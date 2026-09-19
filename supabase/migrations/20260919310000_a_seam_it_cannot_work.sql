-- A seam it cannot work is not no seam at all
--
-- The mola. `Lv 1 · working the seams at 1.0 · reaches 8 tiles`, standing on a
-- paved deed doing nothing, for a day. The answer is all in that one line and
-- it took far too long to get to:
--
--     iron wants mining 5.  The mola has 1.0.
--
-- So the exposed iron seam inside its eight tiles is refused — correctly, and
-- by the rule `shore.ts` has pinned since the shore-face work — the coal near
-- it is under soil, and there is nothing else. It has nothing it can work, and
-- it never says so.
--
-- The idle line added a moment ago would have said
--
--     Mola can find no bare rock with a seam in it within 8 tiles…
--
-- which is false, and falsely reassuring: there *is* bare rock with a seam in
-- it, six feet away, and being told there is none would send anybody looking
-- for the wrong thing. "Nothing in range" and "nothing in range I am good
-- enough for" want different answers because they want different remedies.
--
-- And the second is the worse trap of the two. Mining is raised by mining. A
-- worker whose only reachable seam is above its level cannot improve by
-- working, so it is not slow, it is stopped — permanently, and silently, with
-- a perfectly good vein in front of it. That is the one a keeper has no way of
-- working out from the outside, so it is the one worth spelling out with the
-- numbers in it.
--
-- `seam_beyond` asks the question the other way round: within the same reach,
-- a face this worker *would* take but for the skill, nearest-in-level first.
-- It is a ring scan with a `bedrock_at` per tile, which would be a silly thing
-- to run on a clock — it runs at most once per worker per ten minutes, behind
-- an hour of proven idleness, which is the one moment the island can afford to
-- go and look properly.

create or replace function seam_beyond(p_world uuid, p_cx int, p_cy int, p_range int, c creature)
returns table(x int, y int, want double precision, what text)
language sql stable as $fn$
  select gx, gy, (bedrock_at(p_world, gx, gy)).level, (bedrock_at(p_world, gx, gy)).name
  from generate_series(p_cx - p_range, p_cx + p_range) gx,
       generate_series(p_cy - p_range, p_cy + p_range) gy
  where in_bounds(p_world, gx, gy)
    and land_tile(p_world, gx, gy) = tile_id('Rock')
    and (bedrock_at(p_world, gx, gy)).seam
    and (bedrock_at(p_world, gx, gy)).level > task_skill(c)
    and rock_height(p_world, gx, gy) > -mine_depth()
    and face_reach(p_world, gx, gy)
  order by (bedrock_at(p_world, gx, gy)).level, greatest(abs(gx - p_cx), abs(gy - p_cy))
  limit 1
$fn$;

create or replace function worker_idle(p_world uuid, c creature, p_kind text,
                                       p_x int, p_y int, p_radius int, p_post bigint)
returns void language plpgsql as $fn$
declare v_since timestamptz; v_hard record; v_where text;
begin
  if c.keeper is null then return; end if;
  select idle_since into v_since from creature where world_id = p_world and id = c.id;
  -- Empty for a moment is between jobs; empty for an hour is stuck.
  if v_since is null or v_since > now() - idle_before_telling() then return; end if;
  -- The same ten minutes, off the same stamp, as `worker_nowhere`.
  if (select told_at from creature where world_id = p_world and id = c.id) > now() - interval '10 minutes'
    then return; end if;
  update creature set told_at = now() where world_id = p_world and id = c.id;

  v_where := case when p_post is not null then 'its work post' else 'the token' end
             || ' at ' || p_x || ',' || p_y;

  -- A face it would take but for the skill. Only mining has levels on it.
  if p_kind = 'mine' then
    select * into v_hard from seam_beyond(p_world, p_x, p_y, p_radius, c);
    if v_hard.x is not null then
      perform tell(p_world, c.keeper, c.name || ' has nothing it can mine within '
        || p_radius || ' tiles of ' || v_where || '. The ' || lower(v_hard.what) || ' at '
        || v_hard.x || ',' || v_hard.y || ' wants mining '
        || rtrim(rtrim(to_char(v_hard.want, 'FM990.99'), '0'), '.')
        || ' and ' || c.name || ' is at ' || to_char(task_skill(c), 'FM990.0') || '. '
        || 'Mining is learned by mining, so it cannot work its way up to that one: '
        || 'give it a softer seam — copper and coal want 1 apiece — or move it to one.', 'error');
      return;
    end if;
  end if;

  perform tell(p_world, c.keeper, c.name || ' can find no ' || work_words(p_kind)
    || ' within ' || p_radius || ' tiles of ' || v_where || '. '
    || case when p_kind in ('mine', 'quarry')
         then 'A seam under soil or paving is not a face; the rock has to be bare. '
         else '' end
    || 'Put it on a work post nearer the work, or raise its skill to widen the search.', 'error');
end $fn$;
select private.lock_doors();
