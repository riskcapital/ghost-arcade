// Touch targets and type size on the phone (iPhone 15 at 390 × 844, iPhone SE at 375 × 667).
// Opens the main screens, sheets and dialogs of the standalone studio and fails when:
//   - a control a finger taps is under 44 × 44 pt,
//   - a control sits past the left or right edge where nothing scrolls it into view,
//   - visible text is under 12 px.
// It starts its own Vite server for the native-mobile entry and drives Chrome with Playwright:
//   PLAYWRIGHT_MODULE=/path/to/node_modules/playwright/index.mjs node scripts/mobile-touch-targets.mjs
// Optional: SIZES=390x844,375x667  SCREENS=perform,map  URL=http://127.0.0.1:1437/native-mobile.html (skip the server)
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCREENS, closeDialogs } from './mobile-ui-screens.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const SIZES = (process.env.SIZES || '390x844,375x667').split(',').map((s) => s.split('x').map(Number));
const ONLY = process.env.SCREENS ? new Set(process.env.SCREENS.split(',')) : null;

let server = null;
let url = process.env.URL;
if (!url) {
  const { createServer } = await import('vite');
  server = await createServer({
    configFile: join(root, 'vite.config.native-mobile.ts'),
    cacheDir: mkdtempSync(join(tmpdir(), 'ga-touch-vite-')),
    server: { port: 0, strictPort: false, host: '127.0.0.1' },
    logLevel: 'error',
  });
  await server.listen();
  const address = server.httpServer.address();
  url = `http://127.0.0.1:${address.port}/native-mobile.html`;
}

/** Runs in the page: what is too small, cut off or too small to read in the current state. */
function audit() {
  const MIN = 44, TEXT = 12, SLACK = 0.5;
  // A modal (a <dialog> opened as one, or a dialog role marked modal) makes the rest inert.
  const modal = [...document.querySelectorAll('dialog[open], [role="dialog"][aria-modal="true"]')]
    .filter((d) => (d.tagName === 'DIALOG' ? d.matches(':modal') : d.getClientRects().length > 0)).pop();
  const scope = modal ?? document.body;
  const visible = (el) => {
    if (el.closest('[aria-hidden="true"], [inert]')) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };
  const scrollsX = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const o = getComputedStyle(p).overflowX;
      if ((o === 'auto' || o === 'scroll') && p.scrollWidth > p.clientWidth + 1) return true;
    }
    return false;
  };
  const name = (el) => {
    const label = el.getAttribute('aria-label') || el.textContent?.trim().replace(/\s+/g, ' ') || el.getAttribute('title') || el.tagName.toLowerCase();
    return `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').filter((c) => !c.startsWith('svelte-'))[0] : ''} "${label.slice(0, 40)}"`;
  };
  const problems = [];
  const controls = scope.querySelectorAll('button, a[href], input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="tab"], [role="radio"], [role="switch"], [role="slider"]');
  for (const el of controls) {
    if (!visible(el) || el.closest('[data-touch-exempt]')) continue;
    // A checkbox inside its row label is tapped through the whole label.
    const target = el.matches('input[type="checkbox"], input[type="radio"]') && el.closest('label') ? el.closest('label') : el;
    const r = target.getBoundingClientRect();
    if (r.width + SLACK < MIN || r.height + SLACK < MIN) problems.push(`small ${Math.round(r.width)}×${Math.round(r.height)} ${name(el)}`);
    if ((r.right > innerWidth + 1 || r.left < -1) && !scrollsX(el)) problems.push(`cut off at x ${Math.round(r.left)}–${Math.round(r.right)} of ${innerWidth} ${name(el)}`);
  }
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent.trim();
    const el = node.parentElement;
    if (!text || !el || el.closest('svg, canvas, script, style, [data-touch-exempt], option')) continue;
    if (!visible(el)) continue;
    const cs = getComputedStyle(el);
    if (cs.clipPath.startsWith('inset(50%') || cs.clip.startsWith('rect(0')) continue;
    const size = parseFloat(cs.fontSize);
    const key = `${size} ${text.slice(0, 30)}`;
    if (size + 0.01 < TEXT && !seen.has(key)) { seen.add(key); problems.push(`text ${size}px "${text.slice(0, 40)}"`); }
  }
  return problems;
}

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const failures = [];
try {
  for (const [width, height] of SIZES) {
    for (const [screen, go] of Object.entries(SCREENS)) {
      if (ONLY && !ONLY.has(screen)) continue;
      const page = await browser.newPage({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      // Shaders compile to a flat colour: this checks layout, not pictures.
      await page.route('**/ISF/**/*.fs', (r) => r.fulfill({ body: '/*{"INPUTS":[]}*/\nvoid main(){gl_FragColor=vec4(.2,.2,.3,1.);}', contentType: 'text/plain' }));
      try {
        await page.goto(url);
        await page.waitForSelector('.studio nav.tabs');
        await page.waitForTimeout(300);
        await go(page);
        await page.waitForTimeout(350);
        const problems = await page.evaluate(audit);
        if (problems.length) failures.push(`${width}×${height} ${screen}:\n  ${problems.join('\n  ')}`);
        else console.log(`ok   ${width}×${height} ${screen}`);
      } catch (error) {
        failures.push(`${width}×${height} ${screen}: could not open (${String(error.message || error).split('\n')[0]})`);
      } finally {
        await closeDialogs(page).catch(() => {});
        await page.close();
      }
    }
  }
} finally {
  await browser.close();
  await server?.close();
}
if (failures.length) console.log(`\n${failures.join('\n\n')}`);
assert.equal(failures.length, 0, `${failures.length} screen states have controls under 44 pt, cut-off controls or text under 12 px`);
console.log('PASS every control is at least 44 × 44 pt, none is cut off, and all text is at least 12 px');
