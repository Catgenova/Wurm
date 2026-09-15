/**
 * What somebody looks like, and the only place that decides it.
 *
 * This is data with no imports, so anything may read it — the sprites, the
 * landing page, the definition dump that puts it in Postgres — without
 * anything importing anything back.
 *
 * ## Ids rather than colours
 *
 * A look is seven and eight short strings, every one of them an id out of a
 * table in this file. Nothing a person types ever reaches a canvas, which
 * matters more than it looks: a `look` travels from a stranger's browser
 * through the database and into `ctx.fillStyle` on everybody else's machine,
 * and a free-text colour there is a hole with a view of the whole island.
 * Ids close it by construction — an id that is not in the table is not a
 * colour, it is a default.
 *
 * Ids rather than indices for the same reason a migration is not renamed:
 * these tables will gain entries, and a look stored as `hair: 7` would quietly
 * become a different haircut the day somebody inserts one in the middle.
 */

export type Gender = 'woman' | 'man' | 'neither';

export interface Look {
  gender: Gender;
  /** Ids into SKINS, HAIRSTYLES, HAIR_COLOURS, EYES, BEARDS and CLOTH. */
  skin: string;
  hair: string;
  hairColour: string;
  eyes: string;
  beard: string;
  shirt: string;
  trousers: string;
}

export interface Swatch {
  id: string;
  name: string;
  colour: string;
}

const s = (id: string, name: string, colour: string): Swatch => ({ id, name, colour });

/** Skin, pale to deep. A ramp rather than a set of types. */
export const SKINS: Swatch[] = [
  s('porcelain', 'Porcelain', '#f5ddc6'),
  s('fair', 'Fair', '#ecc8a6'),
  s('light', 'Light', '#ddae85'),
  s('olive', 'Olive', '#c79a68'),
  s('tan', 'Tan', '#b5804f'),
  s('bronze', 'Bronze', '#9d6a3f'),
  s('umber', 'Umber', '#855634'),
  s('deep', 'Deep', '#6b4328'),
  s('dark', 'Dark', '#55341f'),
  s('ebony', 'Ebony', '#3e2617'),
];

export const HAIR_COLOURS: Swatch[] = [
  s('black', 'Black', '#1c1614'),
  s('soot', 'Soot', '#2a211c'),
  s('dark_brown', 'Dark brown', '#3b2a1c'),
  s('brown', 'Brown', '#5a3a1e'),
  s('chestnut', 'Chestnut', '#6f4423'),
  s('auburn', 'Auburn', '#7d3a1d'),
  s('ginger', 'Ginger', '#a5521f'),
  s('copper', 'Copper', '#b8672a'),
  s('honey', 'Honey', '#b98c3f'),
  s('blond', 'Blond', '#d8b76a'),
  s('flax', 'Flax', '#e6d3a1'),
  s('ash', 'Ash', '#b9b0a3'),
  s('grey', 'Grey', '#8e8b85'),
  s('white', 'White', '#ded9d0'),
];

export const EYES: Swatch[] = [
  s('dark', 'Dark', '#2a1a10'),
  s('brown', 'Brown', '#5a3a20'),
  s('hazel', 'Hazel', '#7a6030'),
  s('amber', 'Amber', '#a0762c'),
  s('green', 'Green', '#45703f'),
  s('blue', 'Blue', '#3e6a9c'),
  s('pale', 'Pale blue', '#7fa5c4'),
  s('grey', 'Grey', '#6f7378'),
];

/**
 * What you washed ashore in. Undyed cloth at the top, and below it the colours
 * this island can actually strike — the same family as the dyes in
 * `dyestuffs.ts`, so that nobody starts wearing something no dyer could make.
 */
export const CLOTH: Swatch[] = [
  s('unbleached', 'Unbleached linen', '#d9cbae'),
  s('bleached', 'Bleached linen', '#eee6d6'),
  s('oat', 'Oat wool', '#c4b18c'),
  s('straw', 'Straw', '#b79f68'),
  s('ochre', 'Ochre', '#b0842f'),
  s('weld', 'Weld yellow', '#c9a83c'),
  s('russet', 'Russet', '#9a5a34'),
  s('madder', 'Madder red', '#a63f36'),
  s('crimson', 'Crimson', '#8e2f4a'),
  s('walnut', 'Walnut', '#6b4b2e'),
  s('bark', 'Bark', '#4a3823'),
  s('moss', 'Moss', '#55693f'),
  s('verdigris', 'Verdigris', '#4b7a4a'),
  s('woad', 'Woad blue', '#3d5f9c'),
  s('slate', 'Slate', '#48525c'),
  s('charcoal', 'Charcoal', '#2f2d2b'),
];

export interface Style {
  id: string;
  name: string;
}

const y = (id: string, name: string): Style => ({ id, name });

/**
 * Twenty of them, and they are silhouettes rather than hair.
 *
 * A head is nine pixels across at zoom 1. Nothing about a haircut survives
 * that except its outline, so each of these is drawn as a shape the eye can
 * tell from the other nineteen at arm's length: how far down the sides it
 * comes, what happens behind the neck, and whether anything sticks up. The
 * creator draws them at six times the size, which is the only place the
 * difference between locs and curls is ever visible — and that is fine. It is
 * where you choose.
 */
export const HAIRSTYLES: Style[] = [
  y('bald', 'Bald'),
  y('crop', 'Cropped'),
  y('short', 'Short'),
  y('bowl', 'Bowl cut'),
  y('side', 'Side part'),
  y('swept', 'Swept back'),
  y('fringe', 'Fringe'),
  y('curls', 'Curls'),
  y('afro', 'Afro'),
  y('waves', 'Waves'),
  y('long', 'Long and loose'),
  y('ponytail', 'Ponytail'),
  y('topknot', 'Topknot'),
  y('bun', 'Bun'),
  y('braid', 'Braid'),
  y('braids', 'Twin braids'),
  y('locs', 'Locs'),
  y('ridge', 'Ridge'),
  y('undercut', 'Shaved sides'),
  y('tonsure', 'Tonsure'),
];

export const BEARDS: Style[] = [
  y('none', 'Clean-shaven'),
  y('stubble', 'Stubble'),
  y('moustache', 'Moustache'),
  y('goatee', 'Goatee'),
  y('short', 'Short beard'),
  y('full', 'Full beard'),
  y('long', 'Long beard'),
];

export const GENDERS: Style[] = [
  y('woman', 'Woman'),
  y('man', 'Man'),
  y('neither', 'Neither'),
];

/**
 * The build each answers to.
 *
 * Small numbers on purpose. A body that is twenty-eight pixels tall has room
 * for a shoulder line and a waist and nothing else, and a bigger difference
 * than this stops being a build and starts being a caricature.
 */
export const BUILDS: Record<Gender, { shoulder: number; waist: number; hip: number }> = {
  man: { shoulder: 1.1, waist: 1, hip: 0.95 },
  woman: { shoulder: 0.9, waist: 0.88, hip: 1.1 },
  neither: { shoulder: 1, waist: 0.95, hip: 1 },
};

export const DEFAULT_LOOK: Look = {
  gender: 'neither',
  skin: 'light',
  hair: 'short',
  hairColour: 'brown',
  eyes: 'brown',
  beard: 'none',
  shirt: 'unbleached',
  trousers: 'walnut',
};

const pick = (table: Array<{ id: string }>, id: unknown, fallback: string): string =>
  (typeof id === 'string' && table.some((t) => t.id === id) ? id : fallback);

/**
 * A look out of whatever arrived, with everything unrecognised replaced.
 *
 * Total, deliberately: it never throws and never returns a partial look, so
 * there is no path anywhere in the program where a body has half an
 * appearance. The same clamping is done again in SQL, because this one runs on
 * the client and therefore proves nothing.
 */
export function cleanLook(raw: unknown): Look {
  const o = (raw ?? {}) as Partial<Record<keyof Look, unknown>>;
  return {
    gender: pick(GENDERS, o.gender, DEFAULT_LOOK.gender) as Gender,
    skin: pick(SKINS, o.skin, DEFAULT_LOOK.skin),
    hair: pick(HAIRSTYLES, o.hair, DEFAULT_LOOK.hair),
    hairColour: pick(HAIR_COLOURS, o.hairColour, DEFAULT_LOOK.hairColour),
    eyes: pick(EYES, o.eyes, DEFAULT_LOOK.eyes),
    beard: pick(BEARDS, o.beard, DEFAULT_LOOK.beard),
    shirt: pick(CLOTH, o.shirt, DEFAULT_LOOK.shirt),
    trousers: pick(CLOTH, o.trousers, DEFAULT_LOOK.trousers),
  };
}

const colourOf = (table: Swatch[], id: string, fallback: string): string =>
  table.find((t) => t.id === id)?.colour ?? fallback;

/** The colours a look comes to, for whoever is holding the brush. */
export const skinColour = (l: Look): string => colourOf(SKINS, l.skin, '#ddae85');
export const hairColour = (l: Look): string => colourOf(HAIR_COLOURS, l.hairColour, '#5a3a1e');
export const eyeColour = (l: Look): string => colourOf(EYES, l.eyes, '#5a3a20');
export const shirtColour = (l: Look): string => colourOf(CLOTH, l.shirt, '#d9cbae');
export const trouserColour = (l: Look): string => colourOf(CLOTH, l.trousers, '#6b4b2e');

/** A hex colour darkened towards black, for a fold or the shaded side. */
export function darken(hex: string, by: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const cut = (v: number): number => Math.max(0, Math.round(v * (1 - by)));
  const r = cut((n >> 16) & 255);
  const g = cut((n >> 8) & 255);
  const b = cut(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/** Somebody, at random. What the creator opens on, and what a body with no look gets. */
export function randomLook(roll: () => number = Math.random): Look {
  const any = <T extends { id: string }>(t: T[]): string => t[Math.floor(roll() * t.length)].id;
  return {
    gender: any(GENDERS) as Gender,
    skin: any(SKINS),
    hair: any(HAIRSTYLES),
    hairColour: any(HAIR_COLOURS),
    eyes: any(EYES),
    beard: roll() < 0.4 ? any(BEARDS) : 'none',
    shirt: any(CLOTH),
    trousers: any(CLOTH),
  };
}

/** Every table by the name the database and the creator both file it under. */
export const LOOK_TABLES = {
  gender: GENDERS,
  skin: SKINS,
  hair: HAIRSTYLES,
  hairColour: HAIR_COLOURS,
  eyes: EYES,
  beard: BEARDS,
  shirt: CLOTH,
  trousers: CLOTH,
} as const;
