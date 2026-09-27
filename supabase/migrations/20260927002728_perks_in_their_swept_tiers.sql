/*
 * The Terraformer's perks, set out in the tiers swept for them.
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
     where pn.node = any(array['terraformer_quick_level', 'terraformer_bed_worker', 'terraformer_quick_paver', 'terraformer_level_hand', 'terraformer_stump_puller', 'terraformer_steep_cut', 'terraformer_bed_true', 'terraformer_soil_porter', 'terraformer_road_legs', 'terraformer_frugal_cobbler', 'terraformer_strong_back', 'terraformer_long_reach', 'terraformer_dig_out_the_tile', 'terraformer_clean_earth', 'terraformer_rare_earth', 'terraformer_treasure_nose']::text[])
     group by pn.world_id, pn.uid
  loop
    delete from player_node where world_id = r.world_id and uid = r.uid and node = any(array['terraformer_quick_level', 'terraformer_bed_worker', 'terraformer_quick_paver', 'terraformer_level_hand', 'terraformer_stump_puller', 'terraformer_steep_cut', 'terraformer_bed_true', 'terraformer_soil_porter', 'terraformer_road_legs', 'terraformer_frugal_cobbler', 'terraformer_strong_back', 'terraformer_long_reach', 'terraformer_dig_out_the_tile', 'terraformer_clean_earth', 'terraformer_rare_earth', 'terraformer_treasure_nose']::text[]);
    perform class_fold(r.world_id, r.uid);
    perform tell(r.world_id, r.uid, 'The Terraformer’s perks are set out in new tiers, and ' || r.names
      || case when r.n > 1 then ' moved to others. They are cleared' else ' moved to another. It is cleared' end
      || ', and yours to choose again in the Trades window.', 'system');
  end loop;
end $$;

select private.lock_doors();
