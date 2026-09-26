/*
 * Baubles.
 *
 * Asked for: "Add a 30% chance during archeology to uncover Baubles. Baubles
 * need to be restored during the restoration process like normal artifacts.
 * Baubles can be Minor (70%) Major (25%) and Ancient (5%). These will be
 * inserted into the Deed Alter to unlock permanent bonuses for all citizens
 * for actions on that deed only. Alters have 3 ancient Baubles slots, 5 major
 * slots, and 21 minor slots." -- and what each tier gives, that a rare one
 * gives twice as much, a supreme three and a fantastic four times, and that
 * one set in can be replaced but never taken out.
 *
 * The browser's rules are `src/game/baubles.ts`, and everything with a number
 * in it crossed in the defs just before this: `bauble_tier`, `bauble_skill`,
 * `bauble_ancient`, `bauble_kind`, `bauble_share()` and the rest. What is here is the doing
 * of it, in the browser's words:
 *
 *   * `investigate` turns up a tarnished bauble for `bauble_share()` of its
 *     finds, its tier rolled on `bauble_tier`;
 *   * `restore_relic` puts one right (`restore_bauble`), and that is when what
 *     it gives is rolled, and its rarity, which multiplies it; all of it is
 *     written on the bauble (`bauble_text`), and read back off it
 *     (`bauble_read`) when it is set;
 *   * `set_bauble` sets one into a settlement's socket at an altar on it
 *     (`bauble_setting`, `perform_bauble`): the sockets are the settlement's,
 *     in `deed_bauble`, and go with it when it goes;
 *   * and what is in them works for its citizens -- not its guests -- while
 *     they stand on it (`bauble_here`): on a job's time (`settle`, `rpc_act`),
 *     on what a go teaches (`skill_mult`), and on what a go yields (`gather`,
 *     `perform_craft`, through `bauble_yield`, which `settle` marks each go
 *     for and says the outcome of).
 */
set local lock_timeout = '3s';

create table if not exists deed_bauble (
  world_id uuid not null,
  founder uuid not null,
  tier text not null,
  slot int not null,
  kind text not null check (kind in ('time', 'learn', 'double', 'plus')),
  key text not null,
  amount double precision not null,
  rare text,
  ql double precision,
  set_by uuid,
  set_at timestamptz not null default now(),
  primary key (world_id, founder, tier, slot),
  foreign key (world_id, founder) references deed (world_id, founded_by) on delete cascade
);
alter table deed_bauble enable row level security;

/**
 * What a bauble gives, as it is written on it: the browser's `baubleText`,
 * off the same words (`bauble_kind`, `bauble_ancient`).
 */
create or replace function bauble_text(p_kind text, p_key text, p_amount double precision)
  returns text language sql stable as $fn$
  select case when p_kind = 'plus'
    then rtrim(p_key || ': +' || round(p_amount)::int || ' '
               || coalesce((select a.said from bauble_ancient a where a.id = p_key), ''))
    else (select replace(p_key, '_', ' ') || ': ' || k.lead || to_char(p_amount, 'FM990.0') || k.tail
            from bauble_kind k where k.id = p_kind)
  end
$fn$;

/** What a bauble's rarity multiplies it by: once, twice, three and four times (`baubleTimes`). */
create or replace function bauble_times(p_rare text) returns double precision language sql stable as $fn$
  select 1 + coalesce((select r.ord from rarity_def r where r.id = p_rare), 0)::double precision
$fn$;

/** Which tier a find is, off `bauble_tier` (`rollTier`). */
create or replace function bauble_tier_roll() returns text language plpgsql volatile as $fn$
declare v_r double precision := random(); t bauble_tier;
begin
  for t in select * from bauble_tier order by ord loop
    if v_r < t.odds then return t.id; end if;
    v_r := v_r - t.odds;
  end loop;
  return (select b.id from bauble_tier b order by b.ord limit 1);
end $fn$;

/** What a bauble of this tier and rarity turns out to give, as it will be written on it (`rollBauble`). */
create or replace function bauble_roll(p_tier text, p_rare text) returns text language plpgsql volatile as $fn$
declare v_times double precision := bauble_times(p_rare); v_share double precision; v_key text;
begin
  if p_tier = 'ancient' then
    select a.id into v_key from bauble_ancient a order by random() limit 1;
    return bauble_text('plus', v_key, ancient_plus() * v_times);
  end if;
  v_share := round((bauble_low() + random() * (bauble_high() - bauble_low()))::numeric, 1)::double precision;
  if p_tier = 'major' then
    select s.skill into v_key from bauble_skill s where s.major order by random() limit 1;
    return bauble_text('double', v_key, v_share * v_times);
  end if;
  select s.skill into v_key from bauble_skill s where s.minor order by random() limit 1;
  return bauble_text(case when random() < 0.5 then 'time' else 'learn' end, v_key, v_share * v_times);
end $fn$;

/**
 * What a restored bauble gives, read off what is written on it; all null for
 * anything else (`readBauble`). An ancient one by its job and its count,
 * whatever words follow; the others by the words around the amount, which
 * are what say which kind it is.
 */
create or replace function bauble_read(p_def text, p_extra text, out kind text, out key text, out amount double precision)
  language plpgsql stable as $fn$
declare v_m text[]; v_tier text; v_key text;
begin
  select t.id into v_tier from bauble_tier t where t.item = p_def;
  v_m := regexp_match(coalesce(p_extra, ''), '^([a-z ]+): (\+?)(\d+(?:\.\d+)?)(.*)$');
  if v_tier is null or v_m is null then return; end if;
  if v_tier = 'ancient' then
    if v_m[2] = '+' and v_m[3]::double precision = floor(v_m[3]::double precision)
       and exists (select 1 from bauble_ancient a where a.id = v_m[1]) then
      kind := 'plus'; key := v_m[1]; amount := v_m[3]::double precision;
    end if;
    return;
  end if;
  v_key := replace(v_m[1], ' ', '_');
  select k.id into kind from bauble_kind k
   where k.lead = v_m[2] and k.tail = v_m[4]
     and k.id = any(case when v_tier = 'major' then array['double'] else array['time', 'learn'] end)
     and exists (select 1 from bauble_skill s where s.skill = v_key
                   and case when v_tier = 'major' then s.major else s.minor end);
  if kind is not null then key := v_key; amount := v_m[3]::double precision; end if;
end $fn$;

/**
 * The baubles working for this person where they stand: those of the
 * settlement of theirs under their feet, while they are a citizen of it
 * rather than a guest; nothing anywhere else (`Game.baubleHere`).
 */
create or replace function bauble_here(p_world uuid, p_uid uuid) returns setof deed_bauble
  language plpgsql stable as $fn$
declare v_x int; v_y int; v_deed deed;
begin
  -- Most islands have none set anywhere, and this is asked on every go.
  if not exists (select 1 from deed_bauble b where b.world_id = p_world) then return; end if;
  select floor(p.x)::int, floor(p.y)::int into v_x, v_y from player p where p.world_id = p_world and p.uid = p_uid;
  if v_x is null then return; end if;
  v_deed := deed_here(p_world, p_uid, v_x, v_y);
  if v_deed.world_id is null or coalesce(deed_role(p_world, v_deed.founded_by, p_uid), 'guest') = 'guest' then return; end if;
  return query select b.* from deed_bauble b where b.world_id = p_world and b.founder = v_deed.founded_by;
end $fn$;

/** What they add up to for one kind and one skill (or job): percent, to the kind's cap, or a count (`baubleBonus`). */
create or replace function bauble_sum(p_world uuid, p_uid uuid, p_kind text, p_key text)
  returns double precision language sql stable as $fn$
  select case when p_kind = 'plus' then x.s
              else least(coalesce((select k.cap from bauble_kind k where k.id = p_kind), 0), x.s) end
    from (select coalesce(sum(b.amount), 0)::double precision as s
            from bauble_here(p_world, p_uid) b where b.kind = p_kind and b.key = p_key) x
$fn$;

/** What they take off a job's time, as a multiplier on it (`baublePace`). */
create or replace function bauble_pace(p_world uuid, p_uid uuid, p_skill text)
  returns double precision language sql stable as $fn$
  select case when p_skill is null then 1 else 1 - bauble_sum(p_world, p_uid, 'time', p_skill) / 100 end
$fn$;

/** What they add to what a go teaches, as a multiplier on it (`baubleLearn`). */
create or replace function bauble_learn(p_world uuid, p_uid uuid, p_skill text)
  returns double precision language sql stable as $fn$
  select 1 + bauble_sum(p_world, p_uid, 'learn', p_skill) / 100
$fn$;

/** Whether this go's yield comes out doubled (`baubleTwice`). */
create or replace function bauble_twice(p_world uuid, p_uid uuid, p_skill text)
  returns boolean language plpgsql volatile as $fn$
declare v_chance double precision;
begin
  if p_skill is null then return false; end if;
  v_chance := bauble_sum(p_world, p_uid, 'double', p_skill);
  return v_chance > 0 and random() * 100 < v_chance;
end $fn$;

/** What they add to a yield of this job (`baublePlus`). */
create or replace function bauble_plus(p_world uuid, p_uid uuid, p_action text)
  returns int language sql stable as $fn$
  select coalesce((select round(bauble_sum(p_world, p_uid, 'plus', a.id))::int
                     from bauble_ancient a where a.action = p_action), 0)
$fn$;

/**
 * A yield of the go in hand, and what the settlement's baubles make of it
 * (`Game.baubleYield`): what an ancient bauble on the job adds, and then
 * `bauble_yield_times()` as many, the go a major bauble on its skill comes up.
 * Whether it came up is asked once a go, at its first yield, so a go comes
 * out multiplied or not as a whole.
 *
 * A go is what `settle` says it is: it sets `wurm.bauble_go` for each one it
 * performs, and says what the baubles made of it once the go has said its own
 * piece (`bauble_said`). Anything gathered outside a go is left as it was.
 */
create or replace function bauble_yield(p_world uuid, p_uid uuid, p_item text, p_n int) returns int
  language plpgsql volatile as $fn$
declare v_go text := coalesce(current_setting('wurm.bauble_go', true), ''); v_act text; v_skill text; v_n int;
begin
  if v_go = '' or p_n is null or p_n <= 0 then return p_n; end if;
  select p.act, d.skill into v_act, v_skill
    from player p left join action_def d on d.id = p.act
   where p.world_id = p_world and p.uid = p_uid;
  if v_act is null then return p_n; end if;
  v_n := p_n + bauble_plus(p_world, p_uid, v_act);
  if v_go = 'go' then
    v_go := case when bauble_twice(p_world, p_uid, v_skill) then 'twice' else 'once' end;
    perform set_config('wurm.bauble_go', v_go, true);
  end if;
  if v_go = 'twice' then v_n := round(v_n * bauble_yield_times())::int; end if;
  if v_n <> p_n then
    perform set_config('wurm.bauble_made',
      concat_ws('|', nullif(current_setting('wurm.bauble_made', true), ''),
                v_n || ' × ' || lower(coalesce((select d.name from item_def d where d.id = p_item), p_item))), true);
  end if;
  return v_n;
end $fn$;

/** After the go's own words, what the baubles made of its yield, in so many (`Game.sayBaubleGo`). */
create or replace function bauble_said(p_world uuid, p_uid uuid) returns void language plpgsql as $fn$
declare v_made text[] := string_to_array(nullif(current_setting('wurm.bauble_made', true), ''), '|'); v_n int;
begin
  perform set_config('wurm.bauble_go', '', true);
  perform set_config('wurm.bauble_made', '', true);
  v_n := coalesce(array_length(v_made, 1), 0);
  if v_n = 0 then return; end if;
  perform tell(p_world, p_uid, 'The baubles in the altar make that '
    || case when v_n = 1 then v_made[1]
            else array_to_string(v_made[1:v_n - 1], ', ') || ' and ' || v_made[v_n] end || '.', 'event');
end $fn$;

/** A settlement's sockets as the browser holds them (`baublesFrom`). */
create or replace function deed_baubles_json(p_world uuid, p_founder uuid) returns jsonb language sql stable as $fn$
  select coalesce(jsonb_agg(jsonb_build_object('tier', b.tier, 'slot', b.slot, 'kind', b.kind, 'key', b.key,
                                               'amount', b.amount, 'rare', b.rare, 'ql', b.ql)
                            order by t.ord, b.slot), '[]'::jsonb)
    from deed_bauble b join bauble_tier t on t.id = b.tier
   where b.world_id = p_world and b.founder = p_founder
$fn$;

/**
 * Why this bauble will not go into this altar, or which settlement's socket
 * it would go into when it will: the browser's `baubleSetting`, in its words.
 */
create or replace function bauble_setting(p_world uuid, p_uid uuid, p_target jsonb,
  out o_why text, out o_founder uuid, out o_tier text, out o_slot int, out o_kind text, out o_key text,
  out o_amount double precision, out o_item item, out o_was deed_bauble)
  language plpgsql stable as $fn$
declare v_pc placed; v_deed deed; v_role text; v_slots int; v_asked int; v_read record;
begin
  select * into v_pc from placed pl where pl.world_id = p_world and pl.id = (p_target->>'id')::bigint;
  if not found or not is_altar(v_pc) then o_why := 'That is not an altar.'; return; end if;
  if not near_piece(p_world, p_uid, v_pc, 2.4) then o_why := 'Stand at the altar.'; return; end if;
  v_deed := deed_here(p_world, p_uid, v_pc.x, v_pc.y);
  if v_deed.world_id is null then o_why := 'This altar does not stand on a settlement of yours.'; return; end if;
  v_role := deed_role(p_world, v_deed.founded_by, p_uid);
  if v_role is null or v_role = 'guest' then
    o_why := 'A guest of this settlement may not set baubles into its altar.'; return;
  end if;
  select * into o_item from item i where i.world_id = p_world and i.id = target_item(p_target)
    and i.holder = 'player' and i.holder_uid = p_uid;
  if o_item.def = 'tarnished_bauble' then o_why := 'Restore it first: tarnished, it does nothing.'; return; end if;
  select * into v_read from bauble_read(o_item.def, o_item.extra);
  if o_item.id is null or v_read.kind is null then o_why := 'That is not a bauble you can set.'; return; end if;
  select t.id, t.slots into o_tier, v_slots from bauble_tier t where t.item = o_item.def;
  o_kind := v_read.kind; o_key := v_read.key; o_amount := v_read.amount; o_founder := v_deed.founded_by;
  if jsonb_typeof(p_target->'slot') = 'number' then
    if (p_target->>'slot')::numeric <> floor((p_target->>'slot')::numeric) then
      o_why := 'That is not a bauble you can set.'; return;
    end if;
    v_asked := (p_target->>'slot')::int;
    if v_asked < 0 or v_asked >= v_slots then o_why := 'That is not a bauble you can set.'; return; end if;
    select * into o_was from deed_bauble b where b.world_id = p_world and b.founder = v_deed.founded_by
      and b.tier = o_tier and b.slot = v_asked;
    if o_was.world_id is not null and v_role not in ('founder', 'mayor') then
      o_why := 'Only its founder or a mayor may replace a bauble already set.'; return;
    end if;
    o_slot := v_asked;
    return;
  end if;
  select min(s.n) into o_slot from generate_series(0, v_slots - 1) s(n)
   where not exists (select 1 from deed_bauble b where b.world_id = p_world and b.founder = v_deed.founded_by
                       and b.tier = o_tier and b.slot = s.n);
  if o_slot is null then
    o_why := 'All ' || v_slots || ' ' || o_tier || ' sockets are filled. Choose one to replace.';
  end if;
end $fn$;

create or replace function bauble_refusal(p_world uuid, p_uid uuid, p_target jsonb) returns text
  language sql stable as $fn$
  select s.o_why from bauble_setting(p_world, p_uid, p_target) s
$fn$;

/** Set a bauble into its socket, and lose whatever was in it. */
create or replace function perform_bauble(p_world uuid, p_uid uuid, p_target jsonb) returns void
  language plpgsql as $fn$
declare s record; v_name text; v_deed text;
begin
  select * into s from bauble_setting(p_world, p_uid, p_target);
  if s.o_why is not null then return; end if;
  v_name := lower(item_name(s.o_item));
  perform consume(p_world, p_uid, (s.o_item).def, 1, (s.o_item).id);
  insert into deed_bauble (world_id, founder, tier, slot, kind, key, amount, rare, ql, set_by, set_at)
  values (p_world, s.o_founder, s.o_tier, s.o_slot, s.o_kind, s.o_key, s.o_amount, (s.o_item).rare, (s.o_item).ql, p_uid, now())
  on conflict (world_id, founder, tier, slot) do update
     set kind = excluded.kind, key = excluded.key, amount = excluded.amount, rare = excluded.rare,
         ql = excluded.ql, set_by = excluded.set_by, set_at = excluded.set_at;
  select d.name into v_deed from deed d where d.world_id = p_world and d.founded_by = s.o_founder;
  perform tell(p_world, p_uid, 'You set the ' || v_name || ' into the altar, in ' || s.o_tier || ' socket '
    || (s.o_slot + 1) || '. Every citizen working on ' || v_deed || ' has it now.'
    || case when (s.o_was).world_id is not null
            then ' The ' || bauble_text((s.o_was).kind, (s.o_was).key, (s.o_was).amount) || ' that was there crumbles away.'
            else '' end, 'event');
end $fn$;

/**
 * A tarnished bauble put right: at its tier's difficulty, and only as good as
 * it came out of the ground, less what age took, as a relic is. What it does
 * is rolled now, and its rarity with it.
 */
create or replace function restore_bauble(p_world uuid, p_uid uuid, p_it item) returns void
  language plpgsql as $fn$
declare t bauble_tier; v_ql double precision; v_rare text; v_new bigint;
begin
  select * into t from bauble_tier b where b.id = p_it.extra;
  if not found then select * into t from bauble_tier b order by b.ord limit 1; end if;
  if not skill_check(skill_of(p_world, p_uid, 'restoration'), t.difficulty, 0, mind_ease(p_world, p_uid)) then
    perform damage_item(p_it.id, 5 + random() * 9);
    perform skill_raise(p_world, p_uid, 'mind_logic', try_gain(false, restore_gain()));
    perform tell(p_world, p_uid, 'The tarnish will not lift from the ' || t.id || ' bauble and you mark it trying.', 'event');
    return;
  end if;
  v_ql := greatest(1, least(100, p_it.ql * (1 - p_it.dmg / 200) * (0.72 + skill_of(p_world, p_uid, 'restoration') / 260)
                                * class_mul(p_world, p_uid, 'fine', 'restoration')));
  v_rare := rarity_roll();
  perform consume(p_world, p_uid, 'tarnished_bauble', 1, p_it.id);
  v_new := give(p_world, p_uid, t.item, 1, v_ql, bauble_roll(t.id, v_rare), v_rare);
  if v_rare is not null then perform tell(p_world, p_uid, rarity_word(v_rare), 'skill'); end if;
  perform skill_raise(p_world, p_uid, 'mind_logic', try_gain(true, restore_gain()));
  perform tell(p_world, p_uid, 'The tarnish comes away and the bauble is whole: '
    || lower((select item_name(i) from item i where i.id = v_new)) || '. (QL ' || to_char(v_ql, 'FM990.0') || ')', 'event');
end $fn$;


CREATE OR REPLACE FUNCTION public.skill_mult(p_world uuid, p_uid uuid, p_id text)
 RETURNS double precision
 LANGUAGE plpgsql
 STABLE
AS $function$
declare p player; m double precision;
begin
  select * into p from player where world_id = p_world and uid = p_uid;
  if not found then return 1; end if;
  m := case when coalesce(p.rested, 0) > 0 then rest_mult() else 1 end;
  -- A knack earned on the way up never wears off, unlike a meal or a night's sleep.
  m := m + knack_bonus((p.knacks->>p_id)::int);
  -- And the stone you wear, worth a knack on the one trade it favours.
  m := m + coalesce((select jewel_bonus() from gem_def g
                      where g.skill = p_id and lower(g.name) = lower((worn(p_world, p_uid, 'jewel')).extra)), 0);
  -- And the reader's path is a tenth on everything, for good.
  if p_id <> meditation_skill() and walks(p_world, p_uid, 'knowledge', 1) then m := m + 0.1; end if;
  m := m * table_mul(p.nutrition);
  -- And the dish that favours this one, while it lasts.
  m := m + coalesce((select sum((b->>'bonus')::double precision)
                       from jsonb_array_elements(coalesce(p.boons, '[]'::jsonb)) b
                      where b->>'skill' = p_id
                        and (b->>'until')::double precision > world_time(p_world)), 0);
  /*
   * And the tree, which is the last thing on and the only one that is not the
   * same for everybody with the same sheet.
   *
   * Free here, and that is why learning is wired here rather than in
   * `skill_raise`: this function already has the row in hand, and the fold
   * kept on it is a product somebody else worked out. It tells only on the
   * skills the trade covers -- the check is inside `class_mul` -- so a smith's
   * forge sense is worth nothing at a loom.
   */
  m := m * class_mul(coalesce(p.class_mul, '{}'::jsonb), 'learn', p_id);
  -- And a bauble for the trade in the altar of the settlement you are working on.
  return greatest(0.01, m) * bauble_learn(p_world, p_uid, p_id);
end $function$;

CREATE OR REPLACE FUNCTION public.settle(p_world uuid, p_uid uuid)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare p player; d action_def; done int := 0; guard int := 0; nxt jsonb; ended timestamptz;
        v_err text; v_state text; v_where text;
begin
  /*
   * One body's work, and nobody else's.
   *
   * Everything below used to run bare, and `world_tick` settles every body on
   * every island in one transaction: one go that raised an error took the
   * whole round down with it, every second, for as long as that job was
   * still due. Reported as "something just broke, no actions are working":
   * `take_spoil` set the last spadeful in a cart to a count of 0, which the
   * item table refuses, and for a quarter of an hour nothing anybody did on
   * the island finished.
   *
   * So the goes run in a block of their own. A fault undoes what the block
   * had done -- the goes that had come due in this call, and nothing else --
   * stops that job and the queue behind it, tells its owner what the island
   * said, and is kept in `private.tick_fault` for the deploy to report. A
   * deadlock, a lock that timed out or a serialization failure is not a
   * fault in the job: those are raised as before, and the job is tried again
   * next round. A statement timeout is not caught by `others` at all.
   */
  begin
    perform wounds_settle(p_world, p_uid);
    perform body_settle(p_world, p_uid);
    select * into p from player where world_id = p_world and uid = p_uid for update;
    if not found or p.act is null then return 0; end if;
    /*
     * Twenty-five goes to a call, not two hundred.
     *
     * This is the one way a round of the clock can run long: somebody back from
     * an hour away is owed hundreds of goes, and at two hundred apiece — inside
     * `tick_players` inside `tick_worlds` — one person's backlog is the whole
     * tick. It mattered less at five seconds. It matters at one.
     *
     * Nothing is lost by taking less at a time: what is still due is still due,
     * and there is another round a second from now, plus the browser's own beat
     * the moment its job comes up. A backlog drains in seconds either way; the
     * difference is whether everybody else waits while it does.
     */
    while p.act is not null and p.act_ends <= now() and guard < 25 loop
      guard := guard + 1;
      -- A go, for what the baubles make of its yield (`bauble_yield`), and
      -- what they made of it said after the go has said its own piece.
      perform set_config('wurm.bauble_go', 'go', true);
      perform set_config('wurm.bauble_made', '', true);
      perform act_perform(p_world, p_uid, p.act, p.act_target);
      perform bauble_said(p_world, p_uid);
      -- And what the go took out of you, which nothing over here had ever
      -- charged: `action_def.stamina` was a column no function read.
      perform spend_wind(p_world, p_uid, p.act);
      done := done + 1;
      select * into d from action_def where id = p.act;
      ended := p.act_ends;
      if p.act_left > 1 and act_refusal(p_world, p_uid, p.act, p.act_target) is null then
        update player set act_left = act_left - 1, act_started = ended,
               act_ends = ended + make_interval(secs => act_duration(
                 d.base_time,
                 case when d.skill is null then 50 else skill_of(p_world, p_uid, d.skill) end,
                 case when d.tool is null then 0 else tool_ql(p_world, p_uid, d.tool) end,
                 -- The body's own pace, and then the trade's, which tells only
                 -- on the skill this job is done with.
                 control_speed(p_world, p_uid)
                   * class_mul(coalesce(p.class_mul, '{}'::jsonb), 'hands',
                               act_scope(p_world, p_uid, d.skill)) * bauble_pace(p_world, p_uid, d.skill)))
          where world_id = p_world and uid = p_uid returning * into p;
      else
        if p.act_left > 1 then
          -- Why, when there is a why. A run of goes that stops because the wind
          -- gave out should say so rather than leave somebody wondering what
          -- they did wrong, which is what the browser has always said.
          perform tell(p_world, p_uid,
            coalesce(act_refusal(p_world, p_uid, p.act, p.act_target) || ' That was '
                     || (coalesce(p.act_left, 1)) || ' to go.',
                     'You stop ' || d.verb || '.'), 'info');
        end if;
        /*
         * The next job in the line, or the first one behind it that can be done.
         *
         * Reported: "queued up multiple chopping actions, then after the tree
         * was felled and no actions were running I'd dig up the stump and it
         * would show a cutting action following that I didn't queue." The
         * second chop, popped once the tree was down, was refused and put out of
         * the line — and the third stayed in it, behind an empty hand, until the
         * next thing asked for was done and it came up as "then". A refusal puts
         * that job out of the line and asks the next, as the browser's
         * `nextInQueue` has always done, until one starts or the line is empty.
         */
        loop
          nxt := p.act_queue -> 0;
          -- Another onion will do. See `act_retarget`: only when the row it named
          -- has gone, and only to another of what it was.
          nxt := act_retarget(p_world, p_uid, nxt);
          if nxt is null then
            update player set act = null, act_target = null, act_started = null, act_ends = null,
                   act_left = null, act_goes = null
              where world_id = p_world and uid = p_uid returning * into p;
            exit;
          end if;
          select * into d from action_def where id = nxt->>'action';
          if d is null or act_refusal(p_world, p_uid, nxt->>'action', nxt->'target') is not null then
            perform tell(p_world, p_uid,
              coalesce(act_refusal(p_world, p_uid, nxt->>'action', nxt->'target'), 'That cannot be done now.'), 'error');
            update player set act = null, act_target = null, act_started = null, act_ends = null,
                   act_left = null, act_goes = null, act_queue = act_queue - 0
              where world_id = p_world and uid = p_uid returning * into p;
            -- And the one behind it.
          else
            update player set act = nxt->>'action', act_target = nxt->'target',
                   act_left = greatest(1, coalesce((nxt->>'goes')::int, 1)),
                   -- What was asked for, carried out of the queue with the job.
                   -- Without it the browser was left holding the count of
                   -- whatever ran *before* this one, and the bar drew "3 of 10"
                   -- off two numbers from different jobs.
                   act_goes = greatest(1, coalesce((nxt->>'goes')::int, 1)),
                   act_started = ended,
                   act_ends = ended + make_interval(secs => act_duration(
                     d.base_time,
                     case when d.skill is null then 50 else skill_of(p_world, p_uid, d.skill) end,
                     case when d.tool is null then 0 else tool_ql(p_world, p_uid, d.tool) end,
                     control_speed(p_world, p_uid)
                       * class_mul(coalesce(p.class_mul, '{}'::jsonb), 'hands',
                                   act_scope(p_world, p_uid, d.skill)) * bauble_pace(p_world, p_uid, d.skill))),
                   act_queue = act_queue - 0
              where world_id = p_world and uid = p_uid returning * into p;
            perform tell(p_world, p_uid, 'You start ' || d.verb || '.', 'info');
            exit;
          end if;
        end loop;
      end if;
    end loop;
    return done;
  exception
    when deadlock_detected or lock_not_available or serialization_failure then raise;
    when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate, v_where = pg_exception_context;
      perform settle_fault(p_world, p_uid, v_err, v_state, v_where);
      return 0;
  end;
end $function$;

CREATE OR REPLACE FUNCTION public.rpc_act(p_world uuid, p_action text, p_target jsonb, p_times integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); d action_def; p player; why text; secs double precision;
        s double precision; tq double precision; cap int; room int;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  perform settle(p_world, me);
  why := act_refusal(p_world, me, p_action, p_target);
  if why is not null then
    perform tell(p_world, me, why, 'error');
    return jsonb_build_object('started', false, 'why', why);
  end if;
  select * into d from action_def where id = p_action;
  select * into p from player where world_id = p_world and uid = me for update;

  -- Something already in hand: line this one up behind it rather than drop it.
  if p.act is not null then
    cap := queue_capacity(p_world, me);
    room := cap - 1 - jsonb_array_length(p.act_queue);
    if room <= 0 then
      why := 'You can only keep ' || cap || ' jobs in your head at once. Mind logic is what widens that.';
      perform tell(p_world, me, why, 'error');
      return jsonb_build_object('started', false, 'queued', false, 'why', why);
    end if;
    /*
     * And what the thing *was*, for a job that may outlive the row it names.
     *
     * Stamped now rather than worked out later, because later is exactly when
     * it cannot be: once `consume` has deleted the last of a stack there is
     * nothing left to ask what kind of thing it had been.
     */
    update player set act_queue = act_queue || (jsonb_build_object(
        'action', p_action, 'target', p_target, 'goes', greatest(1, least(100, coalesce(p_times, 1))))
        || coalesce((select jsonb_build_object('was', i.def) from item i
                      where i.id = target_item(p_target) and i.world_id = p_world), '{}'::jsonb))
      where world_id = p_world and uid = me returning * into p;
    perform tell(p_world, me, d.label || ' is next, ' || jsonb_array_length(p.act_queue) + 1 || ' of ' || cap || ' in hand.', 'info');
    /*
     * And what is in the head now, not just how much of it.
     *
     * The bar drew its queue from `rpc_settle` and nothing else, and
     * `rpc_settle` runs on the heartbeat and when a job comes due — never when
     * one is *added*. So asking for a third job while two were running left the
     * bar saying "2 of 3" until the job in hand finished, at which point one
     * came off the queue and it said "2 of 3" again. Reported as never changing
     * from 2/3 to 3/3, which is exactly what it did: it was always one behind,
     * and topping the queue up kept it there.
     *
     * The answer to the ask is where the browser should hear about what the ask
     * did, so it says so here rather than waiting to be asked again.
     */
    return held_now(p_world, me) || jsonb_build_object('started', false, 'queued', true,
      'inHand', jsonb_array_length(p.act_queue) + 1, 'capacity', cap,
      'queue', coalesce((select jsonb_agg(jsonb_build_object(
                           'action', q->>'action',
                           'goes', greatest(1, coalesce((q->>'goes')::int, 1))) order by o)
                         from jsonb_array_elements(p.act_queue) with ordinality t(q, o)), '[]'::jsonb));
  end if;

  s := case when d.skill is null then 50 else skill_of(p_world, me, d.skill) end;
  tq := case when d.tool is null then 0 else tool_ql(p_world, me, d.tool) end;
  -- Every other job has a floor of a second or so under it; an instant one has
  -- no duration to put a floor under, and act_duration would give it one.
  secs := case when d.instant then 0
               else act_duration(d.base_time, s, tq, control_speed(p_world, me)
                 * class_mul(coalesce(p.class_mul, '{}'::jsonb), 'hands',
                             act_scope(p_world, me, d.skill)) * bauble_pace(p_world, me, d.skill)) end;
  update player set
      act = p_action, act_target = p_target, act_started = now(),
      act_ends = now() + make_interval(secs => secs),
      act_left = greatest(1, least(100, coalesce(p_times, 1))),
      act_goes = greatest(1, least(100, coalesce(p_times, 1))), seen_at = now(), away = false
    where world_id = p_world and uid = me;
  /*
   * And what the ask left you holding, said in the answer to the ask.
   *
   * Reported as inventory rubberbanding: a thing put in a crate turns up in
   * the crate and stays in the pack as well, for up to the twenty seconds
   * until the next reconcile, and then goes. Two causes with one shape —
   * nothing ever tells a browser that a thing has *left* its hands.
   *
   * `item` is published with the default replica identity, so a DELETE carries
   * the primary key and nothing else, and the browser's Realtime filter is
   * `holder_uid = me`: a row carrying only an `id` cannot match it. Putting a
   * whole stack in a crate deletes the row, so nothing is said. And a thing
   * that goes to the ground, or to somebody else, has `holder_uid` set to
   * null, so the *new* row does not match the filter either. Realtime carries
   * every arrival and no departure, and `refresh_pack` on the twenty-second
   * reconcile was the only thing that ever noticed.
   *
   * Said at each return rather than worked out once at the top, because for an
   * instant ask the work happens in the `settle` three lines below this — a
   * value built any earlier is the pack as it was before the thing moved,
   * which is the very answer that was wrong.
   */
  if d.instant then
    perform settle(p_world, me);
    return held_now(p_world, me) || jsonb_build_object('started', true, 'done', true, 'seconds', 0);
  end if;
  perform tell(p_world, me, 'You start ' || d.verb || '.', 'info');
  return held_now(p_world, me)
      || jsonb_build_object('started', true, 'ends', now() + make_interval(secs => secs), 'seconds', secs);
end $function$;

CREATE OR REPLACE FUNCTION public.gather(p_world uuid, p_uid uuid, p_item text, p_n integer, p_ql double precision, p_extra text DEFAULT NULL::text, p_rare text DEFAULT NULL::text, p_maker text DEFAULT NULL::text, p_cast text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
declare v_cart placed; v_fit int := 0; v_id bigint; v_rest bigint; fresh item;
begin
  -- And what the settlement's baubles make of it, when it is the yield of a go.
  p_n := bauble_yield(p_world, p_uid, p_item, p_n);
  /*
   * What a gathering job brings up, put where it belongs: into the cart you
   * are working from as far as it has room and will take it, and the rest
   * into the pack through `give`, the one way a thing arrives there. The row
   * it went into comes back, the cart's when any of it went there.
   */
  v_cart := work_cart(p_world, p_uid);
  if v_cart.id is null or p_n <= 0 then
    return give(p_world, p_uid, p_item, p_n, p_ql, p_extra, p_rare, p_maker, p_cast);
  end if;
  if furniture_refuses(v_cart, p_item) is null then
    v_fit := least(p_n, furniture_room(v_cart, p_item));
  end if;
  if v_fit > 0 then
    -- The row as it would be written, so the key is the real key -- as `give` does.
    if item_stackable(p_item) then
      fresh.def := p_item; fresh.extra := p_extra; fresh.rare := p_rare;
      fresh.maker := p_maker; fresh.piece := p_cast;
      fresh.locked := false; fresh.lit := false; fresh.issued := false;
      select i.id into v_id from item i
       where i.world_id = p_world and i.holder = 'furniture' and i.placed = v_cart.id
         and i.def = p_item and stack_key(i) = stack_key(fresh)
       order by i.id limit 1;
    end if;
    if v_id is not null then
      update item set ql = (ql * count + greatest(0, least(100, p_ql)) * v_fit) / (count + v_fit),
                      count = count + v_fit
        where id = v_id;
    else
      insert into item (world_id, holder, placed, def, ql, count, extra, rare, maker, piece)
      values (p_world, 'furniture', v_cart.id, p_item, greatest(0, least(100, p_ql)), v_fit,
              p_extra, p_rare, p_maker, p_cast)
      returning id into v_id;
    end if;
  end if;
  if v_fit < p_n then
    perform cart_full(p_world, p_uid, v_cart);
    v_rest := give(p_world, p_uid, p_item, p_n - v_fit, p_ql, p_extra, p_rare, p_maker, p_cast);
  end if;
  return coalesce(v_id, v_rest);
end $function$;

CREATE OR REPLACE FUNCTION public.perform_craft(p_world uuid, p_uid uuid, p_recipe text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare r recipe; i record; v_n int; prefer bigint; mat text; hard double precision; tq double precision;
        s double precision; made_ql double precision; rare text; total double precision := 0;
        v_made bigint; weight double precision := 0; one double precision; share double precision;
        only_mat boolean; was text;
begin
  select * into r from recipe where id = p_recipe;
  prefer := target_item(p_target);
  -- What the run is aimed at, while it is still there to ask.
  select it.def into was from item it where it.id = prefer and it.world_id = p_world;
  mat := craft_material(p_world, p_uid, p_recipe, prefer);
  s := skill_of(p_world, p_uid, r.skill);
  tq := case when r.tool is null then 0 else tool_ql(p_world, p_uid, r.tool) end;
  -- Oak and the deep metals fight the hands that shape them.
  hard := craft_hardness(p_recipe, mat);

  if r.difficulty is not null and not skill_check(s, hard, tq) then
    if r.consume_on_fail then
      for i in select * from recipe_input where recipe = p_recipe order by ord loop
        perform craft_consume(p_world, p_uid, i.item, i.count, prefer, mat);
      end loop;
      -- The batch is wasted, not the vessel: you tip the ruin out and keep the
      -- bucket. Salvage if the recipe names any, otherwise whatever it returns.
      for i in
        select g.item, g.count from recipe_gives g
        where g.recipe = p_recipe
          and g.kind = (case when exists (select 1 from recipe_gives where recipe = p_recipe and kind = 'salvage')
                             then 'salvage' else 'return' end)
      loop
        perform give(p_world, p_uid, i.item, i.count, 20);
      end loop;
      perform craft_carry_on(p_world, p_uid, p_recipe, p_target, was, mat);
    end if;
    perform skill_raise(p_world, p_uid, r.skill, try_gain(false));
    perform skill_raise(p_world, p_uid, 'mind_logic', try_gain(false, craft_head()));
    perform tell(p_world, p_uid, coalesce(r.fail,
      'You fail to make ' || lower((select coalesce(name, r.result) from item_def where id = r.result)) || '.'), 'event');
    return;
  end if;

  -- The quality of what is about to be used up, worked out before it is used
  -- up, since using it up changes the answer: off the stack each input would
  -- be spent from first, which is the clicked one where it is one of them.
  if r.ql_from_inputs then
    for i in select * from recipe_input where recipe = p_recipe order by ord loop
      only_mat := mat is not null and craft_count(p_world, p_uid, i.item, mat, prefer) >= i.count;
      select st.ql into one from craft_stock(p_world, p_uid, prefer) st
        where st.def = i.item and (not only_mat or st.extra is not distinct from mat)
        order by (st.id = prefer) desc, st.draw limit 1;
      if one is not null then
        -- By mass, not by the count. Two nails weigh two hundredths of a
        -- kilogram between them and do not get to decide what a pickaxe is.
        share := coalesce((select d.weight from item_def d where d.id = i.item), 1) * i.count;
        total := total + one * share;
        weight := weight + share;
      end if;
    end loop;
  end if;

  for i in select * from recipe_input where recipe = p_recipe order by ord loop
    if not craft_consume(p_world, p_uid, i.item, i.count, prefer, mat) then return; end if;
  end loop;
  perform craft_carry_on(p_world, p_uid, p_recipe, p_target, was, mat);

  if r.ql_from_inputs then
    made_ql := greatest(1, least(100, (case when weight > 0 then total / weight else 1 end) * (0.78 + s / 460)));
  else
    made_ql := product_ql(s, tq);
  end if;
  -- And the tree, on the trade the recipe belongs to: the quality of what came
  -- off the bench, however it was arrived at. A hundred is still a hundred.
  made_ql := least(100, made_ql * class_mul(p_world, p_uid, 'fine', r.skill));
  rare := rarity_roll();
  -- More, the go a bauble on the trade comes up in the altar of the settlement you work on.
  v_n := bauble_yield(p_world, p_uid, r.result, r.count);
  v_made := give(p_world, p_uid, r.result, v_n, made_ql, coalesce(r.extra, mat), rare, maker_mark(p_world, p_uid, rare));
  -- A vessel comes off the bench full: a bucket of juice holds its five drinks.
  update item set charges = d.charges from item_def d
    where item.id = v_made and item.charges is null and d.id = item.def and d.charges is not null;
  -- Into the ledger, which is the only memory this island has of what you have
  -- made. It says so when it is your first of a kind or your best.
  perform journal_made(p_world, p_uid, r.result, made_ql, v_n, rare);
  if rare is not null then
    perform journal_note(p_world, p_uid, rare);
    perform tell(p_world, p_uid, rarity_word(rare), 'skill');
  end if;
  for i in select g.item, g.count from recipe_gives g where g.recipe = p_recipe and g.kind = 'return' loop
    perform give(p_world, p_uid, i.item, i.count, 20);
  end loop;

  perform skill_raise(p_world, p_uid, r.skill, 1);
  -- Working a thing out with your hands is what sharpens the head.
  perform skill_raise(p_world, p_uid, 'mind_logic', try_gain(true, craft_head()));
  perform tell(p_world, p_uid, r.done || ' (' || case when mat is not null then lower(mat) || ', ' else '' end
    || 'QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
end $function$;

CREATE OR REPLACE FUNCTION public.perform_dig(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare tx int; ty int; it item; r relic_def; v_skill double precision; v_tool double precision;
        v_part int; v_ql double precision; v_dmg double precision; v_left int; v_new bigint;
        v_missing int[]; v_relic text; v_avg double precision; v_gain double precision;
        /*
         * `v_piece`, not `h`. The seventh time this class has bitten and the
         * first that was not a column name: `h` was the loop variable *and*
         * the alias of `pieces_held(...) h`, so `h.ql` was ambiguous between a
         * record field and a column of the very rows being looped over. Alias
         * every table, prefix every local, and the two can never meet.
         */
        v_piece item;
        v_lectern boolean; v_roll double precision; v_sum double precision;
begin
  if p_action = 'investigate' then
    tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
    perform mark_foraged(p_world, tx, ty, 'dig');
    v_skill := skill_of(p_world, p_uid, 'archaeology');
    v_tool := tool_ql(p_world, p_uid, 'trowel');
    if random() > find_chance(v_skill, v_tool) then
      -- Half a go here, where the browser's blanket pays a whole one. That
      -- disagreement is older than this change and is left where it is: what
      -- moves today is only what a *failed* go is worth.
      perform skill_raise(p_world, p_uid, 'archaeology', try_gain(false, 0.5));
      perform tell(p_world, p_uid,
        'You go through the soil and turn up nothing but roots and small stones.', 'event');
      return;
    end if;
    perform skill_raise(p_world, p_uid, 'archaeology', try_gain(true, 0.5));
    -- A share of whatever comes up is a bauble, whatever the archaeologist
    -- knows: whole, but black with age, and good for nothing until restored.
    if random() < bauble_share() then
      v_relic := bauble_tier_roll();
      v_ql := greatest(1, product_ql(v_skill, v_tool) * (0.55 + random() * 0.35));
      v_dmg := 18 + random() * 50;
      v_new := gather(p_world, p_uid, 'tarnished_bauble', 1, v_ql, v_relic);
      update item set dmg = v_dmg where id = v_new;
      perform tell(p_world, p_uid, 'Your trowel turns up a tarnished ' || v_relic
        || ' bauble. Restore it to see what it does. (QL ' || to_char(v_ql, 'FM990.0')
        || ', damage ' || to_char(v_dmg, 'FM990') || ')', 'event');
      return;
    end if;
    if not exists (select 1 from relics_within(v_skill)) then
      perform tell(p_world, p_uid,
        'You turn up a scrap of something worked, but you cannot tell what it was and it crumbles.',
        'event');
      return;
    end if;
    -- The commonplace comes up far more often than the rare, as it did when
    -- it was lost: weighted by difficulty, and the weights are small numbers.
    select sum(1 / (1 + w.difficulty / 12)) into v_sum from relics_within(v_skill) w;
    v_roll := random() * v_sum;
    for r in select * from relics_within(v_skill) loop
      v_roll := v_roll - 1 / (1 + r.difficulty / 12);
      exit when v_roll <= 0;
    end loop;
    -- A piece you are still short of, if you are short of any.
    v_missing := parts_missing(p_world, p_uid, r.name);
    if coalesce(array_length(v_missing, 1), 0) > 0 then
      v_part := v_missing[1 + floor(random() * array_length(v_missing, 1))::int];
    else
      v_part := 1 + floor(random() * r.parts)::int;
    end if;
    v_ql := greatest(1, product_ql(v_skill, v_tool) * (0.55 + random() * 0.35));
    -- Nothing comes out of the ground sound.
    v_dmg := 18 + random() * 50;
    v_new := gather(p_world, p_uid, 'fragment', 1, v_ql, r.name || ' ' || v_part || '/' || r.parts);
    update item set dmg = v_dmg where id = v_new;
    v_left := coalesce(array_length(parts_missing(p_world, p_uid, r.name), 1), 0);
    perform tell(p_world, p_uid, 'Your trowel turns up a fragment of ' || r.name || ', piece '
      || v_part || ' of ' || r.parts || '. (QL ' || to_char(v_ql, 'FM990.0')
      || ', damage ' || to_char(v_dmg, 'FM990') || ')'
      || case when v_left > 0 then ' ' || v_left || ' of ' || r.parts || ' still missing.'
              else ' That is all ' || r.parts || ' of them.' end, 'event');
    return;
  end if;

  select * into it from item where world_id = p_world and id = target_item(p_target);
  if not found then return; end if;

  if p_action = 'study_book' then
    -- A lectern holds the pages open at the right angle, and you get twice as
    -- much out of the hour.
    v_lectern := exists (select 1 from placed p where p.world_id = p_world and p.kind = 'furniture'
                           and p.sub = 'lectern' and near_piece(p_world, p_uid, p, 2.6));
    v_gain := skill_raise(p_world, p_uid, 'mind_logic',
      (0.5 + it.ql / 90) * case when v_lectern then 2 else 1 end);
    perform damage_item(it.id, 2 + random() * 3);
    perform tell(p_world, p_uid, 'You work through the ' || lower(item_name(it)) || '.'
      || case when v_lectern
              then ' The lectern holds it open at the right angle and you make good use of the hour.'
              else ' Held in one hand, it is hard going. A lectern would be better.' end
      || case when v_gain > 0.0005 then '' else ' There is nothing left in it you do not already know.' end,
      'event');
    return;
  end if;

  if it.def = 'tarnished_bauble' then
    perform restore_bauble(p_world, p_uid, it);
    return;
  end if;

  -- Restoring: every piece in at once, and what comes out is only as good as
  -- the pieces that went in, less what age took.
  v_relic := fragment_relic(it.extra);
  select * into r from relic_def where name = v_relic;
  if not found then return; end if;
  if not skill_check(skill_of(p_world, p_uid, 'restoration'), r.difficulty, 0,
                     mind_ease(p_world, p_uid)) then
    for v_piece in select * from pieces_held(p_world, p_uid, v_relic) loop
      perform damage_item(v_piece.id, 5 + random() * 9);
    end loop;
    perform skill_raise(p_world, p_uid, 'mind_logic', try_gain(false, restore_gain()));
    perform tell(p_world, p_uid, 'The pieces of the ' || r.name
      || ' will not sit together and you mark them trying.', 'event');
    return;
  end if;
  select avg(h.ql * (1 - h.dmg / 200)) into v_avg from pieces_held(p_world, p_uid, v_relic) h;
  -- And the tree, on restoration, which is the mender's and the only quality
  -- on this island that comes out of pieces rather than out of stock.
  v_ql := greatest(1, least(100, v_avg * (0.72 + skill_of(p_world, p_uid, 'restoration') / 260)
                                * class_mul(p_world, p_uid, 'fine', 'restoration')));
  for v_piece in select * from pieces_held(p_world, p_uid, v_relic) loop
    perform consume(p_world, p_uid, 'fragment', 1, v_piece.id);
  end loop;
  v_new := give(p_world, p_uid, r.result, 1, v_ql);
  perform skill_raise(p_world, p_uid, 'mind_logic', try_gain(true, restore_gain()));
  perform tell(p_world, p_uid, 'The pieces go back together and the ' || r.name || ' is whole: '
    || lower((select item_name(i) from item i where i.id = v_new))
    || '. (QL ' || to_char(v_ql, 'FM990.0') || ')', 'event');
end $function$;

CREATE OR REPLACE FUNCTION public.dig_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare tx int; ty int; t tile_def; it item; v_relic text; v_missing int[]; r relic_def;
begin
  if p_action = 'investigate' then
    tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
    if tx is null or not in_bounds(p_world, tx, ty) then return 'There is nothing there.'; end if;
    select * into t from tile_def where id = land_tile(p_world, tx, ty);
    if not t.diggable then return 'There is nothing to go through here.'; end if;
    if has_water(p_world, tx, ty) then return 'Not under water.'; end if;
    if pack_count(p_world, p_uid, 'trowel') < 1 then
      return 'You need a trowel to go through the soil carefully.';
    end if;
    if is_foraged(p_world, tx, ty, 'dig') then
      return 'You have been over this ground already. Try somewhere else.';
    end if;
    return null;
  end if;

  select * into it from item where world_id = p_world and id = target_item(p_target)
    and holder = 'player' and holder_uid = p_uid;
  if not found then return 'It is gone.'; end if;

  if p_action = 'study_book' then
    if it.def <> 'book' then return 'That is not a book.'; end if;
    if it.dmg >= 90 then return 'The pages are too far gone to read. Repair it first.'; end if;
    return null;
  end if;

  if it.def = 'tarnished_bauble' then
    if it.dmg >= 85 then return 'It is too far gone to restore. Repair it first.'; end if;
    return null;
  end if;

  -- Restoring.
  v_relic := fragment_relic(it.extra);
  select * into r from relic_def where name = v_relic;
  if it.def <> 'fragment' or not found then return 'That is not a fragment of anything.'; end if;
  v_missing := parts_missing(p_world, p_uid, v_relic);
  if coalesce(array_length(v_missing, 1), 0) > 0 then
    return 'You are missing ' || array_length(v_missing, 1) || ' of the ' || r.parts
      || ' pieces of the ' || r.name || ' (' || array_to_string(v_missing, ', ') || ').';
  end if;
  if exists (select 1 from pieces_held(p_world, p_uid, v_relic) h where h.dmg >= 85) then
    return 'One of the pieces is too far gone to join. Repair it first.';
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.last_action(p_action text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select p_action in ('plan_bridge', 'build_bridge', 'demolish_bridge',
                      'ring_bell', 'sleep', 'set_home', 'pair_creature', 'read_blood',
                      'dye_item', 'strip_dye', 'start_brew', 'set_bauble')
$function$;

CREATE OR REPLACE FUNCTION public.last_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare p player; pc placed; b bridge; d bridge_def; s bridge_span; c creature; mate creature;
        it item; dye item; bd brew_def; v_kind text; v_short text;
begin
  select * into p from player where world_id = p_world and uid = p_uid;

  if p_action = 'set_bauble' then
    return bauble_refusal(p_world, p_uid, p_target);
  end if;

  if p_action = 'plan_bridge' then
    v_kind := coalesce(p_target->>'material', 'rope');
    return bridge_reason(p_world, v_kind, floor(p.x)::int, floor(p.y)::int,
      (p_target->>'x')::int, (p_target->>'y')::int);

  elsif p_action in ('build_bridge', 'demolish_bridge') then
    select * into b from bridge where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found then return 'It is gone.'; end if;
    select * into d from bridge_def where id = b.kind;
    if p_action = 'build_bridge' then
      select * into s from bridge_span sp where sp.world_id = p_world and sp.bridge = b.id
        and not span_done(sp.needed) order by sp.n limit 1;
      if not found then return 'It is finished.'; end if;
      if tool_ql(p_world, p_uid, d.tool) <= 0 then
        return 'You need a ' || lower((select coalesce(name, d.tool) from item_def where id = d.tool)) || '.';
      end if;
      if sqrt((s.x + 0.5 - p.x) ^ 2 + (s.y + 0.5 - p.y) ^ 2) > 4.5 then
        return 'Work from one end. Walk to the open part of the span.';
      end if;
      select e.key into v_short from jsonb_each(s.needed) e
        where (e.value)::int > 0 and pack_count(p_world, p_uid, e.key) < 1 order by e.key limit 1;
      if v_short is not null then
        return 'That span wants ' || span_wants(s.needed) || '; you are carrying no '
          || lower((select coalesce(name, v_short) from item_def where id = v_short)) || '.';
      end if;
    else
      if sqrt((b.ax + 0.5 - p.x) ^ 2 + (b.ay + 0.5 - p.y) ^ 2) > 4.5
         and sqrt((b.bx + 0.5 - p.x) ^ 2 + (b.by + 0.5 - p.y) ^ 2) > 4.5 then
        return 'Stand at one end of it.';
      end if;
    end if;
    return null;

  elsif p_action = 'ring_bell' then
    select * into pc from placed where world_id = p_world and id = (p_target->>'id')::bigint
      and kind = 'furniture';
    if not found or not coalesce((select f.bell from furniture_def f where f.id = pc.sub), false) then
      return 'That is not a bell.';
    end if;
    if not near_piece(p_world, p_uid, pc) then return 'Stand next to it.'; end if;
    if not on_my_deed(p_world, p_uid, pc.x, pc.y) then
      return 'Ring it on a settlement of yours; a bell in the wild calls nobody.';
    end if;
    return null;

  elsif p_action in ('sleep', 'set_home') then
    select * into pc from placed where world_id = p_world and id = (p_target->>'id')::bigint
      and kind = 'furniture';
    if not found or not is_bed(pc) then return 'That is not a bed.'; end if;
    if not near_piece(p_world, p_uid, pc) then return 'Stand next to it.'; end if;
    if p_action = 'sleep' and not is_night(p_world) then
      return 'It is ' || world_clock(p_world) || ' and broad daylight. Sleep when it is dark.';
    end if;
    if p_action = 'set_home' and p.home_x = pc.x and p.home_y = pc.y then
      return 'You already wake up here.';
    end if;
    return null;

  elsif p_action in ('pair_creature', 'read_blood') then
    perform creature_settle(p_world, (p_target->>'id')::int);
    perform herd_settle(p_world);
    c := target_creature(p_world, p_target);
    if c.world_id is null then return 'It is gone.'; end if;
    if p_action = 'read_blood' then return null; end if;
    if (my_deed(p_world, p_uid)).world_id is null then
      return 'Breeding is settled work. Found a settlement first: the young one goes to the token.';
    end if;
    if not creature_in_reach(p_world, p_uid, c, 2.4) then return 'Stand next to ' || c.name || '.'; end if;
    if c.due is not null then return c.name || ' is already in young.'; end if;
    mate := mate_for(p_world, c);
    if mate.id is null then
      return 'There is no ' || lower((select name from species_def where id = c.species))
        || ' of the other sex within ' || round(pair_range()) || ' tiles. ' || c.name
        || ' is ' || c.sex || '.';
    end if;
    return pair_refuses(p_world, c, mate);

  elsif p_action in ('dye_item', 'strip_dye') then
    select * into it from item where world_id = p_world and id = target_item(p_target)
      and holder = 'player' and holder_uid = p_uid;
    if p_action = 'dye_item' then
      if not found then return 'It is gone.'; end if;
      if not takes_dye(it.def) then return 'Nothing will take on that.'; end if;
      dye := pick_dye(p_world, p_uid);
      if dye.id is null then
        return 'You have no dye. Boil one out of berries, acorns or herbs with a bucket of lye.';
      end if;
      if it.dye = (select id from dye_def where name = dye.extra) then
        return 'It is ' || (select word from dye_def where name = dye.extra) || ' already.';
      end if;
    else
      if not found or it.dye is null then return 'It has taken no colour.'; end if;
      if pack_count(p_world, p_uid, 'lye_bucket') <= 0 then
        return 'You need a bucket of lye to strip it.';
      end if;
    end if;
    return null;

  elsif p_action = 'start_brew' then
    select * into bd from brew_def where id = p_target->>'brew';
    if not found then return 'Choose what to brew.'; end if;
    select * into pc from placed where world_id = p_world and id = (p_target->>'id')::bigint
      and kind = 'furniture';
    return brew_reason(p_world, p_uid, pc, bd);
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.perform_last(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare v_took boolean; p player; pc placed; b bridge; d bridge_def; s bridge_span; c creature; mate creature;
        dam creature; sire creature; it item; dye item; bd brew_def; dd dye_def;
        v_kind text; v_id bigint; v_h int; v_n int; v_left int; v_want text; v_back jsonb;
        v_parts text[]; v_half int; e record; r record; v_skill double precision;
        v_care double precision; v_one bigint; v_stock item; v_ql double precision;
begin
  select * into p from player where world_id = p_world and uid = p_uid;

  if p_action = 'set_bauble' then
    perform perform_bauble(p_world, p_uid, p_target);
    return;
  end if;

  if p_action = 'plan_bridge' then
    v_kind := coalesce(p_target->>'material', 'rope');
    if bridge_reason(p_world, v_kind, floor(p.x)::int, floor(p.y)::int,
         (p_target->>'x')::int, (p_target->>'y')::int) is not null then return; end if;
    select * into d from bridge_def where id = v_kind;
    v_h := round((centre_height(p_world, floor(p.x)::int, floor(p.y)::int)
                + centre_height(p_world, (p_target->>'x')::int, (p_target->>'y')::int)) / 2);
    insert into bridge (world_id, kind, ax, ay, bx, by, height, material, made_by)
    values (p_world, v_kind, floor(p.x)::int, floor(p.y)::int,
            (p_target->>'x')::int, (p_target->>'y')::int, v_h,
            case when v_kind = 'stone' then null else 'Oak' end, p_uid)
    returning id into v_id;
    insert into bridge_span (world_id, bridge, n, x, y, needed, total)
    select p_world, v_id, t.n, t.x, t.y, span_bill(v_kind), span_bill(v_kind)
    from span_tiles(floor(p.x)::int, floor(p.y)::int,
                    (p_target->>'x')::int, (p_target->>'y')::int) t;
    select count(*)::int into v_n from bridge_span sp where sp.world_id = p_world and sp.bridge = v_id;
    perform journal_note(p_world, p_uid, 'planned_bridge');
    perform skill_raise(p_world, p_uid, d.skill, 0.4);
    perform tell(p_world, p_uid, 'You set out a ' || lower(d.name) || ' of ' || v_n || ' span'
      || case when v_n > 1 then 's' else '' end || ' across. Each one wants '
      || span_wants(span_bill(v_kind)) || '. ' || d.note, 'system');

  elsif p_action = 'build_bridge' then
    select * into b from bridge where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found then return; end if;
    select * into d from bridge_def where id = b.kind;
    select * into s from bridge_span sp where sp.world_id = p_world and sp.bridge = b.id
      and not span_done(sp.needed) order by sp.n limit 1;
    if not found then return; end if;
    -- One unit of one thing per go, as with a wall.
    select e2.key into v_want from jsonb_each(s.needed) e2
      where (e2.value)::int > 0 and pack_count(p_world, p_uid, e2.key) > 0 order by e2.key limit 1;
    if v_want is null then return; end if;
    if not consume(p_world, p_uid, v_want, 1) then return; end if;
    update bridge_span sp set needed = jsonb_set(sp.needed, array[v_want],
        to_jsonb(greatest(0, (sp.needed->>v_want)::int - 1)))
      where sp.world_id = p_world and sp.bridge = b.id and sp.n = s.n
      returning * into s;
    perform skill_raise(p_world, p_uid, d.skill, 0.5);
    perform wear_tool((select i.id from item i where i.world_id = p_world and i.holder = 'player'
      and i.holder_uid = p_uid and i.def = d.tool
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1), 0.4);
    if span_done(s.needed) then
      v_left := bridge_left(p_world, b.id);
      if v_left > 0 then
        perform tell(p_world, p_uid, 'That span is decked. ' || v_left || ' still open.', 'event');
      else
        perform journal_note(p_world, p_uid, 'bridged');
        perform tell(p_world, p_uid, 'The last span is decked and the ' || lower(bridge_name(b))
          || ' is open. ' || case when d.carts then 'A cart will cross it.'
                                  else 'Foot traffic only; nothing with a wheel.' end, 'system');
      end if;
    else
      perform tell(p_world, p_uid, 'You work a '
        || lower((select coalesce(name, v_want) from item_def where id = v_want))
        || ' into the span. It still wants ' || span_wants(s.needed) || '.', 'event');
    end if;

  elsif p_action = 'demolish_bridge' then
    select * into b from bridge where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found then return; end if;
    -- Half of what went into it comes back, which is what pulling a thing down
    -- is worth anywhere else in the world.
    v_parts := '{}';
    for e in
      select k.key as item, sum((k.value)::int - coalesce((sp.needed->>k.key)::int, 0))::int as used
      from bridge_span sp cross join lateral jsonb_each(sp.total) k
      where sp.world_id = p_world and sp.bridge = b.id
      group by k.key order by k.key
    loop
      v_half := floor(e.used / 2.0)::int;
      if v_half > 0 then
        perform give(p_world, p_uid, e.item, v_half, 20);
        v_parts := v_parts || (v_half || ' ' ||
          lower((select coalesce(name, e.item) from item_def where id = e.item)));
      end if;
    end loop;
    delete from bridge_span where world_id = p_world and bridge = b.id;
    delete from bridge where world_id = p_world and id = b.id;
    perform tell(p_world, p_uid, case when array_length(v_parts, 1) > 0
      then 'You take the ' || lower(bridge_name(b)) || ' down and save '
           || array_to_string(v_parts, ', ') || '.'
      else 'You take the ' || lower(bridge_name(b)) || ' down.' end, 'event');

  elsif p_action = 'ring_bell' then
    select * into pc from placed where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found then return; end if;
    select * into p from player where world_id = p_world and uid = p_uid;
    r := deed_at(p_world, pc.x, pc.y);
    if r.world_id is null then return; end if;
    v_n := 0;
    -- Every wildermon working the deed drops what it is doing and walks to
    -- whoever rang: a leg to the ringer, and a while standing there before
    -- the work takes it back.
    for e in select cr.*, coalesce(sp.speed, 1) as pace
             from creature cr join species_def sp on sp.id = cr.species
             where cr.world_id = p_world and cr.mode = 'deed' and cr.hitched_to is null
               and cr.keeper in (select m.uid from deed_member m
                                 where m.world_id = p_world and m.founder = r.founded_by
                                 union select r.founded_by)
    loop
      v_ql := greatest(0.5, sqrt(power(p.x - e.to_x, 2) + power(p.y - e.to_y, 2)) / greatest(0.4, e.pace));
      update creature set phase = 'idle', work_x = null, work_y = null, enemy = null,
          from_x = e.to_x, from_y = e.to_y, to_x = p.x, to_y = p.y,
          leg_at = now(), leg_ends = now() + make_interval(secs => v_ql),
          until = now() + make_interval(secs => v_ql + 20)
        where world_id = p_world and id = e.id;
      v_n := v_n + 1;
    end loop;
    -- And every citizen hears where it hangs.
    for e in select m.uid from deed_member m where m.world_id = p_world and m.founder = r.founded_by
             union select r.founded_by
    loop
      if e.uid <> p_uid then
        perform tell(p_world, e.uid, 'The bell rings out over ' || r.name || ' from ' || pc.x || ', ' || pc.y || '.', 'system');
      end if;
    end loop;
    perform journal_note(p_world, p_uid, 'rang');
    perform tell(p_world, p_uid, 'You ring the ' || lower(placed_name(pc)) || ' and it sounds over ' || r.name || '. '
      || case when v_n > 0 then v_n || ' wildermon ' || case when v_n = 1 then 'comes' else 'come' end || ' at the sound'
              else 'Nothing is working the deed to come' end
      || ', and every citizen hears where it hangs: ' || pc.x || ', ' || pc.y || '.', 'event');

  elsif p_action = 'sleep' then
    select * into pc from placed where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found then return; end if;
    /*
     * A well-made bed is a better night than a cot with a thin mattress — and
     * a bed under a roof, in a room with walls all round it, is a better night
     * again than the same bed standing in a field in the weather.
     */
    perform journal_note(p_world, p_uid, 'slept');
    perform sleep_until_morning(p_world, p_uid,
      (select bed from furniture_def where id = pc.sub) * (0.6 + pc.ql / 250)
        * case when indoors(p_world, 0, floor(pc.x)::int, floor(pc.y)::int) then indoors_rest() else 1 end,
      lower(placed_name(pc)));

  elsif p_action = 'set_home' then
    select * into pc from placed where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found then return; end if;
    update player set home_x = pc.x, home_y = pc.y where world_id = p_world and uid = p_uid;
    perform tell(p_world, p_uid, 'You make up the ' || lower(placed_name(pc))
      || '. This is where you will wake, whatever happens to you.', 'event');

  elsif p_action = 'pair_creature' then
    c := target_creature(p_world, p_target);
    mate := mate_for(p_world, c);
    if c.world_id is null or mate.id is null or pair_refuses(p_world, c, mate) is not null then return; end if;
    if c.sex = 'female' then dam := c; sire := mate; else dam := mate; sire := c; end if;
    v_skill := skill_of(p_world, p_uid, 'animal_husbandry');
    v_care := (dam.care + sire.care) / 2;
    v_took := random() < breed_chance(v_skill, v_care);
    perform skill_raise(p_world, p_uid, 'animal_husbandry', try_gain(v_took, breed_gain()));
    if not v_took then
      -- A failed pairing costs both of them a rest, but only half of one.
      update creature set bred_at = now() - make_interval(secs => breed_rest() / 2)
        where world_id = p_world and id in (dam.id, sire.id);
      perform tell(p_world, p_uid, dam.name || ' and ' || sire.name
        || ' will have nothing to do with one another. Brush them, feed them, and try again.', 'error');
      return;
    end if;
    perform pair_them(p_world, dam.id, sire.id, v_skill);
    perform journal_note(p_world, p_uid, 'paired');
    perform tell(p_world, p_uid, sire.name || ' is put to ' || dam.name
      || '. She is in young and will drop in about ' || clock_left(gestation())
      || '. Between them they carry '
      || trait_names((select array_agg(distinct t) from unnest(sire.traits || dam.traits) t))
      || '.', 'event');

  elsif p_action = 'read_blood' then
    c := target_creature(p_world, p_target);
    if c.world_id is null then return; end if;
    perform tell(p_world, p_uid, blood_read(p_world, p_uid, c), 'event');

  elsif p_action = 'dye_item' then
    select * into it from item where world_id = p_world and id = target_item(p_target);
    dye := pick_dye(p_world, p_uid);
    if it.id is null or dye.id is null then return; end if;
    select * into dd from dye_def where name = dye.extra;
    if not consume(p_world, p_uid, 'dye', 1) then return; end if;
    -- One pot does one thing. A stack is split so the rest stays as it was.
    if it.count > 1 then
      update item set count = count - 1 where id = it.id;
      insert into item (world_id, holder, holder_uid, def, ql, dmg, count, extra, rare, dye)
      values (p_world, it.holder, it.holder_uid, it.def, it.ql, it.dmg, 1, it.extra, it.rare, dd.id);
    else
      update item set dye = dd.id where id = it.id;
    end if;
    perform journal_note(p_world, p_uid, 'dyed');
    perform skill_raise(p_world, p_uid, 'alchemy', 0.3);
    perform tell(p_world, p_uid, 'You work the ' || lower(dd.name)
      || ' through it. It comes out ' || dd.word || '.', 'event');

  elsif p_action = 'strip_dye' then
    select * into it from item where world_id = p_world and id = target_item(p_target);
    if it.id is null then return; end if;
    select * into dye from item i where i.world_id = p_world and i.holder = 'player'
      and i.holder_uid = p_uid and i.def = 'lye_bucket' order by i.id limit 1;
    if dye.id is null or not consume(p_world, p_uid, 'lye_bucket', 1) then return; end if;
    perform give(p_world, p_uid, 'bucket', 1, dye.ql);
    update item set dye = null where id = it.id;
    perform skill_raise(p_world, p_uid, 'alchemy', 0.2);
    perform tell(p_world, p_uid, 'You boil it out in lye. It is back to the colour of '
      || lower((select coalesce(name, it.def) from item_def where id = it.def)) || '.', 'event');

  elsif p_action = 'start_brew' then
    select * into bd from brew_def where id = p_target->>'brew';
    select * into pc from placed where world_id = p_world and id = (p_target->>'id')::bigint;
    if bd.id is null or pc.id is null
       or brew_reason(p_world, p_uid, pc, bd) is not null then return; end if;
    -- What goes in decides most of what comes out; the hand only decides how
    -- much of it survives the working.
    select i.* into v_stock from craft_stock(p_world, p_uid) h join item i on i.id = h.id
      where h.def = bd.input order by h.draw limit 1;
    v_ql := coalesce(v_stock.ql, 20);
    if not craft_consume(p_world, p_uid, bd.input, bd.count) then return; end if;
    if not skill_check(skill_of(p_world, p_uid, 'brewing'), bd.difficulty, 0) then
      update placed set litres = greatest(0, placed_litres(pc) - bd.litres), since = now()
        where id = pc.id;
      update placed set liquid = null where id = pc.id and litres <= 0;
      perform skill_raise(p_world, p_uid, 'brewing', try_gain(false, brew_gain()));
      perform tell(p_world, p_uid, 'It will not take. You tip the whole soured lot out of the '
        || lower(placed_name(pc)) || '.', 'event');
      return;
    end if;
    update placed set litres = bd.litres, liquid = bd.id, ferment = bd.seconds, since = now(),
        ql = greatest(1, least(100, (v_ql + skill_of(p_world, p_uid, 'brewing')) / 2))
      where id = pc.id;
    perform journal_note(p_world, p_uid, 'brew');
    perform journal_note(p_world, p_uid, 'brew:' || bd.id);
    perform skill_raise(p_world, p_uid, 'brewing', try_gain(true, brew_gain()));
    perform tell(p_world, p_uid, bd.done || ' (about ' || round(bd.seconds / 60) || ' minutes)', 'event');
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.rpc_ground(p_world uuid, p_range double precision DEFAULT 40, p_slow boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); p player;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  select * into p from player where world_id = p_world and uid = me;
  if not found then raise exception 'you are not on this island'; end if;
  /*
   * On the slow half only, because this writes.
   *
   * The fast read runs about once a second per body — everything burning, what
   * is on the tile under you — and a settle on that path is an update a second
   * per player whether or not anything is due. The crops ride the slow half
   * beside the settlements, and any of your own work forces one of those, so
   * sowing is seen at once and a stage is at worst one reconcile late.
   */
  if p_slow then perform crops_settle(p_world, p.x, p.y, p_range); end if;
  return jsonb_build_object(
    'placed', coalesce((select jsonb_agg(
        (to_jsonb(pl) - 'world_id' - 'made_by' - 'since' - 'made_at' - 'cx' - 'cy' - 'crumbles_at')
        || jsonb_build_object('fuel', placed_fuel(pl), 'ash', placed_ash(pl),
                              'lit', placed_lit(pl), 'mine', coalesce(pl.made_by = me, false),
        /*
         * And what is in it, which this never said.
         *
         * Reported as "i opened it and dragged my dirt into it and the dirt
         * vanished". It had not: the island had the dirt in the bin and told
         * nobody. Every chest, bin, larder and cart on an island read as
         * empty over there, so anything put away went out of the pack and was
         * never seen again — the same hole a crate fell down before crates
         * carried their contents, and closed the same way. Within six tiles
         * only: you must be within two and a half to reach into one, so six
         * is generous, and a yard of full chests is not worth a phone's
         * second.
         */
                              'things', case when pl.kind = 'furniture'
                                              and greatest(abs(pl.cx - p.x), abs(pl.cy - p.y)) <= 6
                                              -- A grave's, to whoever lies under it and nobody else.
                                              and (pl.crumbles_at is null or pl.made_by = me)
                                then coalesce((select jsonb_agg(jsonb_build_object(
                                       'id', i.id, 'def', i.def, 'ql', i.ql, 'dmg', i.dmg,
                                       'count', i.count, 'extra', i.extra) order by i.id)
                                     from item i
                                     where i.world_id = p_world and i.holder = 'furniture' and i.placed = pl.id),
                                   '[]'::jsonb)
                                else '[]'::jsonb end)
        /*
         * Whether a helm is as good as empty, its holder gone away, and who is
         * aboard as a passenger and in which place: only for a piece that has
         * either, so nothing else carries two more keys it does not need.
         */
        || case when pl.driver is null then '{}'::jsonb
                else jsonb_build_object('helm_open', coalesce((select r.away from player r
                       where r.world_id = p_world and r.uid = pl.driver), true)) end
        || coalesce((select jsonb_build_object('riders', jsonb_agg(jsonb_build_object('uid', r.uid, 'seat', r.seat)
                       order by r.seat))
                     from player r where r.world_id = p_world and r.aboard = pl.id
                     having count(*) > 0), '{}'::jsonb)
        /*
         * And a grave: whose it is, for what anybody else is told when they
         * try it; the seconds it has left, which a browser counts down on its
         * own clock rather than reading this island's; and, to its owner, how
         * many things are in it, which `things` only says from within reach --
         * the way `units` rides beside a crate's contents.
         */
        || case when pl.crumbles_at is null then '{}'::jsonb
                else jsonb_build_object('grave', jsonb_build_object('name', grave_owner(pl),
                       'left', greatest(0, extract(epoch from (pl.crumbles_at - now()))),
                       'units', case when pl.made_by = me then (select coalesce(sum(i.count), 0) from item i
                                  where i.placed = pl.id and i.holder = 'furniture') end)) end
        order by pl.id)
      from placed pl
      where pl.world_id = p_world
        -- The box first, in the whole tiles `placed_near` is keyed on, and then
        -- the exact question. A btree cannot look up a function of a column, so
        -- the exact test on its own read every placed thing on the island, on
        -- every ground poll, for every player. `x` is `floor(cx)` and `y` is
        -- `floor(cy)` -- `drag_along` and every placing write both together --
        -- so a tile of slack each way makes the box a superset of the answer
        -- and the line below still decides who is in it.
        and pl.x between floor(p.x - p_range)::int - 1 and floor(p.x + p_range)::int + 1
        and pl.y between floor(p.y - p_range)::int - 1 and floor(p.y + p_range)::int + 1
        and greatest(abs(pl.cx - p.x), abs(pl.cy - p.y)) <= p_range), '[]'::jsonb),
    'crates', crates_near(p_world, me, p_range),
    /*
     * And what is lying on the ground, which this never carried.
     *
     * Reported as "killed a roxxa, no corpse dropped to butcher, or at least
     * isn't displaying". The corpse was there: `wound_beast` drops one where
     * the thing fell, and the suite has measured it since kills were ported.
     * This sent the fires, the crates, the crops and the walls, and never a
     * thing lying on the grass — and the browser's map of the ground was only
     * ever written by its own rules, which do not run on an island. So a
     * corpse, a log a worker put down, a hatchet somebody else dropped: all
     * in this table and drawn by nobody.
     *
     * On the fast half, because a corpse is looked for the second the thing
     * goes down; `item_on_ground` serves the box. The whole row, the way the
     * pack is sent, so the browser reads it with the same map.
     */
    'lying', coalesce((select jsonb_agg(to_jsonb(i) - 'world_id' order by i.id)
      from item i
      where i.world_id = p_world and i.holder = 'ground'
        and i.gx between floor(p.x - p_range)::int and floor(p.x + p_range)::int
        and i.gy between floor(p.y - p_range)::int and floor(p.y + p_range)::int), '[]'::jsonb))
  /*
   * And the half that hardly ever moves.
   *
   * A fire burns down and a kiln works through its load while you stand and
   * watch it, which is why this is asked for every second. A wall is not like
   * that: it goes up when somebody builds it and then it is a wall. Sending
   * both at one pace meant a correlated subquery over `building_tile` per
   * building, a scan of `wall` and one of `floor_tile`, every second for every
   * player, to say that the house is still a house.
   *
   * So the caller says whether it wants them. A browser asks for the lot on
   * its twenty-second reconcile and after any of its own work, and for the
   * burning half the rest of the time. Left out rather than emptied: the
   * browser applies only the keys it is given, so what it holds stands.
   *
   * `p_slow` defaults true, so a page that has not been redeployed gets
   * exactly what it always got.
   */
  || case when not p_slow then '{}'::jsonb else jsonb_build_object(
    /*
     * And everybody ashore, on the slow half, which is the beat that already
     * carries the settlements. The map draws them; `folk_ashore` decides
     * whether there is anything to draw them at.
     */
    'folk', folk_ashore(p_world, me),
    /*
     * And every grave of yours, however far off: you wake a long way from
     * where you fell, and `placed` above is only what is in range. The map
     * marks them and takes the mark up when one goes. Off the index the
     * sweep uses, which holds nothing but graves.
     */
    'graves', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'x', g.x, 'y', g.y) order by g.id)
      from placed g
      where g.world_id = p_world and g.crumbles_at is not null and g.made_by = me), '[]'::jsonb),
    /*
     * What is growing here, settled first so the stage reported is the stage
     * it is actually at rather than the stage it was at when somebody last
     * touched it. Everything on this island settles lazily off a timestamp,
     * and for a crop nobody had ever been the one to ask.
     *
     * `ago` rather than `stage_at`: the browser counts in its own seconds and
     * has no use for the hour this island stamped on it.
     */
    'crops', coalesce((select jsonb_agg(jsonb_build_object(
        'x', c.x, 'y', c.y, 'id', c.id, 'stage', c.stage,
        'ago', extract(epoch from (now() - c.stage_at)),
        'tended', c.tended, 'tendedNow', c.tended_now, 'ql', c.ql))
      from crop c
      where c.world_id = p_world
        and greatest(abs(c.x + 0.5 - p.x), abs(c.y + 0.5 - p.y)) <= p_range), '[]'::jsonb),
    /*
     * The felling notches near you, and how long ago the woods last turned
     * over. Look reads both: "2 of 3 strokes in it", "the woods turn over in
     * 9 hours". A browser on an island keeps no clock of its own for the
     * woods, so this is the only place it hears the hour.
     */
    'notches', coalesce((select jsonb_agg(jsonb_build_object('x', n.x, 'y', n.y, 'cuts', n.cuts))
      from tree_notch n
      where n.world_id = p_world
        and greatest(abs(n.x + 0.5 - p.x), abs(n.y + 0.5 - p.y)) <= p_range), '[]'::jsonb),
    'treesAgo', (select extract(epoch from (now() - w.trees_at)) from world w where w.id = p_world),
    -- The mark the ground is being worked to, which lives on the player row
    -- so that it is the same mark in every browser you open.
    'level', p.level_h,
    -- What you are on each of them, so the browser can say what you may do
    -- rather than finding out by being refused. Your own first one is your
    -- own or one you were asked onto; either way `deed_role` says which.
    'deed', (select jsonb_build_object(
        'name', d.name, 'x', d.x, 'y', d.y, 'radius', d.radius, 'level', d.level, 'mine', true,
        'role', deed_role(p_world, d.founded_by, me),
        'baubles', deed_baubles_json(p_world, d.founded_by))
      from my_deed(p_world, me) d where d.world_id is not null),
    'deeds', coalesce((select jsonb_agg(jsonb_build_object(
        'name', d.name, 'x', d.x, 'y', d.y, 'radius', d.radius, 'level', d.level,
        -- Land you were asked onto is land you may work, so it is drawn as
        -- yours rather than as a stranger's border you happen to be inside.
        'mine', exists (select 1 from deed_member m where m.world_id = p_world
                          and m.uid = me and m.founder = d.founded_by),
        'role', deed_role(p_world, d.founded_by, me),
        'holder', account_name(d.founded_by),
        -- And what is in its altar, for the settlements you are a citizen of.
        'baubles', case when exists (select 1 from deed_member m where m.world_id = p_world
                                       and m.uid = me and m.founder = d.founded_by)
                        then deed_baubles_json(p_world, d.founded_by) end) order by d.founded_at)
      from deed d
      where d.world_id = p_world and d.founded_by <> me
        and greatest(abs(d.x + 0.5 - p.x), abs(d.y + 0.5 - p.y)) <= p_range + d.radius),
      '[]'::jsonb),
    /*
     * And what is standing.
     *
     * `building`, `wall` and `floor_tile` have been kept here since buildings
     * were ported and have never been sent to anybody. The rules answered
     * about them, a plan went up in Postgres, and no browser ever drew a wall
     * of it — so on an island a building was invisible to everyone, the person
     * who planned it included.
     *
     * Shaped as the browser's own `BuildingsJSON`, so it is laid straight in.
     * A building comes along whole if any of its tiles is in range: half a
     * house is worse than none, and a house is a handful of rows.
     */
    'buildings', jsonb_build_object(
      'nextId', coalesce((select max(b.id) + 1 from building b where b.world_id = p_world), 1),
      'list', coalesce((select jsonb_agg(jsonb_build_object(
          'id', b.id, 'name', b.name, 'levels', b.levels, 'workLevel', b.work_level,
          'tiles', (select coalesce(jsonb_agg(bt.x || ',' || bt.y order by bt.y, bt.x), '[]'::jsonb)
                      from building_tile bt
                     where bt.world_id = p_world and bt.building = b.id)) order by b.id)
        from building b
        where b.world_id = p_world
          and exists (select 1 from building_tile bt
                       where bt.world_id = p_world and bt.building = b.id
                         and greatest(abs(bt.x + 0.5 - p.x), abs(bt.y + 0.5 - p.y)) <= p_range)),
        '[]'::jsonb),
      'walls', coalesce((select jsonb_agg(jsonb_build_object(
          'building', w.building, 'level', w.level, 'x', w.x, 'y', w.y, 'dir', w.dir,
          'type', w.type, 'material', w.material, 'needed', w.needed, 'total', w.total)
          order by w.level, w.dir, w.x, w.y)
        from wall w
        where w.world_id = p_world
          and greatest(abs(w.x + 0.5 - p.x), abs(w.y + 0.5 - p.y)) <= p_range), '[]'::jsonb),
      'floors', coalesce((select jsonb_agg(jsonb_build_object(
          'building', f.building, 'level', f.level, 'x', f.x, 'y', f.y,
          'material', f.material, 'kind', f.kind, 'facing', f.facing,
          'needed', f.needed, 'total', f.total) order by f.level, f.x, f.y)
        from floor_tile f
        where f.world_id = p_world
          and greatest(abs(f.x + 0.5 - p.x), abs(f.y + 0.5 - p.y)) <= p_range), '[]'::jsonb)),
    /*
     * And the slabs, which are not buildings and do not go in with them: a
     * foundation is ground somebody poured, and the browser lays it beside the
     * terrain rather than inside a house.
     */
    'foundations', coalesce((select jsonb_agg(jsonb_build_object(
        'id', fo.id, 'x', fo.x, 'y', fo.y, 'top', fo.top,
        'needed', fo.needed, 'total', fo.total) order by fo.id)
      from foundation fo
      where fo.world_id = p_world
        and greatest(abs(fo.x + 0.5 - p.x), abs(fo.y + 0.5 - p.y)) <= p_range), '[]'::jsonb),
    'nextFoundationId', coalesce((select max(fo.id) + 1 from foundation fo where fo.world_id = p_world), 1)) end;
end $function$;

select private.lock_doors();
