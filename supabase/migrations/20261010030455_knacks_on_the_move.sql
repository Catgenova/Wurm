/*
 * Knacks on the move (`knackChance` in `src/game/titles.ts`).
 *
 * Swimming is raised once a second in deep water, driving and sailing once a
 * tile, climbing once a steep step, and every one of those raises rolled a
 * go's odds (one in `knack_odds()`) for a knack. A swim across the bay or a
 * cart down the coast handed knacks out many times faster than a day's work
 * at the bench. A raise of one of those trades now rolls at the share of a go
 * it teaches -- its base over a go's -- and every other raise is as it was.
 * `knack_chance` is generated with the defs, from the browser's own rule.
 */

create or replace function earn_knacks(p_world uuid, p_uid uuid, p_id text, p_base double precision)
returns void language plpgsql as $fn$
declare p player; v_id text; had int;
begin
  if random() >= knack_chance(p_id, p_base) then return; end if;
  if random() < knack_home() then
    v_id := p_id;
  else
    select k.skill into v_id from knack_kin k
     where k.family = (select family from knack_kin where skill = p_id)
     order by random() limit 1;
    v_id := coalesce(v_id, p_id);
  end if;
  select * into p from player where world_id = p_world and uid = p_uid for update;
  if not found then return; end if;
  had := coalesce((p.knacks->>v_id)::int, 0);
  if had >= knack_cap() then return; end if;
  update player set knacks = jsonb_set(coalesce(knacks, '{}'::jsonb), array[v_id], to_jsonb(had + 1)),
         skills_at = now()
    where world_id = p_world and uid = p_uid;
  perform journal_note(p_world, p_uid, 'knack');
  perform tell(p_world, p_uid, 'You have a knack for '
    || lower((select name from skill_def where id = v_id)) || ' now. It goes in '
    || round(knack_bonus(had + 1) * 100) || '% faster.', 'skill');
end $fn$;

-- A go's worth, for anything that still asks without saying what it taught.
create or replace function earn_knacks(p_world uuid, p_uid uuid, p_id text) returns void
  language sql as $fn$ select earn_knacks(p_world, p_uid, p_id, 1::double precision) $fn$;

create or replace function skill_raise(p_world uuid, p_uid uuid, p_id text, p_base double precision)
returns double precision language plpgsql as $fn$
declare was double precision; now_v double precision;
begin
  was := skill_of(p_world, p_uid, p_id);
  /*
   * Everything that makes a trade go in faster, which was four things kept on
   * the row and one thing spent. `skill_mult` is the browser's own `skillMult`,
   * term for term, and it goes on the *base* the way it does over there rather
   * than on the gain that comes out — the two are not the same number, because
   * `skill_gain_of` is not linear in what it is given.
   */
  now_v := least(100, was + skill_gain_of(was, p_base * skill_mult(p_world, p_uid, p_id),
                                          0.6 + 0.8 * random()));
  insert into skill (world_id, uid, id, value) values (p_world, p_uid, p_id, now_v)
    on conflict (world_id, uid, id) do update set value = excluded.value;
  -- So the beat knows whether the book is worth sending.
  update player set skills_at = now() where world_id = p_world and uid = p_uid;
  -- And what the go left behind besides the number: a knack at the share of a
  -- go this raise taught.
  perform earn_knacks(p_world, p_uid, p_id, p_base);
  perform earn_titles(p_world, p_uid, p_id, was, now_v);
  perform skill_said(p_world, p_uid, p_id, now_v - was);
  return now_v - was;
end $fn$;
