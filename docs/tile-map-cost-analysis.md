# Cost of a 4096×4096 tile map on Supabase

What it costs to grow the world from 256×256 to 4096×4096 tiles and put it on
Supabase. Every size in this document was measured, not estimated: terrain was
generated with the game's own `generateWorld` (seed 12345) and the database
figures come from a local PostgreSQL 16 cluster loaded with the real bytes.
Re-run the size measurements with:

```sh
npx tsx tools/measure-map-cost.ts 256 4096
```

## The short version

The map is **256× more tiles** but only **156× more bytes on the wire**, and
if the client streams what it can see instead of downloading the map, it is
**cheaper per session than the 256×256 map is today**.

The money is not in storing the map. It is in how you shape the rows and how
much of the map you ship per player.

| Decision | Wrong way | Right way | Difference |
| --- | --- | --- | --- |
| Postgres schema | one row per tile → **1.61 GB** per world | 64×64 chunks as `bytea` → **10.3 MB** | **157×** |
| Client load | whole map → **8.47 MB** | stream visible chunks → **~17 KB** first paint | **500×** |
| Egress @ 10k sessions/day | **$231/mo** | **$25/mo** (inside Pro) | **$206/mo** |

A 4096×4096 world on the recommended architecture costs **$25/month** — the
Pro plan price, with the map consuming 0.13% of the included database. Getting
the schema wrong costs more than the plan does.

## What actually changes

At 4 m per tile, the world goes from a 1.02 km island to a **16.4 km × 16.4 km**
landmass — 1.0 km² to 268 km², the scale of the attached reference map.

| | 256×256 | 4096×4096 | Growth |
| --- | ---: | ---: | ---: |
| Tiles | 65,536 | 16,777,216 | 256× |
| Height corners | 66,049 | 16,785,409 | 254× |
| Land tiles | 43.2% | 42.0% | — |
| `World` typed arrays (RAM) | 263,170 B | 67,125,250 B | 255× |
| Current save format (base64 JSON) | 350,896 B | 89,500,336 B | 255× |
| Whole map, gzip | 58,956 B | 10,463,315 B | 177× |
| Whole map, brotli | 54,300 B | 8,467,331 B | **156×** |
| Chunked, delta + brotli | 42,381 B | 7,550,023 B | 178× |
| `generateWorld` wall clock | 0.14 s | **21.6 s** | 154× |

Compressed size grows more slowly than tile count because a bigger island
brings proportionally more open ocean, which is almost free to encode. Per
tile the big map is actually *cheaper*: **0.45 bytes/tile** chunked, against
0.65 bytes/tile for the small one chunked the same way.

## Storage: the schema decides everything

Three candidate schemas, each loaded with the real 4096² world and measured
with `pg_total_relation_size`:

| Schema | Rows | Heap | Index | **Total** |
| --- | ---: | ---: | ---: | ---: |
| Row per tile, `(world_id, x, y)` PK | 16,777,216 | 964 MB | 650 MB | **1,614 MB** |
| Row per tile, `(x, y)` PK | 16,777,216 | 709 MB | 359 MB | **1,068 MB** |
| 64×64 chunks, raw `bytea` (TOAST/pglz) | 4,096 | 1 MB | 12 MB toast | **13.5 MB** |
| 64×64 chunks, app-compressed `bytea` | 4,096 | — | — | **10.3 MB** |

Row-per-tile is the trap, because **it works fine at 256×256**. The same
schema holds 65,536 rows today and takes about 4 MB — nothing. At 4096² it
becomes 1.6 GB, and every cost turns bad at once:

- It is **3.2× the entire 500 MB Free-plan database** for a single world.
- It uses **20% of the Pro plan's included 8 GB**, so four worlds fill it.
- Reading one 64×64 region touches **805 buffers and takes 19.5 ms**, against
  **5 buffers and 0.10 ms** for the equivalent chunk row — 190× slower for the
  exact same terrain.
- PostgREST caps responses at 1,000 rows by default, so a full map read becomes
  **16,777 paginated requests**, and as JSON on the wire it is roughly 670 MB
  before compression — 79× worse than the 8.47 MB binary blob.

Chunked storage inverts all of that. The whole world is 4,096 rows; the cost
of the map stops being interesting.

### The one thing chunking makes worse

A chunk row is ~2 KB, so a single dug tile rewrites the whole chunk. Measured
WAL per tile edit (`fsync` and `full_page_writes` off, so these are floors —
Supabase runs with full-page writes on, which adds up to 8 KB per page on
first touch after a checkpoint):

| Write path | WAL per tile edit |
| --- | ---: |
| Row per tile, update one row | 209 B |
| Chunked, rewrite the containing chunk | **1,791 B** (8.6×) |
| Slim `tile_override` row, insert | **138 B** |

So do not store mutable terrain in the chunk blobs. Keep the generated terrain
immutable and put player changes in a narrow override table — the cheapest
read *and* the cheapest write, and the override table only ever holds tiles
players actually touched.

## Egress: the dominant cost

Supabase bills egress at **$0.09/GB** beyond the plan's allowance (**$0.03/GB**
when served cached through the CDN). This, not storage, is what a 16× bigger
map really costs.

Per client, one world load:

| Approach | Bytes | Free plan (5 GB) | Pro (250 GB) |
| --- | ---: | ---: | ---: |
| 256² today, as currently saved | 350,896 B | ~14,200 loads | ~712,000 loads |
| 4096², whole map, brotli | 8,467,331 B | **590 loads** | 29,525 loads |
| 4096², chunked, whole map | 7,550,023 B | 662 loads | 33,112 loads |
| 4096², streamed, typical session (~100 chunks) | ~184,000 B | 27,174 sessions | 1,358,695 sessions |
| 4096², streamed, first paint (3×3 chunks) | ~16,600 B | — | — |

**The Free plan cannot serve a whole 4096² map**: 5 GB of egress is 590 loads a
month, about 19 a day. (Free-plan projects also pause after a week of
inactivity, so it is not a hosting option for a persistent world regardless.)

Monthly bill by traffic, Pro plan, one map load per session:

| Sessions/day | Whole map each time | Streamed |
| ---: | ---: | ---: |
| 100 | $25 (25 GB, in quota) | $25 (0.6 GB) |
| 1,000 | $25 (254 GB, just over) | $25 (5.5 GB) |
| 10,000 | **$231** (2,540 GB) | $25 (55 GB) |
| 50,000 | **$1,145** (12,700 GB) | $25 (276 GB, ~$2 over) |

Streaming is what makes the big map affordable, and it is not a marginal win:
at 50,000 sessions/day it is the difference between **$1,145 and $27**.

It also means the 4096² map is *cheaper to serve than the current 256² one*,
because a session pulls ~184 KB of chunks instead of a 343 KB whole-map save.
**World size stops being a cost driver once the client only pays for what it
looks at.** What you pay for is player-hours and how far players roam.

The viewport backs this up: at zoom 1 on a 1080p screen roughly 2,000–2,500
tiles are visible — about one and a half 64×64 chunks — so a 3×3 chunk working
set covers the screen with a ring of prefetch, at a mean of 1,843 B per chunk.

## Realtime

Supabase counts **one message sent plus one per receiving client**, with 5M
included on Pro and $2.50 per million after. The cost scales with *fanout*, not
map size — and here the bigger map helps.

200 concurrent players, 4 tile changes per minute each, 4 active hours a day
(192,000 change events/day):

| Channel design | Messages/month | Cost |
| --- | ---: | ---: |
| One global channel (what 1 km² effectively forces) | ~1.15 B | far past any plan |
| Per-chunk channels, ~3 nearby listeners | ~23 M | ~$45/mo |

On a 1.0 km² island everyone is plausibly in everyone's view, so fanout is
global. Spread over 268 km² and 4,096 chunks, per-region channels cut it by
two orders of magnitude. Use Broadcast on per-chunk channels rather than
Postgres Changes, which re-checks every change against every subscriber's RLS.

## What breaks in this codebase at 4096²

These are hard client-side failures, independent of Supabase, and they need
fixing before the map can grow:

1. **`src/world/pathfinding.ts:40`** — `getBuffers(w * h)` allocates five
   arrays sized by the whole grid: **640 MiB** at 4096² (`Float64Array` 134 MB
   + `Int32Array` 67 MB × 2 + `Int32Array` 134 MB + `Float64Array` 268 MB), on
   the first click-to-move. The search itself is already bounded by
   `maxNodes` (30,000); only the index-by-tile buffers are unbounded. Fix with
   a hash map or a windowed sub-grid.
2. **`src/ui/panels/minimap.ts:22-33`** — allocates a `w × h` canvas (67 MB
   backing store) *and* a `2w × 2h` view canvas: 8192×8192 = 67.1M pixels,
   **268 MB**, past Safari/iOS canvas area and dimension caps. The constructor
   then calls `paint()` **16.7 million times** at startup. Replace with the
   pre-baked overview PNG pyramid below.
3. **`src/game/save.ts:47-49`** — the save is base64 JSON in `localStorage`:
   **85.4 MiB** against a 5–10 MB quota, and `btoa` over a 64 MB binary string
   transiently doubles memory. Saving is simply impossible at this size; it has
   to move to IndexedDB or the server.
4. **`generateWorld` takes ~22 s** single-threaded — it cannot run on the main
   thread at load, and it exceeds Edge Function CPU budgets as a single job.
   Per chunk it is only **5.3 ms**, which is the way out (see below).
5. **`World` typed arrays are 64 MB resident** — fine on desktop, tight on
   mobile Safari. Streaming keeps only nearby chunks in memory.

One piece of good news: **the renderer already scales**. `renderer.ts:142-146`
derives its diagonal range from the camera's iso bounds and the inner loop is
bounded by screen width, so per-frame cost depends on the viewport, not on
world size. Rendering needs no changes.

## Recommended architecture

**Generate on demand, never ship the base map.** The generator is positional —
every value comes from noise and `hash2` of the coordinates — so a 64×64 chunk
can be generated in isolation given a 2-tile halo for `nearWater`'s 5×5 probe.
At **5.3 ms per chunk** the client can produce terrain in a Worker as fast as
it walks. Base terrain then costs **zero egress and zero storage**; the server
holds only the seed and what players changed.

If generation must stay server-side, the fallback is:

| Asset | Where | Size | Cost |
| --- | --- | ---: | ---: |
| 4,096 immutable chunk objects | Storage + CDN | 7.55 MB | $0.00016/mo |
| Overview PNGs (512² + 1024²) | Storage + CDN | 855 KB | negligible |
| Player tile overrides | Postgres | grows with play | ~5 MB per 100k edits |
| **Per world** | | **~8.4 MB** | **~$0.0002/mo** |

Serving base terrain from Storage rather than Postgres also moves it onto the
CDN, cutting egress from $0.09 to **$0.03/GB** and keeping the load off the
database. The 100 GB of included Storage holds roughly **11,900 worlds**.

Two further savings worth taking:

- **Skip the ocean.** 2,044 of 4,096 chunks (49.9%) are uniform open sea,
  973 KB of the total. Store nothing and synthesise them client-side: the map
  drops to 2,052 stored chunks and **6.27 MB**.
- **Delta-encode heights.** Zigzag varint deltas along rows shrink the height
  plane from 7,665,874 B gzipped to **4,047,063 B** — heights are smooth, so
  the deltas are almost all one byte. This is what `encodeChunk` in the tool
  does, and it is why chunked beats whole-map brotli despite per-chunk framing.

### Projected bill

| | Naive (row-per-tile, whole-map load) | Recommended |
| --- | ---: | ---: |
| Database | 1.61 GB/world | ~10 MB, or ~0 if generated on demand |
| Region read | 19.5 ms, 805 buffers | 0.10 ms, 5 buffers |
| Egress @ 10k sessions/day | 2,540 GB | 55 GB |
| **Monthly** | **$231** | **$25** |

The 16× map is affordable. Row-per-tile storage and whole-map downloads are
not — and both are easy to fall into precisely because both work at 256×256.

## Sources

Supabase pricing verified September 2026 (Free: 500 MB database, 1 GB storage,
5 GB egress, 2M realtime messages, 200 peak connections, paused after a week
idle. Pro: $25/mo with 8 GB disk, 100 GB storage, 250 GB egress, 5M realtime
messages, 500 peak connections. Overages: disk $0.125/GB, storage $0.021/GB,
egress $0.09/GB, cached egress $0.03/GB, realtime $2.50/M messages, $10 per
1,000 peak connections.)

- <https://supabase.com/pricing>
- <https://supabase.com/docs/guides/platform/manage-your-usage/disk-size>
- <https://supabase.com/docs/guides/platform/manage-your-usage/egress>
- <https://supabase.com/docs/guides/realtime/pricing>
- <https://supabase.com/docs/guides/storage/pricing>
