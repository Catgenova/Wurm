import { darker, drawBeast, drawBeastPortrait, headOf, topOf, type Anim, type BeastPose, type Kind } from './beasts';
import { LUME, VESP } from './wild-air';
import { QUILL, SEDRA, WARDA } from './wild-birds';
import { DRAGON } from './wild-dragon';
import { DOWSE, MOLA, SNOUT, VOLA } from './wild-diggers';
import { BURA, CUDDA, GORRAL, ORSE, ROXXEN, SAPPA, SHAGGAN, SNEDDA } from './wild-herd';
import { CRAWLER, MAGGA, NOOT } from './wild-odd';
import { ULVA } from './wild-hunters';
import { RABBA, SEAVIC, WOOLA } from './wild-small';
import { GOBLIN, OGRE, ORC, TINKA } from './wild-upright';
import { BEVERE, BOGGA, EMBRA, HOLLA, MIDDUN, PLUCKA, WADD } from './wild-brook';
import { COBBE, GRUBBA, QUARRA, ROWL } from './wild-wild';

/**
 * The wildermon, each as a body of its own (`./beasts` for what they are all
 * made with).
 *
 * None of them is simply the animal it was drawn from. Every one is a cute
 * thing first -- a head a size too big for it, eyes that look back at you at
 * forty pixels, soft round masses -- and every one carries something that is
 * not in any field guide: a rabba's ears end in leaves, a woola's fleece is
 * cloud. What it is made of is its variant's two colours, the coat and the
 * markings, and its kind's own things.
 */

/* ---- the kinds ----------------------------------------------------------------------- */

export const WILDERMON: Record<string, Kind> = {
  rabba: RABBA,
  woola: WOOLA,
  magga: MAGGA,
  noot: NOOT,
  crawler: CRAWLER,
  ulva: ULVA,
  seavic: SEAVIC,
  vola: VOLA,
  mola: MOLA,
  dowse: DOWSE,
  snout: SNOUT,
  roxxen: ROXXEN,
  orse: ORSE,
  cudda: CUDDA,
  bura: BURA,
  gorral: GORRAL,
  shaggan: SHAGGAN,
  snedda: SNEDDA,
  sappa: SAPPA,
  rowl: ROWL,
  grubba: GRUBBA,
  cobbe: COBBE,
  quarra: QUARRA,
  embra: EMBRA,
  bogga: BOGGA,
  bevere: BEVERE,
  wadd: WADD,
  holla: HOLLA,
  plucka: PLUCKA,
  middun: MIDDUN,
  sedra: SEDRA,
  warda: WARDA,
  quill: QUILL,
  tinka: TINKA,
  goblin: GOBLIN,
  orc: ORC,
  ogre: OGRE,
  vesp: VESP,
  lume: LUME,
  dragon: DRAGON,
};

/** Whether a kind is drawn as a model here, or still by hand. */
export const modelled = (species: string | undefined): boolean => !!species && species in WILDERMON;

/** A wildermon with its feet at (sx, sy). */
export function drawWildermon(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, species: string, colors: [string, string], p: BeastPose): void {
  const kind = WILDERMON[species];
  if (kind) drawBeast(ctx, sx, sy, zoom, species, kind, colors, p);
}

/** How far over its feet the top of a kind is, standing, at zoom one: where its name and health bar go. */
export function wildermonTop(species: string): number | undefined {
  const kind = WILDERMON[species];
  return kind ? topOf(species, kind) : undefined;
}

/** Where a kind's head is over its feet at a facing, at zoom one (`headOf`): where the reins of a team come to. */
export function wildermonHead(species: string, facing: number): [number, number] | null {
  const kind = WILDERMON[species];
  return kind ? headOf(species, kind, facing) : null;
}

/** A kind on its own, for a page. */
export function drawWildermonPortrait(ctx: CanvasRenderingContext2D, w: number, h: number, species: string, colors: [string, string], facing = 1, ink?: string): void {
  const kind = WILDERMON[species];
  if (kind) drawBeastPortrait(ctx, w, h, species, kind, colors, facing, ink);
}

export type { Anim };
export { darker };
