// The standalone studio's main screens, sheets and dialogs, and how to reach each from a fresh
// start with Playwright. Used by mobile-touch-targets.mjs.
export const tap = (page, name) => page.getByRole('button', { name, exact: true }).first().click();
export const closeDialogs = (page) => page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
export const SCREENS = {
  map: async () => {},
  perform: async (page) => tap(page, 'Perform'),
  'perform-coach-closed': async (page) => { await tap(page, 'Perform'); const close = page.getByRole('button', { name: 'Close getting started tips' }); if (await close.count()) await close.first().click(); },
  'tempo-audio': async (page) => { await tap(page, 'Perform'); await page.locator('[data-audio-input]').click(); },
  'autopilot-settings': async (page) => { await tap(page, 'Perform'); await tap(page, 'Autopilot settings'); },
  mixer: async (page) => { await tap(page, 'Perform'); await tap(page, 'Mix'); },
  'controls-source': async (page) => { await tap(page, 'Perform'); await tap(page, 'Ctrls'); },
  'controls-effects': async (page) => { await tap(page, 'Perform'); await tap(page, 'Ctrls'); await tap(page, 'FX'); },
  'effect-browser': async (page) => { await tap(page, 'Perform'); await tap(page, 'Ctrls'); await tap(page, 'FX'); await page.locator('[data-add-effect]').click(); },
  'clip-picker': async (page) => { await tap(page, 'Perform'); await page.getByRole('button', { name: /^Add clip to row 1 column/ }).first().click(); },
  flux: async (page) => tap(page, 'Flux'),
  studio: async (page) => tap(page, 'Studio'),
  tools: async (page) => tap(page, 'Tools'),
  calibration: async (page) => { await tap(page, 'Tools'); await page.getByRole('button', { name: /Projector calibration/ }).click(); },
  settings: async (page) => tap(page, 'Set settings'),
  output: async (page) => tap(page, 'Output settings'),
  templates: async (page) => page.locator('[data-open-templates]').click(),
  'map-paint': async (page) => tap(page, 'Paint'),
  'map-add-surface': async (page) => tap(page, 'Add surface'),
  record: async (page) => { await tap(page, 'Perform'); await page.locator('[data-record]').click(); },
  'controls-playback': async (page) => { await tap(page, 'Perform'); await tap(page, 'Ctrls'); await page.locator('.transport-card > summary').click(); },
  'dual-decks': async (page) => { await tap(page, 'Perform'); await tap(page, 'A/B decks'); },
  'mixer-dual': async (page) => { await tap(page, 'Perform'); await tap(page, 'A/B decks'); await tap(page, 'Mix'); },
  'studio-effects': async (page) => { await tap(page, 'Studio'); await tap(page, 'Effects'); },
  'studio-objects': async (page) => { await tap(page, 'Studio'); await tap(page, 'Objects'); },
  'studio-setup': async (page) => { await tap(page, 'Studio'); await tap(page, 'Setup'); },
  'tools-privacy': async (page) => { await tap(page, 'Tools'); await page.locator('.privacy > summary').click(); },
  'block-menu': async (page) => { await tap(page, 'Perform'); await page.locator('.block-tab.active').first().click(); },
};

