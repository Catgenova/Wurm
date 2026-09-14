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

## The only four doors

PostgREST publishes every function in the schema, so `0007_rls.sql` takes
execute away from everybody and hands it back to four:

| | |
|---|---|
| `rpc_join(world, name)` | come ashore, or come back to the body you left |
| `rpc_move(world, x, y, level)` | say where you have walked to, believed only as far as the clock allows |
| `rpc_act(world, action, target, times)` | ask to do something |
| `rpc_sweep()` | finish what people walked away from |

Every table has row level security on and **not one write policy**. A client
holding the publishable key can read the island, its own pack and its own
skills, and can write nothing at all.

## The numbers are generated, the algorithms are ported

`0003_defs.sql` is generated from the TypeScript by `npm run defs` — item
weights, tile yields, skill starts, material multipliers. It is never edited by
hand. Only the *algorithms* (the skill curve, the success roll, what a tool is
worth) exist twice, in `0004_rules.sql` and in `src/game/`, and the suite checks
they agree.

## Applying it

The migrations are plain SQL, in order. Either paste them into the SQL editor
in the dashboard, or:

```
supabase link --project-ref <ref>
supabase db push
```

`local/00_shim.sql` is **not** part of that. It is the handful of things a real
project already has — the `auth` schema, `auth.uid()`, the three roles — so the
same migrations can be run against a bare Postgres for testing. Applying it to
the project would do nothing good.

## Testing

`npm run db:test` drops the schema, rebuilds it from the migrations and runs
`test/island.sql` over it. From scratch every time, deliberately: what is being
tested is as much the migrations as the rules, and a migration that only works
against a database that already had the last version of it will not run on the
project.
