-- A run of deck between two banks.
--
-- Water and ravines have been walls until now: the map is full of places you
-- can see across and cannot get to. A bridge is deck between two pieces of
-- solid ground at much the same height, standing over whatever is in between,
-- and once it is finished it is simply ground.
--
-- ## A bridge is a wall that happens to be horizontal
--
-- Which is to say it needed no new machinery. A wall is a bill of materials
-- that comes down one unit at a time as somebody works at it, and so is a tile
-- of deck. The one thing a bridge has that a wall has not is that there are
-- several of them in a row and they are built in order, so `bridge_span` is
-- the wall table with an index on it and `bridge` is the pair of banks.

create table if not exists bridge (
  world_id uuid not null references world(id) on delete cascade,
  id bigint generated always as identity,
  kind text not null,
  ax int not null, ay int not null,
  bx int not null, by int not null,
  height int not null,
  material text,
  made_by uuid,
  made_at timestamptz not null default now(),
  primary key (world_id, id)
);
create table if not exists bridge_span (
  world_id uuid not null,
  bridge bigint not null,
  n int not null,
  x int not null, y int not null,
  needed jsonb not null,
  total jsonb not null,
  primary key (world_id, bridge, n)
);
create index if not exists bridge_span_where on bridge_span (world_id, x, y);

alter table bridge enable row level security;
alter table bridge_span enable row level security;
drop policy if exists bridge_read on bridge;
create policy bridge_read on bridge for select to authenticated using (true);
drop policy if exists bridge_span_read on bridge_span;
create policy bridge_span_read on bridge_span for select to authenticated using (true);
grant select on bridge, bridge_span to authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table bridge;
    exception when duplicate_object then null; end;
    begin
      alter publication supabase_realtime add table bridge_span;
    exception when duplicate_object then null; end;
  end if;
end $$;

/** The tiles a bridge's deck covers, ends excluded. */
create or replace function span_tiles(p_ax int, p_ay int, p_bx int, p_by int)
  returns table (n int, x int, y int) language plpgsql immutable as $$
declare dx int := sign(p_bx - p_ax); dy int := sign(p_by - p_ay); i int := 0;
begin
  if dx <> 0 and dy <> 0 then return; end if;
  x := p_ax + dx; y := p_ay + dy;
  while x <> p_bx or y <> p_by loop
    i := i + 1; n := i;
    return next;
    x := x + dx; y := y + dy;
  end loop;
end $$;

create or replace function bridge_at(p_world uuid, p_x int, p_y int) returns bigint
  language sql stable as $$
  select b.id from bridge b
  where b.world_id = p_world
    and ((b.ax = p_x and b.ay = p_y) or (b.bx = p_x and b.by = p_y)
         or exists (select 1 from bridge_span s where s.world_id = p_world and s.bridge = b.id
                      and s.x = p_x and s.y = p_y))
  limit 1
$$;

create or replace function bridge_name(b bridge) returns text language sql stable as $$
  select (select name from bridge_def where id = b.kind)
       || coalesce(' (' || lower(b.material) || ')', '')
$$;

/** One tile of deck, unbuilt. */
create or replace function span_bill(p_kind text) returns jsonb language sql stable as $$
  select coalesce(jsonb_object_agg(item, count), '{}'::jsonb)
  from bridge_bill where kind = p_kind
$$;

create or replace function span_done(p_needed jsonb) returns boolean language sql immutable as $$
  select not exists (select 1 from jsonb_each(p_needed) e where (e.value)::int > 0)
$$;

/** What one tile of deck still wants, written out. */
create or replace function span_wants(p_needed jsonb) returns text language sql stable as $$
  select coalesce(string_agg((e.value)::int || ' ' ||
    lower((select coalesce(name, e.key) from item_def where id = e.key)), ', ' order by e.key),
    'nothing')
  from jsonb_each(p_needed) e where (e.value)::int > 0
$$;

create or replace function bridge_left(p_world uuid, p_id bigint) returns int language sql stable as $$
  select count(*)::int from bridge_span s
  where s.world_id = p_world and s.bridge = p_id and not span_done(s.needed)
$$;

create or replace function bridge_state(p_world uuid, p_id bigint) returns text language plpgsql stable as $$
declare n int; left_n int; done_units double precision := 0; total_units double precision := 0; r record;
begin
  select count(*)::int into n from bridge_span s where s.world_id = p_world and s.bridge = p_id;
  left_n := bridge_left(p_world, p_id);
  if left_n = 0 then return n || ' tiles · finished'; end if;
  for r in select needed, total from bridge_span s where s.world_id = p_world and s.bridge = p_id loop
    total_units := total_units + (select coalesce(sum((e.value)::int), 0) from jsonb_each(r.total) e);
    done_units := done_units + (select coalesce(sum((e.value)::int), 0) from jsonb_each(r.total) e)
                             - (select coalesce(sum((e.value)::int), 0) from jsonb_each(r.needed) e);
  end loop;
  return n || ' tiles · ' || round(case when total_units > 0 then done_units / total_units * 100 else 100 end)
    || '% · ' || left_n || ' still open';
end $$;

/** Why a bridge cannot be thrown from here to there, or null. */
create or replace function bridge_reason(p_world uuid, p_kind text, p_ax int, p_ay int, p_bx int, p_by int)
  returns text language plpgsql stable as $$
declare d bridge_def; n int; ha double precision; hb double precision; h int; r record; e record;
begin
  select * into d from bridge_def where id = p_kind;
  if not found then return 'Choose what to build it out of.'; end if;
  if not in_bounds(p_world, p_ax, p_ay) or not in_bounds(p_world, p_bx, p_by) then return 'Not there.'; end if;
  if p_ax <> p_bx and p_ay <> p_by then
    return 'A bridge runs straight. Pick an end level with this one, north, south, east or west.';
  end if;
  select count(*)::int into n from span_tiles(p_ax, p_ay, p_bx, p_by);
  if n = 0 then return 'There is nothing between those two. Bridge a gap.'; end if;
  if n > d.span then
    return 'A ' || lower(d.name) || ' spans ' || d.span || ' tiles; that is ' || n || '.';
  end if;
  for e in select * from (values (p_ax, p_ay), (p_bx, p_by)) v(x, y) loop
    -- The bank of a ravine always shares a corner with the ravine, so what
    -- matters is whether you can stand in the middle of the tile, not whether
    -- every corner of it is dry.
    if not passable(p_world, e.x, e.y) or centre_height(p_world, e.x, e.y) < 0 then
      return 'Both ends want dry, solid ground to stand on.';
    end if;
    if bridge_at(p_world, e.x, e.y) is not null then return 'One end is already under a bridge.'; end if;
  end loop;
  ha := centre_height(p_world, p_ax, p_ay);
  hb := centre_height(p_world, p_bx, p_by);
  if abs(ha - hb) > end_slop() then
    return 'The two ends are ' || to_char(abs(ha - hb), 'FM990')
      || ' apart in height. One deck will not meet both; level one of them.';
  end if;
  h := round((ha + hb) / 2);
  for r in select * from span_tiles(p_ax, p_ay, p_bx, p_by) loop
    if bridge_at(p_world, r.x, r.y) is not null then return 'Something is already bridged across there.'; end if;
    if building_at(p_world, r.x, r.y) is not null then return 'Not over a building.'; end if;
    if h - centre_height(p_world, r.x, r.y) < clearance() then return 'That is not a gap, it is ground. Walk it.'; end if;
  end loop;
  return null;
end $$;

select private.lock_doors();
