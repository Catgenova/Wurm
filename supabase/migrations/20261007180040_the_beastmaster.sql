/*
 * The Beastmaster: two spells and a passive at each of six tiers, opening on
 * the trade's own level, as the other fighting trades' do (`talents.ts`).
 *
 * Picked: spells 1 2 8 13 15 18 27 28 32 41 48 50 and passives 1 2 6 8 19 20
 * of the fifty and thirty offered, and set in the tiers in order of what they
 * are worth. The rows came with the definitions just before this. Here: the
 * companion following you (`class_companion`), a blow it strikes when told
 * (`class_beast_blow`), what makes its blows larger and quicker while a spell
 * holds (`companion_dealt`, `companion_quick`), a trade that learns from its
 * blows (`class_learn_beast`), a share of a blow moved between you and it
 * (`class_bond_take`, `class_bond_give`, `class_beast_take`), a creature it
 * answers for you (`class_vengeance`), and the passives where their rules
 * are.
 */
set local lock_timeout = '3s';

/* The Beastmaster's old tree went with the move to perks: its bought nodes go too, and its holders are folded afresh. */
delete from player_node pn
 where pn.node like 'beastmaster\_%' and not exists (select 1 from class_perk k where k.id = pn.node)
   and not exists (select 1 from class_node n where n.id = pn.node);
do $$ declare r record; begin
  for r in select world_id, uid from player where combat_class = 'beastmaster' loop perform class_fold(r.world_id, r.uid); end loop;
end $$;

/*
 * The creature following you that can be told anything: kept by you and at
 * heel, not in a crate, on a deed, in the traces or under a rider, and alive.
 * Not settled here: a blow at you asks this from inside a creature's turn.
 */
create or replace function class_companion(p_world uuid, p_uid uuid)
  returns creature language sql stable as $$
  select cr.* from creature cr
   where cr.world_id = p_world and cr.keeper = p_uid and cr.mode = 'active' and cr.health > 0
     and cr.hitched_to is null and cr.rider is null
   order by cr.id limit 1
$$;

/* What a Bloodlust and a Primal Fury on its keeper make of a companion's blows while they hold; one for anything else. */
create or replace function companion_dealt(c creature)
  returns double precision language sql stable as $$
  select case when c.mode <> 'active' or c.keeper is null then 1 else coalesce((
    select case when (pl.blessings->'bloodlust'->>'until')::timestamptz > now()
                then (pl.blessings->'bloodlust'->>'more')::double precision else 1 end
         * case when (pl.blessings->'primal_fury'->>'until')::timestamptz > now()
                then (pl.blessings->'primal_fury'->>'more')::double precision else 1 end
      from player pl where pl.world_id = c.world_id and pl.uid = c.keeper), 1) end
$$;

/* And how much more often it strikes inside a Primal Fury. */
create or replace function companion_quick(c creature)
  returns double precision language sql stable as $$
  select case when c.mode <> 'active' or c.keeper is null then 1 else coalesce((
    select case when (pl.blessings->'primal_fury'->>'until')::timestamptz > now()
                then (pl.blessings->'primal_fury'->>'quick')::double precision else 1 end
      from player pl where pl.world_id = c.world_id and pl.uid = c.keeper), 1) end
$$;

/*
 * A blow its companion lands teaches a Beastmaster's trade as a blow of
 * their own does (`class_learn_blow`), and more for a kill. Nobody else's:
 * a Sworn Blade's dog does not make a better swordsman.
 */
create or replace function class_learn_beast(p_world uuid, a creature, p_died boolean)
  returns void language plpgsql as $$
begin
  if a.mode = 'active' and a.keeper is not null
     and exists (select 1 from player pl where pl.world_id = p_world and pl.uid = a.keeper and pl.combat_class = 'beastmaster') then
    perform class_learn(p_world, a.keeper, class_learn_blow() + case when p_died then class_learn_kill() else 0 end);
  end if;
end $$;

/*
 * A blow a companion strikes on a spell: its own blow (`creature_attack`) at
 * the share the spell names, landed as any of its blows lands. What it did,
 * as `class_blow` says it for a blow of yours.
 */
create or replace function class_beast_blow(p_world uuid, p_comp integer, p_target integer, p_more double precision)
  returns jsonb language plpgsql as $$
declare a creature; t creature; d species_def; v_dmg double precision; v_died boolean; v_before double precision; v_left double precision;
begin
  perform creature_settle(p_world, p_target);
  select * into a from creature where world_id = p_world and id = p_comp;
  select * into t from creature where world_id = p_world and id = p_target;
  if a.id is null or t.id is null or t.health <= 0 then
    return jsonb_build_object('landed', false, 'died', false, 'dmg', 0, 'name', 'creature');
  end if;
  select * into d from species_def where id = t.species;
  v_before := t.health;
  v_dmg := attack_of(a) * (1 + coalesce((a.skills->>'fighting')::double precision, 0) / 200) * (0.7 + random() * 0.6)
         * companion_dealt(a) * p_more;
  if a.skills ? 'fighting' then perform worker_learn(p_world, p_comp, 'fighting', 0.05); end if;
  v_died := wound_beast(p_world, p_target, v_dmg, creature_x(a), creature_y(a), null, p_comp);
  v_left := case when v_died then 0 else coalesce((select health from creature where world_id = p_world and id = p_target), 0) end;
  perform class_learn_beast(p_world, a, v_died);
  return jsonb_build_object('landed', v_died or v_left < v_before, 'died', v_died, 'dmg', v_dmg,
    'left', greatest(0, ceil(v_left)), 'of', max_health(t), 'name', lower(d.name));
end $$;

/* What a companion's blow on a spell did, in a sentence, as `class_blow_said` says one of yours. */
create or replace function class_beast_said(p_spell text, p_name text, b jsonb)
  returns text language sql immutable as $$
  select p_spell || ': ' || p_name || ' strikes the ' || coalesce(b->>'name', 'creature')
      || case when (b->>'died')::boolean then ', and it dies.'
              when not coalesce((b->>'landed')::boolean, false) then ', and it does not tell.'
              else '. It is down to ' || (b->>'left') || ' of ' || (b->>'of') || '.' end
$$;

/*
 * A share of a blow put on a companion straight off its health, as an Oath
 * puts one on a friend (`faith_oath`): not as a blow, so nothing is settled
 * from inside the turn of whatever struck. One that has nothing left is put
 * down as a blow puts it down (`wound_beast`). Whether it died.
 */
create or replace function class_beast_take(p_world uuid, p_id integer, p_pts double precision, p_by integer)
  returns boolean language plpgsql as $$
declare c creature; v_name text; cx double precision; cy double precision;
begin
  if p_pts <= 0 then return false; end if;
  update creature set health = health - p_pts, hurt_at = now(), hurt_by = coalesce(p_by, hurt_by)
   where world_id = p_world and id = p_id and health > 0
   returning * into c;
  if c.id is null or c.health > 0 then return false; end if;
  select name into v_name from species_def where id = c.species;
  cx := creature_x(c); cy := creature_y(c);
  delete from creature where world_id = p_world and id = p_id;
  update creature set enemy = null where world_id = p_world and enemy = p_id;
  perform drop_on_ground(p_world, floor(cx)::int, floor(cy)::int, 'corpse',
    (15 + random() * 35) * (age_row(c.born, old_of(c))).yield, v_name);
  if c.keeper is not null then perform tell(p_world, c.keeper, c.name || ' dies of the wounds it took for you.', 'fight'); end if;
  return true;
end $$;

/*
 * What of a blow that landed on you comes off your health, once your
 * companion has taken its share: half inside a Feral Bond, wherever it is;
 * a Shared Wounds' share while it is within that perk's reach of you; the
 * larger of the two. Its share is in its own health at what a creature's blow
 * is to yours (`blow_share`), and it takes it as any blow is taken (`soak`).
 */
create or replace function class_bond_take(p_world uuid, p_uid uuid, p_taken double precision, p_by integer)
  returns double precision language plpgsql as $$
declare pl player; k creature; v_share double precision := 0;
begin
  if p_taken <= 0 then return p_taken; end if;
  select * into pl from player where world_id = p_world and uid = p_uid;
  k := class_companion(p_world, p_uid);
  if pl.uid is null or k.id is null then return p_taken; end if;
  if (pl.blessings->'feral_bond'->>'until')::timestamptz > now() then
    v_share := (pl.blessings->'feral_bond'->>'share')::double precision;
  end if;
  if pk(pl.class_mul, 'bond:share', 0) > 0
     and sqrt((creature_x(k) - pl.x) ^ 2 + (creature_y(k) - pl.y) ^ 2) <= pk(pl.class_mul, 'bond:reach', 0) then
    v_share := greatest(v_share, pk(pl.class_mul, 'bond:share', 0));
  end if;
  if v_share <= 0 then return p_taken; end if;
  perform class_beast_take(p_world, k.id, p_taken * v_share / blow_share() * beast_mul(k, 'soak'), p_by);
  return p_taken * (1 - v_share);
end $$;

/*
 * And the other way: inside a Feral Bond its keeper takes their share of a
 * blow that lands on the companion, straight off their health as an Oath's
 * share is, and dies of it as they would of their own. What the companion
 * keeps of it.
 */
create or replace function class_bond_give(p_world uuid, c creature, p_pts double precision)
  returns double precision language plpgsql as $$
declare b jsonb; v_share double precision; v_h double precision;
begin
  if p_pts <= 0 or c.mode <> 'active' or c.keeper is null then return p_pts; end if;
  select blessings into b from player where world_id = p_world and uid = c.keeper and not away;
  if not coalesce((b->'feral_bond'->>'until')::timestamptz > now(), false) then return p_pts; end if;
  v_share := (b->'feral_bond'->>'share')::double precision;
  update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{health}',
                                      to_jsonb(greatest(0, coalesce((stats->>'health')::double precision, 1) - p_pts * v_share * blow_share())))
   where world_id = p_world and uid = c.keeper
   returning (stats->>'health')::double precision into v_h;
  if v_h <= 0 and not faith_undying(p_world, c.keeper) and not faith_second_life(p_world, c.keeper) then
    perform player_die(p_world, c.keeper);
  end if;
  return p_pts * (1 - v_share);
end $$;

/*
 * A Vengeance's answer, owed by a blow that landed on you and paid once the
 * row of what struck is written (`class_owed_pay`), as a Riposte is: your
 * companion strikes it back, so many times, while it is within the spell's
 * reach of it.
 */
create or replace function class_vengeance(p_world uuid, p_uid uuid, p_id integer, p_more double precision, p_n integer)
  returns void language plpgsql as $$
declare c creature; k creature; b jsonb; v_reach double precision; v_go int;
begin
  v_reach := coalesce((select (pl.blessings->'vengeance'->>'reach')::double precision from player pl
                        where pl.world_id = p_world and pl.uid = p_uid), 0);
  for v_go in 1 .. greatest(1, coalesce(p_n, 1)) loop
    select * into c from creature where world_id = p_world and id = p_id;
    k := class_companion(p_world, p_uid);
    exit when c.id is null or c.health <= 0 or k.id is null
      or sqrt((creature_x(c) - creature_x(k)) ^ 2 + (creature_y(c) - creature_y(k)) ^ 2) > v_reach;
    b := class_beast_blow(p_world, k.id, p_id, p_more);
    perform tell(p_world, p_uid, k.name || ' answers the ' || (b->>'name') || ' for you'
      || case when (b->>'died')::boolean then ', and it dies.'
              else '. It is down to ' || (b->>'left') || ' of ' || (b->>'of') || '.' end, 'fight');
  end loop;
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
       -- And its keeper's Beastmaster passives while it follows them (`companionMul`): Thick Hide, Hardy Stock, Fleet and Quick Paws.
       * case when c.mode <> 'active' or c.kept is null then 1
              when p_channel = 'hardy' then coalesce((c.kept->>'kept:hardy')::double precision, 1)
              when p_channel = 'soak' then coalesce((c.kept->>'kept:soak')::double precision, 1)
              when p_channel = 'speed' then coalesce((c.kept->>'kept:speed')::double precision, 1)
              when p_channel = 'haste' then coalesce((c.kept->>'kept:haste')::double precision, 1)
              else 1 end
$function$;

CREATE OR REPLACE FUNCTION public.creature_attack(p_world uuid, p_attacker integer, p_target integer)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
declare a creature; d species_def; v_dmg double precision; t creature; v_guard uuid; v_died boolean;
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
           * (0.7 + random() * 0.6)
           -- And larger inside its keeper's Bloodlust and Primal Fury (`companion_dealt`).
           * companion_dealt(a);
  if a.skills ? 'fighting' then perform worker_learn(p_world, p_attacker, 'fighting', 0.05); end if;
  v_died := wound_beast(p_world, p_target, v_dmg, creature_x(a), creature_y(a), null, p_attacker);
  -- And a Beastmaster's trade learns from it as from a blow of their own (`class_learn_beast`).
  perform class_learn_beast(p_world, a, v_died);
  return v_died;
end $function$;

CREATE OR REPLACE FUNCTION public.companion_settle(p_world uuid, p_id integer)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare c creature; d species_def; k player; q creature; guard int := 0; done int := 0;
        pace double precision; cx double precision; cy double precision;
        ax double precision; ay double precision; dist double precision; v_step record;
begin
  select * into c from creature where world_id = p_world and id = p_id for update;
  if not found or c.mode <> 'active' or c.keeper is null then return 0; end if;
  -- Under a rider or in the traces it goes where it is taken, and does no thinking.
  if c.rider is not null or c.hitched_to is not null then return 0; end if;
  select * into k from player where world_id = p_world and uid = c.keeper;
  if not found then return 0; end if;
  select * into d from species_def where id = c.species;
  pace := d.speed * (age_row(c.born, old_of(c))).speed * beast_mul(c, 'speed');

  while c.until <= now() and guard < 60 loop
    guard := guard + 1;
    cx := c.to_x; cy := c.to_y;

    if c.phase = 'strike' then
      -- The row goes down first: the blow settles the other one, and a kill
      -- takes the enemy off every row that had it, this one included.
      update creature set from_x = c.from_x, from_y = c.from_y, to_x = c.to_x, to_y = c.to_y,
          leg_at = c.leg_at, leg_ends = c.leg_ends, until = c.until, phase = c.phase,
          enemy = c.enemy, settled_at = now()
        where world_id = p_world and id = p_id;
      if c.enemy is not null and creature_attack(p_world, p_id, c.enemy) then done := done + 1; end if;
      select * into c from creature where world_id = p_world and id = p_id;
      c.phase := 'idle';
      c.leg_at := c.until; c.leg_ends := c.until;
      continue;
    end if;

    q := companion_target(p_world, c, k);
    if q.id is null then
      c.enemy := null;
      exit;
    end if;
    if c.enemy is distinct from q.id then
      c.enemy := q.id;
      perform tell(p_world, c.keeper, c.name || ' goes for the '
        || lower((select name from species_def where id = q.species)) || '.', 'fight');
    end if;
    ax := creature_x(q); ay := creature_y(q);
    dist := sqrt((ax - cx) ^ 2 + (ay - cy) ^ 2);
    if dist <= companion_reach() then
      c.phase := 'strike';
      c.leg_at := c.until; c.leg_ends := c.until;
      -- Quicker inside its keeper's Primal Fury (`companion_quick`).
      c.until := c.until + make_interval(secs => companion_blow() / (beast_mul(c, 'haste') * companion_quick(c)));
    else
      -- A leg that ends well inside its reach, so a thing shuffling half a
      -- step does not put it out of reach again, round whatever is between.
      select * into v_step from chase_leg(p_world, cx, cy,
        cx + (ax - cx) * (dist - companion_reach() / 2) / dist,
        cy + (ay - cy) * (dist - companion_reach() / 2) / dist);
      if v_step.x is null then
        -- Nothing open at all: the browser gives up here too.
        c.enemy := null;
        exit;
      end if;
      c.from_x := cx; c.from_y := cy;
      c.to_x := v_step.x; c.to_y := v_step.y;
      c.leg_at := c.until;
      c.leg_ends := c.leg_at + make_interval(secs =>
        greatest(0.2, sqrt((c.to_x - cx) ^ 2 + (c.to_y - cy) ^ 2)
                      / greatest(0.1, pace * companion_pace())));
      c.until := c.leg_ends;
    end if;
  end loop;

  -- Piers: at heel, unless its keeper is on a tile on piers, where it does not go: then where it is (`creature_tile_ok`).
  if c.enemy is null and on_piers(p_world, floor(k.x)::int, floor(k.y)::int) then
    c.from_x := c.to_x; c.from_y := c.to_y;
    c.leg_at := now(); c.leg_ends := now(); c.until := now();
    c.phase := 'idle';
  elsif c.enemy is null then
    -- Nothing to go for: at heel, which is not a walk of its own.
    c.from_x := k.x; c.from_y := k.y; c.to_x := k.x; c.to_y := k.y;
    c.leg_at := now(); c.leg_ends := now(); c.until := now();
    c.phase := 'idle';
  elsif c.until <= now() then
    c.from_x := c.to_x; c.from_y := c.to_y;
    c.leg_at := now(); c.leg_ends := now(); c.until := now() + interval '1 second';
  end if;
  update creature set from_x = c.from_x, from_y = c.from_y, to_x = c.to_x, to_y = c.to_y,
      leg_at = c.leg_at, leg_ends = c.leg_ends, until = c.until, phase = c.phase,
      enemy = c.enemy, settled_at = now()
    where world_id = p_world and id = p_id;
  return done;
end $function$;

CREATE OR REPLACE FUNCTION public.companion_target(p_world uuid, c creature, k player)
 RETURNS creature
 LANGUAGE plpgsql
 STABLE
AS $function$
declare q creature; v_threat int;
        -- As far as it looks and as far as it follows a fight: further for its keeper's Long Leash.
        v_sight double precision := pk(k.class_mul, 'sight:companion', companion_sight());
        v_leash double precision := pk(k.class_mul, 'leash:companion', companion_leash());
begin
  if k.away then return null; end if;
  -- Fallen back (`order_heel`): at your side, and no fight of its own until the time is up.
  if c.heel_until is not null and c.heel_until > now() then return null; end if;
  -- What it is on, whatever its stance: a passive one is on something only when told (`order_attack`).
  if c.enemy is not null then
    select * into q from creature where world_id = p_world and id = c.enemy;
    if found and q.mode = 'wild' and q.hitched_to is null
       and sqrt((creature_x(q) - k.x) ^ 2 + (creature_y(q) - k.y) ^ 2)
           <= (case when c.stance = 'guard' then guard_range() else v_leash end) then
      return q;
    end if;
    return null;
  end if;
  if c.stance = 'passive' then return null; end if;
  -- Guarding you: whatever is hunting you within `companion_sight`, nearest first, before it lands a blow.
  if c.stance = 'guard' then
    select qq.* into q from creature qq
      where qq.world_id = p_world and qq.hunting = k.uid and qq.mode = 'wild' and qq.hitched_to is null
        and sqrt((creature_x(qq) - k.x) ^ 2 + (creature_y(qq) - k.y) ^ 2) <= v_sight
      order by (creature_x(qq) - k.x) ^ 2 + (creature_y(qq) - k.y) ^ 2, qq.id
      limit 1;
    if found then return q; end if;
  end if;
  if c.stance = 'aggressive' then
    select qq.* into q from creature qq
      where qq.world_id = p_world and qq.mode = 'wild' and qq.hitched_to is null
        -- The box first, which the index can serve; the circle second.
        and qq.to_x between k.x - (v_sight + leg_slack()) and k.x + (v_sight + leg_slack())
        and qq.to_y between k.y - (v_sight + leg_slack()) and k.y + (v_sight + leg_slack())
        and sqrt((creature_x(qq) - k.x) ^ 2 + (creature_y(qq) - k.y) ^ 2) <= v_sight
      order by (creature_x(qq) - k.x) ^ 2 + (creature_y(qq) - k.y) ^ 2, qq.id
      limit 1;
    if not found then return null; end if;
    return q;
  end if;
  v_threat := case
    when c.hurt_at > now() - make_interval(secs => blow_memory()) then c.hurt_by
    when (k.stats->>'hurtAt')::timestamptz > now() - make_interval(secs => blow_memory())
      then (k.stats->>'hurtBy')::int
  end;
  if v_threat is null or v_threat = c.id then return null; end if;
  select * into q from creature where world_id = p_world and id = v_threat and mode = 'wild'
    and hitched_to is null;
  if not found then return null; end if;
  return q;
end $function$;

CREATE OR REPLACE FUNCTION public.creature_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare c creature; d species_def; food text; held int; working int; cap int; q creature; pl player;
begin
  -- Opening a crate you carry is asked of the crate, not of a creature.
  if p_action in ('crate_follow', 'crate_work') then
    return crate_open_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Walked forward before it is looked at: where it was is not where it is.
  perform creature_settle(p_world, (p_target->>'id')::int);
  c := target_creature(p_world, p_target);
  if c.world_id is null then return 'It is gone.'; end if;
  select * into d from species_def where id = c.species;

  -- In the traces until somebody takes it out: nothing that would send it
  -- anywhere else is open to it, in the words culling one already uses.
  if p_action in ('assign_deed', 'take_creature', 'crate_creature', 'release_creature')
     and c.hitched_to is not null then
    return c.name || ' is in the traces. Take it out first.';
  end if;

  -- Only your own is yours to send anywhere, put in a crate, order about or name.
  if p_action in ('take_creature', 'assign_deed', 'crate_creature', 'release_creature', 'cull_creature',
                  'set_stance', 'order_attack', 'order_heel', 'rename_creature')
     and c.mode <> 'wild' and c.keeper is distinct from p_uid then
    return c.name || ' is not yours.';
  end if;

  -- An order is heard from wherever you stand, as a stance is.
  if p_action not in ('examine_creature', 'assign_deed', 'set_stance', 'order_attack', 'order_heel')
     and not creature_in_reach(p_world, p_uid, c) then
    return case when c.mode = 'wild' then 'The ' || lower(d.name) || ' is not close enough.'
                else 'Stand next to ' || c.name || '.' end;
  end if;

  if p_action = 'tame' then
    if d.monster then
      return 'A ' || lower(d.name) || ' is not a wildermon. There is nothing to be done with it but kill it.';
    end if;
    if c.mode <> 'wild' then return c.name || ' is already yours.'; end if;
    if skill_of(p_world, p_uid, 'taming') < d.tame_level then
      return 'You need taming ' || to_char(d.tame_level, 'FM990.#') || ' to try.';
    end if;
    if bait_in_pack(p_world, p_uid, c.species, pk(p_world, p_uid, 'bait:any', 0) > 0) is null then
      return d.name || 's take ' || diet_text(c.species) || '. Bring some.';
    end if;
    -- The first follows you, and every one after that goes into a crate you carry.
    return tame_room_refusal(p_world, p_uid);

  elsif p_action = 'assign_deed' then
    if c.mode = 'wild' then return 'It is not yours to set to work.'; end if;
    if c.mode = 'stored' then return c.name || ' is in a creature crate. Open the crate to set it to work.'; end if;
    if (my_deed(p_world, p_uid)).world_id is null then
      return 'You have no settlement to assign it to.';
    end if;
    if d.gathers is null then return 'A ' || lower(d.name) || ' has no trade to be set to.'; end if;
    -- A trade asked for by name has to be one of its own.
    if nullif(p_target->>'job', '') is not null
       and not (p_target->>'job' = d.gathers or p_target->>'job' = any(coalesce(d.trades, '{}'::text[]))) then
      return 'A ' || lower(d.name) || ' cannot be set to that.';
    end if;
    if not worker_job_ported(coalesce(nullif(p_target->>'job', ''), d.gathers)) then
      return 'Nobody has taught this island what '
        || (select plain from gather_def where id = coalesce(nullif(p_target->>'job', ''), d.gathers))
        || ' looks like yet.';
    end if;
    -- One off a post takes a place as much as one off the road, since a post costs none.
    if c.mode <> 'deed' or c.post is not null then
      working := workers_on_deed(p_world, p_uid);
      cap := worker_cap(p_world, p_uid);
      if working >= cap then
        return (my_deed(p_world, p_uid)).name || ' has work for ' || cap
          || ' wildermon at level ' || cap || '. Upgrade the settlement to take on more.';
      end if;
    end if;
    return null;

  elsif p_action = 'feed' then
    if c.mode not in ('active', 'deed') then return 'It is not yours to feed.'; end if;
    if bait_in_pack(p_world, p_uid, c.species) is null then
      return 'It eats ' || diet_text(c.species) || '.';
    end if;
    return null;

  elsif p_action = 'groom' then
    if d.monster then return 'Not that. Not ever.'; end if;
    if c.mode = 'wild' then return 'It is not yours to brush.'; end if;
    if pack_count(p_world, p_uid, 'brush') <= 0 then return 'You need a brush.'; end if;
    if c.care >= 0.995 then return c.name || ' has been brushed to a shine already.'; end if;
    return null;

  elsif p_action = 'shear' then
    if d.fleece is null then return 'There is nothing on it worth shearing.'; end if;
    if c.mode = 'wild' then return 'Tame it first; it will not stand still for you otherwise.'; end if;
    if pack_count(p_world, p_uid, 'carving_knife') <= 0 then return 'You need a knife to shear with.'; end if;
    if c.fleece < 0.35 then
      return c.name || ' has hardly any '
        || case when d.shear_yield = 'feather' then 'feathers' else 'fleece' end || ' back yet.';
    end if;
    return null;

  elsif p_action = 'milk_creature' then
    if not d.milk then return 'That is not something you milk.'; end if;
    if c.mode in ('wild', 'stored') then return 'It is not yours to milk.'; end if;
    if pack_count(p_world, p_uid, 'bucket') <= 0 then return 'You need an empty bucket.'; end if;
    if c.sex <> 'female' then return c.name || ' is male. Nothing is coming out of him.'; end if;
    if c.fleece < 0.4 then return c.name || ' has nothing to give yet.'; end if;
    return null;

  elsif p_action = 'set_stance' then
    if c.mode <> 'active' then return 'Only a companion takes orders like that.'; end if;
    if coalesce(p_target->>'stance', '') not in ('passive', 'defensive', 'aggressive', 'guard') then
      return 'Passive, defensive, guarding you or aggressive.';
    end if;
    return null;

  elsif p_action = 'order_attack' then
    if c.mode <> 'active' then return 'Only a companion takes orders like that.'; end if;
    if coalesce(p_target->>'foe', '') !~ '^[0-9]+$' then return 'Mark something wild first, or fight it.'; end if;
    select * into q from creature where world_id = p_world and id = (p_target->>'foe')::int;
    if not found or q.mode <> 'wild' or q.hitched_to is not null then return 'Mark something wild first, or fight it.'; end if;
    select * into pl from player where world_id = p_world and uid = p_uid;
    -- As far as it follows a fight: further for a Beastmaster's Long Leash.
    if sqrt((creature_x(q) - pl.x) ^ 2 + (creature_y(q) - pl.y) ^ 2) > pk(pl.class_mul, 'leash:companion', companion_leash()) then
      return 'It is more than ' || pk(pl.class_mul, 'leash:companion', companion_leash()) || ' tiles from you.';
    end if;
    return null;

  elsif p_action = 'order_heel' then
    if c.mode <> 'active' then return 'Only a companion takes orders like that.'; end if;
    return null;

  elsif p_action = 'rename_creature' then
    if c.mode = 'wild' then return 'It is not yours to name.'; end if;
    if nullif(btrim(coalesce(p_target->>'name', '')), '') is null then return 'Choose a name.'; end if;
    return null;

  elsif p_action = 'take_creature' then
    if c.mode = 'stored' then return c.name || ' is in a creature crate. Open the crate to let it out.'; end if;
    if c.mode <> 'deed' then return 'It is already with you.'; end if;
    -- Where the one following you now goes, or why it has nowhere to.
    return (companion_swap(p_world, p_uid, c)).v_why;

  elsif p_action = 'crate_creature' then
    if c.mode = 'stored' then return c.name || ' is already in a creature crate.'; end if;
    if c.mode not in ('active', 'deed') then return 'It is not yours to put in a crate.'; end if;
    if c.rider is not null then return 'Get down off ' || c.name || ' first.'; end if;
    if empty_crate(p_world, p_uid) is null then return 'You need an empty creature crate in your pack.'; end if;
    return null;

  elsif p_action = 'release_creature' then
    if c.mode = 'wild' then return 'It is already wild.'; end if;
    if c.mode = 'stored' and exists (select 1 from item i where i.world_id = p_world and i.creature = c.id
                                        and (i.deal is not null or i.holder <> 'player')) then
      return c.name || '''s crate is on offer, on a stall or in the post. Take it back first.';
    end if;
    return null;

  elsif p_action = 'cull_creature' then
    -- Only your own, and only one that is not in the traces or under you when
    -- you ask: both of those are a mess this does not have to make.
    if c.mode = 'wild' then return 'That one is nobody''s. Fight it if you mean it.'; end if;
    if c.hitched_to is not null then return c.name || ' is in the traces. Take it out first.'; end if;
    if c.rider is not null then return 'Get down off ' || c.name || ' first.'; end if;
    if c.mode = 'stored' and exists (select 1 from item i where i.world_id = p_world and i.creature = c.id
                                        and (i.deal is not null or i.holder <> 'player')) then
      return c.name || '''s crate is on offer, on a stall or in the post. Take it back first.';
    end if;
    return null;
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.wound_beast(p_world uuid, p_id integer, p_dmg double precision, p_from_x double precision DEFAULT NULL::double precision, p_from_y double precision DEFAULT NULL::double precision, p_teller uuid DEFAULT NULL::uuid, p_by integer DEFAULT NULL::integer)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
declare c creature; d species_def; cx double precision; cy double precision; v_taken double precision;
        v_len double precision; v_size double precision; v_killer creature;
begin
  perform creature_settle(p_world, p_id);
  select * into c from creature where world_id = p_world and id = p_id for update;
  if not found then return false; end if;
  select * into d from species_def where id = c.species;
  cx := creature_x(c); cy := creature_y(c);
  -- What a blow costs it is its blood's to say, and its herd's.
  -- Nothing is struck inside a Truce, nor from one (`faith_truce`).
  if faith_truce(p_world, cx, cy) or (p_from_x is not null and faith_truce(p_world, p_from_x, p_from_y)) then
    return false;
  end if;
  -- And a creature under a Mark of Judgment takes its share more (`faith_marked`).
  v_taken := p_dmg * beast_mul(c, 'soak') * faith_marked(p_world, p_id);
  -- And on a companion inside its keeper's Feral Bond, its keeper's share of it, straight off their health (`class_bond_give`).
  v_taken := class_bond_give(p_world, c, v_taken);

  update creature set health = c.health - v_taken, hurt_at = now(), hurt_by = p_by,
      coaxed = 0, coaxed_at = null,
      from_x = cx, from_y = cy, to_x = cx, to_y = cy, leg_at = now(), leg_ends = now(),
      settled_at = now()
    where world_id = p_world and id = p_id;

  if c.health - v_taken > 0 then
    -- A wild thing that stands and fights turns on a tame one that hurt it (`beast_threat`).
    if c.mode = 'wild' and not coalesce(d.timid, false) and p_by is not null then
      perform beast_threat(p_world, p_id, p_by);
    end if;
    if c.mode = 'wild' and d.timid and p_from_x is not null then
      v_len := greatest(0.001, sqrt((cx - p_from_x) ^ 2 + (cy - p_from_y) ^ 2));
      update creature set to_x = cx + ((cx - p_from_x) / v_len) * 5, to_y = cy + ((cy - p_from_y) / v_len) * 5,
          leg_ends = now() + interval '3 seconds', until = now() + interval '3 seconds'
        where world_id = p_world and id = p_id;
    end if;
    return false;
  end if;

  -- What the carcass is worth follows the size of the thing that left it.
  v_size := (age_row(c.born, old_of(c))).yield;
  delete from creature where world_id = p_world and id = p_id;
  -- Nothing goes on fighting something that is no longer there.
  update creature set enemy = null where world_id = p_world and enemy = p_id;
  perform drop_on_ground(p_world, floor(cx)::int, floor(cy)::int, 'corpse',
    (15 + random() * 35) * v_size, d.name);

  -- A hunter marks where its kill went down and comes back for it.
  if p_by is not null then
    select * into v_killer from creature where world_id = p_world and id = p_by;
    -- A companion's kill is told to its keeper, who is standing right there. A
    -- worker's is not: a guard's week on a deed its keeper has left would come
    -- back as a page of them.
    if found and v_killer.mode = 'active' and v_killer.keeper is not null then
      perform tell(p_world, v_killer.keeper, v_killer.name || ' killed a wild ' || lower(d.name) || '.', 'fight');
    end if;
    if found and v_killer.carrying is null
       and (select gathers from species_def where id = v_killer.species) = 'hunt' then
      update creature set work_x = floor(cx)::int, work_y = floor(cy)::int
        where world_id = p_world and id = p_by;
      perform worker_learn(p_world, p_by, 'fighting', 0.4);
    end if;
  end if;

  /*
   * And what it was keeping, which is the other half of where a map comes
   * from. Only a monster — `species_def.monster` is already the line between
   * a thing that hunts you and a thing you could have tamed — and only to
   * whoever struck it down. The odds and the quality both come off its
   * health, which is the one number that says how big a thing was: a goblin
   * in thirty-five carries a scrap, a dragon in two carries a dragon's.
   */
  if p_teller is not null and d.monster and random() < map_chance_beast(d.health) then
    perform bury_treasure(p_world, p_teller, map_ql_beast(d.health), cx, cy);
  end if;

  if p_teller is not null then
    perform journal_note(p_world, p_teller, 'slew:' || c.species);
    if d.monster then
      perform tell(p_world, p_teller, 'The ' || lower(d.name)
        || ' goes down. Butcher it before it rots: there is a great deal on it.', 'fight');
    else
      perform tell(p_world, p_teller, 'You kill the wild ' || lower(d.name)
        || '. Its corpse lies where it fell.', 'fight');
    end if;
  end if;
  return true;
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
  -- And answered by your companion inside a Beastmaster's Vengeance: owed now, struck once its row is written (`class_vengeance`).
  if v_from.id is not null and (p.blessings->'vengeance'->>'until')::timestamptz > now() then
    insert into class_mark (world_id, creature_id, kind, val, n, until, by_uid)
      values (p_world, v_from.id, 'vengeance', (p.blessings->'vengeance'->>'more')::double precision, 1, now(), p_uid)
      on conflict (world_id, creature_id, kind) do update set n = coalesce(class_mark.n, 0) + 1
        where class_mark.by_uid = excluded.by_uid;
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
  perform tell(p_world, p_uid, p_what || note || '. You have ' || wound_text(w) || '.', 'fight');
  -- And a Second Life, which the killing blow spends instead of you (`faith_second_life`).
  -- Undying holds you at its floor and is not spent; a Second Life is.
  if health <= 0 and faith_undying(p_world, p_uid) then perform fight_back(p_world, p_uid, (p.stats->>'hurtBy')::int);
  elsif health <= 0 and faith_second_life(p_world, p_uid) then perform fight_back(p_world, p_uid, (p.stats->>'hurtBy')::int);
  elsif health <= 0 then perform player_die(p_world, p_uid);
  else perform fight_back(p_world, p_uid, (p.stats->>'hurtBy')::int); end if;
end $function$;

CREATE OR REPLACE FUNCTION public.class_owed_pay(p_world uuid, p_id integer)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
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
  -- And every blow it landed on a Beastmaster inside a Vengeance, answered by their companion (`class_vengeance`).
  delete from class_mark where world_id = p_world and creature_id = p_id and kind = 'vengeance'
    returning * into m;
  if m.creature_id is not null and m.by_uid is not null then
    perform class_vengeance(p_world, m.by_uid, p_id, m.val, m.n);
  end if;
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
        k creature; v_top double precision;
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
                    -- A Beastmaster's companion strikes from its own reach of it, which its arm asks: you as far as any spell;
                    -- and a Call of the Wild as far as it says.
                    when p_spell = 'beastmaster_call_of_the_wild' then spell_fx(p_spell, 'reach')
                    when s.class = 'beastmaster' then spell_reach()
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

  when 'beastmaster_sic' then
    k := class_companion(p_world, p_uid);
    if k.id is not null then perform creature_settle(p_world, k.id); k := class_companion(p_world, p_uid); end if;
    if k.id is null then return jsonb_build_object('why', s.name || ' wants a companion following you.'); end if;
    if sqrt((creature_x(c) - creature_x(k)) ^ 2 + (creature_y(c) - creature_y(k)) ^ 2) > companion_reach() then
      return jsonb_build_object('why', k.name || ' is not close enough to the ' || lower(d.name) || ' to strike it.');
    end if;
    b := class_beast_blow(p_world, k.id, c.id, spell_fx(p_spell, 'more'));
    v_said := class_beast_said(s.name, k.name, b);

  when 'beastmaster_lick_wounds' then
    k := class_companion(p_world, p_uid);
    if k.id is not null then perform creature_settle(p_world, k.id); k := class_companion(p_world, p_uid); end if;
    if k.id is null then return jsonb_build_object('why', s.name || ' wants a companion following you.'); end if;
    v_top := max_health(k);
    if k.health >= v_top then return jsonb_build_object('why', k.name || ' is not hurt.'); end if;
    update creature set health = least(v_top, health + v_top * spell_fx(p_spell, 'heal')) where world_id = p_world and id = k.id;
    v_said := s.name || ' heals ' || k.name || ' by ' || faith_pct(spell_fx(p_spell, 'heal')) || '.';

  when 'beastmaster_pounce' then
    k := class_companion(p_world, p_uid);
    if k.id is not null then perform creature_settle(p_world, k.id); k := class_companion(p_world, p_uid); end if;
    if k.id is null then return jsonb_build_object('why', s.name || ' wants a companion following you.'); end if;
    v_dist := sqrt((creature_x(c) - creature_x(k)) ^ 2 + (creature_y(c) - creature_y(k)) ^ 2);
    if v_dist > spell_fx(p_spell, 'reach') then
      return jsonb_build_object('why', k.name || ' is more than ' || trim_scale(spell_fx(p_spell, 'reach')::numeric) || ' tiles from the '
        || lower(d.name) || '.');
    end if;
    if not line_clear(p_world, creature_x(k), creature_y(k), creature_x(c), creature_y(c)) then
      return jsonb_build_object('why', 'Something stands between ' || k.name || ' and the ' || lower(d.name) || '.');
    end if;
    -- It lands half its reach short of it, on the line between them; on it, where there is no footing there.
    v_x := creature_x(c) - (creature_x(c) - creature_x(k)) / greatest(v_dist, 0.001) * companion_reach() / 2;
    v_y := creature_y(c) - (creature_y(c) - creature_y(k)) / greatest(v_dist, 0.001) * companion_reach() / 2;
    if not creature_tile_ok(p_world, floor(v_x)::int, floor(v_y)::int) then v_x := creature_x(c); v_y := creature_y(c); end if;
    update creature set from_x = v_x, from_y = v_y, to_x = v_x, to_y = v_y, leg_at = now(), leg_ends = now(), until = now(),
        phase = 'idle', enemy = c.id, heel_until = null
      where world_id = p_world and id = k.id;
    b := class_beast_blow(p_world, k.id, c.id, spell_fx(p_spell, 'more'));
    if not (b->>'died')::boolean then
      update creature set windup_at = null, until = greatest(until, now()) + make_interval(secs => spell_fx(p_spell, 'back'))
        where world_id = p_world and id = c.id;
    end if;
    v_said := class_beast_said(s.name, k.name, b) || case when (b->>'died')::boolean then ''
      else ' Its next blow is put back ' || faith_span(spell_fx(p_spell, 'back')) || '.' end;

  when 'beastmaster_snarl' then
    k := class_companion(p_world, p_uid);
    if k.id is not null then perform creature_settle(p_world, k.id); k := class_companion(p_world, p_uid); end if;
    if k.id is null then return jsonb_build_object('why', s.name || ' wants a companion following you.'); end if;
    for r in select cr.id from creature cr
              where cr.world_id = p_world and cr.mode = 'wild' and cr.health > 0 and cr.hitched_to is null
                and cr.to_x between creature_x(k) - (spell_fx(p_spell, 'reach') + leg_slack()) and creature_x(k) + (spell_fx(p_spell, 'reach') + leg_slack())
                and cr.to_y between creature_y(k) - (spell_fx(p_spell, 'reach') + leg_slack()) and creature_y(k) + (spell_fx(p_spell, 'reach') + leg_slack())
                and (creature_x(cr) - creature_x(k)) ^ 2 + (creature_y(cr) - creature_y(k)) ^ 2 <= spell_fx(p_spell, 'reach') ^ 2
              order by cr.id loop
      perform creature_settle(p_world, r.id);
      update creature set brawl = k.id, threat_at = now(), windup_at = null
        where world_id = p_world and id = r.id and mode = 'wild' and health > 0;
      if found then v_n := v_n + 1; end if;
    end loop;
    if v_n = 0 then
      return jsonb_build_object('why', 'Nothing wild is within ' || trim_scale(spell_fx(p_spell, 'reach')::numeric) || ' tiles of ' || k.name || '.');
    end if;
    v_said := s.name || ': ' || v_n || case when v_n = 1 then ' creature turns on ' else ' creatures turn on ' end || k.name || '.';

  when 'beastmaster_guard_me' then
    k := class_companion(p_world, p_uid);
    if k.id is not null then perform creature_settle(p_world, k.id); k := class_companion(p_world, p_uid); end if;
    if k.id is null then return jsonb_build_object('why', s.name || ' wants a companion following you.'); end if;
    -- Only when something within its reach of you is hunting you: otherwise it would be a leap for nothing.
    if not exists (select 1 from creature cr
                    where cr.world_id = p_world and cr.mode = 'wild' and cr.health > 0 and cr.hunting = p_uid
                      and (creature_x(cr) - me.x) ^ 2 + (creature_y(cr) - me.y) ^ 2 <= spell_fx(p_spell, 'reach') ^ 2) then
      return jsonb_build_object('why', 'Nothing within ' || trim_scale(spell_fx(p_spell, 'reach')::numeric) || ' tiles of you is hunting you.');
    end if;
    update creature set from_x = me.x, from_y = me.y, to_x = me.x, to_y = me.y, leg_at = now(), leg_ends = now(), until = now(),
        phase = 'idle'
      where world_id = p_world and id = k.id;
    for r in select cr.id from creature cr
              where cr.world_id = p_world and cr.mode = 'wild' and cr.health > 0 and cr.hunting = p_uid
                and (creature_x(cr) - me.x) ^ 2 + (creature_y(cr) - me.y) ^ 2 <= spell_fx(p_spell, 'reach') ^ 2
              order by cr.id loop
      perform creature_settle(p_world, r.id);
      update creature set brawl = k.id, threat_at = now(), windup_at = null
        where world_id = p_world and id = r.id and mode = 'wild' and health > 0;
      if found then v_n := v_n + 1; end if;
    end loop;
    v_said := s.name || ': ' || k.name || ' is at your side, and ' || v_n
      || case when v_n = 1 then ' creature turns on it.' else ' creatures turn on it.' end;

  when 'beastmaster_drag_down' then
    k := class_companion(p_world, p_uid);
    if k.id is not null then perform creature_settle(p_world, k.id); k := class_companion(p_world, p_uid); end if;
    if k.id is null then return jsonb_build_object('why', s.name || ' wants a companion following you.'); end if;
    if sqrt((creature_x(c) - creature_x(k)) ^ 2 + (creature_y(c) - creature_y(k)) ^ 2) > companion_reach() then
      return jsonb_build_object('why', k.name || ' is not close enough to the ' || lower(d.name) || ' to strike it.');
    end if;
    b := class_beast_blow(p_world, k.id, c.id, spell_fx(p_spell, 'more'));
    if not (b->>'died')::boolean then perform class_hold(p_world, c.id, spell_fx(p_spell, 'hold')); end if;
    v_said := class_beast_said(s.name, k.name, b) || case when (b->>'died')::boolean then ''
      else ' It is held where it stands for ' || faith_span(spell_fx(p_spell, 'hold')) || '.' end;

  when 'beastmaster_disembowel' then
    k := class_companion(p_world, p_uid);
    if k.id is not null then perform creature_settle(p_world, k.id); k := class_companion(p_world, p_uid); end if;
    if k.id is null then return jsonb_build_object('why', s.name || ' wants a companion following you.'); end if;
    if sqrt((creature_x(c) - creature_x(k)) ^ 2 + (creature_y(c) - creature_y(k)) ^ 2) > companion_reach() then
      return jsonb_build_object('why', k.name || ' is not close enough to the ' || lower(d.name) || ' to strike it.');
    end if;
    b := class_beast_blow(p_world, k.id, c.id, spell_fx(p_spell, 'more'));
    -- A bleed, as a knife's runs (`creature_settle`): the stronger of the two where it already bleeds, to the later end.
    if not (b->>'died')::boolean then
      update creature set bleed_rate = greatest(coalesce(bleed_rate, 0), (b->>'dmg')::double precision * spell_fx(p_spell, 'each')),
          bleed_until = greatest(coalesce(bleed_until, now()), now() + make_interval(secs => spell_fx(p_spell, 'secs')))
        where world_id = p_world and id = c.id;
    end if;
    v_said := class_beast_said(s.name, k.name, b) || case when (b->>'died')::boolean then ''
      else ' It bleeds ' || faith_pct(spell_fx(p_spell, 'each')) || ' of the blow a second for ' || faith_span(spell_fx(p_spell, 'secs')) || '.' end;

  when 'beastmaster_bloodlust' then
    k := class_companion(p_world, p_uid);
    if k.id is not null then perform creature_settle(p_world, k.id); k := class_companion(p_world, p_uid); end if;
    if k.id is null then return jsonb_build_object('why', s.name || ' wants a companion following you.'); end if;
    -- On every blow of its while it holds (`companion_dealt`).
    perform blessing_put(p_world, p_uid, 'bloodlust', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'more', spell_fx(p_spell, 'more')));
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' ' || k.name || '''s blows are '
      || faith_pct(spell_fx(p_spell, 'more') - 1) || ' larger.';

  when 'beastmaster_vengeance' then
    k := class_companion(p_world, p_uid);
    if k.id is not null then perform creature_settle(p_world, k.id); k := class_companion(p_world, p_uid); end if;
    if k.id is null then return jsonb_build_object('why', s.name || ' wants a companion following you.'); end if;
    -- On every blow that lands on you while it holds (`hurt_player`), answered once the striker's turn is written (`class_vengeance`).
    perform blessing_put(p_world, p_uid, 'vengeance', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'more', spell_fx(p_spell, 'more'),
      'reach', spell_fx(p_spell, 'reach')));
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' ' || k.name
      || ' answers every creature that lands a blow on you.';

  when 'beastmaster_feral_bond' then
    k := class_companion(p_world, p_uid);
    if k.id is not null then perform creature_settle(p_world, k.id); k := class_companion(p_world, p_uid); end if;
    if k.id is null then return jsonb_build_object('why', s.name || ' wants a companion following you.'); end if;
    -- On every blow that lands on you (`class_bond_take`) or on it (`class_bond_give`) while it holds.
    perform blessing_put(p_world, p_uid, 'feral_bond', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'share', spell_fx(p_spell, 'share')));
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' every blow on you or on ' || k.name
      || ' is split between you.';

  when 'beastmaster_primal_fury' then
    k := class_companion(p_world, p_uid);
    if k.id is not null then perform creature_settle(p_world, k.id); k := class_companion(p_world, p_uid); end if;
    if k.id is null then return jsonb_build_object('why', s.name || ' wants a companion following you.'); end if;
    -- On every blow of its while it holds (`companion_dealt`), and on how often it strikes (`companion_quick`).
    perform blessing_put(p_world, p_uid, 'primal_fury', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'more', spell_fx(p_spell, 'more'),
      'quick', spell_fx(p_spell, 'quick')));
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' ' || k.name || '''s blows are '
      || faith_pct(spell_fx(p_spell, 'more') - 1) || ' larger and come ' || faith_pct(spell_fx(p_spell, 'quick') - 1) || ' more often.';

  when 'beastmaster_call_of_the_wild' then
    -- A tame that takes, as an offering that takes does (`perform_creature`), with nothing offered.
    if d.monster then return jsonb_build_object('why', 'The ' || lower(d.name) || ' cannot be tamed.'); end if;
    if coalesce(d.tame_level, 0) > skill_of(p_world, p_uid, 'taming') then
      return jsonb_build_object('why', 'The ' || lower(d.name) || ' wants ' || round(d.tame_level)::int || ' taming; you have '
        || floor(skill_of(p_world, p_uid, 'taming'))::int || '.');
    end if;
    v_why := tame_room_refusal(p_world, p_uid);
    if v_why is not null then return jsonb_build_object('why', v_why); end if;
    v_id := companion_of(p_world, p_uid);
    update creature set mode = 'active', stance = 'defensive', keeper = p_uid, coaxed = 0, coaxed_at = null,
        hunting = null, brawl = null, enemy = null, windup_at = null
      where world_id = p_world and id = c.id;
    -- One follows you; every one after that goes into the crate you carry.
    if v_id is not null then perform crate_shut_in(p_world, c.id, empty_crate(p_world, p_uid), null); end if;
    perform journal_note(p_world, p_uid, 'tamed');
    perform guide_mark(p_world, p_uid, c.species, 'tamed');
    perform skill_told(p_world, p_uid, 'taming', try_gain(true, tame_gain()));
    perform skill_told(p_world, p_uid, 'soul_strength', try_gain(true, tame_nerve()));
    v_said := s.name || ': the ' || lower(d.name) || ' trusts you. ' || case when v_id is null then c.name || ' now follows you.'
      else 'It goes into the creature crate in your pack.' end;

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
