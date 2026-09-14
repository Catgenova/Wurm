-- The maths of doing something, ported from src/game/skills.ts and the roll
-- helpers in src/game/game.ts.
--
-- These are the algorithms, and they are the one thing that genuinely lives in
-- two places now. The constants do not: everything with a number in it comes
-- out of the generated def tables next door, so the only way these can drift
-- from the browser's copy is if somebody changes a formula, which is rare and
-- deliberate. The tests alongside check the two agree.

/** What is left of a gain at a given level: 1 at nothing, 0 at mastery. */
create or replace function skill_room(p_v double precision) returns double precision
  language sql immutable as $$ select power(greatest(0, 1 - p_v / 100), 1.8) $$;

/**
 * The least an honest go is worth. Without it the curve never quite arrives and
 * a hundred is a number nobody can reach.
 */
create or replace function min_gain() returns double precision
  language sql immutable as $$ select 0.0001::double precision $$;

/** One gain: the curve, floored, and then luck of a fifth either way. */
create or replace function skill_gain_of(p_v double precision, p_base double precision, p_roll double precision)
  returns double precision language sql immutable as
$$ select greatest(min_gain(), p_base * skill_room(p_v)) * p_roll $$;

/** Where a body is on a skill, falling back to where everybody starts. */
create or replace function skill_of(p_world uuid, p_uid uuid, p_id text) returns double precision
  language sql stable as
$$ select coalesce(
     (select s.value from skill s where s.world_id = p_world and s.uid = p_uid and s.id = p_id),
     (select d.start from skill_def d where d.id = p_id),
     1) $$;

/** Raise one, and say by how much. The roll happens here, where nobody can see it coming. */
create or replace function skill_raise(p_world uuid, p_uid uuid, p_id text, p_base double precision)
  returns double precision language plpgsql as $$
declare was double precision; now_v double precision;
begin
  was := skill_of(p_world, p_uid, p_id);
  now_v := least(100, was + skill_gain_of(was, p_base, 0.6 + 0.8 * random()));
  insert into skill (world_id, uid, id, value) values (p_world, p_uid, p_id, now_v)
    on conflict (world_id, uid, id) do update set value = excluded.value;
  return now_v - was;
end $$;

/**
 * Whether a go at something came off. Better skill and tools help, difficulty
 * hurts, and it is never certain either way: a third of the time at worst, all
 * but two in a hundred at best.
 *
 * The roll is here rather than in the browser, which is the whole point of the
 * move. A client that rolls its own successes is a client that never fails.
 */
create or replace function skill_check(p_skill double precision, p_difficulty double precision,
                                       p_tool_ql double precision default 0, p_ease double precision default 0)
  returns boolean language sql volatile as $$
  select random() < least(0.98, greatest(0.3,
    0.6 + (p_skill / 100) * 0.38 + p_tool_ql / 500
      - (case when p_ease > 0 then greatest(p_difficulty * 0.5, p_difficulty - p_ease) else p_difficulty end) / 150))
$$;

/**
 * What a piece of work comes out at. Your skill is the ceiling; the tool's
 * quality is the percentage chance of reaching it, and every other time the
 * thing comes out at 1, fit for nothing but being used up.
 */
create or replace function product_ql(p_skill double precision, p_tool_ql double precision default 0)
  returns double precision language sql volatile as $$
  select case
    when p_tool_ql <= 0 then least(100, greatest(1, least(100, greatest(1, p_skill)) * (0.6 + random() * 0.8) + 1))
    when random() * 100 < p_tool_ql then least(100, greatest(1, p_skill))
    else 1 end
$$;

create or replace function rarity_boost(p_rare text) returns double precision language sql immutable as $$
  select case p_rare when 'rare' then 1.1 when 'supreme' then 1.25 when 'fantastic' then 1.5 else 1 end
$$;

create or replace function rarity_keep(p_rare text) returns double precision language sql immutable as $$
  select case p_rare when 'rare' then 0.8 when 'supreme' then 0.6 when 'fantastic' then 0.35 else 1 end
$$;

/**
 * What a tool is worth at the work: its quality, bitten into by the state it
 * is in and lifted by its material, its rarity and any blessing on it. This
 * one figure decides how fast a job goes, how often it comes off, and how good
 * what comes out of it is.
 */
create or replace function tool_worth(p_ql real, p_dmg real, p_extra text, p_rare text, p_bless real)
  returns double precision language sql stable as $$
  select least(100,
      least(100, p_ql * coalesce((select m.bite from material_def m where m.id = p_extra), 1))
      * rarity_boost(p_rare)
      * (1 + least(3, coalesce(p_bless, 0)) * 0.09))
    * greatest(0.3, 1 - p_dmg / 160)
$$;

/** The best of a kind of tool in somebody's pack, and what it is worth. */
create or replace function tool_ql(p_world uuid, p_uid uuid, p_def text) returns double precision
  language sql stable as $$
  select coalesce(max(tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless)), 0)
  from item i
  where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = p_def
$$;

/** How long a go at something takes: skill and a good tool both shorten it. */
create or replace function act_duration(p_base double precision, p_skill double precision,
                                        p_tool_ql double precision, p_control double precision default 1)
  returns double precision language sql immutable as $$
  select greatest(1.2, p_base * (1 - p_skill / 140) * (1 - p_tool_ql / 400) * p_control)
$$;

/** Steadiness of hand: body control makes every job a little quicker. */
create or replace function control_speed(p_world uuid, p_uid uuid) returns double precision
  language sql stable as $$ select greatest(0.6, 1 - (skill_of(p_world, p_uid, 'body_control') - 20) * 0.003) $$;

/**
 * Wear on a tool from one use. A poor tool goes to pieces far faster than a
 * good one, which is most of what quality is for. A tool worn through is gone.
 */
create or replace function wear_tool(p_item bigint, p_multiplier double precision default 1)
  returns void language plpgsql as $$
declare it item; amount double precision;
begin
  select * into it from item where id = p_item;
  if not found then return; end if;
  amount := (0.06 + 3 / (10 + it.ql)) * p_multiplier
            * coalesce((select m.wear from material_def m where m.id = it.extra), 1)
            * rarity_keep(it.rare);
  if it.dmg + amount >= 100 then
    delete from item where id = p_item;
  else
    update item set dmg = dmg + amount where id = p_item;
  end if;
end $$;

/** Tell somebody something. This is what the log line was, now it has to travel. */
create or replace function tell(p_world uuid, p_uid uuid, p_text text, p_kind text default 'event')
  returns void language sql as $$
  insert into event (world_id, uid, text, kind) values (p_world, p_uid, p_text, p_kind)
$$;

/**
 * What time it is on the island: seconds since it began, straight off the wall
 * clock. Nothing advances it and nothing can disagree about it — which is the
 * whole of what the old `clock` message and its drift-nudging were for.
 */
create or replace function world_time(p_world uuid) returns double precision language sql stable as $$
  select extract(epoch from (now() - w.epoch)) from world w where w.id = p_world
$$;
