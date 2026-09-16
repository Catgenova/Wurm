-- Every number about rarity, read off the one table that holds them.
--
-- `rarity_def` is generated from `RARITIES` by `npm run defs`, which is the
-- whole point of it: the boost, the keep, the ceiling and now the odds live in
-- TypeScript and are crossed, so the two sides cannot disagree about what a
-- rare thing is. Four functions then wrote the same numbers out again by hand,
-- and one of them had already drifted.
--
--     improve_ceiling   rare 4   supreme 10   fantastic 20
--     rarity_def        rare 5   supreme 12   fantastic 25
--
-- Five, twelve and twenty-five is what `RARITIES` says, what the browser's
-- `improveCeiling` adds, and what this island's own `examine_item_text` tells
-- you when you look at the thing — because that one reads the table. So the
-- island said "it can be bettered 5 past your own skill" and then refused at
-- 4. On a fantastic tool that is five whole points of quality that exist in
-- the sentence and not in the rule.
--
-- The other three agreed today and were the same shape: `rarity_boost` and
-- `rarity_keep` as `case` expressions over the same three words, and
-- `rarity_roll` with `array[0.01, 0.1, 0.1]` — the one rarity number that was
-- not crossed at all. All four read the table now, and the odds are crossed
-- with the rest of them.
--
-- `rarity_boost` and `rarity_keep` go from IMMUTABLE to STABLE, which is what
-- reading a table makes them. Every caller — `tool_worth`, `piece_soak`,
-- `weapon_damage`, `ground_decay_rate`, `damage_item` — is already STABLE or
-- VOLATILE, so nothing needed loosening to take them.

/** What a rare thing is better at what it is for by. */
create or replace function rarity_boost(p_rare text) returns double precision
  language sql stable as $fn$
  select coalesce((select r.boost from rarity_def r where r.id = p_rare), 1)::double precision
$fn$;

/** And how much slower it wears and rots. */
create or replace function rarity_keep(p_rare text) returns double precision
  language sql stable as $fn$
  select coalesce((select r.keep from rarity_def r where r.id = p_rare), 1)::double precision
$fn$;

/**
 * How far past your own skill a thing may be bettered.
 *
 * This is the one that had drifted: 4, 10 and 20 written out here against the
 * 5, 12 and 25 in the table, in the browser and in the island's own examine
 * line. A rule and a sentence about the rule, disagreeing.
 */
create or replace function improve_ceiling(p_world uuid, p_uid uuid, p_skill text, p_rare text)
  returns double precision language sql stable as $fn$
  select greatest(10, skill_of(p_world, p_uid, p_skill))
       + coalesce((select r.ceiling from rarity_def r where r.id = p_rare), 0)
$fn$;

/**
 * Roll for rarity on a newly made thing: nothing helps and nothing hurts.
 *
 * Each step in turn, stopping at the first that does not come off — one thing
 * in a hundred is rare, one in a thousand supreme, one in ten thousand
 * fantastic. `rollRarity` does exactly this over `RARITY_ODDS`, which is where
 * `rarity_def.odds` now comes from.
 */
create or replace function rarity_roll() returns text
  language plpgsql as $fn$
declare r rarity_def; got text := null;
begin
  for r in select * from rarity_def order by ord loop
    exit when random() >= r.odds;
    got := r.id;
  end loop;
  return got;
end $fn$;

select private.lock_doors();
