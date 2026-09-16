-- A face at the tide line is a face you can work.
--
-- Reported from the island with a picture of it: a copper vein at (2556,
-- 2989), "You cannot mine below the water level.", and no water drawn on that
-- tile or anywhere near it. Both halves of that were wrong, off one line:
--
--     if rock_height(p_world, cx, cy) <= 0 then
--
-- **The wrong height.** `rock_height` is `land_height - land_dirt` — the
-- bedrock under the soil, not the ground. A corner a mineable tile shares with
-- a meadow carries that meadow's soil, so a face standing well clear of the
-- sea is refused because the rock buried beside it is not. Water is a question
-- about the surface. `has_water` asks the surface; so does every browser that
-- draws a coastline.
--
-- **And a height out where the two do agree.** `<= 0` refuses a face standing
-- *at* the waterline, and water is drawn at `< 0`. So nought is the one height
-- that refuses and shows nothing to refuse for — and nought is where a shore
-- face sits.
--
-- The rule under the message was worth loosening anyway. A quarry at the tide
-- line is a thing people build; ten units of water is about waist deep and you
-- work standing in it. Past that you are swimming, and nobody swings a pick
-- while swimming — which is what the refusal now says.
--
--     corner height   before                        after
--     --------------  ----------------------------  ---------------------
--       1 and up      allowed, unless soil beside   allowed
--       0             refused, "below the water"     allowed
--      -1 .. -10      refused                       allowed, standing in it
--     -11 and down    refused                       refused, "too deep"
--
-- `mine_depth()` is the same ten the browser reads, crossed from `actions.ts`
-- by `npm run defs`, so there is one number and not two.

CREATE OR REPLACE FUNCTION public.terrain_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare cx int; cy int; tx int; ty int; t tile_def; r rock_def; mining double precision; here int;
begin
  cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
  tx := (p_target->>'x')::int;  ty := (p_target->>'y')::int;

  if p_action in ('mine', 'chip_corner') then
    select * into t from tile_def where id = land_tile(p_world, tx, ty);
    if not t.mineable then return 'There is no rock face there to work.'; end if;
    /*
     * How deep the water over a face may be and still be worked.
     *
     * This was `rock_height(corner) <= 0`, and the report that moved it came
     * with a picture: a copper vein, "You cannot mine below the water level",
     * and no water drawn anywhere on the tile. Two things were wrong in the
     * one line.
     *
     * It asked the wrong height. `rock_height` is the surface less the soil
     * over it, so a corner shared with a meadow refuses a face standing fifty
     * units above the sea because the bedrock buried under the grass beside it
     * is below sea level. Water is a question about the surface, and the
     * surface is what `has_water` reads and what a browser draws.
     *
     * And it was a height out even where the two agree: `<= 0` refuses a face
     * standing *at* the waterline, while water is only drawn below it. Nought
     * is the one height that refuses and shows nothing — which is exactly
     * where a shore face sits.
     *
     * So: the corner's own height, and `mine_depth` of water allowed over it.
     * That is about waist deep at the tide line and you work standing in it,
     * which is what a shore quarry looks like. Past that you are swimming, and
     * nobody swings a pick while swimming — so the refusal says that, rather
     * than blaming water for ground that is not under any.
     */
    if land_height(p_world, cx, cy) < -mine_depth() then
      return 'The water is too deep here to work in.';
    end if;
    -- A seam only gives up its metal to somebody who knows how to take it.
    if land_tile(p_world, tx, ty) = 4 then
      r := bedrock_at(p_world, tx, ty);
      mining := skill_of(p_world, p_uid, 'mining');
      if r.ore and mining < r.level then
        -- `FM990.9` leaves "5." on a whole number, which reads as a typo in the
        -- middle of a sentence. The browser prints the number as it is.
        return r.name || ' needs mining ' || rtrim(rtrim(to_char(r.level, 'FM990.99'), '0'), '.')
          || ' to work. Yours is ' || to_char(mining, 'FM990.0') || '.';
      end if;
    end if;
    return null;
  end if;

  here := land_tile(p_world, tx, ty);
  if p_action = 'pack' then
    if not packable(here) then return 'That ground will not pack down.'; end if;
  elsif p_action = 'cultivate' then
    if here <> 2 then return 'Only packed earth can be broken up.'; end if;
  elsif p_action in ('pave_gravel', 'pave_cobble') then
    if here <> 2 then return 'Pack the ground down before paving it.'; end if;
    if p_action = 'pave_gravel' and pack_count(p_world, p_uid, 'rock_shards') < 1 then
      return 'You need rock shards to pave with gravel.';
    end if;
    if p_action = 'pave_cobble' and pack_count(p_world, p_uid, 'stone_brick') < 1 then
      return 'You need a stone brick to lay cobblestone.';
    end if;
  elsif p_action = 'drop_dirt_here' then
    if pack_count(p_world, p_uid, 'dirt') < 1 then return 'You have no dirt to drop.'; end if;
    -- The corner nearest whoever is standing there, as the game reckons it.
    select round(x)::int, round(y)::int into cx, cy from player where world_id = p_world and uid = p_uid;
    if corner_slope_after(p_world, cx, cy, 1) > max_dig_slope(p_world, p_uid) then
      return 'The slope would be too steep for your digging skill.';
    end if;
  end if;
  return null;
end $function$;
