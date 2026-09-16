-- Deep water, which this island has never charged anybody a thing for.
--
-- `swim_wind()` and `drown_rate()` were crossed from the browser the day the
-- body was ported and called by nothing on either side of the water since. So:
-- open water cost no wind, nobody has ever been out of breath in it, and
-- nobody has ever drowned. You could swim the length of the island and step
-- out the far end as fresh as you went in.
--
-- And the trade it teaches was worse than absent — it was *thrown away*.
-- `gainSkill('swimming', …)` still runs in the browser on an island, because
-- climbing and swimming are the two the browser was left owning. But the book
-- the island sends every beat is `jsonb_object_agg` over the `skill` table, and
-- this island has never had a `swimming` row to put in it, so the number went
-- up locally, was overwritten the first time anything else raised a skill, and
-- was gone entirely at the next refresh. An afternoon in the water, and
-- swimming is back to one.
--
-- ## What is actually in the water
--
-- The browser asked one question — is the ground under me below `SWIM_DEPTH` —
-- and asked it of the ground alone. So a hull in thirty feet of water was
-- swimming: slowed to a swimmer's share of a walking pace, spending a
-- swimmer's wind, and drowning its crew once that ran out. In a boat. A Wadd
-- carrying a rider across a sound was the same, and a Wadd is the one mount
-- on this island that exists to do exactly that.
--
-- The question deep water is really asking is whether your own feet are in
-- it. A deck, a hull, a cart bed and a saddle all mean they are not, and only
-- the island knows what is under you — so `in_deep_water` asks, and the
-- browser now says `carried` each tick so its own answer agrees.
--
-- ## What a stretch of it costs
--
-- The same shape as every other body rule here: the island cannot watch you
-- between beats, so it charges the stretch it is settling at the rate for
-- where you are standing when it settles. A swimmer is a body that is moving,
-- and moving is `rpc_move`, which settles — so in practice this runs about
-- twice a second for somebody actually swimming.
--
--     wind      spends at `swim_wind`, eased by the swimming trade, rather
--               than coming back at `wind_rest`
--     health    falls at `drown_rate` once the wind is gone, and a body that
--               reaches nought dies where every other death on this island
--               does, in `player_die`
--     swimming  rises by `swim_learn` a second, paid for in whole seconds so
--               that a browser beating ten times a second cannot buy ten
--               goes of `min_gain()` out of one
--     healing   does not happen at all: nothing knits while you are trying
--               not to drown, which is what the browser has always done
--
-- Three minutes is the cap on any settled stretch (`body_gap`), and it applies
-- here as it does to hunger — so a body left in open water and come back to an
-- hour later has drowned. That is the honest answer and not a harsh one:
-- death on this island is a wake-up at the shore you came in on with
-- everything you were carrying still on you, and leaving your body in the sea
-- is a thing you did.
--
-- ## Where this meets the tide line
--
-- `swim_depth` is four and `mine_depth` is ten, and they are answering the
-- same question with different numbers. A miner standing on the bank and
-- working a face down to ten under the line is dry and always was. A miner who
-- walks *out* to stand on ground five under the line is swimming, by the rule
-- the browser has kept since swimming was written — so from here on that
-- miner tires, and stays long enough and drowns.
--
-- Both numbers are one line each and neither is changed here, because a feel
-- change to where deep water starts is not a bug fix. Worth knowing that the
-- two do not agree, and that this is the migration that makes the
-- disagreement cost something.
--
-- ## And what is deliberately *not* here
--
-- Speed. `travel_speed` feeds the pull-back in `rpc_move` — the slack a
-- claimed walk is allowed — and it is already generous by a factor of 1.6 plus
-- a tile and a half, because a link that hiccups must not yank anybody
-- backwards. Narrowing it to a swimmer's pace would buy a fifth of a cheat
-- that is already there for walking, and pay for it in exactly the
-- rubber-banding this pull-back exists to avoid. The browser slows its own
-- swimmer, as it always has; the island charges what it costs.

alter table player add column if not exists swim_at timestamptz;
alter table player add column if not exists drowned_at timestamptz;

/**
 * Whether this body's own feet are in water deep enough to be swimming in.
 *
 * The cheap question first: almost everybody, almost always, is on dry ground,
 * and `centre_height` is four scanline reads against an index. Only a body
 * that really is out over deep water pays for the rest of it.
 *
 * `centre_height` rather than the browser's bilinear reading at the exact
 * spot, because the island has no such reading and because the tile is the
 * unit every other water question here is asked in. The two disagree by less
 * than a step along a shelving shore, which is a body that is up to its chest
 * either way.
 */
create or replace function in_deep_water(p_world uuid, p_uid uuid) returns boolean
  language sql stable as $fn$
  select case
    -- A bridge deck or a mine floor is not the ground, and not the water.
    when p.level <> 0 then false
    when centre_height(p_world, floor(p.x)::int, floor(p.y)::int) >= -swim_depth() then false
    -- A hull, a cart bed or a saddle: something else is holding you up.
    when exists (select 1 from placed q where q.world_id = p_world and q.driver = p_uid) then false
    when exists (select 1 from creature c where c.world_id = p_world and c.rider = p_uid) then false
    else bridge_at(p_world, floor(p.x)::int, floor(p.y)::int) is null
  end
  from player p where p.world_id = p_world and p.uid = p_uid
$fn$;

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

notify pgrst, 'reload schema';
