/**
 * The version of the game: the one in package.json, written in by the build
 * (`define` in vite.config.ts), and shown in the corner before the frame rate.
 * Anything that bundles these modules some other way -- the Node tests, the
 * tools -- gets 'dev'.
 */
declare const __VERSION__: string | undefined;

export const VERSION: string = typeof __VERSION__ === 'string' ? __VERSION__ : 'dev';
