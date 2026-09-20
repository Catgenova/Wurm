-- Nine nodes to a trade
--
-- The fourteen trades landed with nothing under them: taking one wrote a word
-- on your body and moved no number at all. This is the number. Each trade
-- carries nine passive nodes in three columns of three, and taking them is
-- what a trade is *for*.
--
-- ## The shape, and why it is this one
--
-- A column is one thing the trade gets better at. The first two nodes in it
-- are minor and cost a point each; the third is major, costs three, and wants
-- the two under it first. So a whole column is five points and there is no
-- other edge in the graph -- nothing crosses between columns, nothing is
-- hidden, and a tree can be drawn from `needs` alone.
--
-- A trade is worth two points at fifty and twelve at a hundred, off the
-- *best* skill it covers rather than the sum of them, so Smith with six skills
-- and Fisher with one reach the same twelve. Twelve buys two whole columns and
-- two over, never all three. That is the whole of the choosing: the tree is
-- deliberately bigger than the budget, and what you leave is as much a
-- decision as what you take.
--
-- ## Four channels, and nothing else
--
-- Every node moves one of four numbers and none of them is an ability:
--
--     hands   how long a go takes         act_duration, beside control_speed
--     learn   what a go teaches you       skill_mult
--     wind    what a go takes out of you  spend_wind
--     fine    the quality off the bench   perform_craft, improve, repair, restore
--
-- Four channels was a budget, not a shortlist. Every one of them is a number
-- that already existed at exactly one place in the rules, so a node is a
-- multiplier folded into a line that was already there rather than a new rule
-- with its own edge cases. Nothing here needs a branch anywhere, and no node
-- can ever disagree with another -- they are all the same product.
--
-- Fineness is the one that runs backwards in one place. At the bench, the file
-- and the restorer's table it multiplies the quality gained; at a mend it
-- divides the quality *lost*, because a mender whose work comes back better
-- than it went is a mender who takes less off. Same number, same claim,
-- different quantity.
--
-- ## A node only tells on its own trade
--
-- A Miner's quick hands are quick at mining, prospecting and archaeology and
-- nowhere else. Without that a tree is a general upgrade with a name on it,
-- and two people in different trades with the same nodes would be the same
-- person. The scope is carried in the fold itself -- see below -- so the check
-- costs a jsonb containment and no join.
--
-- ## The fold, which is the only reason this is affordable
--
-- `hands` is read once per go per player on the clock, and `learn` once per
-- skill gain, which on a busy island is thousands a minute. Walking nine rows
-- and summing them there would be a join on the hottest path in the rules.
--
-- So it is not walked. `player.class_mul` holds the answer: a product per
-- channel and the list of skills the trade covers, written once when a node is
-- taken or a trade changes and read as a jsonb lookup for ever after. Three of
-- the four sites already had the player row in hand, so those three cost
-- nothing at all; `wind` reads a row it was already reading. The fold is
-- correct because nothing else can change it -- skills add points, they do not
-- move multipliers, and points are checked when a node is taken.
--
-- ## Taken is taken
--
-- There is no undo on a node. Putting the whole trade down clears its tree,
-- and that costs five hundred silver, which is the expensive undo the trades
-- already had. Spending a point badly is survivable and meant to be: twelve
-- points is two whole columns and two over, so one wasted still leaves two
-- columns and one. It is only at the top that the tree is tight, and nobody
-- who has got there is short of five hundred silver.

set local lock_timeout = '3s';

/*
 * The fold, kept on the body.
 *
 * Asked for in a loop for the same reason the three class columns were: `alter
 * table` takes ACCESS EXCLUSIVE before it looks to see whether there is
 * anything to do, `player` is read by the clock and by every door on the
 * island, and one long wait queues every reader behind it. A minute of short
 * ones does not. It is the first statement in the file so the transaction
 * holds nothing while it waits.
 */
do $$
declare i int;
begin
  for i in 1 .. 30 loop
    begin
      set local lock_timeout = '2s';
      alter table player add column if not exists class_mul jsonb;
      return;
    exception when lock_not_available then
      perform pg_sleep(2);
    end;
  end loop;
  raise exception 'could not get a moment on player to add the fold';
end $$;

/*
 * What somebody has taken, and when.
 *
 * On the player rather than on the class, because a person may hold two trades
 * and the node's own row says which one it was drawn on. Cascading off
 * `player` the way `skill` does, so a reaped island takes its trees with it
 * and nothing has to remember to.
 *
 * No foreign key to `class_node`: that table is truncated and written again by
 * every definitions run, and a key pointed at it would refuse the truncate.
 * `skill` does not key to `skill_def` either, for the same reason.
 */
create table if not exists player_node (
  world_id uuid not null,
  uid uuid not null,
  node text not null,
  took timestamptz not null default now(),
  primary key (world_id, uid, node),
  foreign key (world_id, uid) references player (world_id, uid) on delete cascade
);
alter table player_node enable row level security;
drop policy if exists player_node_read on player_node;
create policy player_node_read on player_node for select to anon, authenticated
  using (uid = (select auth.uid()));
grant select on player_node to anon, authenticated;

/*
 * What a trade is worth in points: nothing under forty, one more every five,
 * and it stops at a hundred. Two at fifty, twelve at the top.
 */
create or replace function class_points_for(p_best double precision) returns int
  language sql immutable as $fn$
  select greatest(0, floor((least(100, p_best) - class_point_floor()) / class_point_step())::int)
$fn$;

/* Off the best skill the trade covers, not the sum of them. */
create or replace function class_points(p_world uuid, p_uid uuid, p_class text) returns int
  language sql stable as $fn$
  select coalesce((select class_points_for(max(skill_of(p_world, p_uid, cs.skill)))
                     from class_skill cs where cs.class = p_class), 0)
$fn$;

/* And what has already gone out of them, on that trade and no other. */
create or replace function class_spent(p_world uuid, p_uid uuid, p_class text) returns int
  language sql stable as $fn$
  select coalesce((select sum(n.cost)::int
                     from player_node pn join class_node n on n.id = pn.node
                    where pn.world_id = p_world and pn.uid = p_uid and n.class = p_class), 0)
$fn$;

/*
 * One channel out of a fold, or one, given the skill the go was done with.
 *
 * Immutable and free of any read, which is the point: three of the four sites
 * already hold the player row, so they hand the jsonb straight in. `skills` is
 * folded in beside the channels so the scope check is a containment on a value
 * already in hand rather than a join back to `class_skill` on the hot path.
 *
 * A null skill -- a job that is nobody's trade -- is nobody's business, and
 * gets one.
 */
create or replace function class_mul(p_mul jsonb, p_channel text, p_skill text) returns double precision
  language sql immutable as $fn$
  select case when p_skill is not null and p_mul ? p_channel
                and p_mul->'skills' @> to_jsonb(p_skill)
              then (p_mul->>p_channel)::double precision else 1 end
$fn$;

/* The same, for the sites that do not have the row. */
create or replace function class_mul(p_world uuid, p_uid uuid, p_channel text, p_skill text)
  returns double precision language sql stable as $fn$
  select class_mul(coalesce((select pl.class_mul from player pl
                              where pl.world_id = p_world and pl.uid = p_uid), '{}'::jsonb),
                   p_channel, p_skill)
$fn$;

/*
 * Fold a tree down to the answer and write it on the body.
 *
 * Multiplied in node order rather than as `exp(sum(ln()))`, so the island's
 * arithmetic is the browser's arithmetic to the last bit -- `foldNodes` walks
 * the same list in the same order, and the suite compares the two exactly
 * rather than within a whisker.
 *
 * Nodes of a trade the player no longer holds are skipped rather than trusted:
 * `rpc_take_class` clears them, and this is what makes that belt-and-braces
 * instead of load-bearing.
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
  update player set class_mul = v where world_id = p_world and uid = p_uid;
  return v;
end $fn$;

/*
 * Why a node cannot be taken, or nothing.
 *
 * Four refusals and no fifth, the same four and the same sentences the browser
 * builds in `nodeRefusal`, which the suite asks the two of them to agree on
 * word for word.
 */
create or replace function node_refusal(p_world uuid, p_uid uuid, p_node text) returns text
  language plpgsql stable as $fn$
declare n class_node; c class_def; p player; v_mine text; v_left int;
begin
  select * into n from class_node where id = p_node;
  if not found then return 'There is no such node.'; end if;
  select * into p from player where world_id = p_world and uid = p_uid;
  if not found then return 'You are not on this island.'; end if;
  select * into c from class_def where id = n.class;
  v_mine := case when c.kind = 'craft' then p.craft_class else p.combat_class end;
  if v_mine is distinct from n.class then
    return 'That is the ' || lower(c.name) || '’s, and you are not one.';
  end if;
  if exists (select 1 from player_node where world_id = p_world and uid = p_uid and node = p_node) then
    return 'You have that already.';
  end if;
  if n.needs is not null and not exists (
       select 1 from player_node where world_id = p_world and uid = p_uid and node = n.needs) then
    return (select name from class_node where id = n.needs) || ' comes first.';
  end if;
  v_left := class_points(p_world, p_uid, n.class) - class_spent(p_world, p_uid, n.class);
  if v_left < n.cost then
    return n.name || ' wants ' || n.cost || ' point' || case when n.cost = 1 then '' else 's' end
        || ' and you have ' || v_left || '. Every ' || class_point_step()::int
        || ' in the trade is another one.';
  end if;
  return null;
end $fn$;

/*
 * Your trees, whole, in one call.
 *
 * Every node of every trade you hold, what is taken, what it would cost, why
 * not where there is a why, and the fold itself -- so a panel can draw the
 * thing and also show what it is currently worth without asking twice. A tree
 * is a screen, and a screen that asks the island once cannot be half drawn.
 */
create or replace function rpc_tree(p_world uuid) returns jsonb
 language plpgsql security definer set search_path to 'public' as $fn$
declare me uuid := auth.uid(); p player;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  select * into p from player where world_id = p_world and uid = me;
  if not found then return jsonb_build_object('why', 'You are not on this island.'); end if;
  return jsonb_build_object(
    'mul', coalesce(p.class_mul, '{}'::jsonb),
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
end $fn$;

/*
 * Take one.
 *
 * No undo, so the answer says what is left afterwards rather than leaving
 * anybody to work it out, and the fold is written here rather than lazily --
 * a tree that is read a thousand times between changes should be folded on the
 * change.
 */
create or replace function rpc_take_node(p_world uuid, p_node text) returns jsonb
 language plpgsql security definer set search_path to 'public' as $fn$
declare me uuid := auth.uid(); n class_node; v_why text; v_mul jsonb;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  select * into n from class_node where id = p_node;
  if not found then return jsonb_build_object('why', 'There is no such node.'); end if;
  v_why := node_refusal(p_world, me, p_node);
  if v_why is not null then return jsonb_build_object('why', v_why); end if;
  insert into player_node (world_id, uid, node) values (p_world, me, p_node)
    on conflict (world_id, uid, node) do nothing;
  v_mul := class_fold(p_world, me);
  perform tell(p_world, me, n.name || '. ' || n.note, 'system');
  return jsonb_build_object('took', p_node, 'mul', v_mul,
    'left', class_points(p_world, me, n.class) - class_spent(p_world, me, n.class));
end $fn$;

-- The nine functions a tree tells on, re-emitted with the fold folded in.
-- Generated by treegen.py against the live definitions, so nothing here is
-- retyped from memory and every anchor was asserted to occur exactly once.

CREATE OR REPLACE FUNCTION public.skill_mult(p_world uuid, p_uid uuid, p_id text)
 RETURNS double precision
 LANGUAGE plpgsql
 STABLE
AS $function$
declare p player; m double precision;
begin
  select * into p from player where world_id = p_world and uid = p_uid;
  if not found then return 1; end if;
  m := case when coalesce(p.rested, 0) > 0 then rest_mult() else 1 end;
  -- A knack earned on the way up never wears off, unlike a meal or a night's sleep.
  m := m + knack_bonus((p.knacks->>p_id)::int);
  -- And the stone you wear, worth a knack on the one trade it favours.
  m := m + coalesce((select jewel_bonus() from gem_def g
                      where g.skill = p_id and lower(g.name) = lower((worn(p_world, p_uid, 'jewel')).extra)), 0);
  -- And the reader's path is a tenth on everything, for good.
  if p_id <> meditation_skill() and walks(p_world, p_uid, 'knowledge', 1) then m := m + 0.1; end if;
  m := m * table_mul(p.nutrition);
  -- And the dish that favours this one, while it lasts.
  m := m + coalesce((select sum((b->>'bonus')::double precision)
                       from jsonb_array_elements(coalesce(p.boons, '[]'::jsonb)) b
                      where b->>'skill' = p_id
                        and (b->>'until')::double precision > world_time(p_world)), 0);
  /*
   * And the tree, which is the last thing on and the only one that is not the
   * same for everybody with the same sheet.
   *
   * Free here, and that is why learning is wired here rather than in
   * `skill_raise`: this function already has the row in hand, and the fold
   * kept on it is a product somebody else worked out. It tells only on the
   * skills the trade covers -- the check is inside `class_mul` -- so a smith's
   * forge sense is worth nothing at a loom.
   */
  m := m * class_mul(coalesce(p.class_mul, '{}'::jsonb), 'learn', p_id);
  return greatest(0.01, m);
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
                 * class_mul(coalesce(p.class_mul, '{}'::jsonb), 'hands', d.skill)))
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
                     * class_mul(coalesce(p.class_mul, '{}'::jsonb), 'hands', d.skill))),
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
                 * class_mul(coalesce(p.class_mul, '{}'::jsonb), 'hands', d.skill)) end;
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

CREATE OR REPLACE FUNCTION public.perform_craft(p_world uuid, p_uid uuid, p_recipe text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare r recipe; i record; prefer bigint; mat text; hard double precision; tq double precision;
        s double precision; made_ql double precision; rare text; total double precision := 0;
        v_made bigint;
        weight double precision := 0; one double precision;
begin
  select * into r from recipe where id = p_recipe;
  prefer := target_item(p_target);
  mat := craft_material(p_world, p_uid, p_recipe, prefer);
  s := skill_of(p_world, p_uid, r.skill);
  tq := case when r.tool is null then 0 else tool_ql(p_world, p_uid, r.tool) end;
  -- Oak and the deep metals fight the hands that shape them.
  hard := craft_hardness(p_recipe, mat);

  if r.difficulty is not null and not skill_check(s, hard, tq) then
    if r.consume_on_fail then
      for i in select * from recipe_input where recipe = p_recipe order by ord loop
        perform consume(p_world, p_uid, i.item, i.count, prefer, mat);
      end loop;
      -- The batch is wasted, not the vessel: you tip the ruin out and keep the
      -- bucket. Salvage if the recipe names any, otherwise whatever it returns.
      for i in
        select g.item, g.count from recipe_gives g
        where g.recipe = p_recipe
          and g.kind = (case when exists (select 1 from recipe_gives where recipe = p_recipe and kind = 'salvage')
                             then 'salvage' else 'return' end)
      loop
        perform give(p_world, p_uid, i.item, i.count, 20);
      end loop;
    end if;
    perform skill_raise(p_world, p_uid, r.skill, try_gain(false));
    perform skill_raise(p_world, p_uid, 'mind_logic', try_gain(false, craft_head()));
    perform tell(p_world, p_uid, coalesce(r.fail,
      'You fail to make ' || lower((select coalesce(name, r.result) from item_def where id = r.result)) || '.'), 'event');
    return;
  end if;

  -- The quality of what is about to be used up, worked out before it is used
  -- up, since using it up changes the answer.
  if r.ql_from_inputs then
    for i in select * from recipe_input where recipe = p_recipe order by ord loop
      select it.ql into one from item it
        where it.world_id = p_world and it.holder = 'player' and it.holder_uid = p_uid and it.def = i.item
        order by it.id limit 1;
      if one is not null then
        total := total + one * i.count;
        weight := weight + i.count;
      end if;
    end loop;
  end if;

  for i in select * from recipe_input where recipe = p_recipe order by ord loop
    if not consume(p_world, p_uid, i.item, i.count, prefer, mat) then return; end if;
  end loop;

  if r.ql_from_inputs then
    made_ql := greatest(1, least(100, (case when weight > 0 then total / weight else 1 end) * (0.78 + s / 460)));
  else
    made_ql := product_ql(s, tq);
  end if;
  /*
   * And the tree, on the trade the recipe belongs to.
   *
   * After both branches rather than inside either, because a thing made from
   * its inputs and a thing made from the hands are the same claim -- this is
   * the quality of what came off the bench -- and there is nothing to be
   * gained by saying it twice. The ceiling stays where it was: a hundred is a
   * hundred, and no tree lifts it.
   */
  made_ql := least(100, made_ql * class_mul(p_world, p_uid, 'fine', r.skill));
  rare := rarity_roll();
  v_made := give(p_world, p_uid, r.result, r.count, made_ql, coalesce(r.extra, mat), rare, maker_mark(p_world, p_uid, rare));
  -- A vessel comes off the bench full: a bucket of juice holds its five drinks, the
  -- way a new thing in the browser takes its charge off the item table. This gave
  -- it with nothing in it, and the first drink from a pressed bucket was its last.
  update item set charges = d.charges from item_def d
    where item.id = v_made and item.charges is null and d.id = item.def and d.charges is not null;
  -- Into the ledger, which is the only memory this island has of what you have
  -- made. It says so when it is your first of a kind or your best.
  perform journal_made(p_world, p_uid, r.result, made_ql, r.count, rare);
  if rare is not null then
    perform journal_note(p_world, p_uid, rare);
    perform tell(p_world, p_uid, rarity_word(rare), 'skill');
  end if;
  for i in select g.item, g.count from recipe_gives g where g.recipe = p_recipe and g.kind = 'return' loop
    perform give(p_world, p_uid, i.item, i.count, 20);
  end loop;

  perform skill_raise(p_world, p_uid, r.skill, 1);
  -- Working a thing out with your hands is what sharpens the head.
  perform skill_raise(p_world, p_uid, 'mind_logic', try_gain(true, craft_head()));
  perform tell(p_world, p_uid, r.done || ' (' || case when mat is not null then lower(mat) || ', ' else '' end
    || 'QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
end $function$;

CREATE OR REPLACE FUNCTION public.perform_item(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare v_ok boolean; v_it item; v_what improvable_def; v_mat improve_material_def; v_stock item;
        v_made text; v_ceiling double precision; v_tool_ql double precision;
        v_healed double precision; v_lost double precision; v_skill double precision;
        v_favour text; v_full text; v_name text; v_p player; v_lift text;
begin
  if p_action = 'drink' then
    update player set stats = jsonb_set(stats, '{thirst}', '1') where world_id = p_world and uid = p_uid;
    perform tell(p_world, p_uid, 'You drink the cool water. It is refreshing.', 'event');
    return;
  end if;

  v_it := carried(p_world, p_uid, target_item(p_target));
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
    /*
     * And the tree, which is the one place fineness runs backwards: what a
     * mend costs the piece rather than what a pass puts on it. A mender whose
     * work comes back better than it went is a mender who takes less off, so
     * the multiplier divides here and multiplies everywhere else. It is the
     * same number saying the same thing about a different quantity.
     */
    v_lost := v_healed * greatest(0.004, 0.03 - v_skill * 0.00026)
            / class_mul(p_world, p_uid, 'fine', 'repair');
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
    -- A failed pass marks the piece rather than spoiling it outright. Oak and
    -- the deep metals are stubborn under the file as under the saw. The gain
    -- used to be written above the roll, which paid a marked piece what a
    -- passed one is worth.
    v_ok := skill_check(skill_of(p_world, p_uid, v_what.skill),
        12 + v_it.ql / 3 + mat_difficulty(v_it.extra), v_tool_ql,
        mind_ease(p_world, p_uid));
    perform skill_raise(p_world, p_uid, v_what.skill, try_gain(v_ok, improve_gain()));
    if not v_ok then
      perform damage_item(v_it.id, 3 + random() * 5);
      perform tell(p_world, p_uid, 'You work at the ' || v_name || ' and mark it. (damage '
        || to_char((select dmg from item where id = v_it.id), 'FM990.0') || ')', 'event');
      return;
    end if;
    v_ceiling := least(99.9, improve_ceiling(p_world, p_uid, v_what.skill, v_it.rare));
    -- And the tree, on the trade that would have made the thing: a smith's
    -- temper is worth as much at the file as at the anvil. The ceiling is
    -- untouched, so this buys passes rather than a higher top.
    update item set ql = greatest(ql, least(v_ceiling,
        ql + improve_step(skill_of(p_world, p_uid, v_what.skill), ql)
             * class_mul(p_world, p_uid, 'fine', v_what.skill)))
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

CREATE OR REPLACE FUNCTION public.perform_dig(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare tx int; ty int; it item; r relic_def; v_skill double precision; v_tool double precision;
        v_part int; v_ql double precision; v_dmg double precision; v_left int; v_new bigint;
        v_missing int[]; v_relic text; v_avg double precision; v_gain double precision;
        /*
         * `v_piece`, not `h`. The seventh time this class has bitten and the
         * first that was not a column name: `h` was the loop variable *and*
         * the alias of `pieces_held(...) h`, so `h.ql` was ambiguous between a
         * record field and a column of the very rows being looped over. Alias
         * every table, prefix every local, and the two can never meet.
         */
        v_piece item;
        v_lectern boolean; v_roll double precision; v_sum double precision;
begin
  if p_action = 'investigate' then
    tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
    perform mark_foraged(p_world, tx, ty, 'dig');
    v_skill := skill_of(p_world, p_uid, 'archaeology');
    v_tool := tool_ql(p_world, p_uid, 'trowel');
    if random() > find_chance(v_skill, v_tool) then
      -- Half a go here, where the browser's blanket pays a whole one. That
      -- disagreement is older than this change and is left where it is: what
      -- moves today is only what a *failed* go is worth.
      perform skill_raise(p_world, p_uid, 'archaeology', try_gain(false, 0.5));
      perform tell(p_world, p_uid,
        'You go through the soil and turn up nothing but roots and small stones.', 'event');
      return;
    end if;
    perform skill_raise(p_world, p_uid, 'archaeology', try_gain(true, 0.5));
    if not exists (select 1 from relics_within(v_skill)) then
      perform tell(p_world, p_uid,
        'You turn up a scrap of something worked, but you cannot tell what it was and it crumbles.',
        'event');
      return;
    end if;
    -- The commonplace comes up far more often than the rare, as it did when
    -- it was lost: weighted by difficulty, and the weights are small numbers.
    select sum(1 / (1 + w.difficulty / 12)) into v_sum from relics_within(v_skill) w;
    v_roll := random() * v_sum;
    for r in select * from relics_within(v_skill) loop
      v_roll := v_roll - 1 / (1 + r.difficulty / 12);
      exit when v_roll <= 0;
    end loop;
    -- A piece you are still short of, if you are short of any.
    v_missing := parts_missing(p_world, p_uid, r.name);
    if coalesce(array_length(v_missing, 1), 0) > 0 then
      v_part := v_missing[1 + floor(random() * array_length(v_missing, 1))::int];
    else
      v_part := 1 + floor(random() * r.parts)::int;
    end if;
    v_ql := greatest(1, product_ql(v_skill, v_tool) * (0.55 + random() * 0.35));
    -- Nothing comes out of the ground sound.
    v_dmg := 18 + random() * 50;
    v_new := give(p_world, p_uid, 'fragment', 1, v_ql, r.name || ' ' || v_part || '/' || r.parts);
    update item set dmg = v_dmg where id = v_new;
    v_left := coalesce(array_length(parts_missing(p_world, p_uid, r.name), 1), 0);
    perform tell(p_world, p_uid, 'Your trowel turns up a fragment of ' || r.name || ', piece '
      || v_part || ' of ' || r.parts || '. (QL ' || to_char(v_ql, 'FM990.0')
      || ', damage ' || to_char(v_dmg, 'FM990') || ')'
      || case when v_left > 0 then ' ' || v_left || ' of ' || r.parts || ' still missing.'
              else ' That is all ' || r.parts || ' of them.' end, 'event');
    return;
  end if;

  select * into it from item where world_id = p_world and id = target_item(p_target);
  if not found then return; end if;

  if p_action = 'study_book' then
    -- A lectern holds the pages open at the right angle, and you get twice as
    -- much out of the hour.
    v_lectern := exists (select 1 from placed p where p.world_id = p_world and p.kind = 'furniture'
                           and p.sub = 'lectern' and near_piece(p_world, p_uid, p, 2.6));
    v_gain := skill_raise(p_world, p_uid, 'mind_logic',
      (0.5 + it.ql / 90) * case when v_lectern then 2 else 1 end);
    perform damage_item(it.id, 2 + random() * 3);
    perform tell(p_world, p_uid, 'You work through the ' || lower(item_name(it)) || '.'
      || case when v_lectern
              then ' The lectern holds it open at the right angle and you make good use of the hour.'
              else ' Held in one hand, it is hard going. A lectern would be better.' end
      || case when v_gain > 0.0005 then '' else ' There is nothing left in it you do not already know.' end,
      'event');
    return;
  end if;

  -- Restoring: every piece in at once, and what comes out is only as good as
  -- the pieces that went in, less what age took.
  v_relic := fragment_relic(it.extra);
  select * into r from relic_def where name = v_relic;
  if not found then return; end if;
  if not skill_check(skill_of(p_world, p_uid, 'restoration'), r.difficulty, 0,
                     mind_ease(p_world, p_uid)) then
    for v_piece in select * from pieces_held(p_world, p_uid, v_relic) loop
      perform damage_item(v_piece.id, 5 + random() * 9);
    end loop;
    perform skill_raise(p_world, p_uid, 'mind_logic', try_gain(false, restore_gain()));
    perform tell(p_world, p_uid, 'The pieces of the ' || r.name
      || ' will not sit together and you mark them trying.', 'event');
    return;
  end if;
  select avg(h.ql * (1 - h.dmg / 200)) into v_avg from pieces_held(p_world, p_uid, v_relic) h;
  -- And the tree, on restoration, which is the mender's and the only quality
  -- on this island that comes out of pieces rather than out of stock.
  v_ql := greatest(1, least(100, v_avg * (0.72 + skill_of(p_world, p_uid, 'restoration') / 260)
                                * class_mul(p_world, p_uid, 'fine', 'restoration')));
  for v_piece in select * from pieces_held(p_world, p_uid, v_relic) loop
    perform consume(p_world, p_uid, 'fragment', 1, v_piece.id);
  end loop;
  v_new := give(p_world, p_uid, r.result, 1, v_ql);
  perform skill_raise(p_world, p_uid, 'mind_logic', try_gain(true, restore_gain()));
  perform tell(p_world, p_uid, 'The pieces go back together and the ' || r.name || ' is whole: '
    || lower((select item_name(i) from item i where i.id = v_new))
    || '. (QL ' || to_char(v_ql, 'FM990.0') || ')', 'event');
end $function$;

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
  end if;
  if c.kind = 'craft' then
    update player set craft_class = p_class, class_taken = now() where world_id = p_world and uid = me;
  else
    update player set combat_class = p_class, class_taken = now() where world_id = p_world and uid = me;
  end if;
  perform class_fold(p_world, me);

  perform tell(p_world, me, case when v_had is null
    then 'You take up the ' || lower(c.name) || '’s trade. ' || c.lever
    else 'You put the ' || lower((select name from class_def where id = v_had))
         || '’s trade down and take up the ' || lower(c.name) || '’s, for '
         || v_cost || ' silver. ' || c.lever end, 'system');
  return jsonb_build_object('took', p_class, 'kind', c.kind, 'paid', v_cost, 'was', v_had);
end $function$;

CREATE OR REPLACE FUNCTION public.rpc_classes(p_world uuid)
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
    'taken', jsonb_build_object('craft', p.craft_class, 'combat', p.combat_class),
    'at', class_at()::int,
    'change_cost', class_change_cost()::bigint,
    'purse', purse(p_world, me),
    'classes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'kind', c.kind, 'name', c.name, 'note', c.note,
        'main', c.main, 'lever', c.lever,
        'skills', (select jsonb_agg(cs.skill order by cs.skill) from class_skill cs where cs.class = c.id),
        -- What the trade would be worth in points if it were taken up, which
        -- is a thing worth knowing before taking it up.
        'points', class_points(p_world, me, c.id),
        'open', class_open(p_world, me, c.id),
        'why', class_refusal(p_world, me, c.id)) order by c.kind, c.name)
      from class_def c), '[]'::jsonb));
end $function$;

notify pgrst, 'reload schema';
select private.lock_doors();
