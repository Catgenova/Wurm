/*
 * The Blessing's fifteen spells (`FAITH_SPELLS` in `src/game/patrons.ts`),
 * three at each of the five tiers: one that mends, one that guards, and one
 * for creatures, things and the land. Their numbers are on their rows
 * (`faith_spell.fx`), which is what the notes in the Faith window are written
 * from too, and each is one arm of `faith_spell_cast`.
 *
 * What is done at once is done there. What lasts a while is kept:
 *
 *   * on whoever it was cast on, in `player.blessings`, a key a spell with an
 *     `until` -- Ward and Shield of Dawn, which `faith_blunt` spends on the
 *     blows `hurt_player` is dealt; Second Life, which the killing blow spends
 *     instead (`faith_second_life`); Renewal, which `body_settle` heals by
 *     (`faith_renewal`); Bless Arms, which `perform_fight` hits monsters
 *     harder with (`faith_arms`); Steady Hands, on the caster for the tool
 *     it was cast on, which `rpc_act` and `settle` time jobs by
 *     (`faith_steady`); and Kinship, which `tame_chance` adds and
 *     `perform_creature`'s next taming spends;
 *   * on the ground, in `faith_zone`: a Sanctuary, inside which `at_peace`
 *     says what it says on the beach, and a Radiance, which `hunt_settle`
 *     burns whatever is hunting somebody inside by (`faith_radiance`).
 *
 * The functions hooked are put back whole, as they stand, with the one
 * line each that asks.
 */
set local lock_timeout = '3s';

alter table player add column if not exists blessings jsonb not null default '{}'::jsonb;

create table if not exists faith_zone (
  id bigint generated always as identity primary key,
  world_id uuid not null references world on delete cascade,
  kind text not null,
  x double precision not null,
  y double precision not null,
  r double precision not null,
  rate double precision not null default 0,
  at timestamptz not null default now(),
  until timestamptz not null,
  by uuid
);
create index if not exists faith_zone_world on faith_zone (world_id, kind, until);
alter table faith_zone enable row level security;

-- A number off a spell's row.
create or replace function spell_fx(p_spell text, p_key text) returns double precision language sql stable as $fn$
  select (fx->>p_key)::double precision from faith_spell where id = p_spell
$fn$;

-- A share as the log says it, and a stretch of time as the notes do (`span`).
create or replace function faith_pct(p double precision) returns text language sql immutable as $fn$
  select round(p * 100)::int || '%'
$fn$;
create or replace function faith_span(p_secs double precision) returns text language sql immutable as $fn$
  select case when p_secs < 120 then round(p_secs)::int || ' s' else round(p_secs / 60)::int || ' minutes' end
$fn$;

-- A spell lasting on somebody: put on (anything run out is cleared away while it is), or taken off.
create or replace function blessing_put(p_world uuid, p_uid uuid, p_key text, p_blessing jsonb) returns void language sql as $fn$
  update player set blessings = coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(coalesce(blessings, '{}'::jsonb)) e
                                       where (e.value->>'until')::timestamptz > now()), '{}'::jsonb)
                            || jsonb_build_object(p_key, p_blessing)
   where world_id = p_world and uid = p_uid
$fn$;

/*
 * Heal somebody by a share of their whole health, and stop their worst
 * bleeding wound bleeding, or every one of them: `{healed, stopped}`.
 */
create or replace function faith_mend(p_world uuid, p_uid uuid, p_share double precision, p_all boolean) returns jsonb
 language plpgsql as $fn$
declare p player; hp double precision; v_worst jsonb; w jsonb; v_out jsonb := '[]'::jsonb; v_stopped int := 0;
begin
  select * into p from player where world_id = p_world and uid = p_uid for update;
  if not found then return jsonb_build_object('healed', 0, 'stopped', 0); end if;
  hp := coalesce((p.stats->>'health')::double precision, 1);
  select x into v_worst from jsonb_array_elements(coalesce(p.wounds, '[]'::jsonb)) x
   where (x->>'bleeding')::boolean order by (x->>'severity')::double precision desc limit 1;
  for w in select * from jsonb_array_elements(coalesce(p.wounds, '[]'::jsonb)) loop
    if (w->>'bleeding')::boolean and (p_all or (v_stopped = 0 and w = v_worst)) then
      w := jsonb_set(w, '{bleeding}', 'false');
      v_stopped := v_stopped + 1;
    end if;
    v_out := v_out || w;
  end loop;
  update player set wounds = v_out, stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{health}', to_jsonb(least(1, hp + p_share)))
    where world_id = p_world and uid = p_uid;
  return jsonb_build_object('healed', least(1, hp + p_share) - hp, 'stopped', v_stopped);
end $fn$;

-- Heal a creature by a share of its whole health and stop it bleeding; false when it was neither hurt nor bleeding.
create or replace function faith_tend(p_world uuid, p_id int, p_share double precision) returns boolean
 language plpgsql as $fn$
declare c creature; v_top double precision;
begin
  perform creature_settle(p_world, p_id);
  select * into c from creature where world_id = p_world and id = p_id for update;
  if not found then return false; end if;
  v_top := max_health(c);
  if c.health >= v_top and c.bleed_until is null then return false; end if;
  update creature set health = least(v_top, health + v_top * p_share), bleed_until = null, bleed_rate = null
    where world_id = p_world and id = p_id;
  return true;
end $fn$;

-- Draw the venom out of every wound and close every burn; false when there was neither.
create or replace function faith_purify(p_world uuid, p_uid uuid) returns boolean language plpgsql as $fn$
declare p player; w jsonb; v_out jsonb := '[]'::jsonb; v_did boolean := false;
begin
  select * into p from player where world_id = p_world and uid = p_uid for update;
  for w in select * from jsonb_array_elements(coalesce(p.wounds, '[]'::jsonb)) loop
    if w->>'kind' = 'burn' then v_did := true; continue; end if;
    if coalesce((w->>'venom')::double precision, 0) > 0 then
      w := jsonb_set(w, '{venom}', '0');
      v_did := true;
    end if;
    v_out := v_out || w;
  end loop;
  if v_did then update player set wounds = v_out where world_id = p_world and uid = p_uid; end if;
  return v_did;
end $fn$;

/*
 * A blow on somebody, after a Ward and a Shield of Dawn have had it: the
 * Ward takes its share of the next blow and goes, and the Shield takes
 * what it has left of the rest.
 */
create or replace function faith_blunt(p_world uuid, p_uid uuid, p_raw double precision) returns double precision
 language plpgsql as $fn$
declare b jsonb; v_cut double precision; v_left double precision; v_changed boolean := false;
begin
  select blessings into b from player where world_id = p_world and uid = p_uid;
  if b is null or b = '{}'::jsonb then return p_raw; end if;
  if (b->'ward'->>'until')::timestamptz > now() then
    v_cut := (b->'ward'->>'cut')::double precision;
    p_raw := p_raw * (1 - v_cut);
    b := b - 'ward';
    v_changed := true;
    perform tell(p_world, p_uid, (select name from faith_spell where id = 'blessing_ward') || ' takes '
      || faith_pct(v_cut) || ' of the blow.', 'fight');
  end if;
  if (b->'shield'->>'until')::timestamptz > now() and p_raw > 0 then
    v_left := (b->'shield'->>'left')::double precision;
    v_changed := true;
    if v_left > p_raw then
      b := jsonb_set(b, '{shield,left}', to_jsonb(v_left - p_raw));
      p_raw := 0;
      perform tell(p_world, p_uid, (select name from faith_spell where id = 'blessing_shield') || ' takes the blow.', 'fight');
    else
      p_raw := p_raw - v_left;
      b := b - 'shield';
      perform tell(p_world, p_uid, (select name from faith_spell where id = 'blessing_shield')
        || ' breaks, and the rest of the blow reaches you.', 'fight');
    end if;
  end if;
  if v_changed then update player set blessings = b where world_id = p_world and uid = p_uid; end if;
  return p_raw;
end $fn$;

-- Whether a Second Life takes the killing blow, leaving its share of health instead; spent if it does.
create or replace function faith_second_life(p_world uuid, p_uid uuid) returns boolean language plpgsql as $fn$
declare b jsonb; v_heal double precision;
begin
  select blessings into b from player where world_id = p_world and uid = p_uid;
  if not coalesce((b->'second_life'->>'until')::timestamptz > now(), false) then return false; end if;
  v_heal := (b->'second_life'->>'heal')::double precision;
  update player set blessings = blessings - 'second_life', stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{health}', to_jsonb(v_heal))
    where world_id = p_world and uid = p_uid;
  perform tell(p_world, p_uid, (select name from faith_spell where id = 'blessing_second_life')
    || ' takes the blow that would have killed you, and leaves you at ' || faith_pct(v_heal) || ' of your health.', 'fight');
  return true;
end $fn$;

-- What a Renewal heals between a body's last settling and now.
create or replace function faith_renewal(p_blessings jsonb, p_from timestamptz) returns double precision language sql stable as $fn$
  select coalesce(greatest(0, extract(epoch from least(now(), (p_blessings->'renewal'->>'until')::timestamptz)
                                     - greatest(p_from, (p_blessings->'renewal'->>'at')::timestamptz)))
                  * (p_blessings->'renewal'->>'each')::double precision / (p_blessings->'renewal'->>'every')::double precision, 0)
$fn$;

-- How much harder somebody's blows land on this kind of creature: a Bless Arms on them, at a monster.
create or replace function faith_arms(p_world uuid, p_uid uuid, d species_def) returns double precision language sql stable as $fn$
  select coalesce((select case when d.monster and (p.blessings->'arms'->>'until')::timestamptz > now()
                               then 1 + (p.blessings->'arms'->>'more')::double precision else 1 end
                     from player p where p.world_id = p_world and p.uid = p_uid), 1)
$fn$;

-- How long a job wanting this tool takes, by a Steady Hands cast on one you carry.
create or replace function faith_steady(p_world uuid, p_uid uuid, p_tool text) returns double precision language sql stable as $fn$
  select coalesce((select 1 - (p.blessings->'steady'->>'cut')::double precision
                     from player p join item i on i.world_id = p.world_id and i.id = (p.blessings->'steady'->>'item')::bigint
                    where p.world_id = p_world and p.uid = p_uid and p_tool is not null
                      and (p.blessings->'steady'->>'until')::timestamptz > now()
                      and i.holder = 'player' and i.holder_uid = p_uid and i.def = p_tool), 1)
$fn$;

-- What a Kinship adds to somebody's next go at taming this creature, and that go spending it.
create or replace function faith_kinship(p_world uuid, p_uid uuid, p_id int) returns double precision language sql stable as $fn$
  select coalesce((select (p.blessings->'kinship'->>'points')::double precision from player p
                    where p.world_id = p_world and p.uid = p_uid and (p.blessings->'kinship'->>'id')::int = p_id
                      and (p.blessings->'kinship'->>'until')::timestamptz > now()), 0)
$fn$;
create or replace function faith_kinship_spent(p_world uuid, p_uid uuid, p_id int) returns void language sql as $fn$
  update player set blessings = blessings - 'kinship'
   where world_id = p_world and uid = p_uid and (blessings->'kinship'->>'id')::int = p_id
$fn$;

/*
 * A creature hunting somebody inside a Radiance, settled: its share of its
 * health a second for every second since it was last settled that it spent
 * there while the Radiance lasted, never down to nothing.
 */
create or replace function faith_radiance(p_world uuid, c creature, p_x double precision, p_y double precision) returns creature
 language plpgsql as $fn$
declare v_share double precision;
begin
  select sum(greatest(0, extract(epoch from least(now(), z.until) - greatest(c.settled_at, z.at))) * z.rate) into v_share
    from faith_zone z
   where z.world_id = p_world and z.kind = 'radiance' and z.until > c.settled_at
     and (p_x - z.x) ^ 2 + (p_y - z.y) ^ 2 <= z.r ^ 2;
  if coalesce(v_share, 0) <= 0 then return c; end if;
  c.health := greatest(least(c.health, 1), c.health - max_health(c) * v_share);
  c.hurt_at := now();
  return c;
end $fn$;

/*
 * What a spell does, once nothing refuses it: `{said}` for the log when it
 * worked, or `{why}` when what it was pointed at will not take it, in which
 * case it costs nothing. `p_target` is what `spell_target` made of it.
 */
create or replace function faith_spell_cast(p_world uuid, p_uid uuid, p_spell text, p_target jsonb) returns jsonb
 language plpgsql as $fn$
declare s faith_spell; me player; c creature; d species_def; it item; r jsonb;
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

  else
    return jsonb_build_object('why', 'Nothing is written behind that spell yet.');
  end case;

  if v_uid is not null and v_uid <> p_uid then
    perform tell(p_world, v_uid, me.name || ' casts ' || s.name || ' on you. ' || s.note, 'system');
  end if;
  return jsonb_build_object('said', v_said);
end $fn$;

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
    if piece.dmg + v_worn >= 100 then
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

CREATE OR REPLACE FUNCTION public.body_settle(p_world uuid, p_uid uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare p player; secs double precision;
        h double precision; t double precision; w double precision; hp double precision;
        deep boolean; swum double precision; swim_from timestamptz; nagged timestamptz;
        cost double precision; gasped double precision; i int;
begin
  select * into p from player where world_id = p_world and uid = p_uid for update;
  if not found then return; end if;
  secs := least(body_gap(), extract(epoch from (now() - p.body_at)));
  if secs <= 0 then
    update player set body_at = now() where world_id = p_world and uid = p_uid;
    return;
  end if;
  h := coalesce((p.stats->>'hunger')::double precision, 1);
  t := coalesce((p.stats->>'thirst')::double precision, 1);
  w := coalesce((p.stats->>'stamina')::double precision, 1);
  hp := coalesce((p.stats->>'health')::double precision, 1);
  deep := coalesce(in_deep_water(p_world, p_uid), false);
  swim_from := coalesce(p.swim_at, p.body_at);
  nagged := p.drowned_at;

  /*
   * What is on your table, which holds hunger and thirst off.
   *
   * `upkeep_mul` reads the *average* of the four, so anything at all in you
   * helps and a full table helps most. `kept_best` has been crossed from the
   * browser since nutrition was written and nothing on this island read it, so
   * a body that ate well got nothing for it but the bar going up once.
   */
  h := greatest(0, h - secs * hunger_rate() * upkeep_mul(p.nutrition));
  t := greatest(0, t - secs * thirst_rate() * upkeep_mul(p.nutrition));

  if deep then
    /*
     * Open water, which cost nothing at all until now.
     *
     * A strong swimmer tires more slowly — the same easing the browser has
     * always applied — and a swimmer with no wind left is swallowing water.
     * The warning is spaced by `drown_warn` off the row rather than off a
     * clock in a tab, because `body_settle` runs on every walk and every beat
     * and an unspaced line would be a wall of them.
     */
    cost := swim_wind() * greatest(0.4, 1 - skill_of(p_world, p_uid, 'swimming') / 200);
    /*
     * How much of the stretch there was breath for, and how much of it there
     * was not. The browser asks that of every frame it draws; here it is one
     * division, and it has to be asked: a stretch that *ends* out of breath is
     * not a stretch that spent the whole of itself drowning, and charging it
     * as one turns twenty seconds in the water into a death.
     */
    gasped := greatest(0, secs - (case when cost > 0 then w / cost else 0 end));
    w := greatest(0, w - secs * cost);
    if gasped > 0 then
      hp := greatest(0, hp - gasped * drown_rate());
      if nagged is null or now() - nagged > make_interval(secs => drown_warn()) then
        perform tell(p_world, p_uid,
          'You are exhausted and swallowing water. Get to shore!', 'error');
        nagged := now();
      end if;
    end if;
    /*
     * And deep water is its own teacher — a go a second, and no other way.
     *
     * Two things push at this from opposite sides and only one shape satisfies
     * both. `skill_gain_of` has a floor under it (`min_gain`), so a base scaled
     * by a tenth of a second is not a tenth of a second's worth — it is the
     * floor, and a browser settling ten times a second would buy ten goes out
     * of one. And `skill_room` falls as the number rises, so one go of a
     * minute's worth is a quarter more than sixty goes of a second's:
     *
     *     sixty goes of 0.09, a second apiece      1 -> 6.4278
     *     one go of 5.40, the whole minute at once 1 -> 8.0092
     *
     * — which a body left floating while the tab is shut would collect by the
     * three minutes, over and over, drowning each time and not minding.
     *
     * So the clock runs on the row and is spent a whole second at a time, the
     * way `swimClock` spends it over there. Twenty-five goes to a call, as in
     * `settle`, and what is left stays on the clock for the next one — and a
     * body that reaches the shore drops the backlog, because ashore is where
     * the clock starts again.
     */
    swum := least(floor(extract(epoch from (now() - swim_from))), 25);
    if swum >= 1 then
      for i in 1..swum::int loop
        perform skill_raise(p_world, p_uid, 'swimming', swim_learn());
      end loop;
      swim_from := swim_from + make_interval(secs => swum);
    end if;
  else
    if p.act is null then
      /*
       * And your wind, which comes back slower on the move.
       *
       * `wind_walk()` was crossed the day the body was and called by nothing, so
       * a body that walked all day got its wind back as fast as one sitting
       * down. The island cannot watch your feet between beats, so it asks the
       * one thing it does know: whether the body moved at all during the stretch
       * this is settling. Moved in it, walked through it.
       */
      w := least(1, w + secs
             * (case when p.moved_at > p.body_at then wind_walk() else wind_rest() end)
             * (1 + greatest(0, skill_of(p_world, p_uid, 'body_stamina') - char_start()) * wind_per_level())
             * (case when h <= 0 or t <= 0 then wind_starving() else 1 end));
    end if;
    -- Ashore, so the swimming clock starts again from nothing and the
    -- telling-off is forgotten.
    swim_from := now();
    nagged := null;
  end if;

  -- Nothing knits while you are trying not to drown.
  if not deep and h > heal_fed() and t > heal_fed() and hp < 1 then
    hp := least(1, hp + secs * heal_rate());
  end if;
  -- And a Renewal's share of the time since the body was last settled (`faith_renewal`).
  hp := least(1, hp + faith_renewal(p.blessings, p.body_at));

  /*
   * And the rest banked by a night in a bed, which burns while you work.
   *
   * `rest_bonus()` was crossed from the browser the day sleeping was ported
   * and nothing ever called it, so the rest went in and never came out: a body
   * that had slept once carried it for ever, and would have carried a doubled
   * rate for ever the moment anything spent it. It burns a second a second,
   * and only while there is a job in hand — standing about is not work.
   */
  if p.act is not null and coalesce(p.rested, 0) > 0 then
    update player set rested = greatest(0, p.rested - secs)
      where world_id = p_world and uid = p_uid;
    if p.rested - secs <= 0 then
      perform tell(p_world, p_uid,
        'The rest goes out of you. Skills go in at their ordinary pace again.', 'system');
    end if;
  end if;

  /*
   * And what is on the table going off, which nothing here did either.
   *
   * `nutrient_decay` is a full measure falling away to nothing over fifty
   * minutes of world time. Without it one good dinner fed a body for the rest
   * of its life, which would have been the reward for porting `upkeep_mul`
   * above rather than a rule.
   */
  if p.nutrition is not null and p.nutrition <> '{}'::jsonb then
    update player set nutrition = (
        select jsonb_object_agg(k, greatest(0, (p.nutrition->>k)::double precision - secs * nutrient_decay()))
          from jsonb_object_keys(p.nutrition) k)
      where world_id = p_world and uid = p_uid;
  end if;

  update player set body_at = now(), swim_at = swim_from, drowned_at = nagged,
    stats = jsonb_set(jsonb_set(jsonb_set(jsonb_set(
      coalesce(stats, '{}'::jsonb),
      '{hunger}', to_jsonb(h)), '{thirst}', to_jsonb(t)),
      '{stamina}', to_jsonb(w)), '{health}', to_jsonb(hp))
    where world_id = p_world and uid = p_uid;
  -- And a body that has taken its last breath, where every other death goes.
  if hp <= 0 then perform player_die(p_world, p_uid); end if;
end $function$;

CREATE OR REPLACE FUNCTION public.rpc_act(p_world uuid, p_action text, p_target jsonb, p_times integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); d action_def; p player; why text; secs double precision;
        s double precision; tq double precision; cap int; room int;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  perform settle(p_world, me);
  why := act_refusal(p_world, me, p_action, p_target);
  if why is not null then
    perform tell(p_world, me, why, 'error');
    return jsonb_build_object('started', false, 'why', why);
  end if;
  select * into d from action_def where id = p_action;
  select * into p from player where world_id = p_world and uid = me for update;

  /*
   * A fight never waits behind work: what is in hand goes to the front of the
   * line to be picked up after, as `fight_back` puts it, and a fight already
   * in hand gives way to this one. The browser does the same in `requestAction`.
   */
  if p.act is not null and is_fight(p_action) then
    update player set
        act_queue = case when is_fight(p.act) then act_queue
                         else jsonb_build_array(jsonb_build_object('action', p.act, 'target', p.act_target,
                                                                   'goes', greatest(1, coalesce(p.act_left, 1)))) || act_queue end,
        act = null, act_target = null, act_started = null, act_ends = null, act_left = null, act_goes = null
      where world_id = p_world and uid = me returning * into p;
  end if;

  -- Something already in hand: line this one up behind it rather than drop it.
  if p.act is not null then
    cap := queue_capacity(p_world, me);
    room := cap - 1 - jsonb_array_length(p.act_queue);
    if room <= 0 then
      why := 'You can only keep ' || cap || ' jobs in your head at once. Mind logic is what widens that.';
      perform tell(p_world, me, why, 'error');
      return jsonb_build_object('started', false, 'queued', false, 'why', why);
    end if;
    /*
     * And what the thing *was*, for a job that may outlive the row it names.
     *
     * Stamped now rather than worked out later, because later is exactly when
     * it cannot be: once `consume` has deleted the last of a stack there is
     * nothing left to ask what kind of thing it had been.
     */
    update player set act_queue = act_queue || (jsonb_build_object(
        'action', p_action, 'target', p_target, 'goes', greatest(1, least(100, coalesce(p_times, 1))))
        || coalesce((select jsonb_build_object('was', i.def) from item i
                      where i.id = target_item(p_target) and i.world_id = p_world), '{}'::jsonb))
      where world_id = p_world and uid = me returning * into p;
    perform tell(p_world, me, d.label || ' is next, ' || jsonb_array_length(p.act_queue) + 1 || ' of ' || cap || ' in hand.', 'info');
    /*
     * And what is in the head now, not just how much of it.
     *
     * The bar drew its queue from `rpc_settle` and nothing else, and
     * `rpc_settle` runs on the heartbeat and when a job comes due — never when
     * one is *added*. So asking for a third job while two were running left the
     * bar saying "2 of 3" until the job in hand finished, at which point one
     * came off the queue and it said "2 of 3" again. Reported as never changing
     * from 2/3 to 3/3, which is exactly what it did: it was always one behind,
     * and topping the queue up kept it there.
     *
     * The answer to the ask is where the browser should hear about what the ask
     * did, so it says so here rather than waiting to be asked again.
     */
    return held_now(p_world, me) || jsonb_build_object('started', false, 'queued', true,
      'inHand', jsonb_array_length(p.act_queue) + 1, 'capacity', cap,
      'queue', coalesce((select jsonb_agg(jsonb_build_object(
                           'action', q->>'action',
                           'goes', greatest(1, coalesce((q->>'goes')::int, 1))) order by o)
                         from jsonb_array_elements(p.act_queue) with ordinality t(q, o)), '[]'::jsonb));
  end if;

  s := case when d.skill is null then 50 else skill_of(p_world, me, d.skill) end;
  -- The tool at what it counts at: a Farmer's Worn-in Rake counts the rake better.
  tq := job_tool_ql(coalesce(p.class_mul, '{}'::jsonb), p_world, me, p_action, d.tool);
  -- Every other job has a floor of a second or so under it; an instant one has
  -- no duration to put a floor under, and act_duration would give it one.
  secs := case when d.instant then 0
               else act_duration(act_base(p_world, me, p_action, d.base_time), s, tq, control_speed(p_world, me)
                 * class_mul(coalesce(p.class_mul, '{}'::jsonb), 'hands',
                             act_scope(p_world, me, d.skill)) * bauble_pace(p_world, me, d.skill))
                 -- And what a perk makes of this job's time: a Terraformer's Quick Level,
                 -- a Mason's Quick Mason on stone. After the floor, so that it says
                 -- what it does of a job already down on it (a Mender's Quick Hands).
                 * perk_time(coalesce(p.class_mul, '{}'::jsonb), p_world, p_action, p_target)
                 -- And a piece standing near that speeds the trade: an Artisan's potter's wheel.
                 * piece_pace(p_world, me, d.skill) * faith_steady(p_world, me, d.tool) end;
  update player set
      act = p_action, act_target = p_target, act_started = now(),
      act_ends = now() + make_interval(secs => secs),
      act_left = greatest(1, least(100, coalesce(p_times, 1))),
      act_goes = greatest(1, least(100, coalesce(p_times, 1))), seen_at = now(), away = false
    where world_id = p_world and uid = me;
  /*
   * And what the ask left you holding, said in the answer to the ask.
   *
   * Reported as inventory rubberbanding: a thing put in a crate turns up in
   * the crate and stays in the pack as well, for up to the twenty seconds
   * until the next reconcile, and then goes. Two causes with one shape —
   * nothing ever tells a browser that a thing has *left* its hands.
   *
   * `item` is published with the default replica identity, so a DELETE carries
   * the primary key and nothing else, and the browser's Realtime filter is
   * `holder_uid = me`: a row carrying only an `id` cannot match it. Putting a
   * whole stack in a crate deletes the row, so nothing is said. And a thing
   * that goes to the ground, or to somebody else, has `holder_uid` set to
   * null, so the *new* row does not match the filter either. Realtime carries
   * every arrival and no departure, and `refresh_pack` on the twenty-second
   * reconcile was the only thing that ever noticed.
   *
   * Said at each return rather than worked out once at the top, because for an
   * instant ask the work happens in the `settle` three lines below this — a
   * value built any earlier is the pack as it was before the thing moved,
   * which is the very answer that was wrong.
   */
  if d.instant then
    perform settle(p_world, me);
    return held_now(p_world, me) || jsonb_build_object('started', true, 'done', true, 'seconds', 0);
  end if;
  perform tell(p_world, me, 'You start ' || d.verb || '.', 'info');
  return held_now(p_world, me)
      || jsonb_build_object('started', true, 'ends', now() + make_interval(secs => secs), 'seconds', secs);
end $function$;

CREATE OR REPLACE FUNCTION public.settle(p_world uuid, p_uid uuid)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare p player; d action_def; done int := 0; guard int := 0; nxt jsonb; ended timestamptz;
        v_err text; v_state text; v_where text;
begin
  /*
   * One body's work, and nobody else's.
   *
   * Everything below used to run bare, and `world_tick` settles every body on
   * every island in one transaction: one go that raised an error took the
   * whole round down with it, every second, for as long as that job was
   * still due. Reported as "something just broke, no actions are working":
   * `take_spoil` set the last spadeful in a cart to a count of 0, which the
   * item table refuses, and for a quarter of an hour nothing anybody did on
   * the island finished.
   *
   * So the goes run in a block of their own. A fault undoes what the block
   * had done -- the goes that had come due in this call, and nothing else --
   * stops that job and the queue behind it, tells its owner what the island
   * said, and is kept in `private.tick_fault` for the deploy to report. A
   * deadlock, a lock that timed out or a serialization failure is not a
   * fault in the job: those are raised as before, and the job is tried again
   * next round. A statement timeout is not caught by `others` at all.
   */
  begin
    perform wounds_settle(p_world, p_uid);
    perform body_settle(p_world, p_uid);
    select * into p from player where world_id = p_world and uid = p_uid for update;
    if not found or p.act is null then return 0; end if;
    /*
     * Twenty-five goes to a call, not two hundred.
     *
     * This is the one way a round of the clock can run long: somebody back from
     * an hour away is owed hundreds of goes, and at two hundred apiece — inside
     * `tick_players` inside `tick_worlds` — one person's backlog is the whole
     * tick. It mattered less at five seconds. It matters at one.
     *
     * Nothing is lost by taking less at a time: what is still due is still due,
     * and there is another round a second from now, plus the browser's own beat
     * the moment its job comes up. A backlog drains in seconds either way; the
     * difference is whether everybody else waits while it does.
     */
    while p.act is not null and p.act_ends <= now() and guard < 25 loop
      guard := guard + 1;
      -- A go, for what the baubles make of its yield (`bauble_yield`), and
      -- what they made of it said after the go has said its own piece.
      perform set_config('wurm.bauble_go', 'go', true);
      perform set_config('wurm.bauble_made', '', true);
      -- And the perks, for the rules too deep to be handed the body: for
      -- this go and no other (`pkx`), cleared the moment it is done.
      perform set_config('wurm.pk', coalesce(p.class_mul->'fx', '{}'::jsonb)::text, true);
      perform set_config('wurm.pk_act', p.act, true);
      perform set_config('wurm.floor', floor_said(p_world, p.level, p.x, p.y), true); -- cellar: the side the go is taken on
      perform act_perform(p_world, p_uid, p.act, p.act_target);
      perform set_config('wurm.pk', '', true);
      perform set_config('wurm.pk_act', '', true);
      perform set_config('wurm.floor', '', true); -- cellar
      perform bauble_said(p_world, p_uid);
      -- And what the go took out of you, which nothing over here had ever
      -- charged: `action_def.stamina` was a column no function read.
      perform spend_wind(p_world, p_uid, p.act);
      done := done + 1;
      select * into d from action_def where id = p.act;
      ended := p.act_ends;
      if p.act_left > 1 and act_refusal(p_world, p_uid, p.act, p.act_target) is null then
        update player set act_left = act_left - 1, act_started = ended,
               act_ends = ended + make_interval(secs => act_duration(
                 act_base(p_world, p_uid, d.id, d.base_time),
                 case when d.skill is null then 50 else skill_of(p_world, p_uid, d.skill) end,
                 job_tool_ql(coalesce(p.class_mul, '{}'::jsonb), p_world, p_uid, d.id, d.tool),
                 -- The body's own pace, and then the trade's, which tells only
                 -- on the skill this job is done with.
                 control_speed(p_world, p_uid)
                   * class_mul(coalesce(p.class_mul, '{}'::jsonb), 'hands',
                               act_scope(p_world, p_uid, d.skill)) * bauble_pace(p_world, p_uid, d.skill))
                 -- And a perk on the job's time, after the floor.
                 * perk_time(coalesce(p.class_mul, '{}'::jsonb), p_world, d.id, p.act_target)
                 * piece_pace(p_world, p_uid, d.skill) * faith_steady(p_world, p_uid, d.tool))
          where world_id = p_world and uid = p_uid returning * into p;
      else
        -- A fight was never a count: it ends when it is over or out of reach, and says nothing of goes.
        if p.act_left > 1 and not is_fight(p.act) then
          -- Why, when there is a why. A run of goes that stops because the wind
          -- gave out should say so rather than leave somebody wondering what
          -- they did wrong, which is what the browser has always said.
          perform tell(p_world, p_uid,
            coalesce(act_refusal(p_world, p_uid, p.act, p.act_target) || ' That was '
                     || (coalesce(p.act_left, 1)) || ' to go.',
                     'You stop ' || d.verb || '.'), 'info');
        end if;
        /*
         * The next job in the line, or the first one behind it that can be done.
         *
         * Reported: "queued up multiple chopping actions, then after the tree
         * was felled and no actions were running I'd dig up the stump and it
         * would show a cutting action following that I didn't queue." The
         * second chop, popped once the tree was down, was refused and put out of
         * the line — and the third stayed in it, behind an empty hand, until the
         * next thing asked for was done and it came up as "then". A refusal puts
         * that job out of the line and asks the next, as the browser's
         * `nextInQueue` has always done, until one starts or the line is empty.
         */
        loop
          nxt := p.act_queue -> 0;
          -- Another onion will do. See `act_retarget`: only when the row it named
          -- has gone, and only to another of what it was.
          nxt := act_retarget(p_world, p_uid, nxt);
          if nxt is null then
            update player set act = null, act_target = null, act_started = null, act_ends = null,
                   act_left = null, act_goes = null
              where world_id = p_world and uid = p_uid returning * into p;
            exit;
          end if;
          select * into d from action_def where id = nxt->>'action';
          if d is null or act_refusal(p_world, p_uid, nxt->>'action', nxt->'target') is not null then
            perform tell(p_world, p_uid,
              coalesce(act_refusal(p_world, p_uid, nxt->>'action', nxt->'target'), 'That cannot be done now.'), 'error');
            update player set act = null, act_target = null, act_started = null, act_ends = null,
                   act_left = null, act_goes = null, act_queue = act_queue - 0
              where world_id = p_world and uid = p_uid returning * into p;
            -- And the one behind it.
          else
            update player set act = nxt->>'action', act_target = nxt->'target',
                   act_left = greatest(1, coalesce((nxt->>'goes')::int, 1)),
                   -- What was asked for, carried out of the queue with the job.
                   -- Without it the browser was left holding the count of
                   -- whatever ran *before* this one, and the bar drew "3 of 10"
                   -- off two numbers from different jobs.
                   act_goes = greatest(1, coalesce((nxt->>'goes')::int, 1)),
                   act_started = ended,
                   act_ends = ended + make_interval(secs => act_duration(
                     act_base(p_world, p_uid, d.id, d.base_time),
                     case when d.skill is null then 50 else skill_of(p_world, p_uid, d.skill) end,
                     job_tool_ql(coalesce(p.class_mul, '{}'::jsonb), p_world, p_uid, d.id, d.tool),
                     control_speed(p_world, p_uid)
                       * class_mul(coalesce(p.class_mul, '{}'::jsonb), 'hands',
                                   act_scope(p_world, p_uid, d.skill)) * bauble_pace(p_world, p_uid, d.skill))
                     * perk_time(coalesce(p.class_mul, '{}'::jsonb), p_world, d.id, nxt->'target')
                     * piece_pace(p_world, p_uid, d.skill) * faith_steady(p_world, p_uid, d.tool)),
                   act_queue = act_queue - 0
              where world_id = p_world and uid = p_uid returning * into p;
            perform tell(p_world, p_uid, 'You start ' || d.verb || '.', 'info');
            exit;
          end if;
        end loop;
      end if;
    end loop;
    return done;
  exception
    when deadlock_detected or lock_not_available or serialization_failure then raise;
    when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate, v_where = pg_exception_context;
      perform settle_fault(p_world, p_uid, v_err, v_state, v_where);
      return 0;
  end;
end $function$;

CREATE OR REPLACE FUNCTION public.tame_chance(p_world uuid, p_uid uuid, c creature)
 RETURNS double precision
 LANGUAGE sql
 STABLE
AS $function$
  select case when d.monster then 0 else
    -- And a Kinship's points on top of whatever the rest comes to (`faith_kinship`).
    least(0.95, greatest(0, least(0.95, (d.tame_chance
      + (skill_of(p_world, p_uid, 'taming') - d.tame_level) / 200
      + case when c.hunger < 0.5 then 0.1 else 0 end
      + coax_bonus(c, pk(p_world, p_uid, 'coax:step', coax_step()))
      + greatest(0, (skill_of(p_world, p_uid, 'soul_strength') - 20) * 0.002))
      -- A young one easier still for a Herdsman's Young Trust.
      * case when age_of(c.born, old_of(c)) = 'young' then pk(p_world, p_uid, 'tame:young', (age_row(c.born, old_of(c))).tame)
             else (age_row(c.born, old_of(c))).tame end
      -- Gentle hand: a wild thing is a quarter readier to trust you.
      * case when walks(p_world, p_uid, 'love', 3) then 1.25 else 1 end
      * class_mul(p_world, p_uid, 'tame', 'soul_strength')
      -- And every offering so many points likelier for a Herdsman's Soft Hand, over all the rest of it.
      + pk(p_world, p_uid, 'tame:offer', 0))) + faith_kinship(p_world, p_uid, c.id)) end
  from species_def d where d.id = c.species
$function$;

CREATE OR REPLACE FUNCTION public.perform_creature(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare c creature; d species_def; a age_def; food text; n int; made_ql double precision;
        gained double precision; chance double precision; warm double precision; nm text;
        held int; brush_id bigint; top double precision; before double precision; skill double precision;
        dd deed; v_swap int; v_to text; v_why text; v_more boolean := false;
begin
  -- Opening a crate is asked of the crate, standing or carried.
  if p_action in ('crate_follow', 'crate_work') then
    perform perform_crate_open(p_world, p_uid, p_action, p_target);
    return;
  end if;
  c := target_creature(p_world, p_target);
  if c.world_id is null then return; end if;
  select * into d from species_def where id = c.species;
  a := age_row(c.born, old_of(c));

  if p_action = 'examine_creature' then
    if c.mode = 'wild' and d.monster then
      perform tell(p_world, p_uid, 'A ' || lower(d.name) || ': ' || d.description
        || ' It has ' || ceil(c.health) || ' of ' || max_health(c) || ' in it and hits for '
        || to_char(attack_of(c), 'FM990') || '. It cannot be tamed. Kill it and butcher it, or keep well clear.', 'error');
    elsif c.mode = 'wild' then
      warm := coax_bonus(c, pk(p_world, p_uid, 'coax:step', coax_step()));
      perform tell(p_world, p_uid, 'A wild ' || lower(d.name) || ': ' || d.description
        || ' It eats ' || diet_text(c.species) || '.'
        || case when warm > 0 then ' It has taken ' ||
             case when c.coaxed = 1 then 'an offering' else c.coaxed || ' offerings' end
             || ' from your hand and is ' || to_char(warm * 100, 'FM990') || '% readier for the next.'
           else '' end
        || ' You would have to tame it to learn more.', 'event');
    else
      perform tell(p_world, p_uid, c.name || ' (' || c.sex || ' ' || lower(d.name) || ', ' || a.name
        || '): ' || d.description || ' Level ' || creature_level(c.skills)
        || '. Health ' || ceil(c.health) || '/' || max_health(c) || '. It is ' || care_word(c.care)
        || ' and carries ' || trait_names(c.traits) || '. '
        || case when c.hunger < 0.3 then 'It looks hungry.' when c.hunger < 0.6 then 'It could eat.'
                else 'It looks well fed.' end
        || ' It eats ' || diet_text(c.species) || '.'
        -- And the odds of a pairing, for a Herdsman's Stud Book.
        || stud_book(p_world, p_uid, c), 'event');
    end if;

  elsif p_action = 'tame' then
    -- Any food as an offering for a Herdsman's Any Bait.
    food := bait_in_pack(p_world, p_uid, c.species, pk(p_world, p_uid, 'bait:any', 0) > 0);
    if food is null then return; end if;
    -- The crate may have gone out of the pack since the offering was begun.
    if tame_room_refusal(p_world, p_uid) is not null then
      perform tell(p_world, p_uid, tame_room_refusal(p_world, p_uid), 'error');
      return;
    end if;
    if not consume(p_world, p_uid, food, 1) then return; end if;
    chance := tame_chance(p_world, p_uid, c);
    perform faith_kinship_spent(p_world, p_uid, c.id);
    update creature set hunger = least(1, hunger + 0.25) where world_id = p_world and id = c.id;
    if random() < chance then
      held := companion_of(p_world, p_uid);
      update creature set mode = 'active', stance = 'defensive', keeper = p_uid, coaxed = 0, coaxed_at = null
        where world_id = p_world and id = c.id;
      -- One follows you; every one after that goes into the crate you carry.
      if held is not null then perform crate_shut_in(p_world, c.id, empty_crate(p_world, p_uid), null); end if;
      perform tell(p_world, p_uid, 'The ' || lower(d.name) || ' takes the '
        || material_name(food, 1) || ' from your hand and trusts you. '
        || case when held is null then c.name || ' now follows you.'
             else 'It goes into the creature crate in your pack: set the crate down, or open it to have it follow you or work the deed.' end,
        'system');
      perform journal_note(p_world, p_uid, 'tamed');
      perform guide_mark(p_world, p_uid, c.species, 'tamed');
      perform skill_told(p_world, p_uid, 'taming', try_gain(true, tame_gain()));
      perform skill_told(p_world, p_uid, 'soul_strength', try_gain(true, tame_nerve()));
    else
      -- It refused, but it stayed for the offering, and that is worth
      -- something to the next one.
      update creature set coaxed = coaxed + 1, coaxed_at = now()
        where world_id = p_world and id = c.id returning * into c;
      warm := coax_bonus(c, pk(p_world, p_uid, 'coax:step', coax_step()));
      perform tell(p_world, p_uid, 'The ' || lower(d.name) || ' '
        || replace(d.tame_fail, '{food}', material_name(food, 1)) || '.'
        -- No ceiling on it any more, so nothing here says there is one: this
        -- read "as used to you as it will get" from the fourth offering on,
        -- which was true then and is not now.
        || case when warm > 0 then ' It is growing used to you: '
             || to_char(warm * 100, 'FM990') || '% readier than the first time.'
           else '' end, 'event');
      perform skill_told(p_world, p_uid, 'taming', try_gain(false, tame_gain()));
      perform skill_told(p_world, p_uid, 'soul_strength', try_gain(false, tame_nerve()));
    end if;

  elsif p_action = 'feed' then
    food := bait_in_pack(p_world, p_uid, c.species);
    if food is null or not consume(p_world, p_uid, food, 1) then return; end if;
    update creature set hunger = least(1, hunger + 0.5) where world_id = p_world and id = c.id;
    perform tell(p_world, p_uid, c.name || ' gobbles up the ' || material_name(food, 1) || '.', 'event');

  elsif p_action = 'groom' then
    select i.id into brush_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'brush'
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    skill := skill_of(p_world, p_uid, 'animal_husbandry');
    before := c.care;
    top := max_health(c);
    update creature set
        -- More of it at a go for a Herdsman's Brushwork.
        care = least(1, care + (0.18 + (skill / 100) * 0.34
                          + (least(100, tool_ql(p_world, p_uid, 'brush')) / 100) * 0.22) * pk(p_world, p_uid, 'groom:care', 1)),
        -- A brushing is also a looking-over: it finds the small hurts, more of them for Healing Hands.
        health = least(top, health + top * pk(p_world, p_uid, 'groom:heal', groom_heal()))
      where world_id = p_world and id = c.id returning * into c;
    if brush_id is not null then perform wear_tool(brush_id, 3); end if;
    perform journal_note(p_world, p_uid, 'groom');
    if c.care >= 0.995 then perform journal_note(p_world, p_uid, 'groomfull'); end if;
    gained := skill_told(p_world, p_uid, 'animal_husbandry', 0.4);
    perform tell(p_world, p_uid, case when before < 0.12 and c.care >= 0.12
        then 'You work the dust out of ' || c.name || '''s coat. It leans into the brush. ('
        else 'You brush ' || c.name || ' down. (' end || care_word(c.care) || ')', 'event');

  elsif p_action = 'shear' then
    -- A full fleece is three, a half-grown one is one, and quality follows the fleece.
    n := greatest(1, round(c.fleece * case when coalesce(d.shear_yield, 'wool') = 'wool' then 3 else 6 end)::int)
      -- And more of it for a perk on what comes off (a Tailor's Full Fleece).
      + floor(pk(p_world, p_uid, 'plus:' || coalesce(d.shear_yield, 'wool'), 0))::int;
    made_ql := greatest(1, least(100, 15 + c.fleece * 45 + skill_of(p_world, p_uid, 'tailoring') * 0.4));
    perform gather(p_world, p_uid, coalesce(d.shear_yield, 'wool'), n, made_ql);
    update creature set fleece = 0 where world_id = p_world and id = c.id;
    perform skill_told(p_world, p_uid, 'tailoring', 0.4);
    perform skill_told(p_world, p_uid, 'taming', 0.1);
    perform tell(p_world, p_uid, 'You '
      || case when coalesce(d.shear_yield, 'wool') = 'wool' then 'shear' else 'pluck' end
      || ' ' || c.name || ' and come away with ' || n || ' '
      || lower((select coalesce(name, 'wool') from item_def where id = coalesce(d.shear_yield, 'wool')))
      || '. (QL ' || to_char(made_ql, 'FM990.0') || ') It will grow back.', 'event');

  elsif p_action = 'milk_creature' then
    if not consume(p_world, p_uid, 'bucket', 1) then return; end if;
    -- What it has been fed on is what comes out of it.
    made_ql := greatest(1, least(100, 20 + c.fleece * 40 + c.hunger * 30));
    perform give(p_world, p_uid, 'milk_bucket', 1, made_ql);
    -- A Farmer's Milkmaid fills a second bucket now and then, if there is one.
    if random() < pk(p_world, p_uid, 'more:milk_creature', 0) then
      v_more := consume(p_world, p_uid, 'bucket', 1);
      if v_more then perform give(p_world, p_uid, 'milk_bucket', 1, made_ql); end if;
    end if;
    update creature set fleece = 0 where world_id = p_world and id = c.id;
    perform skill_told(p_world, p_uid, 'farming', 0.3);
    perform tell(p_world, p_uid, 'You milk ' || c.name || ' into the bucket'
      || case when v_more then ' and fill another' else '' end || '. (QL '
      || to_char(made_ql, 'FM990.0') || ')', 'event');

  elsif p_action = 'set_stance' then
    update creature set stance = p_target->>'stance', enemy = null where world_id = p_world and id = c.id;
    perform tell(p_world, p_uid, c.name || ' will be '
      || case when p_target->>'stance' = 'guard' then 'guarding you' else p_target->>'stance' end || '.', 'info');

  elsif p_action = 'order_attack' then
    update creature set enemy = (p_target->>'foe')::int, heel_until = null where world_id = p_world and id = c.id;
    perform tell(p_world, p_uid, c.name || ' goes for the ' || lower((select sd.name from creature q
      join species_def sd on sd.id = q.species where q.world_id = p_world and q.id = (p_target->>'foe')::int)) || '.', 'fight');

  elsif p_action = 'order_heel' then
    update creature set enemy = null, heel_until = now() + make_interval(secs => fall_back())
      where world_id = p_world and id = c.id;
    perform tell(p_world, p_uid, c.name || ' falls back to your side, and starts no fight for ' || fall_back() || ' seconds.', 'info');

  elsif p_action = 'rename_creature' then
    nm := left(btrim(p_target->>'name'), 24);
    update creature set name = nm where world_id = p_world and id = c.id;
    perform tell(p_world, p_uid, 'It answers to ' || nm || ' now.', 'info');

  elsif p_action = 'take_creature' then
    -- The one following you takes its place, on the deed or in a crate you carry.
    select sw.v_current, sw.v_to, sw.v_why into v_swap, v_to, v_why from companion_swap(p_world, p_uid, c) sw;
    if v_why is not null then return; end if;
    if c.carrying is not null then
      perform drop_on_ground(p_world, floor(creature_x(c))::int, floor(creature_y(c))::int,
        c.carrying->>'def', coalesce((c.carrying->>'ql')::double precision, 1), c.carrying->>'extra',
        coalesce((c.carrying->>'count')::int, 1));
    end if;
    update creature set mode = 'active', keeper = p_uid, post = null, carrying = null, phase = 'idle',
        enemy = null, hunting = null, settled_at = now()
      where world_id = p_world and id = c.id;
    perform creature_settle(p_world, c.id);
    perform tell(p_world, p_uid, c.name || ' now follows you.', 'system');
    if v_to = 'deed' then
      update creature set mode = 'deed', job = (select s.gathers from species_def s where s.id = creature.species),
          phase = 'idle', work_x = null, work_y = null, carrying = null, enemy = null, hunting = null,
          settled_at = now()
        where world_id = p_world and id = v_swap returning * into c;
      perform tell(p_world, p_uid, c.name || ' stays behind in its place, and will ' || deed_job_line(c) || '.', 'info');
    elsif v_to = 'crate' then
      perform crate_shut_in(p_world, v_swap, empty_crate(p_world, p_uid), null);
      perform tell(p_world, p_uid, (select q.name from creature q where q.world_id = p_world and q.id = v_swap)
        || ' goes into the creature crate in your pack.', 'info');
    end if;

  elsif p_action = 'crate_creature' then
    if empty_crate(p_world, p_uid) is null or c.mode not in ('active', 'deed') then return; end if;
    perform crate_shut_in(p_world, c.id, empty_crate(p_world, p_uid), null);
    perform tell(p_world, p_uid, c.name || ' goes into the creature crate. Set the crate down and it can be seen inside.', 'system');

  elsif p_action = 'assign_deed' then
    -- The same key, missed in the same place: this is the token the wildermon
    -- is being put to work around, so it is the caller's own, not whichever
    -- one the planner happened to hand back first. On an island with two
    -- settlements it teleported a stored beast to a stranger's token.
    dd := my_deed(p_world, p_uid);
    -- The trade it was asked for by name, or its species' own. The door has
    -- already said the name is one of its trades.
    update creature set mode = 'deed', keeper = p_uid, phase = 'idle',
        job = coalesce(nullif(p_target->>'job', ''), d.gathers),
        work_x = null, work_y = null, carrying = null,
        from_x = case when c.mode = 'stored' then dd.x + 0.5 else creature_x(c) end,
        from_y = case when c.mode = 'stored' then dd.y + 1.5 else creature_y(c) end,
        to_x = case when c.mode = 'stored' then dd.x + 0.5 else creature_x(c) end,
        to_y = case when c.mode = 'stored' then dd.y + 1.5 else creature_y(c) end,
        leg_at = now(), leg_ends = now(), until = now(), settled_at = now()
      where world_id = p_world and id = c.id;
    perform tell(p_world, p_uid, c.name || ' will '
      || coalesce((select plain from gather_def where id = coalesce(nullif(p_target->>'job', ''), d.gathers)), 'stay around the settlement')
      || ' within ' || work_range(c) || ' tiles of the token and bring what it finds to the crate.', 'system');

  elsif p_action = 'release_creature' then
    -- Out of its crate first, at the crate's door.
    if c.mode = 'stored' then perform crate_let_out(p_world, c.id); end if;
    -- Blood takes generations to build and a moment to walk away.
    update creature set mode = 'wild', stance = 'passive', keeper = null,
        name = d.name, coaxed = 0, coaxed_at = null, until = now()
      where world_id = p_world and id = c.id;
    perform tell(p_world, p_uid, 'The ' || lower(d.name) || ' ' || d.leaves || '.', 'system');

  elsif p_action = 'cull_creature' then
    /*
     * One action, and it is done.
     *
     * A beast you keep could always be killed — by swinging at it until it
     * stopped, which is a strange thing to have to do to your own livestock
     * and takes as long as fighting a wild one. This is the short way, and it
     * leaves exactly what the long way left: a carcass on the tile, for the
     * knife.
     *
     * Walked forward first, so the carcass lands where the body actually is;
     * a kept one stands at the token, which `creature_settle` has already
     * seen to. Whatever it was carrying is not buried with it.
     */
    perform creature_settle(p_world, c.id);
    -- One in a crate is let out of it first: the carcass lies at the crate's door.
    if c.mode = 'stored' then perform crate_let_out(p_world, c.id); end if;
    select * into c from creature where world_id = p_world and id = c.id;
    if c.world_id is null then return; end if;
    if c.carrying is not null then
      perform drop_on_ground(p_world, floor(creature_x(c))::int, floor(creature_y(c))::int,
        c.carrying->>'def', coalesce((c.carrying->>'ql')::double precision, 1),
        c.carrying->>'extra', coalesce((c.carrying->>'count')::int, 1));
      update creature set carrying = null where world_id = p_world and id = c.id;
    end if;
    nm := c.name;
    -- Past any soak its blood could put in the way: this is not a blow, it is
    -- a decision. `wound_beast` is told nobody struck it, so it writes no
    -- hunter's line and no "you kill the wild one" — the words below are what
    -- happened.
    perform wound_beast(p_world, c.id, 1e9, null, null, null, null);
    perform tell(p_world, p_uid, 'You put ' || nm || ' down. The ' || lower(d.name)
      || '''s carcass lies where it stood, ready for the knife.', 'fight');
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
       or at_peace(p_world, p.x, p.y) then
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
    if m.id is null and p.d > coalesce(d.notice, hunt_sight()) then return c; end if;
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

CREATE OR REPLACE FUNCTION public.at_peace(p_world uuid, p_x double precision, p_y double precision)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  select coalesce((select greatest(abs(p_x - (w.spawn_x + 0.5)), abs(p_y - (w.spawn_y + 0.5))) <= peace_reach()
                   from world w where w.id = p_world), false)
      -- And inside a Sanctuary while it lasts.
      or exists (select 1 from faith_zone z where z.world_id = p_world and z.kind = 'sanctuary' and z.until > now()
                   and (p_x - z.x) ^ 2 + (p_y - z.y) ^ 2 <= z.r ^ 2)
$function$;

select private.lock_doors();
