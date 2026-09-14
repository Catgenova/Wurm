-- Who may read what, and who may write anything at all.
--
-- The answer to the second is nobody. Every table below has row level security
-- on and not one write policy, so a client holding the publishable key can
-- select and nothing else. Changes happen only through the `rpc_` functions,
-- which run as their owner and so pass straight through these policies — which
-- is exactly what "Postgres enforces the rules" means in practice: the rules
-- are not a layer a client is asked to go through, they are the only door.

alter table world enable row level security;
alter table land_corner enable row level security;
alter table land_tile enable row level security;
alter table player enable row level security;
alter table skill enable row level security;
alter table item enable row level security;
alter table tile_change enable row level security;
alter table event enable row level security;

drop policy if exists world_read on world;
create policy world_read on world for select to authenticated using (true);

drop policy if exists land_corner_read on land_corner;
create policy land_corner_read on land_corner for select to authenticated using (true);
drop policy if exists land_tile_read on land_tile;
create policy land_tile_read on land_tile for select to authenticated using (true);
drop policy if exists tile_change_read on tile_change;
create policy tile_change_read on tile_change for select to authenticated using (true);

/** Everybody on an island you are on is visible to you; nobody else is. */
drop policy if exists player_read on player;
create policy player_read on player for select to authenticated using (
  exists (select 1 from player mine where mine.world_id = player.world_id and mine.uid = auth.uid())
);

/** What you have learned is yours. Reading it off somebody else is not a thing. */
drop policy if exists skill_read on skill;
create policy skill_read on skill for select to authenticated using (uid = auth.uid());

/** Your own pack, and anything lying on the ground where anyone could see it. */
drop policy if exists item_read on item;
create policy item_read on item for select to authenticated using (
  (holder = 'player' and holder_uid = auth.uid()) or holder = 'ground'
);

/** Lines meant for you, and lines meant for the whole island. */
drop policy if exists event_read on event;
create policy event_read on event for select to authenticated using (uid = auth.uid() or uid is null);

-- A real project already has this; a database built from these files alone
-- does not, and without it every select below fails as "relation does not
-- exist" — which is a confusing way to be told about a missing grant.
grant usage on schema public to anon, authenticated;

-- The definition tables are the rulebook: public, and the same for everyone.
grant select on item_def, tile_def, skill_def, material_def, action_def to anon, authenticated;
grant select on world, land_corner, land_tile, player, skill, item, tile_change, event to authenticated;
