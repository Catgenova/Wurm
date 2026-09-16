-- A thing may come on under the file, not only its quality.
--
-- Rarity was rolled once, at the bench, and never again. Everything after that
-- — a hundred passes with a file over a year of play — could raise a thing's
-- quality to within a tenth of the ceiling and never change what it *was*. So
-- the only fantastic anything on the island is one somebody happened to make,
-- and no amount of work has ever turned an ordinary thing into a good one.
--
-- Now a pass that goes well rolls for a step up, at the same odds as making
-- one outright:
--
--     plain    -> rare        1 in 100
--     rare     -> supreme     1 in 1,000
--     supreme  -> fantastic   1 in 10,000
--     fantastic                nothing above it
--
-- Those are `RARITY_ODDS` **multiplied out**, not each step on its own.
-- `rarity_def.odds` holds the conditional odds — a hundredth, then a tenth,
-- then a tenth — because that is what `rarity_roll` walks at the bench. What
-- somebody means by "the odds of a fantastic" is the three of them together,
-- and `rarity_chance` is that.
--
-- One step at a time and never two. There is no road to the top of it but
-- through the middle: an ordinary thing does not become fantastic because
-- somebody was lucky once, and a supreme thing that becomes fantastic has been
-- worked on by somebody who made it rare and then supreme first.
--
-- A step up also lifts the ceiling the thing may be bettered to — five, twelve
-- and twenty-five past your own skill — so a lucky pass opens room that was
-- not there a moment ago. That is the next pass's business: the ceiling this
-- one used was worked out for the thing as it stood when the pass began.
--
-- ## And two things found on the way
--
-- `rarity_word` wrote the bench's three sentences out by hand beside the
-- generated table that now holds them, so the words are crossed with the
-- numbers and there is one of each. `rarity_lift` is the same for the three
-- new ones: what is said when a thing already in your hands comes on is not
-- what is said when one is set down finished.
--
-- And `perform_item`'s improve was the one `skill_check` in its family that
-- never passed `mind_ease`. `perform_forge` does, `perform_craft`'s caller
-- does, and the browser's own improve passes `g.mindEase()` — so a meditator
-- improving a thing on the island was working against the plain difficulty
-- while their own screen said otherwise. One argument, added here because it
-- is the line this change is already rewriting.

/** The step above this one, or nothing when there is nothing above it. */
create or replace function rarity_next(p_rare text) returns text
  language sql stable as $fn$
  select r.id from rarity_def r
   where r.ord = coalesce((select q.ord from rarity_def q where q.id = p_rare), 0) + 1
$fn$;

/**
 * The chance a thing is this rare *at all*, rather than the chance of the step
 * on its own.
 *
 * `rarity_def.odds` is conditional — each step is rolled only if the one below
 * it came off — because that is how `rarity_roll` walks the bench. Multiplied
 * out it is one in a hundred, one in a thousand, one in ten thousand, which is
 * what anybody means by the odds of a rare, a supreme or a fantastic.
 */
create or replace function rarity_chance(p_rare text) returns double precision
  language plpgsql stable as $fn$
declare v_ord int; v_p double precision := 1; r rarity_def;
begin
  select ord into v_ord from rarity_def where id = p_rare;
  if not found then return 0; end if;
  for r in select * from rarity_def where ord <= v_ord order by ord loop
    v_p := v_p * r.odds;
  end loop;
  return v_p;
end $fn$;

/**
 * A step up under the file, on a pass that went well.
 *
 * Null when nothing happened, which is almost always, and when the thing is
 * already as rare as a thing gets. `liftRarity` is this, term for term.
 */
create or replace function rarity_lift(p_rare text) returns text
  language plpgsql as $fn$
declare v_next text;
begin
  v_next := rarity_next(p_rare);
  if v_next is null then return null; end if;
  if random() >= rarity_chance(v_next) then return null; end if;
  return v_next;
end $fn$;

/** What is said when one comes off the bench, read off the table that holds it. */
create or replace function rarity_word(p_rare text) returns text
  language sql stable as $fn$
  select r.word from rarity_def r where r.id = p_rare
$fn$;

CREATE OR REPLACE FUNCTION public.perform_item(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare v_it item; v_what improvable_def; v_mat improve_material_def; v_stock item;
        v_made text; v_ceiling double precision; v_tool_ql double precision;
        v_healed double precision; v_lost double precision; v_skill double precision;
        v_favour text; v_full text; v_name text; v_p player; v_lift text;
begin
  if p_action = 'drink' then
    update player set stats = jsonb_set(stats, '{thirst}', '1') where world_id = p_world and uid = p_uid;
    perform tell(p_world, p_uid, 'You drink the cool water. It is refreshing.', 'event');
    return;
  end if;

  v_it := carried(p_world, p_uid, nullif(p_target->>'uid', '')::bigint);
  if v_it.id is null then return; end if;
  v_name := lower((select coalesce(name, v_it.def) from item_def where id = v_it.def));
  select * into v_p from player where world_id = p_world and uid = p_uid;

  if p_action = 'eat' then
    if not consume(p_world, p_uid, v_it.def, 1, v_it.id) then return; end if;
    update player set stats = jsonb_set(stats, '{hunger}', to_jsonb(least(1,
        coalesce((v_p.stats->>'hunger')::double precision, 1)
        + coalesce((select food from item_def where id = v_it.def), 0) * (0.7 + v_it.ql / 200))))
      where world_id = p_world and uid = p_uid;
    -- A dish favours a trade, and having eaten it you are better at that
    -- trade for a while.
    v_favour := grant_boon(p_world, p_uid, v_it.def, v_it.ql);
    v_full := nourish(p_world, p_uid, v_it.def, v_it.ql);
    perform tell(p_world, p_uid, 'You eat the ' || v_name || '.'
      || coalesce(' ' || v_favour, '') || coalesce(' ' || v_full, ''), 'event');

  elsif p_action = 'drink_skin' then
    update item set charges = coalesce(charges, 1) - 1 where id = v_it.id;
    update player set stats = jsonb_set(stats, '{thirst}', to_jsonb(least(1,
        coalesce((v_p.stats->>'thirst')::double precision, 1)
        + coalesce((select drink from item_def where id = v_it.def), 0))))
      where world_id = p_world and uid = p_uid;
    -- Milk and anything brewed favour a trade the way a cooked dish does.
    v_favour := grant_boon(p_world, p_uid, v_it.def, v_it.ql);
    v_full := nourish(p_world, p_uid, v_it.def, v_it.ql);
    perform tell(p_world, p_uid, 'You take a drink from the ' || v_name || '.'
      || coalesce(' ' || v_favour, '') || coalesce(' ' || v_full, ''), 'event');

  elsif p_action = 'repair_item' then
    -- A second's work: some of the damage comes out, and a little of the
    -- quality with it — a little, not much, so mending a thing is not the end
    -- of it.
    v_skill := skill_of(p_world, p_uid, 'repair');
    v_healed := least(v_it.dmg, 1.2 + v_skill * 0.1);
    v_lost := v_healed * greatest(0.004, 0.03 - v_skill * 0.00026);
    update item set dmg = greatest(0, dmg - v_healed), ql = greatest(1, ql - v_lost)
      where id = v_it.id returning * into v_it;
    perform skill_raise(p_world, p_uid, 'repair', 0.25);
    if v_it.dmg <= 0 then
      perform tell(p_world, p_uid, 'The ' || v_name || ' is as sound as it will ever be again. (QL '
        || to_char(v_it.ql, 'FM990.0') || ')', 'event');
    end if;

  elsif p_action = 'improve_item' then
    select * into v_what from improvable_def where item = v_it.def;
    if not found then return; end if;
    select * into v_mat from improve_material_def where id = v_what.material;
    v_made := (mat_of(v_it.extra)).name;
    v_stock := stock_for(p_world, p_uid, v_mat.id, v_made);
    if v_stock.id is null or not consume(p_world, p_uid, v_stock.def, 1, v_stock.id) then return; end if;
    v_tool_ql := coalesce((select max(tool_ql(p_world, p_uid, t.tool)) from improve_tool t
                           where t.material = v_mat.id), 0);
    perform skill_raise(p_world, p_uid, v_what.skill, 0.4);
    -- A failed pass marks the piece rather than spoiling it outright. Oak and
    -- the deep metals are stubborn under the file as under the saw.
    if not skill_check(skill_of(p_world, p_uid, v_what.skill),
        12 + v_it.ql / 3 + mat_difficulty(v_it.extra), v_tool_ql,
        mind_ease(p_world, p_uid)) then
      perform damage_item(v_it.id, 3 + random() * 5);
      perform tell(p_world, p_uid, 'You work at the ' || v_name || ' and mark it. (damage '
        || to_char((select dmg from item where id = v_it.id), 'FM990.0') || ')', 'event');
      return;
    end if;
    v_ceiling := least(99.9, improve_ceiling(p_world, p_uid, v_what.skill, v_it.rare));
    update item set ql = greatest(ql, least(v_ceiling,
        ql + improve_step(skill_of(p_world, p_uid, v_what.skill), ql)))
      where id = v_it.id returning * into v_it;
    /*
     * And now and again the thing itself comes on, not only its quality.
     *
     * The same odds as the bench, one step at a time: a hundred good passes
     * turn a plain thing rare about once, a thousand a rare thing supreme, ten
     * thousand a supreme thing fantastic. Never two steps, so the only road to
     * the top of it is through the middle of it.
     *
     * A step up also lifts the ceiling it may be bettered to, which is the
     * next pass's business rather than this one's — `v_ceiling` above was
     * worked out for the thing as it stood when this pass started.
     */
    v_lift := rarity_lift(v_it.rare);
    if v_lift is not null then
      update item set rare = v_lift where id = v_it.id returning * into v_it;
      perform journal_note(p_world, p_uid, v_lift);
      perform tell(p_world, p_uid,
        (select r.lift from rarity_def r where r.id = v_lift), 'skill');
    end if;
    perform tell(p_world, p_uid, 'The ' || v_name || ' is better than it was. (QL '
      || to_char(v_it.ql, 'FM990.0') || ')', 'event');
  end if;
end $function$;
select private.lock_doors();
