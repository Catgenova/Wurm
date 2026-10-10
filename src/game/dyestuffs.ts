/**
 * Dye, as a liquid, and nothing else.
 *
 * This is data and arithmetic with no imports, so anything may read it — the
 * item names, the sprites, the actions, the save loader — without anything
 * importing anything back. The island has every function here twice over in
 * SQL (`dye_rgb`, `dye_word`, `dye_mix`, `dye_says` …) and `supabase/test/dyes.ts`
 * holds the two against each other.
 *
 * ## What a dye is
 *
 * A **mix of the three primaries**, red, yellow and blue, as parts out of
 * `DYE_PARTS` that always add up to it, and a **QL**. Boiling a dyestuff gives
 * one primary pure; everything else is made by pouring one dye into another,
 * which averages both the parts and the QL by the litres of each.
 *
 * ## What colour it is
 *
 * The mix is scaled so its strongest primary is full and looked up in the
 * RYB colour cube (Gossett and Chen, 2004) by trilinear interpolation, so that
 * red and blue make purple and all three make brown as paint does, rather than
 * the grey that light makes. The QL then decides the brightness alone: black at
 * QL 1, the mix itself at QL 50 and white at QL 100, in a straight line on each
 * side.
 *
 * ## How it is written down
 *
 * In the one `dye` text a thing already has. A thing dyed carries the colour
 * it took, `#rrggbb`. A vessel of dye — a bucket, a barrel — carries the dye
 * itself: `r600y0b400q4125`, the parts of each primary and the QL in
 * hundredths, and on a bucket the litres after it, `l3`. Every number in it
 * is a whole number, so both sides read and write it the same to the last
 * digit.
 */

export type Primary = 'red' | 'yellow' | 'blue';
export const PRIMARIES: readonly Primary[] = ['red', 'yellow', 'blue'];

/** The parts a dye's three primaries are counted out of. */
export const DYE_PARTS = 1000;

export interface DyeLiquid {
  red: number;
  yellow: number;
  blue: number;
  /** 1 to 100, to the hundredth. */
  ql: number;
}

/** The QL a dye is black at, the QL it is the mix itself at, and the QL it is white at. */
export const DYE_QL_BLACK = 1;
export const DYE_QL_PURE = 50;
export const DYE_QL_WHITE = 100;

/** Litres of dye a boil leaves in the bucket of lye it was boiled in. */
export const DYE_BOIL_LITRES = 3;

/**
 * Litres a dyeing takes, by the size of the thing. A wall is one side of one
 * wall and a floor one tile of it.
 */
export const DYE_LITRES = { garment: 1, banner: 2, sail: 3, ship: 5, wall: 1, floor: 1 } as const;
export type DyeSize = keyof typeof DYE_LITRES;
/** The things that are not a garment, by size. Every piece of cloth or leather armour is a garment. */
export const DYE_SIZE_OF: Record<string, DyeSize> = {
  cloth: 'garment', sack: 'garment', satchel: 'garment', backpack: 'garment', saddle: 'garment', bridle: 'garment',
  banner: 'banner', flagpole: 'banner', sailing_boat: 'sail', caravel: 'ship',
};
/** Litres it takes to dye one of these. */
export const dyeLitresFor = (id: string): number => DYE_LITRES[DYE_SIZE_OF[id] ?? 'garment'];

/** What is boiled for a primary: the dyestuff, how much of it, and how hard the boil is. */
export interface Dyestuff {
  from: string;
  primary: Primary;
  count: number;
  difficulty: number;
}

const stuff = (from: string, primary: Primary, count: number, difficulty: number): Dyestuff => ({ from, primary, count, difficulty });

/** Every dyestuff on the island, by primary. Nothing else boils into dye. */
export const DYESTUFFS: Dyestuff[] = [
  stuff('raspberry', 'red', 8, 12),
  stuff('strawberry', 'red', 10, 22),
  stuff('lingonberry', 'red', 10, 20),
  stuff('rose_petals', 'red', 8, 15),
  stuff('lotus_flower', 'red', 8, 18),
  stuff('sage', 'yellow', 8, 16),
  stuff('wildflowers', 'yellow', 8, 12),
  stuff('blueberry', 'blue', 8, 14),
  stuff('lavender', 'blue', 8, 16),
];
export const DYESTUFF_OF = new Map(DYESTUFFS.map((d) => [d.from, d]));
/** The recipe that boils a dyestuff. */
export const dyeRecipeId = (from: string): string => `make_dye_${from}`;

/* ---- the liquid --------------------------------------------------------- */

/** A QL kept to the hundredth, between 1 and 100. */
export const dyeQl = (ql: number): number => Math.floor(Math.max(DYE_QL_BLACK, Math.min(DYE_QL_WHITE, ql)) * 100 + 0.5) / 100;

export const pureDye = (p: Primary, ql: number): DyeLiquid =>
  ({ red: p === 'red' ? DYE_PARTS : 0, yellow: p === 'yellow' ? DYE_PARTS : 0, blue: p === 'blue' ? DYE_PARTS : 0, ql: dyeQl(ql) });

/**
 * Two dyes poured together: the parts and the QL each the average of the
 * two, by litres. Red and yellow are rounded to the part; blue is what is
 * left, so the three always add up.
 */
export function mixDye(a: DyeLiquid, la: number, b: DyeLiquid, lb: number): DyeLiquid {
  if (la <= 0) return { ...b };
  if (lb <= 0) return { ...a };
  const all = la + lb;
  const red = Math.floor((a.red * la + b.red * lb) / all + 0.5);
  const yellow = Math.floor((a.yellow * la + b.yellow * lb) / all + 0.5);
  return { red, yellow, blue: DYE_PARTS - red - yellow, ql: dyeQl((a.ql * la + b.ql * lb) / all) };
}

/** A dye written down: `r600y0b400q4125`, and `l3` after it for the litres in a bucket. */
export const dyeText = (l: DyeLiquid, litres?: number): string =>
  `r${l.red}y${l.yellow}b${l.blue}q${Math.floor(l.ql * 100 + 0.5)}${litres !== undefined ? `l${litres}` : ''}`;

const DYE_TEXT = /^r(\d+)y(\d+)b(\d+)q(\d+)(?:l(\d+))?$/;
/** A dye read back, with the litres written on it (nought where there are none); null if it is not one. */
export function readDye(text: string | null | undefined): { liquid: DyeLiquid; litres: number } | null {
  const m = text ? DYE_TEXT.exec(text) : null;
  if (!m) return null;
  return { liquid: { red: Number(m[1]), yellow: Number(m[2]), blue: Number(m[3]), ql: Number(m[4]) / 100 }, litres: m[5] ? Number(m[5]) : 0 };
}
export const isDyeText = (text: string | null | undefined): boolean => !!text && DYE_TEXT.test(text);

/** The one thing in a pack that carries dye: a bucket of it. */
export const DYE_BUCKET = 'dye_bucket';
/** The dye in a bucket of it, and how many litres. */
export const dyeIn = (item: { id: string; dye?: string | null } | null | undefined): { liquid: DyeLiquid; litres: number } | null =>
  (item?.id === DYE_BUCKET ? readDye(item.dye) : null);

/* ---- its colour ----------------------------------------------------------- */

/**
 * The RYB cube's corners as red, green and blue, in the order white, red,
 * yellow, orange (red and yellow), blue, purple (red and blue), green (yellow
 * and blue) and black (all three): Gossett and Chen's.
 */
export const RYB_CUBE: readonly number[] = [
  1, 1, 1,
  1, 0, 0,
  1, 1, 0,
  1, 0.5, 0,
  0.163, 0.373, 0.6,
  0.5, 0, 0.5,
  0, 0.66, 0.2,
  0.2, 0.094, 0,
];

/** One channel of the cube at (x, y, z), each 0 to 1: trilinear between its eight corners. */
function cube(c: number, x: number, y: number, z: number): number {
  const k = (i: number): number => RYB_CUBE[i * 3 + c];
  const c00 = k(0) * (1 - x) + k(1) * x;
  const c10 = k(2) * (1 - x) + k(3) * x;
  const c01 = k(4) * (1 - x) + k(5) * x;
  const c11 = k(6) * (1 - x) + k(7) * x;
  const c0 = c00 * (1 - y) + c10 * y;
  const c1 = c01 * (1 - y) + c11 * y;
  return c0 * (1 - z) + c1 * z;
}

/** A dye's colour as red, green and blue, 0 to 255. */
export function dyeRgb(l: DyeLiquid): [number, number, number] {
  const most = Math.max(l.red, l.yellow, l.blue, 1);
  const x = l.red / most, y = l.yellow / most, z = l.blue / most;
  const ql = Math.max(DYE_QL_BLACK, Math.min(DYE_QL_WHITE, l.ql));
  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const pure = cube(c, x, y, z);
    // Black at 1, the mix at 50, white at 100.
    const v = ql <= DYE_QL_PURE ? pure * ((ql - DYE_QL_BLACK) / (DYE_QL_PURE - DYE_QL_BLACK))
      : pure + (1 - pure) * ((ql - DYE_QL_PURE) / (DYE_QL_WHITE - DYE_QL_PURE));
    out[c] = Math.floor(v * 255 + 0.5);
  }
  return out;
}

export const rgbHex = (rgb: readonly number[]): string => `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
export const hexRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
export const isHex = (s: string | null | undefined): s is string => !!s && /^#[0-9a-f]{6}$/.test(s);
/** A dye's colour, `#rrggbb`. */
export const dyeHex = (l: DyeLiquid): string => rgbHex(dyeRgb(l));

/**
 * The plain words a colour is called by, each at the colour it names. A dyed
 * thing is called by the nearest of them, and the hex is in its Examine.
 */
export const DYE_WORDS: ReadonlyArray<readonly [string, string]> = [
  ['black', '#141414'],
  ['grey', '#808080'],
  ['white', '#f2f2f2'],
  ['red', '#c83028'],
  ['crimson', '#8c2440'],
  ['pink', '#f2a0b0'],
  ['orange', '#e88038'],
  ['brown', '#6e4020'],
  ['dark brown', '#3a2210'],
  ['tan', '#c8a078'],
  ['ochre', '#c09030'],
  ['yellow', '#f0e020'],
  ['cream', '#f0e8b0'],
  ['olive', '#707020'],
  ['green', '#3a8a40'],
  ['pale green', '#90d8a0'],
  ['teal', '#208080'],
  ['blue', '#2a60b0'],
  ['navy', '#18285a'],
  ['sky blue', '#90b8e0'],
  ['indigo', '#4b2a96'],
  ['purple', '#702080'],
  ['dark purple', '#401040'],
  ['violet', '#a080d0'],
  ['magenta', '#c83090'],
];

/**
 * How far apart two colours look: the "redmean" weighting of the three
 * channels, squared, which needs no more than arithmetic and so comes out the
 * same on both sides.
 */
export function colourDistance(a: readonly number[], b: readonly number[]): number {
  const rm = (a[0] + b[0]) / 2;
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
}

/** The plain word for a colour: the nearest of `DYE_WORDS`, the first of them on a tie. */
export function colourWord(hex: string): string {
  const rgb = hexRgb(hex);
  let best = DYE_WORDS[0][0];
  let bestD = Infinity;
  for (const [word, at] of DYE_WORDS) {
    const d = colourDistance(rgb, hexRgb(at));
    if (d < bestD) {
      bestD = d;
      best = word;
    }
  }
  return best;
}

/** How much of its light the shaded side of dyed cloth keeps: the folds, the hems, the underside of a sail. */
export const DYE_SHADE = 0.7;
export const shadeOf = (hex: string): string => rgbHex(hexRgb(hex).map((v) => Math.floor(v * DYE_SHADE + 0.5)));

/** A colour a thing has been dyed: the lit side and the shaded one. */
export interface Tint {
  colour: string;
  shade: string;
}

/* ---- what is said of it ----------------------------------------------- */

/** Parts out of a thousand as a share: "60%", "33.3%". */
const partsSaid = (p: number): string => `${Math.floor(p / 10)}${p % 10 ? `.${p % 10}` : ''}%`;
/** A QL to the hundredth: "41.25", "7.00". */
const qlSaid = (ql: number): string => {
  const q = Math.floor(ql * 100 + 0.5);
  return `${Math.floor(q / 100)}.${String(q % 100).padStart(2, '0')}`;
};

/** What a dye is mixed of: "60% red and 40% blue", "100% yellow". */
export function sharesSaid(l: DyeLiquid): string {
  const parts = PRIMARIES.map((p) => [p, l[p]] as const).filter(([, n]) => n > 0).map(([p, n]) => `${partsSaid(n)} ${p}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : (parts[0] ?? 'nothing');
}

/** What Examine says of dye in anything that holds it. */
export const dyeSays = (l: DyeLiquid, litres: number): string =>
  `${litres} ${litres === 1 ? 'litre' : 'litres'} of ${colourWord(dyeHex(l))} dye, ${dyeHex(l)} at QL ${qlSaid(l.ql)}: ${sharesSaid(l)}.`;

/* ---- what the colour on a thing is -------------------------------------- */

/**
 * The dyes there were before dye was a liquid: what each was boiled from and
 * how, the word a thing dyed with it was called and its colour. Anything
 * dyed with one keeps that colour, and a pot of one left in a pack becomes
 * the nearest dye that can be mixed (`legacyLiquid`).
 */
export interface LegacyDye {
  id: string;
  name: string;
  word: string;
  colour: string;
  from: string;
  count: number;
  difficulty: number;
}
const old = (id: string, name: string, word: string, colour: string, from: string, count: number, difficulty: number): LegacyDye =>
  ({ id, name, word, colour, from, count, difficulty });
export const LEGACY_DYES: LegacyDye[] = [
  old('woad', 'Woad', 'blue', '#3d5f9c', 'blueberry', 8, 14),
  old('madder', 'Madder', 'red', '#a63f36', 'raspberry', 8, 12),
  old('scarlet', 'Scarlet', 'scarlet', '#c8452f', 'strawberry', 10, 22),
  old('cochineal', 'Cochineal', 'crimson', '#8e2f4a', 'lingonberry', 10, 20),
  old('gall', 'Oak gall', 'black', '#2b2a28', 'acorn', 10, 18),
  old('weld', 'Weld', 'yellow', '#c9a83c', 'sage', 8, 16),
  old('verdigris', 'Verdigris', 'green', '#4b7a4a', 'mint', 8, 18),
  old('umber', 'Umber', 'brown', '#6b4b2e', 'nuts', 8, 10),
  old('rose', 'Rose', 'pink', '#d6879f', 'rose_petals', 8, 15),
  old('lavender', 'Lavender', 'violet', '#8a6fbf', 'lavender', 8, 16),
  old('wildflowers', 'Wildflowers', 'orange', '#dc8c4a', 'wildflowers', 8, 12),
  old('lily', 'Lily', 'white', '#ece8de', 'water_lily', 8, 15),
  old('lotus', 'Lotus', 'magenta', '#c0508c', 'lotus_flower', 8, 18),
];
export const LEGACY_BY_ID = new Map(LEGACY_DYES.map((d) => [d.id, d]));
export const LEGACY_BY_NAME = new Map(LEGACY_DYES.map((d) => [d.name, d]));
/** How many pots a boil made, and what was boiled for them. */
export const LEGACY_POTS = 2;

/**
 * The dye that comes nearest an old one's colour: every mix in whole
 * percents and every whole QL, and the first of the nearest. Worked out once,
 * the first time it is asked; the island is handed the answers (`dye_legacy`).
 */
let legacy: Map<string, DyeLiquid> | null = null;
export function legacyLiquid(id: string): DyeLiquid | null {
  if (!legacy) {
    legacy = new Map();
    const targets = LEGACY_DYES.map((d) => ({ id: d.id, rgb: hexRgb(d.colour), best: Infinity, at: null as DyeLiquid | null }));
    for (let r = 0; r <= 100; r++) {
      for (let y = 0; y + r <= 100; y++) {
        const parts = { red: r * 10, yellow: y * 10, blue: DYE_PARTS - r * 10 - y * 10 };
        for (let q = 1; q <= 100; q++) {
          const l = { ...parts, ql: q };
          const rgb = dyeRgb(l);
          for (const t of targets) {
            const d = colourDistance(rgb, t.rgb);
            if (d < t.best) {
              t.best = d;
              t.at = l;
            }
          }
        }
      }
    }
    for (const t of targets) if (t.at) legacy.set(t.id, t.at);
  }
  return legacy.get(id) ?? null;
}

/** The colour on a thing as `#rrggbb`, whichever way it was written: a colour, a dye, or the id of an old dye. */
export function dyeHexOf(dye: string | null | undefined): string | null {
  if (!dye) return null;
  if (isHex(dye)) return dye;
  const l = readDye(dye);
  if (l) return dyeHex(l.liquid);
  return LEGACY_BY_ID.get(dye)?.colour ?? null;
}

/** The colour a thing or a piece has been dyed, lit and shaded, if it has taken one. */
export function dyeTint(dye: string | null | undefined): Tint | null {
  const colour = dyeHexOf(dye);
  return colour ? { colour, shade: shadeOf(colour) } : null;
}
export const dyeOf = (thing: { dye?: string | null } | null | undefined): Tint | null => dyeTint(thing?.dye);
/** The plain word a dyed thing is called by: "blue", "olive". */
export const dyeWord = (dye: string | null | undefined): string | null => {
  const hex = dyeHexOf(dye);
  return hex ? colourWord(hex) : null;
};

/* ---- a save from before dye was mixed ------------------------------------ */

type Loose = Record<string, unknown>;
const isObj = (v: unknown): v is Loose => !!v && typeof v === 'object' && !Array.isArray(v);
/** An item as a save writes it: a number, a kind and a count. */
const isItemLike = (v: unknown): v is Loose & { uid: number; id: string; count: number } =>
  isObj(v) && typeof v.uid === 'number' && typeof v.id === 'string' && typeof v.count === 'number';

/** The dye an old pot becomes, by the name written on it (`extra`). */
export const potLiquid = (extra: string | null | undefined): DyeLiquid => {
  const was = LEGACY_BY_NAME.get(String(extra ?? '')) ?? LEGACY_BY_ID.get(String(extra ?? '').toLowerCase()) ?? LEGACY_DYES[0];
  return legacyLiquid(was.id) ?? pureDye('red', DYE_QL_PURE);
};

/**
 * Everything in a save from before dye was mixed, brought up to now, in place.
 *
 * A thing dyed with one of the old dyes keeps its colour: every `dye` that is
 * an old dye's id becomes that dye's `#rrggbb`, on items, pieces, walls,
 * floors and anything else that carries one. A pot of old dye becomes
 * `DYE_LITRES.garment` litres -- one dyeing of a garment, which is what a pot
 * did -- of the dye nearest its colour (`legacyLiquid`), poured into buckets of
 * dye `bucket` litres at a time: the first takes the pot's place and number,
 * any more come after it with numbers off the save's well. Nothing is lost.
 * The island does the same in its migration.
 */
export function upgradeDyes(data: Loose, bucket: number): void {
  let most = 0;
  const count = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(count);
    else if (isObj(v)) {
      if (isItemLike(v)) most = Math.max(most, v.uid);
      Object.values(v).forEach(count);
    }
  };
  count(data);
  const well = typeof data.nextUid === 'number' ? data.nextUid : 1;
  let next = Math.max(well, most + 1);
  const potInto = (pot: Loose & { uid: number; count: number }): Loose[] => {
    const liquid = potLiquid(typeof pot.extra === 'string' ? pot.extra : null);
    let left = Math.max(1, pot.count) * DYE_LITRES.garment;
    const out: Loose[] = [];
    while (left > 0) {
      const litres = Math.min(bucket, left);
      left -= litres;
      const one: Loose = { ...pot, id: DYE_BUCKET, count: 1, dye: dyeText(liquid, litres) };
      delete one.extra;
      if (out.length) one.uid = next++;
      out.push(one);
    }
    return out;
  };
  let grew = false;
  const fix = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        const x = v[i];
        if (isItemLike(x) && x.id === 'dye') {
          const into = potInto(x);
          if (into.length > 1) grew = true;
          v.splice(i, 1, ...into);
          i += into.length - 1;
        } else fix(x);
      }
    } else if (isObj(v)) {
      for (const [k, x] of Object.entries(v)) {
        if (k === 'dye' && typeof x === 'string' && LEGACY_BY_ID.has(x)) v[k] = LEGACY_BY_ID.get(x)?.colour;
        // A pot held on its own, not in a list: one bucket, of what one pot was.
        else if (isItemLike(x) && x.id === 'dye') v[k] = potInto({ ...x, count: 1 })[0];
        else fix(x);
      }
    }
  };
  fix(data);
  if (grew) data.nextUid = next;
}
