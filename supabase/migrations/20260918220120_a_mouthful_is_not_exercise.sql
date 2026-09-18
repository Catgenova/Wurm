-- A mouthful is not exercise
--
-- Asked for: "no stats should be gained by eating, drinking, or moving items".
-- Every go trained the hands a little and every go that cost wind trained the
-- chest, which is right for work and wrong for the three things that are not
-- work: putting something in your mouth, tipping a bucket, and carrying a
-- thing from a crate to your pack. A body that does those over and over should
-- be no steadier for it. Twenty-five jobs are named (`teaches_nothing`), and
-- for those `spend_wind` pays no hands, no back and no chest. The wind itself
-- is still spent — a cost is not a lesson — and nothing else about them moves.
-- The browser keeps the same list in `TEACHES_NOTHING`.

/*
 * The jobs that teach the body nothing at all.
 *
 * Every go trains the hands a little, and spending wind trains the chest —
 * which is right for work, and wrong for the three things that are not work.
 * Asked for: "no stats should be gained by eating, drinking, or moving items".
 * Putting something in your mouth, tipping a bucket, and carrying a thing from
 * a crate to your pack are not exercise, and a body that does them over and
 * over should be no steadier for it. The wind they cost is still spent: a cost
 * is not a lesson. The browser keeps the same list in `TEACHES_NOTHING`, and a
 * test of its own holds the two of them together.
 */
CREATE OR REPLACE FUNCTION public.teaches_nothing(p_action text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select p_action in (
    -- Eating and drinking, and handing food to something else.
    'eat', 'drink', 'drink_from_vessel', 'drink_skin', 'feed',
    -- Carrying things about, in and out of whatever holds them.
    'pick_up', 'pick_up_all', 'drop', 'crate_take_all', 'furniture_take_all',
    'kiln_take_all', 'smelter_take_all', 'store_in_crate', 'store_in_furniture',
    'take_from_store', 'stow_item', 'empty_bag', 'throw_away', 'equip', 'unequip',
    -- And pouring, which is carrying by another name.
    'fill_bucket', 'fill_skin', 'empty_bucket', 'empty_vessel', 'pour_into_barrel')
$function$;

CREATE OR REPLACE FUNCTION public.spend_wind(p_world uuid, p_uid uuid, p_action text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare cost double precision; w double precision; body double precision; spent double precision;
        v_idle boolean;
begin
  -- And nothing at all for the jobs that are not work. The wind below is still
  -- spent: a cost is not a lesson.
  v_idle := teaches_nothing(p_action);
  /*
   * What the go taught the hands, whatever it was and whatever it cost.
   *
   * Before the wind, and outside the guard below, because a go that costs no
   * wind is still a go: the browser pays this on every one and the island paid
   * it on none. It is not the digging skill — a body that has swung a shovel a
   * thousand times has a steadier hand than one that has not, at anything.
   */
  if not v_idle then
    perform char_told(p_world, p_uid, 'body_control', work_hand());
    -- And the back, from the heavy trades: a shovel or a pick, whatever the go found.
    if coalesce((select s.heavy from action_def a join skill_def s on s.id = a.skill where a.id = p_action), false) then
      perform char_told(p_world, p_uid, 'body_strength', work_back());
    end if;
  end if;
  select stamina into cost from action_def where id = p_action;
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
end $function$;

select private.lock_doors();
