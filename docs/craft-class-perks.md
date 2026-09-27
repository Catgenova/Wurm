# Craft class perks

The perks chosen for the fourteen craft classes, class by class, on 26 September 2026, and the tiers they are offered in, settled on 27 September. They replace what a craft class gave before: its channels and its tree of nodes in `src/game/classes.ts`. The Terraformer, the Miner, the Mason, the Carpenter, the Smith, the Forester, the Farmer, the Cook, the Tailor, the Herdsman, the Naturalist and the Fisher are built, in `src/game/perks.ts` and on the island; the other two are not yet.

## Tiers

- A class is taken at 50 in one of its skills.
- Its 18 perks are offered three at a time in six tiers. The first opens when the class is taken; the others open at 60, 70, 80, 90 and 100 in the class's main skill.
- A player takes one perk at each tier, so at 100 they hold 6 of their class's 18. The **Tiers** line under each class says what each tier offers, and a built class's `TIERS` row in `src/game/perks.ts` must match it.

Each class was offered 50 perks and 18 were picked. A perk keeps the number it was offered under, which is the number it was picked by. Figures in brackets are the game's own when the perks were chosen, so each line can be checked against the rule it changes when it is built.

## Terraformer

Main skill digging; also paving.

5. **Clean Earth** — dirt, sand, clay, peat and tar you dig, dredge, collect or flatten off come up at +10% QL (at most 100).
6. **Rare Earth** — 1 in 100 goes of Dig, Dredge and Collect bring the material up rare, rolling on to supreme and fantastic at crafting's odds. (Gathered material is never rare now.)
9. **Level Hand** — Flatten moves 2 height units a go instead of 1.
10. **Quick Level** — Flatten takes 35% less time per go.
12. **Steep Cut** — slope limit for Dig, Drop dirt and Flatten is 4× digging (now 3×, minimum 40).
14. **Wader** — Dig, Flatten and Drop dirt work in water up to 20 deep (now 10).
15. **Dredger** — Dredge reaches bottoms up to 60 deep (now 30) and takes 20% less time.
17. **Bed Worker** — Collect takes 30% less time per go.
20. **Treasure Nose** — digging turns up a treasure map in 1 of every 200 goes (now 1 in 1000).
23. **Stump Puller** — Dig out the stump takes 50% less time and gives 1 log of the tree's kind.
25. **Quick Paver** — Pack, Pave (cobblestone) and Pave (slabs) take 35% less time per go.
26. **Bed True** — Pave (slabs) never fails (now a check at difficulty 10 against the slab's QL).
27. **Frugal Cobbler** — 1 in 3 goes of Pave (cobblestone) use no stone brick.
29. **Road Legs** — you walk 15% faster on packed dirt, cobblestone and slabs.
32. **Soil Porter** — dirt, sand and clay weigh 10 kg a unit in your pack (now 20 kg, against a 120 kg carry limit).
33. **Strong Back** — you carry 40 kg more before the load slows you (now 120 kg + 5 per body strength).
34. **Long Reach** — Drop dirt and Flatten draw soil from carts and containers within 5 tiles (now 2.5), and what you dig goes straight into a cart within 5 tiles.
44. **Dig Out the Tile** — lowers all four corners of a tile by 1 in one go, in 16 s base (four digs take 24 s), and gives 4 of the material.

**Tiers** (swept): 50 — Quick Level, Bed Worker, Quick Paver · 60 — Level Hand, Wader, Stump Puller ·
70 — Steep Cut, Dredger, Bed True · 80 — Frugal Cobbler, Road Legs, Soil Porter ·
90 — Strong Back, Long Reach, Dig Out the Tile · 100 — Clean Earth, Rare Earth, Treasure Nose.

## Miner

Main skill mining; also prospecting and archaeology.

1. **Quick Pick** — Mine takes 25% less time per go (8 s base now).
2. **Rich Seam** — Mine: 15% of goes bring up 2.
3. **Sure Swing** — Mine fails half as often.
6. **Rare Ore** — 1 in 100 goes of Mine bring the yield up rare, rolling on to supreme and fantastic at crafting's odds.
7. **Ore Sense** — you can mine each ore at 10 below its mining level: gold at 40, seryll at 80 (now copper 1, iron 5, tin 10, then every 10 up to seryll 90).
8. **Coal Hand** — Mine on a coal seam brings up 2 coal a go.
9. **Chipper** — Chip corner lowers the corner 1 go in 2 (now 1 in 4).
11. **Face Shaper** — when Chip corner succeeds, it lowers the corner by 2.
13. **Rock Slide** — when the face drops on its own, 3 more of what you're mining come down with it.
14. **Wet Work** — Mine and Chip corner work in water up to 20 deep (now 10).
15. **Gem Eye** — mining turns up a gem in 1 of every 150 goes (now 1 in 400).
17. **Treasure in the Rock** — mining turns up a treasure map in 1 of every 200 goes (now 1 in 1000).
19. **Far Reader** — Prospect reads 3 tiles further (now 3, plus 1 per 10 prospecting).
25. **Keen Trowel** — Investigate finds something 15 percentage points more often, up to 85%. (Now: 14%, plus 40% of your archaeology level and 10% of the trowel's QL, capped at 70%.)
27. **Pieces that Fit** — while you hold pieces of a relic, half your relic finds are a piece of it you're missing.
28. **Bauble Hunter** — 40% of finds are tarnished baubles (now 30%).
35. **Ore Cart** — what you mine goes straight into a cart or container within 5 tiles.
50. **Pan** — on sand beside water, 1 go in 8 gives copper, tin, silver or gold ore, at a QL set by your prospecting.

**Tiers** (swept): 50 — Ore Sense, Coal Hand, Chipper · 60 — Rock Slide, Wet Work, Far Reader ·
70 — Quick Pick, Rich Seam, Keen Trowel · 80 — Sure Swing, Pieces that Fit, Ore Cart ·
90 — Face Shaper, Gem Eye, Bauble Hunter · 100 — Rare Ore, Treasure in the Rock, Pan.

## Mason

Main skill masonry; also stonecutting.

1. **Quick Chisel** — stonecutting takes 25% less time (bricks 6 s, slabs 9–10 s base).
2. **Three from a Shard** — Chisel brick makes 3 bricks from a shard (now 2).
4. **Sure Chisel** — stonecutting fails half as often.
8. **Quick Mason** — stone walls and floors take 30% less time per go (5 s base now).
9. **Two at a Time** — Build wall and Build floor lay 2 units a go when you have them (now 1; a stone-brick wall is 24 bricks and 12 mortar).
12. **Tall Walls** — stone buildings you plan can rise 2 storeys past the material's limit (stone brick and marble 10, slate 8, sandstone and clay brick 7, cobblestone 6, adobe 5).
16. **Salvage** — Remove wall gives back half the stone (now nothing).
17. **Concrete Hand** — Raise the rock with concrete never fails (now difficulty 10, and the concrete is lost on a fail).
18. **Double Lift** — Raise the rock lifts the corner by 2 for one concrete, where the slope limit allows.
19. **Steep Stone** — the slope limit for raising rock is 4× masonry (now 3×, minimum 40).
20. **Good Mix** — Mix concrete makes 2 from 1 mortar and 1 ash (now 1).
22. **Wet Set** — Raise the rock works under water up to 10 deep (now only above water).
24. **Nothing Wasted** — a failed smelter, kiln, oven, brazier, well, statue or altar keeps its materials (now they're lost).
29. **Bridge Mason** — stone arch bridges take 30% less time and span 10 tiles (now 8).
33. **Brick Porter** — bricks and slabs weigh half in your pack (a stone brick is 15 kg now).
35. **Hod Carrier** — Build wall and Build floor also draw from carts and containers within 5 tiles (now only your pack and a crate on the site).
47. **Repoint** — re-lay a finished wall in a different stone; you pay the new stone and get half the old stone back.
48. **Rubble Fill** — raise a rock corner with 5 rock shards instead of a concrete.

**Tiers** (swept): 50 — Quick Chisel, Quick Mason, Concrete Hand · 60 — Sure Chisel, Double Lift, Steep Stone ·
70 — Good Mix, Wet Set, Brick Porter · 80 — Three from a Shard, Two at a Time, Bridge Mason ·
90 — Salvage, Hod Carrier, Rubble Fill · 100 — Tall Walls, Nothing Wasted, Repoint.

## Carpenter

Main skill carpentry; also fine carpentry, bowyery and fletching.

1. **Quick Saw** — Saw into planks, Saw into timbers and Carve shafts take 30% less time (5 s base).
2. **Clean Sawing** — a log saws into 4 planks (now 3).
3. **Heavy Timber** — a log saws into 3 timbers (now 2).
6. **Thatcher** — Bundle into thatch makes 2 from 2 mixed grass (now 1).
10. **Master Joiner** — furniture you make comes out rare twice as often.
12. **Deep Drawers** — chests, cupboards, barrels, bins, shelves, wardrobes and larders you make hold 20% more.
14. **Shipwright** — boats take 30% less time to build (rowing boat 34 s, sailing boat 70 s, caravel 180 s).
15. **Keel Layer** — boats you build go 10% faster on the water.
16. **Deep Hold** — boats you build carry 25% more.
18. **Smooth Axle** — carts and wagons you build go 10% faster.
19. **Sure Hull** — boats, carts and wagons fail half as often.
25. **Fence Builder** — fences and gates take half the time and half the material.
26. **Timber Salvage** — Remove wall gives back half the wood (now nothing).
27. **Bridge Wright** — wooden and rope bridges take 30% less time and span 2 tiles more.
31. **Bowyer's Draw** — bows you make hit 10% harder.
32. **True Bow** — bows you make reach 10% further.
37. **String Maker** — a bowstring takes 1 yarn (now 2) and never fails.
45. **Saw Care** — saws, carving knives, mallets and files wear 50% less.

**Tiers** (swept): 50 — Quick Saw, String Maker, Saw Care · 60 — Heavy Timber, Thatcher, Shipwright ·
70 — Keel Layer, Timber Salvage, Bowyer's Draw · 80 — Deep Hold, Sure Hull, True Bow ·
90 — Clean Sawing, Smooth Axle, Fence Builder · 100 — Master Joiner, Deep Drawers, Bridge Wright.

## Smith

Main skill blacksmithing; also smelting, weaponsmithing, armorsmithing, platesmithing and chainsmithing.

7. **Sure Alloy** — alloy mixes fail half as often.
8. **Glassblower** — Make glass makes 2.
9. **Reclaimer** — Melt down gives back 75% of the lumps at 85% QL (now half, at 70%).
12. **Hard Sand** — moulds you make wear half as fast, so they last twice as many pours (a QL 50 mould now lasts 7).
13. **Clean Pour** — a mould's wear doesn't lower what you pour. (A casting is now the average of the lump, your smelting and the mould's QL, and the mould's QL drops by half its damage.)
16. **Sure Hammer** — smithing at the anvil fails half as often.
20. **Second Heat** — a failed smithing go keeps the casting (now it's lost).
22. **Nail Maker** — 8 nails a lump (now 5).
24. **Keen Edge** — weapons you smith deal 10% more damage.
25. **Balanced** — weapons you smith have a 5% better chance to hit.
26. **Mail Maker** — chain armour you smith stops 10% more damage.
27. **Plate Maker** — plate armour you smith stops 10% more damage.
30. **Toolsmith** — tool heads and blades you smith come out at +10% QL.
32. **Metal Polisher** — Improve on metal raises QL 50% more per go.
36. **Forge Reach** — smelter and anvil work draw lumps, fuel and castings from containers within 6 tiles (now 3).
38. **Long Shift** — you can queue 2 more jobs.
45. **Temper Bath** — quench a weapon or tool you finished for +5 QL, once per item.
49. **Ingots** — pour 5 lumps into 1 ingot that weighs half and counts as 5 lumps.

**Tiers** (swept): 50 — Glassblower, Mail Maker, Plate Maker · 60 — Toolsmith, Metal Polisher, Ingots ·
70 — Hard Sand, Second Heat, Nail Maker · 80 — Keen Edge, Balanced, Forge Reach ·
90 — Sure Alloy, Reclaimer, Clean Pour · 100 — Sure Hammer, Long Shift, Temper Bath.

## Forester

Main skill woodcutting; also forestry.

1. **Clean Stroke** — each stroke of Cut down takes 25% less time (8 s base).
2. **Heavy Swing** — trees come down in one stroke fewer, at least 1 (now young 2, mature 3, old 3, very old 4).
3. **Sure Hatchet** — Cut down glances off half as often.
5. **Choice Logs** — logs you fell come up at +10% QL.
6. **Rare Heartwood** — 1 tree in 100 you fell gives rare logs, rolling on to supreme and fantastic at crafting's odds.
7. **Clean Drop** — a tree you fell leaves no stump.
10. **Sprout Picker** — Pick sprout never fails (now difficulty 15) and gives 2.
11. **Nursery** — sprouts you plant come up mature, a stage on from young. (As chosen it said young, skipping the sapling stage; but a planted sprout already comes up young for everybody, and only a tree that seeds itself starts as a sapling, so it moved one stage on.)
14. **Master Grafter** — Graft never fails (now difficulty 40) and takes 30% less time.
16. **Fruitful** — Pick fruit gives 1 more fruit per pick.
20. **Hedge Harvest** — Harvest bush gives 1 more per go.
21. **Nest Finder** — 1 tree in 10 you fell gives 3 feathers, which fletching needs.
22. **Honey Hunter** — 1 tree in 20 you fell gives 2 honey.
24. **Kindling** — cutting down a bush gives 2 shafts.
34. **Woodsman's Stride** — you walk through bushes, reeds, stumps and marsh at full pace (now half pace in bushes, 0.7 on stumps, 0.8 in reeds, 0.6 in marsh).
40. **Coppice** — cuts a mature or older tree back to young for 2 logs; the tree stays standing.
43. **Tap Resin** — taps a pine for 1 tar once a day.
44. **Clear Brush** — clears a 3×3 patch of bushes and reeds as one job.

**Tiers** (swept): 50 — Woodsman's Stride, Tap Resin, Clear Brush · 60 — Nest Finder, Honey Hunter, Coppice ·
70 — Clean Stroke, Heavy Swing, Sure Hatchet · 80 — Clean Drop, Fruitful, Kindling ·
90 — Sprout Picker, Nursery, Hedge Harvest · 100 — Choice Logs, Rare Heartwood, Master Grafter.

## Farmer

Main skill farming; also milling.

4. **Seed Saver** — 1 sowing in 4 uses no seed.
5. **Fast Growth** — crops you sow go through each stage 20% faster. Built as each stage taking 20% less time, stamped on the crop as it is sown, so it grows at that pace whoever harvests it.
6. **Crop Rotation** — a field sown with a different crop from its last one grows 25% faster. Built as each stage taking 25% less time; a field never sown, or broken up since, has no last crop.
8. **Bumper Crop** — a crop tended at every stage gives 5 produce (now 4).
11. **Rare Harvest** — 1 harvest in 100 comes up rare, rolling on to supreme and fantastic at crafting's odds.
14. **Fodder** — every harvest also gives 2 mixed grass.
15. **Herb Plot** — sage, basil, thyme, mint and rosemary give 2 more per harvest.
16. **Grain Master** — wheat and corn give 2 more per harvest.
17. **Fibre Farmer** — cotton and wemp give 2 more per harvest.
22. **More Meal** — Make flour and Make cornmeal give 1 more per go.
23. **Full Press** — pressing fruit gives 25% more juice, cider or oil. Built as a pressing taking 20% less fruit (8 where it took 10, 16 where it took 20): a bucket of juice or cider cannot hold a quarter more, so the same bucket comes from less fruit, which is 25% more from the same fruit.
25. **Milkmaid** — milking takes 40% less time and gives 50% more milk. Built as 1 milking in 2 filling a second bucket, if you carry another empty one: a bucket of milk is full at one milking.
28. **Sack Porter** — produce, seeds and flour weigh half in your pack.
30. **Barn Reach** — harvests go straight into a container within 5 tiles.
34. **Worn-in Rake** — your rake counts as 20 QL higher when tilling (at most 100).
39. **Sow a Patch** — sows a 3×3 patch as one job.
40. **Tend a Patch** — tends a 3×3 patch as one job.
41. **Harvest a Patch** — harvests a 3×3 patch as one job.

**Tiers** (swept): 50 — Fodder, Milkmaid, Sack Porter · 60 — Seed Saver, Fast Growth, Bumper Crop ·
70 — More Meal, Full Press, Barn Reach · 80 — Crop Rotation, Worn-in Rake, Sow a Patch ·
90 — Rare Harvest, Tend a Patch, Harvest a Patch · 100 — Herb Plot, Grain Master, Fibre Farmer.

## Cook

Main skill cooking; also butchering and brewing.

3. **Fine Fare** — dishes you cook come up at +10% QL.
5. **Big Pot** — stew, pottage, porridge and preserves make 1 more serving.
6. **Frugal Cook** — 1 dish in 5 gives one of its ingredients back. Built as one of the first ingredient that is not a bucket, at the quality of the stack it came off.
7. **Hearty** — dishes you cook feed each nutrient 25% more. Built, like Long-lasting, Flavoursome and Filling, as a maker's mark on the dish, so it holds whoever eats it; a dish made by the handful stacks by its mark.
8. **Long-lasting** — dishes you cook decay 50% slower. Built as rotting 50% slower on the ground, which is the only place anything rots.
11. **Flavoursome** — the knack from a dish you cooked lasts 50% longer.
14. **Balanced Diet** — a balanced diet is worth up to +30% on your learning (now +20%).
15. **Filling** — your dishes fill hunger 25% more.
18. **Full Carcass** — you take 15% more of a carcass (at most all of it).
20. **Prime Cuts** — meat you butcher comes up at +10% QL.
21. **Hide Keeper** — hides and bones you take come up at +10% QL.
28. **Strong Brew** — the knack from a drink you brewed lasts 50% longer. Built as a mark on the barrel when the brew is set going, drawn off into every bucket filled from it; brew poured together is only as strong as the weakest of it, and an emptied barrel forgets it.
31. **Pantry Reach** — cooking draws ingredients from containers within 6 tiles (now 3).
32. **Cool Pack** — food in your pack decays 50% slower. Nothing rots in a pack, so it was built as food you drop rotting 50% slower where it lies, until it is picked up again.
46. **Broth** — a recipe that turns bones into broth, feeding a little of all four.
47. **Distil** — turns 15 L of a brew into 5 L of spirit whose knack lasts 3 times as long. Built as 3 buckets of a brew into 1 of spirit, 2 buckets back, over a campfire with a clay pot. The spirit's knack is 3 times that of a drink as strong as it, mead or wine; ale and cider are weaker drinks with shorter knacks, so against them it is longer still.
49. **Bait Maker** — butchering also gives 2 fishing bait. Built as 2 offal, a new bait that trout and pike bite on.
50. **Taste** — Examine on a dish shows what it feeds and how long its knack lasts. Built for anything eaten or drunk: how much of the food bar a helping fills (or of the thirst bar a drink quenches), what it feeds of each of the four and how long its knack lasts, at its quality and with its maker's marks.

**Tiers** (swept): 50 — Flavoursome, Full Carcass, Strong Brew · 60 — Pantry Reach, Bait Maker, Taste ·
70 — Fine Fare, Hearty, Long-lasting · 80 — Big Pot, Frugal Cook, Filling ·
90 — Prime Cuts, Hide Keeper, Cool Pack · 100 — Balanced Diet, Broth, Distil.

## Tailor

Main skill tailoring; also leatherworking and ropemaking.

2. **Full Fleece** — shearing gives 1 more wool (now 1–3, depending on the fleece).
3. **Quick Spindle** — spinning takes 40% less time (6 s base).
4. **Even Thread** — spinning turns 2 fibre into 3 yarn (now 2).
7. **Tight Weave** — a cloth takes 2 yarn (now 3).
9. **Sure Needle** — tailoring fails half as often (difficulty 8–20).
11. **Master Tailor** — what you tailor comes out rare twice as often.
16. **Sack Maker** — sacks you stitch hold 60 (now 40). Built, like Deep Pockets, as a maker's mark on the bag, so it holds whoever carries it.
18. **Sure Tan** — tanning fails half as often (difficulty 16). Sure Awl covers tanning too, so with both it fails a quarter as often.
19. **Lye Saver** — 1 tanning in 2 leaves the lye in the bucket. Built as the bucket of lye left full and no empty bucket back.
21. **Sure Awl** — leatherworking fails half as often (difficulty 12–58).
25. **Deep Pockets** — satchels you stitch hold 31 (now 25) and backpacks hold 75 (now 60).
27. **Saddler** — mounts and teams in saddles, bridles and yokes you made move 10% faster. Built as a maker's mark on each piece. A saddle's and a bridle's go onto the mount with them and come back with them when it is stripped, and the mount goes faster by the larger of the two, after the cap on a mount's pace, so a mount at the cap goes past it. A yoke's goes into the cart or wagon built on it, multiplied with the builder's own.
31. **Fisher's Friend** — nets and creels you make catch 20% more (a net now hauls 1–5 fish). Built as a maker's mark, a new family (`catch`). A net's haul is multiplied by it and the part over a whole fish is a chance at one more, so it is 20% more on the average. A creel's odds at each look are multiplied by it, and a creel keeps its mark in the water and when it is taken up.
34. **Nothing Wasted** — a failed tailoring, leatherworking or ropemaking job keeps its materials. Built on the thirty recipes of the three that lose their materials when they fail.
35. **Light Pack** — cloth, leather, yarn and hides weigh half as much in your pack. Loose in the pack; in a bag they weigh what they do.
37. **Workshop Reach** — tailoring, leatherworking and ropemaking draw from containers within 6 tiles (now 3).
46. **Patch** — take 20 damage off a cloth or leather piece for 1 cloth or leather. Built as a job on cloth and leather armour: one of the piece's own stuff, cloth for cloth and leather for leather, and none of its QL.
49. **Tent** — pitch a tent and sleep anywhere, with half the rest a bed gives. Built as a piece of furniture (8 cloth, 2 rope and 3 shafts, with a needle) that is set down like any other; a night in it banks half the rest of a night in a bed of the same QL.

**Tiers** (swept): 50 — Full Fleece, Quick Spindle, Sure Tan · 60 — Saddler, Fisher's Friend, Workshop Reach ·
70 — Sure Needle, Lye Saver, Sure Awl · 80 — Sack Maker, Deep Pockets, Nothing Wasted ·
90 — Even Thread, Tight Weave, Light Pack · 100 — Master Tailor, Patch, Tent.

## Herdsman

Main skill animal husbandry; also taming.

1. **Soft Hand** — every offering is 10 points likelier to take. Built as 10 points added after everything else that goes into the chance, under its ceiling of 95%.
2. **Patient Coax** — each refused offering makes the next 6 points likelier (now 3). Built as the step of whoever makes the offering: the count of refused offerings is on the wildermon, and Examine says what it is worth to the one looking.
9. **Young Trust** — young ones are 2.5 times as easy to tame (now 1.6 times).
10. **Any Bait** — any food works as an offering to any kind (now each kind takes only its own few). Built on taming only; feeding one you keep still takes its own food.
11. **Brushwork** — a brushing adds 50% more care (now 18–74% of full care, depending on your skill and the brush).
13. **Lasting Care** — care wears off over 6 hours (now 3). Built, like Well Kept, Light Eaters and Long-lived, as the keeper's: their numbers are stamped on every wildermon they keep (`creature.kept`) when its keeper changes, which is when it is tamed, born, bought or handed over, and again whenever the keeper's perks change. They go to the browser with it; offline, your own perks keep yours. One that changes hands takes its new keeper's.
14. **Well Kept** — full care makes a wildermon work and learn 40% faster (now 25%).
15. **Healing Hands** — a brushing heals 15% of its health (now 6%).
16. **Light Eaters** — wildermon you keep get hungry 30% slower (now a follower empties in about 67 minutes, a settlement worker in about 42).
18. **Long-lived** — wildermon you keep grow old at 25 hours (now 15).
21. **Short Rest** — a pair can be put together again 25 minutes after a pairing (now 50). Built on both of the pair, and read off whoever put them together, as are Quick Gestation, Twins, True Blood, Bred Up and Choose the Sex. A pairing that does not take rests half of that.
22. **Quick Gestation** — a mother you pair carries for 15 minutes (now 30).
24. **Twins** — 1 pairing in 5 gives two young. Built as the second young decided at the covering, its own draw of traits and its own sex, and dropped with the first. It goes where a second tamed one goes: into an empty creature crate once the first is following you.
25. **True Blood** — each of a young one's traits is 10 points likelier to come from its parents (now 50%, plus 0.35 point per husbandry level, plus up to 11 points for care, 96% at most).
26. **Bred Up** — each trait is 10 points likelier to come out a tier better (now 0.22 point per husbandry level plus up to 8 points for care, 30% at most).
28. **Choose the Sex** — you choose whether a pairing gives a male or a female (now even odds). Built as two entries under Put it to a mate, For a female young and For a male young; twins take the sex asked for too, and a sex asked for without the perk is not heard.
37. **Light Crate** — a creature crate weighs 3 kg in your pack (now 10).
50. **Stud Book** — Examine on a pair shows the odds before you pair them: the chance the pairing takes, and each trait's chance to come through. Built as Examine on one of yours that is out with you and has a mate in range: it says how often the pairing takes and how often each of the young's traits is drawn from the pair's blood and comes out a tier better, in the same words on the island and in the browser.

**Tiers** (swept): 50 — Soft Hand, Brushwork, Short Rest · 60 — Healing Hands, Light Crate, Stud Book ·
70 — Patient Coax, Lasting Care, Quick Gestation · 80 — Young Trust, Light Eaters, True Blood ·
90 — Well Kept, Twins, Choose the Sex · 100 — Any Bait, Long-lived, Bred Up.

Brush it down, Put it to a mate and Look it over were rules on both sides that no menu offered. They are on a wildermon's menu now, which is where most of these perks are reached.

## Naturalist

Main skill foraging; also botanizing, alchemy and first aid.

2. **Keen Eye** — foraging and botanizing search the ground one more time (now 1, plus 1 for every 20 skill, 6 at most). Built as one more pass a go (`passes:`); there is no cap in the rule, six is what 100 gives.
3. **Sure Find** — no search comes up empty by chance (now 1 in 5 does, before the skill check). Built as that chance multiplied by the perk's none (`empty:`), foraging and botanizing.
10. **Hay Cutter** — cutting grass gives 3 bundles (now 2).
11. **Reed Cutter** — cutting reeds always gives 3 (now 2, with a chance of a 3rd equal to your foraging ÷ 140).
12. **Rare Find** — 1 find in 100 comes up rare. Built as the first rarity step at 1 in 100 on each find, the steps after it at their usual odds. Offline nothing gathered came up rare before; it can now, for this perk.
13. **Quick Lye** — making lye takes 40% less time (12 s base).
15. **Double Boil** — a dye boil makes 3 pots (now 2).
16. **Thrifty Dyer** — a dye boil takes 25% less dyestuff (now 8–10). Built as three quarters of it rounded up, as every `need:` perk is: 6 of 8 and 8 of 10, a quarter off the one and a fifth off the other. The bucket of lye is the same.
17. **Sure Boil** — alchemy fails half as often (difficulty 10–22). Built on every alchemy recipe with a check: candles, lye, ink, the ten dyes, and the Naturalist's own herb tea and tincture. Healing covers are first aid.
19. **Ink Maker** — grinding ink gives 4 (now 2).
23. **Quick Dressing** — dressing a wound takes 40% less time (7 s base).
24. **Sure Hands** — dressing a wound fails half as often (difficulty 10, or 30 on an infected one). Built at difficulty 10: a wound gone bad is refused a dressing until it is cleaned out, on both sides, so the 30 never comes up.
29. **Quick Mend** — wounds you dress close 50% faster. Built as the dresser's pace stamped on the wound at a clean dressing, whoever's wound it is; the next dressing puts its own on, and scouring it out takes it off.
30. **Cover Maker** — 2 herbs and 1 cotton make 5 covers (now 3).
34. **Field Medic** — you can dress other players' wounds, at your skill (now only your own and your wildermon's). Built as a new thing an action can be done to, a person: "Dress <name>'s wounds" on their menu, standing beside them. It goes on their worst wound, at your first aid and out of your pack, and they are told who dressed it.
43. **Herb Tea** — a new recipe; 2 herbs and a bucket of water make 3 cups, and each cup restores 20% of your stamina. Built as five recipes, one for each healing herb, the bucket back, and Drink it on a cup. Nothing restored stamina before but rest.
44. **Salve** — a new recipe; 2 herbs and 1 wax make a salve, and a dressed wound under it never gets infected. Built as five recipes and Rub in the salve: it goes on the worst dressed wound that could still go bad (under cloth or the wrong herb), and scouring the wound out takes it off. Nothing on an island gave wax, so hives fill there now, as they always did offline: a kept Vesp on a settlement fills a hive standing on it with honey and wax, three to one, on the clock's tidying round.
50. **Tincture** — a new recipe; 3 herbs make a tincture that gives +10% skill gain in foraging, botanizing, alchemy and first aid for 20 minutes. Built as five recipes and Take it: four boons of its own kind, for as long as a dish's knack at its plainest (twenty minutes of the world's time, fifty of play). They stand beside a dish's rather than in its place; a dish puts back the clock on a dish's, a tincture on a tincture's.

**Tiers** (swept): 50 — Keen Eye, Quick Lye, Quick Dressing · 60 — Hay Cutter, Reed Cutter, Ink Maker ·
70 — Sure Find, Sure Boil, Sure Hands · 80 — Thrifty Dyer, Quick Mend, Cover Maker ·
90 — Rare Find, Double Boil, Field Medic · 100 — Herb Tea, Salve, Tincture.

## Fisher

Main skill fishing.

1. **Quick Cast** — a cast takes 30% less time (9 s base).
2. **Long Cast** — you cast up to 6 tiles (now 3.6). Built as the line's reach (`reach:fish`), which the walk to the water, the island's "too far" and the cast itself all read; water clicked beyond it is fished at the deepest water in the square of whole tiles the reach spans round your feet (six each way, now three).
3. **Steady Hand** — a fish that bites stays on 15 points more often. Built as points added after everything else that goes into the chance, under the 95% ceiling (`hook:`, `stays_on`).
4. **Bait Saver** — bait is used up only when you land a fish (now every cast uses one). Built as the bait taken after the bite rather than before it: with a landed fish, and with one that comes off unless the perk keeps it on (`spare:fish`).
5. **Strong Bait** — bait draws its fish twice as strongly (now 8 times for its first fish and 4 times for its second). Built as a multiplier on a bait's pull (`bait:pull`), on the hook and in a creel, whose perks are its setter's.
6. **Any Bait** — any food works as bait (now only worms, corn, minnows, meat and perch). Built as the first food carried going on the hook, or in a creel, when no bait that favours a fish is (`bait:food`): it draws every fish at its plain weight and helps a fish stay on as any bait does.
9. **Big Fish** — trout, pike and sturgeon bite twice as often. Built as twice their weight in the draw of which fish bites (`bite:`), on the rod, in the net and in a creel: 51% of the bites where every fish runs on a bare hook, where it was 34%.
12. **Rare Catch** — 1 fish in 100 comes up rare. Built for a rod and a net alike (`rare:fish`, `rare:drag_net`); a rare one in a haul is a pile of its own.
13. **Quick Net** — dragging the net takes 30% less time (16 s base).
14. **Full Net** — a net hauls 2 more fish (now 1–5). Built as two added to the haul before the net's maker's mark is counted in (`haul:`).
15. **Wide Net** — a net reaches 4 tiles (now 2.6). Built as Long Cast is, for the net (`reach:drag_net`); the square it looks in for water is four each way, now two, where the island had looked three for a net and a rod alike.
17. **Net Care** — nets wear 50% less.
19. **Deep Creel** — a creel holds 16 fish (now 8). Built as a maker's mark on a creel you make (`hold:creel`), which it keeps in the water and taken up (`creel_hold`, `creelHold`).
25. **Cool Pack** — fish in your pack decay 50% slower. Built as the Cook's Cool Pack is: nothing rots in a pack, so it is fish you set down that rot half as fast where they lie, until picked up (`cool:<fish>`).
27. **Smoke Fish** — a new job; smoke fish over a fire so it keeps 5 times as long. Built as five recipes, one for each fish, at a lit campfire on fishing rather than cooking: the same fish comes off at its own quality with the smoker's mark to rot a fifth as fast (`rot:<fish>`).
33. **Rod Care** — rods wear 50% less.
45. **Fishing Journal** — looking at water also shows each fish's chance to bite with the bait you carry. Built as a line on Examine for water, the same words on both sides (`fish_journal`, `fishJournal`): the depth, each fish's share of the bites with the bait that would go on, and how often a fish that bites stays on with your rod.
47. **Fish Pond** — a new build on your settlement that holds 10 fish and gains 1 an hour. Built as a piece (20 clay, 12 rock shards and 8 reeds, with a shovel, on fishing) set down only on your settlement, which stocks itself with any of the five fish at their plain weights, a fish an hour of real time up to ten, at about its own quality; nothing is put in, as with a hive (`pond_sweep` on the island's tidying round, `stockPond`).

The browser had drifted from the island here too. A rod and a net wore their own measure and then a whole use more on top in the browser; they wear only their own now, as on an island, and so does a spadeful turned for worms (`ActionDef.wear`). A net in the browser let the deep fish into a haul all together or not at all; each one is its own chance now, as on an island.

**Tiers** (swept): 50 — Quick Cast, Bait Saver, Quick Net · 60 — Long Cast, Wide Net, Fishing Journal ·
70 — Net Care, Cool Pack, Rod Care · 80 — Steady Hand, Full Net, Deep Creel ·
90 — Strong Bait, Any Bait, Big Fish · 100 — Rare Catch, Smoke Fish, Fish Pond.

## Mender

Main skill repair; also restoration.

1. **Big Mend** — each repair takes out 50% more damage. Built as a multiplier on what a go takes out (`mend:repair_item`), at the same quality for each point of it.
2. **Light Touch** — repairing costs half the QL. Built as a multiplier on the quality each point of damage taken out costs (`cost:repair_item`). The tree's fineness on repair, which divided that cost on the island and nowhere else, went with the tree.
3. **Clean Repair** — 1 repair in 4 costs no QL. Built as a go's chance of costing nothing (`keep:repair_item`), rolled only for somebody who has it.
4. **Quick Hands** — each repair takes 40% less time (1 s base). A go of Repair is always down on the floor under every job, where a perk on its time did nothing, so a perk on a job's time (`time:`) now comes off after the floor rather than before it, on both sides and for every trade: every quick perk is what it says at any skill.
9. **Tool Care** — all your tools wear 25% slower. Built as `wear:` on every tool a job or a recipe wears, and the brush. The browser had worn a brush a flat sliver a grooming; it wears it by its quality now, as the island does.
10. **Armour Care** — armour and weapons you wear take 25% less damage. Built as three keys (`worn:armour`, `worn:shield`, `worn:weapon`): a piece of armour a blow lands on, a shield that stops one, and a weapon that lands one or a bow that puts an arrow home.
14. **Post Keeper** — work posts, traps and creels you set last 50% longer. Built as the life of the thing times its setter's perk (`life:work_post`, `life:snare`, `life:deadfall`, `life:creel`), read off whoever set it (`kept_life`), wherever its damage and its time left are asked. The island had thirty minutes written out for the roughest post, where the browser's is a world half hour; both read the same two numbers now (`post_life_min`, `post_life_max`).
17. **Quick Restore** — restoring takes 40% less time (20 s base).
18. **Sure Restore** — restoration fails half as often. Built as `fail:restore_relic`, on a relic and a bauble alike.
19. **Gentle Hands** — a failed restoration does no damage (now 5–14 to each piece). Built as a multiplier on that damage (`harm:restore_relic`), nought; what a failure says says so.
20. **Fine Restore** — what you restore comes up at +10% QL. Built as ten per cent on the quality, to a hundred at most (`ql:restore_relic`); it takes the place of the tree's fineness there.
21. **Age Undone** — damage on the pieces no longer lowers the QL of what you restore. Built as a multiplier on what each point of damage takes off (`age:restore_relic`), nought.
24. **Lucky Polish** — baubles you restore come out rare twice as often (now 1 in 100). Built as the first step of rarity at twice its odds (`rare:restore_relic`), the steps after it at theirs.
25. **Second Look** — a bauble you restore is rolled twice, and you keep the better roll. Built as the roll that gives the most kept (`rolls:bauble`), the first where two give the same, which an ancient bauble's always do.
26. **Tier Up** — 1 restoration in 10 turns a minor bauble into a major one, or a major into an ancient one. Built as a roll after the restoring has gone through, at the tier's own difficulty, before what it gives is rolled (`tier:restore_relic`); what it says names both tiers.
27. **Handyman** — you can improve anything up to QL 30, whatever your skill in its trade (now 10). Built as the floor under improving (`floor:improve`) over `improve_floor`.
42. **Repair Kit** — a new item made from 2 cloth, 2 nails and a plank; it takes 50 damage off anything in one use, anywhere. Built as a recipe on repair, with a hammer, and **Use a repair kit** on anything damaged, which anybody who has one may do: `kit_mend` damage off, none of the quality, the kit used up.
50. **Sealant** — a new recipe; 1 tar and 1 wax seal an item so it never decays. Built as a recipe on repair and **Seal it**, which anybody who has some may do: one to a thing and one for each thing in a pile, and it marks the thing sealed (`seal`, nought on its decay on the ground). A seal is whoever sealed it rather than a maker's, is said on its own, and is not carried from a part into what the part goes into.

**Tiers** (swept): 50 — Quick Hands, Tool Care, Quick Restore · 60 — Clean Repair, Armour Care, Gentle Hands ·
70 — Big Mend, Post Keeper, Sure Restore · 80 — Light Touch, Fine Restore, Age Undone ·
90 — Lucky Polish, Second Look, Repair Kit · 100 — Tier Up, Handyman, Sealant.

## Artisan

Main skill jewellery; also pottery and papyrusmaking.

2. **Sure Setting** — setting a stone fails half as often. Built as `fail:` on the three settings (`set_ring`, `set_pendant`, `set_focus`) and on a stone set in a circlet (`set_in_circlet`).
3. **Keep the Stone** — a failed setting never loses the stone (now it splits). Only a focus could lose one; built as the stone kept out of a failed focus whole (`stone:set_focus`), the silver still lost, and a failure that says so.
4. **Bright Stone** — a jewel you set gives +15% skill gain on its trade (now +10%). Built as a maker's mark on the ring, pendant or circlet (`bright`), times what a stone gives (`jewel_bonus`) wherever it is worn (`jewelGain`, `jewel_gain`).
7. **Cut True** — a jewel you set gives up to +5% more, depending on its QL (now QL makes no difference). Built as a mark (`cut`): up to that much more by the jewel's quality, all of it at QL 100 and half at 50.
9. **Fine Castings** — rings and pendants you cast come up at +10% QL. Built as the anvil's `ql:` on what it makes (`ql:ring`, `ql:pendant`), as a Smith's Toolsmith is.
10. **Gem Eye** — your mining turns up gems twice as often. Built as the Miner's is (`gem:mine`), and the browser reads it now, as the island always had: it had not, for either trade.
12. **More Stones** — six new gems that favour farming, masonry, cooking, tailoring, taming and pottery. Built as six stones marked with the perk that lets them out (`gem_def.perk`): opal, peridot, amethyst, jasper, onyx and amber, drawn with the rest by weight for a miner who has it (`rollGem`, `roll_gem`) and set and worn like any other.
13. **Focus Cutter** — a focus you set wears 25% slower when you cast from it. Built as a mark on the focus (`thrift`), on its wear whoever casts (`spell_wear`).
14. **Keen Focus** — spells cast from a focus you set are 10% stronger. Built as a mark (`force`), on what a spell does and on how long a hold lasts, whoever casts (`spell_force`, `do_spell`).
26. **Deep Pot** — dishes cooked in a pot or bowl you made give 1 more serving. Built as a mark stamped on the unfired pot or bowl (`serve`), carried through the kiln, and a serving more of any dish made with it as the tool, whoever cooks; a drink out of a still is not a dish (`isDish`, `is_dish`). The kiln had dropped every maker's mark; it carries them now, on both sides.
27. **Sealed Jar** — fruit preserved in a jar you made keeps twice as long. Built as a mark on the unfired jar (`keeps`), carried through the kiln, on the rot of whatever is put up with it as the tool.
28. **Glaze** — a new job; a glazed pot, bowl or jar never decays. Built as **Glaze it**, on a fired pot, bowl or jar or an amphora, for one lot of ashes (`glaze_item`): a new mark family, `glaze`, nought on its decay on the ground, said on its own and not carried from a part, as a seal is.
34. **Good Read** — books you bind teach 25% more. Built as a mark on a book or a trade book (`teach`), on every go of study in it, whoever reads.
35. **Sturdy Binding** — books you bind take half the damage when studied (now 2–5 each time). Built as a mark (`sturdy`) on the wear a go of study does; the island had the wear, the lectern's worth and its reach written out by hand, and reads the browser's now (`study_wear`, `lectern_gain`, `lectern_reach`), where its lectern had reached a little further.
36. **Trade Book** — a new book written on one of your skills; studying it teaches that skill instead of mind logic. Built as a recipe for each craft trade's main skill, on papyrusmaking (six papyrus, two leather and two ink, with a needle), refused below 50 in the trade; the book's trade is its label, and studying it raises that trade as much as a plain book raises mind logic.
46. **Amphora** — a new fired jar that holds 20 of one food or drink, which keeps twice as long inside it. Built as an unfired amphora shaped on pottery and fired in a kiln into a bag for one kind of food or drink (`oneKind`, `one_kind`), which keeps half the weather off what is in it set down (`shelter`). On an island nothing in a bag on the ground had rotted at all; it rots at the bag's share now, as it always has offline, and a thing set down is no longer charged at its first round for the time it spent in a pack.
48. **Circlet** — a new gold band worn on the head, set with 3 stones that each give half their bonus. Built as a recipe on jewellery (two gold lumps, with a file), worn in the head slot in place of a helm, and **Set in the circlet** on a stone, which anybody may do: on jewellery, a stone that will not seat taken out again whole. Its stones are its label, drawn on it one by one.
49. **Potter's Wheel** — a new build; anyone shaping clay at it works 30% faster. Built as a piece (twelve planks, two shafts, a stone slab and twelve nails) with a pace on pottery (`pace`, `piece_pace`): a go at pottery within 2.4 tiles of one takes 0.7 of the time, after the floor, whoever built it.

**Tiers** (swept): 50 — Sure Setting, Keep the Stone, Deep Pot · 60 — Cut True, Fine Castings, Gem Eye ·
70 — Focus Cutter, Sealed Jar, Sturdy Binding · 80 — Bright Stone, Keen Focus, Good Read ·
90 — More Stones, Amphora, Potter's Wheel · 100 — Glaze, Trade Book, Circlet.
