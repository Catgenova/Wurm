-- Everything the island kept about you and never spent.
--
-- `skill_raise` applied one modifier — the reader's path from meditation — and
-- nothing else. Meanwhile `player` carries four columns the browser draws:
--
--     rested    banked by sleeping     `rest_bonus()` called by nothing
--     boons     written by eating      read by nothing
--     knacks    never written at all   read by nothing
--     titles    never written at all   read by nothing
--
-- So on a live island a night in a bed bought nothing, a stew favoured a trade
-- and the favouring did nothing, no knack was ever earned, and the Skills
-- window's "take any trade to 50 and they will start calling you something"
-- was an invitation to nothing: no function on the island mentioned a title.
--
-- All four are spent now, in the browser's own shape — `skill_mult` is
-- `skillMult` term for term, on the base rather than the gain, because
-- `skill_gain_of` is not linear in what it is given. Knacks are earned at one
-- go in five thousand and land on the trade or a neighbour of it; titles at
-- fifty, seventy, ninety and ninety-nine.
--
-- Rest burns while there is a job in hand, which it has to: rest that never
-- runs out is a doubled rate for ever, and that would have been worse than the
-- bug it replaces.
--
-- And the beat carries all of it, because a hud saying "Rested 12m ·
-- everything ×2" off a number the island never sent is a hud making it up.

/** What the knacks in a trade are worth to the rate it goes in at. */
create or replace function knack_bonus(p_n int) returns double precision
  language sql immutable as $fn$
  select least(knack_cap(), greatest(0, coalesce(p_n, 0)))::double precision * knack_each()
$fn$;

/** How well fed a body is in the worst of the four, which is what a diet is judged on. */
create or replace function nutrition_balance(p jsonb) returns double precision
  language sql immutable as $fn$
  select coalesce(min(least(1, greatest(0, coalesce((p->>k)::double precision, 0)))), 0)
    from unnest(array['starch', 'flesh', 'fat', 'greens']) k
$fn$;

/** And in general: the average of the four. */
create or replace function nutrition_fedness(p jsonb) returns double precision
  language sql immutable as $fn$
  select coalesce(avg(least(1, greatest(0, coalesce((p->>k)::double precision, 0)))), 0)
    from unnest(array['starch', 'flesh', 'fat', 'greens']) k
$fn$;

/**
 * What a table with all four things on it is worth on what you learn.
 *
 * It reads off the *worst* of the four, so a week of nothing but bread buys
 * nothing — which is the whole point of keeping four of them.
 */
create or replace function table_mul(p jsonb) returns double precision
  language sql immutable as $fn$ select 1 + table_best() * nutrition_balance(p) $fn$;

/**
 * How much faster a trade goes into you than it otherwise would.
 *
 * Every term of this was already kept on the player row and none of it was
 * ever spent. `skill_raise` applied one thing — the reader's path — and
 * nothing else, so a night in a bed, a stew that favours the trade, a knack
 * earned over a long day and a table with all four things on it were all
 * columns the browser drew and the island ignored.
 *
 * The shape is the browser's `skillMult`, term for term: rest doubles, knacks
 * and the reader's path add, the table multiplies what those come to, and
 * whatever you have eaten that favours *this* trade adds on the end.
 */
create or replace function skill_mult(p_world uuid, p_uid uuid, p_id text)
  returns double precision language plpgsql stable as $fn$
declare p player; m double precision;
begin
  select * into p from player where world_id = p_world and uid = p_uid;
  if not found then return 1; end if;
  m := case when coalesce(p.rested, 0) > 0 then rest_mult() else 1 end;
  -- A knack earned on the way up never wears off, unlike a meal or a night's sleep.
  m := m + knack_bonus((p.knacks->>p_id)::int);
  -- And the reader's path is a tenth on everything, for good.
  if p_id <> meditation_skill() and walks(p_world, p_uid, 'knowledge', 1) then m := m + 0.1; end if;
  m := m * table_mul(p.nutrition);
  -- And the dish that favours this one, while it lasts.
  m := m + coalesce((select sum((b->>'bonus')::double precision)
                       from jsonb_array_elements(coalesce(p.boons, '[]'::jsonb)) b
                      where b->>'skill' = p_id
                        and (b->>'until')::double precision > world_time(p_world)), 0);
  return greatest(0.01, m);
end $fn$;

/**
 * A knack from a go at a trade: one in five thousand, whatever the level.
 *
 * Not tied to the level you reach, so a trade keeps paying them for as long as
 * you keep working at it rather than stopping dead once the early tens are
 * behind you. It lands usually on the trade you were working and sometimes on
 * one beside it — the same hands and the same wood. Permanent, and they stack
 * five to a trade, which is half again on everything that trade teaches you.
 */
create or replace function earn_knacks(p_world uuid, p_uid uuid, p_id text) returns void
  language plpgsql as $fn$
declare p player; v_id text; had int;
begin
  if random() >= 1.0 / knack_odds() then return; end if;
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
  perform tell(p_world, p_uid, 'You have a knack for '
    || lower((select name from skill_def where id = v_id)) || ' now. It goes in '
    || round(knack_bonus(had + 1) * 100) || '% faster.', 'skill');
end $fn$;

/**
 * And what a trade earns you the right to be called.
 *
 * Four to a trade — at fifty, seventy, ninety and ninety-nine — and the first
 * one you earn is the one you wear until you say otherwise. `player.titles`
 * has been on the row since the day it was made and nothing on this island has
 * ever put anything in it, so the Skills window's "take any trade to 50 and
 * they will start calling you something" was an invitation to nothing.
 */
create or replace function earn_titles(p_world uuid, p_uid uuid, p_id text,
                                       p_before double precision, p_after double precision)
  returns void language plpgsql as $fn$
declare p player; t title_def;
begin
  if floor(p_after) <= floor(p_before) then return; end if;
  select * into p from player where world_id = p_world and uid = p_uid for update;
  if not found then return; end if;
  for t in select * from title_def where skill = p_id and p_after >= at and p_before < at order by at loop
    if coalesce(p.titles, '[]'::jsonb) ? t.id then continue; end if;
    update player set titles = coalesce(titles, '[]'::jsonb) || to_jsonb(t.id),
           title = coalesce(title, t.id)
      where world_id = p_world and uid = p_uid returning * into p;
    perform tell(p_world, p_uid, 'They will call you ' || t.name
      || ' for that. (Skills, to wear it)', 'skill');
  end loop;
end $fn$;

CREATE OR REPLACE FUNCTION public.skill_raise(p_world uuid, p_uid uuid, p_id text, p_base double precision)
 RETURNS double precision
 LANGUAGE plpgsql
AS $function$
declare was double precision; now_v double precision;
begin
  was := skill_of(p_world, p_uid, p_id);
  /*
   * Everything that makes a trade go in faster, which was four things kept on
   * the row and one thing spent.
   *
   * The reader's path was applied here and nothing else was: rest, knacks, a
   * dish that favours the trade and a table with all four things on it were
   * columns the browser drew and this ignored. `skill_mult` is the browser's
   * own `skillMult`, term for term, and it goes on the *base* the way it does
   * over there rather than on the gain that comes out — the two are not the
   * same number, because `skill_gain_of` is not linear in what it is given.
   */
  now_v := least(100, was + skill_gain_of(was, p_base * skill_mult(p_world, p_uid, p_id),
                                          0.6 + 0.8 * random()));
  insert into skill (world_id, uid, id, value) values (p_world, p_uid, p_id, now_v)
    on conflict (world_id, uid, id) do update set value = excluded.value;
  -- So the beat knows whether the book is worth sending.
  update player set skills_at = now() where world_id = p_world and uid = p_uid;
  -- And what the go left behind besides the number.
  perform earn_knacks(p_world, p_uid, p_id);
  perform earn_titles(p_world, p_uid, p_id, was, now_v);
  return now_v - was;
end $function$;

CREATE OR REPLACE FUNCTION public.body_settle(p_world uuid, p_uid uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare p player; secs double precision;
        h double precision; t double precision; w double precision; hp double precision;
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

  h := greatest(0, h - secs * hunger_rate());
  t := greatest(0, t - secs * thirst_rate());
  if p.act is null then
    w := least(1, w + secs * wind_rest()
           * (1 + greatest(0, skill_of(p_world, p_uid, 'body_stamina') - char_start()) * wind_per_level())
           * (case when h <= 0 or t <= 0 then wind_starving() else 1 end));
  end if;
  if h > heal_fed() and t > heal_fed() and hp < 1 then
    hp := least(1, hp + secs * heal_rate());
  end if;

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

  update player set body_at = now(), stats = jsonb_set(jsonb_set(jsonb_set(jsonb_set(
      coalesce(stats, '{}'::jsonb),
      '{hunger}', to_jsonb(h)), '{thirst}', to_jsonb(t)),
      '{stamina}', to_jsonb(w)), '{health}', to_jsonb(hp))
    where world_id = p_world and uid = p_uid;
end $function$;

CREATE OR REPLACE FUNCTION public.rpc_settle(p_seen bigint DEFAULT NULL::bigint, p_world uuid DEFAULT NULL::uuid, p_said bigint DEFAULT NULL::bigint, p_book boolean DEFAULT false)
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
  return jsonb_strip_nulls(jsonb_build_object(
    'settled', n,
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
                        'n', e.n, 'text', e.text, 'kind', e.kind) order by e.n)
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

notify pgrst, 'reload schema';
