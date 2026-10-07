/*
 * The Chirurgeon: two spells and a passive at each of six tiers, opening on
 * the trade's own level, as the other fighting trades' do (`talents.ts`).
 *
 * Picked: spells 1 2 4 6 15 17 19 20 43 46 49 50 and passives 1 4 5 6 22 23
 * of the fifty and thirty offered, and set in the tiers in order of what they
 * are worth. The rows came with the definitions just before this. Here: health
 * put back on a person (`class_heal`), their wounds closed (`class_wounds_close`),
 * a person within a spell's reach of you (`class_person_why`), health back a
 * second for a while (`class_regen`, in `body_settle`), a trade that learns
 * from a heal in a fight (`class_learn_heal`), and the passives in the dressing
 * they change.
 */
set local lock_timeout = '3s';

/* The Chirurgeon's old tree went with the move to perks: its bought nodes go too, and its holders are folded afresh. */
delete from player_node pn
 where pn.node like 'chirurgeon\_%' and not exists (select 1 from class_perk k where k.id = pn.node)
   and not exists (select 1 from class_node n where n.id = pn.node);
do $$ declare r record; begin
  for r in select world_id, uid from player where combat_class = 'chirurgeon' loop perform class_fold(r.world_id, r.uid); end loop;
end $$;

/* Health back on somebody, as a share of a full bar and never past it; what it actually put back. */
create or replace function class_heal(p_world uuid, p_uid uuid, p_share double precision)
  returns double precision language plpgsql as $$
declare hp double precision;
begin
  select coalesce((stats->>'health')::double precision, 1) into hp from player where world_id = p_world and uid = p_uid for update;
  if hp is null then return 0; end if;
  update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{health}', to_jsonb(least(1, hp + p_share)))
    where world_id = p_world and uid = p_uid;
  return least(1, hp + p_share) - hp;
end $$;

/*
 * Somebody's wounds closed by a share of their severity: the worst one
 * (`worst_wound`), or every one; and stopped bleeding as well when asked.
 * One closed all the way is gone, gone bad or not; one closed part of the way
 * is gone once there is nothing left of it, as a dressing leaves one. How
 * many it closed on.
 */
create or replace function class_wounds_close(p_world uuid, p_uid uuid, p_share double precision, p_all boolean, p_stop boolean)
  returns int language plpgsql as $$
declare pl player; v_worst jsonb; w jsonb; v_out jsonb := '[]'::jsonb; v_n int := 0;
begin
  select * into pl from player where world_id = p_world and uid = p_uid for update;
  if pl.uid is null then return 0; end if;
  v_worst := worst_wound(pl.wounds);
  for w in select * from jsonb_array_elements(coalesce(pl.wounds, '[]'::jsonb)) loop
    if p_all or (v_n = 0 and w->>'id' is not distinct from v_worst->>'id') then
      v_n := v_n + 1;
      if p_share >= 1 then continue; end if;
      w := jsonb_set(w, '{severity}', to_jsonb((w->>'severity')::double precision * (1 - p_share)));
      if p_stop then w := jsonb_set(w, '{bleeding}', 'false'); end if;
    end if;
    if (w->>'severity')::double precision > 0.004 or (w->>'infected')::boolean then v_out := v_out || w; end if;
  end loop;
  if v_n > 0 then update player set wounds = v_out where world_id = p_world and uid = p_uid; end if;
  return v_n;
end $$;

/* Why a Chirurgeon's spell cannot be put on this person -- you, or somebody within its reach of you -- or nothing. */
create or replace function class_person_why(p_world uuid, p_uid uuid, p_target jsonb, p_reach double precision)
  returns text language plpgsql stable as $$
declare me player; pl player;
begin
  select * into me from player where world_id = p_world and uid = p_uid;
  if coalesce(p_target->>'uid', '') !~ '^[0-9a-f-]{36}$' then return 'That is not here.'; end if;
  select * into pl from player where world_id = p_world and uid = (p_target->>'uid')::uuid and not away;
  if pl.uid is null then return 'That is not here.'; end if;
  if pl.uid <> p_uid and sqrt((pl.x - me.x) ^ 2 + (pl.y - me.y) ^ 2) > p_reach then
    return coalesce(pl.name, 'They') || ' is more than ' || trim_scale(p_reach::numeric) || ' tiles away.';
  end if;
  return null;
end $$;

/* A Chirurgeon's Regenerate's share of the time since the body was last settled, as a Renewal's is (`faith_renewal`). */
create or replace function class_regen(p_blessings jsonb, p_from timestamptz)
  returns double precision language sql stable as $$
  select coalesce(greatest(0, extract(epoch from least(now(), (p_blessings->'regenerate'->>'until')::timestamptz)
                                     - greatest(p_from, (p_blessings->'regenerate'->>'at')::timestamptz)))
                  * (p_blessings->'regenerate'->>'each')::double precision, 0)
$$;

/*
 * What a heal teaches the trade that cast it: as much as a blow that lands
 * (`class_learn_blow`), while the one it is put on is in a fight -- something
 * hunting them. A heal out of a fight teaches nothing, as a swing at nothing
 * does.
 */
create or replace function class_learn_heal(p_world uuid, p_uid uuid, p_on uuid)
  returns void language plpgsql as $$
begin
  if exists (select 1 from creature cr where cr.world_id = p_world and cr.hunting = p_on and cr.health > 0) then
    perform class_learn(p_world, p_uid, class_learn_blow());
  end if;
end $$;

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
  -- And a Renewal's share of the time since the body was last settled (`faith_renewal`), and a Chirurgeon's Regenerate's (`class_regen`).
  hp := least(1, hp + faith_renewal(p.blessings, p.body_at) + class_regen(p.blessings, p.body_at));

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
        v_wind double precision;
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
      -- And now and then a critical one (`my_crit_chance`), more often for a Skirmisher's Keen Edge and on one Marked for Death
      -- (`class_marked`), and harder for a Skirmisher's Lethal (`crit_mul`).
      -- And every one while a Berserker's Last Rage holds (`class_crit`).
      v_crit := random() < my_crit_chance(p_world, p_uid, w) * class_marked(p_world, c.id) or class_crit(p_world, p_uid);
      dmg := weapon_damage(p_world, p_uid, w, held) * bane * my_stance_dealt(p_world, p_uid, p.fight_stance)
             * hide_takes(d.hide, blow_of(w.id, w.kind)) * blindside_of(c, p_uid) * (0.75 + random() * 0.5)
             * case when v_crit then crit_mul(p_world, p_uid, w) else 1 end * faith_arms(p_world, p_uid, d)
             -- And what a fighting trade makes of it: a Battle Rage, an Executioner, Pain Fuels (`class_dealt`).
             * class_dealt(p_world, p_uid, c);
      died := hurt_creature(p_world, c.id, dmg, p_uid);
      -- And it teaches the fighting trade you hold (`class_learn`), a kill more.
      perform class_learn(p_world, p_uid, class_learn_blow() + case when died then class_learn_kill() else 0 end);
      -- And a Thirst for Blood's share of your health back (`class_leech`).
      perform class_leech(p_world, p_uid);
      perform faith_feast(p_world, p_uid, dmg);
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
    -- And a Pikeman's Keep Away pushes what it landed on further off, once it has turned on you (`class_keep_away`).
    if v_landed and not coalesce(died, false) then perform class_keep_away(p_world, p_uid, c.id); end if;

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
    -- The far end of a bow's range is a far harder shot than the near end (`bow_range`); and no shot at all
    -- for one that spends an Archer's Read the Wind, which cannot miss (`class_wind_take`).
    v_wind := class_wind_take(p_world, p_uid);
    v_landed := v_wind is not null or random() <= hit_chance(p_world, p_uid, 'archery', mark_of(held.mark, 'aim'))
                            * (1 - (dist / bow_range(p_world, p_uid, bow, held)) * 0.35) * beast_mul(c, 'evade');
    perform skill_raise(p_world, p_uid, 'fighting', try_gain(v_landed, shot_fight()));
    perform skill_raise(p_world, p_uid, 'archery', try_gain(v_landed, shot_archery()));
    -- Picking a target out of the dark at range is the hardest looking there is.
    perform fought_in_dark(p_world, p_uid, dark_shot());
    if not v_landed then
      perform tell(p_world, p_uid, 'Your arrow goes wide of the ' || lower(d.name) || '.', 'fight');
    else
      -- The stave throws it; the head is what goes in. Both have a say.
      bane := case when mat_bane(arrow.extra) and d.glow is not null then bane_bonus() else 1 end;
      -- And critical more often for a Read the Wind spent on it, and on one Marked for Death.
      v_crit := random() < my_crit_chance(p_world, p_uid, bow) * coalesce(v_wind, 1) * class_marked(p_world, c.id) or class_crit(p_world, p_uid);
      -- And what the head is: a blunt crushes, a bodkin goes through a hide (`headBlow`, `headHide`).
      dmg := weapon_damage(p_world, p_uid, bow, held) * mat_edge(arrow.extra) * bane * my_stance_dealt(p_world, p_uid, p.fight_stance)
             * hide_takes(d.hide, case when v_head = 'blunt' then 'crush' else blow_of(bow.id, bow.kind) end)
             * case when v_head = 'bodkin' and d.hide is not null then bodkin_hide() else 1 end
             * blindside_of(c, p_uid)
             * (0.6 + arrow.ql / 140) * (0.8 + random() * 0.4)
             * case when v_crit then crit_mul(p_world, p_uid, bow) else 1 end * faith_arms(p_world, p_uid, d)
             -- And what a fighting trade makes of it: a Battle Rage, an Executioner, Pain Fuels (`class_dealt`),
             * class_dealt(p_world, p_uid, c)
             -- and an Archer's Ambush on one not after you (`class_ambush`).
             * class_ambush(p_world, p_uid, c);
      died := hurt_creature(p_world, c.id, dmg, p_uid);
      -- And it teaches the fighting trade you hold (`class_learn`), a kill more.
      perform class_learn(p_world, p_uid, class_learn_blow() + case when died then class_learn_kill() else 0 end);
      -- And a Thirst for Blood's share of your health back (`class_leech`).
      perform class_leech(p_world, p_uid);
      perform faith_feast(p_world, p_uid, dmg);
      perform damage_item(held.id, 0.25 * pk(p_world, p_uid, 'worn:weapon', 1));
      -- And now and then the arrow back in your pack, for an Archer's Arrow Saver (`class_arrow_saved`).
      perform class_arrow_saved(p_world, p_uid, arrow);
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
              * (case when suits then 1.5 when got <> '' then 1.1 else 1 end)
              -- And more on a body far gone, for a Chirurgeon's Triage Instinct, and over again in a Surgeon's Hands.
              * (case when coalesce((pt.stats->>'health')::double precision, 1) < pk(p_world, p_uid, 'triage:below', 0)
                      then pk(p_world, p_uid, 'triage:heal', 1) else 1 end)
              * (case when (p.blessings->'surgeons_hands'->>'until')::timestamptz > now()
                      then (p.blessings->'surgeons_hands'->>'more')::double precision else 1 end);
    out_w := '[]'::jsonb;
    for one in select * from jsonb_array_elements(pt.wounds) loop
      if one = hurt then
        one := jsonb_set(one, '{severity}', to_jsonb(greatest(0, (one->>'severity')::double precision - healed)));
        if clean then
          one := jsonb_set(jsonb_set(one, '{dressing}', to_jsonb(got)), '{bleeding}', 'false');
          one := case when v_mend <> 1 then jsonb_set(one, '{mend}', to_jsonb(v_mend)) else one - 'mend' end;
          -- And goes bad less often under the hands that dressed it: a Chirurgeon's Clean Cloth (`fester_chance`).
          one := case when pk(p_world, p_uid, 'fester:bind_wound', 1) <> 1
                      then jsonb_set(one, '{fester}', to_jsonb(pk(p_world, p_uid, 'fester:bind_wound', 1))) else one - 'fester' end;
        end if;
      end if;
      if (one->>'severity')::double precision > 0.004 or (one->>'infected')::boolean then
        out_w := out_w || one;
      end if;
    end loop;
    -- And wind back on whoever it is on, for a Chirurgeon's Bedside Manner.
    update player set wounds = out_w,
        stats = jsonb_set(jsonb_set(pt.stats, '{health}',
          to_jsonb(least(1, coalesce((pt.stats->>'health')::double precision, 1) + healed))),
          '{stamina}', to_jsonb(least(1, coalesce((pt.stats->>'stamina')::double precision, 1) + pk(p_world, p_uid, 'stamina:bind_wound', 0))))
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

CREATE OR REPLACE FUNCTION public.fester_chance(w jsonb)
 RETURNS double precision
 LANGUAGE sql
 STABLE
AS $function$
  -- And never under a salve (a Naturalist's).
  select case when (w->>'infected')::boolean or w->>'dressing' = k.herb
                or coalesce((w->>'salved')::boolean, false) then 0 else
    k.fester
    * case when w->>'dressing' is null then 1 when w->>'dressing' = '' then 0.12 else 0.05 end
    -- And less often under the hands of a Chirurgeon who learned Clean Cloth.
    * coalesce((w->>'fester')::double precision, 1)
    * (0.3 + (w->>'severity')::double precision * 2) / 60 end
  from wound_kind_def k where k.id = w->>'kind'
$function$;

CREATE OR REPLACE FUNCTION public.fight_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare it item; c creature; d species_def; w weapon_def; bow weapon_def; dist double precision;
        p player; slot text; corpse item; hurt jsonb; use item; pt player;
begin
  select * into p from player where world_id = p_world and uid = p_uid;

  if p_action in ('equip', 'unequip') then
    select * into it from item where id = target_item(p_target)
      and world_id = p_world and holder = 'player' and holder_uid = p_uid;
    if not found then return 'It is gone.'; end if;
    slot := slot_of(it.def);
    if slot is null then return 'That is not worn or wielded.'; end if;
    if p_action = 'unequip' then
      return case when (p.equipped->>slot)::bigint is distinct from it.id
                  then 'You are not wearing that.' end;
    end if;
    if (p.equipped->>slot)::bigint = it.id then return 'You already have it on.'; end if;
    if slot = 'offhand' and two_handed_in_hand(p_world, p_uid) then
      return 'Both your hands are on your weapon.';
    end if;
    return null;

  elsif p_action in ('attack_creature', 'shoot_creature', 'treat_creature') then
    perform creature_settle(p_world, (p_target->>'id')::int);
    c := target_creature(p_world, p_target);
    if c.world_id is null then return 'It is dead or gone.'; end if;
    select * into d from species_def where id = c.species;
    dist := (select sqrt((creature_x(c) - pl.x) ^ 2 + (creature_y(c) - pl.y) ^ 2)
             from player pl where pl.world_id = p_world and pl.uid = p_uid);
    if p_action = 'attack_creature' then
      if c.mode <> 'wild' then return 'That one is tame. Release it first if you mean it.'; end if;
      if dist > melee_reach(p_world, p_uid) then return 'It is out of reach.'; end if;
      return null;
    elsif p_action = 'shoot_creature' then
      if c.mode <> 'wild' then return 'That one is tame. Release it first if you mean it.'; end if;
      select bw.* into bow from weapon_def bw where bw.id = (worn(p_world, p_uid, 'weapon')).def and bw.ammo is not null;
      if not found then return 'You have no bow in your hands.'; end if;
      if coalesce((select sum(pack_count(p_world, p_uid, idf.id)) from item_def idf
                   where arrow_head_of(idf.id) is not null), 0) <= 0 then return 'You are out of arrows.'; end if;
      -- Further for the bow's maker's mark, a Carpenter's True Bow, and for an Archer's Long Draw (`bow_range`).
      if dist > bow_range(p_world, p_uid, bow, worn(p_world, p_uid, 'weapon')) then
        return 'Too far for a ' || lower((select name from item_def where id = bow.id)) || '.';
      end if;
      -- And nearer for an Archer's Close Quarters (`draw_nearest`).
      if dist < draw_nearest(p_world, p_uid) then return 'It is too close to draw on.'; end if;
      return null;
    else
      if c.mode = 'wild' then return 'It will not stand still for you while it is wild.'; end if;
      if c.health >= max_health(c) then return c.name || ' is not hurt.'; end if;
      if pack_count(p_world, p_uid, 'bandage') <= 0 then return 'You have no bandages. Cut some from cloth.'; end if;
      if dist > 1.9 then return 'You need to be beside it.'; end if;
      return null;
    end if;

  elsif p_action = 'butcher' then
    corpse := target_corpse(p_world, p_uid, p_target);
    if corpse.id is null then return 'There is nothing to butcher.'; end if;
    if (corpse_species(corpse.extra)).id is null then return 'You cannot make sense of this carcass.'; end if;
    return null;

  elsif p_action = 'bind_wound' then
    /*
     * Somebody else's, for a Naturalist's Field Medic: standing beside you,
     * at your first aid and with your dressings. What is wrong with them is
     * this side's to say; the browser knows only the perk and your pack.
     */
    if p_target->>'kind' = 'person' and p_target->>'uid' is distinct from p_uid::text then
      if pk(p_world, p_uid, 'dress_others', 0) <= 0 then
        return 'Dressing somebody else''s wounds wants a Naturalist who has learned Field Medic, or a Chirurgeon who has learned '
          || 'Field Surgeon.';
      end if;
      if coalesce(p_target->>'uid', '') !~ '^[0-9a-f-]{36}$' then return 'They are not on this island.'; end if;
      select * into pt from player where world_id = p_world and uid = (p_target->>'uid')::uuid;
      if not found then return 'They are not on this island.'; end if;
      if sqrt((pt.x - p.x) ^ 2 + (pt.y - p.y) ^ 2) > 1.9 then return 'You need to be beside them.'; end if;
      perform wounds_settle(p_world, pt.uid);
      select * into pt from player where world_id = p_world and uid = pt.uid;
      hurt := worst_wound(pt.wounds);
      if hurt is null then return coalesce(pt.name, 'They') || ' has nothing open to dress.'; end if;
      if (hurt->>'infected')::boolean then
        return 'The ' || (select name from wound_kind_def where id = hurt->>'kind') || ' on '
          || coalesce(pt.name, 'their') || '''s ' || part_name(hurt->>'part')
          || ' has gone bad. It wants cleaning out before anything will hold on it.';
      end if;
      if (dressing_for(p_world, p_uid, hurt)).id is null then return 'You have nothing to dress it with.'; end if;
      return null;
    end if;
    perform wounds_settle(p_world, p_uid);
    select * into p from player where world_id = p_world and uid = p_uid;
    hurt := worst_wound(p.wounds);
    if hurt is null then
      return case when coalesce((p.stats->>'health')::double precision, 1) >= 0.999
        then 'There is nothing wrong with you.' else 'Nothing is open. You are only tired and thin.' end;
    end if;
    if (hurt->>'infected')::boolean then
      return 'The ' || (select name from wound_kind_def where id = hurt->>'kind')
        || ' on your ' || part_name(hurt->>'part')
        || ' has gone bad. Clean it out before anything will hold on it.';
    end if;
    use := dressing_for(p_world, p_uid, hurt);
    if use.id is null then return 'You have nothing to dress it with.'; end if;
    return null;

  elsif p_action = 'clean_wound' then
    perform wounds_settle(p_world, p_uid);
    select * into p from player where world_id = p_world and uid = p_uid;
    if not exists (select 1 from jsonb_array_elements(coalesce(p.wounds, '[]'::jsonb)) x
                   where (x->>'infected')::boolean) then
      return 'Nothing on you has gone bad.';
    end if;
    if pack_count(p_world, p_uid, 'lye_bucket') <= 0 then
      return 'You need a bucket of lye to clean it out with.';
    end if;
    return null;
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.spell_cast_refusal(p_world uuid, p_uid uuid, p_spell text)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare s spell_any; p player; v_left double precision; v_favour double precision; v_stamina double precision; v_needs text;
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
    if v_stamina < s.cost then
      return s.name || ' costs ' || round(s.cost * 100)::int || '% of your stamina; you have ' || floor(v_stamina * 100)::int || '%.';
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
  v_favour := favour_settle(p_world, p_uid);
  if v_favour < s.cost then
    return s.name || ' costs ' || s.cost::int || ' favour; you hold ' || floor(v_favour)::int || '. Pray at an altar.';
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.class_spell_cast(p_world uuid, p_uid uuid, p_spell text, p_target jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare s class_spell; me player; c creature; d species_def; b jsonb; v_said text; v_id int; r record;
        v_dist double precision; v_reach double precision; v_x double precision; v_y double precision;
        v_n int := 0; v_put jsonb; v_windup boolean; v_more double precision; v_h double precision;
        v_dead int := 0; v_held int := 0; v_i int; v_part text; v_on jsonb; v_pace jsonb;
        v_why text; v_uid uuid; v_who text; v_whose text; v_hp double precision;
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

  else
    return jsonb_build_object('why', 'Nothing is written behind that spell yet.');
  end case;

  -- The blow it struck goes back with the sentence, for whoever cast it to read the numbers of (`class_blow`).
  return jsonb_build_object('said', v_said)
    || case when b is not null then jsonb_build_object('blow', b) else '{}'::jsonb end
    || case when v_put is not null then jsonb_build_object('put', v_put) else '{}'::jsonb end
    || case when v_pace is not null then jsonb_build_object('pace', v_pace) else '{}'::jsonb end;
end $function$;

select private.lock_doors();
