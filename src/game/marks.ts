/**
 * Marks on the map.
 *
 * An island is a million tiles and the good clay is on one of them. A mark is
 * a name pinned to a spot, dropped where you stand or anywhere on the map, and
 * one click walks you back to it.
 */
export interface Marker {
  id: number;
  name: string;
  x: number;
  y: number;
  /** Which of the colours below it is drawn in. */
  colour: string;
  /**
   * The grave this mark stands on, by its id, when it is one of yours: the
   * mark is put there when the grave is dug and comes off when it goes.
   */
  grave?: number;
}

/** The colours a mark can be drawn in, and what each is usually for. */
export const MARK_COLOURS: Array<{ id: string; name: string; css: string; note: string }> = [
  { id: 'amber', name: 'Amber', css: '#ffc95c', note: 'anything worth coming back to' },
  { id: 'green', name: 'Green', css: '#7ad46a', note: 'a field, an orchard, a wood' },
  { id: 'blue', name: 'Blue', css: '#6fb4ef', note: 'water, a fishing spot, a landing' },
  { id: 'red', name: 'Red', css: '#e8695a', note: 'something that will kill you' },
  { id: 'grey', name: 'Stone', css: '#c9c1ad', note: 'ore, rock, clay' },
  { id: 'violet', name: 'Violet', css: '#b48ce0', note: 'an altar, a rug, a quiet place' },
];

export const MARK_CSS = (id: string): string => MARK_COLOURS.find((c) => c.id === id)?.css ?? MARK_COLOURS[0].css;

/** The most marks the map will hold; past this the oldest is pushed off. */
export const MARK_CAP = 64;

/** The name a mark gets when you cannot be bothered to give it one. */
export const markName = (name: string, x: number, y: number): string => name.trim() || `Mark at ${x}, ${y}`;
