import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Which island keeper to talk to.
 *
 * The publishable key is meant to be public — it identifies the project and
 * nothing else, and every door it can reach is guarded by row level security
 * and by the rules in `supabase/migrations`. A client holding it can read the
 * island and call eight functions, all of which check who is asking and what
 * they are asking for. It is the `service_role` key that must never be near a
 * static site, and it is not here.
 */
export const PROJECT = {
  url: 'https://glebtboagnafcgwjjvfy.supabase.co',
  key: 'sb_publishable_10_lQyHkKqBQ9F6rYuJehw_9rNaCtz3',
} as const;

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!client) {
    client = createClient(PROJECT.url, PROJECT.key, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'wurm.auth' },
      // Twice a second is plenty for other people's bodies and far more than
      // the ground needs; the default of ten is a lot of wake-ups for nothing.
      realtime: { params: { eventsPerSecond: 5 } },
    });
  }
  return client;
}

/**
 * Who this browser is, as far as the island is concerned.
 *
 * Anonymous, and durable: Supabase hands out a real account with a real
 * `auth.uid()` and no sign-up screen, and the session is kept in local storage
 * so tomorrow's visit is the same person as today's. It is the durable `who`
 * the old host-and-guest code kept on the client, except that this one the
 * database can check rather than take on trust — which is the whole reason row
 * level security has anything to stand on.
 */
export async function signIn(): Promise<string> {
  const sb = supabase();
  const had = await sb.auth.getSession();
  if (had.data.session?.user?.id) return had.data.session.user.id;
  const { data, error } = await sb.auth.signInAnonymously();
  if (error || !data.user) throw new Error(`Could not reach the island keeper: ${error?.message ?? 'no account'}`);
  return data.user.id;
}
