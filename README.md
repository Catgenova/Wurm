# Wildermon

A browser remake of Wurm Online as a 2.5D isometric game. The whole page is one
canvas; every piece of UI is an HTML overlay floating above it.

**Play it: <https://catgenova.github.io/Wurm/>**

No runtime dependencies: rendering is Canvas 2D, terrain and sprites are
procedural, the UI is plain DOM. Vite + TypeScript for the toolchain.

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck, bundle, and refresh the site at the repo root
npm run preview    # serve the last build from dist/
```

Add `?seed=12345` to the URL to generate a specific island. Progress autosaves
every 20 seconds and as the page goes away. **New world** in the toolbar wipes
the save.

### Accounts

`account.html` sets up a username and a password, and nothing else — there is
no e-mail address to give and nothing is ever sent to you. The username *is*
the login (`alice` signs in as `alice@players.wurm.invalid`, a domain RFC 2606
reserves so that it can never reach anybody), which means signing up is itself
the reservation and a name cannot be forged: the island reads it back out of
the address rather than taking a client's word. Eight characters at the least,
and the password is checked against the Pwned Passwords list by k-anonymity —
only the first five hex characters of its SHA-1 leave the page — with an
unreachable list refused rather than waved through. Because no address can
receive anything, **a forgotten password is a lost account**; the page says so
before you choose one.

An account is an addition, not a toll. Settings (`O`) links to the page, the
island takes a Wanderer without one, and the single-player island in your
browser has never needed anybody's permission at all.

### The island the keeper serves

The front door opens on an island kept in Postgres. Open the site with nothing
in the address bar and it asks the keeper which island it keeps and comes
ashore on it — a page that needs a uuid pasted into it is not a front door.
That island is **4096 tiles a side**: sixteen kilometres across, 268 km²,
against the one square kilometre a 256-tile island covers.

What makes it affordable is that the land stops travelling. The join used to
download the whole world before you could take a step: `rpc_land` scanline by
scanline, base64 inside JSON, which is 138 MB at this size and is paid again by
every player on every join. It does not any more. The land is a pure function
of the seed and the survey chart, both of which this browser already has, so
the join carries the seed and the ground is worked out here — 64 × 64 tiles at
a time, the nine squares around you before the first frame and the rest as you
walk into them. What is left on the wire is what people have actually dug.

Postgres keeps its own copy and stays the authority: it is what the rules are
checked against. That copy travels exactly once, at founding, from
`tools/found-island.ts` — about half a minute of ground and 130 MB of land, run
once by a tool rather than in a tab somebody is waiting on. Founding from the
browser is for small islands and says so above 512 tiles.

`docs/tile-map-cost-analysis.md` is the arithmetic, and the three things that
had to be fixed before a big island would run at all: the pathfinder's buffers,
the minimap's canvas, and the database laying down sixteen thousand animals the
moment an island opened.

The one the keeper is holding was founded on 15 September 2026, seed 7, 130 MB
of land handed over in forty-six seconds:

    b6cc06ac-3d60-41f6-9026-de02cb8555b1

You do not have to know that. The `home` table holds it, the page reads it, and
the address bar decides only the unusual cases:

| in the address bar | what you get |
| --- | --- |
| nothing | the island this keeper keeps |
| `?island=<id>` | a particular island |
| `?found=<name>` | a small one, rolled here and handed over |
| `?alone` | the single-player game, in this browser, with no keeper at all |

`home` is one row and nothing with a browser can write it — whoever could would
be pointing every visitor at an island of their own. It is set by a migration,
and claimed by the opening of an island bigger than a tab may found (512
tiles), which is what tells `tools/found-island.ts` apart from somebody's page.
The keeper also refuses to reap it: everything else goes back to the sea after
a month with nobody on it, and a home island in a quiet month would take the
front door with it.

The single-player game is all still there and still saved in this browser. It
is one link away rather than the default, and it is also where the page lands
when the keeper cannot be reached — with a line saying which game you got and
why, because a page that cannot reach the island should still have a game.

Founding another island is the *Island* workflow with **found** ticked; it
prints the new address.

### Who you are

Between making the account and stepping ashore comes the second half of setting
one up: **build, skin, twenty haircuts, hair colour, eyes, beard, shirt and
trousers**, with a mirror beside them that walks. The mirror is `drawPlayer` —
the same function the island draws you with, not a second drawing of a person —
so the figure you are choosing is the figure you get. Haircuts and beards are
chosen from thumbnails of a head wearing them rather than from a list of names,
because a haircut is a silhouette and a name for one is a word you have to
imagine.

A look is eight short ids, never colours: it travels from your browser through
the database into `ctx.fillStyle` on everybody else's machine, and the island
keeper clamps every field against its own tables on the way past. The face is
kept with the account, so it follows you to every island, and it can be changed
whenever you like. A browser with no account still gets a face — a random one,
because nobody should be the default figure.

### Deploying

GitHub Pages serves the `main` branch from the repository root, so the built
site is committed: `index.html`, `account.html` and `assets/` at the root are
generated by `npm run build` from `src/index.html`, `src/account.html` and the
sources. Run the build before you commit; if a source change reaches `main`
without it, the *Build site* workflow rebuilds and commits the result.

## Controls

| Input | Effect |
| --- | --- |
You walk by clicking, and only by clicking. The keys move the *view* and open
things; none of them move you. Every one below can be changed in **Settings
(`O`) → Keys**, two keys apiece, and the table is the default rather than the
law.

| Input | Effect |
| --- | --- |
| Left click | Walk to a tile (paths around trees and cliffs) |
| W A S D / arrows | Push the view; the camera stops following you |
| Drag (left or middle) | Look around; likewise |
| Scroll, `+` `-` | Zoom |
| `C` | Centre the camera on yourself again |
| `Q` `E` | Turn the view a quarter turn (the HUD compass points north) |
| Right click | Context menu for the tile, tree or inventory item |
| `Esc` | Stop the current action / close the menu |
| `Enter` | Chat in the event window (`/name`, `/where`, `/help`) |
| `I` `R` `T` `K` `L` `M` | Inventory, Crafting, Tile, Skills, Event log, Map |
| `N` `B` `U` `J` `P` `O` `F1` | Settlement, Ledger, Stores, Journal, Wildermon, Settings, Help |
| `1`…`9`, `0` | Do the numbered action on the selected tile or creature; otherwise press a toolbelt loop |
| `Home` | Walk back to your settlement token |
| `G` `X` | Tile grid; cut away the walls facing you |
| Touch: tap, drag, pinch, long press | Walk, look around, zoom, open the action menu |

The number keys are the one exception: they are not in the table above and
cannot be rebound, because they always answer to whatever the Tile window or
the toolbelt is offering.

### How long things take

Every `baseTime` in the action and recipe tables is a **weight**, not a number
of seconds: felling a tree is worth more than picking a berry and the tables
say by how much. What sets the clock is one number in `src/game/pace.ts` —
mining is the yardstick, and a beginner with a plain pickaxe spends **thirty
seconds** on a face of rock. Everything else keeps the ratio to that it always
had, so re-pacing the whole game is one edit.

Skill and a good tool cut it from there: the same rock is about seventeen
seconds at mining 50 with a middling pick and eight at 90 with a fine one. The
floor — the shortest a go at anything can be — moves with the pace, so the
quickest jobs stay quick relative to everything else rather than all landing on
the same second.

Postgres prices a job the same way, through `act_duration`, which reads an
`action_pace()` generated from that same constant. Neither side has a number of
its own to drift with, and the suite checks the two agree.

### And how long the world takes

The world has a pace of its own, on the same principle and against a second
yardstick: **a stage of cotton takes five minutes**, and everything the world
does while nobody is watching keeps the ratio to that it always had. Crops,
brews, firing, smelting, traps, fuel, candles and torches, how long a beast
carries and how long before it will again, how quickly favour comes back — and
the length of a day, which is the most visible of them: **an hour of real time
to the day now, with twenty-five minutes of dark in it** rather than ten.

The day had to move with the rest or the point would be lost. A crop that took
a third of a day to ripen would have taken most of one, and every "twice a day"
thing in the game would quietly have become once. It also keeps the lights
honest: a torch was five minutes against a ten-minute night, and it is twelve
and a half against a twenty-five minute one — the same half a night it always
was.

The two paces differ (3.75 for jobs, 2.5 for the world), so a field is not
quite as many swings of a pickaxe of waiting as it was before either moved. In
days it is exactly what it always was, which is the relationship worth keeping.

Where `ACTION_PACE` is applied in the one function each side turns a weight
into a clock, `WORLD_PACE` is applied where each duration is **defined** — a
crop stage, a kiln, a candle and a pregnancy have no code in common, and the
one place they do share is the table they are written in. Scaling there also
means the definition dump carries them to Postgres already paced, with no
second multiplication at the far end to keep in step.

What did *not* move: how fast anything walks, how often a blow lands, and the
rest banked from a night in a bed, which is spent in working time rather than
in world time.

## What is in the game

- **Terrain like Wurm's.** A 1024×1024 tile island — a million tiles, about
  four kilometres a side at Wurm's four metres to the tile — whose height map
  lives on tile corners, so tiles are sloped quads rather than flat stamps. Heights are in
  "dirt" units (one dig = one unit = 10 cm on a 4 m tile). Water sits at height
  zero and floods anything below it.
- **Tile types.** Grass, dirt, packed dirt, sand, rock, steppe, tundra, marsh,
  clay, peat, tar, moss, snow, cobblestone, trees (birch, pine, oak,
  maple, willow, cedar with young/mature/old sizes), bushes, kelp and reed.
- **Bedrock everywhere.** Every tile sits on a particular rock of a particular
  quality, written down when the world is made and unchanged by anything done
  to the ground above it — under grass, forest or open sea alike. Metal is laid
  far more thickly into dry land than into ground under water, so roughly four
  fifths of a world's ore can actually be reached: about one land tile in seven
  carries a seam, some 60,000 of them on a 1024×1024 island.
- **Soil over bedrock.** Every corner carries a depth of soil on top of rock.
  Digging takes soil away and stops dead at bedrock; strip all four corners of
  a tile and it becomes rock of whatever kind lies beneath, which may be a
  metal seam. Dropping dirt buries it again.
- **Mining and prospecting.** Eleven metals lie in the rock, each needing its
  own mining skill to work: copper and coal at 1, tin 10, zinc 20, lead 30,
  silver 40, gold 50, adamantine 60, glimmersteel 70, mithril 80, seryll 90,
  and each rarer than the last. Mining bare rock is for what is in it: it
  yields ore or shards and leaves the face where it stands, bringing a slab
  down only one swing in thirty, by luck — and the same for a mola working a
  seam for you. Cutting the face back is its own
  entry — **Chip corner** — which takes the corner down a step one attempt in
  four and gives you what broke away. Prospecting marks every ore-bearing tile within range, buried
  or bare, and where you stand it names the rock, the skill any metal takes,
  the quality ceiling and how deep it lies; the range is 3 tiles plus one per
  10 levels of Prospecting. Coal outburns a log as campfire fuel.
- **Terraforming.** Dig the corner nearest your click, drop dirt to raise it,
  pack and cultivate, pave with bricks for cobblestone or cut
  slabs for a stone floor, remove paving. Flatten levels a tile to the
  height of the ground you stand on, scraping high ground down into dirt and
  packing dirt in to bring low ground up, so a terrace can be carried outwards
  tile by tile; flattening the tile under your feet takes it down to its own
  lowest corner. Slopes you may create are limited by your digging skill.
- **Beds you take off the top.** Sand, clay, peat and tar are beds rather than
  soil: stand on one and **Collect** fills a shovel off it — the entry names
  what is underfoot — leaving the tile's type, its corner heights and its soil
  exactly as they were, so a clay pit is still there tomorrow. It takes a
  moment longer than cutting a corner away, which is the only thing you give
  up; digging the corner still lowers the ground for when that is what you
  want.
- **Gathering.** Cut down trees for logs, pick and plant sprouts, forage and
  botanize with per-tile cooldowns, drink from any water or from a water skin
  you fill at the shore.
- **Deeds.** A deed stake, carved from a shaft with a carving knife, founds an
  11×11 settlement around a stone token; you may hold one at a time.
  Disbanding pulls the stake back up. Right-click any deed tile for the deed
  menu: manage the wildermon kept there, rename or disband, and upgrade the
  settlement. Each of the four upgrades widens the border by 2 tiles and takes
  on one more worker, and is earned by building the settlement out: a crate
  and a campfire for level 2, a stone smelter for 3, an anvil for 4, and a
  walled building with three wildermon at work for 5. Building is only possible on its land,
  things left outside rot ten times slower there, and a green border can be
  kept on permanently from Settings.
- **Looking inside.** A strip of arrows at the screen edge picks which storey
  you are looking at, lifting the ceilings above it off, with Auto to follow
  your own floor again; Page Up and Page Down do the same. A cutaway toggle
  (X) takes away the walls standing between you and the inside of a building
  while leaving the far walls in place.
- **Building, Wurm style.** Plan on flat packed dirt with a mallet, extend the
  footprint, plan walls on tile borders (solid, window, bay, door, double door)
  in twelve materials, feed them materials to build, lay floors with the paving
  skill, and plan another storey only once every wall below is built. Walls
  block movement; doors let you through.
- **Fences, gates and half walls.** The same twelve materials at a fraction of
  the cost — a log fence is two logs where a log wall is four — and they go on
  a bare tile border anywhere, with no building, no deed and no packed ground
  needed. A fence or a half wall stops anything alive at that border, player
  and wildermon alike, which is what makes a paddock a paddock; a **fence
  gate** is the one thing in the list you can walk through. Nothing rests on
  waist-high work, so a storey cannot be raised over a run of it. Staircases and ladders on an upper
  storey take you up and down, and roofs go on once the top storey's walls are
  finished, shaping themselves into hips and ridges from their neighbours.
- **A journal of goals.** Eighty-five goals in seven chapters — Ashore, The
  trades, The land, The water, The wildermon, Standing, A lifetime — from
  felling a tree to catching every kind of fish, brewing ale, cider, mead and
  wine, making a fantastic item and reaching 99 in a skill. Each says plainly
  what to do, and a hint says how when that is not obvious. Nothing is required and
  nothing is rewarded; each ticks itself off the moment it is done, says so in
  the events with a running count, and stays ticked for good. It exists
  because there is a great deal to do here and nothing else that says so.
- **Materials and crafting.** Planks and timbers from logs with a saw,
  shafts and mallets carved with a knife, thatch from cut grass, mortar from
  clay and sand, adobe from clay and grass, silver and gold chipped from
  veins in the mountains. Every recipe is a tool plus materials; the crafting
  window (R) is a recipe book grouped by craft: every recipe shows its tool
  and materials, green when carried and red when missing, with whatever you
  can make right now at the top and a switch to hide the rest. Each
  material's own menu offers the same recipes. A deed stake, the thing you plant to found a
  settlement, is carved from a shaft with a carving knife.
- **What a thing is made of matters.** The same bill of materials in two
  different woods, or two different metals, makes two different things. A log
  keeps the wood it was cut from all the way through — planks, timbers, shafts
  and whatever is nailed together out of them — and a lump keeps its metal
  from the seam to the finished blade. Every wood and every metal carries the
  same eight numbers: difficulty to work, weight, how much punishment it takes,
  how fast it rots, and what it is worth as an edge, as armour, as a tool and
  as a container. **Pine** is soft, light and rots fast; **willow** and
  **birch** are light and springy; **maple** is even-tempered; **oak** takes a
  third of the knocks a pine thing does, holds a tenth more and swings harder,
  at the price of weight and an afternoon's extra work; **cedar** barely rots
  at all. Among the metals **copper** is the soft starting point, **tin**,
  **zinc**, **lead** and **pewter** are stock for alloys, **bronze** and
  **brass** the first real step up, **silver** hardly tarnishes and bites
  anything that carries its own light half again as hard, **gold** never decays
  and is good for nothing else, and the four deep-seam metals —
  **adamantine** (the keenest edge), **glimmersteel** (light and the best
  armour), **mithril** (lightest of all) and **seryll** (scarcely takes a
  mark) — are what a lifetime of mining is for. One craft draws on one
  material: you cannot nail an oak plank to a pine one and call it a chest,
  and improving an oak chest wants more oak. The crafting window shows what a
  piece would come out *of*; click a different stack to use that one. Bows are
  the fussiest thing on the island — a short bow is tillered from willow, a
  medium bow from birch and a long bow from oak, and nothing else will do.
- **Queued actions.** Ask for a job while one is already going and it lines up
  behind it instead of cancelling it, starting the moment the first is done and
  walking you over if it must. Three fit in your head to begin with, one more
  per 10 points of mind logic, and the action bar shows what is waiting.
  Walking off or pressing Esc forgets the lot.
- **Characteristics that matter.** All five start at 20 and rise from the work
  that uses them: body strength is how hard you hit, body stamina how little
  wind an action costs and how fast it returns, body control how quickly
  everything is done, mind logic how many jobs you can line up and how often a
  hard craft comes out right, and soul strength how readily a wild animal
  trusts you. Climbing raises the step you can take between tiles — slopes that
  turn you back at the start open up later — and swimming makes deep water
  faster and cheaper. The Skills window spells out what each is worth right
  now.
- **Nails.** A nail mould is fired from sand at a smelter and cast on an
  anvil: one lump of metal runs out as a hundred nails of ten grams each.
  Everything that is nailed together needs them — plank crates, tool heads
  fitted to shafts, and all twenty pieces of furniture — while sawing planks,
  carving shafts, bundling thatch, notching a log crate together and raising a
  wall of any material need none at all, so neither the first shelter nor the
  first storage waits on a smith.
- **Furniture and storage.** Fine carpentry, the furniture hand as distinct
  from the carpentry that cuts the wood, builds twenty pieces from planks,
  timbers, shafts and nails: stool, chair, bench, table, long table, writing
  desk, bed, cot, chest, coffer, cupboard, wardrobe, shelves, bookshelf,
  larder, barrel, lectern, coat rack, planter and firewood rack. Each is
  carried like a crate and set down on the subtile grid, taking the block of
  spots its size needs. Ten of them store things, and store more than a crate:
  a coffer 25, a barrel or firewood rack 40, a chest 60, a cupboard 80, a
  bookshelf 90, a wardrobe 100, shelves 120 and a larder 150. Open one to see
  inside, or stand beside it and put things away; nothing can be lifted again
  until it is empty.
- **Eat and Feed buttons.** The Eat button by the food bar eats the best food
  you carry; the Feed button on the companion line gives your wildermon the
  poorest thing it will take, so the good food stays in the pack.
- **Tools wear out and are repaired.** Every use puts a little damage on the
  tool the work called for, faster the poorer the tool, and damage makes it
  work as though it were poorer still — but slowly: a rough tool is good for
  about three hundred jobs and a fine one for over a thousand. Past 75 damage
  it warns in red, and again every five points after; at 100 it breaks and is
  gone. Repair is its own skill: right-click a damaged thing and the work goes
  a few seconds at a time, taking damage out and a little quality with it — a
  couple of minutes and a couple of points of quality for a beginner, far
  fewer goes and half a point for a skilled hand.
- **Deed orders.** The deed menu sets one stance for every wildermon kept
  there, and it fires when something wild crosses the border: aggressive ones
  break off work and go for it, defensive ones answer only what has struck at
  them or at you, passive ones carry on working.
- **Quality: the skill is the ceiling, the tool is the chance.** Every piece of
  work comes out either at your skill in that trade or at 1, and the tool's
  quality is the percentage chance of the good one — a quality 20 hatchet off
  the beach is right four times in twenty, a hatchet worked up to 90 nine times
  in ten. Nothing is ever finer than the hands that made it, so a fine tool in
  a beginner's hands makes beginner's work and simply stops wasting the
  material. Work with no tool at all — foraging, farming — has nothing to roll
  against and comes out around what the skill can do.
- **Quality: a thing made of parts is worth what its parts are worth.** The
  rule above is for work made out of raw stuff. A recipe that joins finished
  parts together — the five alloys, and the seventeen that fit a forged head,
  blade or haft to a handle — is not rolled for at all: it comes out at what
  went into it, weighed by how much of each of it goes in, and the trade skill
  decides how much of that survives, from 78% at no skill to 99.7% at a
  hundred. So a pickaxe is its head (1.2 kg of it) and its shaft (1 kg), and
  the two nails (10 g apiece) decide nothing. Mining a better vein, smelting
  it well and forging a better head all reach the tool at the end of it, and a
  poor handle on a good head shows.
- **Rare things.** About one thing in a hundred comes off the bench **rare**,
  one in a thousand **supreme**, one in ten thousand **fantastic**. Nothing
  brings it on — not skill, not tools, not the metal — and nothing makes it
  more likely. A rare thing is better at whatever it was for by a tenth, a
  quarter or a half, wears and rots more slowly in the same proportion, and
  can be improved 5, 12 or 25 past the ceiling of your own skill. Anything
  that holds things holds more of them — a bag, a crate, a cupboard, a weight
  bin, the charge a smelter takes and the load a kiln fires — by 5, 10 or 15%,
  and never by less than one unit a step, so that a small container's steps do
  not round into each other. They carry
  the word in their name and their own colour in the pack, and on the ground
  they shine in that colour: a rare thing throws four slow blue motes, a
  supreme one six violet ones over a bloom, a fantastic one eight gold ones
  under a turning star you can pick out across a field. A heap shines for the
  best thing in it, and a chest, a cupboard or an anvil set down keeps its
  rarity and shines where it stands.
- **Improving.** Anything finished can be bettered — except the kit you washed
  ashore with, which is issued gear: it mends but it does not improve, so the
  first real job on the island is making your own tools. Each pass spends stock
  and raises quality, fast at first and slowly near the top, while a failure marks
  the piece and past 10 damage it must be repaired before the work can go on.
  What you need is decided by the material — a file and a whetstone for metal,
  a carving knife and a file for wood, a needle for cloth, an awl and needle
  for tanned leather, a chisel and whetstone for stone — plus a little of the material
  itself per pass. Whetstones are chiselled from shards and needles and awls
  carved from bone, so most improving starts long before a forge; a file is
  cast from its own mould, which is what gates metal. The judging skill is
  whichever one would have made the thing, and nothing improves past it.
- **The oven.** A mason's job — ten stone bricks and four mortar with a trowel
  — set down on four spots like a smelter. It takes the same fuel a fire does
  and holds two hours of it. A lit oven is a cooking fire for every recipe,
  and a better one: the brickwork holds its heat, so what would have burnt
  over a flame comes out right and comes out finer. It leaves ashes like any
  other fire.
- **Bags.** A **sack** of 2 cloth (40 things), a **satchel** of 3 leather and a
  ribbon (25) and a **backpack** of 6 leather and 2 ribbons (60), all carried
  in the pack and opened through the same window as a crate. What is in a bag
  is out of reach until it comes out — no recipe draws on it — and one bag
  will not go inside another. What a bag is for is that it sheds the weather:
  dropped on the ground, what is inside rots at four fifths the rate in a
  sack, half in a satchel and two fifths in a backpack, so a pack of food and
  tools left at a work post keeps far better than the same things thrown down
  beside it.
- **Work posts.** A settlement's worth of orders on a stake: 2 planks, 2
  shafts, 4 nails and a metal ribbon with a mallet, driven into any spot on
  open ground **outside** your own borders. One wildermon may be set to it and
  works out of it exactly as it would out of a settlement — the same job, the
  same skill gained — only measured from the post. A post is a work site
  rather than a settlement, so it keeps its creature on a short rein: 8 tiles
  round a rough one and 20 round the best, whatever the creature has learned.
  Anything with room in it inside that circle takes the loads, so a crate
  beside the post makes a camp that keeps itself. Nothing holds a post up and
  it rots where it stands — about half an hour at quality 1 and three hours at
  quality 100, leaning further as it goes — and when it falls the wildermon
  comes back to your side if you are walking alone, or goes to the token if you
  already have a companion. A creature on a post is not on the settlement's
  books and costs none of the working slots your deed level allows, which is
  most of what a post is for: a logging camp in a far wood, a digger on a clay
  bank, a Snout turned loose over an old ruin, for as long as a stake in wet
  ground lasts.
- **The level, and a spadeful out of the cart.** Take the level at a corner and
  that height is the mark: flattening aims at it from wherever you stand, and
  digging, chipping, dropping dirt and laying concrete all refuse a corner once
  it is on the mark — so a run of goes stops exactly there instead of counting
  spadefuls and overshooting. Dirt, clay and sand weigh 20kg apiece, so
  dropping dirt and the packing-in half of flattening will draw a spadeful out
  of any crate, cart or bin within reach when you carry none yourself.
- **Raw materials, rubbish and a cart.** A raw material bin holds 400 of what
  comes out of the ground, off a tree or off a beast unworked — ore, logs,
  dirt, shards, wool — and refuses everything a bench has touched. A trash crate rots what is put
  in it thirty times faster than open ground, and Put away never chooses it —
  throwing something out has to be asked for. A small cart holds 100 things
  and follows you about once you take hold of the shafts, until you let go.
- **Boats.** Two hulls a carpenter builds. A **rowing boat** — 20 planks, 6
  timbers, 2 shafts, 30 nails — carries 300 things, wants two deep of water
  under her and is rowed, so body strength is the engine. A **sailing boat** —
  40 planks, 14 timbers, 3 shafts, 6 cloth, 4 ribbons, 70 nails — carries
  1500, wants four deep, and the wind does the work, so body control decides
  how much of it you waste. Launch one by setting her down on water deep
  enough while you stand on the bank; she moves with you over any water with
  depth enough and over nothing else — no beaching, no sandbars — and stepping
  ashore puts you on the nearest dry ground or refuses if there is none.
  Besides opening the coast, a boat is the only way to put a line over
  thirty feet of water, which is where the pike and the sturgeon are.
- **Large carts and wagons, and something in the traces.** Two vehicles that
  are driven rather than pulled by hand, built to a wheelwright's bill: large
  wheels (planks, shafts, a metal ribbon and nails), big axles cast in a mould
  on an anvil, ribbons run four to a lump out of a gang mould, and a stitched
  yoke to every hitch. A **large cart** — 20 planks, 6 timbers, 2 wheels, an
  axle, 8 ribbons, 2 yokes, 40 nails — holds **1000 things of any weight** and
  moves behind one wildermon, faster behind two. A **wagon** — 40 planks, 12
  timbers, 4 wheels, 2 axles, 16 ribbons, 4 yokes, 80 nails — holds **10000**
  and will not stir until all four yokes are filled. Hitch a tamed wildermon
  from its own menu, climb on and take the reins: the team decides the pace and
  the load does not come into it, so a fine pair outruns you at a walk while
  four slow ones shift ten thousand bricks at their own speed. A hungry animal
  drags its feet. Wheels keep to open ground — no fords, no stairs, nothing
  steeper than a horse would take — and nothing in the traces can be sent to
  the token, reassigned or released until it is unbuckled.
- **Water away from the shore.** A well is laid in brick and mortar and then
  draws its own water, up to 50 litres, at a speed its quality decides — a
  poor shaft trickles, a fine one keeps up with a settlement. Buckets and
  waterskins fill at it as they would at a shore, and you can drink from it
  where you stand. Barrels hold liquid and nothing else in three sizes (30,
  80 and 250 litres), one liquid to a barrel; pouring a bucket in gives the
  empty bucket back, and filling beside a barrel draws out of it.
- **Light after dark.** A candle was makeable from the start and its own
  description promised a lantern that did not exist; here it is. A **lantern**
  (4 ribbons, 2 cloth, a shaft, on a hammer) takes a candle and burns it only
  while lit — five tiles and 17 minutes to a candle at the roughest, nine tiles
  and 29 at the best. Carried lit it gives back most of what the dark takes:
  8 tiles of sight at the dead of night without one, 16 with. Lit campfires,
  ovens, kilns, smelters and the two glowing creatures each cast their own
  circle, burnt out of the night wash with a soft edge and a little firelight
  in it. Nothing is computed while the sun is up.
- **Calling things by name.** Any crate, bin, chest, cart, piece of furniture,
  work post or trap takes a name of its own, and that name is what it is called
  everywhere after — the Stores window, the settlement window, its own menu,
  the tooltip. Answering with nothing takes the name off again. A **sign** and a
  wider **signboard** are boards made to be written on: set one up, name it,
  and the name stands in the world above the board for anyone walking past.
- **Roads worth their stone.** Feet hardly care what is under them; a laden
  wheel cares about little else. An empty cart rolls over anything at its own
  pace, a full one is held to what the ground will take, and a half-loaded one
  pays half. Slabs and cobble cost a full wagon nothing; packed dirt a
  tenth, grass three tenths, sand and a field half, a bog seven tenths. Forty
  tiles with a full wagon is 13 seconds on a paved road, 24 over grass and 92
  through marsh. Walking with a load is routed the way a carter would take it —
  a full cart took 24 of its 25 steps on stone to get round a bog an empty one
  cut straight through — and the hud says what the ground is costing.
- **A ledger of everything made.** Every kind of thing that has come off a
  bench, an anvil or an oven is written down: how many, how many came off rare
  or better, and the best one ever managed, ordered by any of those or by name
  or newest first, and searchable. The first of anything says so in the log,
  and so does every time you beat your own best.
- **What is in a meal.** Four nutrients — starch, flesh, fat, greens — are
  kept under the food bar, fed by different food and falling away over fifty
  minutes. Raw food feeds one of them a little (a potato is 6 starch, meat 9
  flesh); a cooked dish feeds several and feeds them properly (bread 30
  starch, cooked fish 28 flesh and 10 fat), and a stew is the only thing that
  feeds all four. Anything in you holds hunger and thirst off — on a full
  board they fall at three fifths of their pace, 29 minutes to half a food bar
  against 21 — and a board with all four full makes everything you do go in a
  fifth faster. That last reads off the *shortest* of the four, so three full
  and one empty is worth nothing: 200 goes take digging to 50.5 on an empty
  stomach and 54.4 on a full one.
- **Rest and knacks from the table.** Sleeping in a bed banks **rest** — about half the
  night, more from a better bed, up to an hour held at a time. It burns only
  while you are actually working, and everything done while it burns teaches
  you twice as much. Separately, every cooked dish **favours one trade**:
  eating it makes that trade go half again as fast for anything from four
  minutes to half an hour, by how filling the dish was and how well it was
  made. Which dish favours which trade is settled when the island is raised
  and never changes on it, and no two islands agree — examine a dish to see.
  Between them they are what elaborate cooking and a good bed are actually
  for.
- **Night, and a bed to wake in.** A day and a night pass in twenty-four
  minutes, an hour to the minute, with the clock beside your position and the
  world darkening between dusk at eight and dawn at six. A bed or cot can be
  made your home, which is where you wake whatever happens to you, and slept
  in after dark to wake at half past six rested. The world carries on while
  you sleep: fires burn down, crops come on, and anything left outside ages.
- **Grain, the quern and bread.** Wheat and corn are useless until they have
  been milled. A quern — two stones dressed flat and grooved, chiselled from
  three rock shards — grinds two wheat into flour or two corn into cornmeal
  under the Milling skill. Flour and a bucket of water make dough (the bucket
  comes back), dough baked at a fire makes bread, and cornmeal boiled in a
  clay bowl makes porridge.
- **First aid.** Cloth cuts into three bandages with a knife. Right-click one
  to bind your wounds: each strip treats one wound and is used up, and the work
  carries on while you are hurt and still carrying cloth. A clean dressing is
  worth what your skill and the cloth are worth, a slipped one about a third.
  The same bandages treat a hurt tame wildermon standing beside you.
- **Reeds, papyrus and books.** Reed beds can be cut with a knife. Four reeds
  soaked in a bucket of water and pressed give three sheets of papyrus
  (Papyrusmaking). Ink is alchemy: a gland — the rare part off a carcass, and
  until now good for nothing — ground with ashes into water. Six sheets, two
  leather boards, ink and a needle bind a book, and studying one raises mind
  logic and wears its pages. A lectern doubles what an hour is worth.
- **Archaeology and restoration.** Investigate any soil or sand with a trowel
  and the ground gives up fragments of what the old people left. Each fragment
  names its relic and which piece it is, and comes up damaged, so Repair earns
  its keep. Eight things lie under the island, from an old pot in two pieces to
  an ancient helm in five; the harder ones are only recognised as archaeology
  rises. With every piece in hand, Restore puts the thing back together — a
  failure marks all the pieces instead — and what comes out is only as good as
  what went in. Some are treasure (statuette, bronze mirror, bone comb, old
  lamp) and some are an old file, an old blade or an ancient helm.
- **Ashes, lye and tanning.** Every fire leaves ashes behind — a campfire, a
  smelter or a kiln, about one lot per two minutes of burning — and Take ashes
  rakes them out lit or cold. A bucket is three planks and six nails; fill it
  at any shore, and two lots of ashes leached into a bucket of water make lye,
  which is what the Alchemy skill is for. One bucket of lye tans one raw hide:
  leatherworking and a carving knife take the hair off and work the skin soft,
  giving leather and the empty bucket back. Leather is what caps, jerkins,
  sleeves, trousers and boots are cut from, and what an awl and needle work
  into a leather piece when improving it.
- **Wool, cloth and the loom.** Fibre becomes cloth in two steps with two
  pieces of furniture: a spindle spins wool, cotton or wemp into yarn, and a
  loom weaves three yarn into cloth. Cloth stuffs a mattress, sews into
  clothing, and twisted into a bowstring starts every bow.
- **Armour.** Worn a piece at a time in five places — head, chest, arms, legs,
  feet — and it only counts where the blow lands. Four kinds, each a skill of
  its own that rises by being hit in it: cloth (tailoring, ~1/6 of a blow),
  leather (leatherworking, cut from tanned hide, ~1/3), chain (chain armoursmithing, ~1/2) and plate
  (plate armoursmithing, ~2/3). Quality and skill raise those; damage lowers
  them, and a piece beaten to nothing falls off. Weight is the price — full
  plate slows you a quarter and makes everything cost more wind. A shield in
  the off hand stops whole blows outright instead, as often as the shields
  skill and its quality allow, and two-handed weapons leave no hand for one.
- **Weapons.** Knives, swords, axes, mauls, polearms and archery are each their
  own subskill, trained by use, with the fighting skill behind them; together
  they decide whether a blow lands and how hard. Each weapon has its own
  damage, pace and reach: a knife is quick, a maul or battle axe is slow and
  final, a spear reaches a tile further, and the two-handers cost you the
  shield. Heads come from moulds at an anvil and are fitted to shafts; a club
  is carved from a log.
- **Bows and fletching.** Bowyery tillers short, medium and long bows (six,
  nine and thirteen tiles) from shafts and a bowstring. Fletching makes arrows
  from a shaft, three arrow heads — a gang mould casts twenty-five from one
  lump — and three feathers, which only come off a bird. With a bow in hand,
  Shoot appears on any wild creature in range; long shots are harder than close
  ones and every shot spends an arrow.
- **Stonecutting.** A chisel and the Stonecutting skill turn rock, slate,
  marble and sandstone shards into bricks — what walls, smelters and kilns are
  built from — or, two shards at a time, into slabs. Slabs are paving rather
  than building material: Pave (slabs) with a trowel lays a floor of that
  stone, each of the four a different colour, and breaking paving up with a
  pickaxe usually lifts the slab out whole. Masonry lays the stone;
  stonecutting cuts it.
- **Pottery and the kiln.** Everything shaped from clay comes out soft.
  Pottery makes unfired bricks, bowls, pots and jars, and green ware is no use
  until it has been fired. A kiln — six stone bricks and two mortar, crafted,
  carried and set down on any dry flat ground, and picked up again when cold
  and empty — burns the fuel a campfire does; pack the green ware in, light
  it, and each piece takes its own time at heat, faster and truer in a
  well-built kiln. Fired, the bowl cooks, the pot makes pottage, the jar puts
  up preserves, and the brick builds.
- **Where deed workers put things.** A worker fills the deed crate first, then
  the nearest other store on the deed that will take its load — crate, raw
  material bin, chest, larder, cart — never a trash crate. When everything is full it
  holds on to what it is carrying and waits near the token instead of tipping
  it on the ground, saying so once. Seed for sowing and wood for stoking are
  drawn from any store on the deed, not only the deed crate.
- **Foraging by the handful.** Foraging and botanizing take one more pass over
  the tile for every twenty points of the skill — one below twenty, three at
  forty, six at a hundred — each pass its own chance of a find and its own roll
  on the table. The tile is picked clean for the same while afterwards, so
  skill is worth more than walking twice as far, and the menu says how many
  passes you are good for before you start.
- **Wildermon.** Tameable creatures with a taming skill. The Rabba, a
  rabbit-like grazer, forages berries when hungry and is tamed with a berry or
  vegetable; the Vola, a mole-like digger, botanizes herbs and roots and is
  tamed with a spice or vegetable; the Bevere, a flat-tailed gnawer that only
  lives within sight of water, is placid by nature, eats vegetables and
  starches, and fells trees for its deed, carrying the logs to the crate; and
  the Seavic, a squirrel that lives among trees, eats acorns and nuts, is
  placid too, and runs a deed's farm — sowing seed from the crate, tending
  every stage and carrying the harvest back, though it cannot till a field of
  its own and works only ground the player has raked; and the Mola, a
  broad-clawed mole found on metal and fed on spices, which works the seams
  for its deed, taking the nearest ore no other Mola has claimed and bringing
  back metal at the quality its own mining skill earns, up to the seam's
  ceiling, with a range that grows 5 tiles per 10 levels rather than 10; and
  the Crawler, a broad sand-dwelling crab fed on vegetables, which digs sand a
  clawful at a time from the highest corner of a sand tile and carries it to
  the deed crate; the Noot, a plump upright waddler that settles beside the
  clay pits, eats root vegetables, and digs clay for its deed the same way,
  which is what keeps a potter in clay without walking the shore for it; the
  Quarra, a stone-jawed thing that sits on bare rock, eats clay and cuts rock,
  slate, marble and sandstone into shards; the Embra, which sleeps in peat and
  tar, eats only cooked food, and keeps every fire, smelter and kiln on the
  deed fed and lit from the crate; the Magga, a magpie that clears a settlement
  of everything dropped and forgotten and puts it in the crate, while wild ones
  do the reverse; the Woola, a mild grazer that does no work but grows a fleece
  you shear with a knife for wool, back again in a quarter of an hour; and the
  Ulva, the one creature that hunts the player unprovoked, tracking by scent
  from seven tiles and giving up only when you are well away or it is badly
  hurt — taming 30 to try, and a tamed one keeps watch over the deed and goes
  for anything wild that crosses the border. Three more come with the wheels:
  the **Roxxen**, a slab-shouldered ox that does no job but pull, leaves the
  largest carcass on the island, and trains **climbing** in the traces — what
  a team knows between them sets both the pace of a cart and the steepness of
  the line it will take, so a green pair balks at a bank a worked pair walks
  up; the **Orse**, which learns the same skill hauling or under a rider and
  can be **mounted** once a saddle and a bridle are stitched and fitted, a
  green one carrying you a shade faster than your own legs and a worked one
  half again as fast and up slopes you would have to go round; and the
  **Rowl**, which hunts on sight in the wild and hunts for you tamed — it
  works a circuit of the token, runs down anything wild inside it, and carries
  the carcasses back to storage, its **fighting** skill deciding both how hard
  it bites and how wide that circuit runs, from twelve tiles to over a
  hundred. The Crawler is defensive by nature: it hits back every time
  it is struck, and even a tamed one turns on whoever stands beside it now and
  then, though a helm blunts it. Each puts the tile on the same cooldown a
  player would, and none retaliates for a failed taming attempt. A wild thing
  that has taken food from your hand and still refused you is a little readier
  for the next offering — three points in a hundred for every attempt in a row,
  up to twelve after four of them — which means a long run of refusals is going
  somewhere rather than nowhere. The run lapses if you leave it ninety seconds,
  and raising a hand to it ends the run outright. A companion
  follows you with a Passive, Defensive or Aggressive stance; a deed worker
  forages or botanizes around the settlement and delivers to the deed crate;
  spare tamed ones are kept at the token. A deed worker feeds itself from any
  crate on the deed once its hunger falls below a quarter. A Wildermon window shows your
  creatures' health, hunger, level, skills and working range (wild ones stay
  hidden); workers gain skill at half a player's pace, work at half a player's
  speed, improve the quality and pace of their work as they level, and range
  10 tiles further from the token for every 10 levels of their task skill.
- **Wounds, herbs and covers.** A blow leaves a **wound** — of a kind, in
  the place it landed — rather than only a number off the bar. It bleeds
  until dressed, goes bad if it never is, and nothing knits while something
  is still open. Five kinds, each with a herb that suits it: a **cut** wants
  **thyme**, a **puncture** basil, a **bruise** mint, a **burn** sage, a
  **bite** rosemary — and what you get is what hit you, since a hoof
  bruises, a claw opens, a sting goes deep and narrow, and the two
  creatures that carry their own light burn. A **bandage** stops the
  bleeding and holds (a cut closes in about three quarters of an hour); a
  **healing cover**, the herb bruised into cotton, closes the right wound in
  twenty minutes and it never turns. Left open, seven cuts in ten go bad
  within twenty minutes, against one in eleven under cloth. A wound that has
  gone bad drains instead of closing and takes nothing until it is scoured
  out with lye.
- **Dye.** Eight dyestuffs boiled out of things that grow, each with a
  bucket of lye to bite the colour in and hold it: **woad** (blue, from
  blueberries), **madder** (red, raspberries), **scarlet** (strawberries),
  **cochineal** (crimson, lingonberries), **oak gall** (black, acorns),
  **weld** (yellow, sage), **verdigris** (green, mint) and **umber**
  (brown, nut husks). One pot colours one thing, and cloth and leather take
  dye where metal will not — armour of those two sorts, cloth, sacks,
  satchels, backpacks, a saddle, a bridle, a **banner**, and a sailing
  boat's sail. A dyed chest or leg piece is worn where it shows: the figure
  on screen walks about in it, and a planted banner flies your colour over
  the deed. Boil it out in lye to change your mind.
- **Titles and knacks.** Every trade hands out a **title** at 50, 70, 90 and
  99 — Joiner, Carpenter, Master Carpenter, Legendary Carpenter — and you
  wear one at a time, picked in the Skills window and shown beside your
  position. A permanent **knack** comes of the work itself: **one go in five
  thousand**, at any trade and any level, usually in that trade and sometimes
  in one beside it (a long day of carpentry may leave you better at bowyery —
  same hands, same wood). A knack is a tenth more on everything that trade
  teaches you, it never wears off, and a trade holds five of them: half again
  on every gain, for good, stacking with rest and with what you have eaten.
  Being luck rather than levels, it can land at any moment and never dries up
  — the ten-thousandth hour is as likely to leave one as the first.
- **Rope.** Wemp fibre goes two ways: spun on a spindle it is coarse yarn,
  laid up on a **rope tool** it is **rope** — four fibres to a rope, on the
  new **ropemaking** skill — and three ropes laid up again make a **thick
  rope**. Rope is a real input rather than a curiosity: a bridle takes one
  for the reins, a rowing boat two, a sailing boat eight and two hawsers of
  standing rigging, and a well a hawser to hang its bucket on.
- **Bridges.** Water and ravines were walls; now they are gaps. Stand on one
  bank and right-click the other to throw a bridge across: it must run
  straight, both ends must be dry ground, the ends must be within twelve
  height units of each other, and what is between must be at least three
  units below the deck — a gap, not a slope. A **rope bridge** (two hawsers,
  three planks, four nails a span) spans fourteen tiles and takes feet only;
  a **wooden bridge** (four timber, six planks, twelve nails) spans ten and
  carries a cart; a **stone arch** (ten bricks, six mortar, three slabs)
  spans eight. It is built a span at a time like a wall, nothing crosses
  until the last span is decked, and pulling one down returns half of what
  went into it. A boat passes underneath.
- **Wind.** A direction and a strength, both wandering, both worked out from
  the clock rather than stored — the same wind for anyone there at that hour,
  a different wind on a different island. Oars ignore it; a sail lives on it,
  and far more on the **angle** than the strength. Across the wind is
  fastest, before it is steady and slower, hard up into it is hard work, and
  inside the last thirty-six degrees she is **in irons** and makes almost no
  way — so getting anywhere upwind means **tacking**. On a ql 70 oak hull in
  a hard blow: 6.1 tiles a second on a beam reach, 5.0 running, 3.5
  close-hauled, 0.7 in irons. The bars show an arrow flying with the wind and
  the point of sail you are on, and the sail itself goes out on whichever
  side the wind is. A hull loaded to her marks is a third slower than one
  running empty.
- **Bait, nets and creels.** **Bait** decides what bites, in a ladder every
  rung of which is something you caught on the rung below: **worms** (turned
  out of damp dirt with a shovel) bring up **perch**, a live **minnow** or
  raw meat brings up a **pike**, and a whole **perch** on the hook is what
  brings up a **sturgeon** — a bare hook gives 4 sturgeon in a hundred in
  deep water, a perch on the hook gives 28. Whatever is worth using comes
  out of your pack by itself. A **net** (twelve yarn, two ropes, a needle)
  is dragged through wadeable water and takes several small fish a haul
  while the big ones go through it. A **creel** (fourteen reed and a rope)
  is a basket with the throat turned inward: sink it off a bank, bait it,
  walk away, and it fishes on its own — holds eight, gives four or five to
  a baiting, and kept baited is worth about twenty-five fish an hour for no
  work at all.
- **Finding things and moving them in bulk.** A **Stores** window lists every
  container you own, nearest first, with how full each is and what is in it;
  type what you are after and it narrows to the stores that have it, with
  **Walk there** and **Open**. Any open container has **Take all**, **Put all
  in** and **Put in what it holds** — the last tops a store up with only the
  kinds already in it. Nothing kept back or worn moves either way. The
  inventory sorts by name, quality, weight, damage or count and groups by
  kind or runs flat. **Pick up everything here** sweeps your tile and the
  eight around it in one go.
- **Keeping things back, and what your back will take.** Any item can be
  **kept back**: never spent by a recipe, never used as bait, never fed away,
  never dropped — but still usable as a tool, which is the point. You carry
  forty kilos plus most of a kilo per point of body strength; past that you
  are slower and tire faster, and the inventory footer and the bars both say
  by how much. The damage column turns amber past 75 and red past 90.
  Releasing a wildermon that carries supreme or fantastic blood names what is
  on it and warns you that you will not get it back.
- **Meditation, and the three paths.** Weave a **rug**, sit on it once every
  twelve minutes, and where you sit decides what it is worth — your own yard
  is the worst place, high thin air is worth half again. At five meditation
  you choose one of three ways, once and for good. **Love** is the
  gardener's: crops on your deed come on a fifth faster, wild things are a
  quarter readier to trust you, harvests give a third more, plus **Refresh**
  and **Mend the flesh**. **Knowledge** is the reader's: everything teaches
  you a tenth faster for good, you read any wildermon's blood at a glance,
  you see a quarter further, plus **Sense the rock** and **Recall the way**.
  **Power** is the plain one: armour burdens you a fifth less, you hit a
  sixth harder, and what you wear turns a tenth more — a full plate suit
  goes from turning 70% of a blow to 78% — plus **Second wind** and
  **Fury**, half a minute of double damage. Each path opens five things:
  two called on with a long rest between, three simply true from then on.
- **An altar, and favour.** No god with a name; a stone table, the hour
  before the sun is properly up, and the plain fact that a thing knelt over
  at dawn comes out better. An **altar** is sixteen bricks, eight mortar,
  four slabs and a lump of gold. Kneeling banks **favour** on the new
  **prayer** skill — once in most of an island day, worth half again around
  dawn or dusk, and better from a better-built altar; it also trickles back
  on its own up to what your faith carries (25 at the start, 120 at the
  top). Six things it buys, none available any other way: **Call** (12) puts
  your companion beside you from wherever it had got to; **Mend** (18) takes
  every mark of use off one thing; **Light of the dawn** (26) closes every
  wound and cleans what had gone bad; **Circle of cunning** (34) makes a
  tool work 9% better than it was ever made to, permanently, three times
  over; **Fair wind** (30) brings the wind round behind wherever you are
  pointed; **Bounty** (44) brings every field on the settlement on a stage
  at once.
- **The things that are not wildermon.** Four of them, and none can be
  tamed, trapped, bred or brushed. A **goblin** (40 health, hits for 14) is
  knee-high and entirely malice; an **orc** (95, 22) is a head taller than
  you and carries sharpened iron; an **ogre** (170, 34) is three times your
  weight and most of it shoulder; and somewhere out there is the **dragon**
  (700, 70). They notice you from eleven to twenty tiles off — further than
  anything else pays you any attention — come straight at you, and do not
  give up easily. They are about one thing in fifty that stands up out in
  the country, weighted heavily to goblins, capped across the island (six
  goblins, three orcs, two ogres, **one dragon**), and the bigger the thing
  the further it keeps from anywhere anybody lives: no dragon within ninety
  tiles of your token. An orc takes an unarmoured player from full to a
  fifth in four seconds.
  What they are worth is the other side of it. Butchering gives **tusk** and
  **sinew** off an orc or ogre, and off a dragon twenty-four **dragon
  scales** and a **hoard** — a double handful of lumps of the four deep
  metals and the two precious ones, the only place they turn up together.
  Tusk and sinew lay up a **composite bow**: seventeen tiles and 21 damage
  against the long bow's thirteen and 15. Dragon scale riveted to leather
  makes **scale armour**, a fifth class above plate — it turns 74% of a blow
  where plate turns 62, and burdens you less than chain. A full suit takes
  twenty-six scales, rather more than one dragon carries.
- **Traps.** The other way of taking a wild thing: set it, bait it, walk
  away, and whatever came to the bait is waiting when you come back —
  **alive**, with the blood it was born with still in it. A **snare** (a
  rope and two shafts) holds to about taming 20; a **deadfall** (three
  planks, two shafts, two ropes, six nails and a mallet) to about 60.
  Traps go outside your own borders — nothing wild comes inside them —
  and the bait menu says which sorts would come to each thing in your pack.
  Anything warier than the trap will hold takes the bait and goes. Timid
  creatures, the ones you cannot walk up to, are half again as likely to
  walk in; hunters much less so. Traps rot where they stand and whatever is
  in one walks away when it goes over. Getting the catch out is still
  taming: the skill wall stands whether the animal is held or not.
- **Traits, genders and animal husbandry.** Every wildermon is born **male**
  or **female** and carries **three traits**, drawn from four tiers —
  **common**, **rare**, **supreme**, **fantastic** — whose worth climbs steeply
  with the tier: a common trait is a few percent, a fantastic one half again or
  better. Between them the thirty-one traits lift how fast it moves, how
  quickly it works, how fast the work goes into it as skill, what it carries
  and pulls, what it brings back, how little it eats, how much it can take, how
  hard it hits, how far it sees, how far it will range, and how fast fleece and
  milk come back on it. Four are **communal**: what they lift, they lift for
  every wildermon working the same settlement or the same post — one *pack
  leader* makes a whole deed quicker and brighter. What is walking about in the
  wild is almost all common (a fantastic trait is about one animal in seventy),
  so better blood is bred rather than caught. **Animal husbandry** is the skill
  and the **brush** is the tool: brushing a wildermon down puts **care** into
  it, and a cared-for beast works a quarter faster, learns a quarter faster and
  heals as you go over it. Care runs out over about three hours alone.
  **Breeding** takes a grown, fed male and female of one sort standing within
  four tiles, neither put to a mate in the last twenty minutes; the female
  carries twelve minutes and drops a young one at the token. What it is born
  with is settled at the covering. Each of the three slots is drawn from what
  the pair carry between them, and husbandry decides how often the parents'
  blood comes through at all (half at nothing, nearly all at a hundred with a
  well-brushed pair) and how often a trait comes through **one tier better than
  either parent had it** — which is how a line climbs. Blood does not read
  itself, either: **Look it over** names only the traits your husbandry is good
  enough to recognise, rare at 16, supreme at 36, old blood at 61. Only a
  female is in milk.
- **Wildermon age.** Everything alive was born at some hour and gets older
  from there. A **young** one is two thirds the size, a little slower, grows
  no fleece and gives no milk, and is no use in the traces or under a saddle —
  but it has not learned to mistrust you and is half again as easy to tame. It
  is **grown** after an hour of real time, and **old** after six: slower again
  and poorer at pulling, slower to grow a fleece back, but heavier, and an old
  carcass is worth a third more. Wild country carries a spread of ages rather
  than a field of yearlings, and age is drawn as size rather than written on
  the creature.
- **Eighteen more wildermon.** Most of them are kept for a job: the **Bogga**
  cuts peat and tar out of the marshes; the **Sedra**, a long-necked wader,
  shears reeds at the water's edge; the **Holla** carries water in its throat
  from the shore or a well and pours it into your barrels; the **Dowse**, which
  will not live where there is no metal under it, reads the ground and marks
  what is down there; the **Sappa** plants sprouts where the axe has been; the
  **Cobbe** carries the hod, taking brick, mortar and timber out of your stores
  and fitting it into whatever wall you have planned; the **Tinka** mends the
  damaged gear in your stores; the **Middun** eats what is rotting on the
  ground and turns it into compost; and the **Snout**, at taming 50, smells out
  buried relics and marks where to dig. Four are backs and traces: the **Bura**
  carries 200 things in panniers of its own, the **Gorral** is a cliff-goat
  that takes a saddle up ground an Orse turns away from, the **Wadd** is the
  one mount that will swim deep water with a rider on it, and the **Shaggan**
  is slower in the traces than anything else and stronger than all of them.
  The rest are eyes and produce: the **Warda** sees eighteen tiles for you
  wherever it stands; the **Quill** is plucked rather than shorn, for feathers;
  the **Cudda** is milked into an empty bucket, and a bucket of milk presses
  into three cheeses; the **Vesp** is a swarm that fills a **hive** on your
  deed with honey and beeswax, and two wax and a length of yarn draw a pair of
  candles; and the **Lume**, found only after dark, carries its own daylight
  about with it.
- **Brewing.** Fill a barrel from a well or the shore and set a brew going:
  **ale** from 12 wheat in a quarter of an hour, **cider** from 20 apples in
  half an hour, **mead** from 12 honey in forty minutes, **wine** from 30
  cherries in three quarters. Each takes 15 litres of water and gives back 15
  of drink. A working barrel says so and cannot be drawn off, and nothing
  hurries it; the quality is half what went in and half your **brewing**, and
  a brew that will not take sours the barrel. What it is for is the knack —
  anything drunk favours a trade like a cooked dish, and a brew carries it far
  longer: a baked potato is nine minutes, a bucket of wine three quarters of
  an hour.
- **Fishing.** A **fishing rod** spliced from 2 shafts, a bowstring and a
  ribbon bent into a hook. Stand at water and fish: the line reaches about
  three tiles and goes into whatever water within a cast is deepest, so where
  you stand is the whole trade. Five fish run at five depths and each wants a
  hand to match — **minnow** anywhere, **perch** from three deep, **trout**
  from eight at fishing 15, **pike** from sixteen at 35, **sturgeon** from
  twenty-eight at 60 — so a shelving beach never gives more than perch however
  good you get, and a sheer bank gives everything. Each cooks over a fire into
  helpings that follow its size, a pike being four and a sturgeon ten. The
  **Wadd**, the one thing on the island that swims, now has fishing as its
  deed job.
- **Fruit trees and orchards.** Three of the nine trees bear — **apple**,
  **cherry** and **olive** — growing wild about one tree in a hundred in the
  warm low country, and told apart across a field by what is hanging in them.
  Take a sprout with forestry and plant an orchard of your own. A sapling
  bears nothing; a mature tree gives three or four to a picking and an old one
  five or six, rising with forestry, and a picked tree wants a few minutes
  before there is anything on it again. Four apples and a dough bake into two
  **apple pies**, a dozen cherries boil into **preserves**, and ten olives
  under a **quern** press into **olive oil**. All three are also woods, and
  good ones: apple wears like oak and takes a finer edge, cherry is the best
  handle wood on the island, and olive is murder to work and outlasts
  everything — at one log a tree, so an orchard felled is an orchard gone.
- **Farming.** Till grass or dirt into a field with a rake, sow seeds gathered
  while foraging and botanizing, and grow thirteen crops across vegetables,
  starches, spices and fibre. Each crop runs through four stages with its own
  timing and its own model per stage, and each stage can be tended once: an
  untended field gives 1 crop and 1 seed, a fully tended one gives 4 crops and
  2 seeds. Tilling and tending train Farming, which sets the quality of the
  harvest, and a harvested field stays tilled so it can be sown again.
- **Metal, from seam to tool.** Mining brings up ore. A stone smelter is
  crafted by a mason from 12 bricks and 6 mortar, carried, and set down over
  six subtiles of a deed tile — and taken up again whole when it is cold,
  empty and raked out. It burns fuel to turn ore into lumps, with each piece timed by its own quality and the smelter's.
  Lumps of a metal merge into larger lumps whose quality is the size-weighted
  average, and a hot smelter also mixes bronze, brass, pewter and electrum,
  taking their quality from the metal rather than the smith. Sand fired in the
  smelter makes moulds — an anvil, a pan, tool heads, a sword blade, a helm —
  which wear a little with every filling and can never be mended. An anvil
  mould cools in the smelter into an anvil of that metal, placed on four
  subtiles; every other mould is beaten out at an anvil using blacksmithing,
  weaponsmithing or armoursmithing. Heads and blades are finished with a
  shaft. A sword hits far harder than a working tool, and a helm blunts the
  swipe a cornered animal takes at you.
- **Campfires and cooking.** Lay a campfire from two shafts on a two by two
  block of subtiles, feed it shafts, thatch, planks, timbers or logs for burn
  time, and light it. A burning fire is the station every cooking recipe
  needs: cooked meat, baked potatoes, roast onions and nuts, and with a clay
  bowl, berry compote and stew. Fires burn down in real time and go cold when
  the fuel runs out; an unlit one gives its wood back.
- **Hunting and butchering.** Wild wildermon can be attacked, and an edged
  tool hits far harder than bare hands. Whatever kills one leaves a corpse
  where it fell. Butchering it yields meat, fur, raw hide, bone and the
  occasional gland, with the Butchering skill and a butchering knife deciding
  how much of the carcass survives the job. A hide is no use to anybody until
  it has been through lye.
- **Placeable crates on a subtile grid.** Tiles are divided into 4×4 spots;
  a log or plank crate (crafted from logs or planks with a mallet) takes one
  spot, snaps to the grid, holds 30 or 60 things, and can be emptied and
  picked up. The deed crate is one of them. The player and creatures are
  drawn to a one-spot footprint on 96 px tiles so the land reads as the
  4 m squares it represents.
- **Plain grass.** Grass is one tile that looks the same whatever it is
  holding. It carried tufts once — berries where it could be foraged, flowers
  where it could be botanized — and hundreds of them on a screen read as a
  carpet with the trees and rocks lost in it; a soft patch of colour in place
  of the tufts said the same thing more quietly and was still a tile telling
  you about its contents. What a tile holds is a question you ask it: click it,
  or press T, and the Tile window says whether there is something to pick or
  something to gather.
- **Items.** Click an item for its actions: eat, drink, fill, drop one or all,
  chisel, examine. Dropped items lie on the tile as a pile and can be picked up
  from that tile's menu. Anything left on the ground decays over real time,
  including time spent away (capped at a week): food rots in about half an
  hour, stone lasts days, and quality slows it down. When damage hits 100 the
  item rots away.
- **Packing and paving.** A shovel treads grass, dirt, lawn, steppe, tundra
  and moss down into packed dirt, cutting the turf away on sod. Packed dirt is
  what a building needs under it and the only ground paving will go on: both
  cobblestone and slabs want a hard flat bed. Breaking paving up leaves
  bare dirt, so laying it again means packing it again.
- **Character.** Health, stamina, food and water; swimming drains stamina and
  drowning sends you back to the shore. Actions take time based on skill and
  tool quality, can fail, and raise skills on a curve that bites: what a gain
  is worth is the room left in the skill raised to 1.8, so an ordinary action
  gives 0.44 at level 1, 0.13 at 50, 0.007 at 90 and 0.0001 at 99 — two goes
  for the first point of a skill, 140 for the ninetieth and about ten thousand
  for the hundredth. A floor under the gain keeps the last point a long grind
  rather than an unreachable one.
- **UI.** Draggable, resizable windows that remember their layout and expand to
  nearly the whole screen with one tap (handy on phones), a status HUD,
  action timer, right-click menus with greyed-out reasons, hover tooltips, an
  event log with chat and a live minimap.
- **Dragging between windows.** Anything in the inventory or an open container
  can be dragged from one window to the other, under the same rules the menus
  use: you must be within reach of the container, and it must accept what you
  are giving it — a raw material bin refuses anything worked, a barrel refuses solids, a full
  crate is full — and it says which when it will not go.
- **Fog of war, in three states.** Land nobody has looked at is not drawn at
  all and cannot be clicked; land somebody is looking at is drawn in full;
  land that has been walked but is not being watched is drawn cold and
  without detail, showing what was last seen rather than what is there — fell
  a wood, walk away, and the map keeps the trees until you return. Sight is a
  viewshed: fifteen tiles on the flat, further from a hill, better than half
  of it gone at night, a ridge hiding the hollow behind it and a wood about
  three trees deep. Lit fires, your own wildermon and your settlement all see
  for themselves. The minimap shows the same three states, it all survives a
  save, and a setting turns it off. The map draws a window on what you know
  rather than the whole island — a thousand tiles a side drawn whole is a dark
  square with a speck of coast in it — widening by doublings as you explore and
  never narrowing, out to the whole island once you have been round it.
- **Streamed wildlife.** An island holds a fixed head of wildlife — one for
  every thousand tiles, so a 1024-tile island carries 1,024 — but only
  the stretch of country being walked holds it in the flesh. A wild creature
  left more than 85 tiles behind and unwatched is put back on the books for
  its region; walk within 60 tiles of a region again and what it owes is let
  out, never closer than 30 tiles so nothing is seen to appear. The bank is a
  number per region, not a list of creatures, so memory follows the explored
  area rather than the map: the island's total is conserved across any amount
  of walking, and a map ten times the size costs the same to play.
- **Placed things filed by tile.** Crates, campfires, smelters, kilns,
  furniture and anvils each sit in a tile index. The renderer asks "what is on
  this tile?" for every tile it draws, and that used to copy the whole
  collection each time — at 800 placed things one screen's worth of those
  questions cost 7.5 ms per frame, for one collection of six. Through the
  index the same screen costs 0.1 ms. Every "nearest thing within reach"
  search — a lit fire, a hot oven, a store to put something in, a barrel to
  pour into — now looks at the handful of tiles it could be on.
- **Simulation follows what is watched.** The fog is also the engine's answer
  to "who is being looked at", which is what lets the creature count grow.
  Anything in sight or close by is simulated every frame; anything out of
  sight but nearby thinks four times a second; anything far away and unwatched
  keeps its body going — wounds close, fleece grows — and thinks once every
  couple of seconds, banking the time so nothing is lost. Your own creatures
  are never left to themselves. Measured with 3,000 creatures on the island,
  a frame of creature work drops from 1.17 ms to 0.50 ms with 225 of the 3,000
  thinking; the HUD shows the count as "thought/alive".
- **An island of a million tiles.** The world is 1024 tiles a side, sixteen
  times the ground it used to be, and the things that were made to follow the
  player rather than the map are what pay for it. Measured in a 1400×860
  window: 64 fps standing and 51 fps walking (the same island at 256 draws no
  faster, because the renderer only ever touches what is on screen), a look
  around costing 0.7 ms, a frame of creature work 0.006 ms with 3,000 of them
  on the island, and 30 MB of heap. Raising a new island takes about a second
  and a half, so the page says what it is doing while it does it.
- **Saving what changed.** The land of a big island is ten megabytes of typed
  array, which is more than local storage will take as text — the save simply
  failed on every big world — so it goes into IndexedDB as arrays. It is kept
  in three parts that change at three different rates: the ground, which only
  moves when something is dug or built; what is known of the island, which
  moves as you explore; and everything else, which is small and always
  changing. A save while standing still costs 0.4 ms of the frame it happens
  on, one while walking 8 ms, and one after digging 27 ms. Because a write to
  IndexedDB is asked for rather than done, and a closing page is torn down
  before the browser gets to it, leaving the page also writes the small part
  to local storage there and then, and it is laid over the last full save when
  the world is read back: shutting the tab costs no more than the last twenty
  seconds of digging. Saves made the old way are still read, and move
  themselves into the new store the first time they are put away.
- **The tile window.** Clicking a tile chooses it: it is outlined in the
  world and the Tile window (T) fills with everything that could be done to
  it — the same entries the right-click menu shows, built from the same list,
  so the two cannot drift apart. It follows whatever was clicked, tile or
  chest or smelter or wildermon, greys out what is not possible with the
  reason beside it, and lets the whole game be played with one button. A
  setting turns off the opening-on-click for anyone who prefers right-click.
- **Search in the inventory and the recipe book.** Both windows have a search
  box at the top. The inventory matches on name and kind; the recipe book
  matches on everything in a row at once — the thing made, the trade, the
  station and every material — so "leather" finds every leather craft, "mason"
  finds the oven and the well, and "nail" finds every recipe that wants nails.
  The footer counts the matches, and Esc in the box clears it.
- **An event log you can look through.** The log is cut into tabs — All, Work,
  Skills, Talk and Trouble — with a count on any tab that has lines waiting and
  a box that searches whichever tab is open. The help is cut the same way: a
  list of contents across the top jumps to any of its fifty-eight sections, and
  the search keeps whole sections rather than single lines, because half an
  explanation is worse than none.
- **What a tool is really worth.** Damage drags a tool down, its metal lifts or
  lowers it, rarity and a blessing lift it further, and it is that figure —
  not the number it was stamped with — that decides how fast a job goes and how
  well it comes out. The pack shows both when they differ (`60.0→45`) and
  examining a thing says it in words.
- **The settlement at a glance.** One window (`N`) for the deed: its level and
  border, workers of the cap, what the next upgrade still wants with the button
  that buys it, a count of everything standing inside the border, the standing
  orders, and a walk-to button beside every building, store, trap, post and
  bridge on the land.
- **Number keys on the selection.** With something selected in the Tile
  window, `1`–`9` and `0` do the first ten things that can actually be done to
  it, in the order shown, with the key drawn on each row. Submenus and
  greyed-out rows take no key, so a number never does nothing; with nothing
  selected the same keys press the toolbelt loops instead, and the belt bar
  dims while the window has them.
- **Tooltips that answer the question.** Pointing at a creature gives a wild
  one's real taming odds — the same number the attempt rolls against, with
  hunger, soul, age, path and any run of offerings counted — and for your own,
  name, sex, kind, age, level, health and fullness with bars, care, what it is
  doing and how good it is at it, a worker's reach, its traits (marked only
  when better than common, and unread until your husbandry can read them) and
  how long a carried young has left.
- **Marks on the map.** Right-click the map, or use the tile's own menu, to
  pin a name to a spot in one of six colours. Pins are drawn with their names
  beside them and listed under the map nearest first, each with a button that
  walks you there; `Home` walks you back to the settlement token. The camera
  keeps to you unless dragged off, and the cursor at the edge of the screen
  slides the view — both switchable in Settings.
- **The herd in order.** The wildermon window searches on name, kind, job,
  age, orders or trait and orders by name, level, kind, health, hunger, care,
  age or best trait, with a footer that counts the herd and says how many are
  hungry or hurt.
- **The toolbelt, and doing a thing many times.** Every job that runs on and
  on is offered by the handful as well as one at a time — once, five, ten,
  twenty-five, fifty, or until you stop — and a counted job counts itself
  down, says "7 of 25" on the action bar and puts the work away at the end,
  so a hundred bricks is one right-click rather than a hundred. A stitched
  **toolbelt**, worn, carries the jobs you do most: one loop for every ten
  points of how well it was made, ten loops on a perfect one, each answering
  to a number key. A job hung from your pack remembers the kind of thing
  rather than the one in your hand, so the loop still works on the next loaf
  you bake; a job hung from the ground is done wherever the cursor is, and on
  the tile under your own feet when it is on nothing. The bar greys a loop out
  and says why when what hangs on it cannot be done just now.

## How it is put together

```
index.html, account.html, assets/
                     generated site (do not edit; see Deploying)
src/
  index.html         the real HTML entry
  main.ts            wires input, game, renderer and UI into the frame loop
  account.html       the landing page: a username, a password and a face
  account.ts         its behaviour; account.css its own small stylesheet
  net/accounts.ts    name rules, the breach check, signing up and back in
  game/look.ts       skin, hair, eyes, build and cloth — the only place they live
  world/atlas-world.ts  the archipelago, any window of it, from the survey chart
tools/
  found-island.ts    works the big island out and hands it over, once
  measure-map-cost.ts  what a world of a given size costs to store and to send
  engine/            canvas sizing, input, loop, camera (no game knowledge)
  render/iso.ts      projection constants and world <-> iso math
  render/renderer.ts terrain quads, water, entities, picking, overlays
  render/sprites.ts  procedurally drawn trees, bushes and the player
  world/             tiles, height-mapped World, noise, generator, A*
  game/              Game state machine, actions, items, skills, player, save
  ui/                windows, HUD, context menu, tooltip and the panels
```

**Projection.** A 2:1 diamond: tile width 96, height 48 at zoom 1. A world point
`(x, y, h)` is first rotated into view space `(u, v)` by the camera's quarter
turn, then lands at iso `((u - v) * 48, (u + v) * 24 - h * 2.25)`. The camera
stores an iso-space centre, a zoom and the rotation. Because height only moves
points vertically, screen x pins down `u - v` exactly, which keeps picking
cheap: for a click we walk the possible depths `u + v` front to back, map each
view tile back to its world tile and test the projected quad.

**Draw order.** Tiles are drawn one view-space diagonal (`u + v`) at a time
from back to front, so turning the camera is just a different mapping from view
tiles to world tiles. Trees and the player standing on a diagonal are drawn right after its
tiles, so terrain in front occludes them correctly and nothing needs a z-buffer.
Tile colours (base colour, slope lighting, per-tile variation, depth tint) are
cached per tile and invalidated when a corner changes.

**Water.** Any tile with a corner below zero draws its terrain first, then a
water polygon at height zero clipped to the submerged part of the tile
(marching-squares style), coloured by how deep it is: **light teal at the
water's edge through to a dark blue at the bottom**, over forty steps covering
the whole hundred and twenty height units the island goes down. The alpha
climbs with the colour, so the sand shows through the shallows and not through
the deep, which is most of what makes a shelf read as a shelf. The map is
painted from the same ramp — it used to have one of its own, over a different
pair of colours and a different depth, so a shelf that read as pale green out
of the window read as navy on the map.

**Actions.** `game/actions.ts` is a data table. Each action says which targets it
applies to, why it may currently be unavailable (shown greyed in the menu),
how long it takes, and what it does on completion. The game walks you into range
first, then runs the timer; moving interrupts it.

## Roadmap

- Chunked offscreen terrain caching for very zoomed-out views.
- More wildermon species, breeding, and creature combat against the player.
- Containers and item repair.
- Smithing: metal tools and weapons from lumps.
- Caves and mine entrances.
- Day/night cycle and weather.
- Creatures and combat.
- Multi-tile gates wide enough to take a wagon through.
- Multiplayer server and persistence beyond the browser.

Wurm Online is a trademark of Code Club AB. This is a fan project and is not
affiliated with them.
