-- What is in the crate, said out loud.
--
-- Reported from the island: "if I put things in the deed crate it
-- automatically puts them back in my inventory in like 2 seconds."
--
-- They did not come back. They never went in — or rather, the island put them
-- in and the browser had no way of ever knowing it. `sawGround` builds every
-- crate with `items: []`, because `rpc_ground` has never sent the contents, so
-- on an island every crate is drawn empty for ever and the pack is re-read
-- from the island a moment later with whatever is really in it. Put something
-- in a crate and watch the crate: nothing arrives. Watch your pack: it settles
-- back to the truth. It reads exactly like a crate that spits things out.
--
-- Worse than the look of it, the browser's own refusal is worked out from that
-- empty copy: "the crate is full" is decided by counting `items`, which is
-- always nought, so the browser waves through a store the island then refuses
-- — and says nothing anybody would connect to the crate.
--
-- Two numbers rather than one, because they cost differently:
--
--   * `units` for every crate in sight. A label saying how full something is
--     does not need to know what is in it.
--   * `things` only for crates within six tiles. You have to be within two and
--     a half to reach into one, so six is generous — and a settlement yard
--     with five full crates in it would otherwise cost a phone the better part
--     of a hundred kilobytes every three seconds for contents nobody is
--     looking at.
CREATE OR REPLACE FUNCTION public.rpc_ground(p_world uuid, p_range double precision DEFAULT 40)
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
  if not found then raise exception 'you are not on this island'; end if;
  return jsonb_build_object(
    'placed', coalesce((select jsonb_agg(
        (to_jsonb(pl) - 'world_id' - 'made_by' - 'since' - 'made_at' - 'cx' - 'cy')
        || jsonb_build_object('fuel', placed_fuel(pl), 'ash', placed_ash(pl),
                              'lit', placed_lit(pl), 'mine', coalesce(pl.made_by = me, false))
        order by pl.id)
      from placed pl
      where pl.world_id = p_world
        and greatest(abs(pl.cx - p.x), abs(pl.cy - p.y)) <= p_range), '[]'::jsonb),
    'crates', coalesce((select jsonb_agg((to_jsonb(c) - 'world_id' - 'made_by')
        || jsonb_build_object(
             'mine', crate_yours(p_world, me, c.id),
             -- How full it is, for every crate in sight: a label does not need
             -- the contents and the contents are not free.
             'units', crate_units(p_world, c.id),
             -- And what is actually in it, for the ones you could reach into.
             -- You must be within two and a half tiles to put anything in or
             -- take anything out, so six is generous and keeps a yard full of
             -- crates from costing a phone a hundred kilobytes every three
             -- seconds.
             'things', case when greatest(abs(crate_centre_x(c) - p.x), abs(crate_centre_y(c) - p.y)) <= 6
               then coalesce((select jsonb_agg(jsonb_build_object(
                     'id', i.id, 'def', i.def, 'ql', i.ql, 'dmg', i.dmg,
                     'count', i.count, 'extra', i.extra) order by i.id)
                   from item i where i.world_id = p_world and i.holder = 'crate' and i.crate = c.id),
                 '[]'::jsonb)
               else '[]'::jsonb end) order by c.id)
      from crate c
      where c.world_id = p_world
        and greatest(abs(c.x + 0.5 - p.x), abs(c.y + 0.5 - p.y)) <= p_range), '[]'::jsonb),
    'deed', (select jsonb_build_object(
        'name', d.name, 'x', d.x, 'y', d.y, 'radius', d.radius, 'level', d.level, 'mine', true)
      from my_deed(p_world, me) d where d.world_id is not null),
    'deeds', coalesce((select jsonb_agg(jsonb_build_object(
        'name', d.name, 'x', d.x, 'y', d.y, 'radius', d.radius, 'level', d.level,
        'mine', false, 'holder', account_name(d.founded_by)) order by d.founded_at)
      from deed d
      where d.world_id = p_world and d.founded_by <> me
        and greatest(abs(d.x + 0.5 - p.x), abs(d.y + 0.5 - p.y)) <= p_range + d.radius),
      '[]'::jsonb));
end $function$;

select private.lock_doors();
