-- What a furnace finishes waits as a stack, and every mould has a name
--
-- Reported with a picture: "You draw iron lump, iron lump, iron lump, ..."
-- twenty times over. A furnace kept every finished piece as its own entry
-- and the take-all named each one. A finished piece is folded into what is
-- waiting of its kind now (`furnace_fold`: same def, metal and piece, and a
-- thing that stacks at all), the quality averaged by the unit the way a pack
-- averages it, so twenty lumps wait as one entry of twenty and are drawn as
-- "20 × iron lump". The browser folds its own furnaces the same way.
--
-- And, from the same picture, the crafting window said `arrow_head_mould`:
-- seventeen moulds had no item definition and showed as their ids. They are
-- named off the mould table now, on both sides, through the generated
-- definitions. A nail mould runs a lump out as five nails rather than a
-- hundred, asked for, which the mould table says.

/**
 * A finished job put with what is waiting: folded into the entry of its kind
 * (def, metal, piece) when the thing stacks, the quality averaged by the unit;
 * otherwise added as one.
 */
create or replace function furnace_fold(p_done jsonb, p_job jsonb) returns jsonb language plpgsql stable as $fn$
declare i int; e jsonb; n int; q double precision;
begin
  for i in 0 .. jsonb_array_length(p_done) - 1 loop
    e := p_done->i;
    if e->>'def' = p_job->>'makes'
       and (e->>'extra') is not distinct from (p_job->>'extra')
       and (e->>'piece') is not distinct from (p_job->>'piece')
       and coalesce((select stackable from item_def where id = e->>'def'), false) then
      n := coalesce((e->>'count')::int, 1);
      q := ((e->>'ql')::double precision * n + (p_job->>'ql')::double precision) / (n + 1);
      return jsonb_set(jsonb_set(p_done, array[i::text, 'count'], to_jsonb(n + 1)),
                       array[i::text, 'ql'], to_jsonb(q));
    end if;
  end loop;
  return p_done || jsonb_build_object('def', p_job->>'makes', 'ql', (p_job->>'ql')::double precision,
    'count', 1, 'extra', p_job->>'extra', 'piece', p_job->>'piece');
end $fn$;

CREATE OR REPLACE FUNCTION public.furnace_settle(p_world uuid, p_id bigint)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare p placed; budget double precision; jobs jsonb; out_j jsonb; done jsonb;
        v_job jsonb; v_left double precision; made int := 0; was_lit boolean;
        v_name text; v_last jsonb;
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
    -- Folded into what is waiting of its kind, the way a pack folds it: one
    -- entry of twenty rather than twenty of one, and the quality the average.
    done := furnace_fold(done, v_job);
    v_last := v_job;
    made := made + 1;
  end loop;

  update placed set state = jsonb_set(jsonb_set(coalesce(state, '{}'::jsonb),
      '{jobs}', out_j), '{output}', done)
    where id = p_id;

  if made > 0 and p.made_by is not null then
    v_name := made_name(v_last->>'makes', v_last->>'piece');
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
end $function$

;

select private.lock_doors();
