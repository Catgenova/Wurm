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
| **205** | recipes — every one of them, through one performer |
| **14** | things set down on the ground: campfires, smelters, furniture |
| **13** | building: plans, walls, fences, storeys, floors, stairs, ladders and roofs |
| **11** | the wildermon: examining, taming, feeding, brushing, shearing, milking, stances, names, and letting one go |
| **8** | fighting: wearing and wielding, sword and bow, butchering, and the first aid that follows |
| **11** | firing: a kiln built, packed, lit and unpacked, and the smelter's own queue — ore in, lumps and anvils out |
| **5** | what a pair of hands does to what it holds: better it, mend it, eat it, drink it |
| **8** | and to what is lying about: pick one up, sweep the lot, put one down, look at a thing or a tile, set a thing aside and take it back, call something by a name |
| **4** | crates: made, set down on a subtile, filled, emptied and lifted again |
| **1** | setting a wildermon to work the deed or a post, which is every one of the twenty-two trades and a crate to fill |
| **8** | working the ground: dig, mine, chip, pack, cultivate, two pavings, dropping dirt back |
| **11** | and shaping it: flatten a tile, drop dirt on a named corner, lay and lift cut slabs, cut grass and reeds, pick fruit and sprouts, plant a tree, turn the ground over for worms, read it for metal |
| **6** | liquids: fill a bucket at a shore, a well or a barrel, tip it out, pour it in, drink from it, fill a skin |
| **10** | the forge: an oven fed, lit, raked and emptied of ashes; a lantern candled, struck and pinched out; an anvil set down, beaten on and heaved up again |
| **5** | things that hold things: a bag stowed and turned out, a chest or bin filled and emptied, a trash crate |
| **7** | the settlement: upgraded, renamed, disbanded — and work posts driven in, pulled up, set to and called off |
| **3** | what the old people left in the ground: investigated, put back together, and a book worked through |
| **6** | traps: a snare set, baited, emptied and lifted; a creel sunk and turned out; and whatever is in one let go |
| **11** | a saddle and a set of traces: tack fitted and stripped, a rider up and down, a beast into the yokes and out, the shafts of a cart taken up and let go, a seat boarded and left, and the whole team unhitched at once |
| **5** | an altar and the three paths: a prayer knelt, six things favour buys, a sitting, a path chosen once, and six abilities called on |
| **3** | bridges: thrown across, decked a plank at a time, and pulled down for half of what went into them |
| **2** | a bed: a night slept through, and a place to wake |
| **2** | a herd: two of them put together, and the blood read off one of them |
| **2** | colour: a pot worked through something, and boiled back out of it |
| **1** | a barrel of water left alone until it is ale |
| **5** | farming: till, sow, tend, harvest, clear |
| **4** | taking what grows: felling, foraging, botanizing, filling a shovel off a bed |
| **2** | fishing: a rod off the bank, a net walked round |
| **1** | planting a deed stake and claiming the island around it |
| **0** | left. Every action in the game has a performer behind it |

An action the rules do not implement is not the same thing as an action that
does not exist, and the difference matters to whoever is looking at the menu:
"there is no such thing as cut_down" invites a bug report, "you cannot chop
down on this island yet" invites patience. So every action in the game is in
`action_def` — generated from the same TypeScript the browser reads — and
`act_ported()` says which have a performer behind them.

It now says all of them. `rpc_unported()` returns no rows, and the refusal it
existed to explain is unreachable — kept anyway, because the honest answer to
"why not?" is worth more than the two lines it costs, and because the next
thing added to the browser will need it again.

Of the 204 recipes, 147 need no station and were playable from the start; the
other 58 want a lit campfire (18), a hot smelter (34), a spindle (3) or a loom
(2), and all four of those can now be built, set down and lit.

Jobs queue behind one another as they do in the game — three deep, and one
deeper for every ten points of mind logic above where you began — rather than
being refused because your hands are full.

Not yet ported at all, and now a short list: stamina (deliberately — half of
it, with the cost but not the recovery, would make the island unplayable),
sowing a field from a worker's own cheeks, the ledger, the journal, and the
ease a hot oven lends to cooking. None of those is an action; they are things
that happen around the actions, and every one of them is a decision rather
than an omission.

### The browser changed because of the port, once

Porting `light_lantern` turned up that it wanted a **tinderbox**, that there
was no tinderbox anywhere in the game — not in `ITEM_DEFS`, not in any recipe,
nowhere but that one check and a line of help promising it — and therefore that
a lantern could not be lit by anybody, ever. A whole subsystem with no way in.

That was ported faithfully and named out loud, which is the right thing to do
with a bug you find in the thing you are copying. It was the wrong place to
leave it. Both sides light it at a fire now: a campfire, a kiln, a smelter or
an oven within reach, or off something already alight in your own hand. It is a
better rule than the tinderbox would have been — it gives the campfire a second
job, and it means the first thing you do on a dark island is get something
burning.

A **torch** came with it, on both sides: a shaft with oiled cloth round the
head, three to five tiles of light and minutes rather than most of an hour, and
gone when it is done. What it has over a lantern is that anybody can wind one
in the first hour of an island, which is when the dark is worst. One recipe,
two columns already there, and no new actions at all — a torch is a thing the
lantern's three actions already knew how to handle once they stopped asking
whether it was specifically a lantern.

That is one recipe more than there were, so the island is **374 of 374**.

### You cannot make the island wait, so you make it have been longer

Every other thing in this port settles *forward*: something happened at a
moment, time has passed, work out how much of it. Sleeping asks for the
opposite. The browser adds ten hours to its clock and then walks every
subsystem forward by hand, because it owns a clock and has a loop to run.

There is no clock here to move. `now()` is Postgres's and will not be argued
with, and the hour of the island's day is `now() - world.epoch`. So sleeping
does not move the world forward: it moves the world's **memory back**. Every
timestamp this island settles from — when a fire was last looked at, when a
crop last came on, when a trap was last rolled, when somebody last prayed — is
pushed backwards by the length of the night, and the epoch with them. Nothing
is walked forward at all. The next person to look at any of it finds that the
night happened, because from where they are standing it did.

  - sown at bedtime, and nobody watched it: the wheat is at stage 3 of 3 at
    130 seconds a stage, a plank made at bedtime is 9 minutes old, and favour
    has come back to 2.0 — all out of one night that took no time at all.

Two things are deliberately *not* pushed back, and both would be bugs.
`creature.born` stays put, so a night ages a yearling rather than leaving it
exactly as young as it was. And `player.moved_at` stays put, because `rpc_move`
believes a claimed position in proportion to how long it has been since you
last said where you were — a night's memory shifted there is a night's worth of
travel allowed in one step. The ceiling clamps that gap at ten seconds, so it
was never actually reachable; relying on a clamp somewhere else to save a
mistake here is not a reason to make it.

One of the shifted timestamps currently buys nothing, and that is worth saying
before somebody reads the list and assumes otherwise. `item.made_at` moves back
with the rest, so a plank made at bedtime is honestly nine minutes old in the
morning — but the browser's ground decay, which is the only rule that would
*read* that age, is not ported. Nothing left outside on this island rots yet.
The shift is there so that the day decay arrives it is already carried through
a night, rather than being a thing somebody has to remember.

One thing is a named departure rather than a port. The browser burns a night's
banked rest only while you are actually working — standing about does not spend
it. Nothing here knows whether you are working, and building something that did
would mean a loop, so rest runs out on the wall clock from the moment you wake.
A night is worth the same amount; it simply cannot be hoarded by idling.

And `set_home` records where you would wake and nothing reads it, which is not
the same kind of gap: there is no death on this island for a player, so there
is nothing to wake *from*. The column is the whole of the action.

### A brew is a well running the other way, and a bridge is a horizontal wall

Neither needed any machinery, which after eleven families is the more
interesting result.

A well fills at a rate to a ceiling. A barrel of ale counts a clock down to
nought and then stops being a thing that is working and starts being a thing
you can draw off — same settling, same single timestamp, opposite sign, and the
`since` it counts from is the one `placed` has carried since the first
campfire. One column.

A wall is a bill of materials that comes down one unit at a time as somebody
works at it. So is a tile of bridge deck. The only thing a bridge has that a
wall has not is that there are several of them in a row and they are built in
order, so `bridge_span` is the wall table with an index on it and `bridge` is
the pair of banks.

### A pregnancy is the first settling that makes a new row

Everything else that settles changes something already there: a fire has less
fuel, a well has more water, a trap has something in it. A dam in young settles
into a *creature that did not exist before*, and she does it whether or not her
keeper is standing there when the hour comes — so `herd_settle` runs at the top
of the dispatcher, where somebody is always about to do something.

What the young one carries is decided at the moment of pairing rather than at
the moment of birth: `unborn` is written then and read back at the hour. That
is the browser's arrangement and it is the right one. The blood is the blood of
the two of them as they were when they were put together, not as they are
twelve minutes later.

### Ninth and tenth, in one function

`born` is a column of `creature`. So is `traits`. Both were locals in
`give_birth`, inside an `update creature` — which makes them not locals at all.
`care` was the eighth, in `pair_them`, the same afternoon.

The rule has not changed since the first one: alias every table, prefix every
local. What this pass proved is that knowing the rule is not the same as
applying it, and the moment to apply it is while writing rather than while
reading a stack trace. Ten instances, and every one of them cost a run.

### Eighteen things the game can make and had no name for

Seventeen moulds and an altar. The browser never notices, because `itemDef()`
hands back `{ name: id, category: 'misc', weight: 1 }` for anything it has not
heard of — so a mould is called `arrow_head_mould` on screen and weighs a kilo,
which is wrong and harmless.

Down here it is neither. A missing row is a null, and a null in a concatenation
is a null all the way out: `item_name` of a mould was null, and the action that
tried to say its name died on a not-null constraint rather than saying
anything. That is exactly the bug the starting kit's `knife` caused, arriving
for the eighteenth time.

The fix is not another `coalesce` in another accessor. It is the row. The
browser's own fallback is now generated for every recipe result and every
recipe input that `ITEM_DEFS` has no entry for, so every lookup on this island
finds something the way every lookup in the browser does — and if a
nineteenth appears, it will be generated too rather than found by a crash.

### Favour is a well, and a rest is not a thing that ticks

Favour comes back on its own at four thousandths a second, up to what your
faith will carry, and stops there. A rate, a ceiling, and a note of when
anybody last looked: `favour_settle` does for a body exactly what `well_settle`
does for a hole in the ground. It is the tenth thing on this island that will
not sit still, and the easiest of them, because it only ever goes up.

The rest of the faith and the paths needed no machinery at all, which is worth
saying out loud after nine families that did. A prayer is worth nothing again
for most of an island day; a sitting the same; every ability has its own wait.
In the browser each of those is a number compared against a running clock,
because there is a loop to run it. Down here they are timestamps, and "may I do
this again" is `now() - prayed_at > prayer_rest()`. Nothing settles, nothing is
rolled forward, and the whole of the mechanism is a column.

### A path with no effect behind it is a path nobody walks

`walks(path, n)` answers whether somebody has the nth step of a path behind
them, and five of the passive effects are wired to it: what a wild thing will
trust, how fast a field comes on, what a harvest gives, how quickly work
teaches, and what a blow lands.

Three are not, and are named rather than quietly skipped — carrying weight
(`power 1`), the reach of sight (`knowledge 5`), and how much of a blow armour
turns (`power 5`). None of the three is computed anywhere on this island: not
half-computed, not approximated, absent. There is nothing to multiply.

The field is the odd one of the five. A crop grows for whoever founded the
ground it is in, not for whoever is looking at it, so `crop_settle` asks the
*deed's founder* whether they walk love — the one effect of a path that belongs
to somebody who is not here.

### A migration can be appended out of order

Append-only turned out to be two rules, and the repository only knew one of
them. Nothing is ever edited or renamed, which CI has guarded from the start.
But a migration can be *added* with a timestamp earlier than one the project
has already run, and the CLI refuses that too: "Found local migration files to
be inserted before the last migration on remote database."

It happened because the two stamps come from two clocks. The generated
definitions are named by the wall clock at the moment `npm run defs` runs; the
hand-written ones are named by hand. Write the migrations first and generate
the definitions after, and the generated one lands *behind* them.

There is now a guard for it in `rules`, which is a rename away from fixed when
it fires, where the same thing at the project is a failed deploy. The push
carries `--include-all`, which is safe precisely because that guard has already
refused anything the CLI would have to slot in early.

### Lifting a chest took what was in it

The browser refuses to pick a piece of furniture up for six reasons and this
island knew one of them. Three of the missing ones were the traces' fault —
until an hour ago nothing could be hitched to a cart — but two had been here
since furniture arrived, and they were worse than a missing refusal. `item.placed`
cascades, so lifting a chest with anything in it *deleted the contents*, and
lifting a barrel poured the water away without a word.

Found by reading the whole of `pick_up_furniture` while porting `unhitch_team`,
not by anything failing. Nothing in the suite had ever tried to pick up a full
chest, because nothing in the suite had any reason to. That is the argument for
reading the whole of an action rather than the branch you came for.

One of the three is unreachable, and that is faithful too: `Get down off it
first.` cannot be reached through a wheeled vehicle, because nobody can board
one without a team in front of it and the team is asked about first. Only a
hull ever reaches that line.

### A ridden thing is the ninth that will not sit still, and the only one that settles from a place

Every other thing on this island that moves unwatched moves because a clock
moved. A fire has burned this much of its fuel; a wound has drained this far; a
trap has had eighty rolls at the country round it. Not one of them needs to
know where anybody is standing.

A mount is the opposite of all of them. It moves for exactly one reason — the
rider moved — and it moves not at a rate but to a **place**. The browser keeps
it under its rider by copying the player's position onto the creature every
frame, which is a loop, and there are no loops here.

But there does not have to be one. The moment a rider's position changes is a
moment this island already knows about, because the client tells it, through
`rpc_move`. So `drag_along` runs there, in the same statement that moves you:
the beast under the saddle, the cart behind you, the wagon you are on and the
team in front of it all land where you did. Nothing is stale and nothing is
rolled forward, because for once the clock is not what moved.

Everything lands on the same spot, which is close enough. Nothing in the rules
asks whether a horse is half a tile ahead of the cart it is pulling, and
pretending to know would be inventing a simulation the browser has not got
either.

### The ceiling had to learn what you are sitting on

`rpc_move` has always believed a claimed position only as far as the fastest
thing on two legs could have carried you since you last said where you were. It
is the one thing standing between a client and the far side of the island, so
it is not lifted for a rider — it is told.

`travel_speed()` answers with the walk, or what the mount could do, or what the
team in the traces could do, or the hull's own speed. A vehicle with an
unfilled yoke answers nought, and nought means walking, because what you are
doing is pushing it.

The arithmetic is the browser's, including the part that reads like a bug and
is not: a horse straight out of the wild is *slower* than your own legs — 2.30
tiles a second against 2.40 — because `footing` is 0.9 until something has been
learned on bad ground. The same horse at climbing 60 does 3.39 and steps up 51
height units where your legs manage 32. A horse is worth having for what it
learns, not for what it is.

### A trap is a chance compounded, not a chance repeated

A trap is the eighth thing that will not sit still, and the first that is a
gamble. Everything settled so far had an answer that could be worked out: a
fire has burned this much of its fuel, a wound has drained this far, a well
holds what the rate says it holds. A trap asks a question with dice in it, and
it asks it every forty-five seconds whether anybody is there or not.

Rolling it forty times when somebody finally walks past would be both slow and
wrong — wrong because a trap that is checked often would catch more than one
that is not. So it is not rolled forty times. The chance of catching nothing in
`n` rolls is `(1 - p)^n`, so the chance of catching something is one minus
that, rolled **once**. The same trick the festering wound uses, and the only
honest way to settle a gamble from a timestamp.

And unlike a hunt, it is deliberately **not** clamped. `hunt_window()` caps a
chase at ten seconds however long you were gone, because a hunter cannot have
been closing on a path nobody wrote down. A trap is the opposite: it catches
things *precisely* when nobody is watching, which is the whole of what it is
for. An hour away is eighty real rolls, and eighty rolls at forty in a hundred
is a certainty.

### An honest check that made the island fail for getting better

The live suite had a check that proved the dispatcher tells the truth about an
action with no performer behind it. It proved it by *playing*: try half a dozen
actions in turn, take the first that is refused for want of a performer. The
comment above it worried, in as many words, about the check rotting as the port
caught up.

It rotted, in the direction nobody had planned for. Every one of the six is
ported now, so the loop found no refusal at all and **started six real jobs**
instead. Three is all a head holds, so the next four checks were refused for
want of room, and a live run failed because the island had got better.

The fix is not a longer list of candidates, it is not asking by doing.
`rpc_unported()` reads out the same `act_ported()` the dispatcher consults.
A question that is asked rather than acted out cannot fill a queue and cannot
rot either way: the day it returns nothing is the day the port is finished.

### A fragment is a thing that knows what it is a piece of

Everything else made on this island is one item with a quality on it. A
fragment is one of several, and the several only mean anything together: `old
lamp 2/3` is the second piece of a three-piece lamp, and until the other two
are in the same pack it is a scrap of metal.

There is no table for that and there does not need to be. The pieces are
ordinary rows with the relic and the number written into `extra`, exactly as
the browser writes them, and a regex takes them apart again. A relic
half-found is a pack with some of the numbers in it. Forty-eight tiles of an
island at archaeology 45 turned up fifteen fragments of seven different things.

The ground is also kinder than it needs to be, deliberately: a turn of the
trowel that finds anything finds a piece you are *short* of, if you are short
of any. That is not realism, it is the difference between a five-piece helm
being a long afternoon and a five-piece helm being something nobody finishes.

### Twenty-two of twenty-two

`seek` was the last trade, and it needed nothing that was not already here.
Every trade before it wanted something the island had not got — crates,
furnaces, walls, barrels, marks on a map, relics — so each one arrived with a
subsystem behind it. This one is the gatherer machinery with two branches
added: what ground is worth a nose, and what a nose turns up. A quarter of an
hour of a snout is thirty-eight holes and six fragments in the crate.

### A seventh prefix, and the first that was not a column

`h` was the loop variable in `perform_dig` *and* the alias of
`pieces_held(...) h`, so `h.ql` was ambiguous between a record field and a
column of the very rows being looped over. The six before this were locals
colliding with column names; this one is a local colliding with a query alias,
which the rule "alias every table" does not on its own prevent. Alias every
table *and* prefix every local, and the two can never meet.


### A post is the seventh thing that will not sit still, and the first that dies

A fire burns down, a crop comes on, a well fills, a candle burns while it is
lit, a creature walks, a wound drains. All of them settle to a number. A work
post settles to a number too — it is a stake in open ground with nothing
holding it up, and it rots where it stands, half an hour for a rough one and
three hours for the best that can be made — but when that number reaches a
hundred the post is *gone*, and whoever was working out of it comes home.

So `post_settle` is the first settling that deletes a row, and every question
about a post goes through it first: one nobody has looked at for a day is not a
post at 100 damage, it is not there. Forty minutes into a seventy-four minute
post is `54 gone, and it is still standing`; two hours is `1 post went over ...
The work post (pine) has rotted through and gone over. Middun comes home.`

The knock-on was worth the trouble. Everything a worker does is measured from
somewhere — where it looks for work, how far it ranges, where it wanders, how
far a guard's border reaches — and all of it read the settlement directly,
because until now a settlement was the only place orders could come from.
`work_site` answers that once, and everything reads it.

### A knife that was never in the game

The port handed every new player nine things, one of which was a `knife`. There
is no `knife` in this game — there is a carving knife, a hunting knife and a
butchering knife — so every player had been carrying a thing with no definition
behind it since the first migration: no name, no weight, no description.
Nothing noticed, because nothing had ever asked one of them a question.

`examine_item` asked, and a null in a concatenation is a null all the way out,
so the action died on a not-null constraint rather than saying a word. The live
smoke test found it by looking at the first thing in the pack — which the local
suite had never done, because every examine here was of something it had put
there itself, with a material on it.

Two fixes and a third thing while the lid was off: `unit_weight` copes with a
thing made of nothing in particular, `examine_item_text` says nothing about a
material rather than nothing at all, and the kit is the browser's twelve things
with copper heads on pine handles rather than nine bare ones.


### A candle is the sixth thing that will not sit still, and the fussiest

A fire burns whether anybody is there or not. A crop grows, a well fills, a
creature walks, a wound drains. A candle is the first of them that burns
*conditionally* — only while the lantern is lit, and a dark lantern in your
pack costs you nothing but the weight of it. So one timestamp is not enough: it
needs `lit` and `lit_at`, and the arithmetic is "what was left, less the seconds
since it was struck, but only if it is still burning".

Five minutes lit reads `lit, 19m of candle left`; five minutes dark reads `24m
of candle in it, unlit`.

### The tinderbox that was never in the game

`light_lantern` asks for a tinderbox. There is no tinderbox in the game — not
in the item list, not in a recipe, nowhere but that one check and a help page
promising it. So a lantern cannot be struck in the browser either, and it
cannot be struck here.

Ported as written, and measured out loud rather than quietly given an item the
game has never had: measurement 374 prints the refusal and then counts the
tinderboxes in `item_def`, which is nought. Somebody should decide whether the
item or the check is the mistake. A port is not the place to decide it.

### One un-settled action takes four unrelated checks down with it

Nothing runs on this island but the looking, so an action with a clock on it
sits in the player's head until somebody sweeps — and three of those and the
next one is refused for want of room. The live smoke test started a `prospect`
(five seconds) and never settled it, and the four checks after it failed
saying things like "You can only keep 3 jobs in your head at once", which
explains nothing about the cause.

Two fixes, because the first alone would only postpone it: anything timed now
goes through a `settle()` helper, and the smoke test asks outright whether the
head is empty before the digging starts. A full head is now one honest failure
that names what is in it.

Worth noting what did *not* catch this: `npm run typecheck` covers `src` only,
so `supabase/test/*.ts` is checked by nothing but the esbuild bundle, which
erases types. A second tsconfig for the node-side files would be the real
guard, and it wants `@types/node` that this repo does not have yet.

### A well is the fifth thing that will not sit still

A fire burns down, a crop comes on, a forage bed recovers, a creature walks. A
well draws its own water, and it draws it whether or not anybody is standing
over it — so it settles like all the others: what was in it when somebody last
touched it, plus the seconds since, stopped at the depth it was sunk to. Five
minutes gives 16.8 litres and a day gives 50, which is the whole of the shaft
and not a drop more.

A barrel is the other half and the easy half. It holds what is poured in and
loses nothing, so its litres are a number on the row.

The one thing this turned up is a difference between the two that reads as a
bug the first time it bites. A barrel says on its row what is in it, because
somebody poured it in. A well never needed telling — it is water, it was always
going to be water — and its column only catches up the next time anybody draws
from it. So a bucket filled at a fresh well came up holding nothing at all,
because the code read the column. `placed_liquid()` answers the question
instead of the column does, and a well answers water.

### A sixth prefix, and the first caught by running

`kind` is a local in `errand_do` and a column of `placed`. That is the sixth
time this exact class has bitten — after `land_tile.y`, `crop.y`,
`trait_def.tier`, `species_butcher.n` and `crate_def.kind` — and the first that
was caught by running the suite rather than by reading the diff. The fix is the
one the surrounding code already uses: alias the table, every time, even when
the query looks unambiguous on the page.

### A hash on something that never changes is not a hash

A prospector picks where to read next by throwing sixty guesses inside its
range and walking to the furthest. The browser rolls them; out here everything
is hashed off the creature and the leg it is on, because a row settled twice
has to land in the same place both times.

A deed worker never touches its leg. Nothing in the round trip needs one — the
phases carry the state, and `leg` belongs to the wild walk. So the hash was
constant, the sixty guesses were the same sixty guesses every round, and a
dowse set to read the ground took forty readings of one patch of grass and
learned a great deal about it. A reading *is* a leg, so it counts as one now.

The suite said `40 readings, 0 tiles lit`, which is the sort of sentence a
boolean assertion would have turned into a silent pass.

### Examining a tile inside a building

`building_at` hands back the building's *number*. The examine text declared a
`building` row variable and assigned it straight in, which Postgres refuses the
moment it is handed one — so examining any tile under a roof raised, and every
tile outside one worked perfectly, because `building_at` answers null out there
and null goes into a row variable without complaint.

It went out live. The suite examined the ground by the token, which is exactly
the case that cannot fail, and nothing asked about the one tile that would have
said "It belongs to Mead Hall". The fix is forward, in the next migration, and
the measurement that would have caught it now runs first in the section.

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

### A thing in a bag is not to hand

This was going to be the hard one. The browser keeps a bag's contents out of
the inventory list entirely, so a recipe that wants two planks cannot see the
two in your satchel — and making that true down here looked like teaching every
question the island asks of a pack to skip what is inside something. Fifty-odd
places, of which `consume`, `pack_count` and `tool_ql` are only the obvious
three, and half of that is worse than none.

The way through was to stop trying. Every one of those fifty queries already
says `holder = 'player'`, so a stowed thing simply stops being held by the
player: `holder` becomes `'bag'` and `inside` says which one. Nothing had to
learn anything. The schema had been spelling out `'player', 'ground', 'crate',
'bag'` in a comment since the first migration and the last of the four had
never once been used.

The other fear was row level security — a policy on `item` that has to ask
whether the *bag* belongs to you is a policy on `item` that queries `item`,
which recurses. It never needed to ask. A thing in your satchel keeps your
`holder_uid`: it is still yours, it is only not to hand. The policy is a column
test like every other one.

Nine planks in the pack and a wooden shield is `allowed`; seven of them in the
satchel and the same shield is `Wooden shield takes 4 planks`.

### A plural the port got wrong

The port put an `s` on the end whenever there was more than one, which is how a
recipe came to ask for "8 nailss". The browser is careful in two ways this was
not: only a thing that *stacks* takes a plural at all, and a name that already
ends in an s is left alone. Found by a bag test that had nothing to do with
nails, which is the usual way of it.


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
on an island with three hundred and seventy-four actions that bet keeps
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
| `?me=<name>` | what to be called, if there is no account signed in here |

Generating an island stays in the browser — it is a large deterministic
function of a seed that already exists and is tested, and a second
implementation in SQL would be two islands that have to agree forever. So it is
rolled here, handed over once, and after that it is not ours: `rpc_put_land`
refuses the moment the island opens.

A page that cannot reach the keeper says so and plays on its own. An island is
an addition, not a replacement.

## A name you can prove

Until accounts, everybody was anybody. The island read `?me=Wanderer` out of
the address bar, and the only thing behind that name was an anonymous sign-in
that any tab can mint for itself in a millisecond. Fine for one person on one
island; nothing at all once there are two.

`account.html` is where a username and a password are set up. The trick that
makes it small is that **the username is the login**:

    alice  ->  alice@players.wurm.invalid

`.invalid` is reserved by RFC 2606 and can never be delegated to anybody, so
the address is guaranteed to reach no one, forever. Two things fall out of it:

* **Signing up is the reservation.** The index that makes a name yours is the
  unique one Auth already keeps over its own addresses, so there is no window
  between "free when I looked" and "mine now" for a second browser to slip
  into. No lock, no retry, no race, and no second authority to disagree with
  the first. `rpc_name_free` exists, but only as a courtesy, and says so.
* **The name cannot be forged.** `rpc_my_name()` takes no argument: it reads
  the caller's own address back out of `auth.users` and cuts the suffix off.
  A browser that signed up as `alice` cannot file itself as `bob`, because it
  never gets to say. Had that function taken a name and trusted it, the whole
  change would have been one RPC call from being undone.

What the database cannot do is the password. Auth takes it, hashes it, and
Postgres only ever learns that a row appeared — so the eight-character minimum
and the check against breached passwords both happen in the browser, and a
check in the browser is a courtesy to the honest rather than a control. The
settings that make them controls are in the project's own Auth configuration
and nowhere a migration can reach; `20260915025000_accounts.sql` names all
three, including the one without which none of this works (`Confirm email` has
to be off, because an address at `.invalid` can never answer a mail).

The breach check is the Pwned Passwords range API by k-anonymity: SHA-1 the
password, send the **first five hex characters** of the digest and nothing
else, match the suffixes here. It fails closed — "deny breached passwords" and
"deny breached passwords when the network is cooperating" are different
instructions, and only one of them was given.

### The rulebook rule met its first counterexample

`lock_doors()` decided what belonged to the rulebook by asking whether a table
had a `world_id`: no island of its own meant a definition, so it was made
readable by everybody and writable by nobody. That held for a hundred and
twenty migrations. `account` walked straight through it — a roll of who exists
belongs to no island and is not a definition either — and the sweep dropped the
policy the migration had just written and put back one letting `anon` read
every username in the game in a single request.

Nothing above it would have noticed, because every measurement in the suite so
far asked as somebody who had already come ashore. The rule now has the other
half it always wanted: the rulebook is what has **no island and nobody in it**.
A `uid` column means the rows are about people, and people's rows are answered
for by their own policies. Measurement 543 asks as a stranger, which is the
only way that class of thing is ever found.

## A face, and where it is kept

Between making an account and stepping ashore there is a second step: skin,
hair, eyes, build, beard and the clothes you washed ashore in. Eight short
strings, and every one of them an id out of `look_option`.

Ids and not colours, because of where a look goes. It leaves a stranger's
browser, sits in this database, and arrives on everybody else's machine as an
argument to `ctx.fillStyle`. A free-text colour on that path is a hole with a
view of the whole island. `look_clean()` replaces anything that is not in the
table, so the worst a crafted look can do is come out looking ordinary — and
it is total, never raising and never returning half a face, because a body with
half an appearance is a state nothing downstream knows how to be in.

`src/game/look.ts` clamps the same way and that clamp is worth nothing: it runs
on the client. This one is the control.

The face lives in two places on purpose. `account.look` is what you chose, and
it follows you between islands; `player.look` is the body on this island, which
is what everybody else reads through `player_read`. `rpc_set_look` writes both,
including every body you already have ashore — a look you change and then have
to travel to collect is a look that is wrong everywhere you are not standing.
A body with no account behind it gets `look_random()`, because nobody should be
the default figure.

### Two things it turned up

`look_option` is created twice — once by hand in `20260915033000_looks.sql` and
once by the generated definitions — because those two are stamped by different
clocks and the clocks cross. Both say `if not exists`, so neither cares which
landed first, and nothing calls `look_clean()` in between.

And `look_random()` draws from `gen_random_uuid()` rather than `random()`. The
suite seeds `random()` once at the top so that a roll reading differently from
last time means the rules changed. Every join now rolls a face; drawing those
from the seeded stream shifted every dig, swing and cast that came after it —
a hundred and forty-six measurements moved and not one of them was about faces.
Postgres's uuid source is its own, so the sequence the island is measured with
is left alone. Only measurement 277 changed: 68 rulebook tables became 69.

## The big island

The island the keeper serves is 4096 tiles a side. Three things had to change
before that would run, and all three were the same shape: something that was
fine at 256 because 256 is small.

**The join stopped carrying the land.** It used to be `rpc_land` for every
scanline — 138 MB at this size, paid by every player on every join, forever.
Now it carries the seed. The land is a pure function of the seed and the survey
chart, the browser has both, and it works the ground out 64 × 64 at a time as
somebody walks into it. `rpc_land` is still there and still answers; it is
simply not asked for sixteen million tiles at the door. The land travels once,
at founding, from `tools/found-island.ts`.

**Wildlife stopped being laid down all at once.** `creature_stock` put an
island's whole population out when it opened — one wild thing per 32 × 32
tiles, placed by throwing darts at the map until enough stuck. Sixty-four
creatures and a few hundred darts at 256². At 4096² it is sixteen thousand
creatures and up to six hundred and fifty thousand darts, each one reading the
height of a tile, which on a big island means detoasting an eight kilobyte
scanline to look at two bytes of it. **`rpc_ready` did not come back**, and it
was found by opening one — no amount of reading was going to turn that up.

So wildlife settles like everything else here. A block of country — 256 tiles
square — gets its animals the first time somebody comes within a block of it,
and the row in `world_stocked` that says so is what stops it happening twice:
two people walking into the same empty country both try to claim it, one wins
the primary key, and the loser does nothing rather than doubling the animals.
`rpc_move` is where it happens, written so that the usual case (nine blocks
already out) is one index probe and nothing else.

The density is unchanged, so a small island gets exactly the sixty-four it
always got, in one block, with the same thirty-two darts. What changed is that
a big one no longer has to populate Cornwall before anybody can stand up in
Kent — and that an island somebody joins now has wildlife in it even if nobody
ever called `rpc_ready` on it, which is why a dozen measurements in the suite
read differently from before.

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
