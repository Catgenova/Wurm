// Copies the Vite build output to the repository root so GitHub Pages can
// serve the site straight from the main branch.
import { createHash } from 'node:crypto';
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

rmSync('assets', { recursive: true, force: true });
cpSync('dist/assets', 'assets', { recursive: true });

/*
 * Asset file names are fixed, so a browser that cached ./assets/app.js could
 * keep serving an old build. Stamp each link with a hash of the file it points
 * at: the name on disk stays stable, but the URL changes whenever the bytes do.
 */
const stamp = (file) => createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 8);
const html = readFileSync('dist/index.html', 'utf8').replace(/(\.\/assets\/[\w.-]+)(?=["'])/g, (url) => `${url}?v=${stamp(url.replace('./', 'dist/'))}`);
writeFileSync('index.html', html);
console.log('Copied dist/index.html and dist/assets/ to the repository root.');
