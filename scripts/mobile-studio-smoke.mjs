const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
const artifactDir = process.env.MOBILE_SMOKE_DIR || '/tmp/ghost-mobile-studio-smoke';
mkdirSync(artifactDir, { recursive: true });
(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-webgl', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1194, height: 834 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(process.env.MOBILE_STUDIO_URL || 'http://127.0.0.1:1437/native-mobile.html');
  await page.waitForTimeout(900);
  const pixels = () =>
    page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => {
            const c = document.querySelector('canvas'),
              g = c.getContext('webgl'),
              p = new Uint8Array(4);
            g.readPixels(Math.floor(c.width * 0.35), Math.floor(c.height * 0.45), 1, 1, g.RGBA, g.UNSIGNED_BYTE, p);
            resolve([...p]);
          }),
        ),
    );
  assert.notDeepEqual((await pixels()).slice(0, 3), [0, 0, 0], 'live shader visible');
  await page.getByRole('button', { name: 'Hold', exact: true }).click();
  const a = await pixels();
  await page.waitForTimeout(200);
  assert.deepEqual(await pixels(), a, 'hold preserves frame');
  await page.getByRole('button', { name: 'Blackout', exact: true }).click();
  assert.deepEqual((await pixels()).slice(0, 3), [0, 0, 0]);
  await page.getByRole('button', { name: 'Blackout', exact: true }).click();
  assert.deepEqual(await pixels(), a);
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.getByRole('button', { name: 'Controls', exact: true }).click();
  await page.getByRole('button', { name: 'FX', exact: true }).click();
  await page.getByLabel('Add effect', { exact: true }).selectOption('invert');
  await page.waitForTimeout(150);
  assert.notDeepEqual((await pixels()).slice(0, 3), [0, 0, 0], 'effect chain output visible');
  await page.getByRole('button', { name: 'Perform', exact: true }).click();
  for (const name of ['Ember Drift', 'Kaleidoscope', 'Liquid Metal', 'Plasma Flow']) {
    await page.getByRole('button', {name: new RegExp(`Launch ${name} on row`)}).click();
    await page.waitForTimeout(120);
  }
  await page.getByRole('button', { name: 'Clear layer', exact: true }).click();
  await page.getByRole('button', {name:'Launch Plasma Flow on row 1',exact:true}).click();
  await page.waitForTimeout(150);
  assert.notDeepEqual((await pixels()).slice(0, 3), [0, 0, 0], 'cached shader survives clear/relaunch');
  await page.getByRole('button', { name: 'Blocks', exact: true }).click();
  await page.getByRole('button', { name: 'Save as new block', exact: true }).click();
  assert.equal(await page.locator('.scene-pad').count(), 1);
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await page.getByRole('button', { name: '3 × 3 mesh', exact: true }).click();
  const handle = page.getByRole('button', { name: 'Warp point 5', exact: true }),
    box = await handle.boundingBox();
  await page.mouse.move(box.x + 22, box.y + 22);
  await page.mouse.down();
  await page.mouse.move(box.x + 62, box.y - 12);
  await page.mouse.up();
  await page.waitForTimeout(400);
  await page.reload();
  await page.waitForTimeout(800);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ga-mobile-studio-v1')));
  assert.equal(saved.scenes.length, 1);
  assert.equal(saved.surfaces[0].mode, 'mesh');
  assert.notEqual(saved.surfaces[0].points[4].x, 0.5);
  await page.locator('.pad.empty').first().click();
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
    'base64',
  );
  await page.getByLabel('Import media', { exact: true }).setInputFiles({ name: 'red.png', mimeType: 'image/png', buffer: png });
  await page.waitForTimeout(400);
  await page.reload();
  await page.waitForTimeout(500);
  assert.ok(await page.getByRole('button',{name:/Launch red.png on row/}).count()>0);
  await page.setViewportSize({ width: 393, height: 852 });
  await page.screenshot({ path: `${artifactDir}/iphone.png` });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 393);
  await page.getByRole('button', { name: 'Clean output', exact: true }).click();
  assert.equal(await page.locator('.studio.clean').count(), 1);
  await page.getByRole('button', { name: 'Return to studio', exact: true }).click();
  assert.equal(await page.locator('.studio.clean').count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: animated output, hold/resume, blackout, FX, rapid clip changes, clear/relaunch, scenes, mesh persistence, local image restore, phone bounds, clean output',
  );
  await browser.close();
})();
