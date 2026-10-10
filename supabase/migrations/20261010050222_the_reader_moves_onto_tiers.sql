/*
 * Meditation, phase one: the framework every path will use, and the
 * Knowledge path moved onto it (`src/game/meditation.ts`).
 *
 *   * A path is chosen at `choose_at()` meditation, which is now the first of
 *     the five tiers (`path_tier`, the numbers a patron's tiers of faith open
 *     at). Whoever has chosen keeps their path whatever their meditation.
 *   * A path has either kept its old steps (`path_step`) or **moved**
 *     (`path_def.moved`): no steps, no old abilities, and at each tier one
 *     technique and two disciplines (`path_pick`), one of which is taken
 *     through `rpc_take_path_pick` and kept in `path_taken`. Knowledge has
 *     moved; Love and Power keep their steps, every one of them as it was.
 *     `path_steps` reads nothing on a moved path, so `walks` and `ability_of`
 *     find nothing there.
 *   * A technique is a spell of the path school (`spell_any`), put in the
 *     bar's path slot through `rpc_spell_bar` and cast through
 *     `rpc_cast_spell`, which pays it in **Calm** (`player.calm`) and rests it
 *     as it rests every spell; `path_technique_cast` does what it does. A
 *     discipline is read wherever its rule is (`path_fx`, `path_holds`).
 *   * A sitting banks `sit_calm()` Calm times the place it was sat
 *     (`sit_place`), up to `calm_cap`: favour's own curve off meditation, and
 *     more for a Deep Calm. The place now counts a mote swirl within reach
 *     and halves a spot within reach of anywhere sat since the woods last
 *     turned (`player.sat_spots`, kept with the dawn they are for, so the turn
 *     clears them without touching a row). A blow that lands in a sitting
 *     ends it with nothing come of it (`sitting_struck`, from `hurt_player`).
 *   * The beat says the path, its picks, Calm, a Foreknow's goes, a Clarity's
 *     seconds, the spots sat and the marks a Seek or a Trace left
 *     (`path_beat`), so the browser can work out sight, the map and a
 *     wildermon's blood as the island holds them.
 *
 * Sense the Rock and Recall the Way went with Knowledge's steps; nothing else
 * called on either, and `work_ability` no longer knows them.
 *
 * `supabase/test/meditation.ts` holds the two sides to each other.
 */
set local lock_timeout = '3s';

-- Calm, what a moved path's walker carries besides, and the blow that ends a sitting. One alter, so one lock.
alter table player
  add column if not exists calm real not null default 0,
  add column if not exists sat_spots jsonb not null default '[]'::jsonb,
  add column if not exists sat_dawn timestamptz,
  add column if not exists foreknow int not null default 0,
  add column if not exists clarity_until timestamptz,
  add column if not exists studied jsonb not null default '{}'::jsonb,
  add column if not exists path_marks jsonb not null default '{}'::jsonb,
  add column if not exists struck_at timestamptz;

-- The picks taken, one a tier, kept as `player_spell` keeps a patron's spells.
create table if not exists path_taken (
  world_id uuid not null,
  uid uuid not null,
  pick text not null,
  took timestamptz not null default now(),
  primary key (world_id, uid, pick),
  foreign key (world_id, uid) references player (world_id, uid) on delete cascade
);
alter table path_taken enable row level security;
drop policy if exists path_taken_read on path_taken;
create policy path_taken_read on path_taken for select to anon, authenticated
  using (uid = (select auth.uid()));
grant select on path_taken to anon, authenticated;

/* ------------------------------------------------------------------ *
 * A path moved, and what its walker holds.
 * ------------------------------------------------------------------ */

/** Whether a path has moved onto tiers. */
create or replace function path_moved(p_way text) returns boolean language sql stable as $$
  select coalesce((select moved from path_def where id = p_way), false)
$$;

/** How many steps of their path somebody has behind them: none on a path that has moved (`stepsOf`). */
create or replace function path_steps(p_way text, p_meditation double precision) returns int
  language sql stable as $$
  select case when p_way is null or path_moved(p_way) then 0 else
    (select count(*)::int from path_step s where s.path = p_way and p_meditation >= s.at) end
$$;

/** Whether a pick is somebody's: taken, of the path they walk, and that path moved (`Game.holds`). */
create or replace function path_holds(p_world uuid, p_uid uuid, p_pick text) returns boolean
  language sql stable as $$
  select exists (select 1 from path_taken t
                   join path_pick k on k.id = t.pick
                   join player p on p.world_id = t.world_id and p.uid = t.uid
                  where t.world_id = p_world and t.uid = p_uid and t.pick = p_pick
                    and p.way = k.path and path_moved(k.path))
$$;

/** One number off the disciplines somebody holds, by its key, the first taken that has it; or the rule's own (`Game.pathFx`). */
create or replace function path_fx(p_world uuid, p_uid uuid, p_key text, p_else double precision) returns double precision
  language sql stable as $$
  select coalesce((select (k.fx->>p_key)::double precision from path_taken t
                     join path_pick k on k.id = t.pick
                     join player p on p.world_id = t.world_id and p.uid = t.uid
                    where t.world_id = p_world and t.uid = p_uid and k.kind = 'discipline' and k.fx ? p_key
                      and p.way = k.path and path_moved(k.path)
                    order by t.took, t.pick limit 1), p_else)
$$;

/** Favour's curve, off the numbers `wells.ts` holds, which Calm is held to as well. */
create or replace function favour_cap(p_faith double precision) returns double precision language sql immutable as $$
  select least(favour_ceiling(), well_base() + p_faith * well_per())
$$;

/** The most Calm this much meditation holds: favour's curve, and `p_deep` times it for a Deep Calm (`calmCap`). */
create or replace function calm_cap(p_meditation double precision, p_deep double precision default 1) returns double precision
  language sql immutable as $$ select favour_cap(p_meditation) * p_deep $$;

/** The most Calm somebody holds, with their Deep Calm. */
create or replace function player_calm_cap(p_world uuid, p_uid uuid) returns double precision language sql stable as $$
  select calm_cap(skill_of(p_world, p_uid, meditation_skill()), path_fx(p_world, p_uid, 'calm', 1))
$$;

/* ------------------------------------------------------------------ *
 * A sitting.
 * ------------------------------------------------------------------ */

/**
 * What a spot multiplies a sitting by, and what sitting there says: every
 * multiplier in one place, in the browser's order and words (`sitPlace`).
 */
create or replace function sit_place(p_on_deed boolean, p_height double precision, p_water boolean, p_swirl boolean, p_stale boolean)
  returns table (place double precision, said text) language plpgsql immutable as $$
begin
  place := 1;
  said := 'You sit down and let the day go past.';
  if p_on_deed then
    place := place * sit_yard();
    said := 'You sit in your own yard. It is hard to empty your head where there is so much to do.';
  end if;
  -- High, wild ground is what the paths are walked on.
  if p_height > sit_thin_at() then
    place := place * sit_thin();
    said := 'You sit where the ground runs out and the air is thin, and the day goes past a long way below.';
  elsif p_height > sit_high_at() and not p_on_deed then
    place := place * sit_high();
    said := 'You sit on the high ground with your back to a stone.';
  end if;
  if p_water then
    place := place * sit_water();
    said := 'You sit with your feet in the water and let it go past.';
  end if;
  if p_swirl then
    place := place * sit_swirl();
    said := said || ' ' || sit_swirl_said();
  end if;
  if p_stale then
    place := place * sit_stale();
    said := said || ' ' || sit_stale_said();
  end if;
  return next;
end $$;

/** The spots somebody has sat at since the woods last turned: none, once they have turned since (`satSince`). */
create or replace function sat_spots_now(p player) returns jsonb language sql stable as $$
  select case when p.sat_dawn is not distinct from tree_last_dawn() then coalesce(p.sat_spots, '[]'::jsonb) else '[]'::jsonb end
$$;

/**
 * What a sitting where somebody stands is worth: the meditation it trains,
 * the Calm it banks, the place's multiplier and what it says (`sittingWorth`).
 */
drop function if exists sitting_worth(uuid, uuid);
create or replace function sitting_worth(p_world uuid, p_uid uuid)
  returns table (gain double precision, calm double precision, place double precision, said text) language plpgsql stable as $$
declare p player; tx int; ty int; v_deed boolean; v_swirl boolean; v_stale boolean; r record;
begin
  select * into p from player where world_id = p_world and uid = p_uid;
  tx := floor(p.x)::int; ty := floor(p.y)::int;
  v_deed := exists (select 1 from deed d where d.world_id = p_world
    and abs(tx - d.x) <= d.radius and abs(ty - d.y) <= d.radius);
  v_swirl := exists (select 1 from mote_swirl m where m.world_id = p_world
    and sqrt(((m.x - tx) ^ 2 + (m.y - ty) ^ 2)::double precision) <= sit_swirl_reach());
  v_stale := exists (select 1 from jsonb_array_elements(sat_spots_now(p)) e
    where sqrt((((e->>0)::int - tx) ^ 2 + ((e->>1)::int - ty) ^ 2)::double precision) <= sit_stale_reach());
  select * into r from sit_place(v_deed, centre_height(p_world, tx, ty), has_water(p_world, tx, ty), v_swirl, v_stale);
  place := r.place;
  said := r.said;
  gain := sit_gain() * r.place;
  calm := sit_calm() * r.place;
  return next;
end $$;

/**
 * Stillness: a blow that lands in a sitting ends it, with nothing come of it
 * (`STRUCK_SAID`). Said at the blow. With nothing behind it the job is simply
 * over; with a queue behind it, the sitting's go comes due now and says
 * nothing (`struck_at`), and the queue goes on as it would have.
 */
create or replace function sitting_struck(p_world uuid, p_uid uuid) returns boolean language plpgsql as $$
declare p player;
begin
  select * into p from player where world_id = p_world and uid = p_uid for update;
  if not found or p.act is distinct from 'meditate' then return false; end if;
  if jsonb_array_length(coalesce(p.act_queue, '[]'::jsonb)) = 0 then
    update player set act = null, act_target = null, act_started = null, act_ends = null, act_left = null, act_goes = null,
           struck_at = now()
     where world_id = p_world and uid = p_uid;
  else
    update player set act_ends = least(act_ends, now()), act_left = 1, struck_at = now()
     where world_id = p_world and uid = p_uid;
  end if;
  perform tell(p_world, p_uid, struck_said(), 'error');
  return true;
end $$;

/* ------------------------------------------------------------------ *
 * Taking a pick.
 * ------------------------------------------------------------------ */

/**
 * Why a pick cannot be taken, or nothing: the browser's `pathPickRefusal`, in
 * the same order and words.
 */
create or replace function path_pick_refusal(p_world uuid, p_uid uuid, p_pick text) returns text
  language plpgsql stable as $$
declare k path_pick; p player; v_other text; v_at int; v_med double precision;
begin
  select * into k from path_pick where id = p_pick;
  if not found then return 'There is no such pick.'; end if;
  select * into p from player where world_id = p_world and uid = p_uid;
  if not found then return 'You are not on this island.'; end if;
  if p.way is null then return 'Choose a path first, at ' || choose_at()::int || ' meditation.'; end if;
  if k.path <> p.way then
    return 'That is ' || coalesce((select name from path_def where id = k.path), k.path) || '’s, and you walk '
        || coalesce((select name from path_def where id = p.way), p.way) || '.';
  end if;
  if not path_moved(p.way) then
    return coalesce((select name from path_def where id = p.way), p.way) || ' is still walked by its steps.';
  end if;
  if exists (select 1 from path_taken where world_id = p_world and uid = p_uid and pick = p_pick) then
    return 'You have that already.';
  end if;
  select o.name into v_other from path_taken t join path_pick o on o.id = t.pick
   where t.world_id = p_world and t.uid = p_uid and o.path = k.path and o.tier = k.tier
   order by t.took limit 1;
  if v_other is not null then return 'You took ' || v_other || ' at this tier.'; end if;
  v_at := (select at from path_tier where tier = k.tier);
  v_med := skill_of(p_world, p_uid, meditation_skill());
  if v_med < v_at then
    return 'This tier opens at ' || v_at || ' meditation; you have ' || floor(v_med)::int || '.';
  end if;
  return null;
end $$;

/** Your path as the Faith window draws it (`PathSaid`). */
create or replace function path_said(p_world uuid, p_uid uuid) returns jsonb language plpgsql stable as $$
declare p player; v_med double precision;
begin
  select * into p from player where world_id = p_world and uid = p_uid;
  if not found then return null; end if;
  v_med := skill_of(p_world, p_uid, meditation_skill());
  return jsonb_build_object(
    'way', p.way,
    'meditation', v_med,
    'calm', floor(coalesce(p.calm, 0)),
    'cap', floor(player_calm_cap(p_world, p_uid)),
    'taken', coalesce((select jsonb_agg(t.pick order by t.took, t.pick) from path_taken t
                        where t.world_id = p_world and t.uid = p_uid), '[]'::jsonb),
    'picks', coalesce((select jsonb_object_agg(k.id, path_pick_refusal(p_world, p_uid, k.id))
                         from path_pick k where k.path = p.way), '{}'::jsonb));
end $$;

/**
 * And your path on the beat (`PathBeat`): the picks, Calm, a Foreknow's goes,
 * a Clarity's seconds, where you have sat since the woods turned, the day
 * each skill last had a Quick Study's gain, and where a Seek's swirl and a
 * Trace's hoard are while they are still there.
 */
create or replace function path_beat(p_world uuid, p_uid uuid) returns jsonb language plpgsql stable as $$
declare p player;
begin
  select * into p from player where world_id = p_world and uid = p_uid;
  if not found then return null; end if;
  return jsonb_build_object(
    'way', p.way,
    'picks', coalesce((select jsonb_agg(t.pick order by t.took, t.pick) from path_taken t
                        where t.world_id = p_world and t.uid = p_uid), '[]'::jsonb),
    'calm', coalesce(p.calm, 0),
    'foreknow', coalesce(p.foreknow, 0),
    'clarity', greatest(0, coalesce(extract(epoch from (p.clarity_until - now())), 0)),
    'sat', sat_spots_now(p),
    'studied', coalesce(p.studied, '{}'::jsonb),
    'seek', (select jsonb_build_object('x', m.x, 'y', m.y) from mote_swirl m
              where m.world_id = p_world and m.id = (p.path_marks->>'seek')::bigint),
    'trace', (select jsonb_build_object('x', t.x, 'y', t.y) from treasure t
               where t.world_id = p_world and t.item_id = (p.path_marks->>'trace')::bigint));
end $$;

/** Take one pick of a tier of your path: one of the three, for good. A technique goes in the path slot when it is empty. */
create or replace function rpc_take_path_pick(p_world uuid, p_pick text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); k path_pick; v_why text; v_slot int;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  v_why := path_pick_refusal(p_world, me, p_pick);
  if v_why is not null then return jsonb_build_object('why', v_why); end if;
  select * into k from path_pick where id = p_pick;
  insert into path_taken (world_id, uid, pick) values (p_world, me, p_pick)
    on conflict (world_id, uid, pick) do nothing;
  if k.kind = 'technique' then
    select min(sl.slot) into v_slot from spell_slot sl, player p
     where p.world_id = p_world and p.uid = me and sl.school = 'path' and (p.spell_bar->>sl.slot) is null;
    if v_slot is not null then perform spell_bar_put(p_world, me, v_slot, p_pick); end if;
  end if;
  perform journal_note(p_world, me, 'path');
  perform tell(p_world, me, k.name || '. ' || k.note, 'system');
  return faith_said(p_world, me) || jsonb_build_object('took', k.id);
end $$;

/* ------------------------------------------------------------------ *
 * A technique: a spell of the path school.
 * ------------------------------------------------------------------ */

create or replace view spell_any with (security_invoker = true) as
  select faith_spell.id, 'faith'::text as school, faith_spell.patron as owner, faith_spell.name, faith_spell.note,
         faith_spell.cost, faith_spell.rest, faith_spell.on_what, faith_spell.radius, faith_spell.fx
    from faith_spell
  union all
  select class_spell.id, 'class'::text, class_spell.class, class_spell.name, class_spell.note,
         class_spell.cost, class_spell.rest, class_spell.on_what, null::double precision, class_spell.fx
    from class_spell
  union all
  -- A path's techniques, every one cast on yourself and paid for in Calm.
  select path_pick.id, 'path'::text, path_pick.path, path_pick.name, path_pick.note,
         path_pick.cost, path_pick.rest, array['self']::text[], null::double precision, path_pick.fx
    from path_pick where path_pick.kind = 'technique';

/** A patron's spell taken, your fighting trade's while you hold the trade, or your path's technique while you walk it. */
create or replace function spell_known(p_world uuid, p_uid uuid, p_spell text) returns boolean
  language sql stable as $$
  select exists (select 1 from player_spell where world_id = p_world and uid = p_uid and spell = p_spell)
      or exists (select 1 from class_spell cs
                   join player_node pn on pn.node = cs.id and pn.world_id = p_world and pn.uid = p_uid
                   join player pl on pl.world_id = p_world and pl.uid = p_uid and pl.combat_class = cs.class
                  where cs.id = p_spell)
      or exists (select 1 from path_pick k where k.id = p_spell and k.kind = 'technique' and path_holds(p_world, p_uid, p_spell))
$$;

/**
 * The wind at an hour of an island's clock, as the browser's `windAt` works
 * it out: a sum of slow sines of the clock and the seed, so the wind of any
 * hour ahead is known now. A remainder here keeps the sign of what it came
 * from, as the browser's does.
 */
create or replace function wind_at(p_seed bigint, p_time double precision, out dir double precision, out force double precision)
  language plpgsql immutable as $$
declare s double precision := (p_seed % 1000)::double precision / 1000; tau double precision := 2 * pi(); d double precision; raw double precision;
begin
  d := s * tau + sin(p_time / wind_turn() + s * 7) * 2.2 + sin(p_time / (wind_turn() * 0.37) + s * 3) * 0.8;
  d := d - tau * trunc(d / tau);
  d := d + tau;
  d := d - tau * trunc(d / tau);
  raw := 0.5 + 0.34 * sin(p_time / (wind_gust() * 3.1) + s * 11) + 0.18 * sin(p_time / wind_gust() + s * 5)
       + 0.1 * sin(p_time / (wind_gust() * 0.41) + s * 2);
  dir := d;
  force := greatest(0, least(1, raw));
end $$;

/** Read the Sky's sentence: the wind at each of the next `p_hours` hours of the island's clock (`skySaid`). */
create or replace function sky_said(p_seed bigint, p_time double precision, p_hours int) returns text language plpgsql immutable as $$
declare h int; w record; f double precision; v_point int; v_word text; out_t text := '';
        v_points text[] := array['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
begin
  for h in 1..p_hours loop
    w := wind_at(p_seed, p_time + h * day_seconds() / 24);
    f := w.dir + pi();
    f := f - 2 * pi() * trunc(f / (2 * pi()));
    v_point := floor(f / (pi() / 4) + 0.5)::int % 8;
    v_word := case when w.force < 0.12 then 'flat calm' when w.force < 0.3 then 'light air'
                   when w.force < 0.5 then 'a steady breeze' when w.force < 0.72 then 'a fresh wind'
                   when w.force < 0.9 then 'a hard blow' else 'a gale' end;
    out_t := out_t || case when h > 1 then ' ' else '' end
      || 'In ' || case when h = 1 then 'an hour' else number_word(h) || ' hours' end
      || ' the wind is from the ' || v_points[v_point + 1] || ': ' || v_word || ', '
      || floor(w.force * 100 + 0.5)::int || '% of a gale.';
  end loop;
  return out_t;
end $$;

/**
 * What a technique does, and what it says: `{said}`, or `{why}` for one that
 * found nothing, which costs nothing (`Game.workTechnique`).
 */
create or replace function path_technique_cast(p_world uuid, p_uid uuid, p_spell text, p_at jsonb) returns jsonb
  language plpgsql as $$
declare k path_pick; p player; tx int; ty int; r record;
begin
  select * into k from path_pick where id = p_spell;
  select * into p from player where world_id = p_world and uid = p_uid;
  tx := floor(p.x)::int; ty := floor(p.y)::int;
  if p_spell = 'knowledge_seek' then
    select m.id, m.element, sqrt(((m.x - tx) ^ 2 + (m.y - ty) ^ 2)::double precision) as d into r
      from mote_swirl m where m.world_id = p_world
       and sqrt(((m.x - tx) ^ 2 + (m.y - ty) ^ 2)::double precision) <= (k.fx->>'reach')::double precision
     order by 3, m.id limit 1;
    if r.id is null then
      return jsonb_build_object('why', 'There is no mote swirl within ' || (k.fx->>'reach') || ' tiles of you.');
    end if;
    update player set path_marks = coalesce(path_marks, '{}'::jsonb) || jsonb_build_object('seek', r.id)
     where world_id = p_world and uid = p_uid;
    return jsonb_build_object('said', 'The nearest mote swirl is ' || floor(r.d + 0.5)::int || ' tiles off, '
      || case when r.element ~ '^[aeiou]' then 'an' else 'a' end || ' ' || r.element || ' mote swirl. It is marked on your map.');
  elsif p_spell = 'knowledge_sky' then
    return jsonb_build_object('said', sky_said((select seed from world where id = p_world), world_time(p_world), (k.fx->>'hours')::int));
  elsif p_spell = 'knowledge_trace' then
    -- A hoard of a map in your own pack: the map is what digs it up (`unearth`).
    select t.item_id, sqrt(((t.x - tx) ^ 2 + (t.y - ty) ^ 2)::double precision) as d into r
      from treasure t join item i on i.world_id = t.world_id and i.id = t.item_id
     where t.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid
       and sqrt(((t.x - tx) ^ 2 + (t.y - ty) ^ 2)::double precision) <= (k.fx->>'reach')::double precision
     order by 2, t.item_id limit 1;
    if r.item_id is null then
      return jsonb_build_object('why', 'No hoard of a map in your pack is buried within ' || (k.fx->>'reach') || ' tiles of you.');
    end if;
    update player set path_marks = coalesce(path_marks, '{}'::jsonb) || jsonb_build_object('trace', r.item_id)
     where world_id = p_world and uid = p_uid;
    return jsonb_build_object('said', 'A hoard buried for a map in your pack is ' || floor(r.d + 0.5)::int || ' tiles off. It is marked on your map.');
  elsif p_spell = 'knowledge_foreknow' then
    update player set foreknow = (k.fx->>'goes')::int where world_id = p_world and uid = p_uid;
    return jsonb_build_object('said', 'Your next ' || number_word((k.fx->>'goes')::int) || ' goes that roll for success will succeed.');
  elsif p_spell = 'knowledge_clarity' then
    update player set clarity_until = now() + make_interval(secs => (k.fx->>'secs')::double precision)
     where world_id = p_world and uid = p_uid;
    return jsonb_build_object('said', 'For ' || time_words((k.fx->>'secs')::double precision) || ' every skill gain you make is '
      || round((k.fx->>'more')::numeric * 100)::int || '% larger.');
  end if;
  return jsonb_build_object('why', 'Nothing is written behind that spell yet.');
end $$;

/* ------------------------------------------------------------------ *
 * What the disciplines do, where their rules are.
 * ------------------------------------------------------------------ */

/**
 * A skill check, which a Foreknow's goes cannot fail: `settle` says whose go
 * this is (`wurm.foreknow`), and spends a go of it once the go is done if a
 * roll was taken (`wurm.foreknown`). The browser's `skillCheck`.
 */
create or replace function skill_check(p_skill double precision, p_difficulty double precision, p_tool_ql double precision default 0, p_ease double precision default 0)
  returns boolean language plpgsql as $$
begin
  if coalesce(current_setting('wurm.foreknow', true), '') = 'on' then
    perform set_config('wurm.foreknown', 'on', true);
    return true;
  end if;
  return random() < least(0.98, greatest(0.3,
    0.6 + (p_skill / 100) * 0.38 + p_tool_ql / 500
      - (case when p_ease > 0 then greatest(p_difficulty * 0.5, p_difficulty - p_ease) else p_difficulty end) / 150));
end $$;

/**
 * A Quick Study's doubling: the first gain in each skill on each day of the
 * island's clock is `first` times what it would be, and the day is written
 * down against the skill (`Game.firstOfDay`).
 */
create or replace function path_first(p_world uuid, p_uid uuid, p_id text) returns double precision language plpgsql as $$
declare v_first double precision; v_day bigint;
begin
  v_first := path_fx(p_world, p_uid, 'first', 1);
  if v_first = 1 then return 1; end if;
  v_day := floor(world_time(p_world) / day_seconds())::bigint;
  if (select (studied->>p_id)::bigint from player where world_id = p_world and uid = p_uid) is not distinct from v_day then
    return 1;
  end if;
  update player set studied = jsonb_set(coalesce(studied, '{}'::jsonb), array[p_id], to_jsonb(v_day))
   where world_id = p_world and uid = p_uid;
  return v_first;
end $$;

create or replace function skill_raise(p_world uuid, p_uid uuid, p_id text, p_base double precision)
returns double precision language plpgsql as $fn$
declare was double precision; now_v double precision;
begin
  was := skill_of(p_world, p_uid, p_id);
  /*
   * Everything that makes a trade go in faster, which was four things kept on
   * the row and one thing spent. `skill_mult` is the browser's own `skillMult`,
   * term for term, and it goes on the *base* the way it does over there rather
   * than on the gain that comes out — the two are not the same number, because
   * `skill_gain_of` is not linear in what it is given. And a reader's Quick
   * Study on the day's first, as the browser's `firstOfDay`.
   */
  now_v := least(100, was + skill_gain_of(was, p_base * skill_mult(p_world, p_uid, p_id) * path_first(p_world, p_uid, p_id),
                                          0.6 + 0.8 * random()));
  insert into skill (world_id, uid, id, value) values (p_world, p_uid, p_id, now_v)
    on conflict (world_id, uid, id) do update set value = excluded.value;
  -- So the beat knows whether the book is worth sending.
  update player set skills_at = now() where world_id = p_world and uid = p_uid;
  -- And what the go left behind besides the number: a knack at the share of a
  -- go this raise taught.
  perform earn_knacks(p_world, p_uid, p_id, p_base);
  perform earn_titles(p_world, p_uid, p_id, was, now_v);
  perform skill_said(p_world, p_uid, p_id, now_v - was);
  return now_v - was;
end $fn$;

create or replace function earn_knacks(p_world uuid, p_uid uuid, p_id text, p_base double precision)
returns void language plpgsql as $fn$
declare p player; v_id text; had int;
begin
  -- A Polymath's chance is the better (`knackChance`'s third).
  if random() >= knack_chance(p_id, p_base, path_fx(p_world, p_uid, 'knack', 1)) then return; end if;
  if random() < knack_home() then
    v_id := p_id;
  else
    select k.skill into v_id from knack_kin k
     where k.family = (select family from knack_kin where skill = p_id)
     order by random() limit 1;
    v_id := coalesce(v_id, p_id);
  end if;
  select * into p from player where world_id = p_world and uid = p_uid for update;
  if not found then return; end if;
  had := coalesce((p.knacks->>v_id)::int, 0);
  if had >= knack_cap() then return; end if;
  update player set knacks = jsonb_set(coalesce(knacks, '{}'::jsonb), array[v_id], to_jsonb(had + 1)),
         skills_at = now()
    where world_id = p_world and uid = p_uid;
  perform journal_note(p_world, p_uid, 'knack');
  perform tell(p_world, p_uid, 'You have a knack for '
    || lower((select name from skill_def where id = v_id)) || ' now. It goes in '
    || round(knack_bonus(had + 1) * 100) || '% faster.', 'skill');
end $fn$;

/** A wildermon's blood as somebody reads it: what their husbandry reaches, or all of it for a reader's Reader. */
create or replace function blood_seen(p_world uuid, p_uid uuid, p_traits text[]) returns text[]
  language sql stable as $$
  select coalesce(array_agg(t.id order by t.ord), '{}')
    from unnest(coalesce(p_traits, '{}')) with ordinality t(id, ord)
    join trait_def td on td.id = t.id
    join tier_odds o on o.tier = td.tier
   where path_holds(p_world, p_uid, 'knowledge_reader')
      or skill_of(p_world, p_uid, 'animal_husbandry') >= 1 + o.level
$$;

create or replace function perform_swirl(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 returns void language plpgsql as $$
declare tx int := (p_target->>'x')::int; ty int := (p_target->>'y')::int; v_why text; s mote_swirl; v_n int; v_skill double precision;
begin
  v_why := swirl_refusal(p_world, p_uid, p_action, p_target);
  if v_why is null then
    delete from mote_swirl m where m.world_id = p_world and m.x = tx and m.y = ty returning m.* into s;
  end if;
  if s.id is null then
    perform skill_raise(p_world, p_uid, elementalism_skill(), try_gain(false));
    perform tell(p_world, p_uid, coalesce(v_why, swirl_said('gone')), 'error');
    return;
  end if;
  v_skill := skill_of(p_world, p_uid, elementalism_skill());
  -- And another for a reader's Elemental Lore.
  v_n := motes_for(v_skill) + path_fx(p_world, p_uid, 'motes', 0)::int;
  perform gather(p_world, p_uid, s.element || '_mote', v_n, product_ql(v_skill));
  perform skill_raise(p_world, p_uid, elementalism_skill(), 1);
  perform tell(p_world, p_uid, 'You collect ' || motes_word(v_n, s.element) || ' from the swirl, and it is gone.', 'event');
  perform swirl_gone(p_world, s.x, s.y, s.id);
end $$;

/** Call on what a path on its steps has taught. Sense the Rock and Recall the Way went with Knowledge's steps. */
create or replace function work_ability(p_world uuid, p_uid uuid, p_ability text) returns text
  language plpgsql as $$
declare p player; n int;
begin
  select * into p from player where world_id = p_world and uid = p_uid;
  if p_ability = 'refresh' then
    update player set stats = jsonb_set(jsonb_set(stats, '{hunger}', '1'), '{thirst}', '1')
      where world_id = p_world and uid = p_uid;
    return 'You are neither hungry nor thirsty, and cannot say when that happened.';

  elsif p_ability = 'mendflesh' then
    n := jsonb_array_length(p.wounds);
    update player set wounds = '[]'::jsonb,
        stats = jsonb_set(stats, '{health}',
          to_jsonb(least(1, coalesce((stats->>'health')::double precision, 1) + 0.4)))
      where world_id = p_world and uid = p_uid;
    return case when n = 1 then 'The wound closes and the ache goes with it.'
                when n > 1 then 'All ' || n || ' of them close and the ache goes with them.'
                else 'There was nothing to mend, and you feel better anyway.' end;

  elsif p_ability = 'secondwind' then
    update player set stats = jsonb_set(stats, '{stamina}', '1')
      where world_id = p_world and uid = p_uid;
    return 'Your wind comes back all at once.';

  elsif p_ability = 'fury' then
    update player set fury_until = now() + interval '30 seconds'
      where world_id = p_world and uid = p_uid;
    return 'For half a minute nothing you swing at is going to enjoy it.';
  end if;
  return 'Nothing happens.';
end $$;

create or replace function skill_mult(p_world uuid, p_uid uuid, p_id text) returns double precision
  language plpgsql stable as $function$
declare p player; m double precision;
begin
  select * into p from player where world_id = p_world and uid = p_uid;
  if not found then return 1; end if;
  m := case when coalesce(p.rested, 0) > 0 then rest_mult() else 1 end;
  -- A knack earned on the way up never wears off, unlike a meal or a night's sleep.
  m := m + knack_bonus((p.knacks->>p_id)::int);
  -- And the stones you wear, a jewel's and a circlet's, on the trades they favour.
  m := m + jewel_gain(worn(p_world, p_uid, 'jewel'), p_id) + jewel_gain(worn(p_world, p_uid, 'head'), p_id);
  -- And a reader's Attentive, for good, on every skill, and a Clarity while it lasts (`skillMult`).
  m := m + path_fx(p_world, p_uid, 'learn', 0);
  if p.clarity_until > now() then
    m := m + coalesce((select (fx->>'more')::double precision from path_pick where id = 'knowledge_clarity'), 0);
  end if;
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

create or replace function faith_said(p_world uuid, p_uid uuid) returns jsonb
  language plpgsql as $function$
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
    -- Your fighting trade's spells that you know, lowest tier first, for its slots on the bar.
    'classSpells', coalesce((select jsonb_agg(cs.id order by k.tier, cs.num) from class_spell cs join class_perk k on k.id = cs.id
                              where spell_known(p_world, p_uid, cs.id)), '[]'::jsonb),
    -- And your path's techniques, lowest tier first, for its slot.
    'pathSpells', coalesce((select jsonb_agg(k.id order by k.num) from path_pick k
                             where k.kind = 'technique' and path_holds(p_world, p_uid, k.id)), '[]'::jsonb),
    -- And your path, Calm and the picks of its tiers, for the Faith window's Path tab.
    'path', path_said(p_world, p_uid),
    'stamina', coalesce((p.stats->>'stamina')::double precision, 1),
    'spells', coalesce((select jsonb_object_agg(s.id, faith_spell_refusal(p_world, p_uid, s.id))
                          from faith_spell s where s.patron = p.patron), '{}'::jsonb),
    'bar', (select jsonb_agg(coalesce(p.spell_bar->s.slot, 'null'::jsonb) order by s.slot) from spell_slot s),
    'rest', coalesce((select jsonb_object_agg(s.id, spell_rest_left(p.used_at, s.id, s.rest))
                        from spell_any s where p.used_at ? ('spell:' || s.id)), '{}'::jsonb)
  );
end $function$;

create or replace function perform_faith(p_world uuid, p_uid uuid, p_action text, p_target jsonb) returns void
  language plpgsql as $function$
declare p player; pc placed; faith double precision; hour double precision;
        gained double precision; cap double precision; got double precision;
        was double precision; med double precision; sit record; v_step path_step;
        v_way text; r record;
begin
  select * into p from player where world_id = p_world and uid = p_uid;

  if p_action = 'pray' then
    select * into pc from placed where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found then return; end if;
    faith := skill_of(p_world, p_uid, faith_skill());
    hour := hour_of_day(p_world);
    cap := favour_cap(faith);
    -- What a prayer banks is Prayer's to say; what you can hold is faith's (`favour_cap`).
    got := least(cap, favour_settle(p_world, p_uid) + prayer_worth(pc.ql, hour, skill_of(p_world, p_uid, praying_skill())));
    update player set favour = got, favour_at = now(), prayed_at = now()
      where world_id = p_world and uid = p_uid;
    perform journal_note(p_world, p_uid, 'prayed');
    perform skill_raise(p_world, p_uid, faith_skill(), prayer_gain());
    perform tell(p_world, p_uid,
      case when abs(hour - 6) < 2 or abs(hour - 20) < 2
           then 'You kneel in the half light and it goes better than it usually does.'
           else 'You kneel at the stone.' end
      || ' Favour ' || floor(got) || ' of ' || floor(cap) || '.', 'event');
    -- And Prayer, the skill it is said with, as every job teaches its own (`completeAction`).
    perform skill_raise(p_world, p_uid, praying_skill(), try_gain(true));

  elsif p_action = 'cast' then
    if cast_reason(p_world, p_uid, p_target->>'spell', target_item(p_target)) is not null then
      return;
    end if;
    perform journal_note(p_world, p_uid, 'cast:' || (p_target->>'spell'));
    perform tell(p_world, p_uid,
      do_cast(p_world, p_uid, p_target->>'spell', target_item(p_target)), 'event');

  elsif p_action = 'meditate' then
    -- Struck in the middle of it: said at the blow (`sitting_struck`), and nothing comes of it.
    if p.struck_at is not null and p.act_started is not null and p.struck_at >= p.act_started then return; end if;
    select * into sit from sitting_worth(p_world, p_uid);
    was := skill_of(p_world, p_uid, meditation_skill());
    -- And where it was sat, for the next sitting near it until the woods turn (`satHere`).
    update player set sat_at = now(),
           sat_spots = sat_spots_now(p) || jsonb_build_array(jsonb_build_array(floor(p.x)::int, floor(p.y)::int)),
           sat_dawn = tree_last_dawn()
      where world_id = p_world and uid = p_uid;
    perform journal_note(p_world, p_uid, 'sat');
    perform skill_raise(p_world, p_uid, meditation_skill(), sit.gain);
    med := skill_of(p_world, p_uid, meditation_skill());
    -- The Calm it banks, up to what this much meditation holds.
    cap := player_calm_cap(p_world, p_uid);
    update player set calm = least(cap, coalesce(calm, 0) + sit.calm)
      where world_id = p_world and uid = p_uid returning calm into got;
    perform tell(p_world, p_uid, sit.said || ' Calm ' || floor(got) || ' of ' || floor(cap) || '.', 'event');
    if p.way is null and med >= choose_at() and was < choose_at() then
      perform tell(p_world, p_uid, 'Something settles. Three ways of looking at all this have '
        || 'become clear, and you may walk exactly one of them. Choose from the rug.', 'system');
    end if;
    if p.way is not null and path_moved(p.way) then
      -- A moved path's tiers, as they open (`tierSaid`).
      for r in select t.tier, d.name as path_name from path_tier t, path_def d
        where d.id = p.way and was < t.at and med >= t.at order by t.tier
      loop
        perform journal_note(p_world, p_uid, 'path');
        perform tell(p_world, p_uid, r.path_name || ': tier ' || r.tier || ' is open. Take one of '
          || listed_or((select array_agg(k.name order by k.num) from path_pick k where k.path = p.way and k.tier = r.tier))
          || ' in the Faith window.', 'system');
      end loop;
    elsif p.way is not null then
      for r in select s.*, d.name as path_name from path_step s join path_def d on d.id = s.path
        where s.path = p.way and was < s.at and med >= s.at order by s.n
      loop
        perform tell(p_world, p_uid, r.path_name || ': ' || r.name || '. ' || r.note, 'system');
      end loop;
    end if;

  elsif p_action = 'choose_path' then
    v_way := p_target->>'material';
    if p.way is not null or not exists (select 1 from path_def where id = v_way) then return; end if;
    update player set way = v_way where world_id = p_world and uid = p_uid;
    perform tell(p_world, p_uid, 'You take the path of '
      || (select name from path_def where id = v_way) || '. '
      || (select note from path_def where id = v_way), 'system');

  elsif p_action = 'use_ability' then
    v_step := ability_of(p_world, p_uid, p_target->>'material');
    if v_step.path is null then return; end if;
    update player set used_at = jsonb_set(used_at, array[v_step.ability], to_jsonb(now()))
      where world_id = p_world and uid = p_uid;
    perform skill_raise(p_world, p_uid, meditation_skill(), technique_gain());
    perform tell(p_world, p_uid, work_ability(p_world, p_uid, v_step.ability), 'event');
  end if;
end $function$;

/** The step of somebody's path that answers to this ability, if any: none on a path that has moved. */
create or replace function ability_of(p_world uuid, p_uid uuid, p_ability text) returns path_step
  language sql stable as $$
  select s.* from path_step s, player p
  where p.world_id = p_world and p.uid = p_uid and s.path = p.way and not path_moved(p.way)
    and s.ability = p_ability
    and skill_of(p_world, p_uid, meditation_skill()) >= s.at
$$;

-- Why a spell will not go: a technique short of Calm, as well as everything before.
CREATE OR REPLACE FUNCTION public.spell_cast_refusal(p_world uuid, p_uid uuid, p_spell text)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare s spell_any; p player; v_left double precision; v_favour double precision; v_stamina double precision; v_needs text;
        v_cost double precision;
begin
  select * into s from spell_any where id = p_spell;
  if not found then return 'There is no such spell.'; end if;
  -- A patron's taken, or your fighting trade's taken while you hold the trade (`spell_known`).
  if not spell_known(p_world, p_uid, p_spell) then return 'You do not have that spell.'; end if;
  select * into p from player where world_id = p_world and uid = p_uid;
  if not found then return 'You are not on this island.'; end if;
  v_left := spell_rest_left(p.used_at, s.id, s.rest);
  if v_left > 0 then return s.name || ' can be called again in ' || ceil(v_left)::int || ' seconds.'; end if;
  if s.school = 'class' then
    -- A trade's spell is paid for in stamina, as a share of a full bar.
    v_stamina := coalesce((p.stats->>'stamina')::double precision, 1);
    -- Less for a Kindler's Deep Breath.
    v_cost := s.cost * pk(p.class_mul, 'cast:cost', 1);
    if v_stamina < v_cost then
      return s.name || ' costs ' || trim_scale(round((v_cost * 100)::numeric, 1)) || '% of your stamina; you have '
        || floor(v_stamina * 100)::int || '%.';
    end if;
    -- What it wants in your hands (`needs`): a shield in the off hand, or a weapon of a kind in the other.
    select cs.needs into v_needs from class_spell cs where cs.id = p_spell;
    if v_needs = 'shield' and not exists (select 1 from shield_def sd where sd.id = (worn(p_world, p_uid, 'offhand')).def) then
      return s.name || ' wants a shield in your off hand.';
    end if;
    if v_needs in ('axes', 'mauls') and (swung_with(p_world, p_uid)).kind is distinct from v_needs then
      return s.name || ' wants ' || case v_needs when 'axes' then 'an axe' else 'a maul' end || ' in your hand.';
    end if;
    -- And a shot a bow in your hands and an arrow to loose, as a draw does (`fight_refusal`).
    if v_needs = 'archery' then
      if not exists (select 1 from weapon_def bw where bw.id = (worn(p_world, p_uid, 'weapon')).def and bw.ammo is not null) then
        return s.name || ' wants a bow in your hands.';
      end if;
      if coalesce((select sum(pack_count(p_world, p_uid, idf.id)) from item_def idf where arrow_head_of(idf.id) is not null), 0) <= 0 then
        return 'You are out of arrows.';
      end if;
    end if;
    -- And a throw a javelin or a throwing axe in your hand; a Hit and Run one of those or a knife, which bare hands are not.
    if v_needs = 'throwing' and (swung_with(p_world, p_uid)).kind is distinct from 'throwing' then
      return s.name || ' wants a javelin or a throwing axe in your hand.';
    end if;
    if v_needs = 'skirmish' and ((swung_with(p_world, p_uid)).kind not in ('throwing', 'knives') or (swung_with(p_world, p_uid)).id = 'fist') then
      return s.name || ' wants a javelin, a throwing axe or a knife in your hand.';
    end if;
    -- And a Chirurgeon's knife work a knife, which bare hands are not.
    if v_needs = 'knives' and ((swung_with(p_world, p_uid)).kind is distinct from 'knives' or (swung_with(p_world, p_uid)).id = 'fist') then
      return s.name || ' wants a knife in your hand.';
    end if;
    -- And a Kindler's a focus of the school's stones in your pack, to cast it out of (`kindler_focus`).
    if v_needs = 'kindling' and (kindler_focus(p_world, p_uid)).id is null then
      return s.name || ' wants a garnet or ruby focus in your pack.';
    end if;
    -- And a Binder's a focus of its school's stones (`school_focus`).
    if v_needs = 'binding' and (school_focus(p_world, p_uid, 'binding')).id is null then
      return s.name || ' wants a sapphire or diamond focus in your pack.';
    end if;
    -- And a Warder's the same of its own.
    if v_needs = 'warding' and (school_focus(p_world, p_uid, 'warding')).id is null then
      return s.name || ' wants a topaz or emerald focus in your pack.';
    end if;
    -- And a Beastmaster's a companion following you, fit to be told (`class_companion`).
    if v_needs = 'companion' and (class_companion(p_world, p_uid)).id is null then
      return s.name || ' wants a companion following you.';
    end if;
    -- And one paid for in your own health is refused when it would take the last of it.
    if s.fx ? 'health' and coalesce((p.stats->>'health')::double precision, 1) <= (s.fx->>'health')::double precision then
      return s.name || ' costs ' || round((s.fx->>'health')::double precision * 100)::int || '% of your health; you have '
        || floor(coalesce((p.stats->>'health')::double precision, 1) * 100)::int || '%.';
    end if;
    if s.fx ? 'below' and coalesce((p.stats->>'health')::double precision, 1) >= (s.fx->>'below')::double precision then
      return s.name || ' is only for below ' || round((s.fx->>'below')::double precision * 100)::int || '% of your health.';
    end if;
    return null;
  end if;
  -- A path's technique is paid for in Calm (`calmRefusal`).
  if s.school = 'path' then
    if coalesce(p.calm, 0) < s.cost then
      return s.name || ' costs ' || s.cost::int || ' calm; you hold ' || floor(coalesce(p.calm, 0))::int || '. Sit somewhere quiet.';
    end if;
    return null;
  end if;
  v_favour := favour_settle(p_world, p_uid);
  if v_favour < s.cost then
    return s.name || ' costs ' || s.cost::int || ' favour; you hold ' || floor(v_favour)::int || '. Pray at an altar.';
  end if;
  return null;
end $function$;

-- A spell off the bar: a path's technique as well as a trade's or a patron's.
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
  if s.school = 'path' then
    -- A path's technique (`path_technique_cast`), paid in Calm; one that found nothing costs nothing.
    v_out := path_technique_cast(p_world, me, v_spell, v_at);
    v_told := fx_told(p_world, me, v_was);
    if v_out ? 'why' then return v_out; end if;
    update player set calm = greatest(0, coalesce(calm, 0) - s.cost),
        used_at = jsonb_set(coalesce(used_at, '{}'::jsonb), array['spell:' || s.id], to_jsonb(now()), true)
      where world_id = p_world and uid = me;
    perform journal_note(p_world, me, 'cast:' || s.id);
    perform skill_raise(p_world, me, meditation_skill(), technique_gain());
    perform tell(p_world, me, v_out->>'said', 'system');
    return faith_said(p_world, me) || jsonb_build_object('cast', s.id, 'said', v_out->>'said') || v_told;
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

-- A blow that lands, which now ends a sitting.
CREATE OR REPLACE FUNCTION public.hurt_player(p_world uuid, p_uid uuid, p_raw double precision, p_what text, p_kind text DEFAULT 'bite'::text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare p player; shield item; sh shield_def; chance double precision; roll double precision;
        part text; piece item; cls armour_class_def; soak double precision; taken double precision;
        health double precision; ws jsonb; had jsonb; found_w boolean := false; out_w jsonb := '[]'::jsonb;
        w jsonb; k wound_kind_def; note text; aegis double precision; v_worn double precision;
        v_from creature; v_venom boolean := false; v_dodge double precision; v_guard uuid; v_watch uuid;
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
  -- A creature's blow lands on an Archer's Decoy instead, while it holds.
  if v_from.id is not null and (p.blessings->'decoy'->>'until')::timestamptz > now() then
    perform tell(p_world, p_uid, 'The ' || coalesce((select lower(name) from species_def where id = v_from.species), 'creature')
      || ' strikes your decoy.', 'fight');
    return;
  end if;
  -- And none lands at all inside a Warder's Unbreakable.
  if v_from.id is not null and (p.blessings->'unbreakable'->>'until')::timestamptz > now() then
    perform tell(p_world, p_uid, 'The ' || coalesce((select lower(name) from species_def where id = v_from.species), 'creature')
      || '’s blow does not land: ' || (select name from class_spell where id = 'warder_unbreakable') || '.', 'fight');
    perform fight_back(p_world, p_uid, (p.stats->>'hurtBy')::int);
    return;
  end if;
  -- A Sworn Blade's Guardian standing near may take it on a shield instead (`class_guardian`).
  if v_from.id is not null then
    v_guard := class_guardian(p_world, p.x, p.y, p_uid);
    if v_guard is not null then
      perform class_guard_take(p_world, v_guard, p_raw,
        coalesce((select lower(name) from species_def where id = v_from.species), 'creature'), p.name);
      perform tell(p_world, p_uid, (select name from player where world_id = p_world and uid = v_guard)
        || ' takes the ' || coalesce((select lower(name) from species_def where id = v_from.species), 'creature')
        || '’s blow on a shield.', 'fight');
      perform fight_back(p_world, p_uid, (p.stats->>'hurtBy')::int);
      return;
    end if;
  end if;
  -- No roll at all while there is no chance, so nothing else's luck moves.
  v_dodge := dodge_chance(skill_of(p_world, p_uid, 'body_control'), worn_kg(p_world, p_uid));
  if v_dodge > 0 and random() < v_dodge then
    perform skill_raise(p_world, p_uid, 'body_control', dodge_gain());
    perform tell(p_world, p_uid, 'You dodge the '
      || coalesce((select lower(name) from species_def where id = v_from.species), 'blow') || '.', 'fight');
    -- And answered, for a Skirmisher's Riposte: owed now, struck once its row is written (`class_riposte`).
    if v_from.id is not null and pk(p_world, p_uid, 'riposte:blow', 0) > 0 then
      insert into class_mark (world_id, creature_id, kind, val, n, until, by_uid)
        values (p_world, v_from.id, 'riposte', pk(p_world, p_uid, 'riposte:blow', 0), 1, now(), p_uid)
        on conflict (world_id, creature_id, kind) do update set n = coalesce(class_mark.n, 0) + 1
          where class_mark.by_uid = excluded.by_uid;
    end if;
    perform fight_back(p_world, p_uid, (p.stats->>'hurtBy')::int);
    return;
  end if;
  /*
   * A blow that lands. A Warder's Thorns answers it with its share of the
   * creature's own attack, and the nearest other Warder with Watchful within
   * their reach of you turns it on themselves -- both owed now and paid once
   * its row is written (`class_owed_pay`).
   */
  if v_from.id is not null then
    if pk(p.class_mul, 'thorns:attack', 0) > 0 then
      insert into class_mark (world_id, creature_id, kind, val, until, by_uid)
        values (p_world, v_from.id, 'thorns', attack_of(v_from) * pk(p.class_mul, 'thorns:attack', 0), now(), p_uid)
        on conflict (world_id, creature_id, kind) do update set val = class_mark.val + excluded.val, by_uid = excluded.by_uid;
    end if;
    select w.uid into v_watch from player w
     where w.world_id = p_world and w.uid <> p_uid and not w.away and w.combat_class = 'warder'
       and pk(w.class_mul, 'watch:reach', 0) > 0 and v_from.hunting is distinct from w.uid
       and (w.x - p.x) ^ 2 + (w.y - p.y) ^ 2 <= pk(w.class_mul, 'watch:reach', 0) ^ 2
     order by (w.x - p.x) ^ 2 + (w.y - p.y) ^ 2, w.uid limit 1;
    if v_watch is not null then
      insert into class_mark (world_id, creature_id, kind, val, until, by_uid)
        values (p_world, v_from.id, 'watched', 1, now(), v_watch)
        on conflict (world_id, creature_id, kind) do update set by_uid = excluded.by_uid;
    end if;
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
  -- And one Disarming Cut left on it lands its share less, counted off (`class_disarm_take`).
  p_raw := p_raw * class_disarm_take(p_world, v_from.id);
  -- And one that is burning lands its share less on a Kindler's Flame Ward (`class_burning`).
  if v_from.id is not null and pk(p.class_mul, 'ward:burning', 1) <> 1 and class_burning(p_world, v_from.id) then
    p_raw := p_raw * pk(p.class_mul, 'ward:burning', 1);
  end if;
  -- And one held, rooted or slowed lands its share less on a Binder's Frost Ward (`class_stilled`),
  if v_from.id is not null and pk(p.class_mul, 'ward:stilled', 1) <> 1 and class_stilled(p_world, v_from) then
    p_raw := p_raw * pk(p.class_mul, 'ward:stilled', 1);
  end if;
  -- and one inside a Dull Claws lands its share less on anybody (`class_dull`),
  if v_from.id is not null then p_raw := p_raw * class_dull(p_world, v_from.id); end if;
  -- and every blow its share less inside a Binder's Still Skin,
  if (p.blessings->'still_skin'->>'until')::timestamptz > now() then
    p_raw := p_raw * (1 - (p.blessings->'still_skin'->>'cut')::double precision);
  end if;
  -- and inside a Warder's Stoneskin, and again inside a Bastion of Stone.
  if (p.blessings->'stoneskin'->>'until')::timestamptz > now() then
    p_raw := p_raw * (1 - (p.blessings->'stoneskin'->>'cut')::double precision);
  end if;
  if (p.blessings->'bastion_stone'->>'until')::timestamptz > now() then
    p_raw := p_raw * (1 - (p.blessings->'bastion_stone'->>'cut')::double precision);
  end if;
  v_venom := coalesce((select venom from species_def where id = v_from.species), false);
  -- Harder or softer for the way you stand (`stance_taken`), before anything has its say,
  p_raw := p_raw * my_stance_taken(p_world, p_uid, p.fight_stance)
    -- and less inside a Sworn Blade's Last Stand,
    * case when (p.blessings->'last_stand'->>'until')::timestamptz > now()
           then 1 - (p.blessings->'last_stand'->>'cut')::double precision else 1 end
    -- and more inside a Berserker's Battle Rage,
    * case when (p.blessings->'battle_rage'->>'until')::timestamptz > now()
           then (p.blessings->'battle_rage'->>'taken')::double precision else 1 end
    -- and less on a Pikeman's feet that have not moved (Bastion), as `hurtPlayer` has it, which `fight_back` asks the same of;
    * case when p.moved_at is null or p.moved_at <= now() - make_interval(secs => fight_back_still())
           then pk(p.class_mul, 'still:taken', 1) else 1 end;
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
      -- Taken to the last of it: a Second Wind, and a Ward Link of whoever laid it (`warder_skin_spent`).
      if aegis - p_raw <= 1e-9 then perform warder_skin_spent(p_world, p_uid); end if;
      perform fight_back(p_world, p_uid, (p.stats->>'hurtBy')::int);
      return;
    end if;
    update player set stats = jsonb_set(stats, '{aegis}', to_jsonb(0::double precision))
      where world_id = p_world and uid = p_uid;
    p_raw := p_raw - aegis;
    perform tell(p_world, p_uid, 'The ward goes with a sound like ice, and the rest of it reaches you.', 'fight');
    perform warder_skin_spent(p_world, p_uid);
  end if;

  -- The shield, next.
  shield := worn(p_world, p_uid, 'offhand');
  if shield.id is not null then
    select * into sh from shield_def where id = shield.def;
    if found then
      -- With what a Sworn Blade's Shield Mastery adds, under the ceiling it raises (`shield_block`).
      chance := shield_block(p_world, p_uid, sh, shield.ql)
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
        if v_from.id is not null then
          -- A Sworn Blade's Counterweight: its next blow put back, paid by its own turn (`class_stagger_owed`).
          if pk(p.class_mul, 'stagger:block', 0) > 0 then
            insert into class_mark (world_id, creature_id, kind, val, until, by_uid)
              values (p_world, v_from.id, 'stagger', pk(p.class_mul, 'stagger:block', 0), now() + interval '1 minute', p_uid)
              on conflict (world_id, creature_id, kind) do update set val = class_mark.val + excluded.val, until = excluded.until;
          end if;
          -- And a Deflect sends its share of the blow back, paid as a Retribution's is (`faith_owed`).
          if (p.blessings->'deflect'->>'until')::timestamptz > now() then
            insert into faith_owed (world_id, creature_id, dmg, from_uid)
              values (p_world, v_from.id, p_raw * (p.blessings->'deflect'->>'share')::double precision / blow_share(), p_uid);
          end if;
        end if;
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
      -- Less of a wound than of a blow for a Sworn Blade's Battle-Hardened; the health it takes is the same.
      w := jsonb_set(w, '{severity}', to_jsonb((w->>'severity')::double precision + taken * pk(p.class_mul, 'severity:wound', 1)));
      if k.bleed > 0.001 then w := jsonb_set(w, '{bleeding}', 'true'); end if;
      if v_venom then w := jsonb_set(w, '{venom}', to_jsonb(venom_secs())); end if;
      found_w := true;
    end if;
    out_w := out_w || w;
  end loop;
  if not found_w then
    -- A bruise does not bleed; everything else does until it is seen to. And a fresh one less deep for a Pikeman's Scarred.
    w := jsonb_build_object('kind', p_kind, 'part', part,
      'severity', taken * pk(p.class_mul, 'severity:wound', 1) * pk(p.class_mul, 'severity:new', 1),
      'bleeding', p_kind <> 'crush', 'infected', false, 'dressing', null, 'at', now())
      || case when v_venom then jsonb_build_object('venom', venom_secs()) else '{}'::jsonb end;
    out_w := out_w || w;
  end if;

  -- A Retribution's share of what landed goes back to whatever struck, paid when it is next settled (`faith_owed`).
  if v_from.id is not null and (p.blessings->'retribution'->>'until')::timestamptz > now() then
    insert into faith_owed (world_id, creature_id, dmg, from_uid)
      values (p_world, v_from.id, taken * (p.blessings->'retribution'->>'share')::double precision / blow_share(), p_uid);
  end if;
  -- And answered by your companion inside a Beastmaster's Vengeance: owed now, struck once its row is written (`class_vengeance`).
  if v_from.id is not null and (p.blessings->'vengeance'->>'until')::timestamptz > now() then
    insert into class_mark (world_id, creature_id, kind, val, n, until, by_uid)
      values (p_world, v_from.id, 'vengeance', (p.blessings->'vengeance'->>'more')::double precision, 1, now(), p_uid)
      on conflict (world_id, creature_id, kind) do update set n = coalesce(class_mark.n, 0) + 1
        where class_mark.by_uid = excluded.by_uid;
  end if;
  -- And set alight for a Kindler's Burning Retort: owed now, lit once its row is written (`class_owed_pay`).
  if v_from.id is not null and pk(p.class_mul, 'retort:each', 0) > 0 then
    insert into class_mark (world_id, creature_id, kind, val, until, by_uid)
      values (p_world, v_from.id, 'retort', pk(p.class_mul, 'retort:each', 0), now(), p_uid)
      on conflict (world_id, creature_id, kind) do update set val = excluded.val, by_uid = excluded.by_uid;
  end if;
  -- A share of it on your companion, for a Beastmaster's Feral Bond or Shared Wounds (`class_bond_take`).
  taken := class_bond_take(p_world, p_uid, taken, v_from.id);
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
  -- And a sitting it lands in is over, with nothing come of it (`sitting_struck`), before anything turns to fight.
  perform sitting_struck(p_world, p_uid);
  perform tell(p_world, p_uid, p_what || note || '. You have ' || wound_text(w) || '.', 'fight');
  -- And a Second Life, which the killing blow spends instead of you (`faith_second_life`).
  -- Undying holds you at its floor and is not spent; a Second Life is.
  if health <= 0 and faith_undying(p_world, p_uid) then perform fight_back(p_world, p_uid, (p.stats->>'hurtBy')::int);
  elsif health <= 0 and faith_second_life(p_world, p_uid) then perform fight_back(p_world, p_uid, (p.stats->>'hurtBy')::int);
  elsif health <= 0 then perform player_die(p_world, p_uid);
  else perform fight_back(p_world, p_uid, (p.stats->>'hurtBy')::int); end if;
end $function$;

-- A go through the clock, which now knows a Foreknow.
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
      -- And a Foreknow's goes, which no roll in this go can fail (`skill_check`); one is spent if a roll was taken.
      perform set_config('wurm.foreknow', case when coalesce((select foreknow from player
        where world_id = p_world and uid = p_uid), 0) > 0 then 'on' else '' end, true);
      perform set_config('wurm.foreknown', '', true);
      perform act_perform(p_world, p_uid, p.act, p.act_target);
      if current_setting('wurm.foreknown', true) = 'on' then
        update player set foreknow = greatest(0, foreknow - 1) where world_id = p_world and uid = p_uid;
      end if;
      perform set_config('wurm.foreknow', '', true);
      perform set_config('wurm.foreknown', '', true);
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

-- The heartbeat, which now says your path.
CREATE OR REPLACE FUNCTION public.rpc_settle(p_seen bigint DEFAULT NULL::bigint, p_world uuid DEFAULT NULL::uuid, p_said bigint DEFAULT NULL::bigint, p_book boolean DEFAULT false, p_ticked jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); r record; n int := 0; p player; v_world uuid;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;

  /*
   * Which island this is a heartbeat for, settled before anything is written.
   *
   * It used to be `order by seen_at desc limit 1` over every row with your uid
   * on it, and the update above it had no world in its `where` either — so one
   * beat set `seen_at` to the same instant on every island you have ever
   * joined, and then picked between them with a sort that had nothing left to
   * sort by. Three rows, one timestamp, no tie-break: the answer is whichever
   * one Postgres happens to hand back, and that is a choice of plan rather
   * than a fact about you.
   *
   * The same answer carries the hour and the bars, so when the choice moved,
   * both moved together — reported as "occasionally it switches randomly to
   * nighttime and hunger/thirst plummet until refreshed". A refresh put it
   * right because `rpc_join` names its island, and the next beat broke it
   * again because this one did not.
   *
   * So the browser says where it is standing. `rpc_settle` was the only door
   * of the twenty that did not take a `p_world`, and it is the one that runs
   * every minute of every session.
   */
  if p_world is not null then
    select world_id into v_world from player where uid = me and world_id = p_world;
  end if;
  if v_world is null then
    -- A page that has not been redeployed yet, and does not say. The best
    -- guess is still a guess, but `world_id` breaks the tie, so a session gets
    -- the same wrong island every beat rather than a different one each time.
    select world_id into v_world from player where uid = me
      order by seen_at desc, world_id limit 1;
  end if;
  if v_world is null then return jsonb_build_object('settled', 0); end if;

  -- Standing here, and only here. Keeping `seen_at` fresh on every island at
  -- once told each of them you were present, which is how a body could be left
  -- standing on an island you walked away from an hour ago.
  update player set seen_at = now(), away = false,
         seen_change = greatest(seen_change, coalesce(p_seen, 0))
    where uid = me and world_id = v_world
      and (away or seen_at < now() - interval '5 seconds' or coalesce(p_seen, 0) > seen_change);
  /*
   * And anything newly ticked off the journal.
   *
   * The ticking itself stays in the browser, because a goal is a question
   * about everything at once — the book, the pack, the ground, what is
   * standing on it — and eighty-five of those predicates are eighty-five
   * ports for another day. What the island owns is the *record*: which ones
   * are done, so that they stay done through a refresh and a change of
   * machine. An id nobody knows is kept as it is rather than refused; the
   * journal is a list of things somebody thought worth doing and there is
   * nothing here worth guarding.
   */
  if p_ticked is not null and jsonb_typeof(p_ticked) = 'array'
     and jsonb_array_length(p_ticked) > 0 then
    update player set
        ticked = (select coalesce(jsonb_agg(distinct g), '[]'::jsonb)
                  from (select jsonb_array_elements_text(coalesce(ticked, '[]'::jsonb)) as g
                        union
                        select jsonb_array_elements_text(p_ticked)) u),
        tally_at = now()
      where uid = me and world_id = v_world
        and not (coalesce(ticked, '[]'::jsonb) @> p_ticked);
  end if;
  for r in select world_id from player
    where uid = me and world_id = v_world and act is not null and act_ends <= now()
  loop
    n := n + settle(r.world_id, me);
  end loop;
  /*
   * And the body itself, which nothing had ever brought up to date.
   *
   * `settle` above runs only for somebody with a job whose time is up, and
   * `world_tick` only for the same — so a body standing still never got
   * hungry, never got its wind back and never healed. This is the heartbeat
   * every browser makes anyway, once a minute, and it is where a body that is
   * only standing there lives.
   */
  perform body_settle(v_world, me);
  select * into p from player where world_id = v_world and uid = me;
  -- Said before the row is read back, so what goes out is what was true when
  -- it was read rather than what was true a statement ago.
  if p.skills_at is not null and (p.skills_seen is null or p.skills_at > p.skills_seen) then
    update player set skills_seen = now() where world_id = v_world and uid = me;
  end if;
  if p.tally_at is not null and (p.tally_seen is null or p.tally_at > p.tally_seen) then
    update player set tally_seen = now() where world_id = v_world and uid = me;
  end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'settled', n,
    -- How far the island has let the land's history go. A browser whose place
    -- in it is further back reads the land again; see `change_keep`.
    'land_from', (select nullif(changes_from, 0) from world where id = v_world),
    'act', p.act,
    'ends', p.act_ends,
    'left', p.act_left,
    -- And how many were asked for, which nothing wrote down until now. The bar
    -- says "3 of 10" off this and `left`; the browser used to keep its own
    -- tally, which is a second opinion about a number the island owns — and it
    -- only ever heard one for a job that *started*, never for one that waited
    -- its turn in the queue.
    'goes', p.act_goes,
    'secs', case when p.act_ends is null then null
                 else greatest(0, extract(epoch from (p.act_ends - now()))) end,
    'total', case when p.act_ends is null or p.act_started is null then null
                  else greatest(0.001, extract(epoch from (p.act_ends - p.act_started))) end,
    -- What is lined up behind it, and how much room is left in your head.
    'queue', coalesce((select jsonb_agg(jsonb_build_object(
                         'action', q->>'action',
                         'goes', greatest(1, coalesce((q->>'goes')::int, 1))) order by o)
                       from jsonb_array_elements(p.act_queue) with ordinality t(q, o)), '[]'::jsonb),
    'cap', case when v_world is null then null else queue_capacity(v_world, me) end,
    -- The bars, which have been the ones you came ashore with until now.
    'stats', p.stats,
    /*
     * And what you are carrying, which has never gone out at all.
     *
     * The island has kept wounds since they were ported — `wounds_settle`
     * drains your health from them, turns them bad, closes them over and says
     * so — and no door has ever mentioned them. So on an island the wound
     * window was empty however cut about you were, `bleeding()` was false, and
     * a bandage or a healing cover had nothing to be put on. The health you
     * were losing to them arrived as a number going down for no stated reason.
     *
     * Sent every beat rather than when they change, unlike the skill book
     * above: this is a column of the row that has already been read, not an
     * aggregate over a table, so there is nothing to save by leaving it out —
     * and `[]` has to be able to mean "they have all closed".
     */
    'wounds', coalesce(p.wounds, '[]'::jsonb),
    /*
     * And the rest of what you are, which the row has kept all along.
     *
     * Rest, the dishes favouring a trade, the knacks, the titles and what is
     * on your table: every one of them is a column the browser draws and none
     * of them has ever crossed. A hud saying "Rested 12m · everything ×2" off
     * a number the island never sent is a hud making it up.
     */
    'rested', coalesce(p.rested, 0),
    'boons', coalesce(p.boons, '[]'::jsonb),
    'knacks', coalesce(p.knacks, '{}'::jsonb),
    'titles', coalesce(p.titles, '[]'::jsonb),
    'title', p.title,
    'nutrition', coalesce(p.nutrition, '{}'::jsonb),
    /*
     * And what you have on.
     *
     * `equipped` is a column of this row that the island has written on every
     * `equip` and every `unequip` since the day those two were dispatched
     * here, and has never once handed back. So a browser that reloaded held
     * an empty record: nothing in the pack was marked worn, no armour of
     * yours counted towards what your back would take, and the only entry the
     * item menu would offer on the helm already on your head was `Wear or
     * wield`. Reported: *"there's no option to unequip gear."*
     *
     * Sent every beat rather than when it changes, like the wounds above and
     * for the same reason: it is a column of a row that has already been
     * read, so there is nothing to save by leaving it out -- and an empty
     * slot has to be able to mean "there is nothing on it".
     */
    'equipped', coalesce(p.equipped, '{}'::jsonb),
    /*
     * Every skill, but only when one of them has moved.
     *
     * The log says one went up and the window said it did not, which is why
     * this is here — and it was aggregating the whole book on every beat,
     * standing still, to hand back the forty numbers it handed back last time.
     * `skill_raise` stamps the player now, so a quiet beat costs nothing and a
     * busy one costs what it always did.
     *
     * Left out rather than emptied when nothing moved, and the browser applies
     * only the keys it is given.
     *
     * And `p_book`, which is the whole of what this got wrong. The stamp is on
     * the *player*, not on the session — so a browser that had just opened,
     * holding nothing but the starting value of every skill, was told nothing,
     * because the last session had already been told. Reported as mining
     * refusing an iron vein: "Iron vein needs mining 5 to work. Yours is 1.0",
     * with the island's own log line saying 13.26 two lines above it. Worse
     * than wrong — it locks: the seam you cannot start is the seam that would
     * have raised the skill that says you can.
     *
     * So the browser says whether it holds a book, the same way it says how
     * much of the talk it has heard. It asks once, gets the lot, and every
     * beat after that is the delta this was written for.
     */
    'skills', case when not coalesce(p_book, false)
                        and p.skills_seen is not null and p.skills_at is not null
                        and p.skills_at <= p.skills_seen then null
                   else coalesce((select jsonb_object_agg(s.id, s.value) from skill s
                                  where s.world_id = v_world and s.uid = me), '{}'::jsonb) end,
    /*
     * And the journal: what you have done, what you have made, and what is
     * ticked off.
     *
     * Behind the same cursor the book is behind, and for the same reason: it
     * only moves when something is noted, and a browser that has just opened
     * holds none of it. Three fields rather than one because they are three
     * different things — a count of goes, a record of a bench, and a list of
     * ids — and because the browser applies each of them differently.
     */
    'tally', case when not coalesce(p_book, false)
                       and p.tally_seen is not null and p.tally_at is not null
                       and p.tally_at <= p.tally_seen then null
                  else coalesce(p.tally, '{}'::jsonb) end,
    'ledger', case when not coalesce(p_book, false)
                        and p.tally_seen is not null and p.tally_at is not null
                        and p.tally_at <= p.tally_seen then null
                   else coalesce(p.ledger, '{}'::jsonb) end,
    'ticked', case when not coalesce(p_book, false)
                        and p.tally_seen is not null and p.tally_at is not null
                        and p.tally_at <= p.tally_seen then null
                   else coalesce(p.ticked, '[]'::jsonb) end,
    /*
     * And anything said since you last heard.
     *
     * Talk and the island's own lines arrive over Realtime, which is fast and
     * is not a promise: a channel that dropped for a moment loses them for
     * good, and `event` was the one table with no way to catch up. The browser
     * carries the highest `n` it has seen and gets whatever is newer, so a
     * dropped line is twenty seconds late rather than gone.
     */
    'said', case when p_said is null then null
                 when p_said <= 0 then '[]'::jsonb
                 else coalesce((select jsonb_agg(jsonb_build_object(
                        'n', e.n, 'text', e.text, 'kind', e.kind, 'at', e.at) order by e.n)
                      from event e
                      where e.world_id = v_world and e.n > p_said
                        and (e.uid is null or e.uid = me)
                      limit 60), '[]'::jsonb) end,
    /*
     * And where the talk had got to when you arrived.
     *
     * The catch-up above is for a channel that dropped, and it is counted from
     * the highest line the browser has heard. A browser that has just opened
     * has heard none, carries a nought, and was handed the *oldest* sixty
     * lines on the island — "You wash ashore on an untouched island", measured
     * on a body that came ashore a week ago — and then the next sixty on the
     * beat after that, walking forward through its own history while somebody
     * watched.
     *
     * So a nought means "I have just got here" rather than "from the
     * beginning": nothing is missed yet, and the mark to count from comes back
     * instead. What was said before you arrived is `rpc_chat`'s job and it
     * already does it, sixty lines of talk, which is a different question from
     * this one.
     */
    'saidTo', case when coalesce(p_said, 1) > 0 then null
                   else coalesce((select max(e.n) from event e where e.world_id = v_world), 0) end,
    -- The ore a prospector read, and how much longer it is lit for.
    -- Your path: its picks, Calm, the spots sat and what a technique marked (`path_beat`).
    'path', case when v_world is null then null else path_beat(v_world, me) end,
    'marks', case when jsonb_typeof(p.stats->'prospected') <> 'object' then null
                  else jsonb_build_object(
                    'tiles', p.stats->'prospected'->'tiles',
                    'secs', greatest(0, (p.stats->'prospected'->>'until')::double precision
                                        - extract(epoch from now()))) end,
    'queued', coalesce(jsonb_array_length(p.act_queue), 0),
    -- And what hour it is out there, which the browser had been keeping for
    -- itself. Seconds since the island began, so the browser works the hour
    -- out the way it always did rather than being handed a picture to draw.
    'time', case when v_world is null then null else world_time(v_world) end,
    -- The island's own reading of the same clock. Nothing draws from this: it
    -- is here so that two ends disagreeing about whether it is dark can be
    -- seen, rather than found out by a lantern that would not light.
    'night', case when v_world is null then null else is_night(v_world) end));
end $function$;

-- The ground worked, where prospecting now reads further for a Deep Reading.
CREATE OR REPLACE FUNCTION public.perform_ground(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare tx int; ty int; cx int; cy int; here int; t tile_def; v_data int; v_tree tree_def;
        d action_def; v_spoil text;
        v_skill double precision; v_tool double precision; v_ql double precision; v_n int; v_slab item; v_kind int; v_target int; v_hi record; v_lo record;
        v_rock rock_def; v_rad int; v_tiles int[] := '{}'; v_names text[] := '{}'; v_row record;
        v_id bigint; v_species int; v_sprout item; v_buried text; v_size int;
        v_age tree_age_def; v_to tree_age_def; v_needs double precision; v_grown int; v_cut int;
begin
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  here := land_tile(p_world, tx, ty);
  select * into t from tile_def where id = here;
  v_data := land_data(p_world, tx, ty);
  select * into d from action_def where id = p_action;
  -- What this ground is made of, which digging has always read off the tile
  -- and flattening never did.
  v_spoil := coalesce(t.dig_yield, 'dirt');

  -- A flight of garden steps, laid or taken up (`perform_steps`).
  if p_action in ('lay_steps', 'lay_timber_steps', 'take_up_steps') then
    perform perform_steps(p_world, p_uid, p_action, p_target);
    return;
  end if;

  if p_action in ('take_level', 'clear_level') then
    if p_action = 'clear_level' then
      update player set level_h = null where world_id = p_world and uid = p_uid;
      perform tell(p_world, p_uid,
        'You put the level away. Flattening works to the ground you stand on again.', 'event');
    else
      cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
      update player set level_h = land_height(p_world, cx, cy) where world_id = p_world and uid = p_uid;
      perform tell(p_world, p_uid, 'You sight the level at ' || land_height(p_world, cx, cy)
        || '. Flattening works to it, and digging, dropping and concrete stop at it.', 'event');
    end if;
    return;
  end if;

  if p_action = 'flatten' then
    v_target := flatten_target(p_world, p_uid, tx, ty);
    -- The corners furthest above and below the height we are working towards.
    /*
     * The high corner has to be soil, because a shovel does not move rock. It
     * used to be the highest corner whatever it was made of, and a tile with
     * one rock shoulder on it stopped the whole run dead with "Mine it down
     * instead" while the other three corners still had work in them. The rock
     * is stepped round now and named at the end.
     */
    select c.cx, c.cy into v_hi from tile_corners(tx, ty) c
      where land_height(p_world, c.cx, c.cy) > v_target and land_dirt(p_world, c.cx, c.cy) > 0
      order by land_height(p_world, c.cx, c.cy) desc limit 1;
    select c.cx, c.cy into v_lo from tile_corners(tx, ty) c
      where land_height(p_world, c.cx, c.cy) < v_target
      order by land_height(p_world, c.cx, c.cy) limit 1;
    if v_hi.cx is null and v_lo.cx is null then
      perform tell(p_world, p_uid,
        case when exists (select 1 from tile_corners(tx, ty) c
                           where land_height(p_world, c.cx, c.cy) > v_target and land_dirt(p_world, c.cx, c.cy) <= 0)
             then 'What is still standing high here is bare rock. Mine it down.'
             else 'There is nothing left to move here.' end, 'error');
      return;
    end if;
    /*
     * A go moves `flatten_step` -- two units for a Terraformer's Level Hand --
     * but never past the height being worked to, so a corner one short of it
     * moves the one.
     */
    v_n := pk(p_world, p_uid, 'flatten:step', flatten_step())::int;
    if v_hi.cx is not null then
      v_n := least(v_n, land_height(p_world, v_hi.cx, v_hi.cy) - v_target, land_dirt(p_world, v_hi.cx, v_hi.cy));
    end if;
    if v_lo.cx is not null then v_n := least(v_n, v_target - land_height(p_world, v_lo.cx, v_lo.cy)); end if;
    v_n := greatest(1, v_n);
    if v_hi.cx is not null and v_lo.cx is not null then
      -- One corner down and one up: the dirt simply moves across the tile.
      perform raise_corner(p_world, v_hi.cx, v_hi.cy, -v_n);
      perform raise_corner(p_world, v_lo.cx, v_lo.cy, v_n);
      perform tell(p_world, p_uid, 'You move some dirt across the tile.', 'event');
    elsif v_hi.cx is not null then
      perform raise_corner(p_world, v_hi.cx, v_hi.cy, -v_n);
      perform gather(p_world, p_uid, v_spoil, v_n,
        least(100, product_ql(skill_of(p_world, p_uid, d.skill), tool_ql(p_world, p_uid, 'shovel'))
                   * pk(p_world, p_uid, 'ql:flatten', 1)));
      perform tell(p_world, p_uid, 'You scrape the ground down and pocket the '
        || lower((select name from item_def where id = v_spoil)) || '.', 'event');
    else
      /*
       * Its own stuff first and dirt after. Dirt fills anything, and it would
       * be a strange rule that let you take clay out of a bank and not put it
       * back.
       */
      if take_spoil(p_world, p_uid, v_spoil) then
        perform raise_corner(p_world, v_lo.cx, v_lo.cy, 1);
        -- And the second unit of a Level Hand's go, if there is soil for it.
        if v_n > 1 and take_spoil(p_world, p_uid, v_spoil) then perform raise_corner(p_world, v_lo.cx, v_lo.cy, 1); end if;
        perform tell(p_world, p_uid, 'You pack '
          || lower((select name from item_def where id = v_spoil))
          || ' in to bring the ground up.', 'event');
      elsif take_spoil(p_world, p_uid, 'dirt') then
        perform raise_corner(p_world, v_lo.cx, v_lo.cy, 1);
        if v_n > 1 and take_spoil(p_world, p_uid, 'dirt') then perform raise_corner(p_world, v_lo.cx, v_lo.cy, 1); end if;
        perform tell(p_world, p_uid, 'You pack dirt in to bring the ground up.', 'event');
      else
        perform tell(p_world, p_uid, 'You need '
          || lower((select name from item_def where id = v_spoil))
          || ' or dirt to bring this ground up, in the pack or in something beside you.', 'error');
        return;
      end if;
    end if;
    -- And what an hour of levelling ground teaches, which was nothing at all.
    perform skill_raise(p_world, p_uid, d.skill, 1);
    if t.turns_to_dirt then perform land_set_tile(p_world, tx, ty, 1); end if;
    perform land_announce(p_world, tx, ty);
    if not needs_flattening(p_world, p_uid, tx, ty) then
      perform tell(p_world, p_uid,
        case when floor((select x from player where world_id = p_world and uid = p_uid))::int = tx
              and floor((select y from player where world_id = p_world and uid = p_uid))::int = ty
             then 'The tile is now flat at its lowest corner.'
             else 'The tile is now flat and level with the ground you stand on.' end, 'event');
    end if;

  elsif p_action = 'drop_dirt' then
    cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
    -- Dirt, clay or sand: the one named off the menu, or the first to hand.
    v_spoil := spoil_near(p_world, p_uid, target_item(p_target));
    if v_spoil is null or not take_spoil(p_world, p_uid, v_spoil) then return; end if;
    perform raise_corner(p_world, cx, cy, 1);
    -- What a spadeful covers over becomes what was in it, off the list both
    -- sides read: a clay bank or a beach can be laid now as well as dug.
    if exists (select 1 from buryable b where b.tile = here) then
      perform land_set_tile(p_world, tx, ty, spoil_tile(v_spoil));
    end if;
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You drop the ' || lower((select name from item_def where id = v_spoil))
      || ' on the ' || corner_name(tx, ty, cx, cy) || ' corner, raising the ground.', 'event');

  elsif p_action = 'raise_rock' then
    cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
    -- Spent either way: concrete that slumps off is concrete gone.
    if not consume(p_world, p_uid, 'concrete', 1) then return; end if;
    v_skill := skill_of(p_world, p_uid, 'masonry');
    v_tool := tool_ql(p_world, p_uid, 'trowel');
    select i.id into v_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'trowel'
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if v_id is not null then perform wear_tool(v_id); end if;
    -- A Mason's Concrete Hand never fails (`fail:raise_rock`).
    if not perk_pass(skill_check(v_skill, d.difficulty, v_tool), pk(p_world, p_uid, 'fail:raise_rock', 1)) then
      perform skill_raise(p_world, p_uid, 'masonry', try_gain(false));
      perform tell(p_world, p_uid, 'The concrete slumps off the rock before it sets, and is lost.', 'event');
      return;
    end if;
    -- The rock rises: the height goes up and the soil over it stays nought --
    -- two steps for a Mason's Double Lift, where the slope and the level let it.
    v_n := greatest(1, floor(pk(p_world, p_uid, 'lift:raise_rock', 1))::int);
    if v_n > 1 and (slope_refusal(p_world, p_uid, 'masonry', cx, cy, v_n) is not null
                    or land_height(p_world, cx, cy) + v_n
                       > coalesce((select pl.level_h from player pl where pl.world_id = p_world and pl.uid = p_uid),
                                  land_height(p_world, cx, cy) + v_n)) then
      v_n := 1;
    end if;
    perform land_set_height(p_world, cx, cy, land_height(p_world, cx, cy) + v_n);
    perform reconcile_around(p_world, cx, cy);
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You lay concrete on the ' || corner_name(tx, ty, cx, cy)
      || ' corner and the rock stands ' || case when v_n > 1 then number_word(v_n) || ' steps' else 'a step' end
      || ' higher.', 'event');
    perform skill_raise(p_world, p_uid, 'masonry', 1);

  /*
   * A Mason's Rubble Fill: the same step up on bare rock for rock shards
   * rather than a concrete, spent either way, under the same check.
   */
  elsif p_action = 'rubble_fill' then
    cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
    if not consume(p_world, p_uid, 'rock_shards', pk(p_world, p_uid, 'rubble', 0)::int) then return; end if;
    v_skill := skill_of(p_world, p_uid, 'masonry');
    v_tool := tool_ql(p_world, p_uid, 'trowel');
    select i.id into v_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'trowel'
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if v_id is not null then perform wear_tool(v_id); end if;
    if not skill_check(v_skill, d.difficulty, v_tool) then
      perform skill_raise(p_world, p_uid, 'masonry', try_gain(false));
      perform tell(p_world, p_uid, 'The rubble slides off the rock before it binds, and is lost.', 'event');
      return;
    end if;
    perform land_set_height(p_world, cx, cy, land_height(p_world, cx, cy) + 1);
    perform reconcile_around(p_world, cx, cy);
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You pack rubble into the ' || corner_name(tx, ty, cx, cy)
      || ' corner and the rock stands a step higher.', 'event');
    perform skill_raise(p_world, p_uid, 'masonry', 1);

  elsif p_action = 'dredge' then
    cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
    v_skill := skill_of(p_world, p_uid, 'digging');
    v_tool := tool_ql(p_world, p_uid, 'shovel');
    select i.id into v_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'shovel'
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if v_id is not null then perform wear_tool(v_id); end if;
    if not skill_check(v_skill, d.difficulty, v_tool) then
      perform skill_raise(p_world, p_uid, 'digging', try_gain(false));
      perform tell(p_world, p_uid, 'The shovel comes up with nothing but water.', 'event');
      return;
    end if;
    -- The bottom comes up a spadeful at a time, exactly as a corner ashore
    -- does under `dig`: the height and the soil over the rock go down
    -- together, and the water over it is that much deeper.
    perform land_set_height(p_world, cx, cy, land_height(p_world, cx, cy) - 1);
    v_n := land_dirt(p_world, cx, cy) - 1;
    perform land_set_dirt(p_world, cx, cy, v_n);
    if t.turns_to_dirt then perform land_set_tile(p_world, tx, ty, 1); end if;
    perform reconcile_around(p_world, cx, cy);
    perform land_announce(p_world, tx, ty);
    v_ql := least(100, product_ql(v_skill, v_tool) * pk(p_world, p_uid, 'ql:dredge', 1));
    perform gather(p_world, p_uid, v_spoil, 1, v_ql, null, perk_rare(pk(p_world, p_uid, 'rare:dredge', 0)));
    perform tell(p_world, p_uid, 'You dredge up some ' || lower((select name from item_def where id = v_spoil))
      || ' off the bottom at the ' || corner_name(tx, ty, cx, cy) || ' corner. (QL ' || to_char(v_ql, 'FM990.0') || ')', 'event');
    perform skill_raise(p_world, p_uid, 'digging', 1);

  elsif p_action = 'pave_slabs' then
    select i.* into v_slab from item i join slab_def s on s.item = i.def
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and not i.locked
      order by (i.id = target_item(p_target)) desc, i.id limit 1;
    if not found then return; end if;
    select id into v_kind from slab_def where item = v_slab.def;
    if not perk_pass(skill_check(skill_of(p_world, p_uid, 'paving'), d.difficulty, v_slab.ql),
                     pk(p_world, p_uid, 'fail:pave_slabs', 1)) then
      perform skill_raise(p_world, p_uid, 'paving', try_gain(false));
      perform tell(p_world, p_uid,
        'The slab rocks on its bed however you set it. You leave it for now.', 'event');
      return;
    end if;
    if not consume(p_world, p_uid, v_slab.def, 1, v_slab.id) then return; end if;
    perform land_set_tile(p_world, tx, ty, 21);
    perform land_set_data(p_world, tx, ty, v_kind);
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You bed the '
      || lower((select name from item_def where id = v_slab.def)) || ' down flat and true.', 'event');
    perform skill_raise(p_world, p_uid, 'paving', 1);

  elsif p_action = 'remove_paving' then
    -- A slab comes up whole more often than not; gravel and cobbles do not.
    v_kind := case when here = 21 then v_data & 3 else null end;
    perform land_set_tile(p_world, tx, ty, 1);
    perform land_announce(p_world, tx, ty);
    if v_kind is not null and random() < 0.6 then
      v_ql := product_ql(skill_of(p_world, p_uid, 'paving'));
      perform gather(p_world, p_uid, (select item from slab_def where id = v_kind), 1, v_ql);
      perform tell(p_world, p_uid, 'You lever the '
        || regexp_replace(lower((select name from slab_def where id = v_kind)), 's$', '')
        || ' up whole. (QL ' || to_char(v_ql, 'FM990.0') || ')', 'event');
    else
      perform tell(p_world, p_uid, 'You break up the paving, leaving bare dirt.', 'event');
    end if;
    perform skill_raise(p_world, p_uid, 'paving', 1);

  elsif p_action = 'cut_grass' then
    perform mark_foraged(p_world, tx, ty, 'grass');
    -- More to a cut for a Naturalist's Hay Cutter.
    v_cut := floor(pk(p_world, p_uid, 'count:mixed_grass', grass_per_cut()))::int;
    perform gather(p_world, p_uid, 'mixed_grass', v_cut, product_ql(skill_of(p_world, p_uid, 'foraging')));
    -- Grass kept cut on a deed becomes lawn: the tile counts the days, in
    -- the bits `tree_day` reads.
    if here = tile_id('Grass') and on_deed(p_world, tx, ty) then
      v_n := v_data & 3;
      perform land_set_data(p_world, tx, ty, v_n | 4);
      perform land_announce(p_world, tx, ty);
      perform tell(p_world, p_uid, 'You cut ' || number_word(v_cut) || ' bundles of mixed grass.'
        || case when 3 - v_n - 1 > 0
             then ' Kept cut, this will be lawn in ' || (3 - v_n - 1) || ' more day' || case when 3 - v_n - 1 = 1 then '' else 's' end || '.'
             else ' Kept cut, this will be lawn tomorrow.' end, 'event');
    else
      perform tell(p_world, p_uid, 'You cut ' || number_word(v_cut) || ' bundles of mixed grass.', 'event');
    end if;
    perform skill_raise(p_world, p_uid, 'foraging', 1);

  elsif p_action = 'cut_moss' then
    -- Cut as grass is, and the tile stays moss.
    perform mark_foraged(p_world, tx, ty, 'moss');
    v_cut := moss_per_cut()::int;
    perform gather(p_world, p_uid, 'moss', v_cut, product_ql(skill_of(p_world, p_uid, 'foraging')));
    perform tell(p_world, p_uid, 'You cut ' || number_word(v_cut) || ' clumps of moss.', 'event');
    perform skill_raise(p_world, p_uid, 'foraging', 1);

  elsif p_action = 'cut_reeds' then
    perform mark_foraged(p_world, tx, ty, 'reed');
    v_skill := skill_of(p_world, p_uid, 'foraging');
    -- Never fewer than a Naturalist's Reed Cutter says, whatever the roll.
    v_n := greatest(floor(pk(p_world, p_uid, 'count:reed', 0))::int,
                    reed_cut()::int + case when random() < v_skill / reed_extra_at() then 1 else 0 end);
    perform gather(p_world, p_uid, 'reed', v_n,
      product_ql(v_skill, tool_ql(p_world, p_uid, 'carving_knife')));
    perform tell(p_world, p_uid, 'You cut ' || v_n || ' reeds out of the bed.', 'event');
    perform skill_raise(p_world, p_uid, 'foraging', 1);

  elsif p_action = 'pick_fruit' then
    select * into v_tree from tree_def where id = tree_species(v_data);
    -- An old tree carries more than one only just come into bearing, and a
    -- very old one as much as an old one.
    v_skill := skill_of(p_world, p_uid, 'forestry');
    v_n := greatest(1, round(case when tree_age(v_data) in (2, 4) then 5 else 3 end
                             * (0.5 + v_skill / 130) * (0.7 + random() * 0.6))::int)
           -- And one more for a Forester's Fruitful.
           + case when random() < pk(p_world, p_uid, 'more:pick_fruit', 0) then 1 else 0 end;
    v_ql := product_ql(v_skill);
    perform gather(p_world, p_uid, v_tree.fruit, v_n, v_ql);
    perform mark_foraged(p_world, tx, ty, 'forage');
    perform skill_raise(p_world, p_uid, 'forestry', 0.35);
    perform tell(p_world, p_uid, 'You pick ' || v_n || ' '
      || lower((select name from item_def where id = v_tree.fruit))
      || case when v_n = 1 then '' else 's' end
      || ' off the ' || lower(v_tree.name) || '. (QL ' || to_char(v_ql, 'FM990.0') || ')', 'event');

  elsif p_action = 'pick_sprout' then
    select * into v_tree from tree_def where id = tree_species(v_data);
    -- A Forester's Sprout Picker never fails (`fail:pick_sprout`).
    if not perk_pass(skill_check(skill_of(p_world, p_uid, 'forestry'), 15), pk(p_world, p_uid, 'fail:pick_sprout', 1)) then
      perform skill_raise(p_world, p_uid, 'forestry', try_gain(false));
      perform tell(p_world, p_uid, 'You find no sprout worth picking.', 'event');
      return;
    end if;
    -- And picks more than one (`count:sprout`).
    v_n := greatest(1, floor(pk(p_world, p_uid, 'count:sprout', 1))::int);
    perform gather(p_world, p_uid, 'sprout', v_n,
      product_ql(skill_of(p_world, p_uid, 'forestry')), v_tree.name);
    perform tell(p_world, p_uid, case when v_n = 1 then 'You pick a ' || lower(v_tree.name) || ' sprout.'
      else 'You pick ' || number_word(v_n) || ' ' || lower(v_tree.name) || ' sprouts.' end, 'event');
    perform skill_raise(p_world, p_uid, 'forestry', 1);

  elsif p_action = 'prune' then
    select * into v_tree from tree_def where id = tree_species(v_data);
    select * into v_age from tree_age_def where id = tree_age(v_data);
    select * into v_to from tree_age_def where id = v_age.pruned;
    -- The door has already said no to a tree too young for this; a null age
    -- is never written into a tile.
    if v_to.id is null then return; end if;
    v_skill := skill_of(p_world, p_uid, 'forestry');
    v_tool := tool_ql(p_world, p_uid, 'sickle');
    select i.id into v_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'sickle'
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if v_id is not null then perform wear_tool(v_id); end if;
    if not skill_check(v_skill, d.difficulty, v_tool) then
      perform skill_raise(p_world, p_uid, 'forestry', try_gain(false));
      perform tell(p_world, p_uid, 'You cut at the ' || lower(v_tree.name)
        || ' and take off nothing that matters.', 'event');
      return;
    end if;
    /*
     * The age and nothing else. The species stays, and so does the notch a
     * hatchet has left in the trunk — it is beside the land, and the tile is
     * still a tree: pruning is the crown's business, and a half-felled tree
     * pruned back is still half felled.
     */
    perform land_set_data(p_world, tx, ty, tree_pack(tree_species(v_data), v_to.id));
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You prune the ' || lower(v_age.name) || ' ' || lower(v_tree.name)
      || ' back. It stands as a ' || lower(v_to.name) || ' ' || lower(v_tree.name) || ' now.', 'event');
    perform skill_raise(p_world, p_uid, 'forestry', 1);

  elsif p_action = 'plant' then
    -- The one chosen off the menu first, and the oldest that comes to hand if
    -- nobody chose. Sprouts come in nine species and what goes in the ground
    -- is what stands there for the next twenty years, so "whichever was picked
    -- up first" was not a choice anybody had made.
    select * into v_sprout from item where world_id = p_world and holder = 'player'
      and holder_uid = p_uid and def = 'sprout' and not locked
      and (target_item(p_target) is null or id = target_item(p_target))
      order by (id = target_item(p_target)) desc, id limit 1;
    if not found then return; end if;
    v_species := coalesce((select id from tree_def where name = v_sprout.extra), 0);
    if not consume(p_world, p_uid, 'sprout', 1, v_sprout.id) then return; end if;
    perform land_set_tile(p_world, tx, ty, 16);
    -- Species and age packed the one way (`tree_pack`): a planted tree
    -- starts as a sapling and grows on the same clock as one that seeded itself.
    -- Young, or further on for a Forester's Nursery (`grown:plant`).
    v_grown := planted_age(floor(pk(p_world, p_uid, 'grown:plant', 0))::int);
    perform land_set_data(p_world, tx, ty, tree_pack(v_species, v_grown));
    perform land_announce(p_world, tx, ty);
    perform journal_note(p_world, p_uid, 'planted');
    if (select fruit from tree_def where id = v_species) is not null then
      perform journal_note(p_world, p_uid, 'orchard');
    end if;
    perform tell(p_world, p_uid, 'You plant the '
      || lower((select name from tree_def where id = v_species)) || ' sprout.'
      || case when v_grown = planted_age(0) then ''
              else ' It comes up a ' || lower((select name from tree_age_def where id = v_grown)) || ' '
                   || lower((select name from tree_def where id = v_species)) || '.' end, 'event');
    perform skill_raise(p_world, p_uid, 'forestry', 1);

  elsif p_action = 'graft' then
    -- The sprout named off the menu, or the first fruit sprout to hand.
    select i.* into v_sprout from item i join tree_def td on td.name = i.extra and td.fruit is not null
     where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid
       and i.def = 'sprout' and not i.locked
       and (target_item(p_target) is null or i.id = target_item(p_target))
     order by (i.id = target_item(p_target)) desc, i.id limit 1;
    if not found then return; end if;
    select * into v_tree from tree_def where id = tree_species(v_data);
    v_species := (select id from tree_def where name = v_sprout.extra);
    -- The sprout is spent either way: a graft that does not take is a sprout gone.
    if not consume(p_world, p_uid, 'sprout', 1, v_sprout.id) then return; end if;
    v_skill := skill_of(p_world, p_uid, 'forestry');
    v_tool := tool_ql(p_world, p_uid, 'carving_knife');
    select i.id into v_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'carving_knife'
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if v_id is not null then perform wear_tool(v_id); end if;
    -- A Forester's Master Grafter's graft always takes (`fail:graft`).
    if not perk_pass(skill_check(v_skill, d.difficulty, v_tool), pk(p_world, p_uid, 'fail:graft', 1)) then
      perform skill_raise(p_world, p_uid, 'forestry', try_gain(false));
      perform tell(p_world, p_uid, 'The ' || lower(v_sprout.extra) || ' graft does not take, and the sprout is spent.', 'event');
      return;
    end if;
    -- The species and nothing else: the age stays, and so does any notch.
    perform land_set_data(p_world, tx, ty, tree_pack(v_species, tree_age(v_data)));
    perform land_announce(p_world, tx, ty);
    perform journal_note(p_world, p_uid, 'orchard');
    perform tell(p_world, p_uid, 'You graft the ' || lower(v_sprout.extra) || ' sprout onto the ' || lower(v_tree.name)
      || '. It is a ' || lower((select name from tree_age_def where id = tree_age(v_data))) || ' '
      || lower(v_sprout.extra) || ' tree now.', 'event');
    perform skill_raise(p_world, p_uid, 'forestry', 1);

  elsif p_action = 'harvest_bush' then
    -- As fruit off a tree: more to a practised hand, and never nothing.
    v_skill := skill_of(p_world, p_uid, 'forestry');
    v_tool := tool_ql(p_world, p_uid, 'sickle');
    select i.id into v_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'sickle'
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if v_id is not null then perform wear_tool(v_id); end if;
    v_n := greatest(1, round(3 * (0.5 + v_skill / 130) * (0.7 + random() * 0.6))::int)
           -- And one more for a Forester's Hedge Harvest.
           + case when random() < pk(p_world, p_uid, 'more:harvest_bush', 0) then 1 else 0 end;
    v_ql := product_ql(v_skill, v_tool);
    perform gather(p_world, p_uid, (select yields from bush_def where id = bush_species(v_data)), v_n, v_ql);
    perform mark_foraged(p_world, tx, ty, 'forage');
    perform skill_raise(p_world, p_uid, 'forestry', 0.35);
    perform tell(p_world, p_uid, 'You cut ' || v_n || ' '
      || lower((select name from item_def where id = (select yields from bush_def where id = bush_species(v_data))))
      || ' off the ' || lower((select name from bush_def where id = bush_species(v_data)))
      || '. (QL ' || to_char(v_ql, 'FM990.0') || ')', 'event');

  elsif p_action = 'coppice' then
    -- A Forester's Coppice: a tree grown enough to bear, cut back to young off
    -- the stool for `coppice` logs, and left standing to grow on.
    select * into v_tree from tree_def where id = tree_species(v_data);
    select * into v_age from tree_age_def where id = tree_age(v_data);
    if here <> 16 or not coalesce(v_age.alive and v_age.bears, false) then return; end if;
    v_skill := skill_of(p_world, p_uid, 'woodcutting');
    v_tool := tool_ql(p_world, p_uid, 'hatchet');
    select i.id into v_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'hatchet'
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if v_id is not null then perform wear_tool(v_id); end if;
    if not skill_check(v_skill, d.difficulty, v_tool) then
      perform skill_raise(p_world, p_uid, 'woodcutting', try_gain(false));
      perform tell(p_world, p_uid, 'Your hatchet glances off and you fail to make headway.', 'event');
      return;
    end if;
    -- A fresh trunk off the stool: whatever notch was in the old one went with it.
    perform land_set_data(p_world, tx, ty, tree_pack(tree_species(v_data), planted_age(0)));
    delete from tree_notch where world_id = p_world and x = tx and y = ty;
    perform land_announce(p_world, tx, ty);
    v_n := floor(pk(p_world, p_uid, 'coppice', 0))::int;
    v_ql := product_ql(v_skill, v_tool);
    perform gather(p_world, p_uid, 'log', v_n, v_ql, v_tree.name);
    perform tell(p_world, p_uid, 'You cut the ' || lower(v_age.name) || ' ' || lower(v_tree.name)
      || ' back to the stool and get ' || v_n || case when v_n = 1 then ' log' else ' logs' end
      || '. (QL ' || to_char(v_ql, 'FM990.0') || ') It stands as a '
      || lower((select name from tree_age_def where id = planted_age(0))) || ' ' || lower(v_tree.name) || ' now.', 'event');
    perform skill_raise(p_world, p_uid, 'woodcutting', 1);

  elsif p_action = 'tap_resin' then
    -- A Forester's Tap Resin: `tap_resin` tar out of a living pine, once a day
    -- for each -- the refusal says when it runs again.
    v_skill := skill_of(p_world, p_uid, 'forestry');
    v_tool := tool_ql(p_world, p_uid, 'carving_knife');
    select i.id into v_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'carving_knife'
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if v_id is not null then perform wear_tool(v_id); end if;
    perform mark_foraged(p_world, tx, ty, 'resin');
    v_n := floor(pk(p_world, p_uid, 'tap_resin', 0))::int;
    v_ql := product_ql(v_skill, v_tool);
    perform gather(p_world, p_uid, 'tar', v_n, v_ql);
    perform tell(p_world, p_uid, 'You cut the ' || lower((select name from tree_def where id = resin_tree()))
      || '''s bark and collect ' || v_n || ' ' || lower((select name from item_def where id = 'tar'))
      || ' from it. (QL ' || to_char(v_ql, 'FM990.0') || ')', 'event');
    perform skill_raise(p_world, p_uid, 'forestry', 1);

  elsif p_action = 'clear_brush' then
    -- A Forester's Clear Brush: every bush and reed within `clear_brush` tiles
    -- of the one chosen, in one go. A bush leaves grass and reeds bare dirt,
    -- as `CLEARED_TO` has it in the browser.
    select i.id into v_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'sickle'
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if v_id is not null then perform wear_tool(v_id); end if;
    v_rad := floor(pk(p_world, p_uid, 'clear_brush', 0))::int;
    v_n := 0;
    for v_row in select gx, gy from generate_series(ty - v_rad, ty + v_rad) gy, generate_series(tx - v_rad, tx + v_rad) gx
                  where in_bounds(p_world, gx, gy) and land_tile(p_world, gx, gy) in (tile_id('Bush'), tile_id('Reed')) loop
      perform land_set_tile(p_world, v_row.gx, v_row.gy,
        case when land_tile(p_world, v_row.gx, v_row.gy) = tile_id('Bush') then tile_id('Grass') else tile_id('Dirt') end);
      perform land_set_data(p_world, v_row.gx, v_row.gy, 0);
      perform land_announce(p_world, v_row.gx, v_row.gy);
      v_n := v_n + 1;
    end loop;
    perform tell(p_world, p_uid, 'You clear the brush off ' || v_n || case when v_n = 1 then ' tile.' else ' tiles.' end, 'event');
    perform skill_raise(p_world, p_uid, 'forestry', 1);

  elsif p_action = 'dig_stump' then
    select * into v_tree from tree_def where id = tree_species(v_data);
    v_skill := skill_of(p_world, p_uid, 'digging');
    v_tool := tool_ql(p_world, p_uid, 'shovel');
    select i.id into v_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'shovel'
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if v_id is not null then perform wear_tool(v_id); end if;
    if not skill_check(v_skill, d.difficulty, v_tool) then
      perform skill_raise(p_world, p_uid, 'digging', try_gain(false));
      perform tell(p_world, p_uid, 'The roots hold. You dig round the ' || lower(v_tree.name)
        || ' stump and it does not shift.', 'event');
      return;
    end if;
    -- Bare dirt where it stood: the roots came out with it.
    perform land_set_tile(p_world, tx, ty, tile_id('Dirt'));
    perform land_set_data(p_world, tx, ty, 0);
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You dig the ' || lower(v_tree.name)
      || ' stump out. The ground is bare dirt where it stood.', 'event');
    -- And a log of the tree's kind, for a Terraformer's Stump Puller.
    v_n := pk(p_world, p_uid, 'stump:log', 0)::int;
    if v_n > 0 then
      perform gather(p_world, p_uid, 'log', v_n, product_ql(v_skill, v_tool), v_tree.name);
      perform tell(p_world, p_uid, 'The root ball comes up with a length of good ' || lower(v_tree.name) || ' on it.', 'event');
    end if;
    perform skill_raise(p_world, p_uid, 'digging', 1);

  elsif p_action = 'dig_worms' then
    perform skill_raise(p_world, p_uid, 'digging', 0.2);
    select i.id into v_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'shovel'
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if v_id is not null then perform wear_tool(v_id, 0.4); end if;
    -- Damp ground gives more than dry: a marsh is full of them.
    v_n := floor(random() * case when t.rich_worms then 5 else 3 end)::int
           + case when t.rich_worms then 1 else 0 end;
    if v_n = 0 then
      perform tell(p_world, p_uid, 'You turn a spadeful over and nothing is moving in it.', 'event');
      return;
    end if;
    perform gather(p_world, p_uid, 'worm', v_n, 20 + random() * 40);
    perform journal_note(p_world, p_uid, 'worms');
    perform tell(p_world, p_uid, 'You turn the dirt over and pick ' || v_n || ' worm'
      || case when v_n > 1 then 's' else '' end || ' out of it.', 'event');

  elsif p_action = 'prospect' then
    v_skill := skill_of(p_world, p_uid, 'prospecting');
    v_rad := prospect_radius(v_skill) + pk(p_world, p_uid, 'further:prospect', 0)::int + path_fx(p_world, p_uid, 'further', 0)::int;
    v_size := (select size from world where id = p_world);
    -- Metal counts wherever it lies: bare, under soil, or below water.
    for v_row in select x, y, (bedrock_at(p_world, x, y)).name as nm
      from generate_series(greatest(0, tx - v_rad), least(v_size - 1, tx + v_rad)) x
      cross join generate_series(greatest(0, ty - v_rad), least(v_size - 1, ty + v_rad)) y
      -- Anything worth mining, not only what is metal: a coal seam is a
      -- seam, and asking `ore` is asking whether its name ends in `_ore`.
      where (bedrock_at(p_world, x, y)).seam
      order by y, x
    loop
      v_tiles := v_tiles || (v_row.y * v_size + v_row.x);
      v_names := v_names || lower(v_row.nm);
    end loop;
    perform mark_prospected(p_world, p_uid, v_tiles);

    -- Sampling where you stand tells you what that particular rock holds.
    v_rock := bedrock_at(p_world, tx, ty);
    v_ql := ore_max_ql((select seed from world where id = p_world), tx, ty);
    v_buried := case when here = 4 then ''
      else ' It lies under ' || greatest(1, land_dirt(p_world, tx, ty)) || ' of ground.' end;
    if v_rock.seam then
      perform tell(p_world, p_uid, 'You sample the ' || lower(v_rock.name)
        || '. It needs mining ' || to_char(case when v_rock.ore
                                                then greatest(0, v_rock.level - pk(p_world, p_uid, 'ore:below', 0))
                                                else v_rock.level end, 'FM990')
        || ' to work' || case when skill_of(p_world, p_uid, 'mining')
                                   >= case when v_rock.ore
                                           then greatest(0, v_rock.level - pk(p_world, p_uid, 'ore:below', 0))
                                           else v_rock.level end
                              then ', which you have' else '' end
        || ', and will give up nothing finer than quality ' || to_char(v_ql, 'FM990')
        || '.' || v_buried, 'event');
    else
      perform tell(p_world, p_uid, 'Plain ' || lower(v_rock.name)
        || ' beneath you, with no metal in it, and nothing finer than quality '
        || to_char(v_ql, 'FM990') || ' in the stone.' || v_buried, 'event');
    end if;

    if coalesce(array_length(v_tiles, 1), 0) = 0 then
      perform tell(p_world, p_uid, 'You read the ground ' || v_rad
        || ' tiles about you and find no sign of anything worth mining.', 'event');
    else
      perform tell(p_world, p_uid, 'Within ' || v_rad || ' tiles you read '
        || (select string_agg(case when n > 1 then n || ' tiles of ' || nm
                                   else 'a tile of ' || nm end, ' and ' order by nm)
            from (select nm, count(*) as n from unnest(v_names) nm group by nm) q)
        || ', buried or bare. They are marked for a while.', 'event');
    end if;
    perform skill_raise(p_world, p_uid, 'prospecting', 1);
  end if;

end $function$;

-- Everything above is the island's own but the new door: shut to players again.
select private.lock_doors();
