-- Things set down on the ground, and the fires in them.
--
-- ## One table, not nine
--
-- A campfire, a smelter, a kiln, an anvil, a crate and a loom are the same
-- shape: somewhere on a tile, a footprint in subtiles, a quality, and for the
-- ones that burn, fuel and ash. Nine tables would mean nine of every function
-- that asks "is there one of those near me", which is the question this whole
-- file exists to answer.
--
-- ## Fire on the wall clock
--
-- Nothing ticks here, fires included. `fuel` is what was in it at the moment
-- `since` was stamped; a lit thing has burned the seconds since off that, and
-- made ash at a fixed rate the whole while. Both are worked out on reading,
-- and written back whenever anything touches it — the same settle-on-touch the
-- actions use, for the same reason: there is nowhere in Supabase to put a loop,
-- and a fire that only burns while somebody is watching is not a fire.

create table if not exists placed (
  id bigint primary key generated always as identity,
  world_id uuid not null references world on delete cascade,
  /** campfire, smelter, kiln, furniture, anvil, crate, post */
  kind text not null,
  /** Which sort of furniture, when that is the kind. */
  sub text,
  x int not null,
  y int not null,
  /** Top-left subtile of its footprint, 0..3. */
  sx int not null default 0,
  sy int not null default 0,
  /** Where its middle is, in tiles: what "near enough to use" is measured to. */
  cx double precision not null,
  cy double precision not null,
  ql real not null default 20,
  fuel real not null default 0,
  ash real not null default 0,
  lit boolean not null default false,
  /** When `fuel` and `ash` were last true. */
  since timestamptz not null default now(),
  state jsonb not null default '{}',
  made_by uuid,
  made_at timestamptz not null default now()
);

create index if not exists placed_on_island on placed (world_id, kind);
create index if not exists placed_near on placed (world_id, x, y);

alter table placed enable row level security;
drop policy if exists placed_read on placed;
create policy placed_read on placed for select to authenticated using (true);
grant select on placed to authenticated;
revoke insert, update, delete on placed from anon, authenticated;

/** Four subtiles to a tile, each way. */
create or replace function subtiles() returns int language sql immutable as $$ select 4 $$;

/** What a thing of this sort takes up, in subtiles. */
create or replace function placed_size(p_kind text, p_sub text) returns int[] language sql stable as $$
  select case p_kind
    when 'campfire' then array[2, 2]
    when 'smelter' then array[3, 2]
    when 'kiln' then array[2, 2]
    when 'anvil' then array[2, 2]
    when 'furniture' then coalesce((select array[w, h] from furniture_def where id = p_sub), array[1, 1])
    else array[1, 1] end
$$;

/** Seconds of burning left in it, now rather than when it was last looked at. */
create or replace function placed_fuel(p placed) returns double precision language sql stable as $$
  select case when p.lit
    then greatest(0, p.fuel - extract(epoch from (now() - p.since)))
    else p.fuel end
$$;

/**
 * Ashes built up, now. A fire makes one lot every two minutes it burns, and
 * stops making them when the fuel runs out rather than when somebody notices.
 */
create or replace function placed_ash(p placed) returns double precision language sql stable as $$
  select case when p.lit
    then p.ash + least(p.fuel, extract(epoch from (now() - p.since))) / 120
    else p.ash end
$$;

create or replace function placed_lit(p placed) returns boolean language sql stable as $$
  select p.lit and placed_fuel(p) > 0
$$;

/**
 * Bring a fire up to date and say whether it went out while nobody was there.
 * Called before anything reads or changes one, so that what is written down is
 * always what is true at the moment it is written.
 */
create or replace function placed_settle(p_id bigint) returns void language plpgsql as $$
declare p placed; f double precision; a double precision;
begin
  select * into p from placed where id = p_id for update;
  if not found or not p.lit then return; end if;
  f := placed_fuel(p);
  a := placed_ash(p);
  update placed set fuel = f, ash = a, lit = (f > 0), since = now() where id = p_id;
end $$;

/** Everything of a kind within reach of somebody, nearest first. */
create or replace function placed_near(p_world uuid, p_uid uuid, p_kind text, p_sub text default null,
                                       p_range double precision default 2.4)
  returns setof placed language sql stable as $$
  select pl.* from placed pl, player py
  where pl.world_id = p_world and py.world_id = p_world and py.uid = p_uid
    and pl.kind = p_kind and (p_sub is null or pl.sub = p_sub)
    and sqrt(power(pl.cx - py.x, 2) + power(pl.cy - py.y, 2)) <= p_range
  order by sqrt(power(pl.cx - py.x, 2) + power(pl.cy - py.y, 2))
$$;

/**
 * Whether you are standing at the thing a recipe needs.
 *
 * A cooking fire is a lit campfire or a lit oven — an oven holds its heat more
 * evenly, which is why the two are not quite the same thing elsewhere, but for
 * the purpose of "can this be cooked here" they are. Everything else is a
 * piece of furniture of the right sort within arm's reach.
 */
create or replace function at_station(p_world uuid, p_uid uuid, p_station text)
  returns boolean language sql stable as $$
  select case p_station
    when 'campfire' then
      exists (select 1 from placed_near(p_world, p_uid, 'campfire', null, 2.6) p where placed_lit(p))
      or exists (select 1 from placed_near(p_world, p_uid, 'furniture', null, 2.6) p
                 join furniture_def d on d.id = p.sub where d.hearth and placed_lit(p))
    when 'smelter' then
      exists (select 1 from placed_near(p_world, p_uid, 'smelter', null, 2.6) p where placed_lit(p))
    else
      exists (select 1 from placed_near(p_world, p_uid, 'furniture', p_station, 2.4))
    end
$$;

/** Seconds of burning each thing is worth. Fires take wood and coal, nothing else. */
create or replace function fuel_value(p_item text) returns double precision language sql immutable as $$
  select case p_item
    when 'shaft' then 90 when 'thatch' then 60 when 'plank' then 120
    when 'timber' then 240 when 'log' then 600 when 'coal' then 900 end
$$;

/** Most a fire holds: an hour of burning. */
create or replace function fire_capacity() returns double precision language sql immutable as $$ select 3600 $$;

create or replace function burns_for(p_fuel double precision) returns text language sql immutable as $$
  select case
    when round(p_fuel / 60) >= 60 then to_char(p_fuel / 3600, 'FM990.0') || ' hours'
    when round(p_fuel / 60) >= 1 then round(p_fuel / 60) || ' minutes'
    else round(p_fuel) || ' seconds' end
$$;

select private.lock_doors();
