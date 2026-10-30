// The Show Runner's vocabulary. Actions map onto the app's own stores (the
// same calls the UI makes) or real input (file drops, clicks); checks read
// the render core's actual output, not what the UI thinks it shows.
import { fixture, NAMED_RGB } from './fixtures.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;

/** Page-side helpers, installed once per page. */
export const PAGE_HELPERS = `(() => {
  if (window.__show) return true;
  const g = () => window.__ghostArcade;
  const read = (store) => { let v; store.subscribe((x) => { v = x; })(); return v; };
  window.__show = {
    g, read,
    deck: () => read(g().vjClipLauncher),
    project: () => read(g().project),
    async snapshot(opts = {}) {
      const s = await window.electronAPI.invoke('native_renderer_get_frame_snapshot', { include_pixels: false, ...opts }).catch(() => null);
      return s && s.mean_rgba ? s : null;
    },
    async shaderClip(name, values = {}) {
      const src = './ISF/' + (name + '.fs').split('/').map(encodeURIComponent).join('/');
      const code = await (await fetch(src)).text();
      return { id: crypto.randomUUID(), type: 'shader', name, src, shaderCode: code, shaderValues: values };
    },
    cell(row, col) {
      return document.querySelectorAll('.layer-row')[row]?.querySelectorAll('.clip-cell')[col] ?? null;
    },
  };
  return true;
})()`;

const ACTIONS = {
  async 'app.start'(ctx, s) {
    const index = { tour: 0, templates: 1, open: 2, blank: 3 }[s.choice ?? 'blank'];
    await ctx.eval(`(async () => {
      // The welcome screen waits for the loading splash to fade out.
      for (let i = 0; i < 50 && !document.querySelector('.welcome .choice'); i++) await new Promise((r) => setTimeout(r, 200));
      [...document.querySelectorAll('.close-modal-backdrop button')].find((b) => /Discard/.test(b.textContent))?.click();
      document.querySelectorAll('.welcome .choice')[${index}]?.click();
    })()`);
    await sleep(800);
  },
  async 'deck.open'(ctx, s) {
    await ctx.eval(`(() => { const L = __show.g().vjClipLauncher; L.setOpen(true); ${s.live === false ? '' : 'L.setLive(true);'} })()`);
    await sleep(1500);
  },
  async 'deck.rows'(ctx, s) {
    await ctx.eval(`(() => { const L = __show.g().vjClipLauncher; while (__show.deck().numLayers < ${s.count}) L.addLayer(); })()`);
    await sleep(1000);
  },
  async 'deck.live'(ctx, s) { await ctx.eval(`__show.g().vjClipLauncher.setLive(${s.on !== false})`); },
  async 'deck.drop'(ctx, s) {
    const files = (s.clips ?? [s.clip]).map(fixture);
    await ctx.session.dropFiles(`__show.cell(${s.row}, ${s.col})`, files);
    await sleep(1500 + 400 * files.length);
  },
  async 'deck.shader'(ctx, s) {
    await ctx.eval(`(async () => {
      const clip = await __show.shaderClip(${J(s.shader)}, ${J(s.values ?? {})});
      __show.g().vjClipLauncher.setClip(${s.row}, ${s.col}, clip, ${J(s.deck ?? 'A')});
    })()`);
  },
  async 'deck.trigger'(ctx, s) { await ctx.eval(`__show.g().vjClipLauncher.triggerClip(${s.row}, ${s.col}, ${J(s.deck ?? 'A')})`); },
  async 'deck.triggerColumn'(ctx, s) { await ctx.eval(`__show.g().vjClipLauncher.triggerColumn(${s.col}, ${J(s.deck ?? 'A')})`); },
  async 'deck.stopRow'(ctx, s) {
    // The row's own stop button, so the UI path is exercised.
    await ctx.eval(`(() => {
      const b = document.querySelectorAll('.layer-row')[${s.row}]?.querySelector('button[title^="Stop layer"]');
      if (b) b.click(); else __show.g().vjClipLauncher.stopLayer(${s.row}, ${J(s.deck ?? 'A')});
    })()`);
  },
  async 'deck.stopAll'(ctx) { await ctx.eval('__show.g().vjClipLauncher.stopAll()'); },
  async 'deck.dragRow'(ctx, s) { await ctx.eval(`__show.g().vjClipLauncher.reorderLayers(${s.from}, ${s.to})`); },
  async 'deck.fader'(ctx, s) { await ctx.eval(`__show.g().vjClipLauncher.setLayerOpacity(${s.row}, ${s.value}, ${J(s.deck ?? 'A')})`); },
  async 'deck.crossfader'(ctx, s) { await ctx.eval(`__show.g().vjClipLauncher.setCrossfaderEnabled(${s.on !== false})`); },
  async 'deck.crossfade'(ctx, s) { await ctx.eval(`__show.g().vjClipLauncher.setCrossfaderValue(${s.value})`); },
  async 'template.open'(ctx, s) {
    const done = await ctx.eval(`(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      __show.g().onboarding.openTemplates();
      await sleep(600);
      const ids = ['band-stage', 'club-vj', 'psychedelic', 'mapping-starter'];
      const card = document.querySelectorAll('.tp-card')[ids.indexOf(${J(s.id)})];
      if (!card) return false;
      card.click(); await sleep(300);
      if (document.querySelector('.tp-card.confirm')) card.click();
      for (let i = 0; i < 160 && document.querySelector('.tp-backdrop'); i++) await sleep(250);
      return !document.querySelector('.tp-backdrop');
    })()`, 90000);
    if (!done) throw new Error(`template ${s.id} did not open`);
    await sleep(1000);
  },
  async 'tour.start'(ctx, s) {
    await ctx.eval(`__show.g().onboarding.startTour(${J(s.path ?? null)})`);
    await sleep(1500);
  },
  async 'tour.next'(ctx) { await ctx.eval(`document.querySelector('.tour-next')?.click()`); await sleep(1200); },
  async 'tour.action'(ctx) { await ctx.eval(`document.querySelector('.tour-action')?.click()`); await sleep(2500); },
  async 'tour.end'(ctx) { await ctx.eval('__show.g().onboarding.endTour()'); },
  async 'mapsim.open'(ctx) {
    await ctx.eval(`document.querySelector('.map-sim-btn')?.click()`);
    ctx.mapsim = await ctx.openPage((t) => t.url.includes('mode=projection-sim'));
    await sleep(2500);
  },
  async 'mapsim.preset'(ctx, s) {
    await ctx.mapsim.eval(`(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const keep = window.confirm; window.confirm = () => false;
      const sel = document.querySelector('.preset-picker select');
      sel.value = ${J(s.id)}; sel.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(300);
      [...document.querySelectorAll('.preset-picker .wide-btn')].find((b) => /Load preset/i.test(b.textContent)).click();
      await sleep(1500); window.confirm = keep;
    })()`);
  },
  async 'mapsim.automap'(ctx) {
    await ctx.mapsim.eval(`(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const button = document.querySelector('.auto-map-btn');
      button.click();
      await sleep(300);
      // Done when the button is enabled again and a fresh status is shown.
      for (let i = 0; i < 240; i++) {
        const status = document.querySelector('.auto-map-status')?.textContent ?? '';
        if (!button.disabled && /Mapped|Nothing|No room|failed/.test(status)) break;
        await sleep(250);
      }
    })()`, 60000);
    ctx.vars.automapStatus = await ctx.mapsim.eval(`document.querySelector('.auto-map-status')?.textContent ?? ''`);
    await sleep(1500);
  },
  async 'mapsim.close'(ctx) { await ctx.mapsim?.eval('window.close()').catch(() => {}); ctx.mapsim = null; await sleep(1500); },
  async 'project.groupAll'(ctx, s) {
    await ctx.eval(`(async () => {
      const g = __show.g();
      g.project.createGroupFromIds(__show.project().layers.map((l) => l.id));
      await new Promise((r) => setTimeout(r, 400));
      const group = __show.project().layers.find((l) => l.type === 'group');
      ${s.shader ? `const clip = await __show.shaderClip(${J(s.shader)});
      g.project.updateGroupConfig(group.id, { shaderMode: 'unified', shaderSource: { id: 'show-group-src', type: 'shader', src: clip.src, name: clip.name, shaderCode: clip.shaderCode, shaderValues: {} } });` : ''}
    })()`);
    await sleep(2500);
  },
  async wait(_ctx, s) { await sleep((s.seconds ?? 1) * 1000); },
  async eval(ctx, s) { ctx.vars.last = await ctx.eval(s.js, 60000); },
};

function nameRgb(name) {
  const key = String(name ?? '').toLowerCase().replace(/\.(mp4|mov)$/, '');
  return NAMED_RGB[key] ?? null;
}

function colourName(rgb) {
  let best = null; let bestD = Infinity;
  for (const [name, ref] of Object.entries(NAMED_RGB)) {
    const d = Math.hypot(rgb[0] - ref[0], rgb[1] - ref[1], rgb[2] - ref[2]);
    if (d < bestD) { bestD = d; best = name; }
  }
  return { name: best, distance: bestD };
}

const CHECKS = {
  async 'output.colour'(ctx, s) {
    const snap = await ctx.eval('__show.snapshot()');
    if (!snap) return { pass: false, detail: 'no output frame' };
    const got = colourName(snap.mean_rgba);
    return { pass: got.name === s.is && got.distance < (s.tolerance ?? 0.25), detail: `output is ${got.name} (${snap.mean_rgba.slice(0, 3).map((v) => v.toFixed(2)).join(', ')})` };
  },
  async 'output.notBlack'(ctx, s) {
    const snap = await ctx.eval('__show.snapshot()');
    const mean = snap ? (snap.mean_rgba[0] + snap.mean_rgba[1] + snap.mean_rgba[2]) / 3 : 0;
    return { pass: mean >= (s.min ?? 0.02), detail: `mean brightness ${mean.toFixed(3)}` };
  },
  async 'output.moving'(ctx) {
    const a = await ctx.eval('__show.snapshot()');
    await sleep(600);
    const b = await ctx.eval('__show.snapshot()');
    const moving = !!a && !!b && a.checksum !== b.checksum;
    return { pass: moving, detail: moving ? 'output changes over time' : 'output is frozen' };
  },
  async 'rows.match'(ctx, s) {
    // Each deck row must draw the clip the deck says it holds.
    const rows = await ctx.eval(`(async () => {
      const d = __show.deck();
      const out = [];
      for (let i = 0; i < ${s.rows ?? 4}; i++) {
        const clip = d.layerStates[i]?.activeClip;
        const snap = await __show.snapshot({ layer_id: 'vj-layer-' + i });
        out.push({ row: i, clip: clip ? clip.name : null, rgb: snap ? snap.mean_rgba.slice(0, 3) : null });
      }
      return out;
    })()`);
    const bad = [];
    for (const r of rows) {
      const want = nameRgb(r.clip);
      if (!r.clip) { if (r.rgb) bad.push(`row ${r.row + 1} is stopped but still draws`); continue; }
      if (!want) continue;
      if (!r.rgb) { bad.push(`row ${r.row + 1} should show ${r.clip} but draws nothing`); continue; }
      const got = colourName(r.rgb).name;
      if (nameRgb(got).join() !== want.join()) bad.push(`row ${r.row + 1} should show ${r.clip} but shows ${got}`);
    }
    return { pass: bad.length === 0, detail: bad.length ? bad.join('; ') : rows.map((r) => `${r.row + 1}:${r.clip ?? '-'}`).join(' ') };
  },
  async 'deck.row'(ctx, s) {
    const names = await ctx.eval(`__show.deck()[${J(s.deck === 'B' ? 'bankBClipGrid' : 'clipGrid')}][${s.row}].map((c) => c ? c.name : null)`);
    const want = s.clips.map((c) => (c === null ? null : c));
    const got = names.slice(0, want.length).map((n) => (n ? n.replace(/\.(mp4|mov)$/, '') : null));
    return { pass: J(got) === J(want), detail: `row ${s.row + 1}: ${got.map((n) => n ?? '-').join(' ')}` };
  },
  async 'deck.columns'(ctx, s) {
    const n = await ctx.eval('__show.deck().numColumns');
    return { pass: n >= (s.min ?? 0) && n <= (s.max ?? Infinity), detail: `${n} columns` };
  },
  async 'deck.blocksFull'(ctx, s) {
    const blocks = await ctx.eval(`__show.deck().blocks.map((b) => ({ name: b.name, a: b.clipGrid.flat().filter(Boolean).length, b: (b.bankBClipGrid ?? []).flat().filter(Boolean).length }))`);
    const short = blocks.filter((b) => b.a < (s.min ?? 1));
    const ok = blocks.length >= (s.blocks ?? 1) && short.length === 0;
    return { pass: ok, detail: blocks.map((b) => `${b.name}: ${b.a}${b.b ? '/' + b.b : ''}`).join(', ') };
  },
  async 'project.layers'(ctx, s) {
    const n = await ctx.eval('__show.project().layers.filter((l) => l.type !== "group").length');
    return { pass: n >= (s.min ?? 0) && n <= (s.max ?? Infinity), detail: `${n} layers` };
  },
  async 'core.noShaderError'(ctx) {
    const st = await ctx.eval(`window.electronAPI.invoke('native_renderer_get_status')`);
    const err = st?.last_shader_error ?? st?.stats?.last_shader_error ?? null;
    return { pass: !err, detail: err ? String(err) : 'no shader errors' };
  },
  async 'tour.ring'(ctx, s) {
    const r = await ctx.eval(`(() => { const t = document.querySelector('.tour-card h2')?.textContent ?? null; const ring = !!document.querySelector('.tour-ring'); return { t, ring }; })()`);
    return { pass: r.t !== null && (s.ring === false ? true : r.ring), detail: `${r.t ?? 'no card'}${r.ring ? ' (highlighted)' : ''}` };
  },
  async 'text.contains'(ctx, s) {
    const text = s.var ? String(ctx.vars[s.var] ?? '') : await ctx.eval(`document.querySelector(${J(s.selector)})?.textContent ?? ''`);
    const ok = new RegExp(s.pattern).test(text);
    return { pass: ok, detail: text.trim().slice(0, 140) };
  },
  async perf(ctx, s) {
    const r = await ctx.measurePerf(s.seconds ?? 3);
    const bad = [];
    if (s.minFps && r.coreFps < s.minFps) bad.push(`core ${r.coreFps} fps < ${s.minFps}`);
    if (s.minEditorFps && r.editorFps < s.minEditorFps) bad.push(`editor ${r.editorFps} fps < ${s.minEditorFps}`);
    if (s.maxGpuMs && r.gpuMs > s.maxGpuMs) bad.push(`GPU ${r.gpuMs} ms > ${s.maxGpuMs}`);
    ctx.perf.push({ step: ctx.stepLabel, ...r });
    return { pass: bad.length === 0, detail: bad.join('; ') || `core ${r.coreFps} fps, editor ${r.editorFps} fps, GPU ${r.gpuMs ?? '?'} ms` };
  },
  async snapshot(ctx, s) { return ctx.compareGolden(s.name, s.maxDiff ?? 0.04); },
  async noErrors(ctx) {
    const errs = ctx.session.errors.filter((e) => e.at >= ctx.startedAt && !/ResizeObserver loop|favicon/.test(e.text));
    return { pass: errs.length === 0, detail: errs.length ? errs.slice(0, 3).map((e) => e.text.slice(0, 160)).join(' | ') : 'no console errors' };
  },
};

export const ACTION_NAMES = Object.keys(ACTIONS);
export const CHECK_NAMES = Object.keys(CHECKS);

export async function runAction(ctx, step) {
  const fn = ACTIONS[step.do];
  if (!fn) throw new Error(`unknown action "${step.do}"`);
  await fn(ctx, step);
}

export async function runCheck(ctx, name, spec) {
  const fn = CHECKS[name];
  if (!fn) return { pass: false, detail: `unknown check "${name}"` };
  const opts = spec === true ? {} : spec;
  // `within: seconds` retries the check until it passes or time runs out,
  // for things that settle (a shader compiling, a clip pre-rolling).
  const until = Date.now() + (opts.within ?? 0) * 1000;
  let last;
  do {
    try {
      last = await fn(ctx, opts);
    } catch (err) {
      last = { pass: false, detail: `check failed to run: ${err.message}` };
    }
    if (last.pass || Date.now() >= until) break;
    await sleep(500);
  } while (true);
  if (opts.within && last.pass) last.detail = `${last.detail}`;
  return last;
}
