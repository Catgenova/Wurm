import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** The version in package.json, written into the game for the corner of the screen (see src/version.ts). */
const { version } = JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8')) as { version: string };

/**
 * The app source lives in src/ (including the HTML entries). `npm run build`
 * writes dist/ and then scripts/copy-site.mjs copies the pages and assets/ to
 * the repository root, which is what GitHub Pages serves from `main`.
 * Asset names are fixed (no hashes) so rebuilds only change the files whose
 * content changed.
 *
 * Two pages, not one: `index.html` is the game and `account.html` is where a
 * username and a password are set up. They share the Supabase client and the
 * account rules and nothing else — the landing page does not drag in a
 * renderer, and the game does not drag in a sign-up form.
 */
export default defineConfig({
  root: 'src',
  base: './',
  define: { __VERSION__: JSON.stringify(version) },
  server: { port: 5173, host: true },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname, 'src/index.html'),
        account: resolve(import.meta.dirname, 'src/account.html'),
      },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
