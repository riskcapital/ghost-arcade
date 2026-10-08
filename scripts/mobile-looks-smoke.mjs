import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(process.env.MOBILE_STUDIO_URL || 'http://127.0.0.1:1437/native-mobile.html');
  await page.getByRole('button', { name: 'Dual deck', exact: true }).click();
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await page.getByLabel('Screen content', { exact: true }).selectOption('0');
  await page.getByRole('button', { name: 'Choose a Look', exact: false }).click();
  await page.getByRole('button', { name: 'Comet Chase', exact: true }).click();
  await page.getByLabel('Look palette', { exact: true }).selectOption('fire');
  await page.getByRole('slider', { name: 'Look amount', exact: true }).fill('0.7');
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/mobile-looks-phone.png' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.reload();
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  assert.equal(await page.getByLabel('Look palette', { exact: true }).inputValue(), 'fire');
  assert.equal(await page.getByRole('slider', { name: 'Look amount', exact: true }).inputValue(), '0.7');
  assert.equal(await page.getByLabel('Screen content', { exact: true }).inputValue(), '0');
  await page.getByRole('button', { name: 'Controls', exact: true }).click();
  await page.getByRole('button', { name: 'FX', exact: true }).click();
  await page.getByLabel('Add effect', { exact: true }).selectOption('rgbShift');
  await page.getByLabel('Mode', { exact: true }).selectOption('1');
  await page.waitForTimeout(300);
  await page.setViewportSize({ width: 1194, height: 834 });
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await page.getByRole('button', { name: 'Comet Chase', exact: false }).click();
  await page.screenshot({ path: '/tmp/mobile-looks-tablet.png' });
  assert.deepEqual(errors, []);
  console.log(
    'PASS Looks gallery, palette/amount, persistence, deck-following assignment, effect mode controls and phone bounds',
  );
} finally {
  await browser.close();
}
