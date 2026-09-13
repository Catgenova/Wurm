/** Weighted loot tables shared by foraging players and foraging creatures. */
export const FORAGE_TABLE: Array<[string, number]> = [
  ['blueberry', 18],
  ['raspberry', 18],
  ['strawberry', 14],
  ['lingonberry', 14],
  ['acorn', 10],
  ['nuts', 10],
  ['potato', 6],
  ['onion', 6],
  // Seeds for the field.
  ['potato_seed', 5],
  ['onion_seed', 5],
  ['carrot_seed', 5],
  ['cabbage_seed', 4],
  ['wheat_seed', 4],
  ['corn_seed', 3],
];

export const BOTANIZE_TABLE: Array<[string, number]> = [
  ['sage', 15],
  ['basil', 15],
  ['thyme', 15],
  ['mint', 15],
  ['rosemary', 12],
  ['cotton_seed', 10],
  ['wemp_seed', 10],
  ['mixed_grass', 8],
  ['sage_seed', 6],
  ['basil_seed', 6],
  ['thyme_seed', 6],
  ['mint_seed', 6],
  ['rosemary_seed', 5],
];

export function rollTable(table: Array<[string, number]>, r: number): string {
  const total = table.reduce((s, e) => s + e[1], 0);
  let acc = r * total;
  for (const [id, wgt] of table) {
    acc -= wgt;
    if (acc <= 0) return id;
  }
  return table[table.length - 1][0];
}
