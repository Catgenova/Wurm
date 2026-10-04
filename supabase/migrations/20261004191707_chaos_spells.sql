/*
 * Chaos's fifteen spells (`FAITH_SPELLS` in `src/game/patrons.ts`), three at
 * each of the five tiers: one that ruins, one that dreads, and one that is a
 * bargain, paid for in the caster's own health or things rather than favour.
 * None touches another person or anything of theirs: a Chaos spell is cast
 * on a creature, on the ground, on yourself or on a thing you carry.
 *
 * Built on what the Blessing and Justice laid down -- `faith_strike`,
 * `faith_mark`, `player.blessings`, a creature's own bleeding -- and on:
 *
 *   * `faith_flee`, the run a creature makes when its nerve goes, made on
 *     purpose: away from a spot, for so long, and no hunt meanwhile;
 *   * `faith_weak`, a creature made to Cower, whose blows `hurt_player`
 *     cuts by its share (`faith_weakened`);
 *   * a Pact in `faith_arms`, harder on everything; a Blood Feast in
 *     `perform_fight`, healing by what a blow dealt (`faith_feast`), turned
 *     from a creature's health into a share of a life by `blow_share`;
 *   * a Shroud in `hunt_settle`: nothing notices you, and a hunt loses you,
 *     past its reach (`faith_shroud`);
 *   * Undying in `hurt_player` and `faith_oath`, ahead of a Second Life and
 *     not spent by the blow it stops (`faith_undying`).
 *
 * And every spell on the ground now finds what is inside by the whole of the
 * leg a creature is on rather than the end of it: one already running from
 * a Panic, its leg ending far off, was missed by a Cataclysm cast where it
 * still stood. Benediction and Judgment had the same box.
 */
set local lock_timeout = '3s';

create table if not exists faith_weak (
  world_id uuid not null references world on delete cascade,
  creature_id int not null,
  cut double precision not null,
  until timestamptz not null,
  primary key (world_id, creature_id)
);
alter table faith_weak enable row level security;

-- What a creature's blows land for, made to Cower: its share less while it lasts.
create or replace function faith_weakened(p_world uuid, p_id int) returns double precision language sql stable as $fn$
  select 1 - coalesce((select w.cut from faith_weak w where w.world_id = p_world and w.creature_id = p_id and w.until > now()), 0)
$fn$;

-- Health back, as a share of a life, up to whole: how much it came to.
create or replace function faith_heal(p_world uuid, p_uid uuid, p_share double precision) returns double precision
 language plpgsql as $fn$
declare v_h double precision;
begin
  select coalesce((stats->>'health')::double precision, 1) into v_h from player where world_id = p_world and uid = p_uid for update;
  if not found or p_share <= 0 then return 0; end if;
  update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{health}', to_jsonb(least(1, v_h + p_share)))
   where world_id = p_world and uid = p_uid;
  return least(1, v_h + p_share) - v_h;
end $fn$;

-- A bargain's price, paid in health: false, and nothing taken, when there is not more than that to pay with.
create or replace function faith_spend(p_world uuid, p_uid uuid, p_price double precision) returns boolean
 language plpgsql as $fn$
declare v_h double precision;
begin
  select coalesce((stats->>'health')::double precision, 1) into v_h from player where world_id = p_world and uid = p_uid for update;
  if not found or v_h <= p_price then return false; end if;
  update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{health}', to_jsonb(v_h - p_price))
   where world_id = p_world and uid = p_uid;
  return true;
end $fn$;

-- Favour given, up to what the caster's faith holds: how much of it fitted.
create or replace function faith_favour_add(p_world uuid, p_uid uuid, p_amount double precision) returns double precision
 language plpgsql as $fn$
declare v_now double precision; v_add double precision;
begin
  v_now := favour_settle(p_world, p_uid);
  v_add := greatest(0, least(p_amount, favour_cap(skill_of(p_world, p_uid, faith_skill())) - v_now));
  if v_add > 0 then update player set favour = favour + v_add where world_id = p_world and uid = p_uid; end if;
  return v_add;
end $fn$;

/*
 * A creature running from a spot for so long: its hunt dropped and none
 * taken up meanwhile, and a leg away as far as it runs in that time at the
 * pace a nerve gone makes it (`flee_pace`), round whatever is in the way.
 */
create or replace function faith_flee(p_world uuid, p_id int, p_fx double precision, p_fy double precision, p_secs double precision)
  returns void language plpgsql as $fn$
declare c creature; d species_def; a age_def; v_cx double precision; v_cy double precision; v_d double precision;
        v_pace double precision; v_run double precision; v_step record; v_tx double precision; v_ty double precision;
begin
  perform creature_settle(p_world, p_id);
  select * into c from creature where world_id = p_world and id = p_id for update;
  if not found then return; end if;
  select * into d from species_def where id = c.species;
  a := age_row(c.born, old_of(c));
  v_cx := creature_x(c); v_cy := creature_y(c);
  v_d := greatest(0.001, sqrt((v_cx - p_fx) ^ 2 + (v_cy - p_fy) ^ 2));
  v_pace := greatest(0.1, d.speed * a.speed * beast_mul(c, 'speed') * flee_pace());
  v_run := v_pace * p_secs;
  select * into v_step from chase_leg(p_world, v_cx, v_cy, v_cx + (v_cx - p_fx) / v_d * v_run, v_cy + (v_cy - p_fy) / v_d * v_run);
  v_tx := coalesce(v_step.x, v_cx); v_ty := coalesce(v_step.y, v_cy);
  update creature set hunting = null, windup_at = null, brawl = null,
      hunt_again = now() + make_interval(secs => p_secs),
      from_x = v_cx, from_y = v_cy, to_x = v_tx, to_y = v_ty, leg_at = now(),
      leg_ends = now() + make_interval(secs => greatest(0.2, sqrt((v_tx - v_cx) ^ 2 + (v_ty - v_cy) ^ 2) / v_pace)),
      until = now() + make_interval(secs => p_secs), settled_at = now()
    where world_id = p_world and id = p_id;
end $fn$;

-- How far off a creature can notice somebody under a Shroud, or keep hunting them: no limit without one.
create or replace function faith_shroud(p_world uuid, p_uid uuid) returns double precision language sql stable as $fn$
  select coalesce((select (p.blessings->'shroud'->>'reach')::double precision from player p
                    where p.world_id = p_world and p.uid = p_uid and (p.blessings->'shroud'->>'until')::timestamptz > now()), 1e9)
$fn$;

-- A blow on somebody under a Blood Feast heals them by its share of what it dealt, as a share of a life.
create or replace function faith_feast(p_world uuid, p_uid uuid, p_dmg double precision) returns void language plpgsql as $fn$
declare b jsonb;
begin
  if p_dmg is null or p_dmg <= 0 then return; end if;
  select blessings into b from player where world_id = p_world and uid = p_uid;
  if not coalesce((b->'blood_feast'->>'until')::timestamptz > now(), false) then return; end if;
  perform faith_heal(p_world, p_uid, p_dmg * (b->'blood_feast'->>'share')::double precision * blow_share());
end $fn$;

-- Whether Undying holds somebody at its floor against the blow that would kill them; not spent by it.
create or replace function faith_undying(p_world uuid, p_uid uuid) returns boolean language plpgsql as $fn$
declare b jsonb;
begin
  select blessings into b from player where world_id = p_world and uid = p_uid;
  if not coalesce((b->'undying'->>'until')::timestamptz > now(), false) then return false; end if;
  update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{health}', to_jsonb((b->'undying'->>'floor')::double precision))
   where world_id = p_world and uid = p_uid;
  perform tell(p_world, p_uid, (select name from faith_spell where id = 'chaos_undying') || ' holds: the blow leaves you at '
    || faith_pct((b->'undying'->>'floor')::double precision) || ' of your health.', 'fight');
  return true;
end $fn$;

-- How much harder somebody's blows land: a Bless Arms on them, at a monster; a Pact, at anything.
create or replace function faith_arms(p_world uuid, p_uid uuid, d species_def) returns double precision language sql stable as $fn$
  select coalesce((select (case when d.monster and (p.blessings->'arms'->>'until')::timestamptz > now()
                                then 1 + (p.blessings->'arms'->>'more')::double precision else 1 end)
                        * (case when (p.blessings->'pact'->>'until')::timestamptz > now()
                                then 1 + (p.blessings->'pact'->>'more')::double precision else 1 end)
                     from player p where p.world_id = p_world and p.uid = p_uid), 1)
$fn$;

CREATE OR REPLACE FUNCTION public.faith_spell_cast(p_world uuid, p_uid uuid, p_spell text, p_target jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare s faith_spell; me player; c creature; d species_def; it item; r jsonb; g placed;
        v_h double precision; v_top double precision; v_died boolean := false;
        v_uid uuid; v_who text; v_whose text; v_id bigint; v_said text;
        v_x double precision; v_y double precision; v_r double precision; v_n int := 0; v_m int := 0;
        v_tx int; v_ty int; v_data int; v_next int; v_tree int := tile_id('Tree'); v_size int;
begin
  select * into s from faith_spell where id = p_spell;
  if not found then return jsonb_build_object('why', 'There is no such spell.'); end if;
  select * into me from player where world_id = p_world and uid = p_uid;
  if p_target->>'kind' in ('self', 'player') then
    v_uid := (p_target->>'uid')::uuid;
    v_who := case when v_uid = p_uid then 'you' else (select name from player where world_id = p_world and uid = v_uid) end;
    v_whose := case when v_uid = p_uid then 'You are' else v_who || ' is' end;
  elsif p_target->>'kind' in ('enemy', 'wildermon') then
    v_id := (p_target->>'id')::bigint;
    perform creature_settle(p_world, v_id::int);
    select * into c from creature where world_id = p_world and id = v_id;
    if not found then return jsonb_build_object('why', 'That is not here.'); end if;
    select * into d from species_def where id = c.species;
  elsif p_target->>'kind' = 'area' then
    v_x := (p_target->>'x')::double precision;
    v_y := (p_target->>'y')::double precision;
    v_r := (p_target->>'radius')::double precision;
  end if;

  case p_spell
  when 'blessing_soothe' then
    r := faith_mend(p_world, v_uid, spell_fx(p_spell, 'heal'), false);
    if (r->>'healed')::double precision <= 0 and (r->>'stopped')::int = 0 then
      return jsonb_build_object('why', v_whose || ' not hurt.');
    end if;
    v_said := s.name || ' heals ' || v_who || ' by ' || faith_pct(spell_fx(p_spell, 'heal'))
      || case when (r->>'stopped')::int > 0 then ' and stops a wound bleeding' else '' end || '.';

  when 'blessing_ward' then
    perform blessing_put(p_world, v_uid, 'ward', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'cut', spell_fx(p_spell, 'cut')));
    v_said := s.name || ' is on ' || v_who || ' for ' || faith_span(spell_fx(p_spell, 'secs')) || '.';

  when 'blessing_tend' then
    if not faith_tend(p_world, c.id, spell_fx(p_spell, 'heal')) then
      return jsonb_build_object('why', 'The ' || lower(d.name) || ' is not hurt.');
    end if;
    v_said := s.name || ' heals the ' || lower(d.name) || ' by ' || faith_pct(spell_fx(p_spell, 'heal')) || ' and stops it bleeding.';

  when 'blessing_purify' then
    if not faith_purify(p_world, v_uid) then
      return jsonb_build_object('why', case when v_uid = p_uid then 'You carry' else v_who || ' carries' end || ' no venom and no burns.');
    end if;
    v_said := s.name || ' draws the venom and the burns out of ' || v_who || '.';

  when 'blessing_calm' then
    if d.monster then return jsonb_build_object('why', 'Monsters are not calmed.'); end if;
    update creature set hunting = null, windup_at = null,
        hunt_again = now() + make_interval(secs => spell_fx(p_spell, 'secs'))
      where world_id = p_world and id = c.id;
    v_said := 'The ' || lower(d.name) || ' is calmed, and will not hunt for ' || faith_span(spell_fx(p_spell, 'secs')) || '.';

  when 'blessing_steady' then
    if p_target->>'item' is null then return jsonb_build_object('why', s.name || ' is cast on a tool you carry.'); end if;
    select * into it from item where world_id = p_world and id = (p_target->>'item')::bigint;
    if not exists (select 1 from action_def where tool = it.def) then
      return jsonb_build_object('why', 'The ' || lower(item_name(it)) || ' is not a tool any job wants.');
    end if;
    perform blessing_put(p_world, p_uid, 'steady', jsonb_build_object('item', it.id,
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'cut', spell_fx(p_spell, 'cut')));
    v_said := s.name || ': every job wanting your ' || lower(item_name(it)) || ' takes '
      || faith_pct(spell_fx(p_spell, 'cut')) || ' less time for ' || faith_span(spell_fx(p_spell, 'secs')) || '.';

  when 'blessing_renewal' then
    if coalesce((select (stats->>'health')::double precision from player where world_id = p_world and uid = v_uid), 1) >= 1 then
      return jsonb_build_object('why', v_whose || ' not hurt.');
    end if;
    perform body_settle(p_world, v_uid);
    perform blessing_put(p_world, v_uid, 'renewal', jsonb_build_object('at', now(),
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')),
      'each', spell_fx(p_spell, 'each'), 'every', spell_fx(p_spell, 'every')));
    v_said := s.name || ' heals ' || v_who || ' by ' || faith_pct(spell_fx(p_spell, 'each')) || ' every '
      || faith_span(spell_fx(p_spell, 'every')) || ' for ' || faith_span(spell_fx(p_spell, 'secs')) || '.';

  when 'blessing_arms' then
    perform blessing_put(p_world, v_uid, 'arms', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'more', spell_fx(p_spell, 'more')));
    v_said := s.name || ' is on ' || v_who || ' for ' || faith_span(spell_fx(p_spell, 'secs')) || ': '
      || faith_pct(spell_fx(p_spell, 'more')) || ' more damage to monsters.';

  when 'blessing_kinship' then
    if d.monster then return jsonb_build_object('why', 'Monsters cannot be tamed.'); end if;
    if c.mode <> 'wild' then return jsonb_build_object('why', 'The ' || lower(d.name) || ' is tame already.'); end if;
    perform blessing_put(p_world, p_uid, 'kinship', jsonb_build_object('id', c.id,
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'points', spell_fx(p_spell, 'points')));
    v_said := s.name || ': your next go at taming the ' || lower(d.name) || ' within ' || faith_span(spell_fx(p_spell, 'secs'))
      || ' is ' || round(spell_fx(p_spell, 'points') * 100)::int || ' points likelier.';

  when 'blessing_benediction' then
    for v_uid in select pl.uid from player pl
                  where pl.world_id = p_world and not pl.away and (pl.x - v_x) ^ 2 + (pl.y - v_y) ^ 2 <= v_r ^ 2 loop
      r := faith_mend(p_world, v_uid, spell_fx(p_spell, 'heal'), true);
      if (r->>'healed')::double precision > 0 or (r->>'stopped')::int > 0 then
        v_n := v_n + 1;
        if v_uid <> p_uid then perform tell(p_world, v_uid, me.name || '’s ' || s.name || ' heals you.', 'system'); end if;
      end if;
    end loop;
    v_uid := null;
    for v_id in select cr.id from creature cr
                  where cr.world_id = p_world and cr.health > 0 and cr.hunting is distinct from p_uid
                    and least(cr.from_x, cr.to_x) <= v_x + v_r and greatest(cr.from_x, cr.to_x) >= v_x - v_r
                and least(cr.from_y, cr.to_y) <= v_y + v_r and greatest(cr.from_y, cr.to_y) >= v_y - v_r
                    and (creature_x(cr) - v_x) ^ 2 + (creature_y(cr) - v_y) ^ 2 <= v_r ^ 2 loop
      if faith_tend(p_world, v_id::int, spell_fx(p_spell, 'heal')) then v_m := v_m + 1; end if;
    end loop;
    if v_n + v_m = 0 then
      return jsonb_build_object('why', 'Nobody and nothing within ' || round(v_r)::int || ' tiles is hurt.');
    end if;
    v_said := s.name || ' heals ' || v_n || case when v_n = 1 then ' person' else ' people' end || ' and '
      || v_m || ' wildermon by ' || faith_pct(spell_fx(p_spell, 'heal')) || '.';

  when 'blessing_shield' then
    perform blessing_put(p_world, v_uid, 'shield', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'left', spell_fx(p_spell, 'share')));
    v_said := s.name || ' is on ' || v_who || ' for ' || faith_span(spell_fx(p_spell, 'secs')) || ', good for '
      || faith_pct(spell_fx(p_spell, 'share')) || ' of a life in damage.';

  when 'blessing_sanctuary' then
    delete from faith_zone where world_id = p_world and until < now() - interval '1 hour';
    insert into faith_zone (world_id, kind, x, y, r, until, by)
      values (p_world, 'sanctuary', v_x, v_y, v_r, now() + make_interval(secs => spell_fx(p_spell, 'secs')), p_uid);
    v_said := s.name || ' holds the ground within ' || round(v_r)::int || ' tiles for ' || faith_span(spell_fx(p_spell, 'secs')) || '.';

  when 'blessing_second_life' then
    perform blessing_put(p_world, v_uid, 'second_life', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'heal', spell_fx(p_spell, 'heal')));
    v_said := s.name || ' is on ' || v_who || ' for ' || faith_span(spell_fx(p_spell, 'secs')) || '.';

  when 'blessing_radiance' then
    delete from faith_zone where world_id = p_world and until < now() - interval '1 hour';
    insert into faith_zone (world_id, kind, x, y, r, rate, until, by)
      values (p_world, 'radiance', v_x, v_y, v_r, spell_fx(p_spell, 'each'),
              now() + make_interval(secs => spell_fx(p_spell, 'secs')), p_uid);
    v_said := s.name || ' burns within ' || round(v_r)::int || ' tiles for ' || faith_span(spell_fx(p_spell, 'secs')) || '.';

  when 'blessing_land' then
    select size into v_size from world where id = p_world;
    for v_ty in greatest(0, floor(v_y - v_r)::int) .. least(v_size - 1, floor(v_y + v_r)::int) loop
      for v_tx in greatest(0, floor(v_x - v_r)::int) .. least(v_size - 1, floor(v_x + v_r)::int) loop
        continue when (v_tx + 0.5 - v_x) ^ 2 + (v_ty + 0.5 - v_y) ^ 2 > v_r ^ 2;
        continue when land_tile(p_world, v_tx, v_ty) is distinct from v_tree;
        v_data := land_data(p_world, v_tx, v_ty);
        select a.next into v_next from tree_age_def a join tree_age_def b on b.id = a.next
         where a.id = tree_age(v_data) and a.alive and b.alive and a.next <> a.id;
        continue when v_next is null;
        perform land_set_data(p_world, v_tx, v_ty, (v_data & 143) | (v_next << 4));
        perform land_announce(p_world, v_tx, v_ty);
        v_n := v_n + 1;
      end loop;
    end loop;
    if v_n = 0 then
      return jsonb_build_object('why', 'No tree within ' || round(v_r)::int || ' tiles can grow a stage.');
    end if;
    v_said := s.name || ' grows ' || v_n || case when v_n = 1 then ' tree' else ' trees' end || ' a stage.';

  when 'justice_mark' then
    perform faith_mark_put(p_world, c.id, spell_fx(p_spell, 'more'), spell_fx(p_spell, 'secs'), p_uid);
    v_said := 'The ' || lower(d.name) || ' is marked: ' || faith_pct(spell_fx(p_spell, 'more')) || ' more damage from every blow for '
      || faith_span(spell_fx(p_spell, 'secs')) || '.';

  when 'justice_retribution' then
    perform blessing_put(p_world, v_uid, 'retribution', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'share', spell_fx(p_spell, 'share')));
    v_said := s.name || ' is on ' || v_who || ' for ' || faith_span(spell_fx(p_spell, 'secs')) || ': '
      || faith_pct(spell_fx(p_spell, 'share')) || ' of every blow goes back to whatever struck.';

  when 'justice_assay' then
    v_n := faith_assay(p_world, p_uid, v_x, v_y, v_r, spell_fx(p_spell, 'secs'));
    if v_n = 0 then
      return jsonb_build_object('why', 'There is no ore under the ground within ' || round(v_r)::int || ' tiles.');
    end if;
    v_said := s.name || ' marks ' || v_n || case when v_n = 1 then ' ore seam' else ' ore seams' end || ' within '
      || round(v_r)::int || ' tiles for ' || faith_span(spell_fx(p_spell, 'secs')) || '.';

  when 'justice_sentence' then
    v_top := max_health(c);
    if c.health >= v_top then return jsonb_build_object('why', 'The ' || lower(d.name) || ' is unhurt.'); end if;
    v_h := (v_top - c.health) * spell_fx(p_spell, 'share');
    v_died := faith_strike(p_world, p_uid, c.id, v_h);
    v_said := s.name || ' strikes the ' || lower(d.name) || ' for ' || round(v_h)::int
      || case when v_died then ', and it dies.' else '.' end;

  when 'justice_bind' then
    v_h := spell_fx(p_spell, 'secs') * case when d.monster then spell_fx(p_spell, 'monster') else 1 end;
    v_x := creature_x(c); v_y := creature_y(c);
    update creature set from_x = v_x, from_y = v_y, to_x = v_x, to_y = v_y, leg_at = now(), leg_ends = now(),
        until = now() + make_interval(secs => v_h), windup_at = null
      where world_id = p_world and id = c.id;
    v_said := 'The ' || lower(d.name) || ' is held where it stands for ' || faith_span(v_h) || '.';

  when 'justice_equity' then
    select coalesce((stats->>'health')::double precision, 1) into v_h from player where world_id = p_world and uid = p_uid;
    select coalesce((stats->>'health')::double precision, 1) into v_top from player where world_id = p_world and uid = v_uid;
    if abs(v_h - v_top) < 0.005 then
      return jsonb_build_object('why', 'You and ' || v_who || ' are even already.');
    end if;
    v_h := (v_h + v_top) / 2;
    update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{health}', to_jsonb(v_h))
      where world_id = p_world and uid in (p_uid, v_uid);
    v_said := s.name || ': you and ' || v_who || ' are both at ' || faith_pct(v_h) || ' of your health.';

  when 'justice_verdict', 'justice_execution' then
    v_top := max_health(c);
    v_h := v_top * case when d.monster then spell_fx(p_spell, 'monster') else spell_fx(p_spell, 'below') end;
    if c.health < v_h then
      perform faith_strike(p_world, p_uid, c.id, c.health + 1);
      v_said := s.name || ': the ' || lower(d.name) || ' dies.';
    else
      v_died := faith_strike(p_world, p_uid, c.id, v_top * spell_fx(p_spell, 'share'));
      v_said := s.name || ' strikes the ' || lower(d.name) || ' for ' || faith_pct(spell_fx(p_spell, 'share')) || ' of its health'
        || case when v_died then ', and it dies.' else '.' end;
    end if;

  when 'justice_summons' then
    if coalesce(d.timid, false) then return jsonb_build_object('why', 'The ' || lower(d.name) || ' will not fight anybody.'); end if;
    update creature set hunting = p_uid, brawl = null, windup_at = null, hunt_again = null,
        hunt_x = creature_x(c), hunt_y = creature_y(c),
        threat_at = now() + make_interval(secs => spell_fx(p_spell, 'secs') - threat_hold())
      where world_id = p_world and id = c.id;
    v_said := 'The ' || lower(d.name) || ' turns on you, and hunts only you for ' || faith_span(spell_fx(p_spell, 'secs')) || '.';

  when 'justice_temper' then
    if p_target->>'item' is null then return jsonb_build_object('why', s.name || ' is cast on a thing you carry.'); end if;
    select * into it from item where world_id = p_world and id = (p_target->>'item')::bigint;
    perform blessing_put(p_world, p_uid, 'temper', jsonb_build_object('item', it.id,
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs'))));
    v_said := s.name || ': your ' || lower(item_name(it)) || ' takes no wear for ' || faith_span(spell_fx(p_spell, 'secs')) || '.';

  when 'justice_judgment' then
    for c in select cr.* from creature cr
              where cr.world_id = p_world and cr.health > 0 and cr.hunting is not null and cr.mode = 'wild'
                and least(cr.from_x, cr.to_x) <= v_x + v_r and greatest(cr.from_x, cr.to_x) >= v_x - v_r
                and least(cr.from_y, cr.to_y) <= v_y + v_r and greatest(cr.from_y, cr.to_y) >= v_y - v_r
                and (creature_x(cr) - v_x) ^ 2 + (creature_y(cr) - v_y) ^ 2 <= v_r ^ 2 loop
      perform faith_mark_put(p_world, c.id, spell_fx(p_spell, 'more'), spell_fx(p_spell, 'secs'), p_uid);
      if faith_strike(p_world, p_uid, c.id, max_health(c) * spell_fx(p_spell, 'share')) then v_m := v_m + 1; end if;
      v_n := v_n + 1;
    end loop;
    if v_n = 0 then
      return jsonb_build_object('why', 'Nothing within ' || round(v_r)::int || ' tiles is hunting anybody.');
    end if;
    v_said := s.name || ' strikes ' || v_n || case when v_n = 1 then ' creature' else ' creatures' end || ' for '
      || faith_pct(spell_fx(p_spell, 'share')) || ' of their health and marks them'
      || case when v_m > 0 then '; ' || v_m || ' of them died.' else '.' end;

  when 'justice_truce' then
    delete from faith_zone where world_id = p_world and until < now() - interval '1 hour';
    insert into faith_zone (world_id, kind, x, y, r, until, by)
      values (p_world, 'truce', v_x, v_y, v_r, now() + make_interval(secs => spell_fx(p_spell, 'secs')), p_uid);
    v_said := s.name || ' holds within ' || round(v_r)::int || ' tiles for ' || faith_span(spell_fx(p_spell, 'secs'))
      || ': nothing there strikes or is struck.';

  when 'justice_restitution' then
    select * into g from placed
     where world_id = p_world and kind = 'furniture' and sub = 'grave' and made_by = v_uid order by id desc limit 1;
    if not found then
      return jsonb_build_object('why', case when v_uid = p_uid then 'You have' else v_who || ' has' end || ' no grave.');
    end if;
    with moved as (
      update item set holder = 'player', holder_uid = v_uid, placed = null
       where world_id = p_world and holder = 'furniture' and placed = g.id returning 1)
    select count(*) into v_n from moved;
    delete from placed where world_id = p_world and id = g.id;
    v_said := s.name || ' brings ' || v_n || case when v_n = 1 then ' thing' else ' things' end || ' back from '
      || case when v_uid = p_uid then 'your' else v_who || '’s' end || ' grave.';

  when 'justice_oath' then
    if not exists (select 1 from friend where world_id = p_world and uid = p_uid and other = v_uid and state = 'friends') then
      return jsonb_build_object('why', 'An Oath binds only friends, and ' || v_who || ' is not yours.');
    end if;
    perform blessing_put(p_world, p_uid, 'oath', jsonb_build_object('with', v_uid,
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs'))));
    perform blessing_put(p_world, v_uid, 'oath', jsonb_build_object('with', p_uid,
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs'))));
    v_said := s.name || ' binds you and ' || v_who || ' for ' || faith_span(spell_fx(p_spell, 'secs'))
      || ': every blow on either of you is split between you.';

  when 'justice_reward' then
    perform blessing_put(p_world, v_uid, 'reward', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'more', spell_fx(p_spell, 'more')));
    v_said := s.name || ' is on ' || v_who || ' for ' || faith_span(spell_fx(p_spell, 'secs')) || ': '
      || faith_pct(spell_fx(p_spell, 'more')) || ' more from every skill raised.';

  when 'chaos_hex' then
    update creature set bleed_rate = greatest(coalesce(bleed_rate, 0), max_health(c) * spell_fx(p_spell, 'each')),
        bleed_until = greatest(coalesce(bleed_until, now()), now() + make_interval(secs => spell_fx(p_spell, 'secs'))),
        settled_at = now()
      where world_id = p_world and id = c.id;
    v_said := 'The ' || lower(d.name) || ' bleeds ' || faith_pct(spell_fx(p_spell, 'each')) || ' of its health a second for '
      || faith_span(spell_fx(p_spell, 'secs')) || '.';

  when 'chaos_fright' then
    if d.monster then return jsonb_build_object('why', 'Monsters are not frightened.'); end if;
    perform faith_flee(p_world, c.id, me.x, me.y, spell_fx(p_spell, 'secs'));
    v_said := 'The ' || lower(d.name) || ' flees from you for ' || faith_span(spell_fx(p_spell, 'secs')) || '.';

  when 'chaos_blood_price' then
    if coalesce((me.stats->>'health')::double precision, 1) < spell_fx(p_spell, 'floor') then
      return jsonb_build_object('why', s.name || ' wants at least ' || faith_pct(spell_fx(p_spell, 'floor')) || ' of your health.');
    end if;
    v_h := faith_favour_add(p_world, p_uid, spell_fx(p_spell, 'favour'));
    if v_h <= 0 then return jsonb_build_object('why', 'Your favour is full.'); end if;
    perform faith_spend(p_world, p_uid, spell_fx(p_spell, 'price'));
    v_said := s.name || ': ' || faith_pct(spell_fx(p_spell, 'price')) || ' of your health for ' || round(v_h)::int || ' favour.';

  when 'chaos_siphon' then
    v_h := max_health(c) * spell_fx(p_spell, 'share');
    v_died := faith_strike(p_world, p_uid, c.id, v_h);
    v_top := faith_heal(p_world, p_uid, v_h * blow_share());
    v_said := s.name || ' takes ' || round(v_h)::int || ' health from the ' || lower(d.name) || ' and heals you by '
      || faith_pct(v_top) || case when v_died then '; it dies.' else '.' end;

  when 'chaos_cower' then
    insert into faith_weak (world_id, creature_id, cut, until)
    values (p_world, c.id, spell_fx(p_spell, 'cut'), now() + make_interval(secs => spell_fx(p_spell, 'secs')))
    on conflict (world_id, creature_id) do update set cut = greatest(faith_weak.cut, excluded.cut), until = greatest(faith_weak.until, excluded.until);
    v_said := 'The ' || lower(d.name) || ' cowers: its blows do ' || faith_pct(spell_fx(p_spell, 'cut')) || ' less for '
      || faith_span(spell_fx(p_spell, 'secs')) || '.';

  when 'chaos_pact', 'chaos_blood_feast', 'chaos_undying' then
    if not faith_spend(p_world, p_uid, spell_fx(p_spell, 'price')) then
      return jsonb_build_object('why', 'You have not got ' || faith_pct(spell_fx(p_spell, 'price')) || ' of your health to spend.');
    end if;
    perform blessing_put(p_world, p_uid, substr(p_spell, 7), (select fx from faith_spell where id = p_spell)
      || jsonb_build_object('until', now() + make_interval(secs => spell_fx(p_spell, 'secs'))));
    v_said := s.name || ': ' || faith_pct(spell_fx(p_spell, 'price')) || ' of your health, for ' || faith_span(spell_fx(p_spell, 'secs')) || '.';

  when 'chaos_plague' then
    for c in select cr.* from creature cr
              where cr.world_id = p_world and cr.health > 0 and cr.mode = 'wild'
                and least(cr.from_x, cr.to_x) <= v_x + v_r and greatest(cr.from_x, cr.to_x) >= v_x - v_r
                and least(cr.from_y, cr.to_y) <= v_y + v_r and greatest(cr.from_y, cr.to_y) >= v_y - v_r
                and (creature_x(cr) - v_x) ^ 2 + (creature_y(cr) - v_y) ^ 2 <= v_r ^ 2 loop
      perform creature_settle(p_world, c.id);
      update creature set bleed_rate = greatest(coalesce(bleed_rate, 0), max_health(c) * spell_fx(p_spell, 'each')),
          bleed_until = greatest(coalesce(bleed_until, now()), now() + make_interval(secs => spell_fx(p_spell, 'secs')))
        where world_id = p_world and id = c.id;
      v_n := v_n + 1;
    end loop;
    if v_n = 0 then return jsonb_build_object('why', 'There is nothing wild within ' || round(v_r)::int || ' tiles.'); end if;
    v_said := s.name || ' takes ' || v_n || case when v_n = 1 then ' creature' else ' creatures' end || ' within '
      || round(v_r)::int || ' tiles.';

  when 'chaos_panic' then
    for c in select cr.* from creature cr
              where cr.world_id = p_world and cr.health > 0 and cr.mode = 'wild'
                and least(cr.from_x, cr.to_x) <= v_x + v_r and greatest(cr.from_x, cr.to_x) >= v_x - v_r
                and least(cr.from_y, cr.to_y) <= v_y + v_r and greatest(cr.from_y, cr.to_y) >= v_y - v_r
                and (creature_x(cr) - v_x) ^ 2 + (creature_y(cr) - v_y) ^ 2 <= v_r ^ 2 loop
      perform faith_flee(p_world, c.id, v_x, v_y,
        case when (select sd.monster from species_def sd where sd.id = c.species) then spell_fx(p_spell, 'monster') else spell_fx(p_spell, 'secs') end);
      v_n := v_n + 1;
    end loop;
    if v_n = 0 then return jsonb_build_object('why', 'There is nothing wild within ' || round(v_r)::int || ' tiles.'); end if;
    v_said := s.name || ': ' || v_n || case when v_n = 1 then ' creature flees.' else ' creatures flee.' end;

  when 'chaos_unmake' then
    if p_target->>'item' is null then return jsonb_build_object('why', s.name || ' is cast on a thing you carry.'); end if;
    select * into it from item where world_id = p_world and id = (p_target->>'item')::bigint;
    if exists (select 1 from jsonb_each_text(coalesce(me.equipped, '{}'::jsonb)) e where e.value = it.id::text) then
      return jsonb_build_object('why', 'Take the ' || lower(item_name(it)) || ' off first.');
    end if;
    if coalesce(it.locked, false) then return jsonb_build_object('why', 'The ' || lower(item_name(it)) || ' is locked.'); end if;
    if exists (select 1 from item i where i.inside = it.id) then
      return jsonb_build_object('why', 'Empty the ' || lower(item_name(it)) || ' first.');
    end if;
    v_h := faith_favour_add(p_world, p_uid, least(spell_fx(p_spell, 'most'), it.ql * spell_fx(p_spell, 'per')));
    if v_h <= 0 then return jsonb_build_object('why', 'Your favour is full.'); end if;
    delete from item where id = it.id;
    v_said := s.name || ': the ' || lower(item_name(it)) || ' is gone, for ' || round(v_h)::int || ' favour.';

  when 'chaos_soul_rend' then
    v_died := faith_strike(p_world, p_uid, c.id, max_health(c) * spell_fx(p_spell, 'share'));
    if v_died then v_h := faith_favour_add(p_world, p_uid, spell_fx(p_spell, 'favour')); end if;
    v_said := s.name || ' takes ' || faith_pct(spell_fx(p_spell, 'share')) || ' of the ' || lower(d.name) || '’s health'
      || case when v_died then '; it dies, and ' || round(coalesce(v_h, 0))::int || ' favour comes back to you.' else '.' end;

  when 'chaos_shroud' then
    perform blessing_put(p_world, p_uid, 'shroud', jsonb_build_object('reach', spell_fx(p_spell, 'reach'),
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs'))));
    v_said := s.name || ' is on you for ' || faith_span(spell_fx(p_spell, 'secs')) || '.';

  when 'chaos_cataclysm' then
    for c in select cr.* from creature cr
              where cr.world_id = p_world and cr.health > 0 and cr.mode = 'wild'
                and least(cr.from_x, cr.to_x) <= v_x + v_r and greatest(cr.from_x, cr.to_x) >= v_x - v_r
                and least(cr.from_y, cr.to_y) <= v_y + v_r and greatest(cr.from_y, cr.to_y) >= v_y - v_r
                and (creature_x(cr) - v_x) ^ 2 + (creature_y(cr) - v_y) ^ 2 <= v_r ^ 2 loop
      if faith_strike(p_world, p_uid, c.id, max_health(c) * spell_fx(p_spell, 'share')) then v_m := v_m + 1; end if;
      v_n := v_n + 1;
    end loop;
    if v_n = 0 then return jsonb_build_object('why', 'There is nothing wild within ' || round(v_r)::int || ' tiles.'); end if;
    v_said := s.name || ' takes ' || faith_pct(spell_fx(p_spell, 'share')) || ' from ' || v_n
      || case when v_n = 1 then ' creature' else ' creatures' end || case when v_m > 0 then '; ' || v_m || ' died.' else '.' end;

  when 'chaos_abyssal_gaze' then
    perform faith_flee(p_world, c.id, me.x, me.y, spell_fx(p_spell, 'secs'));
    perform faith_mark_put(p_world, c.id, spell_fx(p_spell, 'more'), spell_fx(p_spell, 'secs'), p_uid);
    v_said := 'The ' || lower(d.name) || ' flees from you for ' || faith_span(spell_fx(p_spell, 'secs')) || ', taking '
      || faith_pct(spell_fx(p_spell, 'more')) || ' more from every blow.';

  else
    return jsonb_build_object('why', 'Nothing is written behind that spell yet.');
  end case;

  if v_uid is not null and v_uid <> p_uid then
    perform tell(p_world, v_uid, me.name || ' casts ' || s.name || ' on you. ' || s.note, 'system');
  end if;
  return jsonb_build_object('said', v_said);
end $function$;

CREATE OR REPLACE FUNCTION public.hurt_player(p_world uuid, p_uid uuid, p_raw double precision, p_what text, p_kind text DEFAULT 'bite'::text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare p player; shield item; sh shield_def; chance double precision; roll double precision;
        part text; piece item; cls armour_class_def; soak double precision; taken double precision;
        health double precision; ws jsonb; had jsonb; found_w boolean := false; out_w jsonb := '[]'::jsonb;
        w jsonb; k wound_kind_def; note text; aegis double precision; v_worn double precision;
        v_from creature; v_venom boolean := false; v_dodge double precision;
begin
  select * into p from player where world_id = p_world and uid = p_uid for update;
  if not found then return; end if;
  -- Dodged, before anything else has its say (`dodge_chance`): your body control, less the armour on you.
  select * into v_from from creature where world_id = p_world and id = (p.stats->>'hurtBy')::int;
  -- Nothing is struck inside a Truce, nor by anything standing in one (`faith_truce`).
  if faith_truce(p_world, p.x, p.y)
     or (v_from.id is not null and faith_truce(p_world, creature_x(v_from), creature_y(v_from))) then
    return;
  end if;
  -- No roll at all while there is no chance, so nothing else's luck moves.
  v_dodge := dodge_chance(skill_of(p_world, p_uid, 'body_control'), worn_kg(p_world, p_uid));
  if v_dodge > 0 and random() < v_dodge then
    perform skill_raise(p_world, p_uid, 'body_control', dodge_gain());
    perform tell(p_world, p_uid, 'You dodge the '
      || coalesce((select lower(name) from species_def where id = v_from.species), 'blow') || '.', 'fight');
    perform fight_back(p_world, p_uid, (p.stats->>'hurtBy')::int);
    return;
  end if;
  -- A venomous bite leaves venom in what it opens (`venom_secs`).
  -- A Ward, and then a Shield of Dawn, before anything else is asked of the blow (`faith_blunt`).
  p_raw := faith_blunt(p_world, p_uid, p_raw);
  if p_raw <= 0 then
    perform fight_back(p_world, p_uid, (p.stats->>'hurtBy')::int);
    return;
  end if;
  -- A striker made to Cower lands its share less (`faith_weakened`).
  p_raw := p_raw * faith_weakened(p_world, v_from.id);
  v_venom := coalesce((select venom from species_def where id = v_from.species), false);
  -- Harder or softer for the way you stand (`stance_taken`), before anything has its say,
  p_raw := p_raw * stance_taken(p.fight_stance);
  -- and harder from something on you that is not what you are fighting: it is at your back (`flank_hit`).
  if is_fight(p.act) and p.act_target->>'kind' = 'creature' and p.stats ? 'hurtBy'
     and (p.act_target->>'id')::int is distinct from (p.stats->>'hurtBy')::int then
    p_raw := p_raw * flank_hit();
  end if;

  -- Being hit in the dark teaches more about watching than hitting does, and
  -- before the shield, because a blow you turned is still a blow you did not
  -- see coming.
  perform fought_in_dark(p_world, p_uid, dark_hit());

  /*
   * The skin a warder put over you, which takes the blow instead and is spent
   * doing it.
   *
   * Before the shield, because it is not a thing you are holding -- it is
   * between the blow and everything you are holding. A skin that covers the
   * whole blow stops it dead; one that does not goes, and what is left of the
   * blow carries on into the shield and the armour as it always did. Nothing
   * downstream of here knows it happened.
   */
  aegis := coalesce((p.stats->>'aegis')::double precision, 0);
  if aegis > 0 then
    if aegis >= p_raw then
      update player set stats = jsonb_set(stats, '{aegis}', to_jsonb(aegis - p_raw))
        where world_id = p_world and uid = p_uid;
      perform tell(p_world, p_uid, 'The ward takes ' || p_what || ', and holds.', 'fight');
      perform fight_back(p_world, p_uid, (p.stats->>'hurtBy')::int);
      return;
    end if;
    update player set stats = jsonb_set(stats, '{aegis}', to_jsonb(0::double precision))
      where world_id = p_world and uid = p_uid;
    p_raw := p_raw - aegis;
    perform tell(p_world, p_uid, 'The ward goes with a sound like ice, and the rest of it reaches you.', 'fight');
  end if;

  -- The shield, next.
  shield := worn(p_world, p_uid, 'offhand');
  if shield.id is not null then
    select * into sh from shield_def where id = shield.def;
    if found then
      chance := least(0.6, (sh.block * (0.6 + shield.ql / 160)
        + skill_of(p_world, p_uid, 'shields') / 400)
        * class_mul(p_world, p_uid, 'guard', 'shields'))
        -- Less of one for every other thing on you than the one that struck (`crowd_block`).
        * greatest(0, 1 - crowd_block() * (select count(*) from creature o
            where o.world_id = p_world and o.hunting = p_uid and o.mode = 'wild' and o.health > 0 and o.brawl is null
              and o.id is distinct from (p.stats->>'hurtBy')::int));
      perform skill_raise(p_world, p_uid, 'shields', 0.12);
      if random() < chance then
        -- Less for a Mender's Armour Care.
        update item set dmg = least(100, dmg + p_raw * 3 * pk(p_world, p_uid, 'worn:shield', 1)) where id = shield.id;
        perform skill_raise(p_world, p_uid, 'shields', 0.5);
        perform tell(p_world, p_uid, 'You take ' || p_what || ' on your '
          || lower((select name from item_def where id = shield.def)) || '.', 'fight');
        -- A blow turned is still a blow, and you turn on whatever struck it.
        perform fight_back(p_world, p_uid, (p.stats->>'hurtBy')::int);
        return;
      end if;
    end if;
  end if;

  -- Then wherever it lands.
  roll := random();
  select h.slot into part from (
    select slot, sum(share) over (order by ord) as upto from hit_location) h
  where roll <= h.upto order by h.upto limit 1;
  part := coalesce(part, 'chest');

  taken := p_raw;
  note := '';
  piece := worn(p_world, p_uid, part);
  if piece.id is not null and exists (select 1 from armour_def where id = piece.def) then
    select c.* into cls from armour_def a join armour_class_def c on c.id = a.cls where a.id = piece.def;
    -- And the trade, on the line of armour this piece belongs to: a pikeman's
    -- harness does nothing for the leather an archer is wearing.
    soak := piece_soak(piece, skill_of(p_world, p_uid, cls.skill))
          * class_mul(p_world, p_uid, 'guard', cls.skill)
          -- And what this class of armour makes of this kind of blow (`armour_vs`).
          * armour_vs(cls.id, p_kind);
    -- Armour is learned by being hit in it, and worn out the same way.
    perform skill_raise(p_world, p_uid, cls.skill, 0.4);
    -- Less for a Mender's Armour Care.
    -- And a burn wears it out `burn_wear` times as fast.
    v_worn := p_raw * 4 * pk(p_world, p_uid, 'worn:armour', 1) * case when p_kind = 'burn' then burn_wear() else 1 end;
    update item set dmg = least(100, dmg + v_worn) where id = piece.id;
    if (select i.dmg from item i where i.id = piece.id) >= 100 then
      delete from item where id = piece.id;
      update player set equipped = equipped - part where world_id = p_world and uid = p_uid;
      perform tell(p_world, p_uid, 'Your ' || lower((select name from item_def where id = piece.def))
        || ' is beaten to pieces and falls away.', 'fight');
    else
      note := ', though your ' || lower((select name from item_def where id = piece.def)) || ' takes the worst of it';
    end if;
    taken := p_raw * (1 - least(0.92, soak));
  end if;

  select * into k from wound_kind_def where id = p_kind;
  -- Open a wound, or deepen one of the same kind already in that place.
  for w in select * from jsonb_array_elements(coalesce(p.wounds, '[]'::jsonb)) loop
    if not found_w and w->>'kind' = p_kind and w->>'part' = part and not (w->>'infected')::boolean then
      w := jsonb_set(w, '{severity}', to_jsonb((w->>'severity')::double precision + taken));
      if k.bleed > 0.001 then w := jsonb_set(w, '{bleeding}', 'true'); end if;
      if v_venom then w := jsonb_set(w, '{venom}', to_jsonb(venom_secs())); end if;
      found_w := true;
    end if;
    out_w := out_w || w;
  end loop;
  if not found_w then
    -- A bruise does not bleed; everything else does until it is seen to.
    w := jsonb_build_object('kind', p_kind, 'part', part, 'severity', taken,
      'bleeding', p_kind <> 'crush', 'infected', false, 'dressing', null, 'at', now())
      || case when v_venom then jsonb_build_object('venom', venom_secs()) else '{}'::jsonb end;
    out_w := out_w || w;
  end if;

  -- A Retribution's share of what landed goes back to whatever struck, paid when it is next settled (`faith_owed`).
  if v_from.id is not null and (p.blessings->'retribution'->>'until')::timestamptz > now() then
    insert into faith_owed (world_id, creature_id, dmg, from_uid)
      values (p_world, v_from.id, taken * (p.blessings->'retribution'->>'share')::double precision / blow_share(), p_uid);
  end if;
  -- And an Oath puts half of it on the friend sworn to (`faith_oath`).
  taken := faith_oath(p_world, p_uid, taken);
  health := greatest(0, coalesce((p.stats->>'health')::double precision, 1) - taken);
  /*
   * Built from the row as it stands rather than from the copy taken at the top
   * of this function.
   *
   * `p` is a snapshot, and writing `p.stats` back puts everything in it back
   * -- including anything this function itself changed on the way down. That
   * was harmless while nothing did, and the ward is the first thing that does:
   * it was spent against the blow, and then handed straight back, so a warder's
   * skin absorbed for ever. Measured, before the fix: a 0.15 skin took 0.15 of
   * a 0.20 blow, the remaining 0.05 opened a wound as it should -- and the skin
   * read 0.15 again afterwards.
   *
   * Unqualified, `stats` is the column of the row being updated, which is the
   * live value. Nothing else in here reads it after this point.
   */
  update player set wounds = out_w,
      stats = jsonb_set(jsonb_set(stats, '{health}', to_jsonb(health)),
                        '{hurtSettled}', to_jsonb(now()))
    where world_id = p_world and uid = p_uid;
  perform tell(p_world, p_uid, p_what || note || '. You have ' || wound_text(w) || '.', 'fight');
  -- And a Second Life, which the killing blow spends instead of you (`faith_second_life`).
  -- Undying holds you at its floor and is not spent; a Second Life is.
  if health <= 0 and faith_undying(p_world, p_uid) then perform fight_back(p_world, p_uid, (p.stats->>'hurtBy')::int);
  elsif health <= 0 and faith_second_life(p_world, p_uid) then perform fight_back(p_world, p_uid, (p.stats->>'hurtBy')::int);
  elsif health <= 0 then perform player_die(p_world, p_uid);
  else perform fight_back(p_world, p_uid, (p.stats->>'hurtBy')::int); end if;
end $function$;

CREATE OR REPLACE FUNCTION public.perform_fight(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare v_landed boolean; it item; p player; slot text; shield item; c creature; d species_def; w weapon_def;
        bow weapon_def; arrow item; held item; dist double precision; dmg double precision;
        bane double precision; before double precision; died boolean; reach double precision;
        corpse item; sp species_def; knife_ql double precision; v_share double precision;
        made_ql double precision; taken text[] := '{}'; r record; v_n int; lumps text[] := '{}';
        hurt jsonb; use item; suits boolean; clean boolean; healed double precision;
        top double precision; out_w jsonb; one jsonb; lye item; got text; v_bait int;
        pt player; v_other boolean; v_mend double precision; v_kind text; v_crit boolean := false; v_head text;
begin
  select * into p from player where world_id = p_world and uid = p_uid;

  if p_action = 'equip' then
    select * into it from item where id = target_item(p_target);
    slot := slot_of(it.def);
    update player set equipped = jsonb_set(equipped, array[slot], to_jsonb(it.id))
      where world_id = p_world and uid = p_uid returning * into p;
    -- Both hands on it means nothing else in them.
    if slot = 'weapon' and coalesce((select two_handed from weapon_def where id = it.def), false) then
      shield := worn(p_world, p_uid, 'offhand');
      if shield.id is not null then
        update player set equipped = equipped - 'offhand' where world_id = p_world and uid = p_uid;
        perform tell(p_world, p_uid, 'You need both hands for that, so the '
          || lower((select name from item_def where id = shield.def)) || ' goes on your back.', 'info');
      end if;
    end if;
    perform tell(p_world, p_uid, 'You '
      || case when slot in ('weapon', 'offhand') then 'take up' else 'put on' end
      || ' the ' || lower((select name from item_def where id = it.def)) || '.', 'info');

  elsif p_action = 'unequip' then
    select * into it from item where id = target_item(p_target);
    slot := slot_of(it.def);
    update player set equipped = equipped - slot where world_id = p_world and uid = p_uid;
    perform tell(p_world, p_uid, 'You put the '
      || lower((select name from item_def where id = it.def)) || ' away.', 'info');

  elsif p_action = 'attack_creature' then
    c := target_creature(p_world, p_target);
    if c.world_id is null then return; end if;
    select * into d from species_def where id = c.species;
    w := swung_with(p_world, p_uid);
    held := swung_item(p_world, p_uid);
    before := c.health;
    -- The gains used to be written above the roll, so a miss paid exactly
    -- what a landed blow paid.
    -- Its blood has a say in whether you connect at all.
    v_landed := random() <= hit_chance(p_world, p_uid, w.kind, mark_of(held.mark, 'aim')) * beast_mul(c, 'evade');
    perform skill_raise(p_world, p_uid, 'fighting', try_gain(v_landed, swing_fight()));
    perform skill_raise(p_world, p_uid, w.kind, try_gain(v_landed, swing_arm()));
    perform skill_raise(p_world, p_uid, 'body_strength', try_gain(v_landed, swing_body()));
    -- And, if it is dark enough to matter, what it teaches about noticing.
    perform fought_in_dark(p_world, p_uid, dark_swing());
    if not v_landed then
      perform tell(p_world, p_uid, 'You swing at the ' || lower(d.name)
        || case when held.id is null then '' else ' with your '
             || lower((select name from item_def where id = held.def)) end || ' and miss.', 'fight');
    else
      bane := case when held.id is not null and mat_bane(held.extra) and d.glow is not null
                   then bane_bonus() else 1 end;
      -- And harder or softer for the way you stand (`stance_dealt`).
      -- And for what its hide makes of an edge, a point or a weight, and at something whose mind is on another fight.
      -- And now and then a critical one (`crit_chance`).
      v_crit := random() < crit_chance(skill_of(p_world, p_uid, w.kind), w.id, w.kind);
      dmg := weapon_damage(p_world, p_uid, w, held) * bane * stance_dealt(p.fight_stance)
             * hide_takes(d.hide, blow_of(w.id, w.kind)) * blindside_of(c, p_uid) * (0.75 + random() * 0.5)
             * case when v_crit then crit_hit() else 1 end * faith_arms(p_world, p_uid, d);
      died := hurt_creature(p_world, c.id, dmg, p_uid);
      perform faith_feast(p_world, p_uid, dmg);
      -- And what the weapon does besides: a maul staggers, a spear holds it off, a knife opens it up (`sideBlow`).
      if not died and w.id <> 'fist' then perform side_blow(p_world, p_uid, c.id, w.kind, dmg); end if;
      -- Less for a Mender's Armour Care.
      if held.id is not null then perform damage_item(held.id, 0.35 * pk(p_world, p_uid, 'worn:weapon', 1)); end if;
      if not died then
        perform tell(p_world, p_uid, 'You strike the ' || lower(d.name)
          || case when held.id is null then '' else ' with your '
               || lower((select name from item_def where id = held.def)) end
          || case when v_crit then ', a critical blow' else '' end
          || '. It is down to ' || greatest(0, ceil(c.health - dmg)) || ' of ' || max_health(c) || '.', 'fight');
      end if;
    end if;
    /*
     * And it fights back, on its own clock rather than yours: whatever is
     * struck that does not bolt is after you now (`engage_beast`), and lands
     * its blows every `blow_every` seconds in `hunt_settle` while you are in
     * reach of it, swinging or not. It used to answer each swing with a roll.
     */
    if not coalesce(died, false) then perform engage_beast(p_world, c.id, p_uid); end if;

  elsif p_action = 'shoot_creature' then
    c := target_creature(p_world, p_target);
    if c.world_id is null then return; end if;
    select * into d from species_def where id = c.species;
    held := worn(p_world, p_uid, 'weapon');
    select bw.* into bow from weapon_def bw where bw.id = held.def and bw.ammo is not null;
    if not found then return; end if;
    -- The arrows asked for, else plain ones, else any (`nockedArrow`).
    select i.* into arrow from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and arrow_head_of(i.def) is not null
      order by (i.def = coalesce(p_target->>'arrow', 'arrow')) desc, (i.def = 'arrow') desc, i.ql desc limit 1;
    if arrow.id is null or not consume(p_world, p_uid, arrow.def, 1, arrow.id) then return; end if;
    v_head := arrow_head_of(arrow.def);
    dist := (select sqrt((creature_x(c) - pl.x) ^ 2 + (creature_y(c) - pl.y) ^ 2)
             from player pl where pl.world_id = p_world and pl.uid = p_uid);
    -- The far end of a bow's range is a far harder shot than the near end.
    v_landed := random() <= hit_chance(p_world, p_uid, 'archery', mark_of(held.mark, 'aim'))
                            * (1 - (dist / (coalesce(bow.range, 6) * mark_of(held.mark, 'range'))) * 0.35) * beast_mul(c, 'evade');
    perform skill_raise(p_world, p_uid, 'fighting', try_gain(v_landed, shot_fight()));
    perform skill_raise(p_world, p_uid, 'archery', try_gain(v_landed, shot_archery()));
    -- Picking a target out of the dark at range is the hardest looking there is.
    perform fought_in_dark(p_world, p_uid, dark_shot());
    if not v_landed then
      perform tell(p_world, p_uid, 'Your arrow goes wide of the ' || lower(d.name) || '.', 'fight');
    else
      -- The stave throws it; the head is what goes in. Both have a say.
      bane := case when mat_bane(arrow.extra) and d.glow is not null then bane_bonus() else 1 end;
      v_crit := random() < crit_chance(skill_of(p_world, p_uid, 'archery'), bow.id, bow.kind);
      -- And what the head is: a blunt crushes, a bodkin goes through a hide (`headBlow`, `headHide`).
      dmg := weapon_damage(p_world, p_uid, bow, held) * mat_edge(arrow.extra) * bane * stance_dealt(p.fight_stance)
             * hide_takes(d.hide, case when v_head = 'blunt' then 'crush' else blow_of(bow.id, bow.kind) end)
             * case when v_head = 'bodkin' and d.hide is not null then bodkin_hide() else 1 end
             * blindside_of(c, p_uid)
             * (0.6 + arrow.ql / 140) * (0.8 + random() * 0.4)
             * case when v_crit then crit_hit() else 1 end * faith_arms(p_world, p_uid, d);
      died := hurt_creature(p_world, c.id, dmg, p_uid);
      perform faith_feast(p_world, p_uid, dmg);
      perform damage_item(held.id, 0.25 * pk(p_world, p_uid, 'worn:weapon', 1));
      -- A broadhead bleeds it as a knife does, a blunt staggers it as a maul does (`headSide`).
      if not died and v_head in ('broadhead', 'blunt') then
        perform side_blow(p_world, p_uid, c.id, case when v_head = 'broadhead' then 'knives' else 'mauls' end, dmg);
      end if;
      if not died then
        perform tell(p_world, p_uid, 'Your arrow goes home'
          || case when v_crit then ', a critical hit' else '' end || '. The ' || lower(d.name)
          || ' is down to ' || greatest(0, ceil(c.health - dmg)) || ' of ' || max_health(c) || '.', 'fight');
      end if;
    end if;
    -- Shot at, it comes for you, as anything struck does.
    if not coalesce(died, false) then perform engage_beast(p_world, c.id, p_uid); end if;

  elsif p_action = 'butcher' then
    corpse := target_corpse(p_world, p_uid, p_target);
    sp := corpse_species(corpse.extra);
    if corpse.id is null or sp.id is null then return; end if;
    knife_ql := nullif(tool_ql(p_world, p_uid, 'butchering_knife'), 0);
    -- And more of it for a Cook's Full Carcass, and never more than all of it.
    v_share := least(1, butcher_yield(skill_of(p_world, p_uid, 'butchering'), knife_ql)
                        * pk(p_world, p_uid, 'share:butcher', 1));
    /*
     * The Butchering skill decides the quality of everything that comes off
     * the carcass, the way every trade's skill decides what it makes: with a
     * knife it is your skill, or the knife's quality spread 0.6 to 1.4 when
     * that comes out lower; bare-handed it is your skill spread the same way.
     * The corpse's own quality used to scale it down again by 0.6 to 1.0, so
     * a butcher at 100 took meat off at 66 to 80 and the skill did not decide
     * it. Asked for: "Butchering skill determines ql of Butchering output".
     */
    made_ql := product_ql(skill_of(p_world, p_uid, 'butchering'), coalesce(knife_ql, 0));
    -- What it was sleeping on, which is not a part of it at all.
    for r in select sb.n from species_butcher sb where sb.species = sp.id and sb.part = 'hoard' loop
      for v_n in 1..round(r.n * (4 + v_share * 6))::int loop
        select item into got from hoard_metal order by random() limit 1;
        perform gather(p_world, p_uid, got, 1, greatest(20, least(100, 40 + random() * 55)));
        lumps := lumps || lower((select name from item_def where id = got));
      end loop;
    end loop;
    if array_length(lumps, 1) > 0 then
      perform journal_note(p_world, p_uid, 'hoard');
      perform tell(p_world, p_uid, 'Something rattles as the belly opens: ' || array_length(lumps, 1)
        || ' lumps of what it had been sleeping on. '
        || (select string_agg(distinct l, ', ') from unnest(lumps) l) || '.', 'event');
    end if;
    /* `n` was a plpgsql variable here and `species_butcher.n` a column, and
     * Postgres would not guess which was meant. That is the fourth time on
     * this island — `land_tile.y`, `crop.y`, `trait_def.tier` — so the locals
     * that could collide carry a prefix. */
    for r in select b.part, b.item, sb.n from butcher_part b
             join species_butcher sb on sb.part = b.part and sb.species = sp.id
             order by b.ord loop
      v_n := floor(r.n * v_share)::int;
      -- The remainder is a chance at one more, so a poor job still gives something.
      if random() < r.n * v_share - v_n then v_n := v_n + 1; end if;
      -- Glands are the rare part: only a steady hand finds them intact.
      if r.part = 'gland' and v_n > 0 and random() > 0.35 * (0.5 + v_share) then v_n := 0; end if;
      if v_n <= 0 then continue; end if;
      -- Better for a perk on the part (a Cook's Prime Cuts and Hide Keeper).
      perform gather(p_world, p_uid, r.item, v_n,
        least(100, greatest(1, least(100, made_ql)) * pk(p_world, p_uid, 'ql:' || r.item, 1)));
      taken := taken || (case when v_n > 1 then v_n || ' × ' else '' end
        || lower((select name from item_def where id = r.item)));
    end loop;
    -- And bait for the hook out of what is left (a Cook's Bait Maker), into the pack.
    v_bait := floor(pk(p_world, p_uid, 'bait:butcher', 0))::int;
    if v_bait > 0 then
      perform give(p_world, p_uid, 'offal', v_bait, greatest(1, least(100, made_ql)));
      taken := taken || (v_bait || ' × ' || lower((select name from item_def where id = 'offal')));
    end if;
    delete from item where id = corpse.id;
    if array_length(taken, 1) is null then
      perform tell(p_world, p_uid, 'You make a mess of the ' || lower(sp.name)
        || ' carcass and salvage nothing.', 'event');
    else
      perform tell(p_world, p_uid, 'You butcher the ' || lower(sp.name) || ' and take '
        || array_to_string(taken, ', ') || ' (QL ' || to_char(greatest(1, least(100, made_ql)), 'FM990.0') || ').'
        || case when knife_ql is null then ' Bare hands waste most of a carcass.' else '' end, 'event');
    end if;
    /*
     * And what a go at it teaches, which was nothing: every other trade's
     * performer raises its own skill, and this one never did, so Butchering
     * stayed where it started on an island however much was butchered -- and
     * with it the quality of everything taken off a carcass. A full go, as
     * the browser has always counted one, whatever the carcass gave.
     */
    perform skill_raise(p_world, p_uid, 'butchering', 1);

  elsif p_action = 'bind_wound' then
    -- Your own, or somebody else's beside you for a Naturalist's Field Medic:
    -- at your first aid and out of your pack either way.
    v_other := p_target->>'kind' = 'person' and p_target->>'uid' is distinct from p_uid::text;
    if v_other then
      select * into pt from player where world_id = p_world and uid = (p_target->>'uid')::uuid;
      if not found then return; end if;
    else
      select * into pt from player where world_id = p_world and uid = p_uid;
    end if;
    hurt := worst_wound(pt.wounds);
    if hurt is null or (hurt->>'infected')::boolean then return; end if;
    use := dressing_for(p_world, p_uid, hurt);
    if use.id is null or not consume(p_world, p_uid, use.def, 1, use.id) then return; end if;
    got := case when use.def = 'cover' then lower(coalesce(use.extra, '')) else '' end;
    v_kind := (select name from wound_kind_def where id = hurt->>'kind');
    suits := got = (select herb from wound_kind_def where id = hurt->>'kind');
    -- Slips half as often for a Naturalist's Sure Hands.
    clean := perk_pass(skill_check(skill_of(p_world, p_uid, 'first_aid'), dress_check(), use.ql),
                       pk(p_world, p_uid, 'fail:bind_wound', 1));
    -- And closes faster for the hands that dressed it: a Naturalist's Quick Mend.
    v_mend := pk(p_world, p_uid, 'mend:bind_wound', 1);
    -- Cloth holds a dressing on. The right herb closes the wound.
    healed := (0.06 + (skill_of(p_world, p_uid, 'first_aid') / 100) * 0.24 + (use.ql / 100) * 0.1)
              * (case when clean then 1 else 0.35 end)
              * (case when suits then 1.5 when got <> '' then 1.1 else 1 end);
    out_w := '[]'::jsonb;
    for one in select * from jsonb_array_elements(pt.wounds) loop
      if one = hurt then
        one := jsonb_set(one, '{severity}', to_jsonb(greatest(0, (one->>'severity')::double precision - healed)));
        if clean then
          one := jsonb_set(jsonb_set(one, '{dressing}', to_jsonb(got)), '{bleeding}', 'false');
          one := case when v_mend <> 1 then jsonb_set(one, '{mend}', to_jsonb(v_mend)) else one - 'mend' end;
        end if;
      end if;
      if (one->>'severity')::double precision > 0.004 or (one->>'infected')::boolean then
        out_w := out_w || one;
      end if;
    end loop;
    update player set wounds = out_w,
        stats = jsonb_set(pt.stats, '{health}',
          to_jsonb(least(1, coalesce((pt.stats->>'health')::double precision, 1) + healed)))
      where world_id = p_world and uid = pt.uid;
    perform journal_note(p_world, p_uid, 'dressed');
    if clean and suits then perform journal_note(p_world, p_uid, 'covered'); end if;
    perform skill_raise(p_world, p_uid, 'first_aid', try_gain(clean, bandage_gain()));
    if v_other then
      perform tell(p_world, p_uid, case
        when not clean then 'The dressing slips and you make a poor job of it. ' || coalesce(pt.name, 'They')
          || ' still has ' || wound_text(hurt) || '.'
        else 'You dress the ' || v_kind || ' on ' || coalesce(pt.name, 'their') || '''s ' || part_name(hurt->>'part')
          || case when suits then ' with ' || got || ', which suits it.' when got <> '' then ' with ' || got || '.'
                  else ' with cloth.' end
        end, 'event');
      perform tell(p_world, pt.uid, coalesce(p.name, 'Somebody') || case when clean
        then ' dresses the ' || v_kind || ' on your ' || part_name(hurt->>'part') || '.'
        else ' tries to dress the ' || v_kind || ' on your ' || part_name(hurt->>'part') || ' and makes a poor job of it.' end,
        'event');
      return;
    end if;
    perform tell(p_world, p_uid, case
      when not clean then 'The dressing slips and you make a poor job of it. You still have '
        || wound_text(hurt) || '.'
      when suits then 'You lay the ' || got
        || ' cover on and bind it. The bleeding stops at once and it is already closing.'
      when got <> '' then 'You bind the ' || got || ' cover over it. It is the wrong herb for a '
        || (select name from wound_kind_def where id = hurt->>'kind')
        || ', but it holds and the bleeding stops.'
      else 'You clean it and bind it with cloth. The bleeding stops, though it will be slow to close.'
      end, 'event');

  elsif p_action = 'clean_wound' then
    select * into p from player where world_id = p_world and uid = p_uid;
    select i.* into lye from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'lye_bucket'
      order by i.ql desc limit 1;
    if lye.id is null or not consume(p_world, p_uid, 'lye_bucket', 1, lye.id) then return; end if;
    perform give(p_world, p_uid, 'bucket', 1, lye.ql);
    clean := skill_check(skill_of(p_world, p_uid, 'first_aid'), 26, lye.ql);
    perform journal_note(p_world, p_uid, 'cleaned');
    perform skill_raise(p_world, p_uid, 'first_aid', try_gain(clean, clean_gain()));
    select x into hurt from jsonb_array_elements(p.wounds) x where (x->>'infected')::boolean limit 1;
    if not clean then
      perform tell(p_world, p_uid, 'You scour the '
        || (select name from wound_kind_def where id = hurt->>'kind')
        || ' out and it is no better for it. The lye is gone.', 'error');
      return;
    end if;
    out_w := '[]'::jsonb;
    for one in select * from jsonb_array_elements(p.wounds) loop
      if one = hurt then
        -- Scoured out, nothing of the old dressing is left on it: no salve and no quick hands.
        one := jsonb_set(jsonb_set(jsonb_set(one, '{infected}', 'false'),
          '{bleeding}', 'true'), '{dressing}', 'null'::jsonb) - 'mend' - 'salved';
      end if;
      out_w := out_w || one;
    end loop;
    update player set wounds = out_w where world_id = p_world and uid = p_uid;
    perform tell(p_world, p_uid, 'You scour the '
      || (select name from wound_kind_def where id = hurt->>'kind') || ' on your '
      || part_name(hurt->>'part') || ' out with lye. It is open and clean again, and bleeding. Dress it.', 'event');

  elsif p_action = 'treat_creature' then
    c := target_creature(p_world, p_target);
    if c.world_id is null then return; end if;
    select i.* into use from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'bandage'
      order by i.ql desc limit 1;
    if use.id is null or not consume(p_world, p_uid, 'bandage', 1, use.id) then return; end if;
    clean := skill_check(skill_of(p_world, p_uid, 'first_aid'), 14, use.ql);
    top := max_health(c);
    healed := top * (0.06 + (skill_of(p_world, p_uid, 'first_aid') / 100) * 0.24 + (use.ql / 100) * 0.1)
              * (case when clean then 1 else 0.35 end);
    update creature set health = least(top, health + healed)
      where world_id = p_world and id = c.id returning * into c;
    perform skill_raise(p_world, p_uid, 'first_aid', try_gain(clean, bandage_gain()));
    perform tell(p_world, p_uid, case when clean
      then 'You dress ' || c.name || '''s wounds with the '
        || lower((select name from item_def where id = 'bandage')) || '. It is up to '
      else c.name || ' will not hold still and the dressing goes on badly. It is up to '
      end || ceil(c.health) || ' of ' || top || '.', 'event');
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.hunt_settle(p_world uuid, c creature, d species_def, a age_def)
 RETURNS creature
 LANGUAGE plpgsql
AS $function$
declare p record; v_dist double precision; v_pace double precision; v_guard int := 0;
        v_cx double precision; v_cy double precision; v_secs double precision;
        v_ax double precision; v_ay double precision; v_step record;
        m creature; l creature; v_n int := 0; v_k int := 0; v_slot double precision; v_own double precision;
        v_turn double precision; v_b double precision; v_run double precision; v_nerve boolean := false;
begin
  v_cx := creature_x(c); v_cy := creature_y(c);
  -- A Radiance burns what is hunting somebody inside it (`faith_radiance`).
  if c.hunting is not null then c := faith_radiance(p_world, c, v_cx, v_cy); end if;
  /*
   * One of a pack that is not after anybody hears another of its kind within
   * `pack_call` that is, and comes for the same one (`packmateOn`).
   */
  if c.hunting is null and d.hunter and d.pack and (c.hunt_again is null or c.hunt_again <= now()) then
    select mm.* into m from creature mm
      where mm.world_id = p_world and mm.hunting is not null and mm.species = c.species
        and mm.id <> c.id and mm.mode = 'wild'
        and (creature_x(mm) - v_cx) ^ 2 + (creature_y(mm) - v_cy) ^ 2 <= pack_call() ^ 2
      order by (creature_x(mm) - v_cx) ^ 2 + (creature_y(mm) - v_cy) ^ 2, mm.id
      limit 1;
  end if;
  /*
   * Whoever it is already after, if anybody: a beast you struck stays on you
   * (`engage_beast`) rather than on whoever happens to be nearer. Then whoever
   * its pack is after, and otherwise the nearest, for a hunter to notice.
   */
  if c.hunting is not null then
    select pl.uid, pl.x, pl.y, sqrt((pl.x - v_cx) ^ 2 + (pl.y - v_cy) ^ 2) as d into p
      from player pl where pl.world_id = p_world and pl.uid = c.hunting;
  elsif m.id is not null then
    select pl.uid, pl.x, pl.y, sqrt((pl.x - v_cx) ^ 2 + (pl.y - v_cy) ^ 2) as d into p
      from player pl where pl.world_id = p_world and pl.uid = m.hunting;
  else
    select * into p from nearest_player(p_world, v_cx, v_cy);
  end if;
  if not found then c.hunting := null; return c; end if;

  if c.hunting is not null then
    /*
     * How far it has come from where it started, which is the one measure that
     * grows while it chases.
     *
     * Reported as being chased until you are dead, and that is exactly what
     * happened: every give-up here was about the gap between hunter and
     * hunted, and a hunter runs at `speed * 1.15` — so the gap it was measured
     * against was a gap it was closing. Outrunning one was the only way to
     * lose it, and most things on this island are faster than a body carrying
     * a pack.
     *
     * So the leash is tied where the chase began. It gives up at the end of it
     * and then wants nothing to do with hunting for `hunt_rest`, because
     * otherwise it drops you at thirty tiles, notices you again on the next
     * breath because you are still well inside its sight, and measures a fresh
     * leash from there — which is the same endless chase with a stutter in it.
     */
    /*
     * And how far it is from its own home ground, which is what stops a
     * hunter that had already strayed from taking you another thirty tiles
     * beyond where it strayed to. Both are asked; the first to run out ends
     * it.
     */
    if sqrt((v_cx - coalesce(c.hunt_x, v_cx)) ^ 2 + (v_cy - coalesce(c.hunt_y, v_cy)) ^ 2)
         > (case when d.hunter then hunt_leash() else fight_leash() end)
       or sqrt((v_cx - coalesce(c.home_x, v_cx)) ^ 2 + (v_cy - coalesce(c.home_y, v_cy)) ^ 2)
         > hunt_home() then
      c.hunting := null;
      c.windup_at := null;
      c.hunt_again := now() + make_interval(secs => hunt_rest());
      -- And back to its own country, rather than standing wherever it
      -- happened to stop. A hunter that gave up ten valleys from home and
      -- stayed there is how a range stops meaning anything.
      if c.home_x is not null then
        c.from_x := v_cx; c.from_y := v_cy;
        c.to_x := c.home_x; c.to_y := c.home_y;
        c.leg_at := now();
        c.leg_ends := now() + make_interval(secs => greatest(1,
          sqrt((v_cx - c.home_x) ^ 2 + (v_cy - c.home_y) ^ 2)
            / greatest(0.1, d.speed * a.speed * beast_mul(c, 'speed') * 0.7)));
        c.until := c.leg_ends;
      end if;
      return c;
    end if;
    -- Far enough off, or on the beach: let go.
    if p.d > (case when not d.hunter then fight_give_up() when d.monster then hunt_give_up() * 2.2 else hunt_give_up() end)
       or at_peace(p_world, p.x, p.y) or p.d > faith_shroud(p_world, p.uid) then
      c.hunting := null;
      c.windup_at := null;
      return c;
    end if;
    /*
     * Its nerve (`nerveGoes`): a hunter hurt below what its kind stands, one
     * whose pack's leader is dead or has run, or a coward below `coward_drag`
     * with another of its kind within `pack_call` already run. Anything else
     * fights a fight it did not go looking for to the end.
     */
    if d.hunter then
      if c.health < max_health(c) * turns_at(d) then v_nerve := true; end if;
      if not v_nerve and c.pack_lead is not null and c.pack_lead <> c.id then
        select * into l from creature where world_id = p_world and id = c.pack_lead;
        if l.id is null or l.mode <> 'wild' or l.health <= 0 or l.hunt_again > now() then v_nerve := true; end if;
      end if;
      if not v_nerve and d.coward and c.health < max_health(c) * coward_drag() then
        v_nerve := exists (select 1 from creature o
          where o.world_id = p_world and o.species = c.species and o.id <> c.id and o.mode = 'wild'
            and o.hunt_again > now()
            and o.to_x between v_cx - (pack_call() + leg_slack()) and v_cx + (pack_call() + leg_slack())
            and o.to_y between v_cy - (pack_call() + leg_slack()) and v_cy + (pack_call() + leg_slack())
            and (creature_x(o) - v_cx) ^ 2 + (creature_y(o) - v_cy) ^ 2 <= pack_call() ^ 2);
      end if;
    end if;
    if v_nerve then
      -- It turns tail (`turnTail`): away from you, and no interest in you for a while.
      c.hunting := null;
      c.windup_at := null;
      c.hunt_again := now() + make_interval(secs => hunt_rest());
      v_run := d.speed * flee_pace() * flee_secs();
      select * into v_step from chase_leg(p_world, v_cx, v_cy,
        v_cx + (v_cx - p.x) / greatest(0.001, p.d) * v_run, v_cy + (v_cy - p.y) / greatest(0.001, p.d) * v_run);
      c.from_x := v_cx; c.from_y := v_cy;
      c.to_x := coalesce(v_step.x, v_cx); c.to_y := coalesce(v_step.y, v_cy);
      c.leg_at := now();
      c.leg_ends := now() + make_interval(secs => greatest(0.2, sqrt((c.to_x - v_cx) ^ 2 + (c.to_y - v_cy) ^ 2)
                                                 / greatest(0.1, d.speed * a.speed * beast_mul(c, 'speed') * flee_pace())));
      c.until := greatest(c.leg_ends, now() + make_interval(secs => flee_secs()));
      perform tell(p_world, p.uid, 'The ' || lower(d.name) || ' turns tail.', 'fight');
      return c;
    end if;
    c.hunting := p.uid;
  else
    -- Only a hunter goes looking for a fight.
    if not d.hunter then return c; end if;
    -- Nothing comes for you across ground it cannot stand on, and nothing
    -- comes for you at all while you are still standing on the beach.
    if at_peace(p_world, p.x, p.y) then return c; end if;
    if c.hunt_again is not null and c.hunt_again > now() then return c; end if;
    -- One of its pack already on you brings it from wherever it can hear; anything else has to notice you.
    if m.id is null and p.d > least(coalesce(d.notice, hunt_sight()), faith_shroud(p_world, p.uid)) then return c; end if;
    if not creature_tile_ok(p_world, floor(p.x)::int, floor(p.y)::int) then return c; end if;
    c.hunting := p.uid;
    -- Where the leash is tied, and a fresh count of blows.
    c.hunt_x := v_cx; c.hunt_y := v_cy;
    c.fight_blows := 0; c.windup_at := null;
    -- The first of a pack leads it; the rest follow whoever the one they heard follows.
    c.pack_lead := case when not d.pack then null when m.id is not null then coalesce(m.pack_lead, m.id) else c.id end;
    perform tell(p_world, p.uid, case when m.id is not null then 'Another ' || lower(d.name) || ' comes with it.'
                                      else 'A ' || lower(d.name) || ' has your scent.' end, 'fight');
  end if;

  -- Only the last few seconds of the gap were spent on you.
  if c.until < now() - make_interval(secs => hunt_window()) then
    c.from_x := v_cx; c.from_y := v_cy; c.to_x := v_cx; c.to_y := v_cy;
    c.until := now() - make_interval(secs => hunt_window());
    c.leg_at := c.until; c.leg_ends := c.until;
  end if;

  v_pace := d.speed * a.speed * beast_mul(c, 'speed') * 1.15;
  /*
   * Its own side of you, when it hunts with a pack (`packWay`): the leader's is
   * where the leader is, and the rest share the circle out evenly from there,
   * in the order they came into the world.
   */
  if c.pack_lead is not null then
    select count(*), count(*) filter (where mm.id < c.id and mm.id <> c.pack_lead) into v_n, v_k
      from creature mm
      where mm.world_id = p_world and mm.hunting = p.uid and mm.pack_lead = c.pack_lead
        and mm.mode = 'wild' and mm.id <> c.id;
    v_n := v_n + 1;
    v_k := case when c.id = c.pack_lead then 0 else v_k + 1 end;
    if v_n >= 2 then
      select * into l from creature where world_id = p_world and id = c.pack_lead;
      v_slot := case when l.id is null then atan2(v_cy - p.y, v_cx - p.x)
                     else atan2(creature_y(l) - p.y, creature_x(l) - p.x) end + 2 * pi() * v_k / v_n;
    end if;
  end if;
  while c.until <= now() and v_guard < 12 loop
    v_guard := v_guard + 1;
    v_dist := sqrt((p.x - c.to_x) ^ 2 + (p.y - c.to_y) ^ 2);
    /*
     * A heavy blow drawn back for (`windup_at`): it stood where it was for
     * `wind_up`, and lands on whatever is still in its reach.
     */
    if c.windup_at is not null then
      c.windup_at := null;
      c.fight_blows := c.fight_blows + 1;
      if v_dist <= hunt_reach() then
        perform mark_attacker(p_world, p.uid, c.id);
        perform hurt_player(p_world, p.uid, attack_of(c) * 0.012 * heavy_hit(),
          'The ' || lower(d.name) || '''s heavy blow lands', coalesce(d.wound, 'bite'));
      else
        perform tell(p_world, p.uid, 'The ' || lower(d.name) || '''s heavy blow falls short.', 'fight');
      end if;
      c.until := c.until + make_interval(secs => blow_every(d) / beast_mul(c, 'haste'));
      continue;
    end if;
    /*
     * A thrower (`throwStep`): backs away from you inside `keep_off -
     * back_slack`, and with nowhere to back to fights hand to hand below;
     * within `throw_reach` it stands and throws; further, it closes to
     * `keep_off`, round to its own side of you when it runs with a pack.
     */
    if d.throws then
      if v_dist < keep_off() - back_slack() then
        select * into v_step from chase_leg(p_world, c.to_x, c.to_y,
          c.to_x + (c.to_x - p.x) / greatest(0.001, v_dist) * 2, c.to_y + (c.to_y - p.y) / greatest(0.001, v_dist) * 2);
        if v_step.x is not null and (v_step.x - c.to_x) ^ 2 + (v_step.y - c.to_y) ^ 2 > 0.01 then
          c.from_x := c.to_x; c.from_y := c.to_y;
          c.to_x := v_step.x; c.to_y := v_step.y;
          c.leg_at := c.until;
          c.leg_ends := c.leg_at + make_interval(secs => greatest(0.2, sqrt((c.to_x - c.from_x) ^ 2 + (c.to_y - c.from_y) ^ 2)
                                                         / greatest(0.1, d.speed * a.speed * beast_mul(c, 'speed') * back_pace())));
          c.until := c.leg_ends;
          continue;
        end if;
      elsif v_dist <= throw_reach() then
        c.fight_blows := c.fight_blows + 1;
        perform mark_attacker(p_world, p.uid, c.id);
        perform hurt_player(p_world, p.uid, attack_of(c) * 0.012 * throw_hit(),
          'The ' || lower(d.name) || '''s stone finds you', 'crush');
        c.until := c.until + make_interval(secs => blow_every(d) / beast_mul(c, 'haste'));
        continue;
      else
        v_ax := null;
        if v_slot is not null then
          v_own := atan2(c.to_y - p.y, c.to_x - p.x);
          v_turn := turn_to(v_own, v_slot);
          if abs(v_turn) > circle_arc() then
            v_b := v_own + sign(v_turn) * least(abs(v_turn), circle_arc());
            v_ax := p.x + cos(v_b) * keep_off(); v_ay := p.y + sin(v_b) * keep_off();
          end if;
        end if;
        if v_ax is null then
          v_ax := p.x + (c.to_x - p.x) / v_dist * keep_off(); v_ay := p.y + (c.to_y - p.y) / v_dist * keep_off();
        end if;
        select * into v_step from chase_leg(p_world, c.to_x, c.to_y, v_ax, v_ay);
        if v_step.x is null then
          c.hunting := null;
          exit;
        end if;
        c.from_x := c.to_x; c.from_y := c.to_y;
        c.to_x := v_step.x; c.to_y := v_step.y;
        c.leg_at := c.until;
        c.leg_ends := c.leg_at + make_interval(secs => greatest(0.2, sqrt((c.to_x - c.from_x) ^ 2 + (c.to_y - c.from_y) ^ 2)
                                                       / greatest(0.1, v_pace)));
        c.until := c.leg_ends;
        continue;
      end if;
    end if;
    if v_dist > hunt_reach() then
      -- Round to its own side of you first, when it runs with a pack and is not on it yet (`circlePoint`).
      v_ax := null;
      if v_slot is not null then
        v_own := atan2(c.to_y - p.y, c.to_x - p.x);
        v_turn := turn_to(v_own, v_slot);
        if abs(v_turn) > circle_arc() then
          v_b := v_own + sign(v_turn) * least(abs(v_turn), circle_arc());
          v_ax := p.x + cos(v_b) * circle_r(); v_ay := p.y + sin(v_b) * circle_r();
        end if;
      end if;
      -- Otherwise a leg that ends a pace short of your feet, round whatever is between.
      if v_ax is null then
        v_ax := c.to_x + (p.x - c.to_x) * (v_dist - 1) / v_dist;
        v_ay := c.to_y + (p.y - c.to_y) * (v_dist - 1) / v_dist;
      end if;
      select * into v_step from chase_leg(p_world, c.to_x, c.to_y, v_ax, v_ay);
      if v_step.x is null then
        c.hunting := null;
        exit;
      end if;
      c.from_x := c.to_x; c.from_y := c.to_y;
      c.to_x := v_step.x; c.to_y := v_step.y;
      v_secs := greatest(0.2, sqrt((c.to_x - c.from_x) ^ 2 + (c.to_y - c.from_y) ^ 2)
                              / greatest(0.1, v_pace));
      c.leg_at := c.until;
      c.leg_ends := c.leg_at + make_interval(secs => v_secs);
      c.until := c.leg_ends;
    elsif d.heavy and (c.fight_blows + 1) % heavy_every()::int = 0 then
      -- Every `heavy_every`th blow of a kind that hits heavy is drawn back for first.
      c.windup_at := c.until + make_interval(secs => wind_up());
      c.until := c.windup_at;
      perform tell(p_world, p.uid, 'The ' || lower(d.name) || ' draws back for a heavy blow. Step out of its reach.', 'fight');
    else
      c.fight_blows := c.fight_blows + 1;
      perform mark_attacker(p_world, p.uid, c.id);
      perform hurt_player(p_world, p.uid, attack_of(c) * 0.012,
        'The ' || lower(d.name) || ' is on you', coalesce(d.wound, 'bite'));
      c.until := c.until + make_interval(secs => blow_every(d) / beast_mul(c, 'haste'));
    end if;
  end loop;
  return c;
end $function$;

CREATE OR REPLACE FUNCTION public.faith_oath(p_world uuid, p_uid uuid, p_taken double precision)
 RETURNS double precision
 LANGUAGE plpgsql
AS $function$
declare b jsonb; ob jsonb; o uuid; v_half double precision; v_h double precision;
begin
  if p_taken <= 0 then return p_taken; end if;
  select blessings into b from player where world_id = p_world and uid = p_uid;
  if not coalesce((b->'oath'->>'until')::timestamptz > now(), false) then return p_taken; end if;
  o := (b->'oath'->>'with')::uuid;
  select blessings into ob from player where world_id = p_world and uid = o and not away;
  if ob is null or (ob->'oath'->>'with')::uuid is distinct from p_uid
     or not coalesce((ob->'oath'->>'until')::timestamptz > now(), false) then
    return p_taken;
  end if;
  v_half := p_taken / 2;
  update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{health}',
                                      to_jsonb(greatest(0, coalesce((stats->>'health')::double precision, 1) - v_half)))
   where world_id = p_world and uid = o
   returning (stats->>'health')::double precision into v_h;
  if v_h <= 0 and not faith_undying(p_world, o) and not faith_second_life(p_world, o) then perform player_die(p_world, o); end if;
  return p_taken - v_half;
end $function$;

select private.lock_doors();
