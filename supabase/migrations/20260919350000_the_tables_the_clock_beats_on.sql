-- The tables the clock beats on
--
-- Reported: wildly laggy since four o'clock. Measured here, on a freshly
-- built island, ten rounds of `world_tick` with every player awake:
--
--     creature: 450 updates, 61 of them HOT, 450 dead rows
--     item:     150 updates, 143 of them HOT,  150 dead rows
--
-- `item` is what a healthy churn table looks like: ninety-five per cent of
-- its updates never leave the page and never touch an index. `creature` is
-- fourteen per cent, and the reason is structural rather than anybody's
-- mistake: `creature_at` is `(world_id, to_x, to_y)`, and walking is
-- precisely what changes `to_x` and `to_y`. An update that moves an indexed
-- column cannot be HOT, and the moment it is not HOT *every* non-partial
-- index on the table takes a new entry -- including `creature_pkey` and
-- `creature_by_world`, neither of whose columns moved at all. They are
-- collateral, and they are the majority of the write.
--
-- ---- what was looked at and left alone ------------------------------------
--
-- The obvious move is to drop an index, and it was wrong twice.
--
-- `creature_ridden` looked like a sixth index landing at 20:06, the hour the
-- lag started. It is `(world_id, rider) where rider is not null`, sixteen
-- kilobytes, and there is not a ridden creature on the island: Postgres
-- skips the insertion entirely for a row that fails the predicate, so a wild
-- animal's move never touches it. Same for `creature_by_keeper` and
-- `creature_in_traces`. Three of the six cost nothing, and the arithmetic
-- that said otherwise was simply wrong.
--
-- The other three all earn their keep, measured over the same ten rounds:
-- `creature_pkey` 1,212 scans, `creature_by_world` 998, `creature_at` 140.
-- Nothing here is dead weight. The write amplification is the price of the
-- reads, and the way to pay less of it is not to carry less index -- it is
-- to stop the dead rows piling up faster than they are collected.
--
-- ---- so: collect sooner, and leave room to write -------------------------
--
-- Postgres decides to vacuum a table when its dead rows exceed
-- `threshold + scale_factor * rows`. The stock scale factor is a fifth of
-- the table, which for a table turning over forty-five rows a second is
-- minutes of accumulation before anything is collected, and then a large
-- collection -- and in between, every scan reads the corpses. A twentieth,
-- with a floor under it, is the same total work in smaller and far more
-- frequent bites.
--
-- The cost delay is deliberately left alone. Turning it to zero makes
-- autovacuum run flat out, and on an instance that may already be throttled
-- on burst IO that is a way to make a slow evening into a stopped one. More
-- often, not more fiercely.
--
-- `fillfactor` is the other half. Reserving a slice of each page gives the
-- fourteen per cent that *can* be HOT somewhere to go, which is the one
-- lever that actually converts writes into cheap writes here. It applies to
-- pages written from here on, not to the ones already packed, so this gets
-- better over a day rather than at once.
--
-- And `caller`, which is the quietest expensive thing on the island: every
-- read goes through `too_fast`, and `too_fast` writes. One row per player,
-- upserted several times a second, forever, on a handful of pages. Its
-- columns are unindexed so its updates are HOT by rights -- but only while
-- the page has room, which at the stock fillfactor it very soon has not.
-- Seventy leaves it room to stay cheap.
--
-- No rule moves. Nothing here is visible from the game.

alter table creature set (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_vacuum_threshold = 200,
  autovacuum_analyze_scale_factor = 0.05,
  fillfactor = 85
);

alter table caller set (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_vacuum_threshold = 50,
  fillfactor = 70
);

select private.lock_doors();
