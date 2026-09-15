# A 4096 × 4096 island on Supabase

The world table already allows it: `size int not null check (size between 8 and 4096)`.
This is what happens if you use that ceiling — measured against the schema in
`supabase/migrations/`, not against a hypothetical one.

Every number below was measured on a real 4096 × 4096 world, generated with
`generateAtlasWindow` and loaded into PostgreSQL 16 in the layout
`20260914180100_world.sql` defines. Sizes come from `pg_total_relation_size`,
write costs from `pg_current_wal_lsn()` deltas, and the join payload from the
same `jsonb_build_object` aggregation `rpc_land` runs.

## The short version

**Storage and writes are fine. The join is not.**

The land tables hold a 4096² world in **36 MB**, and a dug tile costs about
**1.5 KB of WAL**. Neither is worth a second thought against the Pro plan's
8 GB. But `Island.join` downloads the entire world before the player can
move — `rpc_land` in batches of 64 rows, base64 inside JSON — and at 4096²
that is **138 MB over 65 round trips**, up from about 0.54 MB at 256².

| | 256² | 4096² | Growth |
| --- | ---: | ---: | ---: |
| Tiles | 65,536 | 16,777,216 | 256× |
| Land tables on disk | ~0.6 MB | **36 MB** | 60× |
| WAL per dug tile | ~1.5 KB | ~1.5 KB | — |
| **Join download** | **~0.54 MB** | **~138 MB** | **256×** |

Storage grows more slowly than tile count because the tile planes compress
well. The join download does not compress at all — it is base64 in JSON — so it
grows with the square, in full.

At 10,000 joins a day that download is **41 TB a month, about $3,730**. The
same traffic with the client generating its own terrain is **inside the Pro
plan's included egress**, so $25.

## What the schema does today

Land is stored one row per scanline, as byte strings:

```sql
create table land_corner (world_id uuid, y int, heights bytea, dirt bytea, primary key (world_id, y));
create table land_tile   (world_id uuid, y int, tiles bytea, data bytea, rock bytea, primary key (world_id, y));
```

At 4096 that is 4,097 corner rows of 12,291 bytes and 4,096 tile rows of 12,288
— 96 MiB of land in 8,193 rows. Measured in the database:

| Table | Rows | On disk |
| --- | ---: | ---: |
| `land_corner` | 4,097 | 28 MB |
| `land_tile` | 4,096 | 8 MB |
| **Total** | **8,193** | **36 MB** |

The tile planes compress 6× under TOAST; the heights, being 16-bit and noisy in
the low bits, only manage 1.8×. Even so: **227 worlds fit in the 8 GB the Pro
plan includes**. Scanline rows are a good shape for this data and there is no
reason to change them for storage's sake.

Storing the same world as 4,096 chunks of 64 × 64 instead comes to 28 MB —
better, because a square compresses better than a 4096-wide strip, but not by
enough to matter.

## Writes are fine

A dug tile rewrites the scanline it sits on. That sounds expensive and isn't,
because the row compresses to about 2 KB:

| Write path | WAL per dug tile |
| --- | ---: |
| Scanline row (`land_tile`) | **1,532 B** |
| 64 × 64 chunk row | 8,154 B |

Measured over 200 digs spread across 200 different rows, with `fsync` and
`full_page_writes` off, so both are floors — Supabase runs with full-page
writes on, which adds up to 8 KB per page on first touch after a checkpoint.
A single dig measured in isolation is 8.6 KB either way, almost entirely the
full-page image.

Chunks lose here only because the chunk payload I tested carries corners, soil,
tiles, data and rock for its square — about 25 KB against the scanline row's
12 KB. Write cost tracks the compressed size of whatever row you rewrite, and
on that measure the current layout is the better of the two.

## The join is the problem

`Island.join` builds a blank world and fills it by calling `rpc_land` for every
scanline, `DOWNLOAD_BATCH = 64` rows at a time. `rpc_land` returns each row as
five base64 strings inside a JSON object.

Measured, running that exact aggregation against the real world:

- one 64-row batch: **2,157,622 bytes** (2.06 MiB)
- per scanline: 33,713 bytes, against 24,579 bytes of actual land — base64 and
  JSON add 37%
- the whole world: **138 MB across 65 round trips**

`rpc_land` also refuses more than 256 rows per call, so the round trips cannot
be collapsed. Nothing here is wrong at 256², where the same path moves about
half a megabyte. At 4096² it is a 138 MB download standing between a player and
their first step, and it is paid again by every player, on every join, forever.

`tile_change` exists precisely so that somebody returning "catches up without
downloading six megabytes again" — the right instinct, applied to the diff but
not yet to the land itself.

### What that costs

Supabase bills egress at **$0.09/GB** beyond the plan's allowance, **$0.03/GB**
when served cached through the CDN. The Pro plan includes 250 GB.

| Joins/day | Whole world each time | Client generates |
| ---: | ---: | ---: |
| 100 | $40 (414 GB) | $25 |
| 1,000 | **$375** (4.1 TB) | $25 |
| 10,000 | **$3,731** (41 TB) | $25 |

The Free plan's 5 GB of egress is **36 joins a month** — and free projects pause
after a week idle, so it was never the place for a persistent island anyway.

## The fix: send the seed, not the land

The land is a pure function of the seed and the atlas. `atlas-world.ts`
generates any window of it, and the client already has that code — so the join
does not need to carry the land at all. It needs the seed, the atlas, and the
diffs that `tile_change` already holds.

Measured generation cost, single-threaded:

| Work | Time |
| --- | ---: |
| One 64 × 64 chunk | **15.9 ms** |
| One 32 × 32 chunk | 5.9 ms |
| First paint, 3 × 3 chunks around the player | **143 ms** |
| The whole 4096² world | 133 s |

So: never generate the whole world. 133 seconds and 117 MB of typed arrays is a
non-starter on the main thread, but a chunk costs 16 ms, and the nine chunks a
player can actually see cost 143 ms — less than the first round trip of the
current download.

That turns the join into:

1. the world row (seed, size, spawn) — a few hundred bytes,
2. `atlas.png`, **245 KB**, immutable and CDN-cacheable, fetched once per client
   rather than once per join,
3. `tile_change` rows since the player last looked — which is already how
   catching up works.

Terrain then costs nothing per join, and the only thing that grows with the
player base is the diff stream, which grows with how much people dig rather
than with how big the map is. **World size stops being a cost driver.**

Keeping the land in Postgres as well is still worth it — it is 36 MB and it is
the authority when generation and history disagree — but it should be read in
windows, not downloaded whole. A 64 × 64 viewport costs **443 buffers and
1.56 ms** read as 64 scanlines, against **39 buffers and 0.55 ms** read as one
chunk row, because a scanline read has to detoast a full 4096-wide row to use
64 bytes of it. If windowed reads become the common path, a chunk table earns
its place; until then the scanline rows are fine.

## Realtime

Every change goes to one channel per island, `island:${worldId}`, so every
player hears every dig wherever it happens. Supabase counts **one message sent
plus one per receiving client**, with 5M included on Pro and $2.50 per million
after.

At 256² that is honest enough — the whole island is about a kilometre across
and everyone is plausibly in sight of everyone. At 4096² the map is 268 km²
and the same fanout sends a player the sound of somebody digging ten kilometres
away.

200 concurrent players, four changes a minute each, four active hours a day:

| Channel design | Messages/month | Cost |
| --- | ---: | ---: |
| One channel per island (today) | ~1.15 B | far past any plan |
| Per-region channels, ~3 near listeners | ~23 M | ~$45/mo |

Splitting the channel by region is the single change that makes a big map
cheaper to run than a small one, because density per channel falls as the map
grows.

## What still breaks in the client

Two things scale with `w * h` and will not survive 4096², whatever the server
does:

1. **`src/world/pathfinding.ts:46`** — `getBuffers(w * h * levels)` allocates
   five arrays sized by the whole grid: **640 MiB** at 4096² with one level,
   1.28 GiB with two, on the first click-to-move. The search itself is already
   bounded by `maxNodes` (30,000); only the index-by-tile buffers are unbounded.
   A hash map or a windowed sub-grid fixes it.
2. **`src/ui/panels/minimap.ts:52`** — the base canvas is `w × h`, which at 4096
   is 16,777,216 pixels and a 67 MB `ImageData`. That is exactly Safari's canvas
   area cap, so it is marginal rather than certainly broken, and it should
   become a pre-baked overview image with incremental repaints.

Two earlier worries have already been fixed on main and are noted here only so
they are not re-reported: saves moved to IndexedDB, so the old `localStorage`
quota problem is gone, and the minimap's view canvas is now a fixed 512 px
rather than two pixels per tile.

The renderer is fine: it derives its draw range from the camera's iso bounds,
so per-frame cost depends on the viewport and not on world size.

## Reproducing this

```sh
npx tsx tools/measure-map-cost.ts 256 4096
```

reports the generation and wire sizes. The database figures come from loading a
generated world into the schema in `supabase/migrations/` and reading
`pg_total_relation_size`, `pg_current_wal_lsn()` and `explain (analyze, buffers)`.

Supabase pricing verified September 2026: Free — 500 MB database, 1 GB storage,
5 GB egress, 2M realtime messages. Pro — $25/mo with 8 GB disk, 100 GB storage,
250 GB egress, 5M realtime messages. Overages — disk $0.125/GB, storage
$0.021/GB, egress $0.09/GB, cached egress $0.03/GB, realtime $2.50 per million
messages.

- <https://supabase.com/pricing>
- <https://supabase.com/docs/guides/platform/manage-your-usage/egress>
- <https://supabase.com/docs/guides/realtime/pricing>
