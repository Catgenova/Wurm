-- Fourteen trades, and one of them yours
--
-- Sixty-one skills is a lot of things to be good at and no way at all of
-- saying what you *are*. A class is that: fourteen craft trades, one of them
-- locked in, each covering a handful of skills that belong together and each
-- carrying a small tree of passive nodes of its own. The trees come next; the
-- trades, and the choosing, are here.
--
-- ## Three rules, and where each of them already lived
--
-- **A card opens at fifty.** Reach fifty in any skill a class covers and its
-- card is on the table. Nothing invented for it: `title_def (id, skill, at,
-- name)` has handed out names at skill thresholds since the beginning, and a
-- class card is the same shape asked a different way.
--
-- **One craft and one combat.** Two columns, not one, and nothing may be
-- put in the wrong slot -- `class_def.kind` decides which. The combat trades
-- land beside these and are drawn from the twenty-two skills the craft ones
-- leave alone: the weapon skills, the four armour lines, the body, prayer,
-- meditation, awareness. The two lists are disjoint on purpose, so no skill
-- gates two cards and nobody takes the same lever twice.
--
-- **Locked in, but not for ever.** The first trade in a slot is free. Changing
-- it costs `class_change_cost()` in silver -- five hundred, against a gold
-- coin worth ten and twenty coins to the lump, so two and a half lumps of
-- gold mined, smelted and struck. A class you can swap cheaply is a menu.
--
-- ## Every craft skill belongs to exactly one trade
--
-- Thirty-nine of them, across fourteen classes, no skill twice and none left
-- out. That is checked rather than hoped for: `craft.ts` asks the island for
-- its list and the browser for its own and adds both up. Smith holds six
-- skills and Fisher holds one, which is deliberate -- a wide trade is easier
-- to open and its nodes are spread over six trades to pay for it.
--
-- ## What this file does not do
--
-- No node, no effect, no number moved. Taking a trade today writes a word on
-- your body and opens a door that is not built yet. That is the honest order
-- to do it in: the set has to be right and agreed by both sides before there
-- is any point drawing fourteen trees against it.

set local lock_timeout = '3s';

/*
 * Two words on a body and the hour it was decided. `class_taken`, not
 * `class_at`, because `class_at()` is the constant that says fifty.
 *
 * Asked for in a loop, because of what happened eight hours ago. `alter table`
 * takes ACCESS EXCLUSIVE *before* it looks to see whether there is anything to
 * do, that conflicts with the ACCESS SHARE every reader takes, and `player` is
 * read by the clock and by every door on the island -- so on a busy island the
 * gap may never come, and the moment this starts waiting, every reader queues
 * behind it. A deploy died on exactly that, on `tile_def`, and the fix there
 * was to stop asking for the lock at all.
 *
 * Here it genuinely has to be asked for, so it is asked for the right way:
 * a short wait, and another go, rather than one long wait that queues. This
 * is the first statement in the file and the transaction holds nothing yet,
 * so a go that fails costs nothing and blocks nobody -- and a subtransaction
 * that rolls back takes all three columns with it, so a retry starts clean.
 *
 * Thirty goes at two seconds is a minute of trying. If a minute of one-second
 * gaps is not enough, that is worth being told about rather than worth waiting
 * out.
 */
do $$
declare i int;
begin
  for i in 1 .. 30 loop
    begin
      set local lock_timeout = '2s';
      alter table player add column if not exists craft_class text;
      alter table player add column if not exists combat_class text;
      alter table player add column if not exists class_taken timestamptz;
      return;
    exception when lock_not_available then
      perform pg_sleep(2);
    end;
  end loop;
  raise exception 'could not get a moment on player to add the class columns';
end $$;

/*
 * Whether a card is on the table.
 *
 * Fifty in any one skill the class covers. Free of sublinks so it folds into
 * whatever asks it, and keyed on the class rather than handed a sheet of
 * skills, because that is the shape both sides have.
 */
create or replace function class_open(p_world uuid, p_uid uuid, p_class text) returns boolean
  language sql stable as $fn$
  select exists (select 1 from class_skill cs
                  where cs.class = p_class and skill_of(p_world, p_uid, cs.skill) >= class_at())
$fn$;

/* The skills a class covers, in the words a person would read. */
create or replace function class_wants(p_class text) returns text
  language sql stable as $fn$
  select string_agg(replace(cs.skill, '_', ' '), ', ' order by cs.skill)
    from class_skill cs where cs.class = p_class
$fn$;

/*
 * Why not, or null. The same sentence `classRefusal` builds on the browser's
 * side, which the suite asks the two of them to agree on.
 */
create or replace function class_refusal(p_world uuid, p_uid uuid, p_class text) returns text
  language plpgsql stable as $fn$
declare c class_def;
begin
  select * into c from class_def where id = p_class;
  if not found then return 'There is no such trade.'; end if;
  if class_open(p_world, p_uid, p_class) then return null; end if;
  return 'You are not a ' || lower(c.name) || ' yet. That wants ' || class_at()::int
      || ' in one of ' || class_wants(p_class) || '.';
end $fn$;

/*
 * Every trade, what it is, whether it is open to you and what it would cost.
 *
 * One call rather than fourteen: the card list is a screen, and a screen that
 * asks the island once is a screen that cannot be half drawn.
 */
create or replace function rpc_classes(p_world uuid) returns jsonb
 language plpgsql security definer set search_path to 'public' as $fn$
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
        'open', class_open(p_world, me, c.id),
        'why', class_refusal(p_world, me, c.id)) order by c.kind, c.name)
      from class_def c), '[]'::jsonb));
end $fn$;

/*
 * Take a trade up.
 *
 * The first one in a slot is free; swapping costs. One door for both, because
 * they are one decision asked twice -- a separate `drop` would leave somebody
 * with no trade at all and a bill still to pay.
 */
create or replace function rpc_take_class(p_world uuid, p_class text) returns jsonb
 language plpgsql security definer set search_path to 'public' as $fn$
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

  if c.kind = 'craft' then
    update player set craft_class = p_class, class_taken = now() where world_id = p_world and uid = me;
  else
    update player set combat_class = p_class, class_taken = now() where world_id = p_world and uid = me;
  end if;

  perform tell(p_world, me, case when v_had is null
    then 'You take up the ' || lower(c.name) || '’s trade. ' || c.lever
    else 'You put the ' || lower((select name from class_def where id = v_had))
         || '’s trade down and take up the ' || lower(c.name) || '’s, for '
         || v_cost || ' silver. ' || c.lever end, 'system');
  return jsonb_build_object('took', p_class, 'kind', c.kind, 'paid', v_cost, 'was', v_had);
end $fn$;

notify pgrst, 'reload schema';
select private.lock_doors();
