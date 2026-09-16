/**
 * Emotes: a wave and a hop, and nothing that anybody's rules read.
 *
 * These are *drawing* messages, in exactly the sense the body broadcast is one
 * — "nobody's client can make anybody else's position true, and the island
 * keeps the truth on the row below". An emote has no truth to keep. Nothing on
 * the island is decided by whether somebody waved, so nothing on the island
 * needs to know: it goes over Broadcast, it is drawn, and it is gone. No
 * column, no migration, no row anybody could be caught lying about.
 *
 * That is also why the list is here rather than crossed into a def table. A
 * def table exists so that two sides cannot disagree about a rule. There is no
 * rule.
 */

export interface EmoteDef {
  id: string;
  /** What the menu calls it. */
  label: string;
  /** What the log says, with `{name}` for whoever did it. */
  said: string;
  /** How long it runs, in seconds. */
  seconds: number;
}

export const EMOTES: EmoteDef[] = [
  { id: 'wave', label: 'Wave', said: '{name} waves.', seconds: 1.9 },
  { id: 'hop', label: 'Hop', said: '{name} hops on the spot.', seconds: 1.2 },
];

export const EMOTE_BY_ID = new Map(EMOTES.map((e) => [e.id, e]));

/** The longest any of them runs, which is how long a peer's is kept. */
export const EMOTE_LONGEST = Math.max(...EMOTES.map((e) => e.seconds));

/**
 * What an emote does to a body, part way through.
 *
 * `t` runs 0 to 1 over the emote's own length. Two numbers come back and the
 * figure reads both: `lift` raises the whole body off its shadow — which stays
 * where it is, because a shadow is the ground and the ground does not hop —
 * and `wave` swings the near arm, above the shoulder rather than beside it.
 *
 * Eased at both ends. A hop that starts at full speed and stops dead is a
 * figure being teleported twice, and the difference between that and a jump is
 * entirely in the half-second at each end.
 */
export function emotePose(id: string, t: number): { lift: number; wave: number } {
  const k = Math.max(0, Math.min(1, t));
  if (id === 'hop') {
    // Two hops, the second smaller, because one is a twitch and three is a dance.
    const arc = Math.abs(Math.sin(k * Math.PI * 2));
    return { lift: arc * 7 * (1 - k * 0.45), wave: 0 };
  }
  if (id === 'wave') {
    // Up, three swings, down: the arm rises over the first fifth and drops
    // over the last, so it is never snapped into place or out of it.
    const up = Math.min(1, k / 0.2, (1 - k) / 0.2);
    return { lift: 0, wave: Math.max(0, up) * Math.sin(k * Math.PI * 6) };
  }
  return { lift: 0, wave: 0 };
}

/** How far through an emote started at `at`, or null once it is over. */
export function emoteAt(id: string | undefined, at: number | undefined, now: number): number | null {
  if (!id || at === undefined) return null;
  const def = EMOTE_BY_ID.get(id);
  if (!def) return null;
  const t = (now - at) / def.seconds;
  return t >= 0 && t <= 1 ? t : null;
}
