import { defineConfig } from 'vite';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * Which deploy of the site this build is, for the corner of the screen (see
 * src/version.ts). Every push to main redeploys the site, so it is the number
 * of commits on main, counting the one this build goes out in: built here,
 * that is the commit about to be made, one after HEAD; built by the "Build
 * site" workflow, it is the commit that was pushed, HEAD itself -- so the two
 * builds agree, and the workflow finds nothing to rebuild. Without the whole
 * history to count, in a shallow clone, there is no number.
 */
function deploy(): number | undefined {
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: import.meta.dirname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    if (git('rev-parse', '--is-shallow-repository') === 'true') return undefined;
    return Number(git('rev-list', '--count', 'HEAD')) + (process.env.GITHUB_ACTIONS === 'true' ? 0 : 1);
  } catch {
    return undefined;
  }
}

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
  define: { __DEPLOY__: String(deploy() ?? 'undefined') },
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
