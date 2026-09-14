-- Doing something to the island, decided entirely here.

create table if not exists action_def (
  id text primary key,
  label text not null,
  verb text not null,
  skill text,
  tool text,
  corner boolean not null default false,
  range int,
  stamina real not null default 0,
  base_time real not null,
  difficulty real not null default 10
);

insert into action_def (id, label, verb, skill, tool, corner, stamina, base_time, difficulty)
values ('dig', 'Dig', 'digging', 'digging', 'shovel', true, 0.05, 6, 8)
on conflict (id) do update set
  label = excluded.label, verb = excluded.verb, skill = excluded.skill, tool = excluded.tool,
  corner = excluded.corner, stamina = excluded.stamina, base_time = excluded.base_time,
  difficulty = excluded.difficulty;

/**
 * Whether a job may even be started: everything that can be known before the
 * work begins. The browser asks the same questions to grey out a menu item,
 * but its answer is a courtesy — this one is the answer.
 */
create or replace function act_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
  returns text language plpgsql stable as $$
declare d action_def; p player; cx int; cy int; tx int; ty int; t tile_def;
begin
  select * into d from action_def where id = p_action;
  if not found then return 'There is no such thing as ' || p_action || '.'; end if;
  select * into p from player where world_id = p_world and uid = p_uid;
  if not found then return 'You are not on this island.'; end if;
  -- Deliberately not "are you busy": this is asked of the *next* go in a queue
  -- as well as the first, and by then the person asking is in the middle of
  -- exactly the job being asked about. Having it here meant a queue of six
  -- dug one hole and quietly stopped. Being busy is `rpc_act`'s business.
  if not in_reach(p.x, p.y, p_target, d.corner, d.range) then return 'You are too far away from that.'; end if;
  if d.tool is not null and tool_ql(p_world, p_uid, d.tool) <= 0 then
    return 'You need a ' || d.tool || ' to ' || lower(d.label) || '.';
  end if;

  if p_action = 'dig' then
    cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
    tx := (p_target->>'x')::int;  ty := (p_target->>'y')::int;
    select * into t from tile_def where id = land_tile(p_world, tx, ty);
    if t.dig_yield is null then return 'You cannot dig that.'; end if;
    if land_height(p_world, cx, cy) <= 0 then return 'You cannot dig below the water level.'; end if;
    if land_dirt(p_world, cx, cy) <= 0 then
      return 'That corner is bare rock. Only a pickaxe will take it lower.';
    end if;
  end if;
  return null;
end $$;

/**
 * Start something. The island writes down what was begun and when it will be
 * done, and that is all: no work happens now, and the outcome is not decided
 * now either. A client that hangs up halfway through still gets its hole.
 */
create or replace function rpc_act(p_world uuid, p_action text, p_target jsonb, p_times int default 1)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); d action_def; why text; secs double precision; s double precision; tq double precision;
begin
  if me is null then raise exception 'not signed in'; end if;
  perform settle(p_world, me);
  if exists (select 1 from player where world_id = p_world and uid = me and act is not null) then
    perform tell(p_world, me, 'You are already busy.', 'error');
    return jsonb_build_object('started', false, 'why', 'You are already busy.');
  end if;
  why := act_refusal(p_world, me, p_action, p_target);
  if why is not null then
    perform tell(p_world, me, why, 'error');
    return jsonb_build_object('started', false, 'why', why);
  end if;
  select * into d from action_def where id = p_action;
  s := case when d.skill is null then 50 else skill_of(p_world, me, d.skill) end;
  tq := case when d.tool is null then 0 else tool_ql(p_world, me, d.tool) end;
  secs := act_duration(d.base_time, s, tq, control_speed(p_world, me));
  update player set
      act = p_action, act_target = p_target, act_started = now(),
      act_ends = now() + make_interval(secs => secs),
      act_left = greatest(1, least(100, coalesce(p_times, 1))), seen_at = now()
    where world_id = p_world and uid = me;
  perform tell(p_world, me, 'You start ' || d.verb || '.', 'info');
  return jsonb_build_object('started', true, 'ends', now() + make_interval(secs => secs), 'seconds', secs);
end $$;

/**
 * One go at a job, once its time has come. Everything that decides an outcome
 * — the roll, the quality, the skill gained — happens in here, on the server,
 * out of reach.
 */
create or replace function act_perform(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
  returns void language plpgsql as $$
declare d action_def; tq double precision; s double precision; cx int; cy int; tx int; ty int;
        t tile_def; left_dirt int; made_ql double precision; yield text; gained double precision; tool_id bigint;
begin
  select * into d from action_def where id = p_action;
  s := case when d.skill is null then 50 else skill_of(p_world, p_uid, d.skill) end;
  tq := case when d.tool is null then 0 else tool_ql(p_world, p_uid, d.tool) end;

  if p_action = 'dig' then
    cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
    tx := (p_target->>'x')::int;  ty := (p_target->>'y')::int;
    select * into t from tile_def where id = land_tile(p_world, tx, ty);
    -- The tool wears whether or not the go came off, as it does in the hand.
    select i.id into tool_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = d.tool
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if tool_id is not null then perform wear_tool(tool_id); end if;

    if not skill_check(s, d.difficulty, tq) then
      perform tell(p_world, p_uid, 'You fail to dig anything useful.', 'event');
      return;
    end if;
    perform land_set_height(p_world, cx, cy, land_height(p_world, cx, cy) - 1);
    left_dirt := land_dirt(p_world, cx, cy) - 1;
    perform land_set_dirt(p_world, cx, cy, left_dirt);
    if t.turns_to_dirt then perform land_set_tile(p_world, tx, ty, 1); end if;
    perform land_announce(p_world, tx, ty);
    if left_dirt <= 0 then
      perform tell(p_world, p_uid, 'Your shovel grates on bare rock.', 'event');
    end if;
    yield := coalesce(t.dig_yield, 'dirt');
    made_ql := product_ql(s, tq);
    insert into item (world_id, holder, holder_uid, def, ql) values (p_world, 'player', p_uid, yield, made_ql);
    gained := skill_raise(p_world, p_uid, d.skill, 1);
    perform tell(p_world, p_uid,
      'You dig up some ' || lower((select name from item_def where id = yield)) ||
      '. (QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
    if gained > 0 then
      perform tell(p_world, p_uid, 'Digging increased by ' || to_char(gained, 'FM0.0000') ||
        ' to ' || to_char(skill_of(p_world, p_uid, d.skill), 'FM990.0000') || '.', 'skill');
    end if;
  end if;
end $$;

/**
 * Finish whatever has come due.
 *
 * This is the whole of what replaces a running world. Every entry point calls
 * it first, so by the time anything reads a player that player is up to date;
 * and `rpc_sweep` calls it for people who walked away mid-job, so a hole does
 * not wait forever on somebody who has closed their laptop.
 *
 * It loops because a queue of six digs whose six seconds each went by while
 * nobody was looking is six digs that happened, not one.
 */
create or replace function settle(p_world uuid, p_uid uuid) returns int
  language plpgsql as $$
declare p player; d action_def; done int := 0; guard int := 0;
begin
  select * into p from player where world_id = p_world and uid = p_uid for update;
  if not found or p.act is null then return 0; end if;
  while p.act is not null and p.act_ends <= now() and guard < 200 loop
    guard := guard + 1;
    perform act_perform(p_world, p_uid, p.act, p.act_target);
    done := done + 1;
    select * into d from action_def where id = p.act;
    if p.act_left > 1 and act_refusal(p_world, p_uid, p.act, p.act_target) is null then
      -- Another go, starting when the last one ended rather than now: a queue
      -- settled late must not be paid for twice.
      update player set act_left = act_left - 1, act_started = p.act_ends,
             act_ends = p.act_ends + make_interval(secs => act_duration(
               d.base_time,
               case when d.skill is null then 50 else skill_of(p_world, p_uid, d.skill) end,
               case when d.tool is null then 0 else tool_ql(p_world, p_uid, d.tool) end,
               control_speed(p_world, p_uid)))
        where world_id = p_world and uid = p_uid returning * into p;
    else
      if p.act_left > 1 then
        perform tell(p_world, p_uid, 'You stop ' || d.verb || '.', 'info');
      end if;
      update player set act = null, act_target = null, act_started = null, act_ends = null, act_left = null
        where world_id = p_world and uid = p_uid returning * into p;
    end if;
  end loop;
  return done;
end $$;

/**
 * Settle everybody who has work owing, for a scheduled sweep. Nothing else
 * needs a timer: this is the one job that cannot wait on somebody coming back,
 * because they may not.
 */
create or replace function rpc_sweep() returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select world_id, uid from player where act is not null and act_ends <= now() limit 500 loop
    n := n + settle(r.world_id, r.uid);
  end loop;
  return n;
end $$;
