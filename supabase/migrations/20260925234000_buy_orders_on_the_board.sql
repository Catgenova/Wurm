/*
 * Buy orders on the board.
 *
 * Asked for: buy orders on the market board. Somebody at a settlement token
 * or a mailbox says what they want -- a kind of thing, and the least quality
 * that will do if they care -- how many, and the silver for each; the whole
 * price comes out of their purse and is held. The board lists the order beside
 * the stalls. Anybody else fills it out of their pack, all of it or some, is
 * paid out of what it holds at once, and what they brought goes to whoever
 * wanted it by the post. The one who put it up may take it back for what it
 * still holds, and one left open for a week takes itself back.
 *
 * A stall sells what you have to somebody who is not there. An order buys
 * what you want from somebody who is not there, which is the half of a market
 * this island did not have: until now the only way to get a hundred iron ore
 * out of a stranger was to be standing next to them when they had it.
 *
 * The coins are held the way a deal's are: taken out of the pack when the
 * order goes up -- change and all, by `take_coins` -- and paid out of nothing
 * but the order afterwards. What an order holds is never written down; it is
 * what is still wanted at the price, `(want - got) * price`, so it cannot
 * drift from what the order has paid out. Whoever fills it is paid that much
 * a thing; whoever takes it back, or lets it lapse, gets the rest.
 *
 * The island chooses what goes, not the browser: of the kind asked for,
 * whatever it is made of, at the quality asked for or better, out of the pack
 * and nowhere else, the poorest first -- which is what anybody filling an
 * order out of their own pack would send. Never what is put by, held out in a
 * deal, worn or held in the hand, a creature crate with a wildermon in it, or
 * anything with something inside it: an order is not a way to strip a body or
 * empty a bag. So a browser asks for a number and nothing else, and nothing it
 * says can put the wrong thing in the post.
 *
 * What is brought rides in a letter from whoever brought it, which makes it a
 * parcel like any other: in the post, named for its sender, drawn out at any
 * mailbox with `rpc_collect`. The one who wanted it is told in the event log,
 * and when they are away it is counted for them -- `away_tally` gains
 * `bought`, by item, with the silver it cost.
 *
 * Two people filling one order at once are one after the other: the order's
 * row is held from the moment a fill reads it, so the second waits and then
 * reads what the first left -- fewer wanted, or none. The doors that take
 * coins or things out of a pack hold that body's row first, through `settle`;
 * the one putting an order up holds the coins in the purse before it counts
 * them, and a fill holds everything of the kind in the pack before it counts
 * that.
 *
 * An order lapses after `order_life()` -- `ORDER_LIFE` in
 * `src/game/orders.ts`, a week -- and nothing on the clock looks for it:
 * whoever reads the board or touches an order sweeps the lapsed ones first,
 * which gives their coins back. An order past its time is only ever read by
 * one of those, so it is always swept before anybody can see it.
 *
 *   rpc_order         put an order up, at a token or a mailbox;
 *   rpc_orders        every open order on the island at a token or a
 *                     mailbox, and your own wherever you are;
 *   rpc_order_fill    bring some or all of what one wants, at a token or a
 *                     mailbox;
 *   rpc_order_cancel  take one of your own back, from anywhere.
 *
 * None of it is in the game you play by yourself: there is nobody there to
 * fill one.
 */
set local lock_timeout = '3s';

select private.shut($ddl$
create table if not exists buy_order (
  world_id uuid not null,
  n bigint generated always as identity,
  -- Who wants it.
  poster uuid not null,
  -- What they want: a kind of thing, and the least quality that will do; nought for any.
  def text not null,
  ql int not null default 0,
  -- How many were asked for and how many have been brought, and the silver paid for each.
  want int not null,
  got int not null default 0,
  price bigint not null,
  -- The tile it was put up from, at a token or a mailbox, which is where the board says it is.
  x int not null,
  y int not null,
  at timestamptz not null default now(),
  -- Set when nothing more is wanted: filled, taken back, or lapsed. An open order has neither.
  closed_at timestamptz,
  closed text,
  primary key (world_id, n),
  foreign key (world_id, poster) references player (world_id, uid) on delete cascade,
  constraint buy_order_ql check (ql between 0 and 100),
  constraint buy_order_want check (want > 0 and got between 0 and want),
  constraint buy_order_price check (price > 0),
  constraint buy_order_closed check ((closed_at is null) = (closed is null)
                                     and closed in ('filled', 'withdrawn', 'lapsed'))
)$ddl$);
-- The open ones, by age: what the board lists and what a sweep looks through.
select private.shut($ddl$create index if not exists buy_order_open on buy_order (world_id, at) where closed_at is null$ddl$);
select private.shut('alter table buy_order enable row level security');
-- Read and written through the doors below and nowhere else.
select private.shut('revoke all on buy_order from anon, authenticated');

-- And a count for somebody away of what was brought to their orders.
select private.shut($ddl$alter table away_tally drop constraint if exists away_tally_what_check,
  add constraint away_tally_what_check check (what in ('haul', 'born', 'strayed', 'sold', 'parcel', 'bought'))$ddl$);

/*
 * What an order asks for, the way a line says it: "15 × iron ore of quality
 * 30 or better", or "15 × iron ore" when any quality will do. The browser says
 * it in the same words (`orderWords`).
 */
create or replace function order_words(p_def text, p_n bigint, p_ql int) returns text
language sql stable as $$
  select p_n || ' × ' || lower(coalesce((select d.name from item_def d where d.id = p_def), p_def))
      || case when p_ql > 0 then ' of quality ' || p_ql || ' or better' else '' end
$$;

/*
 * What in a body's pack would go to an order: of the kind, whatever it is
 * made of, and of the quality or better; not put by, not held out in a deal,
 * not worn or in the hand, not a crate with a wildermon in it, and nothing
 * with anything inside it. The browser asks the same of its own pack
 * (`fitsOrder`), all but the deal, which it cannot see.
 */
create or replace function order_fits(p_world uuid, p_uid uuid, p_def text, p_ql int) returns setof item
language sql stable as $$
  select i.* from item i
   where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid
     and i.def = p_def and i.ql >= p_ql and not i.locked and i.deal is null and i.creature is null
     and not exists (select 1 from item c where c.inside = i.id)
     and not exists (select 1 from player pl cross join jsonb_each_text(pl.equipped) e
                      where pl.world_id = p_world and pl.uid = p_uid and e.value = i.id::text)
$$;

/*
 * An order that wants nothing more from anybody: taken back, or lapsed. What
 * it still held goes back into its owner's purse, and they are told how much.
 * Returns the silver given back.
 *
 * The coins go in as `give_coins` gives them and are not folded into the rest
 * of the purse here: a lapse is found by whoever reads the board, and folding
 * somebody else's pack from their door, without holding their row, is a wait
 * on whatever they are doing to it at that moment. The owner's own door folds.
 */
create or replace function order_close(o buy_order, p_how text) returns bigint
language plpgsql as $$
declare v_back bigint := (o.want - o.got)::bigint * o.price; v_words text;
begin
  v_words := order_words(o.def, o.want - o.got, o.ql);
  perform give_coins(o.world_id, o.poster, v_back);
  update buy_order set closed_at = now(), closed = p_how where world_id = o.world_id and n = o.n;
  perform tell(o.world_id, o.poster, case when p_how = 'lapsed'
      then 'Your order for ' || v_words || ' has lapsed. The ' || v_back
        || ' silver it still held is back in your pack.'
      else 'You take back your order for ' || v_words || ', and the ' || v_back
        || ' silver it still held.' end, 'event');
  return v_back;
end $$;

/*
 * Every open order on the island past `order_life()`, closed and paid back.
 *
 * Asked of by whoever reads the board or puts an order up, so that nothing on
 * the clock has to look. One somebody is filling or taking back at this moment
 * is left to them: they hold its row, a fill finds it lapsed for itself, and
 * taking it back gives back the same coins a lapse would.
 */
create or replace function order_sweep(p_world uuid) returns int
language plpgsql as $$
declare o buy_order; v_n int := 0;
begin
  for o in select * from buy_order
            where world_id = p_world and closed_at is null
              and at <= now() - make_interval(secs => order_life())
            order by n
            for update skip locked
  loop
    perform order_close(o, 'lapsed');
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

/*
 * Put an order up.
 *
 * At a settlement token or a mailbox, which is where the board is read. The
 * whole price comes out of the purse now and is held against the order, so
 * an order can always pay for what it asked for. The coins in the purse are
 * held before they are counted: anything else paying out of it waits until
 * this is done, and cannot spend a coin this is spending too.
 */
create or replace function rpc_order(p_world uuid, p_def text, p_count integer, p_price bigint,
                                     p_ql integer default 0)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare me uuid := auth.uid(); p player; v_ql int; v_total numeric; v_purse bigint; v_n bigint;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  perform settle(p_world, me);
  select * into p from player where world_id = p_world and uid = me;
  if not found then raise exception 'you are not on this island'; end if;
  perform order_sweep(p_world);
  if not board_at(p_world, me) then
    return jsonb_build_object('why', 'Stand at a settlement token or a mailbox to put up an order.');
  end if;
  if p_def = 'coin' then
    return jsonb_build_object('why', 'Coins are what an order pays with, not something it can ask for.');
  end if;
  if p_def is null or not exists (select 1 from item_def where id = p_def) then
    return jsonb_build_object('why', 'There is no such thing to ask for.');
  end if;
  if coalesce(p_count, 0) < 1 then return jsonb_build_object('why', 'Ask for at least one.'); end if;
  if coalesce(p_price, 0) < 1 then return jsonb_build_object('why', 'Offer at least a silver for each.'); end if;
  v_ql := greatest(0, least(100, coalesce(p_ql, 0)));

  perform 1 from item where world_id = p_world and holder = 'player' and holder_uid = me and def = 'coin'
    order by id for update;
  v_total := p_count::numeric * p_price;
  v_purse := purse(p_world, me);
  if v_total > v_purse then
    return jsonb_build_object('why', 'That holds ' || v_total || ' silver, and you are carrying ' || v_purse || '.');
  end if;
  if not take_coins(p_world, me, v_total::bigint) then
    return jsonb_build_object('why', 'You do not have that many coins.');
  end if;
  perform pack_fold(p_world, me);
  insert into buy_order (world_id, poster, def, ql, want, price, x, y)
    values (p_world, me, p_def, v_ql, p_count, p_price, floor(p.x)::int, floor(p.y)::int)
    returning n into v_n;
  perform tell(p_world, me, 'Your order is up: ' || order_words(p_def, p_count, v_ql) || ' at ' || p_price
    || ' silver each, with ' || v_total || ' silver held against it.', 'event');
  return jsonb_build_object('order', v_n, 'held', v_total);
end $$;

/*
 * The open orders: every one on the island for somebody at a settlement
 * token or a mailbox, and your own wherever you are, so they can be taken
 * back from anywhere. Swept first, so a lapsed one is never shown.
 */
create or replace function rpc_orders(p_world uuid) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare me uuid := auth.uid(); v_board boolean;
begin
  if me is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from player where world_id = p_world and uid = me) then
    raise exception 'you are not on this island';
  end if;
  perform order_sweep(p_world);
  v_board := board_at(p_world, me);
  return jsonb_build_object(
    'board', v_board,
    'orders', coalesce((select jsonb_agg(jsonb_build_object(
        'n', o.n, 'def', o.def, 'ql', o.ql, 'want', o.want, 'got', o.got, 'price', o.price,
        'who', folk_name(p_world, o.poster), 'mine', o.poster = me, 'x', o.x, 'y', o.y,
        'deed', (select d.name from deed d where d.world_id = p_world
                   and abs(o.x - d.x) <= d.radius and abs(o.y - d.y) <= d.radius
                 order by d.level desc limit 1),
        -- Seconds before it lapses, counted here so a browser's clock has no say in it.
        'left', greatest(0, ceil(extract(epoch from o.at - now()) + order_life()))::bigint)
        order by o.poster = me desc, o.at, o.n)
      from buy_order o
      where o.world_id = p_world and o.closed_at is null and (v_board or o.poster = me)), '[]'::jsonb));
end $$;

/*
 * Bring some or all of what an order wants, out of your pack.
 *
 * At a settlement token or a mailbox, and never to your own. The order's row
 * is held from here to the end, so a second person filling it at the same
 * moment waits, and then reads what this left. The pack is held too: every
 * row of the kind, before anything is counted, so what was counted is what
 * goes.
 */
create or replace function rpc_order_fill(p_world uuid, p_n bigint, p_count integer)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare me uuid := auth.uid(); p player; o buy_order; r item; v_left int; v_have bigint; v_owed int;
        v_take int; v_letter bigint; v_paid bigint; v_words text;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  perform settle(p_world, me);
  select * into p from player where world_id = p_world and uid = me;
  if not found then raise exception 'you are not on this island'; end if;
  if not board_at(p_world, me) then
    return jsonb_build_object('why', 'Stand at a settlement token or a mailbox to fill an order.');
  end if;
  select * into o from buy_order where world_id = p_world and n = p_n and closed_at is null for update;
  if not found then return jsonb_build_object('why', 'That order is gone.'); end if;
  if o.at <= now() - make_interval(secs => order_life()) then
    perform order_close(o, 'lapsed');
    return jsonb_build_object('why', 'That order has lapsed.');
  end if;
  if o.poster = me then
    return jsonb_build_object('why', 'It is your own order. Take it back instead.');
  end if;
  v_left := o.want - o.got;
  if coalesce(p_count, 0) < 1 then return jsonb_build_object('why', 'Bring at least one.'); end if;
  if p_count > v_left then
    return jsonb_build_object('why', 'It wants only ' || v_left || ' more.');
  end if;

  perform 1 from item where world_id = p_world and holder = 'player' and holder_uid = me and def = o.def
    order by id for update;
  select coalesce(sum(f.count), 0) into v_have from order_fits(p_world, me, o.def, o.ql) f;
  if v_have < p_count then
    return jsonb_build_object('why', case when v_have = 0 then 'You have none in your pack that will do.'
      else 'You have only ' || v_have || ' in your pack that will do.' end);
  end if;

  -- The letter it rides in, which is what makes it a parcel and says who it is from.
  v_words := order_words(o.def, p_count, 0);
  insert into letter (world_id, sender, reader, text)
    values (p_world, me, o.poster, 'For your order: ' || v_words || '.') returning n into v_letter;
  v_owed := p_count;
  for r in select * from order_fits(p_world, me, o.def, o.ql) f order by f.ql, f.id loop
    exit when v_owed <= 0;
    v_take := least(r.count, v_owed);
    if v_take = r.count then
      update item set holder = 'post', holder_uid = o.poster, letter = v_letter,
                      crate = null, placed = null, price = null
        where id = r.id;
    else
      -- Some of a stack: the rest stays in the pack, and what goes is the same stuff.
      update item set count = count - v_take where id = r.id;
      insert into item (world_id, holder, holder_uid, letter, def, ql, dmg, count, extra, rare, dye, bless,
                        charges, issued, made_at, lit, lit_at, rot_at, maker, piece, keyed)
        values (p_world, 'post', o.poster, v_letter, r.def, r.ql, r.dmg, v_take, r.extra, r.rare, r.dye, r.bless,
                r.charges, r.issued, r.made_at, r.lit, r.lit_at, r.rot_at, r.maker, r.piece, r.keyed);
    end if;
    v_owed := v_owed - v_take;
  end loop;

  v_paid := p_count::bigint * o.price;
  perform give_coins(p_world, me, v_paid);
  perform pack_fold(p_world, me);
  update buy_order set got = got + p_count,
         closed_at = case when got + p_count >= want then now() end,
         closed = case when got + p_count >= want then 'filled' end
   where world_id = p_world and n = o.n;
  perform tell(p_world, o.poster, folk_name(p_world, me) || ' brings ' || v_words || ' to your order, for '
    || v_paid || ' silver of what it held. '
    || case when p_count >= v_left then 'That is all it wanted.' else 'It still wants ' || (v_left - p_count) || '.' end
    || ' It waits for you at any mailbox.', 'event');
  perform away_count(p_world, o.poster, 'bought', o.def, p_count, v_paid);
  perform tell(p_world, me, 'You bring ' || v_words || ' to ' || folk_name(p_world, o.poster)
    || '''s order and are paid ' || v_paid || ' silver. It goes to them by the post.', 'event');
  return jsonb_build_object('brought', p_count, 'paid', v_paid, 'left', v_left - p_count);
end $$;

/* Take one of your own orders back, from anywhere, and what it still holds with it. */
create or replace function rpc_order_cancel(p_world uuid, p_n bigint) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare me uuid := auth.uid(); o buy_order; v_back bigint;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  perform settle(p_world, me);
  if not exists (select 1 from player where world_id = p_world and uid = me) then
    raise exception 'you are not on this island';
  end if;
  select * into o from buy_order where world_id = p_world and n = p_n and closed_at is null for update;
  if not found then return jsonb_build_object('why', 'That order is gone.'); end if;
  if o.poster <> me then return jsonb_build_object('why', 'That order is not yours to take back.'); end if;
  v_back := order_close(o, 'withdrawn');
  perform pack_fold(p_world, me);
  return jsonb_build_object('back', v_back);
end $$;

select private.lock_doors();
