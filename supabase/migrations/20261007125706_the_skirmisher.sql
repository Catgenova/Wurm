/*
 * The Skirmisher: two spells and a passive at each of six tiers, opening on
 * the trade's own level, as the other fighting trades' do (`talents.ts`).
 *
 * Picked: spells 2 3 4 7 8 9 10 12 31 36 44 49 and passives 2 4 7 10 12 20
 * of the fifty and thirty offered, and set in the tiers in order of what they
 * are worth. The rows came with the definitions just before this. Here: what
 * each spell does with the javelin or the throwing axe in hand, which fights
 * from where you stand (`class_blow`); a leap back over ground you could walk
 * (`class_leap`); a quicker walk on foot while a Hit and Run holds
 * (`travel_speed`); a creature marked so that every blow, throw and shot on it
 * is critical more often (`class_marked`); and the passives in the rules they
 * change -- a critical blow's chance and weight by the weapon (`my_crit_chance`,
 * `crit_mul`), a bleed's length (`side_blow`), and a dodged blow answered
 * (`class_riposte`).
 */
set local lock_timeout = '3s';

/* The Skirmisher's old tree went with the move to perks: its bought nodes go too, and its holders are folded afresh. */
delete from player_node pn
 where pn.node like 'skirmisher\_%' and not exists (select 1 from class_perk k where k.id = pn.node)
   and not exists (select 1 from class_node n where n.id = pn.node);
do $$ declare r record; begin
  for r in select world_id, uid from player where combat_class = 'skirmisher' loop perform class_fold(r.world_id, r.uid); end loop;
end $$;

/* Your chance of a critical blow with this weapon: at your skill with it, and more for a Skirmisher's Keen Edge on a thrown one (`myCritChance`). */
create or replace function my_crit_chance(p_world uuid, p_uid uuid, w weapon_def)
  returns double precision language sql stable as $$
  select crit_chance(skill_of(p_world, p_uid, w.kind), w.id, w.kind)
       + case when w.id = 'fist' then 0 else pk(p_world, p_uid, 'crit:' || w.kind, 0) end
$$;

/* How hard a critical blow of yours with it lands: `crit_hit`, or harder for a Skirmisher's Lethal on a knife (`critMul`). */
create or replace function crit_mul(p_world uuid, p_uid uuid, w weapon_def)
  returns double precision language sql stable as $$
  select case when w.id = 'fist' then crit_hit() else pk(p_world, p_uid, 'crithit:' || w.kind, crit_hit()) end
$$;

/* How many times as often a blow, a throw or a shot that lands on it is critical, while a Skirmisher's Marked for Death holds on it. */
create or replace function class_marked(p_world uuid, p_id int)
  returns double precision language sql stable as $$
  select coalesce((select cm.val from class_mark cm where cm.world_id = p_world and cm.creature_id = p_id
                     and cm.kind = 'marked' and cm.until > now()), 1)
$$;

/*
 * A leap straight away from a point, as far as `p_far` tiles over ground you
 * could walk (`walk_share`, as `rpc_move` asks), and a quarter of the way
 * shorter at a time where it cannot go so far: a Skirmisher's Parting Throw.
 * Where it put you and how far, for the browser to follow; nothing when even
 * a quarter of it is barred.
 */
create or replace function class_leap(p_world uuid, p_uid uuid, p_from_x double precision, p_from_y double precision, p_far double precision)
  returns jsonb language plpgsql as $$
declare me player; v_d double precision; v_ux double precision; v_uy double precision; v_by double precision;
        v_x double precision; v_y double precision; v_q int;
begin
  select * into me from player where world_id = p_world and uid = p_uid;
  v_d := sqrt((me.x - p_from_x) ^ 2 + (me.y - p_from_y) ^ 2);
  if me.uid is null or v_d < 0.001 then return null; end if;
  v_ux := (me.x - p_from_x) / v_d; v_uy := (me.y - p_from_y) / v_d;
  for v_q in reverse 4 .. 1 loop
    v_by := p_far * v_q / 4;
    v_x := me.x + v_ux * v_by; v_y := me.y + v_uy * v_by;
    if walk_share(p_world, p_uid, coalesce(me.level, 0), me.x, me.y, v_x, v_y) >= 0.999 then
      update player set x = v_x, y = v_y, moved_at = now() where world_id = p_world and uid = p_uid;
      perform drag_along(p_world, p_uid, v_x, v_y);
      return jsonb_build_object('x', v_x, 'y', v_y, 'level', coalesce(me.level, 0), 'by', v_by);
    end if;
  end loop;
  return null;
end $$;

/*
 * A Skirmisher's Riposte: for each blow of a creature's they dodged, a blow
 * at its share of a swing's from what is in their hand, while it is within
 * their reach (`riposte`). Paid once the creature's row is written
 * (`class_owed_pay`), since the dodge is made while it is being settled.
 */
create or replace function class_riposte(p_world uuid, p_uid uuid, p_id int, p_share double precision, p_n int)
  returns void language plpgsql as $$
declare c creature; pl player; b jsonb; v_go int;
begin
  for v_go in 1 .. greatest(1, coalesce(p_n, 1)) loop
    select * into c from creature where world_id = p_world and id = p_id;
    select * into pl from player where world_id = p_world and uid = p_uid;
    exit when c.id is null or c.health <= 0 or pl.uid is null
      or sqrt((creature_x(c) - pl.x) ^ 2 + (creature_y(c) - pl.y) ^ 2) > melee_reach(p_world, p_uid);
    b := class_blow(p_world, p_uid, p_id, p_share);
    perform tell(p_world, p_uid, 'You answer the ' || (b->>'name')
      || case when not (b->>'landed')::boolean then ' and miss.'
              when (b->>'died')::boolean then ', and it dies.'
              else case when (b->>'crit')::boolean then ' with a critical blow' else '' end
                || '. It is down to ' || (b->>'left') || ' of ' || (b->>'of') || '.' end, 'fight');
  end loop;
end $$;

/*
 * What is owed a creature once its row is written: a Pikeman's Brace for the
 * Charge's blow at the edge of their reach, and a Skirmisher's Riposte for
 * every blow of its they dodged; and the marks that have run out, gone.
 */
create or replace function class_owed_pay(p_world uuid, p_id int)
  returns void language plpgsql as $$
declare m class_mark; b jsonb; c creature; pl player; v_name text; v_back double precision;
begin
  if not exists (select 1 from class_mark where world_id = p_world and creature_id = p_id) then return; end if;
  delete from class_mark where world_id = p_world and creature_id = p_id and kind in ('warned', 'exposed', 'marked') and until < now();
  delete from class_mark where world_id = p_world and creature_id = p_id and kind = 'brace' and until <= now()
    returning * into m;
  if m.creature_id is not null then
    select * into c from creature where world_id = p_world and id = p_id;
    select * into pl from player where world_id = p_world and uid = m.by_uid;
    if c.id is not null and c.health > 0 and pl.uid is not null
       and sqrt((creature_x(c) - pl.x) ^ 2 + (creature_y(c) - pl.y) ^ 2) <= melee_reach(p_world, pl.uid) + 0.5 then
      select name into v_name from class_spell where id = 'pikeman_brace_for_the_charge';
      v_back := spell_fx('pikeman_brace_for_the_charge', 'back');
      b := class_blow(p_world, pl.uid, p_id, spell_fx('pikeman_brace_for_the_charge', 'more'));
      if (b->>'landed')::boolean and not (b->>'died')::boolean then
        update creature set until = greatest(until, now()) + make_interval(secs => v_back) where world_id = p_world and id = p_id;
        perform tell(p_world, pl.uid, class_blow_said(v_name, b) || ' Its next blow is put back ' || faith_span(v_back) || '.', 'fight');
      else
        perform tell(p_world, pl.uid, class_blow_said(v_name, b), 'fight');
      end if;
    end if;
  end if;
  delete from class_mark where world_id = p_world and creature_id = p_id and kind = 'riposte'
    returning * into m;
  if m.creature_id is not null and m.by_uid is not null then
    perform class_riposte(p_world, m.by_uid, p_id, m.val, m.n);
  end if;
end $$;

CREATE OR REPLACE FUNCTION public.class_blow(p_world uuid, p_uid uuid, p_id integer, p_more double precision, p_sure boolean DEFAULT false, p_blow text DEFAULT NULL::text, p_miss double precision DEFAULT 1, p_crit double precision DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare p player; c creature; d species_def; w weapon_def; held item; v_landed boolean; v_crit boolean := false;
        v_dmg double precision := 0; v_bane double precision; v_died boolean := false; v_hit double precision;
begin
  select * into p from player where world_id = p_world and uid = p_uid;
  select * into c from creature where world_id = p_world and id = p_id;
  if c.id is null then return jsonb_build_object('landed', false, 'died', false, 'name', 'creature'); end if;
  select * into d from species_def where id = c.species;
  w := swung_with(p_world, p_uid);
  held := swung_item(p_world, p_uid);
  v_hit := hit_chance(p_world, p_uid, w.kind, mark_of(held.mark, 'aim')) * beast_mul(c, 'evade');
  v_landed := p_sure or random() <= case when p_miss = 1 then v_hit else 1 - p_miss * (1 - v_hit) end;
  if v_landed then
    v_bane := case when held.id is not null and mat_bane(held.extra) and d.glow is not null then bane_bonus() else 1 end;
    -- And every one critical while a Last Rage holds (`class_crit`); more often for a Skirmisher's Keen Edge (`my_crit_chance`)
    -- and on one Marked for Death (`class_marked`).
    v_crit := random() < my_crit_chance(p_world, p_uid, w) * p_crit * class_marked(p_world, c.id) or class_crit(p_world, p_uid);
    v_dmg := weapon_damage(p_world, p_uid, w, held) * v_bane * my_stance_dealt(p_world, p_uid, p.fight_stance)
           * hide_takes(d.hide, coalesce(p_blow, blow_of(w.id, w.kind))) * blindside_of(c, p_uid) * (0.75 + random() * 0.5)
           * case when v_crit then crit_mul(p_world, p_uid, w) else 1 end * faith_arms(p_world, p_uid, d) * class_dealt(p_world, p_uid, c) * p_more;
    v_died := hurt_creature(p_world, c.id, v_dmg, p_uid);
    perform faith_feast(p_world, p_uid, v_dmg);
    if held.id is not null then perform damage_item(held.id, 0.35 * pk(p_world, p_uid, 'worn:weapon', 1)); end if;
    perform class_learn(p_world, p_uid, class_learn_blow() + case when v_died then class_learn_kill() else 0 end);
    perform class_leech(p_world, p_uid);
    if not v_died and w.id <> 'fist' then perform side_blow(p_world, p_uid, c.id, w.kind, v_dmg); end if;
  end if;
  if not v_died then perform engage_beast(p_world, c.id, p_uid); end if;
  -- And once it has turned on you, pushed off in a Keep Away (`class_keep_away`).
  if v_landed and not v_died then perform class_keep_away(p_world, p_uid, c.id); end if;
  return jsonb_build_object('landed', v_landed, 'died', v_died, 'crit', v_crit, 'dmg', v_dmg,
    'left', greatest(0, ceil(c.health - v_dmg)), 'of', max_health(c), 'name', lower(d.name));
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
              * (case when suits then 1.5 when got <> '' then 1.1 else 1 end);
    out_w := '[]'::jsonb;
    for one in select * from jsonb_array_elements(pt.wounds) loop
      if one = hurt then
        one := jsonb_set(one, '{severity}', to_jsonb(greatest(0, (one->>'severity')::double precision - healed)));
        if clean then
          one := jsonb_set(jsonb_set(one, '{dressing}', to_jsonb(got)), '{bleeding}', 'false');
          one := case when v_mend <> 1 then jsonb_set(one, '{mend}', to_jsonb(v_mend)) else one - 'mend' end;
        end if;
      end if;
      if (one->>'severity')::double precision > 0.004 or (one->>'infected')::boolean then
        out_w := out_w || one;
      end if;
    end loop;
    update player set wounds = out_w,
        stats = jsonb_set(pt.stats, '{health}',
          to_jsonb(least(1, coalesce((pt.stats->>'health')::double precision, 1) + healed)))
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

CREATE OR REPLACE FUNCTION public.class_shot(p_world uuid, p_uid uuid, p_id integer, p_more double precision, p_sure boolean DEFAULT false, p_crit double precision DEFAULT 1, p_steady boolean DEFAULT false, p_arrow text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare p player; c creature; d species_def; held item; bow weapon_def; arrow item; v_head text; v_dist double precision;
        v_landed boolean; v_crit boolean := false; v_dmg double precision := 0; v_bane double precision; v_died boolean := false;
        v_wind double precision;
begin
  select * into p from player where world_id = p_world and uid = p_uid;
  select * into c from creature where world_id = p_world and id = p_id;
  if c.id is null then return jsonb_build_object('landed', false, 'died', false, 'name', 'creature'); end if;
  select * into d from species_def where id = c.species;
  held := worn(p_world, p_uid, 'weapon');
  select bw.* into bow from weapon_def bw where bw.id = held.def and bw.ammo is not null;
  select i.* into arrow from item i
    where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and arrow_head_of(i.def) is not null
    order by (i.def = coalesce(p_arrow, 'arrow')) desc, (i.def = 'arrow') desc, i.ql desc limit 1;
  -- Nothing loosed without a bow and an arrow, which `spell_cast_refusal` asks first.
  if bow.id is null or arrow.id is null or not consume(p_world, p_uid, arrow.def, 1, arrow.id) then
    return jsonb_build_object('landed', false, 'died', false, 'name', lower(d.name));
  end if;
  v_head := arrow_head_of(arrow.def);
  v_dist := sqrt((creature_x(c) - p.x) ^ 2 + (creature_y(c) - p.y) ^ 2);
  v_wind := class_wind_take(p_world, p_uid);
  v_landed := p_sure or v_wind is not null or random() <= hit_chance(p_world, p_uid, 'archery', mark_of(held.mark, 'aim'))
      * case when p_steady then 1 else 1 - (v_dist / bow_range(p_world, p_uid, bow, held)) * 0.35 end * beast_mul(c, 'evade');
  if v_landed then
    v_bane := case when mat_bane(arrow.extra) and d.glow is not null then bane_bonus() else 1 end;
    -- And every one critical while a Last Rage holds (`class_crit`).
    v_crit := random() < my_crit_chance(p_world, p_uid, bow) * p_crit * coalesce(v_wind, 1) * class_marked(p_world, c.id)
              or class_crit(p_world, p_uid);
    v_dmg := weapon_damage(p_world, p_uid, bow, held) * mat_edge(arrow.extra) * v_bane * my_stance_dealt(p_world, p_uid, p.fight_stance)
           * hide_takes(d.hide, case when v_head = 'blunt' then 'crush' else blow_of(bow.id, bow.kind) end)
           * case when v_head = 'bodkin' and d.hide is not null then bodkin_hide() else 1 end
           * blindside_of(c, p_uid) * (0.6 + arrow.ql / 140) * (0.8 + random() * 0.4)
           * case when v_crit then crit_mul(p_world, p_uid, bow) else 1 end * faith_arms(p_world, p_uid, d)
           * class_dealt(p_world, p_uid, c) * class_ambush(p_world, p_uid, c) * p_more;
    v_died := hurt_creature(p_world, c.id, v_dmg, p_uid);
    perform class_learn(p_world, p_uid, class_learn_blow() + case when v_died then class_learn_kill() else 0 end);
    perform class_leech(p_world, p_uid);
    perform faith_feast(p_world, p_uid, v_dmg);
    perform damage_item(held.id, 0.25 * pk(p_world, p_uid, 'worn:weapon', 1));
    -- A broadhead bleeds it as a knife does, a blunt staggers it as a maul does (`headSide`).
    if not v_died and v_head in ('broadhead', 'blunt') then
      perform side_blow(p_world, p_uid, c.id, case when v_head = 'broadhead' then 'knives' else 'mauls' end, v_dmg);
    end if;
    perform class_arrow_saved(p_world, p_uid, arrow);
  end if;
  if not v_died then perform engage_beast(p_world, c.id, p_uid); end if;
  return jsonb_build_object('landed', v_landed, 'died', v_died, 'crit', v_crit, 'dmg', v_dmg,
    'left', greatest(0, ceil(c.health - v_dmg)), 'of', max_health(c), 'name', lower(d.name), 'arrow', arrow.def);
end $function$;

CREATE OR REPLACE FUNCTION public.side_blow(p_world uuid, p_uid uuid, p_id integer, p_kind text, p_dmg double precision)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare v_name text;
begin
  if p_kind = 'mauls' then
    select lower(sd.name) into v_name from creature c join species_def sd on sd.id = c.species
      where c.world_id = p_world and c.id = p_id and c.windup_at is not null;
    if v_name is not null then perform tell(p_world, p_uid, 'You knock the ' || v_name || ' off its stroke.', 'fight'); end if;
    update creature set windup_at = null, until = greatest(until, now()) + make_interval(secs => stagger_maul())
      where world_id = p_world and id = p_id;
  elsif p_kind = 'polearms' then
    update creature set until = greatest(until, now()) + make_interval(secs => stagger_pole())
      where world_id = p_world and id = p_id;
  elsif p_kind = 'knives' then
    update creature set bleed_rate = greatest(coalesce(bleed_rate, 0), p_dmg * knife_bleed()),
        -- Longer for a Skirmisher's Long Bleed (`sideBlow`).
        bleed_until = now() + make_interval(secs => knife_bleed_secs() * pk(p_world, p_uid, 'bleed:secs', 1))
      where world_id = p_world and id = p_id;
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.class_dealt(p_world uuid, p_uid uuid, c creature)
 RETURNS double precision
 LANGUAGE sql
 STABLE
AS $function$
  select coalesce((
    select case when (pl.blessings->'battle_rage'->>'until')::timestamptz > now()
                then (pl.blessings->'battle_rage'->>'dealt')::double precision else 1 end
         * case when c.health < max_health(c) * pk(pl.class_mul, 'finish:below', 0)
                then pk(pl.class_mul, 'finish:dmg', 1) else 1 end
         * case when coalesce((pl.stats->>'health')::double precision, 1) < pk(pl.class_mul, 'pain:deep', 0) then pk(pl.class_mul, 'pain:deeper', 1)
                when coalesce((pl.stats->>'health')::double precision, 1) < pk(pl.class_mul, 'pain:below', 0) then pk(pl.class_mul, 'pain:dmg', 1)
                else 1 end
         * case when coalesce(sd.monster, false) then pk(pl.class_mul, 'monster:dmg', 1) else 1 end
         * case when pk(pl.class_mul, 'gap:dmg', 1) <> 1 and g.d > beast_reach(sd) and g.d <= melee_reach(p_world, p_uid)
                then pk(pl.class_mul, 'gap:dmg', 1) else 1 end
         * coalesce((select cm.val from class_mark cm where cm.world_id = p_world and cm.creature_id = c.id
                       and cm.kind = 'exposed' and cm.until > now()), 1)
         -- And a Skirmisher's Opportunist on one fighting somebody else: another creature, or another person.
         * case when (pl.blessings->'opportunist'->>'until')::timestamptz > now()
                 and (c.enemy is not null or (c.hunting is not null and c.hunting <> p_uid))
                then (pl.blessings->'opportunist'->>'dealt')::double precision else 1 end
      from player pl
      join species_def sd on sd.id = c.species
      cross join lateral (select sqrt((creature_x(c) - pl.x) ^ 2 + (creature_y(c) - pl.y) ^ 2) as d) g
     where pl.world_id = p_world and pl.uid = p_uid), 1)
$function$;

CREATE OR REPLACE FUNCTION public.travel_speed(p_world uuid, p_uid uuid)
 RETURNS double precision
 LANGUAGE plpgsql
 STABLE
AS $function$
declare c creature; p placed; v double precision; pl player;
begin
  p := driving(p_world, p_uid);
  if p.id is not null then
    -- As fast as she can go under the hands at her helm, and her builder's
    -- hand in her too: a Carpenter's Keel Layer. And the helm's own Sailing
    -- (`sailing_pace`), as the browser's `boatSpeed` has it.
    if is_boat(p) then
      return hull_speed(p_world, p_uid, p) * mark_of(p.mark, 'speed')
           * sailing_pace(skill_of(p_world, p_uid, sailing_skill()));
    end if;
    v := vehicle_speed(p_world, p.id);
    -- And the driver's Driving on the reins (`driving_pace`), past the cap as the mark is.
    if v > 0 then return v * driving_pace(skill_of(p_world, p_uid, driving_skill())); end if;
    return base_speed();
  end if;
  c := mount_of(p_world, p_uid);
  if c.id is not null then
    -- Shod, it goes quicker on laid stone and gravel.
    select * into pl from player where world_id = p_world and uid = p_uid;
    -- The cap comes after the shoes, as the browser has it: a mount at the cap is at the cap.
    -- And quicker again in tack its maker's hand is in (a Tailor's Saddler), past the cap, as a vehicle's mark is.
    return least(max_mount_speed(), mount_speed(c) * case when shod(c) and paved(land_tile(p_world, floor(pl.x)::int, floor(pl.y)::int))
                                                          then shoe_pace() else 1 end) * tack_speed(c);
  end if;
  -- On foot, and on a made road, a Terraformer's Road Legs; and quicker while a Skirmisher's Hit and Run holds.
  select * into pl from player where world_id = p_world and uid = p_uid;
  v := case when (pl.blessings->'hit_and_run'->>'until')::timestamptz > now()
            then (pl.blessings->'hit_and_run'->>'pace')::double precision else 1 end;
  if coalesce((select t.road from tile_def t
                where t.id = land_tile(p_world, floor(pl.x)::int, floor(pl.y)::int)), false) then
    return base_speed() * pk(pl.class_mul, 'walk:road', 1) * v;
  end if;
  return base_speed() * v;
end $function$;

CREATE OR REPLACE FUNCTION public.hurt_player(p_world uuid, p_uid uuid, p_raw double precision, p_what text, p_kind text DEFAULT 'bite'::text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare p player; shield item; sh shield_def; chance double precision; roll double precision;
        part text; piece item; cls armour_class_def; soak double precision; taken double precision;
        health double precision; ws jsonb; had jsonb; found_w boolean := false; out_w jsonb := '[]'::jsonb;
        w jsonb; k wound_kind_def; note text; aegis double precision; v_worn double precision;
        v_from creature; v_venom boolean := false; v_dodge double precision; v_guard uuid;
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
      perform fight_back(p_world, p_uid, (p.stats->>'hurtBy')::int);
      return;
    end if;
    update player set stats = jsonb_set(stats, '{aegis}', to_jsonb(0::double precision))
      where world_id = p_world and uid = p_uid;
    p_raw := p_raw - aegis;
    perform tell(p_world, p_uid, 'The ward goes with a sound like ice, and the rest of it reaches you.', 'fight');
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
  perform tell(p_world, p_uid, p_what || note || '. You have ' || wound_text(w) || '.', 'fight');
  -- And a Second Life, which the killing blow spends instead of you (`faith_second_life`).
  -- Undying holds you at its floor and is not spent; a Second Life is.
  if health <= 0 and faith_undying(p_world, p_uid) then perform fight_back(p_world, p_uid, (p.stats->>'hurtBy')::int);
  elsif health <= 0 and faith_second_life(p_world, p_uid) then perform fight_back(p_world, p_uid, (p.stats->>'hurtBy')::int);
  elsif health <= 0 then perform player_die(p_world, p_uid);
  else perform fight_back(p_world, p_uid, (p.stats->>'hurtBy')::int); end if;
end $function$;

CREATE OR REPLACE FUNCTION public.class_spell_cast(p_world uuid, p_uid uuid, p_spell text, p_target jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare s class_spell; me player; c creature; d species_def; b jsonb; v_said text; v_id int; r record;
        v_dist double precision; v_reach double precision; v_x double precision; v_y double precision;
        v_n int := 0; v_put jsonb; v_windup boolean; v_more double precision; v_h double precision;
        v_dead int := 0; v_held int := 0; v_i int; v_part text; v_on jsonb; v_pace jsonb;
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

  else
    return jsonb_build_object('why', 'Nothing is written behind that spell yet.');
  end case;

  -- The blow it struck goes back with the sentence, for whoever cast it to read the numbers of (`class_blow`).
  return jsonb_build_object('said', v_said)
    || case when b is not null then jsonb_build_object('blow', b) else '{}'::jsonb end
    || case when v_put is not null then jsonb_build_object('put', v_put) else '{}'::jsonb end
    || case when v_pace is not null then jsonb_build_object('pace', v_pace) else '{}'::jsonb end;
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

CREATE OR REPLACE FUNCTION public.rpc_cast_spell(p_world uuid, p_slot integer, p_target jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); v_spell text; v_why text; s spell_any; v_at jsonb; v_out jsonb;
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
  if s.school = 'class' then
    -- A fighting trade's (`class_spell_cast`), paid in stamina, and where a Lunge put you, for the browser to follow.
    v_out := class_spell_cast(p_world, me, v_spell, v_at);
    if v_out ? 'why' then return v_out; end if;
    update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}',
          to_jsonb(greatest(0, coalesce((stats->>'stamina')::double precision, 1) - s.cost))),
        used_at = jsonb_set(coalesce(used_at, '{}'::jsonb), array['spell:' || s.id], to_jsonb(now()), true)
      where world_id = p_world and uid = me;
    perform tell(p_world, me, v_out->>'said', 'system');
    return faith_said(p_world, me) || jsonb_build_object('cast', s.id, 'said', v_out->>'said')
      || case when v_out ? 'put' then jsonb_build_object('put', v_out->'put') else '{}'::jsonb end
      || case when v_out ? 'pace' then jsonb_build_object('pace', v_out->'pace') else '{}'::jsonb end;
  end if;
  v_out := faith_spell_cast(p_world, me, v_spell, v_at);
  if v_out ? 'why' then return v_out; end if;
  perform favour_settle(p_world, me);
  update player set favour = greatest(0, favour - s.cost),
      used_at = jsonb_set(coalesce(used_at, '{}'::jsonb), array['spell:' || s.id], to_jsonb(now()), true)
    where world_id = p_world and uid = me;
  perform skill_raise(p_world, me, faith_skill(), 0.6);
  perform tell(p_world, me, v_out->>'said', 'system');
  return faith_said(p_world, me) || jsonb_build_object('cast', s.id, 'said', v_out->>'said');
end $function$;

select private.lock_doors();
