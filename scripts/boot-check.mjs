/**
 * Does the built page start?
 *
 * Every other check in this repository runs the rules in Node, from the
 * source, bundled by esbuild. None of them loads the page the players get:
 * the one Vite builds into `index.html` and `assets/`, whose modules run in
 * the order Rolldown chooses. That order is not esbuild's, and when two
 * modules import each other it decides which of them runs first -- which is
 * how `baubles.ts` → `game.ts` → `actions.ts` → `baubles.ts` left `ACTIONS`
 * spreading a `BAUBLE_ACTIONS` that did not exist yet. The page threw as it
 * loaded and stood on "Raising an island…" for everybody, for two hours,
 * with every test green.
 *
 * So this serves the built site from the repository root, opens it in a real
 * browser and asks it to start:
 *
 *   * `index.html?alone`, the game on its own, which needs no island and no
 *     network, must come up far enough to hand the console its `wurm`
 *     handle, which is the last thing `main.ts` does before the first frame;
 *   * `account.html`, the landing page, must load without throwing.
 *
 * Anything thrown on the way is a failure, with the error and where it was.
 *
 * It needs a Chromium. It uses `CHROME_PATH` if that is set, then the one
 * Playwright keeps under `PLAYWRIGHT_BROWSERS_PATH`, then an installed Google
 * Chrome. With none of them it says so and passes, unless `BOOT_CHECK_STRICT`
 * is set, as it is in CI, where a check that cannot run is a failure.
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium } from 'playwright-core';

// The repository root, or another built site to check (`BOOT_CHECK_ROOT`), such as an older deploy's.
const ROOT = resolve(process.env.BOOT_CHECK_ROOT ?? new URL('..', import.meta.url).pathname);
const STRICT = !!process.env.BOOT_CHECK_STRICT;
/** How long the game gets to come up before it counts as stuck. */
const BOOT_WAIT = 45_000;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

/** The repository root, as GitHub Pages serves it. */
function serve() {
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)).replace(/^([/\\])+/, '');
    let file = join(ROOT, path || 'index.html');
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done(server)));
}

/** A Chromium to drive, or null when there is none here. */
function browserOptions() {
  const args = ['--no-sandbox', '--disable-dev-shm-usage'];
  if (process.env.CHROME_PATH) return { executablePath: process.env.CHROME_PATH, args };
  const kept = join(process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers', 'chromium');
  if (existsSync(kept)) return { executablePath: kept, args };
  for (const chrome of ['/opt/google/chrome/chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']) {
    if (existsSync(chrome)) return { executablePath: chrome, args };
  }
  return null;
}

const options = browserOptions();
if (!options) {
  const said = 'boot check: no Chromium here (set CHROME_PATH), so the built page was not opened.';
  if (STRICT) {
    console.error(`${said} It has to be, here.`);
    process.exit(1);
  }
  console.log(said);
  process.exit(0);
}

const server = await serve();
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch(options);
const bad = [];

/** Open a page and collect what it throws; `ready` says when it counts as up. */
async function open(path, ready) {
  const page = await browser.newPage();
  const thrown = [];
  page.on('pageerror', (e) => thrown.push(`${e.message}\n    ${(e.stack ?? '').split('\n').slice(1, 4).map((l) => l.trim()).join('\n    ')}`));
  try {
    await page.goto(`${base}/${path}`, { waitUntil: 'load' });
  } catch (e) {
    bad.push(`${path}: would not open: ${e instanceof Error ? e.message.split('\n')[0] : e}`);
    await page.close();
    return false;
  }
  let up = true;
  try {
    await ready(page);
  } catch {
    up = false;
  }
  for (const t of thrown) bad.push(`${path}: threw ${t}`);
  if (!up && !thrown.length) {
    const now = await page.evaluate(() => document.querySelector('#boot .boot-now')?.textContent ?? '').catch(() => '');
    bad.push(`${path}: did not come up within ${BOOT_WAIT / 1000}s${now ? `; the boot screen says "${now.trim()}"` : ''}`);
  }
  await page.close();
  return up && !thrown.length;
}

const game = await open('index.html?alone', (page) => page.waitForFunction(() => typeof window.wurm === 'object', null, { timeout: BOOT_WAIT }));
const landing = await open('account.html', (page) => page.waitForTimeout(2000));
await browser.close();
server.close();

console.log(`boot check: the game on its own ${game ? 'comes up' : 'DOES NOT come up'}; the landing page ${landing ? 'loads' : 'DOES NOT load'}.`);
for (const b of bad) console.error(`  ${b}`);
if (bad.length) process.exit(1);
