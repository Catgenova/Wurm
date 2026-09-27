/*
 * The Herdsman moved onto perks: its eighteen, on the island.
 *
 * The tenth trade off its tree (`PERK_CLASSES`). Its perks are rows the
 * definitions already carry (`class_perk`). What is here is every rule they
 * change, each reading its key off the fold with the rule's own number as the
 * default, so that for anybody without the perk nothing moves:
 *
 *   * taming (`tame_chance`, `perform_creature`, `creature_refusal`): Soft
 *     Hand's points on every offering, over the rest and under the ceiling;
 *     Patient Coax's bigger step for each refused one (`coax_bonus`, which
 *     takes the step now); Young Trust's easier young; and Any Bait's any food
 *     as an offering (`bait_in_pack`, which takes whether any food will do);
 *   * the brush: Brushwork's more care and Healing Hands' more health;
 *   * a beast you keep (`creature.kept`): Light Eaters, Lasting Care, Well
 *     Kept and Long-lived are the keeper's, read where nobody is acting -- the
 *     creature tick, the work and learning, the age -- so the keeper's numbers
 *     are stamped on the beast: when it changes hands (`creature_kept_*`) and
 *     when its keeper's perks change (`class_fold`). An age is asked with the
 *     keeper's threshold (`age_of`, `age_row`, `old_of`) everywhere it is asked;
 *   * the pairing (`perform_last`, `pair_them`, `breed_traits`): Short Rest,
 *     Quick Gestation, Twins, True Blood, Bred Up and Choose the Sex are the
 *     breeder's, settled at the covering; a birth drops a twin as it drops the
 *     first (`give_birth`, `drop_young`);
 *   * Stud Book says the odds on examining one of yours (`stud_book`).
 *
 * Light Crate is a key every pack already reads (`weight:`), and needs nothing
 * here.
 *
 * The Herdsman's nodes go with its tree, and every Herdsman's fold is written
 * again, which stamps what they keep.
 */
set local lock_timeout = '3s';

/* What its keeper's perks make of keeping a beast (a Herdsman's), stamped on it. */
alter table creature add column if not exists kept jsonb;

/* A keeper's numbers for keeping a beast: the `kept:` keys of their fold, or nothing. */
create or replace function kept_of(p_world uuid, p_uid uuid) returns jsonb
  language sql stable as $$
  select nullif(coalesce((select jsonb_object_agg(e.key, e.value)
                            from player pl, jsonb_each(coalesce(pl.class_mul->'fx', '{}'::jsonb)) e
                           where pl.world_id = p_world and pl.uid = p_uid and e.key like 'kept:%'), '{}'::jsonb), '{}'::jsonb)
$$;

/* The seconds a beast lives before it is old: its keeper's Long-lived, or the rule's. The browser's `keptOf`. */
create or replace function old_of(c creature) returns double precision
  language sql stable as $$
  select coalesce((c.kept->>'kept:old_at')::double precision, old_at())
$$;

/*
 * How old a creature is, and what that makes of it, at the threshold it turns
 * old at. Every caller hands the creature's own (`old_of`); one that does not
 * gets the rule's.
 */
drop function if exists age_row(timestamptz);
drop function if exists age_of(timestamptz);
create or replace function age_of(p_born timestamptz, p_old_at double precision default null) returns text
  language sql stable as $$
  select case
    when p_born is null then 'grown'
    when now() - p_born < make_interval(secs => young_for()) then 'young'
    when now() - p_born < make_interval(secs => coalesce(p_old_at, old_at())) then 'grown'
    else 'old' end
$$;
create or replace function age_row(p_born timestamptz, p_old_at double precision default null) returns age_def
  language sql stable as $$ select * from age_def where id = age_of(p_born, p_old_at) $$;

/* What a run of offerings is worth to the next one: each worth the offerer's step (a Herdsman's Patient Coax). */
drop function if exists coax_bonus(creature);
create or replace function coax_bonus(c creature, p_step double precision default coax_step()) returns double precision
  language sql stable as $$
  select case when c.coaxed <= 0 or c.coaxed_at is null
                or now() - c.coaxed_at > make_interval(secs => coax_lapse()) then 0
              else c.coaxed * p_step end
$$;

/*
 * The first thing in the pack a species will take: its own diet, or, for an
 * offering from a Herdsman with Any Bait, any food at all. The browser's
 * `bait`.
 */
drop function if exists bait_in_pack(uuid, uuid, text);
create or replace function bait_in_pack(p_world uuid, p_uid uuid, p_species text, p_any boolean default false) returns text
  language sql stable as $$
  select i.def from item i
  where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid
    and (is_bait_for(p_species, i.def)
         or (p_any and coalesce((select d.food from item_def d where d.id = i.def), 0) > 0))
  order by i.id limit 1
$$;

/* What care is worth: up to its keeper's Well Kept brushed to a shine, or the rule's. The browser's `careMul`. */
create or replace function care_mul(c creature) returns double precision
  language sql immutable as $$
  select 1 + least(1, greatest(0, c.care)) * coalesce((c.kept->>'kept:care_bonus')::double precision, care_bonus())
$$;

CREATE OR REPLACE FUNCTION public.tame_chance(p_world uuid, p_uid uuid, c creature)
 RETURNS double precision
 LANGUAGE sql
 STABLE
AS $function$
  select case when d.monster then 0 else
    greatest(0, least(0.95, (d.tame_chance
      + (skill_of(p_world, p_uid, 'taming') - d.tame_level) / 200
      + case when c.hunger < 0.5 then 0.1 else 0 end
      + coax_bonus(c, pk(p_world, p_uid, 'coax:step', coax_step()))
      + greatest(0, (skill_of(p_world, p_uid, 'soul_strength') - 20) * 0.002))
      -- A young one easier still for a Herdsman's Young Trust.
      * case when age_of(c.born, old_of(c)) = 'young' then pk(p_world, p_uid, 'tame:young', (age_row(c.born, old_of(c))).tame)
             else (age_row(c.born, old_of(c))).tame end
      -- Gentle hand: a wild thing is a quarter readier to trust you.
      * case when walks(p_world, p_uid, 'love', 3) then 1.25 else 1 end
      * class_mul(p_world, p_uid, 'tame', 'soul_strength')
      -- And every offering so many points likelier for a Herdsman's Soft Hand, over all the rest of it.
      + pk(p_world, p_uid, 'tame:offer', 0))) end
  from species_def d where d.id = c.species
$function$;

CREATE OR REPLACE FUNCTION public.creature_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare c creature; d species_def; food text; held int; working int; cap int;
begin
  -- Opening a crate you carry is asked of the crate, not of a creature.
  if p_action in ('crate_follow', 'crate_work') then
    return crate_open_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Walked forward before it is looked at: where it was is not where it is.
  perform creature_settle(p_world, (p_target->>'id')::int);
  c := target_creature(p_world, p_target);
  if c.world_id is null then return 'It is gone.'; end if;
  select * into d from species_def where id = c.species;

  -- In the traces until somebody takes it out: nothing that would send it
  -- anywhere else is open to it, in the words culling one already uses.
  if p_action in ('assign_deed', 'take_creature', 'crate_creature', 'release_creature')
     and c.hitched_to is not null then
    return c.name || ' is in the traces. Take it out first.';
  end if;

  -- Only your own is yours to send anywhere, put in a crate, order about or name.
  if p_action in ('take_creature', 'assign_deed', 'crate_creature', 'release_creature', 'cull_creature',
                  'set_stance', 'rename_creature')
     and c.mode <> 'wild' and c.keeper is distinct from p_uid then
    return c.name || ' is not yours.';
  end if;

  if p_action not in ('examine_creature', 'assign_deed')
     and not creature_in_reach(p_world, p_uid, c) then
    return case when c.mode = 'wild' then 'The ' || lower(d.name) || ' is not close enough.'
                else 'Stand next to ' || c.name || '.' end;
  end if;

  if p_action = 'tame' then
    if d.monster then
      return 'A ' || lower(d.name) || ' is not a wildermon. There is nothing to be done with it but kill it.';
    end if;
    if c.mode <> 'wild' then return c.name || ' is already yours.'; end if;
    if skill_of(p_world, p_uid, 'taming') < d.tame_level then
      return 'You need taming ' || to_char(d.tame_level, 'FM990.#') || ' to try.';
    end if;
    if bait_in_pack(p_world, p_uid, c.species, pk(p_world, p_uid, 'bait:any', 0) > 0) is null then
      return d.name || 's take ' || diet_text(c.species) || '. Bring some.';
    end if;
    -- The first follows you, and every one after that goes into a crate you carry.
    return tame_room_refusal(p_world, p_uid);

  elsif p_action = 'assign_deed' then
    if c.mode = 'wild' then return 'It is not yours to set to work.'; end if;
    if c.mode = 'stored' then return c.name || ' is in a creature crate. Open the crate to set it to work.'; end if;
    if (my_deed(p_world, p_uid)).world_id is null then
      return 'You have no settlement to assign it to.';
    end if;
    if d.gathers is null then return 'A ' || lower(d.name) || ' has no trade to be set to.'; end if;
    -- A trade asked for by name has to be one of its own.
    if nullif(p_target->>'job', '') is not null
       and not (p_target->>'job' = d.gathers or p_target->>'job' = any(coalesce(d.trades, '{}'::text[]))) then
      return 'A ' || lower(d.name) || ' cannot be set to that.';
    end if;
    if not worker_job_ported(coalesce(nullif(p_target->>'job', ''), d.gathers)) then
      return 'Nobody has taught this island what '
        || (select plain from gather_def where id = coalesce(nullif(p_target->>'job', ''), d.gathers))
        || ' looks like yet.';
    end if;
    -- One off a post takes a place as much as one off the road, since a post costs none.
    if c.mode <> 'deed' or c.post is not null then
      working := workers_on_deed(p_world, p_uid);
      cap := worker_cap(p_world, p_uid);
      if working >= cap then
        return (my_deed(p_world, p_uid)).name || ' has work for ' || cap
          || ' wildermon at level ' || cap || '. Upgrade the settlement to take on more.';
      end if;
    end if;
    return null;

  elsif p_action = 'feed' then
    if c.mode not in ('active', 'deed') then return 'It is not yours to feed.'; end if;
    if bait_in_pack(p_world, p_uid, c.species) is null then
      return 'It eats ' || diet_text(c.species) || '.';
    end if;
    return null;

  elsif p_action = 'groom' then
    if d.monster then return 'Not that. Not ever.'; end if;
    if c.mode = 'wild' then return 'It is not yours to brush.'; end if;
    if pack_count(p_world, p_uid, 'brush') <= 0 then return 'You need a brush.'; end if;
    if c.care >= 0.995 then return c.name || ' has been brushed to a shine already.'; end if;
    return null;

  elsif p_action = 'shear' then
    if d.fleece is null then return 'There is nothing on it worth shearing.'; end if;
    if c.mode = 'wild' then return 'Tame it first; it will not stand still for you otherwise.'; end if;
    if pack_count(p_world, p_uid, 'carving_knife') <= 0 then return 'You need a knife to shear with.'; end if;
    if c.fleece < 0.35 then
      return c.name || ' has hardly any '
        || case when d.shear_yield = 'feather' then 'feathers' else 'fleece' end || ' back yet.';
    end if;
    return null;

  elsif p_action = 'milk_creature' then
    if not d.milk then return 'That is not something you milk.'; end if;
    if c.mode in ('wild', 'stored') then return 'It is not yours to milk.'; end if;
    if pack_count(p_world, p_uid, 'bucket') <= 0 then return 'You need an empty bucket.'; end if;
    if c.sex <> 'female' then return c.name || ' is male. Nothing is coming out of him.'; end if;
    if c.fleece < 0.4 then return c.name || ' has nothing to give yet.'; end if;
    return null;

  elsif p_action = 'set_stance' then
    if c.mode <> 'active' then return 'Only a companion takes orders like that.'; end if;
    if coalesce(p_target->>'stance', '') not in ('passive', 'defensive', 'aggressive') then
      return 'Passive, defensive or aggressive.';
    end if;
    return null;

  elsif p_action = 'rename_creature' then
    if c.mode = 'wild' then return 'It is not yours to name.'; end if;
    if nullif(btrim(coalesce(p_target->>'name', '')), '') is null then return 'Choose a name.'; end if;
    return null;

  elsif p_action = 'take_creature' then
    if c.mode = 'stored' then return c.name || ' is in a creature crate. Open the crate to let it out.'; end if;
    if c.mode <> 'deed' then return 'It is already with you.'; end if;
    -- Where the one following you now goes, or why it has nowhere to.
    return (companion_swap(p_world, p_uid, c)).v_why;

  elsif p_action = 'crate_creature' then
    if c.mode = 'stored' then return c.name || ' is already in a creature crate.'; end if;
    if c.mode not in ('active', 'deed') then return 'It is not yours to put in a crate.'; end if;
    if c.rider is not null then return 'Get down off ' || c.name || ' first.'; end if;
    if empty_crate(p_world, p_uid) is null then return 'You need an empty creature crate in your pack.'; end if;
    return null;

  elsif p_action = 'release_creature' then
    if c.mode = 'wild' then return 'It is already wild.'; end if;
    if c.mode = 'stored' and exists (select 1 from item i where i.world_id = p_world and i.creature = c.id
                                        and (i.deal is not null or i.holder <> 'player')) then
      return c.name || '''s crate is on offer, on a stall or in the post. Take it back first.';
    end if;
    return null;

  elsif p_action = 'cull_creature' then
    -- Only your own, and only one that is not in the traces or under you when
    -- you ask: both of those are a mess this does not have to make.
    if c.mode = 'wild' then return 'That one is nobody''s. Fight it if you mean it.'; end if;
    if c.hitched_to is not null then return c.name || ' is in the traces. Take it out first.'; end if;
    if c.rider is not null then return 'Get down off ' || c.name || ' first.'; end if;
    if c.mode = 'stored' and exists (select 1 from item i where i.world_id = p_world and i.creature = c.id
                                        and (i.deal is not null or i.holder <> 'player')) then
      return c.name || '''s crate is on offer, on a stall or in the post. Take it back first.';
    end if;
    return null;
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.perform_creature(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare c creature; d species_def; a age_def; food text; n int; made_ql double precision;
        gained double precision; chance double precision; warm double precision; nm text;
        held int; brush_id bigint; top double precision; before double precision; skill double precision;
        dd deed; v_swap int; v_to text; v_why text; v_more boolean := false;
begin
  -- Opening a crate is asked of the crate, standing or carried.
  if p_action in ('crate_follow', 'crate_work') then
    perform perform_crate_open(p_world, p_uid, p_action, p_target);
    return;
  end if;
  c := target_creature(p_world, p_target);
  if c.world_id is null then return; end if;
  select * into d from species_def where id = c.species;
  a := age_row(c.born, old_of(c));

  if p_action = 'examine_creature' then
    if c.mode = 'wild' and d.monster then
      perform tell(p_world, p_uid, 'A ' || lower(d.name) || ': ' || d.description
        || ' It has ' || ceil(c.health) || ' of ' || max_health(c) || ' in it and hits for '
        || to_char(attack_of(c), 'FM990') || '. It cannot be tamed. Kill it and butcher it, or keep well clear.', 'error');
    elsif c.mode = 'wild' then
      warm := coax_bonus(c, pk(p_world, p_uid, 'coax:step', coax_step()));
      perform tell(p_world, p_uid, 'A wild ' || lower(d.name) || ': ' || d.description
        || ' It eats ' || diet_text(c.species) || '.'
        || case when warm > 0 then ' It has taken ' ||
             case when c.coaxed = 1 then 'an offering' else c.coaxed || ' offerings' end
             || ' from your hand and is ' || to_char(warm * 100, 'FM990') || '% readier for the next.'
           else '' end
        || ' You would have to tame it to learn more.', 'event');
    else
      perform tell(p_world, p_uid, c.name || ' (' || c.sex || ' ' || lower(d.name) || ', ' || a.name
        || '): ' || d.description || ' Level ' || creature_level(c.skills)
        || '. Health ' || ceil(c.health) || '/' || max_health(c) || '. It is ' || care_word(c.care)
        || ' and carries ' || trait_names(c.traits) || '. '
        || case when c.hunger < 0.3 then 'It looks hungry.' when c.hunger < 0.6 then 'It could eat.'
                else 'It looks well fed.' end
        || ' It eats ' || diet_text(c.species) || '.'
        -- And the odds of a pairing, for a Herdsman's Stud Book.
        || stud_book(p_world, p_uid, c), 'event');
    end if;

  elsif p_action = 'tame' then
    -- Any food as an offering for a Herdsman's Any Bait.
    food := bait_in_pack(p_world, p_uid, c.species, pk(p_world, p_uid, 'bait:any', 0) > 0);
    if food is null then return; end if;
    -- The crate may have gone out of the pack since the offering was begun.
    if tame_room_refusal(p_world, p_uid) is not null then
      perform tell(p_world, p_uid, tame_room_refusal(p_world, p_uid), 'error');
      return;
    end if;
    if not consume(p_world, p_uid, food, 1) then return; end if;
    chance := tame_chance(p_world, p_uid, c);
    update creature set hunger = least(1, hunger + 0.25) where world_id = p_world and id = c.id;
    if random() < chance then
      held := companion_of(p_world, p_uid);
      update creature set mode = 'active', stance = 'defensive', keeper = p_uid, coaxed = 0, coaxed_at = null
        where world_id = p_world and id = c.id;
      -- One follows you; every one after that goes into the crate you carry.
      if held is not null then perform crate_shut_in(p_world, c.id, empty_crate(p_world, p_uid), null); end if;
      perform tell(p_world, p_uid, 'The ' || lower(d.name) || ' takes the '
        || material_name(food, 1) || ' from your hand and trusts you. '
        || case when held is null then c.name || ' now follows you.'
             else 'It goes into the creature crate in your pack: set the crate down, or open it to have it follow you or work the deed.' end,
        'system');
      perform journal_note(p_world, p_uid, 'tamed');
      perform guide_mark(p_world, p_uid, c.species, 'tamed');
      perform skill_told(p_world, p_uid, 'taming', try_gain(true, tame_gain()));
      perform skill_told(p_world, p_uid, 'soul_strength', try_gain(true, tame_nerve()));
    else
      -- It refused, but it stayed for the offering, and that is worth
      -- something to the next one.
      update creature set coaxed = coaxed + 1, coaxed_at = now()
        where world_id = p_world and id = c.id returning * into c;
      warm := coax_bonus(c, pk(p_world, p_uid, 'coax:step', coax_step()));
      perform tell(p_world, p_uid, 'The ' || lower(d.name) || ' '
        || replace(d.tame_fail, '{food}', material_name(food, 1)) || '.'
        -- No ceiling on it any more, so nothing here says there is one: this
        -- read "as used to you as it will get" from the fourth offering on,
        -- which was true then and is not now.
        || case when warm > 0 then ' It is growing used to you: '
             || to_char(warm * 100, 'FM990') || '% readier than the first time.'
           else '' end, 'event');
      perform skill_told(p_world, p_uid, 'taming', try_gain(false, tame_gain()));
      perform skill_told(p_world, p_uid, 'soul_strength', try_gain(false, tame_nerve()));
    end if;

  elsif p_action = 'feed' then
    food := bait_in_pack(p_world, p_uid, c.species);
    if food is null or not consume(p_world, p_uid, food, 1) then return; end if;
    update creature set hunger = least(1, hunger + 0.5) where world_id = p_world and id = c.id;
    perform tell(p_world, p_uid, c.name || ' gobbles up the ' || material_name(food, 1) || '.', 'event');

  elsif p_action = 'groom' then
    select i.id into brush_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'brush'
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    skill := skill_of(p_world, p_uid, 'animal_husbandry');
    before := c.care;
    top := max_health(c);
    update creature set
        -- More of it at a go for a Herdsman's Brushwork.
        care = least(1, care + (0.18 + (skill / 100) * 0.34
                          + (least(100, tool_ql(p_world, p_uid, 'brush')) / 100) * 0.22) * pk(p_world, p_uid, 'groom:care', 1)),
        -- A brushing is also a looking-over: it finds the small hurts, more of them for Healing Hands.
        health = least(top, health + top * pk(p_world, p_uid, 'groom:heal', groom_heal()))
      where world_id = p_world and id = c.id returning * into c;
    if brush_id is not null then perform wear_tool(brush_id, 3); end if;
    perform journal_note(p_world, p_uid, 'groom');
    if c.care >= 0.995 then perform journal_note(p_world, p_uid, 'groomfull'); end if;
    gained := skill_told(p_world, p_uid, 'animal_husbandry', 0.4);
    perform tell(p_world, p_uid, case when before < 0.12 and c.care >= 0.12
        then 'You work the dust out of ' || c.name || '''s coat. It leans into the brush. ('
        else 'You brush ' || c.name || ' down. (' end || care_word(c.care) || ')', 'event');

  elsif p_action = 'shear' then
    -- A full fleece is three, a half-grown one is one, and quality follows the fleece.
    n := greatest(1, round(c.fleece * case when coalesce(d.shear_yield, 'wool') = 'wool' then 3 else 6 end)::int)
      -- And more of it for a perk on what comes off (a Tailor's Full Fleece).
      + floor(pk(p_world, p_uid, 'plus:' || coalesce(d.shear_yield, 'wool'), 0))::int;
    made_ql := greatest(1, least(100, 15 + c.fleece * 45 + skill_of(p_world, p_uid, 'tailoring') * 0.4));
    perform gather(p_world, p_uid, coalesce(d.shear_yield, 'wool'), n, made_ql);
    update creature set fleece = 0 where world_id = p_world and id = c.id;
    perform skill_told(p_world, p_uid, 'tailoring', 0.4);
    perform skill_told(p_world, p_uid, 'taming', 0.1);
    perform tell(p_world, p_uid, 'You '
      || case when coalesce(d.shear_yield, 'wool') = 'wool' then 'shear' else 'pluck' end
      || ' ' || c.name || ' and come away with ' || n || ' '
      || lower((select coalesce(name, 'wool') from item_def where id = coalesce(d.shear_yield, 'wool')))
      || '. (QL ' || to_char(made_ql, 'FM990.0') || ') It will grow back.', 'event');

  elsif p_action = 'milk_creature' then
    if not consume(p_world, p_uid, 'bucket', 1) then return; end if;
    -- What it has been fed on is what comes out of it.
    made_ql := greatest(1, least(100, 20 + c.fleece * 40 + c.hunger * 30));
    perform give(p_world, p_uid, 'milk_bucket', 1, made_ql);
    -- A Farmer's Milkmaid fills a second bucket now and then, if there is one.
    if random() < pk(p_world, p_uid, 'more:milk_creature', 0) then
      v_more := consume(p_world, p_uid, 'bucket', 1);
      if v_more then perform give(p_world, p_uid, 'milk_bucket', 1, made_ql); end if;
    end if;
    update creature set fleece = 0 where world_id = p_world and id = c.id;
    perform skill_told(p_world, p_uid, 'farming', 0.3);
    perform tell(p_world, p_uid, 'You milk ' || c.name || ' into the bucket'
      || case when v_more then ' and fill another' else '' end || '. (QL '
      || to_char(made_ql, 'FM990.0') || ')', 'event');

  elsif p_action = 'set_stance' then
    update creature set stance = p_target->>'stance' where world_id = p_world and id = c.id;
    perform tell(p_world, p_uid, c.name || ' will be ' || (p_target->>'stance') || '.', 'info');

  elsif p_action = 'rename_creature' then
    nm := left(btrim(p_target->>'name'), 24);
    update creature set name = nm where world_id = p_world and id = c.id;
    perform tell(p_world, p_uid, 'It answers to ' || nm || ' now.', 'info');

  elsif p_action = 'take_creature' then
    -- The one following you takes its place, on the deed or in a crate you carry.
    select sw.v_current, sw.v_to, sw.v_why into v_swap, v_to, v_why from companion_swap(p_world, p_uid, c) sw;
    if v_why is not null then return; end if;
    if c.carrying is not null then
      perform drop_on_ground(p_world, floor(creature_x(c))::int, floor(creature_y(c))::int,
        c.carrying->>'def', coalesce((c.carrying->>'ql')::double precision, 1), c.carrying->>'extra',
        coalesce((c.carrying->>'count')::int, 1));
    end if;
    update creature set mode = 'active', keeper = p_uid, post = null, carrying = null, phase = 'idle',
        enemy = null, hunting = null, settled_at = now()
      where world_id = p_world and id = c.id;
    perform creature_settle(p_world, c.id);
    perform tell(p_world, p_uid, c.name || ' now follows you.', 'system');
    if v_to = 'deed' then
      update creature set mode = 'deed', job = (select s.gathers from species_def s where s.id = creature.species),
          phase = 'idle', work_x = null, work_y = null, carrying = null, enemy = null, hunting = null,
          settled_at = now()
        where world_id = p_world and id = v_swap returning * into c;
      perform tell(p_world, p_uid, c.name || ' stays behind in its place, and will ' || deed_job_line(c) || '.', 'info');
    elsif v_to = 'crate' then
      perform crate_shut_in(p_world, v_swap, empty_crate(p_world, p_uid), null);
      perform tell(p_world, p_uid, (select q.name from creature q where q.world_id = p_world and q.id = v_swap)
        || ' goes into the creature crate in your pack.', 'info');
    end if;

  elsif p_action = 'crate_creature' then
    if empty_crate(p_world, p_uid) is null or c.mode not in ('active', 'deed') then return; end if;
    perform crate_shut_in(p_world, c.id, empty_crate(p_world, p_uid), null);
    perform tell(p_world, p_uid, c.name || ' goes into the creature crate. Set the crate down and it can be seen inside.', 'system');

  elsif p_action = 'assign_deed' then
    -- The same key, missed in the same place: this is the token the wildermon
    -- is being put to work around, so it is the caller's own, not whichever
    -- one the planner happened to hand back first. On an island with two
    -- settlements it teleported a stored beast to a stranger's token.
    dd := my_deed(p_world, p_uid);
    -- The trade it was asked for by name, or its species' own. The door has
    -- already said the name is one of its trades.
    update creature set mode = 'deed', keeper = p_uid, phase = 'idle',
        job = coalesce(nullif(p_target->>'job', ''), d.gathers),
        work_x = null, work_y = null, carrying = null,
        from_x = case when c.mode = 'stored' then dd.x + 0.5 else creature_x(c) end,
        from_y = case when c.mode = 'stored' then dd.y + 1.5 else creature_y(c) end,
        to_x = case when c.mode = 'stored' then dd.x + 0.5 else creature_x(c) end,
        to_y = case when c.mode = 'stored' then dd.y + 1.5 else creature_y(c) end,
        leg_at = now(), leg_ends = now(), until = now(), settled_at = now()
      where world_id = p_world and id = c.id;
    perform tell(p_world, p_uid, c.name || ' will '
      || coalesce((select plain from gather_def where id = coalesce(nullif(p_target->>'job', ''), d.gathers)), 'stay around the settlement')
      || ' within ' || work_range(c) || ' tiles of the token and bring what it finds to the crate.', 'system');

  elsif p_action = 'release_creature' then
    -- Out of its crate first, at the crate's door.
    if c.mode = 'stored' then perform crate_let_out(p_world, c.id); end if;
    -- Blood takes generations to build and a moment to walk away.
    update creature set mode = 'wild', stance = 'passive', keeper = null,
        name = d.name, coaxed = 0, coaxed_at = null, until = now()
      where world_id = p_world and id = c.id;
    perform tell(p_world, p_uid, 'The ' || lower(d.name) || ' ' || d.leaves || '.', 'system');

  elsif p_action = 'cull_creature' then
    /*
     * One action, and it is done.
     *
     * A beast you keep could always be killed — by swinging at it until it
     * stopped, which is a strange thing to have to do to your own livestock
     * and takes as long as fighting a wild one. This is the short way, and it
     * leaves exactly what the long way left: a carcass on the tile, for the
     * knife.
     *
     * Walked forward first, so the carcass lands where the body actually is;
     * a kept one stands at the token, which `creature_settle` has already
     * seen to. Whatever it was carrying is not buried with it.
     */
    perform creature_settle(p_world, c.id);
    -- One in a crate is let out of it first: the carcass lies at the crate's door.
    if c.mode = 'stored' then perform crate_let_out(p_world, c.id); end if;
    select * into c from creature where world_id = p_world and id = c.id;
    if c.world_id is null then return; end if;
    if c.carrying is not null then
      perform drop_on_ground(p_world, floor(creature_x(c))::int, floor(creature_y(c))::int,
        c.carrying->>'def', coalesce((c.carrying->>'ql')::double precision, 1),
        c.carrying->>'extra', coalesce((c.carrying->>'count')::int, 1));
      update creature set carrying = null where world_id = p_world and id = c.id;
    end if;
    nm := c.name;
    -- Past any soak its blood could put in the way: this is not a blow, it is
    -- a decision. `wound_beast` is told nobody struck it, so it writes no
    -- hunter's line and no "you kill the wild one" — the words below are what
    -- happened.
    perform wound_beast(p_world, c.id, 1e9, null, null, null, null);
    perform tell(p_world, p_uid, 'You put ' || nm || ' down. The ' || lower(d.name)
      || '''s carcass lies where it stood, ready for the knife.', 'fight');
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.creature_settle(p_world uuid, p_id integer)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
declare c creature; d species_def; a age_def; elapsed double precision; top double precision;
        guard int := 0; n int; i int; nx double precision; ny double precision;
        dist double precision; secs double precision; pace double precision; ok boolean;
        home record; ax double precision; ay double precision; v_rig placed;
begin
  select * into c from creature where world_id = p_world and id = p_id for update;
  if not found then return false; end if;
  select * into d from species_def where id = c.species;
  a := age_row(c.born, old_of(c));
  /*
   * In the traces until somebody takes it out.
   *
   * A hitch was a column and nothing else read it: the settle below went on
   * walking a companion to its keeper's feet and sending a worker out to its
   * trade, so an animal backed into a yoke was at its owner's heels a second
   * later, still hitched to a wagon it was nowhere near. It stands at the
   * vehicle now, thinks nothing, and does not get hungry, until `unhitch_one`
   * or `unhitch_all` takes it out -- or what it was hitched to is gone, in
   * which case there is nothing left to be in the traces of.
   */
  if c.hitched_to is not null then
    select * into v_rig from placed where world_id = p_world and id = c.hitched_to;
    if not found then
      update creature set hitched_to = null where world_id = p_world and id = p_id;
      c.hitched_to := null;
    end if;
  end if;
  elapsed := extract(epoch from (now() - c.settled_at));
  if elapsed <= 0 then
    -- Nothing has passed for the body — but a worker's day is not its body,
    -- and the trips it is owed are still owed. One in the traces owes none.
    if c.hitched_to is not null then return false; end if;
    if c.mode = 'deed' then perform worker_settle(p_world, p_id);
    elsif c.mode = 'active' then perform companion_settle(p_world, p_id); end if;
    return false;
  end if;

  -- The body: hunger falling, wounds closing, fleece coming back, and a
  -- brushing wearing off. None of it needs a step; it is all just elapsed time.
  top := max_health(c);
  -- Except in the traces, where the belly holds where it was when it went in.
  if c.hitched_to is null then
    -- Hungry slower for its keeper's Light Eaters.
    c.hunger := greatest(0, c.hunger - elapsed * hunger_rate(c.mode) * beast_mul(c, 'appetite')
                                   * coalesce((c.kept->>'kept:hunger')::double precision, 1));
  end if;
  if c.health > top then
    c.health := top;
  elsif c.health < top and (c.hurt_at is null or now() - c.hurt_at > interval '6 seconds') then
    c.health := least(top, c.health + elapsed * case when c.mode = 'wild' then 0.25 else 0.6 end * beast_mul(c, 'mend'));
  end if;
  if d.fleece is not null and a.growth > 0 and c.fleece < 1 then
    c.fleece := least(1, c.fleece + elapsed * d.fleece * a.growth * beast_mul(c, 'grow'));
  end if;
  -- A brushing wears off over a few hours: longer for its keeper's Lasting Care.
  c.care := greatest(0, c.care - elapsed / (coalesce((c.kept->>'kept:care_hours')::double precision, care_hours()) * 3600));
  /*
   * And a hungry one on a deed goes to the stores.
   *
   * Written on the row rather than on `c`, so the settle below does not carry
   * the old belly back over it. Only when it is actually hungry, which for a
   * worker is an hour or so apart — this is not a cost anybody pays on a beat.
   */
  if c.mode <> 'wild' and c.hitched_to is null and c.hunger < graze_hungry() then
    if worker_feed(p_world, p_id) is not null then
      c.hunger := least(1, c.hunger + graze_fill());
    end if;
  end if;

  -- And no further: it stands at the vehicle, the body settled and nothing else.
  if c.hitched_to is not null then
    update creature set
        from_x = v_rig.cx, from_y = v_rig.cy, to_x = v_rig.cx, to_y = v_rig.cy,
        leg_at = now(), leg_ends = now(), until = now(),
        health = c.health, fleece = c.fleece, care = c.care,
        enemy = null, hunting = null, settled_at = now()
      where world_id = p_world and id = p_id;
    return true;
  end if;

  if c.mode = 'wild' then
    if d.hunter then c := hunt_settle(p_world, c, d, a); else c.hunting := null; end if;
  else
    c.hunting := null;
  end if;

  if c.mode = 'wild' and c.hunting is null then
    pace := d.speed * a.speed * beast_mul(c, 'speed') * 0.7;
    while c.until <= now() and guard < catch_up_legs() loop
      guard := guard + 1;
      n := c.leg + 1;
      ok := false;
      -- A step about its own country rather than a step from wherever it
      -- last got to. Past the edge of its range it draws towards home
      -- instead, which is what keeps an island's wildlife somewhere in
      -- particular. A creature from before homes existed takes where it
      -- stands, which is what it would have had anyway.
      if c.home_x is null then c.home_x := c.to_x; c.home_y := c.to_y; end if;
      if (c.to_x - c.home_x) ^ 2 + (c.to_y - c.home_y) ^ 2 > wild_range() ^ 2 then
        ax := c.home_x; ay := c.home_y;
      else
        ax := c.to_x; ay := c.to_y;
      end if;
      for i in 0..7 loop
        nx := ax + (hash_tile(p_id, n, 7001 + i) * 2 - 1) * wild_reach();
        ny := ay + (hash_tile(p_id, n, 9001 + i) * 2 - 1) * wild_reach();
        if creature_tile_ok(p_world, floor(nx)::int, floor(ny)::int)
           and line_clear(p_world, c.to_x, c.to_y, nx, ny) then ok := true; exit; end if;
      end loop;
      c.leg := n;
      if not ok then
        -- Hemmed in: stand where it is and look again in a moment.
        c.from_x := c.to_x; c.from_y := c.to_y;
        c.leg_at := c.until; c.leg_ends := c.until;
        c.until := c.until + interval '2 seconds';
        continue;
      end if;
      -- It feeds itself on the way. The browser walks it to a forage bed,
      -- grazes for a few seconds and tops the belly up; out here the leg that
      -- ends on ground worth grazing is the same thing without the detail.
      if c.hunger < graze_hungry() and coalesce((select forage from tile_def
            where id = land_tile(p_world, floor(nx)::int, floor(ny)::int)), false) then
        c.hunger := least(1, c.hunger + graze_fill());
      end if;
      dist := sqrt((nx - c.to_x) ^ 2 + (ny - c.to_y) ^ 2);
      secs := greatest(0.2, dist / greatest(0.1, pace));
      c.from_x := c.to_x; c.from_y := c.to_y;
      c.to_x := nx; c.to_y := ny;
      c.leg_at := c.until;
      c.leg_ends := c.leg_at + make_interval(secs => secs);
      c.until := c.leg_ends + make_interval(secs => wild_rest() + hash_tile(p_id, n, 11001) * wild_rest_spread());
    end loop;
    /*
     * And past the cap it is where it got to, and the clock catches up with
     * it. This line is the whole reason the cap can come down: it was already
     * here, and it was already the answer for anything more than forty legs
     * behind. Forty was doing an eighth of a second of arithmetic to reach an
     * answer this line gives for nothing.
     *
     * Measured, on a creature an hour behind: 109.10 ms with the cap at forty,
     * against 4.78 ms for one a second behind. Every one of those legs is a
     * random step inside a home range nobody was standing in.
     */
    if c.until <= now() then
      c.from_x := c.to_x; c.from_y := c.to_y;
      c.leg_at := now(); c.leg_ends := now();
      c.until := now() + make_interval(secs => 1 + hash_tile(p_id, c.leg, 11001) * 5);
    end if;
  elsif c.mode = 'active' and c.keeper is not null and c.enemy is null then
    -- A companion is wherever its keeper is; following is not a walk of its own.
    -- A fight is, and one with something in its teeth keeps the legs it has:
    -- `companion_settle`, below, walks it, strikes, and brings it back to heel.
    select p.x, p.y into home from player p where p.world_id = p_world and p.uid = c.keeper;
    if found then
      c.from_x := home.x; c.from_y := home.y; c.to_x := home.x; c.to_y := home.y;
      c.leg_at := now(); c.leg_ends := now(); c.until := now();
    end if;
  elsif c.mode = 'stored' then
    -- In a crate: where the crate stands, or at the feet of whoever carries it.
    select pl.cx as x, pl.cy as y into home from placed pl where pl.world_id = p_world and pl.creature = p_id limit 1;
    if not found then
      select py.x, py.y into home from player py where py.world_id = p_world and py.uid = c.keeper;
    end if;
    if found then
      c.from_x := home.x; c.from_y := home.y; c.to_x := home.x; c.to_y := home.y;
      -- A crated one never walks, so it is not asked every round.
      c.leg_at := now(); c.leg_ends := now(); c.until := now() + make_interval(secs => stored_settle());
    end if;
  end if;

  update creature set
      from_x = c.from_x, from_y = c.from_y, to_x = c.to_x, to_y = c.to_y,
      leg_at = c.leg_at, leg_ends = c.leg_ends, until = c.until, leg = c.leg,
      health = c.health, hunger = c.hunger, fleece = c.fleece, care = c.care,
      hunting = c.hunting, hunt_x = c.hunt_x, hunt_y = c.hunt_y, hunt_again = c.hunt_again,
      home_x = c.home_x, home_y = c.home_y,
      settled_at = now()
    where world_id = p_world and id = p_id;
  -- And then the day's work, for whichever of them is on a deed rather than
  -- out in the country. The row goes down first because the work reads it back.
  if c.mode = 'deed' then perform worker_settle(p_world, p_id);
  -- And a companion's company, which is the one thing at heel that is a walk of its own.
  elsif c.mode = 'active' then perform companion_settle(p_world, p_id); end if;
  return true;
end $function$;

CREATE OR REPLACE FUNCTION public.companion_settle(p_world uuid, p_id integer)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare c creature; d species_def; k player; q creature; guard int := 0; done int := 0;
        pace double precision; cx double precision; cy double precision;
        ax double precision; ay double precision; dist double precision; v_step record;
begin
  select * into c from creature where world_id = p_world and id = p_id for update;
  if not found or c.mode <> 'active' or c.keeper is null then return 0; end if;
  -- Under a rider or in the traces it goes where it is taken, and does no thinking.
  if c.rider is not null or c.hitched_to is not null then return 0; end if;
  select * into k from player where world_id = p_world and uid = c.keeper;
  if not found then return 0; end if;
  select * into d from species_def where id = c.species;
  pace := d.speed * (age_row(c.born, old_of(c))).speed * beast_mul(c, 'speed');

  while c.until <= now() and guard < 60 loop
    guard := guard + 1;
    cx := c.to_x; cy := c.to_y;

    if c.phase = 'strike' then
      -- The row goes down first: the blow settles the other one, and a kill
      -- takes the enemy off every row that had it, this one included.
      update creature set from_x = c.from_x, from_y = c.from_y, to_x = c.to_x, to_y = c.to_y,
          leg_at = c.leg_at, leg_ends = c.leg_ends, until = c.until, phase = c.phase,
          enemy = c.enemy, settled_at = now()
        where world_id = p_world and id = p_id;
      if c.enemy is not null and creature_attack(p_world, p_id, c.enemy) then done := done + 1; end if;
      select * into c from creature where world_id = p_world and id = p_id;
      c.phase := 'idle';
      c.leg_at := c.until; c.leg_ends := c.until;
      continue;
    end if;

    q := companion_target(p_world, c, k);
    if q.id is null then
      c.enemy := null;
      exit;
    end if;
    if c.enemy is distinct from q.id then
      c.enemy := q.id;
      perform tell(p_world, c.keeper, c.name || ' goes for the '
        || lower((select name from species_def where id = q.species)) || '.', 'fight');
    end if;
    ax := creature_x(q); ay := creature_y(q);
    dist := sqrt((ax - cx) ^ 2 + (ay - cy) ^ 2);
    if dist <= companion_reach() then
      c.phase := 'strike';
      c.leg_at := c.until; c.leg_ends := c.until;
      c.until := c.until + make_interval(secs => companion_blow() / beast_mul(c, 'haste'));
    else
      -- A leg that ends well inside its reach, so a thing shuffling half a
      -- step does not put it out of reach again, round whatever is between.
      select * into v_step from chase_leg(p_world, cx, cy,
        cx + (ax - cx) * (dist - companion_reach() / 2) / dist,
        cy + (ay - cy) * (dist - companion_reach() / 2) / dist);
      if v_step.x is null then
        -- Nothing open at all: the browser gives up here too.
        c.enemy := null;
        exit;
      end if;
      c.from_x := cx; c.from_y := cy;
      c.to_x := v_step.x; c.to_y := v_step.y;
      c.leg_at := c.until;
      c.leg_ends := c.leg_at + make_interval(secs =>
        greatest(0.2, sqrt((c.to_x - cx) ^ 2 + (c.to_y - cy) ^ 2)
                      / greatest(0.1, pace * companion_pace())));
      c.until := c.leg_ends;
    end if;
  end loop;

  if c.enemy is null then
    -- Nothing to go for: at heel, which is not a walk of its own.
    c.from_x := k.x; c.from_y := k.y; c.to_x := k.x; c.to_y := k.y;
    c.leg_at := now(); c.leg_ends := now(); c.until := now();
    c.phase := 'idle';
  elsif c.until <= now() then
    c.from_x := c.to_x; c.from_y := c.to_y;
    c.leg_at := now(); c.leg_ends := now(); c.until := now() + interval '1 second';
  end if;
  update creature set from_x = c.from_x, from_y = c.from_y, to_x = c.to_x, to_y = c.to_y,
      leg_at = c.leg_at, leg_ends = c.leg_ends, until = c.until, phase = c.phase,
      enemy = c.enemy, settled_at = now()
    where world_id = p_world and id = p_id;
  return done;
end $function$;

CREATE OR REPLACE FUNCTION public.worker_settle(p_world uuid, p_id integer)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare c creature; d species_def; kind text; guard int := 0; done int := 0;
        spot record; stand record; step record; pace double precision; dist double precision;
        secs double precision; load jsonb; cx double precision; cy double precision;
        ax double precision; ay double precision; v_foe creature; v_corpse item;
        v_step record; v_site record; v_store record; v_in boolean;
begin
  select * into c from creature where world_id = p_world and id = p_id for update;
  if not found or c.mode <> 'deed' then return 0; end if;
  /*
   * Where it takes its orders from. A post stands in for a settlement, and a
   * worker with neither has nobody to take them from at all.
   */
  select * into v_site from work_site(p_world, c);
  if v_site.x is null then
    /*
     * Let go, and told.
     *
     * A worker with neither a post nor a settlement to take orders from is
     * turned loose — which is right, because the cap on how many you may keep
     * is your settlement's level and it is nought without one. What was wrong
     * was doing it in silence. From the island: a wildermon that had been
     * working stood about on fifty tiles of forage it could have been on, and
     * nothing anywhere said it had stopped being a worker. The rules were
     * doing exactly as written and the only broken thing was that nobody was
     * told.
     */
    update creature set mode = 'wild', phase = 'idle', job = null, post = null
      where world_id = p_world and id = p_id;
    if c.keeper is not null then
      perform tell(p_world, c.keeper,
        c.name || ' has no settlement to work for and has gone back to its own business.', 'event');
    end if;
    return 0;
  end if;
  select * into d from species_def where id = c.species;
  -- The trade it was set to, which is its species' own unless it was told otherwise.
  kind := coalesce(c.job, d.gathers);
  pace := d.speed * (age_row(c.born, old_of(c))).speed * beast_mul(c, 'speed')
          * (1 + greatest(1, task_skill(c)) / 500);

  while c.until <= now() and guard < 120 loop
    guard := guard + 1;
    cx := c.to_x; cy := c.to_y;

    /*
     * Company first.
     *
     * Nothing works while something is coming at it, and the two trades that
     * fight for a living are always looking for company. A worker breaks off
     * between jobs rather than mid-load: what is already in its arms goes in
     * the crate before it goes for anything, which is the one place this is
     * tidier than the browser.
     */
    if c.phase = 'strike' then
      update creature set from_x = c.from_x, from_y = c.from_y, to_x = c.to_x, to_y = c.to_y,
          leg_at = c.leg_at, leg_ends = c.leg_ends, until = c.until, phase = c.phase,
          work_x = c.work_x, work_y = c.work_y, carrying = c.carrying, enemy = c.enemy,
          settled_at = now()
        where world_id = p_world and id = p_id;
      if c.enemy is not null and creature_attack(p_world, p_id, c.enemy) then done := done + 1; end if;
      select * into c from creature where world_id = p_world and id = p_id;
      c.phase := 'idle';
      c.leg_at := c.until; c.leg_ends := c.until;
      continue;

    elsif c.phase = 'stalk' then
      -- Arrived where the carcass went down. If somebody else has had it, the
      -- walk was wasted, which is what happens to a hunter now and then.
      c.carrying := take_from_ground(p_world, c.work_x, c.work_y, 'corpse');
      c.work_x := null; c.work_y := null;
      c.phase := 'idle';
      c.leg_at := c.until; c.leg_ends := c.until;
      c.until := c.until + interval '0.5 seconds';
      continue;
    end if;

    if fight_trade(kind) and c.phase = 'idle' and c.carrying is not null then
      select * into v_store from worker_store(p_world, c, c.carrying->>'def', (c.carrying->>'count')::int);
      if v_store.id is null then
        c.until := now() + interval '30 seconds';
        exit;
      end if;
      ax := v_store.cx; ay := v_store.cy;
      dist := sqrt((ax - cx) ^ 2 + (ay - cy) ^ 2);
      c.from_x := cx; c.from_y := cy; c.to_x := ax; c.to_y := ay;
      c.leg_at := c.until;
      c.leg_ends := c.leg_at + make_interval(secs => greatest(0.2, dist / greatest(0.1, pace)));
      c.until := c.leg_ends;
      c.phase := 'home';
      continue;
    end if;

    if c.phase = 'idle' and c.carrying is null
       and (fight_trade(kind) or c.enemy is not null or c.stance <> 'passive') then
      v_foe := fight_target(p_world, p_id);
      if v_foe.id is null then
        c.enemy := null;
      else
        if c.enemy is distinct from v_foe.id then
          -- It has just seen it. A guard trains its back by keeping watch; a
          -- hunter learns the country by hunting it.
          if fight_trade(kind) then
            perform worker_learn(p_world, p_id,
              case when kind = 'hunt' then 'fighting' else 'body_strength' end,
              case when kind = 'hunt' then 0.08 else 0.1 end);
          end if;
          c.enemy := v_foe.id;
        end if;
        ax := creature_x(v_foe); ay := creature_y(v_foe);
        dist := sqrt((ax - cx) ^ 2 + (ay - cy) ^ 2);
        if dist <= fight_reach(kind) then
          c.phase := 'strike';
          c.leg_at := c.until; c.leg_ends := c.until;
          c.until := c.until + make_interval(secs => fight_blow(kind) / beast_mul(c, 'haste'));
        else
          select * into v_step from chase_leg(p_world, cx, cy,
            cx + (ax - cx) * (dist - 1) / dist, cy + (ay - cy) * (dist - 1) / dist);
          if v_step.x is null then
            -- Nothing open at all: the browser gives up here too.
            c.enemy := null;
            c.until := c.until + interval '2 seconds';
          else
            c.from_x := cx; c.from_y := cy;
            c.to_x := v_step.x; c.to_y := v_step.y;
            c.leg_at := c.until;
            c.leg_ends := c.leg_at + make_interval(secs =>
              greatest(0.2, sqrt((c.to_x - cx) ^ 2 + (c.to_y - cy) ^ 2)
                            / greatest(0.1, pace * fight_pace(kind))));
            c.until := c.leg_ends;
          end if;
        end if;
        continue;
      end if;
    end if;

    if kind = 'hunt' and c.phase = 'idle' and c.carrying is null then
      if c.work_x is not null and not exists (select 1 from item i
           where i.world_id = p_world and i.holder = 'ground'
             and i.gx = c.work_x and i.gy = c.work_y and i.def = 'corpse') then
        c.work_x := null; c.work_y := null;
      end if;
      if c.work_x is null then
        v_corpse := carcass_near(p_world, v_site.x, v_site.y, v_site.radius, cx, cy);
        if v_corpse.id is not null then c.work_x := v_corpse.gx; c.work_y := v_corpse.gy; end if;
      end if;
      if c.work_x is not null then
        ax := c.work_x + 0.5; ay := c.work_y + 0.5;
        dist := sqrt((ax - cx) ^ 2 + (ay - cy) ^ 2);
        c.from_x := cx; c.from_y := cy; c.to_x := ax; c.to_y := ay;
        c.leg_at := c.until;
        c.leg_ends := c.leg_at + make_interval(secs => greatest(0.2, dist / greatest(0.1, pace)));
        c.until := c.leg_ends;
        c.phase := 'stalk';
        continue;
      end if;
    end if;

    if worker_errand(kind) then
      -- Everything an errand asks about is on the row, so the row goes down
      -- before it is asked.
      update creature set from_x = c.from_x, from_y = c.from_y, to_x = c.to_x, to_y = c.to_y,
          leg_at = c.leg_at, leg_ends = c.leg_ends, until = c.until, phase = c.phase,
          work_x = c.work_x, work_y = c.work_y, carrying = c.carrying, fetching = c.fetching,
          settled_at = now()
        where world_id = p_world and id = p_id;

      if c.phase = 'fetch' then
        load := take_from_stores(p_world, c.fetching);
        if load is null then
          c.phase := 'idle';
          c.leg_at := c.until; c.leg_ends := c.until;
          c.until := now() + interval '4 seconds';
          exit;
        end if;
        c.carrying := load;
        c.fetching := null;
        c.phase := 'idle';
        c.leg_at := c.until; c.leg_ends := c.until;
        c.until := c.until + interval '0.5 seconds';

      elsif c.phase = 'out' then
        c.phase := 'work';
        c.leg_at := c.until; c.leg_ends := c.until;
        c.until := c.until + make_interval(secs => work_duration(task_skill(c)) / beast_mul(c, 'work'));

      elsif c.phase = 'work' then
        if errand_do(p_world, p_id) then done := done + 1; end if;
        select * into c from creature where world_id = p_world and id = p_id;
        c.phase := 'idle';
        c.leg_at := c.until; c.leg_ends := c.until;
        c.until := c.until + interval '1 second';

      else
        select * into step from errand_step(p_world, p_id);
        if step.gx is null then
          -- Nothing to run. Replaying an afternoon of that produces nothing.
          c.from_x := cx; c.from_y := cy;
          c.leg_at := now(); c.leg_ends := now();
          c.until := now() + interval '4 seconds';
          exit;
        end if;
        c.work_x := step.wx; c.work_y := step.wy;
        c.fetching := step.want;
        dist := sqrt((step.gx - cx) ^ 2 + (step.gy - cy) ^ 2);
        c.from_x := cx; c.from_y := cy; c.to_x := step.gx; c.to_y := step.gy;
        c.leg_at := c.until;
        c.leg_ends := c.leg_at + make_interval(secs => greatest(0.2, dist / greatest(0.1, pace)));
        c.until := c.leg_ends;
        c.phase := case when step.want is null then 'out' else 'fetch' end;
      end if;
      continue;
    end if;

    if c.phase = 'out' then
      c.phase := 'work';
      c.leg_at := c.until; c.leg_ends := c.until;
      c.until := c.until + make_interval(secs => work_duration(task_skill(c)) / beast_mul(c, 'work'));

    elsif c.phase = 'work' then
      update creature set from_x = cx, from_y = cy, to_x = cx, to_y = cy,
          leg_at = c.leg_at, leg_ends = c.leg_ends, until = c.until, phase = c.phase,
          work_x = c.work_x, work_y = c.work_y, settled_at = now()
        where world_id = p_world and id = p_id;
      load := worker_do(p_world, p_id);
      select * into c from creature where world_id = p_world and id = p_id;
      done := done + 1;
      c.carrying := load;
      c.work_x := null; c.work_y := null;
      if load is null then
        c.phase := 'idle';
        c.leg_at := c.until; c.leg_ends := c.until;
        c.until := c.until + interval '1 second';
      else
        select * into v_store from worker_store(p_world, c, load->>'def', (load->>'count')::int);
        if v_store.id is null then
          -- Everything on the deed is full. A worker will not tip a load out
          -- on the ground: it holds it and waits for room, and says so, once
          -- in a while rather than once a job.
          perform worker_nowhere(p_world, c);
          c.phase := 'idle';
          c.leg_at := c.until; c.leg_ends := c.until;
          c.until := now() + interval '30 seconds';
          exit;
        end if;
        ax := v_store.cx; ay := v_store.cy;
        dist := sqrt((ax - cx) ^ 2 + (ay - cy) ^ 2);
        secs := greatest(0.2, dist / greatest(0.1, pace));
        c.from_x := cx; c.from_y := cy; c.to_x := ax; c.to_y := ay;
        c.leg_at := c.until; c.leg_ends := c.leg_at + make_interval(secs => secs);
        c.until := c.leg_ends;
        c.phase := 'home';
      end if;

    elsif c.phase = 'home' then
      /*
       * Wherever the room is *now*. A crate that had room when the walk began
       * may be full by the time the load arrives — somebody else filled it, or
       * another worker got there first — and the old rule walked to the
       * settlement's crate, failed quietly into a full one and carried the
       * load back out to the fields. Reported as workers overdelivering to a
       * full crate with an empty one standing beside it.
       */
      if c.carrying is not null then
        select * into v_store from worker_store(p_world, c, c.carrying->>'def', (c.carrying->>'count')::int);
        if v_store.id is null then
          perform worker_nowhere(p_world, c);
          c.until := now() + interval '30 seconds';
          c.phase := 'idle';
          c.leg_at := c.until; c.leg_ends := c.until;
          exit;
        end if;
        if sqrt((v_store.cx - cx) ^ 2 + (v_store.cy - cy) ^ 2) > 1.6 then
          -- The room is somewhere else now: walk there rather than stand at a
          -- full crate holding a load.
          dist := sqrt((v_store.cx - cx) ^ 2 + (v_store.cy - cy) ^ 2);
          c.from_x := cx; c.from_y := cy; c.to_x := v_store.cx; c.to_y := v_store.cy;
          c.leg_at := c.until;
          c.leg_ends := c.leg_at + make_interval(secs => greatest(0.2, dist / greatest(0.1, pace)));
          c.until := c.leg_ends;
          continue;
        end if;
        if v_store.kind = 'crate' then
          v_in := crate_add(p_world, v_store.id::int, c.carrying->>'def',
            (c.carrying->>'count')::int, (c.carrying->>'ql')::double precision, c.carrying->>'extra');
        else
          v_in := furniture_add(p_world, v_store.id, c.carrying->>'def',
            (c.carrying->>'count')::int, (c.carrying->>'ql')::double precision, c.carrying->>'extra');
        end if;
        if v_in then
          -- Counted for its keeper, if they are away: what came home while they were gone.
          perform away_count(p_world, c.keeper, 'haul', c.carrying->>'def', (c.carrying->>'count')::bigint);
          c.carrying := null;
        end if;
      end if;
      c.phase := 'idle';
      c.leg_at := c.until; c.leg_ends := c.until;
      c.until := c.until + interval '1 second';

    else
      -- The fields' growth brought up to date once for the whole of the ground
      -- it works, rather than a tile at a time inside the search.
      if kind = 'farm' then
        perform crops_settle(p_world, v_site.x + 0.5, v_site.y + 0.5, v_site.radius);
      end if;
      select * into spot from find_work_tile(p_world, v_site.x, v_site.y, v_site.radius, kind, c);
      if spot.x is null then
        -- Nothing of its trade anywhere it can reach. It wanders a few tiles
        -- and waits, which from outside is a beast standing about for no
        -- reason anybody is ever told. The clock on it starts here; whether
        -- that is worth a word is `worker_idle`'s to decide, and it wants an
        -- hour of it before it says anything, so that a trade which has run
        -- dry for the day is not mistaken for one that is stuck.
        c.idle_since := coalesce(c.idle_since, now());
        perform worker_idle(p_world, c, kind, v_site.x, v_site.y, v_site.radius, v_site.post);
        c.from_x := cx; c.from_y := cy;
        c.to_x := v_site.x + 0.5 + (hash_tile(p_id, guard, 601) * 2 - 1) * 3;
        c.to_y := v_site.y + 0.5 + (hash_tile(p_id, guard, 701) * 2 - 1) * 3;
        if not creature_tile_ok(p_world, floor(c.to_x)::int, floor(c.to_y)::int) then
          c.to_x := cx; c.to_y := cy;
        end if;
        dist := sqrt((c.to_x - cx) ^ 2 + (c.to_y - cy) ^ 2);
        c.leg_at := now();
        c.leg_ends := c.leg_at + make_interval(secs => greatest(0.2, dist / greatest(0.1, pace)));
        c.until := c.leg_ends + worker_rest(c.idle_since);
        exit;
      else
        -- Worked from the bank when there is no standing on it: always for a
        -- tree, a rod or a fruit bough, and for a rock face when the water
        -- over it is deeper than a beast can wade.
        if kind in ('woodcut', 'prune', 'fish', 'fruit')
           or (kind in ('mine', 'quarry') and not creature_tile_ok(p_world, spot.x, spot.y)) then
          select * into stand from beside_tile(p_world, spot.x, spot.y);
          if stand.x is null then
            /*
             * A tile of its trade with nowhere to stand and work it from.
             *
             * This added four seconds and went round again, and round again
             * re-derived the very same tile: `find_work_tile` walks the rings
             * outward from the site and hands back the first thing that
             * passes, so nothing about waiting changes which tile that is.
             * The only thing that could is the ground itself. A beast in here
             * stands still for ever and says nothing, which is the shape of
             * every bad hour this island has had lately.
             *
             * It is unreachable today, and that is worth being plain about:
             * `worker_gatherable` demands `face_reach`, and `face_reach` only
             * passes without standing room when `beside_tile` has something in
             * it, so the two cannot presently disagree. This is written as a
             * refusal rather than a retry so that the next rule added to one
             * of them and not the other is a worker that goes quiet and gets
             * reported, not one that spins in silence.
             *
             * Having found a tile it cannot work is having found nothing, so
             * it leaves by the same door: the idle clock starts, and an hour
             * of it is a word to the keeper.
             */
            c.idle_since := coalesce(c.idle_since, now());
            perform worker_idle(p_world, c, kind, v_site.x, v_site.y, v_site.radius, v_site.post);
            c.from_x := cx; c.from_y := cy;
            c.leg_at := now(); c.leg_ends := now();
            c.until := now() + worker_rest(c.idle_since);
            exit;
          end if;
          ax := stand.x + 0.5; ay := stand.y + 0.5;
        else
          ax := spot.x + 0.5; ay := spot.y + 0.5;
        end if;
        c.work_x := spot.x; c.work_y := spot.y;
        -- Anything found at all, and the idle clock starts over.
        c.idle_since := null;
        dist := sqrt((ax - cx) ^ 2 + (ay - cy) ^ 2);
        c.from_x := cx; c.from_y := cy; c.to_x := ax; c.to_y := ay;
        c.leg_at := c.until;
        c.leg_ends := c.leg_at + make_interval(secs => greatest(0.2, dist / greatest(0.1, pace)));
        c.until := c.leg_ends;
        c.phase := 'out';
      end if;
    end if;
  end loop;

  if c.until <= now() then
    c.from_x := c.to_x; c.from_y := c.to_y;
    c.leg_at := now(); c.leg_ends := now(); c.until := now() + interval '1 second';
  end if;

  update creature set from_x = c.from_x, from_y = c.from_y, to_x = c.to_x, to_y = c.to_y,
      leg_at = c.leg_at, leg_ends = c.leg_ends, until = c.until, phase = c.phase,
      work_x = c.work_x, work_y = c.work_y, carrying = c.carrying, fetching = c.fetching,
      idle_since = c.idle_since,
      enemy = c.enemy, settled_at = now()
    where world_id = p_world and id = p_id;
  return done;
end $function$;

CREATE OR REPLACE FUNCTION public.wound_beast(p_world uuid, p_id integer, p_dmg double precision, p_from_x double precision DEFAULT NULL::double precision, p_from_y double precision DEFAULT NULL::double precision, p_teller uuid DEFAULT NULL::uuid, p_by integer DEFAULT NULL::integer)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
declare c creature; d species_def; cx double precision; cy double precision; v_taken double precision;
        v_len double precision; v_size double precision; v_killer creature;
begin
  perform creature_settle(p_world, p_id);
  select * into c from creature where world_id = p_world and id = p_id for update;
  if not found then return false; end if;
  select * into d from species_def where id = c.species;
  cx := creature_x(c); cy := creature_y(c);
  -- What a blow costs it is its blood's to say, and its herd's.
  v_taken := p_dmg * beast_mul(c, 'soak');

  update creature set health = c.health - v_taken, hurt_at = now(), hurt_by = p_by,
      coaxed = 0, coaxed_at = null,
      from_x = cx, from_y = cy, to_x = cx, to_y = cy, leg_at = now(), leg_ends = now(),
      settled_at = now()
    where world_id = p_world and id = p_id;

  if c.health - v_taken > 0 then
    if c.mode = 'wild' and d.timid and p_from_x is not null then
      v_len := greatest(0.001, sqrt((cx - p_from_x) ^ 2 + (cy - p_from_y) ^ 2));
      update creature set to_x = cx + ((cx - p_from_x) / v_len) * 5, to_y = cy + ((cy - p_from_y) / v_len) * 5,
          leg_ends = now() + interval '3 seconds', until = now() + interval '3 seconds'
        where world_id = p_world and id = p_id;
    end if;
    return false;
  end if;

  -- What the carcass is worth follows the size of the thing that left it.
  v_size := (age_row(c.born, old_of(c))).yield;
  delete from creature where world_id = p_world and id = p_id;
  -- Nothing goes on fighting something that is no longer there.
  update creature set enemy = null where world_id = p_world and enemy = p_id;
  perform drop_on_ground(p_world, floor(cx)::int, floor(cy)::int, 'corpse',
    (15 + random() * 35) * v_size, d.name);

  -- A hunter marks where its kill went down and comes back for it.
  if p_by is not null then
    select * into v_killer from creature where world_id = p_world and id = p_by;
    -- A companion's kill is told to its keeper, who is standing right there. A
    -- worker's is not: a guard's week on a deed its keeper has left would come
    -- back as a page of them.
    if found and v_killer.mode = 'active' and v_killer.keeper is not null then
      perform tell(p_world, v_killer.keeper, v_killer.name || ' killed a wild ' || lower(d.name) || '.', 'fight');
    end if;
    if found and v_killer.carrying is null
       and (select gathers from species_def where id = v_killer.species) = 'hunt' then
      update creature set work_x = floor(cx)::int, work_y = floor(cy)::int
        where world_id = p_world and id = p_by;
      perform worker_learn(p_world, p_by, 'fighting', 0.4);
    end if;
  end if;

  /*
   * And what it was keeping, which is the other half of where a map comes
   * from. Only a monster — `species_def.monster` is already the line between
   * a thing that hunts you and a thing you could have tamed — and only to
   * whoever struck it down. The odds and the quality both come off its
   * health, which is the one number that says how big a thing was: a goblin
   * in thirty-five carries a scrap, a dragon in two carries a dragon's.
   */
  if p_teller is not null and d.monster and random() < map_chance_beast(d.health) then
    perform bury_treasure(p_world, p_teller, map_ql_beast(d.health), cx, cy);
  end if;

  if p_teller is not null then
    perform journal_note(p_world, p_teller, 'slew:' || c.species);
    if d.monster then
      perform tell(p_world, p_teller, 'The ' || lower(d.name)
        || ' goes down. Butcher it before it rots: there is a great deal on it.', 'fight');
    else
      perform tell(p_world, p_teller, 'You kill the wild ' || lower(d.name)
        || '. Its corpse lies where it fell.', 'fight');
    end if;
  end if;
  return true;
end $function$;

CREATE OR REPLACE FUNCTION public.vehicle_speed(p_world uuid, p_id bigint)
 RETURNS double precision
 LANGUAGE plpgsql
 STABLE
AS $function$
declare v vehicle_def; p placed; c creature; n int := 0;
        sum_pace double precision := 0; worst double precision := 1; pull double precision := 0.75;
begin
  select * into p from placed where world_id = p_world and id = p_id;
  if not found then return 0; end if;
  select * into v from vehicle_def where id = p.sub;
  if not found then return 0; end if;
  for c in select * from team_of(p_world, p_id) loop
    n := n + 1;
    sum_pace := sum_pace + (select speed from species_def where id = c.species)
      * (age_row(c.born, old_of(c))).speed * beast_mul(c, 'speed');
    worst := least(worst, 0.6 + 0.4 * c.hunger);
    -- Every beast adds its own share; the ones bred for it add more.
    pull := pull + coalesce((select sp.pull from species_def sp where sp.id = c.species), 0.25)
      * (age_row(c.born, old_of(c))).pull * beast_mul(c, 'haul');
  end loop;
  if n < v.needs then return 0; end if;
  -- The builder's mark goes on after the cap, so a Carpenter's Smooth Axle is
  -- its whole share at the top of the range too, as `vehicleSpeed` has it.
  return least(max_vehicle_speed(),
    (sum_pace / n) * pull * worst * footing(team_climb(p_world, p_id)) * roll_ease(p.material)) * mark_of(p.mark, 'speed');
end $function$;

CREATE OR REPLACE FUNCTION public.mount_speed(c creature)
 RETURNS double precision
 LANGUAGE sql
 STABLE
AS $function$
  select least(max_mount_speed(),
    (select speed from species_def where id = c.species)
    * (age_row(c.born, old_of(c))).speed * beast_mul(c, 'speed')
    * footing(beast_climb(c)) * (0.6 + 0.4 * c.hunger))
$function$;

CREATE OR REPLACE FUNCTION public.ride_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare c creature; d species_def; p placed; v vehicle_def; want text; n int; v_aboard bigint; v_shut text;
begin
  if ride_beast_action(p_action) then
    perform creature_settle(p_world, (p_target->>'id')::int);
    c := target_creature(p_world, p_target);
    if c.world_id is null then return 'It is gone.'; end if;
    select * into d from species_def where id = c.species;
    if c.mode = 'stored' then return c.name || ' is in a creature crate. Let it out first.'; end if;

    if p_action = 'tack_creature' then
      if not creature_in_reach(p_world, p_uid, c) then return 'Stand next to ' || c.name || '.'; end if;
      if not (age_row(c.born, old_of(c))).works then
        return c.name || ' is not grown. Nothing that young takes a saddle.';
      end if;
      want := tack_missing(p_world, p_uid);
      if want is not null then return 'You need ' || want || '.'; end if;

    elsif p_action = 'shoe_creature' then
      -- Shoes, in the words the browser uses: a mount, grown, within reach,
      -- and four shoes and a mallet in the pack.
      if d.mount is null then return 'Only a mount takes shoes.'; end if;
      if not creature_in_reach(p_world, p_uid, c) then return 'Stand next to ' || c.name || '.'; end if;
      if not (age_row(c.born, old_of(c))).works then
        return c.name || ' is not grown. Nothing that young takes a shoe.';
      end if;
      if pack_count(p_world, p_uid, 'horseshoe') < shoes_per_mount()::int or pack_count(p_world, p_uid, 'mallet') < 1 then
        return 'You need four horseshoes and a mallet.';
      end if;

    elsif p_action = 'untack_creature' then
      if not creature_in_reach(p_world, p_uid, c) then return 'Stand next to ' || c.name || '.'; end if;

    elsif p_action = 'mount_creature' then
      if not c.tacked then return c.name || ' has no saddle or bridle on.'; end if;
      if not (age_row(c.born, old_of(c))).works then return c.name || ' is not grown enough to carry you.'; end if;
      if c.hitched_to is not null then return c.name || ' is in the traces.'; end if;
      if not creature_in_reach(p_world, p_uid, c) then return 'Stand next to ' || c.name || '.'; end if;
      if (driving(p_world, p_uid)).id is not null then
        return 'Get down off what you are driving first.';
      end if;
      if (select aboard from player where world_id = p_world and uid = p_uid) is not null then
        return 'Step ashore first.';
      end if;

    elsif p_action = 'hitch_creature' then
      -- Asked of one already in harness, which a browser that could not see
      -- the traces was offering: `hitch_up` said no and nobody heard why.
      if c.hitched_to is not null then return c.name || ' is already in the traces.'; end if;
      if c.rider is not null then return c.name || ' has a rider on it.'; end if;
      p := vehicle_for(p_world, p_uid, c);
      if p.id is null then return 'There is no cart or wagon here with an empty yoke.'; end if;
      if not near_piece(p_world, p_uid, p) then
        return 'Stand by the ' || lower(placed_name(p)) || '.';
      end if;
      if not creature_in_reach(p_world, p_uid, c, 4) then
        return c.name || ' is too far off. Call it over first.';
      end if;
      if not (age_row(c.born, old_of(c))).works then
        return c.name || ' is not grown. A yearling is no use in the traces.';
      end if;
      if c.hunger < 0.15 then
        return c.name || ' is too hungry to pull anything. Feed it first.';
      end if;

    elsif p_action = 'unhitch_creature' then
      if c.hitched_to is null then return c.name || ' is not in the traces.'; end if;
    end if;
    return null;
  end if;

  -- The rest are asked of a thing standing on the ground.
  select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint
    and kind = 'furniture';
  if not found then return 'It is gone.'; end if;

  if p_action = 'pull_cart' then
    if not near_piece(p_world, p_uid, p) then return 'Stand beside the shafts.'; end if;
    v_shut := lock_refusal(p_world, p_uid, p.lock, p.x, p.y);
    if v_shut is not null then return v_shut; end if;
    if exists (select 1 from placed q where q.world_id = p_world and q.puller = p_uid and q.id <> p.id) then
      return 'You already have a cart behind you.';
    end if;

  elsif p_action = 'board_vehicle' then
    -- Nobody takes the reins or the helm out of the hands of somebody who is here.
    if helm_held(p_world, p, p_uid) then
      return case when is_boat(p) then 'Somebody else has the helm.' else 'Somebody else has the reins.' end;
    end if;
    -- Aboard her already, the helm is a step away; aboard anything else, it is not yours to reach. And the
    -- helm of a hull whose helmsman has gone away is taken over from her deck and from nowhere else, so
    -- that they have a place to be put in; the reins of a wagon are anybody's who is beside it.
    select aboard into v_aboard from player where world_id = p_world and uid = p_uid;
    if v_aboard is not null and v_aboard <> p.id then return 'You are aboard another vessel. Step ashore first.'; end if;
    if p.driver is not null and p.driver <> p_uid and is_boat(p) and v_aboard is distinct from p.id then
      return 'Somebody else has the helm.';
    end if;
    if v_aboard is null and not near_piece(p_world, p_uid, p) then return 'Stand beside it first.'; end if;
    if (driving(p_world, p_uid)).id is not null then return 'You are already driving something.'; end if;
    -- A padlock on her keeps her helm, or the reins, to whoever has its key.
    v_shut := lock_refusal(p_world, p_uid, p.lock, p.x, p.y);
    if v_shut is not null then return v_shut; end if;
    -- A hull asks nothing but that she is still floating.
    if is_boat(p) then
      if not launch_spot(p_world, p.sub, p.x, p.y) then return 'She is aground. Push her off first.'; end if;
      return null;
    end if;
    select * into v from vehicle_def where id = p.sub;
    if found then
      n := team_size(p_world, p.id);
      if n < v.needs then
        return case when n = 0
          then 'Nothing is in the yokes. ' || placed_name(p) || ' needs ' || v.needs || ' to move.'
          else 'Only ' || n || ' of ' || v.yokes || ' yokes are filled. It needs ' || v.needs || '.' end;
      end if;
    end if;

  elsif p_action = 'board_passenger' then
    n := boat_places(p);
    if n = 0 then return 'She carries nobody but whoever steers her.'; end if;
    select aboard into v_aboard from player where world_id = p_world and uid = p_uid;
    if v_aboard = p.id then return 'You are aboard her already.'; end if;
    if v_aboard is not null then return 'You are aboard another vessel. Step ashore first.'; end if;
    if (driving(p_world, p_uid)).id is not null then return 'You are already driving something.'; end if;
    if (mount_of(p_world, p_uid)).id is not null then return 'Get down off your mount first.'; end if;
    if not near_piece(p_world, p_uid, p) then return 'Stand beside her first.'; end if;
    v_shut := lock_refusal(p_world, p_uid, p.lock, p.x, p.y);
    if v_shut is not null then return v_shut; end if;
    if not launch_spot(p_world, p.sub, p.x, p.y) then return 'She is aground. Push her off first.'; end if;
    if (select count(*) from player r where r.world_id = p_world and r.aboard = p.id) >= n then
      return 'Every one of her ' || n || ' places is taken.';
    end if;

  elsif p_action = 'leave_passenger' then
    if (select aboard from player where world_id = p_world and uid = p_uid) is distinct from p.id then
      return 'You are not aboard her.';
    end if;
    if not exists (select 1 from player pl, lateral shore_near(p_world, pl.x, pl.y)
                   where pl.world_id = p_world and pl.uid = p_uid) then
      return 'There is no shore within reach. Wait until she comes in close.';
    end if;

  elsif p_action = 'leave_vehicle' then
    if is_boat(p) and not exists (select 1 from player pl, lateral shore_near(p_world, pl.x, pl.y)
                                  where pl.world_id = p_world and pl.uid = p_uid) then
      return 'There is no shore within reach. Bring her in first, or swim for it.';
    end if;

  elsif p_action = 'unhitch_team' then
    if not near_piece(p_world, p_uid, p) then return 'Stand beside it first.'; end if;
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.pair_refuses(p_world uuid, a creature, b creature)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare c creature; stage text;
begin
  foreach c in array array[a, b] loop
    stage := age_of(c.born, old_of(c));
    if stage <> 'grown' then
      return c.name || case when stage = 'young' then ' is not grown.' else ' is past it.' end;
    end if;
    if c.hunger < 0.5 then return c.name || ' is too hungry to think about it. Feed it first.'; end if;
    if c.bred_at is not null and now() - c.bred_at < make_interval(secs => breed_rest()) then
      return c.name || ' has been put to a mate lately and wants '
        || clock_left(breed_rest() - extract(epoch from (now() - c.bred_at))) || ' to itself.';
    end if;
    if c.due is not null then return c.name || ' is already in young.'; end if;
  end loop;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.blood_read(p_world uuid, p_uid uuid, c creature)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare seen text[]; hidden int; d species_def; carrying text;
begin
  select * into d from species_def where id = c.species;
  -- Blood does not read itself. Without the skill you can see that there is
  -- something in it; with the skill you can see what.
  seen := blood_seen(p_world, p_uid, c.traits);
  hidden := coalesce(array_length(c.traits, 1), 0) - coalesce(array_length(seen, 1), 0);
  carrying := case when c.due is not null
    then ' She is in young, due in about '
         || clock_left(extract(epoch from (c.due - now()))) || '.' else '' end;
  return c.name || ', ' || c.sex || ' ' || lower(d.name) || ', ' || age_of(c.born, old_of(c))
    || ' and ' || care_word(c.care) || '. It carries '
    || case when array_length(seen, 1) > 0 then trait_names(seen) else 'nothing you can read' end
    || case when hidden > 0 then ', and ' || case when hidden = 1 then 'one thing'
                                                  else hidden || ' things' end
                                 || ' you cannot read yet' else '' end
    || '.'
    -- And what that blood is actually worth, which the line had never said.
    -- Only over what can be read: a trait you cannot name is a trait whose
    -- figure you have not earned either.
    || coalesce(' That blood comes to ' || trait_worth(seen) || '.', '') || carrying;
end $function$;

CREATE OR REPLACE FUNCTION public.rpc_creatures(p_world uuid, p_range double precision DEFAULT 40)
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
   * And the wildlife is not moved from in here any more.
   *
   * This is a read. It ran `creature_sweep`, which settles every creature in
   * forty tiles whose turn is due — up to a hundred and twenty of them, each
   * one a piece of animal thinking, some of it pathing. On the call a browser
   * makes every second, for every player, while the browser waits for the
   * answer.
   *
   * And `world_tick` already does it. It takes the same list of live bodies,
   * dedupes them onto their tiles, and sweeps forty tiles round each one, once
   * a second, on a clock nobody is waiting for. So this was the same work a
   * second time, on the worst possible thread to do it on: measured here at
   * 257 to 466 ms a call against 2.7 ms for the ground read beside it, which
   * is why an island would hand over a deed in a few seconds and its wildlife
   * not at all — eight PostgREST slots, and this sitting in them.
   *
   * Where there is no `pg_cron` there is no other clock, so it still happens
   * here: the suite's bare postgres and any project without the extension are
   * exactly as they were. The guard is the one `world_tick` already uses for
   * the stocking, for the same reason and with the same shape.
   */
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform creature_sweep(p_world, p.x, p.y, p_range);
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'species', c.species, 'name', c.name, 'variant', c.variant,
      'mode', c.mode, 'stance', c.stance, 'job', c.job, 'shod', shod(c), 'tack', c.tack,
      'x', creature_x(c), 'y', creature_y(c),
      'fromX', c.from_x, 'fromY', c.from_y, 'toX', c.to_x, 'toY', c.to_y,
      /*
       * How long the leg is and how much of it is left, in seconds.
       *
       * It used to hand over the two instants themselves, which asks a browser
       * to agree with this database about what time it is. A phone whose clock
       * is twenty seconds out pins every leg at one end or the other and then
       * re-pins it on the next answer, which reads as a thing jumping about —
       * and the action bar learnt this lesson already: "a browser whose clock
       * is a minute out still draws the right bar".
       */
      'legFor', case when c.leg_ends > c.leg_at
                     then extract(epoch from (c.leg_ends - c.leg_at)) else 0 end,
      'legLeft', greatest(0, extract(epoch from (c.leg_ends - now()))),
      'health', c.health, 'max', max_health(c), 'hunger', c.hunger,
      'sex', c.sex, 'age', age_of(c.born, old_of(c)), 'traits', c.traits,
      'hunting', c.hunting = me, 'mine', coalesce(c.keeper = me, false),
      -- What its keeper's perks make of keeping it, which the browser ages and feeds it by.
      'kept', c.kept,
      -- Which vehicle it is in the traces of, which no browser has ever been told.
      'hitchedTo', c.hitched_to)
      /*
       * And, for your own only, what the card has been making up.
       *
       * A worker's trade, its learning, its brushing and what is in its arms
       * are all here and none of them have ever gone out, so the browser
       * filled them in from the book: every wildermon on an island read
       * Foraging 1.00, Experience 0.0, Care 0% and "Looking for work", however
       * long it had been at it. Yours only, because it is a card you open
       * about your own and nobody needs five numbers about a wild boar.
       */
      || case when c.keeper = me then jsonb_build_object(
           'care', c.care, 'xp', c.xp, 'skills', c.skills,
           'phase', c.phase, 'carrying', c.carrying)
         else '{}'::jsonb end
      /*
       * And its pedigree, for anything bred: whole for your own, and for
       * anybody else's saying where a trait came from only for the traits
       * you can read, by the rule the card's chips keep.
       */
      || case when c.pedigree is null then '{}'::jsonb
              when c.keeper = me then jsonb_build_object('pedigree', c.pedigree)
              else jsonb_build_object('pedigree', pedigree_seen(p_world, me, c.pedigree)) end
      order by c.id)
    from creature c
    -- Your own in crates, wherever the crates are; and everything within range.
    where (c.world_id = p_world and c.keeper = me and c.mode = 'stored')
       or (c.world_id = p_world
      /*
       * Where the leg ends, first, because that is what there is an index on.
       *
       * The exact answer below is where the thing is *now*, which is a point
       * on the leg it is walking and so a function of four columns and the
       * clock — nothing a btree can help with, and it was being worked out for
       * every creature on the island before being thrown away. This narrows to
       * the neighbourhood first, generously: `leg_slack` is far longer than
       * any leg the rules make (the longest measured on a real island is 2.13
       * tiles), and anything walking further than that in one leg was already
       * invisible to `creature_sweep`, which has bounded itself this way since
       * it was written.
       */
      and c.to_x between p.x - (p_range + leg_slack()) and p.x + (p_range + leg_slack())
      and c.to_y between p.y - (p_range + leg_slack()) and p.y + (p_range + leg_slack())
      and greatest(abs(creature_x(c) - p.x), abs(creature_y(c) - p.y)) <= p_range)), '[]'::jsonb);
end $function$;


/*
 * Stamped when a beast comes into somebody's keeping or changes hands, however
 * that happens -- tamed, trapped, born, bought, sold in its crate -- and gone
 * with a keeper.
 */
create or replace function creature_kept_stamp() returns trigger
  language plpgsql as $$
begin
  new.kept := case when new.keeper is null then null else kept_of(new.world_id, new.keeper) end;
  return new;
end $$;
drop trigger if exists creature_kept_new on creature;
create trigger creature_kept_new before insert on creature
  for each row when (new.keeper is not null) execute function creature_kept_stamp();
drop trigger if exists creature_kept_moved on creature;
create trigger creature_kept_moved before update of keeper on creature
  for each row when (old.keeper is distinct from new.keeper) execute function creature_kept_stamp();

CREATE OR REPLACE FUNCTION public.class_fold(p_world uuid, p_uid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare p player; v jsonb := '{}'::jsonb; n record; m double precision;
        v_fx jsonb := '{}'::jsonb; e record; v_rule text; v_had double precision;
begin
  select * into p from player where world_id = p_world and uid = p_uid;
  if not found then return '{}'::jsonb; end if;
  for n in
    select cn.channel, cn.mul from player_node pn join class_node cn on cn.id = pn.node
     where pn.world_id = p_world and pn.uid = p_uid
       and cn.class in (p.craft_class, p.combat_class)
     order by cn.id
  loop
    m := coalesce((v->>n.channel)::double precision, 1) * n.mul;
    v := jsonb_set(v, array[n.channel], to_jsonb(m));
  end loop;
  v := jsonb_set(v, '{skills}', coalesce((select jsonb_agg(cs.skill order by cs.skill)
    from class_skill cs where cs.class in (p.craft_class, p.combat_class)), '[]'::jsonb), true);
  if (p.class_mul->'rite'->>'until')::timestamptz > now() then
    v := jsonb_set(v, '{rite}', p.class_mul->'rite', true);
  end if;
  /*
   * And the perks, key by key, by the family's rule (`perk_fx_rule`): times
   * multiply, a carry adds, and anything else is the larger of the two. In id
   * order, as the browser's `foldPerks` is asked to agree with.
   */
  for e in
    select x.key, x.value::double precision as val
      from player_node pn join class_perk cp on cp.id = pn.node
      cross join lateral jsonb_each_text(cp.fx) x
     where pn.world_id = p_world and pn.uid = p_uid
       and cp.class in (p.craft_class, p.combat_class)
     order by cp.id, x.key
  loop
    v_rule := (select r.rule from perk_fx_rule r where r.family = split_part(e.key, ':', 1));
    v_had := (v_fx->>e.key)::double precision;
    v_fx := jsonb_set(v_fx, array[e.key], to_jsonb(case
      when v_had is null then e.val
      when v_rule = 'mul' then v_had * e.val
      when v_rule = 'add' then v_had + e.val
      else greatest(v_had, e.val) end));
  end loop;
  v := jsonb_set(v, '{fx}', v_fx, true);
  update player set class_mul = v where world_id = p_world and uid = p_uid;
  -- And what keeping a beast comes to under the new fold, onto every beast this player keeps (a Herdsman's).
  update creature set kept = kept_of(p_world, p_uid)
   where world_id = p_world and keeper = p_uid and kept is distinct from kept_of(p_world, p_uid);
  return v;
end $function$;

drop function if exists breed_traits(text[], text[], double precision, double precision);
CREATE OR REPLACE FUNCTION public.breed_traits(p_sire text[], p_dam text[], p_husbandry double precision, p_care double precision,
                                               p_keep_plus double precision default 0, p_up_plus double precision default 0)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare pool text[]; keep double precision; up double precision; lift double precision; out_t text[] := '{}';
        slot int; left_t text[]; weights double precision[]; total double precision; r double precision;
        i int; pick text; v_above text; v_family text; v_up text;
        v_from jsonb := '{}'; v_source text;
begin
  select array_agg(distinct t) into pool from unnest(p_sire || p_dam) t;
  pool := coalesce(pool, '{}');
  -- More of the pair and more of it a tier better, for a breeder's True Blood and Bred Up; never past certain.
  keep := least(1, inherit_chance(p_husbandry, p_care) + p_keep_plus);
  up := least(1, upgrade_chance(p_husbandry, p_care) + p_up_plus);
  lift := greatest(0, least(100, p_husbandry)) / 100;
  for slot in 1..trait_slots() loop
    -- What the pair carry that the foal does not, by name.
    select array_agg(t) into left_t from unnest(pool) t where not (trait_family(t) = any(trait_families(out_t)));
    left_t := coalesce(left_t, '{}');
    pick := null; v_source := 'roll';
    if array_length(left_t, 1) > 0 and random() < keep then
      -- A good keeper's eye falls on the best of what the pair carry.
      select array_agg(1 + (select o.ord from trait_def d join tier_odds o on o.tier = d.tier
                            where d.id = t) * lift * 2.4)
        into weights from unnest(left_t) t;
      select sum(w) into total from unnest(weights) w;
      r := random() * total;
      pick := left_t[array_length(left_t, 1)];
      for i in 1..array_length(left_t, 1) loop
        r := r - weights[i];
        if r < 0 then pick := left_t[i]; exit; end if;
      end loop;
      -- Whose it was: which of them carries that very trait, grade and all.
      v_source := case when pick = any(coalesce(p_dam, '{}')) then
                    case when pick = any(coalesce(p_sire, '{}')) then 'both' else 'dam' end
                  else 'sire' end;
    else
      pick := roll_trait(out_t, p_husbandry);
    end if;
    if pick is null then continue; end if;
    -- And then the chance that it comes through better than it went in.
    if random() < up then
      v_above := null; v_up := null;
      select o2.tier into v_above from trait_def d
        join tier_odds o on o.tier = d.tier join tier_odds o2 on o2.ord = o.ord + 1
        where d.id = pick;
      if v_above is not null then
        select d.family into v_family from trait_def d where d.id = pick;
        if v_family is not null then
          select d.id into v_up from trait_def d where d.family = v_family and d.tier = v_above;
        else
          select d.id into v_up from trait_def d
            where d.tier = v_above and d.family is null and not (d.id = any(out_t))
            order by random() limit 1;
        end if;
        if v_up is not null then pick := v_up; v_source := 'up'; end if;
      end if;
    end if;
    if not (trait_family(pick) = any(trait_families(out_t))) then
      out_t := out_t || pick;
      v_from := v_from || jsonb_build_object(pick, v_source);
    end if;
  end loop;
  -- A short straw in the draw never leaves a foal with fewer than three.
  while coalesce(array_length(out_t, 1), 0) < trait_slots() loop
    pick := roll_trait(out_t, p_husbandry);
    exit when pick is null;
    out_t := out_t || pick;
    v_from := v_from || jsonb_build_object(pick, 'roll');
  end loop;
  return jsonb_build_object('traits', to_jsonb(out_t), 'from', v_from);
end $function$;

drop function if exists pair_them(uuid, integer, integer, double precision);
CREATE OR REPLACE FUNCTION public.pair_them(p_world uuid, p_dam integer, p_sire integer, p_husbandry double precision,
                                            p_uid uuid default null, p_sex text default null)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
/*
 * `v_care`, not `care`. The eighth time this class has bitten: a local called
 * `care` inside an `update creature` is not a local, it is the column, and
 * Postgres says "ambiguous" if you are lucky. Alias every table, prefix every
 * local — the rule has not changed and neither has the mistake.
 */
declare dam creature; sire creature; v_care double precision; v_bred jsonb; v_twin jsonb;
        v_keep double precision; v_up double precision; v_sex text; v_rest double precision;
begin
  select * into dam from creature where world_id = p_world and id = p_dam;
  select * into sire from creature where world_id = p_world and id = p_sire;
  v_care := (dam.care + sire.care) / 2;
  /*
   * What the breeder's perks put into it, read off whoever put them together:
   * more of the pair and more of it a tier better (True Blood, Bred Up), the
   * sex they asked for (Choose the Sex) or even odds, now and then a second
   * young bred for itself (Twins), carried for less of the time (Quick
   * Gestation), and both ready again sooner (Short Rest).
   */
  v_keep := pk(p_world, p_uid, 'breed:inherit', 0);
  v_up := pk(p_world, p_uid, 'breed:upgrade', 0);
  v_sex := case when p_sex in ('male', 'female') and pk(p_world, p_uid, 'breed:sex', 0) > 0 then p_sex end;
  v_bred := breed_traits(sire.traits, dam.traits, p_husbandry, v_care, v_keep, v_up);
  if random() < pk(p_world, p_uid, 'breed:twins', 0) then
    v_twin := breed_traits(sire.traits, dam.traits, p_husbandry, v_care, v_keep, v_up);
    v_twin := jsonb_build_object('traits', v_twin->'traits', 'from', v_twin->'from',
      'sex', coalesce(v_sex, case when random() < 0.5 then 'male' else 'female' end));
  end if;
  v_rest := breed_rest() * (1 - pk(p_world, p_uid, 'breed:rest', 1));
  -- The sire is written down now, by id and by name, with where each trait
  -- came from: he need not be about when the hour comes.
  update creature set
      unborn = jsonb_build_object(
        'traits', v_bred->'traits',
        'sex', coalesce(v_sex, case when random() < 0.5 then 'male' else 'female' end),
        'sire', jsonb_build_object('id', sire.id, 'name', sire.name),
        'from', v_bred->'from')
        || case when v_twin is null then '{}'::jsonb else jsonb_build_object('twin', v_twin) end,
      due = now() + make_interval(secs => gestation() * pk(p_world, p_uid, 'breed:gestation', 1)),
      bred_at = now() - make_interval(secs => v_rest)
    where world_id = p_world and id = p_dam;
  update creature set bred_at = now() - make_interval(secs => v_rest) where world_id = p_world and id = p_sire;
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
  if p_action = 'sacrifice' then
    perform perform_sacrifice(p_world, p_uid, p_target);
    return;
  end if;
  if p_action = 'absorb_mote' then
    perform perform_absorb(p_world, p_uid, p_target);
    return;
  end if;

  if p_action = 'plan_bridge' then
    v_kind := coalesce(p_target->>'material', 'rope');
    if bridge_reason(p_world, p_uid, v_kind, floor(p.x)::int, floor(p.y)::int,
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
      -- Half a shorter one for the breeder's Short Rest.
      update creature set bred_at = now() - make_interval(secs => breed_rest() * (1 - pk(p_world, p_uid, 'breed:rest', 1) / 2))
        where world_id = p_world and id in (dam.id, sire.id);
      perform tell(p_world, p_uid, dam.name || ' and ' || sire.name
        || ' will have nothing to do with one another. Brush them, feed them, and try again.', 'error');
      return;
    end if;
    perform pair_them(p_world, dam.id, sire.id, v_skill, p_uid, p_target->>'sex');
    perform journal_note(p_world, p_uid, 'paired');
    perform tell(p_world, p_uid, sire.name || ' is put to ' || dam.name
      || '. She is in young and will drop in about ' || clock_left(gestation() * pk(p_world, p_uid, 'breed:gestation', 1))
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
      update placed set knack = null where id = pc.id;
      perform skill_raise(p_world, p_uid, 'brewing', try_gain(false, brew_gain()));
      perform tell(p_world, p_uid, 'It will not take. You tip the whole soured lot out of the '
        || lower(placed_name(pc)) || '.', 'event');
      return;
    end if;
    update placed set litres = bd.litres, liquid = bd.id, ferment = bd.seconds, since = now(),
        ql = greatest(1, least(100, (v_ql + skill_of(p_world, p_uid, 'brewing')) / 2)),
        -- Its brewer's hand in it, which goes into every bucket drawn off it (a Cook's Strong Brew).
        knack = nullif(pk(p_world, p_uid, 'brewed:' || bd.id, 1), 1)
      where id = pc.id;
    perform journal_note(p_world, p_uid, 'brew');
    perform journal_note(p_world, p_uid, 'brew:' || bd.id);
    perform skill_raise(p_world, p_uid, 'brewing', try_gain(true, brew_gain()));
    perform tell(p_world, p_uid, bd.done || ' (about ' || round(bd.seconds / 60) || ' minutes)', 'event');
  end if;
end $function$;

/*
 * One young dropped: where it goes, what it carries, and what its keeper is
 * told. `give_birth` drops each one a covering left, the first and a twin.
 */
create or replace function drop_young(p_world uuid, p_dam creature, p_coming jsonb) returns integer
  language plpgsql as $function$
declare v_dam creature := p_dam; v_d species_def; v_nx double precision; v_ny double precision;
        v_born int; v_coming jsonb := p_coming; v_traits text[]; v_home record;
        v_mode text; v_where text := ''; v_crate bigint; v_placed bigint;
begin
  select * into v_d from species_def where id = v_dam.species;
  v_nx := creature_x(v_dam); v_ny := creature_y(v_dam);
  /*
   * Where it goes, now that nothing is kept at the token: where a tamed one
   * goes, and then a crate standing on the settlement -- with its keeper's
   * name on it, which a young one born at the token never had.
   *
   * A dam that is nobody's drops a wild one. Otherwise it follows its keeper
   * when nothing else does; goes into an empty creature crate in their pack
   * when something does; and, when they carry none, into an empty one of
   * theirs standing on their settlement, the nearest the dam. With none of
   * those it goes off into the wild.
   */
  v_mode := 'wild';
  if v_dam.keeper is not null and v_dam.mode <> 'wild' then
    if companion_of(p_world, v_dam.keeper) is null then
      v_mode := 'active';
      select py.x, py.y into v_home from player py where py.world_id = p_world and py.uid = v_dam.keeper;
      if found then v_nx := v_home.x; v_ny := v_home.y; end if;
      v_where := ' It follows you.';
    else
      v_crate := empty_crate(p_world, v_dam.keeper);
      if v_crate is null then v_placed := standing_crate(p_world, v_dam.keeper, v_nx, v_ny); end if;
      if v_crate is not null then
        v_mode := 'stored';
        v_where := ' It goes into the creature crate in your pack.';
      elsif v_placed is not null then
        v_mode := 'stored';
        select ' It goes into the empty creature crate at (' || pl.x || ', ' || pl.y || ') on '
               || coalesce((my_deed(p_world, v_dam.keeper)).name, 'your settlement') || '.'
          into v_where from placed pl where pl.id = v_placed;
      else
        v_where := ' Something already follows you and there is no empty creature crate in your pack or standing on your settlement, so it goes off into the wild.';
      end if;
    end if;
  end if;
  v_born := creature_spawn(p_world, v_dam.species, v_nx, v_ny,
    case when v_mode = 'stored' then 'active' else v_mode end, now(),
    case when v_mode = 'wild' then null else v_dam.keeper end);
  select array_agg(t) into v_traits from jsonb_array_elements_text(v_coming->'traits') t;
  /*
   * And its pedigree, for good: the dam as she is now, and the sire and where
   * each trait came from as the covering wrote them down. A young one of a
   * covering made before pedigrees were kept has none, rather than half of one.
   */
  update creature set traits = coalesce(v_traits, '{}'), sex = v_coming->>'sex',
      hunger = 0.9, care = 0.5,
      pedigree = case when v_coming ? 'sire' then jsonb_build_object(
        'dam', jsonb_build_object('id', v_dam.id, 'name', v_dam.name),
        'sire', v_coming->'sire',
        'from', coalesce(v_coming->'from', '{}'::jsonb)) end
    where world_id = p_world and id = v_born;
  update creature c set health = max_health(c) where c.world_id = p_world and c.id = v_born;
  if v_mode = 'stored' then perform crate_shut_in(p_world, v_born, v_crate, v_placed); end if;
  if v_dam.keeper is not null then
    perform away_count(p_world, v_dam.keeper, case when v_mode = 'wild' then 'strayed' else 'born' end,
                       v_dam.species, 1);
    perform journal_note(p_world, v_dam.keeper, 'bred');
    -- A page of the field guide, for a young one born to a dam somebody keeps:
    -- one turned loose before her hour drops hers in the wild, and it is nobody's.
    if v_dam.mode <> 'wild' then perform guide_mark(p_world, v_dam.keeper, v_dam.species, 'bred'); end if;
    -- Blood worth keeping, which is the whole point of putting two together.
    if exists (select 1 from unnest(coalesce(v_traits, '{}')) t
               join trait_def td on td.id = t where td.tier in ('supreme', 'fantastic')) then
      perform journal_note(p_world, v_dam.keeper, 'goodblood');
    end if;
    perform tell(p_world, v_dam.keeper, v_dam.name || ' drops a young ' || lower(v_d.name)
      || ' (' || (v_coming->>'sex') || '): ' || trait_names(coalesce(v_traits, '{}'))
      || '.' || v_where, 'event');
  end if;
  return v_born;
end $function$;


create or replace function give_birth(p_world uuid, p_id integer) returns integer
  language plpgsql as $function$
/*
 * The hour comes. What was settled at the covering is dropped: the young one,
 * and a second from a covering that threw twins (a Herdsman's Twins), each
 * placed as a tamed one is -- so the second goes into a crate when the first
 * already follows. Every local prefixed, as ever in anything that updates
 * `creature`.
 */
declare v_dam creature; v_coming jsonb; v_born int;
begin
  select * into v_dam from creature where world_id = p_world and id = p_id for update;
  if not found or v_dam.due is null or v_dam.due > now() then return 0; end if;
  v_coming := v_dam.unborn;
  update creature set unborn = null, due = null where world_id = p_world and id = p_id;
  if v_coming is null then return 0; end if;
  v_born := drop_young(p_world, v_dam, v_coming - 'twin');
  if v_coming ? 'twin' then
    perform drop_young(p_world, v_dam, (v_coming->'twin') || jsonb_build_object('sire', v_coming->'sire'));
  end if;
  return v_born;
end $function$;

/*
 * What a Herdsman's Stud Book says of one of theirs, out with them, and the
 * mate it would be put to: the odds the pairing takes, and for each of the
 * young's traits the odds it is drawn from their blood and comes out a tier
 * better, at their husbandry, the pair's care and their perks. Nothing
 * without the perk or a mate in reach. The browser's `studBook`.
 */
create or replace function stud_book(p_world uuid, p_uid uuid, c creature) returns text
  language plpgsql stable as $$
declare mate creature; v_skill double precision; v_care double precision;
begin
  if pk(p_world, p_uid, 'stud_book', 0) <= 0 or c.keeper is distinct from p_uid or c.mode not in ('active', 'deed') then
    return '';
  end if;
  mate := mate_for(p_world, c);
  if mate.id is null then return ''; end if;
  v_skill := skill_of(p_world, p_uid, 'animal_husbandry');
  v_care := (c.care + mate.care) / 2;
  return ' Put to ' || mate.name || ', it takes ' || round((breed_chance(v_skill, v_care) * 100)::numeric)::int
    || '% of the time; each of the young''s ' || trait_slots() || ' traits is drawn from their blood '
    || round((least(1, inherit_chance(v_skill, v_care) + pk(p_world, p_uid, 'breed:inherit', 0)) * 100)::numeric)::int
    || '% of the time and comes out a tier better '
    || round((least(1, upgrade_chance(v_skill, v_care) + pk(p_world, p_uid, 'breed:upgrade', 0)) * 100)::numeric)::int
    || '% of the time.';
end $$;

/*
 * The Herdsman's tree, cleared, as the nine before it were: its nine nodes
 * left `class_node` with the rulebook that brought its perks, whatever of them
 * anybody had taken goes, and every Herdsman's fold is written again -- which
 * stamps what each keeps.
 */
delete from player_node where node ~ '^herdsman_[0-9]_[0-9]$';
do $$
declare r record;
begin
  for r in select world_id, uid from player where craft_class = 'herdsman' loop
    perform class_fold(r.world_id, r.uid);
  end loop;
end $$;

revoke all on function kept_of(uuid, uuid) from public, anon, authenticated;
revoke all on function old_of(creature) from public, anon, authenticated;
revoke all on function age_of(timestamptz, double precision) from public, anon, authenticated;
revoke all on function age_row(timestamptz, double precision) from public, anon, authenticated;
revoke all on function coax_bonus(creature, double precision) from public, anon, authenticated;
revoke all on function bait_in_pack(uuid, uuid, text, boolean) from public, anon, authenticated;
revoke all on function care_mul(creature) from public, anon, authenticated;
revoke all on function creature_kept_stamp() from public, anon, authenticated;
revoke all on function breed_traits(text[], text[], double precision, double precision, double precision, double precision) from public, anon, authenticated;
revoke all on function pair_them(uuid, integer, integer, double precision, uuid, text) from public, anon, authenticated;
revoke all on function drop_young(uuid, creature, jsonb) from public, anon, authenticated;
revoke all on function give_birth(uuid, integer) from public, anon, authenticated;
revoke all on function stud_book(uuid, uuid, creature) from public, anon, authenticated;
select private.lock_doors();
