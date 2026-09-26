/*
 * Perks: six tiers of three, and the Terraformer's eighteen.
 *
 * Asked for: "We are replacing the current bonuses", and then "Every class
 * will have 6 tiers: level 50, 60, 70, 80, 90, 100. Each tier allows one
 * choice between 3 choices." A craft trade in `PERK_CLASSES` has no tree any
 * more. It has eighteen perks, three to a tier; the first tier opens with the
 * trade and the rest at sixty to a hundred in its main skill, and at each the
 * holder takes one of the three. The Terraformer is the first trade moved
 * over, whole; the others keep their trees until all eighteen of theirs do
 * what they say.
 *
 * ## Choosing
 *
 * `rpc_take_perk` takes one, after `perk_refusal`'s four reasons -- not your
 * trade's, already yours, another taken at that tier, or the tier not open --
 * which are the browser's `perkRefusal` word for word. A perk is a row in
 * `player_node`, the same table a node is, so putting a trade down clears its
 * perks with its nodes: for silver in `rpc_take_class`, and with a Bauble of
 * Regret in `rpc_regret_class`.
 *
 * ## What a perk does
 *
 * Every perk is numbers keyed by what they change (`class_perk.fx`), and
 * `class_fold` folds the ones somebody holds into `class_mul.fx` on their row,
 * by the key's family (`perk_fx_rule`): times multiply, a carry adds, and the
 * rest are the larger. A rule reads its key with `pk`, and the rule's own
 * number is the default -- so for anybody without the perk nothing moves.
 *
 * Deep in the rules, where a function is handed neither the body nor the job
 * (`gather`, `maybe_map`), the fold is read from the job's own context
 * instead: `settle` sets `wurm.pk` and `wurm.pk_act` around each go, the way
 * it already sets `wurm.bauble_go`, and clears them after it, so nothing done
 * outside a go -- a creature's work, somebody else's go -- ever sees them.
 *
 * ## The trees that were
 *
 * The Terraformer's nine nodes are gone from `class_node` with this change
 * to the rulebook, and taken nodes are cleared here and the fold written
 * again, so nobody keeps a number the rules no longer have.
 */
set local lock_timeout = '3s';

create table if not exists class_perk (
  id text primary key, class text not null, tier int not null, num int not null,
  name text not null, note text not null, fx jsonb not null
);
create table if not exists perk_fx_rule (
  family text primary key, rule text not null
);
create table if not exists perk_tier (
  tier int primary key, at int not null
);
alter table tile_def add column if not exists road boolean not null default false;

/* One number off a fold's perks, or the rule's own when no perk changes it. */
create or replace function pk(p_mul jsonb, p_key text, p_else double precision)
 returns double precision language sql immutable as $fn$
  select coalesce((p_mul->'fx'->>p_key)::double precision, p_else)
$fn$;

/* The same, for a body by its keys, for the rules that do not hold the row. */
create or replace function pk(p_world uuid, p_uid uuid, p_key text, p_else double precision)
 returns double precision language sql stable as $fn$
  select pk(coalesce((select pl.class_mul from player pl
                       where pl.world_id = p_world and pl.uid = p_uid), '{}'::jsonb), p_key, p_else)
$fn$;

/*
 * And off the go in hand, for the rules deep enough to be handed neither the
 * body nor the job: `settle` sets `wurm.pk` to the fold's perks for the length
 * of a go and nothing else ever does, so outside one this is the default.
 */
create or replace function pkx(p_key text, p_else double precision)
 returns double precision language sql stable as $fn$
  select coalesce((nullif(current_setting('wurm.pk', true), '')::jsonb ->> p_key)::double precision, p_else)
$fn$;

/* The job whose go this is, or nothing outside one. */
create or replace function pkx_act() returns text language sql stable as $fn$
  select nullif(current_setting('wurm.pk_act', true), '')
$fn$;

/*
 * A roll that failed, passed after all at the rate a perk says it fails
 * less: `fail` is what is left of the failures, so nought passes every one
 * and one passes none.
 */
create or replace function perk_pass(p_ok boolean, p_fail double precision)
 returns boolean language sql volatile as $fn$
  select p_ok or random() >= p_fail
$fn$;

/*
 * Something gathered coming up rare at a perk's own chance, and rolling on
 * from there to supreme and fantastic at the odds everything else has
 * (`rarity_def`, which is `rarity_roll`'s). Nothing, without the perk.
 */
create or replace function perk_rare(p_chance double precision)
 returns text language plpgsql volatile as $fn$
declare r rarity_def; got text := null; first boolean := true;
begin
  if coalesce(p_chance, 0) <= 0 then return null; end if;
  for r in select * from rarity_def order by ord loop
    exit when random() >= case when first then p_chance else r.odds end;
    first := false;
    got := r.id;
  end loop;
  return got;
end $fn$;

/*
 * Why a perk cannot be taken, or nothing. The browser's `perkRefusal`, word
 * for word, in the same order.
 */
create or replace function perk_refusal(p_world uuid, p_uid uuid, p_perk text)
 returns text language plpgsql stable as $fn$
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
  v_at := (select at from perk_tier where tier = k.tier);
  v_main := skill_of(p_world, p_uid, c.main);
  if k.tier > 1 and v_main < v_at then
    return 'This tier opens at ' || v_at || ' in ' || replace(c.main, '_', ' ')
        || '; you have ' || floor(v_main)::int || '.';
  end if;
  return null;
end $fn$;

/* Take one: one of the three at a tier, for as long as the trade is held. */
create or replace function rpc_take_perk(p_world uuid, p_perk text) returns jsonb
 language plpgsql security definer set search_path to 'public' as $fn$
declare me uuid := auth.uid(); k class_perk; v_why text; v_mul jsonb;
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
  perform tell(p_world, me, k.name || '. ' || k.note, 'system');
  return jsonb_build_object('took', p_perk, 'mul', v_mul);
end $fn$;
revoke all on function perk_refusal(uuid, uuid, text) from public, anon, authenticated;


CREATE OR REPLACE FUNCTION public.class_fold(p_world uuid, p_uid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare p player; v jsonb := '{}'::jsonb; n record; m double precision;
        v_fx jsonb := '{}'::jsonb; e record; v_rule text; v_had double precision;
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
  /*
   * And the perks, key by key, by the family's rule (`perk_fx_rule`): times
   * multiply, a carry adds, and anything else is the larger of the two. In id
   * order, as the browser's `foldPerks` is asked to agree with.
   */
  for e in
    select x.key, x.value::double precision as val
      from player_node pn join class_perk cp on cp.id = pn.node
      cross join lateral jsonb_each_text(cp.fx) x
     where pn.world_id = p_world and pn.uid = p_uid
       and cp.class in (p.craft_class, p.combat_class)
     order by cp.id, x.key
  loop
    v_rule := (select r.rule from perk_fx_rule r where r.family = split_part(e.key, ':', 1));
    v_had := (v_fx->>e.key)::double precision;
    v_fx := jsonb_set(v_fx, array[e.key], to_jsonb(case
      when v_had is null then e.val
      when v_rule = 'mul' then v_had * e.val
      when v_rule = 'add' then v_had + e.val
      else greatest(v_had, e.val) end));
  end loop;
  v := jsonb_set(v, '{fx}', v_fx, true);
  update player set class_mul = v where world_id = p_world and uid = p_uid;
  return v;
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
          from class_node n where n.class = c.id)) ||
        -- A trade moved over to perks: its six tiers, each with its three.
        case when exists (select 1 from class_perk k where k.class = c.id) then jsonb_build_object('tiers', (
          select jsonb_agg(jsonb_build_object(
            'tier', t.tier, 'at', t.at,
            'open', t.tier = 1 or skill_of(p_world, me, c.main) >= t.at,
            'perks', (select jsonb_agg(jsonb_build_object(
                'id', k.id, 'name', k.name, 'note', k.note,
                'taken', exists (select 1 from player_node pn
                                  where pn.world_id = p_world and pn.uid = me and pn.node = k.id),
                'why', perk_refusal(p_world, me, k.id)) order by k.num)
              from class_perk k where k.class = c.id and k.tier = t.tier)) order by t.tier)
            from perk_tier t)) else '{}'::jsonb end order by c.kind)
      from class_def c where c.id in (p.craft_class, p.combat_class)), '[]'::jsonb));
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
    -- And its perks, which are rows in the same table.
    delete from player_node pn using class_perk k
     where k.id = pn.node and pn.world_id = p_world and pn.uid = me and k.class = v_had;
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
    update player set combat_class = null where world_id = p_world and uid = me;
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
                             act_scope(p_world, me, d.skill)) * bauble_pace(p_world, me, d.skill)
                 -- And what a perk makes of this job's time: a Terraformer's Quick Level.
                 * pk(coalesce(p.class_mul, '{}'::jsonb), 'time:' || p_action, 1)) end;
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

CREATE OR REPLACE FUNCTION public.settle(p_world uuid, p_uid uuid)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare p player; d action_def; done int := 0; guard int := 0; nxt jsonb; ended timestamptz;
        v_err text; v_state text; v_where text;
begin
  /*
   * One body's work, and nobody else's.
   *
   * Everything below used to run bare, and `world_tick` settles every body on
   * every island in one transaction: one go that raised an error took the
   * whole round down with it, every second, for as long as that job was
   * still due. Reported as "something just broke, no actions are working":
   * `take_spoil` set the last spadeful in a cart to a count of 0, which the
   * item table refuses, and for a quarter of an hour nothing anybody did on
   * the island finished.
   *
   * So the goes run in a block of their own. A fault undoes what the block
   * had done -- the goes that had come due in this call, and nothing else --
   * stops that job and the queue behind it, tells its owner what the island
   * said, and is kept in `private.tick_fault` for the deploy to report. A
   * deadlock, a lock that timed out or a serialization failure is not a
   * fault in the job: those are raised as before, and the job is tried again
   * next round. A statement timeout is not caught by `others` at all.
   */
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
      -- A go, for what the baubles make of its yield (`bauble_yield`), and
      -- what they made of it said after the go has said its own piece.
      perform set_config('wurm.bauble_go', 'go', true);
      perform set_config('wurm.bauble_made', '', true);
      -- And the perks, for the rules too deep to be handed the body: for
      -- this go and no other (`pkx`), cleared the moment it is done.
      perform set_config('wurm.pk', coalesce(p.class_mul->'fx', '{}'::jsonb)::text, true);
      perform set_config('wurm.pk_act', p.act, true);
      perform act_perform(p_world, p_uid, p.act, p.act_target);
      perform set_config('wurm.pk', '', true);
      perform set_config('wurm.pk_act', '', true);
      perform bauble_said(p_world, p_uid);
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
                               act_scope(p_world, p_uid, d.skill)) * bauble_pace(p_world, p_uid, d.skill)
                   * pk(coalesce(p.class_mul, '{}'::jsonb), 'time:' || d.id, 1)))
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
                                   act_scope(p_world, p_uid, d.skill)) * bauble_pace(p_world, p_uid, d.skill)
                       * pk(coalesce(p.class_mul, '{}'::jsonb), 'time:' || d.id, 1))),
                   act_queue = act_queue - 0
              where world_id = p_world and uid = p_uid returning * into p;
            perform tell(p_world, p_uid, 'You start ' || d.verb || '.', 'info');
            exit;
          end if;
        end loop;
      end if;
    end loop;
    return done;
  exception
    when deadlock_detected or lock_not_available or serialization_failure then raise;
    when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate, v_where = pg_exception_context;
      perform settle_fault(p_world, p_uid, v_err, v_state, v_where);
      return 0;
  end;
end $function$;

CREATE OR REPLACE FUNCTION public.act_ported(p_action text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  select exists (select 1 from recipe where id = p_action)
      or last_action(p_action)
      or faith_action(p_action)
      or ride_action(p_action)
      or trap_action(p_action)
      or dig_action(p_action)
      or treasure_action(p_action)
      or settlement_action(p_action)
      or holding_action(p_action)
      or forge_action(p_action)
      or liquid_action(p_action)
      or hands_action(p_action)
      or ground_action(p_action)
      or item_action(p_action)
      or firing_action(p_action)
      or fire_action(p_action)
      or crate_action(p_action)
      -- Fitting a padlock, and taking one off again.
      or p_action in ('fit_lock', 'take_off_lock')
      or build_action(p_action)
      or creature_action(p_action)
      or fight_action(p_action)
      or foundation_action(p_action)
      or p_action in ('dig', 'mine', 'chip_corner', 'pack', 'cultivate', 'pave_cobble',
                      'drop_dirt_here', 'cut_down', 'forage', 'botanize', 'collect',
                      'till', 'plant_seed', 'tend_crop', 'harvest_crop', 'clear_field',
                      'fish', 'drag_net', 'found_settlement', 'set_to_work', 'dig_tile')
$function$;

CREATE OR REPLACE FUNCTION public.act_refusal_rules(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare d action_def; p player; cx int; cy int; tx int; ty int; t tile_def; aimed text;
begin
  select * into d from action_def where id = p_action;
  if not found then return 'There is no such thing as ' || p_action || '.'; end if;
  select * into p from player where world_id = p_world and uid = p_uid;
  if not found then return 'You are not on this island.'; end if;
  -- Deliberately not "are you busy": asked of queued jobs too. That is rpc_act's.
  if not act_ported(p_action) then
    return 'You cannot ' || lower(d.label) || ' on this island yet.';
  end if;

  -- A crate with a wildermon in it is carried, set down or opened, and that is all.
  aimed := occupied_crate_refusal(p_world, p_uid, p_action, p_target);
  if aimed is not null then return aimed; end if;
  aimed := p_target->>'kind';
  -- Whose ground it is, before anything about what it is made of.
  aimed := ground_deed_refusal(p_world, p_uid, p_action, p_target);
  if aimed is not null then return aimed; end if;
  aimed := p_target->>'kind';
  -- The hour comes for a dam in young whoever is or is not standing there, and
  -- somebody is always about to do something. This is where they find out.
  perform herd_settle(p_world);
  -- The last ten answer for their own reach, every one of them: a bridge is
  -- worked from either bank, a bed is furniture, and a beast is not at a tile.
  -- First of all, because a map is an item and every other family that takes
  -- an item wants one it can name a use for. This one is aimed at the map.
  if treasure_action(p_action) then
    return treasure_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if last_action(p_action) then
    return last_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Then the only family that does not care what it is
  -- pointed at: a prayer wants an altar, a cast wants a name, and the other
  -- three want nothing but the ground you are sitting on.
  if faith_action(p_action) then
    return faith_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Then the ones asked of a beast, which is not at a
  -- tile, and half of a cart, which is furniture and would otherwise be handed
  -- to the code that lights fires. Both answer for their own reach.
  if ride_action(p_action) then
    return ride_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if hands_action(p_action) then
    return hands_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Before the one that lights fires, which is what pointing at furniture has
  -- meant up to now: a barrel is furniture too, and tipping it out is not a fire.
  if liquid_action(p_action) then
    return liquid_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Also before the one that lights fires: an oven is furniture and an anvil
  -- is pointed at the same way a kiln is, and neither wants that route.
  if forge_action(p_action) then
    return forge_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if holding_action(p_action) then
    return holding_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- The token is under your feet and a post answers for its own reach, so
  -- neither wants the reach check below.
  if settlement_action(p_action) then
    return settlement_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if dig_action(p_action) then
    return dig_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- A trap answers for its own reach, and rolls itself forward before it
  -- answers anything at all.
  if trap_action(p_action) then
    return trap_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Working the ground answers for its own reach for the same reason: a
  -- corner is a place rather than a thing, and `drop_dirt` names one.
  if ground_action(p_action) then
    if not in_reach(p.x, p.y, p_target, d.corner, d.range) then return 'You are too far away from that.'; end if;
    if d.tool is not null and tool_ql(p_world, p_uid, d.tool) <= 0 then
      return 'You need a ' || lower((select coalesce(name, d.tool) from item_def where id = d.tool)) || ' to ' || lower(d.label) || '.';
    end if;
    return ground_refusal(p_world, p_uid, p_action, p_target);
  end if;
  /*
   * A furnace is brought up to date before anything asks it a question: its
   * fire and its queue together, so that "is anything finished" is answered
   * about now rather than about whenever somebody last stood here.
   */
  if aimed in ('smelter', 'kiln') then
    perform furnace_settle(p_world, nullif(p_target->>'id', '')::bigint);
  end if;
  if item_action(p_action) then
    return item_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if firing_action(p_action) then
    return firing_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if aimed in ('campfire', 'smelter', 'kiln', 'furniture', 'anvil') or fire_action(p_action) then
    return fire_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- A crate is reached for rather than stood in front of, so it answers for
  -- its own reach the way the creatures do.
  if crate_action(p_action) then
    return crate_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Fitting a padlock and taking one off: aimed at a crate or at a piece of
  -- furniture, so it sits beside the family that answers for crates.
  if p_action in ('fit_lock', 'take_off_lock') then
    return lock_refusal_for(p_world, p_uid, p_action, p_target);
  end if;
  -- The stake is in your hand and the ground is under your feet: nothing to reach for.
  if p_action = 'found_settlement' then
    return deed_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- A creature is not at a tile, it is wherever its last leg left it, so the
  -- reach check below cannot answer for it. Both of these do their own; the
  -- fighting ones reach as far as what is in your hand, which is further.
  if creature_action(p_action) then
    return creature_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if fight_action(p_action) then
    return fight_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if not in_reach(p.x, p.y, p_target, d.corner, d.range) then return 'You are too far away from that.'; end if;
  if d.tool is not null and tool_ql(p_world, p_uid, d.tool) <= 0 then
    return 'You need a ' || lower((select coalesce(name, d.tool) from item_def where id = d.tool)) || ' to ' || lower(d.label) || '.';
  end if;
  if foundation_action(p_action) then
    return foundation_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if build_action(p_action) then
    return build_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if p_action in ('mine', 'chip_corner', 'pack', 'cultivate', 'pave_cobble', 'drop_dirt_here') then
    return terrain_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if p_action in ('cut_down', 'forage', 'botanize', 'collect') then
    return gather_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if p_action in ('till', 'plant_seed', 'tend_crop', 'harvest_crop', 'clear_field') then
    return farm_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if p_action in ('fish', 'drag_net') then
    return fish_refusal(p_world, p_uid, p_action, p_target);
  end if;

  if exists (select 1 from recipe where id = p_action) then
    return craft_refusal(p_world, p_uid, p_action, target_item(p_target));
  end if;

  if p_action = 'dig' then
    cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
    tx := (p_target->>'x')::int;  ty := (p_target->>'y')::int;
    select * into t from tile_def where id = land_tile(p_world, tx, ty);
    if t.dig_yield is null then return 'You cannot dig that.'; end if;
    /*
     * The same depth a pick works to. This was the exact line `terrain_refusal`
     * condemns in its own comment — `<= 0` refuses a corner standing at the
     * waterline, where no water is drawn — and mining was fixed for it while
     * digging was left with it.
     */
    -- Deeper for a Terraformer who wades.
    if land_height(p_world, cx, cy) < -pk(p.class_mul, 'depth:dig', mine_depth()) then
      return 'The water is too deep here to work in.';
    end if;
    if land_dirt(p_world, cx, cy) <= 0 then
      return 'That corner is bare rock. Only a pickaxe will take it lower.';
    end if;
    return coalesce(level_stop(p_world, p_uid, cx, cy, -1),
                    slope_refusal(p_world, p_uid, 'digging', cx, cy, -1));
  end if;
  -- A Terraformer's Dig out the tile: every corner of it asked what a dig asks.
  if p_action = 'dig_tile' then
    tx := (p_target->>'x')::int;  ty := (p_target->>'y')::int;
    if pk(p.class_mul, 'dig_tile', 0) <= 0 then
      return 'That wants a Terraformer who has learned to dig out a whole tile.';
    end if;
    select * into t from tile_def where id = land_tile(p_world, tx, ty);
    if t.dig_yield is null then return 'You cannot dig that.'; end if;
    for cx, cy in select c.cx, c.cy from tile_corners(tx, ty) c loop
      aimed := corner_under_building(p_world, cx, cy);
      if aimed is not null then return aimed; end if;
      if land_height(p_world, cx, cy) < -pk(p.class_mul, 'depth:dig', mine_depth()) then
        return 'The water is too deep here to work in.';
      end if;
      if land_dirt(p_world, cx, cy) <= 0 then
        return 'A corner of it is bare rock. Only a pickaxe will take that lower.';
      end if;
      aimed := coalesce(level_stop(p_world, p_uid, cx, cy, -1),
                        slope_refusal(p_world, p_uid, 'digging', cx, cy, -1));
      if aimed is not null then return aimed; end if;
    end loop;
    return null;
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.act_perform(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare d action_def; tq double precision; s double precision; cx int; cy int; tx int; ty int;
        t tile_def; left_dirt int; made_ql double precision; yield text; tool_id bigint;
begin
  if last_action(p_action) then
    perform perform_last(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if faith_action(p_action) then
    perform perform_faith(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if ride_action(p_action) then
    perform perform_ride(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if hands_action(p_action) then
    perform perform_hands(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if liquid_action(p_action) then
    perform perform_liquid(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if forge_action(p_action) then
    perform perform_forge(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if holding_action(p_action) then
    perform perform_holding(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if settlement_action(p_action) then
    perform perform_settlement(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if dig_action(p_action) then
    perform perform_dig(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if trap_action(p_action) then
    perform perform_trap(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if ground_action(p_action) then
    perform perform_ground(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if foundation_action(p_action) then
    perform perform_foundation(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if build_action(p_action) then
    perform perform_building(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if p_action = 'found_settlement' then
    perform perform_deed(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if creature_action(p_action) then
    perform perform_creature(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if fight_action(p_action) then
    perform perform_fight(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if p_action in ('fit_lock', 'take_off_lock') then
    perform perform_lock(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if crate_action(p_action) then
    perform perform_crate(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if item_action(p_action) then
    perform perform_item(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if firing_action(p_action) then
    perform perform_firing(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if fire_action(p_action) then
    perform perform_fire(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if treasure_action(p_action) then
    perform perform_treasure(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if p_action in ('mine', 'chip_corner', 'pack', 'cultivate', 'pave_cobble', 'drop_dirt_here') then
    perform perform_terrain(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if p_action in ('cut_down', 'forage', 'botanize', 'collect') then
    perform perform_gather(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if p_action in ('till', 'plant_seed', 'tend_crop', 'harvest_crop', 'clear_field') then
    perform perform_farm(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if p_action in ('fish', 'drag_net') then
    perform perform_fish(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if exists (select 1 from recipe where id = p_action) then
    perform perform_craft(p_world, p_uid, p_action, p_target);
    return;
  end if;

  select * into d from action_def where id = p_action;
  s := case when d.skill is null then 50 else skill_of(p_world, p_uid, d.skill) end;
  tq := case when d.tool is null then 0 else tool_ql(p_world, p_uid, d.tool) end;

  if p_action = 'dig_tile' then
    perform perform_dig_tile(p_world, p_uid, p_target);
    return;
  end if;

  if p_action = 'dig' then
    cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
    tx := (p_target->>'x')::int;  ty := (p_target->>'y')::int;
    select * into t from tile_def where id = land_tile(p_world, tx, ty);
    select i.id into tool_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = d.tool
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if tool_id is not null then perform wear_tool(tool_id); end if;
    if not skill_check(s, d.difficulty, tq) then
      perform skill_raise(p_world, p_uid, d.skill, try_gain(false));
      perform tell(p_world, p_uid, 'You fail to dig anything useful.', 'event');
      return;
    end if;
    perform land_set_height(p_world, cx, cy, land_height(p_world, cx, cy) - 1);
    left_dirt := land_dirt(p_world, cx, cy) - 1;
    perform land_set_dirt(p_world, cx, cy, left_dirt);
    if t.turns_to_dirt then perform land_set_tile(p_world, tx, ty, 1); end if;
    -- Dug to the rock, the tile becomes rock and shows the seam under it.
    perform reconcile_around(p_world, cx, cy);
    perform land_announce(p_world, tx, ty);
    if left_dirt <= 0 then
      perform tell(p_world, p_uid, 'Your shovel grates on bare rock.', 'event');
    end if;
    yield := coalesce(t.dig_yield, 'dirt');
    -- Cleaner for a Terraformer's Clean Earth, and now and then rare.
    made_ql := least(100, product_ql(s, tq) * pkx('ql:dig', 1));
    perform gather(p_world, p_uid, yield, 1, made_ql, null, perk_rare(pkx('rare:dig', 0)));
    -- And one spadeful in a thousand that is not dirt at all.
    perform maybe_map(p_world, p_uid, s, tq);
    perform skill_raise(p_world, p_uid, d.skill, 1);
    perform tell(p_world, p_uid,
      'You dig up some ' || lower((select name from item_def where id = yield)) ||
      '. (QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
  end if;
end $function$;


/*
 * A Terraformer's Dig out the tile: all four corners down by one in a single
 * go, and four of what the ground is made of. The same roll, the same tool
 * and the same quality as a dig, once; the same map in a thousand -- or in
 * two hundred, for Treasure Nose -- once.
 */
create or replace function perform_dig_tile(p_world uuid, p_uid uuid, p_target jsonb)
 returns void language plpgsql as $fn$
declare d action_def; t tile_def; tx int; ty int; s double precision; tq double precision;
        tool_id bigint; c record; v_yield text; v_ql double precision;
begin
  select * into d from action_def where id = 'dig_tile';
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  select * into t from tile_def where id = land_tile(p_world, tx, ty);
  s := skill_of(p_world, p_uid, 'digging');
  tq := tool_ql(p_world, p_uid, 'shovel');
  select i.id into tool_id from item i
    where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'shovel'
    order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
  if tool_id is not null then perform wear_tool(tool_id); end if;
  if not skill_check(s, d.difficulty, tq) then
    perform skill_raise(p_world, p_uid, 'digging', try_gain(false));
    perform tell(p_world, p_uid, 'You fail to dig anything useful.', 'event');
    return;
  end if;
  for c in select * from tile_corners(tx, ty) loop
    perform land_set_height(p_world, c.cx, c.cy, land_height(p_world, c.cx, c.cy) - 1);
    perform land_set_dirt(p_world, c.cx, c.cy, land_dirt(p_world, c.cx, c.cy) - 1);
  end loop;
  if t.turns_to_dirt then perform land_set_tile(p_world, tx, ty, 1); end if;
  for c in select * from tile_corners(tx, ty) loop
    perform reconcile_around(p_world, c.cx, c.cy);
  end loop;
  perform land_announce(p_world, tx, ty);
  v_yield := coalesce(t.dig_yield, 'dirt');
  v_ql := least(100, product_ql(s, tq) * pkx('ql:dig', 1));
  perform gather(p_world, p_uid, v_yield, corners_per_tile()::int, v_ql, null, perk_rare(pkx('rare:dig', 0)));
  perform maybe_map(p_world, p_uid, s, tq);
  perform skill_raise(p_world, p_uid, 'digging', 1);
  perform tell(p_world, p_uid, 'You dig the whole tile down and come away with ' || corners_per_tile()::int || ' × '
    || lower((select name from item_def where id = v_yield)) || '. (QL ' || to_char(v_ql, 'FM990.0') || ')', 'event');
end $fn$;


CREATE OR REPLACE FUNCTION public.perform_ground(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare tx int; ty int; cx int; cy int; here int; t tile_def; v_data int; v_tree tree_def;
        d action_def; v_spoil text;
        v_skill double precision; v_tool double precision; v_ql double precision; v_n int; v_slab item; v_kind int; v_target int; v_hi record; v_lo record;
        v_rock rock_def; v_rad int; v_tiles int[] := '{}'; v_names text[] := '{}'; v_row record;
        v_id bigint; v_species int; v_sprout item; v_buried text; v_size int;
        v_age tree_age_def; v_to tree_age_def;
begin
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  here := land_tile(p_world, tx, ty);
  select * into t from tile_def where id = here;
  v_data := land_data(p_world, tx, ty);
  select * into d from action_def where id = p_action;
  -- What this ground is made of, which digging has always read off the tile
  -- and flattening never did.
  v_spoil := coalesce(t.dig_yield, 'dirt');

  if p_action in ('take_level', 'clear_level') then
    if p_action = 'clear_level' then
      update player set level_h = null where world_id = p_world and uid = p_uid;
      perform tell(p_world, p_uid,
        'You put the level away. Flattening works to the ground you stand on again.', 'event');
    else
      cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
      update player set level_h = land_height(p_world, cx, cy) where world_id = p_world and uid = p_uid;
      perform tell(p_world, p_uid, 'You sight the level at ' || land_height(p_world, cx, cy)
        || '. Flattening works to it, and digging, dropping and concrete stop at it.', 'event');
    end if;
    return;
  end if;

  if p_action = 'flatten' then
    v_target := flatten_target(p_world, p_uid, tx, ty);
    -- The corners furthest above and below the height we are working towards.
    /*
     * The high corner has to be soil, because a shovel does not move rock. It
     * used to be the highest corner whatever it was made of, and a tile with
     * one rock shoulder on it stopped the whole run dead with "Mine it down
     * instead" while the other three corners still had work in them. The rock
     * is stepped round now and named at the end.
     */
    select c.cx, c.cy into v_hi from tile_corners(tx, ty) c
      where land_height(p_world, c.cx, c.cy) > v_target and land_dirt(p_world, c.cx, c.cy) > 0
      order by land_height(p_world, c.cx, c.cy) desc limit 1;
    select c.cx, c.cy into v_lo from tile_corners(tx, ty) c
      where land_height(p_world, c.cx, c.cy) < v_target
      order by land_height(p_world, c.cx, c.cy) limit 1;
    if v_hi.cx is null and v_lo.cx is null then
      perform tell(p_world, p_uid,
        case when exists (select 1 from tile_corners(tx, ty) c
                           where land_height(p_world, c.cx, c.cy) > v_target and land_dirt(p_world, c.cx, c.cy) <= 0)
             then 'What is still standing high here is bare rock. Mine it down.'
             else 'There is nothing left to move here.' end, 'error');
      return;
    end if;
    /*
     * A go moves `flatten_step` -- two units for a Terraformer's Level Hand --
     * but never past the height being worked to, so a corner one short of it
     * moves the one.
     */
    v_n := pk(p_world, p_uid, 'flatten:step', flatten_step())::int;
    if v_hi.cx is not null then
      v_n := least(v_n, land_height(p_world, v_hi.cx, v_hi.cy) - v_target, land_dirt(p_world, v_hi.cx, v_hi.cy));
    end if;
    if v_lo.cx is not null then v_n := least(v_n, v_target - land_height(p_world, v_lo.cx, v_lo.cy)); end if;
    v_n := greatest(1, v_n);
    if v_hi.cx is not null and v_lo.cx is not null then
      -- One corner down and one up: the dirt simply moves across the tile.
      perform raise_corner(p_world, v_hi.cx, v_hi.cy, -v_n);
      perform raise_corner(p_world, v_lo.cx, v_lo.cy, v_n);
      perform tell(p_world, p_uid, 'You move some dirt across the tile.', 'event');
    elsif v_hi.cx is not null then
      perform raise_corner(p_world, v_hi.cx, v_hi.cy, -v_n);
      perform gather(p_world, p_uid, v_spoil, v_n,
        least(100, product_ql(skill_of(p_world, p_uid, d.skill), tool_ql(p_world, p_uid, 'shovel'))
                   * pk(p_world, p_uid, 'ql:flatten', 1)));
      perform tell(p_world, p_uid, 'You scrape the ground down and pocket the '
        || lower((select name from item_def where id = v_spoil)) || '.', 'event');
    else
      /*
       * Its own stuff first and dirt after. Dirt fills anything, and it would
       * be a strange rule that let you take clay out of a bank and not put it
       * back.
       */
      if take_spoil(p_world, p_uid, v_spoil) then
        perform raise_corner(p_world, v_lo.cx, v_lo.cy, 1);
        -- And the second unit of a Level Hand's go, if there is soil for it.
        if v_n > 1 and take_spoil(p_world, p_uid, v_spoil) then perform raise_corner(p_world, v_lo.cx, v_lo.cy, 1); end if;
        perform tell(p_world, p_uid, 'You pack '
          || lower((select name from item_def where id = v_spoil))
          || ' in to bring the ground up.', 'event');
      elsif take_spoil(p_world, p_uid, 'dirt') then
        perform raise_corner(p_world, v_lo.cx, v_lo.cy, 1);
        if v_n > 1 and take_spoil(p_world, p_uid, 'dirt') then perform raise_corner(p_world, v_lo.cx, v_lo.cy, 1); end if;
        perform tell(p_world, p_uid, 'You pack dirt in to bring the ground up.', 'event');
      else
        perform tell(p_world, p_uid, 'You need '
          || lower((select name from item_def where id = v_spoil))
          || ' or dirt to bring this ground up, in the pack or in something beside you.', 'error');
        return;
      end if;
    end if;
    -- And what an hour of levelling ground teaches, which was nothing at all.
    perform skill_raise(p_world, p_uid, d.skill, 1);
    if t.turns_to_dirt then perform land_set_tile(p_world, tx, ty, 1); end if;
    perform land_announce(p_world, tx, ty);
    if not needs_flattening(p_world, p_uid, tx, ty) then
      perform tell(p_world, p_uid,
        case when floor((select x from player where world_id = p_world and uid = p_uid))::int = tx
              and floor((select y from player where world_id = p_world and uid = p_uid))::int = ty
             then 'The tile is now flat at its lowest corner.'
             else 'The tile is now flat and level with the ground you stand on.' end, 'event');
    end if;

  elsif p_action = 'drop_dirt' then
    cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
    -- Dirt, clay or sand: the one named off the menu, or the first to hand.
    v_spoil := spoil_near(p_world, p_uid, target_item(p_target));
    if v_spoil is null or not take_spoil(p_world, p_uid, v_spoil) then return; end if;
    perform raise_corner(p_world, cx, cy, 1);
    -- What a spadeful covers over becomes what was in it, off the list both
    -- sides read: a clay bank or a beach can be laid now as well as dug.
    if exists (select 1 from buryable b where b.tile = here) then
      perform land_set_tile(p_world, tx, ty, spoil_tile(v_spoil));
    end if;
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You drop the ' || lower((select name from item_def where id = v_spoil))
      || ' on the ' || corner_name(tx, ty, cx, cy) || ' corner, raising the ground.', 'event');

  elsif p_action = 'raise_rock' then
    cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
    -- Spent either way: concrete that slumps off is concrete gone.
    if not consume(p_world, p_uid, 'concrete', 1) then return; end if;
    v_skill := skill_of(p_world, p_uid, 'masonry');
    v_tool := tool_ql(p_world, p_uid, 'trowel');
    select i.id into v_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'trowel'
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if v_id is not null then perform wear_tool(v_id); end if;
    if not skill_check(v_skill, d.difficulty, v_tool) then
      perform skill_raise(p_world, p_uid, 'masonry', try_gain(false));
      perform tell(p_world, p_uid, 'The concrete slumps off the rock before it sets, and is lost.', 'event');
      return;
    end if;
    -- The rock rises: the height goes up and the soil over it stays nought.
    perform land_set_height(p_world, cx, cy, land_height(p_world, cx, cy) + 1);
    perform reconcile_around(p_world, cx, cy);
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You lay concrete on the ' || corner_name(tx, ty, cx, cy)
      || ' corner and the rock stands a step higher.', 'event');
    perform skill_raise(p_world, p_uid, 'masonry', 1);

  elsif p_action = 'dredge' then
    cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
    v_skill := skill_of(p_world, p_uid, 'digging');
    v_tool := tool_ql(p_world, p_uid, 'shovel');
    select i.id into v_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'shovel'
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if v_id is not null then perform wear_tool(v_id); end if;
    if not skill_check(v_skill, d.difficulty, v_tool) then
      perform skill_raise(p_world, p_uid, 'digging', try_gain(false));
      perform tell(p_world, p_uid, 'The shovel comes up with nothing but water.', 'event');
      return;
    end if;
    -- The bottom comes up a spadeful at a time, exactly as a corner ashore
    -- does under `dig`: the height and the soil over the rock go down
    -- together, and the water over it is that much deeper.
    perform land_set_height(p_world, cx, cy, land_height(p_world, cx, cy) - 1);
    v_n := land_dirt(p_world, cx, cy) - 1;
    perform land_set_dirt(p_world, cx, cy, v_n);
    if t.turns_to_dirt then perform land_set_tile(p_world, tx, ty, 1); end if;
    perform reconcile_around(p_world, cx, cy);
    perform land_announce(p_world, tx, ty);
    v_ql := least(100, product_ql(v_skill, v_tool) * pk(p_world, p_uid, 'ql:dredge', 1));
    perform gather(p_world, p_uid, v_spoil, 1, v_ql, null, perk_rare(pk(p_world, p_uid, 'rare:dredge', 0)));
    perform tell(p_world, p_uid, 'You dredge up some ' || lower((select name from item_def where id = v_spoil))
      || ' off the bottom at the ' || corner_name(tx, ty, cx, cy) || ' corner. (QL ' || to_char(v_ql, 'FM990.0') || ')', 'event');
    perform skill_raise(p_world, p_uid, 'digging', 1);

  elsif p_action = 'pave_slabs' then
    select i.* into v_slab from item i join slab_def s on s.item = i.def
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and not i.locked
      order by (i.id = target_item(p_target)) desc, i.id limit 1;
    if not found then return; end if;
    select id into v_kind from slab_def where item = v_slab.def;
    if not perk_pass(skill_check(skill_of(p_world, p_uid, 'paving'), d.difficulty, v_slab.ql),
                     pk(p_world, p_uid, 'fail:pave_slabs', 1)) then
      perform skill_raise(p_world, p_uid, 'paving', try_gain(false));
      perform tell(p_world, p_uid,
        'The slab rocks on its bed however you set it. You leave it for now.', 'event');
      return;
    end if;
    if not consume(p_world, p_uid, v_slab.def, 1, v_slab.id) then return; end if;
    perform land_set_tile(p_world, tx, ty, 21);
    perform land_set_data(p_world, tx, ty, v_kind);
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You bed the '
      || lower((select name from item_def where id = v_slab.def)) || ' down flat and true.', 'event');
    perform skill_raise(p_world, p_uid, 'paving', 1);

  elsif p_action = 'remove_paving' then
    -- A slab comes up whole more often than not; gravel and cobbles do not.
    v_kind := case when here = 21 then v_data & 3 else null end;
    perform land_set_tile(p_world, tx, ty, 1);
    perform land_announce(p_world, tx, ty);
    if v_kind is not null and random() < 0.6 then
      v_ql := product_ql(skill_of(p_world, p_uid, 'paving'));
      perform gather(p_world, p_uid, (select item from slab_def where id = v_kind), 1, v_ql);
      perform tell(p_world, p_uid, 'You lever the '
        || regexp_replace(lower((select name from slab_def where id = v_kind)), 's$', '')
        || ' up whole. (QL ' || to_char(v_ql, 'FM990.0') || ')', 'event');
    else
      perform tell(p_world, p_uid, 'You break up the paving, leaving bare dirt.', 'event');
    end if;
    perform skill_raise(p_world, p_uid, 'paving', 1);

  elsif p_action = 'cut_grass' then
    perform mark_foraged(p_world, tx, ty, 'grass');
    perform gather(p_world, p_uid, 'mixed_grass', 2, product_ql(skill_of(p_world, p_uid, 'foraging')));
    -- Grass kept cut on a deed becomes lawn: the tile counts the days, in
    -- the bits `tree_day` reads.
    if here = tile_id('Grass') and on_deed(p_world, tx, ty) then
      v_n := v_data & 3;
      perform land_set_data(p_world, tx, ty, v_n | 4);
      perform land_announce(p_world, tx, ty);
      perform tell(p_world, p_uid, 'You cut two bundles of mixed grass.'
        || case when 3 - v_n - 1 > 0
             then ' Kept cut, this will be lawn in ' || (3 - v_n - 1) || ' more day' || case when 3 - v_n - 1 = 1 then '' else 's' end || '.'
             else ' Kept cut, this will be lawn tomorrow.' end, 'event');
    else
      perform tell(p_world, p_uid, 'You cut two bundles of mixed grass.', 'event');
    end if;
    perform skill_raise(p_world, p_uid, 'foraging', 1);

  elsif p_action = 'cut_reeds' then
    perform mark_foraged(p_world, tx, ty, 'reed');
    v_skill := skill_of(p_world, p_uid, 'foraging');
    v_n := 2 + case when random() < v_skill / 140 then 1 else 0 end;
    perform gather(p_world, p_uid, 'reed', v_n,
      product_ql(v_skill, tool_ql(p_world, p_uid, 'carving_knife')));
    perform tell(p_world, p_uid, 'You cut ' || v_n || ' reeds out of the bed.', 'event');
    perform skill_raise(p_world, p_uid, 'foraging', 1);

  elsif p_action = 'pick_fruit' then
    select * into v_tree from tree_def where id = tree_species(v_data);
    -- An old tree carries more than one only just come into bearing, and a
    -- very old one as much as an old one.
    v_skill := skill_of(p_world, p_uid, 'forestry');
    v_n := greatest(1, round(case when tree_age(v_data) in (2, 4) then 5 else 3 end
                             * (0.5 + v_skill / 130) * (0.7 + random() * 0.6))::int);
    v_ql := product_ql(v_skill);
    perform gather(p_world, p_uid, v_tree.fruit, v_n, v_ql);
    perform mark_foraged(p_world, tx, ty, 'forage');
    perform skill_raise(p_world, p_uid, 'forestry', 0.35);
    perform tell(p_world, p_uid, 'You pick ' || v_n || ' '
      || lower((select name from item_def where id = v_tree.fruit))
      || case when v_n = 1 then '' else 's' end
      || ' off the ' || lower(v_tree.name) || '. (QL ' || to_char(v_ql, 'FM990.0') || ')', 'event');

  elsif p_action = 'pick_sprout' then
    select * into v_tree from tree_def where id = tree_species(v_data);
    if not skill_check(skill_of(p_world, p_uid, 'forestry'), 15) then
      perform skill_raise(p_world, p_uid, 'forestry', try_gain(false));
      perform tell(p_world, p_uid, 'You find no sprout worth picking.', 'event');
      return;
    end if;
    perform gather(p_world, p_uid, 'sprout', 1,
      product_ql(skill_of(p_world, p_uid, 'forestry')), v_tree.name);
    perform tell(p_world, p_uid, 'You pick a ' || lower(v_tree.name) || ' sprout.', 'event');
    perform skill_raise(p_world, p_uid, 'forestry', 1);

  elsif p_action = 'prune' then
    select * into v_tree from tree_def where id = tree_species(v_data);
    select * into v_age from tree_age_def where id = tree_age(v_data);
    select * into v_to from tree_age_def where id = v_age.pruned;
    -- The door has already said no to a tree too young for this; a null age
    -- is never written into a tile.
    if v_to.id is null then return; end if;
    v_skill := skill_of(p_world, p_uid, 'forestry');
    v_tool := tool_ql(p_world, p_uid, 'sickle');
    select i.id into v_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'sickle'
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if v_id is not null then perform wear_tool(v_id); end if;
    if not skill_check(v_skill, d.difficulty, v_tool) then
      perform skill_raise(p_world, p_uid, 'forestry', try_gain(false));
      perform tell(p_world, p_uid, 'You cut at the ' || lower(v_tree.name)
        || ' and take off nothing that matters.', 'event');
      return;
    end if;
    /*
     * The age and nothing else. The species stays, and so does the notch a
     * hatchet has left in the trunk — it is beside the land, and the tile is
     * still a tree: pruning is the crown's business, and a half-felled tree
     * pruned back is still half felled.
     */
    perform land_set_data(p_world, tx, ty, tree_pack(tree_species(v_data), v_to.id));
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You prune the ' || lower(v_age.name) || ' ' || lower(v_tree.name)
      || ' back. It stands as a ' || lower(v_to.name) || ' ' || lower(v_tree.name) || ' now.', 'event');
    perform skill_raise(p_world, p_uid, 'forestry', 1);

  elsif p_action = 'plant' then
    -- The one chosen off the menu first, and the oldest that comes to hand if
    -- nobody chose. Sprouts come in nine species and what goes in the ground
    -- is what stands there for the next twenty years, so "whichever was picked
    -- up first" was not a choice anybody had made.
    select * into v_sprout from item where world_id = p_world and holder = 'player'
      and holder_uid = p_uid and def = 'sprout' and not locked
      and (target_item(p_target) is null or id = target_item(p_target))
      order by (id = target_item(p_target)) desc, id limit 1;
    if not found then return; end if;
    v_species := coalesce((select id from tree_def where name = v_sprout.extra), 0);
    if not consume(p_world, p_uid, 'sprout', 1, v_sprout.id) then return; end if;
    perform land_set_tile(p_world, tx, ty, 16);
    -- Species and age packed the one way (`tree_pack`): a planted tree
    -- starts as a sapling and grows on the same clock as one that seeded itself.
    perform land_set_data(p_world, tx, ty, tree_pack(v_species, 0));
    perform land_announce(p_world, tx, ty);
    perform journal_note(p_world, p_uid, 'planted');
    if (select fruit from tree_def where id = v_species) is not null then
      perform journal_note(p_world, p_uid, 'orchard');
    end if;
    perform tell(p_world, p_uid, 'You plant the '
      || lower((select name from tree_def where id = v_species)) || ' sprout.', 'event');
    perform skill_raise(p_world, p_uid, 'forestry', 1);

  elsif p_action = 'graft' then
    -- The sprout named off the menu, or the first fruit sprout to hand.
    select i.* into v_sprout from item i join tree_def td on td.name = i.extra and td.fruit is not null
     where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid
       and i.def = 'sprout' and not i.locked
       and (target_item(p_target) is null or i.id = target_item(p_target))
     order by (i.id = target_item(p_target)) desc, i.id limit 1;
    if not found then return; end if;
    select * into v_tree from tree_def where id = tree_species(v_data);
    v_species := (select id from tree_def where name = v_sprout.extra);
    -- The sprout is spent either way: a graft that does not take is a sprout gone.
    if not consume(p_world, p_uid, 'sprout', 1, v_sprout.id) then return; end if;
    v_skill := skill_of(p_world, p_uid, 'forestry');
    v_tool := tool_ql(p_world, p_uid, 'carving_knife');
    select i.id into v_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'carving_knife'
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if v_id is not null then perform wear_tool(v_id); end if;
    if not skill_check(v_skill, d.difficulty, v_tool) then
      perform skill_raise(p_world, p_uid, 'forestry', try_gain(false));
      perform tell(p_world, p_uid, 'The ' || lower(v_sprout.extra) || ' graft does not take, and the sprout is spent.', 'event');
      return;
    end if;
    -- The species and nothing else: the age stays, and so does any notch.
    perform land_set_data(p_world, tx, ty, tree_pack(v_species, tree_age(v_data)));
    perform land_announce(p_world, tx, ty);
    perform journal_note(p_world, p_uid, 'orchard');
    perform tell(p_world, p_uid, 'You graft the ' || lower(v_sprout.extra) || ' sprout onto the ' || lower(v_tree.name)
      || '. It is a ' || lower((select name from tree_age_def where id = tree_age(v_data))) || ' '
      || lower(v_sprout.extra) || ' tree now.', 'event');
    perform skill_raise(p_world, p_uid, 'forestry', 1);

  elsif p_action = 'harvest_bush' then
    -- As fruit off a tree: more to a practised hand, and never nothing.
    v_skill := skill_of(p_world, p_uid, 'forestry');
    v_tool := tool_ql(p_world, p_uid, 'sickle');
    select i.id into v_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'sickle'
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if v_id is not null then perform wear_tool(v_id); end if;
    v_n := greatest(1, round(3 * (0.5 + v_skill / 130) * (0.7 + random() * 0.6))::int);
    v_ql := product_ql(v_skill, v_tool);
    perform gather(p_world, p_uid, (select yields from bush_def where id = bush_species(v_data)), v_n, v_ql);
    perform mark_foraged(p_world, tx, ty, 'forage');
    perform skill_raise(p_world, p_uid, 'forestry', 0.35);
    perform tell(p_world, p_uid, 'You cut ' || v_n || ' '
      || lower((select name from item_def where id = (select yields from bush_def where id = bush_species(v_data))))
      || ' off the ' || lower((select name from bush_def where id = bush_species(v_data)))
      || '. (QL ' || to_char(v_ql, 'FM990.0') || ')', 'event');

  elsif p_action = 'dig_stump' then
    select * into v_tree from tree_def where id = tree_species(v_data);
    v_skill := skill_of(p_world, p_uid, 'digging');
    v_tool := tool_ql(p_world, p_uid, 'shovel');
    select i.id into v_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'shovel'
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if v_id is not null then perform wear_tool(v_id); end if;
    if not skill_check(v_skill, d.difficulty, v_tool) then
      perform skill_raise(p_world, p_uid, 'digging', try_gain(false));
      perform tell(p_world, p_uid, 'The roots hold. You dig round the ' || lower(v_tree.name)
        || ' stump and it does not shift.', 'event');
      return;
    end if;
    -- Bare dirt where it stood: the roots came out with it.
    perform land_set_tile(p_world, tx, ty, tile_id('Dirt'));
    perform land_set_data(p_world, tx, ty, 0);
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You dig the ' || lower(v_tree.name)
      || ' stump out. The ground is bare dirt where it stood.', 'event');
    -- And a log of the tree's kind, for a Terraformer's Stump Puller.
    v_n := pk(p_world, p_uid, 'stump:log', 0)::int;
    if v_n > 0 then
      perform gather(p_world, p_uid, 'log', v_n, product_ql(v_skill, v_tool), v_tree.name);
      perform tell(p_world, p_uid, 'The root ball comes up with a length of good ' || lower(v_tree.name) || ' on it.', 'event');
    end if;
    perform skill_raise(p_world, p_uid, 'digging', 1);

  elsif p_action = 'dig_worms' then
    perform skill_raise(p_world, p_uid, 'digging', 0.2);
    select i.id into v_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'shovel'
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if v_id is not null then perform wear_tool(v_id, 0.4); end if;
    -- Damp ground gives more than dry: a marsh is full of them.
    v_n := floor(random() * case when t.rich_worms then 5 else 3 end)::int
           + case when t.rich_worms then 1 else 0 end;
    if v_n = 0 then
      perform tell(p_world, p_uid, 'You turn a spadeful over and nothing is moving in it.', 'event');
      return;
    end if;
    perform gather(p_world, p_uid, 'worm', v_n, 20 + random() * 40);
    perform journal_note(p_world, p_uid, 'worms');
    perform tell(p_world, p_uid, 'You turn the dirt over and pick ' || v_n || ' worm'
      || case when v_n > 1 then 's' else '' end || ' out of it.', 'event');

  elsif p_action = 'prospect' then
    v_skill := skill_of(p_world, p_uid, 'prospecting');
    v_rad := prospect_radius(v_skill);
    v_size := (select size from world where id = p_world);
    -- Metal counts wherever it lies: bare, under soil, or below water.
    for v_row in select x, y, (bedrock_at(p_world, x, y)).name as nm
      from generate_series(greatest(0, tx - v_rad), least(v_size - 1, tx + v_rad)) x
      cross join generate_series(greatest(0, ty - v_rad), least(v_size - 1, ty + v_rad)) y
      -- Anything worth mining, not only what is metal: a coal seam is a
      -- seam, and asking `ore` is asking whether its name ends in `_ore`.
      where (bedrock_at(p_world, x, y)).seam
      order by y, x
    loop
      v_tiles := v_tiles || (v_row.y * v_size + v_row.x);
      v_names := v_names || lower(v_row.nm);
    end loop;
    perform mark_prospected(p_world, p_uid, v_tiles);

    -- Sampling where you stand tells you what that particular rock holds.
    v_rock := bedrock_at(p_world, tx, ty);
    v_ql := ore_max_ql((select seed from world where id = p_world), tx, ty);
    v_buried := case when here = 4 then ''
      else ' It lies under ' || greatest(1, land_dirt(p_world, tx, ty)) || ' of ground.' end;
    if v_rock.seam then
      perform tell(p_world, p_uid, 'You sample the ' || lower(v_rock.name)
        || '. It needs mining ' || to_char(v_rock.level, 'FM990')
        || ' to work' || case when skill_of(p_world, p_uid, 'mining') >= v_rock.level
                              then ', which you have' else '' end
        || ', and will give up nothing finer than quality ' || to_char(v_ql, 'FM990')
        || '.' || v_buried, 'event');
    else
      perform tell(p_world, p_uid, 'Plain ' || lower(v_rock.name)
        || ' beneath you, with no metal in it, and nothing finer than quality '
        || to_char(v_ql, 'FM990') || ' in the stone.' || v_buried, 'event');
    end if;

    if coalesce(array_length(v_tiles, 1), 0) = 0 then
      perform tell(p_world, p_uid, 'You read the ground ' || v_rad
        || ' tiles about you and find no sign of anything worth mining.', 'event');
    else
      perform tell(p_world, p_uid, 'Within ' || v_rad || ' tiles you read '
        || (select string_agg(case when n > 1 then n || ' tiles of ' || nm
                                   else 'a tile of ' || nm end, ' and ' order by nm)
            from (select nm, count(*) as n from unnest(v_names) nm group by nm) q)
        || ', buried or bare. They are marked for a while.', 'event');
    end if;
    perform skill_raise(p_world, p_uid, 'prospecting', 1);
  end if;

end $function$;

CREATE OR REPLACE FUNCTION public.ground_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare tx int; ty int; cx int; cy int; here int; t tile_def; v_data int; v_tree tree_def;
        v_under text; p player; v_spoil text;
begin
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  if tx is null or ty is null or not in_bounds(p_world, tx, ty) then
    return 'There is nothing there.';
  end if;
  here := land_tile(p_world, tx, ty);
  select * into t from tile_def where id = here;
  v_data := land_data(p_world, tx, ty);

  if p_action = 'flatten' then
    if t.dig_yield is null then return 'You cannot flatten that.'; end if;
    if pack_count(p_world, p_uid, 'shovel') < 1 then return 'You need a shovel to flatten.'; end if;
    -- Shallows are workable, to the depth a pick works to. `has_water` refuses
    -- a tile with one corner an inch under, which is most of a shoreline.
    if centre_height(p_world, tx, ty) < -pk(p_world, p_uid, 'depth:dig', mine_depth()) then
      return 'The water is too deep here to work in.';
    end if;
    if flatten_target(p_world, p_uid, tx, ty) < -pk(p_world, p_uid, 'depth:dig', mine_depth()) then
      return 'The ground you stand on is too deep to work from.';
    end if;
    v_under := under_building(p_world, tx, ty);
    if v_under is not null then return v_under; end if;
    if not needs_flattening(p_world, p_uid, tx, ty) then return 'That ground is already flat.'; end if;

  elsif p_action = 'drop_dirt' then
    cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
    v_spoil := spoil_near(p_world, p_uid, target_item(p_target));
    if v_spoil is null then
      return case when target_item(p_target) is not null then 'That is not dirt, clay or sand.'
                  else 'You have no dirt, clay or sand to drop, and nothing beside you is holding any.' end;
    end if;
    v_under := corner_under_building(p_world, cx, cy);
    if v_under is not null then return v_under; end if;
    return coalesce(level_stop(p_world, p_uid, cx, cy, 1),
                    slope_refusal(p_world, p_uid, 'digging', cx, cy, 1));

  elsif p_action = 'raise_rock' then
    cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
    if pack_count(p_world, p_uid, 'concrete') < 1 then return 'You have no concrete.'; end if;
    -- Concrete goes on bare rock, above the water: the only way to build up
    -- on rock without dirt, which slides off it.
    if land_dirt(p_world, cx, cy) > 0 then return 'There is soil on that corner. Concrete goes on bare rock.'; end if;
    if land_height(p_world, cx, cy) < 0 then return 'Concrete will not set under water.'; end if;
    -- And never on a seam. A corner holds up four tiles, and a vein under any
    -- of them raised with concrete would be ore for ever: mined down, laid up
    -- and mined again. `rock_def.seam` is the browser's own `isSeam`: every
    -- vein, and the coal seam with them.
    if exists (select 1 from (values (cx - 1, cy - 1), (cx, cy - 1), (cx - 1, cy), (cx, cy)) v(x, y)
               where in_bounds(p_world, v.x, v.y) and (bedrock_at(p_world, v.x, v.y)).seam) then
      return 'That corner is on a seam. Concrete goes on plain rock.';
    end if;
    v_under := corner_under_building(p_world, cx, cy);
    if v_under is not null then return v_under; end if;
    return coalesce(level_stop(p_world, p_uid, cx, cy, 1),
                    slope_refusal(p_world, p_uid, 'masonry', cx, cy, 1));

  elsif p_action = 'dredge' then
    cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
    -- Digging from a boat: the bottom comes up a spadeful at a time, to a
    -- depth the shore never reaches. The doors are the digger's, in the
    -- digger's words, with the hull's in front of them.
    if t.dig_yield is null then return 'You cannot dredge that.'; end if;
    if pack_count(p_world, p_uid, 'shovel') < 1 then return 'You need a shovel to dredge with.'; end if;
    if not coalesce(is_boat(driving(p_world, p_uid)), false) then return 'Dredging is done from a boat.'; end if;
    if land_height(p_world, cx, cy) >= 0 then return 'That corner is above the water. Dig it from the shore.'; end if;
    if land_height(p_world, cx, cy) < -pk(p_world, p_uid, 'depth:dredge', dredge_depth()) then return 'The bottom is too deep to reach from a boat.'; end if;
    if land_dirt(p_world, cx, cy) <= 0 then return 'That corner is bare rock down there. A shovel will not bite on it.'; end if;
    v_under := corner_under_building(p_world, cx, cy);
    if v_under is not null then return v_under; end if;
    return slope_refusal(p_world, p_uid, 'digging', cx, cy, -1);

  elsif p_action = 'pave_slabs' then
    v_under := under_building(p_world, tx, ty);
    if v_under is not null then return v_under; end if;
    if here <> 2 then return 'The ground has to be packed flat before anything is laid on it.'; end if;
    if pack_count(p_world, p_uid, 'trowel') < 1 then return 'You need a trowel to bed a slab.'; end if;
    if not exists (select 1 from item i join slab_def s on s.item = i.def
                   where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid
                     and not i.locked) then
      return 'You need a cut slab to pave with.';
    end if;

  elsif p_action = 'remove_paving' then
    if here not in (14, 21) then return 'There is no paving here to break up.'; end if;
    v_under := under_building(p_world, tx, ty);
    if v_under is not null then return v_under; end if;
    if pack_count(p_world, p_uid, 'pickaxe') < 1 then return 'You need a pickaxe to break up paving.'; end if;

  elsif p_action = 'cut_grass' then
    if here not in (0, 5, 6, 20) then return 'There is no grass here to cut.'; end if;
    if is_foraged(p_world, tx, ty, 'grass') then return 'The grass here is still short.'; end if;

  elsif p_action = 'cut_reeds' then
    if here <> 19 then return 'There are no reeds here.'; end if;
    if pack_count(p_world, p_uid, 'carving_knife') < 1 then return 'You need a knife to cut reeds.'; end if;
    if is_foraged(p_world, tx, ty, 'reed') then return 'The reeds here are cut back to the water.'; end if;

  elsif p_action = 'pick_fruit' then
    if here <> 16 then return 'There is no tree here.'; end if;
    select * into v_tree from tree_def where id = tree_species(v_data);
    if v_tree.fruit is null then return 'Nothing grows on this that you would eat.'; end if;
    if not coalesce((select alive from tree_age_def where id = tree_age(v_data)), true) then
      return 'Nothing hangs on a dead tree.';
    end if;
    -- A sapling bears nothing; it has to have some years in it first.
    if not coalesce((select bears from tree_age_def where id = tree_age(v_data)), false) then
      return 'The ' || lower(v_tree.name) || ' is too young to bear. Leave it to grow.';
    end if;
    if is_foraged(p_world, tx, ty, 'forage') then
      return 'You have had what this ' || lower(v_tree.name) || ' has on it. Come back later.';
    end if;

  elsif p_action = 'pick_sprout' then
    if here <> 16 then return 'There is no tree here.'; end if;
    if not coalesce((select alive from tree_age_def where id = tree_age(v_data)), true) then
      return 'There is no life in it to sprout.';
    end if;

  elsif p_action = 'prune' then
    if here <> 16 then return 'There is no tree here to prune.'; end if;
    select * into v_tree from tree_def where id = tree_species(v_data);
    if not coalesce((select alive from tree_age_def where id = tree_age(v_data)), true) then
      return 'There is no pruning a dead tree.';
    end if;
    -- What each stage prunes to is the table's: a stage back for a grown
    -- tree, a shrub for good out of a sapling, and a young tree left to grow.
    -- A stage whose next stage is itself is a shrub already kept.
    if exists (select 1 from tree_age_def where id = tree_age(v_data) and pruned is null and next = id) then
      return 'It is clipped as far as it goes.';
    end if;
    if (select pruned from tree_age_def where id = tree_age(v_data)) is null then
      return 'The ' || lower(v_tree.name) || ' is too young to prune. Let it grow.';
    end if;

  elsif p_action = 'plant' then
    if not exists (select 1 from plantable where tile = here) then
      return 'Nothing will take root in that.';
    end if;
    if pack_count(p_world, p_uid, 'sprout') < 1 then return 'You have no sprout to plant.'; end if;
    -- A grown tile of tree is something you walk round, not through, and the
    -- sprout becomes that tile the moment it goes in.
    select * into p from player where world_id = p_world and uid = p_uid;
    if p.uid is not null and floor(p.x)::int = tx and floor(p.y)::int = ty then
      return 'You would be planting it under your own feet. Step off the tile first.';
    end if;

  elsif p_action = 'graft' then
    if here <> 16 then return 'There is no tree here to graft to.'; end if;
    if not coalesce((select alive from tree_age_def where id = tree_age(v_data)), true) then
      return 'There is no life in it to graft to.';
    end if;
    if (select fruit from tree_def where id = tree_species(v_data)) is not null then return 'It bears already.'; end if;
    -- Grafting is the forester's finest work, and a beginner's graft is a
    -- sprout thrown away.
    if skill_of(p_world, p_uid, 'forestry') < graft_skill() then
      return 'You do not know enough of trees to graft one yet. It takes forestry ' || graft_skill() || '.';
    end if;
    -- The sprout named, or any of the three that bear.
    if target_item(p_target) is not null and not exists (
        select 1 from item i join tree_def td on td.name = i.extra and td.fruit is not null
         where i.world_id = p_world and i.id = target_item(p_target) and i.holder = 'player'
           and i.holder_uid = p_uid and i.def = 'sprout') then
      return 'That is not a fruit sprout.';
    end if;
    if not exists (
        select 1 from item i join tree_def td on td.name = i.extra and td.fruit is not null
         where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid
           and i.def = 'sprout' and not i.locked) then
      return 'You have no fruit sprout to graft.';
    end if;

  elsif p_action = 'harvest_bush' then
    if here <> 17 then return 'There is no bush here.'; end if;
    if (select yields from bush_def where id = bush_species(v_data)) is null then
      return 'Nothing on a ' || lower((select name from bush_def where id = bush_species(v_data))) || ' is worth a sickle.';
    end if;
    if is_foraged(p_world, tx, ty, 'forage') then
      return 'You have had what this ' || lower((select name from bush_def where id = bush_species(v_data))) || ' has on it. Come back later.';
    end if;

  elsif p_action = 'dig_stump' then
    if here <> tile_id('Stump') then return 'There is no stump here.'; end if;

  elsif p_action = 'dig_worms' then
    if not t.wormy then return 'Nothing lives in that.'; end if;
    if pack_count(p_world, p_uid, 'shovel') < 1 then return 'You need a shovel.'; end if;
    if has_water(p_world, tx, ty) then return 'Not under water.'; end if;

  elsif p_action = 'prospect' then
    if pack_count(p_world, p_uid, 'pickaxe') < 1 then return 'You need a pickaxe to prospect.'; end if;
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.perform_terrain(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare d action_def; cx int; cy int; tx int; ty int; t tile_def; r rock_def;
        s double precision; tq double precision; yields text; made_ql double precision; tool_id bigint; here int;
begin
  select * into d from action_def where id = p_action;
  cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
  tx := (p_target->>'x')::int;  ty := (p_target->>'y')::int;
  s := case when d.skill is null then 50 else skill_of(p_world, p_uid, d.skill) end;
  tq := case when d.tool is null then 0 else tool_ql(p_world, p_uid, d.tool) end;
  if d.tool is not null then
    select i.id into tool_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = d.tool
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if tool_id is not null then perform wear_tool(tool_id); end if;
  end if;

  if p_action = 'mine' then
    if not skill_check(s, d.difficulty, tq) then
      -- The swing happened. It taught nothing at all until now.
      perform skill_raise(p_world, p_uid, d.skill, try_gain(false));
      perform tell(p_world, p_uid, 'The rock is hard and you fail to loosen anything.', 'event');
      return;
    end if;
    r := bedrock_at(p_world, tx, ty);
    yields := case when land_tile(p_world, tx, ty) = 4 then r.yields else 'rock_shards' end;
    -- The first ore out of the ground is a thing worth remembering.
    if yields like '%\_ore' then perform journal_note(p_world, p_uid, 'ore'); end if;
    made_ql := least(ore_max_ql((select seed from world where id = p_world), tx, ty), product_ql(s, tq));
    perform gather(p_world, p_uid, yields, 1, made_ql);
    -- And one swing in a thousand that brings out something nobody quarried.
    perform maybe_map(p_world, p_uid, s, tq);
    -- And a stone, now and again, which is the other thing a miner is for.
    perform maybe_gem(p_world, p_uid, s, tq);
    perform tell(p_world, p_uid,
      case when yields like '%lump' then 'You chip a ' else 'You mine some ' end
      || lower((select coalesce(name, yields) from item_def where id = yields))
      || case when yields like '%lump' then ' out of the vein.' else '.' end
      || ' (QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
    -- Cutting the face back is its own job. Now and again one comes down anyway.
    if random() < mine_collapse() then
      perform land_set_height(p_world, cx, cy, land_height(p_world, cx, cy) - 1);
      perform land_set_dirt(p_world, cx, cy, 0);
      perform reconcile_around(p_world, cx, cy);
      perform tell(p_world, p_uid, 'A slab breaks away of its own accord and the face drops.', 'event');
    end if;
    perform skill_raise(p_world, p_uid, d.skill, 1);

  elsif p_action = 'chip_corner' then
    if random() >= chip_chance() then
      perform skill_raise(p_world, p_uid, d.skill, try_gain(false));
      perform tell(p_world, p_uid, 'You work at the corner and find no line in it. The face holds.', 'event');
      return;
    end if;
    perform land_set_height(p_world, cx, cy, land_height(p_world, cx, cy) - 1);
    perform land_set_dirt(p_world, cx, cy, 0);
    perform reconcile_around(p_world, cx, cy);
    r := bedrock_at(p_world, tx, ty);
    yields := case when land_tile(p_world, tx, ty) = 4 then r.yields else 'rock_shards' end;
    -- The first ore out of the ground is a thing worth remembering.
    if yields like '%\_ore' then perform journal_note(p_world, p_uid, 'ore'); end if;
    made_ql := least(ore_max_ql((select seed from world where id = p_world), tx, ty), product_ql(s, tq));
    perform gather(p_world, p_uid, yields, 1, made_ql);
    perform maybe_map(p_world, p_uid, s, tq);
    perform tell(p_world, p_uid, 'The corner breaks away and drops a step. You gather the '
      || lower((select coalesce(name, yields) from item_def where id = yields))
      || '. (QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
    perform skill_raise(p_world, p_uid, d.skill, 1);

  elsif p_action = 'pack' then
    here := land_tile(p_world, tx, ty);
    perform land_set_tile(p_world, tx, ty, 2);
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, case when here <> 1
      then 'You cut the turf away and tread the ground down firm.'
      else 'You pack the dirt down firmly.' end, 'event');
    perform skill_raise(p_world, p_uid, d.skill, 1);

  elsif p_action = 'cultivate' then
    perform land_set_tile(p_world, tx, ty, 1);
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You break up the packed earth.', 'event');
    perform skill_raise(p_world, p_uid, d.skill, 1);

  elsif p_action = 'pave_cobble' then
    -- A Frugal Cobbler's go now and then takes no brick; the rest take one.
    if random() >= pk(p_world, p_uid, 'keep:pave_cobble', 0) then
      if not consume(p_world, p_uid, 'stone_brick', 1) then return; end if;
    end if;
    perform land_set_tile(p_world, tx, ty, 14);
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You lay the cobblestones.', 'event');
    perform skill_raise(p_world, p_uid, d.skill, 1);

  elsif p_action = 'drop_dirt_here' then
    if not consume(p_world, p_uid, 'dirt', 1) then return; end if;
    select round(x)::int, round(y)::int into cx, cy from player where world_id = p_world and uid = p_uid;
    perform land_set_height(p_world, cx, cy, land_height(p_world, cx, cy) + 1);
    perform land_set_dirt(p_world, cx, cy, land_dirt(p_world, cx, cy) + 1);
    perform reconcile_around(p_world, cx, cy);
    /*
     * And what the spadeful covered, which is the tile you are standing on.
     *
     * The corner this raises is the nearest one, which belongs to as many as
     * four tiles; the ground that took the dirt is the one under your feet.
     * `drop_dirt` at a corner covers the tile it names, and this covers that
     * one — the same spadeful and the same list either way.
     */
    select floor(x)::int, floor(y)::int into tx, ty from player where world_id = p_world and uid = p_uid;
    if exists (select 1 from buryable b where b.tile = land_tile(p_world, tx, ty)) then
      perform land_set_tile(p_world, tx, ty, 1);
      perform land_announce(p_world, tx, ty);
    end if;
    perform tell(p_world, p_uid, 'You drop the dirt at your feet, raising the ground.', 'event');
    perform skill_raise(p_world, p_uid, d.skill, 1);
  end if;

end $function$;

CREATE OR REPLACE FUNCTION public.perform_gather(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare d action_def; tx int; ty int; here int; data int; t tile_def; tool_id bigint;
        s double precision; tq double precision; made_ql double precision;
        species int; logs int; tree tree_def;
        v_age tree_age_def; v_cuts int;
        passes int; i int; found text[] := '{}'; got text; yields text;
begin
  select * into d from action_def where id = p_action;
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  here := land_tile(p_world, tx, ty);
  data := land_data(p_world, tx, ty);
  select * into t from tile_def where id = here;
  s := case when d.skill is null then 50 else skill_of(p_world, p_uid, d.skill) end;
  tq := case when d.tool is null then 0 else tool_ql(p_world, p_uid, d.tool) end;
  if d.tool is not null then
    select it.id into tool_id from item it
      where it.world_id = p_world and it.holder = 'player' and it.holder_uid = p_uid and it.def = d.tool
      order by tool_worth(it.ql, it.dmg, it.extra, it.rare, it.bless) desc limit 1;
    if tool_id is not null then perform wear_tool(tool_id); end if;
  end if;

  if p_action = 'cut_down' then
    if not skill_check(s, d.difficulty, tq) then
      perform skill_raise(p_world, p_uid, 'woodcutting', try_gain(false));
      perform tell(p_world, p_uid, 'Your hatchet glances off and you fail to make headway.', 'event');
      return;
    end if;
    if here = tile_id('Bush') then
      perform land_set_tile(p_world, tx, ty, tile_id('Grass'));
      perform land_set_data(p_world, tx, ty, 0);
      perform land_announce(p_world, tx, ty);
      perform tell(p_world, p_uid, 'You hack the bush down.', 'event');
    elsif here <> tile_id('Tree') then
      -- Nothing standing is nothing to fell. `act_refusal` says so before the
      -- swing and this says so after it: reading a tree off a tile that has
      -- none gives species 0 and age 0, which is a birch out of thin air.
      perform tell(p_world, p_uid, 'There is nothing standing here to cut down.', 'error');
      return;
    else
      species := tree_species(data);
      select * into tree from tree_def where id = species;
      select * into v_age from tree_age_def where id = tree_age(data);
      /*
       * A tree comes down in strokes, and how many depends on what it is.
       *
       * The count is kept beside the tile, in `tree_notch`, rather than in
       * the swinging — because a wood is not one woodcutter's. Leave a half-felled oak and the notch is still in it
       * tomorrow, for you or for whoever finds it. A cut that glances off is
       * not one of them: that is the skill check above, which has already
       * returned by here.
       */
      v_cuts := tree_cuts(p_world, tx, ty) + 1;
      if v_cuts < v_age.hits then
        perform tree_notch(p_world, tx, ty, v_cuts);
        perform tell(p_world, p_uid, 'You cut into the ' || lower(v_age.name) || ' '
          || lower(tree.name) || '. ' || (v_age.hits - v_cuts)
          || ' more like that and it comes down.', 'event');
      else
        logs := v_age.logs;
        -- A tree with timber in it leaves a stump of its kind, in the way of
        -- the ground for a day or until somebody digs it out. Nothing smaller
        -- leaves one worth the name.
        if logs = 0 then
          perform land_set_tile(p_world, tx, ty, tile_id('Grass'));
          perform land_set_data(p_world, tx, ty, 0);
        else
          perform land_set_tile(p_world, tx, ty, tile_id('Stump'));
          perform land_set_data(p_world, tx, ty, tree_pack(species, 0));
        end if;
        perform land_announce(p_world, tx, ty);
        perform journal_note(p_world, p_uid, 'tree');
        if logs = 0 then
          perform tell(p_world, p_uid, 'You clear the ' || lower(v_age.name) || ' '
            || lower(tree.name) || ' away. There is no timber in one that size.', 'event');
        else
          made_ql := product_ql(s, tq);
          perform gather(p_world, p_uid, 'log', logs, made_ql, tree.name);
          perform tell(p_world, p_uid, 'The ' || lower(v_age.name) || ' ' || lower(tree.name)
            || ' comes down. You get ' || logs
            || case when logs = 1 then ' log' else ' logs' end || '. (QL ' || to_char(made_ql, 'FM990.0') || ') The stump is left.', 'event');
        end if;
      end if;
    end if;
    perform skill_raise(p_world, p_uid, 'woodcutting', 1);

  elsif p_action in ('forage', 'botanize') then
    perform mark_foraged(p_world, tx, ty, p_action);
    -- A practised eye goes over the same ground more than once.
    passes := rolls_at(s);
    for i in 1..passes loop
      if random() < 0.2 or not skill_check(s, 5, 0) then continue; end if;
      got := roll_table(p_action, random());
      made_ql := product_ql(s, 0);
      perform gather(p_world, p_uid, got, 1, made_ql);
      found := found || (lower((select coalesce(name, got) from item_def where id = got))
        || ' (QL ' || to_char(made_ql, 'FM990.0') || ')');
    end loop;
    if array_length(found, 1) is null then
      perform tell(p_world, p_uid, case when passes > 1
        then 'You go over the ground ' || passes || ' times and find nothing'
             || case when p_action = 'forage' then ' edible.' else ' of interest.' end
        else case when p_action = 'forage' then 'You find nothing edible.' else 'You find nothing of interest.' end
        end, 'event');
    else
      perform tell(p_world, p_uid, 'You find some ' || list_of(found) || '.', 'event');
    end if;
    perform skill_raise(p_world, p_uid, d.skill, try_gain(array_length(found, 1) is not null));

  elsif p_action = 'collect' then
    yields := t.dig_yield;
    if yields is null then return; end if;
    if not skill_check(s, d.difficulty, tq) then
      perform skill_raise(p_world, p_uid, 'digging', try_gain(false));
      perform tell(p_world, p_uid, 'Your shovel comes up with nothing but a smear of '
        || lower(t.name) || '.', 'event');
      return;
    end if;
    made_ql := least(100, product_ql(s, tq) * pk(p_world, p_uid, 'ql:collect', 1));
    perform gather(p_world, p_uid, yields, 1, made_ql, null, perk_rare(pk(p_world, p_uid, 'rare:collect', 0)));
    perform tell(p_world, p_uid, 'You fill a shovel with '
      || lower((select coalesce(name, yields) from item_def where id = yields))
      || ' off the top of the bed. (QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
    perform skill_raise(p_world, p_uid, 'digging', 1);
  end if;

end $function$;


/* The steepest a spade may leave: a Terraformer's Steep Cut raises the multiple. */
create or replace function max_dig_slope(p_world uuid, p_uid uuid)
 returns integer language sql stable as $fn$
  select greatest(slope_floor(), floor(skill_of(p_world, p_uid, 'digging')
                                       * pk(p_world, p_uid, 'slope:digging', slope_per_skill()))::int)
$fn$;

/* The same for a trowel on rock. */
create or replace function max_mason_slope(p_world uuid, p_uid uuid)
 returns integer language sql stable as $fn$
  select greatest(slope_floor(), floor(skill_of(p_world, p_uid, 'masonry')
                                       * pk(p_world, p_uid, 'slope:masonry', slope_per_skill()))::int)
$fn$;

/* The skill a slope wants at a given multiple: the cap read backwards. */
create or replace function slope_needs(p_slope integer, p_per double precision)
 returns double precision language sql immutable as $fn$
  select ceil(p_slope / p_per * 10) / 10
$fn$;


CREATE OR REPLACE FUNCTION public.slope_refusal(p_world uuid, p_uid uuid, p_skill text, p_cx integer, p_cy integer, p_delta integer)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare v_would int; v_cap int; v_per double precision;
begin
  v_would := corner_slope_after(p_world, p_cx, p_cy, p_delta);
  v_cap := case when p_skill = 'masonry' then max_mason_slope(p_world, p_uid)
                else max_dig_slope(p_world, p_uid) end;
  if v_would <= v_cap then return null; end if;
  v_per := pk(p_world, p_uid, 'slope:' || p_skill, slope_per_skill());
  return 'That would leave a slope of ' || v_would || '. Your ' || p_skill || ' allows ' || v_cap
      || '; it would take ' || p_skill || ' ' || to_char(slope_needs(v_would, v_per), 'FM990.0') || '.';
end $function$;

CREATE OR REPLACE FUNCTION public.take_spoil(p_world uuid, p_uid uuid, p_def text)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
declare v_id bigint;
begin
  if consume(p_world, p_uid, p_def, 1) then return true; end if;
  select i.id into v_id from item i
    join crate c on c.world_id = i.world_id and c.id = i.crate
   where i.world_id = p_world and i.holder = 'crate' and i.def = p_def and not i.locked
     and sqrt((crate_centre_x(c) - (select pl.x from player pl where pl.world_id = p_world and pl.uid = p_uid)) ^ 2
            + (crate_centre_y(c) - (select pl.y from player pl where pl.world_id = p_world and pl.uid = p_uid)) ^ 2)
         -- As far as a Terraformer's Long Reach, or the reach everybody has.
         <= pk(p_world, p_uid, 'reach:soil', spoil_reach())
   order by i.id limit 1;
  if v_id is null then
    select i.id into v_id from item i
      join placed p on p.world_id = i.world_id and p.id = i.placed
     where i.world_id = p_world and i.holder = 'furniture' and i.def = p_def and not i.locked
       and near_piece(p_world, p_uid, p, pk(p_world, p_uid, 'reach:soil', spoil_reach()))
       -- Not out of a grave, as `spoil_near` asks.
       and p.crumbles_at is null
     order by i.id limit 1;
  end if;
  if v_id is null then return false; end if;
  update item set count = count - 1 where id = v_id and count > 1;
  if found then return true; end if;
  delete from item where id = v_id;
  return found;
end $function$;

CREATE OR REPLACE FUNCTION public.spoil_near(p_world uuid, p_uid uuid, p_item bigint)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare v_def text; v_want text[] := array['dirt', 'clay', 'sand'];
begin
  v_def := spoil_in_hand(p_world, p_uid, p_item);
  if v_def is not null or p_item is not null then return v_def; end if;
  select i.def into v_def from item i
    join crate c on c.world_id = i.world_id and c.id = i.crate
   where i.world_id = p_world and i.holder = 'crate' and i.def = any(v_want) and not i.locked
     and c.id = (select cc.id from nearest_crate(p_world, crate_centre_x(c), crate_centre_y(c),
                                                    pk(p_world, p_uid, 'reach:soil', spoil_reach())) cc limit 1)
   order by array_position(v_want, i.def), i.id limit 1;
  if v_def is not null then return v_def; end if;
  select i.def into v_def from item i
    join placed p on p.world_id = i.world_id and p.id = i.placed
   where i.world_id = p_world and i.holder = 'furniture' and i.def = any(v_want) and not i.locked
     and near_piece(p_world, p_uid, p, pk(p_world, p_uid, 'reach:soil', spoil_reach()))
     -- Not out of a grave, whoever's it is: what is in one comes out through its own doors or not at all.
     and p.crumbles_at is null
   order by array_position(v_want, i.def), i.id limit 1;
  return v_def;
end $function$;

CREATE OR REPLACE FUNCTION public.maybe_map(p_world uuid, p_uid uuid, p_skill double precision, p_tool_ql double precision)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare p player;
begin
  -- One in a thousand, or what a perk for this job makes it: a Terraformer's Treasure Nose.
  if random() >= coalesce(pkx('map:' || pkx_act(), map_odds()), map_odds()) then return; end if;
  select * into p from player where world_id = p_world and uid = p_uid;
  if not found then return; end if;
  perform bury_treasure(p_world, p_uid, map_ql(p_skill, p_tool_ql), p.x, p.y);
end $function$;

CREATE OR REPLACE FUNCTION public.carry_limit(p_world uuid, p_uid uuid)
 RETURNS double precision
 LANGUAGE sql
 STABLE
AS $function$
  select carry_base() + skill_of(p_world, p_uid, 'body_strength') * carry_per_strength()
       -- And a Terraformer's Strong Back.
       + pk(p_world, p_uid, 'carry', 0)
$function$;

CREATE OR REPLACE FUNCTION public.carried_weight(p_world uuid, p_uid uuid)
 RETURNS double precision
 LANGUAGE sql
 STABLE
AS $function$
  -- What a perk makes of a thing's weight in the pack, by its kind: a Soil Porter's dirt.
  select coalesce(sum(item_weight(i) * pk(m.mul, 'weight:' || i.def, 1)), 0)
    from item i
    cross join (select coalesce((select pl.class_mul from player pl
                                  where pl.world_id = p_world and pl.uid = p_uid), '{}'::jsonb) as mul) m
  where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.inside is null
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
    if is_boat(p) then return (select speed from boat_def where id = p.sub); end if;
    v := vehicle_speed(p_world, p.id);
    if v > 0 then return v; end if;
    return base_speed();
  end if;
  c := mount_of(p_world, p_uid);
  if c.id is not null then
    -- Shod, it goes quicker on laid stone and gravel.
    select * into pl from player where world_id = p_world and uid = p_uid;
    -- The cap comes after the shoes, as the browser has it: a mount at the cap is at the cap.
    return least(max_mount_speed(), mount_speed(c) * case when shod(c) and paved(land_tile(p_world, floor(pl.x)::int, floor(pl.y)::int))
                                                          then shoe_pace() else 1 end);
  end if;
  -- On foot, and on a made road, a Terraformer's Road Legs.
  select * into pl from player where world_id = p_world and uid = p_uid;
  if coalesce((select t.road from tile_def t
                where t.id = land_tile(p_world, floor(pl.x)::int, floor(pl.y)::int)), false) then
    return base_speed() * pk(pl.class_mul, 'walk:road', 1);
  end if;
  return base_speed();
end $function$;

CREATE OR REPLACE FUNCTION public.gather(p_world uuid, p_uid uuid, p_item text, p_n integer, p_ql double precision, p_extra text DEFAULT NULL::text, p_rare text DEFAULT NULL::text, p_maker text DEFAULT NULL::text, p_cast text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
declare v_cart placed; v_fit int := 0; v_id bigint; v_rest bigint; fresh item;
begin
  -- And what the settlement's baubles make of it, when it is the yield of a go.
  p_n := bauble_yield(p_world, p_uid, p_item, p_n);
  /*
   * What a gathering job brings up, put where it belongs: into the cart you
   * are working from as far as it has room and will take it, and the rest
   * into the pack through `give`, the one way a thing arrives there. The row
   * it went into comes back, the cart's when any of it went there.
   */
  v_cart := work_cart(p_world, p_uid);
  /*
   * With no cart in hand, a Terraformer's Long Reach puts what a go of
   * digging brings up into the nearest cart or wagon within reach: an
   * unlocked one that nobody else has by the shafts or the reins.
   */
  if v_cart.id is null and pkx_act() in ('dig', 'dig_tile') and pkx('reach:soil', 0) > 0 then
    select pl.* into v_cart from placed pl
      join player b on b.world_id = pl.world_id and b.uid = p_uid
      join furniture_def f on f.id = pl.sub
     where pl.world_id = p_world and pl.kind = 'furniture' and (f.cart or is_vehicle(pl))
       and pl.lock is null
       and (pl.puller is null or pl.puller = p_uid) and (pl.driver is null or pl.driver = p_uid)
       and sqrt((pl.cx - b.x) ^ 2 + (pl.cy - b.y) ^ 2) <= pkx('reach:soil', 0)
       and furniture_refuses(pl, p_item) is null
     order by (pl.cx - b.x) ^ 2 + (pl.cy - b.y) ^ 2, pl.id limit 1;
  end if;
  if v_cart.id is null or p_n <= 0 then
    return give(p_world, p_uid, p_item, p_n, p_ql, p_extra, p_rare, p_maker, p_cast);
  end if;
  if furniture_refuses(v_cart, p_item) is null then
    v_fit := least(p_n, furniture_room(v_cart, p_item));
  end if;
  if v_fit > 0 then
    -- The row as it would be written, so the key is the real key -- as `give` does.
    if item_stackable(p_item) then
      fresh.def := p_item; fresh.extra := p_extra; fresh.rare := p_rare;
      fresh.maker := p_maker; fresh.piece := p_cast;
      fresh.locked := false; fresh.lit := false; fresh.issued := false;
      select i.id into v_id from item i
       where i.world_id = p_world and i.holder = 'furniture' and i.placed = v_cart.id
         and i.def = p_item and stack_key(i) = stack_key(fresh)
       order by i.id limit 1;
    end if;
    if v_id is not null then
      update item set ql = (ql * count + greatest(0, least(100, p_ql)) * v_fit) / (count + v_fit),
                      count = count + v_fit
        where id = v_id;
    else
      insert into item (world_id, holder, placed, def, ql, count, extra, rare, maker, piece)
      values (p_world, 'furniture', v_cart.id, p_item, greatest(0, least(100, p_ql)), v_fit,
              p_extra, p_rare, p_maker, p_cast)
      returning id into v_id;
    end if;
  end if;
  if v_fit < p_n then
    perform cart_full(p_world, p_uid, v_cart);
    v_rest := give(p_world, p_uid, p_item, p_n - v_fit, p_ql, p_extra, p_rare, p_maker, p_cast);
  end if;
  return coalesce(v_id, v_rest);
end $function$;


/*
 * The Terraformer's tree, cleared. Its nine nodes left `class_node` with the
 * rulebook that brought its perks; whatever of them anybody had taken goes
 * here, and every Terraformer's fold is written again, so that nobody keeps
 * a number the rules no longer have and everybody's perks start empty.
 */
delete from player_node where node ~ '^terraformer_[0-9]_[0-9]$';
do $$
declare r record;
begin
  for r in select world_id, uid from player where craft_class = 'terraformer' loop
    perform class_fold(r.world_id, r.uid);
  end loop;
end $$;

revoke all on function perform_dig_tile(uuid, uuid, jsonb) from public, anon, authenticated;
select private.lock_doors();

