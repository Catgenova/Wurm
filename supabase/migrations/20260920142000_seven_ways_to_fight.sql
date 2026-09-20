-- Seven ways to fight, and a rite for each
--
-- The fourteen craft trades got their trees this morning. These are the seven
-- fighting trades that are not magic -- three melee, two ranged, a healer and
-- one that fights with what fights beside it -- and the thing all ten of them
-- share: a rite.
--
--     Sworn Blade   swords, shields, chain armour     guard, edge, aim
--     Berserker     axes, mauls                       edge, hands, wind
--     Pikeman       polearms, plate armour            aim, guard, wind
--     Archer        archery, awareness, leather       edge, aim, wind
--     Skirmisher    throwing, knives, climbing        edge, aim, hands
--     Chirurgeon    chirurgy, cloth armour            knit, hands, guard
--     Beastmaster   soul strength                     hide, fang, quiet
--
-- ## Five channels, and not one of them a new rule
--
-- The craft trees set the test and this kept it: a channel may exist only
-- where there is already exactly one line in the rules that decides its
-- number. There was, for all five.
--
--     edge    how hard a blow lands       weapon_damage
--     aim     whether it lands at all     hit_chance
--     guard   how much is turned          hurt_player, twice
--     knit    how fast what is open closes wounds_settle
--     fang    what travels with you bites attack_of
--     hide    and what it can take        max_health
--     tame    and how readily it trusts   tame_chance
--
-- `aim` is the one that needed thought. `hit_chance` is a probability with a
-- hard ceiling at 0.96, so the multiplier goes *inside* the ceiling and the
-- channel is scaled gentlest of the seven -- most of a tenth on a chance that
-- already sits at nine tenths is spent against the cap and would be a lie on
-- the card.
--
-- `guard` lands in two places in one function, which is still one meaning:
-- the shield that turns a blow outright, and the armour that soaks whatever
-- the shield missed. A trade only reaches the one its own line of armour
-- covers, so a pikeman's harness does nothing for an archer's leather.
--
-- ## And two channels that wanted nothing but a truer name
--
-- `hands` and `wind` already worked. A swing is an action like any other: it
-- has a duration and it costs wind, and both were already folded. What they
-- had wrong was the scope key. `attack_creature.skill` is `fighting`, which
-- belongs to no trade and must not -- it is the key every melee swing carries,
-- so a trade that owned it would move everybody's numbers.
--
-- `act_scope` is the whole of the fix: when a go is done with `fighting`, the
-- skill it is really done with is the kind of the thing in your hand. Three
-- call sites, one function, and a berserker's rhythm is axes and mauls rather
-- than every swing on the island.
--
-- ## A rite is a node with an hour on it
--
-- Every trade is footed twice: in the skills it covers, and in a rite. A rite
-- is the one thing a class may ask for out loud, and it is paid out of the
-- same favour, at the same altar, on the same prayer the six open casts use.
-- None of the faith economy is duplicated; what differs is which card may call
-- which line.
--
-- And it is not a second kind of rule. It is a node with an expiry: the same
-- channels, the same scope, folded into the same jsonb on the same body, so
-- `class_mul` multiplies it in beside the permanent nodes and stops the moment
-- it lapses. No second machinery to keep, no second place a number can
-- disagree with itself, and **no read on the hot path that was not already
-- happening** -- the rite rides in the fold that was already being read.
--
-- That is also what lets a rite push a channel the wrong way. Red Hour buys
-- half again on what you land by giving away three tenths of what you turn,
-- and it does it with two numbers in the same map as everything else.
--
-- ## Two skills that had to be made
--
-- `throwing`, because three knives at three, four and five damage are a
-- butcher's kit and not a ranged trade. A javelin and a throwing axe come with
-- it, and they reach today with nothing new written -- `weapon_def.range`
-- already existed for the spear and `melee_reach` already reads it on both
-- sides. The thing actually leaving your hand and landing on the ground is a
-- separate piece and is not in here.
--
-- `chirurgy`, because making a dressing and putting one on are two different
-- pieces of knowledge and they were one skill. The forager keeps `first_aid`
-- and everything made with it; the hands that close a wound under fire are
-- their own trade. `bind_wound`, `clean_wound` and `treat_creature` teach it,
-- and `wounds_settle` reads it.
--
-- Nothing crossed the craft boundary to do either, so the fourteen trades are
-- exactly what they were this morning.

set local lock_timeout = '3s';

/**
 * What a go is really done with.
 *
 * `action_def.skill` is `fighting` for every melee swing, which is the right
 * answer for what it teaches and the wrong one for whose trade it is. A swing
 * is done with the thing in your hand.
 *
 * The case is lazy, so nothing that is not a fight pays for the lookup.
 */
create or replace function act_scope(p_world uuid, p_uid uuid, p_skill text) returns text
  language sql stable as $fn$
  select case when p_skill = 'fighting' then (swung_with(p_world, p_uid)).kind else p_skill end
$fn$;

/**
 * One channel out of a fold, plus whatever rite is in flight.
 *
 * Stable rather than immutable now, because a rite has an hour on it and the
 * hour has to be asked. Everything else is as it was: no read, one containment
 * check for the scope, and a multiply.
 *
 * A body with no rite gets exactly the number it got before -- both arms
 * coalesce to one -- which is why the craft trees' arithmetic is untouched to
 * the last bit.
 */
create or replace function class_mul(p_mul jsonb, p_channel text, p_skill text) returns double precision
  language sql stable as $fn$
  select case when p_skill is null or not (p_mul->'skills' @> to_jsonb(p_skill)) then 1
         else coalesce((p_mul->>p_channel)::double precision, 1)
            * case when (p_mul->'rite'->>'until')::timestamptz > now()
                   then coalesce((p_mul->'rite'->'muls'->>p_channel)::double precision, 1)
                   else 1 end
         end
$fn$;

/**
 * Fold a tree down to the answer and write it on the body.
 *
 * As before, and one line more: a rite in flight is carried over rather than
 * re-derived, so taking a node in the middle of one does not put it out.
 */
create or replace function class_fold(p_world uuid, p_uid uuid) returns jsonb
  language plpgsql as $fn$
declare p player; v jsonb := '{}'::jsonb; n record; m double precision;
begin
  select * into p from player where world_id = p_world and uid = p_uid;
  if not found then return '{}'::jsonb; end if;
  for n in
    select cn.channel, cn.mul from player_node pn join class_node cn on cn.id = pn.node
     where pn.world_id = p_world and pn.uid = p_uid
       and cn.class in (p.craft_class, p.combat_class)
     order by cn.id
  loop
    m := coalesce((v->>n.channel)::double precision, 1) * n.mul;
    v := jsonb_set(v, array[n.channel], to_jsonb(m));
  end loop;
  v := jsonb_set(v, '{skills}', coalesce((select jsonb_agg(cs.skill order by cs.skill)
    from class_skill cs where cs.class in (p.craft_class, p.combat_class)), '[]'::jsonb), true);
  if (p.class_mul->'rite'->>'until')::timestamptz > now() then
    v := jsonb_set(v, '{rite}', p.class_mul->'rite', true);
  end if;
  update player set class_mul = v where world_id = p_world and uid = p_uid;
  return v;
end $fn$;

/**
 * Why a rite cannot be called, or nothing.
 *
 * Four refusals in the order a person meets them, and the same four sentences
 * `riteRefusal` builds on the browser's side.
 */
create or replace function rite_refusal(p_world uuid, p_uid uuid, p_rite text) returns text
  language plpgsql as $fn$
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
    return r.name || ' takes ' || r.level::int || ' prayer; you have '
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
end $fn$;

/**
 * Call it.
 *
 * The favour goes the way a cast's does, the rest goes on `used_at` the way a
 * path ability's does, and the rite itself goes into the fold -- where it is
 * read for nothing by everything that was already reading the fold.
 */
create or replace function rpc_rite(p_world uuid, p_rite text) returns jsonb
 language plpgsql security definer set search_path to 'public' as $fn$
declare me uuid := auth.uid(); r rite_def; v_why text; v_mul jsonb;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  select * into r from rite_def where id = p_rite;
  if not found then return jsonb_build_object('why', 'There is no such rite.'); end if;
  v_why := rite_refusal(p_world, me, p_rite);
  if v_why is not null then return jsonb_build_object('why', v_why); end if;

  perform favour_settle(p_world, me);
  update player set favour = greatest(0, favour - r.cost),
      used_at = jsonb_set(coalesce(used_at, '{}'::jsonb), array['rite:' || r.id], to_jsonb(now()), true),
      class_mul = jsonb_set(coalesce(class_mul, '{}'::jsonb), '{rite}',
        jsonb_build_object('id', r.id, 'muls', r.muls,
                           'until', now() + make_interval(secs => r.secs)), true)
    where world_id = p_world and uid = me;
  perform skill_raise(p_world, me, faith_skill(), 0.6);
  perform tell(p_world, me, r.said, 'system');
  select class_mul into v_mul from player where world_id = p_world and uid = me;
  return jsonb_build_object('called', r.id, 'until', now() + make_interval(secs => r.secs),
                            'mul', v_mul, 'favour', floor(favour_settle(p_world, me)));
end $fn$;

-- The eleven functions a fighting trade tells on, re-emitted with the
-- channels folded in. Generated by fightgen.py against the live
-- definitions, every anchor asserted to occur exactly once.

CREATE OR REPLACE FUNCTION public.hit_chance(p_world uuid, p_uid uuid, p_kind text)
 RETURNS double precision
 LANGUAGE sql
 STABLE
AS $function$
  /*
   * And the trade, on the weapon in hand and no other.
   *
   * A multiplier rather than points added, so it folds like every other
   * channel -- but it goes *inside* the ceiling, because this is a
   * probability and 0.96 is where it stops however good you are. That is why
   * `aim` is the gentlest of the fighting channels: most of a tenth on a
   * chance that already sits at nine tenths is spent against the cap.
   */
  select least(0.96, (0.45 + skill_of(p_world, p_uid, p_kind) / 220
    + skill_of(p_world, p_uid, 'fighting') / 300
    + skill_of(p_world, p_uid, 'body_control') / 500)
    * class_mul(p_world, p_uid, 'aim', p_kind))
$function$;

CREATE OR REPLACE FUNCTION public.weapon_damage(p_world uuid, p_uid uuid, w weapon_def, it item)
 RETURNS double precision
 LANGUAGE sql
 STABLE
AS $function$
  select w.damage
    * case when it.id is null then 1 else mat_edge(it.extra) * rarity_boost(it.rare) end
    * (0.55 + coalesce(it.ql, 20) / 180)
    * case when it.id is null then 1 else greatest(0.4, 1 - it.dmg / 150) end
    * (0.7 + skill_of(p_world, p_uid, 'body_strength') / 90)
    * (1 + (skill_of(p_world, p_uid, w.kind) + skill_of(p_world, p_uid, 'fighting')) / 260)
    -- Hard hands, and the half minute of fury that follows them.
    * case when walks(p_world, p_uid, 'power', 3) then 1.16 else 1 end
    * fury_mult(p_world, p_uid)
    -- And the trade, scoped on the weapon's own kind, so a swordsman's edge is
    -- nothing at all to somebody holding an axe.
    * class_mul(p_world, p_uid, 'edge', w.kind)
$function$;

CREATE OR REPLACE FUNCTION public.hurt_player(p_world uuid, p_uid uuid, p_raw double precision, p_what text, p_kind text DEFAULT 'bite'::text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare p player; shield item; sh shield_def; chance double precision; roll double precision;
        part text; piece item; cls armour_class_def; soak double precision; taken double precision;
        health double precision; ws jsonb; had jsonb; found_w boolean := false; out_w jsonb := '[]'::jsonb;
        w jsonb; k wound_kind_def; note text;
begin
  select * into p from player where world_id = p_world and uid = p_uid for update;
  if not found then return; end if;

  -- Being hit in the dark teaches more about watching than hitting does, and
  -- before the shield, because a blow you turned is still a blow you did not
  -- see coming.
  perform fought_in_dark(p_world, p_uid, dark_hit());
  -- The shield, first of all.
  shield := worn(p_world, p_uid, 'offhand');
  if shield.id is not null then
    select * into sh from shield_def where id = shield.def;
    if found then
      chance := least(0.6, (sh.block * (0.6 + shield.ql / 160)
        + skill_of(p_world, p_uid, 'shields') / 400)
        * class_mul(p_world, p_uid, 'guard', 'shields'));
      perform skill_raise(p_world, p_uid, 'shields', 0.12);
      if random() < chance then
        update item set dmg = least(100, dmg + p_raw * 3) where id = shield.id;
        perform skill_raise(p_world, p_uid, 'shields', 0.5);
        perform tell(p_world, p_uid, 'You take ' || p_what || ' on your '
          || lower((select name from item_def where id = shield.def)) || '.', 'fight');
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
          * class_mul(p_world, p_uid, 'guard', cls.skill);
    -- Armour is learned by being hit in it, and worn out the same way.
    perform skill_raise(p_world, p_uid, cls.skill, 0.4);
    update item set dmg = least(100, dmg + p_raw * 4) where id = piece.id;
    if piece.dmg + p_raw * 4 >= 100 then
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
      w := jsonb_set(w, '{severity}', to_jsonb((w->>'severity')::double precision + taken));
      if k.bleed > 0.001 then w := jsonb_set(w, '{bleeding}', 'true'); end if;
      found_w := true;
    end if;
    out_w := out_w || w;
  end loop;
  if not found_w then
    -- A bruise does not bleed; everything else does until it is seen to.
    w := jsonb_build_object('kind', p_kind, 'part', part, 'severity', taken,
      'bleeding', p_kind <> 'crush', 'infected', false, 'dressing', null, 'at', now());
    out_w := out_w || w;
  end if;

  health := greatest(0, coalesce((p.stats->>'health')::double precision, 1) - taken);
  update player set wounds = out_w,
      stats = jsonb_set(jsonb_set(p.stats, '{health}', to_jsonb(health)),
                        '{hurtSettled}', to_jsonb(now()))
    where world_id = p_world and uid = p_uid;
  perform tell(p_world, p_uid, p_what || note || '. You have ' || wound_text(w) || '.', 'fight');
  if health <= 0 then perform player_die(p_world, p_uid);
  else perform fight_back(p_world, p_uid, (p.stats->>'hurtBy')::int); end if;
end $function$;

CREATE OR REPLACE FUNCTION public.wounds_settle(p_world uuid, p_uid uuid)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
declare p player; elapsed double precision; aid double precision; w jsonb;
        out_w jsonb := '[]'::jsonb; health double precision; drained double precision := 0;
        sev double precision; turned boolean := false; kept int := 0;
begin
  select * into p from player where world_id = p_world and uid = p_uid for update;
  if not found or jsonb_array_length(coalesce(p.wounds, '[]'::jsonb)) = 0 then return false; end if;
  elapsed := extract(epoch from (now() - coalesce((p.stats->>'hurtSettled')::timestamptz, p.seen_at)));
  if elapsed <= 0 then return false; end if;
  /*
   * Chirurgy, not first aid.
   *
   * Making a dressing and putting one on are two different pieces of knowledge
   * and they were one skill. The forager keeps `first_aid` -- the bandages,
   * the covers, what goes in them -- and the hands that close a wound are
   * their own trade now.
   */
  aid := skill_of(p_world, p_uid, 'chirurgy');
  health := coalesce((p.stats->>'health')::double precision, 1);

  for w in select * from jsonb_array_elements(p.wounds) loop
    drained := drained + wound_drain(w) * elapsed;
    if not (w->>'infected')::boolean
       and random() < 1 - power(1 - least(0.9, fester_chance(w)), elapsed) then
      w := jsonb_set(jsonb_set(w, '{infected}', 'true'), '{dressing}', 'null'::jsonb);
      turned := true;
    end if;
    sev := (w->>'severity')::double precision
         - wound_close(w, aid) * class_mul(p_world, p_uid, 'knit', 'chirurgy') * elapsed;
    if sev > 0.004 or (w->>'infected')::boolean then
      w := jsonb_set(w, '{severity}', to_jsonb(greatest(0.004, sev)));
      out_w := out_w || w;
      kept := kept + 1;
    end if;
  end loop;

  health := greatest(0, health - drained);
  update player set wounds = out_w,
      stats = jsonb_set(jsonb_set(p.stats, '{health}', to_jsonb(health)),
                        '{hurtSettled}', to_jsonb(now()))
    where world_id = p_world and uid = p_uid;
  if turned then
    perform tell(p_world, p_uid, 'Something you have been carrying has gone bad. Lye, and then a dressing.', 'error');
  end if;
  if kept = 0 and jsonb_array_length(p.wounds) > 0 then
    perform tell(p_world, p_uid, 'The last of what you were carrying has closed over.', 'event');
  end if;
  if health <= 0 then perform player_die(p_world, p_uid); end if;
  return true;
end $function$;

CREATE OR REPLACE FUNCTION public.attack_of(c creature)
 RETURNS double precision
 LANGUAGE sql
 STABLE
AS $function$
  -- And its keeper's trade, if it has one. A creature with no keeper has a
  -- null there, the read finds nothing, and the fold comes back as one.
  select (select attack from species_def where id = c.species) * beast_mul(c, 'tough')
       * class_mul(c.world_id, c.keeper, 'fang', 'soul_strength')
$function$;

CREATE OR REPLACE FUNCTION public.max_health(c creature)
 RETURNS double precision
 LANGUAGE sql
 STABLE
AS $function$
  select round(species_health(c.species) * beast_mul(c, 'hardy')
             * class_mul(c.world_id, c.keeper, 'hide', 'soul_strength'))
$function$;

CREATE OR REPLACE FUNCTION public.tame_chance(p_world uuid, p_uid uuid, c creature)
 RETURNS double precision
 LANGUAGE sql
 STABLE
AS $function$
  select case when d.monster then 0 else
    greatest(0, least(0.95, (d.tame_chance
      + (skill_of(p_world, p_uid, 'taming') - d.tame_level) / 200
      + case when c.hunger < 0.5 then 0.1 else 0 end
      + coax_bonus(c)
      + greatest(0, (skill_of(p_world, p_uid, 'soul_strength') - 20) * 0.002))
      * (age_row(c.born)).tame
      -- Gentle hand: a wild thing is a quarter readier to trust you.
      * case when walks(p_world, p_uid, 'love', 3) then 1.25 else 1 end
      * class_mul(p_world, p_uid, 'tame', 'soul_strength'))) end
  from species_def d where d.id = c.species
$function$;

CREATE OR REPLACE FUNCTION public.settle(p_world uuid, p_uid uuid)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare p player; d action_def; done int := 0; guard int := 0; nxt jsonb; ended timestamptz;
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
    perform act_perform(p_world, p_uid, p.act, p.act_target);
    -- And what the go took out of you, which nothing over here had ever
    -- charged: `action_def.stamina` was a column no function read.
    perform spend_wind(p_world, p_uid, p.act);
    done := done + 1;
    select * into d from action_def where id = p.act;
    ended := p.act_ends;
    if p.act_left > 1 and act_refusal(p_world, p_uid, p.act, p.act_target) is null then
      update player set act_left = act_left - 1, act_started = ended,
             act_ends = ended + make_interval(secs => act_duration(
               d.base_time,
               case when d.skill is null then 50 else skill_of(p_world, p_uid, d.skill) end,
               case when d.tool is null then 0 else tool_ql(p_world, p_uid, d.tool) end,
               -- The body's own pace, and then the trade's, which tells only
               -- on the skill this job is done with.
               control_speed(p_world, p_uid)
                 * class_mul(coalesce(p.class_mul, '{}'::jsonb), 'hands',
                             act_scope(p_world, p_uid, d.skill))))
        where world_id = p_world and uid = p_uid returning * into p;
    else
      if p.act_left > 1 then
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
                   d.base_time,
                   case when d.skill is null then 50 else skill_of(p_world, p_uid, d.skill) end,
                   case when d.tool is null then 0 else tool_ql(p_world, p_uid, d.tool) end,
                   control_speed(p_world, p_uid)
                     * class_mul(coalesce(p.class_mul, '{}'::jsonb), 'hands',
                                 act_scope(p_world, p_uid, d.skill)))),
                 act_queue = act_queue - 0
            where world_id = p_world and uid = p_uid returning * into p;
          perform tell(p_world, p_uid, 'You start ' || d.verb || '.', 'info');
          exit;
        end if;
      end loop;
    end if;
  end loop;
  return done;
end $function$;

CREATE OR REPLACE FUNCTION public.rpc_act(p_world uuid, p_action text, p_target jsonb, p_times integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); d action_def; p player; why text; secs double precision;
        s double precision; tq double precision; cap int; room int;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  perform settle(p_world, me);
  why := act_refusal(p_world, me, p_action, p_target);
  if why is not null then
    perform tell(p_world, me, why, 'error');
    return jsonb_build_object('started', false, 'why', why);
  end if;
  select * into d from action_def where id = p_action;
  select * into p from player where world_id = p_world and uid = me for update;

  -- Something already in hand: line this one up behind it rather than drop it.
  if p.act is not null then
    cap := queue_capacity(p_world, me);
    room := cap - 1 - jsonb_array_length(p.act_queue);
    if room <= 0 then
      why := 'You can only keep ' || cap || ' jobs in your head at once. Mind logic is what widens that.';
      perform tell(p_world, me, why, 'error');
      return jsonb_build_object('started', false, 'queued', false, 'why', why);
    end if;
    /*
     * And what the thing *was*, for a job that may outlive the row it names.
     *
     * Stamped now rather than worked out later, because later is exactly when
     * it cannot be: once `consume` has deleted the last of a stack there is
     * nothing left to ask what kind of thing it had been.
     */
    update player set act_queue = act_queue || (jsonb_build_object(
        'action', p_action, 'target', p_target, 'goes', greatest(1, least(100, coalesce(p_times, 1))))
        || coalesce((select jsonb_build_object('was', i.def) from item i
                      where i.id = target_item(p_target) and i.world_id = p_world), '{}'::jsonb))
      where world_id = p_world and uid = me returning * into p;
    perform tell(p_world, me, d.label || ' is next, ' || jsonb_array_length(p.act_queue) + 1 || ' of ' || cap || ' in hand.', 'info');
    /*
     * And what is in the head now, not just how much of it.
     *
     * The bar drew its queue from `rpc_settle` and nothing else, and
     * `rpc_settle` runs on the heartbeat and when a job comes due — never when
     * one is *added*. So asking for a third job while two were running left the
     * bar saying "2 of 3" until the job in hand finished, at which point one
     * came off the queue and it said "2 of 3" again. Reported as never changing
     * from 2/3 to 3/3, which is exactly what it did: it was always one behind,
     * and topping the queue up kept it there.
     *
     * The answer to the ask is where the browser should hear about what the ask
     * did, so it says so here rather than waiting to be asked again.
     */
    return held_now(p_world, me) || jsonb_build_object('started', false, 'queued', true,
      'inHand', jsonb_array_length(p.act_queue) + 1, 'capacity', cap,
      'queue', coalesce((select jsonb_agg(jsonb_build_object(
                           'action', q->>'action',
                           'goes', greatest(1, coalesce((q->>'goes')::int, 1))) order by o)
                         from jsonb_array_elements(p.act_queue) with ordinality t(q, o)), '[]'::jsonb));
  end if;

  s := case when d.skill is null then 50 else skill_of(p_world, me, d.skill) end;
  tq := case when d.tool is null then 0 else tool_ql(p_world, me, d.tool) end;
  -- Every other job has a floor of a second or so under it; an instant one has
  -- no duration to put a floor under, and act_duration would give it one.
  secs := case when d.instant then 0
               else act_duration(d.base_time, s, tq, control_speed(p_world, me)
                 * class_mul(coalesce(p.class_mul, '{}'::jsonb), 'hands',
                             act_scope(p_world, me, d.skill))) end;
  update player set
      act = p_action, act_target = p_target, act_started = now(),
      act_ends = now() + make_interval(secs => secs),
      act_left = greatest(1, least(100, coalesce(p_times, 1))),
      act_goes = greatest(1, least(100, coalesce(p_times, 1))), seen_at = now(), away = false
    where world_id = p_world and uid = me;
  /*
   * And what the ask left you holding, said in the answer to the ask.
   *
   * Reported as inventory rubberbanding: a thing put in a crate turns up in
   * the crate and stays in the pack as well, for up to the twenty seconds
   * until the next reconcile, and then goes. Two causes with one shape —
   * nothing ever tells a browser that a thing has *left* its hands.
   *
   * `item` is published with the default replica identity, so a DELETE carries
   * the primary key and nothing else, and the browser's Realtime filter is
   * `holder_uid = me`: a row carrying only an `id` cannot match it. Putting a
   * whole stack in a crate deletes the row, so nothing is said. And a thing
   * that goes to the ground, or to somebody else, has `holder_uid` set to
   * null, so the *new* row does not match the filter either. Realtime carries
   * every arrival and no departure, and `refresh_pack` on the twenty-second
   * reconcile was the only thing that ever noticed.
   *
   * Said at each return rather than worked out once at the top, because for an
   * instant ask the work happens in the `settle` three lines below this — a
   * value built any earlier is the pack as it was before the thing moved,
   * which is the very answer that was wrong.
   */
  if d.instant then
    perform settle(p_world, me);
    return held_now(p_world, me) || jsonb_build_object('started', true, 'done', true, 'seconds', 0);
  end if;
  perform tell(p_world, me, 'You start ' || d.verb || '.', 'info');
  return held_now(p_world, me)
      || jsonb_build_object('started', true, 'ends', now() + make_interval(secs => secs), 'seconds', secs);
end $function$;

CREATE OR REPLACE FUNCTION public.spend_wind(p_world uuid, p_uid uuid, p_action text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare cost double precision; secs double precision; w double precision;
        body double precision; spent double precision; v_idle boolean;
        v_skill text; v_mul jsonb;
begin
  select stamina, base_time, skill into cost, secs, v_skill from action_def where id = p_action;
  -- A swing is done with whatever is in your hand, not with `fighting`.
  v_skill := act_scope(p_world, p_uid, v_skill);
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
  select coalesce((pl.stats->>'stamina')::double precision, 1), coalesce(pl.class_mul, '{}'::jsonb)
    into w, v_mul
    from player pl where pl.world_id = p_world and pl.uid = p_uid;
  -- And the tree, on the trade this go belongs to and no other. The read it
  -- wants is the read the wind already had to do, so it costs nothing.
  spent := cost * body * class_mul(v_mul, 'wind', v_skill);
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

CREATE OR REPLACE FUNCTION public.rpc_tree(p_world uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); p player;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  select * into p from player where world_id = p_world and uid = me;
  if not found then return jsonb_build_object('why', 'You are not on this island.'); end if;
  return jsonb_build_object(
    'mul', coalesce(p.class_mul, '{}'::jsonb),
    -- The rite of each trade you hold, and why not where there is a why, so a
    -- panel can draw the button and its refusal out of the one answer.
    'rites', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'class', r.class, 'name', r.name, 'cost', r.cost, 'level', r.level,
        'secs', r.secs, 'rest', r.rest, 'muls', r.muls, 'note', r.note,
        'why', rite_refusal(p_world, me, r.id)) order by r.id)
      from rite_def r where r.class in (p.craft_class, p.combat_class)), '[]'::jsonb),
    'channels', coalesce((select jsonb_agg(jsonb_build_object('id', ch.id, 'name', ch.name,
        'note', ch.note, 'downward', ch.downward) order by ch.id) from class_channel ch), '[]'::jsonb),
    'trades', coalesce((
      select jsonb_agg(jsonb_build_object(
        'class', c.id, 'kind', c.kind, 'name', c.name, 'lever', c.lever,
        'points', class_points(p_world, me, c.id),
        'spent', class_spent(p_world, me, c.id),
        'nodes', (select jsonb_agg(jsonb_build_object(
            'id', n.id, 'col', n.col, 'rank', n.rank, 'name', n.name, 'note', n.note,
            'channel', n.channel, 'cost', n.cost, 'needs', n.needs, 'mul', n.mul,
            'taken', exists (select 1 from player_node pn
                              where pn.world_id = p_world and pn.uid = me and pn.node = n.id),
            'why', node_refusal(p_world, me, n.id)) order by n.col, n.rank)
          from class_node n where n.class = c.id)) order by c.kind)
      from class_def c where c.id in (p.craft_class, p.combat_class)), '[]'::jsonb));
end $function$;

notify pgrst, 'reload schema';
select private.lock_doors();
