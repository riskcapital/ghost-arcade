/**
 * Hidden-instance check for the audio-reactive instruments in the editor.
 *
 *   node scripts/native-audio-visuals-ui-check.mjs --out <dir> [--port 1451] [--cdp 9251]
 *
 * Starts the source checkout on its own Vite and CDP ports with a throwaway
 * profile (and the mock keychain, hidden on macOS), opens a blank project,
 * adds Strands from the layer picker exactly as a user would, and checks:
 *   - the layer is a gpu layer running `strands`;
 *   - its panel was built from the core manifest (groups, the Trigger button);
 *   - the core composite is not black (the resting ring draws in silence);
 * then saves a screenshot of the panel and stops everything it started.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ensureDevServer, launchApp, resolveTarget } from './soak/lib/app.mjs';

const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const outDir = path.resolve(arg('out', path.join(root, 'reports', 'audio-visuals-ui')));
const port = Number(arg('port', '1451'));
const cdpPort = Number(arg('cdp', '9251'));
const sessionDir = path.join(outDir, 'session');
fs.mkdirSync(path.join(sessionDir, 'logs'), { recursive: true });
const log = (m) => console.log(`[ui-check] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let dev;
let app;
let failed = false;
try {
  dev = await ensureDevServer({ root, port, sessionDir, log });
  const target = resolveTarget({ root, appPath: '', sessionDir, log });
  app = await launchApp({ target, root, devUrl: dev.url, cdpPort, runIndex: 1, sessionDir, hidden: true, windowSize: { width: 1600, height: 1000 }, log });
  const s = app.session;
  // Blank project, past any welcome or recovery screen.
  await s.eval(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 75 && !document.querySelector('.welcome .choice') && !document.querySelector('.recovery-backdrop'); i++) await sleep(200);
    document.querySelector('.recovery-backdrop .btn-discard')?.click();
    await sleep(300);
    for (let i = 0; i < 25 && !document.querySelector('.welcome .choice'); i++) await sleep(200);
    document.querySelector('.welcome .choice[data-choice="blank"]')?.click();
    await sleep(1500);
    return true;
  })()`, 60000);
  // Wait for the core and its manifest (the picker entry appears once the
  // native core is the output engine).
  const ready = await s.eval(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 150; i++) {
      const st = await window.electronAPI.invoke('native_renderer_get_status').catch(() => null);
      if (st && st.running !== false && st.frames_presented > 0) return true;
      await sleep(200);
    }
    return false;
  })()`, 60000);
  if (!ready) throw new Error('the native core did not start');
  // The layer picker: open "Add layer", choose Strands.
  const added = await s.eval(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 50; i++) {
      let item = document.querySelector('[data-add-audio-visual="strands"]');
      if (!item) {
        const opener = [...document.querySelectorAll('button')].find((b) => /add layer/i.test(b.getAttribute('aria-label') || b.title || b.textContent || ''));
        opener?.click();
        await sleep(200);
        item = document.querySelector('[data-add-audio-visual="strands"]');
      }
      if (item) { item.click(); return true; }
      await sleep(200);
    }
    return false;
  })()`, 30000);
  if (!added) throw new Error('Strands is not in the layer picker');
  await sleep(1500);
  const layer = await s.eval(`(() => {
    let v; const off = window.__ghostArcade.project.subscribe((x) => { v = x; }); off();
    const l = v.layers.find((x) => x.type === 'gpu' && x.gpuLayerContent?.shaderId === 'strands');
    return l ? { id: l.id, name: l.name } : null;
  })()`, 10000);
  if (!layer) throw new Error('no Strands layer after picking it');
  log(`added layer ${layer.name}`);
  // Panel from the manifest.
  const panel = await s.eval(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 40 && !document.querySelector('.gpu-panel'); i++) await sleep(200);
    const p = document.querySelector('.gpu-panel');
    if (!p) return null;
    p.scrollIntoView();
    const groups = [...p.querySelectorAll('.sec-label.sub')].map((el) => el.textContent.trim());
    const trigger = [...p.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Trigger hit');
    return { groups, trigger, rebuildNote: !!p.querySelector('.rebuild-note') };
  })()`, 15000);
  log(`panel: ${JSON.stringify(panel)}`);
  if (!panel || !panel.groups.includes('Strands') || !panel.groups.includes('Audio') || !panel.trigger) {
    throw new Error('the panel was not built from the manifest');
  }
  // The core's composite is not black: the resting ring in silence, and a
  // launched shape after one press of the Trigger. Read from pixels (a thin
  // ring on a black frame averages near zero, so the core's dark flag is not
  // the test): the brightest pixel and how many are lit.
  const measure = () => s.eval(`(async () => {
    const snap = await window.electronAPI.invoke('native_renderer_get_frame_snapshot', { include_pixels: true, max_dim: 480 }).catch(() => null);
    if (!snap || !snap.rgba_b64) return null;
    const bytes = Uint8Array.from(atob(snap.rgba_b64), (c) => c.charCodeAt(0));
    let max = 0; let lit = 0;
    for (let i = 0; i < bytes.length; i += 4) {
      const m = Math.max(bytes[i], bytes[i + 1], bytes[i + 2]);
      if (m > max) max = m;
      if (m > 40) lit++;
    }
    return { max, litPct: Math.round((lit / (bytes.length / 4)) * 10000) / 100, w: snap.width, h: snap.height };
  })()`, 15000).catch(() => null);
  let resting = null;
  for (let i = 0; i < 20 && !(resting && resting.max > 40); i++) { resting = await measure(); await sleep(400); }
  log(`resting (silence): ${JSON.stringify(resting)}`);
  await s.eval(`[...document.querySelectorAll('.gpu-panel button')].find((b) => b.textContent.trim() === 'Trigger hit')?.click()`, 5000);
  let hit = null;
  for (let i = 0; i < 10; i++) { await sleep(150); const m = await measure(); if (m && (!hit || m.litPct > hit.litPct)) hit = m; }
  log(`after Trigger: ${JSON.stringify(hit)}`);
  if (!resting || resting.max <= 40 || !hit || hit.max <= 40) throw new Error('the Strands layer renders black');
  await sleep(500);
  fs.writeFileSync(path.join(outDir, 'strands-panel.jpg'), await s.screenshot({ quality: 85, maxWidth: 1600 }));
  log(`ok: ${path.join(outDir, 'strands-panel.jpg')}`);
} catch (err) {
  failed = true;
  console.error(`[ui-check] FAILED: ${err.message}`);
  try { if (app?.session) fs.writeFileSync(path.join(outDir, 'failure.jpg'), await app.session.screenshot({ quality: 70 })); } catch { /* none */ }
} finally {
  try { await app?.stop({ graceful: false }); } catch { /* gone */ }
  try { dev?.stop(); } catch { /* gone */ }
}
process.exit(failed ? 1 : 0);
