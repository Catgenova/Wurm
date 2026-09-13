// Copies the Vite build output to the repository root so GitHub Pages can
// serve the site straight from the main branch.
import { cpSync, rmSync } from 'node:fs';

rmSync('assets', { recursive: true, force: true });
cpSync('dist/assets', 'assets', { recursive: true });
cpSync('dist/index.html', 'index.html');
console.log('Copied dist/index.html and dist/assets/ to the repository root.');
