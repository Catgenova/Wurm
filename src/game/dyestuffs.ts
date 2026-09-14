/**
 * The dyestuffs themselves, and nothing else.
 *
 * This is data with no imports, so anything may read it — the item names, the
 * sprites, the actions — without anything importing anything back.
 */

export interface DyeDef {
  id: string;
  /** The dyestuff, as a dyer would call it. */
  name: string;
  /** The colour it makes, as an adjective on the thing dyed. */
  word: string;
  /** What it actually looks like. */
  colour: string;
  /** A second, darker shade for the folds and the shadowed side. */
  shade: string;
  /** What is boiled for it, and how much. */
  from: string;
  count: number;
  difficulty: number;
  note: string;
}

const dye = (id: string, name: string, word: string, colour: string, shade: string, from: string, count: number, difficulty: number, note: string): DyeDef =>
  ({ id, name, word, colour, shade, from, count, difficulty, note });

export const DYES: DyeDef[] = [
  dye('woad', 'Woad', 'blue', '#3d5f9c', '#2a4270', 'blueberry', 8, 14, 'Boiled out of blueberries and struck with lye. It comes up green and turns blue in the air.'),
  dye('madder', 'Madder', 'red', '#a63f36', '#75281f', 'raspberry', 8, 12, 'A warm red out of raspberries. The commonest dye there is, and the one that fades least.'),
  dye('scarlet', 'Scarlet', 'scarlet', '#c8452f', '#8e2a1a', 'strawberry', 10, 22, 'Strawberries boiled down hard. A shouting red that costs twice what it looks like it should.'),
  dye('cochineal', 'Cochineal', 'crimson', '#8e2f4a', '#611d31', 'lingonberry', 10, 20, 'Lingonberries, a long boil and a great deal of patience. It goes on crimson and stays crimson.'),
  dye('gall', 'Oak gall', 'black', '#2b2a28', '#161514', 'acorn', 10, 18, 'Acorns and galls steeped until the water goes black. What every scribe and every mourner uses.'),
  dye('weld', 'Weld', 'yellow', '#c9a83c', '#96792a', 'sage', 8, 16, 'Sage boiled for the yellow in it. Bright, and the base of every green.'),
  dye('verdigris', 'Verdigris', 'green', '#4b7a4a', '#325232', 'mint', 8, 18, 'Mint over copper. A deep leaf green, and the hardest of them to get even.'),
  dye('umber', 'Umber', 'brown', '#6b4b2e', '#4a3320', 'nuts', 8, 10, 'Nut husks, boiled. The dye a beginner starts on, because it is very hard to get wrong.'),
];

export const DYE_BY_ID = new Map(DYES.map((d) => [d.id, d]));
export const DYE_BY_NAME = new Map(DYES.map((d) => [d.name, d]));
/** The dye on an item or a placed piece, if it has taken one. */
export const dyeOf = (thing: { dye?: string } | null | undefined): DyeDef | null =>
  (thing?.dye ? DYE_BY_ID.get(thing.dye) ?? null : null);
/** The adjective a dyed thing is called by: "blue", "scarlet". */
export const dyeWord = (id: string | undefined): string | null => (id ? DYE_BY_ID.get(id)?.word ?? null : null);
