-- Raw material bins
--
-- Asked for: "bulk storage bins can only accept raw materials e.g. ore, logs,
-- dirt. Rename them Raw Material Bins." The bulk storage bin took anything
-- that stacked — bricks, planks, lumps, grain — and it is a raw material bin
-- now, in name and in what it takes. The word it reads is `item_def.raw`,
-- generated from the browser's `ItemDef.raw` and set by hand on what comes
-- out of the ground, off a tree, out of a vein, off a beast or out of a field
-- with no bench, kiln, smelter or anvil between: dirt, sand, clay, peat, tar,
-- coal, the shards, the gem, every ore, the log, wool, fur, hide, bone, tusk,
-- sinew, gland, feathers, dragon scale, worms, compost, reed, grass, cotton,
-- wemp, rose petals and lavender. Forty of them. `furniture_def.raw` marks
-- the bin (the piece keeps its id, `bulk_bin`, so every bin already standing
-- on an island is the same bin, renamed); the old `bulk` column goes. The
-- door is `furniture_refuses`, which `holding_refusal` and `nearest_store`
-- both ask, so a hand putting a plank in and a worker looking for somewhere
-- to put one are refused the same way, in the browser's words.
--
-- What is already in a bin stays in it: nothing is tipped out, and taking
-- things out was never the bin's to refuse.

CREATE OR REPLACE FUNCTION public.furniture_refuses(p placed, p_def text)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  select case
    when holds_liquid(p) then v.it || ' holds liquid and nothing else.'
    when d.hive is not null then v.it || ' is the swarm''s, not yours. Take what is in it; do not put anything back.'
    when coalesce(d.capacity, 0) = 0 then v.it || ' does not hold things.'
    when d.raw and not coalesce((select raw from item_def where id = p_def), false) then
      'A raw material bin takes raw materials — ore, logs, dirt, shards, wool — and nothing a bench has touched.'
    end
  from furniture_def d
  cross join lateral (select case when lower(d.name) ~ '^[aeiou]' then 'An ' else 'A ' end
                        || lower(d.name) as it) v
  where d.id = p.sub
$function$;

alter table furniture_def drop column if exists bulk;

select private.lock_doors();
