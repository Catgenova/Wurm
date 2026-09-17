-- A wood that keeps itself: four days from a sapling to a stump, and two
-- saplings out of the stump
--
-- Asked from the island: *"trees need a life cycle. an old tree, when dying,
-- plants two saplings nearby. have each cycle last a real life day."*
--
-- Until now nothing on this island grew a tree from one age to the next. Every
-- wood was exactly the wood the generator laid down, for ever, minus whatever
-- had been cut out of it — which is why the last change had to put saplings in
-- the wild by hand rather than let them be planted, and said so.
--
--     sapling --a day--> young --a day--> mature --a day--> old --a day--> gone
--
-- and the gone one leaves `tree_seeds()` saplings of its own kind within
-- `tree_seed_reach()` tiles, so a wood left alone stays a wood and a wood cut
-- flat stays flat until somebody plants in it.
--
-- ## A real day, and each tree keeps its own hour of it
--
-- `tree_stage()` is wall clock seconds, not the world's faster hours: a tree
-- planted on a Tuesday is a young tree on Wednesday. But a whole island turning
-- over on the same instant is a forest that dies all at once and comes back all
-- at once, so the hour of the day a given tree has its birthday is its own —
-- `tree_phase` takes it from the tile's own coordinates and the island's seed,
-- which means it is the same answer every time it is asked and needs nothing
-- written down to remember it.
--
-- What *is* written down is one timestamp and one cursor per island.
-- `tree_sweep` walks the map `tree_rows()` lines at a time, and a tree is due
-- exactly when a day boundary of its own falls between the start of this pass
-- and now. The land is a row of bytes per northing, so a row with no tree in it
-- at all is thrown out whole by one `position` over the bytes; only rows that
-- hold a tree are read one byte at a time.
--
-- ## An island nobody is on does not grow
--
-- `world_tick` has never looked at a world with nobody on it — not for
-- settling, not for creatures, not for what is rotting on the ground — and the
-- woods are no different. A tree takes at most one step per pass, so an island
-- left alone for a week does not come back a week older; it picks its cycle up
-- from the moment somebody walks onto it again. On an island with anybody on it
-- at all, a pass comes round every couple of minutes and a stage is a day to
-- the second.
--
-- ## Growing closes a notch
--
-- A year's growth takes the cuts back out of the bark. It also means a tree
-- half-felled and left cannot be finished a year later with one stroke, which
-- is right, and it keeps the cut count honest against an age whose `hits` has
-- changed underneath it.

alter table world add column if not exists trees_at timestamptz not null default now();
alter table world add column if not exists trees_row int not null default 0;

/** The stage nothing else grows into: the beginning of a tree. */
create or replace function tree_first() returns int
  language sql stable as $fn$
  select id from tree_age_def
   where id not in (select next from tree_age_def where next is not null)
   limit 1
$fn$;

/**
 * Where in its own day this tile's birthday falls, in seconds.
 *
 * From the tile and the island's seed, so it is the same answer for ever and
 * nothing has to be stored to know it — and so that two trees side by side do
 * not turn over together.
 */
create or replace function tree_phase(p_seed bigint, p_x int, p_y int)
  returns double precision language sql immutable as $fn$
  select (abs(hashtextextended(p_seed::text || ':' || p_x || ':' || p_y, 0)) % 1000000)::double precision
       / 1000000 * tree_stage()
$fn$;

/** Whether a day of this tree's own has turned between two moments. */
create or replace function tree_due(p_seed bigint, p_x int, p_y int,
                                    p_from double precision, p_to double precision)
  returns boolean language sql immutable as $fn$
  select floor((p_to - tree_phase(p_seed, p_x, p_y)) / tree_stage())
       > floor((p_from - tree_phase(p_seed, p_x, p_y)) / tree_stage())
$fn$;

/**
 * What an old tree leaves behind it.
 *
 * Its own kind, on ground a sprout could have been planted in, and not inside
 * anybody's settlement: a wood is welcome to spread, and not over the place
 * somebody has levelled and built on.
 */
create or replace function tree_seed(p_world uuid, p_x int, p_y int, p_species int)
  returns int language plpgsql as $fn$
declare r record; v_n int := 0; sz int;
begin
  select size into sz from world where id = p_world;
  for r in
    select q.gx, q.gy from (
      select p_x + dx as gx, p_y + dy as gy
      from generate_series(-tree_seed_reach()::int, tree_seed_reach()::int) dx,
           generate_series(-tree_seed_reach()::int, tree_seed_reach()::int) dy
      where not (dx = 0 and dy = 0)
    ) q
    where q.gx >= 0 and q.gy >= 0 and q.gx < sz and q.gy < sz
      and exists (select 1 from plantable pl where pl.tile = land_tile(p_world, q.gx, q.gy))
      and not exists (select 1 from deed_covering(p_world, q.gx, q.gy))
    order by random() limit tree_seeds()::int
  loop
    perform land_set_tile(p_world, r.gx, r.gy, tile_id('Tree'));
    perform land_set_data(p_world, r.gx, r.gy, (p_species & 15) | (tree_first() << 4));
    perform land_announce(p_world, r.gx, r.gy);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $fn$;

/**
 * One pass of the woods: a slice of the island's lines, and every tree in them
 * that has had a birthday since the pass began.
 */
create or replace function tree_sweep(p_world uuid) returns int
  language plpgsql as $fn$
declare w record; v_from double precision; v_to double precision;
        v_y int; v_last int; i int; v_data int; v_age tree_age_def;
        v_moved int := 0; v_tiles bytea[]; v_datas bytea[];
begin
  select * into w from world where id = p_world;
  if not found or not w.ready then return 0; end if;
  v_from := extract(epoch from w.trees_at);
  v_to := extract(epoch from now());
  v_last := least(w.size - 1, w.trees_row + tree_rows() - 1);

  /*
   * The whole slice as it stood when the pass reached it.
   *
   * Read up front rather than row by row, because a stump seeds its
   * neighbours: a sapling dropped into a line this pass had not got to yet was
   * read as an ordinary tree standing there since the pass began, had the same
   * day counted against it, and grew a stage the moment it was born. The suite
   * caught it as "sapling oak, young oak" out of one stump.
   */
  select array_agg(t.tiles order by t.y), array_agg(t.data order by t.y)
    into v_tiles, v_datas
    from land_tile t where t.world_id = p_world and t.y between w.trees_row and v_last;

  for v_y in w.trees_row .. v_last loop
    if v_tiles is null or v_y - w.trees_row + 1 > array_length(v_tiles, 1) then continue; end if;
    -- A line with nothing standing on it is thrown out whole rather than read.
    if position('\x10'::bytea in v_tiles[v_y - w.trees_row + 1]) = 0 then continue; end if;
    for i in 0 .. w.size - 1 loop
      if get_byte(v_tiles[v_y - w.trees_row + 1], i) <> 16 then continue; end if;
      if not tree_due(w.seed, i, v_y, v_from, v_to) then continue; end if;
      v_data := get_byte(v_datas[v_y - w.trees_row + 1], i);
      select * into v_age from tree_age_def where id = ((v_data >> 4) & 3);
      if not found then continue; end if;
      v_moved := v_moved + 1;
      if v_age.next is null then
        perform land_set_tile(p_world, i, v_y, tile_id('Grass'));
        perform land_set_data(p_world, i, v_y, 0);
        perform land_announce(p_world, i, v_y);
        perform tree_seed(p_world, i, v_y, v_data & 15);
      else
        -- A year's growth closes whatever was cut into it.
        perform land_set_data(p_world, i, v_y, (v_data & 15) | (v_age.next << 4));
        perform land_announce(p_world, i, v_y);
      end if;
    end loop;
  end loop;

  if v_last >= w.size - 1 then
    update world set trees_row = 0, trees_at = now() where id = p_world;
  else
    update world set trees_row = v_last + 1 where id = p_world;
  end if;
  return v_moved;
end $fn$;

select private.lock_doors();

/*
 * And the woods into the round, beside everything else the clock keeps.
 */
CREATE OR REPLACE FUNCTION public.world_tick()
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare v_rotted int := 0; w record; p record; v_lit int := 0; v_grew int := 0;
        v_worlds int := 0; v_settled int := 0; v_stirred int := 0;
        v_sprung int := 0; v_gone int := 0;
        v_said int := 0; v_folded int := 0; v_sunk int := 0;
        v_tidy boolean := false;
begin
  /*
   * One round at a time.
   *
   * `pg_cron` starts a job on its schedule whether or not the last one has
   * finished, and at a second there is far less room than there was at five.
   * Nothing here can settle a job twice — `settle` takes `for update` on the
   * player row and re-checks `act_ends <= now()` — but two rounds fighting
   * over the same rows is work neither of them needed to do. A round that
   * finds the clock already turning goes back to bed; its work is due again
   * in a second.
   */
  if not pg_try_advisory_lock(hashtext('world_tick')::bigint) then
    return jsonb_build_object('worlds', 0, 'busy', true);
  end if;

  -- The tidying is not the settling and does not want the settling's pace: a
  -- scan every five seconds to delete nothing is just a scan.
  update keeper set swept_at = now()
    where one and swept_at < now() - make_interval(secs => sweep_every());
  v_tidy := found;

  for w in
    select id from world where ready and exists (
      select 1 from player
      where player.world_id = world.id and not player.away
        and player.seen_at > now() - make_interval(secs => idle_logout()))
    order by id limit tick_worlds()
  loop
    v_worlds := v_worlds + 1;

    -- Everything anybody has finished doing, and the next go of it.
    for p in select uid from player
      where world_id = w.id and act is not null and act_ends <= now()
      order by uid limit tick_players()
    loop
      v_settled := v_settled + settle(w.id, p.uid);
    end loop;

    /*
     * The country round everybody still on their feet — once per patch of it.
     *
     * A crowd at a token or a mine face is a dozen bodies on one tile, and
     * this swept the same ground for each of them. Deduping on the tile is the
     * conservative version of that: two people standing together cost one
     * sweep, two people a tile apart still cost two, and nothing that was
     * being stirred stops being stirred. The index under the sweep took most
     * of this win before this line did — it is a tenth of a millisecond now
     * rather than half of one — so the safe reading is the right one.
     */
    for p in select distinct floor(x) as x, floor(y) as y from player
      where world_id = w.id and not away
        and seen_at > now() - make_interval(secs => idle_logout())
      order by 1, 2 limit tick_players()
    loop
      v_stirred := v_stirred + creature_sweep(w.id, p.x, p.y);
    end loop;

    v_sprung := v_sprung + trap_sweep(w.id) + post_sweep(w.id);
    -- And the braziers, which take at dusk and are raked out at dawn.
    v_lit := v_lit + brazier_sweep(w.id);
    -- And what is lying about, going off where it lies.
    v_rotted := v_rotted + ground_sweep(w.id);
    -- And a slice of the woods, which have their own day to keep.
    v_grew := v_grew + tree_sweep(w.id);
    v_gone := v_gone + log_out_idle(w.id);

    if v_tidy then
      v_said := v_said + prune_events(w.id);
      v_folded := v_folded + compact_changes(w.id);
    end if;
  end loop;

  if v_tidy then v_sunk := reap_islands(); end if;

  perform pg_advisory_unlock(hashtext('world_tick')::bigint);
  return jsonb_build_object('worlds', v_worlds, 'settled', v_settled, 'rotted', v_rotted,
                            'stirred', v_stirred, 'sprung', v_sprung, 'left', v_gone,
                            'swept', v_said, 'folded', v_folded, 'sunk', v_sunk,
                            'braziers', v_lit, 'grew', v_grew);
end $function$;

notify pgrst, 'reload schema';
select private.lock_doors();
