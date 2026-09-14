/**
 * Where there is still something to pick.
 *
 * Ground that can be foraged or botanized used to say so with tufts of grass:
 * berries among them for one, flowers for the other. They were models standing
 * on the tile, and there were hundreds of them on a screen, so the ground read
 * as a carpet of flowers with the trees and rocks lost in it.
 *
 * The same thing is said here with colour instead of with objects: a soft
 * patch laid in the middle of the tile, warm where there is something to eat
 * and cool where there is something to cure with. It is inset from the tile's
 * edges so it reads as a patch of ground rather than as a coloured tile, and
 * so it does not put the hard tile borders back that blending the seams
 * between grounds took away.
 */

/**
 * The tint by what the tile still holds: bit 0 for forage, bit 1 for botany.
 * Nothing left is nothing drawn, which is the cheapest case and the common one
 * on ground you have just been over.
 */
export const FORAGE_TINT: ReadonlyArray<string | null> = [
  null,
  'rgba(255, 196, 88, 0.17)',
  'rgba(202, 142, 240, 0.17)',
  // Ground carrying both is the richest there is, and says so loudest.
  'rgba(250, 172, 140, 0.25)',
];

/** How much of the tile the patch covers, corner to corner. */
export const TINT_SPAN = 0.62;
