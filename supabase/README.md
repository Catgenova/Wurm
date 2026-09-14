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
| **8** | working the ground: dig, mine, chip, pack, cultivate, two pavings, dropping dirt back |
| **5** | farming: till, sow, tend, harvest, clear |
| **4** | taking what grows: felling, foraging, botanizing, filling a shovel off a bed |
| **137** | known, listed, and honestly refused |

An action the rules do not implement is not the same thing as an action that
does not exist, and the difference matters to whoever is looking at the menu:
"there is no such thing as cut_down" invites a bug report, "you cannot chop
down on this island yet" invites patience. So every action in the game is in
`action_def` — generated from the same TypeScript the browser reads — and
`act_ported()` says which have a performer behind them.

Of the 205 recipes, 147 need no station and were playable from the start; the
other 58 want a lit campfire (18), a hot smelter (34), a spindle (3) or a loom
(2), and all four of those can now be built, set down and lit.

Jobs queue behind one another as they do in the game — three deep, and one
deeper for every ten points of mind logic above where you began — rather than
being refused because your hands are full.

Not yet ported at all: stamina (deliberately — half of it, with the cost but
not the recovery, would make the island unplayable), the ledger, the journal,
kilns and what they fire, smelting jobs themselves, flattening and levelling,
paving with cut slabs, fishing, planting trees, prospecting, and the ease a hot
oven lends to cooking.

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
