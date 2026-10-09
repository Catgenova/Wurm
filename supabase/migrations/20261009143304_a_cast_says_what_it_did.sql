/*
 * A cast says what it did.
 *
 * The browser drew every spell from the spell's own numbers and from whatever
 * stood near: an area spell marked everything in its ring, a hold showed for
 * the hold's seconds whatever the island made of it on a monster, a Fright on
 * a monster showed a flight the island had refused, and a Stoke glowed for
 * its whole minute after the fire that spent it. The island knew each of
 * these and said none of them.
 *
 * Now a cast is told what it does as it does it (`fx_open`): the rule that
 * holds, roots, frightens, marks, burns, bleeds, slows, strikes, heals or
 * lays a skin on somebody says so, with the seconds it gave, and the door
 * (`rpc_cast_spell`, `rpc_spell`) hands it back with the rest of its answer
 * (`fx_told`):
 *
 *   hit    who it reached, creatures by id and people by uid, in the order
 *          it reached them
 *   secs   the seconds what it left lasts on each of `hit`, null where it
 *          left nothing that lasts (only when any did)
 *   held   which of `hit` it holds still (only when any)
 *   used   the spells of the caster's waiting to be spent that it spent: a
 *          Stoke, a Thicken (only when any)
 *   size   the largest skin it laid, or the skin a Ward Burst broke, as a
 *          share of health (only when any)
 *   low    an Execute on a creature below its line (only then)
 *
 * and a Ward Link that lays a skin back over somebody, which no cast does,
 * says so to the Warder's browser as a Broadcast of its own (`fx_fired`).
 *
 * Nothing a rule does changes: each says what it already did, into a setting
 * that lasts the transaction and is read by nothing else, and only while a
 * door has opened it -- a blow in a fight or a burn on the clock tells
 * nobody, and costs nothing more than asking whether anybody is listening.
 */

/* Whether a cast is being told what it does (`fx_open`). */
create or replace function fx_heard() returns boolean language sql stable as $$
  select coalesce(current_setting('wurm.fx', true), '') <> ''
$$;

/* Start telling a cast what it does: everything said from now until `fx_told`, in this transaction. */
create or replace function fx_open() returns void language sql as $$
  select set_config('wurm.fx', '{"t":[]}', true)
$$;

/* One thing it did to somebody: who (a creature's id or a person's uid), the seconds it lasts, and what it is. */
create or replace function fx_note(p_who jsonb, p_secs double precision, p_kind text) returns void language plpgsql as $$
declare v jsonb;
begin
  if not fx_heard() or p_who is null or p_who = 'null'::jsonb then return; end if;
  v := current_setting('wurm.fx', true)::jsonb;
  v := jsonb_set(v, '{t}', coalesce(v->'t', '[]'::jsonb)
         || jsonb_build_array(jsonb_build_array(p_who, case when p_secs > 0 then round(p_secs::numeric, 2) end, p_kind)));
  perform set_config('wurm.fx', v::text, true);
end $$;

/* What it did to a creature. */
create or replace function fx_beast(p_id integer, p_secs double precision default null, p_kind text default null)
  returns void language sql as $$
  select fx_note(to_jsonb(p_id), p_secs, p_kind)
$$;

/* What it did to a person. */
create or replace function fx_person(p_uid uuid, p_secs double precision default null, p_kind text default null)
  returns void language sql as $$
  select fx_note(to_jsonb(p_uid::text), p_secs, p_kind)
$$;

/* Something about the cast as a whole (`low`). */
create or replace function fx_set(p_key text, p_val jsonb) returns void language plpgsql as $$
begin
  if not fx_heard() then return; end if;
  perform set_config('wurm.fx', (current_setting('wurm.fx', true)::jsonb || jsonb_build_object(p_key, p_val))::text, true);
end $$;

/* A skin laid or broken: the largest of the cast's. */
create or replace function fx_size(p_size double precision) returns void language plpgsql as $$
begin
  if not fx_heard() or p_size is null then return; end if;
  if p_size > coalesce((current_setting('wurm.fx', true)::jsonb->>'size')::double precision, 0) then
    perform fx_set('size', to_jsonb(round(p_size::numeric, 4)));
  end if;
end $$;

/*
 * What the cast did, from everything it was told (`fx_open`), and the telling
 * stopped. `p_was` is the caster's blessings before it: a Stoke or a Thicken
 * that was waiting then and is gone now was spent by it.
 */
create or replace function fx_told(p_world uuid, p_uid uuid, p_was jsonb) returns jsonb language plpgsql as $$
declare v jsonb := nullif(current_setting('wurm.fx', true), '')::jsonb; v_now jsonb; v_out jsonb; v_used jsonb;
begin
  perform set_config('wurm.fx', '', true);
  if v is null then return '{}'::jsonb; end if;
  with t as (select e.value->0 as who, (e.value->>1)::double precision as secs, e.value->>2 as kind, e.ordinality as n
               from jsonb_array_elements(coalesce(v->'t', '[]'::jsonb)) with ordinality e),
       g as (select who, min(n) as n, max(secs) as secs, bool_or(kind = 'hold') as held from t group by who)
  select jsonb_build_object('hit', coalesce(jsonb_agg(g.who order by g.n), '[]'::jsonb))
      || case when bool_or(g.secs is not null) then jsonb_build_object('secs', jsonb_agg(g.secs order by g.n)) else '{}'::jsonb end
      || case when bool_or(g.held) then jsonb_build_object('held', jsonb_agg(g.who order by g.n) filter (where g.held)) else '{}'::jsonb end
    into v_out from g;
  v_out := coalesce(v_out, jsonb_build_object('hit', '[]'::jsonb));
  if v ? 'size' then v_out := v_out || jsonb_build_object('size', v->'size'); end if;
  if v ? 'low' then v_out := v_out || jsonb_build_object('low', v->'low'); end if;
  select blessings into v_now from player where world_id = p_world and uid = p_uid;
  select jsonb_agg(m.spell order by m.spell) into v_used
    from (values ('stoke', 'kindler_stoke'), ('thicken', 'warder_thicken')) m(key, spell)
   where (p_was->m.key->>'until')::timestamptz > now() and not coalesce(v_now ? m.key, false);
  if v_used is not null then v_out := v_out || jsonb_build_object('used', v_used); end if;
  return v_out;
end $$;

/*
 * Something of a spell's that fired after its cast, on its own (a Ward Link
 * laying a skin back over somebody), to the caster's browser for drawing:
 * which spell, on whom, and how large. Over Broadcast, as `moved` is; a
 * browser that does not know the event never hears it.
 */
create or replace function fx_fired(p_world uuid, p_by uuid, p_spell text, p_on uuid, p_size double precision)
  returns void language plpgsql as $$
begin
  if private.here(p_world, p_by) then
    perform private.send('own:' || p_world || ':' || p_by, 'fx',
      jsonb_build_object('spell', p_spell, 'on', p_on::text, 'size', round(p_size::numeric, 4)));
  end if;
end $$;

/* A creature a blow, a shot, a fire or a strike took something off: told to a cast (`fx_beast`). */
CREATE OR REPLACE FUNCTION public.hurt_creature(p_world uuid, p_id integer, p_dmg double precision, p_by uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
declare px double precision; py double precision; v_was double precision; v_died boolean;
begin
  select p.x, p.y into px, py from player p where p.world_id = p_world and p.uid = p_by;
  -- Only while a cast is being told (`fx_open`): what it had, to tell a blow that landed from one a Truce stopped.
  if fx_heard() then select health into v_was from creature where world_id = p_world and id = p_id; end if;
  v_died := wound_beast(p_world, p_id, p_dmg, px, py, p_by, null);
  if v_was is not null and (v_died or coalesce((select health from creature where world_id = p_world and id = p_id), 0) < v_was) then
    perform fx_beast(p_id);
  end if;
  return v_died;
end $function$;

/* A hold, and for how long: told to a cast as holding it still. */
CREATE OR REPLACE FUNCTION public.class_hold(p_world uuid, p_id integer, p_secs double precision)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare c creature; v_x double precision; v_y double precision;
begin
  select * into c from creature where world_id = p_world and id = p_id;
  if c.id is null or c.health <= 0 then return; end if;
  v_x := creature_x(c); v_y := creature_y(c);
  update creature set from_x = v_x, from_y = v_y, to_x = v_x, to_y = v_y, leg_at = now(), leg_ends = now(),
      until = greatest(until, now() + make_interval(secs => p_secs)), windup_at = null
    where world_id = p_world and id = p_id;
  -- Marked as held for as long as it holds: a Binder's own hold puts its name and its Brittle Hold on it after (`class_bind`).
  insert into class_mark (world_id, creature_id, kind, val, until)
    values (p_world, p_id, 'hold', 1, now() + make_interval(secs => p_secs))
    on conflict (world_id, creature_id, kind) do update
      set val = case when class_mark.until > now() then class_mark.val else excluded.val end,
          by_uid = case when class_mark.until > now() then class_mark.by_uid end,
          until = greatest(class_mark.until, excluded.until);
  perform fx_beast(p_id, p_secs, 'hold');
end $function$;

/* A Root or a Tether, and for how long. */
CREATE OR REPLACE FUNCTION public.class_leash(p_world uuid, p_id integer, p_kind text, p_reach double precision, p_secs double precision, p_by uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare c creature; v_x double precision; v_y double precision;
begin
  select * into c from creature where world_id = p_world and id = p_id and health > 0;
  if c.id is null then return; end if;
  v_x := creature_x(c); v_y := creature_y(c);
  update creature set from_x = v_x, from_y = v_y, to_x = v_x, to_y = v_y, leg_at = now(), leg_ends = now()
   where world_id = p_world and id = p_id;
  insert into class_mark (world_id, creature_id, kind, val, until, by_uid, x, y)
    values (p_world, p_id, p_kind, p_reach, now() + make_interval(secs => p_secs), p_by, v_x, v_y)
    on conflict (world_id, creature_id, kind) do update
      set val = excluded.val, until = excluded.until, by_uid = excluded.by_uid, x = excluded.x, y = excluded.y;
  perform fx_beast(p_id, p_secs, p_kind);
end $function$;

/* A Brittle, a Heavy Limbs, a Dull Claws, and for how long. */
CREATE OR REPLACE FUNCTION public.class_mark_put(p_world uuid, p_id integer, p_kind text, p_val double precision, p_secs double precision, p_by uuid)
 RETURNS void
 LANGUAGE sql
AS $function$
  insert into class_mark (world_id, creature_id, kind, val, until, by_uid)
    values (p_world, p_id, p_kind, p_val, now() + make_interval(secs => p_secs), p_by)
    on conflict (world_id, creature_id, kind) do update
      set val = excluded.val, until = greatest(class_mark.until, excluded.until), by_uid = excluded.by_uid;
  select fx_beast(p_id, p_secs, p_kind);
$function$;

/* A creature put to flight, and for how long: a Fright, a Panic (a monster for its own seconds), an Abyssal Gaze. */
CREATE OR REPLACE FUNCTION public.faith_flee(p_world uuid, p_id integer, p_fx double precision, p_fy double precision, p_secs double precision)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
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
  perform fx_beast(p_id, p_secs, 'fright');
end $function$;

/* A Judgment's mark, and for how long. */
CREATE OR REPLACE FUNCTION public.faith_mark_put(p_world uuid, p_id integer, p_more double precision, p_secs double precision, p_by uuid)
 RETURNS void
 LANGUAGE sql
AS $function$
  insert into faith_mark (world_id, creature_id, more, until, by_uid)
  values (p_world, p_id, p_more, now() + make_interval(secs => p_secs), p_by)
  on conflict (world_id, creature_id) do update
    set more = case when faith_mark.until > now() then greatest(faith_mark.more, excluded.more) else excluded.more end,
        until = greatest(faith_mark.until, excluded.until), by_uid = excluded.by_uid;
  select fx_beast(p_id, p_secs, 'mark');
$function$;

/* A burn that took, for as long as it runs: longer for a Lingering Burn and inside a Firebrand. */
CREATE OR REPLACE FUNCTION public.class_burn(p_world uuid, p_uid uuid, p_id integer, p_each double precision, p_secs double precision)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare pl player; c creature; v_rate double precision; v_secs double precision;
begin
  select * into pl from player where world_id = p_world and uid = p_uid;
  select * into c from creature where world_id = p_world and id = p_id and health > 0;
  if c.id is null or pl.uid is null or p_each <= 0 or p_secs <= 0 or faith_truce(p_world, creature_x(c), creature_y(c)) then
    return null;
  end if;
  v_rate := max_health(c) * p_each * pk(pl.class_mul, 'burn:rate', 1);
  v_secs := p_secs * pk(pl.class_mul, 'burn:secs', 1)
    * case when (pl.blessings->'firebrand'->>'until')::timestamptz > now()
           then (pl.blessings->'firebrand'->>'long')::double precision else 1 end;
  update creature set bleed_rate = case when bleed_until > now() then greatest(coalesce(bleed_rate, 0), v_rate) else v_rate end,
      bleed_until = greatest(coalesce(bleed_until, now()), now() + make_interval(secs => v_secs))
    where world_id = p_world and id = p_id;
  insert into class_mark (world_id, creature_id, kind, val, until, by_uid)
    values (p_world, p_id, 'burn', v_rate, now() + make_interval(secs => v_secs), p_uid)
    on conflict (world_id, creature_id, kind) do update
      set val = case when class_mark.until > now() then greatest(class_mark.val, excluded.val) else excluded.val end,
          until = greatest(class_mark.until, excluded.until), by_uid = excluded.by_uid;
  perform fx_beast(p_id, v_secs, 'burn');
  return jsonb_build_object('each', v_rate / max_health(c), 'secs', v_secs);
end $function$;

/* Something laid on somebody for a while (a Rally's neighbour is not one; a Bastion of Stone is), and for how long. */
CREATE OR REPLACE FUNCTION public.blessing_put(p_world uuid, p_uid uuid, p_key text, p_blessing jsonb)
 RETURNS void
 LANGUAGE sql
AS $function$
  update player set blessings = coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(coalesce(blessings, '{}'::jsonb)) e
                                       where (e.value->>'until')::timestamptz > now()), '{}'::jsonb)
                            || jsonb_build_object(p_key, p_blessing)
   where world_id = p_world and uid = p_uid;
  select fx_person(p_uid, extract(epoch from (p_blessing->>'until')::timestamptz - now())::double precision);
$function$;

/* A skin laid over somebody, and how large: the largest a cast laid is its `size`. */
CREATE OR REPLACE FUNCTION public.warder_skin_put(p_world uuid, p_by uuid, p_on uuid, p_size double precision)
 RETURNS double precision
 LANGUAGE plpgsql
AS $function$
declare v_was double precision; v_now double precision;
begin
  select coalesce((stats->>'aegis')::double precision, 0) into v_was from player where world_id = p_world and uid = p_on;
  if not found then return 0; end if;
  v_now := warder_skin_after(p_world, p_by, p_on, p_size);
  if v_now > v_was then
    update player set stats = coalesce(stats, '{}'::jsonb) || jsonb_build_object('aegis', v_now, 'aegisBy', p_by)
     where world_id = p_world and uid = p_on;
    perform fx_person(p_on);
    perform fx_size(p_size);
  end if;
  return greatest(v_now, v_was);
end $function$;

/* Health given back to somebody: told to a cast when there was any to give. */
CREATE OR REPLACE FUNCTION public.class_heal(p_world uuid, p_uid uuid, p_share double precision)
 RETURNS double precision
 LANGUAGE plpgsql
AS $function$
declare hp double precision;
begin
  select coalesce((stats->>'health')::double precision, 1) into hp from player where world_id = p_world and uid = p_uid for update;
  if hp is null then return 0; end if;
  update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{health}', to_jsonb(least(1, hp + p_share)))
    where world_id = p_world and uid = p_uid;
  if least(1, hp + p_share) > hp then perform fx_person(p_uid); end if;
  return least(1, hp + p_share) - hp;
end $function$;

/* Health given back to somebody: told to a cast when there was any to give. */
CREATE OR REPLACE FUNCTION public.faith_heal(p_world uuid, p_uid uuid, p_share double precision)
 RETURNS double precision
 LANGUAGE plpgsql
AS $function$
declare v_h double precision;
begin
  select coalesce((stats->>'health')::double precision, 1) into v_h from player where world_id = p_world and uid = p_uid for update;
  if not found or p_share <= 0 then return 0; end if;
  update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{health}', to_jsonb(least(1, v_h + p_share)))
   where world_id = p_world and uid = p_uid;
  if least(1, v_h + p_share) > v_h then perform fx_person(p_uid); end if;
  return least(1, v_h + p_share) - v_h;
end $function$;

/* And a wound mended or stopped bleeding. */
CREATE OR REPLACE FUNCTION public.faith_mend(p_world uuid, p_uid uuid, p_share double precision, p_all boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
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
  if least(1, hp + p_share) > hp or v_stopped > 0 then perform fx_person(p_uid); end if;
  return jsonb_build_object('healed', least(1, hp + p_share) - hp, 'stopped', v_stopped);
end $function$;

/* And a creature tended: a Tend, a Benediction over a wildermon. */
CREATE OR REPLACE FUNCTION public.faith_tend(p_world uuid, p_id integer, p_share double precision)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
declare c creature; v_top double precision;
begin
  perform creature_settle(p_world, p_id);
  select * into c from creature where world_id = p_world and id = p_id for update;
  if not found then return false; end if;
  v_top := max_health(c);
  if c.health >= v_top and c.bleed_until is null then return false; end if;
  update creature set health = least(v_top, health + v_top * p_share), bleed_until = null, bleed_rate = null
    where world_id = p_world and id = p_id;
  perform fx_beast(p_id);
  return true;
end $function$;

/* A Ward Link firing: the Warder's browser is told, as well as the line it was always told. */
CREATE OR REPLACE FUNCTION public.warder_skin_spent(p_world uuid, p_uid uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare p player; l player; v_by uuid; v_link jsonb; v_size double precision;
begin
  select * into p from player where world_id = p_world and uid = p_uid;
  if p.uid is null then return; end if;
  if pk(p.class_mul, 'stamina:skin', 0) > 0 then
    update player set stats = jsonb_set(stats, '{stamina}',
        to_jsonb(least(1, coalesce((stats->>'stamina')::double precision, 1) + pk(p.class_mul, 'stamina:skin', 0))))
     where world_id = p_world and uid = p_uid;
    perform tell(p_world, p_uid, (select name from class_perk where id = 'warder_second_wind') || ': you get back '
      || faith_pct(pk(p.class_mul, 'stamina:skin', 0)) || ' of your stamina.', 'fight');
  end if;
  if coalesce(p.stats->>'aegisBy', '') !~ '^[0-9a-f-]{36}$' then return; end if;
  v_by := (p.stats->>'aegisBy')::uuid;
  if v_by = p_uid then return; end if;
  select * into l from player where world_id = p_world and uid = v_by and not away;
  v_link := l.blessings->'ward_link';
  if l.uid is null or v_link is null or (v_link->>'until')::timestamptz <= now()
     or coalesce(v_link->'done', '[]'::jsonb) ? p_uid::text
     or (l.x - p.x) ^ 2 + (l.y - p.y) ^ 2 > (v_link->>'reach')::double precision ^ 2 then
    return;
  end if;
  v_size := warder_skin_size(p_world, v_by, p_uid, warder_skin_at(p_world, v_by) * (v_link->>'skin')::double precision, 1);
  perform warder_skin_put(p_world, v_by, p_uid, v_size);
  update player set blessings = jsonb_set(blessings, '{ward_link,done}',
      coalesce(blessings->'ward_link'->'done', '[]'::jsonb) || to_jsonb(p_uid::text))
   where world_id = p_world and uid = v_by;
  perform tell(p_world, p_uid, l.name || '''s ' || (select name from class_spell where id = 'warder_ward_link')
    || ': a skin of ' || faith_pct(v_size) || ' goes back over you.', 'fight');
  -- And to the Warder's browser, for the skin to be drawn going back over them where it does (`fx_fired`).
  perform fx_fired(p_world, v_by, 'warder_ward_link', p_uid, v_size);
  perform tell(p_world, v_by, (select name from class_spell where id = 'warder_ward_link') || ': a skin of ' || faith_pct(v_size)
    || ' goes back over ' || coalesce(p.name, 'them') || '.', 'fight');
end $function$;

/* A trade's spell, as it was, telling a cast what it did where that is done in the spell itself. */
CREATE OR REPLACE FUNCTION public.class_spell_cast(p_world uuid, p_uid uuid, p_spell text, p_target jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare s class_spell; me player; c creature; d species_def; b jsonb; v_said text; v_id int; r record;
        v_dist double precision; v_reach double precision; v_x double precision; v_y double precision;
        v_n int := 0; v_put jsonb; v_windup boolean; v_more double precision; v_h double precision;
        v_dead int := 0; v_held int := 0; v_i int; v_part text; v_on jsonb; v_pace jsonb;
        v_why text; v_uid uuid; v_who text; v_whose text; v_hp double precision;
        k creature; v_top double precision;
        v_fire double precision := 0; v_fired boolean := false; v_burn class_mark; v_burnt jsonb;
        v_was double precision; v_base double precision; v_self double precision; v_other double precision;
        v_mine boolean := false; v_hunted boolean := false;
begin
  select * into s from class_spell where id = p_spell;
  if not found then return jsonb_build_object('why', 'There is no such spell.'); end if;
  select * into me from player where world_id = p_world and uid = p_uid;
  if p_target->>'kind' = 'enemy' then
    v_id := (p_target->>'id')::int;
    perform creature_settle(p_world, v_id);
    select * into c from creature where world_id = p_world and id = v_id and health > 0;
    if not found then return jsonb_build_object('why', 'That is not here.'); end if;
    select * into d from species_def where id = c.species;
    v_dist := sqrt((creature_x(c) - me.x) ^ 2 + (creature_y(c) - me.y) ^ 2);
    -- A blow wants it within reach of what is in your hand; a Lunge within its stride; a Challenge as far as any spell;
    -- an Overreach its share past your reach, and a Hook as far as it says.
    v_reach := case when p_spell = 'blade_lunge' then spell_fx(p_spell, 'reach')
                    when p_spell = 'blade_challenge' then spell_reach()
                    when p_spell = 'pikeman_overreach' then melee_reach(p_world, p_uid) + spell_fx(p_spell, 'past')
                    when p_spell = 'pikeman_hook' then spell_fx(p_spell, 'reach')
                    -- A Point Blank close in, an Expose as far as any spell, and every other shot as far as the bow in your hands
                    -- reaches (`bow_range`), a Long Shot its share further.
                    when p_spell = 'archer_point_blank' then spell_fx(p_spell, 'reach')
                    when p_spell = 'archer_expose' then spell_reach()
                    -- A Long Throw its share past your reach, and a Marked for Death as far as any spell.
                    when p_spell = 'skirmisher_long_throw' then melee_reach(p_world, p_uid) + spell_fx(p_spell, 'past')
                    when p_spell = 'skirmisher_marked_for_death' then spell_reach()
                    -- A Toxin as far as it says.
                    when p_spell = 'chirurgeon_toxin' then spell_fx(p_spell, 'reach')
                    -- A Beastmaster's companion strikes from its own reach of it, which its arm asks: you as far as any spell;
                    -- and a Call of the Wild as far as it says.
                    when p_spell = 'beastmaster_call_of_the_wild' then spell_fx(p_spell, 'reach')
                    when s.class = 'beastmaster' then spell_reach()
                    -- A Kindler's as far as each says.
                    when s.class = 'kindler' then spell_fx(p_spell, 'reach')
                    -- A Binder's as far as each says, further for Far Reach, and further again in a Long Hold.
                    when s.class = 'binder' then (spell_fx(p_spell, 'reach') + pk(me.class_mul, 'reach:spell', 0))
                                                 * class_mul(me.class_mul, 'reach', 'binding')
                    when s.needs = 'archery' then held_bow_range(p_world, p_uid)
                                                  * case when p_spell = 'archer_long_shot' then spell_fx(p_spell, 'range') else 1 end
                    else melee_reach(p_world, p_uid) end;
    if v_dist > v_reach then
      return jsonb_build_object('why', 'The ' || lower(d.name) || ' is more than ' || trim_scale(round(v_reach::numeric, 1)) || ' tiles away.');
    end if;
    -- And a shot no nearer than a draw can be made (`draw_nearest`), but for a Point Blank.
    if s.needs = 'archery' and p_spell <> 'archer_point_blank' and v_dist < draw_nearest(p_world, p_uid) then
      return jsonb_build_object('why', 'The ' || lower(d.name) || ' is too close to draw on.');
    end if;
  end if;

  case p_spell
  when 'blade_measured_cut' then
    b := class_blow(p_world, p_uid, c.id, spell_fx(p_spell, 'more'), true);
    v_said := class_blow_said(s.name, b);

  when 'blade_challenge' then
    if coalesce(d.timid, false) then return jsonb_build_object('why', 'The ' || lower(d.name) || ' will not fight anybody.'); end if;
    update creature set hunting = p_uid, brawl = null, windup_at = null, hunt_again = null,
        hunt_x = creature_x(c), hunt_y = creature_y(c),
        threat_at = now() + make_interval(secs => spell_fx(p_spell, 'secs') - threat_hold())
      where world_id = p_world and id = c.id;
    v_said := s.name || ': the ' || lower(d.name) || ' turns on you, and hunts only you for ' || faith_span(spell_fx(p_spell, 'secs')) || '.';

  when 'blade_lunge' then
    if me.aboard is not null or (driving(p_world, p_uid)).id is not null then
      return jsonb_build_object('why', 'You cannot lunge from where you sit.');
    end if;
    v_reach := melee_reach(p_world, p_uid);
    if v_dist > v_reach then
      -- To a pace inside your reach of it, over ground you could walk there (`walk_share`, as `rpc_move` asks).
      v_x := creature_x(c) - (creature_x(c) - me.x) / v_dist * (v_reach - 0.4);
      v_y := creature_y(c) - (creature_y(c) - me.y) / v_dist * (v_reach - 0.4);
      if walk_share(p_world, p_uid, coalesce(me.level, 0), me.x, me.y, v_x, v_y) < 0.999 then
        return jsonb_build_object('why', 'Something stands between you and the ' || lower(d.name) || '.');
      end if;
      update player set x = v_x, y = v_y, moved_at = now() where world_id = p_world and uid = p_uid;
      perform drag_along(p_world, p_uid, v_x, v_y);
      v_put := jsonb_build_object('x', v_x, 'y', v_y, 'level', coalesce(me.level, 0));
    end if;
    b := class_blow(p_world, p_uid, c.id, spell_fx(p_spell, 'more'));
    v_said := class_blow_said(s.name, b);

  when 'blade_hamstring' then
    b := class_blow(p_world, p_uid, c.id, spell_fx(p_spell, 'more'));
    if (b->>'landed')::boolean and not (b->>'died')::boolean then
      update creature set slow = spell_fx(p_spell, 'pace'), slow_until = now() + make_interval(secs => spell_fx(p_spell, 'secs'))
        where world_id = p_world and id = c.id;
      perform fx_beast(c.id, spell_fx(p_spell, 'secs'), 'slow');
      v_said := class_blow_said(s.name, b) || ' For ' || faith_span(spell_fx(p_spell, 'secs')) || ' it goes at '
        || faith_pct(spell_fx(p_spell, 'pace')) || ' of its pace.';
    else
      v_said := class_blow_said(s.name, b);
    end if;

  when 'blade_shield_bash' then
    v_windup := c.windup_at is not null;
    b := class_blow(p_world, p_uid, c.id, spell_fx(p_spell, 'more'), false, 'crush');
    v_said := class_blow_said(s.name, b);
    if (b->>'landed')::boolean and not (b->>'died')::boolean then
      update creature set windup_at = null, until = greatest(until, now()) + make_interval(secs => spell_fx(p_spell, 'back'))
        where world_id = p_world and id = c.id;
      v_said := v_said || case when v_windup then ' It is knocked off its stroke, and' else ' Its' end
        || case when v_windup then ' its' else '' end || ' next blow is put back ' || faith_span(spell_fx(p_spell, 'back')) || '.';
    end if;

  when 'blade_second_breath' then
    update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}',
        to_jsonb(least(1, coalesce((stats->>'stamina')::double precision, 1) + spell_fx(p_spell, 'stamina'))))
      where world_id = p_world and uid = p_uid;
    v_said := s.name || ': ' || faith_pct(spell_fx(p_spell, 'stamina')) || ' of your stamina comes back at once.';

  when 'blade_deflect' then
    perform blessing_put(p_world, p_uid, 'deflect', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'share', spell_fx(p_spell, 'share')));
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' every blow you block lands back at '
      || faith_pct(spell_fx(p_spell, 'share')) || ' of itself.';

  when 'blade_hold_the_line' then
    perform blessing_put(p_world, p_uid, 'hold_line', jsonb_build_object('from', now(),
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'bleed', spell_fx(p_spell, 'bleed')));
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' your wounds bleed '
      || faith_pct(1 - spell_fx(p_spell, 'bleed')) || ' less and those on your arms do not slow your swing.';

  when 'blade_disarming_cut' then
    b := class_blow(p_world, p_uid, c.id, spell_fx(p_spell, 'more'));
    v_said := class_blow_said(s.name, b);
    if (b->>'landed')::boolean and not (b->>'died')::boolean then
      insert into class_mark (world_id, creature_id, kind, val, n, until, by_uid)
        values (p_world, c.id, 'disarm', spell_fx(p_spell, 'cut'), spell_fx(p_spell, 'blows')::int,
                now() + make_interval(secs => spell_fx(p_spell, 'secs')), p_uid)
        on conflict (world_id, creature_id, kind) do update set val = excluded.val, n = excluded.n, until = excluded.until, by_uid = excluded.by_uid;
      perform fx_beast(c.id, spell_fx(p_spell, 'secs'), 'disarm');
      v_said := v_said || ' Its next ' || spell_fx(p_spell, 'blows')::int || ' blows do ' || faith_pct(spell_fx(p_spell, 'cut')) || ' less.';
    end if;

  when 'blade_measured_breathing' then
    perform blessing_put(p_world, p_uid, 'breathing', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs'))));
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' a swing or a draw costs you no stamina.';

  when 'blade_guardians_call' then
    for r in
      select cr.id, cr.species from creature cr join species_def sd on sd.id = cr.species
       where cr.world_id = p_world and cr.mode = 'wild' and cr.health > 0
         and (cr.hunting is not null or cr.brawl is not null) and not coalesce(sd.timid, false)
         and (creature_x(cr) - me.x) ^ 2 + (creature_y(cr) - me.y) ^ 2 <= spell_fx(p_spell, 'reach') ^ 2
    loop
      perform creature_settle(p_world, r.id);
      update creature set hunting = p_uid, brawl = null, windup_at = null, hunt_again = null,
          hunt_x = creature_x(creature), hunt_y = creature_y(creature),
          threat_at = now() + make_interval(secs => spell_fx(p_spell, 'secs') - threat_hold())
        where world_id = p_world and id = r.id;
      v_n := v_n + 1;
    end loop;
    if v_n = 0 then
      return jsonb_build_object('why', 'Nothing within ' || spell_fx(p_spell, 'reach')::int || ' tiles of you is hunting anybody.');
    end if;
    v_said := s.name || ': ' || v_n || case when v_n = 1 then ' creature turns' else ' creatures turn' end
      || ' on you, and hunt' || case when v_n = 1 then 's' else '' end || ' only you for ' || faith_span(spell_fx(p_spell, 'secs')) || '.';

  when 'blade_last_stand' then
    perform blessing_put(p_world, p_uid, 'last_stand', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'cut', spell_fx(p_spell, 'cut')));
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' you take ' || faith_pct(spell_fx(p_spell, 'cut')) || ' less damage.';

  when 'berserker_wild_swing' then
    b := class_blow(p_world, p_uid, c.id, spell_fx(p_spell, 'more'), false, null, spell_fx(p_spell, 'miss'));
    v_said := class_blow_said(s.name, b);

  when 'berserker_shrug_it_off' then
    -- The worst wound you carry, by how deep it is: its share as deep, and bleeding no more.
    select (e.i - 1)::int, e.w->>'part' into v_i, v_part
      from jsonb_array_elements(coalesce(me.wounds, '[]'::jsonb)) with ordinality e(w, i)
     order by (e.w->>'severity')::double precision desc nulls last limit 1;
    if v_i is null then return jsonb_build_object('why', 'You have no wound to shrug off.'); end if;
    update player set wounds = jsonb_set(jsonb_set(wounds, array[v_i::text, 'severity'],
          to_jsonb((wounds->v_i->>'severity')::double precision * spell_fx(p_spell, 'severity'))),
          array[v_i::text, 'bleeding'], 'false'::jsonb)
      where world_id = p_world and uid = p_uid;
    v_said := s.name || ': the worst of your wounds, on your ' || part_name(v_part) || ', is '
      || faith_pct(1 - spell_fx(p_spell, 'severity')) || ' less severe and stops bleeding.';

  when 'berserker_rending_chop' then
    b := class_blow(p_world, p_uid, c.id, spell_fx(p_spell, 'more'));
    v_said := class_blow_said(s.name, b);
    -- And it bleeds as a knife leaves it (`side_blow`).
    if (b->>'landed')::boolean and not (b->>'died')::boolean then
      perform side_blow(p_world, p_uid, c.id, 'knives', (b->>'dmg')::double precision);
      v_said := v_said || ' It bleeds ' || faith_pct(knife_bleed()) || ' of the blow a second for ' || faith_span(knife_bleed_secs()) || '.';
    end if;

  when 'berserker_skull_crack' then
    b := class_blow(p_world, p_uid, c.id, spell_fx(p_spell, 'more'));
    v_said := class_blow_said(s.name, b);
    if (b->>'landed')::boolean and not (b->>'died')::boolean then
      v_h := spell_fx(p_spell, 'hold') * case when coalesce(d.monster, false) then spell_fx(p_spell, 'monster') else 1 end;
      perform class_hold(p_world, c.id, v_h);
      v_said := v_said || ' It is held where it stands for ' || faith_span(v_h) || '.';
    end if;

  when 'berserker_battle_rage' then
    perform blessing_put(p_world, p_uid, 'battle_rage', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')),
      'dealt', spell_fx(p_spell, 'dealt'), 'taken', spell_fx(p_spell, 'taken')));
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' you deal ' || faith_pct(spell_fx(p_spell, 'dealt') - 1)
      || ' more damage and take ' || faith_pct(spell_fx(p_spell, 'taken') - 1) || ' more.';

  when 'berserker_adrenaline' then
    perform blessing_put(p_world, p_uid, 'adrenaline', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'time', spell_fx(p_spell, 'time')));
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' a swing or a draw costs no stamina and takes '
      || faith_pct(1 - spell_fx(p_spell, 'time')) || ' less time.';

  when 'berserker_blood_price' then
    -- Paid in your own health before the blow, whether it lands or not; `spell_cast_refusal` keeps it from being the last of it.
    update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{health}',
        to_jsonb(coalesce((stats->>'health')::double precision, 1) - spell_fx(p_spell, 'health')))
      where world_id = p_world and uid = p_uid;
    b := class_blow(p_world, p_uid, c.id, spell_fx(p_spell, 'more'));
    v_said := class_blow_said(s.name, b) || ' It costs you ' || faith_pct(spell_fx(p_spell, 'health')) || ' of your health.';

  when 'berserker_execute' then
    -- Its full share on a creature below its line, and the rest of the time a plain blow.
    v_more := case when c.health < max_health(c) * spell_fx(p_spell, 'low') then spell_fx(p_spell, 'more') else spell_fx(p_spell, 'whole') end;
    if c.health < max_health(c) * spell_fx(p_spell, 'low') then perform fx_set('low', 'true'::jsonb); end if;
    b := class_blow(p_world, p_uid, c.id, v_more);
    v_said := class_blow_said(s.name, b);

  when 'berserker_overhead_smash' then
    b := class_blow(p_world, p_uid, c.id, spell_fx(p_spell, 'more'), true, 'crush');
    v_said := class_blow_said(s.name, b);
    -- And the wind-up is paid after: your own next swing, if you are swinging, comes that much later.
    update player set act_ends = act_ends + make_interval(secs => spell_fx(p_spell, 'wind'))
      where world_id = p_world and uid = p_uid and is_fight(act) and act_ends is not null;
    if found then v_said := v_said || ' Your next swing comes ' || faith_span(spell_fx(p_spell, 'wind')) || ' later.'; end if;

  when 'berserker_whirlwind' then
    -- Every wild thing within its reach, nearest first, its blows each until one kills it.
    for r in
      select cr.id from creature cr
       where cr.world_id = p_world and cr.mode = 'wild' and cr.health > 0
         and (creature_x(cr) - me.x) ^ 2 + (creature_y(cr) - me.y) ^ 2 <= spell_fx(p_spell, 'reach') ^ 2
       order by (creature_x(cr) - me.x) ^ 2 + (creature_y(cr) - me.y) ^ 2, cr.id
    loop
      perform creature_settle(p_world, r.id);
      v_n := v_n + 1;
      for v_go in 1 .. spell_fx(p_spell, 'blows')::int loop
        b := class_blow(p_world, p_uid, r.id, spell_fx(p_spell, 'more'));
        if (b->>'died')::boolean then v_dead := v_dead + 1; exit; end if;
      end loop;
    end loop;
    if v_n = 0 then
      return jsonb_build_object('why', 'Nothing is within ' || spell_fx(p_spell, 'reach')::int || ' tiles of you to strike.');
    end if;
    b := null;
    v_said := s.name || ': you strike at ' || v_n || case when v_n = 1 then ' creature' else ' creatures' end
      || case when v_dead > 0 then ', and ' || v_dead || case when v_dead = 1 then ' dies' else ' die' end else '' end || '.';

  when 'berserker_earthshaker' then
    -- Every wild thing within its reach takes the blow, and each one it leaves standing is held.
    for r in
      select cr.id from creature cr
       where cr.world_id = p_world and cr.mode = 'wild' and cr.health > 0
         and (creature_x(cr) - me.x) ^ 2 + (creature_y(cr) - me.y) ^ 2 <= spell_fx(p_spell, 'reach') ^ 2
       order by (creature_x(cr) - me.x) ^ 2 + (creature_y(cr) - me.y) ^ 2, cr.id
    loop
      perform creature_settle(p_world, r.id);
      v_n := v_n + 1;
      b := class_blow(p_world, p_uid, r.id, spell_fx(p_spell, 'more'));
      if (b->>'died')::boolean then v_dead := v_dead + 1;
      elsif (b->>'landed')::boolean then
        perform class_hold(p_world, r.id, spell_fx(p_spell, 'hold'));
        v_held := v_held + 1;
      end if;
    end loop;
    if v_n = 0 then
      return jsonb_build_object('why', 'Nothing is within ' || spell_fx(p_spell, 'reach')::int || ' tiles of you to strike.');
    end if;
    b := null;
    v_said := s.name || ': you strike at ' || v_n || case when v_n = 1 then ' creature' else ' creatures' end
      || '; ' || v_held || ' held where ' || case when v_held = 1 then 'it stands' else 'they stand' end
      || ' for ' || faith_span(spell_fx(p_spell, 'hold'))
      || case when v_dead > 0 then ', and ' || v_dead || case when v_dead = 1 then ' dies' else ' die' end else '' end || '.';

  when 'berserker_last_rage' then
    perform blessing_put(p_world, p_uid, 'last_rage', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs'))));
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' every blow you land is critical.';

  when 'pikeman_warning_thrust' then
    -- Not on one already on you, nor on one that never goes looking for a fight (`hunt_settle` asks the mark).
    if c.hunting is not distinct from p_uid then
      return jsonb_build_object('why', 'The ' || lower(d.name) || ' is already fighting you.');
    end if;
    if not coalesce(d.hunter, false) then
      return jsonb_build_object('why', 'The ' || lower(d.name) || ' never comes for anybody unless it is struck.');
    end if;
    insert into class_mark (world_id, creature_id, kind, val, n, until, by_uid)
      values (p_world, c.id, 'warned', 1, 0, now() + make_interval(secs => spell_fx(p_spell, 'secs')), p_uid)
      on conflict (world_id, creature_id, kind) do update set val = excluded.val, n = excluded.n, until = excluded.until, by_uid = excluded.by_uid;
    perform fx_beast(c.id, spell_fx(p_spell, 'secs'), 'warned');
    v_said := s.name || ': the ' || lower(d.name) || ' will not come for you for ' || faith_span(spell_fx(p_spell, 'secs'))
      || ', alone or with its pack, unless you strike it.';

  when 'pikeman_overreach' then
    b := class_blow(p_world, p_uid, c.id, spell_fx(p_spell, 'more'));
    v_said := class_blow_said(s.name, b);
    -- And the reach is paid for after: your own next swing, if you are swinging, comes that much later.
    update player set act_ends = act_ends + make_interval(secs => spell_fx(p_spell, 'wind'))
      where world_id = p_world and uid = p_uid and is_fight(act) and act_ends is not null;
    if found then v_said := v_said || ' Your next swing comes ' || faith_span(spell_fx(p_spell, 'wind')) || ' later.'; end if;

  when 'pikeman_sweep_the_legs' then
    b := class_blow(p_world, p_uid, c.id, spell_fx(p_spell, 'more'));
    if (b->>'landed')::boolean and not (b->>'died')::boolean then
      update creature set slow = spell_fx(p_spell, 'pace'), slow_until = now() + make_interval(secs => spell_fx(p_spell, 'secs'))
        where world_id = p_world and id = c.id;
      perform fx_beast(c.id, spell_fx(p_spell, 'secs'), 'slow');
      v_said := class_blow_said(s.name, b) || ' For ' || faith_span(spell_fx(p_spell, 'secs')) || ' it goes at '
        || faith_pct(spell_fx(p_spell, 'pace')) || ' of its pace.';
    else
      v_said := class_blow_said(s.name, b);
    end if;

  when 'pikeman_vital_thrust' then
    b := class_blow(p_world, p_uid, c.id, spell_fx(p_spell, 'more'), false, null, 1, spell_fx(p_spell, 'crit'));
    v_said := class_blow_said(s.name, b);

  when 'pikeman_hook' then
    -- Dragged its share nearer and no nearer than its least, over ground it could walk (`class_shove`), and on you as if struck.
    if v_dist <= spell_fx(p_spell, 'least') + 0.05 then
      return jsonb_build_object('why', 'The ' || lower(d.name) || ' is already at your feet.');
    end if;
    if not exists (select 1 from shove_point(p_world, creature_x(c), creature_y(c), me.x, me.y,
                     -spell_fx(p_spell, 'pull'), spell_fx(p_spell, 'least'))) then
      return jsonb_build_object('why', 'The ' || lower(d.name) || ' cannot be dragged: there is no ground it could walk between you.');
    end if;
    perform engage_beast(p_world, c.id, p_uid);
    v_h := class_shove(p_world, c.id, me.x, me.y, -spell_fx(p_spell, 'pull'), spell_fx(p_spell, 'least'));
    v_said := s.name || ': you drag the ' || lower(d.name) || ' ' || trim_scale(round(v_h::numeric, 1))
      || case when round(v_h::numeric, 1) = 1 then ' tile' else ' tiles' end || ' towards you.';

  when 'pikeman_rally_the_line' then
    -- Everybody on their feet within its reach, you among them; the door takes its stamina after.
    for r in
      select pl.uid from player pl
       where pl.world_id = p_world and not coalesce(pl.away, false) and coalesce((pl.stats->>'health')::double precision, 1) > 0
         and (pl.x - me.x) ^ 2 + (pl.y - me.y) ^ 2 <= spell_fx(p_spell, 'reach') ^ 2
    loop
      update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}',
          to_jsonb(least(1, coalesce((stats->>'stamina')::double precision, 1) + spell_fx(p_spell, 'stamina'))))
        where world_id = p_world and uid = r.uid;
      perform fx_person(r.uid);
      if r.uid <> p_uid then
        perform tell(p_world, r.uid, coalesce(me.name, 'Somebody') || '’s ' || s.name || ' gives you back '
          || faith_pct(spell_fx(p_spell, 'stamina')) || ' of your stamina.', 'fight');
        v_n := v_n + 1;
      end if;
    end loop;
    v_said := s.name || ': ' || faith_pct(spell_fx(p_spell, 'stamina')) || ' of a full bar of stamina back for you'
      || case when v_n = 0 then '' else ' and ' || v_n || case when v_n = 1 then ' other' else ' others' end end || '.';

  when 'pikeman_twin_thrust' then
    -- Its blows one after the other, until one kills it.
    for v_go in 1 .. spell_fx(p_spell, 'blows')::int loop
      b := class_blow(p_world, p_uid, c.id, spell_fx(p_spell, 'more'));
      v_held := v_held + 1;
      if (b->>'landed')::boolean then v_n := v_n + 1; end if;
      exit when (b->>'died')::boolean;
    end loop;
    v_said := s.name || ': ' || v_n || ' of ' || v_held || ' blows land'
      || case when (b->>'died')::boolean then ', and the ' || (b->>'name') || ' dies.'
              else '. The ' || (b->>'name') || ' is down to ' || (b->>'left') || ' of ' || (b->>'of') || '.' end;

  when 'pikeman_reach_advantage' then
    -- Its full share on a creature not yet within its own reach of you (`beast_reach`), and a plain blow on one that is.
    v_more := case when v_dist > beast_reach(d) then spell_fx(p_spell, 'more') else spell_fx(p_spell, 'whole') end;
    b := class_blow(p_world, p_uid, c.id, v_more);
    v_said := class_blow_said(s.name, b);

  when 'pikeman_skewer' then
    b := class_blow(p_world, p_uid, c.id, spell_fx(p_spell, 'more'));
    v_said := class_blow_said(s.name, b);
    -- And through: every enemy up to `behind` tiles behind it, within `width` of the line of the thrust, at its own share.
    v_x := (creature_x(c) - me.x) / greatest(v_dist, 0.001); v_y := (creature_y(c) - me.y) / greatest(v_dist, 0.001);
    for r in
      select cr.id from creature cr
       where cr.world_id = p_world and cr.mode = 'wild' and cr.health > 0 and cr.id <> c.id
         and (creature_x(cr) - creature_x(c)) * v_x + (creature_y(cr) - creature_y(c)) * v_y > 0
         and (creature_x(cr) - creature_x(c)) * v_x + (creature_y(cr) - creature_y(c)) * v_y <= spell_fx(p_spell, 'behind')
         and abs((creature_x(cr) - creature_x(c)) * v_y - (creature_y(cr) - creature_y(c)) * v_x) <= spell_fx(p_spell, 'width')
       order by (creature_x(cr) - creature_x(c)) * v_x + (creature_y(cr) - creature_y(c)) * v_y, cr.id
    loop
      perform creature_settle(p_world, r.id);
      v_n := v_n + 1;
      if (class_blow(p_world, p_uid, r.id, spell_fx(p_spell, 'through'))->>'died')::boolean then v_dead := v_dead + 1; end if;
    end loop;
    if v_n > 0 then
      v_said := v_said || ' It goes through into ' || v_n || ' more behind'
        || case when v_dead > 0 then ', and ' || v_dead || case when v_dead = 1 then ' dies' else ' die' end else '' end || '.';
    end if;

  when 'pikeman_keep_away' then
    perform blessing_put(p_world, p_uid, 'keep_away', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'push', spell_fx(p_spell, 'push')));
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' every blow you land pushes what it lands on '
      || trim_scale(spell_fx(p_spell, 'push')::numeric) || case when spell_fx(p_spell, 'push') = 1 then ' tile' else ' tiles' end
      || ' further from you.';

  when 'pikeman_fend_off' then
    perform blessing_put(p_world, p_uid, 'fend_off', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'push', spell_fx(p_spell, 'push')));
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' anything that comes within '
      || trim_scale(hunt_reach()::numeric) || ' tiles of you to strike is pushed ' || trim_scale(spell_fx(p_spell, 'push')::numeric)
      || ' tiles back instead.';

  when 'pikeman_brace_for_the_charge' then
    perform blessing_put(p_world, p_uid, 'brace', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs'))));
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' the first creature that comes at you from outside your reach '
      || 'is met at the edge of it by a blow at ' || faith_pct(spell_fx(p_spell, 'more')) || '.';

  when 'archer_quick_shot' then
    b := class_shot(p_world, p_uid, c.id, spell_fx(p_spell, 'more'), false, 1, false, p_target->>'arrow');
    v_said := class_shot_said(s.name, b);
    -- And your own next draw, if you are drawing, comes that much sooner.
    update player set act_ends = greatest(now(), act_ends - make_interval(secs => spell_fx(p_spell, 'sooner')))
      where world_id = p_world and uid = p_uid and act = 'shoot_creature' and act_ends is not null;
    if found then v_said := v_said || ' Your next draw comes ' || faith_span(spell_fx(p_spell, 'sooner')) || ' sooner.'; end if;

  when 'archer_aimed_shot' then
    b := class_shot(p_world, p_uid, c.id, spell_fx(p_spell, 'more'), true, 1, false, p_target->>'arrow');
    v_said := class_shot_said(s.name, b);

  when 'archer_read_the_wind' then
    perform blessing_put(p_world, p_uid, 'read_wind', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'crit', spell_fx(p_spell, 'crit')));
    v_said := s.name || ': your next shot within ' || faith_span(spell_fx(p_spell, 'secs')) || ' cannot miss, and is critical '
      || case when spell_fx(p_spell, 'crit') = 2 then 'twice' else trim_scale(spell_fx(p_spell, 'crit')::numeric) || ' times' end
      || ' as often.';

  when 'archer_long_shot' then
    b := class_shot(p_world, p_uid, c.id, spell_fx(p_spell, 'more'), false, 1, true, p_target->>'arrow');
    v_said := class_shot_said(s.name, b);

  when 'archer_crippling_shot' then
    b := class_shot(p_world, p_uid, c.id, spell_fx(p_spell, 'more'), false, 1, false, p_target->>'arrow');
    v_said := class_shot_said(s.name, b);
    if (b->>'landed')::boolean and not (b->>'died')::boolean then
      update creature set slow = spell_fx(p_spell, 'pace'), slow_until = now() + make_interval(secs => spell_fx(p_spell, 'secs'))
        where world_id = p_world and id = c.id;
      perform fx_beast(c.id, spell_fx(p_spell, 'secs'), 'slow');
      v_said := v_said || ' For ' || faith_span(spell_fx(p_spell, 'secs')) || ' it goes at '
        || faith_pct(spell_fx(p_spell, 'pace')) || ' of its pace.';
    end if;

  when 'archer_point_blank' then
    b := class_shot(p_world, p_uid, c.id, spell_fx(p_spell, 'more'), false, 1, false, p_target->>'arrow');
    v_said := class_shot_said(s.name, b);

  when 'archer_twin_arrows' then
    -- Its arrows all at once, and every one of them in your pack first.
    if coalesce((select sum(pack_count(p_world, p_uid, idf.id)) from item_def idf where arrow_head_of(idf.id) is not null), 0)
       < spell_fx(p_spell, 'arrows') then
      return jsonb_build_object('why', s.name || ' wants ' || spell_fx(p_spell, 'arrows')::int || ' arrows in your pack.');
    end if;
    for v_go in 1 .. spell_fx(p_spell, 'arrows')::int loop
      b := class_shot(p_world, p_uid, c.id, spell_fx(p_spell, 'more'), false, 1, false, p_target->>'arrow');
      v_held := v_held + 1;
      if (b->>'landed')::boolean then v_n := v_n + 1; end if;
      exit when (b->>'died')::boolean;
    end loop;
    v_said := s.name || ': ' || v_n || ' of ' || v_held || ' arrows land'
      || case when (b->>'died')::boolean then ', and the ' || (b->>'name') || ' dies.'
              else '. The ' || (b->>'name') || ' is down to ' || (b->>'left') || ' of ' || (b->>'of') || '.' end;

  when 'archer_pinning_shot' then
    b := class_shot(p_world, p_uid, c.id, spell_fx(p_spell, 'more'), false, 1, false, p_target->>'arrow');
    v_said := class_shot_said(s.name, b);
    if (b->>'landed')::boolean and not (b->>'died')::boolean then
      v_h := spell_fx(p_spell, 'hold') * case when coalesce(d.monster, false) then spell_fx(p_spell, 'monster') else 1 end;
      perform class_hold(p_world, c.id, v_h);
      v_said := v_said || ' It is held where it stands for ' || faith_span(v_h) || '.';
    end if;

  when 'archer_expose' then
    -- On the creature, for every blow and shot anybody lands on it while it holds (`class_dealt`).
    insert into class_mark (world_id, creature_id, kind, val, n, until, by_uid)
      values (p_world, c.id, 'exposed', spell_fx(p_spell, 'more'), 0, now() + make_interval(secs => spell_fx(p_spell, 'secs')), p_uid)
      on conflict (world_id, creature_id, kind) do update set val = excluded.val, n = excluded.n, until = excluded.until, by_uid = excluded.by_uid;
    perform fx_beast(c.id, spell_fx(p_spell, 'secs'), 'exposed');
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' every blow and shot that lands on the ' || lower(d.name)
      || ' does ' || faith_pct(spell_fx(p_spell, 'more') - 1) || ' more.';

  when 'archer_decoy' then
    perform blessing_put(p_world, p_uid, 'decoy', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs'))));
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' everything that strikes at you strikes a decoy at your feet instead.';

  when 'archer_snipe' then
    -- Only on one that is not after anybody yet: not hunting, not in a brawl.
    if c.hunting is not null or c.brawl is not null then
      return jsonb_build_object('why', 'The ' || lower(d.name) || ' is already after somebody.');
    end if;
    b := class_shot(p_world, p_uid, c.id, spell_fx(p_spell, 'more'), false, 1, false, p_target->>'arrow');
    v_said := class_shot_said(s.name, b);

  when 'archer_deadeye' then
    perform blessing_put(p_world, p_uid, 'deadeye', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'time', spell_fx(p_spell, 'time')));
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' a draw takes '
      || faith_pct(1 - spell_fx(p_spell, 'time')) || ' less time.';

  when 'skirmisher_snap_throw' then
    b := class_blow(p_world, p_uid, c.id, spell_fx(p_spell, 'more'));
    v_said := class_blow_said(s.name, b);
    -- And your own next swing, if you are swinging, comes that much sooner.
    update player set act_ends = greatest(now(), act_ends - make_interval(secs => spell_fx(p_spell, 'sooner')))
      where world_id = p_world and uid = p_uid and act = 'attack_creature' and act_ends is not null;
    if found then v_said := v_said || ' Your next swing comes ' || faith_span(spell_fx(p_spell, 'sooner')) || ' sooner.'; end if;

  when 'skirmisher_long_throw' then
    b := class_blow(p_world, p_uid, c.id, spell_fx(p_spell, 'more'));
    v_said := class_blow_said(s.name, b);

  when 'skirmisher_hit_and_run' then
    b := class_blow(p_world, p_uid, c.id, spell_fx(p_spell, 'more'));
    -- And a quicker walk on foot while it holds (`travel_speed`), which the browser walks at too.
    perform blessing_put(p_world, p_uid, 'hit_and_run', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'pace', spell_fx(p_spell, 'pace')));
    v_pace := jsonb_build_object('mul', spell_fx(p_spell, 'pace'), 'secs', spell_fx(p_spell, 'secs'));
    v_said := class_blow_said(s.name, b) || ' For ' || faith_span(spell_fx(p_spell, 'secs')) || ' you walk '
      || faith_pct(spell_fx(p_spell, 'pace') - 1) || ' faster.';

  when 'skirmisher_heavy_throw' then
    b := class_blow(p_world, p_uid, c.id, spell_fx(p_spell, 'more'));
    v_said := class_blow_said(s.name, b);
    -- And what a maul does besides (`side_blow`): a heavy blow knocked off its stroke, and its next blow put back.
    if (b->>'landed')::boolean and not (b->>'died')::boolean then
      perform side_blow(p_world, p_uid, c.id, 'mauls', (b->>'dmg')::double precision);
      v_said := v_said || ' Its next blow is put back ' || faith_span(stagger_maul()) || '.';
    end if;

  when 'skirmisher_gut_throw' then
    b := class_blow(p_world, p_uid, c.id, spell_fx(p_spell, 'more'));
    v_said := class_blow_said(s.name, b);
    -- And what a knife does besides (`side_blow`): it bleeds.
    if (b->>'landed')::boolean and not (b->>'died')::boolean then
      perform side_blow(p_world, p_uid, c.id, 'knives', (b->>'dmg')::double precision);
      v_said := v_said || ' It bleeds for ' || faith_span(knife_bleed_secs() * pk(p_world, p_uid, 'bleed:secs', 1)) || '.';
    end if;

  when 'skirmisher_parting_throw' then
    if me.aboard is not null or (driving(p_world, p_uid)).id is not null then
      return jsonb_build_object('why', 'You cannot leap from where you sit.');
    end if;
    b := class_blow(p_world, p_uid, c.id, spell_fx(p_spell, 'more'));
    v_said := class_blow_said(s.name, b);
    -- Straight back from it, as far as ground you could walk lets you (`class_leap`).
    v_put := class_leap(p_world, p_uid, creature_x(c), creature_y(c), spell_fx(p_spell, 'leap'));
    v_said := v_said || case when v_put is null then ' There is no room behind you to leap.'
                             else ' You leap ' || trim_scale(round((v_put->>'by')::numeric, 2)) || ' tiles back.' end;

  when 'skirmisher_double_throw' then
    -- Its throws one after the other, until one kills it.
    for v_go in 1 .. spell_fx(p_spell, 'throws')::int loop
      b := class_blow(p_world, p_uid, c.id, spell_fx(p_spell, 'more'));
      v_held := v_held + 1;
      if (b->>'landed')::boolean then v_n := v_n + 1; end if;
      exit when (b->>'died')::boolean;
    end loop;
    v_said := s.name || ': ' || v_n || ' of ' || v_held || ' throws land'
      || case when (b->>'died')::boolean then ', and the ' || (b->>'name') || ' dies.'
              else '. The ' || (b->>'name') || ' is down to ' || (b->>'left') || ' of ' || (b->>'of') || '.' end;

  when 'skirmisher_ricochet' then
    b := class_blow(p_world, p_uid, c.id, spell_fx(p_spell, 'more'));
    v_said := class_blow_said(s.name, b);
    -- And on, when it lands, to the nearest other wild thing within its reach of the first.
    if (b->>'landed')::boolean then
      select cr.id into v_i from creature cr
       where cr.world_id = p_world and cr.mode = 'wild' and cr.health > 0 and cr.id <> c.id
         and (creature_x(cr) - creature_x(c)) ^ 2 + (creature_y(cr) - creature_y(c)) ^ 2 <= spell_fx(p_spell, 'reach') ^ 2
       order by (creature_x(cr) - creature_x(c)) ^ 2 + (creature_y(cr) - creature_y(c)) ^ 2, cr.id
       limit 1;
      if v_i is not null then
        perform creature_settle(p_world, v_i);
        v_on := class_blow(p_world, p_uid, v_i, spell_fx(p_spell, 'glance'));
        v_said := v_said || ' It glances on to the ' || (v_on->>'name')
          || case when not (v_on->>'landed')::boolean then ', and misses.'
                  when (v_on->>'died')::boolean then ', which dies.'
                  else ', which is down to ' || (v_on->>'left') || ' of ' || (v_on->>'of') || '.' end;
      end if;
    end if;

  when 'skirmisher_fan_of_blades' then
    -- The one you aim at, and every other wild thing within its reach of it, nearest first.
    for r in
      select cr.id from creature cr
       where cr.world_id = p_world and cr.mode = 'wild' and cr.health > 0
         and (cr.id = c.id or (creature_x(cr) - creature_x(c)) ^ 2 + (creature_y(cr) - creature_y(c)) ^ 2 <= spell_fx(p_spell, 'reach') ^ 2)
       order by cr.id <> c.id, (creature_x(cr) - creature_x(c)) ^ 2 + (creature_y(cr) - creature_y(c)) ^ 2, cr.id
    loop
      if r.id <> c.id then perform creature_settle(p_world, r.id); end if;
      v_n := v_n + 1;
      if (class_blow(p_world, p_uid, r.id, spell_fx(p_spell, 'more'))->>'died')::boolean then v_dead := v_dead + 1; end if;
    end loop;
    b := null;
    v_said := s.name || ': you throw at ' || v_n || case when v_n = 1 then ' creature' else ' creatures' end
      || case when v_dead > 0 then ', and ' || v_dead || case when v_dead = 1 then ' dies' else ' die' end else '' end || '.';

  when 'skirmisher_opportunist' then
    -- On every blow, throw and shot of yours on one fighting somebody else while it holds (`class_dealt`).
    perform blessing_put(p_world, p_uid, 'opportunist', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'dealt', spell_fx(p_spell, 'more')));
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' every blow, throw and shot of yours on a creature '
      || 'fighting somebody else does ' || faith_pct(spell_fx(p_spell, 'more') - 1) || ' more.';

  when 'skirmisher_fade' then
    -- Every wild thing hunting you loses you, and is warned off you for a while as a Pikeman's Warning Thrust warns one
    -- (`hunt_settle`): until you strike it.
    for r in select cr.id from creature cr where cr.world_id = p_world and cr.hunting = p_uid and cr.health > 0 order by cr.id loop
      perform creature_settle(p_world, r.id);
      update creature set hunting = null, windup_at = null where world_id = p_world and id = r.id and hunting = p_uid;
      if found then
        v_n := v_n + 1;
        insert into class_mark (world_id, creature_id, kind, val, n, until, by_uid)
          values (p_world, r.id, 'warned', 1, 0, now() + make_interval(secs => spell_fx(p_spell, 'secs')), p_uid)
          on conflict (world_id, creature_id, kind) do update set val = excluded.val, n = excluded.n, until = excluded.until,
            by_uid = excluded.by_uid;
        perform fx_beast(r.id, spell_fx(p_spell, 'secs'), 'warned');
      end if;
    end loop;
    if v_n = 0 then return jsonb_build_object('why', 'Nothing is hunting you.'); end if;
    v_said := s.name || ': ' || v_n || case when v_n = 1 then ' creature loses' else ' creatures lose' end
      || ' you, and will not come for you again for ' || faith_span(spell_fx(p_spell, 'secs')) || ' unless you strike '
      || case when v_n = 1 then 'it' else 'them' end || '.';

  when 'skirmisher_marked_for_death' then
    -- On the creature, for every blow, throw and shot anybody lands on it while it holds (`class_marked`).
    insert into class_mark (world_id, creature_id, kind, val, n, until, by_uid)
      values (p_world, c.id, 'marked', spell_fx(p_spell, 'crit'), 0, now() + make_interval(secs => spell_fx(p_spell, 'secs')), p_uid)
      on conflict (world_id, creature_id, kind) do update set val = excluded.val, n = excluded.n, until = excluded.until, by_uid = excluded.by_uid;
    perform fx_beast(c.id, spell_fx(p_spell, 'secs'), 'marked');
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' every blow, throw and shot that lands on the ' || lower(d.name)
      || ' is critical ' || case when spell_fx(p_spell, 'crit') = 2 then 'twice' else trim_scale(spell_fx(p_spell, 'crit')::numeric) || ' times' end
      || ' as often.';

  when 'chirurgeon_field_dressing' then
    v_why := class_person_why(p_world, p_uid, p_target, spell_fx(p_spell, 'reach'));
    if v_why is not null then return jsonb_build_object('why', v_why); end if;
    v_uid := (p_target->>'uid')::uuid;
    v_who := case when v_uid = p_uid then 'you' else (select name from player where world_id = p_world and uid = v_uid) end;
    v_whose := case when v_uid = p_uid then 'You are' else v_who || ' is' end;
    v_on := faith_mend(p_world, v_uid, spell_fx(p_spell, 'heal'), false);
    if (v_on->>'healed')::double precision <= 0 and (v_on->>'stopped')::int = 0 then
      return jsonb_build_object('why', v_whose || ' not hurt.');
    end if;
    perform class_learn_heal(p_world, p_uid, v_uid);
    v_said := s.name || ' heals ' || v_who || ' by ' || faith_pct(spell_fx(p_spell, 'heal'))
      || case when (v_on->>'stopped')::int > 0 then ' and stops a wound bleeding' else '' end || '.';

  when 'chirurgeon_quick_stitch' then
    v_why := class_person_why(p_world, p_uid, p_target, spell_fx(p_spell, 'reach'));
    if v_why is not null then return jsonb_build_object('why', v_why); end if;
    v_uid := (p_target->>'uid')::uuid;
    v_who := case when v_uid = p_uid then 'you' else (select name from player where world_id = p_world and uid = v_uid) end;
    v_whose := case when v_uid = p_uid then 'You are' else v_who || ' is' end;
    if class_wounds_close(p_world, v_uid, spell_fx(p_spell, 'close'), false, false) = 0 then
      return jsonb_build_object('why', case when v_uid = p_uid then 'You have' else v_who || ' has' end || ' no wound.');
    end if;
    perform class_learn_heal(p_world, p_uid, v_uid);
    v_said := s.name || ' closes the worst wound on ' || v_who || ' by ' || faith_pct(spell_fx(p_spell, 'close')) || '.';

  when 'chirurgeon_leech' then
    -- What it takes of the creature, as a share of all it has, is what you get back of yours.
    v_hp := c.health;
    b := class_blow(p_world, p_uid, c.id, spell_fx(p_spell, 'more'));
    v_said := class_blow_said(s.name, b);
    if (b->>'landed')::boolean then
      v_hp := class_heal(p_world, p_uid, least((b->>'dmg')::double precision, v_hp) / max_health(c));
      if v_hp > 0 then v_said := v_said || ' You get back ' || faith_pct(v_hp) || ' of your health.'; end if;
    end if;

  when 'chirurgeon_regenerate' then
    v_why := class_person_why(p_world, p_uid, p_target, spell_fx(p_spell, 'reach'));
    if v_why is not null then return jsonb_build_object('why', v_why); end if;
    v_uid := (p_target->>'uid')::uuid;
    v_who := case when v_uid = p_uid then 'you' else (select name from player where world_id = p_world and uid = v_uid) end;
    v_whose := case when v_uid = p_uid then 'You are' else v_who || ' is' end;
    if coalesce((select (stats->>'health')::double precision from player where world_id = p_world and uid = v_uid), 1) >= 1 then
      return jsonb_build_object('why', v_whose || ' not hurt.');
    end if;
    -- From now, as a Renewal's is: the body settled first, so none of it is spent on time already gone (`class_regen`).
    perform body_settle(p_world, v_uid);
    perform blessing_put(p_world, v_uid, 'regenerate', jsonb_build_object('at', now(),
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'each', spell_fx(p_spell, 'each')));
    perform class_learn_heal(p_world, p_uid, v_uid);
    v_said := s.name || ' heals ' || v_who || ' by ' || faith_pct(spell_fx(p_spell, 'each')) || ' a second for '
      || faith_span(spell_fx(p_spell, 'secs')) || '.';

  when 'chirurgeon_toxin' then
    -- A bleed, as a knife's runs (`creature_settle`): the stronger of the two where it already bleeds, to the later end.
    update creature set bleed_rate = greatest(coalesce(bleed_rate, 0), max_health(c) * spell_fx(p_spell, 'each')),
        bleed_until = greatest(coalesce(bleed_until, now()), now() + make_interval(secs => spell_fx(p_spell, 'secs')))
      where world_id = p_world and id = c.id;
    perform fx_beast(c.id, spell_fx(p_spell, 'secs'), 'bleed');
    perform class_learn(p_world, p_uid, class_learn_blow());
    v_said := s.name || ': the ' || lower(d.name) || ' bleeds ' || faith_pct(spell_fx(p_spell, 'each')) || ' of its health a second for '
      || faith_span(spell_fx(p_spell, 'secs')) || '.';

  when 'chirurgeon_surgeons_hands' then
    -- On every dressing you put on while it holds (`perform_fight`).
    perform blessing_put(p_world, p_uid, 'surgeons_hands', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'more', spell_fx(p_spell, 'more')));
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' every dressing you put on puts back '
      || case when spell_fx(p_spell, 'more') = 2 then 'twice' else trim_scale(spell_fx(p_spell, 'more')::numeric) || ' times' end
      || ' as much health.';

  when 'chirurgeon_healing_circle' then
    -- You, and everybody within its reach of you who is hurt.
    for r in select pl.uid from player pl
              where pl.world_id = p_world and not pl.away and coalesce((pl.stats->>'health')::double precision, 1) < 1
                and (pl.uid = p_uid or (pl.x - me.x) ^ 2 + (pl.y - me.y) ^ 2 <= spell_fx(p_spell, 'reach') ^ 2)
              order by pl.uid loop
      perform class_heal(p_world, r.uid, spell_fx(p_spell, 'heal'));
      perform class_learn_heal(p_world, p_uid, r.uid);
      v_n := v_n + 1;
    end loop;
    if v_n = 0 then
      return jsonb_build_object('why', 'Nobody within ' || trim_scale(spell_fx(p_spell, 'reach')::numeric) || ' tiles of you is hurt, you included.');
    end if;
    v_said := s.name || ' heals ' || v_n || case when v_n = 1 then ' person' else ' people' end || ' by ' || faith_pct(spell_fx(p_spell, 'heal')) || '.';

  when 'chirurgeon_mass_dressing' then
    -- You, and everybody within its reach of you: the worst wound on each.
    for r in select pl.uid from player pl
              where pl.world_id = p_world and not pl.away
                and (pl.uid = p_uid or (pl.x - me.x) ^ 2 + (pl.y - me.y) ^ 2 <= spell_fx(p_spell, 'reach') ^ 2)
              order by pl.uid loop
      if class_wounds_close(p_world, r.uid, spell_fx(p_spell, 'close'), false, true) > 0 then
        perform fx_person(r.uid);
        perform class_learn_heal(p_world, p_uid, r.uid);
        v_n := v_n + 1;
      end if;
    end loop;
    if v_n = 0 then
      return jsonb_build_object('why', 'Nobody within ' || trim_scale(spell_fx(p_spell, 'reach')::numeric) || ' tiles of you has a wound, you included.');
    end if;
    v_said := s.name || ' stops the worst wound bleeding and closes it by ' || faith_pct(spell_fx(p_spell, 'close')) || ' on '
      || v_n || case when v_n = 1 then ' person.' else ' people.' end;

  when 'chirurgeon_plague' then
    -- Every wild thing within its reach of you bleeds, as a Toxin's does.
    for r in select cr.id from creature cr
              where cr.world_id = p_world and cr.mode = 'wild' and cr.health > 0
                and (creature_x(cr) - me.x) ^ 2 + (creature_y(cr) - me.y) ^ 2 <= spell_fx(p_spell, 'reach') ^ 2
              order by cr.id loop
      perform creature_settle(p_world, r.id);
      update creature set bleed_rate = greatest(coalesce(bleed_rate, 0), max_health(creature) * spell_fx(p_spell, 'each')),
          bleed_until = greatest(coalesce(bleed_until, now()), now() + make_interval(secs => spell_fx(p_spell, 'secs')))
        where world_id = p_world and id = r.id and health > 0;
      if found then
        v_n := v_n + 1;
        perform fx_beast(r.id, spell_fx(p_spell, 'secs'), 'bleed');
        perform class_learn(p_world, p_uid, class_learn_blow());
      end if;
    end loop;
    if v_n = 0 then
      return jsonb_build_object('why', 'Nothing is within ' || trim_scale(spell_fx(p_spell, 'reach')::numeric) || ' tiles of you to strike.');
    end if;
    v_said := s.name || ': ' || v_n || case when v_n = 1 then ' creature bleeds ' else ' creatures bleed ' end
      || faith_pct(spell_fx(p_spell, 'each')) || ' of ' || case when v_n = 1 then 'its' else 'their' end || ' health a second for '
      || faith_span(spell_fx(p_spell, 'secs')) || '.';

  when 'chirurgeon_battlefield_surgery' then
    v_why := class_person_why(p_world, p_uid, p_target, spell_fx(p_spell, 'reach'));
    if v_why is not null then return jsonb_build_object('why', v_why); end if;
    v_uid := (p_target->>'uid')::uuid;
    v_who := case when v_uid = p_uid then 'you' else (select name from player where world_id = p_world and uid = v_uid) end;
    v_whose := case when v_uid = p_uid then 'You are' else v_who || ' is' end;
    v_n := class_wounds_close(p_world, v_uid, spell_fx(p_spell, 'close'), true, false);
    v_hp := class_heal(p_world, v_uid, spell_fx(p_spell, 'heal'));
    if v_n = 0 and v_hp <= 0 then return jsonb_build_object('why', v_whose || ' not hurt.'); end if;
    perform class_learn_heal(p_world, p_uid, v_uid);
    v_said := s.name || ' closes every wound on ' || v_who || ' by ' || faith_pct(spell_fx(p_spell, 'close')) || ' and heals '
      || case when v_uid = p_uid then 'you' else 'them' end || ' by ' || faith_pct(spell_fx(p_spell, 'heal')) || '.';

  when 'chirurgeon_restoration' then
    v_n := class_wounds_close(p_world, p_uid, 1, true, false);
    v_hp := class_heal(p_world, p_uid, spell_fx(p_spell, 'heal'));
    if v_n = 0 and v_hp <= 0 then return jsonb_build_object('why', 'You are not hurt.'); end if;
    perform class_learn_heal(p_world, p_uid, p_uid);
    v_said := s.name || ' closes every wound on you and heals you by ' || faith_pct(spell_fx(p_spell, 'heal')) || '.';

  when 'chirurgeon_miracle_worker' then
    v_why := class_person_why(p_world, p_uid, p_target, spell_fx(p_spell, 'reach'));
    if v_why is not null then return jsonb_build_object('why', v_why); end if;
    v_uid := (p_target->>'uid')::uuid;
    v_who := case when v_uid = p_uid then 'you' else (select name from player where world_id = p_world and uid = v_uid) end;
    v_whose := case when v_uid = p_uid then 'You are' else v_who || ' is' end;
    v_n := class_wounds_close(p_world, v_uid, 1, true, false);
    v_hp := class_heal(p_world, v_uid, spell_fx(p_spell, 'heal'));
    if v_n = 0 and v_hp <= 0 then return jsonb_build_object('why', v_whose || ' not hurt.'); end if;
    perform class_learn_heal(p_world, p_uid, v_uid);
    v_said := s.name || ' closes every wound on ' || v_who || ' and heals ' || case when v_uid = p_uid then 'you' else 'them' end
      || ' by ' || faith_pct(spell_fx(p_spell, 'heal')) || '.';

  when 'beastmaster_sic' then
    k := class_companion(p_world, p_uid);
    if k.id is not null then perform creature_settle(p_world, k.id); k := class_companion(p_world, p_uid); end if;
    if k.id is null then return jsonb_build_object('why', s.name || ' wants a companion following you.'); end if;
    if sqrt((creature_x(c) - creature_x(k)) ^ 2 + (creature_y(c) - creature_y(k)) ^ 2) > companion_reach() then
      return jsonb_build_object('why', k.name || ' is not close enough to the ' || lower(d.name) || ' to strike it.');
    end if;
    b := class_beast_blow(p_world, k.id, c.id, spell_fx(p_spell, 'more'));
    v_said := class_beast_said(s.name, k.name, b);

  when 'beastmaster_lick_wounds' then
    k := class_companion(p_world, p_uid);
    if k.id is not null then perform creature_settle(p_world, k.id); k := class_companion(p_world, p_uid); end if;
    if k.id is null then return jsonb_build_object('why', s.name || ' wants a companion following you.'); end if;
    v_top := max_health(k);
    if k.health >= v_top then return jsonb_build_object('why', k.name || ' is not hurt.'); end if;
    update creature set health = least(v_top, health + v_top * spell_fx(p_spell, 'heal')) where world_id = p_world and id = k.id;
    v_said := s.name || ' heals ' || k.name || ' by ' || faith_pct(spell_fx(p_spell, 'heal')) || '.';

  when 'beastmaster_pounce' then
    k := class_companion(p_world, p_uid);
    if k.id is not null then perform creature_settle(p_world, k.id); k := class_companion(p_world, p_uid); end if;
    if k.id is null then return jsonb_build_object('why', s.name || ' wants a companion following you.'); end if;
    v_dist := sqrt((creature_x(c) - creature_x(k)) ^ 2 + (creature_y(c) - creature_y(k)) ^ 2);
    if v_dist > spell_fx(p_spell, 'reach') then
      return jsonb_build_object('why', k.name || ' is more than ' || trim_scale(spell_fx(p_spell, 'reach')::numeric) || ' tiles from the '
        || lower(d.name) || '.');
    end if;
    if not line_clear(p_world, creature_x(k), creature_y(k), creature_x(c), creature_y(c)) then
      return jsonb_build_object('why', 'Something stands between ' || k.name || ' and the ' || lower(d.name) || '.');
    end if;
    -- It lands half its reach short of it, on the line between them; on it, where there is no footing there.
    v_x := creature_x(c) - (creature_x(c) - creature_x(k)) / greatest(v_dist, 0.001) * companion_reach() / 2;
    v_y := creature_y(c) - (creature_y(c) - creature_y(k)) / greatest(v_dist, 0.001) * companion_reach() / 2;
    if not creature_tile_ok(p_world, floor(v_x)::int, floor(v_y)::int) then v_x := creature_x(c); v_y := creature_y(c); end if;
    update creature set from_x = v_x, from_y = v_y, to_x = v_x, to_y = v_y, leg_at = now(), leg_ends = now(), until = now(),
        phase = 'idle', enemy = c.id, heel_until = null
      where world_id = p_world and id = k.id;
    b := class_beast_blow(p_world, k.id, c.id, spell_fx(p_spell, 'more'));
    if not (b->>'died')::boolean then
      update creature set windup_at = null, until = greatest(until, now()) + make_interval(secs => spell_fx(p_spell, 'back'))
        where world_id = p_world and id = c.id;
    end if;
    v_said := class_beast_said(s.name, k.name, b) || case when (b->>'died')::boolean then ''
      else ' Its next blow is put back ' || faith_span(spell_fx(p_spell, 'back')) || '.' end;

  when 'beastmaster_snarl' then
    k := class_companion(p_world, p_uid);
    if k.id is not null then perform creature_settle(p_world, k.id); k := class_companion(p_world, p_uid); end if;
    if k.id is null then return jsonb_build_object('why', s.name || ' wants a companion following you.'); end if;
    for r in select cr.id from creature cr
              where cr.world_id = p_world and cr.mode = 'wild' and cr.health > 0 and cr.hitched_to is null
                and cr.to_x between creature_x(k) - (spell_fx(p_spell, 'reach') + leg_slack()) and creature_x(k) + (spell_fx(p_spell, 'reach') + leg_slack())
                and cr.to_y between creature_y(k) - (spell_fx(p_spell, 'reach') + leg_slack()) and creature_y(k) + (spell_fx(p_spell, 'reach') + leg_slack())
                and (creature_x(cr) - creature_x(k)) ^ 2 + (creature_y(cr) - creature_y(k)) ^ 2 <= spell_fx(p_spell, 'reach') ^ 2
              order by cr.id loop
      perform creature_settle(p_world, r.id);
      update creature set brawl = k.id, threat_at = now(), windup_at = null
        where world_id = p_world and id = r.id and mode = 'wild' and health > 0;
      if found then v_n := v_n + 1; end if;
    end loop;
    if v_n = 0 then
      return jsonb_build_object('why', 'Nothing wild is within ' || trim_scale(spell_fx(p_spell, 'reach')::numeric) || ' tiles of ' || k.name || '.');
    end if;
    v_said := s.name || ': ' || v_n || case when v_n = 1 then ' creature turns on ' else ' creatures turn on ' end || k.name || '.';

  when 'beastmaster_guard_me' then
    k := class_companion(p_world, p_uid);
    if k.id is not null then perform creature_settle(p_world, k.id); k := class_companion(p_world, p_uid); end if;
    if k.id is null then return jsonb_build_object('why', s.name || ' wants a companion following you.'); end if;
    -- Only when something within its reach of you is hunting you: otherwise it would be a leap for nothing.
    if not exists (select 1 from creature cr
                    where cr.world_id = p_world and cr.mode = 'wild' and cr.health > 0 and cr.hunting = p_uid
                      and (creature_x(cr) - me.x) ^ 2 + (creature_y(cr) - me.y) ^ 2 <= spell_fx(p_spell, 'reach') ^ 2) then
      return jsonb_build_object('why', 'Nothing within ' || trim_scale(spell_fx(p_spell, 'reach')::numeric) || ' tiles of you is hunting you.');
    end if;
    update creature set from_x = me.x, from_y = me.y, to_x = me.x, to_y = me.y, leg_at = now(), leg_ends = now(), until = now(),
        phase = 'idle'
      where world_id = p_world and id = k.id;
    for r in select cr.id from creature cr
              where cr.world_id = p_world and cr.mode = 'wild' and cr.health > 0 and cr.hunting = p_uid
                and (creature_x(cr) - me.x) ^ 2 + (creature_y(cr) - me.y) ^ 2 <= spell_fx(p_spell, 'reach') ^ 2
              order by cr.id loop
      perform creature_settle(p_world, r.id);
      update creature set brawl = k.id, threat_at = now(), windup_at = null
        where world_id = p_world and id = r.id and mode = 'wild' and health > 0;
      if found then v_n := v_n + 1; end if;
    end loop;
    v_said := s.name || ': ' || k.name || ' is at your side, and ' || v_n
      || case when v_n = 1 then ' creature turns on it.' else ' creatures turn on it.' end;

  when 'beastmaster_drag_down' then
    k := class_companion(p_world, p_uid);
    if k.id is not null then perform creature_settle(p_world, k.id); k := class_companion(p_world, p_uid); end if;
    if k.id is null then return jsonb_build_object('why', s.name || ' wants a companion following you.'); end if;
    if sqrt((creature_x(c) - creature_x(k)) ^ 2 + (creature_y(c) - creature_y(k)) ^ 2) > companion_reach() then
      return jsonb_build_object('why', k.name || ' is not close enough to the ' || lower(d.name) || ' to strike it.');
    end if;
    b := class_beast_blow(p_world, k.id, c.id, spell_fx(p_spell, 'more'));
    if not (b->>'died')::boolean then perform class_hold(p_world, c.id, spell_fx(p_spell, 'hold')); end if;
    v_said := class_beast_said(s.name, k.name, b) || case when (b->>'died')::boolean then ''
      else ' It is held where it stands for ' || faith_span(spell_fx(p_spell, 'hold')) || '.' end;

  when 'beastmaster_disembowel' then
    k := class_companion(p_world, p_uid);
    if k.id is not null then perform creature_settle(p_world, k.id); k := class_companion(p_world, p_uid); end if;
    if k.id is null then return jsonb_build_object('why', s.name || ' wants a companion following you.'); end if;
    if sqrt((creature_x(c) - creature_x(k)) ^ 2 + (creature_y(c) - creature_y(k)) ^ 2) > companion_reach() then
      return jsonb_build_object('why', k.name || ' is not close enough to the ' || lower(d.name) || ' to strike it.');
    end if;
    b := class_beast_blow(p_world, k.id, c.id, spell_fx(p_spell, 'more'));
    -- A bleed, as a knife's runs (`creature_settle`): the stronger of the two where it already bleeds, to the later end.
    if not (b->>'died')::boolean then
      update creature set bleed_rate = greatest(coalesce(bleed_rate, 0), (b->>'dmg')::double precision * spell_fx(p_spell, 'each')),
          bleed_until = greatest(coalesce(bleed_until, now()), now() + make_interval(secs => spell_fx(p_spell, 'secs')))
        where world_id = p_world and id = c.id;
      perform fx_beast(c.id, spell_fx(p_spell, 'secs'), 'bleed');
    end if;
    v_said := class_beast_said(s.name, k.name, b) || case when (b->>'died')::boolean then ''
      else ' It bleeds ' || faith_pct(spell_fx(p_spell, 'each')) || ' of the blow a second for ' || faith_span(spell_fx(p_spell, 'secs')) || '.' end;

  when 'beastmaster_bloodlust' then
    k := class_companion(p_world, p_uid);
    if k.id is not null then perform creature_settle(p_world, k.id); k := class_companion(p_world, p_uid); end if;
    if k.id is null then return jsonb_build_object('why', s.name || ' wants a companion following you.'); end if;
    -- On every blow of its while it holds (`companion_dealt`).
    perform blessing_put(p_world, p_uid, 'bloodlust', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'more', spell_fx(p_spell, 'more')));
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' ' || k.name || '''s blows are '
      || faith_pct(spell_fx(p_spell, 'more') - 1) || ' larger.';

  when 'beastmaster_vengeance' then
    k := class_companion(p_world, p_uid);
    if k.id is not null then perform creature_settle(p_world, k.id); k := class_companion(p_world, p_uid); end if;
    if k.id is null then return jsonb_build_object('why', s.name || ' wants a companion following you.'); end if;
    -- On every blow that lands on you while it holds (`hurt_player`), answered once the striker's turn is written (`class_vengeance`).
    perform blessing_put(p_world, p_uid, 'vengeance', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'more', spell_fx(p_spell, 'more'),
      'reach', spell_fx(p_spell, 'reach')));
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' ' || k.name
      || ' answers every creature that lands a blow on you.';

  when 'beastmaster_feral_bond' then
    k := class_companion(p_world, p_uid);
    if k.id is not null then perform creature_settle(p_world, k.id); k := class_companion(p_world, p_uid); end if;
    if k.id is null then return jsonb_build_object('why', s.name || ' wants a companion following you.'); end if;
    -- On every blow that lands on you (`class_bond_take`) or on it (`class_bond_give`) while it holds.
    perform blessing_put(p_world, p_uid, 'feral_bond', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'share', spell_fx(p_spell, 'share')));
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' every blow on you or on ' || k.name
      || ' is split between you.';

  when 'beastmaster_primal_fury' then
    k := class_companion(p_world, p_uid);
    if k.id is not null then perform creature_settle(p_world, k.id); k := class_companion(p_world, p_uid); end if;
    if k.id is null then return jsonb_build_object('why', s.name || ' wants a companion following you.'); end if;
    -- On every blow of its while it holds (`companion_dealt`), and on how often it strikes (`companion_quick`).
    perform blessing_put(p_world, p_uid, 'primal_fury', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'more', spell_fx(p_spell, 'more'),
      'quick', spell_fx(p_spell, 'quick')));
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' ' || k.name || '''s blows are '
      || faith_pct(spell_fx(p_spell, 'more') - 1) || ' larger and come ' || faith_pct(spell_fx(p_spell, 'quick') - 1) || ' more often.';

  when 'beastmaster_call_of_the_wild' then
    -- A tame that takes, as an offering that takes does (`perform_creature`), with nothing offered.
    if d.monster then return jsonb_build_object('why', 'The ' || lower(d.name) || ' cannot be tamed.'); end if;
    if coalesce(d.tame_level, 0) > skill_of(p_world, p_uid, 'taming') then
      return jsonb_build_object('why', 'The ' || lower(d.name) || ' wants ' || round(d.tame_level)::int || ' taming; you have '
        || floor(skill_of(p_world, p_uid, 'taming'))::int || '.');
    end if;
    v_why := tame_room_refusal(p_world, p_uid);
    if v_why is not null then return jsonb_build_object('why', v_why); end if;
    v_id := companion_of(p_world, p_uid);
    update creature set mode = 'active', stance = 'defensive', keeper = p_uid, coaxed = 0, coaxed_at = null,
        hunting = null, brawl = null, enemy = null, windup_at = null
      where world_id = p_world and id = c.id;
    -- One follows you; every one after that goes into the crate you carry.
    if v_id is not null then perform crate_shut_in(p_world, c.id, empty_crate(p_world, p_uid), null); end if;
    perform journal_note(p_world, p_uid, 'tamed');
    perform guide_mark(p_world, p_uid, c.species, 'tamed');
    perform skill_told(p_world, p_uid, 'taming', try_gain(true, tame_gain()));
    perform skill_told(p_world, p_uid, 'soul_strength', try_gain(true, tame_nerve()));
    v_said := s.name || ': the ' || lower(d.name) || ' trusts you. ' || case when v_id is null then c.name || ' now follows you.'
      else 'It goes into the creature crate in your pack.' end;

  when 'kindler_scorch' then
    b := kindler_fire(p_world, p_uid, c.id, kindler_fire_at(p_world, p_uid) * spell_fx(p_spell, 'fire'));
    v_fired := true;
    v_said := kindler_said(s.name, b) || kindler_burn_said(case when (b->>'landed')::boolean and not (b->>'died')::boolean
      then class_burn(p_world, p_uid, c.id, spell_fx(p_spell, 'each'), spell_fx(p_spell, 'secs')) end);

  when 'kindler_heat_seeker' then
    -- Every enemy within its reach settled first, so the share of its health each has left is what it has now.
    for r in select cr.id from creature cr
              where cr.world_id = p_world and cr.mode = 'wild' and cr.health > 0
                and cr.to_x between me.x - (spell_fx(p_spell, 'reach') + leg_slack()) and me.x + (spell_fx(p_spell, 'reach') + leg_slack())
                and cr.to_y between me.y - (spell_fx(p_spell, 'reach') + leg_slack()) and me.y + (spell_fx(p_spell, 'reach') + leg_slack())
                and (creature_x(cr) - me.x) ^ 2 + (creature_y(cr) - me.y) ^ 2 <= spell_fx(p_spell, 'reach') ^ 2
              order by cr.id loop
      perform creature_settle(p_world, r.id);
    end loop;
    select cr.id into v_id from creature cr
     where cr.world_id = p_world and cr.mode = 'wild' and cr.health > 0
                and cr.to_x between me.x - (spell_fx(p_spell, 'reach') + leg_slack()) and me.x + (spell_fx(p_spell, 'reach') + leg_slack())
                and cr.to_y between me.y - (spell_fx(p_spell, 'reach') + leg_slack()) and me.y + (spell_fx(p_spell, 'reach') + leg_slack())
                and (creature_x(cr) - me.x) ^ 2 + (creature_y(cr) - me.y) ^ 2 <= spell_fx(p_spell, 'reach') ^ 2
     order by cr.health / max_health(cr), (creature_x(cr) - me.x) ^ 2 + (creature_y(cr) - me.y) ^ 2, cr.id
     limit 1;
    if v_id is null then
      return jsonb_build_object('why', 'Nothing is within ' || trim_scale(spell_fx(p_spell, 'reach')::numeric) || ' tiles of you to strike.');
    end if;
    b := kindler_fire(p_world, p_uid, v_id, kindler_fire_at(p_world, p_uid) * spell_fx(p_spell, 'fire'));
    v_fired := true;
    v_said := kindler_said(s.name, b);

  when 'kindler_scald' then
    b := kindler_fire(p_world, p_uid, c.id, kindler_fire_at(p_world, p_uid) * spell_fx(p_spell, 'fire'));
    v_fired := true;
    v_said := kindler_said(s.name, b);
    if (b->>'landed')::boolean and not (b->>'died')::boolean then
      update creature set slow = spell_fx(p_spell, 'pace'), slow_until = now() + make_interval(secs => spell_fx(p_spell, 'secs'))
        where world_id = p_world and id = c.id;
      perform fx_beast(c.id, spell_fx(p_spell, 'secs'), 'slow');
      v_said := v_said || ' For ' || faith_span(spell_fx(p_spell, 'secs')) || ' it goes at '
        || faith_pct(spell_fx(p_spell, 'pace')) || ' of its pace.';
    end if;

  when 'kindler_flash_fire' then
    b := kindler_fire(p_world, p_uid, c.id, kindler_fire_at(p_world, p_uid) * spell_fx(p_spell, 'fire'));
    v_fired := true;
    v_said := kindler_said(s.name, b);

  when 'kindler_stoke' then
    -- Spent by the next of your spells that deals fire (`kindler_fire_at`), at the end of its cast.
    perform blessing_put(p_world, p_uid, 'stoke', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'more', spell_fx(p_spell, 'more')));
    v_said := s.name || ': the next spell of yours within ' || faith_span(spell_fx(p_spell, 'secs')) || ' that deals fire deals '
      || faith_pct(spell_fx(p_spell, 'more') - 1) || ' more of it.';

  when 'kindler_firebrand' then
    -- On every burn you start while it holds (`class_burn`).
    perform blessing_put(p_world, p_uid, 'firebrand', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'long', spell_fx(p_spell, 'long')));
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' every burn you start lasts '
      || case when spell_fx(p_spell, 'long') = 2 then 'twice' else trim_scale(spell_fx(p_spell, 'long')::numeric) || ' times' end
      || ' as long.';

  when 'kindler_immolate' then
    v_burnt := class_burn(p_world, p_uid, c.id, spell_fx(p_spell, 'each'), spell_fx(p_spell, 'secs'));
    if v_burnt is null then return jsonb_build_object('why', 'Nothing burns inside a Truce.'); end if;
    perform class_learn(p_world, p_uid, class_learn_blow());
    perform engage_beast(p_world, c.id, p_uid);
    v_said := s.name || ': the ' || lower(d.name) || ' catches.' || kindler_burn_said(v_burnt);

  when 'kindler_combust' then
    -- What its burn still had to do (`class_burn`), all at once, and then it is out, and its bleeding with it.
    select * into v_burn from class_mark where world_id = p_world and creature_id = c.id and kind = 'burn' and until > now();
    if v_burn.creature_id is null then return jsonb_build_object('why', 'The ' || lower(d.name) || ' is not burning.'); end if;
    v_hp := v_burn.val * extract(epoch from (v_burn.until - now())) * spell_fx(p_spell, 'more');
    delete from class_mark where world_id = p_world and creature_id = c.id and kind = 'burn';
    update creature set bleed_rate = null, bleed_until = null where world_id = p_world and id = c.id;
    b := kindler_fire(p_world, p_uid, c.id, v_hp);
    v_said := s.name || ': the burn on the ' || lower(d.name) || ' goes up at once, ' || round(v_hp::numeric) || ' of it'
      || case when (b->>'died')::boolean then ', and it dies.'
              else '. It is down to ' || (b->>'left') || ' of ' || (b->>'of') || '.' end;

  when 'kindler_blaze_aura' then
    -- Burned a round at a time by the clock (`class_aura`), at the fire you had when you cast it.
    v_fire := kindler_fire_at(p_world, p_uid) * spell_fx(p_spell, 'fire');
    perform blessing_put(p_world, p_uid, 'blaze_aura', jsonb_build_object('from', now(), 'at', now(),
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'fire', v_fire, 'share', spell_fx(p_spell, 'fire'),
      'reach', spell_fx(p_spell, 'reach')));
    v_fired := true;
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' everything wild within '
      || trim_scale(spell_fx(p_spell, 'reach')::numeric) || ' tiles of you takes ' || trim_scale(round(v_fire::numeric, 1))
      || ' of fire a second.';

  when 'kindler_inferno_bolt' then
    b := kindler_fire(p_world, p_uid, c.id, kindler_fire_at(p_world, p_uid) * spell_fx(p_spell, 'fire'));
    v_fired := true;
    v_said := kindler_said(s.name, b) || kindler_burn_said(case when (b->>'landed')::boolean and not (b->>'died')::boolean
      then class_burn(p_world, p_uid, c.id, spell_fx(p_spell, 'each'), spell_fx(p_spell, 'secs')) end);

  when 'kindler_meteor' then
    -- The one it was cast at, and every other within its width of where that one stood.
    v_fire := kindler_fire_at(p_world, p_uid);
    v_x := creature_x(c); v_y := creature_y(c);
    b := kindler_fire(p_world, p_uid, c.id, v_fire * spell_fx(p_spell, 'fire'));
    v_fired := true;
    for r in select cr.id from creature cr
              where cr.world_id = p_world and cr.mode = 'wild' and cr.health > 0
                and cr.to_x between v_x - (spell_fx(p_spell, 'wide') + leg_slack()) and v_x + (spell_fx(p_spell, 'wide') + leg_slack())
                and cr.to_y between v_y - (spell_fx(p_spell, 'wide') + leg_slack()) and v_y + (spell_fx(p_spell, 'wide') + leg_slack())
                and (creature_x(cr) - v_x) ^ 2 + (creature_y(cr) - v_y) ^ 2 <= spell_fx(p_spell, 'wide') ^ 2 and cr.id <> c.id
              order by cr.id loop
      v_on := kindler_fire(p_world, p_uid, r.id, v_fire * spell_fx(p_spell, 'splash'));
      if (v_on->>'landed')::boolean then v_n := v_n + 1; end if;
      if (v_on->>'died')::boolean then v_dead := v_dead + 1; end if;
    end loop;
    v_said := kindler_said(s.name, b) || case when v_n = 0 then '' else ' ' || v_n
      || case when v_n = 1 then ' more creature is' else ' more creatures are' end || ' caught in it'
      || case when v_dead = 0 then '.' when v_n = 1 then ', and it dies.' when v_dead = 1 then ', and one of them dies.'
              else ', and ' || v_dead || ' of them die.' end end;

  when 'kindler_firestorm' then
    -- Every enemy within its reach of you, and each the fire leaves standing burns.
    v_fire := kindler_fire_at(p_world, p_uid);
    for r in select cr.id from creature cr
              where cr.world_id = p_world and cr.mode = 'wild' and cr.health > 0
                and cr.to_x between me.x - (spell_fx(p_spell, 'reach') + leg_slack()) and me.x + (spell_fx(p_spell, 'reach') + leg_slack())
                and cr.to_y between me.y - (spell_fx(p_spell, 'reach') + leg_slack()) and me.y + (spell_fx(p_spell, 'reach') + leg_slack())
                and (creature_x(cr) - me.x) ^ 2 + (creature_y(cr) - me.y) ^ 2 <= spell_fx(p_spell, 'reach') ^ 2
              order by cr.id loop
      v_on := kindler_fire(p_world, p_uid, r.id, v_fire * spell_fx(p_spell, 'fire'));
      if (v_on->>'landed')::boolean then
        v_n := v_n + 1;
        if (v_on->>'died')::boolean then v_dead := v_dead + 1;
        else v_burnt := coalesce(class_burn(p_world, p_uid, r.id, spell_fx(p_spell, 'each'), spell_fx(p_spell, 'secs')), v_burnt);
        end if;
      end if;
    end loop;
    if v_n = 0 then
      return jsonb_build_object('why', 'Nothing is within ' || trim_scale(spell_fx(p_spell, 'reach')::numeric) || ' tiles of you to strike.');
    end if;
    v_fired := true;
    v_said := s.name || ': ' || v_n || case when v_n = 1 then ' creature is' else ' creatures are' end || ' caught in it'
      || case when v_dead = 0 then '.' when v_n = 1 then ', and it dies.' when v_dead = 1 then ', and one of them dies.'
              else ', and ' || v_dead || ' of them die.' end
      || case when v_burnt is null then ''
              else ' ' || case when v_dead = 0 and v_n = 1 then 'It burns ' when v_dead = 0 then 'They burn '
                               when v_n - v_dead = 1 then 'The other burns ' else 'The rest burn ' end
                || trim_scale(round(((v_burnt->>'each')::double precision * 100)::numeric, 1)) || '% of '
                || case when v_n - v_dead = 1 then 'its' else 'their' end || ' health a second for '
                || faith_span((v_burnt->>'secs')::double precision) || '.' end;

  when 'binder_bind' then
    perform engage_beast(p_world, c.id, p_uid);
    v_hp := class_bind(p_world, p_uid, c.id, spell_fx(p_spell, 'hold'), spell_fx(p_spell, 'monster'));
    perform class_learn(p_world, p_uid, class_learn_blow());
    v_said := s.name || ': the ' || lower(d.name) || ' is held where it stands for ' || faith_span(v_hp) || '.';

  when 'binder_lock' then
    perform engage_beast(p_world, c.id, p_uid);
    v_hp := class_bind(p_world, p_uid, c.id, spell_fx(p_spell, 'hold'), spell_fx(p_spell, 'monster'));
    perform class_learn(p_world, p_uid, class_learn_blow());
    v_said := s.name || ': the ' || lower(d.name) || ' is held where it stands for ' || faith_span(v_hp) || '.';

  when 'binder_shatter' then
    -- Larger on one held, by anybody's hold (`class_held`).
    v_windup := class_held(p_world, c.id);
    b := kindler_fire(p_world, p_uid, c.id, binder_shatter_at(p_world, p_uid)
           * case when v_windup then spell_fx(p_spell, 'held') else spell_fx(p_spell, 'shatter') end);
    v_said := binder_said(s.name, b);

  when 'binder_root' then
    perform engage_beast(p_world, c.id, p_uid);
    perform class_leash(p_world, c.id, 'root', 0, spell_fx(p_spell, 'secs'), p_uid);
    perform class_learn(p_world, p_uid, class_learn_blow());
    v_said := s.name || ': the ' || lower(d.name) || ' is rooted where it stands for ' || faith_span(spell_fx(p_spell, 'secs')) || '.';

  when 'binder_tether' then
    perform engage_beast(p_world, c.id, p_uid);
    perform class_leash(p_world, c.id, 'tether', spell_fx(p_spell, 'leash'), spell_fx(p_spell, 'secs'), p_uid);
    perform class_learn(p_world, p_uid, class_learn_blow());
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' the ' || lower(d.name) || ' cannot go more than '
      || trim_scale(spell_fx(p_spell, 'leash')::numeric) || ' tiles from where it stands.';

  when 'binder_heavy_limbs' then
    perform engage_beast(p_world, c.id, p_uid);
    perform class_mark_put(p_world, c.id, 'limbs', spell_fx(p_spell, 'often'), spell_fx(p_spell, 'secs'), p_uid);
    perform class_learn(p_world, p_uid, class_learn_blow());
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' the ' || lower(d.name) || ' strikes ' || faith_pct(1 - spell_fx(p_spell, 'often')) || ' less often.';

  when 'binder_dull_claws' then
    perform engage_beast(p_world, c.id, p_uid);
    perform class_mark_put(p_world, c.id, 'dull', spell_fx(p_spell, 'dealt'), spell_fx(p_spell, 'secs'), p_uid);
    perform class_learn(p_world, p_uid, class_learn_blow());
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' the ' || lower(d.name) || '''s blows land ' || faith_pct(1 - spell_fx(p_spell, 'dealt')) || ' smaller.';

  when 'binder_brittle' then
    perform engage_beast(p_world, c.id, p_uid);
    perform class_mark_put(p_world, c.id, 'brittle', spell_fx(p_spell, 'taken'), spell_fx(p_spell, 'secs'), p_uid);
    perform class_learn(p_world, p_uid, class_learn_blow());
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' the ' || lower(d.name) || ' takes ' || faith_pct(spell_fx(p_spell, 'taken') - 1) || ' more from everything that strikes it.';

  when 'binder_stillness' then
    perform wounds_settle(p_world, p_uid);
    if not exists (select 1 from player pl, jsonb_array_elements(coalesce(pl.wounds, '[]'::jsonb)) t(w)
                    where pl.world_id = p_world and pl.uid = p_uid and coalesce((w->>'bleeding')::boolean, false)) then
      return jsonb_build_object('why', 'Nothing on you is bleeding.');
    end if;
    update player set wounds = (select coalesce(jsonb_agg(jsonb_set(w, '{bleeding}', 'false')), '[]'::jsonb)
                                  from jsonb_array_elements(coalesce(wounds, '[]'::jsonb)) t(w))
     where world_id = p_world and uid = p_uid;
    v_said := s.name || ': every wound on you stops bleeding.';

  when 'binder_still_skin' then
    -- On every blow that lands on you while it holds (`hurt_player`).
    perform blessing_put(p_world, p_uid, 'still_skin', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'cut', spell_fx(p_spell, 'cut')));
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' you take ' || faith_pct(spell_fx(p_spell, 'cut'))
      || ' less from every blow.';

  when 'binder_mire' then
    -- Every enemy within its width of you, further in a Long Hold: the slower of its slow and this, to the later end.
    v_reach := spell_fx(p_spell, 'reach') * class_mul(me.class_mul, 'reach', 'binding');
    for r in select cr.id from creature cr
              where cr.world_id = p_world and cr.mode = 'wild' and cr.health > 0
                and cr.to_x between me.x - (v_reach + leg_slack()) and me.x + (v_reach + leg_slack())
                and cr.to_y between me.y - (v_reach + leg_slack()) and me.y + (v_reach + leg_slack())
                and (creature_x(cr) - me.x) ^ 2 + (creature_y(cr) - me.y) ^ 2 <= v_reach ^ 2
              order by cr.id loop
      perform creature_settle(p_world, r.id);
      update creature set slow = case when slow_until > now() then least(coalesce(slow, 1), spell_fx(p_spell, 'pace'))
                                      else spell_fx(p_spell, 'pace') end,
          slow_until = greatest(coalesce(slow_until, now()), now() + make_interval(secs => spell_fx(p_spell, 'secs')))
        where world_id = p_world and id = r.id and health > 0;
      if found then
        v_n := v_n + 1;
        perform fx_beast(r.id, spell_fx(p_spell, 'secs'), 'slow');
        perform engage_beast(p_world, r.id, p_uid);
        perform class_learn(p_world, p_uid, class_learn_blow());
      end if;
    end loop;
    if v_n = 0 then
      return jsonb_build_object('why', 'Nothing is within ' || trim_scale(round(v_reach::numeric, 1)) || ' tiles of you to strike.');
    end if;
    v_said := s.name || ': ' || v_n || case when v_n = 1 then ' creature goes' else ' creatures go' end || ' at '
      || faith_pct(spell_fx(p_spell, 'pace')) || ' of ' || case when v_n = 1 then 'its' else 'their' end || ' pace for '
      || faith_span(spell_fx(p_spell, 'secs')) || '.';

  when 'binder_mass_root' then
    -- Every enemy within its width of you, further in a Long Hold, rooted where it stands.
    v_reach := spell_fx(p_spell, 'reach') * class_mul(me.class_mul, 'reach', 'binding');
    for r in select cr.id from creature cr
              where cr.world_id = p_world and cr.mode = 'wild' and cr.health > 0
                and cr.to_x between me.x - (v_reach + leg_slack()) and me.x + (v_reach + leg_slack())
                and cr.to_y between me.y - (v_reach + leg_slack()) and me.y + (v_reach + leg_slack())
                and (creature_x(cr) - me.x) ^ 2 + (creature_y(cr) - me.y) ^ 2 <= v_reach ^ 2
              order by cr.id loop
      perform creature_settle(p_world, r.id);
      if exists (select 1 from creature where world_id = p_world and id = r.id and health > 0) then
        perform engage_beast(p_world, r.id, p_uid);
        perform class_leash(p_world, r.id, 'root', 0, spell_fx(p_spell, 'secs'), p_uid);
        perform class_learn(p_world, p_uid, class_learn_blow());
        v_n := v_n + 1;
      end if;
    end loop;
    if v_n = 0 then
      return jsonb_build_object('why', 'Nothing is within ' || trim_scale(round(v_reach::numeric, 1)) || ' tiles of you to strike.');
    end if;
    v_said := s.name || ': ' || v_n || case when v_n = 1 then ' creature is' else ' creatures are' end || ' rooted where '
      || case when v_n = 1 then 'it stands' else 'they stand' end || ' for ' || faith_span(spell_fx(p_spell, 'secs')) || '.';

  -- A Warder's skin over you: its share of your skin at 100%, larger for what you hold (`warder_skin_size`), refused where
  -- the skin over you is larger already and nothing adds to it, so that nothing is spent on it.
  when 'warder_ward', 'warder_greater_ward', 'warder_deep_ward' then
    v_more := warder_thicken_at(p_world, p_uid);
    v_hp := warder_skin_size(p_world, p_uid, p_uid, warder_skin_at(p_world, p_uid) * spell_fx(p_spell, 'skin'), v_more);
    v_was := coalesce((me.stats->>'aegis')::double precision, 0);
    if warder_skin_after(p_world, p_uid, p_uid, v_hp) <= v_was then
      return jsonb_build_object('why', 'The skin over you is larger already.');
    end if;
    v_h := warder_skin_put(p_world, p_uid, p_uid, v_hp);
    perform warder_thicken_take(p_world, p_uid);
    perform class_learn_heal(p_world, p_uid, p_uid);
    v_said := warder_skin_said(s.name, 'you', v_hp, v_h, v_was);

  -- And over somebody within its reach of you.
  when 'warder_ward_other', 'warder_greater_ward_other' then
    v_why := class_person_why(p_world, p_uid, p_target, spell_fx(p_spell, 'reach'));
    if v_why is not null then return jsonb_build_object('why', v_why); end if;
    v_uid := (p_target->>'uid')::uuid;
    v_who := case when v_uid = p_uid then 'you' else (select name from player where world_id = p_world and uid = v_uid) end;
    v_more := warder_thicken_at(p_world, p_uid);
    v_hp := warder_skin_size(p_world, p_uid, v_uid, warder_skin_at(p_world, p_uid) * spell_fx(p_spell, 'skin'), v_more);
    v_was := coalesce((select (stats->>'aegis')::double precision from player where world_id = p_world and uid = v_uid), 0);
    if warder_skin_after(p_world, p_uid, v_uid, v_hp) <= v_was then
      return jsonb_build_object('why', 'The skin over ' || v_who || ' is larger already.');
    end if;
    v_h := warder_skin_put(p_world, p_uid, v_uid, v_hp);
    perform warder_thicken_take(p_world, p_uid);
    perform class_learn_heal(p_world, p_uid, v_uid);
    if v_uid <> p_uid then
      perform tell(p_world, v_uid, me.name || '''s ' || s.name || ': a skin of ' || faith_pct(v_hp) || ' goes over you.', 'system');
    end if;
    v_said := warder_skin_said(s.name, v_who, v_hp, v_h, v_was);

  -- A Sanctuary: over you and over everybody within its reach of you, on each where it is the larger.
  when 'warder_sanctuary' then
    v_more := warder_thicken_at(p_world, p_uid);
    v_base := warder_skin_at(p_world, p_uid) * spell_fx(p_spell, 'skin');
    v_self := warder_skin_size(p_world, p_uid, p_uid, v_base, v_more);
    v_other := warder_skin_size(p_world, p_uid, null, v_base, v_more);
    for r in select pl.uid, coalesce((pl.stats->>'aegis')::double precision, 0) as was from player pl
              where pl.world_id = p_world and not pl.away
                and (pl.uid = p_uid or (pl.x - me.x) ^ 2 + (pl.y - me.y) ^ 2 <= spell_fx(p_spell, 'reach') ^ 2)
              order by pl.uid loop
      v_hp := case when r.uid = p_uid then v_self else v_other end;
      if exists (select 1 from creature cr where cr.world_id = p_world and cr.hunting = r.uid and cr.health > 0) then
        v_hunted := true;
      end if;
      if warder_skin_after(p_world, p_uid, r.uid, v_hp) > r.was then
        perform warder_skin_put(p_world, p_uid, r.uid, v_hp);
        if r.uid = p_uid then
          v_mine := true;
        else
          v_n := v_n + 1;
          perform tell(p_world, r.uid, me.name || '''s ' || s.name || ': a skin of ' || faith_pct(v_hp) || ' goes over you.', 'system');
        end if;
      end if;
    end loop;
    if not v_mine and v_n = 0 then
      return jsonb_build_object('why', 'Every skin within ' || trim_scale(spell_fx(p_spell, 'reach')::numeric)
        || ' tiles of you is larger already.');
    end if;
    perform warder_thicken_take(p_world, p_uid);
    if v_hunted then perform class_learn(p_world, p_uid, class_learn_blow()); end if;
    v_said := s.name || ': ' || case when v_mine then 'a skin of ' || faith_pct(v_self) || ' goes over you'
                                     else 'the skin over you is larger already' end
      || case when v_n = 0 then '.'
              else case when v_mine then ', and ' else '; ' end || 'a skin of ' || faith_pct(v_other) || ' goes over '
                || v_n || case when v_n = 1 then ' other.' else ' others.' end end;

  -- A Thicken: the next skin you lay, within its time, the larger (`warder_thicken_at`).
  when 'warder_thicken' then
    perform blessing_put(p_world, p_uid, 'thicken', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'more', spell_fx(p_spell, 'more')));
    perform class_learn_heal(p_world, p_uid, p_uid);
    v_said := s.name || ': the next skin you lay within ' || faith_span(spell_fx(p_spell, 'secs')) || ' is '
      || faith_pct(spell_fx(p_spell, 'more') - 1) || ' larger.';

  -- A Ward Link: a skin of yours over somebody used up while it holds goes back over them, once each (`warder_skin_spent`).
  when 'warder_ward_link' then
    perform blessing_put(p_world, p_uid, 'ward_link', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'reach', spell_fx(p_spell, 'reach'),
      'skin', spell_fx(p_spell, 'skin'), 'done', '[]'::jsonb));
    perform class_learn_heal(p_world, p_uid, p_uid);
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ', when a skin of yours over somebody within '
      || trim_scale(spell_fx(p_spell, 'reach')::numeric) || ' tiles of you is used up, a skin of '
      || faith_pct(spell_fx(p_spell, 'skin')) || ' goes back over them, once each.';

  -- A Stoneskin: its share off every blow on you, for as long as it says (`hurt_player`).
  when 'warder_stoneskin' then
    perform blessing_put(p_world, p_uid, 'stoneskin', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'cut', spell_fx(p_spell, 'cut')));
    perform class_learn_heal(p_world, p_uid, p_uid);
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' you take ' || faith_pct(spell_fx(p_spell, 'cut'))
      || ' less from every blow.';

  -- A Ward Burst: the skin over you broken on every enemy within its reach of you, so much damage for every hundredth of
  -- health it held, as fire lands (`kindler_fire`); refused with no skin, or nothing near enough to take it.
  when 'warder_ward_burst' then
    v_was := coalesce((me.stats->>'aegis')::double precision, 0);
    if v_was <= 0 then return jsonb_build_object('why', 'There is no skin over you to break.'); end if;
    v_reach := spell_fx(p_spell, 'reach');
    if not exists (select 1 from creature cr
                    where cr.world_id = p_world and cr.mode = 'wild' and cr.health > 0
                      and cr.to_x between me.x - (v_reach + leg_slack()) and me.x + (v_reach + leg_slack())
                      and cr.to_y between me.y - (v_reach + leg_slack()) and me.y + (v_reach + leg_slack())
                      and (creature_x(cr) - me.x) ^ 2 + (creature_y(cr) - me.y) ^ 2 <= v_reach ^ 2) then
      return jsonb_build_object('why', 'Nothing is within ' || trim_scale(v_reach::numeric) || ' tiles of you to strike.');
    end if;
    update player set stats = jsonb_set(stats, '{aegis}', to_jsonb(0::double precision)) where world_id = p_world and uid = p_uid;
    perform fx_size(v_was);
    v_fire := v_was * 100 * spell_fx(p_spell, 'dmg');
    for r in select cr.id from creature cr
              where cr.world_id = p_world and cr.mode = 'wild' and cr.health > 0
                and cr.to_x between me.x - (v_reach + leg_slack()) and me.x + (v_reach + leg_slack())
                and cr.to_y between me.y - (v_reach + leg_slack()) and me.y + (v_reach + leg_slack())
                and (creature_x(cr) - me.x) ^ 2 + (creature_y(cr) - me.y) ^ 2 <= v_reach ^ 2
              order by cr.id loop
      v_on := kindler_fire(p_world, p_uid, r.id, v_fire);
      if (v_on->>'landed')::boolean then v_n := v_n + 1; end if;
      if (v_on->>'died')::boolean then v_dead := v_dead + 1; end if;
    end loop;
    v_said := s.name || ': the skin of ' || faith_pct(v_was) || ' over you breaks for ' || trim_scale(round(v_fire::numeric, 1))
      || ' damage on ' || v_n || case when v_n = 1 then ' creature' else ' creatures' end
      || case when v_dead = 0 then '.' when v_n = 1 then ', and it dies.' when v_dead = 1 then ', and one of them dies.'
              else ', and ' || v_dead || ' of them die.' end;

  -- A Bastion of Stone: its share off every blow on you and on everybody within its reach of you, for as long as it says.
  when 'warder_bastion_of_stone' then
    for r in select pl.uid from player pl
              where pl.world_id = p_world and not pl.away
                and (pl.uid = p_uid or (pl.x - me.x) ^ 2 + (pl.y - me.y) ^ 2 <= spell_fx(p_spell, 'reach') ^ 2)
              order by pl.uid loop
      perform blessing_put(p_world, r.uid, 'bastion_stone', jsonb_build_object(
        'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'cut', spell_fx(p_spell, 'cut')));
      if exists (select 1 from creature cr where cr.world_id = p_world and cr.hunting = r.uid and cr.health > 0) then
        v_hunted := true;
      end if;
      if r.uid <> p_uid then
        v_n := v_n + 1;
        perform tell(p_world, r.uid, me.name || '''s ' || s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs'))
          || ' you take ' || faith_pct(spell_fx(p_spell, 'cut')) || ' less from every blow.', 'system');
      end if;
    end loop;
    if v_hunted then perform class_learn(p_world, p_uid, class_learn_blow()); end if;
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' you'
      || case when v_n = 0 then '' when v_n = 1 then ' and one other' else ' and ' || v_n || ' others' end
      || ' take ' || faith_pct(spell_fx(p_spell, 'cut')) || ' less from every blow.';

  -- An Unbreakable: no blow aimed at you lands, for as long as it says (`hurt_player`).
  when 'warder_unbreakable' then
    perform blessing_put(p_world, p_uid, 'unbreakable', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs'))));
    perform class_learn_heal(p_world, p_uid, p_uid);
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' no blow aimed at you lands.';

  else
    return jsonb_build_object('why', 'Nothing is written behind that spell yet.');
  end case;

  -- A Kindler's spell is cast out of the stone, and teaches the school as an Ember does (`rpc_spell`); and one that dealt fire
  -- spends the Stoke that was waiting for it (`kindler_fire_at`).
  if s.class = 'kindler' then
    perform skill_raise(p_world, p_uid, 'kindling', 0.8);
    if v_fired then
      update player set blessings = blessings - 'stoke' where world_id = p_world and uid = p_uid and blessings ? 'stoke';
    end if;
  end if;
  -- And a Binder's teaches binding the same, and a Warder's warding.
  if s.class = 'binder' then perform skill_raise(p_world, p_uid, 'binding', 0.8); end if;
  if s.class = 'warder' then perform skill_raise(p_world, p_uid, 'warding', 0.8); end if;

  -- The blow it struck goes back with the sentence, for whoever cast it to read the numbers of (`class_blow`).
  return jsonb_build_object('said', v_said)
    || case when b is not null then jsonb_build_object('blow', b) else '{}'::jsonb end
    || case when v_put is not null then jsonb_build_object('put', v_put) else '{}'::jsonb end
    || case when v_pace is not null then jsonb_build_object('pace', v_pace) else '{}'::jsonb end;
end $function$;

/* A patron's spell, as it was, telling a cast what it did where that is done in the spell itself. */
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
    perform fx_beast(c.id::int, v_h, 'hold');
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
    perform fx_beast(c.id::int, spell_fx(p_spell, 'secs'), 'bleed');
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
    perform fx_beast(c.id::int, spell_fx(p_spell, 'secs'), 'weak');
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
      perform fx_beast(c.id::int, spell_fx(p_spell, 'secs'), 'bleed');
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

/* The six arcane spells, as they were, telling a cast what they did. */
CREATE OR REPLACE FUNCTION public.do_spell(p_world uuid, p_uid uuid, p_spell text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare d spell_def; p player; it item; v_force double precision; v_secs double precision;
        v_rng double precision; v_n int := 0; c creature; r record; v_name text;
        v_cx double precision; v_cy double precision; v_thick double precision; v_size double precision;
begin
  select * into d from spell_def where id = p_spell;
  select * into p from player where world_id = p_world and uid = p_uid;
  it := focus_for(p_world, p_uid, d.gem);
  v_force := spell_force(p_world, p_uid, d, it);
  -- And a hold the longer for the focus setter's Keen Focus.
  v_secs := spell_secs(p_world, p_uid, d) * mark_of(it.mark, 'force');
  v_rng := spell_range(p_world, p_uid, d);
  v_name := 'it';

  if d.school = 'kindling' then
    if d.at_what = 'creature' then
      select * into c from creature where world_id = p_world and id = (p_target->>'id')::int;
      if not found then return 'There is nothing there.'; end if;
      v_name := lower((select name from species_def where id = c.species));
      perform wound_beast(p_world, c.id, v_force, p.x, p.y, p_uid, null);
      perform fx_beast(c.id);
      v_n := round(v_force);
    else
      for c in select * from creature where world_id = p_world and mode = 'wild'
          and to_x between p.x - v_rng and p.x + v_rng
          and to_y between p.y - v_rng and p.y + v_rng loop
        perform wound_beast(p_world, c.id, v_force, p.x, p.y, p_uid, null);
        perform fx_beast(c.id);
        v_n := v_n + 1;
      end loop;
    end if;

  elsif d.school = 'binding' then
    /*
     * A hold is the `until` the clock already reads before it settles an
     * animal: set it forward and the animal is simply not due, which is what
     * standing still is here. The leg it was on is ended where it had got to,
     * so it stops rather than sliding on to wherever it was going.
     */
    if d.at_what = 'creature' then
      select * into c from creature where world_id = p_world and id = (p_target->>'id')::int;
      if not found then return 'There is nothing there.'; end if;
      v_name := lower((select name from species_def where id = c.species));
      v_cx := creature_x(c); v_cy := creature_y(c);
      update creature set until = now() + make_interval(secs => v_secs),
             from_x = v_cx, from_y = v_cy, to_x = v_cx, to_y = v_cy,
             leg_at = now(), leg_ends = now(), enemy = null, hunting = null
        where world_id = p_world and id = c.id;
      -- Marked as held, as a trade's hold is (`class_hold`), for a Binder's Shatter and Frost Ward to ask.
      insert into class_mark (world_id, creature_id, kind, val, until)
        values (p_world, c.id, 'hold', 1, now() + make_interval(secs => v_secs))
        on conflict (world_id, creature_id, kind) do update
          set val = case when class_mark.until > now() then class_mark.val else excluded.val end,
              by_uid = case when class_mark.until > now() then class_mark.by_uid end,
              until = greatest(class_mark.until, excluded.until);
      perform fx_beast(c.id, v_secs, 'hold');
      v_n := round(v_secs);
    else
      for c in select * from creature where world_id = p_world and mode = 'wild'
          and to_x between p.x - v_rng and p.x + v_rng
          and to_y between p.y - v_rng and p.y + v_rng loop
        v_cx := creature_x(c); v_cy := creature_y(c);
        update creature set until = now() + make_interval(secs => v_secs),
               from_x = v_cx, from_y = v_cy, to_x = v_cx, to_y = v_cy,
               leg_at = now(), leg_ends = now(), enemy = null, hunting = null
          where world_id = p_world and id = c.id;
        -- Marked as held, as a trade's hold is (`class_hold`), for a Binder's Shatter and Frost Ward to ask.
        insert into class_mark (world_id, creature_id, kind, val, until)
          values (p_world, c.id, 'hold', 1, now() + make_interval(secs => v_secs))
          on conflict (world_id, creature_id, kind) do update
            set val = case when class_mark.until > now() then class_mark.val else excluded.val end,
                by_uid = case when class_mark.until > now() then class_mark.by_uid end,
                until = greatest(class_mark.until, excluded.until);
        perform fx_beast(c.id, v_secs, 'hold');
        v_n := v_n + 1;
      end loop;
    end if;

  else
    -- Warding. A skin of the spell's force in hundredths of health, laid as a
    -- Warder lays one: larger for their Thick Skin, over somebody else for their
    -- Protector, and by a Thicken waiting (`warder_skin_size`), and over a skin
    -- already there only where it is the larger, or added to it for their
    -- Overcharge (`warder_skin_put`). Casting it again refreshes a skin rather
    -- than stacking one inside another.
    v_thick := warder_thicken_at(p_world, p_uid);
    perform warder_thicken_take(p_world, p_uid);
    if d.at_what = 'self' then
      v_size := warder_skin_size(p_world, p_uid, p_uid, v_force / 100, v_thick);
      perform warder_skin_put(p_world, p_uid, p_uid, v_size);
      v_n := round(v_size * 100);
    else
      for r in select uid from player where world_id = p_world and not away
          and x between p.x - v_rng and p.x + v_rng
          and y between p.y - v_rng and p.y + v_rng loop
        perform warder_skin_put(p_world, p_uid, r.uid, warder_skin_size(p_world, p_uid, r.uid, v_force / 100, v_thick));
        if r.uid <> p_uid then
          perform tell(p_world, r.uid, 'Something closes over you, put there by somebody else.', 'system');
        end if;
        v_n := v_n + 1;
      end loop;
    end if;
  end if;

  return replace(replace(d.done, '{n}', v_n::text), '{t}', v_name);
end $function$;

/* The door, now saying what the cast did with the rest of its answer. */
CREATE OR REPLACE FUNCTION public.rpc_cast_spell(p_world uuid, p_slot integer, p_target jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); v_spell text; v_why text; s spell_any; v_at jsonb; v_out jsonb; v_was jsonb; v_told jsonb;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  if not exists (select 1 from spell_slot where slot = p_slot) then
    return jsonb_build_object('why', 'There is no such slot.');
  end if;
  select spell_bar->>p_slot into v_spell from player where world_id = p_world and uid = me;
  if v_spell is null then return jsonb_build_object('why', 'Nothing is in that slot.'); end if;
  v_why := spell_cast_refusal(p_world, me, v_spell);
  if v_why is not null then return jsonb_build_object('why', v_why); end if;
  select * into s from spell_any where id = v_spell;
  v_at := spell_target(p_world, me, v_spell, coalesce(p_target, '{}'::jsonb));
  if v_at ? 'why' then return v_at; end if;
  -- What it did, told as it is done (`fx_open`), and the spells of yours it may use up, as they were before it.
  select blessings into v_was from player where world_id = p_world and uid = me;
  perform fx_open();
  if s.school = 'class' then
    -- A fighting trade's (`class_spell_cast`), paid in stamina, and where a Lunge put you, for the browser to follow.
    v_out := class_spell_cast(p_world, me, v_spell, v_at);
    v_told := fx_told(p_world, me, v_was);
    if v_out ? 'why' then return v_out; end if;
    update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}',
          -- Less for a Kindler's Deep Breath.
          to_jsonb(greatest(0, coalesce((stats->>'stamina')::double precision, 1) - s.cost * pk(class_mul, 'cast:cost', 1)))),
        used_at = jsonb_set(coalesce(used_at, '{}'::jsonb), array['spell:' || s.id], to_jsonb(now()), true)
      where world_id = p_world and uid = me;
    -- And a Kindler's fire the larger for it, for a Blaze Momentum (`class_momentum`).
    perform class_momentum(p_world, me);
    perform tell(p_world, me, v_out->>'said', 'system');
    return faith_said(p_world, me) || jsonb_build_object('cast', s.id, 'said', v_out->>'said')
      || case when v_out ? 'put' then jsonb_build_object('put', v_out->'put') else '{}'::jsonb end
      || case when v_out ? 'pace' then jsonb_build_object('pace', v_out->'pace') else '{}'::jsonb end
      -- And what it did, for the browser to draw (`fx_told`).
      || v_told;
  end if;
  v_out := faith_spell_cast(p_world, me, v_spell, v_at);
  v_told := fx_told(p_world, me, v_was);
  if v_out ? 'why' then return v_out; end if;
  perform favour_settle(p_world, me);
  update player set favour = greatest(0, favour - s.cost),
      used_at = jsonb_set(coalesce(used_at, '{}'::jsonb), array['spell:' || s.id], to_jsonb(now()), true)
    where world_id = p_world and uid = me;
  perform class_momentum(p_world, me);
  perform skill_raise(p_world, me, faith_skill(), 0.6);
  perform tell(p_world, me, v_out->>'said', 'system');
  return faith_said(p_world, me) || jsonb_build_object('cast', s.id, 'said', v_out->>'said') || v_told;
end $function$;

/* And the arcane door the same. */
CREATE OR REPLACE FUNCTION public.rpc_spell(p_world uuid, p_spell text, p_target jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); d spell_def; sc school_def; it item; v_why text;
        v_wear double precision; v_said text; v_gone boolean := false; v_was jsonb; v_told jsonb;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  select * into d from spell_def where id = p_spell;
  if not found then return jsonb_build_object('why', 'There is no such spell.'); end if;
  v_why := spell_refusal(p_world, me, p_spell);
  if v_why is not null then return jsonb_build_object('why', v_why); end if;

  select * into sc from school_def where id = d.school;
  it := focus_for(p_world, me, d.gem);
  v_wear := spell_wear(p_world, me, d, it);
  select blessings into v_was from player where world_id = p_world and uid = me;
  perform fx_open();
  v_said := do_spell(p_world, me, p_spell, p_target);
  v_told := fx_told(p_world, me, v_was);

  update item set dmg = least(100, coalesce(dmg, 0) + v_wear) where id = it.id;
  if (select dmg from item where id = it.id) >= 100 then
    delete from item where id = it.id;
    v_gone := true;
  end if;
  perform skill_raise(p_world, me, sc.skill, 0.8);
  perform tell(p_world, me, v_said || case when v_gone
    then ' The ' || d.gem || ' goes to grit in your palm; there was nothing left in it.'
    else '' end, 'event');
  return jsonb_build_object('cast', d.id, 'said', v_said, 'wear', round(v_wear::numeric, 2),
    'spent', v_gone,
    'left', case when v_gone then 0 else round((100 - (select dmg from item where id = it.id))::numeric, 1) end)
    || v_told;
end $function$;

select private.lock_doors();
