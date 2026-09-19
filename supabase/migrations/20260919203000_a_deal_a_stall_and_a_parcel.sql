-- A deal on the table, a stall that sells, and a post that carries parcels
--
-- Coins have existed on this island since there was an anvil to strike them
-- on. They go in a pocket, they melt back into the lump they came from, and
-- they have never once bought anything — because there has never been
-- anything to buy them with or anybody to buy from. A currency nobody can
-- spend is a metal with a picture on it.
--
-- One number settles the money: a gold coin is worth ten silver, and every
-- price is named in silver. It is stated in `money.ts` and read from there by
-- both sides. Deliberately not a market: a rate that moved would want a
-- market to move it, and there is no market, there are people.
--
-- **A deal on the table.** Not a live two-window negotiation, which wants
-- realtime and a dance of ready flags that both sides can pull out of at the
-- last moment. An offer instead: you set out what you are giving and what you
-- want for it, aimed at one person, and it sits there until they take it or
-- turn it down. The terms are fixed when it is made, so accepting executes
-- exactly what was read — which is the property the ready-flag dance exists
-- to fake, got for nothing by writing the terms down.
--
-- **A stall.** The only thing on this island that does anything for you while
-- you are not here: a counter with goods on it and a price on each, which
-- anybody may buy from. The coins wait in its till for whoever set it up.
--
-- **A parcel.** A letter has carried four hundred characters and nothing else
-- since letters landed. It carries things now, posted at a mailbox and drawn
-- out at any other, which is what turns writing to somebody into sending them
-- something.

alter table placed add column if not exists till bigint not null default 0;
-- What a thing on a counter is asking, in silver. Null on everything that is
-- not laid out for sale, which is nearly everything.
alter table item add column if not exists price bigint;
-- And the letter a parcel is riding in, for the things in the post.
alter table item add column if not exists letter bigint;

create table if not exists deal (
  world_id uuid not null references world on delete cascade,
  n bigint generated always as identity,
  -- Who is offering, and who is being offered to.
  seller uuid not null,
  buyer uuid not null,
  -- What is being asked for it, in silver, and what is being given back.
  want bigint not null default 0,
  give bigint not null default 0,
  at timestamptz not null default now(),
  -- Set when it is taken or turned down; an open deal is one with none.
  closed_at timestamptz,
  taken boolean,
  primary key (world_id, n),
  constraint deal_sides check (seller <> buyer),
  constraint deal_coins check (want >= 0 and give >= 0 and (want = 0 or give = 0))
);
create index if not exists deal_open on deal (world_id, buyer, closed_at);
create index if not exists deal_mine on deal (world_id, seller, closed_at);

-- The things in a deal, held out of the pack while it stands so that nothing
-- offered can be eaten, sold or handed to somebody else in the meantime.
alter table item add column if not exists deal bigint;

/** What one coin of each metal is worth, counted in silver. */
create or replace function coin_worth(p_metal text) returns bigint language sql immutable as $fn$
  select case lower(coalesce(p_metal, '')) when 'gold' then 10::bigint
                                           when 'silver' then 1::bigint else 0::bigint end
$fn$;

/** What a body is carrying, in silver. */
create or replace function purse(p_world uuid, p_uid uuid) returns bigint language sql stable as $fn$
  select coalesce(sum(coin_worth(i.extra) * i.count), 0)::bigint
    from item i
   where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid
     and i.def = 'coin' and i.deal is null
$fn$;

/**
 * Take a price out of a pack, largest coin first, and give the change back in
 * silver.
 *
 * Largest first is what a person does and it is also what keeps a purse
 * usable: paying eleven out of a gold and five silver should leave you the
 * four silver rather than spending the five and breaking the gold. Returns
 * false and takes nothing when the pack cannot cover it.
 */
create or replace function take_coins(p_world uuid, p_uid uuid, p_silver bigint) returns boolean
language plpgsql as $fn$
declare r record; v_paid bigint := 0; v_take bigint;
begin
  if coalesce(p_silver, 0) <= 0 then return true; end if;
  if purse(p_world, p_uid) < p_silver then return false; end if;
  for r in select i.id, i.count, coin_worth(i.extra) as worth from item i
             where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid
               and i.def = 'coin' and i.deal is null and coin_worth(i.extra) > 0
             order by coin_worth(i.extra) desc, i.id
  loop
    exit when v_paid >= p_silver;
    v_take := least(r.count, ceil((p_silver - v_paid)::numeric / r.worth)::bigint);
    if v_take <= 0 then continue; end if;
    if v_take >= r.count then delete from item where id = r.id;
    else update item set count = count - v_take where id = r.id; end if;
    v_paid := v_paid + v_take * r.worth;
  end loop;
  if v_paid > p_silver then perform give_coins(p_world, p_uid, v_paid - p_silver); end if;
  return true;
end $fn$;

/** Put coins in a pack, in silver. Change and takings both come this way. */
create or replace function give_coins(p_world uuid, p_uid uuid, p_silver bigint) returns void
language plpgsql as $fn$
declare v_gold bigint; v_silver bigint;
begin
  if coalesce(p_silver, 0) <= 0 then return; end if;
  -- Paid out in as few coins as it takes, which is how anybody counts money.
  v_gold := p_silver / coin_worth('gold');
  v_silver := p_silver - v_gold * coin_worth('gold');
  if v_gold > 0 then
    insert into item (world_id, holder, holder_uid, def, ql, count, extra)
      values (p_world, 'player', p_uid, 'coin', 50, v_gold, 'Gold');
  end if;
  if v_silver > 0 then
    insert into item (world_id, holder, holder_uid, def, ql, count, extra)
      values (p_world, 'player', p_uid, 'coin', 50, v_silver, 'Silver');
  end if;
end $fn$;
/**
 * Offer somebody a deal.
 *
 * The terms are written down here and fixed: these things and this many
 * coins, for that many coins, aimed at one person. Whatever you put up is
 * held out of your pack while the deal stands, so nothing offered can be
 * eaten, sold, dropped or promised to somebody else in the meantime — which
 * is the property a live trade window's ready flags exist to fake, got for
 * nothing by writing the terms down.
 */
create or replace function rpc_deal(p_world uuid, p_uid uuid, p_items bigint[],
                                    p_want bigint default 0, p_give bigint default 0)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare me uuid := auth.uid(); v_n bigint; v_name text; v_count int; v_mine int;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  if p_uid is null or p_uid = me then
    return jsonb_build_object('why', 'There is nobody there to deal with.');
  end if;
  if not exists (select 1 from player where world_id = p_world and uid = me) then
    raise exception 'you are not on this island';
  end if;
  if not exists (select 1 from player where world_id = p_world and uid = p_uid) then
    return jsonb_build_object('why', 'Nobody by that name is on this island.');
  end if;
  if coalesce(p_want, 0) > 0 and coalesce(p_give, 0) > 0 then
    return jsonb_build_object('why', 'A deal asks for coins or offers them, not both.');
  end if;
  v_count := coalesce(array_length(p_items, 1), 0);
  if v_count = 0 and coalesce(p_want, 0) = 0 and coalesce(p_give, 0) = 0 then
    return jsonb_build_object('why', 'An empty offer is not an offer.');
  end if;
  -- One open deal between two people at a time, so nobody is looking at three
  -- offers from the same person and wondering which is the real one.
  if exists (select 1 from deal d where d.world_id = p_world and d.closed_at is null
               and d.seller = me and d.buyer = p_uid) then
    return jsonb_build_object('why', 'You have an offer out to them already. Take it back first.');
  end if;
  if v_count > 0 then
    select count(*) into v_mine from item i
      where i.world_id = p_world and i.id = any(p_items)
        and i.holder = 'player' and i.holder_uid = me and i.deal is null and not i.locked;
    if v_mine <> v_count then
      return jsonb_build_object('why', 'Some of that is not yours to give, or is locked.');
    end if;
  end if;
  if coalesce(p_give, 0) > 0 and purse(p_world, me) < p_give then
    return jsonb_build_object('why', 'You do not have that many coins.');
  end if;

  insert into deal (world_id, seller, buyer, want, give)
    values (p_world, me, p_uid, coalesce(p_want, 0), coalesce(p_give, 0)) returning n into v_n;
  if v_count > 0 then
    update item set deal = v_n where world_id = p_world and id = any(p_items);
  end if;
  -- And the coins, held the same way: taken out now and given back if the
  -- deal is turned down, so an offer of coins is an offer you cannot spend.
  if coalesce(p_give, 0) > 0 then
    if not take_coins(p_world, me, p_give) then
      delete from deal where world_id = p_world and n = v_n;
      return jsonb_build_object('why', 'You do not have that many coins.');
    end if;
  end if;
  v_name := folk_name(p_world, me);
  perform tell(p_world, p_uid, v_name || ' offers you a deal. (Social, to look at it)', 'system');
  return jsonb_build_object('deal', v_n, 'to', folk_name(p_world, p_uid));
end $fn$;

/** Every deal standing between this body and anybody else, both ways round. */
create or replace function rpc_deals(p_world uuid) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not signed in'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'n', d.n, 'mine', d.seller = me,
      'who', folk_name(p_world, case when d.seller = me then d.buyer else d.seller end),
      'uid', case when d.seller = me then d.buyer else d.seller end,
      'want', d.want, 'give', d.give,
      'things', coalesce((select jsonb_agg(jsonb_build_object(
            'id', i.id, 'def', i.def, 'ql', i.ql, 'dmg', i.dmg, 'count', i.count,
            'extra', i.extra, 'rare', i.rare) order by i.id)
          from item i where i.world_id = p_world and i.deal = d.n), '[]'::jsonb))
      order by d.at)
    from deal d
    where d.world_id = p_world and d.closed_at is null and me in (d.seller, d.buyer)),
    '[]'::jsonb);
end $fn$;

/**
 * Take a deal, or turn it down. The seller may also take their own back,
 * which is the same close with the same tidying.
 */
create or replace function rpc_deal_answer(p_world uuid, p_n bigint, p_yes boolean)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare me uuid := auth.uid(); d deal; v_near double precision;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  select * into d from deal where world_id = p_world and n = p_n and closed_at is null for update;
  if not found then return jsonb_build_object('why', 'That offer is gone.'); end if;
  if me not in (d.seller, d.buyer) then
    return jsonb_build_object('why', 'That offer is not yours to answer.');
  end if;

  -- Taking one back, or turning one down: everything held goes home.
  if not coalesce(p_yes, false) or me = d.seller then
    update item set deal = null where world_id = p_world and deal = d.n;
    if d.give > 0 then perform give_coins(p_world, d.seller, d.give); end if;
    update deal set closed_at = now(), taken = false where world_id = p_world and n = d.n;
    if me = d.seller then
      perform tell(p_world, d.buyer, folk_name(p_world, me) || ' has taken their offer back.', 'event');
      return jsonb_build_object('withdrawn', true);
    end if;
    perform tell(p_world, d.seller, folk_name(p_world, me) || ' turns your offer down.', 'event');
    return jsonb_build_object('refused', true);
  end if;

  -- Taking it. Both have to be standing together, because a deal struck
  -- across an island is a post office rather than a handshake.
  select greatest(abs(a.x - b.x), abs(a.y - b.y)) into v_near
    from player a, player b
   where a.world_id = p_world and a.uid = d.seller
     and b.world_id = p_world and b.uid = d.buyer;
  if v_near is null or v_near > 4 then
    return jsonb_build_object('why', 'You have to be standing together to shake on it.');
  end if;
  if d.want > 0 and purse(p_world, me) < d.want then
    return jsonb_build_object('why', 'You do not have that many coins.');
  end if;
  if d.want > 0 then
    if not take_coins(p_world, me, d.want) then
      return jsonb_build_object('why', 'You do not have that many coins.');
    end if;
    perform give_coins(p_world, d.seller, d.want);
  end if;
  if d.give > 0 then perform give_coins(p_world, me, d.give); end if;
  update item set holder_uid = me, deal = null, crate = null, placed = null
    where world_id = p_world and deal = d.n;
  update deal set closed_at = now(), taken = true where world_id = p_world and n = d.n;
  perform tell(p_world, d.seller, folk_name(p_world, me) || ' takes your offer.', 'event');
  perform tell(p_world, me, 'You shake on it.', 'event');
  return jsonb_build_object('taken', true);
end $fn$;
/**
 * A stall: set a price on something laid out on it, or take the price off.
 *
 * Only whoever set the stall up. A price on somebody else's goods would be a
 * way of selling what is not yours.
 */
create or replace function rpc_price(p_world uuid, p_item bigint, p_silver bigint)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare me uuid := auth.uid(); v_it item; v_pl placed;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  select * into v_it from item where world_id = p_world and id = p_item;
  if not found or v_it.placed is null then
    return jsonb_build_object('why', 'That is not laid out on anything.');
  end if;
  select * into v_pl from placed where world_id = p_world and id = v_it.placed;
  if not found or not coalesce((select stall from furniture_def where id = v_pl.kind), false) then
    return jsonb_build_object('why', 'Only what is on a stall can carry a price.');
  end if;
  if v_pl.made_by is distinct from me then
    return jsonb_build_object('why', 'That is not your stall.');
  end if;
  update item set price = case when coalesce(p_silver, 0) > 0 then p_silver end
    where world_id = p_world and id = p_item;
  return jsonb_build_object('priced', coalesce(p_silver, 0));
end $fn$;

/**
 * Buy something off a stall.
 *
 * The coins go into the stall's till rather than to its owner, because its
 * owner is very likely asleep. They empty it when they next come by, and
 * until they do it sits there — which is the whole point of a stall and the
 * only thing on this island that does anything for you while you are away.
 */
create or replace function rpc_buy(p_world uuid, p_item bigint)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare me uuid := auth.uid(); v_it item; v_pl placed; p player; v_name text;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  select * into p from player where world_id = p_world and uid = me;
  if not found then raise exception 'you are not on this island'; end if;
  select * into v_it from item where world_id = p_world and id = p_item for update;
  if not found or v_it.price is null or v_it.placed is null then
    return jsonb_build_object('why', 'That is not for sale.');
  end if;
  select * into v_pl from placed where world_id = p_world and id = v_it.placed;
  if not found then return jsonb_build_object('why', 'That is not for sale.'); end if;
  if v_pl.made_by = me then
    return jsonb_build_object('why', 'It is your own stall. Take it back off the counter instead.');
  end if;
  if greatest(abs(v_pl.x + 0.5 - p.x), abs(v_pl.y + 0.5 - p.y)) > 2.4 then
    return jsonb_build_object('why', 'Stand at the counter.');
  end if;
  if purse(p_world, me) < v_it.price then
    return jsonb_build_object('why', 'You cannot afford it. It is ' || v_it.price || ' silver.');
  end if;
  if not take_coins(p_world, me, v_it.price) then
    return jsonb_build_object('why', 'You cannot afford it.');
  end if;
  update placed set till = till + v_it.price where world_id = p_world and id = v_pl.id;
  v_name := lower(coalesce((select name from item_def where id = v_it.def), v_it.def));
  update item set holder = 'player', holder_uid = me, placed = null, price = null
    where world_id = p_world and id = v_it.id;
  if v_pl.made_by is not null then
    perform tell(p_world, v_pl.made_by, folk_name(p_world, me) || ' buys your ' || v_name
      || ' for ' || v_it.price || ' silver.', 'event');
  end if;
  return jsonb_build_object('bought', v_name, 'paid', v_it.price);
end $fn$;

/** Empty a stall's till into your own pocket. */
create or replace function rpc_takings(p_world uuid, p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare me uuid := auth.uid(); v_pl placed; p player; v_had bigint;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  select * into p from player where world_id = p_world and uid = me;
  select * into v_pl from placed where world_id = p_world and id = p_id for update;
  if not found then return jsonb_build_object('why', 'It is gone.'); end if;
  if v_pl.made_by is distinct from me then return jsonb_build_object('why', 'That is not your stall.'); end if;
  if greatest(abs(v_pl.x + 0.5 - p.x), abs(v_pl.y + 0.5 - p.y)) > 2.4 then
    return jsonb_build_object('why', 'Stand at the counter.');
  end if;
  v_had := v_pl.till;
  if v_had <= 0 then return jsonb_build_object('why', 'The till is empty.'); end if;
  update placed set till = 0 where world_id = p_world and id = p_id;
  perform give_coins(p_world, me, v_had);
  return jsonb_build_object('took', v_had);
end $fn$;
/** Whether this body is standing at a mailbox, and which one. */
create or replace function mailbox_at(p_world uuid, p_uid uuid) returns placed
language sql stable as $fn$
  select pl.* from placed pl, player p
   where pl.world_id = p_world and p.world_id = p_world and p.uid = p_uid
     and coalesce((select post from furniture_def where id = pl.kind), false)
     and greatest(abs(pl.x + 0.5 - p.x), abs(pl.y + 0.5 - p.y)) <= 2.4
   limit 1
$fn$;

/**
 * Post a parcel with a letter.
 *
 * A letter has carried four hundred characters and nothing else since letters
 * landed. What goes in here rides with it: out of your pack at one mailbox
 * and into theirs at any other, which is what turns writing to somebody into
 * sending them something.
 *
 * Both ends want a box. That is the whole rule and it is what makes a mailbox
 * worth nailing up: without one you may still write, and nothing but words
 * will cross the island.
 */
create or replace function rpc_parcel(p_world uuid, p_uid uuid, p_text text, p_items bigint[])
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare me uuid := auth.uid(); v_box placed; v_n bigint; v_count int; v_mine int; v_said jsonb;
begin
  if me is null then raise exception 'not signed in'; end if;
  v_count := coalesce(array_length(p_items, 1), 0);
  if v_count = 0 then return rpc_letter(p_world, p_uid, p_text); end if;
  v_box := mailbox_at(p_world, me);
  if v_box.id is null then
    return jsonb_build_object('why', 'Stand at a mailbox to send anything but words.');
  end if;
  select count(*) into v_mine from item i
    where i.world_id = p_world and i.id = any(p_items)
      and i.holder = 'player' and i.holder_uid = me and i.deal is null and not i.locked;
  if v_mine <> v_count then
    return jsonb_build_object('why', 'Some of that is not yours to send, or is locked.');
  end if;
  -- The words first, through the door that already rate-limits and cleans
  -- them; a parcel with no letter to ride in is not a thing the post carries.
  v_said := rpc_letter(p_world, p_uid, coalesce(nullif(btrim(coalesce(p_text, '')), ''), 'A parcel.'));
  if v_said ? 'why' then return v_said; end if;
  v_n := (v_said->>'n')::bigint;
  if v_n is null then
    select max(n) into v_n from letter where world_id = p_world and sender = me and reader = p_uid;
  end if;
  update item set holder = 'post', holder_uid = p_uid, letter = v_n,
                  crate = null, placed = null
    where world_id = p_world and id = any(p_items);
  perform tell(p_world, p_uid, folk_name(p_world, me) || ' has sent you a parcel. (Any mailbox)', 'system');
  return v_said || jsonb_build_object('parcel', v_count);
end $fn$;

/** What is waiting in the post for this body, whether or not they are at a box. */
create or replace function rpc_parcels(p_world uuid) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not signed in'; end if;
  return jsonb_build_object(
    'at_box', (mailbox_at(p_world, me)).id is not null,
    'things', coalesce((select jsonb_agg(jsonb_build_object(
        'id', i.id, 'def', i.def, 'ql', i.ql, 'dmg', i.dmg, 'count', i.count,
        'extra', i.extra, 'rare', i.rare, 'letter', i.letter,
        'from', folk_name(p_world, l.sender)) order by i.id)
      from item i left join letter l on l.world_id = i.world_id and l.n = i.letter
      where i.world_id = p_world and i.holder = 'post' and i.holder_uid = me), '[]'::jsonb));
end $fn$;

/** Draw what is waiting out of the box you are standing at. */
create or replace function rpc_collect(p_world uuid) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare me uuid := auth.uid(); v_box placed; v_count int;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  v_box := mailbox_at(p_world, me);
  if v_box.id is null then return jsonb_build_object('why', 'Stand at a mailbox.'); end if;
  select count(*) into v_count from item
    where world_id = p_world and holder = 'post' and holder_uid = me;
  if v_count = 0 then return jsonb_build_object('why', 'Nothing is waiting for you.'); end if;
  update item set holder = 'player', letter = null
    where world_id = p_world and holder = 'post' and holder_uid = me;
  return jsonb_build_object('took', v_count);
end $fn$;

select private.lock_doors();
