/*
 * Justice's fifteen spells (`FAITH_SPELLS` in `src/game/patrons.ts`), three
 * at each of the five tiers: one that judges, one that keeps order in a
 * fight, one that measures. Each is one arm of `faith_spell_cast`, beside the
 * Blessing's, and reads its numbers off its own row (`faith_spell.fx`).
 *
 * What Justice adds to what the Blessing laid down:
 *
 *   * `faith_mark`, a creature marked by a Mark of Judgment or a Judgment:
 *     `wound_beast`, which every blow on a creature goes through, deals it
 *     the mark's share more (`faith_marked`).
 *   * `faith_owed`, what a Retribution deals back. A creature's blow on you
 *     lands while that creature is being settled, and what the settling
 *     writes back would overwrite anything done to it meanwhile, so the
 *     share is owed and paid through `wound_beast` once its settling has
 *     written it down (`faith_owed_pay`, at the end of `creature_settle`):
 *     a creature it kills dies the way any other does.
 *   * a Truce, a `faith_zone` inside which `hurt_player` and `wound_beast`
 *     let nothing be struck, nor anything strike from (`faith_truce`).
 *   * an Oath, kept on both people sworn (`player.blessings`), which
 *     `hurt_player` splits every blow landing on either of them by
 *     (`faith_oath`); only between friends.
 *   * a Temper, kept on the caster for one item: `item_temper`, a trigger on
 *     the item table, keeps that item's wear from rising however it was
 *     worn -- a job, a blow, a fire -- and `hurt_player` reads armour's wear
 *     back from the row before calling a piece beaten to pieces.
 *   * a Due Reward, which `skill_mult` multiplies every skill's gain by.
 *
 * Summons needs nothing new: a creature held on you by `threat_at` is what
 * `engage_beast` and `beast_threat` already leave alone. Nor does Bind: a
 * creature's `until` is when it next does anything at all. Nor Assay, which
 * leaves its marks where a prospector's go (`stats.prospected`) for as long
 * as it says.
 */
set local lock_timeout = '3s';

create table if not exists faith_mark (
  world_id uuid not null references world on delete cascade,
  creature_id int not null,
  more double precision not null,
  until timestamptz not null,
  by_uid uuid,
  primary key (world_id, creature_id)
);
alter table faith_mark enable row level security;

create table if not exists faith_owed (
  id bigint generated always as identity primary key,
  world_id uuid not null references world on delete cascade,
  creature_id int not null,
  dmg double precision not null,
  from_uid uuid,
  at timestamptz not null default now()
);
create index if not exists faith_owed_creature on faith_owed (world_id, creature_id);
alter table faith_owed enable row level security;

-- How much more a creature takes from every blow: its mark's share, while it lasts.
create or replace function faith_marked(p_world uuid, p_id int) returns double precision language sql stable as $fn$
  select 1 + coalesce((select m.more from faith_mark m where m.world_id = p_world and m.creature_id = p_id and m.until > now()), 0)
$fn$;

-- Mark a creature, keeping the greater of a mark it already bears.
create or replace function faith_mark_put(p_world uuid, p_id int, p_more double precision, p_secs double precision, p_by uuid)
  returns void language sql as $fn$
  insert into faith_mark (world_id, creature_id, more, until, by_uid)
  values (p_world, p_id, p_more, now() + make_interval(secs => p_secs), p_by)
  on conflict (world_id, creature_id) do update
    set more = case when faith_mark.until > now() then greatest(faith_mark.more, excluded.more) else excluded.more end,
        until = greatest(faith_mark.until, excluded.until), by_uid = excluded.by_uid
$fn$;

/*
 * Take exactly so much health off a creature, struck by somebody: through
 * `hurt_creature`, so that a creature it kills dies as from any blow, and
 * with its hide and its mark taken out of the sum first, so that what the
 * spell says it takes is what it takes. True when it died.
 */
create or replace function faith_strike(p_world uuid, p_uid uuid, p_id int, p_amount double precision) returns boolean
 language plpgsql as $fn$
declare c creature;
begin
  select * into c from creature where world_id = p_world and id = p_id;
  if not found or p_amount <= 0 then return false; end if;
  return hurt_creature(p_world, p_id, p_amount / greatest(0.01, beast_mul(c, 'soak') * faith_marked(p_world, p_id)), p_uid);
end $fn$;

-- What a Retribution dealt back to a creature, paid now that its settling has written it down.
create or replace function faith_owed_pay(p_world uuid, p_id int) returns void language plpgsql as $fn$
declare v_dmg double precision; v_by uuid;
begin
  if not exists (select 1 from faith_owed where world_id = p_world and creature_id = p_id) then return; end if;
  select sum(o.dmg), (array_agg(o.from_uid order by o.at desc))[1] into v_dmg, v_by
    from faith_owed o where o.world_id = p_world and o.creature_id = p_id;
  delete from faith_owed where world_id = p_world and creature_id = p_id;
  perform faith_strike(p_world, v_by, p_id, v_dmg);
end $fn$;

-- Whether a spot is inside a Truce while it lasts.
create or replace function faith_truce(p_world uuid, p_x double precision, p_y double precision) returns boolean language sql stable as $fn$
  select exists (select 1 from faith_zone z where z.world_id = p_world and z.kind = 'truce' and z.until > now()
                   and (p_x - z.x) ^ 2 + (p_y - z.y) ^ 2 <= z.r ^ 2)
$fn$;

/*
 * A blow on somebody sworn to an Oath: half of it is the friend's to take,
 * and the rest theirs. Only while both of them are sworn to each other and
 * the friend is on the island; a friend it would kill is killed, unless a
 * Second Life is on them.
 */
create or replace function faith_oath(p_world uuid, p_uid uuid, p_taken double precision) returns double precision
 language plpgsql as $fn$
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
  if v_h <= 0 and not faith_second_life(p_world, o) then perform player_die(p_world, o); end if;
  return p_taken - v_half;
end $fn$;

/*
 * Every ore seam under the ground within so many tiles of a spot, marked for
 * the caster for so long, where a prospector's sensing leaves its marks:
 * how many there were.
 */
create or replace function faith_assay(p_world uuid, p_uid uuid, p_x double precision, p_y double precision,
                                       p_r double precision, p_secs double precision) returns int
 language plpgsql as $fn$
declare sz int; tiles int[];
begin
  select size into sz from world where id = p_world;
  select coalesce(array_agg(y * sz + x order by y, x), '{}') into tiles
    from generate_series(greatest(0, floor(p_x - p_r)::int), least(sz - 1, floor(p_x + p_r)::int)) x
   cross join generate_series(greatest(0, floor(p_y - p_r)::int), least(sz - 1, floor(p_y + p_r)::int)) y
   where (x + 0.5 - p_x) ^ 2 + (y + 0.5 - p_y) ^ 2 <= p_r ^ 2 and (bedrock_at(p_world, x, y)).ore;
  if coalesce(array_length(tiles, 1), 0) = 0 then return 0; end if;
  update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{prospected}',
                                      jsonb_build_object('tiles', to_jsonb(tiles), 'until', extract(epoch from now()) + p_secs))
   where world_id = p_world and uid = p_uid;
  return array_length(tiles, 1);
end $fn$;

-- An item under a Temper: whatever would have worn it, its wear stays where it was.
create or replace function faith_temper_guard() returns trigger language plpgsql as $fn$
begin
  if new.holder = 'player' and exists (
       select 1 from player p where p.world_id = new.world_id and p.uid = new.holder_uid
          and (p.blessings->'temper'->>'item')::bigint = new.id
          and (p.blessings->'temper'->>'until')::timestamptz > now()) then
    new.dmg := old.dmg;
  end if;
  return new;
end $fn$;
drop trigger if exists item_temper on item;
create trigger item_temper before update of dmg on item
  for each row when (new.dmg > old.dmg) execute function faith_temper_guard();

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
                    and cr.to_x between v_x - v_r - 12 and v_x + v_r + 12 and cr.to_y between v_y - v_r - 12 and v_y + v_r + 12
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
                and cr.to_x between v_x - v_r - 12 and v_x + v_r + 12 and cr.to_y between v_y - v_r - 12 and v_y + v_r + 12
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
  if health <= 0 and faith_second_life(p_world, p_uid) then perform fight_back(p_world, p_uid, (p.stats->>'hurtBy')::int);
  elsif health <= 0 then perform player_die(p_world, p_uid);
  else perform fight_back(p_world, p_uid, (p.stats->>'hurtBy')::int); end if;
end $function$;

CREATE OR REPLACE FUNCTION public.wound_beast(p_world uuid, p_id integer, p_dmg double precision, p_from_x double precision DEFAULT NULL::double precision, p_from_y double precision DEFAULT NULL::double precision, p_teller uuid DEFAULT NULL::uuid, p_by integer DEFAULT NULL::integer)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
declare c creature; d species_def; cx double precision; cy double precision; v_taken double precision;
        v_len double precision; v_size double precision; v_killer creature;
begin
  perform creature_settle(p_world, p_id);
  select * into c from creature where world_id = p_world and id = p_id for update;
  if not found then return false; end if;
  select * into d from species_def where id = c.species;
  cx := creature_x(c); cy := creature_y(c);
  -- What a blow costs it is its blood's to say, and its herd's.
  -- Nothing is struck inside a Truce, nor from one (`faith_truce`).
  if faith_truce(p_world, cx, cy) or (p_from_x is not null and faith_truce(p_world, p_from_x, p_from_y)) then
    return false;
  end if;
  -- And a creature under a Mark of Judgment takes its share more (`faith_marked`).
  v_taken := p_dmg * beast_mul(c, 'soak') * faith_marked(p_world, p_id);

  update creature set health = c.health - v_taken, hurt_at = now(), hurt_by = p_by,
      coaxed = 0, coaxed_at = null,
      from_x = cx, from_y = cy, to_x = cx, to_y = cy, leg_at = now(), leg_ends = now(),
      settled_at = now()
    where world_id = p_world and id = p_id;

  if c.health - v_taken > 0 then
    -- A wild thing that stands and fights turns on a tame one that hurt it (`beast_threat`).
    if c.mode = 'wild' and not coalesce(d.timid, false) and p_by is not null then
      perform beast_threat(p_world, p_id, p_by);
    end if;
    if c.mode = 'wild' and d.timid and p_from_x is not null then
      v_len := greatest(0.001, sqrt((cx - p_from_x) ^ 2 + (cy - p_from_y) ^ 2));
      update creature set to_x = cx + ((cx - p_from_x) / v_len) * 5, to_y = cy + ((cy - p_from_y) / v_len) * 5,
          leg_ends = now() + interval '3 seconds', until = now() + interval '3 seconds'
        where world_id = p_world and id = p_id;
    end if;
    return false;
  end if;

  -- What the carcass is worth follows the size of the thing that left it.
  v_size := (age_row(c.born, old_of(c))).yield;
  delete from creature where world_id = p_world and id = p_id;
  -- Nothing goes on fighting something that is no longer there.
  update creature set enemy = null where world_id = p_world and enemy = p_id;
  perform drop_on_ground(p_world, floor(cx)::int, floor(cy)::int, 'corpse',
    (15 + random() * 35) * v_size, d.name);

  -- A hunter marks where its kill went down and comes back for it.
  if p_by is not null then
    select * into v_killer from creature where world_id = p_world and id = p_by;
    -- A companion's kill is told to its keeper, who is standing right there. A
    -- worker's is not: a guard's week on a deed its keeper has left would come
    -- back as a page of them.
    if found and v_killer.mode = 'active' and v_killer.keeper is not null then
      perform tell(p_world, v_killer.keeper, v_killer.name || ' killed a wild ' || lower(d.name) || '.', 'fight');
    end if;
    if found and v_killer.carrying is null
       and (select gathers from species_def where id = v_killer.species) = 'hunt' then
      update creature set work_x = floor(cx)::int, work_y = floor(cy)::int
        where world_id = p_world and id = p_by;
      perform worker_learn(p_world, p_by, 'fighting', 0.4);
    end if;
  end if;

  /*
   * And what it was keeping, which is the other half of where a map comes
   * from. Only a monster — `species_def.monster` is already the line between
   * a thing that hunts you and a thing you could have tamed — and only to
   * whoever struck it down. The odds and the quality both come off its
   * health, which is the one number that says how big a thing was: a goblin
   * in thirty-five carries a scrap, a dragon in two carries a dragon's.
   */
  if p_teller is not null and d.monster and random() < map_chance_beast(d.health) then
    perform bury_treasure(p_world, p_teller, map_ql_beast(d.health), cx, cy);
  end if;

  if p_teller is not null then
    perform journal_note(p_world, p_teller, 'slew:' || c.species);
    if d.monster then
      perform tell(p_world, p_teller, 'The ' || lower(d.name)
        || ' goes down. Butcher it before it rots: there is a great deal on it.', 'fight');
    else
      perform tell(p_world, p_teller, 'You kill the wild ' || lower(d.name)
        || '. Its corpse lies where it fell.', 'fight');
    end if;
  end if;
  return true;
end $function$;

CREATE OR REPLACE FUNCTION public.creature_settle(p_world uuid, p_id integer)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
declare c creature; d species_def; a age_def; elapsed double precision; top double precision;
        guard int := 0; n int; i int; nx double precision; ny double precision;
        dist double precision; secs double precision; pace double precision; ok boolean;
        home record; ax double precision; ay double precision; v_rig placed; v_bled double precision;
begin
  select * into c from creature where world_id = p_world and id = p_id for update;
  if not found then return false; end if;
  select * into d from species_def where id = c.species;
  a := age_row(c.born, old_of(c));
  /*
   * In the traces until somebody takes it out.
   *
   * A hitch was a column and nothing else read it: the settle below went on
   * walking a companion to its keeper's feet and sending a worker out to its
   * trade, so an animal backed into a yoke was at its owner's heels a second
   * later, still hitched to a wagon it was nowhere near. It stands at the
   * vehicle now, thinks nothing, and does not get hungry, until `unhitch_one`
   * or `unhitch_all` takes it out -- or what it was hitched to is gone, in
   * which case there is nothing left to be in the traces of.
   */
  if c.hitched_to is not null then
    select * into v_rig from placed where world_id = p_world and id = c.hitched_to;
    if not found then
      update creature set hitched_to = null where world_id = p_world and id = p_id;
      c.hitched_to := null;
    end if;
  end if;
  elapsed := extract(epoch from (now() - c.settled_at));
  if elapsed <= 0 then
    -- Nothing has passed for the body — but a worker's day is not its body,
    -- and the trips it is owed are still owed. One in the traces owes none.
    if c.hitched_to is not null then return false; end if;
    if c.mode = 'deed' then perform worker_settle(p_world, p_id);
    elsif c.mode = 'active' then perform companion_settle(p_world, p_id); end if;
    return false;
  end if;

  -- The body: hunger falling, wounds closing, fleece coming back, and a
  -- brushing wearing off. None of it needs a step; it is all just elapsed time.
  top := max_health(c);
  /*
   * A knife's bleeding, for the part of the time since the last settle that it
   * ran, and never the last of it: what finishes a thing is a blow. While it
   * bleeds it is hurt, so it mends nothing (`KNIFE_BLEED`).
   */
  if c.bleed_until is not null then
    v_bled := extract(epoch from (least(now(), c.bleed_until) - c.settled_at));
    if v_bled > 0 then
      if c.health > 1 then c.health := greatest(1, c.health - coalesce(c.bleed_rate, 0) * v_bled); end if;
      c.hurt_at := greatest(coalesce(c.hurt_at, c.settled_at), least(now(), c.bleed_until));
    end if;
    if c.bleed_until <= now() then c.bleed_until := null; c.bleed_rate := null; end if;
  end if;
  -- Except in the traces, where the belly holds where it was when it went in.
  if c.hitched_to is null then
    -- Hungry slower for its keeper's Light Eaters.
    c.hunger := greatest(0, c.hunger - elapsed * hunger_rate(c.mode) * beast_mul(c, 'appetite')
                                   * coalesce((c.kept->>'kept:hunger')::double precision, 1));
  end if;
  if c.health > top then
    c.health := top;
  elsif c.health < top and (c.hurt_at is null or now() - c.hurt_at > interval '6 seconds') then
    c.health := least(top, c.health + elapsed * case when c.mode = 'wild' then 0.25 else 0.6 end * beast_mul(c, 'mend'));
  end if;
  if d.fleece is not null and a.growth > 0 and c.fleece < 1 then
    c.fleece := least(1, c.fleece + elapsed * d.fleece * a.growth * beast_mul(c, 'grow'));
  end if;
  -- A brushing wears off over a few hours: longer for its keeper's Lasting Care.
  c.care := greatest(0, c.care - elapsed / (coalesce((c.kept->>'kept:care_hours')::double precision, care_hours()) * 3600));
  /*
   * And a hungry one on a deed goes to the stores.
   *
   * Written on the row rather than on `c`, so the settle below does not carry
   * the old belly back over it. Only when it is actually hungry, which for a
   * worker is an hour or so apart — this is not a cost anybody pays on a beat.
   */
  if c.mode <> 'wild' and c.hitched_to is null and c.hunger < graze_hungry() then
    if worker_feed(p_world, p_id) is not null then
      c.hunger := least(1, c.hunger + graze_fill());
    end if;
  end if;

  -- And no further: it stands at the vehicle, the body settled and nothing else.
  if c.hitched_to is not null then
    update creature set
        from_x = v_rig.cx, from_y = v_rig.cy, to_x = v_rig.cx, to_y = v_rig.cy,
        leg_at = now(), leg_ends = now(), until = now(),
        health = c.health, fleece = c.fleece, care = c.care,
        enemy = null, hunting = null, settled_at = now()
      where world_id = p_world and id = p_id;
    return true;
  end if;

  if c.mode = 'wild' then
    -- A hunter looks for you; anything else you struck that stands and fights is after you already (`engage_beast`).
    -- A tame thing that hurt it, first, while it is on one (`brawl_settle`).
    if c.brawl is not null then c := brawl_settle(p_world, c, d, a); end if;
    if c.id is not null and c.brawl is null and (d.hunter or c.hunting is not null) then c := hunt_settle(p_world, c, d, a); end if;
  else
    c.hunting := null;
    c.brawl := null;
  end if;

  if c.mode = 'wild' and c.hunting is null and c.brawl is null then
    pace := d.speed * a.speed * beast_mul(c, 'speed') * 0.7;
    while c.until <= now() and guard < catch_up_legs() loop
      guard := guard + 1;
      n := c.leg + 1;
      ok := false;
      -- A step about its own country rather than a step from wherever it
      -- last got to. Past the edge of its range it draws towards home
      -- instead, which is what keeps an island's wildlife somewhere in
      -- particular. A creature from before homes existed takes where it
      -- stands, which is what it would have had anyway.
      if c.home_x is null then c.home_x := c.to_x; c.home_y := c.to_y; end if;
      -- A pack keeps closer to home, so that it is met together (`pack_range`).
      if (c.to_x - c.home_x) ^ 2 + (c.to_y - c.home_y) ^ 2 > (case when d.pack then pack_range() else wild_range() end) ^ 2 then
        ax := c.home_x; ay := c.home_y;
      else
        ax := c.to_x; ay := c.to_y;
      end if;
      for i in 0..7 loop
        nx := ax + (hash_tile(p_id, n, 7001 + i) * 2 - 1) * wild_reach();
        ny := ay + (hash_tile(p_id, n, 9001 + i) * 2 - 1) * wild_reach();
        if creature_tile_ok(p_world, floor(nx)::int, floor(ny)::int)
           and line_clear(p_world, c.to_x, c.to_y, nx, ny) then ok := true; exit; end if;
      end loop;
      c.leg := n;
      if not ok then
        -- Hemmed in: stand where it is and look again in a moment.
        c.from_x := c.to_x; c.from_y := c.to_y;
        c.leg_at := c.until; c.leg_ends := c.until;
        c.until := c.until + interval '2 seconds';
        continue;
      end if;
      -- It feeds itself on the way. The browser walks it to a forage bed,
      -- grazes for a few seconds and tops the belly up; out here the leg that
      -- ends on ground worth grazing is the same thing without the detail.
      if c.hunger < graze_hungry() and coalesce((select forage from tile_def
            where id = land_tile(p_world, floor(nx)::int, floor(ny)::int)), false) then
        c.hunger := least(1, c.hunger + graze_fill());
      end if;
      dist := sqrt((nx - c.to_x) ^ 2 + (ny - c.to_y) ^ 2);
      secs := greatest(0.2, dist / greatest(0.1, pace));
      c.from_x := c.to_x; c.from_y := c.to_y;
      c.to_x := nx; c.to_y := ny;
      c.leg_at := c.until;
      c.leg_ends := c.leg_at + make_interval(secs => secs);
      c.until := c.leg_ends + make_interval(secs => wild_rest() + hash_tile(p_id, n, 11001) * wild_rest_spread());
    end loop;
    /*
     * And past the cap it is where it got to, and the clock catches up with
     * it. This line is the whole reason the cap can come down: it was already
     * here, and it was already the answer for anything more than forty legs
     * behind. Forty was doing an eighth of a second of arithmetic to reach an
     * answer this line gives for nothing.
     *
     * Measured, on a creature an hour behind: 109.10 ms with the cap at forty,
     * against 4.78 ms for one a second behind. Every one of those legs is a
     * random step inside a home range nobody was standing in.
     */
    if c.until <= now() then
      c.from_x := c.to_x; c.from_y := c.to_y;
      c.leg_at := now(); c.leg_ends := now();
      c.until := now() + make_interval(secs => 1 + hash_tile(p_id, c.leg, 11001) * 5);
    end if;
  elsif c.mode = 'active' and c.keeper is not null and c.enemy is null then
    -- A companion is wherever its keeper is; following is not a walk of its own.
    -- A fight is, and one with something in its teeth keeps the legs it has:
    -- `companion_settle`, below, walks it, strikes, and brings it back to heel.
    select p.x, p.y into home from player p where p.world_id = p_world and p.uid = c.keeper;
    -- Piers: but not onto a tile on piers, where it does not go: it waits where it is (`creature_tile_ok`).
    if found and not on_piers(p_world, floor(home.x)::int, floor(home.y)::int) then
      c.from_x := home.x; c.from_y := home.y; c.to_x := home.x; c.to_y := home.y;
      c.leg_at := now(); c.leg_ends := now(); c.until := now();
    end if;
  elsif c.mode = 'stored' then
    -- In a crate: where the crate stands, or at the feet of whoever carries it.
    select pl.cx as x, pl.cy as y into home from placed pl where pl.world_id = p_world and pl.creature = p_id limit 1;
    if not found then
      select py.x, py.y into home from player py where py.world_id = p_world and py.uid = c.keeper;
    end if;
    if found then
      c.from_x := home.x; c.from_y := home.y; c.to_x := home.x; c.to_y := home.y;
      -- A crated one never walks, so it is not asked every round.
      c.leg_at := now(); c.leg_ends := now(); c.until := now() + make_interval(secs => stored_settle());
    end if;
  end if;

  update creature set
      from_x = c.from_x, from_y = c.from_y, to_x = c.to_x, to_y = c.to_y,
      leg_at = c.leg_at, leg_ends = c.leg_ends, until = c.until, leg = c.leg,
      health = c.health, hunger = c.hunger, fleece = c.fleece, care = c.care,
      hunting = c.hunting, hunt_x = c.hunt_x, hunt_y = c.hunt_y, hunt_again = c.hunt_again,
      fight_blows = c.fight_blows, windup_at = c.windup_at, bleed_rate = c.bleed_rate, bleed_until = c.bleed_until,
      hurt_at = c.hurt_at, pack_lead = c.pack_lead, brawl = c.brawl, threat_at = c.threat_at,
      home_x = c.home_x, home_y = c.home_y,
      settled_at = now()
    where world_id = p_world and id = p_id;
  -- And then the day's work, for whichever of them is on a deed rather than
  -- out in the country. The row goes down first because the work reads it back.
  if c.mode = 'deed' then perform worker_settle(p_world, p_id);
  -- And a companion's company, which is the one thing at heel that is a walk of its own.
  elsif c.mode = 'active' then perform companion_settle(p_world, p_id); end if;
  -- And what a Retribution dealt back to it while it struck, now that it is written down (`faith_owed_pay`).
  perform faith_owed_pay(p_world, p_id);
  return true;
end $function$;

CREATE OR REPLACE FUNCTION public.skill_mult(p_world uuid, p_uid uuid, p_id text)
 RETURNS double precision
 LANGUAGE plpgsql
 STABLE
AS $function$
declare p player; m double precision;
begin
  select * into p from player where world_id = p_world and uid = p_uid;
  if not found then return 1; end if;
  m := case when coalesce(p.rested, 0) > 0 then rest_mult() else 1 end;
  -- A knack earned on the way up never wears off, unlike a meal or a night's sleep.
  m := m + knack_bonus((p.knacks->>p_id)::int);
  -- And the stones you wear, a jewel's and a circlet's, on the trades they favour.
  m := m + jewel_gain(worn(p_world, p_uid, 'jewel'), p_id) + jewel_gain(worn(p_world, p_uid, 'head'), p_id);
  -- And the reader's path is a tenth on everything, for good.
  if p_id <> meditation_skill() and walks(p_world, p_uid, 'knowledge', 1) then m := m + 0.1; end if;
  -- A full table, worth a fifth, or more to a Cook with Balanced Diet.
  m := m * table_mul(p.nutrition, greatest(table_best(), pk(coalesce(p.class_mul, '{}'::jsonb), 'table:best', table_best())));
  -- And the dish that favours this one, while it lasts.
  m := m + coalesce((select sum((b->>'bonus')::double precision)
                       from jsonb_array_elements(coalesce(p.boons, '[]'::jsonb)) b
                      where b->>'skill' = p_id
                        and (b->>'until')::double precision > world_time(p_world)), 0);
  /*
   * And the tree, which is the last thing on and the only one that is not the
   * same for everybody with the same sheet.
   *
   * Free here, and that is why learning is wired here rather than in
   * `skill_raise`: this function already has the row in hand, and the fold
   * kept on it is a product somebody else worked out. It tells only on the
   * skills the trade covers -- the check is inside `class_mul` -- so a smith's
   * forge sense is worth nothing at a loom.
   */
  m := m * class_mul(coalesce(p.class_mul, '{}'::jsonb), 'learn', p_id);
  -- And a Due Reward's share more on every skill (`justice_reward`).
  m := m * (1 + coalesce(case when (p.blessings->'reward'->>'until')::timestamptz > now()
                              then (p.blessings->'reward'->>'more')::double precision end, 0));
  -- And a bauble for the trade in the altar of the settlement you are working on.
  return greatest(0.01, m) * bauble_learn(p_world, p_uid, p_id);
end $function$;

select private.lock_doors();
