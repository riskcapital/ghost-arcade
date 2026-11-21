/**
 * Hidden-instance check for the render core's instruments as Audio Lab voices.
 *
 *   node scripts/native-engine-voices-ui-check.mjs --out <dir> [--port 1451] [--cdp 9251]
 *
 * Starts the source checkout on its own Vite and CDP ports with a throwaway
 * profile (and the mock keychain, hidden on macOS), opens a blank project,
 * opens Audio Lab in the VJ workspace and, as a user would:
 *   - adds Strands from the visual picker as a voice, following the kick
 *     (drums), beside the instance's audio shader (ISF) voices in one stack;
 *   - checks the Strands voice is a hidden instrument layer with audioSource
 *     "kick", and that both it and an ISF voice draw (non-black, different
 *     pictures, read per layer from the core);
 * then saves a screenshot of the rack and stops everything it started.
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
  // Audio Lab in the VJ workspace, with its visuals placed on a deck row.
  await s.eval(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const g = window.__ghostArcade;
    g.vjClipLauncher.setOpen(true);
    await sleep(800);
    g.musicStudio.open();
    await sleep(800);
    // The visuals rack is part of the full view.
    for (let i = 0; i < 50 && !document.querySelector('.add-menu'); i++) {
      [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Full view')?.click();
      await sleep(200);
    }
    [...document.querySelectorAll('button')].find((b) => /Start the visuals now|Put them on the selected layer/.test(b.textContent))?.click();
    await sleep(800);
    return !!document.querySelector('.add-menu');
  })()`, 30000);
  const before = await s.eval(`document.querySelectorAll('.follows').length`, 5000);
  // The picker: + Add, Audio shader..., the Strands tile.
  const picked = await s.eval(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const menu = document.querySelector('.add-menu');
    if (!menu) return 'no rack';
    const opt = [...menu.options].find((o) => /Audio shader/.test(o.textContent));
    menu.value = opt.value; menu.dispatchEvent(new Event('change', { bubbles: true }));
    for (let i = 0; i < 25 && !document.querySelector('.tile'); i++) await sleep(200);
    const tile = [...document.querySelectorAll('.tile')].find((t) => t.querySelector('.name')?.textContent.trim() === 'Strands');
    if (!tile) return 'Strands is not in the picker';
    tile.click();
    await sleep(600);
    return 'ok';
  })()`, 20000);
  if (picked !== 'ok') throw new Error(picked);
  // It follows the kick.
  await s.eval(`(async () => {
    const sel = [...document.querySelectorAll('.follows')].at(-1);
    sel.value = 'kick'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
  })()`, 5000);
  // Play: the beat starts and the deck row with the studio's visuals plays.
  await s.eval(`document.querySelector('button.transport[aria-label="Play"]')?.click()`, 5000);
  // Launch the deck cell holding the studio's visuals (the rack names it: "Deck A, row N").
  const where = await s.eval(`(async () => {
    const t = [...document.querySelectorAll('*')].map((e) => e.childElementCount === 0 ? e.textContent : '').find((x) => /^Deck [AB], row \\d+/.test(x || '')) || '';
    const m = /^Deck ([AB]), row (\\d+)/.exec(t);
    if (m) {
      const g = window.__ghostArcade.vjClipLauncher;
      let v; const off = g.subscribe((x) => { v = x; }); off();
      const grid = m[1] === 'A' ? v.clipGrid : v.bankBClipGrid;
      const row = Number(m[2]) - 1;
      const col = (grid[row] ?? []).findIndex((c) => c && c.source);
      if (col >= 0) g.triggerClipNow(row, col, m[1]);
      // The deck feeds the output only while it is live.
      g.setLive(true);
      await new Promise((r) => setTimeout(r, 800));
      let w; const off2 = g.subscribe((x) => { w = x; }); off2();
      return t + ' | col ' + col + ' | cells ' + JSON.stringify((grid[row] ?? []).map((c) => c ? Object.keys(c).join('/') : null)).slice(0, 300) + ' | state ' + JSON.stringify((m[1] === 'A' ? w.layerStates : w.bankBLayerStates)?.[row]).slice(0, 300);
    }
    return t;
  })()`, 5000);
  log(`studio visuals at: ${where}`);
  const voices = await s.eval(`document.querySelectorAll('.follows').length`, 5000);
  log(`voices in the stack: ${before} -> ${voices}`);
  if (voices !== before + 1) throw new Error('the Strands voice was not added');
  // The layers the core gets, from its own snapshot.
  const sleepMs = 2500;
  await sleep(sleepMs);
  const layers = await s.eval(`window.electronAPI.invoke('native_renderer_get_layers_snapshot').then((x) => (x?.layers ?? x ?? []).map((l) => ({ id: l.layer_id ?? l.id, source: l.source_id, kind: l.graph_kind ?? l.kind, slot: l.frame_slot })))`, 10000).catch(() => []);
  const voiceLayers = layers.filter((l) => String(l.id).startsWith('music-voice:'));
  log(`voice layers in the core: ${JSON.stringify(voiceLayers)}`);
  const strandsId = voiceLayers.find((l) => String(l.source).endsWith(':strands'))?.id;
  const isfId = voiceLayers.find((l) => !String(l.source).startsWith('gpu:'))?.id;
  if (!strandsId || !isfId || strandsId === isfId) throw new Error('the voices are not separate core layers');
  const measure = (layerId) => s.eval(`(async () => {
    const snap = await window.electronAPI.invoke('native_renderer_get_frame_snapshot', { layer_id: ${JSON.stringify(layerId)}, include_pixels: true, max_dim: 320 }).catch(() => null);
    if (!snap || !snap.rgba_b64) return null;
    const bytes = Uint8Array.from(atob(snap.rgba_b64), (c) => c.charCodeAt(0));
    let max = 0; let lit = 0; let sum = 0;
    for (let i = 0; i < bytes.length; i += 4) {
      const m = Math.max(bytes[i], bytes[i + 1], bytes[i + 2]);
      if (m > max) max = m;
      if (m > 40) lit++;
      sum += m;
    }
    return { max, litPct: Math.round((lit / (bytes.length / 4)) * 10000) / 100, mean: Math.round(sum / (bytes.length / 4) * 10) / 10 };
  })()`, 15000).catch(() => null);
  // The ISF voices on Auto show only while their sound plays: take whichever draws.
  const isfIds = voiceLayers.filter((l) => !String(l.source).startsWith('gpu:')).map((l) => l.id);
  let strands = null;
  let isf = null;
  let isfAt = isfId;
  for (let i = 0; i < 15 && !(strands?.max > 40 && isf?.max > 40); i++) {
    strands = await measure(strandsId);
    for (const id of isfIds) {
      const m = await measure(id);
      if (m && (!isf || m.max > isf.max)) { isf = m; isfAt = id; }
    }
    await sleep(400);
  }
  log(`composite: ${JSON.stringify(await measure(undefined))}`);
  log(`Strands voice (${strandsId}): ${JSON.stringify(strands)}`);
  log(`ISF voice (${isfAt}): ${JSON.stringify(isf)}`);
  if (!(strands?.max > 40) || !(isf?.max > 40)) throw new Error('a voice renders black');
  if (strands.litPct === isf.litPct && strands.mean === isf.mean) throw new Error('the two voices read as the same picture');
  const rack = await s.eval(`(() => { const r = document.querySelector('.add-menu')?.closest('.rack, .studio-module, section') ?? document.querySelector('.add-menu')?.parentElement; r?.scrollIntoView(); const b = r?.getBoundingClientRect(); return b ? { x: b.x, y: b.y, w: b.width, h: b.height } : null; })()`, 5000);
  log(`rack at ${JSON.stringify(rack)}`);
  fs.writeFileSync(path.join(outDir, 'engine-voice-rack.jpg'), await s.screenshot({ quality: 85, maxWidth: 1600 }));
  log(`ok: ${path.join(outDir, 'engine-voice-rack.jpg')}`);
} catch (err) {
  failed = true;
  console.error(`[ui-check] FAILED: ${err.message}`);
  try { if (app?.session) fs.writeFileSync(path.join(outDir, 'failure.jpg'), await app.session.screenshot({ quality: 70 })); } catch { /* none */ }
} finally {
  try { await app?.stop({ graceful: false }); } catch { /* gone */ }
  try { dev?.stop(); } catch { /* gone */ }
}
process.exit(failed ? 1 : 0);
