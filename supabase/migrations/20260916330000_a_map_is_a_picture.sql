-- A map is a picture of somewhere, and the island is the only thing that knows where.
--
-- Treasure hunting as the real game has it: a map turns up, it shows you a
-- stretch of country with no names and no coordinates on it, and finding the
-- place is your job. Walk until the ground matches, dig, and fight whatever
-- was left to watch it.
--
-- ## The one rule everything else is arranged around
--
-- **The browser must never be told where the treasure is.** That is not a
-- detail of the implementation, it *is* the mechanic — a waypoint turns a
-- hunt into an errand. So the spot lives in `treasure`, a table with RLS on
-- and no policy at all, which makes it unreadable through the front door; the
-- only things that can see it are the two `security definer` calls below, and
-- neither ever answers with a coordinate:
--
--     rpc_treasure_map    a square of ground, tiles and heights, no position
--     rpc_treasure_warm   which band of distance you are in, never a bearing
--
-- Told which way to walk anybody would walk it. Told only "you are close", you
-- have to look at the land. A determined player can still match the square
-- against the land their client already holds and solve for the spot; the real
-- game has exactly the same property, and it costs more effort than finding
-- the place honestly, which is the point.
--
-- ## Where they come from
--
--   * one spadeful or swing in a thousand — `map_odds()`, about two to seven
--     hours of digging depending on how good you are at it
--   * off anything hostile, at odds and a quality that come off its health:
--     `species_def.monster` is already the line between a thing that hunts you
--     and a thing you could have tamed, so no wildermon drops one
--
-- And nowhere else. A chest holds no map: the hunt ends when you open it.
--
-- ## Never on a deed, which has to be true twice
--
-- A spot is rolled off open country — `deed_covering` says whether anybody's
-- square reaches it — but a map made today points at country somebody may put
-- a stake on tomorrow. Refusing the dig would leave a dead map in a pack with
-- no recourse, and refusing the settlement would mean the island explaining a
-- refusal it cannot explain without giving the spot away. So the spot *moves*:
-- read a map whose ground has been settled since and it is quietly buried
-- somewhere else nearby. Nobody notices, because nobody ever had a coordinate
-- to notice it leaving.
--
-- ## And the box test, which is now written once
--
-- `deed_here` asked whether a deed's square reaches a spot by writing the
-- comparison out; this needed the same question asked of *every* deed rather
-- than only yours. That is exactly the shape that had `improve_ceiling`
-- disagreeing with its own examine line for a month, so the comparison is a
-- function now and the two questions are one line each over it:
--
--     deed_covers(deed, x, y)      does this deed's square reach here
--     deed_covering(world, x, y)   every deed whose square does
--     deed_here(world, uid, x, y)  the one of yours that does

/**
 * Does this deed's square reach a spot?
 *
 * One statement of the box, because there are two questions over it and there
 * were about to be three copies.
 */
create or replace function deed_covers(d deed, p_x integer, p_y integer) returns boolean
  language sql immutable as $fn$
  select abs(p_x - d.x) <= d.radius and abs(p_y - d.y) <= d.radius
$fn$;

/** Every settlement whose square reaches a spot, whosever it is. */
create or replace function deed_covering(p_world uuid, p_x integer, p_y integer) returns setof deed
  language sql stable as $fn$
  select d.* from deed d
   where d.world_id = p_world and deed_covers(d, p_x, p_y)
   order by d.founded_at
$fn$;

/** The one of yours that does — founded first, then the earliest you joined. */
create or replace function deed_here(p_world uuid, p_uid uuid, p_x integer, p_y integer)
  returns deed language sql stable as $fn$
  select d.* from deeds_of(p_world, p_uid) d where deed_covers(d, p_x, p_y) limit 1
$fn$;

/*
 * Where each one is, which nothing may read.
 *
 * `private.lock_doors()` gives a public read policy to every table that has no
 * `world_id` or `uid` on it — that is how it tells the rulebook from the
 * world — so a table with `world_id` gets nothing by default, which is what
 * this wants. RLS on and no policy written is a table PostgREST answers empty
 * for, whoever asks; the grants go on top of that so it is shut twice.
 *
 * Keyed on the map itself, so the row follows the map through every trade and
 * into every pack, bag and crate with nothing to update. And `on delete
 * cascade`, because a map left lying in a field rots — `ground_sweep` only
 * touches what is on the ground, a crate being a roof and a pack a pair of
 * hands — and a hoard nobody can ever find again is a row that should have
 * gone with it.
 */
create table if not exists treasure (
  item_id bigint primary key references item (id) on delete cascade,
  world_id uuid not null references world (id) on delete cascade,
  x integer not null,
  y integer not null,
  tier text not null
);
create index if not exists treasure_world on treasure (world_id);
alter table treasure enable row level security;
revoke all on table treasure from anon, authenticated;

/** What a map of this quality is a map to. */
create or replace function treasure_tier(p_ql double precision) returns treasure_def
  language sql stable as $fn$
  select t.* from treasure_def t where p_ql >= t.min_ql order by t.ord desc limit 1
$fn$;

/**
 * How good a map your skill and the tool in your hand turn up.
 *
 * Deliberately not `product_ql`, which everything else out of the ground uses.
 * That one is a lottery rather than a curve: with a tool it is `random() * 100
 * < tool_ql` for your whole skill and **quality 1 otherwise**, so a QL 60
 * shovel answers QL 1 two times in five. That is the right shape for a
 * spadeful of dirt, which costs twenty seconds. It is the wrong shape for the
 * one spadeful in a thousand: five hours of digging should not come back as a
 * worn map because a coin landed badly. A floor under it, skill weighted a
 * little above the tool, and a quarter either way of luck.
 */
create or replace function map_ql(p_skill double precision, p_tool_ql double precision)
  returns double precision language sql as $fn$
  select greatest(1, least(100,
    (20 + 0.45 * greatest(1, p_skill) + 0.35 * greatest(0, p_tool_ql)) * (0.75 + random() * 0.5)))
$fn$;

/** And how good a map comes off a body, which owes nothing to your tools. */
create or replace function map_ql_beast(p_health double precision) returns double precision
  language sql as $fn$
  select greatest(1, least(100, (12 + p_health / 8) * (0.8 + random() * 0.4)))
$fn$;

/** And the odds of one at all off a body that size. */
create or replace function map_chance_beast(p_health double precision) returns double precision
  language sql stable as $fn$
  select least(map_kill_cap(), p_health / map_kill_scale())
$fn$;

/**
 * Somewhere to bury one: dry ground, walkable, inside the island, on nobody's
 * deed.
 *
 * Walkable because something has to stand there and guard it, and dry well
 * clear of the waterline rather than merely above it — a hoard in the surf is
 * a hoard nobody can fight over. Sixty goes at it and then nothing, which is
 * an honest answer: on a small or a crowded island there may be no such spot,
 * and a map to the sea would be worse than no map.
 *
 * `sqrt(random())` rather than `random()` so the spots are spread evenly over
 * the circle instead of bunched at the middle.
 */
create or replace function treasure_spot(p_world uuid, p_x double precision, p_y double precision)
  returns table (x integer, y integer) language plpgsql as $fn$
declare v_size int; v_x int; v_y int; v_try int; v_a double precision; v_r double precision;
begin
  select w.size into v_size from world w where w.id = p_world;
  for v_try in 1..60 loop
    v_a := random() * 2 * pi();
    /*
     * Scaled to the island, not written flat. A hundred and fifty tiles is
     * four minutes' walk on the island people play on and is off the edge of
     * a small one entirely — on sixteen tiles a side every candidate would
     * land in the sea and the roll would come back empty, which is a map
     * nobody gets rather than a map close by.
     */
    v_r := least(map_range(), greatest(4, v_size / 3.0)) * sqrt(random());
    v_x := floor(p_x + cos(v_a) * v_r)::int;
    v_y := floor(p_y + sin(v_a) * v_r)::int;
    continue when v_x < 1 or v_y < 1 or v_x >= v_size - 1 or v_y >= v_size - 1;
    continue when not creature_tile_ok(p_world, v_x, v_y);
    continue when coalesce(centre_height(p_world, v_x, v_y), -1) < 4;
    continue when exists (select 1 from deed_covering(p_world, v_x, v_y));
    x := v_x; y := v_y;
    return next;
    return;
  end loop;
end $fn$;

/**
 * Bury one and put the map of it into somebody's hands.
 *
 * The tier goes in `extra`, so the map reads "Treasure map (grand)" in a pack
 * and a trader can see what is being sold without either of them knowing where
 * it points.
 */
create or replace function bury_treasure(p_world uuid, p_uid uuid, p_ql double precision,
                                         p_x double precision, p_y double precision)
  returns bigint language plpgsql as $fn$
declare v_spot record; v_tier treasure_def; v_id bigint;
begin
  select * into v_spot from treasure_spot(p_world, p_x, p_y);
  -- Nowhere to put it. Better no map than a map to the sea.
  if v_spot.x is null then return null; end if;
  v_tier := treasure_tier(p_ql);
  v_id := give(p_world, p_uid, 'treasure_map', 1, p_ql, v_tier.id);
  insert into treasure (item_id, world_id, x, y, tier)
    values (v_id, p_world, v_spot.x, v_spot.y, v_tier.id);
  perform journal_note(p_world, p_uid, 'map');
  perform tell(p_world, p_uid, 'Oiled hide, folded small and waxed at the edge: a '
    || v_tier.name || '. (QL ' || to_char(p_ql, 'FM990.0')
    || ') Read it to see what country it is a picture of.', 'skill');
  return v_id;
end $fn$;

/** One spadeful in a thousand comes up with something that is not dirt. */
create or replace function maybe_map(p_world uuid, p_uid uuid, p_skill double precision,
                                     p_tool_ql double precision) returns void
  language plpgsql as $fn$
declare p player;
begin
  if random() >= map_odds() then return; end if;
  select * into p from player where world_id = p_world and uid = p_uid;
  if not found then return; end if;
  perform bury_treasure(p_world, p_uid, map_ql(p_skill, p_tool_ql), p.x, p.y);
end $fn$;

/**
 * Where a map points, now.
 *
 * "Now", because a deed may have gone in over it since it was drawn. The spot
 * moves rather than the map dying, and it moves relative to where it already
 * was — so a hoard settled over is reburied in the same country, not across
 * the island.
 */
create or replace function treasure_at(p_item bigint) returns treasure
  language plpgsql as $fn$
declare v_t treasure; v_spot record;
begin
  select * into v_t from treasure where item_id = p_item;
  if not found then return null; end if;
  if not exists (select 1 from deed_covering(v_t.world_id, v_t.x, v_t.y)) then return v_t; end if;
  select * into v_spot from treasure_spot(v_t.world_id, v_t.x, v_t.y);
  if v_spot.x is null then return v_t; end if;
  update treasure set x = v_spot.x, y = v_spot.y where item_id = p_item returning * into v_t;
  return v_t;
end $fn$;

/** The one action in this family. */
create or replace function treasure_action(p_action text) returns boolean
  language sql immutable as $fn$ select p_action = 'unearth' $fn$;

/**
 * Why you may not dig here, in the map's own words.
 *
 * The distance bands are the refusal: a map that will not be dug tells you how
 * warm you are, which is the whole of the search. `map_band` holds the
 * sentences and is crossed from the browser, so both sides say the same thing.
 */
create or replace function treasure_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
  returns text language plpgsql as $fn$
declare v_map item; v_t treasure; p player; v_d double precision; v_say text;
begin
  v_map := carried(p_world, p_uid, (p_target->>'uid')::bigint);
  if v_map.id is null then return 'You are not holding a map.'; end if;
  if v_map.def <> 'treasure_map' then return 'That is not a map.'; end if;
  v_t := treasure_at(v_map.id);
  if v_t.item_id is null then
    return 'The hide is worn blank. Whatever was drawn on it is gone.';
  end if;
  select * into p from player where world_id = p_world and uid = p_uid;
  if not found then return 'You are not on this island.'; end if;
  v_d := sqrt((p.x - (v_t.x + 0.5)) ^ 2 + (p.y - (v_t.y + 0.5)) ^ 2);
  if v_d <= unearth_reach() then return null; end if;
  select b.say into v_say from map_band b where v_d <= b.within order by b.ord limit 1;
  return coalesce(v_say, 'Nothing here looks anything like the map.');
end $fn$;

/**
 * Dig it up, and meet what was left over it.
 *
 * The guard comes out of the ground first and the hoard lies where it fell, so
 * collecting it is a fight rather than a formality — which is the difference
 * between a hoard and a delivery. It is dropped on the ground rather than
 * handed over for the same reason.
 *
 * What is in it: lumps off `hoard_metal`, which is already what a dragon is
 * sleeping on when you butcher one, so a hoard is made of the same stuff
 * however it is come by; and things off `improvable_def`, rolled for rarity
 * like anything else made well.
 */
create or replace function perform_treasure(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
  returns void language plpgsql as $fn$
declare v_map item; v_t treasure; v_tier treasure_def; v_i int; v_got text;
        v_ql double precision; v_rare text; v_c int;
begin
  v_map := carried(p_world, p_uid, (p_target->>'uid')::bigint);
  if v_map.id is null then return; end if;
  v_t := treasure_at(v_map.id);
  if v_t.item_id is null then return; end if;
  select * into v_tier from treasure_def where id = v_t.tier;

  -- What was left to watch it, before anything is worth picking up.
  for v_i in 1..v_tier.guards loop
    perform creature_spawn(p_world, v_tier.guard, v_t.x + 0.5, v_t.y + 0.5, 'wild');
  end loop;

  for v_i in 1..v_tier.lumps loop
    select item into v_got from hoard_metal order by random() limit 1;
    v_ql := greatest(1, least(100, v_map.ql * (0.7 + random() * 0.5)));
    perform drop_on_ground(p_world, v_t.x, v_t.y, v_got, v_ql);
  end loop;
  for v_i in 1..v_tier.things loop
    /*
     * A tool or a blade, not a wardrobe. `improvable_def` is everything worth
     * bettering and that includes the furniture and the boats — the suite's
     * first hoard came up with a cart and a chest in it, which is a thing
     * nobody buried. `item_def.category` already draws the line: 55 tools,
     * heaviest eleven kilos, against 38 pieces of `misc` that run to a
     * six-hundred-kilo sailing boat.
     */
    select i.item into v_got from improvable_def i join item_def d on d.id = i.item
     where d.category = 'tool' order by random() limit 1;
    v_ql := greatest(1, least(100, v_map.ql * (0.7 + random() * 0.5)));
    v_rare := rarity_roll();
    v_c := drop_on_ground(p_world, v_t.x, v_t.y, v_got, v_ql);
    update item set rare = v_rare where world_id = p_world and holder = 'ground'
      and gx = v_t.x and gy = v_t.y and def = v_got and rare is null and v_rare is not null;
  end loop;

  perform consume(p_world, p_uid, 'treasure_map', 1, v_map.id);
  perform journal_note(p_world, p_uid, 'hoard');
  perform tell(p_world, p_uid, 'The spade goes through rotten board and the hoard is open — '
    || v_tier.lumps || ' lump' || case when v_tier.lumps = 1 then '' else 's' end
    || ' and ' || v_tier.things || ' thing' || case when v_tier.things = 1 then '' else 's' end
    || ' lying where they fell. And something was left to watch over it.', 'event');
  perform land_announce(p_world, v_t.x, v_t.y);
end $fn$;

/**
 * The picture, which is the whole of what a browser is ever told.
 *
 * A square of ground `map_snippet()` tiles a side with the hoard at the middle
 * of it — the tiles, the corner heights, and not one number that says where on
 * the island any of it is. The browser draws it the way it draws the minimap
 * and the player goes looking.
 */
create or replace function rpc_treasure_map(p_world uuid, p_item bigint) returns jsonb
  language plpgsql security definer set search_path to 'public' as $fn$
declare me uuid := auth.uid(); v_map item; v_t treasure; v_n int; v_x0 int; v_y0 int;
        v_tiles int[]; v_high int[]; i int; j int; v_size int;
begin
  if me is null then raise exception 'not signed in'; end if;
  v_map := carried(p_world, me, p_item);
  if v_map.id is null or v_map.def <> 'treasure_map' then
    return jsonb_build_object('why', 'You are not holding a map.');
  end if;
  v_t := treasure_at(v_map.id);
  if v_t.item_id is null then
    return jsonb_build_object('why', 'The hide is worn blank.');
  end if;
  select w.size into v_size from world w where w.id = p_world;
  v_n := map_snippet()::int;
  v_x0 := v_t.x - v_n / 2;
  v_y0 := v_t.y - v_n / 2;
  v_tiles := '{}'; v_high := '{}';
  /*
   * The hoard stays at the middle of the picture and the edge of the island
   * is drawn as what it is: open sea. Clamping the window instead would put
   * the hoard off-centre, which is a worse answer twice over — the browser
   * would have to be told how far off-centre, and that is a coordinate.
   *
   * `land_tile` raises on a square outside the island rather than answering,
   * so the guard is here. Found by the suite the first time a hoard was
   * rolled within twelve tiles of a coast, which on a sixty-four tile island
   * is most of it.
   */
  for j in 0..v_n - 1 loop
    for i in 0..v_n - 1 loop
      if v_x0 + i < 0 or v_y0 + j < 0 or v_x0 + i >= v_size or v_y0 + j >= v_size then
        v_tiles := v_tiles || -1;
      else
        v_tiles := v_tiles || land_tile(p_world, v_x0 + i, v_y0 + j);
      end if;
    end loop;
  end loop;
  -- Corners, which are one more each way, so the heights close the square.
  for j in 0..v_n loop
    for i in 0..v_n loop
      if v_x0 + i < 0 or v_y0 + j < 0 or v_x0 + i > v_size or v_y0 + j > v_size then
        v_high := v_high || -1000;
      else
        v_high := v_high || land_height(p_world, v_x0 + i, v_y0 + j);
      end if;
    end loop;
  end loop;
  return jsonb_build_object('side', v_n, 'tier', v_t.tier, 'ql', v_map.ql,
    'tiles', to_jsonb(v_tiles), 'heights', to_jsonb(v_high));
end $fn$;

/** How warm you are: a band, never a bearing. */
create or replace function rpc_treasure_warm(p_world uuid, p_item bigint) returns jsonb
  language plpgsql security definer set search_path to 'public' as $fn$
declare me uuid := auth.uid(); v_why text;
begin
  if me is null then raise exception 'not signed in'; end if;
  v_why := treasure_refusal(p_world, me, 'unearth', jsonb_build_object('uid', p_item));
  return jsonb_build_object('here', v_why is null,
    'say', coalesce(v_why, 'The ground under your feet is the ground on the map.'));
end $fn$;

CREATE OR REPLACE FUNCTION public.wound_beast(p_world uuid, p_id integer, p_dmg double precision, p_from_x double precision DEFAULT NULL::double precision, p_from_y double precision DEFAULT NULL::double precision, p_teller uuid DEFAULT NULL::uuid, p_by integer DEFAULT NULL::integer)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
declare c creature; d species_def; cx double precision; cy double precision;
        v_len double precision; v_size double precision; v_killer creature;
begin
  perform creature_settle(p_world, p_id);
  select * into c from creature where world_id = p_world and id = p_id for update;
  if not found then return false; end if;
  select * into d from species_def where id = c.species;
  cx := creature_x(c); cy := creature_y(c);

  update creature set health = c.health - p_dmg, hurt_at = now(), hurt_by = p_by,
      coaxed = 0, coaxed_at = null,
      from_x = cx, from_y = cy, to_x = cx, to_y = cy, leg_at = now(), leg_ends = now(),
      settled_at = now()
    where world_id = p_world and id = p_id;

  if c.health - p_dmg > 0 then
    if c.mode = 'wild' and d.timid and p_from_x is not null then
      v_len := greatest(0.001, sqrt((cx - p_from_x) ^ 2 + (cy - p_from_y) ^ 2));
      update creature set to_x = cx + ((cx - p_from_x) / v_len) * 5, to_y = cy + ((cy - p_from_y) / v_len) * 5,
          leg_ends = now() + interval '3 seconds', until = now() + interval '3 seconds'
        where world_id = p_world and id = p_id;
    end if;
    return false;
  end if;

  -- What the carcass is worth follows the size of the thing that left it.
  v_size := (age_row(c.born)).yield;
  delete from creature where world_id = p_world and id = p_id;
  -- Nothing goes on fighting something that is no longer there.
  update creature set enemy = null where world_id = p_world and enemy = p_id;
  perform drop_on_ground(p_world, floor(cx)::int, floor(cy)::int, 'corpse',
    (15 + random() * 35) * v_size, d.name);

  -- A hunter marks where its kill went down and comes back for it.
  if p_by is not null then
    select * into v_killer from creature where world_id = p_world and id = p_by;
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
        || ' goes down. Butcher it before it rots: there is a great deal on it.', 'system');
    else
      perform tell(p_world, p_teller, 'You kill the wild ' || lower(d.name)
        || '. Its corpse lies where it fell.', 'event');
    end if;
  end if;
  return true;
end $function$;

CREATE OR REPLACE FUNCTION public.act_perform(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare d action_def; tq double precision; s double precision; cx int; cy int; tx int; ty int;
        t tile_def; left_dirt int; made_ql double precision; yield text; gained double precision; tool_id bigint;
begin
  if last_action(p_action) then
    perform perform_last(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if faith_action(p_action) then
    perform perform_faith(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if ride_action(p_action) then
    perform perform_ride(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if hands_action(p_action) then
    perform perform_hands(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if liquid_action(p_action) then
    perform perform_liquid(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if forge_action(p_action) then
    perform perform_forge(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if holding_action(p_action) then
    perform perform_holding(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if settlement_action(p_action) then
    perform perform_settlement(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if dig_action(p_action) then
    perform perform_dig(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if trap_action(p_action) then
    perform perform_trap(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if ground_action(p_action) then
    perform perform_ground(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if build_action(p_action) then
    perform perform_building(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if p_action = 'found_settlement' then
    perform perform_deed(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if creature_action(p_action) then
    perform perform_creature(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if fight_action(p_action) then
    perform perform_fight(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if crate_action(p_action) then
    perform perform_crate(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if item_action(p_action) then
    perform perform_item(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if firing_action(p_action) then
    perform perform_firing(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if fire_action(p_action) then
    perform perform_fire(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if treasure_action(p_action) then
    perform perform_treasure(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if p_action in ('mine', 'chip_corner', 'pack', 'cultivate', 'pave_gravel', 'pave_cobble', 'drop_dirt_here') then
    perform perform_terrain(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if p_action in ('cut_down', 'forage', 'botanize', 'collect') then
    perform perform_gather(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if p_action in ('till', 'plant_seed', 'tend_crop', 'harvest_crop', 'clear_field') then
    perform perform_farm(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if p_action in ('fish', 'drag_net') then
    perform perform_fish(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if exists (select 1 from recipe where id = p_action) then
    perform perform_craft(p_world, p_uid, p_action, p_target);
    return;
  end if;

  select * into d from action_def where id = p_action;
  s := case when d.skill is null then 50 else skill_of(p_world, p_uid, d.skill) end;
  tq := case when d.tool is null then 0 else tool_ql(p_world, p_uid, d.tool) end;

  if p_action = 'dig' then
    cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
    tx := (p_target->>'x')::int;  ty := (p_target->>'y')::int;
    select * into t from tile_def where id = land_tile(p_world, tx, ty);
    select i.id into tool_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = d.tool
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if tool_id is not null then perform wear_tool(tool_id); end if;
    if not skill_check(s, d.difficulty, tq) then
      perform tell(p_world, p_uid, 'You fail to dig anything useful.', 'event');
      return;
    end if;
    perform land_set_height(p_world, cx, cy, land_height(p_world, cx, cy) - 1);
    left_dirt := land_dirt(p_world, cx, cy) - 1;
    perform land_set_dirt(p_world, cx, cy, left_dirt);
    if t.turns_to_dirt then perform land_set_tile(p_world, tx, ty, 1); end if;
    -- Dug to the rock, the tile becomes rock and shows the seam under it.
    perform reconcile_around(p_world, cx, cy);
    perform land_announce(p_world, tx, ty);
    if left_dirt <= 0 then
      perform tell(p_world, p_uid, 'Your shovel grates on bare rock.', 'event');
    end if;
    yield := coalesce(t.dig_yield, 'dirt');
    made_ql := product_ql(s, tq);
    perform give(p_world, p_uid, yield, 1, made_ql);
    -- And one spadeful in a thousand that is not dirt at all.
    perform maybe_map(p_world, p_uid, s, tq);
    gained := skill_raise(p_world, p_uid, d.skill, 1);
    perform tell(p_world, p_uid,
      'You dig up some ' || lower((select name from item_def where id = yield)) ||
      '. (QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
    perform skill_said(p_world, p_uid, d.skill, gained);
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.perform_terrain(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare d action_def; cx int; cy int; tx int; ty int; t tile_def; r rock_def;
        s double precision; tq double precision; yields text; made_ql double precision;
        gained double precision; tool_id bigint; here int;
begin
  select * into d from action_def where id = p_action;
  cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
  tx := (p_target->>'x')::int;  ty := (p_target->>'y')::int;
  s := case when d.skill is null then 50 else skill_of(p_world, p_uid, d.skill) end;
  tq := case when d.tool is null then 0 else tool_ql(p_world, p_uid, d.tool) end;
  if d.tool is not null then
    select i.id into tool_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = d.tool
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if tool_id is not null then perform wear_tool(tool_id); end if;
  end if;

  if p_action = 'mine' then
    if not skill_check(s, d.difficulty, tq) then
      perform tell(p_world, p_uid, 'The rock is hard and you fail to loosen anything.', 'event');
      return;
    end if;
    r := bedrock_at(p_world, tx, ty);
    yields := case when land_tile(p_world, tx, ty) = 4 then r.yields else 'rock_shards' end;
    -- The first ore out of the ground is a thing worth remembering.
    if yields like '%\_ore' then perform journal_note(p_world, p_uid, 'ore'); end if;
    made_ql := least(ore_max_ql((select seed from world where id = p_world), tx, ty), product_ql(s, tq));
    perform give(p_world, p_uid, yields, 1, made_ql);
    -- And one swing in a thousand that brings out something nobody quarried.
    perform maybe_map(p_world, p_uid, s, tq);
    perform tell(p_world, p_uid,
      case when yields like '%lump' then 'You chip a ' else 'You mine some ' end
      || lower((select coalesce(name, yields) from item_def where id = yields))
      || case when yields like '%lump' then ' out of the vein.' else '.' end
      || ' (QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
    -- Cutting the face back is its own job. Now and again one comes down anyway.
    if random() < 0.01 then
      perform land_set_height(p_world, cx, cy, land_height(p_world, cx, cy) - 1);
      perform land_set_dirt(p_world, cx, cy, 0);
      perform reconcile_around(p_world, cx, cy);
      perform tell(p_world, p_uid, 'A slab breaks away of its own accord and the face drops.', 'event');
    end if;
    gained := skill_raise(p_world, p_uid, 'mining', 1);

  elsif p_action = 'chip_corner' then
    if random() >= 0.25 then
      perform tell(p_world, p_uid, 'You work at the corner and find no line in it. The face holds.', 'event');
      return;
    end if;
    perform land_set_height(p_world, cx, cy, land_height(p_world, cx, cy) - 1);
    perform land_set_dirt(p_world, cx, cy, 0);
    perform reconcile_around(p_world, cx, cy);
    r := bedrock_at(p_world, tx, ty);
    yields := case when land_tile(p_world, tx, ty) = 4 then r.yields else 'rock_shards' end;
    -- The first ore out of the ground is a thing worth remembering.
    if yields like '%\_ore' then perform journal_note(p_world, p_uid, 'ore'); end if;
    made_ql := least(ore_max_ql((select seed from world where id = p_world), tx, ty), product_ql(s, tq));
    perform give(p_world, p_uid, yields, 1, made_ql);
    perform maybe_map(p_world, p_uid, s, tq);
    perform tell(p_world, p_uid, 'The corner breaks away and drops a step. You gather the '
      || lower((select coalesce(name, yields) from item_def where id = yields))
      || '. (QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
    gained := skill_raise(p_world, p_uid, 'mining', 1);

  elsif p_action = 'pack' then
    here := land_tile(p_world, tx, ty);
    perform land_set_tile(p_world, tx, ty, 2);
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, case when here <> 1
      then 'You cut the turf away and tread the ground down firm.'
      else 'You pack the dirt down firmly.' end, 'event');
    gained := skill_raise(p_world, p_uid, 'digging', 1);

  elsif p_action = 'cultivate' then
    perform land_set_tile(p_world, tx, ty, 1);
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You break up the packed earth.', 'event');
    gained := skill_raise(p_world, p_uid, 'digging', 1);

  elsif p_action = 'pave_gravel' then
    if not consume(p_world, p_uid, 'rock_shards', 1) then return; end if;
    perform land_set_tile(p_world, tx, ty, 13);
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You spread the crushed rock into a gravel surface.', 'event');
    gained := skill_raise(p_world, p_uid, 'paving', 1);

  elsif p_action = 'pave_cobble' then
    if not consume(p_world, p_uid, 'stone_brick', 1) then return; end if;
    perform land_set_tile(p_world, tx, ty, 14);
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You lay the cobblestones.', 'event');
    gained := skill_raise(p_world, p_uid, 'paving', 1);

  elsif p_action = 'drop_dirt_here' then
    if not consume(p_world, p_uid, 'dirt', 1) then return; end if;
    select round(x)::int, round(y)::int into cx, cy from player where world_id = p_world and uid = p_uid;
    perform land_set_height(p_world, cx, cy, land_height(p_world, cx, cy) + 1);
    perform land_set_dirt(p_world, cx, cy, land_dirt(p_world, cx, cy) + 1);
    perform reconcile_around(p_world, cx, cy);
    perform tell(p_world, p_uid, 'You drop the dirt at your feet, raising the ground.', 'event');
    gained := skill_raise(p_world, p_uid, 'digging', 1);
  end if;

  perform skill_said(p_world, p_uid, d.skill, gained);
end $function$;

CREATE OR REPLACE FUNCTION public.act_refusal_rules(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare d action_def; p player; cx int; cy int; tx int; ty int; t tile_def; aimed text;
begin
  select * into d from action_def where id = p_action;
  if not found then return 'There is no such thing as ' || p_action || '.'; end if;
  select * into p from player where world_id = p_world and uid = p_uid;
  if not found then return 'You are not on this island.'; end if;
  -- Deliberately not "are you busy": asked of queued jobs too. That is rpc_act's.
  if not act_ported(p_action) then
    return 'You cannot ' || lower(d.label) || ' on this island yet.';
  end if;

  aimed := p_target->>'kind';
  -- The hour comes for a dam in young whoever is or is not standing there, and
  -- somebody is always about to do something. This is where they find out.
  perform herd_settle(p_world);
  -- The last ten answer for their own reach, every one of them: a bridge is
  -- worked from either bank, a bed is furniture, and a beast is not at a tile.
  -- First of all, because a map is an item and every other family that takes
  -- an item wants one it can name a use for. This one is aimed at the map.
  if treasure_action(p_action) then
    return treasure_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if last_action(p_action) then
    return last_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Then the only family that does not care what it is
  -- pointed at: a prayer wants an altar, a cast wants a name, and the other
  -- three want nothing but the ground you are sitting on.
  if faith_action(p_action) then
    return faith_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Then the ones asked of a beast, which is not at a
  -- tile, and half of a cart, which is furniture and would otherwise be handed
  -- to the code that lights fires. Both answer for their own reach.
  if ride_action(p_action) then
    return ride_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if hands_action(p_action) then
    return hands_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Before the one that lights fires, which is what pointing at furniture has
  -- meant up to now: a barrel is furniture too, and tipping it out is not a fire.
  if liquid_action(p_action) then
    return liquid_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Also before the one that lights fires: an oven is furniture and an anvil
  -- is pointed at the same way a kiln is, and neither wants that route.
  if forge_action(p_action) then
    return forge_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if holding_action(p_action) then
    return holding_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- The token is under your feet and a post answers for its own reach, so
  -- neither wants the reach check below.
  if settlement_action(p_action) then
    return settlement_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if dig_action(p_action) then
    return dig_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- A trap answers for its own reach, and rolls itself forward before it
  -- answers anything at all.
  if trap_action(p_action) then
    return trap_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Working the ground answers for its own reach for the same reason: a
  -- corner is a place rather than a thing, and `drop_dirt` names one.
  if ground_action(p_action) then
    if not in_reach(p.x, p.y, p_target, d.corner, d.range) then return 'You are too far away from that.'; end if;
    if d.tool is not null and tool_ql(p_world, p_uid, d.tool) <= 0 then
      return 'You need a ' || lower((select coalesce(name, d.tool) from item_def where id = d.tool)) || ' to ' || lower(d.label) || '.';
    end if;
    return ground_refusal(p_world, p_uid, p_action, p_target);
  end if;
  /*
   * A furnace is brought up to date before anything asks it a question: its
   * fire and its queue together, so that "is anything finished" is answered
   * about now rather than about whenever somebody last stood here.
   */
  if aimed in ('smelter', 'kiln') then
    perform furnace_settle(p_world, nullif(p_target->>'id', '')::bigint);
  end if;
  if item_action(p_action) then
    return item_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if firing_action(p_action) then
    return firing_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if aimed in ('campfire', 'smelter', 'kiln', 'furniture', 'anvil') or fire_action(p_action) then
    return fire_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- A crate is reached for rather than stood in front of, so it answers for
  -- its own reach the way the creatures do.
  if crate_action(p_action) then
    return crate_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- The stake is in your hand and the ground is under your feet: nothing to reach for.
  if p_action = 'found_settlement' then
    return deed_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- A creature is not at a tile, it is wherever its last leg left it, so the
  -- reach check below cannot answer for it. Both of these do their own; the
  -- fighting ones reach as far as what is in your hand, which is further.
  if creature_action(p_action) then
    return creature_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if fight_action(p_action) then
    return fight_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if not in_reach(p.x, p.y, p_target, d.corner, d.range) then return 'You are too far away from that.'; end if;
  if d.tool is not null and tool_ql(p_world, p_uid, d.tool) <= 0 then
    return 'You need a ' || lower((select coalesce(name, d.tool) from item_def where id = d.tool)) || ' to ' || lower(d.label) || '.';
  end if;
  if build_action(p_action) then
    return build_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if p_action in ('mine', 'chip_corner', 'pack', 'cultivate', 'pave_gravel', 'pave_cobble', 'drop_dirt_here') then
    return terrain_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if p_action in ('cut_down', 'forage', 'botanize', 'collect') then
    return gather_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if p_action in ('till', 'plant_seed', 'tend_crop', 'harvest_crop', 'clear_field') then
    return farm_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if p_action in ('fish', 'drag_net') then
    return fish_refusal(p_world, p_uid, p_action, p_target);
  end if;

  if exists (select 1 from recipe where id = p_action) then
    return craft_refusal(p_world, p_uid, p_action, nullif(p_target->>'uid', '')::bigint);
  end if;

  if p_action = 'dig' then
    cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
    tx := (p_target->>'x')::int;  ty := (p_target->>'y')::int;
    select * into t from tile_def where id = land_tile(p_world, tx, ty);
    if t.dig_yield is null then return 'You cannot dig that.'; end if;
    if land_height(p_world, cx, cy) <= 0 then return 'You cannot dig below the water level.'; end if;
    if land_dirt(p_world, cx, cy) <= 0 then
      return 'That corner is bare rock. Only a pickaxe will take it lower.';
    end if;
  end if;
  return null;
end $function$;


/**
 * And the list of what this island can actually do, which `act_refusal_rules`
 * reads before anything else: an action missing from here is refused as
 * unported however well it works.
 */
create or replace function act_ported(p_action text) returns boolean
  language sql stable as $fn$
  select exists (select 1 from recipe where id = p_action)
      or last_action(p_action)
      or faith_action(p_action)
      or ride_action(p_action)
      or trap_action(p_action)
      or dig_action(p_action)
      or treasure_action(p_action)
      or settlement_action(p_action)
      or holding_action(p_action)
      or forge_action(p_action)
      or liquid_action(p_action)
      or hands_action(p_action)
      or ground_action(p_action)
      or item_action(p_action)
      or firing_action(p_action)
      or fire_action(p_action)
      or crate_action(p_action)
      or build_action(p_action)
      or creature_action(p_action)
      or fight_action(p_action)
      or p_action in ('dig', 'mine', 'chip_corner', 'pack', 'cultivate', 'pave_gravel', 'pave_cobble',
                      'drop_dirt_here', 'cut_down', 'forage', 'botanize', 'collect',
                      'till', 'plant_seed', 'tend_crop', 'harvest_crop', 'clear_field',
                      'fish', 'drag_net', 'found_settlement', 'set_to_work')
$fn$;

select private.lock_doors();

notify pgrst, 'reload schema';
