import { defineConfig } from 'vite';

/**
 * The app source lives in src/ (including the HTML entry). `npm run build`
 * writes dist/ and then scripts/copy-site.mjs copies index.html and assets/
 * to the repository root, which is what GitHub Pages serves from `main`.
 * Asset names are fixed (no hashes) so rebuilds only change the files whose
 * content changed.
 */
export default defineConfig({
  root: 'src',
  base: './',
  server: { port: 5173, host: true },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    rolldownOptions: {
      output: {
        entryFileNames: 'assets/app.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
