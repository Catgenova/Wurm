/*
 * A portcullis, a drawbridge and a hidden door (`src/game/gates.ts`).
 *
 * **A portcullis** is a wall type (`wall_type_def`, `portcullis`): an archway
 * of stone with an iron grille in its jambs, laid only in a stone or brick
 * material (`wall_type_def.stone`) and only on the ground floor
 * (`wall_type_def.ground`), its grille the sixteen metal ribbons and eight
 * brackets of `wall_fitting`. `wall.lowered` says it is down: nothing passes
 * it. Raised, it is an archway, wide enough for a cart. The eye goes through it
 * either way. `raise_portcullis` and `lower_portcullis`, from the tile either
 * side of it or one beside those, by anyone its padlock admits
 * (`lock_shut`), and by anybody without one.
 *
 * **A drawbridge** is a bridge kind (`bridge_def`, `draw`) of at most two
 * spans, both ends on the ground (`bridge_def.grounded`), its first span
 * taking the winch in `bridge_winch` over the deck. `bridge.raised` says it is
 * drawn up: then it is not a deck for anybody's feet (`deck_at`, which the
 * walk, the climb and deep water ask, and which already left an aqueduct's
 * channel out), and what is under it is what there is. `raise_drawbridge` and `lower_drawbridge`,
 * standing on the tile at its winch end, by anyone its padlock admits.
 *
 * **A hidden door** is a wall type built of exactly a solid wall's bill; its
 * padlock and a door's hinges go in when it is planned (`perform_gate_plan`),
 * and its key is cut then. To anybody that padlock does not admit it is a
 * solid wall: the ground read sends it as one (`wall_seen_type`), with no
 * padlock on it (`wall_gear`), and every refusal it can give them is a solid
 * wall's. Nothing else reads `wall` for a browser, and the table's `type` and
 * `lock` are no longer readable through the API. And it is planned as a solid
 * wall: the same `plan_wall` job, time, wind and words, with "solid" in the
 * `act_target` and the queue everybody on the island may read. The choice goes
 * to the island with the plan, in the one call (`rpc_plan_hidden_wall`), which
 * is `rpc_act`'s own path for the plan and writes the player row exactly as
 * that does; only when the plan is started or lined up is the ask kept, in
 * `private.hidden_door_plan`, which no API reaches, one row for each border it
 * waits on. It is kept while a plan of a wall on that border is in hand or
 * lined up, whichever plan that is: whenever the job in hand or the queue
 * changes, the asks left with no plan on their border are dropped
 * (`hidden_door_keep`), and `hidden_door_lapse` is only a backstop. Taken up
 * by the next solid wall planned on that border, on whatever storey
 * (`perform_gate_plan`), it writes what
 * a solid wall's plan writes: its words go on the end of the plan's own line,
 * and the padlock's own row becomes the key (`key_from_padlock`). So neither
 * the row, nor the line, nor the item a body numbers gives it away -- nor the
 * key, since every padlock fitted now becomes its own key the same way, and
 * comes back as the same row when it is taken off (`padlock_from_key`): every
 * key is keyed to its own number. So there is no other way to find one.
 *
 * A bridge thrown across now starts on open ground, on a finished deck on
 * piers or on an upper storey, and never through a wall a body cannot walk
 * through (`bridge_end_refusal`), and a drawbridge outside at both ends,
 * its winch never under a jetty, nor a jetty floored over its winch
 * (`frame_jetty_refusal`), since its gallows rise there higher than a storey;
 * nothing is built over the end of a bridge thrown across (`bridge_end_at` in
 * `extend_reason`), an aqueduct's basin keeping its own rules; a padlock on a
 * drawbridge's winch
 * keeps it from being pulled down (`last_refusal`), and one on a portcullis
 * keeps it from being taken down (`build_refusal`). On the way, that refusal's
 * reach test is mended: it read the far end's `by` unquoted off a record,
 * which PL/pgSQL does not find under a reserved word, so asking to pull any
 * bridge down raised an error on the island instead of an answer. Mended, the
 * old rule would have let anybody at an end pull down anybody's bridge; so
 * where either end stands on a settlement, only its builders may now, as only
 * they may take down a building's wall there (`may_shape`), and anywhere else
 * anybody may, as before -- within `bridge_pull_reach` of the middle of either
 * end, a number now written once. An aqueduct, which is pulled down by its own
 * job, is pulled down by the same rule (`aqueduct_refusal`).
 *
 * Both gates, when they go up or down, say so to the block they stand in
 * (`gate_heard`), so a browser there reads the walls again at its next beat
 * rather than at its twenty-second reconcile.
 */
set local lock_timeout = '3s';

alter table wall add column if not exists lowered boolean not null default false;
alter table wall add column if not exists lock bigint;
alter table bridge add column if not exists raised boolean not null default false;
alter table bridge add column if not exists lock bigint;

/*
 * A wall's type and its padlock are read through the ground read and nowhere
 * else. The table is open to anybody signed in, which no browser has used
 * since the ground read began carrying buildings -- and which would hand a
 * hidden door's type and padlock to anybody who asked PostgREST for the rows.
 * So the grant is narrowed to the columns that say nothing about one: where a
 * wall is, whose building, what it is made of and what it still wants -- all
 * of which a hidden door has exactly as a solid wall does -- and whether a
 * portcullis is down, which everybody is told anyway.
 */
revoke select on wall from anon, authenticated;
grant select (world_id, level, dir, x, y, building, material, needed, total, planned_by, dye, lowered) on wall to authenticated;

/*
 * A hidden door asked for and not yet planned: one row for each border a body
 * has asked one on, so that each waits for its own wall and several may wait
 * at once, and asked again on the same border it is asked anew. In `private`,
 * which the API does not serve, with nothing granted on it and row security on
 * with no policy: the island reads it, and nothing else does. An island that
 * goes takes its asks with it.
 */
select private.shut($ddl$
  create table if not exists private.hidden_door_plan (
    world_id uuid not null references public.world (id) on delete cascade,
    uid uuid not null,
    dir text not null,
    x int not null,
    y int not null,
    at timestamptz not null default now(),
    primary key (world_id, uid, dir, x, y)
  )
$ddl$);
select private.shut('alter table private.hidden_door_plan enable row level security');
revoke all on table private.hidden_door_plan from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- What a wall and a bridge are to a body
-- ---------------------------------------------------------------------------

/** A door's hinges, which a hidden door takes as it is planned (`HIDDEN_DOOR_HINGES`). */
create or replace function hidden_door_hinges() returns int language sql stable as $fn$
  select coalesce((select f.count from wall_fitting f where f.type = 'door' and f.item = 'hinge'), 0)
$fn$;

/** What a wall is to this body: a hidden door its padlock does not admit is a solid wall. */
create or replace function wall_seen_type(p_world uuid, p_uid uuid, w wall) returns text
language sql stable as $fn$
  select case when w.type <> 'hidden_door' then w.type
              when lock_shut(p_world, p_uid, w.lock, w.x, w.y) then 'solid'
              else w.type end
$fn$;

/**
 * What the ground read says of a wall besides its type: that a portcullis is
 * down, and the padlock on a wall this body may know is locked -- a
 * portcullis's to anybody, a hidden door's only to whoever it admits.
 */
create or replace function wall_gear(p_world uuid, p_uid uuid, w wall) returns jsonb
language sql stable as $fn$
  select case when w.lowered then jsonb_build_object('lowered', true) else '{}'::jsonb end
      || case when w.lock is null then '{}'::jsonb
              when wall_seen_type(p_world, p_uid, w) = 'solid' then '{}'::jsonb
              else jsonb_build_object('lock', w.lock) end
$fn$;

/** And of a bridge: a drawbridge drawn up, and the padlock on its winch. */
create or replace function bridge_gear(b bridge) returns jsonb language sql immutable as $fn$
  select case when b.raised then jsonb_build_object('raised', true) else '{}'::jsonb end
      || case when b.lock is null then '{}'::jsonb else jsonb_build_object('lock', b.lock) end
$fn$;

/** One tile of deck, unbuilt: the first, beside the end it is set out from, also takes a drawbridge's winch. */
create or replace function span_bill(p_kind text, p_n int) returns jsonb language sql stable as $fn$
  select coalesce(jsonb_object_agg(t.item, t.count), '{}'::jsonb)
  from (select b.item, sum(b.count)::int as count
          from (select item, count from bridge_bill where kind = p_kind
                union all
                select item, count from bridge_winch where kind = p_kind and p_n = 1) b
         group by b.item) t
$fn$;

/** The portcullis on the side of a tile: on the ground floor, where one stands. */
create or replace function portcullis_at(p_world uuid, p_x int, p_y int, p_side text) returns wall
language sql stable as $fn$
  select w.* from border_of(p_x, p_y, p_side) bd
  join wall w on w.world_id = p_world and w.level = 0 and w.dir = bd.dir and w.x = bd.x and w.y = bd.y
  where w.type = 'portcullis'
$fn$;

-- ---------------------------------------------------------------------------
-- Planning one
-- ---------------------------------------------------------------------------

/**
 * Why a wall of this type may not be planned here, over and above what any
 * wall asks, or null: `gatePlanRefusal`, word for word. `p_out` is a wall out
 * past the footprint, on a jetty (`frame_wall_level`), which no storey worked
 * on brings down to the ground floor.
 */
create or replace function gate_plan_refusal(p_world uuid, p_uid uuid, p_type text, p_material text, p_level int, p_out boolean)
returns text language plpgsql stable as $fn$
declare wt wall_type_def; mat build_material_def;
begin
  select * into wt from wall_type_def where id = p_type;
  select * into mat from build_material_def where id = p_material;
  if wt.stone and mat.kind is distinct from 'stone' then
    return 'A ' || lower(wt.name) || ' is laid in stone or brick, with a trowel.';
  end if;
  if wt.ground and p_level > 0 then
    return 'A ' || lower(wt.name) || ' stands in a wall on the ground floor.' || case when p_out then '' else ' Work on storey 1 to plan one.' end;
  end if;
  -- Planned as a solid wall, the door asked for with the plan itself: see `rpc_plan_hidden_wall` below.
  if p_type = 'hidden_door' then
    return 'A hidden door is planned with Plan wall, then Hidden door.';
  end if;
  return null;
end $fn$;

/** What a hidden door wants in the pack as it is planned, or null (`hiddenDoorWants`). */
create or replace function hidden_door_wants(p_world uuid, p_uid uuid) returns text language sql stable as $fn$
  select case
    when pack_count(p_world, p_uid, 'padlock') < 1
      then 'A hidden door takes a padlock when it is planned. Forge one at a smelter.'
    when pack_count(p_world, p_uid, 'hinge') < hidden_door_hinges()
      then 'A hidden door takes ' || number_word(hidden_door_hinges()) || ' hinges when it is planned.'
  end
$fn$;

/** How long an ask waits for its wall to be planned, in seconds (`HIDDEN_DOOR_LAPSE`): a backstop, since an ask goes with its job. */
create or replace function hidden_door_lapse() returns int language sql immutable as $fn$ select 3600 $fn$;

/**
 * A solid wall's plan asked for as a hidden door: the one call that asks for
 * both, sent when the feet arrive, as every plan is (`planHiddenDoor`). The
 * padlock and the hinges are asked for first, and refused for want of them it
 * is refused as `rpc_act` refuses a job: the body settled, the reason said,
 * nothing started. Then the plan is `rpc_act`'s own, called whole -- its reach,
 * its refusals, its wind, the room in the head, its answer, and its one write
 * to the row everybody reads. And in the same transaction, only when that plan
 * was started or lined up, the ask is kept in `private.hidden_door_plan`, on
 * its border, for `perform_gate_plan`. So both are refused or neither, and the
 * row anybody reads moves exactly as a solid wall's plan moves it.
 */
create or replace function rpc_plan_hidden_wall(p_world uuid, p_target jsonb, p_times int default 1) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare me uuid := auth.uid(); why text; v jsonb; bd record;
        t jsonb := coalesce(p_target, '{}'::jsonb) || '{"wallType": "solid"}'::jsonb;
begin
  if me is null then raise exception 'not signed in'; end if;
  why := hidden_door_wants(p_world, me);
  if why is not null then
    if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
    perform settle(p_world, me);
    perform tell(p_world, me, why, 'error');
    return jsonb_build_object('started', false, 'why', why);
  end if;
  v := rpc_act(p_world, 'plan_wall', t, p_times);
  if coalesce((v->>'started')::boolean, false) or coalesce((v->>'queued')::boolean, false) then
    select * into bd from border_of((t->>'x')::int, (t->>'y')::int, t->>'side');
    insert into private.hidden_door_plan (world_id, uid, dir, x, y, at)
      values (p_world, me, bd.dir, bd.x, bd.y, now())
    on conflict (world_id, uid, dir, x, y) do update set at = excluded.at;
  end if;
  return v;
end $fn$;

/**
 * An ask is kept only while its body has a plan of a wall on its border in
 * hand or lined up, whichever plan that is (`keepHiddenAsks`). Whenever the
 * job in hand or the queue changes -- a job done, forgotten (`rpc_cancel`),
 * refused as it came up, or anything else that drops one -- the asks left with
 * no plan on their border are dropped, so none is there for a later plain
 * wall. A job held (`rpc_hold`) goes back into the queue, and its ask stays.
 * In `private`, beside a row nobody else's call writes. It never raises, on
 * the hottest table there is: a target whose x or y is not a whole number
 * names no border, and is read as none rather than cast.
 */
create or replace function private.hidden_door_keep() returns trigger language plpgsql as $fn$
begin
  delete from private.hidden_door_plan h
   where h.world_id = new.world_id and h.uid = new.uid
     and not exists (
       select 1
         from (select new.act_target as target where new.act = 'plan_wall'
               union all
               select q->'target' from jsonb_array_elements(case when jsonb_typeof(new.act_queue) = 'array'
                                                                 then new.act_queue else '[]'::jsonb end) q
                where q->>'action' = 'plan_wall') j
         cross join lateral border_of(case when j.target->>'x' ~ '^-?[0-9]{1,9}$' then (j.target->>'x')::int end,
                                      case when j.target->>'y' ~ '^-?[0-9]{1,9}$' then (j.target->>'y')::int end,
                                      j.target->>'side') bd
        where bd.dir = h.dir and bd.x = h.x and bd.y = h.y);
  return null;
end $fn$;
revoke all on function private.hidden_door_keep() from public, anon, authenticated;
select private.shut('drop trigger if exists hidden_door_keep on public.player');
select private.shut($ddl$create trigger hidden_door_keep after update of act, act_target, act_queue on public.player
  for each row when (old.act is distinct from new.act or old.act_target is distinct from new.act_target
                     or old.act_queue is distinct from new.act_queue)
  execute function private.hidden_door_keep()$ddl$);

/**
 * A padlock fitted -- to a store, a gate, or a hidden door as it is planned:
 * its own row becomes the key cut to it, numbered as it was, so the padlock,
 * the lock and the key share the one number and no new row is numbered
 * (`keyFromPadlock`). It is what a key cut new would be: the padlock's quality
 * and what it was made of, and nothing else of it. So every key is keyed to
 * its own number, and no key says more about the lock it opens than another.
 */
create or replace function key_from_padlock(p_item bigint) returns void language sql as $fn$
  update item set def = 'key', keyed = id, count = 1, dmg = 0, rare = null, dye = null, bless = null, charges = null,
         locked = false, issued = false, made_at = now(), lit = false, lit_at = null, rot_at = null, maker = null,
         piece = null, price = null, letter = null, deal = null, creature = null, mark = null, cool = null
   where id = p_item
$fn$;

/**
 * And the key, thrown in after its padlock as the padlock comes off: the same
 * row, a padlock again, as a new one is handed back (`padlockFromKey`).
 */
create or replace function padlock_from_key(p_item bigint) returns void language sql as $fn$
  update item set def = 'padlock', keyed = null, ql = 40, extra = null, count = 1, dmg = 0, rare = null, dye = null,
         bless = null, charges = null, locked = false, issued = false, made_at = now(), lit = false, lit_at = null,
         rot_at = null, maker = null, piece = null, price = null, letter = null, deal = null, creature = null,
         mark = null, cool = null
   where id = p_item
$fn$;

/** How near the middle of either end tile a body stands to pull a bridge down, in tiles (`PULL_REACH`). */
create or replace function bridge_pull_reach() returns double precision language sql immutable as $fn$ select 4.5::double precision $fn$;

/** What planning a hidden door says, as the browser says it (`hiddenDoorSaid`), naming whoever else it admits. */
create or replace function hidden_door_said(p_own_land boolean, p_deed text) returns text language sql stable as $fn$
  select 'You set a padlock and ' || number_word(hidden_door_hinges())
      || ' hinges in it and cut its key. It is a door to whoever holds that key'
      || case when p_own_land then ' and to you, on your own land'
              when p_deed is not null then ' and to the founder of ' || p_deed else '' end
      || ', and a solid wall to everybody else.'
$fn$;

/** And when the padlock or the hinges went before the wall was planned (`HIDDEN_DOOR_SHORT`). */
create or replace function hidden_door_short() returns text language sql stable as $fn$
  select 'A padlock and ' || number_word(hidden_door_hinges())
      || ' hinges were no longer in your pack, so it is a solid wall.'
$fn$;

/**
 * A solid wall just planned on a border its planner asked a hidden door on, by
 * whichever plan of a wall there it was, on whatever storey, and within
 * `hidden_door_lapse`: the padlock goes in, its
 * number becomes the door's, the padlock's own row becomes the key in the
 * planner's pack -- the same row, so no new one is numbered, as for every
 * padlock fitted (`key_from_padlock`) -- and the hinges are spent (`planGate`). What it says, for `perform_building` to put on the
 * end of the plan's own line, so that the plan writes one line as a solid
 * wall's does; or null, and anything else planned is left alone. Called after
 * the wall row is written, in the same transaction, so nothing ever reads the
 * row as anything but what it ends as.
 */
create or replace function perform_gate_plan(p_world uuid, p_uid uuid, p_target jsonb, p_level int)
returns text language plpgsql as $fn$
declare v_plan private.hidden_door_plan; v_padlock item; w wall; bd record; v_deed deed;
begin
  if p_target->>'wallType' is distinct from 'solid' then return null; end if;
  select * into bd from border_of((p_target->>'x')::int, (p_target->>'y')::int, p_target->>'side');
  delete from private.hidden_door_plan h
   where h.world_id = p_world and h.uid = p_uid and h.dir = bd.dir and h.x = bd.x and h.y = bd.y
  returning h.* into v_plan;
  if not found or v_plan.at < now() - make_interval(secs => hidden_door_lapse()) then return null; end if;
  select * into v_padlock from item
   where world_id = p_world and holder = 'player' and holder_uid = p_uid and def = 'padlock' and not locked
   order by id limit 1;
  if not found or pack_count(p_world, p_uid, 'hinge') < hidden_door_hinges() then
    return hidden_door_short();
  end if;
  perform consume(p_world, p_uid, 'hinge', hidden_door_hinges());
  perform key_from_padlock(v_padlock.id);
  update wall w2 set type = 'hidden_door', lock = v_padlock.id
   where w2.world_id = p_world and w2.level = p_level and w2.dir = bd.dir and w2.x = bd.x and w2.y = bd.y
  returning w2.* into w;
  select d.* into v_deed from deed d where d.world_id = p_world and deed_covers(d, w.x, w.y)
   order by (d.founded_by = p_uid) desc limit 1;
  return hidden_door_said(v_deed.founded_by is not distinct from p_uid and v_deed.world_id is not null, v_deed.name);
end $fn$;

/**
 * The line planning a wall says (`planLine`): a solid wall as it always has
 * been, "You plan a solid stone brick wall on the north side."; a railing as
 * one, "You plan a log railing on the east side.", as the frame batch names
 * it; and any other type as the thing it is, "You plan a portcullis in stone
 * brick on the south side.".
 */
create or replace function plan_line(p_type text, p_material text, p_side text) returns text
language sql stable as $fn$
  select case when p_type = 'solid'
    then 'You plan ' || an(lower(wt.name)) || ' ' || lower(m.name) || ' wall on the ' || side_name(p_side) || ' side.'
    when p_type = 'railing'
    then 'You plan ' || an(lower(m.name)) || ' railing on the ' || side_name(p_side) || ' side.'
    else 'You plan ' || an(lower(wt.name)) || ' in ' || lower(m.name) || ' on the ' || side_name(p_side) || ' side.' end
  from wall_type_def wt, build_material_def m where wt.id = p_type and m.id = p_material
$fn$;

-- ---------------------------------------------------------------------------
-- Where a bridge may start
-- ---------------------------------------------------------------------------

/**
 * Why a bridge may not start or end where it would, over and above what every
 * bridge asks of its ends, or null (`bridgeEndRefusal`, word for word and in
 * the same order): a drawbridge stands outside at both ends, its winch not
 * under a jetty (`frame_jetty_of`); any other bridge
 * on open ground, on a finished deck on piers -- which `bridge_reason` lands
 * a bridge on as on a bank -- or on an upper storey, not on a ground floor
 * laid on the ground; and none goes through a wall a body cannot walk
 * through, at the storey it leaves from, named as what it is and a hidden
 * door counted as the solid wall it looks like, whoever asks.
 */
create or replace function bridge_end_refusal(p_world uuid, p_uid uuid, p_kind text, p_ax int, p_ay int, p_bx int, p_by int,
  p_la int, p_lb int) returns text language plpgsql stable as $fn$
declare d bridge_def; e record; w wall; v_type text; v_what text; ux int := sign(p_bx - p_ax); uy int := sign(p_by - p_ay);
begin
  select * into d from bridge_def where id = p_kind;
  for e in select * from (values (0, p_ax, p_ay, p_la, ux, uy), (1, p_bx, p_by, p_lb, -ux, -uy)) v(i, x, y, lvl, dx, dy) order by i loop
    if building_at(p_world, e.x, e.y) is not null then
      if d.grounded then
        return case when e.i = 0 then 'A ' || lower(d.name) || '''s winch stands outside, on open ground.'
                    else 'A ' || lower(d.name) || ' comes down outside, on open ground.' end;
      end if;
      if e.lvl = 0 and deck_surface(p_world, e.x, e.y) is null then
        return 'A bridge starts and ends on open ground, on a finished deck or on an upper storey, not inside on a ground floor.';
      end if;
    end if;
    -- Its gallows rise over the winch higher than a storey, and its deck stands on end beside it: not on the ground
    -- under a jetty, built or only planned; a finished one is a storey, which its end would be on (`top_deck`).
    if d.grounded and e.i = 0 and e.lvl = 0 and frame_jetty_of(p_world, e.x, e.y) is not null then
      return 'A ' || lower(d.name) || '''s winch is not set under a jetty: its gallows rise over it.';
    end if;
    w := null;
    select w2.* into w from border_of(e.x, e.y, case when e.dx > 0 then 'e' when e.dx < 0 then 'w' when e.dy > 0 then 's' else 'n' end) bd
      join wall w2 on w2.world_id = p_world and w2.level = e.lvl and w2.dir = bd.dir and w2.x = bd.x and w2.y = bd.y;
    -- A hidden door is the solid wall it looks like here to everybody, its key holder too: nobody lands a deck on one.
    v_type := case when w.type = 'hidden_door' then 'solid' else w.type end;
    if w.world_id is not null and not coalesce((select t.passable from wall_type_def t where t.id = v_type), false) then
      v_what := case when v_type = 'solid' then 'solid wall' else lower((select t.name from wall_type_def t where t.id = v_type)) end;
      return upper(left(an(v_what), 1)) || substr(an(v_what), 2)
          || ' stands across one end of it. A bridge goes out through a doorway, an archway or an open side.';
    end if;
  end loop;
  return null;
end $fn$;

/** Whether a drawbridge's winch stands on this tile: the end it was set out from (`drawbridgeWinchAt`). */
create or replace function drawbridge_winch_at(p_world uuid, p_x int, p_y int) returns boolean language sql stable as $fn$
  select exists (select 1 from bridge b where b.world_id = p_world and b.kind = 'draw' and b.ax = p_x and b.ay = p_y)
$fn$;

/**
 * Whether a bridge thrown across comes ashore on this tile: one of its ends
 * (`bridgeEndAt`). Not an aqueduct's: its ends are the pond or pool it draws
 * from and the basin it pours into, which answer for themselves.
 */
create or replace function bridge_end_at(p_world uuid, p_x int, p_y int) returns boolean language sql stable as $fn$
  select exists (select 1 from bridge b where b.world_id = p_world and b.kind <> 'aqueduct'
                   and ((b.ax = p_x and b.ay = p_y) or (b.bx = p_x and b.by = p_y)))
$fn$;

-- ---------------------------------------------------------------------------
-- Raising and lowering
-- ---------------------------------------------------------------------------

create or replace function gate_action(p_action text) returns boolean language sql immutable as $fn$
  select p_action in ('raise_portcullis', 'lower_portcullis', 'raise_drawbridge', 'lower_drawbridge')
$fn$;

/**
 * Why a portcullis or a drawbridge will not go up, or down, or null:
 * `portcullisRefusal` and `drawbridgeRefusal`, word for word, and the reach
 * the browser walks to before it asks -- one tile from the side of a tile a
 * portcullis stands on, and the very tile at a drawbridge's winch end.
 */
create or replace function gate_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
returns text language plpgsql stable as $fn$
declare p player; w wall; b bridge; v_up boolean := p_action like 'raise\_%';
begin
  select * into p from player where world_id = p_world and uid = p_uid;
  if p_action in ('raise_portcullis', 'lower_portcullis') then
    if p_target->>'kind' is distinct from 'tile' or p_target->>'side' is null then
      return 'There is no portcullis there.';
    end if;
    w := portcullis_at(p_world, (p_target->>'x')::int, (p_target->>'y')::int, p_target->>'side');
    if w.world_id is null then return 'There is no portcullis there.'; end if;
    if not in_reach(p.x, p.y, p_target, false, 1) then return 'You are too far away from that.'; end if;
    if not bill_done(w.needed) then return 'Finish the portcullis first.'; end if;
    if v_up and not w.lowered then return 'The portcullis is up already.'; end if;
    if not v_up and w.lowered then return 'The portcullis is down already.'; end if;
    return lock_refusal(p_world, p_uid, w.lock, w.x, w.y);
  end if;
  if p_target->>'kind' = 'bridge' then
    select * into b from bridge where world_id = p_world and id = nullif(p_target->>'id', '')::bigint;
  end if;
  if b.id is null then return 'It is gone.'; end if;
  if b.kind <> 'draw' then return 'That is not a drawbridge.'; end if;
  if floor(p.x)::int <> b.ax or floor(p.y)::int <> b.ay then return 'You are too far away from that.'; end if;
  if bridge_left(p_world, b.id) > 0 then return 'Deck every span of the drawbridge first.'; end if;
  if v_up and b.raised then return 'The drawbridge is up already.'; end if;
  if not v_up and not b.raised then return 'The drawbridge is down already.'; end if;
  return lock_refusal(p_world, p_uid, b.lock, b.ax, b.ay);
end $fn$;

/**
 * A gate went up or down: said to the block it stands in, while anybody who
 * is not away is in it or next to it -- which is who is listening to that
 * block -- so their browsers read the walls and bridges again at the next
 * ground read (`heardLand`). One message, and only when a gate moves.
 */
create or replace function gate_heard(p_world uuid, p_x int, p_y int) returns void
language plpgsql as $fn$
declare v_size int := region_size()::int;
begin
  if not exists (select 1 from player p
                  where p.world_id = p_world and not p.away
                    and abs(floor(p.x / v_size)::int - p_x / v_size) <= 1
                    and abs(floor(p.y / v_size)::int - p_y / v_size) <= 1) then
    return;
  end if;
  perform private.send('land:' || p_world || ':' || region_of(p_x, p_y), 'land', jsonb_build_object('gates', true));
end $fn$;

/** What raising or lowering one says (`portcullisSaid`, `drawbridgeSaid`). */
create or replace function gate_said(p_action text) returns text language sql stable as $fn$
  select case p_action
    when 'raise_portcullis' then 'You winch the portcullis up. People, carts and beasts pass under it.'
    when 'lower_portcullis' then 'You let the portcullis down. Nothing passes it until it is raised; it is still seen through.'
    when 'raise_drawbridge' then 'You winch the drawbridge up. Nothing crosses it until it is let down.'
    else 'You let the drawbridge down. It carries people and beasts'
      || case when (select d.carts from bridge_def d where d.id = 'draw') then ', and carts' else '' end || '.'
  end
$fn$;

create or replace function perform_gate(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
returns void language plpgsql as $fn$
declare w wall; v_up boolean := p_action like 'raise\_%'; v_id bigint; v_x int; v_y int;
begin
  -- Somebody else may have done it while this was being done: then it is done.
  if gate_refusal(p_world, p_uid, p_action, p_target) is not null then return; end if;
  if p_action in ('raise_portcullis', 'lower_portcullis') then
    w := portcullis_at(p_world, (p_target->>'x')::int, (p_target->>'y')::int, p_target->>'side');
    update wall set lowered = not v_up
     where world_id = p_world and level = w.level and dir = w.dir and x = w.x and y = w.y;
    v_x := w.x; v_y := w.y;
  else
    v_id := (p_target->>'id')::bigint;
    update bridge set raised = v_up where world_id = p_world and id = v_id returning ax, ay into v_x, v_y;
  end if;
  perform tell(p_world, p_uid, gate_said(p_action), 'event');
  perform gate_heard(p_world, v_x, v_y);
end $fn$;

-- ---------------------------------------------------------------------------
-- A padlock on a portcullis or a drawbridge's winch
-- ---------------------------------------------------------------------------

/**
 * Fitting a padlock to a portcullis or a drawbridge, and taking it off: the
 * lock family's own words (`lock_refusal_for`), from a tile beside the
 * portcullis or beside the winch. A hidden door has its padlock from the day
 * it is planned and keeps it, so it is not one: to the lock family it is the
 * wall it looks like, and there is nothing there.
 */
create or replace function gate_lock_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
returns text language plpgsql stable as $fn$
declare p player; w wall; b bridge; v_lock bigint; v_x int; v_y int;
begin
  select * into p from player where world_id = p_world and uid = p_uid;
  if p_target->>'kind' = 'tile' then
    if p_target->>'side' is null then return 'It is gone.'; end if;
    w := portcullis_at(p_world, (p_target->>'x')::int, (p_target->>'y')::int, p_target->>'side');
    if w.world_id is null then return 'It is gone.'; end if;
    if not in_reach(p.x, p.y, p_target, false, 1) then return 'Stand next to it.'; end if;
    v_lock := w.lock; v_x := w.x; v_y := w.y;
  else
    select * into b from bridge where world_id = p_world and id = nullif(p_target->>'id', '')::bigint;
    if b.id is null or b.kind <> 'draw' then return 'It is gone.'; end if;
    if greatest(abs(floor(p.x)::int - b.ax), abs(floor(p.y)::int - b.ay)) > 1 then return 'Stand next to it.'; end if;
    v_lock := b.lock; v_x := b.ax; v_y := b.ay;
  end if;
  if p_action = 'fit_lock' then
    if coalesce(v_lock, 0) <> 0 then return 'There is a padlock on it already.'; end if;
    -- One locked against use is not there to be fitted (`padlockToFit`).
    if not exists (select 1 from item where world_id = p_world and holder = 'player'
                     and holder_uid = p_uid and def = 'padlock' and not locked) then
      return 'You have no padlock. Forge one at a smelter.';
    end if;
    return null;
  end if;
  if coalesce(v_lock, 0) = 0 then return 'There is no padlock on it.'; end if;
  return lock_refusal(p_world, p_uid, v_lock, v_x, v_y);
end $fn$;

create or replace function perform_gate_lock(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
returns void language plpgsql as $fn$
declare w wall; b bridge; v_lock bigint; v_x int; v_y int; v_padlock item; v_key item;
begin
  if gate_lock_refusal(p_world, p_uid, p_action, p_target) is not null then return; end if;
  if p_target->>'kind' = 'tile' then
    w := portcullis_at(p_world, (p_target->>'x')::int, (p_target->>'y')::int, p_target->>'side');
    v_lock := w.lock; v_x := w.x; v_y := w.y;
  else
    select * into b from bridge where world_id = p_world and id = (p_target->>'id')::bigint;
    v_lock := b.lock; v_x := b.ax; v_y := b.ay;
  end if;
  if p_action = 'fit_lock' then
    -- The first numbered not locked against use, as every padlock fitted is taken (`padlockToFit`).
    select * into v_padlock from item where world_id = p_world and holder = 'player'
      and holder_uid = p_uid and def = 'padlock' and not locked order by id limit 1;
    if not found then return; end if;
    if w.world_id is not null then
      update wall set lock = v_padlock.id where world_id = p_world and level = w.level and dir = w.dir and x = w.x and y = w.y;
    else
      update bridge set lock = v_padlock.id where world_id = p_world and id = b.id;
    end if;
    -- Its own row becomes its key, as every padlock fitted does.
    perform key_from_padlock(v_padlock.id);
    perform tell(p_world, p_uid, 'You fit the padlock and cut its key. Nothing opens it now but that key'
      || case when exists (select 1 from deed d where d.world_id = p_world and d.founded_by = p_uid
                             and deed_covers(d, v_x, v_y))
              then ', or you, on your own land' else '' end || '.', 'event');
    return;
  end if;
  select * into v_key from item where world_id = p_world and holder = 'player'
    and holder_uid = p_uid and def = 'key' and keyed = v_lock limit 1;
  if w.world_id is not null then
    update wall set lock = null where world_id = p_world and level = w.level and dir = w.dir and x = w.x and y = w.y;
  else
    update bridge set lock = null where world_id = p_world and id = b.id;
  end if;
  -- The key held becomes the padlock handed back; the master key holds none, and a new one comes.
  if v_key.id is not null then
    perform padlock_from_key(v_key.id);
  else
    insert into item (world_id, holder, holder_uid, def, ql, count)
      values (p_world, 'player', p_uid, 'padlock', 40, 1);
  end if;
  perform tell(p_world, p_uid, 'You take the padlock off'
    || case when v_key.id is not null then ' and throw the key in after it' else '' end
    || '. It is open to anybody again.', 'event');
end $fn$;

-- ---------------------------------------------------------------------------
-- The shared functions, each with a few lines calling the above
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.act_ported(p_action text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  select exists (select 1 from recipe where id = p_action)
      or last_action(p_action)
      or spring_action(p_action)
      or aqueduct_action(p_action)
      or flower_action(p_action)
      or green_action(p_action)
      or water_garden_action(p_action)
      -- gates: raising and lowering a portcullis and a drawbridge.
      or gate_action(p_action)
      or cellar_action(p_action) -- cellar
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
      or farm_action(p_action)
      -- Shop counters and lantern posts.
      or counter_action(p_action) or lamp_action(p_action)
      or p_action in ('dig', 'mine', 'chip_corner', 'pack', 'cultivate', 'pave_cobble',
                      'drop_dirt_here', 'cut_down', 'forage', 'botanize', 'collect',
                      'fish', 'drag_net', 'found_settlement', 'set_to_work', 'dig_tile', 'pan')
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
  -- Shop counters and lantern posts (`counters.ts`, `lamps.ts`), and a lantern post lifted with its lantern in it.
  if counter_action(p_action) then return counter_refusal(p_world, p_uid, p_action, p_target); end if;
  if lamp_action(p_action) then return lamp_refusal(p_world, p_uid, p_action, p_target); end if;
  if lamp_lift_refusal(p_world, p_uid, p_action, p_target) is not null then return lamp_lift_refusal(p_world, p_uid, p_action, p_target); end if;
  -- The hour comes for a dam in young whoever is or is not standing there, and
  -- somebody is always about to do something. This is where they find out.
  perform herd_settle(p_world);
  -- cellar: digging out, mining out and filling in a cellar, and a drop, a pick up or a sweep down there.
  if cellar_action(p_action) or (p_action in ('drop', 'pick_up', 'pick_up_all') and cellar_hands(p_world, p_uid, p_action, p_target)) then
    return cellar_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- A spring answers for its own reach, its own tool and whose spring it is.
  if spring_action(p_action) then
    return spring_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- An aqueduct answers for its own reach and both its ends, and for a bridge's job aimed at one.
  if aqueduct_aimed(p_world, p_action, p_target) then
    return aqueduct_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- And wildflowers for their own reach, their season and whether they are picked.
  if flower_action(p_action) then
    return flower_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Ivy and moss answer for their own reach: a statue and a bridge are not tiles.
  if green_action(p_action) then
    return green_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Stepping stones and water plants answer for their own reach, as a spring does.
  if water_garden_action(p_action) then
    return water_garden_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- gates: a portcullis and a drawbridge answer for their own reach: a side of a tile, and the tile at a winch.
  if gate_action(p_action) then
    return gate_refusal(p_world, p_uid, p_action, p_target);
  end if;
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
    -- Nothing is planted under an aqueduct's arches: a tree would grow up through them.
    if p_action = 'plant' and aqueduct_over(p_world, (p_target->>'x')::int, (p_target->>'y')::int) then return 'An aqueduct is carried over that tile.'; end if;
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
  -- A line and a net reach as far as their Fisher casts and drags them (a Long Cast, a Wide Net).
  if not in_reach(p.x, p.y, p_target, d.corner, case p_action when 'fish' then cast_reach(p_world, p_uid)::real
                                                                when 'drag_net' then net_reach(p_world, p_uid)::real
                                                                else d.range end) then
    return 'You are too far away from that.';
  end if;
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
  if farm_action(p_action) then
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
    -- cellar: not a corner of a building, nor of the cellar under one (`cornerUnderBuilding`, as the browser asks it).
    aimed := corner_under_building(p_world, cx, cy); -- cellar
    if aimed is not null then return aimed; end if; -- cellar
    -- Piers: not under a building, a tile on piers among them, as the browser has it (`cornerUnderBuilding`).
    aimed := corner_under_building(p_world, cx, cy);
    if aimed is not null then return aimed; end if;
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
  -- A Miner's Pan: sand with water at one of its corners, and the perk to work it.
  if p_action = 'pan' then
    tx := (p_target->>'x')::int;  ty := (p_target->>'y')::int;
    if pk(p.class_mul, 'pan', 0) <= 0 then
      return 'That wants a Miner who has learned to pan.';
    end if;
    if land_tile(p_world, tx, ty) <> tile_id('Sand') then return 'Panning is done on sand.'; end if;
    if not exists (select 1 from tile_corners(tx, ty) c where land_height(p_world, c.cx, c.cy) < 0) then
      return 'There is no water at this sand to wash it in.';
    end if;
    return null;
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
  -- cellar: digging out, mining out and filling in a cellar, and a drop, a pick up or a sweep down there.
  if cellar_action(p_action) or (p_action in ('drop', 'pick_up', 'pick_up_all') and cellar_hands(p_world, p_uid, p_action, p_target)) then
    perform perform_cellar(p_world, p_uid, p_action, p_target);
    return;
  end if;
  -- Shop counters and lantern posts (`counters.ts`, `lamps.ts`).
  if counter_action(p_action) then perform perform_counter(p_world, p_uid, p_action, p_target); return; end if;
  if lamp_action(p_action) then perform perform_lamp(p_world, p_uid, p_action, p_target); return; end if;
  if spring_action(p_action) then
    perform perform_spring(p_world, p_uid, p_action, p_target);
    return;
  end if;
  -- An aqueduct's jobs, and a bridge's aimed at one (`aqueduct_aimed`).
  if aqueduct_aimed(p_world, p_action, p_target) then
    perform perform_aqueduct(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if flower_action(p_action) then
    perform perform_flowers(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if green_action(p_action) then
    perform perform_green(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if water_garden_action(p_action) then
    perform perform_water_garden(p_world, p_uid, p_action, p_target);
    return;
  end if;
  -- gates: raising and lowering a portcullis and a drawbridge.
  if gate_action(p_action) then
    perform perform_gate(p_world, p_uid, p_action, p_target);
    return;
  end if;
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
  if farm_action(p_action) then
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
  if p_action = 'pan' then
    perform perform_pan(p_world, p_uid, p_target);
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

CREATE OR REPLACE FUNCTION public.lock_refusal_for(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare v_c crate; v_pl placed; v_lock bigint; v_x int; v_y int; v_p player;
begin
  if p_action not in ('fit_lock', 'take_off_lock') then return null; end if;
  -- gates: a portcullis, aimed at the side of a tile, and a drawbridge's winch.
  if p_target->>'kind' in ('tile', 'bridge') then return gate_lock_refusal(p_world, p_uid, p_action, p_target); end if;
  select * into v_p from player where world_id = p_world and uid = p_uid;
  if p_target->>'kind' = 'crate' then
    v_c := target_crate(p_world, p_target);
    if v_c.id is null then return 'It is gone.'; end if;
    v_lock := v_c.lock; v_x := v_c.x; v_y := v_c.y;
  else
    select * into v_pl from placed where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found then return 'It is gone.'; end if;
    v_lock := v_pl.lock; v_x := v_pl.x; v_y := v_pl.y;
  end if;
  if sqrt((v_x + 0.5 - v_p.x) ^ 2 + (v_y + 0.5 - v_p.y) ^ 2) > 2.4 then
    return 'Stand next to it.';
  end if;
  if p_action = 'fit_lock' then
    if coalesce(v_lock, 0) <> 0 then return 'There is a padlock on it already.'; end if;
    -- gates: one locked against use is not there to be fitted (`padlockToFit`).
    if not exists (select 1 from item where world_id = p_world and holder = 'player'
                     and holder_uid = p_uid and def = 'padlock' and not locked) then
      return 'You have no padlock. Forge one at a smelter.';
    end if;
    return null;
  end if;
  if coalesce(v_lock, 0) = 0 then return 'There is no padlock on it.'; end if;
  return lock_refusal(p_world, p_uid, v_lock, v_x, v_y);
end $function$;

CREATE OR REPLACE FUNCTION public.perform_lock(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare v_c crate; v_pl placed; v_lock bigint; v_x int; v_y int; v_padlock item; v_key item;
begin
  -- gates: a portcullis, aimed at the side of a tile, and a drawbridge's winch.
  if p_target->>'kind' in ('tile', 'bridge') then
    perform perform_gate_lock(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if p_target->>'kind' = 'crate' then
    v_c := target_crate(p_world, p_target);
    if v_c.id is null then return; end if;
    v_lock := v_c.lock; v_x := v_c.x; v_y := v_c.y;
  else
    select * into v_pl from placed where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found then return; end if;
    v_lock := v_pl.lock; v_x := v_pl.x; v_y := v_pl.y;
  end if;

  if p_action = 'fit_lock' then
    -- gates: the first numbered not locked against use (`padlockToFit`): not the best, which could be one locked
    -- against use, and would come out of it as an unlocked key.
    select * into v_padlock from item where world_id = p_world and holder = 'player'
      and holder_uid = p_uid and def = 'padlock' and not locked order by id limit 1;
    if not found then return; end if;
    if p_target->>'kind' = 'crate' then
      update crate set lock = v_padlock.id where world_id = p_world and id = v_c.id;
    else
      update placed set lock = v_padlock.id where world_id = p_world and id = v_pl.id;
    end if;
    -- gates: the padlock's own row becomes its key (`key_from_padlock`), as a hidden door's does: every key keyed
    -- to its own number, so no key tells what kind of lock it opens.
    perform key_from_padlock(v_padlock.id);
    perform tell(p_world, p_uid, 'You fit the padlock and cut its key. Nothing opens it now but that key'
      || case when exists (select 1 from deed d where d.world_id = p_world and d.founded_by = p_uid
                             and deed_covers(d, v_x, v_y))
              then ', or you, on your own land' else '' end || '.', 'event');
    return;
  end if;

  -- Taking it off. The key goes with the lock it was cut to: a key to
  -- nothing is an item nobody can tell from a key to something.
  select * into v_key from item where world_id = p_world and holder = 'player'
    and holder_uid = p_uid and def = 'key' and keyed = v_lock limit 1;
  if p_target->>'kind' = 'crate' then
    update crate set lock = null where world_id = p_world and id = v_c.id;
  else
    update placed set lock = null where world_id = p_world and id = v_pl.id;
  end if;
  -- gates: the key held becomes the padlock handed back (`padlock_from_key`); the master key holds none, and a
  -- new one comes.
  if v_key.id is not null then
    perform padlock_from_key(v_key.id);
  else
    insert into item (world_id, holder, holder_uid, def, ql, count)
      values (p_world, 'player', p_uid, 'padlock', 40, 1);
  end if;
  perform tell(p_world, p_uid, 'You take the padlock off'
    || case when v_key.id is not null then ' and throw the key in after it' else '' end
    || '. It is open to anybody again.', 'event');
end $function$;

CREATE OR REPLACE FUNCTION public.build_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare tx int; ty int; side text; wt wall_type_def; mat build_material_def; b building;
        w wall; f floor_tile; lvl int; kind text; tool text; other record; v_gap text;
        bears int; cap int; worst build_material_def; under build_material_def;
        pot item; colour dye_def; v_was build_material_def; v_over int; v_stands int; v_bill jsonb; v_glass text;
begin
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  side := p_target->>'side';
  select * into wt from wall_type_def where id = p_target->>'wallType';
  select * into mat from build_material_def where id = p_target->>'material';
  select * into b from building where world_id = p_world and id = building_at(p_world, tx, ty);
  -- Frame: a storey job out past the footprint is for the building it names (`frame_building`).
  b := frame_building(p_world, p_action, p_target, b);

  /*
   * Whose building it is, asked once for every action that acts on one that
   * already stands.
   *
   * `plan_building` and `add_to_building` are answered by `plan_reason`, which
   * asks whose *ground* it is. Everything else — renaming, unpicking, walling,
   * flooring, adding a storey — was asked of nobody at all, so anybody could
   * rename or take apart anybody's building. `plan_fence` never reaches this
   * because it refuses outright on a tile that is part of a building.
   */
  if b.id is not null and p_action <> 'plan_building'
     and not building_yours(p_world, p_uid, b.id) then
    return 'That is not your building.';
  end if;
  -- Glass goes on a pitched roof and nowhere else, and no floor over a field (`glass_refusal`).
  v_glass := glass_refusal(p_world, p_uid, p_action, p_target);
  if v_glass is not null then return v_glass; end if;
  -- Frame: jetties, terraces, railings and columns, where the browser asks them, after the glass (`frame_refusal`).
  v_gap := frame_refusal(p_world, p_uid, p_action, p_target, b);
  if v_gap is not null or frame_action(p_action) then return v_gap; end if;

  if p_action = 'plan_building' then
    return coalesce(need_tool(p_world, p_uid, 'mallet'), plan_reason(p_world, p_uid, tx, ty),
                    counter_street_refusal(p_world, tx, ty));  -- a counter's street (`counters.ts`)

  elsif p_action = 'add_to_building' then
    tool := need_tool(p_world, p_uid, 'mallet');
    if tool is not null then return tool; end if;
    select * into b from building where world_id = p_world and id = neighbour_building(p_world, tx, ty);
    if not found then return 'There is no building next to this tile.'; end if;
    if b.levels > 1 then return 'The footprint cannot change once upper floors are planned.'; end if;
    -- Piers: under the deck, or beside the floor, of the building it joins (`extend_reason`).
    return coalesce(extend_reason(p_world, p_uid, tx, ty, b.id), counter_street_refusal(p_world, tx, ty));  -- a counter's street

  elsif p_action = 'remove_from_plan' then
    if b.id is null then return 'No building here.'; end if;
    if b.levels > 1 then return 'Remove the upper floors first.'; end if;
    -- cellar: a building with a cellar under it comes down only once the cellar is filled in.
    if (cellar_at(p_world, tx, ty)).world_id is not null then return 'Fill in the cellar under it first.'; end if;
    if tile_has_structures(p_world, tx, ty) then return 'Remove the walls and floor on this tile first.'; end if;
    return null;

  elsif p_action = 'rename_building' then
    if b.id is null then return 'No building here.'; end if;
    if nullif(btrim(coalesce(p_target->>'name', '')), '') is null then return 'Choose a name.'; end if;
    return null;

  elsif p_action = 'plan_wall' then
    if side is null or wt.id is null or mat.id is null then return 'Choose a side, a wall type and a material.'; end if;
    tool := need_tool(p_world, p_uid, 'mallet');
    if tool is not null then return tool; end if;
    if b.id is null then return 'No building here.'; end if;
    lvl := frame_wall_level(p_world, tx, ty, p_target);  -- Frame: a jetty's storey, or round a terrace.
    -- Piers: and on the ground floor of a tile on piers, which is its deck.
    if lvl > 0 or on_piers(p_world, tx, ty) then
      select * into f from floor_tile where world_id = p_world and level = lvl and x = tx and y = ty;
      if not found or not bill_done(f.needed) then return 'Build the floor of this storey first.'; end if;
    end if;
    -- Frame: and on the job's storey.
    if (frame_wall_at(p_world, tx, ty, side, p_target)).world_id is not null then return 'There is already a wall on that side.'; end if;
    -- A shop counter faces the street from the ground floor (`counters.ts`).
    if wt.id = 'counter' then
      v_gap := counter_plan_refusal(p_world, lvl, tx, ty, side);
      if v_gap is not null then return v_gap; end if;
    end if;
    -- Nor does a wall close over a lantern post's arm (`lamps.ts`).
    v_gap := lamp_wall_refusal(p_world, lvl, tx, ty, side, wt.id);
    if v_gap is not null then return v_gap; end if;
    /*
     * And what is underneath has to carry it. The courses below are what hold
     * a wall up, and a beginner finds that out by being told rather than by
     * watching it come down.
     */
    -- Piers: and a building on piers stands on its decks, which carry what they are laid in (`deck_carries`).
    v_gap := case when b.deck is not null then deck_carries(p_world, b.id, mat.id) end;
    if v_gap is not null then return v_gap; end if;
    bears := coalesce(bearing(p_world, b.id, lvl), 9);
    if mat.heft > bears then
      return mat.name || ' is too heavy to raise over what is under it. This storey carries '
          || heft_word(bears) || ', no more.';
    end if;
    -- gates: a portcullis in stone on the ground floor; a hidden door is planned as a solid wall.
    return gate_plan_refusal(p_world, p_uid, wt.id, mat.id, lvl, building_at(p_world, tx, ty) is null);

  elsif p_action = 'plan_fence' then
    if side is null or wt.id is null or mat.id is null then return 'Choose a side, a kind and a material.'; end if;
    if not wt.standalone then return 'Only fences and half walls stand on their own.'; end if;
    tool := need_tool(p_world, p_uid, mat.tool);
    if tool is not null then return tool; end if;
    if b.id is not null then return 'That is part of a building: plan a wall instead.'; end if;
    select * into other from across(tx, ty, side);
    -- The border is shared, so the tile on the other side of it has a say.
    if building_at(p_world, other.x, other.y) is not null then return 'A building stands on the other side of that border.'; end if;
    if not in_bounds(p_world, other.x, other.y) then return 'That border is the edge of the world.'; end if;
    if has_water(p_world, tx, ty) or has_water(p_world, other.x, other.y) then return 'Fences do not stand in water.'; end if;
    if not passable(p_world, tx, ty) or not passable(p_world, other.x, other.y) then return 'There is no room for posts there.'; end if;
    if exists (select 1 from border_of(tx, ty, side) bd
               join wall w2 on w2.world_id = p_world and w2.level = 0
                 and w2.dir = bd.dir and w2.x = bd.x and w2.y = bd.y) then
      return 'There is already something on that border.';
    end if;
    return null;

  elsif p_action in ('build_wall', 'remove_wall') then
    if side is null then return 'Choose a side.'; end if;
    w := frame_wall_at(p_world, tx, ty, side, p_target);  -- Frame: on the job's storey.
    if p_action = 'remove_wall' then
      -- And a shop counter comes down empty, till and all (`counters.ts`).
      -- gates: and a padlock on a portcullis keeps it from being taken down as from being worked; a hidden
      -- door answers as the solid wall it is to whoever it does not admit, which is nothing (`gateRemoveRefusal`).
      return case when w.world_id is null then 'There is no wall there.'
                  else coalesce(counter_remove_refusal(p_world, w),
                                case when w.type = 'portcullis' then lock_refusal(p_world, p_uid, w.lock, w.x, w.y) end) end;
    end if;
    if w.world_id is null then return 'There is no wall planned there.'; end if;
    if bill_done(w.needed) then return 'That wall is finished.'; end if;
    -- Nor is one raised over a lantern post's arm (`lamps.ts`).
    v_gap := lamp_wall_refusal(p_world, w.level, tx, ty, side, w.type);
    if v_gap is not null then return v_gap; end if;
    select * into mat from build_material_def where id = w.material;
    if mat.id is not null then
      tool := need_tool(p_world, p_uid, mat.tool);
      if tool is not null then return tool; end if;
    end if;
    if next_material(p_world, p_uid, w.material, w.needed, tx, ty) is null then
      return 'You need ' || bill_text(w.material, w.needed) || '.';
    end if;
    return null;

  elsif p_action = 'add_floor' then
    tool := need_tool(p_world, p_uid, 'mallet');
    if tool is not null then return tool; end if;
    if b.id is null then return 'No building here.'; end if;
    -- A Mason's Tall Walls: stone stands higher in a building they planned.
    if b.levels >= max_levels()::int + tall_of(p_world, b.id) then
      return 'Buildings cannot be taller than ' || (max_levels()::int + tall_of(p_world, b.id)) || ' storeys.';
    end if;
    /*
     * And no taller than what it is made of will stand. The shortest material
     * in the whole building answers, not the one you are standing on: a plank
     * wing joined to a stone tower caps the tower.
     */
    cap := storey_cap(p_world, b.id);
    if b.levels >= cap then
      worst := storey_capper(p_world, b.id);
      return coalesce(worst.name, 'What this is built of') || ' will not stand '
          || (cap + 1) || ' storeys. ' || cap || ' is as high as it goes.';
    end if;
    -- And the hands to raise it: ten a storey in the trade of the one below.
    under := storey_material(p_world, b.id, b.levels - 1);
    -- Past the tenth storey, which only Tall Walls reaches, a hundred is as much as there is.
    if under.id is not null and skill_of(p_world, p_uid, under.skill) < least(100, b.levels * storey_skill()) then
      return 'Raising a ' || (b.levels + 1) || nth(b.levels + 1) || ' storey over '
          || lower(under.name) || ' takes ' || under.skill || ' '
          || least(100, b.levels * storey_skill()) || '. You have '
          || to_char(skill_of(p_world, p_uid, under.skill), 'FM990.0') || '.';
    end if;
    if has_roof(p_world, b.id) then return 'Take the roof off first.'; end if;
    if has_low_wall(p_world, b.id, b.levels - 1) then
      -- Frame: a railing is low work too, and columns close a side.
      return 'Nothing rests on a fence, a half wall or a railing: the storey below needs walls, or finished columns at both ends of every open side.';
    end if;
    v_gap := level_gap(p_world, b.id, b.levels - 1, p_uid);
    if v_gap is not null then return v_gap; end if;
    return null;

  elsif p_action = 'plan_floor' then
    if mat.id is null then return 'Choose a material.'; end if;
    tool := need_tool(p_world, p_uid, 'mallet');
    if tool is not null then return tool; end if;
    if b.id is null then return 'No building here.'; end if;
    kind := coalesce(p_target->>'floorKind', 'floor');
    lvl := frame_floor_level(p_world, b.id, kind, p_target); -- cellar: storey nought for a flight down; Frame: else the job's storey.
    if kind = 'roof' then
      v_gap := level_gap(p_world, b.id, b.levels - 1, p_uid);
      if v_gap is not null then return v_gap; end if;
    elsif kind in ('stairs', 'ladder') then
      -- cellar: on the ground floor, a way down to the cellar under it.
      if lvl < 1 then
        -- Frame: not a way down, so a way up: in a building with a storey over the ground, that storey to work on.
        if (cellar_at(p_world, tx, ty)).world_id is null and not coalesce((p_target->>'down')::boolean, false) and b.levels > 1 then
          return 'Work on storey 2 or above to plan ' || case when kind = 'ladder' then 'a ladder' else 'stairs' end || ' here.';
        end if;
        v_gap := cellar_flight_refusal(p_world, b.id, tx, ty, side, coalesce((p_target->>'down')::boolean, false));
        if v_gap is not null then return v_gap; end if;
      end if;
      if side is null then return 'Choose the side to climb from.'; end if;
      -- Piers: a flight or a ladder up from a tile on piers stands on its deck.
      if (lvl > 1 or on_piers(p_world, tx, ty)) and not exists (select 1 from floor_tile where world_id = p_world
          and level = lvl - 1 and x = tx and y = ty) then
        return 'Plan the floor of the storey below first.';
      end if;
      -- cellar: one way off the ground floor a tile: a flight up and a flight down are not stacked on it.
      v_gap := cellar_stack_refusal(p_world, lvl, tx, ty); -- cellar
      if v_gap is not null then return v_gap; end if; -- cellar
    end if;
    -- cellar: a flight or a ladder down takes up the ground floor's flooring where it goes (`flooringUnder`).
    if exists (select 1 from floor_tile f2 where f2.world_id = p_world and f2.level = lvl and f2.x = tx and f2.y = ty
                 and not (lvl = 0 and f2.kind = 'floor' and p_target->>'floorKind' in ('stairs', 'ladder'))) then -- cellar
      return case when kind = 'roof' then 'There is already roof planned here.'
                  else 'There is already a floor planned here.' end;
    end if;
    -- Piers: a deck on piers carries what it is laid in, and the building on it is as heavy as its heaviest wall (`deck_bears`).
    if lvl = 0 and kind = 'floor' and on_piers(p_world, tx, ty) then return deck_bears(p_world, b.id, mat.id); end if;
    return null;

  elsif p_action in ('build_floor', 'remove_floor') then
    if b.id is null then return case when p_action = 'build_floor'
      then 'There is nothing planned here.' else 'No building here.' end; end if;
    kind := coalesce(p_target->>'floorKind', 'floor');
    lvl := frame_floor_level(p_world, b.id, kind, p_target); -- cellar; Frame: on the job's storey.
    select * into f from floor_tile where world_id = p_world and level = lvl and x = tx and y = ty;
    if p_action = 'remove_floor' then
      if not found then return 'There is nothing here to remove.'; end if;
      -- cellar: a flight down is let into the ground floor, and the walls round it stand on the ground;
      -- cellar: and a way down is a way up too, for whoever is down there.
      if lvl = 0 and f.kind in ('stairs', 'ladder') then -- cellar
        if (cellar_at(p_world, tx, ty)).world_id is not null and cellar_occupied(p_world, b.id) then -- cellar
          return 'Somebody is down in the cellar, and this is a way up out of it.'; -- cellar
        end if; -- cellar
        return null; -- cellar
      end if; -- cellar
      if f.kind <> 'roof' and exists (
          select 1 from (values ('n'), ('e'), ('s'), ('w')) as s(side)
          cross join lateral border_of(tx, ty, s.side) bd
          join wall w2 on w2.world_id = p_world and w2.level = lvl
            and w2.dir = bd.dir and w2.x = bd.x and w2.y = bd.y) then
        return 'Take down the walls standing on it first.';
      end if;
      -- Piers: a deck holds up whatever stands or lies on it, and whoever is taking it up (`deck_refusal`).
      v_gap := deck_refusal(p_world, p_uid, lvl, tx, ty);
      if v_gap is not null then return v_gap; end if;
      return null;
    end if;
    if not found then return 'There is nothing planned here.'; end if;
    if bill_done(f.needed) then return 'That is already finished.'; end if;
    select * into mat from build_material_def where id = f.material;
    tool := need_tool(p_world, p_uid, case when f.kind = 'ladder' then 'mallet' else mat.tool end);
    if tool is not null then return tool; end if;
    if next_material(p_world, p_uid, f.material, f.needed, tx, ty) is null then
      return 'You need ' || bill_text(f.material, f.needed) || '.';
    end if;
    return null;

  elsif p_action in ('paint_wall', 'strip_wall_paint') then
    if side is null then return 'Choose a side.'; end if;
    w := frame_wall_at(p_world, tx, ty, side, p_target);  -- Frame: on the job's storey.
    if w.world_id is null then return 'There is no wall there.'; end if;
    if p_action = 'strip_wall_paint' then
      if w.dye is null then return 'It has taken no colour.'; end if;
      if pack_count(p_world, p_uid, 'lye_bucket') <= 0 then return 'You need a bucket of lye to scrub it back.'; end if;
      return null;
    end if;
    if not bill_done(w.needed) then return 'Finish it before you paint it.'; end if;
    pot := pick_dye(p_world, p_uid);
    if pot.id is null then return 'You have no dye. Boil one out of berries, acorns or herbs with a bucket of lye.'; end if;
    select * into colour from dye_def where name = pot.extra;
    if w.dye = colour.id then return 'It is ' || colour.word || ' already.'; end if;
    return null;

  elsif p_action = 'paint_floor' then
    if b.id is null then return 'There is no floor here.'; end if;
    lvl := frame_job_level(b, p_target);  -- Frame: on the job's storey.
    select * into f from floor_tile where world_id = p_world and level = lvl and x = tx and y = ty;
    if not found then return 'There is no floor here.'; end if;
    if not bill_done(f.needed) then return 'Finish it before you paint it.'; end if;
    pot := pick_dye(p_world, p_uid);
    if pot.id is null then return 'You have no dye. Boil one out of berries, acorns or herbs with a bucket of lye.'; end if;
    select * into colour from dye_def where name = pot.extra;
    if f.dye = colour.id then return 'It is ' || colour.word || ' already.'; end if;
    return null;

  /*
   * A Mason's Repoint, in the browser's words: a finished wall of stone, a
   * stone to lay it in that is not what it is, and everything to hand -- and
   * what is under it has to carry the new stone and the new stone what stands
   * on it, and stand as many storeys as the building has.
   */
  elsif p_action = 'repoint_wall' then
    if pk(p_world, p_uid, 'repoint', 0) <= 0 then return 'That wants a Mason who has learned to repoint.'; end if;
    if side is null then return 'Choose a side.'; end if;
    w := frame_wall_at(p_world, tx, ty, side, p_target);  -- Frame: on the job's storey.
    if w.world_id is null then return 'There is no wall there.'; end if;
    select * into v_was from build_material_def where id = w.material;
    if v_was.kind is distinct from 'stone' then return 'Only a wall of stone is repointed.'; end if;
    if not bill_done(w.needed) then return 'Finish it before you repoint it.'; end if;
    if mat.id is null or mat.kind <> 'stone' then return 'Choose the stone to lay it in.'; end if;
    if mat.id = v_was.id then return 'It is ' || lower(mat.name) || ' already.'; end if;
    tool := need_tool(p_world, p_uid, mat.tool);
    if tool is not null then return tool; end if;
    if b.id is not null and w.building = b.id then
      -- Piers: a building on piers stands on its decks, which carry what they are laid in (`deck_carries`).
      v_gap := case when b.deck is not null then deck_carries(p_world, b.id, mat.id) end;
      if v_gap is not null then return v_gap; end if;
      bears := bearing(p_world, b.id, w.level);
      if mat.heft > bears then
        return mat.name || ' is too heavy to raise over what is under it. This storey carries '
            || heft_word(bears) || ', no more.';
      end if;
      select max(m2.heft) into v_over from wall w2 join build_material_def m2 on m2.id = w2.material
       where w2.world_id = p_world and w2.building = b.id and w2.level > w.level;
      if mat.heft < coalesce(v_over, 0) then
        return mat.name || ' will not carry the ' || heft_word(v_over) || ' standing on it.';
      end if;
      v_stands := mat.storeys + floor(pk(p_world, p_uid, 'storeys:' || build_work(mat.kind), 0))::int;
      if b.levels > v_stands then
        return mat.name || ' will not stand ' || b.levels || ' storeys. ' || v_stands || ' is as high as it goes.';
      end if;
    end if;
    v_bill := scaled_bill(mat.id, coalesce((select t2.factor::text::float8 from wall_type_def t2 where t2.id = w.type), 1));
    if exists (select 1 from jsonb_each_text(v_bill) e
                where build_to_hand(p_world, p_uid, e.key, tx, ty, mat.id) < e.value::int) then
      return 'You need ' || bill_text(mat.id, v_bill) || '.';
    end if;
    return null;

  elsif p_action = 'remove_storey' then
    if b.id is null or b.levels <= 1 then return 'There is no upper storey.'; end if;
    lvl := b.levels - 1;
    if has_roof(p_world, b.id) then return 'Take the roof off first.'; end if;
    if exists (select 1 from wall where world_id = p_world and building = b.id and level = lvl) then
      return 'Take down the walls of the top storey first.';
    end if;
    if exists (select 1 from floor_tile where world_id = p_world and building = b.id and level = lvl) then
      return 'Tear up the floors of the top storey first.';
    end if;
    return null;
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.perform_building(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare shape text; pot item; colour dye_def; tx int; ty int; side text; b building; w wall; f floor_tile; mat build_material_def;
        wt wall_type_def; lvl int; kind text; used text; nm text;
        sk text; bill jsonb; other record; what text; new_id int;
        v_laid text[]; v_i int; v_stone text; v_back int; v_was build_material_def; v_total jsonb;
        v_gate text; -- gates: what a solid wall asked for as a hidden door says, on the end of its plan's line
begin
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  side := p_target->>'side';
  select * into b from building where world_id = p_world and id = building_at(p_world, tx, ty);
  -- Frame: a storey job out past the footprint is for the building it names, and columns are frame's (`perform_frame`).
  b := frame_building(p_world, p_action, p_target, b);
  if frame_action(p_action) then perform perform_frame(p_world, p_uid, p_action, p_target, b); return; end if;

  if p_action = 'plan_building' then
    nm := left(coalesce(nullif(btrim(coalesce(p_target->>'name', '')), ''), 'House'), 32);
    select coalesce(max(id), 0) + 1 into new_id from building where world_id = p_world;
    insert into building (world_id, id, name, planned_by) values (p_world, new_id, nm, p_uid);
    insert into building_tile (world_id, building, x, y) values (p_world, new_id, tx, ty);
    -- Piers: on piers, where the ground is not level (`stand_on_piers`).
    perform tell(p_world, p_uid, coalesce(stand_on_piers(p_world, p_uid, new_id, tx, ty, true),
      'You plan ' || nm || ' here. Extend it onto neighbouring flat packed '
      || 'tiles, then plan walls on its borders.'), 'event');

  elsif p_action = 'add_to_building' then
    select * into b from building where world_id = p_world and id = neighbour_building(p_world, tx, ty);
    if not found then return; end if;
    insert into building_tile (world_id, building, x, y) values (p_world, b.id, tx, ty)
      on conflict do nothing;
    -- Piers: under its deck, where the ground is not level with its floor (`stand_on_piers`).
    perform tell(p_world, p_uid, coalesce(stand_on_piers(p_world, p_uid, b.id, tx, ty, false),
      'You add the tile to ' || b.name || '.'), 'event');

  elsif p_action = 'remove_from_plan' then
    if b.id is null then return; end if;
    delete from building_tile where world_id = p_world and x = tx and y = ty;
    if exists (select 1 from building_tile where world_id = p_world and building = b.id) then
      perform tell(p_world, p_uid, 'You remove the tile from ' || b.name || '.', 'event');
    else
      -- The last tile of a plan is the plan.
      delete from building where world_id = p_world and id = b.id;
      perform tell(p_world, p_uid, 'You remove the last of ' || b.name || '''s plan.', 'event');
    end if;

  elsif p_action = 'rename_building' then
    if b.id is null then return; end if;
    nm := left(btrim(p_target->>'name'), 32);
    update building set name = nm where world_id = p_world and id = b.id;
    perform tell(p_world, p_uid, 'The building is now called ' || nm || '.', 'event');

  elsif p_action in ('plan_wall', 'plan_fence') then
    select * into wt from wall_type_def where id = p_target->>'wallType';
    select * into mat from build_material_def where id = p_target->>'material';
    lvl := case when p_action = 'plan_fence' then 0 else frame_wall_level(p_world, tx, ty, p_target) end;  -- Frame: a jetty's storey, or round a terrace.
    -- A fence, a gate or a half wall for less of its material: a Carpenter's Fence Builder.
    bill := wall_bill(mat.id, wt.id, case when wt.standalone then pk(p_world, p_uid, 'bill:fence', 1) else 1 end);
    insert into wall (world_id, level, dir, x, y, building, type, material, needed, total, planned_by)
    select p_world, lvl, bd.dir, bd.x, bd.y,
           case when p_action = 'plan_fence' then 0 else b.id end,
           wt.id, mat.id, bill, bill, p_uid
    from border_of(tx, ty, side) bd;
    if p_action = 'plan_fence' then
      perform tell(p_world, p_uid, 'You mark out a ' || lower(mat.name) || ' ' || lower(wt.name)
        || ' on the ' || side_name(side) || ' border. It needs ' || bill_text(mat.id, bill) || '.', 'event');
    else
      -- gates: a solid wall asked for beforehand as a hidden door takes its padlock and hinges now and cuts its key,
      -- and says so on the end of the plan's own line, so that its plan writes one line as a solid wall's does
      -- (`perform_gate_plan`), on the storey the wall was planned on; and a wall of any other type is named as the
      -- thing it is, a railing as one, as the frame batch has it (`plan_line`).
      v_gate := perform_gate_plan(p_world, p_uid, p_target, lvl);
      perform tell(p_world, p_uid, plan_line(wt.id, mat.id, side) || ' It needs ' || bill_text(mat.id, bill) || '.'
        || coalesce(' ' || v_gate, ''), 'event');
    end if;

  elsif p_action = 'build_wall' then
    w := frame_wall_at(p_world, tx, ty, side, p_target);  -- Frame: on the job's storey.
    if w.world_id is null or bill_done(w.needed) then return; end if;
    select * into mat from build_material_def where id = w.material;
    -- A unit a go, or as many as a Mason's Two at a Time lays on stone.
    bill := w.needed;
    v_laid := '{}';
    for v_i in 1 .. greatest(1, floor(pk(p_world, p_uid, 'lay:' || build_work(mat.kind), 1))::int) loop
      exit when bill_done(bill);
      used := next_material(p_world, p_uid, w.material, bill, tx, ty);
      exit when used is null or not take_material(p_world, p_uid, used, tx, ty, w.material);
      bill := jsonb_set(bill, array[used], to_jsonb((bill->>used)::int - 1));
      v_laid := v_laid || used;
    end loop;
    if coalesce(array_length(v_laid, 1), 0) = 0 then return; end if;
    update wall set needed = bill where world_id = w.world_id and level = w.level
      and dir = w.dir and x = w.x and y = w.y;
    -- A shop counter's store opens as it is finished (`counters.ts`).
    if bill_done(bill) then perform counter_finished(p_world, w); end if;
    perform skill_raise(p_world, p_uid, mat.skill, 0.4);
    select * into wt from wall_type_def where id = w.type;
    if bill_done(bill) then
      what := case when wt.low then lower(wt.name) else 'wall' end;
      perform tell(p_world, p_uid, 'You finish the ' || lower(mat.name) || ' ' || what || '.', 'event');
    else
      perform tell(p_world, p_uid, 'You fit ' || laid_text(v_laid) || ' into the wall. Still needed: '
        || bill_text(w.material, bill) || '.', 'event');
    end if;

  elsif p_action = 'remove_wall' then
    w := frame_wall_at(p_world, tx, ty, side, p_target);  -- Frame: on the job's storey.
    if w.world_id is null then return; end if;
    select * into wt from wall_type_def where id = w.type;
    select * into mat from build_material_def where id = w.material;
    -- A Mason's Salvage: a share of the stone laid in it -- the first thing on
    -- its material's bill, not the mortar -- rounded down.
    v_stone := (select b2.item from build_material_bill b2 where b2.material = w.material order by b2.ord limit 1);
    v_back := floor(greatest(0, coalesce((w.total->>v_stone)::int, 0) - coalesce((w.needed->>v_stone)::int, 0))
                    * pk(p_world, p_uid, 'salvage:' || build_work(mat.kind), 0))::int;
    perform counter_gone(p_world, w);
    delete from wall where world_id = w.world_id and level = w.level and dir = w.dir and x = w.x and y = w.y;
    if v_back > 0 then perform give(p_world, p_uid, v_stone, v_back, 20); end if;
    perform tell(p_world, p_uid, 'You take down the '
      || case when wt.low then lower(wt.name) else 'wall' end
      || ' on the ' || side_name(side) || ' side'
      || case when v_back > 0 then ' and save ' || v_back || ' ' || material_name(v_stone, v_back) else '' end
      || '.', 'event');

  /*
   * A Mason's Repoint: a finished stone wall laid again in another stone, in
   * one go. The new stone's bill without the fittings is paid out of whatever
   * a wall may be built out of, the fittings stay, a share of the old stone
   * comes back, and the paint goes with the old face. `build_refusal` has
   * already asked that every unit of it is to hand.
   */
  elsif p_action = 'repoint_wall' then
    w := frame_wall_at(p_world, tx, ty, side, p_target);  -- Frame: on the job's storey.
    select * into mat from build_material_def where id = p_target->>'material';
    select * into v_was from build_material_def where id = w.material;
    if w.world_id is null or mat.id is null or v_was.id is null then return; end if;
    bill := scaled_bill(mat.id, coalesce((select t2.factor::text::float8 from wall_type_def t2 where t2.id = w.type), 1));
    for other in select e.key, e.value::int as n from jsonb_each_text(bill) e loop
      for v_i in 1 .. other.n loop
        if not take_material(p_world, p_uid, other.key, tx, ty, mat.id) then return; end if;
      end loop;
    end loop;
    v_stone := (select b2.item from build_material_bill b2 where b2.material = v_was.id order by b2.ord limit 1);
    v_back := floor(coalesce((w.total->>v_stone)::int, 0) * repoint_back())::int;
    if v_back > 0 then perform give(p_world, p_uid, v_stone, v_back, 20); end if;
    v_total := wall_bill(mat.id, w.type);
    update wall set material = mat.id, total = v_total, dye = null,
           needed = (select jsonb_object_agg(k, 0) from jsonb_object_keys(v_total) k)
     where world_id = w.world_id and level = w.level and dir = w.dir and x = w.x and y = w.y;
    perform skill_raise(p_world, p_uid, 'masonry', 1);
    perform tell(p_world, p_uid, 'You take the ' || lower(v_was.name) || ' out of the wall on the '
      || side_name(side) || ' side and lay it again in ' || lower(mat.name)
      || case when v_back > 0 then ', and save ' || v_back || ' ' || material_name(v_stone, v_back) else '' end
      || '.', 'event');

  elsif p_action = 'add_floor' then
    if b.id is null then return; end if;
    update building set levels = levels + 1, work_level = levels
      where world_id = p_world and id = b.id returning * into b;
    perform tell(p_world, p_uid, 'You plan storey ' || b.levels || ' of ' || b.name
      || '. Plan and build its floor tiles, then raise walls on them.', 'event');

  elsif p_action = 'plan_floor' then
    if b.id is null then return; end if;
    kind := coalesce(p_target->>'floorKind', 'floor');
    lvl := frame_floor_level(p_world, b.id, kind, p_target); -- cellar: storey nought for a flight down; Frame: else the job's storey.
    select * into mat from build_material_def where id = p_target->>'material';
    /*
     * A building has one roof, so the first tile of it decides the shape and
     * the rest follow. Changing your mind means taking the roof off, which is
     * what changing your mind about a roof means anywhere.
     */
    if kind = 'roof' and (select roof from building where world_id = p_world and id = b.id) is null then
      update building set roof = coalesce(
          (select id from roof_shape_def where id = p_target->>'roofShape'), 'hip')
        where world_id = p_world and id = b.id;
    end if;
    shape := roof_shape_of(p_world, b.id);
    bill := floor_bill(mat.id, kind, shape);
    -- Piers: and the piers under a deck (`deck_bill`).
    bill := deck_bill(p_world, tx, ty, lvl, kind, mat.id, bill);
    -- cellar: a flight or a ladder down takes up the ground floor's flooring where it goes.
    if lvl = 0 and kind in ('stairs', 'ladder') then -- cellar
      delete from floor_tile where world_id = p_world and level = 0 and x = tx and y = ty and floor_tile.kind = 'floor'; -- cellar
      if found then perform tell(p_world, p_uid, 'You take up the flooring there.', 'event'); end if; -- cellar
    end if; -- cellar
    insert into floor_tile (world_id, level, x, y, building, material, kind, facing, needed, total, planned_by)
    values (p_world, lvl, tx, ty, b.id, mat.id, kind,
            case when kind in ('stairs', 'ladder') then side end, bill, bill, p_uid);
    perform tell(p_world, p_uid, 'You plan a '
      || case when kind = 'ladder' then 'ladder'
              else case when kind = 'roof'
                        then lower((select name from roof_shape_def where id = shape)) || ' ' else '' end
                   -- Piers: a deck on piers (`floor_kind_said`).
                   || lower(mat.name) || ' ' || floor_kind_said(p_world, tx, ty, lvl, kind) end
      || '. It needs ' || bill_text(mat.id, bill) || '.', 'event');

  elsif p_action = 'build_floor' then
    if b.id is null then return; end if;
    kind := coalesce(p_target->>'floorKind', 'floor');
    lvl := frame_floor_level(p_world, b.id, kind, p_target); -- cellar: storey nought for a flight down; Frame: else the job's storey.
    select * into f from floor_tile where world_id = p_world and level = lvl and x = tx and y = ty;
    if not found or bill_done(f.needed) then return; end if;
    select * into mat from build_material_def where id = f.material;
    -- A unit a go, or as many as a Mason's Two at a Time lays on stone.
    bill := f.needed;
    v_laid := '{}';
    for v_i in 1 .. greatest(1, floor(pk(p_world, p_uid, 'lay:' || build_work(mat.kind), 1))::int) loop
      exit when bill_done(bill);
      used := next_material(p_world, p_uid, f.material, bill, tx, ty);
      exit when used is null or not take_material(p_world, p_uid, used, tx, ty, f.material);
      bill := jsonb_set(bill, array[used], to_jsonb((bill->>used)::int - 1));
      v_laid := v_laid || used;
    end loop;
    if coalesce(array_length(v_laid, 1), 0) = 0 then return; end if;
    update floor_tile set needed = bill where world_id = p_world and level = lvl and x = tx and y = ty;
    -- Floors are paving; stairs, ladders and roofs are carpentry or masonry by material.
    sk := case f.kind when 'floor' then 'paving' when 'ladder' then 'carpentry'
                      else coalesce(mat.skill, 'carpentry') end;
    perform skill_raise(p_world, p_uid, sk, 0.4);
    what := case when f.kind = 'ladder' then 'ladder' else lower(mat.name) || ' ' || floor_kind_name(f.kind) end;
    if bill_done(bill) then
      perform tell(p_world, p_uid, 'You finish the ' || what || '.', 'event');
    else
      perform tell(p_world, p_uid, 'You work ' || laid_text(v_laid) || ' into the '
        || floor_kind_name(f.kind) || '. Still needed: ' || bill_text(f.material, bill) || '.', 'event');
    end if;

  elsif p_action = 'remove_floor' then
    if b.id is null then return; end if;
    kind := coalesce(p_target->>'floorKind', 'floor');
    lvl := frame_floor_level(p_world, b.id, kind, p_target); -- cellar: storey nought for a flight down; Frame: else the job's storey.
    select * into f from floor_tile where world_id = p_world and level = lvl and x = tx and y = ty;
    if not found then return; end if;
    delete from floor_tile where world_id = p_world and level = lvl and x = tx and y = ty;
    -- Anybody standing on what was just torn up goes down a storey, not through it.
    if lvl > 0 then
      update player set level = lvl - 1
        where world_id = p_world and floor(x)::int = tx and floor(y)::int = ty and level >= lvl;
    end if;
    perform tell(p_world, p_uid, 'You remove the ' || floor_kind_name(f.kind) || '.', 'event');

  elsif p_action = 'paint_wall' then
    w := frame_wall_at(p_world, tx, ty, side, p_target);  -- Frame: on the job's storey.
    if w.world_id is null then return; end if;
    pot := pick_dye(p_world, p_uid);
    select * into colour from dye_def where name = pot.extra;
    if colour.id is null or not consume(p_world, p_uid, 'dye', 1) then return; end if;
    update wall set dye = colour.id where world_id = p_world and level = w.level
      and dir = w.dir and x = w.x and y = w.y;
    perform skill_raise(p_world, p_uid, 'alchemy', 0.3);
    perform tell(p_world, p_uid, 'You brush the ' || lower(colour.name) || ' over the wall on the '
      || side_name(side) || ' side. It comes up ' || colour.word || '.', 'event');

  elsif p_action = 'strip_wall_paint' then
    w := frame_wall_at(p_world, tx, ty, side, p_target);  -- Frame: on the job's storey.
    if w.world_id is null or w.dye is null then return; end if;
    select * into pot from item where world_id = p_world and holder = 'player'
      and holder_uid = p_uid and def = 'lye_bucket' order by id limit 1;
    if pot.id is null or not consume(p_world, p_uid, 'lye_bucket', 1) then return; end if;
    perform give(p_world, p_uid, 'bucket', 1, pot.ql);
    update wall set dye = null where world_id = p_world and level = w.level
      and dir = w.dir and x = w.x and y = w.y;
    perform skill_raise(p_world, p_uid, 'alchemy', 0.2);
    select * into mat from build_material_def where id = w.material;
    perform tell(p_world, p_uid, 'You scrub the wall back to bare '
      || coalesce(lower(mat.name), 'stone') || '.', 'event');

  elsif p_action = 'paint_floor' then
    if b.id is null then return; end if;
    lvl := frame_job_level(b, p_target);  -- Frame: on the job's storey.
    select * into f from floor_tile where world_id = p_world and level = lvl and x = tx and y = ty;
    if not found then return; end if;
    pot := pick_dye(p_world, p_uid);
    select * into colour from dye_def where name = pot.extra;
    if colour.id is null or not consume(p_world, p_uid, 'dye', 1) then return; end if;
    update floor_tile set dye = colour.id where world_id = p_world and level = lvl and x = tx and y = ty;
    perform skill_raise(p_world, p_uid, 'alchemy', 0.3);
    perform tell(p_world, p_uid, 'You work the ' || lower(colour.name)
      || ' into the boards. The floor comes up ' || colour.word || '.', 'event');

  elsif p_action = 'remove_storey' then
    if b.id is null or b.levels <= 1 then return; end if;
    update building set levels = levels - 1, work_level = levels - 2
      where world_id = p_world and id = b.id returning * into b;
    perform tell(p_world, p_uid, b.name || ' is back to '
      || case when b.levels = 1 then 'a single storey' else b.levels || ' storeys' end || '.', 'event');
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.rpc_ground(p_world uuid, p_range double precision DEFAULT 40, p_slow boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); p player; v_field double precision; v_box double precision;
        -- When greening came to this island (`greening.ts`).
        v_from timestamptz := (select w.green_from from world w where w.id = p_world);
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  select * into p from player where world_id = p_world and uid = me;
  if not found then raise exception 'you are not on this island'; end if;
  /*
   * On the slow half only, because this writes.
   *
   * The fast read runs about once a second per body — everything burning, what
   * is on the tile under you — and a settle on that path is an update a second
   * per player whether or not anything is due. The crops ride the slow half
   * beside the settlements, and any of your own work forces one of those, so
   * sowing is seen at once and a stage is at worst one reconcile late.
   */
  if p_slow then
    perform crops_settle(p_world, p.x, p.y, p_range);
    perform planters_settle(p_world, p.x, p.y, p_range);
    -- Each clock read once, for every crop on it.
    v_field := crop_clock(false, now());
    v_box := crop_clock(true, now());
  end if;
  return jsonb_build_object(
    'placed', coalesce((select jsonb_agg(
        (to_jsonb(pl) - 'world_id' - 'made_by' - 'since' - 'made_at' - 'cx' - 'cy' - 'crumbles_at')
        || jsonb_build_object('fuel', placed_fuel(pl), 'ash', placed_ash(pl),
                              'lit', placed_lit(pl), 'mine', coalesce(pl.made_by = me, false),
        /*
         * And what is in it, which this never said.
         *
         * Reported as "i opened it and dragged my dirt into it and the dirt
         * vanished". It had not: the island had the dirt in the bin and told
         * nobody. Every chest, bin, larder and cart on an island read as
         * empty over there, so anything put away went out of the pack and was
         * never seen again — the same hole a crate fell down before crates
         * carried their contents, and closed the same way. Within six tiles
         * only: you must be within two and a half to reach into one, so six
         * is generous, and a yard of full chests is not worth a phone's
         * second.
         */
                              'things', case when pl.kind = 'furniture'
                                              and greatest(abs(pl.cx - p.x), abs(pl.cy - p.y)) <= 6
                                              -- A grave's, to whoever lies under it and nobody else.
                                              and (pl.crumbles_at is null or pl.made_by = me)
                                then coalesce((select jsonb_agg(jsonb_build_object(
                                       'id', i.id, 'def', i.def, 'ql', i.ql, 'dmg', i.dmg,
                                       'count', i.count, 'extra', i.extra) order by i.id)
                                     from item i
                                     where i.world_id = p_world and i.holder = 'furniture' and i.placed = pl.id),
                                   '[]'::jsonb)
                                else '[]'::jsonb end)
        /*
         * Whether a helm is as good as empty, its holder gone away, and who is
         * aboard as a passenger and in which place: only for a piece that has
         * either, so nothing else carries two more keys it does not need.
         */
        || case when pl.driver is null then '{}'::jsonb
                else jsonb_build_object('helm_open', coalesce((select r.away from player r
                       where r.world_id = p_world and r.uid = pl.driver), true)) end
        || coalesce((select jsonb_build_object('riders', jsonb_agg(jsonb_build_object('uid', r.uid, 'seat', r.seat)
                       order by r.seat))
                     from player r where r.world_id = p_world and r.aboard = pl.id
                     having count(*) > 0), '{}'::jsonb)
        /*
         * And a grave: whose it is, for what anybody else is told when they
         * try it; the seconds it has left, which a browser counts down on its
         * own clock rather than reading this island's; and, to its owner, how
         * many things are in it, which `things` only says from within reach --
         * the way `units` rides beside a crate's contents.
         */
        || case when pl.crumbles_at is null then '{}'::jsonb
                else jsonb_build_object('grave', jsonb_build_object('name', grave_owner(pl),
                       'left', greatest(0, extract(epoch from (pl.crumbles_at - now()))),
                       'units', case when pl.made_by = me then (select coalesce(sum(i.count), 0) from item i
                                  where i.placed = pl.id and i.holder = 'furniture') end)) end
        /*
         * And for a piece with roses on it, the moment it was set down, which
         * is what its roses grow from (`roses.ts`): the same moment for
         * everybody, and sent for nothing else.
         */
        || case when coalesce((select fd.roses from furniture_def fd where fd.id = pl.sub), false)
                then jsonb_build_object('set', extract(epoch from pl.made_at)) else '{}'::jsonb end
        /*
         * And for a piece that gathers moss -- a statue -- the seconds since
         * the moss on it began: since it was set down or last scrubbed, and
         * never from before greening came in (`greening.ts`). Only for those,
         * so nothing else carries a key it does not need.
         */
        || case when pl.kind = 'furniture' and pl.sub in (select fd.id from furniture_def fd where fd.mossy)
                then jsonb_build_object('green_ago', green_ago(greatest(pl.made_at,
                       (select gs.since from green_since gs where gs.world_id = p_world and gs.thing = 'piece'
                           and gs.x = pl.x and gs.y = pl.y and gs.k = pl.id)), v_from))
                else '{}'::jsonb end
        -- And for a shop counter's store, what is set out on it and for whom (`counters.ts`).
        || case when pl.kind = 'counter' then counter_json(pl, me, p.x, p.y) else '{}'::jsonb end
        order by pl.id)
      from placed pl
      where pl.world_id = p_world
        -- The box first, in the whole tiles `placed_near` is keyed on, and then
        -- the exact question. A btree cannot look up a function of a column, so
        -- the exact test on its own read every placed thing on the island, on
        -- every ground poll, for every player. `x` is `floor(cx)` and `y` is
        -- `floor(cy)` -- `drag_along` and every placing write both together --
        -- so a tile of slack each way makes the box a superset of the answer
        -- and the line below still decides who is in it.
        and pl.x between floor(p.x - p_range)::int - 1 and floor(p.x + p_range)::int + 1
        and pl.y between floor(p.y - p_range)::int - 1 and floor(p.y + p_range)::int + 1
        and greatest(abs(pl.cx - p.x), abs(pl.cy - p.y)) <= p_range), '[]'::jsonb),
    'crates', crates_near(p_world, me, p_range),
    /*
     * And what is lying on the ground, which this never carried.
     *
     * Reported as "killed a roxxa, no corpse dropped to butcher, or at least
     * isn't displaying". The corpse was there: `wound_beast` drops one where
     * the thing fell, and the suite has measured it since kills were ported.
     * This sent the fires, the crates, the crops and the walls, and never a
     * thing lying on the grass — and the browser's map of the ground was only
     * ever written by its own rules, which do not run on an island. So a
     * corpse, a log a worker put down, a hatchet somebody else dropped: all
     * in this table and drawn by nobody.
     *
     * On the fast half, because a corpse is looked for the second the thing
     * goes down; `item_on_ground` serves the box. The whole row, the way the
     * pack is sent, so the browser reads it with the same map.
     */
    'lying', coalesce((select jsonb_agg(to_jsonb(i) - 'world_id' order by i.id)
      from item i
      where i.world_id = p_world and i.holder = 'ground'
        and i.gx between floor(p.x - p_range)::int and floor(p.x + p_range)::int
        and i.gy between floor(p.y - p_range)::int and floor(p.y + p_range)::int), '[]'::jsonb),
    -- cellar: and what is lying on the floors of the cellars in range, the same way (`item_in_cellar` serves the box).
    'cellarLying', coalesce((select jsonb_agg(to_jsonb(i) - 'world_id' order by i.id) from item i -- cellar
      where i.world_id = p_world and i.holder = 'cellar' -- cellar
        and i.gx between floor(p.x - p_range)::int and floor(p.x + p_range)::int -- cellar
        and i.gy between floor(p.y - p_range)::int and floor(p.y + p_range)::int), '[]'::jsonb))
  /*
   * And the half that hardly ever moves.
   *
   * A fire burns down and a kiln works through its load while you stand and
   * watch it, which is why this is asked for every second. A wall is not like
   * that: it goes up when somebody builds it and then it is a wall. Sending
   * both at one pace meant a correlated subquery over `building_tile` per
   * building, a scan of `wall` and one of `floor_tile`, every second for every
   * player, to say that the house is still a house.
   *
   * So the caller says whether it wants them. A browser asks for the lot on
   * its twenty-second reconcile and after any of its own work, and for the
   * burning half the rest of the time. Left out rather than emptied: the
   * browser applies only the keys it is given, so what it holds stands.
   *
   * `p_slow` defaults true, so a page that has not been redeployed gets
   * exactly what it always got.
   */
  || case when not p_slow then '{}'::jsonb else jsonb_build_object(
    /*
     * And everybody ashore, on the slow half, which is the beat that already
     * carries the settlements. The map draws them; `folk_ashore` decides
     * whether there is anything to draw them at.
     */
    'folk', folk_ashore(p_world, me),
    /*
     * And every grave of yours, however far off: you wake a long way from
     * where you fell, and `placed` above is only what is in range. The map
     * marks them and takes the mark up when one goes. Off the index the
     * sweep uses, which holds nothing but graves.
     */
    'graves', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'x', g.x, 'y', g.y) order by g.id)
      from placed g
      where g.world_id = p_world and g.crumbles_at is not null and g.made_by = me), '[]'::jsonb),
    /*
     * What is growing here, settled first so the stage reported is the stage
     * it is actually at rather than the stage it was at when somebody last
     * touched it. Everything on this island settles lazily off a timestamp,
     * and for a crop nobody had ever been the one to ask.
     *
     * `grown` rather than `stage_at`: how far into its stage it has grown, in
     * growing seconds on the clock it grows on, which the browser lays on its
     * own reading of the same clock -- a winter between the stage's start and
     * now adds nothing to it. `ago`, the wall seconds, is what a page from
     * before the year reads.
     */
    'crops', coalesce((select jsonb_agg(jsonb_build_object(
        'x', c.x, 'y', c.y, 'id', c.id, 'stage', c.stage,
        'grown', crop_grown(c.glass, c.stage_at, v_field),
        'ago', extract(epoch from (now() - c.stage_at)),
        'tended', c.tended, 'tendedNow', c.tended_now, 'ql', c.ql, 'pace', c.pace)
        -- And a crop under glass says so, and `grown` is on the glass clock (`glasshouse.ts`).
        || case when c.glass then '{"glass": true}'::jsonb else '{}'::jsonb end)
      from crop c
      where c.world_id = p_world
        and greatest(abs(c.x + 0.5 - p.x), abs(c.y + 0.5 - p.y)) <= p_range), '[]'::jsonb),
    -- And what grows in the planters, by the piece, on the planter's own clock.
    'planted', coalesce((select jsonb_agg(jsonb_build_object(
        'planter', c.placed, 'x', pl.x, 'y', pl.y, 'id', c.id, 'stage', c.stage,
        'grown', v_box - crop_clock(true, c.stage_at),
        'ago', extract(epoch from (now() - c.stage_at)),
        'tended', c.tended, 'tendedNow', c.tended_now, 'ql', c.ql, 'pace', c.pace) order by c.placed)
      from placed pl join planter_crop c on c.placed = pl.id
      where pl.world_id = p_world
        and pl.x between floor(p.x - p_range)::int - 1 and floor(p.x + p_range)::int + 1
        and pl.y between floor(p.y - p_range)::int - 1 and floor(p.y + p_range)::int + 1
        and greatest(abs(pl.cx - p.x), abs(pl.cy - p.y)) <= p_range), '[]'::jsonb),
    -- And the island's wall clock, which a field's clock is read off, so the browser reads it off the same one.
    'now', extract(epoch from now())::double precision,
    /*
     * The felling notches near you, and how long ago the woods last turned
     * over. Look reads both: "2 of 3 strokes in it", "the woods turn over in
     * 9 hours". A browser on an island keeps no clock of its own for the
     * woods, so this is the only place it hears the hour.
     */
    /*
     * The water lilies and lotus planted near you: when each was planted and
     * last picked, which is all of one. The browser works out the rest from
     * the year, as `water_plant_state` does.
     */
    'waterPlants', water_plants_near(p_world, p.x, p.y, p_range),
    'notches', coalesce((select jsonb_agg(jsonb_build_object('x', n.x, 'y', n.y, 'cuts', n.cuts))
      from tree_notch n
      where n.world_id = p_world
        and greatest(abs(n.x + 0.5 - p.x), abs(n.y + 0.5 - p.y)) <= p_range), '[]'::jsonb),
    'treesAgo', (select extract(epoch from (now() - w.trees_at)) from world w where w.id = p_world),
    -- The mark the ground is being worked to, which lives on the player row
    -- so that it is the same mark in every browser you open.
    'level', p.level_h,
    -- What you are on each of them, so the browser can say what you may do
    -- rather than finding out by being refused. Your own first one is your
    -- own or one you were asked onto; either way `deed_role` says which.
    'deed', (select jsonb_build_object(
        'name', d.name, 'x', d.x, 'y', d.y, 'radius', d.radius, 'level', d.level, 'mine', true,
        'role', deed_role(p_world, d.founded_by, me),
        'baubles', deed_baubles_json(p_world, d.founded_by))
      from my_deed(p_world, me) d where d.world_id is not null),
    'deeds', coalesce((select jsonb_agg(jsonb_build_object(
        'name', d.name, 'x', d.x, 'y', d.y, 'radius', d.radius, 'level', d.level,
        -- Land you were asked onto is land you may work, so it is drawn as
        -- yours rather than as a stranger's border you happen to be inside.
        'mine', exists (select 1 from deed_member m where m.world_id = p_world
                          and m.uid = me and m.founder = d.founded_by),
        'role', deed_role(p_world, d.founded_by, me),
        'holder', account_name(d.founded_by),
        -- And what is in its altar, for the settlements you are a citizen of.
        'baubles', case when exists (select 1 from deed_member m where m.world_id = p_world
                                       and m.uid = me and m.founder = d.founded_by)
                        then deed_baubles_json(p_world, d.founded_by) end) order by d.founded_at)
      from deed d
      where d.world_id = p_world and d.founded_by <> me
        and greatest(abs(d.x + 0.5 - p.x), abs(d.y + 0.5 - p.y)) <= p_range + d.radius),
      '[]'::jsonb),
    /*
     * And what is standing.
     *
     * `building`, `wall` and `floor_tile` have been kept here since buildings
     * were ported and have never been sent to anybody. The rules answered
     * about them, a plan went up in Postgres, and no browser ever drew a wall
     * of it — so on an island a building was invisible to everyone, the person
     * who planned it included.
     *
     * Shaped as the browser's own `BuildingsJSON`, so it is laid straight in.
     * A building comes along whole if any of its tiles is in range: half a
     * house is worse than none, and a house is a handful of rows.
     */
    'buildings', jsonb_build_object(
      -- cellar: what is dug out under the buildings sent (`BuildingsJSON.cellars`).
      'cellars', cellars_near(p_world, p.x, p.y, p_range),
      'nextId', coalesce((select max(b.id) + 1 from building b where b.world_id = p_world), 1),
      'list', coalesce((select jsonb_agg(jsonb_build_object(
          'id', b.id, 'name', b.name, 'levels', b.levels, 'workLevel', b.work_level,
          -- Frame: the shape of its roof, which says whether it is a terrace to rail.
          'roof', b.roof,
          'tiles', (select coalesce(jsonb_agg(bt.x || ',' || bt.y order by bt.y, bt.x), '[]'::jsonb)
                      from building_tile bt
                     where bt.world_id = p_world and bt.building = b.id))
          -- Piers: and its deck and its tiles on piers, if it has any (`piers_json`).
          || piers_json(p_world, b.id, b.deck) order by b.id)
        from building b
        where b.world_id = p_world
          and exists (select 1 from building_tile bt
                       where bt.world_id = p_world and bt.building = b.id
                         and greatest(abs(bt.x + 0.5 - p.x), abs(bt.y + 0.5 - p.y)) <= p_range)),
        '[]'::jsonb),
      'walls', coalesce((select jsonb_agg(jsonb_build_object(
          'building', w.building, 'level', w.level, 'x', w.x, 'y', w.y, 'dir', w.dir,
          -- gates: a hidden door its padlock does not admit is sent as the solid wall it looks like.
          'type', wall_seen_type(p_world, me, w), 'material', w.material, 'needed', w.needed, 'total', w.total,
          -- And the seconds since the ivy on a finished wall of stone or brick began (`greening.ts`).
          'greenAgo', case when bill_done(w.needed) and m.kind = 'stone' then green_ago(gs.since, v_from) end)
          -- gates: a portcullis let down, and a padlock this body may know of.
          || wall_gear(p_world, me, w)
          order by w.level, w.dir, w.x, w.y)
        from wall w
        left join build_material_def m on m.id = w.material
        left join green_since gs on gs.world_id = p_world and gs.thing = 'wall' and gs.x = w.x and gs.y = w.y
                                and gs.k = green_wall_k(w.level, w.dir)
        where w.world_id = p_world
          and greatest(abs(w.x + 0.5 - p.x), abs(w.y + 0.5 - p.y)) <= p_range), '[]'::jsonb),
      'floors', coalesce((select jsonb_agg(jsonb_build_object(
          'building', f.building, 'level', f.level, 'x', f.x, 'y', f.y,
          'material', f.material, 'kind', f.kind, 'facing', f.facing,
          'needed', f.needed, 'total', f.total) order by f.level, f.x, f.y)
        from floor_tile f
        where f.world_id = p_world
          and greatest(abs(f.x + 0.5 - p.x), abs(f.y + 0.5 - p.y)) <= p_range), '[]'::jsonb),
      -- Frame: the columns on the corners of its storeys.
      'columns', frame_columns_json(p_world, p.x, p.y, p_range)),
    /*
     * And the slabs, which are not buildings and do not go in with them: a
     * foundation is ground somebody poured, and the browser lays it beside the
     * terrain rather than inside a house.
     */
    'foundations', coalesce((select jsonb_agg(jsonb_build_object(
        'id', fo.id, 'x', fo.x, 'y', fo.y, 'top', fo.top, 'pool', fo.pool,
        'needed', fo.needed, 'total', fo.total,
        -- And the seconds since the moss on a poured one began.
        'greenAgo', case when bill_done(fo.needed) then green_ago(gs.since, v_from) end) order by fo.id)
      from foundation fo
      left join green_since gs on gs.world_id = p_world and gs.thing = 'slab' and gs.x = fo.x and gs.y = fo.y and gs.k = 0
      where fo.world_id = p_world
        and greatest(abs(fo.x + 0.5 - p.x), abs(fo.y + 0.5 - p.y)) <= p_range), '[]'::jsonb),
    'nextFoundationId', coalesce((select max(fo.id) + 1 from foundation fo where fo.world_id = p_world), 1),
    /*
     * And the bridges, shaped as the browser's own `Bridge`, spans and all.
     *
     * The island has kept `bridge` and `bridge_span` since bridges were ported
     * and never said a word about one, so on an island a bridge was drawn by
     * nobody and walked by nobody: the browser decides where its feet go, and
     * it had never heard of the deck. One comes whole if either end is in
     * range, and a stone arch with the seconds since the moss on it began.
     */
    'bridges', coalesce((select jsonb_agg(jsonb_build_object(
        'id', b.id, 'kind', b.kind, 'ax', b.ax, 'ay', b.ay, 'bx', b.bx, 'by', b.by,
        'height', b.height, 'level', b.level, 'material', b.material,
        'spans', (select coalesce(jsonb_agg(jsonb_build_object('x', s.x, 'y', s.y, 'needed', s.needed, 'total', s.total)
                    order by s.n), '[]'::jsonb)
                  from bridge_span s where s.world_id = p_world and s.bridge = b.id),
        'greenAgo', case when b.kind in ('stone', 'aqueduct') and not exists (select 1 from bridge_span s
                           where s.world_id = p_world and s.bridge = b.id and not span_done(s.needed))
                         then green_ago(gs.since, v_from) end)
        -- gates: a drawbridge drawn up, and the padlock on its winch.
        || bridge_gear(b) order by b.id)
      from bridge b
      left join green_since gs on gs.world_id = p_world and gs.thing = 'bridge' and gs.x = b.ax and gs.y = b.ay and gs.k = b.id
      where b.world_id = p_world
        and (greatest(abs(b.ax + 0.5 - p.x), abs(b.ay + 0.5 - p.y)) <= p_range
             or greatest(abs(b.bx + 0.5 - p.x), abs(b.by + 0.5 - p.y)) <= p_range)), '[]'::jsonb),
    /*
     * And the paving: the seconds since greening came in, which is when every
     * paved tile without a row of its own began, and the tiles in range paved
     * or scrubbed since, off the key's own box.
     */
    'greenFromAgo', extract(epoch from (now() - v_from))::double precision,
    'paving', coalesce((select jsonb_agg(jsonb_build_object('x', gs.x, 'y', gs.y, 'ago', green_ago(gs.since, v_from)))
      from green_since gs
      where gs.world_id = p_world and gs.thing = 'paving'
        and gs.x between floor(p.x - p_range)::int and floor(p.x + p_range)::int
        and gs.y between floor(p.y - p_range)::int and floor(p.y + p_range)::int), '[]'::jsonb)) end;
end $function$;

CREATE OR REPLACE FUNCTION public.in_deep_water(p_world uuid, p_uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  select case
    -- A bridge deck or a mine floor is not the ground, and not the water.
    when p.level <> 0 then false
    /*
     * The cheap question first: almost everybody, almost always, is on dry
     * ground. And coalesced, because `land_height` answers NULL for ground
     * nothing has been written for, a NULL guard matches no `when`, and the
     * `else` below is a yes — so an unread height used to mean *swimming*, and
     * a swimmer spends wind rather than getting it back. Fourteen checks of
     * the live run failed with "You are too exhausted to do that" and the body
     * never recovered, because there was nothing to recover from but this.
     */
    -- Out of your depth in a pond as much as in the sea: measured down from whichever water is here.
    when coalesce(water_bed(p_world, floor(p.x)::int, floor(p.y)::int), 0)
         >= water_surface(p_world, floor(p.x)::int, floor(p.y)::int) - swim_depth()
      then false
    /*
     * On stepping stones the feet are dry however deep the water beside them
     * is (`Player.update`). Asked only of a body already out of its depth,
     * which is nobody on dry ground: one read of the tile under it, and the
     * move and the standing checks ask nothing else of stones.
     */
    when land_tile(p_world, floor(p.x)::int, floor(p.y)::int) = tile_id('Stepping stones') then false
    -- A hull, a cart bed or a saddle: something else is holding you up.
    when exists (select 1 from placed q where q.world_id = p_world and q.driver = p_uid) then false
    -- A passenger stands on a deck.
    when p.aboard is not null then false
    when exists (select 1 from creature c where c.world_id = p_world and c.rider = p_uid) then false
    -- Piers: on the finished deck of a tile on piers, whatever is under it (`deck_surface`).
    when deck_surface(p_world, floor(p.x)::int, floor(p.y)::int) is not null then false
    -- A bridge's deck holds you up; an aqueduct's is water, and under it is the open water it stands in.
    -- gates: and a drawbridge drawn up holds nobody up either: `deck_at` leaves out both.
    else deck_at(p_world, floor(p.x)::int, floor(p.y)::int) is null
  end
  from player p where p.world_id = p_world and p.uid = p_uid
$function$;

CREATE OR REPLACE FUNCTION public.deck_at(p_world uuid, p_x integer, p_y integer)
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE
AS $function$
declare v bigint := bridge_at(p_world, p_x, p_y);
begin
  if v is null then return null; end if;
  -- gates: nor is a drawbridge drawn up: what is under it is what there is (`deckDown`).
  return case when (select b.kind = 'aqueduct' or b.raised from bridge b where b.world_id = p_world and b.id = v) then null else v end;
end $function$;

CREATE OR REPLACE FUNCTION public.bridge_reason(p_world uuid, p_uid uuid, p_kind text, p_ax integer, p_ay integer, p_bx integer, p_by integer)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare d bridge_def; n int; ha double precision; hb double precision; h int; r record; e record;
        la int; lb int;
begin
  select * into d from bridge_def where id = p_kind;
  if not found then return 'Choose what to build it out of.'; end if;
  if not in_bounds(p_world, p_ax, p_ay) or not in_bounds(p_world, p_bx, p_by) then return 'Not there.'; end if;
  if p_ax <> p_bx and p_ay <> p_by then
    return 'A bridge runs straight. Pick an end level with this one, north, south, east or west.';
  end if;
  select count(*)::int into n from span_tiles(p_ax, p_ay, p_bx, p_by);
  if n = 0 then return 'There is nothing between those two. Bridge a gap.'; end if;
  -- A Mason's Bridge Mason carries a stone arch further (`span:bridge_stone`).
  if n > pk(p_world, p_uid, 'span:' || ('bridge_' || p_kind), d.span)::int then
    return 'A ' || lower(d.name) || ' spans ' || pk(p_world, p_uid, 'span:' || ('bridge_' || p_kind), d.span)::int
        || ' tiles; that is ' || n || '.';
  end if;
  /*
   * And what each end lands on: a bank, a poured slab, or a finished floor of
   * a building — which is the new one, and the reason anybody builds a tower
   * and then wishes they had not.
   */
  la := top_deck(p_world, p_ax, p_ay);
  lb := top_deck(p_world, p_bx, p_by);
  for e in select * from (values (p_ax, p_ay, la), (p_bx, p_by, lb)) v(x, y, lvl) loop
    -- The bank of a ravine always shares a corner with the ravine, so what
    -- matters is whether you can stand in the middle of the tile, not whether
    -- every corner of it is dry.
    -- Piers: a deck on piers is landed on once it is built, and is dry, solid ground whatever is under it (`deck_surface`).
    if on_piers(p_world, e.x, e.y) and deck_surface(p_world, e.x, e.y) is null then
      return 'A bridge lands on a finished deck: build the deck at that end first.';
    end if;
    if e.lvl = 0 and slab_at(p_world, e.x, e.y) is null
       and deck_surface(p_world, e.x, e.y) is null  -- Piers
       and (not passable(p_world, e.x, e.y) or centre_height(p_world, e.x, e.y) < 0) then
      return 'Both ends want dry, solid ground to stand on.';
    end if;
    if bridge_at(p_world, e.x, e.y) is not null then return 'One end is already under a bridge.'; end if;
  end loop;
  -- gates: not from inside a ground floor nor through a wall, and a drawbridge outside at both ends.
  if bridge_end_refusal(p_world, p_uid, p_kind, p_ax, p_ay, p_bx, p_by, la, lb) is not null then
    return bridge_end_refusal(p_world, p_uid, p_kind, p_ax, p_ay, p_bx, p_by, la, lb);
  end if;
  -- gates: a drawbridge goes from bank to bank: its hinge and its winch stand on the ground.
  if d.grounded and (la <> 0 or lb <> 0) then
    return 'A ' || lower(d.name) || ' goes from ground to ground, not to a storey.';
  end if;
  if la <> lb then
    return 'One end is on ' || case when la = 0 then 'the ground' else 'storey ' || (la + 1) end
        || ' and the other on ' || case when lb = 0 then 'the ground' else 'storey ' || (lb + 1) end
        || '. A deck meets one storey or the other.';
  end if;
  ha := deck_height(p_world, p_ax, p_ay);
  hb := deck_height(p_world, p_bx, p_by);
  if abs(ha - hb) > end_slop() then
    return 'The two ends are ' || to_char(abs(ha - hb), 'FM990')
      || ' apart in height. One deck will not meet both; level one of them.';
  end if;
  h := round((ha + hb) / 2);
  for r in select * from span_tiles(p_ax, p_ay, p_bx, p_by) loop
    if bridge_at(p_world, r.x, r.y) is not null then return 'Something is already bridged across there.'; end if;
    if building_at(p_world, r.x, r.y) is not null then return 'Not over a building.'; end if;
    -- Frame: nor through a jetty, a balcony and its railings (`frame_jetty_of`).
    if frame_jetty_of(p_world, r.x, r.y) is not null then return 'Not over a building''s jetty.'; end if;
    if h - surface_height(p_world, r.x, r.y) < clearance() then return 'That is not a gap, it is ground. Walk it.'; end if;
  end loop;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.perform_last(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare v_took boolean; p player; pc placed; b bridge; d bridge_def; s bridge_span; c creature; mate creature;
        dam creature; sire creature; it item; dye item; bd brew_def; dd dye_def;
        v_kind text; v_id bigint; v_h int; v_n int; v_left int; v_want text; v_back jsonb;
        v_parts text[]; v_half int; e record; r record; v_skill double precision;
        v_care double precision; v_one bigint; v_stock item; v_ql double precision;
begin
  select * into p from player where world_id = p_world and uid = p_uid;

  if p_action = 'set_bauble' then
    perform perform_bauble(p_world, p_uid, p_target);
    return;
  end if;
  if p_action = 'sacrifice' then
    perform perform_sacrifice(p_world, p_uid, p_target);
    return;
  end if;
  if p_action = 'absorb_mote' then
    perform perform_absorb(p_world, p_uid, p_target);
    return;
  end if;

  if p_action = 'plan_bridge' then
    v_kind := coalesce(p_target->>'material', 'rope');
    if bridge_reason(p_world, p_uid, v_kind, floor(p.x)::int, floor(p.y)::int,
         (p_target->>'x')::int, (p_target->>'y')::int) is not null then return; end if;
    select * into d from bridge_def where id = v_kind;
    v_h := round((centre_height(p_world, floor(p.x)::int, floor(p.y)::int)
                + centre_height(p_world, (p_target->>'x')::int, (p_target->>'y')::int)) / 2);
    insert into bridge (world_id, kind, ax, ay, bx, by, height, material, made_by)
    values (p_world, v_kind, floor(p.x)::int, floor(p.y)::int,
            (p_target->>'x')::int, (p_target->>'y')::int, v_h,
            case when v_kind = 'stone' then null else 'Oak' end, p_uid)
    returning id into v_id;
    -- gates: the first span, beside the end it is set out from, also takes a drawbridge's winch.
    insert into bridge_span (world_id, bridge, n, x, y, needed, total)
    select p_world, v_id, t.n, t.x, t.y, span_bill(v_kind, t.n), span_bill(v_kind, t.n)
    from span_tiles(floor(p.x)::int, floor(p.y)::int,
                    (p_target->>'x')::int, (p_target->>'y')::int) t;
    select count(*)::int into v_n from bridge_span sp where sp.world_id = p_world and sp.bridge = v_id;
    perform journal_note(p_world, p_uid, 'planned_bridge');
    perform skill_raise(p_world, p_uid, d.skill, 0.4);
    perform tell(p_world, p_uid, 'You set out a ' || lower(d.name) || ' of ' || v_n || ' span'
      || case when v_n > 1 then 's' else '' end || ' across. Each one wants '
      || span_wants(span_bill(v_kind)) || '. ' || d.note, 'system');

  elsif p_action = 'build_bridge' then
    select * into b from bridge where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found then return; end if;
    select * into d from bridge_def where id = b.kind;
    select * into s from bridge_span sp where sp.world_id = p_world and sp.bridge = b.id
      and not span_done(sp.needed) order by sp.n limit 1;
    if not found then return; end if;
    -- One unit of one thing per go, as with a wall.
    select e2.key into v_want from jsonb_each(s.needed) e2
      where (e2.value)::int > 0 and pack_count(p_world, p_uid, e2.key) > 0 order by e2.key limit 1;
    if v_want is null then return; end if;
    if not consume(p_world, p_uid, v_want, 1) then return; end if;
    update bridge_span sp set needed = jsonb_set(sp.needed, array[v_want],
        to_jsonb(greatest(0, (sp.needed->>v_want)::int - 1)))
      where sp.world_id = p_world and sp.bridge = b.id and sp.n = s.n
      returning * into s;
    perform skill_raise(p_world, p_uid, d.skill, 0.5);
    perform wear_tool((select i.id from item i where i.world_id = p_world and i.holder = 'player'
      and i.holder_uid = p_uid and i.def = d.tool
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1), 0.4);
    if span_done(s.needed) then
      v_left := bridge_left(p_world, b.id);
      if v_left > 0 then
        perform tell(p_world, p_uid, 'That span is decked. ' || v_left || ' still open.', 'event');
      else
        perform journal_note(p_world, p_uid, 'bridged');
        perform tell(p_world, p_uid, 'The last span is decked and the ' || lower(bridge_name(b))
          || ' is open. ' || case when d.carts then 'A cart will cross it.'
                                  else 'Foot traffic only; nothing with a wheel.' end, 'system');
      end if;
    else
      perform tell(p_world, p_uid, 'You work a '
        || lower((select coalesce(name, v_want) from item_def where id = v_want))
        || ' into the span. It still wants ' || span_wants(s.needed) || '.', 'event');
    end if;

  elsif p_action = 'demolish_bridge' then
    select * into b from bridge where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found then return; end if;
    -- Half of what went into it comes back, which is what pulling a thing down
    -- is worth anywhere else in the world.
    v_parts := '{}';
    for e in
      select k.key as item, sum((k.value)::int - coalesce((sp.needed->>k.key)::int, 0))::int as used
      from bridge_span sp cross join lateral jsonb_each(sp.total) k
      where sp.world_id = p_world and sp.bridge = b.id
      group by k.key order by k.key
    loop
      v_half := floor(e.used / 2.0)::int;
      if v_half > 0 then
        perform give(p_world, p_uid, e.item, v_half, 20);
        v_parts := v_parts || (v_half || ' ' ||
          lower((select coalesce(name, e.item) from item_def where id = e.item)));
      end if;
    end loop;
    delete from bridge_span where world_id = p_world and bridge = b.id;
    delete from bridge where world_id = p_world and id = b.id;
    perform tell(p_world, p_uid, case when array_length(v_parts, 1) > 0
      then 'You take the ' || lower(bridge_name(b)) || ' down and save '
           || array_to_string(v_parts, ', ') || '.'
      else 'You take the ' || lower(bridge_name(b)) || ' down.' end, 'event');

  elsif p_action = 'ring_bell' then
    select * into pc from placed where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found then return; end if;
    select * into p from player where world_id = p_world and uid = p_uid;
    r := deed_at(p_world, pc.x, pc.y);
    if r.world_id is null then return; end if;
    v_n := 0;
    -- Every wildermon working the deed drops what it is doing and walks to
    -- whoever rang: a leg to the ringer, and a while standing there before
    -- the work takes it back.
    for e in select cr.*, coalesce(sp.speed, 1) as pace
             from creature cr join species_def sp on sp.id = cr.species
             where cr.world_id = p_world and cr.mode = 'deed' and cr.hitched_to is null
               and cr.keeper in (select m.uid from deed_member m
                                 where m.world_id = p_world and m.founder = r.founded_by
                                 union select r.founded_by)
    loop
      v_ql := greatest(0.5, sqrt(power(p.x - e.to_x, 2) + power(p.y - e.to_y, 2)) / greatest(0.4, e.pace));
      update creature set phase = 'idle', work_x = null, work_y = null, enemy = null,
          from_x = e.to_x, from_y = e.to_y, to_x = p.x, to_y = p.y,
          leg_at = now(), leg_ends = now() + make_interval(secs => v_ql),
          until = now() + make_interval(secs => v_ql + 20)
        where world_id = p_world and id = e.id;
      v_n := v_n + 1;
    end loop;
    -- And every citizen hears where it hangs.
    for e in select m.uid from deed_member m where m.world_id = p_world and m.founder = r.founded_by
             union select r.founded_by
    loop
      if e.uid <> p_uid then
        perform tell(p_world, e.uid, 'The bell rings out over ' || r.name || ' from ' || pc.x || ', ' || pc.y || '.', 'system');
      end if;
    end loop;
    perform journal_note(p_world, p_uid, 'rang');
    perform tell(p_world, p_uid, 'You ring the ' || lower(placed_name(pc)) || ' and it sounds over ' || r.name || '. '
      || case when v_n > 0 then v_n || ' wildermon ' || case when v_n = 1 then 'comes' else 'come' end || ' at the sound'
              else 'Nothing is working the deed to come' end
      || ', and every citizen hears where it hangs: ' || pc.x || ', ' || pc.y || '.', 'event');

  elsif p_action = 'sleep' then
    select * into pc from placed where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found then return; end if;
    /*
     * A well-made bed is a better night than a cot with a thin mattress — and
     * a bed under a roof, in a room with walls all round it, is a better night
     * again than the same bed standing in a field in the weather.
     */
    perform journal_note(p_world, p_uid, 'slept');
    perform sleep_until_morning(p_world, p_uid,
      (select bed from furniture_def where id = pc.sub) * (0.6 + pc.ql / 250)
        * case when case when pc.level < 0 then cellar_done(p_world, floor(pc.x)::int, floor(pc.y)::int) -- cellar: always indoors
                         else indoors(p_world, 0, floor(pc.x)::int, floor(pc.y)::int) end -- cellar
               then indoors_rest() else 1 end, -- cellar
      lower(placed_name(pc)));

  elsif p_action = 'set_home' then
    select * into pc from placed where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found then return; end if;
    update player set home_x = pc.x, home_y = pc.y where world_id = p_world and uid = p_uid;
    perform tell(p_world, p_uid, 'You make up the ' || lower(placed_name(pc))
      || '. This is where you will wake, whatever happens to you.', 'event');

  elsif p_action = 'pair_creature' then
    c := target_creature(p_world, p_target);
    mate := mate_for(p_world, c);
    if c.world_id is null or mate.id is null or pair_refuses(p_world, c, mate) is not null then return; end if;
    if c.sex = 'female' then dam := c; sire := mate; else dam := mate; sire := c; end if;
    v_skill := skill_of(p_world, p_uid, 'animal_husbandry');
    v_care := (dam.care + sire.care) / 2;
    v_took := random() < breed_chance(v_skill, v_care);
    perform skill_raise(p_world, p_uid, 'animal_husbandry', try_gain(v_took, breed_gain()));
    if not v_took then
      -- A failed pairing costs both of them a rest, but only half of one.
      -- Half a shorter one for the breeder's Short Rest.
      update creature set bred_at = now() - make_interval(secs => breed_rest() * (1 - pk(p_world, p_uid, 'breed:rest', 1) / 2))
        where world_id = p_world and id in (dam.id, sire.id);
      perform tell(p_world, p_uid, dam.name || ' and ' || sire.name
        || ' will have nothing to do with one another. Brush them, feed them, and try again.', 'error');
      return;
    end if;
    perform pair_them(p_world, dam.id, sire.id, v_skill, p_uid, p_target->>'sex');
    perform journal_note(p_world, p_uid, 'paired');
    perform tell(p_world, p_uid, sire.name || ' is put to ' || dam.name
      || '. She is in young and will drop in about ' || clock_left(gestation() * pk(p_world, p_uid, 'breed:gestation', 1))
      || '. Between them they carry '
      || trait_names((select array_agg(distinct t) from unnest(sire.traits || dam.traits) t))
      || '.', 'event');

  elsif p_action = 'read_blood' then
    c := target_creature(p_world, p_target);
    if c.world_id is null then return; end if;
    perform tell(p_world, p_uid, blood_read(p_world, p_uid, c), 'event');

  elsif p_action = 'dye_item' then
    select * into it from item where world_id = p_world and id = target_item(p_target);
    dye := pick_dye(p_world, p_uid);
    if it.id is null or dye.id is null then return; end if;
    select * into dd from dye_def where name = dye.extra;
    if not consume(p_world, p_uid, 'dye', 1) then return; end if;
    -- One pot does one thing. A stack is split so the rest stays as it was.
    if it.count > 1 then
      update item set count = count - 1 where id = it.id;
      insert into item (world_id, holder, holder_uid, def, ql, dmg, count, extra, rare, dye)
      values (p_world, it.holder, it.holder_uid, it.def, it.ql, it.dmg, 1, it.extra, it.rare, dd.id);
    else
      update item set dye = dd.id where id = it.id;
    end if;
    perform journal_note(p_world, p_uid, 'dyed');
    perform skill_raise(p_world, p_uid, 'alchemy', 0.3);
    perform tell(p_world, p_uid, 'You work the ' || lower(dd.name)
      || ' through it. It comes out ' || dd.word || '.', 'event');

  elsif p_action = 'strip_dye' then
    select * into it from item where world_id = p_world and id = target_item(p_target);
    if it.id is null then return; end if;
    select * into dye from item i where i.world_id = p_world and i.holder = 'player'
      and i.holder_uid = p_uid and i.def = 'lye_bucket' order by i.id limit 1;
    if dye.id is null or not consume(p_world, p_uid, 'lye_bucket', 1) then return; end if;
    perform give(p_world, p_uid, 'bucket', 1, dye.ql);
    update item set dye = null where id = it.id;
    perform skill_raise(p_world, p_uid, 'alchemy', 0.2);
    perform tell(p_world, p_uid, 'You boil it out in lye. It is back to the colour of '
      || lower((select coalesce(name, it.def) from item_def where id = it.def)) || '.', 'event');

  elsif p_action = 'start_brew' then
    select * into bd from brew_def where id = p_target->>'brew';
    select * into pc from placed where world_id = p_world and id = (p_target->>'id')::bigint;
    if bd.id is null or pc.id is null
       or brew_reason(p_world, p_uid, pc, bd) is not null then return; end if;
    -- What goes in decides most of what comes out; the hand only decides how
    -- much of it survives the working.
    select i.* into v_stock from craft_stock(p_world, p_uid) h join item i on i.id = h.id
      where h.def = bd.input order by h.draw limit 1;
    v_ql := coalesce(v_stock.ql, 20);
    if not craft_consume(p_world, p_uid, bd.input, bd.count) then return; end if;
    if not skill_check(skill_of(p_world, p_uid, 'brewing'), bd.difficulty, 0) then
      update placed set litres = greatest(0, placed_litres(pc) - bd.litres), since = now()
        where id = pc.id;
      update placed set liquid = null where id = pc.id and litres <= 0;
      update placed set knack = null where id = pc.id;
      perform skill_raise(p_world, p_uid, 'brewing', try_gain(false, brew_gain()));
      perform tell(p_world, p_uid, 'It will not take. You tip the whole soured lot out of the '
        || lower(placed_name(pc)) || '.', 'event');
      return;
    end if;
    update placed set litres = bd.litres, liquid = bd.id, ferment = bd.seconds, since = now(),
        ql = greatest(1, least(100, (v_ql + skill_of(p_world, p_uid, 'brewing')) / 2)),
        -- Its brewer's hand in it, which goes into every bucket drawn off it (a Cook's Strong Brew).
        knack = nullif(pk(p_world, p_uid, 'brewed:' || bd.id, 1), 1)
      where id = pc.id;
    perform journal_note(p_world, p_uid, 'brew');
    perform journal_note(p_world, p_uid, 'brew:' || bd.id);
    perform skill_raise(p_world, p_uid, 'brewing', try_gain(true, brew_gain()));
    perform tell(p_world, p_uid, bd.done || ' (about ' || round(bd.seconds / 60) || ' minutes)', 'event');
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.frame_jetty_refusal(p_world uuid, p_uid uuid, p_b building, p_x integer, p_y integer, p_kind text, p_level integer, p_mat build_material_def, p_roof_shape text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare over building; v_side text; v_fx int; v_fy int; v_below double precision; v_high int; bears int; v_kind text;
begin
  if p_kind in ('stairs', 'ladder') then return 'Stairs and ladders go inside the footprint, not out on a jetty.'; end if;
  if p_kind = 'roof' then
    -- Glass on a pitched roof and nowhere else, out over a jetty as over the footprint (`glass_refusal`).
    if p_mat.id = glass_material()
       and coalesce(p_b.roof, (select r.id from roof_shape_def r where r.id = p_roof_shape), 'hip') = 'flat' then
      return glass_pitched_said();
    end if;
    if not exists (select 1 from floor_tile f where f.world_id = p_world and f.level = p_b.levels - 1
                     and f.x = p_x and f.y = p_y and f.building = p_b.id and bill_done(f.needed)) then
      return 'A roof goes out past the footprint only over a finished jetty of storey ' || p_b.levels || '.';
    end if;
    if not exists (select 1 from frame_storey(p_world, p_b.id, p_b.levels - 1) a where a.x = p_x and a.y = p_y) then
      return 'That jetty is shut off from storey ' || p_b.levels
          || ' by a wall or a door, which makes it a balcony, and a balcony takes no roof.';
    end if;
    -- And on what: walls or columns round it, never a railing.
    return frame_jetty_roof_rests(p_world, p_b, p_x, p_y);
  end if;
  if p_level < 1 then
    return case when p_b.levels > 1 then 'Work on storey 2 or above to floor a jetty here.'
                else 'A jetty is floored out from a storey above the ground: plan another storey and work on it.' end;
  end if;
  select * into over from building where world_id = p_world and id = frame_jetty_of(p_world, p_x, p_y);
  if over.id is not null and over.id <> p_b.id then return 'That tile is under ' || over.name || '''s jetty.'; end if;
  if not on_my_deed(p_world, p_uid, p_x, p_y) then return 'You may only build on your own deed.'; end if;
  -- No span of a bridge or an aqueduct goes under it; a bridge's ends are its banks (`jettyReason`).
  select b.kind into v_kind from bridge_span s join bridge b on b.world_id = s.world_id and b.id = s.bridge
   where s.world_id = p_world and s.x = p_x and s.y = p_y limit 1;
  if v_kind is not null then
    return case when v_kind = 'aqueduct' then 'An aqueduct is carried over that tile.' else 'A bridge crosses that tile.' end;
  end if;
  -- gates: nor over a drawbridge's winch, whose gallows rise over that tile higher than a storey (`JETTY_OVER_WINCH`).
  if drawbridge_winch_at(p_world, p_x, p_y) then
    return 'A drawbridge''s winch stands on that tile, and its gallows rise over it.';
  end if;
  if not passable(p_world, p_x, p_y) or land_tile(p_world, p_x, p_y) = tile_id('Bush') then
    return 'A jetty is built over open ground: clear the tree or the bush from under it first.';
  end if;
  -- What it rests on: the first finished full-height wall of the storey below, going round from the north.
  v_side := frame_jetty_bearer(p_world, p_b.id, p_level, p_x, p_y);
  if v_side is not null then
    select a.x, a.y into v_fx, v_fy from across(p_x, p_y, v_side) a;
    -- Clear of the ground by a storey: never lower over it than the storey under it stands.
    -- On piers, from the building's deck (`jettyBase`).
    v_below := coalesce(p_b.deck, land_height(p_world, v_fx, v_fy)) + (p_level - 1) * wall_height();
    v_high := greatest(land_height(p_world, p_x, p_y), land_height(p_world, p_x + 1, p_y),
                       land_height(p_world, p_x + 1, p_y + 1), land_height(p_world, p_x, p_y + 1));
    if v_high > v_below then
      return 'The ground under it rises above the floor of storey ' || p_level || ': dig it down, or floor the jetty out a storey higher.';
    end if;
  elsif not frame_on_jetty_below(p_world, p_b.id, p_level, p_x, p_y) then
    -- Or over the jetty of the storey below, inside that storey, on its walls.
    return 'A jetty rests on a finished full-height wall of storey ' || p_level || ': build one on a side this tile shares with '
        || p_b.name || ' first.';
  end if;
  bears := bearing(p_world, p_b.id, p_level);
  if p_mat.heft > coalesce(bears, 9) then
    return p_mat.name || ' is too heavy to lay out past the walls. The walls under it carry ' || heft_word(bears) || ', no more.';
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.aqueduct_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare p player; b bridge; s bridge_span; v_short text;
begin
  select * into p from player where world_id = p_world and uid = p_uid;
  if p_action = 'plan_bridge' then
    return 'An aqueduct is set out from the pool, pond, fountain or hollow it pours into, not thrown from a bank.';
  end if;
  if p_action = 'plan_aqueduct' then
    if p_target->>'kind' is distinct from 'tile' then return 'Choose where it pours.'; end if;
    if jsonb_typeof(p_target->'head') is distinct from 'array' then return 'Choose the water it draws from.'; end if;
    if not in_reach(p.x, p.y, p_target, false, (select d.range from action_def d where d.id = 'plan_aqueduct')) then
      return 'You are too far away from that.';
    end if;
    return aqueduct_plan(p_world, p_uid, (p_target->'head'->>0)::int, (p_target->'head'->>1)::int,
                         (p_target->>'x')::int, (p_target->>'y')::int)->>'refused';
  end if;
  select * into b from bridge where world_id = p_world and id = (p_target->>'id')::bigint and kind = 'aqueduct';
  if not found then return 'It is gone.'; end if;
  if p_action in ('build_aqueduct', 'build_bridge') then
    select * into s from bridge_span sp where sp.world_id = p_world and sp.bridge = b.id
      and not span_done(sp.needed) order by sp.n limit 1;
    if not found then return 'It is finished.'; end if;
    if tool_ql(p_world, p_uid, 'trowel') <= 0 then
      return 'You need a ' || lower((select coalesce(name, 'trowel') from item_def where id = 'trowel')) || '.';
    end if;
    if sqrt((s.x + 0.5 - p.x) ^ 2 + (s.y + 0.5 - p.y) ^ 2) > 4.5 then
      return 'Work from one end. Walk to the open part of the span.';
    end if;
    select e.key into v_short from jsonb_each(s.needed) e
      where (e.value)::int > 0 and pack_count(p_world, p_uid, e.key) < 1 order by e.key limit 1;
    if v_short is not null then
      return 'That span wants ' || span_wants(s.needed) || '; you are carrying no '
        || lower((select coalesce(name, v_short) from item_def where id = v_short)) || '.';
    end if;
    return null;
  end if;
  -- gates: pulled down from as near either end as a bridge is (`bridge_pull_reach`), and on a settlement only by its
  -- builders, as a bridge is (`last_refusal`, `pullDownRefusal`), named by the job's own label.
  if sqrt((b.ax + 0.5 - p.x) ^ 2 + (b.ay + 0.5 - p.y) ^ 2) > bridge_pull_reach()
     and sqrt((b.bx + 0.5 - p.x) ^ 2 + (b."by" + 0.5 - p.y) ^ 2) > bridge_pull_reach() then
    return 'Stand at one end of it.';
  end if;
  select dd.name into v_short from (values (1, b.ax, b.ay), (2, b.bx, b."by")) v(o, x, y)
    cross join lateral deed_covering(p_world, v.x, v.y) dd
   where not may_shape(p_world, p_uid, v.x, v.y)
   order by v.o, dd.founded_at limit 1;
  if v_short is not null then
    return 'That is part of ' || v_short || '. Only its builders may '
        || lower((select a.label from action_def a where a.id = p_action)) || ' there.';
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.extend_reason(p_world uuid, p_uid uuid, p_x integer, p_y integer, p_into integer)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare v_slab foundation; v_deck int; b building; v_why text;
begin
  if not on_my_deed(p_world, p_uid, p_x, p_y) then return 'You may only build on your own deed.'; end if;
  if is_token(p_world, p_x, p_y) then return 'The settlement token stands here.'; end if;
  if building_at(p_world, p_x, p_y) is not null then return 'That tile is already part of a building.'; end if;
  if aqueduct_over(p_world, p_x, p_y) then return 'An aqueduct is carried over that tile.'; end if;
  -- gates: nor over the end of a bridge thrown across, whose winch or landing stands there (`BRIDGE_END_HERE`).
  if bridge_end_at(p_world, p_x, p_y) then return 'A bridge comes ashore on this tile. Build clear of its ends.'; end if;
  select * into b from building where world_id = p_world and id = p_into;
  select * into v_slab from foundation f where f.world_id = p_world and f.x = p_x and f.y = p_y;
  if v_slab.world_id is not null then
    if land_tile(p_world, p_x, p_y) <> tile_id('Packed dirt') then return 'Buildings need flat packed dirt. Pack the tile first.'; end if;
    if not bill_done(v_slab.needed) then return 'The foundation here is only shuttered. Pour it first.'; end if;
    if v_slab.pool then return 'You cannot build in water.'; end if;
    if b.deck is not null and v_slab.top <> b.deck then
      return 'The slab here is poured to ' || v_slab.top || ' and the floor of ' || b.name || ' stands at ' || b.deck
        || '. A floor is level.';
    end if;
  else
    v_deck := pier_deck_for(p_world, p_uid, p_x, p_y, p_into);
    if v_deck is null then
      if land_tile(p_world, p_x, p_y) <> tile_id('Packed dirt') then return 'Buildings need flat packed dirt. Pack the tile first.'; end if;
    else
      v_why := coalesce(pier_refusal(p_world, p_x, p_y, v_deck), pier_site_refusal(p_world, p_uid, p_x, p_y));
      if v_why is not null then return v_why; end if;
    end if;
  end if;
  if exists (select 1 from item i where i.world_id = p_world and i.holder = 'ground' and i.gx = p_x and i.gy = p_y) then
    return 'Clear away the items lying there first.';
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.last_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare p player; pc placed; b bridge; d bridge_def; s bridge_span; c creature; mate creature;
        it item; dye item; bd brew_def; v_kind text; v_short text;
begin
  select * into p from player where world_id = p_world and uid = p_uid;

  if p_action = 'set_bauble' then
    return bauble_refusal(p_world, p_uid, p_target);
  end if;
  if p_action = 'sacrifice' then
    return sacrifice_refusal(p_world, p_uid, p_target);
  end if;
  if p_action = 'absorb_mote' then
    return absorb_refusal(p_world, p_uid, p_target);
  end if;

  if p_action = 'plan_bridge' then
    v_kind := coalesce(p_target->>'material', 'rope');
    return bridge_reason(p_world, p_uid, v_kind, floor(p.x)::int, floor(p.y)::int,
      (p_target->>'x')::int, (p_target->>'y')::int);

  elsif p_action in ('build_bridge', 'demolish_bridge') then
    select * into b from bridge where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found then return 'It is gone.'; end if;
    select * into d from bridge_def where id = b.kind;
    if p_action = 'build_bridge' then
      select * into s from bridge_span sp where sp.world_id = p_world and sp.bridge = b.id
        and not span_done(sp.needed) order by sp.n limit 1;
      if not found then return 'It is finished.'; end if;
      if tool_ql(p_world, p_uid, d.tool) <= 0 then
        return 'You need a ' || lower((select coalesce(name, d.tool) from item_def where id = d.tool)) || '.';
      end if;
      if sqrt((s.x + 0.5 - p.x) ^ 2 + (s.y + 0.5 - p.y) ^ 2) > 4.5 then
        return 'Work from one end. Walk to the open part of the span.';
      end if;
      select e.key into v_short from jsonb_each(s.needed) e
        where (e.value)::int > 0 and pack_count(p_world, p_uid, e.key) < 1 order by e.key limit 1;
      if v_short is not null then
        return 'That span wants ' || span_wants(s.needed) || '; you are carrying no '
          || lower((select coalesce(name, v_short) from item_def where id = v_short)) || '.';
      end if;
    else
      -- gates: the far end's row, quoted: a record's field named by a reserved word is not found unquoted, so
      -- this refused nothing and raised "record b has no field by" instead, and nobody could pull a bridge down;
      -- and the reach, written once (`bridge_pull_reach`, `PULL_REACH`).
      if sqrt((b.ax + 0.5 - p.x) ^ 2 + (b.ay + 0.5 - p.y) ^ 2) > bridge_pull_reach()
         and sqrt((b.bx + 0.5 - p.x) ^ 2 + (b."by" + 0.5 - p.y) ^ 2) > bridge_pull_reach() then
        return 'Stand at one end of it.';
      end if;
      -- gates: where either end stands on a settlement, only its builders pull a bridge down, as only they take
      -- down a building's wall there (`may_shape`); anywhere else anybody may (`pullDownRefusal`).
      select dd.name into v_short from (values (1, b.ax, b.ay), (2, b.bx, b."by")) v(o, x, y)
        cross join lateral deed_covering(p_world, v.x, v.y) dd
       where not may_shape(p_world, p_uid, v.x, v.y)
       order by v.o, dd.founded_at limit 1;
      if v_short is not null then
        return 'That is part of ' || v_short || '. Only its builders may '
            || lower((select a.label from action_def a where a.id = p_action)) || ' there.';
      end if;
      -- gates: a padlock on a drawbridge's winch keeps it from being pulled down as from being worked.
      v_short := lock_refusal(p_world, p_uid, b.lock, b.ax, b.ay);
      if v_short is not null then return v_short; end if;
    end if;
    return null;

  elsif p_action = 'ring_bell' then
    select * into pc from placed where world_id = p_world and id = (p_target->>'id')::bigint
      and kind = 'furniture';
    if not found or not coalesce((select f.bell from furniture_def f where f.id = pc.sub), false) then
      return 'That is not a bell.';
    end if;
    if not near_piece(p_world, p_uid, pc) then return 'Stand next to it.'; end if;
    if not on_my_deed(p_world, p_uid, pc.x, pc.y) then
      return 'Ring it on a settlement of yours; a bell in the wild calls nobody.';
    end if;
    return null;

  elsif p_action in ('sleep', 'set_home') then
    select * into pc from placed where world_id = p_world and id = (p_target->>'id')::bigint
      and kind = 'furniture';
    if not found or not is_bed(pc) then return 'That is not a bed.'; end if;
    if not near_piece(p_world, p_uid, pc) then return 'Stand next to it.'; end if;
    if p_action = 'sleep' and not is_night(p_world) then
      return 'It is ' || world_clock(p_world) || ' and broad daylight. Sleep when it is dark.';
    end if;
    if p_action = 'set_home' and p.home_x = pc.x and p.home_y = pc.y then
      return 'You already wake up here.';
    end if;
    return null;

  elsif p_action in ('pair_creature', 'read_blood') then
    perform creature_settle(p_world, (p_target->>'id')::int);
    perform herd_settle(p_world);
    c := target_creature(p_world, p_target);
    if c.world_id is null then return 'It is gone.'; end if;
    if p_action = 'read_blood' then return null; end if;
    if (my_deed(p_world, p_uid)).world_id is null then
      return 'Breeding is settled work. Found a settlement first: the young one goes to the token.';
    end if;
    if not creature_in_reach(p_world, p_uid, c, 2.4) then return 'Stand next to ' || c.name || '.'; end if;
    if c.due is not null then return c.name || ' is already in young.'; end if;
    mate := mate_for(p_world, c);
    if mate.id is null then
      return 'There is no ' || lower((select name from species_def where id = c.species))
        || ' of the other sex within ' || round(pair_range()) || ' tiles. ' || c.name
        || ' is ' || c.sex || '.';
    end if;
    return pair_refuses(p_world, c, mate);

  elsif p_action in ('dye_item', 'strip_dye') then
    select * into it from item where world_id = p_world and id = target_item(p_target)
      and holder = 'player' and holder_uid = p_uid;
    if p_action = 'dye_item' then
      if not found then return 'It is gone.'; end if;
      if not takes_dye(it.def) then return 'Nothing will take on that.'; end if;
      dye := pick_dye(p_world, p_uid);
      if dye.id is null then
        return 'You have no dye. Boil one out of berries, acorns or herbs with a bucket of lye.';
      end if;
      if it.dye = (select id from dye_def where name = dye.extra) then
        return 'It is ' || (select word from dye_def where name = dye.extra) || ' already.';
      end if;
    else
      if not found or it.dye is null then return 'It has taken no colour.'; end if;
      if pack_count(p_world, p_uid, 'lye_bucket') <= 0 then
        return 'You need a bucket of lye to strip it.';
      end if;
    end if;
    return null;

  elsif p_action = 'start_brew' then
    select * into bd from brew_def where id = p_target->>'brew';
    if not found then return 'Choose what to brew.'; end if;
    select * into pc from placed where world_id = p_world and id = (p_target->>'id')::bigint
      and kind = 'furniture';
    return brew_reason(p_world, p_uid, pc, bd);
  end if;
  return null;
end $function$;


select private.lock_doors();
