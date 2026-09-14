-- Kilns, and the queue a smelter works through while you are elsewhere.
--
-- ## A queue is a fuel budget spent in order
--
-- A fire already settles on the wall clock: what was in it when `since` was
-- stamped, less the seconds gone by. A queue of work is the same arithmetic
-- read differently. The furnace has a budget — however many seconds of
-- burning it has done since anybody looked — and it spends that budget down
-- the list in order: the first job takes what it still needed, the second
-- takes what it needs, and so on until either the list or the budget runs out.
--
-- The browser spends that budget a frame at a time. Here it is one pass down a
-- jsonb array, and the pieces come out of the furnace at the moment they would
-- have come out — which for an island nobody has visited since Tuesday is
-- every one of them, in one go, the first time anybody opens the door.

/* ------------------------------------------------------------------ *
 * How long each thing takes.
 * ------------------------------------------------------------------ */

create or replace function smelt_seconds(p_metal text, p_ore_ql double precision,
    p_smelter_ql double precision) returns double precision language sql stable as $$
  select greatest(4, 18 * coalesce((select work from metal_def where id = p_metal), 1)
    * (0.6 + p_ore_ql / 90) * (1.4 - p_smelter_ql / 160))
$$;

/** Seconds for a filled anvil mould to cool into an anvil. */
create or replace function cast_seconds(p_metal text, p_ql double precision)
  returns double precision language sql stable as $$
  select greatest(20, 70 * coalesce((select work from metal_def where id = p_metal), 1)
    * (0.7 + p_ql / 130))
$$;

/** How long a piece takes: its own size, quickened by a well-built kiln. */
create or replace function fire_seconds(p_unfired text, p_kiln_ql double precision)
  returns double precision language sql stable as $$
  select greatest(6, coalesce((select seconds from pottery_def where unfired = p_unfired), 30)
    * (1.4 - p_kiln_ql / 160))
$$;

/**
 * What comes out. The potter's hands settle most of it, and a good kiln keeps
 * what they made rather than adding to it.
 */
create or replace function fired_ql(p_green double precision, p_kiln_ql double precision)
  returns double precision language sql immutable as $$
  select greatest(1, least(100, p_green * (0.82 + p_kiln_ql / 420)))
$$;

create or replace function metal_by_ore(p_ore text) returns metal_def language sql stable as $$
  select * from metal_def where ore = p_ore
$$;
create or replace function metal_by_lump(p_lump text) returns metal_def language sql stable as $$
  select * from metal_def where lump = p_lump
$$;

/** How much work a furnace of this sort will take in at once. */
create or replace function furnace_capacity(p_kind text) returns int language sql immutable as $$
  select case p_kind when 'smelter' then 20 when 'kiln' then 16 else 0 end
$$;

create or replace function furnace_jobs(p placed) returns jsonb language sql immutable as $$
  select coalesce(p.state->'jobs', '[]'::jsonb)
$$;
create or replace function furnace_output(p placed) returns jsonb language sql immutable as $$
  select coalesce(p.state->'output', '[]'::jsonb)
$$;

/* ------------------------------------------------------------------ *
 * Spending the budget.
 * ------------------------------------------------------------------ */

/**
 * Bring a furnace up to date: its fire, and then its work.
 *
 * `placed_settle` already knows how to burn fuel down to the minute. This does
 * that and then spends the same seconds down the queue, so the two can never
 * disagree about how long the thing has been hot.
 */
create or replace function furnace_settle(p_world uuid, p_id bigint) returns int
  language plpgsql as $$
declare p placed; budget double precision; jobs jsonb; out_j jsonb; done jsonb;
        v_job jsonb; v_left double precision; made int := 0; was_lit boolean;
        v_name text;
begin
  select * into p from placed where id = p_id and world_id = p_world for update;
  if not found then return 0; end if;
  -- Seconds of burning it has done since anybody last looked. A furnace that
  -- ran out of fuel on Tuesday gets Tuesday's seconds and not a moment more.
  budget := case when p.lit then least(placed_fuel_spent(p), p.fuel) else 0 end;
  was_lit := p.lit;
  perform placed_settle(p_id);
  select * into p from placed where id = p_id;

  jobs := furnace_jobs(p);
  done := furnace_output(p);
  out_j := '[]'::jsonb;

  for v_job in select * from jsonb_array_elements(jobs) loop
    v_left := (v_job->>'left')::double precision;
    if budget <= 0 then
      out_j := out_j || v_job;
      continue;
    end if;
    if v_left > budget then
      out_j := out_j || jsonb_set(v_job, '{left}', to_jsonb(v_left - budget));
      budget := 0;
      continue;
    end if;
    -- It came out. Whatever is left of the budget goes on the next one.
    budget := budget - v_left;
    done := done || jsonb_build_object('def', v_job->>'makes', 'ql', (v_job->>'ql')::double precision,
      'count', 1, 'extra', v_job->>'extra');
    made := made + 1;
  end loop;

  update placed set state = jsonb_set(jsonb_set(coalesce(state, '{}'::jsonb),
      '{jobs}', out_j), '{output}', done)
    where id = p_id;

  if made > 0 and p.made_by is not null then
    v_name := lower((select coalesce(name, d.id) from item_def d
      where d.id = done->(jsonb_array_length(done) - 1)->>'def'));
    perform tell(p_world, p.made_by, 'The ' || p.kind || ' finishes '
      || case when made = 1 then 'a ' || v_name else made || ' pieces, the last of them a ' || v_name end
      || '.', 'event');
  end if;
  if was_lit and not (select lit from placed where id = p_id) then
    if p.made_by is not null then
      perform tell(p_world, p.made_by, 'A ' || p.kind
        || ' burns through the last of its fuel and goes cold.', 'event');
    end if;
  end if;
  return made;
end $$;

/** Seconds a lit thing has burned since it was last written down. */
create or replace function placed_fuel_spent(p placed) returns double precision
  language sql stable as $$
  select case when p.lit then greatest(0, extract(epoch from (now() - p.since))) else 0 end
$$;

select private.lock_doors();
