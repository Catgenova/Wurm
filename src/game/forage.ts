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
];

export const BOTANIZE_TABLE: Array<[string, number]> = [
  ['sage', 15],
  ['basil', 15],
  ['thyme', 15],
  ['mint', 15],
  ['rosemary', 12],
  ['cotton_seeds', 10],
  ['wemp_seeds', 10],
  ['mixed_grass', 8],
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
