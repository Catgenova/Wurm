import { darker, drawBeast, drawBeastPortrait, topOf, type Anim, type BeastPose, type Kind } from './beasts';
import { LUME } from './wild-air';
import { QUILL, SEDRA, WARDA } from './wild-birds';
import { DOWSE, VOLA } from './wild-diggers';
import { BURA, CUDDA, SAPPA } from './wild-herd';
import { NOOT } from './wild-odd';
import { RABBA, SEAVIC, WOOLA } from './wild-small';
import { BOGGA, EMBRA, HOLLA, MIDDUN, WADD } from './wild-brook';
import { COBBE, QUARRA } from './wild-wild';

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
  noot: NOOT,
  seavic: SEAVIC,
  vola: VOLA,
  dowse: DOWSE,
  cudda: CUDDA,
  bura: BURA,
  sappa: SAPPA,
  cobbe: COBBE,
  quarra: QUARRA,
  embra: EMBRA,
  bogga: BOGGA,
  wadd: WADD,
  holla: HOLLA,
  middun: MIDDUN,
  sedra: SEDRA,
  warda: WARDA,
  quill: QUILL,
  lume: LUME,
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

/** A kind on its own, for a page. */
export function drawWildermonPortrait(ctx: CanvasRenderingContext2D, w: number, h: number, species: string, colors: [string, string], facing = 1, ink?: string): void {
  const kind = WILDERMON[species];
  if (kind) drawBeastPortrait(ctx, w, h, species, kind, colors, facing, ink);
}

export type { Anim };
export { darker };
