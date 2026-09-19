-- What the bench gives back, and what a click is worth.
--
-- Three reports in one message, and all three are about the moment a go ends.
-- Two of them are this side's: improving anything at all, and what a go that
-- did not come off is worth. The third is the hands being paid for a click.
--
-- ---- a lump's metal is written on the lump, not on a label beside it -------
--
-- Reported: "my bronze anvil isn't letting me improve it saying that i need
-- bronze, but i have 37 bronze lumps on me", and then the edit that gives the
-- real size of it: "actually it looks like everything i try to improve is
-- telling me that."
--
-- Everything, and on every island. `stock_for` asked whether the stock in your
-- pack was the right stuff by reading its `extra` column and nothing else —
-- and a lump has no `extra`. It never has. A lump's metal is in its name:
-- `bronze_lump` is bronze the way a plank is a plank, and the column beside it
-- is for a thing that could have been made of several stuffs and needs to say
-- which. So the comparison was 'bronze' against the empty string, for every
-- lump of every metal, and nothing made of metal has ever been improvable on
-- an island since improving was ported.
--
-- The browser has always had this right: its `materialOfItem` reads the
-- `extra` first and falls back to the metal the item's own id names. This is
-- that function, in Postgres, so the two of them answer alike — `mat_of_item`,
-- asked of the stock rather than of a column.
--
-- And one more hole in the same rule, which the browser had too: stock whose
-- material cannot be worked out at all — an unmarked plank, a shaft off an old
-- save — matched nothing, because an empty answer was compared against a real
-- one and lost. Stock that does not say what it is made of is generic stock
-- and will go into anything. It is the one that *does* say, and says something
-- else, that has to be refused.

/**
 * What a thing is made of: the material its `extra` names, and failing that
 * the metal its own id names. The browser's `materialOfItem`, term for term.
 */
create or replace function mat_of_item(p_def text, p_extra text)
returns material_def language sql stable as $fn$
  select m.* from material_def m
   where m.id = coalesce(
     (select n.id from material_def n where n.id = lower(coalesce(p_extra, ''))),
     (select d.id from metal_def d where d.lump = p_def))
$fn$;

create or replace function stock_for(p_world uuid, p_uid uuid, p_material text, p_made text)
returns item language sql stable as $fn$
  select i.* from item i
  join improve_stock s on s.item = i.def and s.material = p_material
  cross join lateral (select (mat_of_item(i.def, i.extra)).name as made) k
  where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid
    -- Stock that says what it is made of has to say the right thing; stock
    -- that says nothing is stock of no particular sort and goes into anything.
    and (p_made is null or k.made is null or lower(k.made) = lower(p_made))
  order by i.ql limit 1
$fn$;

-- ---- and what a go that did not come off is worth -------------------------

/**
 * What a go that did not come off is worth, which is the other half of the
 * same afternoon. Reported alongside: "i've made a lot of whetstones and
 * haven't managed anything other than QL 1, even got a rare QL 1."
 *
 * This handed back a flat 1 every time the tool's roll missed, and an issued
 * copper chisel is quality fifteen — so five goes in six came off the bench as
 * rubbish, and the sixth came off at your stonecutting, which on the day you
 * start is also about one. A rough tool makes rough work, which is not the
 * same as making rubbish: a miss comes out at what the tool is worth, never
 * above what your hands could have managed on their own.
 */
create or replace function product_ql(p_skill double precision, p_tool_ql double precision default 0)
returns double precision language sql volatile as $fn$
  select case
    when p_tool_ql <= 0
      then least(100, greatest(1, least(100, greatest(1, p_skill)) * (0.6 + random() * 0.8) + 1))
    when random() * 100 < p_tool_ql then least(100, greatest(1, p_skill))
    else least(least(100, greatest(1, p_skill)),
               greatest(1, p_tool_ql * (0.6 + random() * 0.8))) end
$fn$;

-- ---- and a click is not work ----------------------------------------------
--
-- Reported: "free body control gains from examining as well as keeping/putting
-- back items." Keeping one back is on the list of jobs that teach the body
-- nothing, along with the rest of the eating, drinking and carrying about, and
-- had been since "a mouthful is not exercise". Examining is not, and neither
-- are the thirty-one other jobs that cost no wind and take no time — naming a
-- thing, sighting a level off one, setting a stance, choosing a path. All of
-- them paid a full measure of body control for a click.
--
-- Which is the trouble with answering this with a list: a list is something
-- somebody has to remember to add to, and nobody has. So the rule is read off
-- the job as well: a go that costs nothing and takes no time is not work, and
-- the hands learn nothing from it. The list stays, because a bucket tipped out
-- does cost wind and still teaches nothing, and the two together are the whole
-- of it. The browser gets the same second half.
--
-- It is worse here than in the browser, because an instant job comes due the
-- moment it is asked for: `rpc_act` sets it going and settles it in the same
-- call. A body could stand still and read labels all afternoon.
create or replace function spend_wind(p_world uuid, p_uid uuid, p_action text)
returns void language plpgsql as $fn$
declare cost double precision; secs double precision; w double precision;
        body double precision; spent double precision; v_idle boolean;
begin
  select stamina, base_time into cost, secs from action_def where id = p_action;
  -- And nothing at all for the jobs that are not work: the named ones, and the
  -- ones that ask nothing of you. The wind below is still spent where there is
  -- any: a cost is not a lesson.
  v_idle := teaches_nothing(p_action)
         or (coalesce(cost, 0) <= 0 and coalesce(secs, 0) <= 0);
  /*
   * What the go taught the hands, whatever it was and whatever it cost.
   *
   * Before the wind, and outside the guard below, because a go that costs no
   * wind but takes time is still work: shuttering, sighting a level, watching
   * a kiln. It is not the digging skill — a body that has swung a shovel a
   * thousand times has a steadier hand than one that has not, at anything.
   */
  if not v_idle then
    perform char_told(p_world, p_uid, 'body_control', work_hand());
    -- And the back, from the heavy trades: a shovel or a pick, whatever the go found.
    if coalesce((select s.heavy from action_def a join skill_def s on s.id = a.skill where a.id = p_action), false) then
      perform char_told(p_world, p_uid, 'body_strength', work_back());
    end if;
  end if;
  if coalesce(cost, 0) <= 0 then return; end if;
  perform body_settle(p_world, p_uid);
  -- A hardy body spends less on the same job. No burden here: the island does
  -- not know what you are carrying.
  body := greatest(0.45, 1 - greatest(0, skill_of(p_world, p_uid, 'body_stamina') - char_start()) * 0.0045);
  spent := cost * body;
  select coalesce((stats->>'stamina')::double precision, 1) into w
    from player where world_id = p_world and uid = p_uid;
  update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}',
      to_jsonb(greatest(0, w - spent)))
    where world_id = p_world and uid = p_uid;
  /*
   * And what spending it taught the chest.
   *
   * On what was actually spent rather than on what the job lists, so the same
   * dig teaches a tired body and a hardy one differently — which is the same
   * arithmetic the wind itself came off. The browser reckons its own spend
   * with the burden folded in and this island does not know what anybody is
   * carrying, so a laden body learns a shade less here than the browser drew
   * while it waited. That gap is the burden's, and it was there before this.
   */
  if not v_idle then
    perform char_told(p_world, p_uid, 'body_stamina', work_wind() + spent * work_wind_spent());
  end if;
end $fn$;

select private.lock_doors();
