/*
 * What everybody on an island has on.
 *
 * A body is drawn in what it wears: every piece of armour, the weapon in its
 * hand and the shield on its arm, each in its own material, dye and rarity
 * (src/render/figure.ts). Your own the browser knows. Somebody else's it
 * cannot read: `item_read` shows you your own pack and the ground, and
 * `player.equipped` only holds the ids of the things. A body that walks or
 * changes what it has on says so itself, on the Broadcast channel with its
 * position (src/net/island.ts); this is for everybody who was already
 * standing still when you came ashore, and for all of them again after a
 * reload.
 *
 * Only what shows: which thing, how rare, what it is made of and the colour it
 * took, as [def, rarity 0 to 3, material, dye]. Never its quality, its damage
 * or anything else about it, and only a thing its wearer still holds. Only to
 * somebody with a body on the island, as `player_read` has it; nobody else is
 * told anything.
 */
set local lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.rpc_worn(p_world uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not signed in'; end if;
  if not private.on_island(p_world) then return '{}'::jsonb; end if;
  return coalesce((
    select jsonb_object_agg(p.uid::text, w.gear)
      from player p
      cross join lateral (
        select jsonb_object_agg(e.key, jsonb_build_array(i.def,
                 case i.rare when 'rare' then 1 when 'supreme' then 2 when 'fantastic' then 3 else 0 end,
                 i.extra, i.dye)) as gear
          from jsonb_each(p.equipped) e
          join item i on i.id = case when jsonb_typeof(e.value) = 'number' then (e.value)::text::bigint end
                     and i.world_id = p_world
                     and i.holder = 'player' and i.holder_uid = p.uid
      ) w
     where p.world_id = p_world and w.gear is not null
  ), '{}'::jsonb);
end $function$;

select private.lock_doors();
