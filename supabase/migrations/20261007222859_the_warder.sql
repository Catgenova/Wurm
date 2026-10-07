/*
 * The Warder: two spells and a passive at each of six tiers, opening on the
 * trade's own level, as the other fighting trades' do (`talents.ts`) -- the
 * last of the ten, so no trade is on a tree any more.
 *
 * Picked: spells 1 2 3 7 11 12 14 20 32 42 44 47 and passives 1 4 15 22 25 28
 * of the fifty and thirty offered, and set in the tiers in order of what they
 * are worth. The rows came with the definitions just before this. Here: a
 * skin in hundredths of health, which an Aegis's was not; what a skin at 100%
 * is (`warder_skin_at`); how large one is laid and how it goes over another
 * (`warder_skin_size`, `warder_skin_after`, `warder_skin_put`); a Thicken
 * waiting for the next (`warder_thicken_at`, `warder_thicken_take`); a skin
 * used up (`warder_skin_spent`); and the passives where their rules are.
 */
set local lock_timeout = '3s';

/* The Warder's old tree went with the move to perks: its bought nodes go too, and its holders are folded afresh. */
delete from player_node pn
 where pn.node like 'warder\_%' and not exists (select 1 from class_perk k where k.id = pn.node)
   and not exists (select 1 from class_node n where n.id = pn.node);
do $$ declare r record; begin
  for r in select world_id, uid from player where combat_class = 'warder' loop perform class_fold(r.world_id, r.uid); end loop;
end $$;

/*
 * A skin is in hundredths of health now. An Aegis laid one of its whole
 * force, 6.5 to 35 healths over a body of one, which took every blow there
 * was; every skin laid that way is brought down to what it is in hundredths.
 * Nothing laid any other way comes to a whole health.
 */
update player set stats = jsonb_set(stats, '{aegis}', to_jsonb((stats->>'aegis')::double precision / 100))
 where coalesce((stats->>'aegis')::double precision, 0) >= 1;

/* What a Warder's skin at 100% is now, in hundredths of health: an Aegis out of their focus at their warding (`spell_force`). Nothing without a focus. */
create or replace function warder_skin_at(p_world uuid, p_uid uuid)
  returns double precision language plpgsql stable as $$
declare d spell_def; it item;
begin
  it := school_focus(p_world, p_uid, 'warding');
  if it.id is null then return 0; end if;
  select * into d from spell_def where id = 'aegis';
  return spell_force(p_world, p_uid, d, it) / 100;
end $$;

/*
 * How large a skin somebody lays is, from what it would be: a share of their
 * skin at 100% (`warder_skin_at`), or an Aegis's or a Bulwark's force. Larger
 * for their Thick Skin, larger again over somebody else for their Protector,
 * and by a Thicken waiting, which the caller names.
 */
create or replace function warder_skin_size(p_world uuid, p_by uuid, p_on uuid, p_base double precision, p_thick double precision)
  returns double precision language plpgsql stable as $$
declare pl player;
begin
  select * into pl from player where world_id = p_world and uid = p_by;
  return p_base * coalesce(p_thick, 1) * pk(coalesce(pl.class_mul, '{}'::jsonb), 'skin:size', 1)
       * case when p_on is distinct from p_by then pk(coalesce(pl.class_mul, '{}'::jsonb), 'skin:other', 1) else 1 end;
end $$;

/*
 * What is over somebody once a skin of so much is laid over theirs: the
 * larger of the two, or the two added up to the layer's Overcharge's share of
 * the larger. Nothing is laid.
 */
create or replace function warder_skin_after(p_world uuid, p_by uuid, p_on uuid, p_size double precision)
  returns double precision language sql stable as $$
  select case when pk(p_world, p_by, 'skin:over', 0) > 0
              then least(t.was + p_size, pk(p_world, p_by, 'skin:over', 0) * greatest(t.was, p_size))
              else greatest(t.was, p_size) end
    from (select coalesce((pl.stats->>'aegis')::double precision, 0) as was
            from player pl where pl.world_id = p_world and pl.uid = p_on) t
$$;

/* A skin laid over somebody, as `warder_skin_after` has it, and marked as the layer's for their Ward Link to know it. What is over them after. */
create or replace function warder_skin_put(p_world uuid, p_by uuid, p_on uuid, p_size double precision)
  returns double precision language plpgsql as $$
declare v_was double precision; v_now double precision;
begin
  select coalesce((stats->>'aegis')::double precision, 0) into v_was from player where world_id = p_world and uid = p_on;
  if not found then return 0; end if;
  v_now := warder_skin_after(p_world, p_by, p_on, p_size);
  if v_now > v_was then
    update player set stats = coalesce(stats, '{}'::jsonb) || jsonb_build_object('aegis', v_now, 'aegisBy', p_by)
     where world_id = p_world and uid = p_on;
  end if;
  return greatest(v_now, v_was);
end $$;

/* How much larger a Thicken waiting on somebody makes the next skin they lay: one where none waits. */
create or replace function warder_thicken_at(p_world uuid, p_uid uuid)
  returns double precision language sql stable as $$
  select coalesce((select (pl.blessings->'thicken'->>'more')::double precision from player pl
                    where pl.world_id = p_world and pl.uid = p_uid
                      and (pl.blessings->'thicken'->>'until')::timestamptz > now()), 1)
$$;

/* And the Thicken spent, by the skin it made larger. */
create or replace function warder_thicken_take(p_world uuid, p_uid uuid)
  returns void language sql as $$
  update player set blessings = blessings - 'thicken' where world_id = p_world and uid = p_uid and blessings ? 'thicken'
$$;

/* What a skin spell did, in a sentence: laid, laid in place of a smaller one, or added to the one there for an Overcharge. */
create or replace function warder_skin_said(p_spell text, p_who text, p_size double precision, p_now double precision, p_was double precision)
  returns text language sql immutable as $$
  select p_spell || ': a skin of ' || faith_pct(p_size) || ' goes over ' || p_who || case
    when p_was <= 0 then '.'
    when p_now > greatest(p_was, p_size) + 1e-9 then ', added to the one there: ' || faith_pct(p_now) || ' now.'
    else ', in place of a smaller one.' end
$$;

/*
 * A skin over somebody used up by a blow (`hurt_player`): their own Second
 * Wind gives them stamina back, and a Ward Link of whoever laid it, within its
 * reach of them, lays a fresh one -- once for each of them while it holds.
 */
create or replace function warder_skin_spent(p_world uuid, p_uid uuid)
  returns void language plpgsql as $$
declare p player; l player; v_by uuid; v_link jsonb; v_size double precision;
begin
  select * into p from player where world_id = p_world and uid = p_uid;
  if p.uid is null then return; end if;
  if pk(p.class_mul, 'stamina:skin', 0) > 0 then
    update player set stats = jsonb_set(stats, '{stamina}',
        to_jsonb(least(1, coalesce((stats->>'stamina')::double precision, 1) + pk(p.class_mul, 'stamina:skin', 0))))
     where world_id = p_world and uid = p_uid;
    perform tell(p_world, p_uid, (select name from class_perk where id = 'warder_second_wind') || ': you get back '
      || faith_pct(pk(p.class_mul, 'stamina:skin', 0)) || ' of your stamina.', 'fight');
  end if;
  if coalesce(p.stats->>'aegisBy', '') !~ '^[0-9a-f-]{36}$' then return; end if;
  v_by := (p.stats->>'aegisBy')::uuid;
  if v_by = p_uid then return; end if;
  select * into l from player where world_id = p_world and uid = v_by and not away;
  v_link := l.blessings->'ward_link';
  if l.uid is null or v_link is null or (v_link->>'until')::timestamptz <= now()
     or coalesce(v_link->'done', '[]'::jsonb) ? p_uid::text
     or (l.x - p.x) ^ 2 + (l.y - p.y) ^ 2 > (v_link->>'reach')::double precision ^ 2 then
    return;
  end if;
  v_size := warder_skin_size(p_world, v_by, p_uid, warder_skin_at(p_world, v_by) * (v_link->>'skin')::double precision, 1);
  perform warder_skin_put(p_world, v_by, p_uid, v_size);
  update player set blessings = jsonb_set(blessings, '{ward_link,done}',
      coalesce(blessings->'ward_link'->'done', '[]'::jsonb) || to_jsonb(p_uid::text))
   where world_id = p_world and uid = v_by;
  perform tell(p_world, p_uid, l.name || '''s ' || (select name from class_spell where id = 'warder_ward_link')
    || ': a skin of ' || faith_pct(v_size) || ' goes back over you.', 'fight');
  perform tell(p_world, v_by, (select name from class_spell where id = 'warder_ward_link') || ': a skin of ' || faith_pct(v_size)
    || ' goes back over ' || coalesce(p.name, 'them') || '.', 'fight');
end $$;

/* A Warder's Thorns: what was owed a creature for the blows it landed on them, its share of its own attack each (`hurt_player`). */
create or replace function warder_thorns(p_world uuid, p_uid uuid, p_id integer, p_dmg double precision)
  returns void language plpgsql as $$
declare pl player; c creature; v_name text; v_died boolean; v_left double precision;
begin
  select * into pl from player where world_id = p_world and uid = p_uid;
  select * into c from creature where world_id = p_world and id = p_id and health > 0;
  if pl.uid is null or c.id is null or p_dmg <= 0 then return; end if;
  v_name := coalesce((select lower(name) from species_def where id = c.species), 'creature');
  v_died := wound_beast(p_world, p_id, p_dmg, pl.x, pl.y, p_uid, null);
  v_left := coalesce((select health from creature where world_id = p_world and id = p_id), 0);
  perform tell(p_world, p_uid, (select name from class_perk where id = 'warder_thorns') || ': the ' || v_name || ' takes '
    || trim_scale(round(p_dmg::numeric, 1)) || ' back' || case when v_died then ', and dies.'
    else '. It is down to ' || greatest(0, ceil(v_left)) || ' of ' || max_health(c) || '.' end, 'fight');
end $$;

/* A Warder's Watchful: a creature that struck somebody near them turns on them (`hurt_player`), as a Challenge turns one. */
create or replace function warder_watched(p_world uuid, p_uid uuid, p_id integer)
  returns void language plpgsql as $$
declare pl player; c creature; d species_def;
begin
  select * into pl from player where world_id = p_world and uid = p_uid and not away;
  select * into c from creature where world_id = p_world and id = p_id and health > 0 and mode = 'wild';
  if pl.uid is null or c.id is null or c.hunting is not distinct from p_uid then return; end if;
  select * into d from species_def where id = c.species;
  if coalesce(d.timid, false) then return; end if;
  update creature set hunting = p_uid, brawl = null, windup_at = null, hunt_again = null,
      hunt_x = creature_x(c), hunt_y = creature_y(c), threat_at = now()
    where world_id = p_world and id = p_id;
  perform tell(p_world, p_uid, (select name from class_perk where id = 'warder_watchful') || ': the ' || lower(d.name)
    || ' turns on you.', 'fight');
end $$;

CREATE OR REPLACE FUNCTION public.hurt_player(p_world uuid, p_uid uuid, p_raw double precision, p_what text, p_kind text DEFAULT 'bite'::text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare p player; shield item; sh shield_def; chance double precision; roll double precision;
        part text; piece item; cls armour_class_def; soak double precision; taken double precision;
        health double precision; ws jsonb; had jsonb; found_w boolean := false; out_w jsonb := '[]'::jsonb;
        w jsonb; k wound_kind_def; note text; aegis double precision; v_worn double precision;
        v_from creature; v_venom boolean := false; v_dodge double precision; v_guard uuid; v_watch uuid;
begin
  select * into p from player where world_id = p_world and uid = p_uid for update;
  if not found then return; end if;
  -- Dodged, before anything else has its say (`dodge_chance`): your body control, less the armour on you.
  select * into v_from from creature where world_id = p_world and id = (p.stats->>'hurtBy')::int;
  -- Nothing is struck inside a Truce, nor by anything standing in one (`faith_truce`).
  if faith_truce(p_world, p.x, p.y)
     or (v_from.id is not null and faith_truce(p_world, creature_x(v_from), creature_y(v_from))) then
    return;
  end if;
  -- A creature's blow lands on an Archer's Decoy instead, while it holds.
  if v_from.id is not null and (p.blessings->'decoy'->>'until')::timestamptz > now() then
    perform tell(p_world, p_uid, 'The ' || coalesce((select lower(name) from species_def where id = v_from.species), 'creature')
      || ' strikes your decoy.', 'fight');
    return;
  end if;
  -- And none lands at all inside a Warder's Unbreakable.
  if v_from.id is not null and (p.blessings->'unbreakable'->>'until')::timestamptz > now() then
    perform tell(p_world, p_uid, 'The ' || coalesce((select lower(name) from species_def where id = v_from.species), 'creature')
      || '’s blow does not land: ' || (select name from class_spell where id = 'warder_unbreakable') || '.', 'fight');
    perform fight_back(p_world, p_uid, (p.stats->>'hurtBy')::int);
    return;
  end if;
  -- A Sworn Blade's Guardian standing near may take it on a shield instead (`class_guardian`).
  if v_from.id is not null then
    v_guard := class_guardian(p_world, p.x, p.y, p_uid);
    if v_guard is not null then
      perform class_guard_take(p_world, v_guard, p_raw,
        coalesce((select lower(name) from species_def where id = v_from.species), 'creature'), p.name);
      perform tell(p_world, p_uid, (select name from player where world_id = p_world and uid = v_guard)
        || ' takes the ' || coalesce((select lower(name) from species_def where id = v_from.species), 'creature')
        || '’s blow on a shield.', 'fight');
      perform fight_back(p_world, p_uid, (p.stats->>'hurtBy')::int);
      return;
    end if;
  end if;
  -- No roll at all while there is no chance, so nothing else's luck moves.
  v_dodge := dodge_chance(skill_of(p_world, p_uid, 'body_control'), worn_kg(p_world, p_uid));
  if v_dodge > 0 and random() < v_dodge then
    perform skill_raise(p_world, p_uid, 'body_control', dodge_gain());
    perform tell(p_world, p_uid, 'You dodge the '
      || coalesce((select lower(name) from species_def where id = v_from.species), 'blow') || '.', 'fight');
    -- And answered, for a Skirmisher's Riposte: owed now, struck once its row is written (`class_riposte`).
    if v_from.id is not null and pk(p_world, p_uid, 'riposte:blow', 0) > 0 then
      insert into class_mark (world_id, creature_id, kind, val, n, until, by_uid)
        values (p_world, v_from.id, 'riposte', pk(p_world, p_uid, 'riposte:blow', 0), 1, now(), p_uid)
        on conflict (world_id, creature_id, kind) do update set n = coalesce(class_mark.n, 0) + 1
          where class_mark.by_uid = excluded.by_uid;
    end if;
    perform fight_back(p_world, p_uid, (p.stats->>'hurtBy')::int);
    return;
  end if;
  /*
   * A blow that lands. A Warder's Thorns answers it with its share of the
   * creature's own attack, and the nearest other Warder with Watchful within
   * their reach of you turns it on themselves -- both owed now and paid once
   * its row is written (`class_owed_pay`).
   */
  if v_from.id is not null then
    if pk(p.class_mul, 'thorns:attack', 0) > 0 then
      insert into class_mark (world_id, creature_id, kind, val, until, by_uid)
        values (p_world, v_from.id, 'thorns', attack_of(v_from) * pk(p.class_mul, 'thorns:attack', 0), now(), p_uid)
        on conflict (world_id, creature_id, kind) do update set val = class_mark.val + excluded.val, by_uid = excluded.by_uid;
    end if;
    select w.uid into v_watch from player w
     where w.world_id = p_world and w.uid <> p_uid and not w.away and w.combat_class = 'warder'
       and pk(w.class_mul, 'watch:reach', 0) > 0 and v_from.hunting is distinct from w.uid
       and (w.x - p.x) ^ 2 + (w.y - p.y) ^ 2 <= pk(w.class_mul, 'watch:reach', 0) ^ 2
     order by (w.x - p.x) ^ 2 + (w.y - p.y) ^ 2, w.uid limit 1;
    if v_watch is not null then
      insert into class_mark (world_id, creature_id, kind, val, until, by_uid)
        values (p_world, v_from.id, 'watched', 1, now(), v_watch)
        on conflict (world_id, creature_id, kind) do update set by_uid = excluded.by_uid;
    end if;
  end if;
  -- A venomous bite leaves venom in what it opens (`venom_secs`).
  -- A Ward, and then a Shield of Dawn, before anything else is asked of the blow (`faith_blunt`).
  p_raw := faith_blunt(p_world, p_uid, p_raw);
  if p_raw <= 0 then
    perform fight_back(p_world, p_uid, (p.stats->>'hurtBy')::int);
    return;
  end if;
  -- A striker made to Cower lands its share less (`faith_weakened`).
  p_raw := p_raw * faith_weakened(p_world, v_from.id);
  -- And one Disarming Cut left on it lands its share less, counted off (`class_disarm_take`).
  p_raw := p_raw * class_disarm_take(p_world, v_from.id);
  -- And one that is burning lands its share less on a Kindler's Flame Ward (`class_burning`).
  if v_from.id is not null and pk(p.class_mul, 'ward:burning', 1) <> 1 and class_burning(p_world, v_from.id) then
    p_raw := p_raw * pk(p.class_mul, 'ward:burning', 1);
  end if;
  -- And one held, rooted or slowed lands its share less on a Binder's Frost Ward (`class_stilled`),
  if v_from.id is not null and pk(p.class_mul, 'ward:stilled', 1) <> 1 and class_stilled(p_world, v_from) then
    p_raw := p_raw * pk(p.class_mul, 'ward:stilled', 1);
  end if;
  -- and one inside a Dull Claws lands its share less on anybody (`class_dull`),
  if v_from.id is not null then p_raw := p_raw * class_dull(p_world, v_from.id); end if;
  -- and every blow its share less inside a Binder's Still Skin,
  if (p.blessings->'still_skin'->>'until')::timestamptz > now() then
    p_raw := p_raw * (1 - (p.blessings->'still_skin'->>'cut')::double precision);
  end if;
  -- and inside a Warder's Stoneskin, and again inside a Bastion of Stone.
  if (p.blessings->'stoneskin'->>'until')::timestamptz > now() then
    p_raw := p_raw * (1 - (p.blessings->'stoneskin'->>'cut')::double precision);
  end if;
  if (p.blessings->'bastion_stone'->>'until')::timestamptz > now() then
    p_raw := p_raw * (1 - (p.blessings->'bastion_stone'->>'cut')::double precision);
  end if;
  v_venom := coalesce((select venom from species_def where id = v_from.species), false);
  -- Harder or softer for the way you stand (`stance_taken`), before anything has its say,
  p_raw := p_raw * my_stance_taken(p_world, p_uid, p.fight_stance)
    -- and less inside a Sworn Blade's Last Stand,
    * case when (p.blessings->'last_stand'->>'until')::timestamptz > now()
           then 1 - (p.blessings->'last_stand'->>'cut')::double precision else 1 end
    -- and more inside a Berserker's Battle Rage,
    * case when (p.blessings->'battle_rage'->>'until')::timestamptz > now()
           then (p.blessings->'battle_rage'->>'taken')::double precision else 1 end
    -- and less on a Pikeman's feet that have not moved (Bastion), as `hurtPlayer` has it, which `fight_back` asks the same of;
    * case when p.moved_at is null or p.moved_at <= now() - make_interval(secs => fight_back_still())
           then pk(p.class_mul, 'still:taken', 1) else 1 end;
  -- and harder from something on you that is not what you are fighting: it is at your back (`flank_hit`).
  if is_fight(p.act) and p.act_target->>'kind' = 'creature' and p.stats ? 'hurtBy'
     and (p.act_target->>'id')::int is distinct from (p.stats->>'hurtBy')::int then
    p_raw := p_raw * flank_hit();
  end if;

  -- Being hit in the dark teaches more about watching than hitting does, and
  -- before the shield, because a blow you turned is still a blow you did not
  -- see coming.
  perform fought_in_dark(p_world, p_uid, dark_hit());

  /*
   * The skin a warder put over you, which takes the blow instead and is spent
   * doing it.
   *
   * Before the shield, because it is not a thing you are holding -- it is
   * between the blow and everything you are holding. A skin that covers the
   * whole blow stops it dead; one that does not goes, and what is left of the
   * blow carries on into the shield and the armour as it always did. Nothing
   * downstream of here knows it happened.
   */
  aegis := coalesce((p.stats->>'aegis')::double precision, 0);
  if aegis > 0 then
    if aegis >= p_raw then
      update player set stats = jsonb_set(stats, '{aegis}', to_jsonb(aegis - p_raw))
        where world_id = p_world and uid = p_uid;
      perform tell(p_world, p_uid, 'The ward takes ' || p_what || ', and holds.', 'fight');
      -- Taken to the last of it: a Second Wind, and a Ward Link of whoever laid it (`warder_skin_spent`).
      if aegis - p_raw <= 1e-9 then perform warder_skin_spent(p_world, p_uid); end if;
      perform fight_back(p_world, p_uid, (p.stats->>'hurtBy')::int);
      return;
    end if;
    update player set stats = jsonb_set(stats, '{aegis}', to_jsonb(0::double precision))
      where world_id = p_world and uid = p_uid;
    p_raw := p_raw - aegis;
    perform tell(p_world, p_uid, 'The ward goes with a sound like ice, and the rest of it reaches you.', 'fight');
    perform warder_skin_spent(p_world, p_uid);
  end if;

  -- The shield, next.
  shield := worn(p_world, p_uid, 'offhand');
  if shield.id is not null then
    select * into sh from shield_def where id = shield.def;
    if found then
      -- With what a Sworn Blade's Shield Mastery adds, under the ceiling it raises (`shield_block`).
      chance := shield_block(p_world, p_uid, sh, shield.ql)
        -- Less of one for every other thing on you than the one that struck (`crowd_block`).
        * greatest(0, 1 - crowd_block() * (select count(*) from creature o
            where o.world_id = p_world and o.hunting = p_uid and o.mode = 'wild' and o.health > 0 and o.brawl is null
              and o.id is distinct from (p.stats->>'hurtBy')::int));
      perform skill_raise(p_world, p_uid, 'shields', 0.12);
      if random() < chance then
        -- Less for a Mender's Armour Care.
        update item set dmg = least(100, dmg + p_raw * 3 * pk(p_world, p_uid, 'worn:shield', 1)) where id = shield.id;
        perform skill_raise(p_world, p_uid, 'shields', 0.5);
        perform tell(p_world, p_uid, 'You take ' || p_what || ' on your '
          || lower((select name from item_def where id = shield.def)) || '.', 'fight');
        if v_from.id is not null then
          -- A Sworn Blade's Counterweight: its next blow put back, paid by its own turn (`class_stagger_owed`).
          if pk(p.class_mul, 'stagger:block', 0) > 0 then
            insert into class_mark (world_id, creature_id, kind, val, until, by_uid)
              values (p_world, v_from.id, 'stagger', pk(p.class_mul, 'stagger:block', 0), now() + interval '1 minute', p_uid)
              on conflict (world_id, creature_id, kind) do update set val = class_mark.val + excluded.val, until = excluded.until;
          end if;
          -- And a Deflect sends its share of the blow back, paid as a Retribution's is (`faith_owed`).
          if (p.blessings->'deflect'->>'until')::timestamptz > now() then
            insert into faith_owed (world_id, creature_id, dmg, from_uid)
              values (p_world, v_from.id, p_raw * (p.blessings->'deflect'->>'share')::double precision / blow_share(), p_uid);
          end if;
        end if;
        -- A blow turned is still a blow, and you turn on whatever struck it.
        perform fight_back(p_world, p_uid, (p.stats->>'hurtBy')::int);
        return;
      end if;
    end if;
  end if;

  -- Then wherever it lands.
  roll := random();
  select h.slot into part from (
    select slot, sum(share) over (order by ord) as upto from hit_location) h
  where roll <= h.upto order by h.upto limit 1;
  part := coalesce(part, 'chest');

  taken := p_raw;
  note := '';
  piece := worn(p_world, p_uid, part);
  if piece.id is not null and exists (select 1 from armour_def where id = piece.def) then
    select c.* into cls from armour_def a join armour_class_def c on c.id = a.cls where a.id = piece.def;
    -- And the trade, on the line of armour this piece belongs to: a pikeman's
    -- harness does nothing for the leather an archer is wearing.
    soak := piece_soak(piece, skill_of(p_world, p_uid, cls.skill))
          * class_mul(p_world, p_uid, 'guard', cls.skill)
          -- And what this class of armour makes of this kind of blow (`armour_vs`).
          * armour_vs(cls.id, p_kind);
    -- Armour is learned by being hit in it, and worn out the same way.
    perform skill_raise(p_world, p_uid, cls.skill, 0.4);
    -- Less for a Mender's Armour Care.
    -- And a burn wears it out `burn_wear` times as fast.
    v_worn := p_raw * 4 * pk(p_world, p_uid, 'worn:armour', 1) * case when p_kind = 'burn' then burn_wear() else 1 end;
    update item set dmg = least(100, dmg + v_worn) where id = piece.id;
    if (select i.dmg from item i where i.id = piece.id) >= 100 then
      delete from item where id = piece.id;
      update player set equipped = equipped - part where world_id = p_world and uid = p_uid;
      perform tell(p_world, p_uid, 'Your ' || lower((select name from item_def where id = piece.def))
        || ' is beaten to pieces and falls away.', 'fight');
    else
      note := ', though your ' || lower((select name from item_def where id = piece.def)) || ' takes the worst of it';
    end if;
    taken := p_raw * (1 - least(0.92, soak));
  end if;

  select * into k from wound_kind_def where id = p_kind;
  -- Open a wound, or deepen one of the same kind already in that place.
  for w in select * from jsonb_array_elements(coalesce(p.wounds, '[]'::jsonb)) loop
    if not found_w and w->>'kind' = p_kind and w->>'part' = part and not (w->>'infected')::boolean then
      -- Less of a wound than of a blow for a Sworn Blade's Battle-Hardened; the health it takes is the same.
      w := jsonb_set(w, '{severity}', to_jsonb((w->>'severity')::double precision + taken * pk(p.class_mul, 'severity:wound', 1)));
      if k.bleed > 0.001 then w := jsonb_set(w, '{bleeding}', 'true'); end if;
      if v_venom then w := jsonb_set(w, '{venom}', to_jsonb(venom_secs())); end if;
      found_w := true;
    end if;
    out_w := out_w || w;
  end loop;
  if not found_w then
    -- A bruise does not bleed; everything else does until it is seen to. And a fresh one less deep for a Pikeman's Scarred.
    w := jsonb_build_object('kind', p_kind, 'part', part,
      'severity', taken * pk(p.class_mul, 'severity:wound', 1) * pk(p.class_mul, 'severity:new', 1),
      'bleeding', p_kind <> 'crush', 'infected', false, 'dressing', null, 'at', now())
      || case when v_venom then jsonb_build_object('venom', venom_secs()) else '{}'::jsonb end;
    out_w := out_w || w;
  end if;

  -- A Retribution's share of what landed goes back to whatever struck, paid when it is next settled (`faith_owed`).
  if v_from.id is not null and (p.blessings->'retribution'->>'until')::timestamptz > now() then
    insert into faith_owed (world_id, creature_id, dmg, from_uid)
      values (p_world, v_from.id, taken * (p.blessings->'retribution'->>'share')::double precision / blow_share(), p_uid);
  end if;
  -- And answered by your companion inside a Beastmaster's Vengeance: owed now, struck once its row is written (`class_vengeance`).
  if v_from.id is not null and (p.blessings->'vengeance'->>'until')::timestamptz > now() then
    insert into class_mark (world_id, creature_id, kind, val, n, until, by_uid)
      values (p_world, v_from.id, 'vengeance', (p.blessings->'vengeance'->>'more')::double precision, 1, now(), p_uid)
      on conflict (world_id, creature_id, kind) do update set n = coalesce(class_mark.n, 0) + 1
        where class_mark.by_uid = excluded.by_uid;
  end if;
  -- And set alight for a Kindler's Burning Retort: owed now, lit once its row is written (`class_owed_pay`).
  if v_from.id is not null and pk(p.class_mul, 'retort:each', 0) > 0 then
    insert into class_mark (world_id, creature_id, kind, val, until, by_uid)
      values (p_world, v_from.id, 'retort', pk(p.class_mul, 'retort:each', 0), now(), p_uid)
      on conflict (world_id, creature_id, kind) do update set val = excluded.val, by_uid = excluded.by_uid;
  end if;
  -- A share of it on your companion, for a Beastmaster's Feral Bond or Shared Wounds (`class_bond_take`).
  taken := class_bond_take(p_world, p_uid, taken, v_from.id);
  -- And an Oath puts half of it on the friend sworn to (`faith_oath`).
  taken := faith_oath(p_world, p_uid, taken);
  health := greatest(0, coalesce((p.stats->>'health')::double precision, 1) - taken);
  /*
   * Built from the row as it stands rather than from the copy taken at the top
   * of this function.
   *
   * `p` is a snapshot, and writing `p.stats` back puts everything in it back
   * -- including anything this function itself changed on the way down. That
   * was harmless while nothing did, and the ward is the first thing that does:
   * it was spent against the blow, and then handed straight back, so a warder's
   * skin absorbed for ever. Measured, before the fix: a 0.15 skin took 0.15 of
   * a 0.20 blow, the remaining 0.05 opened a wound as it should -- and the skin
   * read 0.15 again afterwards.
   *
   * Unqualified, `stats` is the column of the row being updated, which is the
   * live value. Nothing else in here reads it after this point.
   */
  update player set wounds = out_w,
      stats = jsonb_set(jsonb_set(stats, '{health}', to_jsonb(health)),
                        '{hurtSettled}', to_jsonb(now()))
    where world_id = p_world and uid = p_uid;
  perform tell(p_world, p_uid, p_what || note || '. You have ' || wound_text(w) || '.', 'fight');
  -- And a Second Life, which the killing blow spends instead of you (`faith_second_life`).
  -- Undying holds you at its floor and is not spent; a Second Life is.
  if health <= 0 and faith_undying(p_world, p_uid) then perform fight_back(p_world, p_uid, (p.stats->>'hurtBy')::int);
  elsif health <= 0 and faith_second_life(p_world, p_uid) then perform fight_back(p_world, p_uid, (p.stats->>'hurtBy')::int);
  elsif health <= 0 then perform player_die(p_world, p_uid);
  else perform fight_back(p_world, p_uid, (p.stats->>'hurtBy')::int); end if;
end $function$;

CREATE OR REPLACE FUNCTION public.class_owed_pay(p_world uuid, p_id integer)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare m class_mark; b jsonb; c creature; pl player; v_name text; v_back double precision;
begin
  if not exists (select 1 from class_mark where world_id = p_world and creature_id = p_id) then return; end if;
  delete from class_mark where world_id = p_world and creature_id = p_id and kind in ('warned', 'exposed', 'marked', 'burn', 'hold', 'root', 'tether', 'limbs', 'dull', 'brittle') and until < now();
  delete from class_mark where world_id = p_world and creature_id = p_id and kind = 'brace' and until <= now()
    returning * into m;
  if m.creature_id is not null then
    select * into c from creature where world_id = p_world and id = p_id;
    select * into pl from player where world_id = p_world and uid = m.by_uid;
    if c.id is not null and c.health > 0 and pl.uid is not null
       and sqrt((creature_x(c) - pl.x) ^ 2 + (creature_y(c) - pl.y) ^ 2) <= melee_reach(p_world, pl.uid) + 0.5 then
      select name into v_name from class_spell where id = 'pikeman_brace_for_the_charge';
      v_back := spell_fx('pikeman_brace_for_the_charge', 'back');
      b := class_blow(p_world, pl.uid, p_id, spell_fx('pikeman_brace_for_the_charge', 'more'));
      if (b->>'landed')::boolean and not (b->>'died')::boolean then
        update creature set until = greatest(until, now()) + make_interval(secs => v_back) where world_id = p_world and id = p_id;
        perform tell(p_world, pl.uid, class_blow_said(v_name, b) || ' Its next blow is put back ' || faith_span(v_back) || '.', 'fight');
      else
        perform tell(p_world, pl.uid, class_blow_said(v_name, b), 'fight');
      end if;
    end if;
  end if;
  delete from class_mark where world_id = p_world and creature_id = p_id and kind = 'riposte'
    returning * into m;
  if m.creature_id is not null and m.by_uid is not null then
    perform class_riposte(p_world, m.by_uid, p_id, m.val, m.n);
  end if;
  -- And a blow it landed on a Kindler with a Burning Retort: it burns, as a burn they started (`class_burn`).
  delete from class_mark where world_id = p_world and creature_id = p_id and kind = 'retort'
    returning * into m;
  if m.creature_id is not null and m.by_uid is not null then
    perform class_burn(p_world, m.by_uid, p_id, m.val, pk(p_world, m.by_uid, 'retort:secs', 0));
  end if;
  -- And every blow it landed on a Beastmaster inside a Vengeance, answered by their companion (`class_vengeance`).
  delete from class_mark where world_id = p_world and creature_id = p_id and kind = 'vengeance'
    returning * into m;
  if m.creature_id is not null and m.by_uid is not null then
    perform class_vengeance(p_world, m.by_uid, p_id, m.val, m.n);
  end if;
  -- And every blow it landed on a Warder with Thorns, answered with its share of its own attack (`warder_thorns`),
  delete from class_mark where world_id = p_world and creature_id = p_id and kind = 'thorns'
    returning * into m;
  if m.creature_id is not null and m.by_uid is not null then
    perform warder_thorns(p_world, m.by_uid, p_id, m.val);
  end if;
  -- and one it landed near a Warder with Watchful, which turns it on them (`warder_watched`).
  delete from class_mark where world_id = p_world and creature_id = p_id and kind = 'watched'
    returning * into m;
  if m.creature_id is not null and m.by_uid is not null then
    perform warder_watched(p_world, m.by_uid, p_id);
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.do_spell(p_world uuid, p_uid uuid, p_spell text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare d spell_def; p player; it item; v_force double precision; v_secs double precision;
        v_rng double precision; v_n int := 0; c creature; r record; v_name text;
        v_cx double precision; v_cy double precision; v_thick double precision; v_size double precision;
begin
  select * into d from spell_def where id = p_spell;
  select * into p from player where world_id = p_world and uid = p_uid;
  it := focus_for(p_world, p_uid, d.gem);
  v_force := spell_force(p_world, p_uid, d, it);
  -- And a hold the longer for the focus setter's Keen Focus.
  v_secs := spell_secs(p_world, p_uid, d) * mark_of(it.mark, 'force');
  v_rng := spell_range(p_world, p_uid, d);
  v_name := 'it';

  if d.school = 'kindling' then
    if d.at_what = 'creature' then
      select * into c from creature where world_id = p_world and id = (p_target->>'id')::int;
      if not found then return 'There is nothing there.'; end if;
      v_name := lower((select name from species_def where id = c.species));
      perform wound_beast(p_world, c.id, v_force, p.x, p.y, p_uid, null);
      v_n := round(v_force);
    else
      for c in select * from creature where world_id = p_world and mode = 'wild'
          and to_x between p.x - v_rng and p.x + v_rng
          and to_y between p.y - v_rng and p.y + v_rng loop
        perform wound_beast(p_world, c.id, v_force, p.x, p.y, p_uid, null);
        v_n := v_n + 1;
      end loop;
    end if;

  elsif d.school = 'binding' then
    /*
     * A hold is the `until` the clock already reads before it settles an
     * animal: set it forward and the animal is simply not due, which is what
     * standing still is here. The leg it was on is ended where it had got to,
     * so it stops rather than sliding on to wherever it was going.
     */
    if d.at_what = 'creature' then
      select * into c from creature where world_id = p_world and id = (p_target->>'id')::int;
      if not found then return 'There is nothing there.'; end if;
      v_name := lower((select name from species_def where id = c.species));
      v_cx := creature_x(c); v_cy := creature_y(c);
      update creature set until = now() + make_interval(secs => v_secs),
             from_x = v_cx, from_y = v_cy, to_x = v_cx, to_y = v_cy,
             leg_at = now(), leg_ends = now(), enemy = null, hunting = null
        where world_id = p_world and id = c.id;
      -- Marked as held, as a trade's hold is (`class_hold`), for a Binder's Shatter and Frost Ward to ask.
      insert into class_mark (world_id, creature_id, kind, val, until)
        values (p_world, c.id, 'hold', 1, now() + make_interval(secs => v_secs))
        on conflict (world_id, creature_id, kind) do update
          set val = case when class_mark.until > now() then class_mark.val else excluded.val end,
              by_uid = case when class_mark.until > now() then class_mark.by_uid end,
              until = greatest(class_mark.until, excluded.until);
      v_n := round(v_secs);
    else
      for c in select * from creature where world_id = p_world and mode = 'wild'
          and to_x between p.x - v_rng and p.x + v_rng
          and to_y between p.y - v_rng and p.y + v_rng loop
        v_cx := creature_x(c); v_cy := creature_y(c);
        update creature set until = now() + make_interval(secs => v_secs),
               from_x = v_cx, from_y = v_cy, to_x = v_cx, to_y = v_cy,
               leg_at = now(), leg_ends = now(), enemy = null, hunting = null
          where world_id = p_world and id = c.id;
        -- Marked as held, as a trade's hold is (`class_hold`), for a Binder's Shatter and Frost Ward to ask.
        insert into class_mark (world_id, creature_id, kind, val, until)
          values (p_world, c.id, 'hold', 1, now() + make_interval(secs => v_secs))
          on conflict (world_id, creature_id, kind) do update
            set val = case when class_mark.until > now() then class_mark.val else excluded.val end,
                by_uid = case when class_mark.until > now() then class_mark.by_uid end,
                until = greatest(class_mark.until, excluded.until);
        v_n := v_n + 1;
      end loop;
    end if;

  else
    -- Warding. A skin of the spell's force in hundredths of health, laid as a
    -- Warder lays one: larger for their Thick Skin, over somebody else for their
    -- Protector, and by a Thicken waiting (`warder_skin_size`), and over a skin
    -- already there only where it is the larger, or added to it for their
    -- Overcharge (`warder_skin_put`). Casting it again refreshes a skin rather
    -- than stacking one inside another.
    v_thick := warder_thicken_at(p_world, p_uid);
    perform warder_thicken_take(p_world, p_uid);
    if d.at_what = 'self' then
      v_size := warder_skin_size(p_world, p_uid, p_uid, v_force / 100, v_thick);
      perform warder_skin_put(p_world, p_uid, p_uid, v_size);
      v_n := round(v_size * 100);
    else
      for r in select uid from player where world_id = p_world and not away
          and x between p.x - v_rng and p.x + v_rng
          and y between p.y - v_rng and p.y + v_rng loop
        perform warder_skin_put(p_world, p_uid, r.uid, warder_skin_size(p_world, p_uid, r.uid, v_force / 100, v_thick));
        if r.uid <> p_uid then
          perform tell(p_world, r.uid, 'Something closes over you, put there by somebody else.', 'system');
        end if;
        v_n := v_n + 1;
      end loop;
    end if;
  end if;

  return replace(replace(d.done, '{n}', v_n::text), '{t}', v_name);
end $function$;

CREATE OR REPLACE FUNCTION public.spell_cast_refusal(p_world uuid, p_uid uuid, p_spell text)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare s spell_any; p player; v_left double precision; v_favour double precision; v_stamina double precision; v_needs text;
        v_cost double precision;
begin
  select * into s from spell_any where id = p_spell;
  if not found then return 'There is no such spell.'; end if;
  -- A patron's taken, or your fighting trade's taken while you hold the trade (`spell_known`).
  if not spell_known(p_world, p_uid, p_spell) then return 'You do not have that spell.'; end if;
  select * into p from player where world_id = p_world and uid = p_uid;
  if not found then return 'You are not on this island.'; end if;
  v_left := spell_rest_left(p.used_at, s.id, s.rest);
  if v_left > 0 then return s.name || ' can be called again in ' || ceil(v_left)::int || ' seconds.'; end if;
  if s.school = 'class' then
    -- A trade's spell is paid for in stamina, as a share of a full bar.
    v_stamina := coalesce((p.stats->>'stamina')::double precision, 1);
    -- Less for a Kindler's Deep Breath.
    v_cost := s.cost * pk(p.class_mul, 'cast:cost', 1);
    if v_stamina < v_cost then
      return s.name || ' costs ' || trim_scale(round((v_cost * 100)::numeric, 1)) || '% of your stamina; you have '
        || floor(v_stamina * 100)::int || '%.';
    end if;
    -- What it wants in your hands (`needs`): a shield in the off hand, or a weapon of a kind in the other.
    select cs.needs into v_needs from class_spell cs where cs.id = p_spell;
    if v_needs = 'shield' and not exists (select 1 from shield_def sd where sd.id = (worn(p_world, p_uid, 'offhand')).def) then
      return s.name || ' wants a shield in your off hand.';
    end if;
    if v_needs in ('axes', 'mauls') and (swung_with(p_world, p_uid)).kind is distinct from v_needs then
      return s.name || ' wants ' || case v_needs when 'axes' then 'an axe' else 'a maul' end || ' in your hand.';
    end if;
    -- And a shot a bow in your hands and an arrow to loose, as a draw does (`fight_refusal`).
    if v_needs = 'archery' then
      if not exists (select 1 from weapon_def bw where bw.id = (worn(p_world, p_uid, 'weapon')).def and bw.ammo is not null) then
        return s.name || ' wants a bow in your hands.';
      end if;
      if coalesce((select sum(pack_count(p_world, p_uid, idf.id)) from item_def idf where arrow_head_of(idf.id) is not null), 0) <= 0 then
        return 'You are out of arrows.';
      end if;
    end if;
    -- And a throw a javelin or a throwing axe in your hand; a Hit and Run one of those or a knife, which bare hands are not.
    if v_needs = 'throwing' and (swung_with(p_world, p_uid)).kind is distinct from 'throwing' then
      return s.name || ' wants a javelin or a throwing axe in your hand.';
    end if;
    if v_needs = 'skirmish' and ((swung_with(p_world, p_uid)).kind not in ('throwing', 'knives') or (swung_with(p_world, p_uid)).id = 'fist') then
      return s.name || ' wants a javelin, a throwing axe or a knife in your hand.';
    end if;
    -- And a Chirurgeon's knife work a knife, which bare hands are not.
    if v_needs = 'knives' and ((swung_with(p_world, p_uid)).kind is distinct from 'knives' or (swung_with(p_world, p_uid)).id = 'fist') then
      return s.name || ' wants a knife in your hand.';
    end if;
    -- And a Kindler's a focus of the school's stones in your pack, to cast it out of (`kindler_focus`).
    if v_needs = 'kindling' and (kindler_focus(p_world, p_uid)).id is null then
      return s.name || ' wants a garnet or ruby focus in your pack.';
    end if;
    -- And a Binder's a focus of its school's stones (`school_focus`).
    if v_needs = 'binding' and (school_focus(p_world, p_uid, 'binding')).id is null then
      return s.name || ' wants a sapphire or diamond focus in your pack.';
    end if;
    -- And a Warder's the same of its own.
    if v_needs = 'warding' and (school_focus(p_world, p_uid, 'warding')).id is null then
      return s.name || ' wants a topaz or emerald focus in your pack.';
    end if;
    -- And a Beastmaster's a companion following you, fit to be told (`class_companion`).
    if v_needs = 'companion' and (class_companion(p_world, p_uid)).id is null then
      return s.name || ' wants a companion following you.';
    end if;
    -- And one paid for in your own health is refused when it would take the last of it.
    if s.fx ? 'health' and coalesce((p.stats->>'health')::double precision, 1) <= (s.fx->>'health')::double precision then
      return s.name || ' costs ' || round((s.fx->>'health')::double precision * 100)::int || '% of your health; you have '
        || floor(coalesce((p.stats->>'health')::double precision, 1) * 100)::int || '%.';
    end if;
    if s.fx ? 'below' and coalesce((p.stats->>'health')::double precision, 1) >= (s.fx->>'below')::double precision then
      return s.name || ' is only for below ' || round((s.fx->>'below')::double precision * 100)::int || '% of your health.';
    end if;
    return null;
  end if;
  v_favour := favour_settle(p_world, p_uid);
  if v_favour < s.cost then
    return s.name || ' costs ' || s.cost::int || ' favour; you hold ' || floor(v_favour)::int || '. Pray at an altar.';
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.class_spell_cast(p_world uuid, p_uid uuid, p_spell text, p_target jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare s class_spell; me player; c creature; d species_def; b jsonb; v_said text; v_id int; r record;
        v_dist double precision; v_reach double precision; v_x double precision; v_y double precision;
        v_n int := 0; v_put jsonb; v_windup boolean; v_more double precision; v_h double precision;
        v_dead int := 0; v_held int := 0; v_i int; v_part text; v_on jsonb; v_pace jsonb;
        v_why text; v_uid uuid; v_who text; v_whose text; v_hp double precision;
        k creature; v_top double precision;
        v_fire double precision := 0; v_fired boolean := false; v_burn class_mark; v_burnt jsonb;
        v_was double precision; v_base double precision; v_self double precision; v_other double precision;
        v_mine boolean := false; v_hunted boolean := false;
begin
  select * into s from class_spell where id = p_spell;
  if not found then return jsonb_build_object('why', 'There is no such spell.'); end if;
  select * into me from player where world_id = p_world and uid = p_uid;
  if p_target->>'kind' = 'enemy' then
    v_id := (p_target->>'id')::int;
    perform creature_settle(p_world, v_id);
    select * into c from creature where world_id = p_world and id = v_id and health > 0;
    if not found then return jsonb_build_object('why', 'That is not here.'); end if;
    select * into d from species_def where id = c.species;
    v_dist := sqrt((creature_x(c) - me.x) ^ 2 + (creature_y(c) - me.y) ^ 2);
    -- A blow wants it within reach of what is in your hand; a Lunge within its stride; a Challenge as far as any spell;
    -- an Overreach its share past your reach, and a Hook as far as it says.
    v_reach := case when p_spell = 'blade_lunge' then spell_fx(p_spell, 'reach')
                    when p_spell = 'blade_challenge' then spell_reach()
                    when p_spell = 'pikeman_overreach' then melee_reach(p_world, p_uid) + spell_fx(p_spell, 'past')
                    when p_spell = 'pikeman_hook' then spell_fx(p_spell, 'reach')
                    -- A Point Blank close in, an Expose as far as any spell, and every other shot as far as the bow in your hands
                    -- reaches (`bow_range`), a Long Shot its share further.
                    when p_spell = 'archer_point_blank' then spell_fx(p_spell, 'reach')
                    when p_spell = 'archer_expose' then spell_reach()
                    -- A Long Throw its share past your reach, and a Marked for Death as far as any spell.
                    when p_spell = 'skirmisher_long_throw' then melee_reach(p_world, p_uid) + spell_fx(p_spell, 'past')
                    when p_spell = 'skirmisher_marked_for_death' then spell_reach()
                    -- A Toxin as far as it says.
                    when p_spell = 'chirurgeon_toxin' then spell_fx(p_spell, 'reach')
                    -- A Beastmaster's companion strikes from its own reach of it, which its arm asks: you as far as any spell;
                    -- and a Call of the Wild as far as it says.
                    when p_spell = 'beastmaster_call_of_the_wild' then spell_fx(p_spell, 'reach')
                    when s.class = 'beastmaster' then spell_reach()
                    -- A Kindler's as far as each says.
                    when s.class = 'kindler' then spell_fx(p_spell, 'reach')
                    -- A Binder's as far as each says, further for Far Reach, and further again in a Long Hold.
                    when s.class = 'binder' then (spell_fx(p_spell, 'reach') + pk(me.class_mul, 'reach:spell', 0))
                                                 * class_mul(me.class_mul, 'reach', 'binding')
                    when s.needs = 'archery' then held_bow_range(p_world, p_uid)
                                                  * case when p_spell = 'archer_long_shot' then spell_fx(p_spell, 'range') else 1 end
                    else melee_reach(p_world, p_uid) end;
    if v_dist > v_reach then
      return jsonb_build_object('why', 'The ' || lower(d.name) || ' is more than ' || trim_scale(round(v_reach::numeric, 1)) || ' tiles away.');
    end if;
    -- And a shot no nearer than a draw can be made (`draw_nearest`), but for a Point Blank.
    if s.needs = 'archery' and p_spell <> 'archer_point_blank' and v_dist < draw_nearest(p_world, p_uid) then
      return jsonb_build_object('why', 'The ' || lower(d.name) || ' is too close to draw on.');
    end if;
  end if;

  case p_spell
  when 'blade_measured_cut' then
    b := class_blow(p_world, p_uid, c.id, spell_fx(p_spell, 'more'), true);
    v_said := class_blow_said(s.name, b);

  when 'blade_challenge' then
    if coalesce(d.timid, false) then return jsonb_build_object('why', 'The ' || lower(d.name) || ' will not fight anybody.'); end if;
    update creature set hunting = p_uid, brawl = null, windup_at = null, hunt_again = null,
        hunt_x = creature_x(c), hunt_y = creature_y(c),
        threat_at = now() + make_interval(secs => spell_fx(p_spell, 'secs') - threat_hold())
      where world_id = p_world and id = c.id;
    v_said := s.name || ': the ' || lower(d.name) || ' turns on you, and hunts only you for ' || faith_span(spell_fx(p_spell, 'secs')) || '.';

  when 'blade_lunge' then
    if me.aboard is not null or (driving(p_world, p_uid)).id is not null then
      return jsonb_build_object('why', 'You cannot lunge from where you sit.');
    end if;
    v_reach := melee_reach(p_world, p_uid);
    if v_dist > v_reach then
      -- To a pace inside your reach of it, over ground you could walk there (`walk_share`, as `rpc_move` asks).
      v_x := creature_x(c) - (creature_x(c) - me.x) / v_dist * (v_reach - 0.4);
      v_y := creature_y(c) - (creature_y(c) - me.y) / v_dist * (v_reach - 0.4);
      if walk_share(p_world, p_uid, coalesce(me.level, 0), me.x, me.y, v_x, v_y) < 0.999 then
        return jsonb_build_object('why', 'Something stands between you and the ' || lower(d.name) || '.');
      end if;
      update player set x = v_x, y = v_y, moved_at = now() where world_id = p_world and uid = p_uid;
      perform drag_along(p_world, p_uid, v_x, v_y);
      v_put := jsonb_build_object('x', v_x, 'y', v_y, 'level', coalesce(me.level, 0));
    end if;
    b := class_blow(p_world, p_uid, c.id, spell_fx(p_spell, 'more'));
    v_said := class_blow_said(s.name, b);

  when 'blade_hamstring' then
    b := class_blow(p_world, p_uid, c.id, spell_fx(p_spell, 'more'));
    if (b->>'landed')::boolean and not (b->>'died')::boolean then
      update creature set slow = spell_fx(p_spell, 'pace'), slow_until = now() + make_interval(secs => spell_fx(p_spell, 'secs'))
        where world_id = p_world and id = c.id;
      v_said := class_blow_said(s.name, b) || ' For ' || faith_span(spell_fx(p_spell, 'secs')) || ' it goes at '
        || faith_pct(spell_fx(p_spell, 'pace')) || ' of its pace.';
    else
      v_said := class_blow_said(s.name, b);
    end if;

  when 'blade_shield_bash' then
    v_windup := c.windup_at is not null;
    b := class_blow(p_world, p_uid, c.id, spell_fx(p_spell, 'more'), false, 'crush');
    v_said := class_blow_said(s.name, b);
    if (b->>'landed')::boolean and not (b->>'died')::boolean then
      update creature set windup_at = null, until = greatest(until, now()) + make_interval(secs => spell_fx(p_spell, 'back'))
        where world_id = p_world and id = c.id;
      v_said := v_said || case when v_windup then ' It is knocked off its stroke, and' else ' Its' end
        || case when v_windup then ' its' else '' end || ' next blow is put back ' || faith_span(spell_fx(p_spell, 'back')) || '.';
    end if;

  when 'blade_second_breath' then
    update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}',
        to_jsonb(least(1, coalesce((stats->>'stamina')::double precision, 1) + spell_fx(p_spell, 'stamina'))))
      where world_id = p_world and uid = p_uid;
    v_said := s.name || ': ' || faith_pct(spell_fx(p_spell, 'stamina')) || ' of your stamina comes back at once.';

  when 'blade_deflect' then
    perform blessing_put(p_world, p_uid, 'deflect', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'share', spell_fx(p_spell, 'share')));
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' every blow you block lands back at '
      || faith_pct(spell_fx(p_spell, 'share')) || ' of itself.';

  when 'blade_hold_the_line' then
    perform blessing_put(p_world, p_uid, 'hold_line', jsonb_build_object('from', now(),
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'bleed', spell_fx(p_spell, 'bleed')));
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' your wounds bleed '
      || faith_pct(1 - spell_fx(p_spell, 'bleed')) || ' less and those on your arms do not slow your swing.';

  when 'blade_disarming_cut' then
    b := class_blow(p_world, p_uid, c.id, spell_fx(p_spell, 'more'));
    v_said := class_blow_said(s.name, b);
    if (b->>'landed')::boolean and not (b->>'died')::boolean then
      insert into class_mark (world_id, creature_id, kind, val, n, until, by_uid)
        values (p_world, c.id, 'disarm', spell_fx(p_spell, 'cut'), spell_fx(p_spell, 'blows')::int,
                now() + make_interval(secs => spell_fx(p_spell, 'secs')), p_uid)
        on conflict (world_id, creature_id, kind) do update set val = excluded.val, n = excluded.n, until = excluded.until, by_uid = excluded.by_uid;
      v_said := v_said || ' Its next ' || spell_fx(p_spell, 'blows')::int || ' blows do ' || faith_pct(spell_fx(p_spell, 'cut')) || ' less.';
    end if;

  when 'blade_measured_breathing' then
    perform blessing_put(p_world, p_uid, 'breathing', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs'))));
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' a swing or a draw costs you no stamina.';

  when 'blade_guardians_call' then
    for r in
      select cr.id, cr.species from creature cr join species_def sd on sd.id = cr.species
       where cr.world_id = p_world and cr.mode = 'wild' and cr.health > 0
         and (cr.hunting is not null or cr.brawl is not null) and not coalesce(sd.timid, false)
         and (creature_x(cr) - me.x) ^ 2 + (creature_y(cr) - me.y) ^ 2 <= spell_fx(p_spell, 'reach') ^ 2
    loop
      perform creature_settle(p_world, r.id);
      update creature set hunting = p_uid, brawl = null, windup_at = null, hunt_again = null,
          hunt_x = creature_x(creature), hunt_y = creature_y(creature),
          threat_at = now() + make_interval(secs => spell_fx(p_spell, 'secs') - threat_hold())
        where world_id = p_world and id = r.id;
      v_n := v_n + 1;
    end loop;
    if v_n = 0 then
      return jsonb_build_object('why', 'Nothing within ' || spell_fx(p_spell, 'reach')::int || ' tiles of you is hunting anybody.');
    end if;
    v_said := s.name || ': ' || v_n || case when v_n = 1 then ' creature turns' else ' creatures turn' end
      || ' on you, and hunt' || case when v_n = 1 then 's' else '' end || ' only you for ' || faith_span(spell_fx(p_spell, 'secs')) || '.';

  when 'blade_last_stand' then
    perform blessing_put(p_world, p_uid, 'last_stand', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'cut', spell_fx(p_spell, 'cut')));
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' you take ' || faith_pct(spell_fx(p_spell, 'cut')) || ' less damage.';

  when 'berserker_wild_swing' then
    b := class_blow(p_world, p_uid, c.id, spell_fx(p_spell, 'more'), false, null, spell_fx(p_spell, 'miss'));
    v_said := class_blow_said(s.name, b);

  when 'berserker_shrug_it_off' then
    -- The worst wound you carry, by how deep it is: its share as deep, and bleeding no more.
    select (e.i - 1)::int, e.w->>'part' into v_i, v_part
      from jsonb_array_elements(coalesce(me.wounds, '[]'::jsonb)) with ordinality e(w, i)
     order by (e.w->>'severity')::double precision desc nulls last limit 1;
    if v_i is null then return jsonb_build_object('why', 'You have no wound to shrug off.'); end if;
    update player set wounds = jsonb_set(jsonb_set(wounds, array[v_i::text, 'severity'],
          to_jsonb((wounds->v_i->>'severity')::double precision * spell_fx(p_spell, 'severity'))),
          array[v_i::text, 'bleeding'], 'false'::jsonb)
      where world_id = p_world and uid = p_uid;
    v_said := s.name || ': the worst of your wounds, on your ' || part_name(v_part) || ', is '
      || faith_pct(1 - spell_fx(p_spell, 'severity')) || ' less severe and stops bleeding.';

  when 'berserker_rending_chop' then
    b := class_blow(p_world, p_uid, c.id, spell_fx(p_spell, 'more'));
    v_said := class_blow_said(s.name, b);
    -- And it bleeds as a knife leaves it (`side_blow`).
    if (b->>'landed')::boolean and not (b->>'died')::boolean then
      perform side_blow(p_world, p_uid, c.id, 'knives', (b->>'dmg')::double precision);
      v_said := v_said || ' It bleeds ' || faith_pct(knife_bleed()) || ' of the blow a second for ' || faith_span(knife_bleed_secs()) || '.';
    end if;

  when 'berserker_skull_crack' then
    b := class_blow(p_world, p_uid, c.id, spell_fx(p_spell, 'more'));
    v_said := class_blow_said(s.name, b);
    if (b->>'landed')::boolean and not (b->>'died')::boolean then
      v_h := spell_fx(p_spell, 'hold') * case when coalesce(d.monster, false) then spell_fx(p_spell, 'monster') else 1 end;
      perform class_hold(p_world, c.id, v_h);
      v_said := v_said || ' It is held where it stands for ' || faith_span(v_h) || '.';
    end if;

  when 'berserker_battle_rage' then
    perform blessing_put(p_world, p_uid, 'battle_rage', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')),
      'dealt', spell_fx(p_spell, 'dealt'), 'taken', spell_fx(p_spell, 'taken')));
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' you deal ' || faith_pct(spell_fx(p_spell, 'dealt') - 1)
      || ' more damage and take ' || faith_pct(spell_fx(p_spell, 'taken') - 1) || ' more.';

  when 'berserker_adrenaline' then
    perform blessing_put(p_world, p_uid, 'adrenaline', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'time', spell_fx(p_spell, 'time')));
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' a swing or a draw costs no stamina and takes '
      || faith_pct(1 - spell_fx(p_spell, 'time')) || ' less time.';

  when 'berserker_blood_price' then
    -- Paid in your own health before the blow, whether it lands or not; `spell_cast_refusal` keeps it from being the last of it.
    update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{health}',
        to_jsonb(coalesce((stats->>'health')::double precision, 1) - spell_fx(p_spell, 'health')))
      where world_id = p_world and uid = p_uid;
    b := class_blow(p_world, p_uid, c.id, spell_fx(p_spell, 'more'));
    v_said := class_blow_said(s.name, b) || ' It costs you ' || faith_pct(spell_fx(p_spell, 'health')) || ' of your health.';

  when 'berserker_execute' then
    -- Its full share on a creature below its line, and the rest of the time a plain blow.
    v_more := case when c.health < max_health(c) * spell_fx(p_spell, 'low') then spell_fx(p_spell, 'more') else spell_fx(p_spell, 'whole') end;
    b := class_blow(p_world, p_uid, c.id, v_more);
    v_said := class_blow_said(s.name, b);

  when 'berserker_overhead_smash' then
    b := class_blow(p_world, p_uid, c.id, spell_fx(p_spell, 'more'), true, 'crush');
    v_said := class_blow_said(s.name, b);
    -- And the wind-up is paid after: your own next swing, if you are swinging, comes that much later.
    update player set act_ends = act_ends + make_interval(secs => spell_fx(p_spell, 'wind'))
      where world_id = p_world and uid = p_uid and is_fight(act) and act_ends is not null;
    if found then v_said := v_said || ' Your next swing comes ' || faith_span(spell_fx(p_spell, 'wind')) || ' later.'; end if;

  when 'berserker_whirlwind' then
    -- Every wild thing within its reach, nearest first, its blows each until one kills it.
    for r in
      select cr.id from creature cr
       where cr.world_id = p_world and cr.mode = 'wild' and cr.health > 0
         and (creature_x(cr) - me.x) ^ 2 + (creature_y(cr) - me.y) ^ 2 <= spell_fx(p_spell, 'reach') ^ 2
       order by (creature_x(cr) - me.x) ^ 2 + (creature_y(cr) - me.y) ^ 2, cr.id
    loop
      perform creature_settle(p_world, r.id);
      v_n := v_n + 1;
      for v_go in 1 .. spell_fx(p_spell, 'blows')::int loop
        b := class_blow(p_world, p_uid, r.id, spell_fx(p_spell, 'more'));
        if (b->>'died')::boolean then v_dead := v_dead + 1; exit; end if;
      end loop;
    end loop;
    if v_n = 0 then
      return jsonb_build_object('why', 'Nothing is within ' || spell_fx(p_spell, 'reach')::int || ' tiles of you to strike.');
    end if;
    b := null;
    v_said := s.name || ': you strike at ' || v_n || case when v_n = 1 then ' creature' else ' creatures' end
      || case when v_dead > 0 then ', and ' || v_dead || case when v_dead = 1 then ' dies' else ' die' end else '' end || '.';

  when 'berserker_earthshaker' then
    -- Every wild thing within its reach takes the blow, and each one it leaves standing is held.
    for r in
      select cr.id from creature cr
       where cr.world_id = p_world and cr.mode = 'wild' and cr.health > 0
         and (creature_x(cr) - me.x) ^ 2 + (creature_y(cr) - me.y) ^ 2 <= spell_fx(p_spell, 'reach') ^ 2
       order by (creature_x(cr) - me.x) ^ 2 + (creature_y(cr) - me.y) ^ 2, cr.id
    loop
      perform creature_settle(p_world, r.id);
      v_n := v_n + 1;
      b := class_blow(p_world, p_uid, r.id, spell_fx(p_spell, 'more'));
      if (b->>'died')::boolean then v_dead := v_dead + 1;
      elsif (b->>'landed')::boolean then
        perform class_hold(p_world, r.id, spell_fx(p_spell, 'hold'));
        v_held := v_held + 1;
      end if;
    end loop;
    if v_n = 0 then
      return jsonb_build_object('why', 'Nothing is within ' || spell_fx(p_spell, 'reach')::int || ' tiles of you to strike.');
    end if;
    b := null;
    v_said := s.name || ': you strike at ' || v_n || case when v_n = 1 then ' creature' else ' creatures' end
      || '; ' || v_held || ' held where ' || case when v_held = 1 then 'it stands' else 'they stand' end
      || ' for ' || faith_span(spell_fx(p_spell, 'hold'))
      || case when v_dead > 0 then ', and ' || v_dead || case when v_dead = 1 then ' dies' else ' die' end else '' end || '.';

  when 'berserker_last_rage' then
    perform blessing_put(p_world, p_uid, 'last_rage', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs'))));
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' every blow you land is critical.';

  when 'pikeman_warning_thrust' then
    -- Not on one already on you, nor on one that never goes looking for a fight (`hunt_settle` asks the mark).
    if c.hunting is not distinct from p_uid then
      return jsonb_build_object('why', 'The ' || lower(d.name) || ' is already fighting you.');
    end if;
    if not coalesce(d.hunter, false) then
      return jsonb_build_object('why', 'The ' || lower(d.name) || ' never comes for anybody unless it is struck.');
    end if;
    insert into class_mark (world_id, creature_id, kind, val, n, until, by_uid)
      values (p_world, c.id, 'warned', 1, 0, now() + make_interval(secs => spell_fx(p_spell, 'secs')), p_uid)
      on conflict (world_id, creature_id, kind) do update set val = excluded.val, n = excluded.n, until = excluded.until, by_uid = excluded.by_uid;
    v_said := s.name || ': the ' || lower(d.name) || ' will not come for you for ' || faith_span(spell_fx(p_spell, 'secs'))
      || ', alone or with its pack, unless you strike it.';

  when 'pikeman_overreach' then
    b := class_blow(p_world, p_uid, c.id, spell_fx(p_spell, 'more'));
    v_said := class_blow_said(s.name, b);
    -- And the reach is paid for after: your own next swing, if you are swinging, comes that much later.
    update player set act_ends = act_ends + make_interval(secs => spell_fx(p_spell, 'wind'))
      where world_id = p_world and uid = p_uid and is_fight(act) and act_ends is not null;
    if found then v_said := v_said || ' Your next swing comes ' || faith_span(spell_fx(p_spell, 'wind')) || ' later.'; end if;

  when 'pikeman_sweep_the_legs' then
    b := class_blow(p_world, p_uid, c.id, spell_fx(p_spell, 'more'));
    if (b->>'landed')::boolean and not (b->>'died')::boolean then
      update creature set slow = spell_fx(p_spell, 'pace'), slow_until = now() + make_interval(secs => spell_fx(p_spell, 'secs'))
        where world_id = p_world and id = c.id;
      v_said := class_blow_said(s.name, b) || ' For ' || faith_span(spell_fx(p_spell, 'secs')) || ' it goes at '
        || faith_pct(spell_fx(p_spell, 'pace')) || ' of its pace.';
    else
      v_said := class_blow_said(s.name, b);
    end if;

  when 'pikeman_vital_thrust' then
    b := class_blow(p_world, p_uid, c.id, spell_fx(p_spell, 'more'), false, null, 1, spell_fx(p_spell, 'crit'));
    v_said := class_blow_said(s.name, b);

  when 'pikeman_hook' then
    -- Dragged its share nearer and no nearer than its least, over ground it could walk (`class_shove`), and on you as if struck.
    if v_dist <= spell_fx(p_spell, 'least') + 0.05 then
      return jsonb_build_object('why', 'The ' || lower(d.name) || ' is already at your feet.');
    end if;
    if not exists (select 1 from shove_point(p_world, creature_x(c), creature_y(c), me.x, me.y,
                     -spell_fx(p_spell, 'pull'), spell_fx(p_spell, 'least'))) then
      return jsonb_build_object('why', 'The ' || lower(d.name) || ' cannot be dragged: there is no ground it could walk between you.');
    end if;
    perform engage_beast(p_world, c.id, p_uid);
    v_h := class_shove(p_world, c.id, me.x, me.y, -spell_fx(p_spell, 'pull'), spell_fx(p_spell, 'least'));
    v_said := s.name || ': you drag the ' || lower(d.name) || ' ' || trim_scale(round(v_h::numeric, 1))
      || case when round(v_h::numeric, 1) = 1 then ' tile' else ' tiles' end || ' towards you.';

  when 'pikeman_rally_the_line' then
    -- Everybody on their feet within its reach, you among them; the door takes its stamina after.
    for r in
      select pl.uid from player pl
       where pl.world_id = p_world and not coalesce(pl.away, false) and coalesce((pl.stats->>'health')::double precision, 1) > 0
         and (pl.x - me.x) ^ 2 + (pl.y - me.y) ^ 2 <= spell_fx(p_spell, 'reach') ^ 2
    loop
      update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}',
          to_jsonb(least(1, coalesce((stats->>'stamina')::double precision, 1) + spell_fx(p_spell, 'stamina'))))
        where world_id = p_world and uid = r.uid;
      if r.uid <> p_uid then
        perform tell(p_world, r.uid, coalesce(me.name, 'Somebody') || '’s ' || s.name || ' gives you back '
          || faith_pct(spell_fx(p_spell, 'stamina')) || ' of your stamina.', 'fight');
        v_n := v_n + 1;
      end if;
    end loop;
    v_said := s.name || ': ' || faith_pct(spell_fx(p_spell, 'stamina')) || ' of a full bar of stamina back for you'
      || case when v_n = 0 then '' else ' and ' || v_n || case when v_n = 1 then ' other' else ' others' end end || '.';

  when 'pikeman_twin_thrust' then
    -- Its blows one after the other, until one kills it.
    for v_go in 1 .. spell_fx(p_spell, 'blows')::int loop
      b := class_blow(p_world, p_uid, c.id, spell_fx(p_spell, 'more'));
      v_held := v_held + 1;
      if (b->>'landed')::boolean then v_n := v_n + 1; end if;
      exit when (b->>'died')::boolean;
    end loop;
    v_said := s.name || ': ' || v_n || ' of ' || v_held || ' blows land'
      || case when (b->>'died')::boolean then ', and the ' || (b->>'name') || ' dies.'
              else '. The ' || (b->>'name') || ' is down to ' || (b->>'left') || ' of ' || (b->>'of') || '.' end;

  when 'pikeman_reach_advantage' then
    -- Its full share on a creature not yet within its own reach of you (`beast_reach`), and a plain blow on one that is.
    v_more := case when v_dist > beast_reach(d) then spell_fx(p_spell, 'more') else spell_fx(p_spell, 'whole') end;
    b := class_blow(p_world, p_uid, c.id, v_more);
    v_said := class_blow_said(s.name, b);

  when 'pikeman_skewer' then
    b := class_blow(p_world, p_uid, c.id, spell_fx(p_spell, 'more'));
    v_said := class_blow_said(s.name, b);
    -- And through: every enemy up to `behind` tiles behind it, within `width` of the line of the thrust, at its own share.
    v_x := (creature_x(c) - me.x) / greatest(v_dist, 0.001); v_y := (creature_y(c) - me.y) / greatest(v_dist, 0.001);
    for r in
      select cr.id from creature cr
       where cr.world_id = p_world and cr.mode = 'wild' and cr.health > 0 and cr.id <> c.id
         and (creature_x(cr) - creature_x(c)) * v_x + (creature_y(cr) - creature_y(c)) * v_y > 0
         and (creature_x(cr) - creature_x(c)) * v_x + (creature_y(cr) - creature_y(c)) * v_y <= spell_fx(p_spell, 'behind')
         and abs((creature_x(cr) - creature_x(c)) * v_y - (creature_y(cr) - creature_y(c)) * v_x) <= spell_fx(p_spell, 'width')
       order by (creature_x(cr) - creature_x(c)) * v_x + (creature_y(cr) - creature_y(c)) * v_y, cr.id
    loop
      perform creature_settle(p_world, r.id);
      v_n := v_n + 1;
      if (class_blow(p_world, p_uid, r.id, spell_fx(p_spell, 'through'))->>'died')::boolean then v_dead := v_dead + 1; end if;
    end loop;
    if v_n > 0 then
      v_said := v_said || ' It goes through into ' || v_n || ' more behind'
        || case when v_dead > 0 then ', and ' || v_dead || case when v_dead = 1 then ' dies' else ' die' end else '' end || '.';
    end if;

  when 'pikeman_keep_away' then
    perform blessing_put(p_world, p_uid, 'keep_away', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'push', spell_fx(p_spell, 'push')));
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' every blow you land pushes what it lands on '
      || trim_scale(spell_fx(p_spell, 'push')::numeric) || case when spell_fx(p_spell, 'push') = 1 then ' tile' else ' tiles' end
      || ' further from you.';

  when 'pikeman_fend_off' then
    perform blessing_put(p_world, p_uid, 'fend_off', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'push', spell_fx(p_spell, 'push')));
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' anything that comes within '
      || trim_scale(hunt_reach()::numeric) || ' tiles of you to strike is pushed ' || trim_scale(spell_fx(p_spell, 'push')::numeric)
      || ' tiles back instead.';

  when 'pikeman_brace_for_the_charge' then
    perform blessing_put(p_world, p_uid, 'brace', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs'))));
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' the first creature that comes at you from outside your reach '
      || 'is met at the edge of it by a blow at ' || faith_pct(spell_fx(p_spell, 'more')) || '.';

  when 'archer_quick_shot' then
    b := class_shot(p_world, p_uid, c.id, spell_fx(p_spell, 'more'), false, 1, false, p_target->>'arrow');
    v_said := class_shot_said(s.name, b);
    -- And your own next draw, if you are drawing, comes that much sooner.
    update player set act_ends = greatest(now(), act_ends - make_interval(secs => spell_fx(p_spell, 'sooner')))
      where world_id = p_world and uid = p_uid and act = 'shoot_creature' and act_ends is not null;
    if found then v_said := v_said || ' Your next draw comes ' || faith_span(spell_fx(p_spell, 'sooner')) || ' sooner.'; end if;

  when 'archer_aimed_shot' then
    b := class_shot(p_world, p_uid, c.id, spell_fx(p_spell, 'more'), true, 1, false, p_target->>'arrow');
    v_said := class_shot_said(s.name, b);

  when 'archer_read_the_wind' then
    perform blessing_put(p_world, p_uid, 'read_wind', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'crit', spell_fx(p_spell, 'crit')));
    v_said := s.name || ': your next shot within ' || faith_span(spell_fx(p_spell, 'secs')) || ' cannot miss, and is critical '
      || case when spell_fx(p_spell, 'crit') = 2 then 'twice' else trim_scale(spell_fx(p_spell, 'crit')::numeric) || ' times' end
      || ' as often.';

  when 'archer_long_shot' then
    b := class_shot(p_world, p_uid, c.id, spell_fx(p_spell, 'more'), false, 1, true, p_target->>'arrow');
    v_said := class_shot_said(s.name, b);

  when 'archer_crippling_shot' then
    b := class_shot(p_world, p_uid, c.id, spell_fx(p_spell, 'more'), false, 1, false, p_target->>'arrow');
    v_said := class_shot_said(s.name, b);
    if (b->>'landed')::boolean and not (b->>'died')::boolean then
      update creature set slow = spell_fx(p_spell, 'pace'), slow_until = now() + make_interval(secs => spell_fx(p_spell, 'secs'))
        where world_id = p_world and id = c.id;
      v_said := v_said || ' For ' || faith_span(spell_fx(p_spell, 'secs')) || ' it goes at '
        || faith_pct(spell_fx(p_spell, 'pace')) || ' of its pace.';
    end if;

  when 'archer_point_blank' then
    b := class_shot(p_world, p_uid, c.id, spell_fx(p_spell, 'more'), false, 1, false, p_target->>'arrow');
    v_said := class_shot_said(s.name, b);

  when 'archer_twin_arrows' then
    -- Its arrows all at once, and every one of them in your pack first.
    if coalesce((select sum(pack_count(p_world, p_uid, idf.id)) from item_def idf where arrow_head_of(idf.id) is not null), 0)
       < spell_fx(p_spell, 'arrows') then
      return jsonb_build_object('why', s.name || ' wants ' || spell_fx(p_spell, 'arrows')::int || ' arrows in your pack.');
    end if;
    for v_go in 1 .. spell_fx(p_spell, 'arrows')::int loop
      b := class_shot(p_world, p_uid, c.id, spell_fx(p_spell, 'more'), false, 1, false, p_target->>'arrow');
      v_held := v_held + 1;
      if (b->>'landed')::boolean then v_n := v_n + 1; end if;
      exit when (b->>'died')::boolean;
    end loop;
    v_said := s.name || ': ' || v_n || ' of ' || v_held || ' arrows land'
      || case when (b->>'died')::boolean then ', and the ' || (b->>'name') || ' dies.'
              else '. The ' || (b->>'name') || ' is down to ' || (b->>'left') || ' of ' || (b->>'of') || '.' end;

  when 'archer_pinning_shot' then
    b := class_shot(p_world, p_uid, c.id, spell_fx(p_spell, 'more'), false, 1, false, p_target->>'arrow');
    v_said := class_shot_said(s.name, b);
    if (b->>'landed')::boolean and not (b->>'died')::boolean then
      v_h := spell_fx(p_spell, 'hold') * case when coalesce(d.monster, false) then spell_fx(p_spell, 'monster') else 1 end;
      perform class_hold(p_world, c.id, v_h);
      v_said := v_said || ' It is held where it stands for ' || faith_span(v_h) || '.';
    end if;

  when 'archer_expose' then
    -- On the creature, for every blow and shot anybody lands on it while it holds (`class_dealt`).
    insert into class_mark (world_id, creature_id, kind, val, n, until, by_uid)
      values (p_world, c.id, 'exposed', spell_fx(p_spell, 'more'), 0, now() + make_interval(secs => spell_fx(p_spell, 'secs')), p_uid)
      on conflict (world_id, creature_id, kind) do update set val = excluded.val, n = excluded.n, until = excluded.until, by_uid = excluded.by_uid;
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' every blow and shot that lands on the ' || lower(d.name)
      || ' does ' || faith_pct(spell_fx(p_spell, 'more') - 1) || ' more.';

  when 'archer_decoy' then
    perform blessing_put(p_world, p_uid, 'decoy', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs'))));
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' everything that strikes at you strikes a decoy at your feet instead.';

  when 'archer_snipe' then
    -- Only on one that is not after anybody yet: not hunting, not in a brawl.
    if c.hunting is not null or c.brawl is not null then
      return jsonb_build_object('why', 'The ' || lower(d.name) || ' is already after somebody.');
    end if;
    b := class_shot(p_world, p_uid, c.id, spell_fx(p_spell, 'more'), false, 1, false, p_target->>'arrow');
    v_said := class_shot_said(s.name, b);

  when 'archer_deadeye' then
    perform blessing_put(p_world, p_uid, 'deadeye', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'time', spell_fx(p_spell, 'time')));
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' a draw takes '
      || faith_pct(1 - spell_fx(p_spell, 'time')) || ' less time.';

  when 'skirmisher_snap_throw' then
    b := class_blow(p_world, p_uid, c.id, spell_fx(p_spell, 'more'));
    v_said := class_blow_said(s.name, b);
    -- And your own next swing, if you are swinging, comes that much sooner.
    update player set act_ends = greatest(now(), act_ends - make_interval(secs => spell_fx(p_spell, 'sooner')))
      where world_id = p_world and uid = p_uid and act = 'attack_creature' and act_ends is not null;
    if found then v_said := v_said || ' Your next swing comes ' || faith_span(spell_fx(p_spell, 'sooner')) || ' sooner.'; end if;

  when 'skirmisher_long_throw' then
    b := class_blow(p_world, p_uid, c.id, spell_fx(p_spell, 'more'));
    v_said := class_blow_said(s.name, b);

  when 'skirmisher_hit_and_run' then
    b := class_blow(p_world, p_uid, c.id, spell_fx(p_spell, 'more'));
    -- And a quicker walk on foot while it holds (`travel_speed`), which the browser walks at too.
    perform blessing_put(p_world, p_uid, 'hit_and_run', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'pace', spell_fx(p_spell, 'pace')));
    v_pace := jsonb_build_object('mul', spell_fx(p_spell, 'pace'), 'secs', spell_fx(p_spell, 'secs'));
    v_said := class_blow_said(s.name, b) || ' For ' || faith_span(spell_fx(p_spell, 'secs')) || ' you walk '
      || faith_pct(spell_fx(p_spell, 'pace') - 1) || ' faster.';

  when 'skirmisher_heavy_throw' then
    b := class_blow(p_world, p_uid, c.id, spell_fx(p_spell, 'more'));
    v_said := class_blow_said(s.name, b);
    -- And what a maul does besides (`side_blow`): a heavy blow knocked off its stroke, and its next blow put back.
    if (b->>'landed')::boolean and not (b->>'died')::boolean then
      perform side_blow(p_world, p_uid, c.id, 'mauls', (b->>'dmg')::double precision);
      v_said := v_said || ' Its next blow is put back ' || faith_span(stagger_maul()) || '.';
    end if;

  when 'skirmisher_gut_throw' then
    b := class_blow(p_world, p_uid, c.id, spell_fx(p_spell, 'more'));
    v_said := class_blow_said(s.name, b);
    -- And what a knife does besides (`side_blow`): it bleeds.
    if (b->>'landed')::boolean and not (b->>'died')::boolean then
      perform side_blow(p_world, p_uid, c.id, 'knives', (b->>'dmg')::double precision);
      v_said := v_said || ' It bleeds for ' || faith_span(knife_bleed_secs() * pk(p_world, p_uid, 'bleed:secs', 1)) || '.';
    end if;

  when 'skirmisher_parting_throw' then
    if me.aboard is not null or (driving(p_world, p_uid)).id is not null then
      return jsonb_build_object('why', 'You cannot leap from where you sit.');
    end if;
    b := class_blow(p_world, p_uid, c.id, spell_fx(p_spell, 'more'));
    v_said := class_blow_said(s.name, b);
    -- Straight back from it, as far as ground you could walk lets you (`class_leap`).
    v_put := class_leap(p_world, p_uid, creature_x(c), creature_y(c), spell_fx(p_spell, 'leap'));
    v_said := v_said || case when v_put is null then ' There is no room behind you to leap.'
                             else ' You leap ' || trim_scale(round((v_put->>'by')::numeric, 2)) || ' tiles back.' end;

  when 'skirmisher_double_throw' then
    -- Its throws one after the other, until one kills it.
    for v_go in 1 .. spell_fx(p_spell, 'throws')::int loop
      b := class_blow(p_world, p_uid, c.id, spell_fx(p_spell, 'more'));
      v_held := v_held + 1;
      if (b->>'landed')::boolean then v_n := v_n + 1; end if;
      exit when (b->>'died')::boolean;
    end loop;
    v_said := s.name || ': ' || v_n || ' of ' || v_held || ' throws land'
      || case when (b->>'died')::boolean then ', and the ' || (b->>'name') || ' dies.'
              else '. The ' || (b->>'name') || ' is down to ' || (b->>'left') || ' of ' || (b->>'of') || '.' end;

  when 'skirmisher_ricochet' then
    b := class_blow(p_world, p_uid, c.id, spell_fx(p_spell, 'more'));
    v_said := class_blow_said(s.name, b);
    -- And on, when it lands, to the nearest other wild thing within its reach of the first.
    if (b->>'landed')::boolean then
      select cr.id into v_i from creature cr
       where cr.world_id = p_world and cr.mode = 'wild' and cr.health > 0 and cr.id <> c.id
         and (creature_x(cr) - creature_x(c)) ^ 2 + (creature_y(cr) - creature_y(c)) ^ 2 <= spell_fx(p_spell, 'reach') ^ 2
       order by (creature_x(cr) - creature_x(c)) ^ 2 + (creature_y(cr) - creature_y(c)) ^ 2, cr.id
       limit 1;
      if v_i is not null then
        perform creature_settle(p_world, v_i);
        v_on := class_blow(p_world, p_uid, v_i, spell_fx(p_spell, 'glance'));
        v_said := v_said || ' It glances on to the ' || (v_on->>'name')
          || case when not (v_on->>'landed')::boolean then ', and misses.'
                  when (v_on->>'died')::boolean then ', which dies.'
                  else ', which is down to ' || (v_on->>'left') || ' of ' || (v_on->>'of') || '.' end;
      end if;
    end if;

  when 'skirmisher_fan_of_blades' then
    -- The one you aim at, and every other wild thing within its reach of it, nearest first.
    for r in
      select cr.id from creature cr
       where cr.world_id = p_world and cr.mode = 'wild' and cr.health > 0
         and (cr.id = c.id or (creature_x(cr) - creature_x(c)) ^ 2 + (creature_y(cr) - creature_y(c)) ^ 2 <= spell_fx(p_spell, 'reach') ^ 2)
       order by cr.id <> c.id, (creature_x(cr) - creature_x(c)) ^ 2 + (creature_y(cr) - creature_y(c)) ^ 2, cr.id
    loop
      if r.id <> c.id then perform creature_settle(p_world, r.id); end if;
      v_n := v_n + 1;
      if (class_blow(p_world, p_uid, r.id, spell_fx(p_spell, 'more'))->>'died')::boolean then v_dead := v_dead + 1; end if;
    end loop;
    b := null;
    v_said := s.name || ': you throw at ' || v_n || case when v_n = 1 then ' creature' else ' creatures' end
      || case when v_dead > 0 then ', and ' || v_dead || case when v_dead = 1 then ' dies' else ' die' end else '' end || '.';

  when 'skirmisher_opportunist' then
    -- On every blow, throw and shot of yours on one fighting somebody else while it holds (`class_dealt`).
    perform blessing_put(p_world, p_uid, 'opportunist', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'dealt', spell_fx(p_spell, 'more')));
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' every blow, throw and shot of yours on a creature '
      || 'fighting somebody else does ' || faith_pct(spell_fx(p_spell, 'more') - 1) || ' more.';

  when 'skirmisher_fade' then
    -- Every wild thing hunting you loses you, and is warned off you for a while as a Pikeman's Warning Thrust warns one
    -- (`hunt_settle`): until you strike it.
    for r in select cr.id from creature cr where cr.world_id = p_world and cr.hunting = p_uid and cr.health > 0 order by cr.id loop
      perform creature_settle(p_world, r.id);
      update creature set hunting = null, windup_at = null where world_id = p_world and id = r.id and hunting = p_uid;
      if found then
        v_n := v_n + 1;
        insert into class_mark (world_id, creature_id, kind, val, n, until, by_uid)
          values (p_world, r.id, 'warned', 1, 0, now() + make_interval(secs => spell_fx(p_spell, 'secs')), p_uid)
          on conflict (world_id, creature_id, kind) do update set val = excluded.val, n = excluded.n, until = excluded.until,
            by_uid = excluded.by_uid;
      end if;
    end loop;
    if v_n = 0 then return jsonb_build_object('why', 'Nothing is hunting you.'); end if;
    v_said := s.name || ': ' || v_n || case when v_n = 1 then ' creature loses' else ' creatures lose' end
      || ' you, and will not come for you again for ' || faith_span(spell_fx(p_spell, 'secs')) || ' unless you strike '
      || case when v_n = 1 then 'it' else 'them' end || '.';

  when 'skirmisher_marked_for_death' then
    -- On the creature, for every blow, throw and shot anybody lands on it while it holds (`class_marked`).
    insert into class_mark (world_id, creature_id, kind, val, n, until, by_uid)
      values (p_world, c.id, 'marked', spell_fx(p_spell, 'crit'), 0, now() + make_interval(secs => spell_fx(p_spell, 'secs')), p_uid)
      on conflict (world_id, creature_id, kind) do update set val = excluded.val, n = excluded.n, until = excluded.until, by_uid = excluded.by_uid;
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' every blow, throw and shot that lands on the ' || lower(d.name)
      || ' is critical ' || case when spell_fx(p_spell, 'crit') = 2 then 'twice' else trim_scale(spell_fx(p_spell, 'crit')::numeric) || ' times' end
      || ' as often.';

  when 'chirurgeon_field_dressing' then
    v_why := class_person_why(p_world, p_uid, p_target, spell_fx(p_spell, 'reach'));
    if v_why is not null then return jsonb_build_object('why', v_why); end if;
    v_uid := (p_target->>'uid')::uuid;
    v_who := case when v_uid = p_uid then 'you' else (select name from player where world_id = p_world and uid = v_uid) end;
    v_whose := case when v_uid = p_uid then 'You are' else v_who || ' is' end;
    v_on := faith_mend(p_world, v_uid, spell_fx(p_spell, 'heal'), false);
    if (v_on->>'healed')::double precision <= 0 and (v_on->>'stopped')::int = 0 then
      return jsonb_build_object('why', v_whose || ' not hurt.');
    end if;
    perform class_learn_heal(p_world, p_uid, v_uid);
    v_said := s.name || ' heals ' || v_who || ' by ' || faith_pct(spell_fx(p_spell, 'heal'))
      || case when (v_on->>'stopped')::int > 0 then ' and stops a wound bleeding' else '' end || '.';

  when 'chirurgeon_quick_stitch' then
    v_why := class_person_why(p_world, p_uid, p_target, spell_fx(p_spell, 'reach'));
    if v_why is not null then return jsonb_build_object('why', v_why); end if;
    v_uid := (p_target->>'uid')::uuid;
    v_who := case when v_uid = p_uid then 'you' else (select name from player where world_id = p_world and uid = v_uid) end;
    v_whose := case when v_uid = p_uid then 'You are' else v_who || ' is' end;
    if class_wounds_close(p_world, v_uid, spell_fx(p_spell, 'close'), false, false) = 0 then
      return jsonb_build_object('why', case when v_uid = p_uid then 'You have' else v_who || ' has' end || ' no wound.');
    end if;
    perform class_learn_heal(p_world, p_uid, v_uid);
    v_said := s.name || ' closes the worst wound on ' || v_who || ' by ' || faith_pct(spell_fx(p_spell, 'close')) || '.';

  when 'chirurgeon_leech' then
    -- What it takes of the creature, as a share of all it has, is what you get back of yours.
    v_hp := c.health;
    b := class_blow(p_world, p_uid, c.id, spell_fx(p_spell, 'more'));
    v_said := class_blow_said(s.name, b);
    if (b->>'landed')::boolean then
      v_hp := class_heal(p_world, p_uid, least((b->>'dmg')::double precision, v_hp) / max_health(c));
      if v_hp > 0 then v_said := v_said || ' You get back ' || faith_pct(v_hp) || ' of your health.'; end if;
    end if;

  when 'chirurgeon_regenerate' then
    v_why := class_person_why(p_world, p_uid, p_target, spell_fx(p_spell, 'reach'));
    if v_why is not null then return jsonb_build_object('why', v_why); end if;
    v_uid := (p_target->>'uid')::uuid;
    v_who := case when v_uid = p_uid then 'you' else (select name from player where world_id = p_world and uid = v_uid) end;
    v_whose := case when v_uid = p_uid then 'You are' else v_who || ' is' end;
    if coalesce((select (stats->>'health')::double precision from player where world_id = p_world and uid = v_uid), 1) >= 1 then
      return jsonb_build_object('why', v_whose || ' not hurt.');
    end if;
    -- From now, as a Renewal's is: the body settled first, so none of it is spent on time already gone (`class_regen`).
    perform body_settle(p_world, v_uid);
    perform blessing_put(p_world, v_uid, 'regenerate', jsonb_build_object('at', now(),
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'each', spell_fx(p_spell, 'each')));
    perform class_learn_heal(p_world, p_uid, v_uid);
    v_said := s.name || ' heals ' || v_who || ' by ' || faith_pct(spell_fx(p_spell, 'each')) || ' a second for '
      || faith_span(spell_fx(p_spell, 'secs')) || '.';

  when 'chirurgeon_toxin' then
    -- A bleed, as a knife's runs (`creature_settle`): the stronger of the two where it already bleeds, to the later end.
    update creature set bleed_rate = greatest(coalesce(bleed_rate, 0), max_health(c) * spell_fx(p_spell, 'each')),
        bleed_until = greatest(coalesce(bleed_until, now()), now() + make_interval(secs => spell_fx(p_spell, 'secs')))
      where world_id = p_world and id = c.id;
    perform class_learn(p_world, p_uid, class_learn_blow());
    v_said := s.name || ': the ' || lower(d.name) || ' bleeds ' || faith_pct(spell_fx(p_spell, 'each')) || ' of its health a second for '
      || faith_span(spell_fx(p_spell, 'secs')) || '.';

  when 'chirurgeon_surgeons_hands' then
    -- On every dressing you put on while it holds (`perform_fight`).
    perform blessing_put(p_world, p_uid, 'surgeons_hands', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'more', spell_fx(p_spell, 'more')));
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' every dressing you put on puts back '
      || case when spell_fx(p_spell, 'more') = 2 then 'twice' else trim_scale(spell_fx(p_spell, 'more')::numeric) || ' times' end
      || ' as much health.';

  when 'chirurgeon_healing_circle' then
    -- You, and everybody within its reach of you who is hurt.
    for r in select pl.uid from player pl
              where pl.world_id = p_world and not pl.away and coalesce((pl.stats->>'health')::double precision, 1) < 1
                and (pl.uid = p_uid or (pl.x - me.x) ^ 2 + (pl.y - me.y) ^ 2 <= spell_fx(p_spell, 'reach') ^ 2)
              order by pl.uid loop
      perform class_heal(p_world, r.uid, spell_fx(p_spell, 'heal'));
      perform class_learn_heal(p_world, p_uid, r.uid);
      v_n := v_n + 1;
    end loop;
    if v_n = 0 then
      return jsonb_build_object('why', 'Nobody within ' || trim_scale(spell_fx(p_spell, 'reach')::numeric) || ' tiles of you is hurt, you included.');
    end if;
    v_said := s.name || ' heals ' || v_n || case when v_n = 1 then ' person' else ' people' end || ' by ' || faith_pct(spell_fx(p_spell, 'heal')) || '.';

  when 'chirurgeon_mass_dressing' then
    -- You, and everybody within its reach of you: the worst wound on each.
    for r in select pl.uid from player pl
              where pl.world_id = p_world and not pl.away
                and (pl.uid = p_uid or (pl.x - me.x) ^ 2 + (pl.y - me.y) ^ 2 <= spell_fx(p_spell, 'reach') ^ 2)
              order by pl.uid loop
      if class_wounds_close(p_world, r.uid, spell_fx(p_spell, 'close'), false, true) > 0 then
        perform class_learn_heal(p_world, p_uid, r.uid);
        v_n := v_n + 1;
      end if;
    end loop;
    if v_n = 0 then
      return jsonb_build_object('why', 'Nobody within ' || trim_scale(spell_fx(p_spell, 'reach')::numeric) || ' tiles of you has a wound, you included.');
    end if;
    v_said := s.name || ' stops the worst wound bleeding and closes it by ' || faith_pct(spell_fx(p_spell, 'close')) || ' on '
      || v_n || case when v_n = 1 then ' person.' else ' people.' end;

  when 'chirurgeon_plague' then
    -- Every wild thing within its reach of you bleeds, as a Toxin's does.
    for r in select cr.id from creature cr
              where cr.world_id = p_world and cr.mode = 'wild' and cr.health > 0
                and (creature_x(cr) - me.x) ^ 2 + (creature_y(cr) - me.y) ^ 2 <= spell_fx(p_spell, 'reach') ^ 2
              order by cr.id loop
      perform creature_settle(p_world, r.id);
      update creature set bleed_rate = greatest(coalesce(bleed_rate, 0), max_health(creature) * spell_fx(p_spell, 'each')),
          bleed_until = greatest(coalesce(bleed_until, now()), now() + make_interval(secs => spell_fx(p_spell, 'secs')))
        where world_id = p_world and id = r.id and health > 0;
      if found then
        v_n := v_n + 1;
        perform class_learn(p_world, p_uid, class_learn_blow());
      end if;
    end loop;
    if v_n = 0 then
      return jsonb_build_object('why', 'Nothing is within ' || trim_scale(spell_fx(p_spell, 'reach')::numeric) || ' tiles of you to strike.');
    end if;
    v_said := s.name || ': ' || v_n || case when v_n = 1 then ' creature bleeds ' else ' creatures bleed ' end
      || faith_pct(spell_fx(p_spell, 'each')) || ' of ' || case when v_n = 1 then 'its' else 'their' end || ' health a second for '
      || faith_span(spell_fx(p_spell, 'secs')) || '.';

  when 'chirurgeon_battlefield_surgery' then
    v_why := class_person_why(p_world, p_uid, p_target, spell_fx(p_spell, 'reach'));
    if v_why is not null then return jsonb_build_object('why', v_why); end if;
    v_uid := (p_target->>'uid')::uuid;
    v_who := case when v_uid = p_uid then 'you' else (select name from player where world_id = p_world and uid = v_uid) end;
    v_whose := case when v_uid = p_uid then 'You are' else v_who || ' is' end;
    v_n := class_wounds_close(p_world, v_uid, spell_fx(p_spell, 'close'), true, false);
    v_hp := class_heal(p_world, v_uid, spell_fx(p_spell, 'heal'));
    if v_n = 0 and v_hp <= 0 then return jsonb_build_object('why', v_whose || ' not hurt.'); end if;
    perform class_learn_heal(p_world, p_uid, v_uid);
    v_said := s.name || ' closes every wound on ' || v_who || ' by ' || faith_pct(spell_fx(p_spell, 'close')) || ' and heals '
      || case when v_uid = p_uid then 'you' else 'them' end || ' by ' || faith_pct(spell_fx(p_spell, 'heal')) || '.';

  when 'chirurgeon_restoration' then
    v_n := class_wounds_close(p_world, p_uid, 1, true, false);
    v_hp := class_heal(p_world, p_uid, spell_fx(p_spell, 'heal'));
    if v_n = 0 and v_hp <= 0 then return jsonb_build_object('why', 'You are not hurt.'); end if;
    perform class_learn_heal(p_world, p_uid, p_uid);
    v_said := s.name || ' closes every wound on you and heals you by ' || faith_pct(spell_fx(p_spell, 'heal')) || '.';

  when 'chirurgeon_miracle_worker' then
    v_why := class_person_why(p_world, p_uid, p_target, spell_fx(p_spell, 'reach'));
    if v_why is not null then return jsonb_build_object('why', v_why); end if;
    v_uid := (p_target->>'uid')::uuid;
    v_who := case when v_uid = p_uid then 'you' else (select name from player where world_id = p_world and uid = v_uid) end;
    v_whose := case when v_uid = p_uid then 'You are' else v_who || ' is' end;
    v_n := class_wounds_close(p_world, v_uid, 1, true, false);
    v_hp := class_heal(p_world, v_uid, spell_fx(p_spell, 'heal'));
    if v_n = 0 and v_hp <= 0 then return jsonb_build_object('why', v_whose || ' not hurt.'); end if;
    perform class_learn_heal(p_world, p_uid, v_uid);
    v_said := s.name || ' closes every wound on ' || v_who || ' and heals ' || case when v_uid = p_uid then 'you' else 'them' end
      || ' by ' || faith_pct(spell_fx(p_spell, 'heal')) || '.';

  when 'beastmaster_sic' then
    k := class_companion(p_world, p_uid);
    if k.id is not null then perform creature_settle(p_world, k.id); k := class_companion(p_world, p_uid); end if;
    if k.id is null then return jsonb_build_object('why', s.name || ' wants a companion following you.'); end if;
    if sqrt((creature_x(c) - creature_x(k)) ^ 2 + (creature_y(c) - creature_y(k)) ^ 2) > companion_reach() then
      return jsonb_build_object('why', k.name || ' is not close enough to the ' || lower(d.name) || ' to strike it.');
    end if;
    b := class_beast_blow(p_world, k.id, c.id, spell_fx(p_spell, 'more'));
    v_said := class_beast_said(s.name, k.name, b);

  when 'beastmaster_lick_wounds' then
    k := class_companion(p_world, p_uid);
    if k.id is not null then perform creature_settle(p_world, k.id); k := class_companion(p_world, p_uid); end if;
    if k.id is null then return jsonb_build_object('why', s.name || ' wants a companion following you.'); end if;
    v_top := max_health(k);
    if k.health >= v_top then return jsonb_build_object('why', k.name || ' is not hurt.'); end if;
    update creature set health = least(v_top, health + v_top * spell_fx(p_spell, 'heal')) where world_id = p_world and id = k.id;
    v_said := s.name || ' heals ' || k.name || ' by ' || faith_pct(spell_fx(p_spell, 'heal')) || '.';

  when 'beastmaster_pounce' then
    k := class_companion(p_world, p_uid);
    if k.id is not null then perform creature_settle(p_world, k.id); k := class_companion(p_world, p_uid); end if;
    if k.id is null then return jsonb_build_object('why', s.name || ' wants a companion following you.'); end if;
    v_dist := sqrt((creature_x(c) - creature_x(k)) ^ 2 + (creature_y(c) - creature_y(k)) ^ 2);
    if v_dist > spell_fx(p_spell, 'reach') then
      return jsonb_build_object('why', k.name || ' is more than ' || trim_scale(spell_fx(p_spell, 'reach')::numeric) || ' tiles from the '
        || lower(d.name) || '.');
    end if;
    if not line_clear(p_world, creature_x(k), creature_y(k), creature_x(c), creature_y(c)) then
      return jsonb_build_object('why', 'Something stands between ' || k.name || ' and the ' || lower(d.name) || '.');
    end if;
    -- It lands half its reach short of it, on the line between them; on it, where there is no footing there.
    v_x := creature_x(c) - (creature_x(c) - creature_x(k)) / greatest(v_dist, 0.001) * companion_reach() / 2;
    v_y := creature_y(c) - (creature_y(c) - creature_y(k)) / greatest(v_dist, 0.001) * companion_reach() / 2;
    if not creature_tile_ok(p_world, floor(v_x)::int, floor(v_y)::int) then v_x := creature_x(c); v_y := creature_y(c); end if;
    update creature set from_x = v_x, from_y = v_y, to_x = v_x, to_y = v_y, leg_at = now(), leg_ends = now(), until = now(),
        phase = 'idle', enemy = c.id, heel_until = null
      where world_id = p_world and id = k.id;
    b := class_beast_blow(p_world, k.id, c.id, spell_fx(p_spell, 'more'));
    if not (b->>'died')::boolean then
      update creature set windup_at = null, until = greatest(until, now()) + make_interval(secs => spell_fx(p_spell, 'back'))
        where world_id = p_world and id = c.id;
    end if;
    v_said := class_beast_said(s.name, k.name, b) || case when (b->>'died')::boolean then ''
      else ' Its next blow is put back ' || faith_span(spell_fx(p_spell, 'back')) || '.' end;

  when 'beastmaster_snarl' then
    k := class_companion(p_world, p_uid);
    if k.id is not null then perform creature_settle(p_world, k.id); k := class_companion(p_world, p_uid); end if;
    if k.id is null then return jsonb_build_object('why', s.name || ' wants a companion following you.'); end if;
    for r in select cr.id from creature cr
              where cr.world_id = p_world and cr.mode = 'wild' and cr.health > 0 and cr.hitched_to is null
                and cr.to_x between creature_x(k) - (spell_fx(p_spell, 'reach') + leg_slack()) and creature_x(k) + (spell_fx(p_spell, 'reach') + leg_slack())
                and cr.to_y between creature_y(k) - (spell_fx(p_spell, 'reach') + leg_slack()) and creature_y(k) + (spell_fx(p_spell, 'reach') + leg_slack())
                and (creature_x(cr) - creature_x(k)) ^ 2 + (creature_y(cr) - creature_y(k)) ^ 2 <= spell_fx(p_spell, 'reach') ^ 2
              order by cr.id loop
      perform creature_settle(p_world, r.id);
      update creature set brawl = k.id, threat_at = now(), windup_at = null
        where world_id = p_world and id = r.id and mode = 'wild' and health > 0;
      if found then v_n := v_n + 1; end if;
    end loop;
    if v_n = 0 then
      return jsonb_build_object('why', 'Nothing wild is within ' || trim_scale(spell_fx(p_spell, 'reach')::numeric) || ' tiles of ' || k.name || '.');
    end if;
    v_said := s.name || ': ' || v_n || case when v_n = 1 then ' creature turns on ' else ' creatures turn on ' end || k.name || '.';

  when 'beastmaster_guard_me' then
    k := class_companion(p_world, p_uid);
    if k.id is not null then perform creature_settle(p_world, k.id); k := class_companion(p_world, p_uid); end if;
    if k.id is null then return jsonb_build_object('why', s.name || ' wants a companion following you.'); end if;
    -- Only when something within its reach of you is hunting you: otherwise it would be a leap for nothing.
    if not exists (select 1 from creature cr
                    where cr.world_id = p_world and cr.mode = 'wild' and cr.health > 0 and cr.hunting = p_uid
                      and (creature_x(cr) - me.x) ^ 2 + (creature_y(cr) - me.y) ^ 2 <= spell_fx(p_spell, 'reach') ^ 2) then
      return jsonb_build_object('why', 'Nothing within ' || trim_scale(spell_fx(p_spell, 'reach')::numeric) || ' tiles of you is hunting you.');
    end if;
    update creature set from_x = me.x, from_y = me.y, to_x = me.x, to_y = me.y, leg_at = now(), leg_ends = now(), until = now(),
        phase = 'idle'
      where world_id = p_world and id = k.id;
    for r in select cr.id from creature cr
              where cr.world_id = p_world and cr.mode = 'wild' and cr.health > 0 and cr.hunting = p_uid
                and (creature_x(cr) - me.x) ^ 2 + (creature_y(cr) - me.y) ^ 2 <= spell_fx(p_spell, 'reach') ^ 2
              order by cr.id loop
      perform creature_settle(p_world, r.id);
      update creature set brawl = k.id, threat_at = now(), windup_at = null
        where world_id = p_world and id = r.id and mode = 'wild' and health > 0;
      if found then v_n := v_n + 1; end if;
    end loop;
    v_said := s.name || ': ' || k.name || ' is at your side, and ' || v_n
      || case when v_n = 1 then ' creature turns on it.' else ' creatures turn on it.' end;

  when 'beastmaster_drag_down' then
    k := class_companion(p_world, p_uid);
    if k.id is not null then perform creature_settle(p_world, k.id); k := class_companion(p_world, p_uid); end if;
    if k.id is null then return jsonb_build_object('why', s.name || ' wants a companion following you.'); end if;
    if sqrt((creature_x(c) - creature_x(k)) ^ 2 + (creature_y(c) - creature_y(k)) ^ 2) > companion_reach() then
      return jsonb_build_object('why', k.name || ' is not close enough to the ' || lower(d.name) || ' to strike it.');
    end if;
    b := class_beast_blow(p_world, k.id, c.id, spell_fx(p_spell, 'more'));
    if not (b->>'died')::boolean then perform class_hold(p_world, c.id, spell_fx(p_spell, 'hold')); end if;
    v_said := class_beast_said(s.name, k.name, b) || case when (b->>'died')::boolean then ''
      else ' It is held where it stands for ' || faith_span(spell_fx(p_spell, 'hold')) || '.' end;

  when 'beastmaster_disembowel' then
    k := class_companion(p_world, p_uid);
    if k.id is not null then perform creature_settle(p_world, k.id); k := class_companion(p_world, p_uid); end if;
    if k.id is null then return jsonb_build_object('why', s.name || ' wants a companion following you.'); end if;
    if sqrt((creature_x(c) - creature_x(k)) ^ 2 + (creature_y(c) - creature_y(k)) ^ 2) > companion_reach() then
      return jsonb_build_object('why', k.name || ' is not close enough to the ' || lower(d.name) || ' to strike it.');
    end if;
    b := class_beast_blow(p_world, k.id, c.id, spell_fx(p_spell, 'more'));
    -- A bleed, as a knife's runs (`creature_settle`): the stronger of the two where it already bleeds, to the later end.
    if not (b->>'died')::boolean then
      update creature set bleed_rate = greatest(coalesce(bleed_rate, 0), (b->>'dmg')::double precision * spell_fx(p_spell, 'each')),
          bleed_until = greatest(coalesce(bleed_until, now()), now() + make_interval(secs => spell_fx(p_spell, 'secs')))
        where world_id = p_world and id = c.id;
    end if;
    v_said := class_beast_said(s.name, k.name, b) || case when (b->>'died')::boolean then ''
      else ' It bleeds ' || faith_pct(spell_fx(p_spell, 'each')) || ' of the blow a second for ' || faith_span(spell_fx(p_spell, 'secs')) || '.' end;

  when 'beastmaster_bloodlust' then
    k := class_companion(p_world, p_uid);
    if k.id is not null then perform creature_settle(p_world, k.id); k := class_companion(p_world, p_uid); end if;
    if k.id is null then return jsonb_build_object('why', s.name || ' wants a companion following you.'); end if;
    -- On every blow of its while it holds (`companion_dealt`).
    perform blessing_put(p_world, p_uid, 'bloodlust', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'more', spell_fx(p_spell, 'more')));
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' ' || k.name || '''s blows are '
      || faith_pct(spell_fx(p_spell, 'more') - 1) || ' larger.';

  when 'beastmaster_vengeance' then
    k := class_companion(p_world, p_uid);
    if k.id is not null then perform creature_settle(p_world, k.id); k := class_companion(p_world, p_uid); end if;
    if k.id is null then return jsonb_build_object('why', s.name || ' wants a companion following you.'); end if;
    -- On every blow that lands on you while it holds (`hurt_player`), answered once the striker's turn is written (`class_vengeance`).
    perform blessing_put(p_world, p_uid, 'vengeance', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'more', spell_fx(p_spell, 'more'),
      'reach', spell_fx(p_spell, 'reach')));
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' ' || k.name
      || ' answers every creature that lands a blow on you.';

  when 'beastmaster_feral_bond' then
    k := class_companion(p_world, p_uid);
    if k.id is not null then perform creature_settle(p_world, k.id); k := class_companion(p_world, p_uid); end if;
    if k.id is null then return jsonb_build_object('why', s.name || ' wants a companion following you.'); end if;
    -- On every blow that lands on you (`class_bond_take`) or on it (`class_bond_give`) while it holds.
    perform blessing_put(p_world, p_uid, 'feral_bond', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'share', spell_fx(p_spell, 'share')));
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' every blow on you or on ' || k.name
      || ' is split between you.';

  when 'beastmaster_primal_fury' then
    k := class_companion(p_world, p_uid);
    if k.id is not null then perform creature_settle(p_world, k.id); k := class_companion(p_world, p_uid); end if;
    if k.id is null then return jsonb_build_object('why', s.name || ' wants a companion following you.'); end if;
    -- On every blow of its while it holds (`companion_dealt`), and on how often it strikes (`companion_quick`).
    perform blessing_put(p_world, p_uid, 'primal_fury', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'more', spell_fx(p_spell, 'more'),
      'quick', spell_fx(p_spell, 'quick')));
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' ' || k.name || '''s blows are '
      || faith_pct(spell_fx(p_spell, 'more') - 1) || ' larger and come ' || faith_pct(spell_fx(p_spell, 'quick') - 1) || ' more often.';

  when 'beastmaster_call_of_the_wild' then
    -- A tame that takes, as an offering that takes does (`perform_creature`), with nothing offered.
    if d.monster then return jsonb_build_object('why', 'The ' || lower(d.name) || ' cannot be tamed.'); end if;
    if coalesce(d.tame_level, 0) > skill_of(p_world, p_uid, 'taming') then
      return jsonb_build_object('why', 'The ' || lower(d.name) || ' wants ' || round(d.tame_level)::int || ' taming; you have '
        || floor(skill_of(p_world, p_uid, 'taming'))::int || '.');
    end if;
    v_why := tame_room_refusal(p_world, p_uid);
    if v_why is not null then return jsonb_build_object('why', v_why); end if;
    v_id := companion_of(p_world, p_uid);
    update creature set mode = 'active', stance = 'defensive', keeper = p_uid, coaxed = 0, coaxed_at = null,
        hunting = null, brawl = null, enemy = null, windup_at = null
      where world_id = p_world and id = c.id;
    -- One follows you; every one after that goes into the crate you carry.
    if v_id is not null then perform crate_shut_in(p_world, c.id, empty_crate(p_world, p_uid), null); end if;
    perform journal_note(p_world, p_uid, 'tamed');
    perform guide_mark(p_world, p_uid, c.species, 'tamed');
    perform skill_told(p_world, p_uid, 'taming', try_gain(true, tame_gain()));
    perform skill_told(p_world, p_uid, 'soul_strength', try_gain(true, tame_nerve()));
    v_said := s.name || ': the ' || lower(d.name) || ' trusts you. ' || case when v_id is null then c.name || ' now follows you.'
      else 'It goes into the creature crate in your pack.' end;

  when 'kindler_scorch' then
    b := kindler_fire(p_world, p_uid, c.id, kindler_fire_at(p_world, p_uid) * spell_fx(p_spell, 'fire'));
    v_fired := true;
    v_said := kindler_said(s.name, b) || kindler_burn_said(case when (b->>'landed')::boolean and not (b->>'died')::boolean
      then class_burn(p_world, p_uid, c.id, spell_fx(p_spell, 'each'), spell_fx(p_spell, 'secs')) end);

  when 'kindler_heat_seeker' then
    -- Every enemy within its reach settled first, so the share of its health each has left is what it has now.
    for r in select cr.id from creature cr
              where cr.world_id = p_world and cr.mode = 'wild' and cr.health > 0
                and cr.to_x between me.x - (spell_fx(p_spell, 'reach') + leg_slack()) and me.x + (spell_fx(p_spell, 'reach') + leg_slack())
                and cr.to_y between me.y - (spell_fx(p_spell, 'reach') + leg_slack()) and me.y + (spell_fx(p_spell, 'reach') + leg_slack())
                and (creature_x(cr) - me.x) ^ 2 + (creature_y(cr) - me.y) ^ 2 <= spell_fx(p_spell, 'reach') ^ 2
              order by cr.id loop
      perform creature_settle(p_world, r.id);
    end loop;
    select cr.id into v_id from creature cr
     where cr.world_id = p_world and cr.mode = 'wild' and cr.health > 0
                and cr.to_x between me.x - (spell_fx(p_spell, 'reach') + leg_slack()) and me.x + (spell_fx(p_spell, 'reach') + leg_slack())
                and cr.to_y between me.y - (spell_fx(p_spell, 'reach') + leg_slack()) and me.y + (spell_fx(p_spell, 'reach') + leg_slack())
                and (creature_x(cr) - me.x) ^ 2 + (creature_y(cr) - me.y) ^ 2 <= spell_fx(p_spell, 'reach') ^ 2
     order by cr.health / max_health(cr), (creature_x(cr) - me.x) ^ 2 + (creature_y(cr) - me.y) ^ 2, cr.id
     limit 1;
    if v_id is null then
      return jsonb_build_object('why', 'Nothing is within ' || trim_scale(spell_fx(p_spell, 'reach')::numeric) || ' tiles of you to strike.');
    end if;
    b := kindler_fire(p_world, p_uid, v_id, kindler_fire_at(p_world, p_uid) * spell_fx(p_spell, 'fire'));
    v_fired := true;
    v_said := kindler_said(s.name, b);

  when 'kindler_scald' then
    b := kindler_fire(p_world, p_uid, c.id, kindler_fire_at(p_world, p_uid) * spell_fx(p_spell, 'fire'));
    v_fired := true;
    v_said := kindler_said(s.name, b);
    if (b->>'landed')::boolean and not (b->>'died')::boolean then
      update creature set slow = spell_fx(p_spell, 'pace'), slow_until = now() + make_interval(secs => spell_fx(p_spell, 'secs'))
        where world_id = p_world and id = c.id;
      v_said := v_said || ' For ' || faith_span(spell_fx(p_spell, 'secs')) || ' it goes at '
        || faith_pct(spell_fx(p_spell, 'pace')) || ' of its pace.';
    end if;

  when 'kindler_flash_fire' then
    b := kindler_fire(p_world, p_uid, c.id, kindler_fire_at(p_world, p_uid) * spell_fx(p_spell, 'fire'));
    v_fired := true;
    v_said := kindler_said(s.name, b);

  when 'kindler_stoke' then
    -- Spent by the next of your spells that deals fire (`kindler_fire_at`), at the end of its cast.
    perform blessing_put(p_world, p_uid, 'stoke', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'more', spell_fx(p_spell, 'more')));
    v_said := s.name || ': the next spell of yours within ' || faith_span(spell_fx(p_spell, 'secs')) || ' that deals fire deals '
      || faith_pct(spell_fx(p_spell, 'more') - 1) || ' more of it.';

  when 'kindler_firebrand' then
    -- On every burn you start while it holds (`class_burn`).
    perform blessing_put(p_world, p_uid, 'firebrand', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'long', spell_fx(p_spell, 'long')));
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' every burn you start lasts '
      || case when spell_fx(p_spell, 'long') = 2 then 'twice' else trim_scale(spell_fx(p_spell, 'long')::numeric) || ' times' end
      || ' as long.';

  when 'kindler_immolate' then
    v_burnt := class_burn(p_world, p_uid, c.id, spell_fx(p_spell, 'each'), spell_fx(p_spell, 'secs'));
    if v_burnt is null then return jsonb_build_object('why', 'Nothing burns inside a Truce.'); end if;
    perform class_learn(p_world, p_uid, class_learn_blow());
    perform engage_beast(p_world, c.id, p_uid);
    v_said := s.name || ': the ' || lower(d.name) || ' catches.' || kindler_burn_said(v_burnt);

  when 'kindler_combust' then
    -- What its burn still had to do (`class_burn`), all at once, and then it is out, and its bleeding with it.
    select * into v_burn from class_mark where world_id = p_world and creature_id = c.id and kind = 'burn' and until > now();
    if v_burn.creature_id is null then return jsonb_build_object('why', 'The ' || lower(d.name) || ' is not burning.'); end if;
    v_hp := v_burn.val * extract(epoch from (v_burn.until - now())) * spell_fx(p_spell, 'more');
    delete from class_mark where world_id = p_world and creature_id = c.id and kind = 'burn';
    update creature set bleed_rate = null, bleed_until = null where world_id = p_world and id = c.id;
    b := kindler_fire(p_world, p_uid, c.id, v_hp);
    v_said := s.name || ': the burn on the ' || lower(d.name) || ' goes up at once, ' || round(v_hp::numeric) || ' of it'
      || case when (b->>'died')::boolean then ', and it dies.'
              else '. It is down to ' || (b->>'left') || ' of ' || (b->>'of') || '.' end;

  when 'kindler_blaze_aura' then
    -- Burned a round at a time by the clock (`class_aura`), at the fire you had when you cast it.
    v_fire := kindler_fire_at(p_world, p_uid) * spell_fx(p_spell, 'fire');
    perform blessing_put(p_world, p_uid, 'blaze_aura', jsonb_build_object('from', now(), 'at', now(),
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'fire', v_fire, 'share', spell_fx(p_spell, 'fire'),
      'reach', spell_fx(p_spell, 'reach')));
    v_fired := true;
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' everything wild within '
      || trim_scale(spell_fx(p_spell, 'reach')::numeric) || ' tiles of you takes ' || trim_scale(round(v_fire::numeric, 1))
      || ' of fire a second.';

  when 'kindler_inferno_bolt' then
    b := kindler_fire(p_world, p_uid, c.id, kindler_fire_at(p_world, p_uid) * spell_fx(p_spell, 'fire'));
    v_fired := true;
    v_said := kindler_said(s.name, b) || kindler_burn_said(case when (b->>'landed')::boolean and not (b->>'died')::boolean
      then class_burn(p_world, p_uid, c.id, spell_fx(p_spell, 'each'), spell_fx(p_spell, 'secs')) end);

  when 'kindler_meteor' then
    -- The one it was cast at, and every other within its width of where that one stood.
    v_fire := kindler_fire_at(p_world, p_uid);
    v_x := creature_x(c); v_y := creature_y(c);
    b := kindler_fire(p_world, p_uid, c.id, v_fire * spell_fx(p_spell, 'fire'));
    v_fired := true;
    for r in select cr.id from creature cr
              where cr.world_id = p_world and cr.mode = 'wild' and cr.health > 0
                and cr.to_x between v_x - (spell_fx(p_spell, 'wide') + leg_slack()) and v_x + (spell_fx(p_spell, 'wide') + leg_slack())
                and cr.to_y between v_y - (spell_fx(p_spell, 'wide') + leg_slack()) and v_y + (spell_fx(p_spell, 'wide') + leg_slack())
                and (creature_x(cr) - v_x) ^ 2 + (creature_y(cr) - v_y) ^ 2 <= spell_fx(p_spell, 'wide') ^ 2 and cr.id <> c.id
              order by cr.id loop
      v_on := kindler_fire(p_world, p_uid, r.id, v_fire * spell_fx(p_spell, 'splash'));
      if (v_on->>'landed')::boolean then v_n := v_n + 1; end if;
      if (v_on->>'died')::boolean then v_dead := v_dead + 1; end if;
    end loop;
    v_said := kindler_said(s.name, b) || case when v_n = 0 then '' else ' ' || v_n
      || case when v_n = 1 then ' more creature is' else ' more creatures are' end || ' caught in it'
      || case when v_dead = 0 then '.' when v_n = 1 then ', and it dies.' when v_dead = 1 then ', and one of them dies.'
              else ', and ' || v_dead || ' of them die.' end end;

  when 'kindler_firestorm' then
    -- Every enemy within its reach of you, and each the fire leaves standing burns.
    v_fire := kindler_fire_at(p_world, p_uid);
    for r in select cr.id from creature cr
              where cr.world_id = p_world and cr.mode = 'wild' and cr.health > 0
                and cr.to_x between me.x - (spell_fx(p_spell, 'reach') + leg_slack()) and me.x + (spell_fx(p_spell, 'reach') + leg_slack())
                and cr.to_y between me.y - (spell_fx(p_spell, 'reach') + leg_slack()) and me.y + (spell_fx(p_spell, 'reach') + leg_slack())
                and (creature_x(cr) - me.x) ^ 2 + (creature_y(cr) - me.y) ^ 2 <= spell_fx(p_spell, 'reach') ^ 2
              order by cr.id loop
      v_on := kindler_fire(p_world, p_uid, r.id, v_fire * spell_fx(p_spell, 'fire'));
      if (v_on->>'landed')::boolean then
        v_n := v_n + 1;
        if (v_on->>'died')::boolean then v_dead := v_dead + 1;
        else v_burnt := coalesce(class_burn(p_world, p_uid, r.id, spell_fx(p_spell, 'each'), spell_fx(p_spell, 'secs')), v_burnt);
        end if;
      end if;
    end loop;
    if v_n = 0 then
      return jsonb_build_object('why', 'Nothing is within ' || trim_scale(spell_fx(p_spell, 'reach')::numeric) || ' tiles of you to strike.');
    end if;
    v_fired := true;
    v_said := s.name || ': ' || v_n || case when v_n = 1 then ' creature is' else ' creatures are' end || ' caught in it'
      || case when v_dead = 0 then '.' when v_n = 1 then ', and it dies.' when v_dead = 1 then ', and one of them dies.'
              else ', and ' || v_dead || ' of them die.' end
      || case when v_burnt is null then ''
              else ' ' || case when v_dead = 0 and v_n = 1 then 'It burns ' when v_dead = 0 then 'They burn '
                               when v_n - v_dead = 1 then 'The other burns ' else 'The rest burn ' end
                || trim_scale(round(((v_burnt->>'each')::double precision * 100)::numeric, 1)) || '% of '
                || case when v_n - v_dead = 1 then 'its' else 'their' end || ' health a second for '
                || faith_span((v_burnt->>'secs')::double precision) || '.' end;

  when 'binder_bind' then
    perform engage_beast(p_world, c.id, p_uid);
    v_hp := class_bind(p_world, p_uid, c.id, spell_fx(p_spell, 'hold'), spell_fx(p_spell, 'monster'));
    perform class_learn(p_world, p_uid, class_learn_blow());
    v_said := s.name || ': the ' || lower(d.name) || ' is held where it stands for ' || faith_span(v_hp) || '.';

  when 'binder_lock' then
    perform engage_beast(p_world, c.id, p_uid);
    v_hp := class_bind(p_world, p_uid, c.id, spell_fx(p_spell, 'hold'), spell_fx(p_spell, 'monster'));
    perform class_learn(p_world, p_uid, class_learn_blow());
    v_said := s.name || ': the ' || lower(d.name) || ' is held where it stands for ' || faith_span(v_hp) || '.';

  when 'binder_shatter' then
    -- Larger on one held, by anybody's hold (`class_held`).
    v_windup := class_held(p_world, c.id);
    b := kindler_fire(p_world, p_uid, c.id, binder_shatter_at(p_world, p_uid)
           * case when v_windup then spell_fx(p_spell, 'held') else spell_fx(p_spell, 'shatter') end);
    v_said := binder_said(s.name, b);

  when 'binder_root' then
    perform engage_beast(p_world, c.id, p_uid);
    perform class_leash(p_world, c.id, 'root', 0, spell_fx(p_spell, 'secs'), p_uid);
    perform class_learn(p_world, p_uid, class_learn_blow());
    v_said := s.name || ': the ' || lower(d.name) || ' is rooted where it stands for ' || faith_span(spell_fx(p_spell, 'secs')) || '.';

  when 'binder_tether' then
    perform engage_beast(p_world, c.id, p_uid);
    perform class_leash(p_world, c.id, 'tether', spell_fx(p_spell, 'leash'), spell_fx(p_spell, 'secs'), p_uid);
    perform class_learn(p_world, p_uid, class_learn_blow());
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' the ' || lower(d.name) || ' cannot go more than '
      || trim_scale(spell_fx(p_spell, 'leash')::numeric) || ' tiles from where it stands.';

  when 'binder_heavy_limbs' then
    perform engage_beast(p_world, c.id, p_uid);
    perform class_mark_put(p_world, c.id, 'limbs', spell_fx(p_spell, 'often'), spell_fx(p_spell, 'secs'), p_uid);
    perform class_learn(p_world, p_uid, class_learn_blow());
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' the ' || lower(d.name) || ' strikes ' || faith_pct(1 - spell_fx(p_spell, 'often')) || ' less often.';

  when 'binder_dull_claws' then
    perform engage_beast(p_world, c.id, p_uid);
    perform class_mark_put(p_world, c.id, 'dull', spell_fx(p_spell, 'dealt'), spell_fx(p_spell, 'secs'), p_uid);
    perform class_learn(p_world, p_uid, class_learn_blow());
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' the ' || lower(d.name) || '''s blows land ' || faith_pct(1 - spell_fx(p_spell, 'dealt')) || ' smaller.';

  when 'binder_brittle' then
    perform engage_beast(p_world, c.id, p_uid);
    perform class_mark_put(p_world, c.id, 'brittle', spell_fx(p_spell, 'taken'), spell_fx(p_spell, 'secs'), p_uid);
    perform class_learn(p_world, p_uid, class_learn_blow());
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' the ' || lower(d.name) || ' takes ' || faith_pct(spell_fx(p_spell, 'taken') - 1) || ' more from everything that strikes it.';

  when 'binder_stillness' then
    perform wounds_settle(p_world, p_uid);
    if not exists (select 1 from player pl, jsonb_array_elements(coalesce(pl.wounds, '[]'::jsonb)) t(w)
                    where pl.world_id = p_world and pl.uid = p_uid and coalesce((w->>'bleeding')::boolean, false)) then
      return jsonb_build_object('why', 'Nothing on you is bleeding.');
    end if;
    update player set wounds = (select coalesce(jsonb_agg(jsonb_set(w, '{bleeding}', 'false')), '[]'::jsonb)
                                  from jsonb_array_elements(coalesce(wounds, '[]'::jsonb)) t(w))
     where world_id = p_world and uid = p_uid;
    v_said := s.name || ': every wound on you stops bleeding.';

  when 'binder_still_skin' then
    -- On every blow that lands on you while it holds (`hurt_player`).
    perform blessing_put(p_world, p_uid, 'still_skin', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'cut', spell_fx(p_spell, 'cut')));
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' you take ' || faith_pct(spell_fx(p_spell, 'cut'))
      || ' less from every blow.';

  when 'binder_mire' then
    -- Every enemy within its width of you, further in a Long Hold: the slower of its slow and this, to the later end.
    v_reach := spell_fx(p_spell, 'reach') * class_mul(me.class_mul, 'reach', 'binding');
    for r in select cr.id from creature cr
              where cr.world_id = p_world and cr.mode = 'wild' and cr.health > 0
                and cr.to_x between me.x - (v_reach + leg_slack()) and me.x + (v_reach + leg_slack())
                and cr.to_y between me.y - (v_reach + leg_slack()) and me.y + (v_reach + leg_slack())
                and (creature_x(cr) - me.x) ^ 2 + (creature_y(cr) - me.y) ^ 2 <= v_reach ^ 2
              order by cr.id loop
      perform creature_settle(p_world, r.id);
      update creature set slow = case when slow_until > now() then least(coalesce(slow, 1), spell_fx(p_spell, 'pace'))
                                      else spell_fx(p_spell, 'pace') end,
          slow_until = greatest(coalesce(slow_until, now()), now() + make_interval(secs => spell_fx(p_spell, 'secs')))
        where world_id = p_world and id = r.id and health > 0;
      if found then
        v_n := v_n + 1;
        perform engage_beast(p_world, r.id, p_uid);
        perform class_learn(p_world, p_uid, class_learn_blow());
      end if;
    end loop;
    if v_n = 0 then
      return jsonb_build_object('why', 'Nothing is within ' || trim_scale(round(v_reach::numeric, 1)) || ' tiles of you to strike.');
    end if;
    v_said := s.name || ': ' || v_n || case when v_n = 1 then ' creature goes' else ' creatures go' end || ' at '
      || faith_pct(spell_fx(p_spell, 'pace')) || ' of ' || case when v_n = 1 then 'its' else 'their' end || ' pace for '
      || faith_span(spell_fx(p_spell, 'secs')) || '.';

  when 'binder_mass_root' then
    -- Every enemy within its width of you, further in a Long Hold, rooted where it stands.
    v_reach := spell_fx(p_spell, 'reach') * class_mul(me.class_mul, 'reach', 'binding');
    for r in select cr.id from creature cr
              where cr.world_id = p_world and cr.mode = 'wild' and cr.health > 0
                and cr.to_x between me.x - (v_reach + leg_slack()) and me.x + (v_reach + leg_slack())
                and cr.to_y between me.y - (v_reach + leg_slack()) and me.y + (v_reach + leg_slack())
                and (creature_x(cr) - me.x) ^ 2 + (creature_y(cr) - me.y) ^ 2 <= v_reach ^ 2
              order by cr.id loop
      perform creature_settle(p_world, r.id);
      if exists (select 1 from creature where world_id = p_world and id = r.id and health > 0) then
        perform engage_beast(p_world, r.id, p_uid);
        perform class_leash(p_world, r.id, 'root', 0, spell_fx(p_spell, 'secs'), p_uid);
        perform class_learn(p_world, p_uid, class_learn_blow());
        v_n := v_n + 1;
      end if;
    end loop;
    if v_n = 0 then
      return jsonb_build_object('why', 'Nothing is within ' || trim_scale(round(v_reach::numeric, 1)) || ' tiles of you to strike.');
    end if;
    v_said := s.name || ': ' || v_n || case when v_n = 1 then ' creature is' else ' creatures are' end || ' rooted where '
      || case when v_n = 1 then 'it stands' else 'they stand' end || ' for ' || faith_span(spell_fx(p_spell, 'secs')) || '.';

  -- A Warder's skin over you: its share of your skin at 100%, larger for what you hold (`warder_skin_size`), refused where
  -- the skin over you is larger already and nothing adds to it, so that nothing is spent on it.
  when 'warder_ward', 'warder_greater_ward', 'warder_deep_ward' then
    v_more := warder_thicken_at(p_world, p_uid);
    v_hp := warder_skin_size(p_world, p_uid, p_uid, warder_skin_at(p_world, p_uid) * spell_fx(p_spell, 'skin'), v_more);
    v_was := coalesce((me.stats->>'aegis')::double precision, 0);
    if warder_skin_after(p_world, p_uid, p_uid, v_hp) <= v_was then
      return jsonb_build_object('why', 'The skin over you is larger already.');
    end if;
    v_h := warder_skin_put(p_world, p_uid, p_uid, v_hp);
    perform warder_thicken_take(p_world, p_uid);
    perform class_learn_heal(p_world, p_uid, p_uid);
    v_said := warder_skin_said(s.name, 'you', v_hp, v_h, v_was);

  -- And over somebody within its reach of you.
  when 'warder_ward_other', 'warder_greater_ward_other' then
    v_why := class_person_why(p_world, p_uid, p_target, spell_fx(p_spell, 'reach'));
    if v_why is not null then return jsonb_build_object('why', v_why); end if;
    v_uid := (p_target->>'uid')::uuid;
    v_who := case when v_uid = p_uid then 'you' else (select name from player where world_id = p_world and uid = v_uid) end;
    v_more := warder_thicken_at(p_world, p_uid);
    v_hp := warder_skin_size(p_world, p_uid, v_uid, warder_skin_at(p_world, p_uid) * spell_fx(p_spell, 'skin'), v_more);
    v_was := coalesce((select (stats->>'aegis')::double precision from player where world_id = p_world and uid = v_uid), 0);
    if warder_skin_after(p_world, p_uid, v_uid, v_hp) <= v_was then
      return jsonb_build_object('why', 'The skin over ' || v_who || ' is larger already.');
    end if;
    v_h := warder_skin_put(p_world, p_uid, v_uid, v_hp);
    perform warder_thicken_take(p_world, p_uid);
    perform class_learn_heal(p_world, p_uid, v_uid);
    if v_uid <> p_uid then
      perform tell(p_world, v_uid, me.name || '''s ' || s.name || ': a skin of ' || faith_pct(v_hp) || ' goes over you.', 'system');
    end if;
    v_said := warder_skin_said(s.name, v_who, v_hp, v_h, v_was);

  -- A Sanctuary: over you and over everybody within its reach of you, on each where it is the larger.
  when 'warder_sanctuary' then
    v_more := warder_thicken_at(p_world, p_uid);
    v_base := warder_skin_at(p_world, p_uid) * spell_fx(p_spell, 'skin');
    v_self := warder_skin_size(p_world, p_uid, p_uid, v_base, v_more);
    v_other := warder_skin_size(p_world, p_uid, null, v_base, v_more);
    for r in select pl.uid, coalesce((pl.stats->>'aegis')::double precision, 0) as was from player pl
              where pl.world_id = p_world and not pl.away
                and (pl.uid = p_uid or (pl.x - me.x) ^ 2 + (pl.y - me.y) ^ 2 <= spell_fx(p_spell, 'reach') ^ 2)
              order by pl.uid loop
      v_hp := case when r.uid = p_uid then v_self else v_other end;
      if exists (select 1 from creature cr where cr.world_id = p_world and cr.hunting = r.uid and cr.health > 0) then
        v_hunted := true;
      end if;
      if warder_skin_after(p_world, p_uid, r.uid, v_hp) > r.was then
        perform warder_skin_put(p_world, p_uid, r.uid, v_hp);
        if r.uid = p_uid then
          v_mine := true;
        else
          v_n := v_n + 1;
          perform tell(p_world, r.uid, me.name || '''s ' || s.name || ': a skin of ' || faith_pct(v_hp) || ' goes over you.', 'system');
        end if;
      end if;
    end loop;
    if not v_mine and v_n = 0 then
      return jsonb_build_object('why', 'Every skin within ' || trim_scale(spell_fx(p_spell, 'reach')::numeric)
        || ' tiles of you is larger already.');
    end if;
    perform warder_thicken_take(p_world, p_uid);
    if v_hunted then perform class_learn(p_world, p_uid, class_learn_blow()); end if;
    v_said := s.name || ': ' || case when v_mine then 'a skin of ' || faith_pct(v_self) || ' goes over you'
                                     else 'the skin over you is larger already' end
      || case when v_n = 0 then '.'
              else case when v_mine then ', and ' else '; ' end || 'a skin of ' || faith_pct(v_other) || ' goes over '
                || v_n || case when v_n = 1 then ' other.' else ' others.' end end;

  -- A Thicken: the next skin you lay, within its time, the larger (`warder_thicken_at`).
  when 'warder_thicken' then
    perform blessing_put(p_world, p_uid, 'thicken', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'more', spell_fx(p_spell, 'more')));
    perform class_learn_heal(p_world, p_uid, p_uid);
    v_said := s.name || ': the next skin you lay within ' || faith_span(spell_fx(p_spell, 'secs')) || ' is '
      || faith_pct(spell_fx(p_spell, 'more') - 1) || ' larger.';

  -- A Ward Link: a skin of yours over somebody used up while it holds goes back over them, once each (`warder_skin_spent`).
  when 'warder_ward_link' then
    perform blessing_put(p_world, p_uid, 'ward_link', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'reach', spell_fx(p_spell, 'reach'),
      'skin', spell_fx(p_spell, 'skin'), 'done', '[]'::jsonb));
    perform class_learn_heal(p_world, p_uid, p_uid);
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ', when a skin of yours over somebody within '
      || trim_scale(spell_fx(p_spell, 'reach')::numeric) || ' tiles of you is used up, a skin of '
      || faith_pct(spell_fx(p_spell, 'skin')) || ' goes back over them, once each.';

  -- A Stoneskin: its share off every blow on you, for as long as it says (`hurt_player`).
  when 'warder_stoneskin' then
    perform blessing_put(p_world, p_uid, 'stoneskin', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'cut', spell_fx(p_spell, 'cut')));
    perform class_learn_heal(p_world, p_uid, p_uid);
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' you take ' || faith_pct(spell_fx(p_spell, 'cut'))
      || ' less from every blow.';

  -- A Ward Burst: the skin over you broken on every enemy within its reach of you, so much damage for every hundredth of
  -- health it held, as fire lands (`kindler_fire`); refused with no skin, or nothing near enough to take it.
  when 'warder_ward_burst' then
    v_was := coalesce((me.stats->>'aegis')::double precision, 0);
    if v_was <= 0 then return jsonb_build_object('why', 'There is no skin over you to break.'); end if;
    v_reach := spell_fx(p_spell, 'reach');
    if not exists (select 1 from creature cr
                    where cr.world_id = p_world and cr.mode = 'wild' and cr.health > 0
                      and cr.to_x between me.x - (v_reach + leg_slack()) and me.x + (v_reach + leg_slack())
                      and cr.to_y between me.y - (v_reach + leg_slack()) and me.y + (v_reach + leg_slack())
                      and (creature_x(cr) - me.x) ^ 2 + (creature_y(cr) - me.y) ^ 2 <= v_reach ^ 2) then
      return jsonb_build_object('why', 'Nothing is within ' || trim_scale(v_reach::numeric) || ' tiles of you to strike.');
    end if;
    update player set stats = jsonb_set(stats, '{aegis}', to_jsonb(0::double precision)) where world_id = p_world and uid = p_uid;
    v_fire := v_was * 100 * spell_fx(p_spell, 'dmg');
    for r in select cr.id from creature cr
              where cr.world_id = p_world and cr.mode = 'wild' and cr.health > 0
                and cr.to_x between me.x - (v_reach + leg_slack()) and me.x + (v_reach + leg_slack())
                and cr.to_y between me.y - (v_reach + leg_slack()) and me.y + (v_reach + leg_slack())
                and (creature_x(cr) - me.x) ^ 2 + (creature_y(cr) - me.y) ^ 2 <= v_reach ^ 2
              order by cr.id loop
      v_on := kindler_fire(p_world, p_uid, r.id, v_fire);
      if (v_on->>'landed')::boolean then v_n := v_n + 1; end if;
      if (v_on->>'died')::boolean then v_dead := v_dead + 1; end if;
    end loop;
    v_said := s.name || ': the skin of ' || faith_pct(v_was) || ' over you breaks for ' || trim_scale(round(v_fire::numeric, 1))
      || ' damage on ' || v_n || case when v_n = 1 then ' creature' else ' creatures' end
      || case when v_dead = 0 then '.' when v_n = 1 then ', and it dies.' when v_dead = 1 then ', and one of them dies.'
              else ', and ' || v_dead || ' of them die.' end;

  -- A Bastion of Stone: its share off every blow on you and on everybody within its reach of you, for as long as it says.
  when 'warder_bastion_of_stone' then
    for r in select pl.uid from player pl
              where pl.world_id = p_world and not pl.away
                and (pl.uid = p_uid or (pl.x - me.x) ^ 2 + (pl.y - me.y) ^ 2 <= spell_fx(p_spell, 'reach') ^ 2)
              order by pl.uid loop
      perform blessing_put(p_world, r.uid, 'bastion_stone', jsonb_build_object(
        'until', now() + make_interval(secs => spell_fx(p_spell, 'secs')), 'cut', spell_fx(p_spell, 'cut')));
      if exists (select 1 from creature cr where cr.world_id = p_world and cr.hunting = r.uid and cr.health > 0) then
        v_hunted := true;
      end if;
      if r.uid <> p_uid then
        v_n := v_n + 1;
        perform tell(p_world, r.uid, me.name || '''s ' || s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs'))
          || ' you take ' || faith_pct(spell_fx(p_spell, 'cut')) || ' less from every blow.', 'system');
      end if;
    end loop;
    if v_hunted then perform class_learn(p_world, p_uid, class_learn_blow()); end if;
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' you'
      || case when v_n = 0 then '' when v_n = 1 then ' and one other' else ' and ' || v_n || ' others' end
      || ' take ' || faith_pct(spell_fx(p_spell, 'cut')) || ' less from every blow.';

  -- An Unbreakable: no blow aimed at you lands, for as long as it says (`hurt_player`).
  when 'warder_unbreakable' then
    perform blessing_put(p_world, p_uid, 'unbreakable', jsonb_build_object(
      'until', now() + make_interval(secs => spell_fx(p_spell, 'secs'))));
    perform class_learn_heal(p_world, p_uid, p_uid);
    v_said := s.name || ': for ' || faith_span(spell_fx(p_spell, 'secs')) || ' no blow aimed at you lands.';

  else
    return jsonb_build_object('why', 'Nothing is written behind that spell yet.');
  end case;

  -- A Kindler's spell is cast out of the stone, and teaches the school as an Ember does (`rpc_spell`); and one that dealt fire
  -- spends the Stoke that was waiting for it (`kindler_fire_at`).
  if s.class = 'kindler' then
    perform skill_raise(p_world, p_uid, 'kindling', 0.8);
    if v_fired then
      update player set blessings = blessings - 'stoke' where world_id = p_world and uid = p_uid and blessings ? 'stoke';
    end if;
  end if;
  -- And a Binder's teaches binding the same, and a Warder's warding.
  if s.class = 'binder' then perform skill_raise(p_world, p_uid, 'binding', 0.8); end if;
  if s.class = 'warder' then perform skill_raise(p_world, p_uid, 'warding', 0.8); end if;

  -- The blow it struck goes back with the sentence, for whoever cast it to read the numbers of (`class_blow`).
  return jsonb_build_object('said', v_said)
    || case when b is not null then jsonb_build_object('blow', b) else '{}'::jsonb end
    || case when v_put is not null then jsonb_build_object('put', v_put) else '{}'::jsonb end
    || case when v_pace is not null then jsonb_build_object('pace', v_pace) else '{}'::jsonb end;
end $function$;

select private.lock_doors();
