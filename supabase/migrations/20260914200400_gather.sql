-- Taking what the island grows: felling, foraging, botanizing, and filling a
-- shovel off a bed of something.

/**
 * Where has been picked over lately.
 *
 * A row per spot per kind, and "picked clean" is simply whether it was written
 * recently — three minutes, on the wall clock, like everything else. No timer
 * clears these; an old row is just an old row, and the sweep tidies them away
 * when it has nothing better to do.
 */
create table if not exists foraged (
  world_id uuid not null references world on delete cascade,
  x int not null,
  y int not null,
  kind text not null,
  at timestamptz not null default now(),
  primary key (world_id, x, y, kind)
);
alter table foraged enable row level security;
drop policy if exists foraged_read on foraged;
create policy foraged_read on foraged for select to authenticated using (true);
grant select on foraged to authenticated;
revoke insert, update, delete on foraged from anon, authenticated;

create or replace function forage_cooldown() returns double precision language sql immutable as $$ select 180 $$;

create or replace function is_foraged(p_world uuid, p_x int, p_y int, p_kind text)
  returns boolean language sql stable as $$
  select exists (select 1 from foraged
    where world_id = p_world and x = p_x and y = p_y and kind = p_kind
      and now() - at < make_interval(secs => forage_cooldown()))
$$;

create or replace function mark_foraged(p_world uuid, p_x int, p_y int, p_kind text)
  returns void language sql as $$
  insert into foraged (world_id, x, y, kind) values (p_world, p_x, p_y, p_kind)
  on conflict (world_id, x, y, kind) do update set at = now()
$$;

/** What stands on a tile: species in the low four bits, age in the next two. */
create or replace function tree_species(p_data int) returns int language sql immutable as $$
  select least((select max(id) from tree_def), p_data & 15)
$$;
create or replace function tree_age(p_data int) returns int language sql immutable as $$
  select least(2, (p_data >> 4) & 3)
$$;
create or replace function bush_species(p_data int) returns int language sql immutable as $$
  select least((select max(id) from bush_def), p_data & 15)
$$;

/**
 * One draw from a weighted table.
 *
 * Takes the roll as an argument rather than rolling inside, so that a caller
 * making several passes over the same ground gets several different answers
 * and not one answer several times.
 */
create or replace function roll_table(p_table text, p_roll double precision) returns text
  language sql stable as $$
  select item from (
    select item, sum(weight) over (order by weight desc, item) as upto,
           sum(weight) over () as total
    from loot_table where id = p_table
  ) q where upto >= p_roll * total order by upto limit 1
$$;

/**
 * How many times a tile is searched in one go. Skill does not only make a find
 * likelier, it makes a second and a third look worth taking: one more pass for
 * every twenty points.
 */
create or replace function rolls_at(p_skill double precision) returns int language sql immutable as $$
  select 1 + floor(greatest(0, p_skill) / 20)::int
$$;

/** "a, b and c", for saying what a handful of passes turned up. */
create or replace function list_of(p_parts text[]) returns text language sql immutable as $$
  select case when array_length(p_parts, 1) <= 1 then coalesce(p_parts[1], '')
    else array_to_string(p_parts[1:array_length(p_parts,1)-1], ', ') || ' and ' || p_parts[array_length(p_parts,1)]
    end
$$;

select private.lock_doors();
