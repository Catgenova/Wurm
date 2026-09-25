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
      global: { fetch: watchedFetch },
    });
  }
  return client;
}

/**
 * Whether the island is taking changes at all.
 *
 * On 09-25 its database filled and went read-only, and every door that
 * writes answered "cannot execute UPDATE in a read-only transaction": one
 * line in the log for every step and every click, in the database's words,
 * and nothing to say that it was the island and not the player. Postgres says
 * that with SQLSTATE 25006 whichever door it is, so it is watched for here,
 * once, on the way back from every call, rather than at each of the fifty
 * places that make one.
 *
 * It clears when a door that was refused for it answers again, which is the
 * only sign that writing works: a door that only reads is let through
 * read-only and would say nothing either way.
 */
export const READ_ONLY = '25006';

/** The line under the banner, and in the log when an action is refused for it. */
export const CANNOT_SAVE = "The island can't save right now. Until it can, nothing you do is kept.";

const refused = new Set<string>();
const savingWatchers = new Set<(saving: boolean) => void>();

/** Be told when the island stops taking changes and when it starts again. */
export function onSaving(watch: (saving: boolean) => void): () => void {
  savingWatchers.add(watch);
  return () => savingWatchers.delete(watch);
}

/** Exported for supabase/test/saving.ts, which asks it with a stand-in `fetch`. */
export async function watchedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const door = /\/rest\/v1\/rpc\/([\w]+)/.exec(url)?.[1];
  if (!door) return res;
  if (res.ok) {
    if (refused.has(door)) {
      refused.clear();
      for (const watch of savingWatchers) watch(true);
    }
  } else {
    const body = (await res.clone().json().catch(() => null)) as { code?: string } | null;
    if (body?.code === READ_ONLY) {
      const was = refused.size;
      refused.add(door);
      if (was === 0) for (const watch of savingWatchers) watch(false);
    }
  }
  return res;
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
