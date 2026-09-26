/*
 * An altar goes up on your own ground.
 *
 * Asked for: "Make the altar only craftable within deed perimeter." A recipe
 * may now say it is worked only by somebody standing on a settlement of
 * theirs -- one they founded or one they are a citizen of, which is what
 * `on_my_deed` answers and what every other "on your deed" rule here asks --
 * and the altar is the one that says so. The flag is `recipe.deed`, crossed
 * in the defs just before this from the browser's own `Recipe.deed`, so the
 * two cannot come apart; the words are the browser's `DEED_ONLY`.
 *
 * It is asked where the crafter stands, the tile under their feet, the same
 * tile the browser asks about. What a craft reaches for is unchanged: the
 * stones may still come out of a crate three tiles off.
 */
set local lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.craft_refusal(p_world uuid, p_uid uuid, p_recipe text, p_prefer bigint)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare r recipe; i record; mat text; have int; tx int; ty int;
begin
  select * into r from recipe where id = p_recipe;
  if not found then return null; end if;
  if r.tool is not null and tool_ql(p_world, p_uid, r.tool) <= 0 then
    return 'You need a ' || lower((select coalesce(name, r.tool) from item_def where id = r.tool)) || '.';
  end if;
  if r.station is not null and not at_station(p_world, p_uid, r.station) then
    return 'You need to stand at a ' || station_name(r.station) || '.';
  end if;
  if r.deed then
    select floor(p.x)::int, floor(p.y)::int into tx, ty
      from player p where p.world_id = p_world and p.uid = p_uid;
    if tx is null or not on_my_deed(p_world, p_uid, tx, ty) then
      return 'You can only build this standing on a settlement of yours.';
    end if;
  end if;
  mat := craft_material(p_world, p_uid, p_recipe, p_prefer);
  for i in select * from recipe_input where recipe = p_recipe order by ord loop
    have := greatest(craft_count(p_world, p_uid, i.item, mat, p_prefer), craft_count(p_world, p_uid, i.item, null, p_prefer));
    if have < i.count then
      return (select coalesce(name, r.result) from item_def where id = r.result)
        || ' takes ' || i.count || ' ' || plural_of(i.item, i.count) || '.';
    end if;
  end loop;
  return null;
end $function$;

select private.lock_doors();
