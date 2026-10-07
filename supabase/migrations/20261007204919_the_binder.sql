/*
 * The Binder: two spells and a passive at each of six tiers, opening on the
 * trade's own level, as the other fighting trades' do (`talents.ts`).
 *
 * Picked: spells 1 2 6 8 15 16 20 21 27 29 35 36 and passives 1 3 5 8 17 22
 * of the fifty and thirty offered, and set in the tiers in order of what they
 * are worth. The rows came with the definitions just before this. Here: the
 * focus a school's trade casts out of (`school_focus`), what a hold and a
 * shatter are at a hundred (`binder_hold_at`, `binder_shatter_at`), a hold
 * marked as one (`class_hold`, `class_held`, `class_bind`), a creature tied to
 * a spot, which is every step it takes drawn back inside a circle round it --
 * a Root a circle of nothing (`class_leash`, `class_leash_point`,
 * `class_chase_leg`) -- what strikes less often, lands less, or takes more
 * (`class_limbs`, `class_dull`, `class_brittle`), and the passives where
 * their rules are.
 */
set local lock_timeout = '3s';

/* Where a creature tied to a spot is tied: a Root's or a Tether's, kept on its mark (`class_leash`). */
alter table class_mark add column if not exists x double precision, add column if not exists y double precision;

/* The Binder's old tree went with the move to perks: its bought nodes go too, and its holders are folded afresh. */
delete from player_node pn
 where pn.node like 'binder\_%' and not exists (select 1 from class_perk k where k.id = pn.node)
   and not exists (select 1 from class_node n where n.id = pn.node);
do $$ declare r record; begin
  for r in select world_id, uid from player where combat_class = 'binder' loop perform class_fold(r.world_id, r.uid); end loop;
end $$;

/*
 * The focus a school's trade casts out of: the best of the school's stones
 * its caster carries that is not worn through, as `focus_for` picks one of a
 * kind. A trade's spell does not wear it.
 */
create or replace function school_focus(p_world uuid, p_uid uuid, p_school text)
  returns item language sql stable as $$
  select i.* from item i
   where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid
     and i.def = 'focus' and lower(coalesce(i.extra, '')) in (select st.gem from school_stone st where st.school = p_school)
     and coalesce(i.dmg, 0) < 100 and not i.locked
   order by i.ql desc nulls last, i.dmg, i.id limit 1
$$;

/* What a Binder's hold at 100% is now, in seconds: a Snare out of their focus at their binding (`spell_secs`), longer in a Long Hold. Nothing without a focus. */
create or replace function binder_hold_at(p_world uuid, p_uid uuid)
  returns double precision language plpgsql stable as $$
declare d spell_def; it item;
begin
  it := school_focus(p_world, p_uid, 'binding');
  if it.id is null then return 0; end if;
  select * into d from spell_def where id = 'snare';
  return spell_secs(p_world, p_uid, d) * mark_of(it.mark, 'force');
end $$;

/* And a shatter at 100%: an Ember's force out of that focus at their binding (`spell_force`), larger in a Long Hold. */
create or replace function binder_shatter_at(p_world uuid, p_uid uuid)
  returns double precision language plpgsql stable as $$
declare d spell_def; it item;
begin
  it := school_focus(p_world, p_uid, 'binding');
  if it.id is null then return 0; end if;
  select * into d from spell_def where id = 'ember';
  d.school := 'binding';
  return spell_force(p_world, p_uid, d, it);
end $$;

/* Whether a creature is held, neither moving nor striking, by anybody's hold (`class_hold`). */
create or replace function class_held(p_world uuid, p_id integer)
  returns boolean language sql stable as $$
  select exists (select 1 from class_mark m
                  where m.world_id = p_world and m.creature_id = p_id and m.kind = 'hold' and m.until > now())
$$;

/* What a creature takes of everything that strikes it: more inside a Brittle, and more while a Binder with a Brittle Hold holds it. */
create or replace function class_brittle(p_world uuid, p_id integer)
  returns double precision language sql stable as $$
  select coalesce((select m.val from class_mark m
                    where m.world_id = p_world and m.creature_id = p_id and m.kind = 'brittle' and m.until > now()), 1)
       * coalesce((select m.val from class_mark m
                    where m.world_id = p_world and m.creature_id = p_id and m.kind = 'hold' and m.until > now()), 1)
$$;

/* The share of its blows a creature still strikes inside a Heavy Limbs. */
create or replace function class_limbs(p_world uuid, p_id integer)
  returns double precision language sql stable as $$
  select coalesce((select m.val from class_mark m
                    where m.world_id = p_world and m.creature_id = p_id and m.kind = 'limbs' and m.until > now()), 1)
$$;

/* And what of each blow it lands, inside a Dull Claws. */
create or replace function class_dull(p_world uuid, p_id integer)
  returns double precision language sql stable as $$
  select coalesce((select m.val from class_mark m
                    where m.world_id = p_world and m.creature_id = p_id and m.kind = 'dull' and m.until > now()), 1)
$$;

/* Whether a creature is held, rooted or slowed, which a Frost Ward asks of whatever strikes. */
create or replace function class_stilled(p_world uuid, c creature)
  returns boolean language sql stable as $$
  select (c.slow_until > now() and coalesce(c.slow, 1) < 1)
      or exists (select 1 from class_mark m
                  where m.world_id = p_world and m.creature_id = c.id and m.kind in ('hold', 'root') and m.until > now())
$$;

/* A mark a spell leaves on a creature for so long, the later of two of a kind kept with the newer number. */
create or replace function class_mark_put(p_world uuid, p_id integer, p_kind text, p_val double precision, p_secs double precision,
                                          p_by uuid)
  returns void language sql as $$
  insert into class_mark (world_id, creature_id, kind, val, until, by_uid)
    values (p_world, p_id, p_kind, p_val, now() + make_interval(secs => p_secs), p_by)
    on conflict (world_id, creature_id, kind) do update
      set val = excluded.val, until = greatest(class_mark.until, excluded.until), by_uid = excluded.by_uid
$$;

/*
 * Where a creature tied to a spot may step: a Root holds it where it stood,
 * a Tether within so many tiles of it (`class_leash`). The point it was
 * going for, drawn back onto the edge of that circle when it is past it, the
 * tighter of the two where it has both; the point itself where nothing ties
 * it.
 */
create or replace function class_leash_point(p_world uuid, p_id integer, p_x double precision, p_y double precision,
                                             out x double precision, out y double precision)
  language plpgsql stable as $$
declare m class_mark; v_d double precision;
begin
  x := p_x; y := p_y;
  if p_x is null or p_y is null then return; end if;
  select * into m from class_mark
   where world_id = p_world and creature_id = p_id and kind in ('root', 'tether') and until > now()
   order by val limit 1;
  if m.creature_id is null or m.x is null then return; end if;
  v_d := sqrt((p_x - m.x) ^ 2 + (p_y - m.y) ^ 2);
  if v_d > m.val then
    x := m.x + (p_x - m.x) * m.val / greatest(v_d, 1e-9);
    y := m.y + (p_y - m.y) * m.val / greatest(v_d, 1e-9);
  end if;
end $$;

/*
 * A leg towards a point round whatever is between (`chase_leg`), for a
 * creature that may be tied to a spot: the point drawn inside its circle
 * first, and where the leg ends drawn inside it again.
 */
create or replace function class_chase_leg(p_world uuid, p_id integer, p_fx double precision, p_fy double precision,
                                           p_tx double precision, p_ty double precision)
  returns table(x double precision, y double precision) language plpgsql stable as $$
declare t record; s record;
begin
  select * into t from class_leash_point(p_world, p_id, p_tx, p_ty);
  select * into s from chase_leg(p_world, p_fx, p_fy, t.x, t.y);
  if s.x is null then return; end if;
  select * into t from class_leash_point(p_world, p_id, s.x, s.y);
  x := t.x; y := t.y;
  return next;
end $$;

/*
 * A creature tied to a spot: where it stands now, within so many tiles of it
 * for a Tether and none for a Root, until the time given. It stops where it
 * is; its next turn comes when it would have.
 */
create or replace function class_leash(p_world uuid, p_id integer, p_kind text, p_reach double precision, p_secs double precision,
                                       p_by uuid)
  returns void language plpgsql as $$
declare c creature; v_x double precision; v_y double precision;
begin
  select * into c from creature where world_id = p_world and id = p_id and health > 0;
  if c.id is null then return; end if;
  v_x := creature_x(c); v_y := creature_y(c);
  update creature set from_x = v_x, from_y = v_y, to_x = v_x, to_y = v_y, leg_at = now(), leg_ends = now()
   where world_id = p_world and id = p_id;
  insert into class_mark (world_id, creature_id, kind, val, until, by_uid, x, y)
    values (p_world, p_id, p_kind, p_reach, now() + make_interval(secs => p_secs), p_by, v_x, v_y)
    on conflict (world_id, creature_id, kind) do update
      set val = excluded.val, until = excluded.until, by_uid = excluded.by_uid, x = excluded.x, y = excluded.y;
end $$;

/*
 * A Binder's hold on a creature (`class_hold`), at the share of a Snare's
 * the spell names (`binder_hold_at`): the share the spell names on a
 * monster, longer for their Firm Grip, marked theirs so that their Brittle
 * Hold makes it take more while it lasts (`class_brittle`), and slowed for so
 * long after for their Lingering Chill. How long it holds.
 */
create or replace function class_bind(p_world uuid, p_uid uuid, p_id integer, p_share double precision, p_monster double precision)
  returns double precision language plpgsql as $$
declare pl player; c creature; d species_def; v_secs double precision;
begin
  select * into pl from player where world_id = p_world and uid = p_uid;
  select * into c from creature where world_id = p_world and id = p_id and health > 0;
  if c.id is null or pl.uid is null then return 0; end if;
  select * into d from species_def where id = c.species;
  v_secs := binder_hold_at(p_world, p_uid) * p_share * case when d.monster then p_monster else 1 end
          * pk(pl.class_mul, 'bind:secs', 1);
  perform class_hold(p_world, p_id, v_secs);
  update class_mark set by_uid = p_uid, val = greatest(val, pk(pl.class_mul, 'bind:brittle', 1))
   where world_id = p_world and creature_id = p_id and kind = 'hold';
  if pk(pl.class_mul, 'chill:secs', 0) > 0 then
    update creature set slow = case when slow_until > now() then least(coalesce(slow, 1), pk(pl.class_mul, 'chill:pace', 1))
                                    else pk(pl.class_mul, 'chill:pace', 1) end,
        slow_until = greatest(coalesce(slow_until, now()), now() + make_interval(secs => v_secs + pk(pl.class_mul, 'chill:secs', 0)))
      where world_id = p_world and id = p_id;
  end if;
  return v_secs;
end $$;

/* What a Binder's shatter did to one creature, in a sentence, as `kindler_said` says a Kindler's fire. */
create or replace function binder_said(p_spell text, b jsonb)
  returns text language sql immutable as $$
  select p_spell || ': ' || case
    when not coalesce((b->>'landed')::boolean, false) then 'the shatter does not take on the ' || coalesce(b->>'name', 'creature') || '.'
    when (b->>'died')::boolean then 'the ' || (b->>'name') || ' shatters, and dies.'
    else 'the shatter takes ' || round((b->>'dmg')::numeric) || ' off the ' || (b->>'name') || '. It is down to '
      || (b->>'left') || ' of ' || (b->>'of') || '.' end
$$;

CREATE OR REPLACE FUNCTION public.class_hold(p_world uuid, p_id integer, p_secs double precision)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare c creature; v_x double precision; v_y double precision;
begin
  select * into c from creature where world_id = p_world and id = p_id;
  if c.id is null or c.health <= 0 then return; end if;
  v_x := creature_x(c); v_y := creature_y(c);
  update creature set from_x = v_x, from_y = v_y, to_x = v_x, to_y = v_y, leg_at = now(), leg_ends = now(),
      until = greatest(until, now() + make_interval(secs => p_secs)), windup_at = null
    where world_id = p_world and id = p_id;
  -- Marked as held for as long as it holds: a Binder's own hold puts its name and its Brittle Hold on it after (`class_bind`).
  insert into class_mark (world_id, creature_id, kind, val, until)
    values (p_world, p_id, 'hold', 1, now() + make_interval(secs => p_secs))
    on conflict (world_id, creature_id, kind) do update
      set val = case when class_mark.until > now() then class_mark.val else excluded.val end,
          by_uid = case when class_mark.until > now() then class_mark.by_uid end,
          until = greatest(class_mark.until, excluded.until);
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
      -- Its turn at once, unless it is held, which a blow does not undo (`class_held`).
      until = case when class_held(p_world, p_id) then until else least(until, now()) end
    where world_id = p_world and id = p_id;
end $function$;

CREATE OR REPLACE FUNCTION public.wound_beast(p_world uuid, p_id integer, p_dmg double precision, p_from_x double precision DEFAULT NULL::double precision, p_from_y double precision DEFAULT NULL::double precision, p_teller uuid DEFAULT NULL::uuid, p_by integer DEFAULT NULL::integer)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
declare c creature; d species_def; cx double precision; cy double precision; v_taken double precision;
        v_len double precision; v_size double precision; v_killer creature; v_fx double precision; v_fy double precision;
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
  v_taken := p_dmg * beast_mul(c, 'soak') * faith_marked(p_world, p_id)
    -- And more inside a Binder's Brittle, and while their Brittle Hold holds it (`class_brittle`).
    * class_brittle(p_world, p_id);
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
    -- Not while it is held, and no further than a Root or a Tether lets it (`class_leash_point`).
    if c.mode = 'wild' and d.timid and p_from_x is not null and not class_held(p_world, p_id) then
      v_len := greatest(0.001, sqrt((cx - p_from_x) ^ 2 + (cy - p_from_y) ^ 2));
      select lp.x, lp.y into v_fx, v_fy
        from class_leash_point(p_world, p_id, cx + ((cx - p_from_x) / v_len) * 5, cy + ((cy - p_from_y) / v_len) * 5) lp;
      update creature set to_x = v_fx, to_y = v_fy,
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
           * companion_dealt(a)
           -- And less inside a Binder's Dull Claws (`class_dull`).
           * class_dull(p_world, p_attacker);
  if a.skills ? 'fighting' then perform worker_learn(p_world, p_attacker, 'fighting', 0.05); end if;
  v_died := wound_beast(p_world, p_target, v_dmg, creature_x(a), creature_y(a), null, p_attacker);
  -- And a Beastmaster's trade learns from it as from a blow of their own (`class_learn_beast`).
  perform class_learn_beast(p_world, a, v_died);
  return v_died;
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
        v_bl jsonb; v_fend double precision; v_brace double precision; v_braced boolean := false; v_t double precision;
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
        -- No further than a Root or a Tether lets it (`class_leash_point`).
        select lp.x, lp.y into c.to_x, c.to_y from class_leash_point(p_world, c.id, c.home_x, c.home_y) lp;
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
      select * into v_step from class_chase_leg(p_world, c.id, v_cx, v_cy,
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
    -- Nor on somebody who warned it off with a Pikeman's Warning Thrust, alone or with its pack, while that holds.
    if exists (select 1 from class_mark cm where cm.world_id = p_world and cm.creature_id = c.id and cm.kind = 'warned'
                 and cm.by_uid = p.uid and cm.until > now()) then
      return c;
    end if;
    c.hunting := p.uid;
    -- Where the leash is tied, and a fresh count of blows.
    c.hunt_x := v_cx; c.hunt_y := v_cy;
    c.fight_blows := 0; c.windup_at := null;
    -- The first of a pack leads it; the rest follow whoever the one they heard follows.
    c.pack_lead := case when not d.pack then null when m.id is not null then coalesce(m.pack_lead, m.id) else c.id end;
    perform tell(p_world, p.uid, case when m.id is not null then 'Another ' || lower(d.name) || ' comes with it.'
                                      else 'A ' || lower(d.name) || ' has your scent.' end, 'fight');
  end if;

  -- What the one it is after holds that changes its steps: a Pikeman's Fend Off, and Brace for the Charge at the edge of their reach.
  select pl.blessings into v_bl from player pl where pl.world_id = p_world and pl.uid = p.uid;
  if (v_bl->'fend_off'->>'until')::timestamptz > now() then v_fend := (v_bl->'fend_off'->>'push')::double precision; end if;
  if (v_bl->'brace'->>'until')::timestamptz > now() then v_brace := melee_reach(p_world, p.uid); end if;

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
     * A Pikeman's Fend Off: come within its reach of them to strike, a heavy
     * blow drawn back included, it is pushed back instead, over ground it
     * could walk (`shove_point`), and comes on again from there.
     */
    if v_fend is not null and v_dist <= hunt_reach() then
      select * into v_step from shove_point(p_world, c.to_x, c.to_y, p.x, p.y, v_fend);
      if v_step.x is not null then
        c.windup_at := null;
        c.from_x := c.to_x; c.from_y := c.to_y;
        c.to_x := v_step.x; c.to_y := v_step.y;
        c.leg_at := c.until;
        c.leg_ends := c.leg_at + make_interval(secs => sqrt((c.to_x - c.from_x) ^ 2 + (c.to_y - c.from_y) ^ 2) / shove_pace());
        c.until := c.leg_ends;
        perform tell(p_world, p.uid, (select name from class_spell where id = 'pikeman_fend_off') || ': you push the '
          || lower(d.name) || ' back.', 'fight');
        continue;
      end if;
    end if;
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
      c.until := c.until + make_interval(secs => blow_every(d) / (beast_mul(c, 'haste') * class_limbs(p_world, c.id))) + class_stagger_owed(p_world, c.id);
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
        select * into v_step from class_chase_leg(p_world, c.id, c.to_x, c.to_y,
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
        c.until := c.until + make_interval(secs => blow_every(d) / (beast_mul(c, 'haste') * class_limbs(p_world, c.id))) + class_stagger_owed(p_world, c.id);
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
        select * into v_step from class_chase_leg(p_world, c.id, c.to_x, c.to_y, v_ax, v_ay);
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
      select * into v_step from class_chase_leg(p_world, c.id, c.to_x, c.to_y, v_ax, v_ay);
      if v_step.x is null then
        c.hunting := null;
        exit;
      end if;
      c.from_x := c.to_x; c.from_y := c.to_y;
      c.to_x := v_step.x; c.to_y := v_step.y;
      /*
       * A Pikeman braced for the charge: a leg that would carry it from outside
       * their reach into it stops at the edge, where the blow is waiting
       * (`class_owed_pay`), and the first such leg spends the brace.
       */
      if v_brace is not null and v_dist > v_brace and (c.to_x - p.x) ^ 2 + (c.to_y - p.y) ^ 2 < v_brace ^ 2 then
        v_t := circle_entry(c.from_x, c.from_y, c.to_x, c.to_y, p.x, p.y, v_brace);
        c.to_x := c.from_x + (c.to_x - c.from_x) * v_t; c.to_y := c.from_y + (c.to_y - c.from_y) * v_t;
        v_braced := true;
      end if;
      v_secs := greatest(0.2, sqrt((c.to_x - c.from_x) ^ 2 + (c.to_y - c.from_y) ^ 2)
                              / greatest(0.1, v_pace));
      c.leg_at := c.until;
      c.leg_ends := c.leg_at + make_interval(secs => v_secs);
      c.until := c.leg_ends;
      if v_braced then
        insert into class_mark (world_id, creature_id, kind, val, n, until, by_uid)
          values (p_world, c.id, 'brace', 1, 0, c.until, p.uid)
          on conflict (world_id, creature_id, kind) do update set val = excluded.val, n = excluded.n, until = excluded.until, by_uid = excluded.by_uid;
        update player set blessings = blessings - 'brace' where world_id = p_world and uid = p.uid;
        v_brace := null; v_braced := false;
      end if;
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
      c.until := c.until + make_interval(secs => blow_every(d) / (beast_mul(c, 'haste') * class_limbs(p_world, c.id))) + class_stagger_owed(p_world, c.id);
    end if;
  end loop;
  return c;
end $function$;

CREATE OR REPLACE FUNCTION public.brawl_settle(p_world uuid, c creature, d species_def, a age_def)
 RETURNS creature
 LANGUAGE plpgsql
AS $function$
declare q creature; v_cx double precision; v_cy double precision; v_qx double precision; v_qy double precision;
        v_dist double precision; v_guard int := 0; v_step record; v_pace double precision; v_run double precision;
        v_id int := c.id;
begin
  select * into q from creature where world_id = p_world and id = c.brawl;
  v_cx := creature_x(c); v_cy := creature_y(c);
  if q.id is null or q.mode in ('wild', 'stored') or q.health <= 0 or q.hitched_to is not null then
    c.brawl := null;
    return c;
  end if;
  v_qx := creature_x(q); v_qy := creature_y(q);
  if sqrt((v_qx - v_cx) ^ 2 + (v_qy - v_cy) ^ 2) > fight_leash() then
    c.brawl := null;
    return c;
  end if;
  -- Its nerve, as on you (`turns_at`): it runs from what it was fighting.
  if d.hunter and c.health < max_health(c) * turns_at(d) then
    c.brawl := null; c.hunting := null; c.windup_at := null;
    c.hunt_again := now() + make_interval(secs => hunt_rest());
    v_run := d.speed * flee_pace() * flee_secs();
    v_dist := greatest(0.001, sqrt((v_cx - v_qx) ^ 2 + (v_cy - v_qy) ^ 2));
    select * into v_step from class_chase_leg(p_world, c.id, v_cx, v_cy,
      v_cx + (v_cx - v_qx) / v_dist * v_run, v_cy + (v_cy - v_qy) / v_dist * v_run);
    c.from_x := v_cx; c.from_y := v_cy;
    c.to_x := coalesce(v_step.x, v_cx); c.to_y := coalesce(v_step.y, v_cy);
    c.leg_at := now();
    c.leg_ends := now() + make_interval(secs => greatest(0.2, sqrt((c.to_x - v_cx) ^ 2 + (c.to_y - v_cy) ^ 2)
                                               / greatest(0.1, d.speed * a.speed * beast_mul(c, 'speed') * flee_pace())));
    c.until := greatest(c.leg_ends, now() + make_interval(secs => flee_secs()));
    if q.keeper is not null then perform tell(p_world, q.keeper, 'The ' || lower(d.name) || ' turns tail.', 'fight'); end if;
    return c;
  end if;
  -- Only the last few seconds of the gap were spent on it.
  if c.until < now() - make_interval(secs => hunt_window()) then
    c.from_x := v_cx; c.from_y := v_cy; c.to_x := v_cx; c.to_y := v_cy;
    c.until := now() - make_interval(secs => hunt_window());
    c.leg_at := c.until; c.leg_ends := c.until;
  end if;
  v_pace := d.speed * a.speed * beast_mul(c, 'speed') * 1.15;
  while c.until <= now() and v_guard < 12 loop
    v_guard := v_guard + 1;
    v_dist := sqrt((v_qx - c.to_x) ^ 2 + (v_qy - c.to_y) ^ 2);
    if v_dist <= hunt_reach() then
      c.until := c.until + make_interval(secs => blow_every(d) / (beast_mul(c, 'haste') * class_limbs(p_world, c.id)));
      update creature set from_x = c.from_x, from_y = c.from_y, to_x = c.to_x, to_y = c.to_y,
          leg_at = c.leg_at, leg_ends = c.leg_ends, until = c.until, leg = c.leg,
          health = c.health, hunger = c.hunger, fleece = c.fleece, care = c.care,
          hunting = c.hunting, hunt_x = c.hunt_x, hunt_y = c.hunt_y, hunt_again = c.hunt_again,
          fight_blows = c.fight_blows, windup_at = c.windup_at, bleed_rate = c.bleed_rate, bleed_until = c.bleed_until,
          hurt_at = c.hurt_at, pack_lead = c.pack_lead, home_x = c.home_x, home_y = c.home_y,
          brawl = c.brawl, threat_at = c.threat_at, settled_at = now()
        where world_id = p_world and id = v_id;
      if creature_attack(p_world, v_id, q.id) then
        select * into c from creature where world_id = p_world and id = v_id;
        if c.id is not null then c.brawl := null; end if;
        return c;
      end if;
      select * into c from creature where world_id = p_world and id = v_id;
      if c.id is null or c.brawl is null then return c; end if;
      select * into q from creature where world_id = p_world and id = c.brawl;
      if q.id is null then
        c.brawl := null;
        return c;
      end if;
      v_qx := creature_x(q); v_qy := creature_y(q);
    else
      -- A leg that ends a pace short of it, round whatever is between.
      select * into v_step from class_chase_leg(p_world, c.id, c.to_x, c.to_y,
        c.to_x + (v_qx - c.to_x) * (v_dist - 1) / v_dist, c.to_y + (v_qy - c.to_y) * (v_dist - 1) / v_dist);
      if v_step.x is null then
        c.brawl := null;
        exit;
      end if;
      c.from_x := c.to_x; c.from_y := c.to_y;
      c.to_x := v_step.x; c.to_y := v_step.y;
      c.leg_at := c.until;
      c.leg_ends := c.leg_at + make_interval(secs => greatest(0.2, sqrt((c.to_x - c.from_x) ^ 2 + (c.to_y - c.from_y) ^ 2)
                                                     / greatest(0.1, v_pace)));
      c.until := c.leg_ends;
    end if;
  end loop;
  return c;
end $function$;

CREATE OR REPLACE FUNCTION public.creature_settle(p_world uuid, p_id integer)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
declare c creature; d species_def; a age_def; elapsed double precision; top double precision;
        guard int := 0; n int; i int; nx double precision; ny double precision;
        dist double precision; secs double precision; pace double precision; ok boolean;
        home record; ax double precision; ay double precision; v_rig placed; v_bled double precision;
begin
  select * into c from creature where world_id = p_world and id = p_id for update;
  if not found then return false; end if;
  select * into d from species_def where id = c.species;
  a := age_row(c.born, old_of(c));
  /*
   * In the traces until somebody takes it out.
   *
   * A hitch was a column and nothing else read it: the settle below went on
   * walking a companion to its keeper's feet and sending a worker out to its
   * trade, so an animal backed into a yoke was at its owner's heels a second
   * later, still hitched to a wagon it was nowhere near. It stands at the
   * vehicle now, thinks nothing, and does not get hungry, until `unhitch_one`
   * or `unhitch_all` takes it out -- or what it was hitched to is gone, in
   * which case there is nothing left to be in the traces of.
   */
  if c.hitched_to is not null then
    select * into v_rig from placed where world_id = p_world and id = c.hitched_to;
    if not found then
      update creature set hitched_to = null where world_id = p_world and id = p_id;
      c.hitched_to := null;
    end if;
  end if;
  elapsed := extract(epoch from (now() - c.settled_at));
  if elapsed <= 0 then
    -- Nothing has passed for the body — but a worker's day is not its body,
    -- and the trips it is owed are still owed. One in the traces owes none.
    if c.hitched_to is not null then return false; end if;
    if c.mode = 'deed' then perform worker_settle(p_world, p_id);
    elsif c.mode = 'active' then perform companion_settle(p_world, p_id); end if;
    return false;
  end if;

  -- The body: hunger falling, wounds closing, fleece coming back, and a
  -- brushing wearing off. None of it needs a step; it is all just elapsed time.
  top := max_health(c);
  /*
   * A knife's bleeding, for the part of the time since the last settle that it
   * ran, and never the last of it: what finishes a thing is a blow. While it
   * bleeds it is hurt, so it mends nothing (`KNIFE_BLEED`).
   */
  if c.bleed_until is not null then
    v_bled := extract(epoch from (least(now(), c.bleed_until) - c.settled_at));
    if v_bled > 0 then
      if c.health > 1 then c.health := greatest(1, c.health - coalesce(c.bleed_rate, 0) * v_bled); end if;
      c.hurt_at := greatest(coalesce(c.hurt_at, c.settled_at), least(now(), c.bleed_until));
    end if;
    if c.bleed_until <= now() then c.bleed_until := null; c.bleed_rate := null; end if;
  end if;
  -- Except in the traces, where the belly holds where it was when it went in.
  if c.hitched_to is null then
    -- Hungry slower for its keeper's Light Eaters.
    c.hunger := greatest(0, c.hunger - elapsed * hunger_rate(c.mode) * beast_mul(c, 'appetite')
                                   * coalesce((c.kept->>'kept:hunger')::double precision, 1));
  end if;
  if c.health > top then
    c.health := top;
  elsif c.health < top and (c.hurt_at is null or now() - c.hurt_at > interval '6 seconds') then
    c.health := least(top, c.health + elapsed * case when c.mode = 'wild' then 0.25 else 0.6 end * beast_mul(c, 'mend'));
  end if;
  if d.fleece is not null and a.growth > 0 and c.fleece < 1 then
    c.fleece := least(1, c.fleece + elapsed * d.fleece * a.growth * beast_mul(c, 'grow'));
  end if;
  -- A brushing wears off over a few hours: longer for its keeper's Lasting Care.
  c.care := greatest(0, c.care - elapsed / (coalesce((c.kept->>'kept:care_hours')::double precision, care_hours()) * 3600));
  /*
   * And a hungry one on a deed goes to the stores.
   *
   * Written on the row rather than on `c`, so the settle below does not carry
   * the old belly back over it. Only when it is actually hungry, which for a
   * worker is an hour or so apart — this is not a cost anybody pays on a beat.
   */
  if c.mode <> 'wild' and c.hitched_to is null and c.hunger < graze_hungry() then
    if worker_feed(p_world, p_id) is not null then
      c.hunger := least(1, c.hunger + graze_fill());
    end if;
  end if;

  -- And no further: it stands at the vehicle, the body settled and nothing else.
  if c.hitched_to is not null then
    update creature set
        from_x = v_rig.cx, from_y = v_rig.cy, to_x = v_rig.cx, to_y = v_rig.cy,
        leg_at = now(), leg_ends = now(), until = now(),
        health = c.health, fleece = c.fleece, care = c.care,
        enemy = null, hunting = null, settled_at = now()
      where world_id = p_world and id = p_id;
    return true;
  end if;

  if c.mode = 'wild' then
    -- A hunter looks for you; anything else you struck that stands and fights is after you already (`engage_beast`).
    -- A tame thing that hurt it, first, while it is on one (`brawl_settle`).
    if c.brawl is not null then c := brawl_settle(p_world, c, d, a); end if;
    if c.id is not null and c.brawl is null and (d.hunter or c.hunting is not null) then c := hunt_settle(p_world, c, d, a); end if;
  else
    c.hunting := null;
    c.brawl := null;
  end if;

  if c.mode = 'wild' and c.hunting is null and c.brawl is null then
    pace := d.speed * a.speed * beast_mul(c, 'speed') * 0.7;
    while c.until <= now() and guard < catch_up_legs() loop
      guard := guard + 1;
      n := c.leg + 1;
      ok := false;
      -- A step about its own country rather than a step from wherever it
      -- last got to. Past the edge of its range it draws towards home
      -- instead, which is what keeps an island's wildlife somewhere in
      -- particular. A creature from before homes existed takes where it
      -- stands, which is what it would have had anyway.
      if c.home_x is null then c.home_x := c.to_x; c.home_y := c.to_y; end if;
      -- A pack keeps closer to home, so that it is met together (`pack_range`).
      if (c.to_x - c.home_x) ^ 2 + (c.to_y - c.home_y) ^ 2 > (case when d.pack then pack_range() else wild_range() end) ^ 2 then
        ax := c.home_x; ay := c.home_y;
      else
        ax := c.to_x; ay := c.to_y;
      end if;
      for i in 0..7 loop
        nx := ax + (hash_tile(p_id, n, 7001 + i) * 2 - 1) * wild_reach();
        ny := ay + (hash_tile(p_id, n, 9001 + i) * 2 - 1) * wild_reach();
        if creature_tile_ok(p_world, floor(nx)::int, floor(ny)::int)
           and line_clear(p_world, c.to_x, c.to_y, nx, ny) then ok := true; exit; end if;
      end loop;
      c.leg := n;
      if not ok then
        -- Hemmed in: stand where it is and look again in a moment.
        c.from_x := c.to_x; c.from_y := c.to_y;
        c.leg_at := c.until; c.leg_ends := c.until;
        c.until := c.until + interval '2 seconds';
        continue;
      end if;
      -- It feeds itself on the way. The browser walks it to a forage bed,
      -- grazes for a few seconds and tops the belly up; out here the leg that
      -- ends on ground worth grazing is the same thing without the detail.
      if c.hunger < graze_hungry() and coalesce((select forage from tile_def
            where id = land_tile(p_world, floor(nx)::int, floor(ny)::int)), false) then
        c.hunger := least(1, c.hunger + graze_fill());
      end if;
      -- No further than a Root or a Tether lets it (`class_leash_point`).
      select lp.x, lp.y into nx, ny from class_leash_point(p_world, p_id, nx, ny) lp;
      dist := sqrt((nx - c.to_x) ^ 2 + (ny - c.to_y) ^ 2);
      secs := greatest(0.2, dist / greatest(0.1, pace));
      c.from_x := c.to_x; c.from_y := c.to_y;
      c.to_x := nx; c.to_y := ny;
      c.leg_at := c.until;
      c.leg_ends := c.leg_at + make_interval(secs => secs);
      c.until := c.leg_ends + make_interval(secs => wild_rest() + hash_tile(p_id, n, 11001) * wild_rest_spread());
    end loop;
    /*
     * And past the cap it is where it got to, and the clock catches up with
     * it. This line is the whole reason the cap can come down: it was already
     * here, and it was already the answer for anything more than forty legs
     * behind. Forty was doing an eighth of a second of arithmetic to reach an
     * answer this line gives for nothing.
     *
     * Measured, on a creature an hour behind: 109.10 ms with the cap at forty,
     * against 4.78 ms for one a second behind. Every one of those legs is a
     * random step inside a home range nobody was standing in.
     */
    if c.until <= now() then
      c.from_x := c.to_x; c.from_y := c.to_y;
      c.leg_at := now(); c.leg_ends := now();
      c.until := now() + make_interval(secs => 1 + hash_tile(p_id, c.leg, 11001) * 5);
    end if;
  elsif c.mode = 'active' and c.keeper is not null and c.enemy is null then
    -- A companion is wherever its keeper is; following is not a walk of its own.
    -- A fight is, and one with something in its teeth keeps the legs it has:
    -- `companion_settle`, below, walks it, strikes, and brings it back to heel.
    select p.x, p.y into home from player p where p.world_id = p_world and p.uid = c.keeper;
    -- Piers: but not onto a tile on piers, where it does not go: it waits where it is (`creature_tile_ok`).
    if found and not on_piers(p_world, floor(home.x)::int, floor(home.y)::int) then
      c.from_x := home.x; c.from_y := home.y; c.to_x := home.x; c.to_y := home.y;
      c.leg_at := now(); c.leg_ends := now(); c.until := now();
    end if;
  elsif c.mode = 'stored' then
    -- In a crate: where the crate stands, or at the feet of whoever carries it.
    select pl.cx as x, pl.cy as y into home from placed pl where pl.world_id = p_world and pl.creature = p_id limit 1;
    if not found then
      select py.x, py.y into home from player py where py.world_id = p_world and py.uid = c.keeper;
    end if;
    if found then
      c.from_x := home.x; c.from_y := home.y; c.to_x := home.x; c.to_y := home.y;
      -- A crated one never walks, so it is not asked every round.
      c.leg_at := now(); c.leg_ends := now(); c.until := now() + make_interval(secs => stored_settle());
    end if;
  end if;

  update creature set
      from_x = c.from_x, from_y = c.from_y, to_x = c.to_x, to_y = c.to_y,
      leg_at = c.leg_at, leg_ends = c.leg_ends, until = c.until, leg = c.leg,
      health = c.health, hunger = c.hunger, fleece = c.fleece, care = c.care,
      hunting = c.hunting, hunt_x = c.hunt_x, hunt_y = c.hunt_y, hunt_again = c.hunt_again,
      fight_blows = c.fight_blows, windup_at = c.windup_at, bleed_rate = c.bleed_rate, bleed_until = c.bleed_until,
      hurt_at = c.hurt_at, pack_lead = c.pack_lead, brawl = c.brawl, threat_at = c.threat_at,
      home_x = c.home_x, home_y = c.home_y,
      settled_at = now()
    where world_id = p_world and id = p_id;
  -- And then the day's work, for whichever of them is on a deed rather than
  -- out in the country. The row goes down first because the work reads it back.
  if c.mode = 'deed' then perform worker_settle(p_world, p_id);
  -- And a companion's company, which is the one thing at heel that is a walk of its own.
  elsif c.mode = 'active' then perform companion_settle(p_world, p_id); end if;
  -- And what a Retribution dealt back to it while it struck, now that it is written down (`faith_owed_pay`).
  perform faith_owed_pay(p_world, p_id);
  -- And a Brace for the Charge waiting for it at the edge of somebody's reach (`class_owed_pay`).
  perform class_owed_pay(p_world, p_id);
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
  -- And one that is burning lands its share less on a Kindler's Flame Ward (`class_burning`).
  if v_from.id is not null and pk(p.class_mul, 'ward:burning', 1) <> 1 and class_burning(p_world, v_from.id) then
    p_raw := p_raw * pk(p.class_mul, 'ward:burning', 1);
  end if;
  -- And one held, rooted or slowed lands its share less on a Binder's Frost Ward (`class_stilled`),
  if v_from.id is not null and pk(p.class_mul, 'ward:stilled', 1) <> 1 and class_stilled(p_world, v_from) then
    p_raw := p_raw * pk(p.class_mul, 'ward:stilled', 1);
  end if;
  -- and one inside a Dull Claws lands its share less on anybody (`class_dull`),
  if v_from.id is not null then p_raw := p_raw * class_dull(p_world, v_from.id); end if;
  -- and every blow its share less inside a Binder's Still Skin.
  if (p.blessings->'still_skin'->>'until')::timestamptz > now() then
    p_raw := p_raw * (1 - (p.blessings->'still_skin'->>'cut')::double precision);
  end if;
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
  -- And set alight for a Kindler's Burning Retort: owed now, lit once its row is written (`class_owed_pay`).
  if v_from.id is not null and pk(p.class_mul, 'retort:each', 0) > 0 then
    insert into class_mark (world_id, creature_id, kind, val, until, by_uid)
      values (p_world, v_from.id, 'retort', pk(p.class_mul, 'retort:each', 0), now(), p_uid)
      on conflict (world_id, creature_id, kind) do update set val = excluded.val, by_uid = excluded.by_uid;
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
  delete from class_mark where world_id = p_world and creature_id = p_id and kind in ('warned', 'exposed', 'marked', 'burn', 'hold', 'root', 'tether', 'limbs', 'dull', 'brittle') and until < now();
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
  -- And a blow it landed on a Kindler with a Burning Retort: it burns, as a burn they started (`class_burn`).
  delete from class_mark where world_id = p_world and creature_id = p_id and kind = 'retort'
    returning * into m;
  if m.creature_id is not null and m.by_uid is not null then
    perform class_burn(p_world, m.by_uid, p_id, m.val, pk(p_world, m.by_uid, 'retort:secs', 0));
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
        v_cost double precision;
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
    -- Less for a Kindler's Deep Breath.
    v_cost := s.cost * pk(p.class_mul, 'cast:cost', 1);
    if v_stamina < v_cost then
      return s.name || ' costs ' || trim_scale(round((v_cost * 100)::numeric, 1)) || '% of your stamina; you have '
        || floor(v_stamina * 100)::int || '%.';
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
    -- And a Kindler's a focus of the school's stones in your pack, to cast it out of (`kindler_focus`).
    if v_needs = 'kindling' and (kindler_focus(p_world, p_uid)).id is null then
      return s.name || ' wants a garnet or ruby focus in your pack.';
    end if;
    -- And a Binder's a focus of its school's stones (`school_focus`).
    if v_needs = 'binding' and (school_focus(p_world, p_uid, 'binding')).id is null then
      return s.name || ' wants a sapphire or diamond focus in your pack.';
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
        v_fire double precision := 0; v_fired boolean := false; v_burn class_mark; v_burnt jsonb;
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
                    -- A Kindler's as far as each says.
                    when s.class = 'kindler' then spell_fx(p_spell, 'reach')
                    -- A Binder's as far as each says, further for Far Reach, and further again in a Long Hold.
                    when s.class = 'binder' then (spell_fx(p_spell, 'reach') + pk(me.class_mul, 'reach:spell', 0))
                                                 * class_mul(me.class_mul, 'reach', 'binding')
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

  when 'kindler_scorch' then
    b := kindler_fire(p_world, p_uid, c.id, kindler_fire_at(p_world, p_uid) * spell_fx(p_spell, 'fire'));
    v_fired := true;
    v_said := kindler_said(s.name, b) || kindler_burn_said(case when (b->>'landed')::boolean and not (b->>'died')::boolean
      then class_burn(p_world, p_uid, c.id, spell_fx(p_spell, 'each'), spell_fx(p_spell, 'secs')) end);

  when 'kindler_heat_seeker' then
    -- Every enemy within its reach settled first, so the share of its health each has left is what it has now.
    for r in select cr.id from creature cr
              where cr.world_id = p_world and cr.mode = 'wild' and cr.health > 0
                and cr.to_x between me.x - (spell_fx(p_spell, 'reach') + leg_slack()) and me.x + (spell_fx(p_spell, 'reach') + leg_slack())
                and cr.to_y between me.y - (spell_fx(p_spell, 'reach') + leg_slack()) and me.y + (spell_fx(p_spell, 'reach') + leg_slack())
                and (creature_x(cr) - me.x) ^ 2 + (creature_y(cr) - me.y) ^ 2 <= spell_fx(p_spell, 'reach') ^ 2
              order by cr.id loop
      perform creature_settle(p_world, r.id);
    end loop;
    select cr.id into v_id from creature cr
     where cr.world_id = p_world and cr.mode = 'wild' and cr.health > 0
                and cr.to_x between me.x - (spell_fx(p_spell, 'reach') + leg_slack()) and me.x + (spell_fx(p_spell, 'reach') + leg_slack())
                and cr.to_y between me.y - (spell_fx(p_spell, 'reach') + leg_slack()) and me.y + (spell_fx(p_spell, 'reach') + leg_slack())
                and (creature_x(cr) - me.x) ^ 2 + (creature_y(cr) - me.y) ^ 2 <= spell_fx(p_spell, 'reach') ^ 2
     order by cr.health / max_health(cr), (creature_x(cr) - me.x) ^ 2 + (creature_y(cr) - me.y) ^ 2, cr.id
     limit 1;
    if v_id is null then
      return jsonb_build_object('why', 'Nothing is within ' || trim_scale(spell_fx(p_spell, 'reach')::numeric) || ' tiles of you to strike.');
    end if;
    b := kindler_fire(p_world, p_uid, v_id, kindler_fire_at(p_world, p_uid) * spell_fx(p_spell, 'fire'));
    v_fired := true;
    v_said := kindler_said(s.name, b);

  when 'kindler_scald' then
    b := kindler_fire(p_world, p_uid, c.id, kindler_fire_at(p_world, p_uid) * spell_fx(p_spell, 'fire'));
    v_fired := true;
    v_said := kindler_said(s.name, b);
    if (b->>'landed')::boolean and not (b->>'died')::boolean then
      update creature set slow = spell_fx(p_spell, 'pace'), slow_until = now() + make_interval(secs => spell_fx(p_spell, 'secs'))
        where world_id = p_world and id = c.id;
      v_said := v_said || ' For ' || faith_span(spell_fx(p_spell, 'secs')) || ' it goes at '
        || faith_pct(spell_fx(p_spell, 'pace')) || ' of its pace.';
    end if;

  when 'kindler_flash_fire' then
    b := kindler_fire(p_world, p_uid, c.id, kindler_fire_at(p_world, p_uid) * spell_fx(p_spell, 'fire'));
    v_fired := true;
    v_said := kindler_said(s.name, b);

  when 'kindler_stoke' then
    -- Spent by the next of your spells that deals fire (`kindler_fire_at`), at the end of its cast.
    perform blessing_put(p_world, p_uid, 'stoke', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'more', spell_fx(p_spell, 'more')));
    v_said := s.name || ': the next spell of yours within ' || faith_span(spell_fx(p_spell, 'secs')) || ' that deals fire deals '
      || faith_pct(spell_fx(p_spell, 'more') - 1) || ' more of it.';

  when 'kindler_firebrand' then
    -- On every burn you start while it holds (`class_burn`).
    perform blessing_put(p_world, p_uid, 'firebrand', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'long', spell_fx(p_spell, 'long')));
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' every burn you start lasts '
      || case when spell_fx(p_spell, 'long') = 2 then 'twice' else trim_scale(spell_fx(p_spell, 'long')::numeric) || ' times' end
      || ' as long.';

  when 'kindler_immolate' then
    v_burnt := class_burn(p_world, p_uid, c.id, spell_fx(p_spell, 'each'), spell_fx(p_spell, 'secs'));
    if v_burnt is null then return jsonb_build_object('why', 'Nothing burns inside a Truce.'); end if;
    perform class_learn(p_world, p_uid, class_learn_blow());
    perform engage_beast(p_world, c.id, p_uid);
    v_said := s.name || ': the ' || lower(d.name) || ' catches.' || kindler_burn_said(v_burnt);

  when 'kindler_combust' then
    -- What its burn still had to do (`class_burn`), all at once, and then it is out, and its bleeding with it.
    select * into v_burn from class_mark where world_id = p_world and creature_id = c.id and kind = 'burn' and until > now();
    if v_burn.creature_id is null then return jsonb_build_object('why', 'The ' || lower(d.name) || ' is not burning.'); end if;
    v_hp := v_burn.val * extract(epoch from (v_burn.until - now())) * spell_fx(p_spell, 'more');
    delete from class_mark where world_id = p_world and creature_id = c.id and kind = 'burn';
    update creature set bleed_rate = null, bleed_until = null where world_id = p_world and id = c.id;
    b := kindler_fire(p_world, p_uid, c.id, v_hp);
    v_said := s.name || ': the burn on the ' || lower(d.name) || ' goes up at once, ' || round(v_hp::numeric) || ' of it'
      || case when (b->>'died')::boolean then ', and it dies.'
              else '. It is down to ' || (b->>'left') || ' of ' || (b->>'of') || '.' end;

  when 'kindler_blaze_aura' then
    -- Burned a round at a time by the clock (`class_aura`), at the fire you had when you cast it.
    v_fire := kindler_fire_at(p_world, p_uid) * spell_fx(p_spell, 'fire');
    perform blessing_put(p_world, p_uid, 'blaze_aura', jsonb_build_object('from', now(), 'at', now(),
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'fire', v_fire, 'share', spell_fx(p_spell, 'fire'),
      'reach', spell_fx(p_spell, 'reach')));
    v_fired := true;
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' everything wild within '
      || trim_scale(spell_fx(p_spell, 'reach')::numeric) || ' tiles of you takes ' || trim_scale(round(v_fire::numeric, 1))
      || ' of fire a second.';

  when 'kindler_inferno_bolt' then
    b := kindler_fire(p_world, p_uid, c.id, kindler_fire_at(p_world, p_uid) * spell_fx(p_spell, 'fire'));
    v_fired := true;
    v_said := kindler_said(s.name, b) || kindler_burn_said(case when (b->>'landed')::boolean and not (b->>'died')::boolean
      then class_burn(p_world, p_uid, c.id, spell_fx(p_spell, 'each'), spell_fx(p_spell, 'secs')) end);

  when 'kindler_meteor' then
    -- The one it was cast at, and every other within its width of where that one stood.
    v_fire := kindler_fire_at(p_world, p_uid);
    v_x := creature_x(c); v_y := creature_y(c);
    b := kindler_fire(p_world, p_uid, c.id, v_fire * spell_fx(p_spell, 'fire'));
    v_fired := true;
    for r in select cr.id from creature cr
              where cr.world_id = p_world and cr.mode = 'wild' and cr.health > 0
                and cr.to_x between v_x - (spell_fx(p_spell, 'wide') + leg_slack()) and v_x + (spell_fx(p_spell, 'wide') + leg_slack())
                and cr.to_y between v_y - (spell_fx(p_spell, 'wide') + leg_slack()) and v_y + (spell_fx(p_spell, 'wide') + leg_slack())
                and (creature_x(cr) - v_x) ^ 2 + (creature_y(cr) - v_y) ^ 2 <= spell_fx(p_spell, 'wide') ^ 2 and cr.id <> c.id
              order by cr.id loop
      v_on := kindler_fire(p_world, p_uid, r.id, v_fire * spell_fx(p_spell, 'splash'));
      if (v_on->>'landed')::boolean then v_n := v_n + 1; end if;
      if (v_on->>'died')::boolean then v_dead := v_dead + 1; end if;
    end loop;
    v_said := kindler_said(s.name, b) || case when v_n = 0 then '' else ' ' || v_n
      || case when v_n = 1 then ' more creature is' else ' more creatures are' end || ' caught in it'
      || case when v_dead = 0 then '.' when v_n = 1 then ', and it dies.' when v_dead = 1 then ', and one of them dies.'
              else ', and ' || v_dead || ' of them die.' end end;

  when 'kindler_firestorm' then
    -- Every enemy within its reach of you, and each the fire leaves standing burns.
    v_fire := kindler_fire_at(p_world, p_uid);
    for r in select cr.id from creature cr
              where cr.world_id = p_world and cr.mode = 'wild' and cr.health > 0
                and cr.to_x between me.x - (spell_fx(p_spell, 'reach') + leg_slack()) and me.x + (spell_fx(p_spell, 'reach') + leg_slack())
                and cr.to_y between me.y - (spell_fx(p_spell, 'reach') + leg_slack()) and me.y + (spell_fx(p_spell, 'reach') + leg_slack())
                and (creature_x(cr) - me.x) ^ 2 + (creature_y(cr) - me.y) ^ 2 <= spell_fx(p_spell, 'reach') ^ 2
              order by cr.id loop
      v_on := kindler_fire(p_world, p_uid, r.id, v_fire * spell_fx(p_spell, 'fire'));
      if (v_on->>'landed')::boolean then
        v_n := v_n + 1;
        if (v_on->>'died')::boolean then v_dead := v_dead + 1;
        else v_burnt := coalesce(class_burn(p_world, p_uid, r.id, spell_fx(p_spell, 'each'), spell_fx(p_spell, 'secs')), v_burnt);
        end if;
      end if;
    end loop;
    if v_n = 0 then
      return jsonb_build_object('why', 'Nothing is within ' || trim_scale(spell_fx(p_spell, 'reach')::numeric) || ' tiles of you to strike.');
    end if;
    v_fired := true;
    v_said := s.name || ': ' || v_n || case when v_n = 1 then ' creature is' else ' creatures are' end || ' caught in it'
      || case when v_dead = 0 then '.' when v_n = 1 then ', and it dies.' when v_dead = 1 then ', and one of them dies.'
              else ', and ' || v_dead || ' of them die.' end
      || case when v_burnt is null then ''
              else ' ' || case when v_dead = 0 and v_n = 1 then 'It burns ' when v_dead = 0 then 'They burn '
                               when v_n - v_dead = 1 then 'The other burns ' else 'The rest burn ' end
                || trim_scale(round(((v_burnt->>'each')::double precision * 100)::numeric, 1)) || '% of '
                || case when v_n - v_dead = 1 then 'its' else 'their' end || ' health a second for '
                || faith_span((v_burnt->>'secs')::double precision) || '.' end;

  when 'binder_bind' then
    perform engage_beast(p_world, c.id, p_uid);
    v_hp := class_bind(p_world, p_uid, c.id, spell_fx(p_spell, 'hold'), spell_fx(p_spell, 'monster'));
    perform class_learn(p_world, p_uid, class_learn_blow());
    v_said := s.name || ': the ' || lower(d.name) || ' is held where it stands for ' || faith_span(v_hp) || '.';

  when 'binder_lock' then
    perform engage_beast(p_world, c.id, p_uid);
    v_hp := class_bind(p_world, p_uid, c.id, spell_fx(p_spell, 'hold'), spell_fx(p_spell, 'monster'));
    perform class_learn(p_world, p_uid, class_learn_blow());
    v_said := s.name || ': the ' || lower(d.name) || ' is held where it stands for ' || faith_span(v_hp) || '.';

  when 'binder_shatter' then
    -- Larger on one held, by anybody's hold (`class_held`).
    v_windup := class_held(p_world, c.id);
    b := kindler_fire(p_world, p_uid, c.id, binder_shatter_at(p_world, p_uid)
           * case when v_windup then spell_fx(p_spell, 'held') else spell_fx(p_spell, 'shatter') end);
    v_said := binder_said(s.name, b);

  when 'binder_root' then
    perform engage_beast(p_world, c.id, p_uid);
    perform class_leash(p_world, c.id, 'root', 0, spell_fx(p_spell, 'secs'), p_uid);
    perform class_learn(p_world, p_uid, class_learn_blow());
    v_said := s.name || ': the ' || lower(d.name) || ' is rooted where it stands for ' || faith_span(spell_fx(p_spell, 'secs')) || '.';

  when 'binder_tether' then
    perform engage_beast(p_world, c.id, p_uid);
    perform class_leash(p_world, c.id, 'tether', spell_fx(p_spell, 'leash'), spell_fx(p_spell, 'secs'), p_uid);
    perform class_learn(p_world, p_uid, class_learn_blow());
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' the ' || lower(d.name) || ' cannot go more than '
      || trim_scale(spell_fx(p_spell, 'leash')::numeric) || ' tiles from where it stands.';

  when 'binder_heavy_limbs' then
    perform engage_beast(p_world, c.id, p_uid);
    perform class_mark_put(p_world, c.id, 'limbs', spell_fx(p_spell, 'often'), spell_fx(p_spell, 'secs'), p_uid);
    perform class_learn(p_world, p_uid, class_learn_blow());
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' the ' || lower(d.name) || ' strikes ' || faith_pct(1 - spell_fx(p_spell, 'often')) || ' less often.';

  when 'binder_dull_claws' then
    perform engage_beast(p_world, c.id, p_uid);
    perform class_mark_put(p_world, c.id, 'dull', spell_fx(p_spell, 'dealt'), spell_fx(p_spell, 'secs'), p_uid);
    perform class_learn(p_world, p_uid, class_learn_blow());
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' the ' || lower(d.name) || '''s blows land ' || faith_pct(1 - spell_fx(p_spell, 'dealt')) || ' smaller.';

  when 'binder_brittle' then
    perform engage_beast(p_world, c.id, p_uid);
    perform class_mark_put(p_world, c.id, 'brittle', spell_fx(p_spell, 'taken'), spell_fx(p_spell, 'secs'), p_uid);
    perform class_learn(p_world, p_uid, class_learn_blow());
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' the ' || lower(d.name) || ' takes ' || faith_pct(spell_fx(p_spell, 'taken') - 1) || ' more from everything that strikes it.';

  when 'binder_stillness' then
    perform wounds_settle(p_world, p_uid);
    if not exists (select 1 from player pl, jsonb_array_elements(coalesce(pl.wounds, '[]'::jsonb)) t(w)
                    where pl.world_id = p_world and pl.uid = p_uid and coalesce((w->>'bleeding')::boolean, false)) then
      return jsonb_build_object('why', 'Nothing on you is bleeding.');
    end if;
    update player set wounds = (select coalesce(jsonb_agg(jsonb_set(w, '{bleeding}', 'false')), '[]'::jsonb)
                                  from jsonb_array_elements(coalesce(wounds, '[]'::jsonb)) t(w))
     where world_id = p_world and uid = p_uid;
    v_said := s.name || ': every wound on you stops bleeding.';

  when 'binder_still_skin' then
    -- On every blow that lands on you while it holds (`hurt_player`).
    perform blessing_put(p_world, p_uid, 'still_skin', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'cut', spell_fx(p_spell, 'cut')));
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' you take ' || faith_pct(spell_fx(p_spell, 'cut'))
      || ' less from every blow.';

  when 'binder_mire' then
    -- Every enemy within its width of you, further in a Long Hold: the slower of its slow and this, to the later end.
    v_reach := spell_fx(p_spell, 'reach') * class_mul(me.class_mul, 'reach', 'binding');
    for r in select cr.id from creature cr
              where cr.world_id = p_world and cr.mode = 'wild' and cr.health > 0
                and cr.to_x between me.x - (v_reach + leg_slack()) and me.x + (v_reach + leg_slack())
                and cr.to_y between me.y - (v_reach + leg_slack()) and me.y + (v_reach + leg_slack())
                and (creature_x(cr) - me.x) ^ 2 + (creature_y(cr) - me.y) ^ 2 <= v_reach ^ 2
              order by cr.id loop
      perform creature_settle(p_world, r.id);
      update creature set slow = case when slow_until > now() then least(coalesce(slow, 1), spell_fx(p_spell, 'pace'))
                                      else spell_fx(p_spell, 'pace') end,
          slow_until = greatest(coalesce(slow_until, now()), now() + make_interval(secs => spell_fx(p_spell, 'secs')))
        where world_id = p_world and id = r.id and health > 0;
      if found then
        v_n := v_n + 1;
        perform engage_beast(p_world, r.id, p_uid);
        perform class_learn(p_world, p_uid, class_learn_blow());
      end if;
    end loop;
    if v_n = 0 then
      return jsonb_build_object('why', 'Nothing is within ' || trim_scale(round(v_reach::numeric, 1)) || ' tiles of you to strike.');
    end if;
    v_said := s.name || ': ' || v_n || case when v_n = 1 then ' creature goes' else ' creatures go' end || ' at '
      || faith_pct(spell_fx(p_spell, 'pace')) || ' of ' || case when v_n = 1 then 'its' else 'their' end || ' pace for '
      || faith_span(spell_fx(p_spell, 'secs')) || '.';

  when 'binder_mass_root' then
    -- Every enemy within its width of you, further in a Long Hold, rooted where it stands.
    v_reach := spell_fx(p_spell, 'reach') * class_mul(me.class_mul, 'reach', 'binding');
    for r in select cr.id from creature cr
              where cr.world_id = p_world and cr.mode = 'wild' and cr.health > 0
                and cr.to_x between me.x - (v_reach + leg_slack()) and me.x + (v_reach + leg_slack())
                and cr.to_y between me.y - (v_reach + leg_slack()) and me.y + (v_reach + leg_slack())
                and (creature_x(cr) - me.x) ^ 2 + (creature_y(cr) - me.y) ^ 2 <= v_reach ^ 2
              order by cr.id loop
      perform creature_settle(p_world, r.id);
      if exists (select 1 from creature where world_id = p_world and id = r.id and health > 0) then
        perform engage_beast(p_world, r.id, p_uid);
        perform class_leash(p_world, r.id, 'root', 0, spell_fx(p_spell, 'secs'), p_uid);
        perform class_learn(p_world, p_uid, class_learn_blow());
        v_n := v_n + 1;
      end if;
    end loop;
    if v_n = 0 then
      return jsonb_build_object('why', 'Nothing is within ' || trim_scale(round(v_reach::numeric, 1)) || ' tiles of you to strike.');
    end if;
    v_said := s.name || ': ' || v_n || case when v_n = 1 then ' creature is' else ' creatures are' end || ' rooted where '
      || case when v_n = 1 then 'it stands' else 'they stand' end || ' for ' || faith_span(spell_fx(p_spell, 'secs')) || '.';

  else
    return jsonb_build_object('why', 'Nothing is written behind that spell yet.');
  end case;

  -- A Kindler's spell is cast out of the stone, and teaches the school as an Ember does (`rpc_spell`); and one that dealt fire
  -- spends the Stoke that was waiting for it (`kindler_fire_at`).
  if s.class = 'kindler' then
    perform skill_raise(p_world, p_uid, 'kindling', 0.8);
    if v_fired then
      update player set blessings = blessings - 'stoke' where world_id = p_world and uid = p_uid and blessings ? 'stoke';
    end if;
  end if;
  -- And a Binder's teaches binding the same.
  if s.class = 'binder' then perform skill_raise(p_world, p_uid, 'binding', 0.8); end if;

  -- The blow it struck goes back with the sentence, for whoever cast it to read the numbers of (`class_blow`).
  return jsonb_build_object('said', v_said)
    || case when b is not null then jsonb_build_object('blow', b) else '{}'::jsonb end
    || case when v_put is not null then jsonb_build_object('put', v_put) else '{}'::jsonb end
    || case when v_pace is not null then jsonb_build_object('pace', v_pace) else '{}'::jsonb end;
end $function$;


/*
 * What a blow, a shot, a fire and a shatter say a creature is down to, read off
 * the creature after it: a Brittle, a Brittle Hold or a Mark of Judgment makes
 * it take more than the blow was (`wound_beast`). And a Snare or a Still field
 * out of the school marks its hold as a trade's does (`class_hold`), so that
 * a Shatter is the larger on it and a Frost Ward asks it.
 */
CREATE OR REPLACE FUNCTION public.class_blow(p_world uuid, p_uid uuid, p_id integer, p_more double precision, p_sure boolean DEFAULT false, p_blow text DEFAULT NULL::text, p_miss double precision DEFAULT 1, p_crit double precision DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare p player; c creature; d species_def; w weapon_def; held item; v_landed boolean; v_crit boolean := false;
        v_dmg double precision := 0; v_bane double precision; v_died boolean := false; v_hit double precision;
        v_left double precision;
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
  -- What it is down to as it stands after the blow, which a Brittle or a Mark of Judgment made more than the blow (`wound_beast`).
  v_left := case when v_died then 0 else coalesce((select health from creature where world_id = p_world and id = c.id), 0) end;
  return jsonb_build_object('landed', v_landed, 'died', v_died, 'crit', v_crit, 'dmg', v_dmg,
    'left', greatest(0, ceil(v_left)), 'of', max_health(c), 'name', lower(d.name));
end $function$;

CREATE OR REPLACE FUNCTION public.class_shot(p_world uuid, p_uid uuid, p_id integer, p_more double precision, p_sure boolean DEFAULT false, p_crit double precision DEFAULT 1, p_steady boolean DEFAULT false, p_arrow text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare p player; c creature; d species_def; held item; bow weapon_def; arrow item; v_head text; v_dist double precision;
        v_left double precision;
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
  -- What it is down to as it stands after the shot, which a Brittle or a Mark of Judgment made more than the shot (`wound_beast`).
  v_left := case when v_died then 0 else coalesce((select health from creature where world_id = p_world and id = c.id), 0) end;
  return jsonb_build_object('landed', v_landed, 'died', v_died, 'crit', v_crit, 'dmg', v_dmg,
    'left', greatest(0, ceil(v_left)), 'of', max_health(c), 'name', lower(d.name), 'arrow', arrow.def);
end $function$;

CREATE OR REPLACE FUNCTION public.kindler_fire(p_world uuid, p_uid uuid, p_id integer, p_dmg double precision, p_learn double precision DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare c creature; d species_def; v_died boolean; v_left double precision; v_landed boolean;
begin
  perform creature_settle(p_world, p_id);
  select * into c from creature where world_id = p_world and id = p_id;
  if c.id is null or c.health <= 0 then
    return jsonb_build_object('landed', false, 'died', false, 'dmg', 0, 'name', 'creature');
  end if;
  select * into d from species_def where id = c.species;
  v_died := hurt_creature(p_world, p_id, p_dmg, p_uid);
  v_left := case when v_died then 0 else coalesce((select health from creature where world_id = p_world and id = p_id), 0) end;
  -- Nothing at all inside a Truce (`wound_beast`), which is no fire to learn from.
  v_landed := v_died or v_left < c.health;
  if v_landed then
    perform class_learn(p_world, p_uid, class_learn_blow() * p_learn + case when v_died then class_learn_kill() else 0 end);
    if not v_died then perform engage_beast(p_world, p_id, p_uid); end if;
  end if;
  -- What came off it, which a Brittle or a Mark of Judgment makes more than the fire (`wound_beast`).
  return jsonb_build_object('landed', v_landed, 'died', v_died,
    'dmg', case when v_landed and not v_died then c.health - v_left else p_dmg end,
    'left', greatest(0, ceil(v_left)), 'of', max_health(c), 'name', lower(d.name));
end $function$;

CREATE OR REPLACE FUNCTION public.do_spell(p_world uuid, p_uid uuid, p_spell text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare d spell_def; p player; it item; v_force double precision; v_secs double precision;
        v_rng double precision; v_n int := 0; c creature; r record; v_name text;
        v_cx double precision; v_cy double precision;
begin
  select * into d from spell_def where id = p_spell;
  select * into p from player where world_id = p_world and uid = p_uid;
  it := focus_for(p_world, p_uid, d.gem);
  v_force := spell_force(p_world, p_uid, d, it);
  -- And a hold the longer for the focus setter's Keen Focus.
  v_secs := spell_secs(p_world, p_uid, d) * mark_of(it.mark, 'force');
  v_rng := spell_range(p_world, p_uid, d);
  v_name := 'it';

  if d.school = 'kindling' then
    if d.at_what = 'creature' then
      select * into c from creature where world_id = p_world and id = (p_target->>'id')::int;
      if not found then return 'There is nothing there.'; end if;
      v_name := lower((select name from species_def where id = c.species));
      perform wound_beast(p_world, c.id, v_force, p.x, p.y, p_uid, null);
      v_n := round(v_force);
    else
      for c in select * from creature where world_id = p_world and mode = 'wild'
          and to_x between p.x - v_rng and p.x + v_rng
          and to_y between p.y - v_rng and p.y + v_rng loop
        perform wound_beast(p_world, c.id, v_force, p.x, p.y, p_uid, null);
        v_n := v_n + 1;
      end loop;
    end if;

  elsif d.school = 'binding' then
    /*
     * A hold is the `until` the clock already reads before it settles an
     * animal: set it forward and the animal is simply not due, which is what
     * standing still is here. The leg it was on is ended where it had got to,
     * so it stops rather than sliding on to wherever it was going.
     */
    if d.at_what = 'creature' then
      select * into c from creature where world_id = p_world and id = (p_target->>'id')::int;
      if not found then return 'There is nothing there.'; end if;
      v_name := lower((select name from species_def where id = c.species));
      v_cx := creature_x(c); v_cy := creature_y(c);
      update creature set until = now() + make_interval(secs => v_secs),
             from_x = v_cx, from_y = v_cy, to_x = v_cx, to_y = v_cy,
             leg_at = now(), leg_ends = now(), enemy = null, hunting = null
        where world_id = p_world and id = c.id;
      -- Marked as held, as a trade's hold is (`class_hold`), for a Binder's Shatter and Frost Ward to ask.
      insert into class_mark (world_id, creature_id, kind, val, until)
        values (p_world, c.id, 'hold', 1, now() + make_interval(secs => v_secs))
        on conflict (world_id, creature_id, kind) do update
          set val = case when class_mark.until > now() then class_mark.val else excluded.val end,
              by_uid = case when class_mark.until > now() then class_mark.by_uid end,
              until = greatest(class_mark.until, excluded.until);
      v_n := round(v_secs);
    else
      for c in select * from creature where world_id = p_world and mode = 'wild'
          and to_x between p.x - v_rng and p.x + v_rng
          and to_y between p.y - v_rng and p.y + v_rng loop
        v_cx := creature_x(c); v_cy := creature_y(c);
        update creature set until = now() + make_interval(secs => v_secs),
               from_x = v_cx, from_y = v_cy, to_x = v_cx, to_y = v_cy,
               leg_at = now(), leg_ends = now(), enemy = null, hunting = null
          where world_id = p_world and id = c.id;
        -- Marked as held, as a trade's hold is (`class_hold`), for a Binder's Shatter and Frost Ward to ask.
        insert into class_mark (world_id, creature_id, kind, val, until)
          values (p_world, c.id, 'hold', 1, now() + make_interval(secs => v_secs))
          on conflict (world_id, creature_id, kind) do update
            set val = case when class_mark.until > now() then class_mark.val else excluded.val end,
                by_uid = case when class_mark.until > now() then class_mark.by_uid end,
                until = greatest(class_mark.until, excluded.until);
        v_n := v_n + 1;
      end loop;
    end if;

  else
    -- Warding. The greater of what is already over you and what this would put
    -- there, so casting it again refreshes the skin rather than stacking one
    -- inside another.
    if d.at_what = 'self' then
      update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{aegis}',
          to_jsonb(greatest(coalesce((stats->>'aegis')::double precision, 0), v_force)))
        where world_id = p_world and uid = p_uid;
      v_n := round(v_force);
    else
      for r in select uid from player where world_id = p_world and not away
          and x between p.x - v_rng and p.x + v_rng
          and y between p.y - v_rng and p.y + v_rng loop
        update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{aegis}',
            to_jsonb(greatest(coalesce((stats->>'aegis')::double precision, 0), v_force)))
          where world_id = p_world and uid = r.uid;
        if r.uid <> p_uid then
          perform tell(p_world, r.uid, 'Something closes over you, put there by somebody else.', 'system');
        end if;
        v_n := v_n + 1;
      end loop;
    end if;
  end if;

  return replace(replace(d.done, '{n}', v_n::text), '{t}', v_name);
end $function$;

select private.lock_doors();
