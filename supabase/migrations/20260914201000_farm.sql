-- Farming: rake a field, sow it, tend it, harvest it.
--
-- Growth is the clearest case yet for doing nothing. A crop moves on a stage
-- every so many seconds, and there is no process here to move it — so it never
-- moves at all until somebody looks, and then it moves by however many stages
-- it should have. A field sown and left overnight is ripe in the morning
-- because the arithmetic says so, not because anything sat up with it.
--
-- The one subtlety is worth naming: a stage that comes due adds its own length
-- to the clock rather than restarting it from now. Otherwise every glance at a
-- field would nudge its next stage a little further off, and a watched crop
-- really would grow more slowly.

create table if not exists crop (
  world_id uuid not null references world on delete cascade,
  x int not null,
  y int not null,
  id text not null references crop_def,
  /** 0 sown, 1 sprouting, 2 growing, 3 ripe. */
  stage int not null default 0,
  /** When the stage it is in began. */
  stage_at timestamptz not null default now(),
  /** Stages tended so far; each one lifts the harvest. */
  tended int not null default 0,
  /** Whether the stage it is in has already been tended. */
  tended_now boolean not null default false,
  /** Quality the harvest will carry, built up while tending. */
  ql real not null default 1,
  sown_by uuid,
  primary key (world_id, x, y)
);
alter table crop enable row level security;
drop policy if exists crop_read on crop;
create policy crop_read on crop for select to authenticated using (true);
grant select on crop to authenticated;
revoke insert, update, delete on crop from anon, authenticated;

create or replace function crop_ripe() returns int language sql immutable as $$ select 3 $$;

create or replace function crop_stage_name(p_stage int) returns text language sql immutable as $$
  select (array['sown', 'sprouting', 'growing', 'ripe'])[least(3, p_stage) + 1]
$$;

/**
 * Move a crop on by however many stages have come due, and say whether it
 * moved. Called before anything reads or works a field.
 */
create or replace function crop_settle(p_world uuid, p_x int, p_y int) returns boolean
  language plpgsql as $$
declare c crop; per double precision; steps int;
begin
  select * into c from crop where world_id = p_world and x = p_x and y = p_y for update;
  if not found or c.stage >= crop_ripe() then return false; end if;
  select stage_seconds into per from crop_def where id = c.id;
  steps := least(crop_ripe() - c.stage, floor(extract(epoch from (now() - c.stage_at)) / per)::int);
  if steps <= 0 then return false; end if;
  update crop set
      stage = c.stage + steps,
      -- The stage's own length, added on; not restarted from now.
      stage_at = c.stage_at + make_interval(secs => per * steps),
      tended_now = false
    where world_id = p_world and x = p_x and y = p_y;
  return true;
end $$;

/**
 * What a harvest gives. An untended field returns the seed it was sown from
 * and a single crop; tending every stage doubles the seed and quadruples the
 * crop.
 */
create or replace function crop_yield(p_tended int) returns int[] language sql immutable as $$
  select array[case when least(3, greatest(0, p_tended)) >= 2 then 2 else 1 end,
               1 + least(3, greatest(0, p_tended))]
$$;

select private.lock_doors();
