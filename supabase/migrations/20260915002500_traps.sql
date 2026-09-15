-- What you catch while you are somewhere else.
--
-- ## A trap is a chance compounded, not a chance repeated
--
-- Everything else this island does lazily is arithmetic: a fire's fuel is a
-- subtraction, a well's water an addition, a post's rot a multiplication. A
-- trap is the first one that is a *gamble*, rolled every forty-five seconds
-- whether anybody is there or not, and an hour of that is eighty rolls.
--
-- Eighty rolls resolved one at a time would be eighty round trips to the
-- random number generator for a question with one answer. It is the same trick
-- the festering wound uses: the chance of catching nothing in n rolls is
-- `(1 - p)^n`, so the chance of catching something is one minus that, rolled
-- once. Eighty rolls at three in ten is not eighty chances; it is a certainty,
-- and the arithmetic says so without pretending to count.
--
-- ## And unlike a hunt, it is not clamped
--
-- A hunter cannot have been chasing you while you were away, because you were
-- not there. A trap catches things *precisely* when nobody is watching — that
-- is the whole of what it is for — so the elapsed time counts in full, bounded
-- only by the trap's own life. What it cannot do is catch something that is
-- not there now: the creatures in reach at the moment somebody looks are the
-- ones it had a chance at, which is the same honesty the hunt is built on.

/* A trap keeps its kind in `sub`, so the wood it was made of needs a column of
 * its own — a post could put its material there because a post has only one
 * kind. */
alter table placed add column if not exists material text;
alter table placed add column if not exists bait text;
alter table placed add column if not exists bait_ql real;
alter table placed add column if not exists caught int;
/** The trap holding it, for the thing that is held. */
alter table creature add column if not exists trapped bigint;

create or replace function trap_action(p_action text) returns boolean language sql immutable as $$
  select p_action in ('set_trap', 'bait_trap', 'take_catch', 'free_catch',
                      'empty_creel', 'pick_up_trap')
$$;

/** How often a set trap is rolled, in seconds. */
create or replace function trap_check_every() returns double precision
  language sql immutable as $$ select 45 $$;

create or replace function trap_life(p_kind text, p_ql double precision) returns double precision
  language sql stable as $$
  select d.life_min + ((least(100, greatest(1, p_ql)) - 1) / 99) * (d.life_max - d.life_min)
  from trap_def d where d.id = p_kind
$$;

create or replace function trap_dmg(p placed) returns double precision language sql stable as $$
  select least(100, p.dmg + (100 / trap_life(p.sub, p.ql))
                            * extract(epoch from (now() - p.since)))
$$;

create or replace function trap_left(p placed) returns double precision language sql stable as $$
  select greatest(0, trap_life(p.sub, p.ql) * (1 - trap_dmg(p) / 100))
$$;

/** What it will hold, once the build quality is counted in. */
create or replace function trap_holds(p placed) returns double precision language sql stable as $$
  select round((select holds from trap_def where id = p.sub) * (0.6 + least(100, greatest(1, p.ql)) / 250))
$$;

create or replace function trap_name(p placed) returns text language sql stable as $$
  select coalesce(p.name,
    (select d.name from trap_def d where d.id = p.sub)
      || case when p.material is null then '' else ' (' || lower(p.material) || ')' end)
$$;

/**
 * The odds one roll catches this.
 *
 * A well-made trap catches more; a trusting animal walks in and a wary one
 * does not; and a timid creature, which is the very thing you cannot walk up
 * to, is the easiest of all to take this way.
 */
create or replace function catch_chance(p placed, c creature) returns double precision
  language sql stable as $$
  select least(0.9, d.odds
    * (0.5 + least(100, greatest(1, p.ql)) / 140)
    * greatest(0.15, 1 - s.tame_level / (trap_holds(p) * 1.8))
    * case when s.timid then 1.5 when s.hunter then 0.6 else 1 end)
  from trap_def d, species_def s
  where d.id = p.sub and s.id = c.species
$$;

/**
 * How long it has left, in the words the menu uses.
 *
 * A creel says minutes however many there are; a land trap says hours once
 * there is an hour of it. That is the browser's own asymmetry, not a slip in
 * the port — the two lines were written at different times and only one of
 * them learned to count past sixty.
 */
create or replace function trap_when(p placed, p_hours boolean) returns text language sql stable as $$
  select case when p_hours and mins >= 60
              then (mins / 60) || 'h ' || (mins % 60) || 'm left'
              else mins || 'm left' end
  from (select ceil(trap_left(p) / 60)::int as mins) m
$$;

/** What it says it is doing, for the menu and the log. */
create or replace function trap_state(p placed) returns text language sql stable as $$
  select case
    when (select water from trap_def where id = p.sub) then
      coalesce((select sum(i.count)::text || ' in it' from item i
                where i.holder = 'trap' and i.placed = p.id), 'empty')
      || ' · ' || coalesce('baited with ' || lower((select name from item_def where id = p.bait)),
                           'not baited')
      || ' · ' || trap_when(p, false)
    when p.caught is not null then
      coalesce((select sp.name from creature c join species_def sp on sp.id = c.species
                where c.id = p.caught and c.world_id = p.world_id), 'Something') || ' in it'
    else case when p.bait is not null
              then 'set and baited with ' || lower((select name from item_def where id = p.bait))
              else 'set but not baited' end
         || ' · ' || trap_when(p, true)
    end
$$;

/** Why a trap cannot be set here, or null. */
create or replace function trap_place_reason(p_world uuid, p_uid uuid, p_kind text,
    p_x int, p_y int, p_sx int, p_sy int)
  returns text language plpgsql stable as $$
declare d trap_def; p player;
begin
  select * into d from trap_def where id = p_kind;
  if not found then return 'That is not a trap.'; end if;
  if not in_bounds(p_world, p_x, p_y) then return 'Not there.'; end if;
  select * into p from player where world_id = p_world and uid = p_uid;
  if d.water then
    -- A creel goes in the water, within reach of a bank you can stand on.
    if water_depth(p_world, p_x, p_y) < 1 then
      return 'A creel goes in the water. Set it off a bank with some depth to it.';
    end if;
    if sqrt((p_x + 0.5 - p.x) ^ 2 + (p_y + 0.5 - p.y) ^ 2) > 3.6 then
      return 'Too far out. Set it within reach of where you stand.';
    end if;
  else
    if on_deed(p_world, p_x, p_y) then
      return 'Nothing wild comes inside your own borders. Set it out in the country.';
    end if;
    if not passable(p_world, p_x, p_y) or has_water(p_world, p_x, p_y) then
      return 'A trap needs dry ground it can be covered on.';
    end if;
    if building_at(p_world, p_x, p_y) is not null then return 'Not inside a building.'; end if;
  end if;
  if exists (select 1 from placed pl where pl.world_id = p_world and pl.x = p_x and pl.y = p_y
               and pl.sx = p_sx and pl.sy = p_sy) then
    return 'Something is already there.';
  end if;
  return null;
end $$;

/* ------------------------------------------------------------------ *
 * The settling.
 * ------------------------------------------------------------------ */

/** Let whatever is in it go, and say so. */
create or replace function spring_trap(p_id bigint, p_why text) returns void language plpgsql as $$
declare p placed;
begin
  select * into p from placed where id = p_id;
  if not found or p.caught is null then return; end if;
  update creature set trapped = null where world_id = p.world_id and id = p.caught;
  update placed set caught = null, bait = null, bait_ql = null where id = p_id;
  if p.made_by is not null then perform tell(p.world_id, p.made_by, p_why, 'system'); end if;
end $$;

/**
 * Roll a set trap forward, and take it away when it has rotted through.
 *
 * Returns true when the trap is gone. Every question about a trap goes through
 * here first, the same as a post.
 */
create or replace function trap_settle(p_id bigint) returns boolean language plpgsql as $$
declare p placed; d trap_def; v_dmg double precision; v_n int; v_best creature;
        v_chance double precision; v_odds double precision; s species_def;
        v_depth double precision; v_got text; v_held int; v_ql double precision; v_new bigint;
begin
  select * into p from placed where id = p_id and kind = 'trap' for update;
  if not found then return false; end if;
  select * into d from trap_def where id = p.sub;

  v_dmg := trap_dmg(p);
  if v_dmg >= 100 then
    if p.caught is not null then
      perform spring_trap(p_id, 'The ' || lower(trap_name(p))
        || ' rots through and whatever was in it walks away.');
    end if;
    if p.made_by is not null then
      perform tell(p.world_id, p.made_by, 'A ' || lower(trap_name(p))
        || ' has rotted through out in the country.', 'system');
    end if;
    delete from item where holder = 'trap' and placed = p_id;
    delete from placed where id = p_id;
    return true;
  end if;

  -- How many rolls there were between then and now, bounded by its own life.
  v_n := floor(least(extract(epoch from (now() - p.since)), trap_life(p.sub, p.ql))
               / trap_check_every())::int;
  update placed set dmg = v_dmg, since = now() where id = p_id;
  if p.bait is null or v_n < 1 then return false; end if;

  if d.water then
    v_held := coalesce((select sum(i.count)::int from item i
                        where i.holder = 'trap' and i.placed = p_id), 0);
    if v_held >= coalesce(d.hold, 8) then return false; end if;
    v_depth := water_depth(p.world_id, p.x, p.y);
    v_odds := d.odds * (0.6 + least(100, greatest(1, p.ql)) / 250);
    -- One roll standing for all of them, then one fish for each success it is
    -- still willing to hold.
    for v_n in 1..least(v_n, coalesce(d.hold, 8) - v_held) loop
      exit when random() >= v_odds;
      v_got := pick_fish(v_depth, 40, p.bait, random());
      exit when v_got is null;
      v_ql := greatest(1, least(100, p.ql * (0.5 + random() * 0.7)));
      insert into item (world_id, holder, placed, def, ql, count)
      values (p.world_id, 'trap', p_id, v_got, v_ql, 1);
      -- Every so often the bait is worked out of it and it goes on empty.
      if random() < 0.14 then
        update placed set bait = null, bait_ql = null where id = p_id;
        if p.made_by is not null then
          perform tell(p.world_id, p.made_by, 'The bait is gone out of a creel. '
            || 'It will take nothing more until it is baited again.', 'system');
        end if;
        exit;
      end if;
    end loop;
    return false;
  end if;

  if p.caught is not null then return false; end if;
  -- The likeliest thing in reach that would come to what is laid, and is not
  -- so wary that it simply takes the bait and goes.
  for v_best in select c.* from creature c
    where c.world_id = p.world_id and c.mode = 'wild' and c.trapped is null
      and sqrt((creature_x(c) - p.cx) ^ 2 + (creature_y(c) - p.cy) ^ 2) <= d.reach
    order by catch_chance(p, c) desc, c.id
  loop
    select * into s from species_def where id = v_best.species;
    if s.monster or not exists (select 1 from species_diet sd
          where sd.species = s.id and sd.item = p.bait) then
      continue;
    end if;
    if s.tame_level > trap_holds(p) then
      -- Too much trap for: a third of a chance a roll that it lifts the bait.
      if random() < 1 - power(0.7, v_n) then
        update placed set bait = null, bait_ql = null where id = p_id;
        if p.made_by is not null then
          perform tell(p.world_id, p.made_by, 'Something took the bait out of your '
            || lower(trap_name(p)) || ' and was gone. It was too much trap for.', 'system');
        end if;
        return false;
      end if;
      continue;
    end if;
    v_chance := catch_chance(p, v_best);
    exit;
  end loop;
  if v_best.id is null or v_chance is null then return false; end if;

  -- The one roll that stands for all of them.
  if random() >= 1 - power(1 - v_chance, v_n) then return false; end if;
  update creature set trapped = p_id,
      from_x = p.cx, from_y = p.cy, to_x = p.cx, to_y = p.cy,
      leg_at = now(), leg_ends = now(), until = now() + interval '1 hour',
      hunting = null, enemy = null, settled_at = now()
    where world_id = p.world_id and id = v_best.id;
  update placed set caught = v_best.id where id = p_id;
  if p.made_by is not null then
    -- The browser's own words, and it says them the instant the board falls.
    -- Here nobody was there for the instant, so it is said when somebody next
    -- looks — which is the whole of what a trap is for.
    perform tell(p.world_id, p.made_by, 'Your ' || lower(trap_name(p))
      || ' has sprung. There is a ' || lower(s.name) || ' in it.', 'event');
  end if;
  return false;
end $$;

/** Bring every trap on the island up to date, and say how many rotted away. */
create or replace function trap_sweep(p_world uuid) returns int language plpgsql as $$
declare r record; n int := 0;
begin
  for r in select id from placed where world_id = p_world and kind = 'trap' order by id loop
    if trap_settle(r.id) then n := n + 1; end if;
  end loop;
  return n;
end $$;

select private.lock_doors();
