/*
 * Patrons, the spells they give, and the spell bar (`src/game/patrons.ts`).
 *
 *   * At `patron_at` faith a body takes one of the three patrons in
 *     `patron_def`, once and for good (`rpc_take_patron`, refused in the
 *     words of `patron_refusal`).
 *   * Each patron offers `spells_per_tier` spells at each tier in
 *     `faith_tier`, and one is taken at each (`rpc_take_faith_spell`, refused
 *     by `faith_spell_refusal`). What is taken is kept in `player_spell`, and
 *     a spell taken goes onto the first empty faith slot of the bar.
 *   * The bar is six slots, each for one school (`spell_slot`): three for a
 *     trade's spells, two for a patron's, one for a path's. `rpc_spell_bar`
 *     puts a spell you have in a slot of its school, or empties one
 *     (`spell_slot_refusal`).
 *   * `rpc_cast_spell` calls what is in a slot: refused by
 *     `spell_cast_refusal` while it is resting or the favour is short, then
 *     worked by `faith_spell_cast`, and only a spell that did something costs
 *     its favour and starts its rest. No spell is written yet, so that has
 *     nothing in it.
 *   * `rpc_faith` says all of it at once (`faith_said`), and so does every
 *     door here, so the window and the bar never ask twice.
 *
 * And the faith skill is called Faith now, so the two refusals that named it
 * say faith; and every door is locked again at the end, which the last few
 * fight migrations never did, so the helpers they added were open to anybody.
 */
set local lock_timeout = '3s';

alter table player add column if not exists patron text;
alter table player add column if not exists spell_bar jsonb not null default '[]'::jsonb;

create table if not exists player_spell (
  world_id uuid not null,
  uid uuid not null,
  spell text not null,
  took timestamptz not null default now(),
  primary key (world_id, uid, spell),
  foreign key (world_id, uid) references player (world_id, uid) on delete cascade
);
alter table player_spell enable row level security;
drop policy if exists player_spell_read on player_spell;
create policy player_spell_read on player_spell for select to anon, authenticated
  using (uid = (select auth.uid()));
grant select on player_spell to anon, authenticated;

-- The faith skill, by the name the skills window gives it.
create or replace function faith_word() returns text language sql stable as $fn$
  select lower(coalesce((select name from skill_def where id = faith_skill()), 'faith'))
$fn$;

-- Why this patron cannot be taken (`patronRefusal`).
create or replace function patron_refusal(p_world uuid, p_uid uuid, p_patron text) returns text
 language plpgsql stable as $fn$
declare d patron_def; p player; v_faith double precision;
begin
  select * into d from patron_def where id = p_patron;
  if not found then return 'There is no such patron.'; end if;
  select * into p from player where world_id = p_world and uid = p_uid;
  if not found then return 'You are not on this island.'; end if;
  if p.patron is not null then
    return coalesce((select name from patron_def where id = p.patron), p.patron)
        || ' is your patron already, and a patron is for good.';
  end if;
  v_faith := skill_of(p_world, p_uid, faith_skill());
  if v_faith < patron_at() then
    return 'A patron is taken at ' || patron_at()::int || ' ' || faith_word() || '; you have ' || floor(v_faith)::int || '.';
  end if;
  return null;
end $fn$;

-- Why a faith spell cannot be taken (`faithSpellRefusal`).
create or replace function faith_spell_refusal(p_world uuid, p_uid uuid, p_spell text) returns text
 language plpgsql stable as $fn$
declare s faith_spell; p player; v_other text; v_at int; v_faith double precision;
begin
  select * into s from faith_spell where id = p_spell;
  if not found then return 'There is no such spell.'; end if;
  select * into p from player where world_id = p_world and uid = p_uid;
  if not found then return 'You are not on this island.'; end if;
  if p.patron is null then return 'Take a patron first.'; end if;
  if s.patron <> p.patron then
    return 'That is ' || coalesce((select name from patron_def where id = s.patron), s.patron) || '’s, and '
        || coalesce((select name from patron_def where id = p.patron), p.patron) || ' is your patron.';
  end if;
  if exists (select 1 from player_spell where world_id = p_world and uid = p_uid and spell = p_spell) then
    return 'You have that already.';
  end if;
  select o.name into v_other from player_spell ps join faith_spell o on o.id = ps.spell
   where ps.world_id = p_world and ps.uid = p_uid and o.patron = s.patron and o.tier = s.tier
   limit 1;
  if v_other is not null then return 'You took ' || v_other || ' at this tier.'; end if;
  v_at := (select at from faith_tier where tier = s.tier);
  v_faith := skill_of(p_world, p_uid, faith_skill());
  if v_faith < v_at then
    return 'This tier opens at ' || v_at || ' ' || faith_word() || '; you have ' || floor(v_faith)::int || '.';
  end if;
  return null;
end $fn$;

-- The school a spell is of (`schoolOf`); only faith spells are written yet.
create or replace function spell_school(p_spell text) returns text language sql stable as $fn$
  select case when exists (select 1 from faith_spell where id = p_spell) then 'faith' end
$fn$;

-- Why this spell cannot go in this slot of the bar (`slotRefusal`). Emptying a slot never is.
create or replace function spell_slot_refusal(p_world uuid, p_uid uuid, p_slot int, p_spell text) returns text
 language plpgsql stable as $fn$
declare v_want text; v_school text;
begin
  select school into v_want from spell_slot where slot = p_slot;
  if not found then return 'There is no such slot.'; end if;
  if p_spell is null then return null; end if;
  v_school := spell_school(p_spell);
  if v_school is null
     or not exists (select 1 from player_spell where world_id = p_world and uid = p_uid and spell = p_spell) then
    return 'You do not have that spell.';
  end if;
  if v_school <> v_want then return 'That slot is for ' || v_want || ' spells.'; end if;
  return null;
end $fn$;

-- Put a spell in a slot, or empty it, taking it out of any other slot it was in.
create or replace function spell_bar_put(p_world uuid, p_uid uuid, p_slot int, p_spell text) returns void
 language sql as $fn$
  update player p set spell_bar = (
    select jsonb_agg(case when s.slot = p_slot then coalesce(to_jsonb(p_spell), 'null'::jsonb)
                          when p.spell_bar->>s.slot = p_spell then 'null'::jsonb
                          else coalesce(p.spell_bar->s.slot, 'null'::jsonb) end order by s.slot)
      from spell_slot s)
   where p.world_id = p_world and p.uid = p_uid
$fn$;

-- Seconds before a spell can be called again; nothing when it can be now.
create or replace function spell_rest_left(p_used jsonb, p_spell text, p_rest double precision) returns double precision
 language sql stable as $fn$
  select greatest(0, p_rest - coalesce(extract(epoch from now() - (p_used->>('spell:' || p_spell))::timestamptz), p_rest))
$fn$;

-- Why a spell cannot be called now: not yours, resting, or the favour is short.
create or replace function spell_cast_refusal(p_world uuid, p_uid uuid, p_spell text) returns text
 language plpgsql as $fn$
declare s faith_spell; p player; v_left double precision; v_favour double precision;
begin
  select * into s from faith_spell where id = p_spell;
  if not found then return 'There is no such spell.'; end if;
  if not exists (select 1 from player_spell where world_id = p_world and uid = p_uid and spell = p_spell) then
    return 'You do not have that spell.';
  end if;
  select * into p from player where world_id = p_world and uid = p_uid;
  if not found then return 'You are not on this island.'; end if;
  v_left := spell_rest_left(p.used_at, s.id, s.rest);
  if v_left > 0 then return s.name || ' can be called again in ' || ceil(v_left)::int || ' seconds.'; end if;
  v_favour := favour_settle(p_world, p_uid);
  if v_favour < s.cost then
    return s.name || ' costs ' || s.cost::int || ' favour; you hold ' || floor(v_favour)::int || '. Pray at an altar.';
  end if;
  return null;
end $fn$;

/*
 * What a spell does, once nothing refuses it: `{said}` for the log when it
 * worked, or `{why}` when what it was pointed at will not take it, in which
 * case it costs nothing. Each spell is one arm of this, as it is written.
 */
create or replace function faith_spell_cast(p_world uuid, p_uid uuid, p_spell text, p_target jsonb) returns jsonb
 language plpgsql as $fn$
begin
  return jsonb_build_object('why', 'Nothing is written behind that spell yet.');
end $fn$;

-- Everything the Faith window and the spell bar draw, in one answer.
create or replace function faith_said(p_world uuid, p_uid uuid) returns jsonb
 language plpgsql as $fn$
declare p player; v_faith double precision; v_favour double precision;
begin
  select * into p from player where world_id = p_world and uid = p_uid;
  if not found then return jsonb_build_object('why', 'You are not on this island.'); end if;
  v_favour := favour_settle(p_world, p_uid);
  v_faith := skill_of(p_world, p_uid, faith_skill());
  return jsonb_build_object(
    'faith', v_faith,
    'favour', floor(v_favour),
    'cap', floor(favour_cap(v_faith)),
    'patron', p.patron,
    'patrons', coalesce((select jsonb_object_agg(d.id, patron_refusal(p_world, p_uid, d.id)) from patron_def d), '{}'::jsonb),
    'taken', coalesce((select jsonb_agg(ps.spell order by ps.took) from player_spell ps
                        where ps.world_id = p_world and ps.uid = p_uid), '[]'::jsonb),
    'spells', coalesce((select jsonb_object_agg(s.id, faith_spell_refusal(p_world, p_uid, s.id))
                          from faith_spell s where s.patron = p.patron), '{}'::jsonb),
    'bar', (select jsonb_agg(coalesce(p.spell_bar->s.slot, 'null'::jsonb) order by s.slot) from spell_slot s),
    'rest', coalesce((select jsonb_object_agg(s.id, spell_rest_left(p.used_at, s.id, s.rest))
                        from faith_spell s where p.used_at ? ('spell:' || s.id)), '{}'::jsonb)
  );
end $fn$;

create or replace function rpc_faith(p_world uuid) returns jsonb
 language plpgsql security definer set search_path to 'public' as $fn$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  return faith_said(p_world, me);
end $fn$;

create or replace function rpc_take_patron(p_world uuid, p_patron text) returns jsonb
 language plpgsql security definer set search_path to 'public' as $fn$
declare me uuid := auth.uid(); d patron_def; v_why text;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  v_why := patron_refusal(p_world, me, p_patron);
  if v_why is not null then return jsonb_build_object('why', v_why); end if;
  select * into d from patron_def where id = p_patron;
  update player set patron = d.id where world_id = p_world and uid = me;
  perform tell(p_world, me, d.name || ' is your patron.', 'system');
  return faith_said(p_world, me) || jsonb_build_object('took', d.id);
end $fn$;

create or replace function rpc_take_faith_spell(p_world uuid, p_spell text) returns jsonb
 language plpgsql security definer set search_path to 'public' as $fn$
declare me uuid := auth.uid(); s faith_spell; v_why text; v_slot int;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  v_why := faith_spell_refusal(p_world, me, p_spell);
  if v_why is not null then return jsonb_build_object('why', v_why); end if;
  select * into s from faith_spell where id = p_spell;
  insert into player_spell (world_id, uid, spell) values (p_world, me, p_spell)
    on conflict (world_id, uid, spell) do nothing;
  -- Onto the bar, in the first faith slot with nothing in it, when there is one.
  select min(sl.slot) into v_slot from spell_slot sl, player p
   where p.world_id = p_world and p.uid = me and sl.school = 'faith' and (p.spell_bar->>sl.slot) is null;
  if v_slot is not null then perform spell_bar_put(p_world, me, v_slot, p_spell); end if;
  perform tell(p_world, me, s.name || '. ' || s.note, 'system');
  return faith_said(p_world, me) || jsonb_build_object('took', s.id);
end $fn$;

create or replace function rpc_spell_bar(p_world uuid, p_slot int, p_spell text) returns jsonb
 language plpgsql security definer set search_path to 'public' as $fn$
declare me uuid := auth.uid(); v_why text;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  v_why := spell_slot_refusal(p_world, me, p_slot, p_spell);
  if v_why is not null then return jsonb_build_object('why', v_why); end if;
  perform spell_bar_put(p_world, me, p_slot, p_spell);
  return faith_said(p_world, me);
end $fn$;

create or replace function rpc_cast_spell(p_world uuid, p_slot int, p_target jsonb default '{}'::jsonb) returns jsonb
 language plpgsql security definer set search_path to 'public' as $fn$
declare me uuid := auth.uid(); v_spell text; v_why text; s faith_spell; v_out jsonb;
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
  v_out := faith_spell_cast(p_world, me, v_spell, coalesce(p_target, '{}'::jsonb));
  if v_out ? 'why' then return v_out; end if;
  perform favour_settle(p_world, me);
  update player set favour = greatest(0, favour - s.cost),
      used_at = jsonb_set(coalesce(used_at, '{}'::jsonb), array['spell:' || s.id], to_jsonb(now()), true)
    where world_id = p_world and uid = me;
  perform skill_raise(p_world, me, faith_skill(), 0.6);
  perform tell(p_world, me, v_out->>'said', 'system');
  return faith_said(p_world, me) || jsonb_build_object('cast', s.id, 'said', v_out->>'said');
end $fn$;


-- The faith skill is Faith in every word now (`castReason`, `riteRefusal`).
CREATE OR REPLACE FUNCTION public.cast_reason(p_world uuid, p_uid uuid, p_cast text, p_uid_item bigint)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare d cast_def; it item; faith double precision; have double precision;
begin
  select * into d from cast_def where id = p_cast;
  if not found then return 'Choose what to call for.'; end if;
  faith := skill_of(p_world, p_uid, faith_skill());
  if faith < d.level then
    return d.name || ' takes ' || to_char(d.level, 'FM990') || ' faith; you have '
      || to_char(faith, 'FM990') || '.';
  end if;
  have := favour_settle(p_world, p_uid);
  if have < d.cost then
    return d.name || ' costs ' || to_char(d.cost, 'FM990') || ' favour; you hold '
      || to_char(floor(have), 'FM990') || '. Pray at an altar.';
  end if;
  if p_uid_item is not null then
    select * into it from item where world_id = p_world and id = p_uid_item
      and holder = 'player' and holder_uid = p_uid;
  end if;
  if d.on_what = 'item' and it.id is null then return 'Choose something to lay it on.'; end if;
  if p_cast = 'mend' and it.id is not null and unrestored(it.def) then return not_restored_says(); end if;
  if p_cast = 'mend' and it.id is not null and it.dmg <= 0 then
    return 'There is nothing wrong with the ' || lower(item_name(it)) || '.';
  end if;
  if p_cast = 'cunning' and it.id is not null then
    if coalesce(it.bless, 0) >= bless_cap() then
      return 'The ' || lower(item_name(it)) || ' has taken all it will take.';
    end if;
    if it.issued then return 'What you washed ashore with has nothing in it to work on.'; end if;
  end if;
  if p_cast = 'call' and not exists (select 1 from creature c where c.world_id = p_world
      and c.mode = 'active' and c.keeper = p_uid) then
    return 'Nothing travels with you.';
  end if;
  if p_cast = 'dawnlight' and jsonb_array_length((select wounds from player
      where world_id = p_world and uid = p_uid)) = 0 then
    return 'Nothing is open on you.';
  end if;
  if p_cast = 'bounty' and (my_deed(p_world, p_uid)).world_id is null then
    return 'You have no settlement, and so no fields.';
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.rite_refusal(p_world uuid, p_uid uuid, p_rite text)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare r rite_def; c class_def; p player; v_mine text; v_have double precision; v_rest double precision;
begin
  select * into r from rite_def where id = p_rite;
  if not found then return 'There is no such rite.'; end if;
  select * into p from player where world_id = p_world and uid = p_uid;
  if not found then return 'You are not on this island.'; end if;
  select * into c from class_def where id = r.class;
  v_mine := case when c.kind = 'craft' then p.craft_class else p.combat_class end;
  if v_mine is distinct from r.class then
    return 'That is the ' || lower(c.name) || '’s to call, and you are not one.';
  end if;
  if skill_of(p_world, p_uid, faith_skill()) < r.level then
    return r.name || ' takes ' || r.level::int || ' faith; you have '
        || floor(skill_of(p_world, p_uid, faith_skill()))::int || '.';
  end if;
  v_have := favour_settle(p_world, p_uid);
  if v_have < r.cost then
    return r.name || ' costs ' || r.cost::int || ' favour; you hold '
        || floor(v_have)::int || '. Pray at an altar.';
  end if;
  -- Never called is not "called infinitely long ago": subtracting -infinity
  -- from a timestamp is an error rather than a large number, and a rite
  -- nobody has ever called is simply ready.
  v_rest := case when coalesce(p.used_at, '{}'::jsonb) ? ('rite:' || r.id)
                 then r.rest - extract(epoch from (now() - (p.used_at->>('rite:' || r.id))::timestamptz))
                 else 0 end;
  if v_rest > 0 then
    return r.name || ' again in ' || ceil(v_rest / 60)::int || ' minutes.';
  end if;
  return null;
end $function$;

-- And every door shut again but the rpc_ ones, which the fight migrations left open.
select private.lock_doors();
