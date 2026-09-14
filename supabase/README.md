# The island in Postgres

Everything that decides anything lives here. The browser draws the island and
says what it would like to do; this says what actually happens.

## Why the rules are down here

A browser-hosted island has one tab that owns the truth, and that tab goes to
sleep the moment its owner looks at something else — `requestAnimationFrame`
stops dead for a hidden tab, so the world stops, every guest freezes, and
anybody mid-dig stays mid-dig. Moving the truth into Postgres removes the tab
from the arrangement entirely.

It also removes the reason to trust the client. A browser that rolls its own
successes never fails one.

## Nothing ticks

Supabase has no long-running process — an Edge Function answers a request and
stops — so there is nowhere to put a loop. That turns out to be a
simplification rather than a problem:

- **Time of day** is not stored and never advances. It is `now() - world.epoch`.
  Nothing has to keep it, and no two machines can disagree about it.
- **A job** is written down once with the moment it will be finished, and
  *settled* later: every entry point calls `settle()` first, so anything that
  reads a player reads them up to date. `rpc_sweep()` does the same for people
  who walked away mid-dig, and is the one thing that wants a schedule
  (`select cron.schedule('wurm-sweep', '10 seconds', 'select rpc_sweep()')`).

## How much of the game is here

| | |
|---|---|
| **204** | recipes — every one of them, through one performer |
| **14** | things set down on the ground: campfires, smelters, furniture |
| **13** | building: plans, walls, fences, storeys, floors, stairs, ladders and roofs |
| **11** | the wildermon: examining, taming, feeding, brushing, shearing, milking, stances, names, and letting one go |
| **8** | fighting: wearing and wielding, sword and bow, butchering, and the first aid that follows |
| **11** | firing: a kiln built, packed, lit and unpacked, and the smelter's own queue — ore in, lumps and anvils out |
| **5** | what a pair of hands does to what it holds: better it, mend it, eat it, drink it |
| **8** | and to what is lying about: pick one up, sweep the lot, put one down, look at a thing or a tile, set a thing aside and take it back, call something by a name |
| **4** | crates: made, set down on a subtile, filled, emptied and lifted again |
| **1** | setting a wildermon to work the deed, which is nineteen trades and a crate to fill |
| **8** | working the ground: dig, mine, chip, pack, cultivate, two pavings, dropping dirt back |
| **5** | farming: till, sow, tend, harvest, clear |
| **4** | taking what grows: felling, foraging, botanizing, filling a shovel off a bed |
| **2** | fishing: a rod off the bank, a net walked round |
| **1** | planting a deed stake and claiming the island around it |
| **74** | known, listed, and honestly refused |

An action the rules do not implement is not the same thing as an action that
does not exist, and the difference matters to whoever is looking at the menu:
"there is no such thing as cut_down" invites a bug report, "you cannot chop
down on this island yet" invites patience. So every action in the game is in
`action_def` — generated from the same TypeScript the browser reads — and
`act_ported()` says which have a performer behind them.

Of the 204 recipes, 147 need no station and were playable from the start; the
other 58 want a lit campfire (18), a hot smelter (34), a spindle (3) or a loom
(2), and all four of those can now be built, set down and lit.

Jobs queue behind one another as they do in the game — three deep, and one
deeper for every ten points of mind logic above where you began — rather than
being refused because your hands are full.

Not yet ported at all: stamina (deliberately — half of it, with the cost but
not the recovery, would make the island unplayable), the three deed trades
that want something this island has not got yet — `water` wants barrels that
hold liquid, `prospect` wants the marks a prospector writes on a map and
`seek` wants archaeology — sowing a field from a worker's own cheeks,
breeding and pairing, riding and the traces, trapping,
the ledger, the journal, flattening and levelling, paving with cut slabs,
prospecting, deed upgrades and disbanding, and the ease a hot oven
lends to cooking.

### The island could put things down and nobody could pick them up

A felling leaves two logs at the stump. A butcher leaves what it could not
carry. Anything that dies leaves a carcass, a crate taken up tips its contents
out where it stood, and a settlement that disbands tips out everything in it.
All of that had been landing on the ground for eight commits, and the only two
things on the island that could pick any of it up again were a hunter and a
middun. A player walked over it.

Nothing was wrong; the ground had simply never been given a door. What it
needed was the eight actions nobody thinks of as features until they are
missing — pick one up, sweep the lot, put one down, look at a thing, look at a
tile, set a thing aside, take it back, call something by a name.

### Locking is only a word until the things that spend things read it

`lock_item` writes `true` into a column. That is the easy half, and on its own
it is a lie: the island went on eating a hatchet somebody had set aside,
because `consume` and `pack_count` never looked. The browser states the rule in
a line worth keeping exactly — `find`, `consume` and `count` look past a locked
thing while `has`, `get` and `tool` do not — so you can still *work* with a
locked hatchet and nothing will quietly spend it.

`give` was left alone, and that is a decision rather than an oversight: the
browser merges a new stack into a matching one without looking at the lock, so
three planks made beside twenty set aside become twenty-three set aside. It is
a quirk. A port that quietly improves on the thing it is porting is a port you
can no longer check against it.

### What bags are still waiting for

`stow_item` and `empty_bag` are the two that did not come with the rest of the
pack, and the reason is worth writing down rather than discovering twice. A
thing in a bag is *not to hand*: the browser keeps a bag's contents out of the
inventory list entirely, so a recipe that wants two planks cannot see the two
in your satchel. Making that true down here means every question the island
asks of a pack has to learn to skip what is inside something — fifty-odd
places, of which `consume`, `pack_count` and `tool_ql` are only the three
obvious ones. Half of that is worse than none of it: a bag you can put things
into and then cannot craft with, with no message saying why.

### Time only passes for a hunter while you are there to be hunted

Everything else that settles lazily settles from a timestamp and needs nothing
else. A fire knows how long it has been burning; a crop knows when it was
sown; a creature's walk is a hash of its own leg number. A hunt needs a second
thing, and that thing is *you* — and the island has no record of where you
were between two looks, only where you are at the moment of each.

So a hunter cannot have been closing on a path nobody wrote down. Shut the tab
with a wolf on you and an hour later there is still a wolf on you, not a
corpse: `hunt_window` is ten seconds, seven blows, and the rest of that hour
it spent alone doing what it does when nobody is about.

What the elapsed seconds buy instead is a leg, aimed. The wild walk is legs to
nowhere in particular; a hunt is the same walk with the destination decided
rather than hashed, from where it stands to a pace short of your feet, taking
as long as the distance and its speed say. That falls out of the model rather
than fighting it, and it means somebody watching sees the thing coming at them
instead of arriving.

The one place this needed something the model did not already have is going
round a corner. The browser walks a creature a frame at a time and asks three
questions at every step — the way it wants to go, then the x of it alone, then
the y — which is what lets a thing follow you round the side of a house rather
than standing at the wall. A leg out here is a great many of those steps at
once, so `chase_leg` asks the same three questions of the whole leg. Without
it a hunter found the first thing it could not walk through and gave up, and
the suite said so: a rowl set to hunt landed fifty-five blows and killed
nothing, because the nearest rabba was across a pond and it spent a quarter of
an hour turning round.

### A fight is a round trip whose work is somebody else

A gatherer walks out to a tile, works it, and carries a load home. A guard
walks out to a *creature*, works it — one blow is one turn of the phase
machine — and walks out to it again wherever it has got to in the meantime. A
hunter does the same and then does what a gatherer does: the carcass is the
load, and it goes in the crate like sand or stone.

So neither of them needed a loop of their own. What they needed was a `work_x`
that moves, and one more thing every other worker got for free with it: a
stance that means something. Passive carries on working whatever happens;
defensive wants to have been given a reason, and a reason is a blow at it or
at somebody on the island in the last eight seconds; aggressive needs no
reason at all. Three sorts of creature, one question, one function —
`fight_target` — which is why a holla with a shovel and an ulva on the border
break off on exactly the same terms.

### The rulebook was never readable

`grant select` on the definition tables was a list of five names, written when
there were five of them. Every table generated since — recipes, fish, crops,
species, traits, weapons, armour, wall types, metals, moulds, pottery, crates,
what a carcass gives, what a dish feeds — arrived with row level security on,
no read policy and no grant. A client could not read one row of any of it.

Nothing said so, because nothing had asked: the browser still reads its own
copy of the numbers out of TypeScript, and almost every question in the local
suite is asked as the owner. It took a live run through PostgREST, as a real
signed-in client, to get a straight no — which is the entire reason that run
exists.

The fix is a rule rather than another list, because a list would go stale again
on the next `npm run defs`. There is a real invariant to lean on: **everything
belonging to a player or an island carries a `world_id`, and the rulebook does
not.** `private.lock_doors()` sets the doors by that now, every time it is
called — which every migration already does on its last line — so a definition
table generated tomorrow is readable the moment it exists. The suite asks the
same question as a client: 48 tables in the rulebook, 48 readable, none
writable.

### An errand runs the round trip backwards

A gatherer walks out to a tile, works it, and carries a load home. An errand
runner as often as not goes the other way: it takes a piece *out* of the
stores and carries it to wherever it is wanted — a log to a furnace burning
low, a plank to a wall you planned and walked away from, a sprout to where a
tree used to be. So the round trip grew one more part, `fetch`, and for those
the delivery *is* the work rather than the thing that follows it.

Five of the seven arrived: hod, mend, stoke, plant and compost. Stoking is the
one that pays for the rest — a deed with an embra on it has no cold furnace on
it when you come back, which is the whole point of a queue that burns while
nobody is watching.

One thing the suite caught by printing sentences rather than booleans. The
stoker's fuel was ordered by what burns longest, which is cleverer than the
game: a stoker takes the *first* thing in the crate that will catch. With
planks at the front of the crate it fed planks to the furnace thirteen times
where the browser would have done the same thing — and reading "13 loads
carried, 19 logs left of twenty" is what made it obvious that the number was
describing something other than what the label claimed.

### A queue is a fuel budget spent in order

A fire already settles on the wall clock: what was in it when `since` was
stamped, less the seconds gone by. A queue of work is the same arithmetic read
differently. The furnace has a budget — however many seconds of burning it has
done since anybody looked — and it spends that budget down the list in order:
the first job takes what it still needed, the second takes what it needs, and
so on until either the list or the budget runs out.

The browser spends that budget a frame at a time. Here it is one pass down a
jsonb array, and the pieces come out at the moment they would have. Two
hundred seconds against an hour of fuel fires all eight bricks; six bowls at
thirty-two seconds each against a hundred seconds of fuel gives three, leaves
three, and the kiln goes cold — which is the half of it worth checking, because
it is the half where the budget and the list disagree.

### A file holds what it is for, and nothing it inherited

Each dispatcher migration was written by copying the last one and editing the
middle. That quietly carried the *other* definitions in it forward too: a
`fire_action` taught about kilns an hour earlier was silently replaced by the
older copy riding along inside the new dispatcher, and `place_kiln` routed
nowhere at all — the refusal said yes and the doing did nothing, which is the
worst shape a bug can take.

A dispatcher holds the dispatch. Everything it calls is defined where it
belongs and left there.

### A prefix is a guess about names nobody has thought of yet

The dispatcher used to route the placeables by two `like` tests: anything
beginning `build_` or `place_`. That was unambiguous the day it was written,
and it has been wrong twice since. `build_wall` was very nearly handed to the
code that lights campfires; `place_crate` would have been the second, and
neither would have said a word about it — the wall would simply have been lit.

Both are named lists now, and the last `like` in the dispatcher went with
them. A prefix is a bet that no other family will ever want the same verb, and
on an island with three hundred and seventy-three actions that bet keeps
losing.

### A worker is a round trip

A wild creature wanders: legs with no purpose, and the last one is as good an
answer as any to where it is. A worker is *doing* something, and a round trip
has parts — out to a tile, work it, back to the crate, put the load down —
each of which begins and ends at a moment. So a worker is stored as which part
of the trip it is in and when that part is over, and settling it walks it
through as many whole trips as have come due.

Which means the result of an hour of a worker's labour is a loop over the
clock rather than an hour of simulation: the logs are in the crate because the
arithmetic says they would be, and nothing had to be running to put them
there. Thirty round trips is as far back as anybody walks; past that the clock
catches up, the same rule a wild one's legs follow.

Every rule underneath a worker is the one a player gets — a forage bed's
cooldown, a seam's metal and its level, a field that has come ripe, a tree
that leaves the rest of itself at the stump because a beast can carry one log.
A worker is not a second set of rules, it is the same ones with nobody
watching.

The search for the next tile is worth a word. Written as a scan of the whole
square within range, it was correct and cost the same whether the answer was
under the worker's nose or nowhere at all: two workers half an hour behind
took four seconds to catch up, nearly all of it looking at ground they had no
need to look at. Ring by ring outwards from the token, stopping at the first
ring with anything in it — and stopping the catch-up entirely when a search
comes up empty, because replaying half an hour of finding nothing produces
exactly nothing — took the same sweep to 274ms.

### A wound is the second thing that will not sit still

A creature moves, so it is stored as a walk. A wound *drains*, which is the
same problem wearing different clothes: health is not a number that sits where
you left it, it is a number that has been going down the whole time nobody was
looking.

So wounds settle from a timestamp exactly as the legs of a walk do. Blood out
of anything still bleeding, a little closing on anything dressed, and — the
part worth spelling out — the chance a wound goes bad. The browser rolls that
once a second. There is no second here, so the odds over the whole stretch are
`1 - (1 - p)^seconds` and the roll happens once: a cut left alone for ten
minutes has had ten minutes to turn, whether or not anybody was there to watch
it. `settle()` calls it, and every way into this island already calls
`settle()`, so touching a player is enough.

### Every local gets a prefix, not just the ones that have bitten

`land_tile.y`, `crop.y`, `trait_def.tier`, `species_butcher.n`, and then
`crate_def.kind`: five times a plpgsql variable has had the same name as a
column in a query beside it, and Postgres has either refused the whole
function or — worse, the first two times — quietly meant the column.

The convention was written down after the fourth. It did not hold, because it
was applied where the last bite had been rather than everywhere, which is not
a convention, it is a scar. Locals in these functions carry `v_` now whether
or not anything has gone wrong near them, and a column inside a query is
written with its table in front of it.

### Material had never had any effect

`material_def` was filled by `Object.entries(MATERIALS)`, and `MATERIALS` is a
list — so every material went into the database keyed `'0'`, `'1'`, `'2'`.
Every lookup against an item's `Oak` or `Steel` missed, fell through a
`coalesce(..., 1)`, and behaved as though the thing were made of nothing in
particular. Silent for the whole port: a seryll hatchet wore out exactly as
fast as a pine one, and nothing anywhere said so, because "no effect" is a
perfectly plausible number.

It surfaced only because fighting needs `edge`, `soak` and `bane`, and a
weapon with no material behind it is obviously wrong in a way a tool with no
material behind it is not. Keys are the material's own id now, the lookup goes
through `mat_of()` — which lower-cases, because the label on an item says
`Oak` and the table says `oak` — and a steel sword hits half again as hard as
a copper one, which is what the book always said it did.

### A creature is a walk, not a place

Everything else on the island settles from a timestamp — a fire burns down, a
crop comes on, a forage bed recovers — and none of them move. A creature does,
and a column called `x` would be a lie the moment the last person looked away:
it would say where the thing *was*.

So a creature is stored as the leg it is on: from a point, to a point,
starting at a moment and ending at one, and then standing still until the next
leg begins. Where it is now is the interpolation, which anybody can work out
without writing anything; when the leg is over, whoever touches it next walks
it forward. The next leg is a hash of the creature and the leg number rather
than a roll, so walking the same row forward twice lands it in the same place,
and a leg begins when the last one's rest ended rather than now — the same
no-drift rule the crops follow. Forty legs is as far back as anybody walks;
past that the creature is where it got to and the clock catches up with it,
which is all anybody arriving could tell anyway.

The browser keeps only the wildlife near the player and banks the rest as a
number per stretch of country, because a frame has to touch everything that
exists. Nothing here touches a creature unless somebody asks about it, so the
whole island's wildlife is simply rows — and an island nobody has ever walked
still has wildlife on it that has been getting on with its life the whole
time. `rpc_creatures()` is the one call that makes any of it move: it walks
everything near the caller forward and then says what is there.

### Nothing a player owns may point at generated data

`crop.id` had a foreign key into `crop_def`, which reads like good hygiene and
is a trap: the definition tables are reloaded wholesale by `npm run defs`, and
a table cannot be truncated while anything references it. Regenerating after
adding a crop would have meant failing outright, or truncating the players'
fields along with the rulebook. The generated file drops such keys itself,
before the truncate, because a separate migration sorts wherever its timestamp
puts it and this has to happen first every time.

### Crops grow while nobody is watching

The clearest case yet for doing nothing. A crop moves on a stage every so many
seconds and there is no process here to move it — so it does not move at all
until somebody looks, and then it moves by however many stages it should have.
A field sown and left overnight is ripe in the morning because the arithmetic
says so, not because anything sat up with it.

One subtlety earns its keep: a stage that comes due adds *its own length* to
the clock rather than restarting from now. Otherwise every glance at a field
would nudge the next stage further off, and a watched crop really would grow
more slowly.

### Tile numbers are looked up, not typed

A tile is written down as a number, so the list may only be appended to — but
the numbers are a poor thing to hand-write. `Tree` was typed as 3 in the first
draft of the felling code, which is Sand, so cutting down a tree became cutting
down a beach. `tile_id('Tree')` cannot be got wrong.

### The ore hash is the ore hash

What is under a tile, and the best quality it will give up, were decided when
the island was rolled in the browser — by a hash of the tile and the seed. The
port reproduces it exactly rather than approximately, because anything else
would be an island handing out different metal from the one it was made with.
JavaScript does it in unsigned 32-bit arithmetic with `>>> 0` and `Math.imul`,
neither of which Postgres has, so every step is taken in `bigint` and folded
back with `% 4294967296`. Checked against the TypeScript to twelve decimal
places, including the far corner of a thousand-tile island.

### Fires burn on the wall clock

Like everything else here, nothing ticks them. `fuel` is what was in a fire at
the moment `since` was stamped, and a lit one has burned the seconds off that
and made ash the whole while. Both are worked out on reading and written back
whenever anything touches it. A fire lit and walked away from for three hours
is out when you come back, and was out for most of them.

## The front doors

PostgREST publishes every function in the schema, so `0007_rls.sql` takes
execute away from everybody and hands it back to four:

| | |
|---|---|
| `rpc_join(world, name)` | come ashore, or come back to the body you left |
| `rpc_move(world, x, y, level)` | say where you have walked to, believed only as far as the clock allows |
| `rpc_act(world, action, target, times)` | ask to do something |
| `rpc_sweep()` | finish what people walked away from |
| `rpc_found` / `rpc_put_land` / `rpc_ready` | lay an island down, once |
| `rpc_land` | read it back |
| `rpc_abandon` | give one up |

Every table has row level security on and **not one write policy**. A client
holding the publishable key can read the island, its own pack and its own
skills, and can write nothing at all.

## The numbers are generated, the algorithms are ported

`0003_defs.sql` is generated from the TypeScript by `npm run defs` — item
weights, tile yields, skill starts, material multipliers. It is never edited by
hand. Only the *algorithms* (the skill curve, the success roll, what a tool is
worth) exist twice, in `0004_rules.sql` and in `src/game/`, and the suite checks
they agree.

## Checked in CI

`.github/workflows/island.yml`, three jobs:

- **rules** — needs no credentials and runs on every push. A Postgres of its
  own, built from these migrations, with the whole suite over it, plus a check
  that the generated definitions still match the TypeScript. This is the one
  that catches things.
- **migrate** — `supabase db push` against the real project. Manual only
  (*Run workflow* → tick **live**).
- **smoke** — founds a real island on the real project, plays on it, checks
  what came back against what went out, and gives it up again.

The last two need two secrets in a repository environment called `AI`:

| | |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | a personal access token, from Account → Access Tokens |
| `SUPABASE_DB_PASSWORD` | the database password, from Project Settings → Database |

Optionally a repository variable `SUPABASE_PROJECT_REF` if the project ever
changes. The publishable key is not a secret and is committed in
`src/net/supabase.ts`.

There are things no local database can tell you, which is the whole reason the
last two exist: whether anonymous sign-in is switched on, whether Realtime is
publishing, whether the policies behave the same behind PostgREST as behind
psql, and whether eight megabytes of island survives the trip.

## Migrations are append-only, without exception

A migration the project has run is a fact about its history. Delete or rename
one and `supabase db push` stops dead — *"Remote migration versions not found
in local migrations directory"* — and the only way out is `migration repair`.

So: to change a function, write a **new** migration that replaces it. Never
edit or rename the one that first created it, however tempting it is to keep
the file tidy while the feature is still being built. CI checks this on every
push.

## A convention worth keeping

Any migration that adds a function must end with:

```sql
select private.lock_doors();
```

PostgREST publishes every function in `public`, and the sweep that takes
execute away from everybody can only reach the functions that exist when it
runs. It lived at the bottom of one migration once, which meant every function
added afterwards was quietly a public endpoint.

## Applying it

The migrations are plain SQL, in order, named the way the CLI expects. Either
paste them into the SQL editor in the dashboard, or:

```
supabase link --project-ref <ref>
supabase db push
```

or let CI do it, which is the same thing with the credentials somewhere safer.

**Switch anonymous sign-ins on** (Authentication → Sign In / Providers) — every
door checks `auth.uid()`, and without it nobody can get through any of them.

**Schedule the sweep**, which is the one thing that wants a timer:

```sql
select cron.schedule('wurm-sweep', '10 seconds', 'select rpc_sweep()');
```

`local/00_shim.sql` is **not** part of that. It is the handful of things a real
project already has — the `auth` schema, `auth.uid()`, the three roles — so the
same migrations can be run against a bare Postgres for testing. Applying it to
the project would do nothing good.

## Playing on one

The address bar decides:

| | |
|---|---|
| *(nothing)* | the single-player game, kept in this browser, exactly as before |
| `?found=<name>` | roll an island here, hand it over, be its first inhabitant |
| `?island=<id>` | come ashore on one that exists |
| `?me=<name>` | what to be called |

Generating an island stays in the browser — it is a large deterministic
function of a seed that already exists and is tested, and a second
implementation in SQL would be two islands that have to agree forever. So it is
rolled here, handed over once, and after that it is not ours: `rpc_put_land`
refuses the moment the island opens.

A page that cannot reach the keeper says so and plays on its own. An island is
an addition, not a replacement.

## Testing

`npm run db:test` drops the schema, rebuilds it from the migrations and runs
`test/island.sql` over it. From scratch every time, deliberately: what is being
tested is as much the migrations as the rules, and a migration that only works
against a database that already had the last version of it will not run on the
project.

`test/landtrip.ts` is the other half, and the one that could not be checked by
reading: a real generated island goes out through `src/net/landpack.ts`, into a
real Postgres, back out through the reader a joining client uses, and is
compared corner by corner against the one that left. The TypeScript packs
little-endian pairs by taking a view of an `Int16Array`; `b_i16` in the
migrations takes the two bytes apart by hand. Both look right. Only running an
island through both finds out.
