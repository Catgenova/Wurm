-- The island, and everybody on it.
--
-- ## Why the land is rows of bytes
--
-- An island is five arrays of a million-odd entries. A row per tile would be
-- a million rows and a hundred megabytes an island; a single blob would be six
-- megabytes rewritten every time somebody dug a hole, and — worse — opaque to
-- the database, which now has to *check* digs rather than take them on trust.
--
-- So the land is stored a world-row at a time: one row of the table per row of
-- the island, each holding that row's slice of each array as `bytea`. A dig
-- reads and writes two rows. Every slice is a few kilobytes, which is under
-- the size at which Postgres moves a value out of line, so reading one byte
-- costs one page rather than a detour through TOAST.
--
-- Corners and tiles are separate tables because there is one more corner than
-- there are tiles in each direction, and because keeping each row's total well
-- under that size limit is the whole point.

create extension if not exists pgcrypto;

create table if not exists world (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 40),
  seed bigint not null,
  size int not null check (size between 8 and 4096),
  spawn_x int not null,
  spawn_y int not null,
  /**
   * When the island began. The time of day is not stored and never ticks: it
   * is this, subtracted from the wall clock. Nothing has to advance it, no
   * two machines can disagree about it, and an island nobody has visited for a
   * week has had a week of nights — which is what everybody expected anyway.
   */
  epoch timestamptz not null default now(),
  /** Whether the land has finished being uploaded. Nobody may join before it has. */
  ready boolean not null default false,
  made_by uuid,
  made_at timestamptz not null default now()
);

create table if not exists land_corner (
  world_id uuid not null references world on delete cascade,
  y int not null,
  /** Heights, signed 16-bit little-endian, one per corner across: size + 1 of them. */
  heights bytea not null,
  /** How much soil is over the rock at each corner, one byte each. */
  dirt bytea not null,
  primary key (world_id, y)
);

create table if not exists land_tile (
  world_id uuid not null references world on delete cascade,
  y int not null,
  tiles bytea not null,
  data bytea not null,
  rock bytea not null,
  primary key (world_id, y)
);

create table if not exists player (
  world_id uuid not null references world on delete cascade,
  uid uuid not null,
  name text not null check (length(name) between 1 and 20),
  x double precision not null,
  y double precision not null,
  level int not null default 0,
  /**
   * Where the body is, as the island believes it. A client says where it has
   * walked to and the island checks the claim against the clock before
   * believing it, which is the only reason the timestamp is here.
   */
  moved_at timestamptz not null default now(),
  stats jsonb not null default '{}',
  nutrition jsonb not null default '{}',
  knacks jsonb not null default '{}',
  titles jsonb not null default '[]',
  wounds jsonb not null default '[]',
  equipped jsonb not null default '{}',
  belt jsonb not null default '[]',
  boons jsonb not null default '[]',
  favour real not null default 0,
  rested real not null default 0,
  way text,
  title text,
  /**
   * What they are in the middle of. The island decides when it finishes, and
   * nothing is running to notice: the work is settled the next time anything
   * touches this row, and by a slow sweep for anyone who has wandered off.
   */
  act text,
  act_target jsonb,
  act_started timestamptz,
  act_ends timestamptz,
  act_left int,
  seen_at timestamptz not null default now(),
  joined_at timestamptz not null default now(),
  primary key (world_id, uid)
);

create table if not exists skill (
  world_id uuid not null,
  uid uuid not null,
  id text not null,
  value real not null,
  primary key (world_id, uid, id),
  foreign key (world_id, uid) references player (world_id, uid) on delete cascade
);

/**
 * Every item on the island, and the well its numbers come from.
 *
 * `generated always as identity` is the uid well made honest: one sequence per
 * island's worth of items, handed out by the database, so two people reaching
 * for the same number at the same instant is not a thing that can happen.
 */
create table if not exists item (
  id bigint primary key generated always as identity,
  world_id uuid not null references world on delete cascade,
  /** Who or what is holding it: 'player', 'ground', 'crate', 'bag'. */
  holder text not null,
  holder_uid uuid,
  gx int,
  gy int,
  inside bigint references item (id) on delete cascade,
  def text not null,
  ql real not null check (ql between 0 and 100),
  dmg real not null default 0 check (dmg between 0 and 100),
  count int not null default 1 check (count > 0),
  extra text,
  rare text,
  dye text,
  bless real,
  charges int,
  locked boolean not null default false,
  issued boolean not null default false,
  made_at timestamptz not null default now()
);

create index if not exists item_by_holder on item (world_id, holder, holder_uid);
create index if not exists item_on_ground on item (world_id, gx, gy) where holder = 'ground';

/**
 * What has changed about the land since it was uploaded.
 *
 * Two jobs in one table: it is what Realtime carries to everybody looking at
 * the island, and it is how somebody who was away catches up without
 * downloading six megabytes again.
 */
create table if not exists tile_change (
  world_id uuid not null references world on delete cascade,
  n bigint generated always as identity,
  x int not null,
  y int not null,
  tile int not null,
  data int not null,
  corners int[] not null,
  at timestamptz not null default now(),
  primary key (world_id, n)
);

/** What somebody is told. One line, to one person, on one island. */
create table if not exists event (
  world_id uuid not null references world on delete cascade,
  n bigint generated always as identity,
  uid uuid,
  text text not null,
  kind text not null default 'event',
  at timestamptz not null default now(),
  primary key (world_id, n)
);

create index if not exists event_for_player on event (world_id, uid, n desc);
