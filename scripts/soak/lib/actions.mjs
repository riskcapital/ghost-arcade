// The soak's action library: what users do, as weighted, self-checking
// steps. Each action has an area, a weight, a timeout and run(ctx); run
// throws (ctx.fail / ctx.assert) when what it did did not happen, and may
// note softer problems with ctx.warn. Arguments come from ctx.rng, which is
// derived from the run's seed and the step number, so `--seed` replays a run.
//
// Actions go through the same store calls the UI makes (window.__ghostArcade)
// or real input (CDP mouse, keyboard and file drops). Show Runner actions are
// reused where they exist (ctx.showStep).
import fs from 'node:fs';
import path from 'node:path';
import { fixture } from '../../show-runner/fixtures.mjs';
import { probeVideo } from './media.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TEMPLATES = ['band-stage', 'club-vj', 'psychedelic', 'mapping-starter'];
const SONGS = ['song-driving.wav', 'song-groove.wav', 'song-chill.wav', 'sections.wav'];
const CLIPS = ['bars.mp4', 'red.mp4', 'blue.mp4', 'white.mov', 'ramp.mp4', 'framecode.mp4'];
const SHAPES = ['rectangle', 'circle', 'ellipse', 'triangle', 'polygon', 'star'];
const LAYER_EFFECTS = [
  { type: 'blur', params: { blurRadius: 5, blurMode: 1, blurAngle: 0, blurQuality: 1, blurEdgeProtect: 0.3, blurMix: 1 } },
  { type: 'invert', params: { invertMode: 0, invertAmount: 1 } },
];
const GROUP_EFFECTS = ['blur', 'invert'];
const SCREEN_FX = [
  { row: 'screenfx', type: 'strobe', params: { rate: 2, duty: 0.5 } },
  { row: 'screenfx', type: 'linear-sweep', params: { angle: 0, speed: 0.5, bandWidth: 0.2, tail: 0 } },
  { row: 'screenfx', type: 'beat-pulse', params: { decay: 0.2 } },
  { row: 'effects', type: 'invert', params: { invertMode: 0, invertAmount: 1 } },
];
const AUTO_STYLES = ['chill', 'groove', 'driving', 'hard', 'cinematic'];
// Settings a user flips without consequences outside the app.
const SETTING_TOGGLES = [
  { name: 'grid', call: 'toggleGrid', read: 'ui.gridSettings.enabled' },
  { name: 'snap to grid', call: 'toggleSnap', read: 'ui.gridSettings.snapToGrid' },
  { name: 'snap to layers', call: 'toggleLayerSnap', read: 'ui.gridSettings.snapToLayers' },
  { name: 'reversed VJ layout', path: ['ui', 'vjLayoutReversed'] },
  { name: 'cursor on output', path: ['output', 'outputShowCursor'] },
  { name: 'dome grid', path: ['output', 'domeGrid'] },
  { name: 'include audio in recordings', path: ['recording', 'includeAudio'] },
];
// Monkey clicks never touch anything that leaves the app, opens a system
// dialog, quits, or throws work away wholesale.
const MONKEY_DENY = /quit|exit|full ?screen|close app|open|save|import|export|browse|choose|locate|licen|activate|buy|purchase|upgrade|sign|log ?in|account|update|download|website|docs|help|feedback|report|support|uninstall|restart|reload|folder|reveal|finder|explorer|show in|send|share|pair|phone|camera|microphone|webcam|capture|record|render|stream|ndi|spout|syphon|midi learn|ableton|connect|email|copy link|delete all|reset all|clear all|new project|discard|\.\.\.|…/i;

let shaderList = null;
function shaders(root) {
  if (!shaderList) {
    try { shaderList = fs.readdirSync(path.join(root, 'public', 'ISF')).filter((f) => f.endsWith('.fs')).map((f) => f.slice(0, -3)); } catch { shaderList = []; }
    if (!shaderList.length) shaderList = ['DM-SolidColor'];
  }
  return shaderList;
}

/** Store state the precondition checks read (one round trip). */
export const STATE_JS = `(() => {
  const S = window.__soak, G = window.__ghostArcade;
  if (!S || !G) return null;
  const p = S.project(), d = S.deck(), sh = S.show();
  const filled = [];
  (d.clipGrid ?? []).forEach((row, r) => row.forEach((c, k) => { if (c) filled.push([r, k]); }));
  return {
    layers: p.layers.length,
    layerIds: p.layers.filter((l) => l.type !== 'group').map((l) => l.id),
    deckOpen: !!d.isOpen, deckLive: !!d.isLive, deckRows: d.numLayers, deckCols: d.numColumns, filled,
    groups: (d.groups ?? []).length,
    timelineDoc: G.showTracks?.activeDoc?.() ?? null,
    timelineOpen: !!sh.isOpen,
    songs: sh.audioTracks.filter((t) => t.url).length,
    sections: (sh.sections ?? []).length,
    tracks: sh.layerTracks.length,
    playing: !!sh.isPlaying,
    lines: (sh.lines ?? []).length,
    outputOpen: !!document.querySelector('button.output-btn[title="Close Output Window"]'),
    studioOpen: !!document.querySelector('[aria-label="Close Interactive Studio"]'),
    modal: S.modalOpen(),
  };
})()`;

const A = [];
const def = (area, name, weight, timeoutSec, run, when = null) => A.push({ area, name, weight, timeoutSec, run, when });

// ── Templates ─────────────────────────────────────────────────────────
def('templates', 'template.load', 3, 120, async (ctx) => {
  const id = ctx.rng.pick(TEMPLATES);
  ctx.note(id);
  await ctx.showStep({ do: 'template.open', id });
  const st = await ctx.state();
  ctx.assert(st.layers > 0 || st.filled.length > 0, `template ${id} loaded nothing (no layers, no deck clips)`);
  await sleep(2500);
  await ctx.expectFrames(`after loading ${id}`);
});

// ── Mapping ───────────────────────────────────────────────────────────
def('mapping', 'mapping.addSurface', 4, 30, async (ctx) => {
  const shape = ctx.rng.pick(SHAPES);
  const shader = ctx.rng.bool(0.6) ? 'DM-SolidColor' : ctx.rng.pick(shaders(ctx.root));
  const x0 = ctx.rng.float(0, 0.6); const y0 = ctx.rng.float(0, 0.6);
  const w = ctx.rng.float(0.15, 0.4); const h = ctx.rng.float(0.15, 0.4);
  const colour = [ctx.rng.float(0.2, 1), ctx.rng.float(0.2, 1), ctx.rng.float(0.2, 1), 1];
  ctx.note(`${shape} ${shader}`);
  const id = await ctx.page(`
    const id = G.project.addLayer('Soak ' + A.shape, 'media', A.shape);
    if (!id) return null;
    const clip = await S.shaderClip(A.shader, A.shader === 'DM-SolidColor' ? { baseColor: A.colour } : {});
    G.project.setLayerSource(id, { id: crypto.randomUUID(), type: 'shader', src: clip.src, name: clip.name, shaderCode: clip.shaderCode, shaderValues: clip.shaderValues });
    G.project.setCorners(id, { topLeft: { x: A.x0, y: A.y0 + A.h }, topRight: { x: A.x0 + A.w, y: A.y0 + A.h }, bottomLeft: { x: A.x0, y: A.y0 }, bottomRight: { x: A.x0 + A.w, y: A.y0 } });
    G.project.selectLayer(id);
    return id;`, { shape, shader, colour, x0, y0, w, h });
  ctx.assert(id, 'addLayer returned nothing');
  await sleep(600);
  const ok = await ctx.page(`const l = S.project().layers.find((x) => x.id === A.id); return !!l && Math.abs(l.corners.topLeft.x - A.x0) < 1e-6;`, { id, x0 });
  ctx.assert(ok, 'the new surface is missing or its corners did not stick');
}, (st) => st.layers < 40);

def('mapping', 'mapping.moveCorners', 4, 20, async (ctx) => {
  const r = await ctx.page(`
    const layers = S.project().layers.filter((l) => l.corners && l.type !== 'group');
    if (!layers.length) return null;
    const l = layers[Math.floor(A.pick * layers.length)];
    const c = { ...l.corners };
    for (const k of ['topLeft', 'topRight', 'bottomLeft', 'bottomRight']) c[k] = { x: Math.min(1.2, Math.max(-0.2, c[k].x + (A.d[k][0]))), y: Math.min(1.2, Math.max(-0.2, c[k].y + A.d[k][1])) };
    G.project.setCorners(l.id, c);
    await new Promise((r) => setTimeout(r, 200));
    const after = S.project().layers.find((x) => x.id === l.id);
    return { name: l.name, moved: Math.abs(after.corners.topRight.x - c.topRight.x) < 1e-6 };`,
  { pick: ctx.rng.next(), d: Object.fromEntries(['topLeft', 'topRight', 'bottomLeft', 'bottomRight'].map((k) => [k, [ctx.rng.float(-0.05, 0.05), ctx.rng.float(-0.05, 0.05)]])) });
  if (!r) return ctx.skip('no surfaces');
  ctx.note(r.name);
  ctx.assert(r.moved, `corners of ${r.name} did not move`);
}, (st) => st.layers > 0);

def('mapping', 'mapping.meshWarp', 3, 20, async (ctx) => {
  const rows = ctx.rng.int(2, 6); const cols = ctx.rng.int(2, 6);
  const r = await ctx.page(`
    const layers = S.project().layers.filter((l) => l.type === 'media' || l.type === 'color');
    if (!layers.length) return null;
    const l = layers[Math.floor(A.pick * layers.length)];
    G.project.setWarpMode(l.id, 'mesh');
    G.project.setMeshGridSize(l.id, A.rows, A.cols);
    await new Promise((r) => setTimeout(r, 150));
    let g = S.project().layers.find((x) => x.id === l.id)?.meshGrid;
    if (!g) return { name: l.name, ok: false, why: 'no mesh grid' };
    const rr = Math.floor(A.p1 * g.rows), cc = Math.floor(A.p2 * g.cols);
    const pt = g.points?.[rr]?.[cc] ?? g.points?.[rr * g.cols + cc];
    if (pt) G.project.setMeshPoint(l.id, rr, cc, { x: pt.x + A.dx, y: pt.y + A.dy });
    if (A.back) G.project.setWarpMode(l.id, 'corners');
    await new Promise((r) => setTimeout(r, 150));
    const after = S.project().layers.find((x) => x.id === l.id);
    return { name: l.name, ok: after.warpMode === (A.back ? 'corners' : 'mesh'), rows: g.rows, cols: g.cols };`,
  { pick: ctx.rng.next(), rows, cols, p1: ctx.rng.next(), p2: ctx.rng.next(), dx: ctx.rng.float(-0.03, 0.03), dy: ctx.rng.float(-0.03, 0.03), back: ctx.rng.bool(0.3) });
  if (!r) return ctx.skip('no media layers');
  ctx.note(`${r.name} ${r.rows}x${r.cols}`);
  ctx.assert(r.ok, `mesh warp on ${r.name} did not apply${r.why ? `: ${r.why}` : ''}`);
}, (st) => st.layers > 0);

def('mapping', 'mapping.mask', 3, 20, async (ctx) => {
  const n = ctx.rng.int(3, 6);
  const pts = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return { x: 0.5 + Math.cos(a) * ctx.rng.float(0.1, 0.35), y: 0.5 + Math.sin(a) * ctx.rng.float(0.1, 0.35) };
  });
  const r = await ctx.page(`
    const layers = S.project().layers.filter((l) => l.type !== 'group');
    if (!layers.length) return null;
    const l = layers[Math.floor(A.pick * layers.length)];
    G.project.enableMask(l.id);
    for (const p of A.pts) G.project.addMaskPoint(l.id, p);
    G.project.closeMaskShape(l.id);
    if (A.invert) G.project.toggleMaskInvert(l.id);
    G.project.setMaskFeather(l.id, A.feather);
    await new Promise((r) => setTimeout(r, 200));
    const m = S.project().layers.find((x) => x.id === l.id)?.mask;
    const closed = !!m?.enabled && (m.shapes ?? []).some((s) => s.closed);
    if (A.clear) G.project.clearMask(l.id);
    return { name: l.name, closed, shapes: (m?.shapes ?? []).length };`,
  { pick: ctx.rng.next(), pts, invert: ctx.rng.bool(0.3), feather: ctx.rng.float(0, 0.1), clear: ctx.rng.bool(0.4) });
  if (!r) return ctx.skip('no layers');
  ctx.note(`${r.name}: ${r.shapes} shape(s)`);
  ctx.assert(r.closed, `mask on ${r.name} did not close`);
}, (st) => st.layers > 0);

def('mapping', 'mapping.linkSurface', 2, 20, async (ctx) => {
  const r = await ctx.page(`
    const layers = S.project().layers.filter((l) => l.type === 'media');
    if (layers.length < 2) return null;
    const a = layers[Math.floor(A.p1 * layers.length)];
    const b = layers.find((l) => l.id !== a.id);
    const count = () => { const m = S.project().mapSurfaces; return m ? (Array.isArray(m) ? m.length : Object.keys(m).length) : 0; };
    const before = count();
    G.project.setLayerSurfaceSharing(a.id, 'share');
    await new Promise((r) => setTimeout(r, 150));
    const shared = S.project().layers.find((l) => l.id === a.id);
    const surfaceId = shared.surfaceId ?? a.id;
    const registered = count() >= Math.max(1, before);
    const compositionId = G.project.saveComposition('Soak link ' + Date.now());
    const res = G.project.linkLayersToSurface({ surfaceId, destinations: [{ compositionId, target: { kind: 'layer', layerId: b.id, warp: 'shared', moveOff: true } }] });
    return { a: a.name, b: b.name, surface: registered, ok: !!res?.ok, issue: res?.ok ? null : JSON.stringify(res?.issues ?? res?.plan?.rows ?? res).slice(0, 200) };`,
  { p1: ctx.rng.next() });
  if (!r) return ctx.skip('needs two media layers');
  ctx.note(`${r.a} -> ${r.b}${r.ok ? '' : ` (refused: ${r.issue})`}`);
  ctx.assert(r.surface, `Share surface did not register a shared surface for ${r.a}`);
}, (st) => st.layers > 1);

def('mapping', 'mapping.duplicateRemove', 2, 20, async (ctx) => {
  const dup = ctx.rng.bool(0.5);
  const r = await ctx.page(`
    const layers = S.project().layers.filter((l) => l.type !== 'group');
    if (!layers.length) return null;
    const l = layers[Math.floor(A.pick * layers.length)];
    const before = S.project().layers.length;
    if (A.dup) G.project.duplicateLayer(l.id); else G.project.removeLayer(l.id);
    await new Promise((r) => setTimeout(r, 250));
    return { name: l.name, before, after: S.project().layers.length };`, { pick: ctx.rng.next(), dup });
  if (!r) return ctx.skip('no layers');
  ctx.note(`${dup ? 'duplicate' : 'remove'} ${r.name}`);
  ctx.assert(dup ? r.after === r.before + 1 : r.after < r.before, `${dup ? 'duplicate' : 'remove'} left ${r.after} layers (was ${r.before})`);
}, (st) => st.layers > 0 && st.layers < 40);

// ── VJ ────────────────────────────────────────────────────────────────
def('vj', 'vj.open', 2, 20, async (ctx) => {
  await ctx.showStep({ do: 'deck.open' });
  const st = await ctx.state();
  ctx.assert(st.deckOpen && st.deckLive, 'the VJ deck did not open live');
}, (st) => !st.deckOpen);

def('vj', 'vj.loadShader', 4, 30, async (ctx) => {
  const st = await ctx.state();
  const row = ctx.rng.int(0, Math.max(0, st.deckRows - 1)); const col = ctx.rng.int(0, Math.min(7, st.deckCols - 1));
  const shader = ctx.rng.pick(shaders(ctx.root));
  ctx.note(`${shader} -> ${row},${col}`);
  await ctx.showStep({ do: 'deck.shader', row, col, shader });
  await sleep(300);
  const has = await ctx.page(`return !!S.deck().clipGrid?.[A.row]?.[A.col];`, { row, col });
  ctx.assert(has, `cell ${row},${col} is still empty`);
}, (st) => st.deckOpen);

def('vj', 'vj.dropVideo', 2, 60, async (ctx) => {
  const st = await ctx.state();
  const row = ctx.rng.int(0, Math.max(0, st.deckRows - 1)); const col = ctx.rng.int(0, Math.min(5, st.deckCols - 1));
  const clip = ctx.rng.pick(CLIPS);
  ctx.note(`${clip} -> ${row},${col}`);
  await ctx.showStep({ do: 'deck.drop', row, col, clip });
  const has = await ctx.waitFor(`!!S.deck().clipGrid?.[${row}]?.[${col}]`, 15000);
  ctx.assert(has, `dropping ${clip} left cell ${row},${col} empty`);
}, (st) => st.deckOpen);

def('vj', 'vj.trigger', 6, 20, async (ctx) => {
  const st = await ctx.state();
  if (!st.filled.length) return ctx.skip('no clips on the deck');
  const [row, col] = ctx.rng.pick(st.filled);
  ctx.note(`${row},${col}`);
  if (ctx.rng.bool(0.5)) {
    // Real click on the cell.
    const ok = await ctx.clickExpr(`document.querySelectorAll('.layer-row')[${row}]?.querySelectorAll('.clip-cell')[${col}]`);
    if (!ok) await ctx.showStep({ do: 'deck.trigger', row, col });
  } else {
    await ctx.showStep({ do: 'deck.trigger', row, col });
  }
  await sleep(1500);
  await ctx.expectFrames(`clip ${row},${col} playing`);
}, (st) => st.deckOpen && st.filled.length > 0);

def('vj', 'vj.triggerColumn', 2, 20, async (ctx) => {
  const st = await ctx.state();
  const col = ctx.rng.pick(st.filled)?.[1] ?? 0;
  await ctx.showStep({ do: 'deck.triggerColumn', col });
  ctx.note(`column ${col}`);
  await sleep(1200);
}, (st) => st.deckOpen && st.filled.length > 0);

// The fader's live position is on screen (the deck state only takes it when
// the fader rests, so per-frame moves never go through the store).
// The readout under the fader shows the live position in percent.
const FADER_JS = `(() => { const t = document.querySelector('.xfade-readout')?.textContent ?? ''; const m = t.match(/(-?[0-9.]+)\\s*%/); return m ? Number(m[1]) / 100 : null; })()`;

def('vj', 'vj.crossfader', 3, 20, async (ctx) => {
  const values = Array.from({ length: ctx.rng.int(3, 10) }, () => ctx.rng.float(0, 1));
  await ctx.page(`G.vjClipLauncher.setCrossfaderEnabled(true); for (const v of A.values) { G.vjClipLauncher.setCrossfaderValue(v); await new Promise((r) => setTimeout(r, 80)); }`, { values });
  await sleep(400);
  if (await ctx.page(`return !!document.querySelector('.xfade-mod-chip.auto');`)) { ctx.note('Auto is driving the fader'); return; }
  const want = values[values.length - 1];
  const onScreen = await ctx.page(`return ${FADER_JS};`);
  const inState = await ctx.page(`return S.deck().crossfaderValue;`);
  ctx.note(`set ${want.toFixed(2)}: fader ${onScreen?.toFixed?.(2)}, deck ${inState?.toFixed?.(2)}`);
  if (onScreen !== null) ctx.assert(Math.abs(onScreen - want) < 0.015, `the fader shows ${onScreen.toFixed(2)}, set to ${want.toFixed(2)}`);
  ctx.assert(Math.abs(inState - want) < 0.02, `the deck kept ${inState} after the fader rested at ${want.toFixed(2)}`);
  if (ctx.rng.bool(0.3)) await ctx.page(`G.vjClipLauncher.glideCrossfaderTo(A.t);`, { t: ctx.rng.float(0, 1) });
}, (st) => st.deckOpen);

def('vj', 'vj.crossfaderAuto', 2, 30, async (ctx) => {
  await ctx.page(`G.vjClipLauncher.setCrossfaderEnabled(true);`);
  await sleep(400);
  if (!(await ctx.click('.xfade-mod-chip'))) return ctx.skip('no crossfader modulation chip on screen');
  await sleep(400);
  const auto = await ctx.click('button.cat-auto');
  if (!auto) { await ctx.click('.mt-close'); return ctx.skip('no Auto button in the tray'); }
  await sleep(300);
  await ctx.click('.mt-close');
  const seen = new Set();
  for (let i = 0; i < 6; i++) { const v = await ctx.page(`return ${FADER_JS};`); if (v !== null) seen.add(v.toFixed(3)); await sleep(500); }
  const chip = await ctx.page(`return !!document.querySelector('.xfade-mod-chip.auto');`);
  ctx.note(`fader positions seen: ${[...seen].join(', ')}`);
  ctx.assert(chip, 'the crossfader chip does not show Auto');
  ctx.assert(seen.size > 1, `Auto crossfader did not move (${[...seen].join(', ') || 'no fader on screen'})`);
  // Back to manual most of the time, so the deck stays testable.
  if (ctx.rng.bool(0.7) && (await ctx.click('.xfade-mod-chip'))) {
    await sleep(300);
    await ctx.click('.mt-cats button');
    await sleep(200);
    await ctx.click('.mt-close');
  }
}, (st) => st.deckOpen);

def('vj', 'vj.effects', 3, 20, async (ctx) => {
  const st = await ctx.state();
  const row = ctx.rng.int(0, Math.max(0, st.deckRows - 1));
  const fx = ctx.rng.pick(LAYER_EFFECTS);
  const where = ctx.rng.pick(['layer', 'composition']);
  ctx.note(`${fx.type} on ${where === 'layer' ? `row ${row}` : 'the composition'}`);
  const r = await ctx.page(`
    const L = G.vjClipLauncher;
    const fx = { id: crypto.randomUUID(), type: A.fx.type, enabled: true, opacity: 1, blendMode: 'normal', params: A.fx.params };
    const list = () => A.where === 'layer' ? (S.deck().layerStates?.[A.row]?.effects ?? []) : (S.deck().compositionEffects ?? []);
    const before = list().length;
    if (A.where === 'layer') L.addLayerEffect(A.row, fx, 'A'); else L.addCompositionEffect(fx);
    await new Promise((r) => setTimeout(r, 300));
    const after = list().length;
    // Keep chains short: drop the oldest when there are more than three.
    const all = list();
    if (all.length > 3) { if (A.where === 'layer') L.removeLayerEffect(A.row, all[0].id, 'A'); else L.removeCompositionEffect(all[0].id); }
    return { before, after };`, { row, fx, where });
  ctx.assert(r.after === r.before + 1, `${fx.type} was not added (${r.before} -> ${r.after})`);
}, (st) => st.deckOpen);

def('vj', 'vj.groups', 2, 20, async (ctx) => {
  const st = await ctx.state();
  if (st.deckRows < 2) return ctx.skip('one row only');
  const first = ctx.rng.int(0, st.deckRows - 2); const last = ctx.rng.int(first + 1, st.deckRows - 1);
  const remove = st.groups > 1 || ctx.rng.bool(0.3);
  const r = await ctx.page(`
    const L = G.vjClipLauncher;
    if (A.remove && (S.deck().groups ?? []).length) { const g = S.deck().groups[0]; L.removeGroup(g.id); await new Promise((r) => setTimeout(r, 200)); return { removed: true, groups: (S.deck().groups ?? []).length }; }
    const before = (S.deck().groups ?? []).length;
    L.addGroup(A.first, A.last);
    await new Promise((r) => setTimeout(r, 200));
    const groups = S.deck().groups ?? [];
    const g = groups[groups.length - 1];
    const err = g ? L.addGroupEffects(g.id, [A.fx]) : 'no group';
    return { before, after: groups.length, err };`, { first, last, remove, fx: ctx.rng.pick(GROUP_EFFECTS) });
  if (r.removed) { ctx.note('removed a group'); return; }
  ctx.note(`rows ${first}-${last}`);
  ctx.assert(r.after >= r.before, `addGroup lost groups (${r.before} -> ${r.after})`);
  if (r.err) ctx.warn(`group effect refused: ${r.err}`);
}, (st) => st.deckOpen);

def('vj', 'vj.rows', 1, 20, async (ctx) => {
  const st = await ctx.state();
  const add = st.deckRows < 8 && ctx.rng.bool(0.6);
  if (add) {
    await ctx.page(`G.vjClipLauncher.addLayer();`);
    await sleep(500);
    const n = (await ctx.state()).deckRows;
    ctx.assert(n === st.deckRows + 1, `add row left ${n} rows (was ${st.deckRows})`);
  } else if (st.deckRows > 2) {
    const from = ctx.rng.int(0, st.deckRows - 1); const to = ctx.rng.int(0, st.deckRows - 1);
    await ctx.showStep({ do: 'deck.dragRow', from, to });
    ctx.note(`reorder ${from} -> ${to}`);
  }
}, (st) => st.deckOpen);

def('vj', 'vj.stopAll', 1, 20, async (ctx) => {
  await ctx.showStep({ do: 'deck.stopAll' });
  await sleep(500);
}, (st) => st.deckOpen);

def('vj', 'vj.close', 1, 20, async (ctx) => {
  await ctx.page(`G.vjClipLauncher.setOpen(false);`);
  await sleep(600);
  ctx.assert(!(await ctx.state()).deckOpen, 'the VJ deck did not close');
}, (st) => st.deckOpen);

// ── Add-ons (only when the build has them) ────────────────────────────
def('addons', 'addons.audioLab', 2, 40, async (ctx) => {
  if (!(await ctx.click('button[title^="Audio Lab:"]'))) return ctx.skip('no Audio Lab in this build');
  const open = await ctx.waitFor(`/Audio Lab/.test(document.querySelector('.music-title, .bar-title')?.textContent ?? '')`, 10000);
  ctx.assert(open, 'Audio Lab did not open');
  await sleep(ctx.rng.int(2000, 6000));
  // Play with a few of its controls through real clicks.
  for (let i = 0; i < ctx.rng.int(1, 4); i++) await ctx.monkeyClick({ within: '.music-studio, .audio-lab, .music-root, main' });
  await ctx.click('button[title^="Audio Lab:"]');
  if (await ctx.page(`return /Audio Lab/.test(document.querySelector('.music-title, .bar-title')?.textContent ?? '');`)) await ctx.key('Backquote', { code: 'Backquote', key: '`', keyCode: 192 });
  await sleep(500);
}, (st) => st.deckOpen);

def('addons', 'addons.analogSynth', 1, 40, async (ctx) => {
  const id = await ctx.page(`
    const id = G.project.addLayer('Soak synth', 'media');
    if (!id) return null;
    G.project.setLayerSource(id, { id: crypto.randomUUID(), type: 'effect', name: 'Analog Synth', src: 'plugin://analog-synth', effectSource: { effectType: 'videosynth' } });
    G.project.selectLayer(id);
    return id;`);
  ctx.assert(id, 'could not add the synth layer');
  await sleep(1500);
  const opened = await ctx.clickText('button', /Open the synth/i);
  if (opened) {
    const shown = await ctx.waitFor(`[...document.querySelectorAll('.app-title')].some((e) => /Analog Synth/.test(e.textContent))`, 10000);
    ctx.assert(shown, 'Analog Synth did not open');
    await sleep(ctx.rng.int(2000, 5000));
    for (let i = 0; i < ctx.rng.int(0, 3); i++) await ctx.monkeyClick({ selector: '[role="radiogroup"] button, .knob, input[type="range"]' });
    await ctx.clickText('button.bar-btn', /^Close$/);
  } else ctx.note('no Open the synth button (add-on not in this build)');
  await sleep(500);
  await ctx.expectFrames('analog synth layer');
  if (ctx.rng.bool(0.6)) await ctx.page(`G.project.removeLayer(A.id);`, { id });
}, (st) => st.layers < 40 && !st.deckOpen);

def('addons', 'addons.phoneCameraFake', 0, 40, async (ctx) => {
  // A fake phone: a second page joins the LAN relay as a phone would and
  // offers a canvas stream as the camera. Off by default (weight 0).
  const r = await ctx.page(`
    const info = await window.ghostRemote?.info?.();
    if (!info?.token || !info?.wsPort) return { skip: 'no LAN relay info' };
    const sessionId = 'soak-' + Date.now();
    const ws = new WebSocket('ws://127.0.0.1:' + info.wsPort + '?pair=' + info.token);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; setTimeout(rej, 5000); });
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
    const c2 = canvas.getContext('2d');
    let n = 0; const tick = setInterval(() => { c2.fillStyle = 'hsl(' + (n++ * 7 % 360) + ',80%,50%)'; c2.fillRect(0, 0, 320, 240); }, 33);
    const pc = new RTCPeerConnection();
    canvas.captureStream(30).getTracks().forEach((t) => pc.addTrack(t));
    pc.onicecandidate = (e) => { if (e.candidate) ws.send(JSON.stringify({ type: 'phone_camera_ice', sessionId, candidate: e.candidate })); };
    ws.onmessage = async (m) => { const msg = JSON.parse(m.data); if (msg.sessionId !== sessionId) return; if (msg.type === 'phone_camera_answer') await pc.setRemoteDescription(msg.sdp ?? msg.answer); if (msg.type === 'phone_camera_ice' && msg.candidate) await pc.addIceCandidate(msg.candidate).catch(() => {}); };
    const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
    ws.send(JSON.stringify({ type: 'phone_camera_offer', sessionId, sdp: pc.localDescription }));
    let live = false;
    for (let i = 0; i < 40 && !live; i++) { await new Promise((r) => setTimeout(r, 250)); live = (G.phoneFeeds.sessions() ?? []).some((s) => s.state?.phase === 'live'); }
    await new Promise((r) => setTimeout(r, A.ms));
    ws.send(JSON.stringify({ type: 'phone_camera_stop', sessionId }));
    clearInterval(tick); pc.close(); ws.close();
    return { live };`, { ms: ctx.rng.int(2000, 8000) }, 40000);
  if (r?.skip) return ctx.skip(r.skip);
  ctx.assert(r?.live, 'the fake phone camera never went live');
});

// ── Timeline ──────────────────────────────────────────────────────────
def('timeline', 'timeline.open', 2, 20, async (ctx) => {
  await ctx.showStep({ do: 'show.open', doc: 'timeline' });
  await sleep(500);
  ctx.assert((await ctx.state()).timelineDoc === 'timeline', 'the Timeline did not open');
}, (st) => st.timelineDoc !== 'timeline' || !st.timelineOpen);

def('timeline', 'timeline.addSong', 2, 90, async (ctx) => {
  const file = ctx.rng.pick(SONGS);
  ctx.note(file);
  const before = (await ctx.state()).songs;
  if (ctx.rng.bool(0.5) && before === 0) {
    await ctx.showStep({ do: 'show.dropSong', file });
  } else {
    await ctx.showStep({ do: 'show.song', file, at: before === 0 ? 0 : ctx.rng.int(0, 30) });
  }
  const after = (await ctx.state()).songs;
  ctx.assert(after > before, `song count ${before} -> ${after}`);
}, (st) => st.timelineDoc === 'timeline' && st.timelineOpen && st.songs < 3);

def('timeline', 'timeline.autoShow', 3, 180, async (ctx) => {
  // ✦ Auto show through its dialog with real clicks. On a Timeline that
  // already has one, the dialog may have nothing left to add (Build is off):
  // that is the app saying so, not a failure, so the dialog is closed again.
  const style = ctx.rng.pick(AUTO_STYLES);
  const opener = ctx.rng.bool(0.5) ? '[data-auto-show-song]' : '[data-auto-show-open]';
  if (!(await ctx.click(opener)) && !(await ctx.click('[data-auto-show-song], [data-auto-show-open]'))) return ctx.skip('no Auto show button on screen');
  const listened = await ctx.waitFor(`!!document.querySelector('[data-auto-build], [data-auto-error]')`, 120000);
  ctx.assert(listened, 'the Auto show dialog never finished listening to the song');
  const error = await ctx.page(`return document.querySelector('[data-auto-error]')?.textContent ?? null;`);
  ctx.assert(!error, `Auto show: ${error}`);
  await ctx.click(`[data-auto-style="${style}"]`);
  await sleep(600);
  const canBuild = await ctx.page(`const b = document.querySelector('[data-auto-build]'); return !!b && !b.disabled;`);
  if (!canBuild) {
    await ctx.click('.auto-modal .auto-cancel');
    await sleep(300);
    return ctx.skip(`${style}: nothing left to add (the Timeline already has an Auto show)`);
  }
  const t0 = Date.now();
  await ctx.click('[data-auto-build]');
  const built = await ctx.waitFor(`document.querySelector('[data-auto-phase]')?.dataset.autoPhase === 'done' && S.show().isPlaying`, 30000);
  ctx.assert(built, `${style}: the show was not built and playing within 30 s`);
  const r = await ctx.page(`const s = S.show(); return { sections: s.sections.length, blocks: s.layerTracks.filter((t) => t.subRow).reduce((n, t) => n + t.clips.length, 0) + s.lookClips.length + s.stageClips.length };`);
  ctx.note(`${style}: ${r.blocks} blocks, ${r.sections} sections, built in ${Date.now() - t0} ms`);
  ctx.assert(r.blocks > 0, `${style}: Auto show laid down nothing`);
  await ctx.click('[data-auto-done]');
  await sleep(3000);
  await ctx.expectFrames('auto show playing');
}, (st) => st.timelineDoc === 'timeline' && st.timelineOpen && st.songs > 0 && st.layers > 0);

def('timeline', 'timeline.transport', 4, 30, async (ctx) => {
  const op = ctx.rng.pick(['play', 'pause', 'seek', 'seek', 'stop', 'go']);
  ctx.note(op);
  if (op === 'play') {
    await ctx.showStep({ do: 'show.play', from: ctx.rng.int(0, 20) });
    await sleep(1500);
    const t0 = await ctx.page(`return S.show().currentTime;`);
    await sleep(1000);
    const t1 = await ctx.page(`return S.show().currentTime;`);
    const playing = await ctx.page(`return S.show().isPlaying;`);
    if (playing) ctx.assert(t1 > t0, `the playhead did not advance (${t0} -> ${t1})`);
  } else if (op === 'pause') await ctx.showStep({ do: 'show.pause' });
  else if (op === 'stop') await ctx.showStep({ do: 'show.stop' });
  else if (op === 'go') {
    const r = await ctx.page(`return G.showSeams.fireShowAction({ kind: 'go' });`);
    if (!r?.ok) ctx.note(`GO: ${r?.reason ?? 'refused'}`);
  } else {
    const t = ctx.rng.float(0, 30);
    await ctx.showStep({ do: 'show.seek', t, settle: 400 });
    const now = await ctx.page(`return S.show().currentTime;`);
    const playing = await ctx.page(`return S.show().isPlaying;`);
    if (!playing) ctx.assert(Math.abs(now - t) < 0.6, `seek to ${t.toFixed(2)} landed at ${now}`);
  }
}, (st) => st.timelineOpen);

def('timeline', 'timeline.sections', 2, 120, async (ctx) => {
  const st = await ctx.state();
  if (!st.sections) {
    const r = await ctx.page(`return await G.timelineScore.score();`, {}, 110000);
    ctx.assert(r?.ok, `scoring the song failed: ${r?.reason}`);
    ctx.note('scored the song');
    return;
  }
  const idx = ctx.rng.int(0, st.sections - 1);
  const r = await ctx.page(`return G.showSeams.fireShowAction({ kind: 'section', index: A.idx });`, { idx });
  ctx.note(`jump to section ${idx}: ${r?.ok ? 'ok' : r?.reason}`);
  if (ctx.rng.bool(0.5)) await ctx.page(`G.showSeams.fireShowAction({ kind: 'go' });`);
}, (st) => st.timelineOpen && st.songs > 0);

def('timeline', 'timeline.screenFx', 3, 20, async (ctx) => {
  const fx = ctx.rng.pick(SCREEN_FX);
  const at = ctx.rng.float(0, 30); const duration = ctx.rng.float(0.5, 6);
  ctx.note(`${fx.type} at ${at.toFixed(1)}`);
  const before = await ctx.page(`return S.show().stageClips.length;`);
  await ctx.showStep({ do: 'show.stageBlock', ...fx, at, duration, ...(fx.row === 'effects' ? {} : {}) });
  const after = await ctx.page(`return S.show().stageClips.length;`);
  ctx.assert(after === before + 1, `Screen FX block not placed (${before} -> ${after})`);
}, (st) => st.timelineDoc === 'timeline' && st.timelineOpen);

def('timeline', 'timeline.line', 3, 20, async (ctx) => {
  const st = await ctx.state();
  const n = ctx.rng.int(2, 6);
  const points = Array.from({ length: n }, (_, i) => [i * ctx.rng.float(1, 4), ctx.rng.float(0, 1)]).sort((a, b) => a[0] - b[0]);
  const r = await ctx.page(`
    const layers = S.project().layers.filter((l) => l.type !== 'group');
    if (!layers.length) return null;
    const l = layers[Math.floor(A.pick * layers.length)];
    const before = S.show().lines.length;
    const line = { id: crypto.randomUUID(), target: { scope: 'layer', id: l.id }, key: 'layer:opacity', kind: 'continuous', min: 0, max: 1, points: A.points.map(([t, v]) => ({ t, v })), follow: null, label: 'Opacity' };
    G.showTimeline.editLines((list) => [...list, line].slice(-12));
    await new Promise((r) => setTimeout(r, 200));
    return { name: l.name, before, after: S.show().lines.length };`, { pick: ctx.rng.next(), points });
  if (!r) return ctx.skip('no layers');
  ctx.note(`${r.name}: ${n} points`);
  ctx.assert(r.after >= Math.min(r.before + 1, 12), `control line not added (${r.before} -> ${r.after})`);
}, (st) => st.timelineDoc === 'timeline' && st.timelineOpen && st.layers > 0);

def('timeline', 'timeline.liveKey', 2, 60, async (ctx) => {
  // Live key take: arm Live key, play, turn a "knob" (the path a learned MIDI
  // knob drives), stop and keep or throw away the take.
  if (!(await ctx.click('[data-line-record] [data-live-edit]'))) return ctx.skip('no Live key button on screen');
  await ctx.showStep({ do: 'show.play', from: ctx.rng.int(0, 10) });
  const layerId = await ctx.page(`return S.project().layers.find((l) => l.type !== 'group')?.id ?? null;`);
  const before = await ctx.page(`return S.show().lines.reduce((n, l) => n + l.points.length, 0);`);
  const steps = ctx.rng.int(10, 40);
  for (let i = 0; i < steps; i++) {
    const v = 0.5 + 0.5 * Math.sin(i / 3 + ctx.rng.float(0, 0.3));
    await ctx.page(`G.showControl.midiRouter.dispatchPath(A.path, A.v, A.layerId ? { layerId: A.layerId } : undefined);`, { path: layerId ? 'map:layer:opacity' : 'vj:0:opacity', v, layerId });
    await sleep(60);
  }
  const keep = ctx.rng.bool(0.6);
  const ended = (await ctx.click(keep ? '[data-live-update]' : '[data-live-discard]')) || (await ctx.click('[data-live-stop]')) || (await ctx.click('[data-line-record] [data-live-edit]'));
  await ctx.showStep({ do: 'show.pause' });
  const after = await ctx.page(`return S.show().lines.reduce((n, l) => n + l.points.length, 0);`);
  ctx.note(`${steps} knob moves, ${keep ? 'kept' : 'discarded'}; line points ${before} -> ${after}${ended ? '' : ' (no stop button found)'}`);
  // Leave Live key off.
  if (await ctx.page(`return !!document.querySelector('[data-line-record] [data-live-edit][aria-pressed="true"], [data-line-record] [data-live-edit].on, [data-line-record] [data-live-edit].active');`)) await ctx.click('[data-line-record] [data-live-edit]');
}, (st) => st.timelineDoc === 'timeline' && st.timelineOpen && st.layers > 0);

def('timeline', 'timeline.takeover', 2, 40, async (ctx) => {
  const r = await ctx.page(`
    const sh = S.show();
    let track = sh.layerTracks[0];
    if (!track) {
      const l = S.project().layers.find((x) => x.type !== 'group');
      if (!l) return { skip: 'no layers' };
      const id = G.showTracks.addTrackForLayer(l.id);
      if (!id) return { skip: 'no track' };
      await new Promise((r) => setTimeout(r, 300));
      track = S.show().layerTracks.find((t) => t.id === id);
    }
    const source = A.kind === 'vjRow' ? { kind: 'vjRow', deck: 'A', row: A.row } : { kind: A.kind };
    const ok = G.takeover.takeOverTrack(track.id, source, { fadeIn: A.fade });
    await new Promise((r) => setTimeout(r, A.hold));
    const summary = JSON.stringify(G.takeover.summary() ?? null).slice(0, 160);
    if (A.all) G.takeover.store.release('all'); else G.takeover.returnTrack(track.id);
    await new Promise((r) => setTimeout(r, 400));
    return { ok, summary };`, { kind: ctx.rng.pick(['vjRow', 'vjMix', 'black']), row: ctx.rng.int(0, 2), fade: ctx.rng.pick([0, 0, 0.5]), hold: ctx.rng.int(500, 3000), all: ctx.rng.bool(0.3) }, 30000);
  if (r?.skip) return ctx.skip(r.skip);
  ctx.note(r.summary);
  ctx.assert(r.ok, 'takeover was refused');
}, (st) => st.timelineDoc === 'timeline' && st.timelineOpen);

def('timeline', 'timeline.performPads', 1, 30, async (ctx) => {
  if (!(await ctx.click('[data-perform-toggle]'))) return ctx.skip('no Perform toggle on screen');
  await sleep(600);
  for (let i = 0; i < ctx.rng.int(1, 5); i++) {
    const pads = await ctx.page(`return [...document.querySelectorAll('[data-takeover-pads] [data-pad], [data-perform-go]')].length;`);
    if (!pads) break;
    await ctx.clickExpr(`[...document.querySelectorAll('[data-takeover-pads] [data-pad], [data-perform-go]')][${ctx.rng.int(0, 1000)} % ${pads}]`);
    await sleep(ctx.rng.int(200, 1200));
  }
  await ctx.click('[data-takeover-return-all]');
  await ctx.click('[data-perform-toggle]');
}, (st) => st.timelineOpen);

def('timeline', 'timeline.undoStorm', 2, 60, async (ctx) => {
  const n = ctx.rng.int(5, 30);
  const mod = process.platform === 'darwin' ? 4 : 2;
  await ctx.page(`document.activeElement?.blur?.();`);
  for (let i = 0; i < n; i++) await ctx.key('z', { code: 'KeyZ', keyCode: 90, modifiers: mod });
  const redo = ctx.rng.int(0, n);
  for (let i = 0; i < redo; i++) await ctx.key('z', { code: 'KeyZ', keyCode: 90, modifiers: mod | 8 });
  ctx.note(`${n} undo, ${redo} redo`);
  await sleep(800);
  ctx.assert(await ctx.page(`return Array.isArray(S.project().layers) && Array.isArray(S.show().lines);`), 'stores unreadable after undo/redo');
});

// ── Interactive world ─────────────────────────────────────────────────
def('interactive', 'interactive.studio', 2, 60, async (ctx) => {
  const id = await ctx.page(`
    const id = G.project.addLayer('Soak world', 'interactive');
    if (!id) return null;
    await new Promise((r) => setTimeout(r, 300));
    window.dispatchEvent(new CustomEvent('open-interactive-studio', { detail: { layerId: id } }));
    return id;`);
  ctx.assert(id, 'could not add an interactive layer');
  const open = await ctx.waitFor(`!!document.querySelector('[aria-label="Close Interactive Studio"]')`, 15000);
  ctx.assert(open, 'the Interactive Studio did not open');
  // Tabs, modes and play tools with real clicks.
  for (let i = 0; i < ctx.rng.int(2, 6); i++) {
    const which = ctx.rng.pick(['nav.inspector-tabs button', '.canvas-toolbar [aria-label="Stage mode"] button', '.stage-tools button']);
    await ctx.clickNth(which, ctx.rng.int(0, 10));
    await sleep(ctx.rng.int(200, 900));
  }
  // Touch the stage a few times (play mode draws/pokes the world).
  for (let i = 0; i < ctx.rng.int(1, 4); i++) await ctx.monkeyDrag({ within: 'canvas' });
  await ctx.click('[aria-label="Close Interactive Studio"]');
  const closed = await ctx.waitFor(`!document.querySelector('[aria-label="Close Interactive Studio"]')`, 10000);
  ctx.assert(closed, 'the Interactive Studio did not close');
  // A trigger zone written into the world, as the Objects tab would.
  const zone = await ctx.page(`
    const l = S.project().layers.find((x) => x.id === A.id);
    const scene = l?.source?.effectSource?.interactiveScene;
    if (!scene) return { skip: true };
    const surfaces = [...(scene.surfaces ?? []), { id: crypto.randomUUID(), name: 'Soak zone', behavior: 'trigger', points: A.pts }];
    G.project.updateLayer(l.id, { source: { ...l.source, effectSource: { ...l.source.effectSource, interactiveScene: { ...scene, surfaces } } } });
    await new Promise((r) => setTimeout(r, 300));
    const after = S.project().layers.find((x) => x.id === A.id)?.source?.effectSource?.interactiveScene?.surfaces?.length ?? 0;
    return { after, want: surfaces.length };`, { id, pts: [{ x: 0.3, y: 0.3 }, { x: 0.6, y: 0.3 }, { x: 0.6, y: 0.6 }, { x: 0.3, y: 0.6 }] });
  if (zone?.skip) ctx.note('no interactive scene on the layer to add a zone to');
  else ctx.assert(zone.after === zone.want, `trigger zone not saved (${zone.after}/${zone.want})`);
  await ctx.expectFrames('interactive world');
  if (ctx.rng.bool(0.5)) await ctx.page(`G.project.removeLayer(A.id);`, { id });
}, (st) => st.layers < 40 && !st.studioOpen);

// ── Render to video ───────────────────────────────────────────────────
def('render', 'render.short', 2, 300, async (ctx) => {
  const seconds = ctx.rng.pick([1, 2, 3]);
  const fps = ctx.rng.pick([24, 30, 60]);
  const [width, height] = ctx.rng.pick([[640, 360], [960, 540], [1280, 720]]);
  const codec = ctx.rng.pick([null, null, 'prores_hq', 'hap']);
  ctx.note(`${seconds}s ${width}x${height}@${fps} ${codec ?? 'h264'}`);
  await ctx.showStep({ do: 'show.export', seconds, fps, width, height, ...(codec ? { codec } : {}), quality: 'web' });
  const file = ctx.showVars().exportFile;
  ctx.assert(file && fs.existsSync(file), `no output file (${file})`);
  const info = probeVideo(file);
  const kept = ctx.keepRender(file);
  ctx.note(`${path.basename(file)}: ${info.width}x${info.height} ${info.frames} frames ${info.codec}`);
  ctx.assert(info.width === width && info.height === height, `render is ${info.width}x${info.height}, asked for ${width}x${height} (${kept})`);
  const want = seconds * fps;
  ctx.assert(Math.abs(info.frames - want) <= 1, `render has ${info.frames} frames, expected ${want} (${kept})`);
  if (info.meanLuma !== null && info.meanLuma < 0.004 && (await ctx.contentExpected())) ctx.warn(`render looks black (mean ${info.meanLuma.toFixed(4)}) (${kept})`);
});

// ── Projects ──────────────────────────────────────────────────────────
def('project', 'project.saveReopen', 2, 90, async (ctx) => {
  const file = path.join(ctx.profile(), 'project-assets', `soak-${ctx.step}.gha`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const r = await ctx.page(`
    const json = await G.project.exportProjectJSONForSave();
    const content = typeof json === 'string' ? json : JSON.stringify(json);
    const before = S.project().layers.map((l) => l.name + ':' + l.type);
    const saved = await window.electronAPI.invoke('save_project_file', { path: A.file, content });
    if (!saved?.success) return { error: 'save: ' + JSON.stringify(saved).slice(0, 200) };
    const read = await window.electronAPI.invoke('read_project_file', { path: A.file });
    if (!read?.content) return { error: 'read: ' + JSON.stringify(read).slice(0, 200) };
    const ok = await G.project.importProject(JSON.parse(read.content), read.dir);
    await new Promise((r) => setTimeout(r, 1500));
    const after = S.project().layers.map((l) => l.name + ':' + l.type);
    return { ok, bytes: content.length, before, after };`, { file }, 80000);
  ctx.assert(!r.error, r.error);
  ctx.note(`${(r.bytes / 1024).toFixed(0)} KB, ${r.before.length} layers`);
  ctx.assert(r.ok !== false, 'importProject refused the file it just saved');
  ctx.assert(JSON.stringify(r.before) === JSON.stringify(r.after), `layers changed on reopen: ${r.before.length} -> ${r.after.length}`);
  try { fs.rmSync(file, { force: true }); } catch { /* kept */ }
  await ctx.expectFrames('reopened project');
});

// ── Settings ──────────────────────────────────────────────────────────
def('settings', 'settings.toggle', 2, 15, async (ctx) => {
  const t = ctx.rng.pick(SETTING_TOGGLES);
  const r = await ctx.page(`
    const get = (o, p) => p.split('.').reduce((x, k) => x?.[k], o);
    const readPath = A.t.read ?? A.t.path.join('.');
    const before = get(G.settings.get(), readPath);
    if (A.t.call) G.settings[A.t.call]();
    else G.settings.update((s) => ({ ...s, [A.t.path[0]]: { ...s[A.t.path[0]], [A.t.path[1]]: !before } }));
    await new Promise((r) => setTimeout(r, 200));
    return { before, after: get(G.settings.get(), readPath) };`, { t });
  ctx.note(`${t.name}: ${r.before} -> ${r.after}`);
  ctx.assert(!!r.before !== !!r.after, `${t.name} did not change`);
});

// ── Window ────────────────────────────────────────────────────────────
def('window', 'window.resize', 2, 20, async (ctx) => {
  const w = ctx.rng.int(1000, 1920); const h = ctx.rng.int(650, 1080);
  ctx.note(`${w}x${h}`);
  const how = await ctx.resizeWindow(w, h);
  ctx.note(how);
  await sleep(800);
  // The interface scale setting zooms the page, so compare shapes, not pixels.
  const inner = await ctx.page(`return { w: innerWidth, h: innerHeight };`);
  ctx.assert(Math.abs(inner.w / inner.h - w / h) < 0.03, `the editor is ${inner.w}x${inner.h}, asked for ${w}x${h} (${how})`);
  await sleep(ctx.rng.int(1000, 4000));
  await ctx.expectFrames('after a resize');
});

def('output', 'output.toggle', 2, 40, async (ctx) => {
  // The toolbar's own Output Window button, clicked for real; its title says
  // which way it will go next.
  const open = await ctx.page(`return !!document.querySelector('button.output-btn[title="Close Output Window"]');`);
  const sel = open ? 'button.output-btn[title="Close Output Window"]' : 'button.output-btn[title="Open Output Window"]';
  if (!(await ctx.click(sel))) return ctx.skip('no Output Window button on screen');
  ctx.note(open ? 'close' : 'open');
  const flipped = await ctx.waitFor(`!!document.querySelector('button.output-btn[title="${open ? 'Open' : 'Close'} Output Window"]')`, 15000);
  ctx.assert(flipped, `the output window did not ${open ? 'close' : 'open'}`);
  ctx.rehide();
  await sleep(ctx.rng.int(1000, 5000));
  await ctx.expectFrames(open ? 'output window closed' : 'output window open');
});

// ── Monkey (seeded real input on whatever is on screen) ───────────────
def('monkey', 'monkey.click', 6, 20, async (ctx) => {
  const n = ctx.rng.int(1, 5);
  for (let i = 0; i < n; i++) await ctx.monkeyClick({});
});
def('monkey', 'monkey.drag', 3, 20, async (ctx) => {
  for (let i = 0; i < ctx.rng.int(1, 3); i++) await ctx.monkeyDrag({});
});
def('monkey', 'monkey.slider', 3, 20, async (ctx) => {
  for (let i = 0; i < ctx.rng.int(1, 4); i++) await ctx.monkeyClick({ selector: 'input[type="range"]', randomX: true });
});
def('monkey', 'monkey.keys', 3, 20, async (ctx) => {
  const keys = [
    ['Escape', 'Escape', 27], ['ArrowLeft', 'ArrowLeft', 37], ['ArrowRight', 'ArrowRight', 39], ['ArrowUp', 'ArrowUp', 38], ['ArrowDown', 'ArrowDown', 40],
    [' ', 'Space', 32], ['Tab', 'Tab', 9], ['1', 'Digit1', 49], ['2', 'Digit2', 50], ['3', 'Digit3', 51], ['g', 'KeyG', 71], ['b', 'KeyB', 66],
  ];
  const n = ctx.rng.int(1, 8);
  const pressed = [];
  for (let i = 0; i < n; i++) {
    const [key, code, keyCode] = ctx.rng.pick(keys);
    pressed.push(code);
    await ctx.key(key, { code, keyCode, text: key.length === 1 ? key : undefined });
    await sleep(ctx.rng.int(50, 300));
  }
  ctx.note(pressed.join(' '));
  // B is blackout: never leave the output black for the next checks.
  await ctx.page(`if (G.settings.get().output?.blackout) G.settings.update((s) => ({ ...s, output: { ...s.output, blackout: false } }));`);
});

export const ACTIONS = A;
export const AREAS = [...new Set(A.map((a) => a.area))];
export { MONKEY_DENY };
