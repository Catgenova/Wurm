/**
 * Which island keeper to talk to.
 *
 * The publishable key is meant to be public — it identifies the project and
 * nothing else, and every door it can reach is guarded by row level security
 * and by the rules in `supabase/migrations`. A client holding it can read the
 * island and call four functions, all of which check who is asking. It is the
 * `service_role` key that must never be near a static site, and it is not here.
 */
export const PROJECT = {
  url: 'https://glebtboagnafcgwjjvfy.supabase.co',
  key: 'sb_publishable_10_lQyHkKqBQ9F6rYuJehw_9rNaCtz3',
} as const;

/** Where the four doors are. */
export const RPC = {
  join: 'rpc_join',
  move: 'rpc_move',
  act: 'rpc_act',
  sweep: 'rpc_sweep',
} as const;
