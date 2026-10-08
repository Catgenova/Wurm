set local lock_timeout = '3s';

/*
 * Ground moved between islands, and the door it is carried through.
 *
 * The land travels once, at founding; the generator is a wire format with one
 * message in it. On 8 October the message changed: glimmersteel went from the
 * Northeast Tundra to West Skerry, the plum from the tundra to East Isle, and
 * the tundra was stripped to plain rock with marble and gold under its
 * mountain. An island founded before that holds the old ground, and every
 * browser now works out the new ground from the seed.
 *
 * `tools/move-ground.ts` reads an island's land, works the new ground out, and
 * writes the difference through this, a row at a time: the rock bytes it is
 * handed, which nothing after founding ever writes, and each tree byte only if
 * the tile is still a tree with the byte it was read with, so a tree felled or
 * aged in between is left as the island has it. The row is held while it is
 * written.
 *
 * `land_move` remembers which move each island has had, so a deploy after the
 * first finds nothing to do and reads no land.
 */
create table if not exists land_move (
  world_id uuid not null references world(id) on delete cascade,
  move text not null,
  rock int not null default 0,
  trees int not null default 0,
  at timestamptz not null default now(),
  primary key (world_id, move)
);
alter table land_move enable row level security;
revoke all on land_move from anon, authenticated;

create or replace function land_regrow_row(
  p_world uuid, p_y int,
  p_rock_x int[], p_rock int[],
  p_tree_x int[], p_tree_from int[], p_tree_to int[], p_tree int
) returns int language plpgsql as $$
declare r bytea; d bytea; t bytea; i int; n int := 0;
begin
  select l.rock, l.data, l.tiles into r, d, t from land_tile l
   where l.world_id = p_world and l.y = p_y for update;
  if not found then return 0; end if;
  for i in 1 .. coalesce(array_length(p_rock_x, 1), 0) loop
    if get_byte(r, p_rock_x[i]) <> p_rock[i] then
      r := set_byte(r, p_rock_x[i], p_rock[i]);
      n := n + 1;
    end if;
  end loop;
  for i in 1 .. coalesce(array_length(p_tree_x, 1), 0) loop
    if get_byte(t, p_tree_x[i]) = p_tree and get_byte(d, p_tree_x[i]) = p_tree_from[i] then
      d := set_byte(d, p_tree_x[i], p_tree_to[i]);
      n := n + 1;
    end if;
  end loop;
  if n > 0 then
    update land_tile l set rock = r, data = d where l.world_id = p_world and l.y = p_y;
  end if;
  return n;
end $$;

select private.lock_doors();
