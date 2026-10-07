/*
 * The Sworn Blade: two spells and a passive at each of six tiers, opening on
 * the trade's own level (`talents.ts`).
 *
 * Asked for: "Let's build out the 10 combat classes class by class. Once
 * selected, the class begins to gain experience in combat. There will be a
 * pick from 2 spells and a passive at each tier. New tiers unlock at class
 * levels 1 20 40 60 80 99." The rows -- `class_spell`, `class_tier`, the
 * eighteen `class_perk`s and the constants -- came with the definitions just
 * before this. Here: the level and what teaches it, the spells' door and what
 * each one does, and the six passives in the rules they change.
 */
set local lock_timeout = '3s';

/*
 * ---- A fighting trade's own level, its marks on a creature, and every spell in one view ----
 */
alter table player add column if not exists class_level double precision not null default 0;
-- Everybody already holding a fighting trade starts its level where a trade taken today does.
update player set class_level = class_level_start() where combat_class is not null and class_level < class_level_start();

-- A Sworn Blade's Hamstring: a pace and when it lapses, on the creature's own row, so the world
-- tick that asks `beast_mul` of every beast it moves reads it without a look-up.
alter table creature add column if not exists slow double precision;
alter table creature add column if not exists slow_until timestamptz;

/*
 * What a fighting trade's spell leaves on a creature besides: a Disarming Cut's
 * weakened blows, counted down one a blow, and a Counterweight's stagger owed
 * to a creature whose blow was blocked in the middle of its own turn -- which
 * writes its row back at the end, so the stagger is paid by that turn
 * (`hunt_settle`) rather than written over by it.
 */
create table if not exists class_mark (
  world_id uuid not null, creature_id int not null, kind text not null,
  val double precision not null, n int, until timestamptz not null, by_uid uuid,
  primary key (world_id, creature_id, kind)
);
alter table class_mark enable row level security;

/* Every spell there is, a patron's and a trade's, in the shape the bar and the cast door ask of one. */
create or replace view spell_any with (security_invoker = true) as
  select id, 'faith'::text as school, patron as owner, name, note, cost, rest, on_what, radius, fx from faith_spell
  union all
  select id, 'class'::text, class, name, note, cost, rest, on_what, null::double precision, fx from class_spell;
revoke insert, update, delete, truncate on spell_any from anon, authenticated;

/* The Sworn Blade's old tree went with the move to perks: its bought nodes go too, and its holders are folded afresh. */
delete from player_node pn
 where pn.node like 'blade\_%' and not exists (select 1 from class_perk k where k.id = pn.node)
   and not exists (select 1 from class_node n where n.id = pn.node);
do $$ declare r record; begin
  for r in select world_id, uid from player where combat_class = 'blade' loop perform class_fold(r.world_id, r.uid); end loop;
end $$;

/*
 * ---- The level ----
 *
 * On the curve every skill rises on (`skill_gain_of`), from `class_learn_blow`
 * for a blow that lands and `class_learn_kill` more for one that kills. Said
 * when it crosses the level a tier opens at, and only for a trade that has
 * tiers to open; the rest of the climb is quiet.
 */
create or replace function class_learn(p_world uuid, p_uid uuid, p_base double precision)
  returns void language plpgsql as $$
declare p player; v_now double precision; v_at int;
begin
  select * into p from player where world_id = p_world and uid = p_uid;
  if not found or p.combat_class is null or p.class_level <= 0 or p_base <= 0 then return; end if;
  v_now := least(100, p.class_level + skill_gain_of(p.class_level, p_base, 0.6 + 0.8 * random()));
  update player set class_level = v_now where world_id = p_world and uid = p_uid;
  select t.at into v_at from class_tier t where t.at > p.class_level and t.at <= v_now order by t.at limit 1;
  if v_at is not null and exists (select 1 from class_perk k where k.class = p.combat_class) then
    perform tell(p_world, p_uid, 'Your ' || lower((select name from class_def where id = p.combat_class))
      || ' level reaches ' || v_at || ', and a new tier opens in the Trades window.', 'system');
  end if;
end $$;

/* What a stance makes of the damage you take and deal, with what a perk makes of it (a Sworn Blade's Stalwart). */
create or replace function my_stance_taken(p_world uuid, p_uid uuid, p_stance text)
  returns double precision language sql stable as $$
  select pk(p_world, p_uid, 'stance:' || coalesce(p_stance, 'balanced') || '_taken', stance_taken(p_stance))
$$;
create or replace function my_stance_dealt(p_world uuid, p_uid uuid, p_stance text)
  returns double precision language sql stable as $$
  select pk(p_world, p_uid, 'stance:' || coalesce(p_stance, 'balanced') || '_dealt', stance_dealt(p_stance))
$$;

/* Whether this spell is yours to cast: a patron's taken, or your fighting trade's taken while you hold the trade. */
create or replace function spell_known(p_world uuid, p_uid uuid, p_spell text)
  returns boolean language sql stable as $$
  select exists (select 1 from player_spell where world_id = p_world and uid = p_uid and spell = p_spell)
      or exists (select 1 from class_spell cs
                   join player_node pn on pn.node = cs.id and pn.world_id = p_world and pn.uid = p_uid
                   join player pl on pl.world_id = p_world and pl.uid = p_uid and pl.combat_class = cs.class
                  where cs.id = p_spell)
$$;

/* A Disarming Cut's share off this creature's next blow, counting that blow off the ones it has left. */
create or replace function class_disarm_take(p_world uuid, p_id int)
  returns double precision language plpgsql as $$
declare m class_mark;
begin
  if p_id is null then return 1; end if;
  update class_mark set n = n - 1
   where world_id = p_world and creature_id = p_id and kind = 'disarm' and until > now() and n > 0
   returning * into m;
  if not found then return 1; end if;
  if m.n <= 0 then delete from class_mark where world_id = p_world and creature_id = p_id and kind = 'disarm'; end if;
  return 1 - m.val;
end $$;

/* The stagger a Counterweight left owing on this creature, paid once, as seconds onto its next blow. */
create or replace function class_stagger_owed(p_world uuid, p_id int)
  returns interval language plpgsql as $$
declare v double precision;
begin
  delete from class_mark where world_id = p_world and creature_id = p_id and kind = 'stagger'
   returning val into v;
  return make_interval(secs => coalesce(v, 0));
end $$;

/*
 * A Sworn Blade with a shield, standing within `guardian_reach` of a blow a
 * creature landed, who takes it instead: the nearest such body rolls its
 * Guardian's share, and nobody else does. Nobody when it is `p_not`.
 */
create or replace function class_guardian(p_world uuid, p_x double precision, p_y double precision, p_not uuid)
  returns uuid language plpgsql as $$
declare g record;
begin
  for g in
    select pl.uid, pk(pl.class_mul, 'cover:share', 0) as share
      from player pl
     where pl.world_id = p_world and pl.uid is distinct from p_not and not pl.away
       and pk(pl.class_mul, 'cover:share', 0) > 0
       and coalesce((pl.stats->>'health')::double precision, 1) > 0
       and (pl.x - p_x) ^ 2 + (pl.y - p_y) ^ 2 <= guardian_reach() ^ 2
       and exists (select 1 from shield_def sd where sd.id = (worn(p_world, pl.uid, 'offhand')).def)
     order by (pl.x - p_x) ^ 2 + (pl.y - p_y) ^ 2
     limit 1
  loop
    if random() < g.share then return g.uid; end if;
  end loop;
  return null;
end $$;

/* The blow a Guardian took on a shield: it wears the shield as a block does, and teaches it as one. */
create or replace function class_guard_take(p_world uuid, p_guard uuid, p_raw double precision, p_by text, p_for text)
  returns void language plpgsql as $$
declare shield item;
begin
  shield := worn(p_world, p_guard, 'offhand');
  if shield.id is null then return; end if;
  update item set dmg = least(100, dmg + p_raw * 3 * pk(p_world, p_guard, 'worn:shield', 1)) where id = shield.id;
  perform skill_raise(p_world, p_guard, 'shields', 0.5);
  perform tell(p_world, p_guard, 'You take the ' || p_by || '’s blow at ' || p_for || ' on your '
    || lower((select name from item_def where id = shield.def)) || '.', 'fight');
end $$;

/*
 * How often your shield takes a blow, before the crowd on you has its say: what
 * it is and how well made, how well you use one, and the trade -- a Sworn
 * Blade's Shield Mastery adding to it under the ceiling it raises (`blockChance`
 * in `fight.ts`, the same sum).
 */
create or replace function shield_block(p_world uuid, p_uid uuid, p_sh shield_def, p_ql double precision)
  returns double precision language sql stable as $$
  select least(pk(p_world, p_uid, 'blockcap:shield', block_most()),
               (p_sh.block * (0.6 + p_ql / 160) + skill_of(p_world, p_uid, 'shields') / 400)
               * class_mul(p_world, p_uid, 'guard', 'shields') + pk(p_world, p_uid, 'block:shield', 0))
$$;

/*
 * ---- A blow struck by a spell ----
 *
 * A blow with what is in your hand, as a swing of it lands in `perform_fight`
 * -- its damage, your stance, the hide, a creature whose mind is elsewhere,
 * a critical one now and then -- at `p_more` of it, and with `p_blow` for the
 * kind when it is not the weapon's own (a shield bash crushes). It may miss
 * as a swing may, unless it is `p_sure`. A blow that lands teaches the trade
 * as one does, and wears the weapon; one that leaves it alive is fought back.
 */
create or replace function class_blow(p_world uuid, p_uid uuid, p_id int, p_more double precision,
    p_sure boolean default false, p_blow text default null)
  returns jsonb language plpgsql as $$
declare p player; c creature; d species_def; w weapon_def; held item; v_landed boolean; v_crit boolean := false;
        v_dmg double precision := 0; v_bane double precision; v_died boolean := false;
begin
  select * into p from player where world_id = p_world and uid = p_uid;
  select * into c from creature where world_id = p_world and id = p_id;
  if c.id is null then return jsonb_build_object('landed', false, 'died', false, 'name', 'creature'); end if;
  select * into d from species_def where id = c.species;
  w := swung_with(p_world, p_uid);
  held := swung_item(p_world, p_uid);
  v_landed := p_sure or random() <= hit_chance(p_world, p_uid, w.kind, mark_of(held.mark, 'aim')) * beast_mul(c, 'evade');
  if v_landed then
    v_bane := case when held.id is not null and mat_bane(held.extra) and d.glow is not null then bane_bonus() else 1 end;
    v_crit := random() < crit_chance(skill_of(p_world, p_uid, w.kind), w.id, w.kind);
    v_dmg := weapon_damage(p_world, p_uid, w, held) * v_bane * my_stance_dealt(p_world, p_uid, p.fight_stance)
           * hide_takes(d.hide, coalesce(p_blow, blow_of(w.id, w.kind))) * blindside_of(c, p_uid) * (0.75 + random() * 0.5)
           * case when v_crit then crit_hit() else 1 end * faith_arms(p_world, p_uid, d) * p_more;
    v_died := hurt_creature(p_world, c.id, v_dmg, p_uid);
    perform faith_feast(p_world, p_uid, v_dmg);
    if held.id is not null then perform damage_item(held.id, 0.35 * pk(p_world, p_uid, 'worn:weapon', 1)); end if;
    perform class_learn(p_world, p_uid, class_learn_blow() + case when v_died then class_learn_kill() else 0 end);
  end if;
  if not v_died then perform engage_beast(p_world, c.id, p_uid); end if;
  return jsonb_build_object('landed', v_landed, 'died', v_died, 'crit', v_crit, 'dmg', v_dmg,
    'left', greatest(0, ceil(c.health - v_dmg)), 'of', max_health(c), 'name', lower(d.name));
end $$;

/* What a spell's blow did, as the log says it: "<Spell>: you strike the <it>. It is down to 12 of 40." */
create or replace function class_blow_said(p_spell text, b jsonb)
  returns text language sql immutable as $$
  select p_spell || ': ' || case
    when not (b->>'landed')::boolean then 'you swing at the ' || (b->>'name') || ' and miss.'
    when (b->>'died')::boolean then 'you strike the ' || (b->>'name') || ', and it dies.'
    else 'you strike the ' || (b->>'name') || case when (b->>'crit')::boolean then ', a critical blow' else '' end
      || '. It is down to ' || (b->>'left') || ' of ' || (b->>'of') || '.' end
$$;

/*
 * ---- What a fighting trade's spell does ----
 *
 * The island's half of `talents.ts`: one arm a spell, each reading its numbers
 * off its own row (`spell_fx`). `rpc_cast_spell` has already asked whether it
 * may be cast (`spell_cast_refusal`) and what at (`spell_target`); an arm that
 * still finds it cannot be done says why and costs nothing.
 */
create or replace function class_spell_cast(p_world uuid, p_uid uuid, p_spell text, p_target jsonb)
  returns jsonb language plpgsql as $$
declare s class_spell; me player; c creature; d species_def; b jsonb; v_said text; v_id int; r record;
        v_dist double precision; v_reach double precision; v_x double precision; v_y double precision;
        v_n int := 0; v_put jsonb; v_windup boolean;
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
    -- A blow wants it within reach of what is in your hand; a Lunge within its stride; a Challenge as far as any spell.
    v_reach := case when p_spell = 'blade_lunge' then spell_fx(p_spell, 'reach')
                    when p_spell = 'blade_challenge' then spell_reach()
                    else melee_reach(p_world, p_uid) end;
    if v_dist > v_reach then
      return jsonb_build_object('why', 'The ' || lower(d.name) || ' is more than ' || trim_scale(round(v_reach::numeric, 1)) || ' tiles away.');
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

  else
    return jsonb_build_object('why', 'Nothing is written behind that spell yet.');
  end case;

  -- The blow it struck goes back with the sentence, for whoever cast it to read the numbers of (`class_blow`).
  return jsonb_build_object('said', v_said)
    || case when b is not null then jsonb_build_object('blow', b) else '{}'::jsonb end
    || case when v_put is not null then jsonb_build_object('put', v_put) else '{}'::jsonb end;
end $$;


CREATE OR REPLACE FUNCTION public.beast_mul(c creature, p_channel text)
 RETURNS double precision
 LANGUAGE sql
 STABLE
AS $function$
  select trait_mul(c.traits, p_channel) * deed_aura(c, p_channel)
       -- Ninety-nine in a hundred are ordinary, and the world tick asks this of every beast it moves: they are spared the look-up.
       * case when c.rare is null then 1 else rarity_blood(c.rare, p_channel) end
       * case when p_channel in ('work', 'learn') then care_mul(c) else 1 end
       -- And a Sworn Blade's Hamstring, for as long as it holds (`slow`).
       * case when p_channel = 'speed' and c.slow_until > now() then coalesce(c.slow, 1) else 1 end
$function$;

CREATE OR REPLACE FUNCTION public.spell_fx(p_spell text, p_key text)
 RETURNS double precision
 LANGUAGE sql
 STABLE
AS $function$
  select (fx->>p_key)::double precision from spell_any where id = p_spell
$function$;

CREATE OR REPLACE FUNCTION public.spell_school(p_spell text)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  select school from spell_any where id = p_spell
$function$;

CREATE OR REPLACE FUNCTION public.spell_target(p_world uuid, p_uid uuid, p_spell text, p_target jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
declare s spell_any; me player; pl player; c creature; pc placed;
        v_kind text := coalesce(p_target->>'kind', 'self');
        v_id bigint := case when p_target->>'id' ~ '^[0-9]{1,18}$' then (p_target->>'id')::bigint end;
        v_uid uuid := case when p_target->>'uid' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                           then (p_target->>'uid')::uuid end;
        v_found boolean := true; v_dist double precision := 0; v_you boolean := false;
        v_wild boolean := false; v_after boolean := false; v_on text;
        v_x double precision; v_y double precision;
begin
  select * into s from spell_any where id = p_spell;
  select * into me from player where world_id = p_world and uid = p_uid;
  if v_kind = 'player' then
    select * into pl from player where world_id = p_world and uid = v_uid and not away;
    v_found := found;
    if v_found then
      v_you := pl.uid = p_uid;
      v_dist := sqrt((pl.x - me.x) ^ 2 + (pl.y - me.y) ^ 2);
    end if;
  elsif v_kind = 'creature' then
    select * into c from creature where world_id = p_world and id = v_id and health > 0;
    v_found := found;
    if v_found then
      v_wild := c.mode = 'wild';
      v_after := c.hunting is not distinct from p_uid;
      v_dist := sqrt((creature_x(c) - me.x) ^ 2 + (creature_y(c) - me.y) ^ 2);
    end if;
  elsif v_kind = 'item' then
    v_found := exists (select 1 from item where world_id = p_world and id = v_id and holder = 'player' and holder_uid = p_uid);
  elsif v_kind = 'placed' then
    select * into pc from placed where world_id = p_world and id = v_id;
    v_found := found;
    if v_found then v_dist := sqrt((pc.x + 0.5 - me.x) ^ 2 + (pc.y + 0.5 - me.y) ^ 2); end if;
  elsif v_kind = 'area' then
    v_x := case when jsonb_typeof(p_target->'x') = 'number' then (p_target->>'x')::double precision else me.x end;
    v_y := case when jsonb_typeof(p_target->'y') = 'number' then (p_target->>'y')::double precision else me.y end;
    v_dist := sqrt((v_x - me.x) ^ 2 + (v_y - me.y) ^ 2);
  elsif v_kind <> 'self' then
    v_found := false;
  end if;
  if not v_found then return jsonb_build_object('why', 'That is not here.'); end if;

  v_on := case v_kind
    when 'self' then case when 'self' = any (s.on_what) then 'self' end
    when 'player' then case when v_you then case when 'self' = any (s.on_what) then 'self' end
                            when 'player' = any (s.on_what) then 'player' end
    when 'creature' then case when 'enemy' = any (s.on_what) and v_wild then 'enemy'
                              when 'wildermon' = any (s.on_what) and not v_after then 'wildermon' end
    when 'item' then case when 'object' = any (s.on_what) then 'object' end
    when 'placed' then case when 'object' = any (s.on_what) then 'object' end
    when 'area' then case when 'area' = any (s.on_what) then 'area' end
  end;
  if v_on is null then
    if v_kind = 'creature' and 'enemy' = any (s.on_what) and not v_wild then
      return jsonb_build_object('why', 'That is tame, not an enemy.');
    end if;
    if v_kind = 'creature' and 'wildermon' = any (s.on_what) and v_after then
      return jsonb_build_object('why', 'That is after you.');
    end if;
    return jsonb_build_object('why', s.name || ' is cast on ' || listed_or(array(
      select d.word from unnest(s.on_what) with ordinality k(id, n) join spell_on_def d on d.id = k.id order by k.n)) || '.');
  end if;
  if v_dist > spell_reach() then
    return jsonb_build_object('why', 'That is more than ' || spell_reach() || ' tiles away.');
  end if;

  return case v_on
    when 'self' then jsonb_build_object('kind', 'self', 'uid', p_uid)
    when 'player' then jsonb_build_object('kind', 'player', 'uid', pl.uid)
    when 'enemy' then jsonb_build_object('kind', 'enemy', 'id', c.id)
    when 'wildermon' then jsonb_build_object('kind', 'wildermon', 'id', c.id)
    when 'object' then case when v_kind = 'item' then jsonb_build_object('kind', 'object', 'item', v_id)
                            else jsonb_build_object('kind', 'object', 'placed', v_id) end
    else jsonb_build_object('kind', 'area', 'x', v_x, 'y', v_y, 'radius', coalesce(s.radius, 0))
  end;
end $function$;

CREATE OR REPLACE FUNCTION public.spell_cast_refusal(p_world uuid, p_uid uuid, p_spell text)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare s spell_any; p player; v_left double precision; v_favour double precision; v_stamina double precision;
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
    if p_spell = 'blade_shield_bash'
       and not exists (select 1 from shield_def sd where sd.id = (worn(p_world, p_uid, 'offhand')).def) then
      return s.name || ' wants a shield in your off hand.';
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
      || case when v_out ? 'put' then jsonb_build_object('put', v_out->'put') else '{}'::jsonb end;
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

CREATE OR REPLACE FUNCTION public.spell_slot_refusal(p_world uuid, p_uid uuid, p_slot integer, p_spell text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare v_want text; v_school text;
begin
  select school into v_want from spell_slot where slot = p_slot;
  if not found then return 'There is no such slot.'; end if;
  if p_spell is null then return null; end if;
  v_school := spell_school(p_spell);
  if v_school is null
     or not spell_known(p_world, p_uid, p_spell) then
    return 'You do not have that spell.';
  end if;
  if v_school <> v_want then return 'That slot is for ' || v_want || ' spells.'; end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.faith_said(p_world uuid, p_uid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
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
    'stamina', coalesce((p.stats->>'stamina')::double precision, 1),
    'spells', coalesce((select jsonb_object_agg(s.id, faith_spell_refusal(p_world, p_uid, s.id))
                          from faith_spell s where s.patron = p.patron), '{}'::jsonb),
    'bar', (select jsonb_agg(coalesce(p.spell_bar->s.slot, 'null'::jsonb) order by s.slot) from spell_slot s),
    'rest', coalesce((select jsonb_object_agg(s.id, spell_rest_left(p.used_at, s.id, s.rest))
                        from spell_any s where p.used_at ? ('spell:' || s.id)), '{}'::jsonb)
  );
end $function$;

CREATE OR REPLACE FUNCTION public.perk_refusal(p_world uuid, p_uid uuid, p_perk text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare k class_perk; c class_def; p player; v_other text; v_main double precision; v_at int;
begin
  select * into k from class_perk where id = p_perk;
  if not found then return 'There is no such perk.'; end if;
  select * into p from player where world_id = p_world and uid = p_uid;
  if not found then return 'You are not on this island.'; end if;
  select * into c from class_def where id = k.class;
  if (case when c.kind = 'craft' then p.craft_class else p.combat_class end) is distinct from k.class then
    return 'That is the ' || lower(c.name) || '’s, and you are not one.';
  end if;
  if exists (select 1 from player_node where world_id = p_world and uid = p_uid and node = p_perk) then
    return 'You have that already.';
  end if;
  select o.name into v_other from player_node pn join class_perk o on o.id = pn.node
   where pn.world_id = p_world and pn.uid = p_uid and o.class = k.class and o.tier = k.tier
   limit 1;
  if v_other is not null then return 'You took ' || v_other || ' at this tier.'; end if;
  -- A fighting trade's tiers open on its own level (`class_tier`), which rises as you fight in it.
  if c.kind = 'combat' then
    v_at := (select at from class_tier where tier = k.tier);
    if k.tier > 1 and p.class_level < v_at then
      return 'This tier opens at class level ' || v_at || '; you have ' || floor(p.class_level)::int || '.';
    end if;
    return null;
  end if;
  v_at := (select at from perk_tier where tier = k.tier);
  v_main := skill_of(p_world, p_uid, c.main);
  if k.tier > 1 and v_main < v_at then
    return 'This tier opens at ' || v_at || ' in ' || replace(c.main, '_', ' ')
        || '; you have ' || floor(v_main)::int || '.';
  end if;
  return null;
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
        -- A fighting trade's own level, which its tiers open on.
        'level', case when c.kind = 'combat' then p.class_level end,
        'points', class_points(p_world, me, c.id),
        'spent', class_spent(p_world, me, c.id),
        'nodes', (select jsonb_agg(jsonb_build_object(
            'id', n.id, 'col', n.col, 'rank', n.rank, 'name', n.name, 'note', n.note,
            'channel', n.channel, 'cost', n.cost, 'needs', n.needs, 'mul', n.mul,
            'taken', exists (select 1 from player_node pn
                              where pn.world_id = p_world and pn.uid = me and pn.node = n.id),
            'why', node_refusal(p_world, me, n.id)) order by n.col, n.rank)
          from class_node n where n.class = c.id)) ||
        -- A trade moved over to perks: its six tiers, each with its three.
        case when exists (select 1 from class_perk k where k.class = c.id) then jsonb_build_object('tiers', (
          select jsonb_agg(jsonb_build_object(
            'tier', t.tier, 'at', t.at,
            'open', t.tier = 1 or case when c.kind = 'combat' then p.class_level >= t.at else skill_of(p_world, me, c.main) >= t.at end,
            'perks', (select jsonb_agg(jsonb_build_object(
                'id', k.id, 'name', k.name, 'note', k.note,
                'taken', exists (select 1 from player_node pn
                                  where pn.world_id = p_world and pn.uid = me and pn.node = k.id),
                'why', perk_refusal(p_world, me, k.id)) order by k.num)
              from class_perk k where k.class = c.id and k.tier = t.tier)) order by t.tier)
            from (select pt.tier, pt.at from perk_tier pt where c.kind <> 'combat'
                  union all select ct.tier, ct.at from class_tier ct where c.kind = 'combat') t)) else '{}'::jsonb end order by c.kind)
      from class_def c where c.id in (p.craft_class, p.combat_class)), '[]'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION public.rpc_take_perk(p_world uuid, p_perk text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); k class_perk; v_why text; v_mul jsonb; v_slot int;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  select * into k from class_perk where id = p_perk;
  if not found then return jsonb_build_object('why', 'There is no such perk.'); end if;
  v_why := perk_refusal(p_world, me, p_perk);
  if v_why is not null then return jsonb_build_object('why', v_why); end if;
  insert into player_node (world_id, uid, node) values (p_world, me, p_perk)
    on conflict (world_id, uid, node) do nothing;
  v_mul := class_fold(p_world, me);
  -- A fighting trade's spell goes onto the bar, in the first of its slots with nothing in it, as a patron's does.
  if exists (select 1 from class_spell where id = p_perk) then
    select min(sl.slot) into v_slot from spell_slot sl, player p
     where p.world_id = p_world and p.uid = me and sl.school = 'class' and (p.spell_bar->>sl.slot) is null;
    if v_slot is not null then perform spell_bar_put(p_world, me, v_slot, p_perk); end if;
  end if;
  perform tell(p_world, me, k.name || '. ' || k.note, 'system');
  return jsonb_build_object('took', p_perk, 'mul', v_mul);
end $function$;

CREATE OR REPLACE FUNCTION public.spell_bar_clear_class(p_world uuid, p_uid uuid)
 RETURNS void
 LANGUAGE sql
AS $function$
  -- Every fighting trade's spell off the bar: the trade that taught it has been put down.
  update player p set spell_bar = (
    select jsonb_agg(case when exists (select 1 from class_spell cs where cs.id = p.spell_bar->>s.slot) then 'null'::jsonb
                          else coalesce(p.spell_bar->s.slot, 'null'::jsonb) end order by s.slot)
      from spell_slot s)
   where p.world_id = p_world and p.uid = p_uid
$function$;

CREATE OR REPLACE FUNCTION public.rpc_take_class(p_world uuid, p_class text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); p player; c class_def; v_had text; v_cost bigint := 0; v_why text;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  select * into p from player where world_id = p_world and uid = me;
  if not found then return jsonb_build_object('why', 'You are not on this island.'); end if;
  select * into c from class_def where id = p_class;
  if not found then return jsonb_build_object('why', 'There is no such trade.'); end if;

  v_why := class_refusal(p_world, me, p_class);
  if v_why is not null then return jsonb_build_object('why', v_why); end if;

  v_had := case when c.kind = 'craft' then p.craft_class else p.combat_class end;
  if v_had = p_class then
    return jsonb_build_object('why', 'You are already a ' || lower(c.name) || '.');
  end if;
  if v_had is not null then
    v_cost := class_change_cost()::bigint;
    if not take_coins(p_world, me, v_cost) then
      return jsonb_build_object('why', 'Putting a trade down and taking another up costs '
        || v_cost || ' silver. You have ' || purse(p_world, me) || '.');
    end if;
  end if;

  /*
   * And the tree goes with the trade.
   *
   * Nodes are drawn on the trade they belong to, so putting it down puts them
   * down with it -- which is also the only way a tree is ever cleared. That is
   * on purpose: it makes the five hundred silver the price of changing your
   * mind about the whole thing, and it means taking a node needs no undo of
   * its own. Only the trade being put down is cleared; the other slot keeps
   * what it had.
   */
  if v_had is not null then
    delete from player_node pn using class_node n
     where n.id = pn.node and pn.world_id = p_world and pn.uid = me and n.class = v_had;
    -- And its perks, which are rows in the same table.
    delete from player_node pn using class_perk k
     where k.id = pn.node and pn.world_id = p_world and pn.uid = me and k.class = v_had;
  end if;
  if c.kind = 'craft' then
    update player set craft_class = p_class, class_taken = now() where world_id = p_world and uid = me;
  else
    -- And its own level, from the start (`class_level_start`), and the old trade's spells off the bar.
    update player set combat_class = p_class, class_taken = now(), class_level = class_level_start()
      where world_id = p_world and uid = me;
    perform spell_bar_clear_class(p_world, me);
  end if;
  perform class_fold(p_world, me);

  perform tell(p_world, me, case when v_had is null
    then 'You take up the ' || lower(c.name) || '’s trade. ' || c.lever
    else 'You put the ' || lower((select name from class_def where id = v_had))
         || '’s trade down and take up the ' || lower(c.name) || '’s, for '
         || v_cost || ' silver. ' || c.lever end, 'system');
  return jsonb_build_object('took', p_class, 'kind', c.kind, 'paid', v_cost, 'was', v_had);
end $function$;

CREATE OR REPLACE FUNCTION public.rpc_regret_class(p_world uuid, p_kind text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); p player; v_had text;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  -- Held for the rest of this, so that two asked at once cannot both break the same bauble.
  select * into p from player where world_id = p_world and uid = me for update;
  if not found then return jsonb_build_object('why', 'You are not on this island.'); end if;
  if p_kind is null or p_kind not in ('craft', 'combat') then
    return jsonb_build_object('why', 'There is no such trade.');
  end if;
  v_had := case when p_kind = 'craft' then p.craft_class else p.combat_class end;
  if v_had is null then
    return jsonb_build_object('why', 'You have no ' || case when p_kind = 'craft' then 'crafting' else 'fighting' end
      || ' trade to undo.');
  end if;
  -- One carried anywhere, loose or in a bag, as `consume` takes it; one put by is not broken.
  if not consume(p_world, me, 'bauble_regret', 1) then
    if exists (select 1 from item i where i.world_id = p_world and i.holder = 'player' and i.holder_uid = me
                and i.def = 'bauble_regret') then
      return jsonb_build_object('why', 'Your Bauble of Regret is put by. Unlock it first.');
    end if;
    return jsonb_build_object('why', 'You need a Bauble of Regret to undo a trade.');
  end if;
  -- The tree goes with the trade, as it does when one is put down for another.
  delete from player_node pn using class_node n
   where n.id = pn.node and pn.world_id = p_world and pn.uid = me and n.class = v_had;
  -- And its perks, which are rows in the same table.
  delete from player_node pn using class_perk k
   where k.id = pn.node and pn.world_id = p_world and pn.uid = me and k.class = v_had;
  if p_kind = 'craft' then
    update player set craft_class = null where world_id = p_world and uid = me;
  else
    update player set combat_class = null, class_level = 0 where world_id = p_world and uid = me;
    perform spell_bar_clear_class(p_world, me);
  end if;
  perform class_fold(p_world, me);
  perform tell(p_world, me, 'The Bauble of Regret breaks, and the '
    || lower((select c.name from class_def c where c.id = v_had))
    || '’s trade is put down as though you had never taken it up, its '
    || case when exists (select 1 from class_perk k where k.class = v_had) then 'perks' else 'tree' end
    || ' with it. '
    || 'The next ' || case when p_kind = 'craft' then 'crafting' else 'fighting' end
    || ' trade you take up costs nothing, not ' || class_change_cost()::bigint || ' silver.', 'system');
  return jsonb_build_object('undone', v_had, 'kind', p_kind);
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
      -- And now and then a critical one (`crit_chance`).
      v_crit := random() < crit_chance(skill_of(p_world, p_uid, w.kind), w.id, w.kind);
      dmg := weapon_damage(p_world, p_uid, w, held) * bane * my_stance_dealt(p_world, p_uid, p.fight_stance)
             * hide_takes(d.hide, blow_of(w.id, w.kind)) * blindside_of(c, p_uid) * (0.75 + random() * 0.5)
             * case when v_crit then crit_hit() else 1 end * faith_arms(p_world, p_uid, d);
      died := hurt_creature(p_world, c.id, dmg, p_uid);
      -- And it teaches the fighting trade you hold (`class_learn`), a kill more.
      perform class_learn(p_world, p_uid, class_learn_blow() + case when died then class_learn_kill() else 0 end);
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
    -- The far end of a bow's range is a far harder shot than the near end.
    v_landed := random() <= hit_chance(p_world, p_uid, 'archery', mark_of(held.mark, 'aim'))
                            * (1 - (dist / (coalesce(bow.range, 6) * mark_of(held.mark, 'range'))) * 0.35) * beast_mul(c, 'evade');
    perform skill_raise(p_world, p_uid, 'fighting', try_gain(v_landed, shot_fight()));
    perform skill_raise(p_world, p_uid, 'archery', try_gain(v_landed, shot_archery()));
    -- Picking a target out of the dark at range is the hardest looking there is.
    perform fought_in_dark(p_world, p_uid, dark_shot());
    if not v_landed then
      perform tell(p_world, p_uid, 'Your arrow goes wide of the ' || lower(d.name) || '.', 'fight');
    else
      -- The stave throws it; the head is what goes in. Both have a say.
      bane := case when mat_bane(arrow.extra) and d.glow is not null then bane_bonus() else 1 end;
      v_crit := random() < crit_chance(skill_of(p_world, p_uid, 'archery'), bow.id, bow.kind);
      -- And what the head is: a blunt crushes, a bodkin goes through a hide (`headBlow`, `headHide`).
      dmg := weapon_damage(p_world, p_uid, bow, held) * mat_edge(arrow.extra) * bane * my_stance_dealt(p_world, p_uid, p.fight_stance)
             * hide_takes(d.hide, case when v_head = 'blunt' then 'crush' else blow_of(bow.id, bow.kind) end)
             * case when v_head = 'bodkin' and d.hide is not null then bodkin_hide() else 1 end
             * blindside_of(c, p_uid)
             * (0.6 + arrow.ql / 140) * (0.8 + random() * 0.4)
             * case when v_crit then crit_hit() else 1 end * faith_arms(p_world, p_uid, d);
      died := hurt_creature(p_world, c.id, dmg, p_uid);
      -- And it teaches the fighting trade you hold (`class_learn`), a kill more.
      perform class_learn(p_world, p_uid, class_learn_blow() + case when died then class_learn_kill() else 0 end);
      perform faith_feast(p_world, p_uid, dmg);
      perform damage_item(held.id, 0.25 * pk(p_world, p_uid, 'worn:weapon', 1));
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

CREATE OR REPLACE FUNCTION public.act_wind(p_world uuid, p_uid uuid, p_action text, p_cost double precision)
 RETURNS double precision
 LANGUAGE plpgsql
 STABLE
AS $function$
declare v_kg double precision; v_kind text; v_free boolean;
begin
  if not is_fight(p_action) then return p_cost; end if;
  -- Nothing at all while a Sworn Blade's Measured Breathing holds.
  select (pl.blessings->'breathing'->>'until')::timestamptz > now() into v_free
    from player pl where pl.world_id = p_world and pl.uid = p_uid;
  if coalesce(v_free, false) then return 0; end if;
  select idf.weight, w.kind into v_kg, v_kind
    from weapon_def w join item_def idf on idf.id = w.id
    where w.id = (worn(p_world, p_uid, 'weapon')).def
      and (w.ammo is null) = (p_action = 'attack_creature');
  -- And less for a sword in a Sworn Blade's hand (Light Sword), as `fightWind` has it.
  return (swing_wind() + swing_wind_kg() * coalesce(v_kg, 0))
    * case when p_action = 'attack_creature' and v_kind = 'swords' then pk(p_world, p_uid, 'wind:swords', 1) else 1 end;
end $function$;

CREATE OR REPLACE FUNCTION public.act_base(p_world uuid, p_uid uuid, p_action text, p_base double precision)
 RETURNS double precision
 LANGUAGE plpgsql
 STABLE
AS $function$
declare v_wind double precision; v_swing double precision;
begin
  if not is_fight(p_action) then return p_base; end if;
  select coalesce((pl.stats->>'stamina')::double precision, 1) into v_wind
    from player pl where pl.world_id = p_world and pl.uid = p_uid;
  if p_action = 'attack_creature' then
    v_swing := (swung_with(p_world, p_uid)).swing;
  else
    select w.swing into v_swing from weapon_def w
      where w.id = (worn(p_world, p_uid, 'weapon')).def and w.ammo is not null;
  end if;
  -- Tired arms, and wounded ones (`arm_pace`).
  return coalesce(v_swing, p_base) * tired_pace(coalesce(v_wind, 1))
    -- Not while a Sworn Blade's Hold the Line holds.
    * (select case when (pl.blessings->'hold_line'->>'until')::timestamptz > now() then 1 else arm_pace(pl.wounds) end
         from player pl where pl.world_id = p_world and pl.uid = p_uid);
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
           then 1 - (p.blessings->'last_stand'->>'cut')::double precision else 1 end;
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
    -- A bruise does not bleed; everything else does until it is seen to.
    w := jsonb_build_object('kind', p_kind, 'part', part, 'severity', taken * pk(p.class_mul, 'severity:wound', 1),
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

CREATE OR REPLACE FUNCTION public.wounds_settle(p_world uuid, p_uid uuid)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
declare p player; elapsed double precision; aid double precision; w jsonb;
        out_w jsonb := '[]'::jsonb; health double precision; drained double precision := 0;
        sev double precision; turned boolean := false; kept int := 0; v_bleed double precision := 1; v_held double precision := 0;
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
  -- A Sworn Blade's Hold the Line: what bleeds through the stretch of this it held is cut to its share.
  if p.blessings ? 'hold_line' then
    v_bleed := coalesce((p.blessings->'hold_line'->>'bleed')::double precision, 1);
    v_held := greatest(0, extract(epoch from (least(now(), (p.blessings->'hold_line'->>'until')::timestamptz)
      - greatest(now() - make_interval(secs => elapsed), (p.blessings->'hold_line'->>'from')::timestamptz))));
  end if;

  for w in select * from jsonb_array_elements(p.wounds) loop
    drained := drained + wound_drain(w) * (elapsed - v_held * (1 - v_bleed));
    -- Venom, for what is left of it, unless the wound is dressed (`venom_drain`).
    if coalesce((w->>'venom')::double precision, 0) > 0 then
      if w->>'dressing' is null then
        drained := drained + venom_drain() * least(elapsed, (w->>'venom')::double precision);
      end if;
      w := jsonb_set(w, '{venom}', to_jsonb(greatest(0, (w->>'venom')::double precision - elapsed)));
    end if;
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

CREATE OR REPLACE FUNCTION public.hunt_settle(p_world uuid, c creature, d species_def, a age_def)
 RETURNS creature
 LANGUAGE plpgsql
AS $function$
declare p record; v_dist double precision; v_pace double precision; v_guard int := 0;
        v_cx double precision; v_cy double precision; v_secs double precision;
        v_ax double precision; v_ay double precision; v_step record;
        m creature; l creature; v_n int := 0; v_k int := 0; v_slot double precision; v_own double precision;
        v_turn double precision; v_b double precision; v_run double precision; v_nerve boolean := false;
begin
  v_cx := creature_x(c); v_cy := creature_y(c);
  -- A Radiance burns what is hunting somebody inside it (`faith_radiance`).
  if c.hunting is not null then c := faith_radiance(p_world, c, v_cx, v_cy); end if;
  /*
   * One of a pack that is not after anybody hears another of its kind within
   * `pack_call` that is, and comes for the same one (`packmateOn`).
   */
  if c.hunting is null and d.hunter and d.pack and (c.hunt_again is null or c.hunt_again <= now()) then
    select mm.* into m from creature mm
      where mm.world_id = p_world and mm.hunting is not null and mm.species = c.species
        and mm.id <> c.id and mm.mode = 'wild'
        and (creature_x(mm) - v_cx) ^ 2 + (creature_y(mm) - v_cy) ^ 2 <= pack_call() ^ 2
      order by (creature_x(mm) - v_cx) ^ 2 + (creature_y(mm) - v_cy) ^ 2, mm.id
      limit 1;
  end if;
  /*
   * Whoever it is already after, if anybody: a beast you struck stays on you
   * (`engage_beast`) rather than on whoever happens to be nearer. Then whoever
   * its pack is after, and otherwise the nearest, for a hunter to notice.
   */
  if c.hunting is not null then
    select pl.uid, pl.x, pl.y, sqrt((pl.x - v_cx) ^ 2 + (pl.y - v_cy) ^ 2) as d into p
      from player pl where pl.world_id = p_world and pl.uid = c.hunting;
  elsif m.id is not null then
    select pl.uid, pl.x, pl.y, sqrt((pl.x - v_cx) ^ 2 + (pl.y - v_cy) ^ 2) as d into p
      from player pl where pl.world_id = p_world and pl.uid = m.hunting;
  else
    select * into p from nearest_player(p_world, v_cx, v_cy);
  end if;
  if not found then c.hunting := null; return c; end if;

  if c.hunting is not null then
    /*
     * How far it has come from where it started, which is the one measure that
     * grows while it chases.
     *
     * Reported as being chased until you are dead, and that is exactly what
     * happened: every give-up here was about the gap between hunter and
     * hunted, and a hunter runs at `speed * 1.15` — so the gap it was measured
     * against was a gap it was closing. Outrunning one was the only way to
     * lose it, and most things on this island are faster than a body carrying
     * a pack.
     *
     * So the leash is tied where the chase began. It gives up at the end of it
     * and then wants nothing to do with hunting for `hunt_rest`, because
     * otherwise it drops you at thirty tiles, notices you again on the next
     * breath because you are still well inside its sight, and measures a fresh
     * leash from there — which is the same endless chase with a stutter in it.
     */
    /*
     * And how far it is from its own home ground, which is what stops a
     * hunter that had already strayed from taking you another thirty tiles
     * beyond where it strayed to. Both are asked; the first to run out ends
     * it.
     */
    if sqrt((v_cx - coalesce(c.hunt_x, v_cx)) ^ 2 + (v_cy - coalesce(c.hunt_y, v_cy)) ^ 2)
         > (case when d.hunter then hunt_leash() else fight_leash() end)
       or sqrt((v_cx - coalesce(c.home_x, v_cx)) ^ 2 + (v_cy - coalesce(c.home_y, v_cy)) ^ 2)
         > hunt_home() then
      c.hunting := null;
      c.windup_at := null;
      c.hunt_again := now() + make_interval(secs => hunt_rest());
      -- And back to its own country, rather than standing wherever it
      -- happened to stop. A hunter that gave up ten valleys from home and
      -- stayed there is how a range stops meaning anything.
      if c.home_x is not null then
        c.from_x := v_cx; c.from_y := v_cy;
        c.to_x := c.home_x; c.to_y := c.home_y;
        c.leg_at := now();
        c.leg_ends := now() + make_interval(secs => greatest(1,
          sqrt((v_cx - c.home_x) ^ 2 + (v_cy - c.home_y) ^ 2)
            / greatest(0.1, d.speed * a.speed * beast_mul(c, 'speed') * 0.7)));
        c.until := c.leg_ends;
      end if;
      return c;
    end if;
    -- Far enough off, or on the beach: let go.
    if p.d > (case when not d.hunter then fight_give_up() when d.monster then hunt_give_up() * 2.2 else hunt_give_up() end)
       or at_peace(p_world, p.x, p.y) or p.d > faith_shroud(p_world, p.uid) then
      c.hunting := null;
      c.windup_at := null;
      return c;
    end if;
    /*
     * Its nerve (`nerveGoes`): a hunter hurt below what its kind stands, one
     * whose pack's leader is dead or has run, or a coward below `coward_drag`
     * with another of its kind within `pack_call` already run. Anything else
     * fights a fight it did not go looking for to the end.
     */
    if d.hunter then
      if c.health < max_health(c) * turns_at(d) then v_nerve := true; end if;
      if not v_nerve and c.pack_lead is not null and c.pack_lead <> c.id then
        select * into l from creature where world_id = p_world and id = c.pack_lead;
        if l.id is null or l.mode <> 'wild' or l.health <= 0 or l.hunt_again > now() then v_nerve := true; end if;
      end if;
      if not v_nerve and d.coward and c.health < max_health(c) * coward_drag() then
        v_nerve := exists (select 1 from creature o
          where o.world_id = p_world and o.species = c.species and o.id <> c.id and o.mode = 'wild'
            and o.hunt_again > now()
            and o.to_x between v_cx - (pack_call() + leg_slack()) and v_cx + (pack_call() + leg_slack())
            and o.to_y between v_cy - (pack_call() + leg_slack()) and v_cy + (pack_call() + leg_slack())
            and (creature_x(o) - v_cx) ^ 2 + (creature_y(o) - v_cy) ^ 2 <= pack_call() ^ 2);
      end if;
    end if;
    if v_nerve then
      -- It turns tail (`turnTail`): away from you, and no interest in you for a while.
      c.hunting := null;
      c.windup_at := null;
      c.hunt_again := now() + make_interval(secs => hunt_rest());
      v_run := d.speed * flee_pace() * flee_secs();
      select * into v_step from chase_leg(p_world, v_cx, v_cy,
        v_cx + (v_cx - p.x) / greatest(0.001, p.d) * v_run, v_cy + (v_cy - p.y) / greatest(0.001, p.d) * v_run);
      c.from_x := v_cx; c.from_y := v_cy;
      c.to_x := coalesce(v_step.x, v_cx); c.to_y := coalesce(v_step.y, v_cy);
      c.leg_at := now();
      c.leg_ends := now() + make_interval(secs => greatest(0.2, sqrt((c.to_x - v_cx) ^ 2 + (c.to_y - v_cy) ^ 2)
                                                 / greatest(0.1, d.speed * a.speed * beast_mul(c, 'speed') * flee_pace())));
      c.until := greatest(c.leg_ends, now() + make_interval(secs => flee_secs()));
      perform tell(p_world, p.uid, 'The ' || lower(d.name) || ' turns tail.', 'fight');
      return c;
    end if;
    c.hunting := p.uid;
  else
    -- Only a hunter goes looking for a fight.
    if not d.hunter then return c; end if;
    -- Nothing comes for you across ground it cannot stand on, and nothing
    -- comes for you at all while you are still standing on the beach.
    if at_peace(p_world, p.x, p.y) then return c; end if;
    if c.hunt_again is not null and c.hunt_again > now() then return c; end if;
    -- One of its pack already on you brings it from wherever it can hear; anything else has to notice you.
    if m.id is null and p.d > least(coalesce(d.notice, hunt_sight()), faith_shroud(p_world, p.uid)) then return c; end if;
    if not creature_tile_ok(p_world, floor(p.x)::int, floor(p.y)::int) then return c; end if;
    c.hunting := p.uid;
    -- Where the leash is tied, and a fresh count of blows.
    c.hunt_x := v_cx; c.hunt_y := v_cy;
    c.fight_blows := 0; c.windup_at := null;
    -- The first of a pack leads it; the rest follow whoever the one they heard follows.
    c.pack_lead := case when not d.pack then null when m.id is not null then coalesce(m.pack_lead, m.id) else c.id end;
    perform tell(p_world, p.uid, case when m.id is not null then 'Another ' || lower(d.name) || ' comes with it.'
                                      else 'A ' || lower(d.name) || ' has your scent.' end, 'fight');
  end if;

  -- Only the last few seconds of the gap were spent on you.
  if c.until < now() - make_interval(secs => hunt_window()) then
    c.from_x := v_cx; c.from_y := v_cy; c.to_x := v_cx; c.to_y := v_cy;
    c.until := now() - make_interval(secs => hunt_window());
    c.leg_at := c.until; c.leg_ends := c.until;
  end if;

  v_pace := d.speed * a.speed * beast_mul(c, 'speed') * 1.15;
  /*
   * Its own side of you, when it hunts with a pack (`packWay`): the leader's is
   * where the leader is, and the rest share the circle out evenly from there,
   * in the order they came into the world.
   */
  if c.pack_lead is not null then
    select count(*), count(*) filter (where mm.id < c.id and mm.id <> c.pack_lead) into v_n, v_k
      from creature mm
      where mm.world_id = p_world and mm.hunting = p.uid and mm.pack_lead = c.pack_lead
        and mm.mode = 'wild' and mm.id <> c.id;
    v_n := v_n + 1;
    v_k := case when c.id = c.pack_lead then 0 else v_k + 1 end;
    if v_n >= 2 then
      select * into l from creature where world_id = p_world and id = c.pack_lead;
      v_slot := case when l.id is null then atan2(v_cy - p.y, v_cx - p.x)
                     else atan2(creature_y(l) - p.y, creature_x(l) - p.x) end + 2 * pi() * v_k / v_n;
    end if;
  end if;
  while c.until <= now() and v_guard < 12 loop
    v_guard := v_guard + 1;
    v_dist := sqrt((p.x - c.to_x) ^ 2 + (p.y - c.to_y) ^ 2);
    /*
     * A heavy blow drawn back for (`windup_at`): it stood where it was for
     * `wind_up`, and lands on whatever is still in its reach.
     */
    if c.windup_at is not null then
      c.windup_at := null;
      c.fight_blows := c.fight_blows + 1;
      if v_dist <= hunt_reach() then
        perform mark_attacker(p_world, p.uid, c.id);
        perform hurt_player(p_world, p.uid, attack_of(c) * 0.012 * heavy_hit(),
          'The ' || lower(d.name) || '''s heavy blow lands', coalesce(d.wound, 'bite'));
      else
        perform tell(p_world, p.uid, 'The ' || lower(d.name) || '''s heavy blow falls short.', 'fight');
      end if;
      c.until := c.until + make_interval(secs => blow_every(d) / beast_mul(c, 'haste')) + class_stagger_owed(p_world, c.id);
      continue;
    end if;
    /*
     * A thrower (`throwStep`): backs away from you inside `keep_off -
     * back_slack`, and with nowhere to back to fights hand to hand below;
     * within `throw_reach` it stands and throws; further, it closes to
     * `keep_off`, round to its own side of you when it runs with a pack.
     */
    if d.throws then
      if v_dist < keep_off() - back_slack() then
        select * into v_step from chase_leg(p_world, c.to_x, c.to_y,
          c.to_x + (c.to_x - p.x) / greatest(0.001, v_dist) * 2, c.to_y + (c.to_y - p.y) / greatest(0.001, v_dist) * 2);
        if v_step.x is not null and (v_step.x - c.to_x) ^ 2 + (v_step.y - c.to_y) ^ 2 > 0.01 then
          c.from_x := c.to_x; c.from_y := c.to_y;
          c.to_x := v_step.x; c.to_y := v_step.y;
          c.leg_at := c.until;
          c.leg_ends := c.leg_at + make_interval(secs => greatest(0.2, sqrt((c.to_x - c.from_x) ^ 2 + (c.to_y - c.from_y) ^ 2)
                                                         / greatest(0.1, d.speed * a.speed * beast_mul(c, 'speed') * back_pace())));
          c.until := c.leg_ends;
          continue;
        end if;
      elsif v_dist <= throw_reach() then
        c.fight_blows := c.fight_blows + 1;
        perform mark_attacker(p_world, p.uid, c.id);
        perform hurt_player(p_world, p.uid, attack_of(c) * 0.012 * throw_hit(),
          'The ' || lower(d.name) || '''s stone finds you', 'crush');
        c.until := c.until + make_interval(secs => blow_every(d) / beast_mul(c, 'haste')) + class_stagger_owed(p_world, c.id);
        continue;
      else
        v_ax := null;
        if v_slot is not null then
          v_own := atan2(c.to_y - p.y, c.to_x - p.x);
          v_turn := turn_to(v_own, v_slot);
          if abs(v_turn) > circle_arc() then
            v_b := v_own + sign(v_turn) * least(abs(v_turn), circle_arc());
            v_ax := p.x + cos(v_b) * keep_off(); v_ay := p.y + sin(v_b) * keep_off();
          end if;
        end if;
        if v_ax is null then
          v_ax := p.x + (c.to_x - p.x) / v_dist * keep_off(); v_ay := p.y + (c.to_y - p.y) / v_dist * keep_off();
        end if;
        select * into v_step from chase_leg(p_world, c.to_x, c.to_y, v_ax, v_ay);
        if v_step.x is null then
          c.hunting := null;
          exit;
        end if;
        c.from_x := c.to_x; c.from_y := c.to_y;
        c.to_x := v_step.x; c.to_y := v_step.y;
        c.leg_at := c.until;
        c.leg_ends := c.leg_at + make_interval(secs => greatest(0.2, sqrt((c.to_x - c.from_x) ^ 2 + (c.to_y - c.from_y) ^ 2)
                                                       / greatest(0.1, v_pace)));
        c.until := c.leg_ends;
        continue;
      end if;
    end if;
    if v_dist > hunt_reach() then
      -- Round to its own side of you first, when it runs with a pack and is not on it yet (`circlePoint`).
      v_ax := null;
      if v_slot is not null then
        v_own := atan2(c.to_y - p.y, c.to_x - p.x);
        v_turn := turn_to(v_own, v_slot);
        if abs(v_turn) > circle_arc() then
          v_b := v_own + sign(v_turn) * least(abs(v_turn), circle_arc());
          v_ax := p.x + cos(v_b) * circle_r(); v_ay := p.y + sin(v_b) * circle_r();
        end if;
      end if;
      -- Otherwise a leg that ends a pace short of your feet, round whatever is between.
      if v_ax is null then
        v_ax := c.to_x + (p.x - c.to_x) * (v_dist - 1) / v_dist;
        v_ay := c.to_y + (p.y - c.to_y) * (v_dist - 1) / v_dist;
      end if;
      select * into v_step from chase_leg(p_world, c.to_x, c.to_y, v_ax, v_ay);
      if v_step.x is null then
        c.hunting := null;
        exit;
      end if;
      c.from_x := c.to_x; c.from_y := c.to_y;
      c.to_x := v_step.x; c.to_y := v_step.y;
      v_secs := greatest(0.2, sqrt((c.to_x - c.from_x) ^ 2 + (c.to_y - c.from_y) ^ 2)
                              / greatest(0.1, v_pace));
      c.leg_at := c.until;
      c.leg_ends := c.leg_at + make_interval(secs => v_secs);
      c.until := c.leg_ends;
    elsif d.heavy and (c.fight_blows + 1) % heavy_every()::int = 0 then
      -- Every `heavy_every`th blow of a kind that hits heavy is drawn back for first.
      c.windup_at := c.until + make_interval(secs => wind_up());
      c.until := c.windup_at;
      perform tell(p_world, p.uid, 'The ' || lower(d.name) || ' draws back for a heavy blow. Step out of its reach.', 'fight');
    else
      c.fight_blows := c.fight_blows + 1;
      perform mark_attacker(p_world, p.uid, c.id);
      perform hurt_player(p_world, p.uid, attack_of(c) * 0.012,
        'The ' || lower(d.name) || ' is on you', coalesce(d.wound, 'bite'));
      c.until := c.until + make_interval(secs => blow_every(d) / beast_mul(c, 'haste')) + class_stagger_owed(p_world, c.id);
    end if;
  end loop;
  return c;
end $function$;

CREATE OR REPLACE FUNCTION public.creature_attack(p_world uuid, p_attacker integer, p_target integer)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
declare a creature; d species_def; v_dmg double precision; t creature; v_guard uuid;
begin
  select * into a from creature where world_id = p_world and id = p_attacker;
  if not found then return false; end if;
  -- A Sworn Blade's Guardian near a companion a wild thing strikes may take the blow on a shield instead.
  if a.mode = 'wild' then
    select * into t from creature where world_id = p_world and id = p_target;
    if t.id is not null and t.mode <> 'wild' then
      v_guard := class_guardian(p_world, creature_x(t), creature_y(t), null);
      if v_guard is not null then
        perform class_guard_take(p_world, v_guard, attack_of(a) * blow_share(),
          coalesce((select lower(name) from species_def where id = a.species), 'creature'), coalesce(t.name, 'a companion'));
        return false;
      end if;
    end if;
  end if;
  select * into d from species_def where id = a.species;
  -- Its blood has a say in what it lands for, as it does in what it bites you for.
  v_dmg := attack_of(a) * (1 + coalesce((a.skills->>'fighting')::double precision, 0) / 200)
           * (0.7 + random() * 0.6);
  if a.skills ? 'fighting' then perform worker_learn(p_world, p_attacker, 'fighting', 0.05); end if;
  return wound_beast(p_world, p_target, v_dmg, creature_x(a), creature_y(a), null, p_attacker);
end $function$;

CREATE OR REPLACE FUNCTION public.engage_beast(p_world uuid, p_id integer, p_uid uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare c creature; v_timid boolean; v_pack boolean; cx double precision; cy double precision; v_name text; v_held boolean;
begin
  select * into c from creature where world_id = p_world and id = p_id for update;
  if not found or c.mode <> 'wild' or c.health <= 0 then return; end if;
  select sd.timid, sd.pack, lower(sd.name) into v_timid, v_pack, v_name from species_def sd where sd.id = c.species;
  if coalesce(v_timid, false) then return; end if;
  /*
   * Threat: it goes for whatever hurt it last, once what it is on has not
   * hurt it for `threat_hold` seconds. On something else that has, it stays on
   * that, and comes for you after.
   */
  v_held := c.threat_at > now() - make_interval(secs => threat_hold());
  if c.brawl is not null then
    if coalesce(v_held, false) then
      if c.hunting is null then
        update creature set hunting = p_uid, hunt_x = creature_x(c), hunt_y = creature_y(c), hunt_again = null
          where world_id = p_world and id = p_id;
      end if;
      return;
    end if;
    perform tell(p_world, p_uid, 'The ' || v_name || ' turns back on you.', 'fight');
  elsif c.hunting is not distinct from p_uid then
    -- Never sooner than a Sworn Blade's Challenge or a Summons held it on you (`threat_at` ahead of now).
    update creature set threat_at = greatest(threat_at, now()) where world_id = p_world and id = p_id;
    return;
  elsif c.hunting is not null and coalesce(v_held, false) then
    return;
  end if;
  cx := creature_x(c); cy := creature_y(c);
  update creature set hunting = p_uid, hunt_x = cx, hunt_y = cy, hunt_again = null, fight_blows = 0, windup_at = null,
      brawl = null, threat_at = now(),
      pack_lead = case when coalesce(v_pack, false) then p_id end,
      from_x = cx, from_y = cy, to_x = cx, to_y = cy, leg_at = now(), leg_ends = now(),
      until = least(until, now())
    where world_id = p_world and id = p_id;
end $function$;

select private.lock_doors();
