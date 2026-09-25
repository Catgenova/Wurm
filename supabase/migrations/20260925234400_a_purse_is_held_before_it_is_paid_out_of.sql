/*
 * A purse is held before it is paid out of.
 *
 * `take_coins` counted the purse and then took coins out of it, and nothing
 * stopped a second payment out of the same purse counting it in between: two
 * tabs buying off two stalls at the same moment both found the money there,
 * and the second took coins the first had already taken -- a delete that
 * found nothing, an update of a count already spent -- and was told it had
 * paid. `rpc_buy` holds the thing being bought, not the buyer's purse, and
 * so did every other door that pays: `rpc_deal`, `rpc_deal_answer` and
 * `rpc_take_class`. Buy orders hold the purse's coins first (`rpc_order`),
 * and now every payment does, here, in the one place they all pay through:
 * the second waits for the first and counts what the first left.
 */
set local lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.take_coins(p_world uuid, p_uid uuid, p_silver bigint)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
declare r record; v_paid bigint := 0; v_take bigint;
begin
  if coalesce(p_silver, 0) <= 0 then return true; end if;
  -- The purse is held before it is counted, so that a second payment out of
  -- it at the same moment waits for this one and counts what is left.
  perform 1 from item i
    where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid
      and i.def = 'coin' and i.deal is null
    order by i.id
    for update;
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
end $function$;

select private.lock_doors();
