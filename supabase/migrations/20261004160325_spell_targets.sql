/*
 * Five faith tiers, and six kinds of thing a spell is cast on
 * (`src/game/patrons.ts`).
 *
 *   * The tiers are rows of `faith_tier`, and the definitions before this put
 *     five in place of nine: 20, 40, 60, 80 and 99 faith.
 *   * A spell names every kind it takes in `faith_spell.on_what`, a list now
 *     where it was one word: yourself, another person, a wildermon, an enemy,
 *     a thing, or the ground within the spell's own `radius` of a spot.
 *   * `spell_target` finds what `rpc_cast_spell` was pointed at and says why
 *     it will not do, in the words of `spellTargetRefusal`, or hands the
 *     spell's arm in `faith_spell_cast` what it counts as -- `{kind, ...}` --
 *     so no arm has to look again.
 *
 * No spell is written yet, so the column is changed on an empty table.
 */
set local lock_timeout = '3s';

do $do$
begin
  if (select data_type from information_schema.columns
       where table_schema = 'public' and table_name = 'faith_spell' and column_name = 'on_what') = 'text' then
    alter table faith_spell alter column on_what type text[] using array[on_what];
  end if;
end $do$;
alter table faith_spell add column if not exists radius double precision;

-- "a, b or c", as `listedOr` says it.
create or replace function listed_or(p text[]) returns text language sql immutable as $fn$
  select case when coalesce(array_length(p, 1), 0) < 2 then coalesce(p[1], '')
              else array_to_string(p[1:array_length(p, 1) - 1], ', ') || ' or ' || p[array_length(p, 1)] end
$fn$;

/*
 * What a spell was pointed at, and what it counts as for that spell, or
 * `{why}`. `p_target` is `{kind: 'self'}`, `{kind: 'player', uid}`,
 * `{kind: 'creature', id}`, `{kind: 'item', id}`, `{kind: 'placed', id}` or
 * `{kind: 'area'}` with an `x` and `y` when it is not where you stand; nothing
 * at all is yourself. A creature counts as an enemy when it is wild and as a
 * wildermon when it is not after you, so one minding its own business is
 * either. Anything but you and what you carry is within `spell_reach` tiles.
 */
create or replace function spell_target(p_world uuid, p_uid uuid, p_spell text, p_target jsonb) returns jsonb
 language plpgsql stable as $fn$
declare s faith_spell; me player; pl player; c creature; pc placed;
        v_kind text := coalesce(p_target->>'kind', 'self');
        v_id bigint := case when p_target->>'id' ~ '^[0-9]{1,18}$' then (p_target->>'id')::bigint end;
        v_uid uuid := case when p_target->>'uid' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                           then (p_target->>'uid')::uuid end;
        v_found boolean := true; v_dist double precision := 0; v_you boolean := false;
        v_wild boolean := false; v_after boolean := false; v_on text;
        v_x double precision; v_y double precision;
begin
  select * into s from faith_spell where id = p_spell;
  select * into me from player where world_id = p_world and uid = p_uid;
  if v_kind = 'player' then
    select * into pl from player where world_id = p_world and uid = v_uid and not away;
    v_found := found;
    if v_found then
      v_you := pl.uid = p_uid;
      v_dist := sqrt((pl.x - me.x) ^ 2 + (pl.y - me.y) ^ 2);
    end if;
  elsif v_kind = 'creature' then
    select * into c from creature where world_id = p_world and id = v_id and health > 0;
    v_found := found;
    if v_found then
      v_wild := c.mode = 'wild';
      v_after := c.hunting is not distinct from p_uid;
      v_dist := sqrt((creature_x(c) - me.x) ^ 2 + (creature_y(c) - me.y) ^ 2);
    end if;
  elsif v_kind = 'item' then
    v_found := exists (select 1 from item where world_id = p_world and id = v_id and holder = 'player' and holder_uid = p_uid);
  elsif v_kind = 'placed' then
    select * into pc from placed where world_id = p_world and id = v_id;
    v_found := found;
    if v_found then v_dist := sqrt((pc.x + 0.5 - me.x) ^ 2 + (pc.y + 0.5 - me.y) ^ 2); end if;
  elsif v_kind = 'area' then
    v_x := case when jsonb_typeof(p_target->'x') = 'number' then (p_target->>'x')::double precision else me.x end;
    v_y := case when jsonb_typeof(p_target->'y') = 'number' then (p_target->>'y')::double precision else me.y end;
    v_dist := sqrt((v_x - me.x) ^ 2 + (v_y - me.y) ^ 2);
  elsif v_kind <> 'self' then
    v_found := false;
  end if;
  if not v_found then return jsonb_build_object('why', 'That is not here.'); end if;

  v_on := case v_kind
    when 'self' then case when 'self' = any (s.on_what) then 'self' end
    when 'player' then case when v_you then case when 'self' = any (s.on_what) then 'self' end
                            when 'player' = any (s.on_what) then 'player' end
    when 'creature' then case when 'enemy' = any (s.on_what) and v_wild then 'enemy'
                              when 'wildermon' = any (s.on_what) and not v_after then 'wildermon' end
    when 'item' then case when 'object' = any (s.on_what) then 'object' end
    when 'placed' then case when 'object' = any (s.on_what) then 'object' end
    when 'area' then case when 'area' = any (s.on_what) then 'area' end
  end;
  if v_on is null then
    if v_kind = 'creature' and 'enemy' = any (s.on_what) and not v_wild then
      return jsonb_build_object('why', 'That is tame, not an enemy.');
    end if;
    if v_kind = 'creature' and 'wildermon' = any (s.on_what) and v_after then
      return jsonb_build_object('why', 'That is after you.');
    end if;
    return jsonb_build_object('why', s.name || ' is cast on ' || listed_or(array(
      select d.word from unnest(s.on_what) with ordinality k(id, n) join spell_on_def d on d.id = k.id order by k.n)) || '.');
  end if;
  if v_dist > spell_reach() then
    return jsonb_build_object('why', 'That is more than ' || spell_reach() || ' tiles away.');
  end if;

  return case v_on
    when 'self' then jsonb_build_object('kind', 'self', 'uid', p_uid)
    when 'player' then jsonb_build_object('kind', 'player', 'uid', pl.uid)
    when 'enemy' then jsonb_build_object('kind', 'enemy', 'id', c.id)
    when 'wildermon' then jsonb_build_object('kind', 'wildermon', 'id', c.id)
    when 'object' then case when v_kind = 'item' then jsonb_build_object('kind', 'object', 'item', v_id)
                            else jsonb_build_object('kind', 'object', 'placed', v_id) end
    else jsonb_build_object('kind', 'area', 'x', v_x, 'y', v_y, 'radius', coalesce(s.radius, 0))
  end;
end $fn$;

/*
 * What a spell does, once nothing refuses it: `{said}` for the log when it
 * worked, or `{why}` when what it was pointed at will not take it, in which
 * case it costs nothing. `p_target` is what `spell_target` made of it. Each
 * spell is one arm of this, as it is written.
 */
create or replace function faith_spell_cast(p_world uuid, p_uid uuid, p_spell text, p_target jsonb) returns jsonb
 language plpgsql as $fn$
begin
  return jsonb_build_object('why', 'Nothing is written behind that spell yet.');
end $fn$;

create or replace function rpc_cast_spell(p_world uuid, p_slot int, p_target jsonb default '{}'::jsonb) returns jsonb
 language plpgsql security definer set search_path to 'public' as $fn$
declare me uuid := auth.uid(); v_spell text; v_why text; s faith_spell; v_at jsonb; v_out jsonb;
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
  select * into s from faith_spell where id = v_spell;
  v_at := spell_target(p_world, me, v_spell, coalesce(p_target, '{}'::jsonb));
  if v_at ? 'why' then return v_at; end if;
  v_out := faith_spell_cast(p_world, me, v_spell, v_at);
  if v_out ? 'why' then return v_out; end if;
  perform favour_settle(p_world, me);
  update player set favour = greatest(0, favour - s.cost),
      used_at = jsonb_set(coalesce(used_at, '{}'::jsonb), array['spell:' || s.id], to_jsonb(now()), true)
    where world_id = p_world and uid = me;
  perform skill_raise(p_world, me, faith_skill(), 0.6);
  perform tell(p_world, me, v_out->>'said', 'system');
  return faith_said(p_world, me) || jsonb_build_object('cast', s.id, 'said', v_out->>'said');
end $fn$;

select private.lock_doors();
