/**
 * What keeping a body alive costs, in one place.
 *
 * These were six numbers written into the middle of `Game.update`, which was
 * fine while the browser was the only thing that had a body to keep. On an
 * island it is not: the island owns the player, and it owned everything about
 * them *except* this — so nothing over there ever got hungry, thirsty, tired
 * or better, and `stats` sat at the full mark it was created with for ever.
 *
 * What that looked like was reported exactly: "thirst and hunger reset to full
 * on every client reset". They did. The bars fell all session because this
 * machine was moving its own copy, and a refresh read the island's, which had
 * never moved.
 *
 * So they live here and are generated into Postgres like every other number,
 * and the island works them forward off a timestamp the way it does a fire —
 * because there is nowhere in Supabase to put a loop, and a body that only
 * gets hungry while somebody is watching is not a body.
 */

/**
 * Hunger and thirst, per real second. Empty from full in five and a half
 * hours, and in three and three quarters.
 *
 * They were forty-two minutes and twenty-eight, which is a faithful port of
 * numbers written for a browser tab somebody opened for ten minutes at a
 * time. On an island a session is an afternoon, and at that rate a body went
 * from full to empty inside one — so eating and drinking stopped being
 * something you saw to and became the thing you were doing.
 *
 * Eight times slower, both of them, so thirst still runs ahead of hunger by
 * the half it always did. Long enough that a good session costs you half a
 * stomach and you drink once in it, rather than tending a pair of bars.
 */
export const HUNGER_RATE = 0.00005;
export const THIRST_RATE = 0.000075;

/** Wind coming back: standing still, and on the move. */
export const WIND_REST = 0.05;
export const WIND_WALK = 0.012;

/** What a point of body stamina above the starting mark adds to that. */
export const WIND_PER_LEVEL = 0.005;

/** An empty stomach or a dry throat gets its wind back at this share of the rate. */
export const WIND_STARVING = 0.3;

/** Knitting back together, per second, and what has to be true for it to happen. */
export const HEAL_RATE = 0.004;
export const HEAL_FED = 0.2;

/** Swimming costs wind, and drowning costs blood. */
export const SWIM_WIND = 0.03;
export const DROWN_RATE = 0.05;

/** Below this you are too far gone to start anything. */
export const EXHAUSTED = 0.08;
