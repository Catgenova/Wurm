/*
 * Mosaic is called stained glass now, and its tiles stained glass panes. The
 * snapshot before this one gave the rulebook the new names; what players
 * made, laid, ordered or counted under the old ones is carried over here, so
 * nothing they own points at a name the island no longer knows.
 */
set local lock_timeout = '3s';

update item set def = 'stained_glass_pane' where def = 'mosaic_tile';
update away_tally set def = 'stained_glass_pane' where def = 'mosaic_tile';
update buy_order set def = 'stained_glass_pane' where def = 'mosaic_tile';
update player set ledger = (ledger - 'mosaic_tile') || jsonb_build_object('stained_glass_pane', ledger -> 'mosaic_tile')
 where ledger ? 'mosaic_tile';

update wall set material = 'stained_glass' where material = 'mosaic';
update floor_tile set material = 'stained_glass' where material = 'mosaic';
update building_column set material = 'stained_glass' where material = 'mosaic';

-- What a piece under way still wants, and what it cost in all, are kept by item.
update wall set needed = (needed - 'mosaic_tile') || jsonb_build_object('stained_glass_pane', needed -> 'mosaic_tile') where needed ? 'mosaic_tile';
update wall set total = (total - 'mosaic_tile') || jsonb_build_object('stained_glass_pane', total -> 'mosaic_tile') where total ? 'mosaic_tile';
update floor_tile set needed = (needed - 'mosaic_tile') || jsonb_build_object('stained_glass_pane', needed -> 'mosaic_tile') where needed ? 'mosaic_tile';
update floor_tile set total = (total - 'mosaic_tile') || jsonb_build_object('stained_glass_pane', total -> 'mosaic_tile') where total ? 'mosaic_tile';
update building_column set needed = (needed - 'mosaic_tile') || jsonb_build_object('stained_glass_pane', needed -> 'mosaic_tile') where needed ? 'mosaic_tile';
update building_column set total = (total - 'mosaic_tile') || jsonb_build_object('stained_glass_pane', total -> 'mosaic_tile') where total ? 'mosaic_tile';

select private.lock_doors();
