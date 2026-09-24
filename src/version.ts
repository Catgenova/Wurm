/**
 * Which deploy of the site this is, as the corner of the screen shows it
 * before the frame rate: "v561" for the 561st. The build counts it and writes
 * it in (`deploy` in vite.config.ts). Anything that bundles these modules some
 * other way -- the Node tests, the tools -- or a build from a shallow clone,
 * with no history to count, says "dev".
 */
declare const __DEPLOY__: number | undefined;

export const VERSION: string = typeof __DEPLOY__ === 'number' ? `v${__DEPLOY__}` : 'dev';
