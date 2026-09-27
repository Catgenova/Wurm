/*
 * The Miner's perks, set out in the tiers swept for them.
 *
 * The definitions before this one put the perks in the tiers they were swept
 * into, one trade at a time. A perk somebody had taken is kept only where it
 * still is: whoever holds one that moved has it cleared, is told which, and
 * may choose again at its new tier, so that nobody keeps two from one tier.
 * Their folds are written again.
 */
set local lock_timeout = '3s';

do $$
declare r record;
begin
  for r in
    select pn.world_id, pn.uid, string_agg(k.name, ' and ' order by k.tier, k.num) as names, count(*) as n
      from player_node pn join class_perk k on k.id = pn.node
     where pn.node = any(array['miner_ore_sense', 'miner_coal_hand', 'miner_chipper', 'miner_rock_slide', 'miner_wet_work', 'miner_far_reader', 'miner_quick_pick', 'miner_rich_seam', 'miner_keen_trowel', 'miner_sure_swing', 'miner_pieces_that_fit', 'miner_ore_cart', 'miner_face_shaper', 'miner_gem_eye', 'miner_bauble_hunter', 'miner_rare_ore', 'miner_treasure_in_the_rock']::text[])
     group by pn.world_id, pn.uid
  loop
    delete from player_node where world_id = r.world_id and uid = r.uid and node = any(array['miner_ore_sense', 'miner_coal_hand', 'miner_chipper', 'miner_rock_slide', 'miner_wet_work', 'miner_far_reader', 'miner_quick_pick', 'miner_rich_seam', 'miner_keen_trowel', 'miner_sure_swing', 'miner_pieces_that_fit', 'miner_ore_cart', 'miner_face_shaper', 'miner_gem_eye', 'miner_bauble_hunter', 'miner_rare_ore', 'miner_treasure_in_the_rock']::text[]);
    perform class_fold(r.world_id, r.uid);
    perform tell(r.world_id, r.uid, 'The Miner’s perks are set out in new tiers, and ' || r.names
      || case when r.n > 1 then ' moved to others. They are cleared' else ' moved to another. It is cleared' end
      || ', and yours to choose again in the Trades window.', 'system');
  end loop;
end $$;

select private.lock_doors();
