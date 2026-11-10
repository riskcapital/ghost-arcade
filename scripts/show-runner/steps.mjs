// The Show Runner's vocabulary. Actions map onto the app's own stores (the
// same calls the UI makes) or real input (file drops, clicks); checks read
// the render core's actual output, not what the UI thinks it shows.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fixture, NAMED_RGB } from './fixtures.mjs';

const require = createRequire(import.meta.url);

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
    // Show timeline + layer tracks.
    show: () => read(g().showTimeline),
    tracks: () => g().showTracks,
    vars: {},
    layerByName(name) { return __show.project().layers.find((l) => l.name === name) ?? null; },
    /** Clip media for a file on disk (fixtures). */
    fileMedia(file, seconds) {
      const name = file.split('/').pop();
      const kind = /\\.(png|jpe?g|webp)$/i.test(name) ? 'image' : 'video';
      const url = 'ghost-asset://localhost' + file.replace(/%/g, '%25').replace(/ /g, '%20').replace(/#/g, '%23');
      return { kind, name, src: url, _assetRef: { kind: 'local-file', originalPath: file, name }, ...(seconds ? { sourceDuration: seconds } : {}) };
    },
    /** Track state at the playhead, by the runner's track name. */
    trackState(name) {
      const id = __show.vars['track:' + name];
      return __show.tracks().frame()?.tracks.find((t) => t.trackId === id) ?? null;
    },
    /** Scene layer id a track draws on: the layer itself, or its injected copy. */
    trackLayerId(name) {
      const id = __show.vars['track:' + name];
      const track = __show.show().layerTracks.find((t) => t.id === id);
      if (!track) return null;
      return __show.project().layers.some((l) => l.id === track.layerId) ? track.layerId : 'showtrack::' + track.layerId;
    },
  };
  return true;
})()`;

const ACTIONS = {
  async 'app.start'(ctx, s) {
    // open, blank, tour, templates or song
    const choice = `.welcome .choice[data-choice="${s.choice ?? 'blank'}"]`;
    await ctx.eval(`(async () => {
      // The welcome screen waits for the loading splash to fade out.
      for (let i = 0; i < 50 && !document.querySelector('.welcome .choice'); i++) await new Promise((r) => setTimeout(r, 200));
      [...document.querySelectorAll('.close-modal-backdrop button')].find((b) => /Discard/.test(b.textContent))?.click();
      document.querySelector(${J(choice)})?.click();
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
  // ── Show timeline and layer tracks ───────────────────────────────────
  async 'project.layer'(ctx, s) {
    // A media layer showing a solid colour (its "own content").
    await ctx.eval(`(async () => {
      const g = __show.g();
      const id = g.project.addLayer(${J(s.name)}, 'media');
      await new Promise((r) => setTimeout(r, 300));
      const rgb = ${J(NAMED_RGB[s.colour] ?? [1, 1, 1])};
      const clip = await __show.shaderClip('DM-SolidColor', { baseColor: [...rgb, 1] });
      g.project.setLayerSource(id, { id: crypto.randomUUID(), type: 'shader', src: clip.src, name: clip.name, shaderCode: clip.shaderCode, shaderValues: clip.shaderValues });
      ${s.x0 !== undefined ? `g.project.updateLayer(id, { corners: { topLeft: { x: ${s.x0}, y: 1 }, topRight: { x: ${s.x1}, y: 1 }, bottomLeft: { x: ${s.x0}, y: 0 }, bottomRight: { x: ${s.x1}, y: 0 } } });` : ''}
      __show.vars['layer:' + ${J(s.name)}] = id;
    })()`);
    await sleep(800);
  },
  async 'project.layerColour'(ctx, s) {
    await ctx.eval(`(async () => {
      const g = __show.g();
      const layer = __show.layerByName(${J(s.name)});
      const clip = await __show.shaderClip('DM-SolidColor', { baseColor: [...${J(NAMED_RGB[s.colour] ?? [1, 1, 1])}, 1] });
      g.project.setLayerSource(layer.id, { id: crypto.randomUUID(), type: 'shader', src: clip.src, name: clip.name, shaderCode: clip.shaderCode, shaderValues: clip.shaderValues });
    })()`);
    await sleep(600);
  },
  async 'project.removeLayer'(ctx, s) {
    await ctx.eval(`(() => { const l = __show.layerByName(${J(s.name)}); if (l) __show.g().project.removeLayer(l.id); })()`);
    await sleep(500);
  },
  async 'preset.save'(ctx, s) {
    await ctx.eval(`(() => { __show.vars['preset:' + ${J(s.name)}] = __show.g().project.saveComposition(${J(s.name)}); })()`);
    await sleep(300);
  },
  async 'show.open'(ctx, s) { await ctx.eval(`__show.g().showTimeline.setOpen(${s.open !== false})`); await sleep(500); },
  async 'show.preset'(ctx, s) {
    const id = await ctx.eval(`__show.g().showTimeline.insertPresetClipAt(__show.vars['preset:' + ${J(s.name)}], ${s.at ?? 0}, ${s.duration ?? 10}, ${J(s.name)})`);
    if (!id) throw new Error(`preset clip ${s.name} was not placed`);
    if (s.cut !== false) await ctx.eval(`__show.g().showTimeline.removeTransitionAt(${J(id)})`);
  },
  async 'show.track'(ctx, s) {
    // { name, layer } tracks an existing layer; { name, newLayer } makes one.
    const id = await ctx.eval(`(() => {
      const t = __show.tracks();
      const id = ${s.newLayer ? `t.addTrackForNewLayer(${J(s.newLayer)}, { addToPresets: ${s.addToPresets !== false} })` : `t.addTrackForLayer(__show.layerByName(${J(s.layer ?? s.name)})?.id)`};
      __show.vars['track:' + ${J(s.name)}] = id;
      return id;
    })()`);
    if (!id) throw new Error(`no track for ${s.layer ?? s.newLayer ?? s.name}`);
    await sleep(300);
  },
  async 'show.subRow'(ctx, s) {
    // "+ Layer" on a piece's row: { name, track } (the piece's row name).
    const id = await ctx.eval(`(() => {
      const row = __show.show().layerTracks.find((t) => t.id === __show.vars['track:' + ${J(s.track)}]);
      const id = row ? __show.tracks().addSubRow(row.layerId, ${J(s.label ?? s.name)}) : null;
      __show.vars['track:' + ${J(s.name)}] = id;
      return id;
    })()`);
    if (!id) throw new Error(`no layer added on ${s.track}`);
    await sleep(300);
  },
  async 'show.blockParam'(ctx, s) {
    // Click a block, then move one of its shader inputs as the Shader
    // Parameters panel does: { clip (var), name, value }.
    const ok = await ctx.eval(`(async () => {
      const t = __show.tracks();
      return (await t.editBlock(__show.vars['clip:' + ${J(s.clip)}])) && (await t.setBlockShaderValue(${J(s.name)}, ${J(s.value)}, false));
    })()`);
    if (!ok) throw new Error(`could not edit block ${s.clip}`);
    await sleep(400);
  },
  async 'show.trackSet'(ctx, s) {
    const patch = {};
    for (const k of ['gap', 'muted', 'locked']) if (s[k] !== undefined) patch[k] = s[k];
    await ctx.eval(`__show.g().showTimeline.updateLayerTrack(__show.vars['track:' + ${J(s.track)}], ${J(patch)})`);
    await sleep(300);
  },
  async 'show.clip'(ctx, s) {
    // Media: `clip` (a fixture file, `seconds` long), `shader` (+ values) or `colour`.
    const file = s.clip ? fixture(s.clip) : null;
    const seconds = s.seconds ?? (s.clip && /^ramp/.test(s.clip) ? 10 : s.clip ? 4 : undefined);
    const opts = {};
    for (const k of ['duration', 'inPoint', 'endBehaviour', 'fadeIn', 'fadeOut', 'rate', 'opacity', 'blendMode', 'transitionIn', 'transitionDuration']) if (s[k] !== undefined) opts[k] = s[k];
    const id = await ctx.eval(`(async () => {
      let media;
      ${file ? `media = __show.fileMedia(${J(file)}, ${seconds ?? 'undefined'});` : ''}
      ${s.shader || s.colour ? `const c = await __show.shaderClip(${J(s.shader ?? 'DM-SolidColor')}, ${J(s.colour ? { baseColor: [...(NAMED_RGB[s.colour] ?? [1, 1, 1]), 1] } : (s.values ?? {}))}); media = { kind: 'shader', name: c.name, src: c.src, shaderCode: c.shaderCode, shaderValues: c.shaderValues };` : ''}
      ${s.layerContent ? `media = { kind: 'layer', name: 'layer', src: '' };` : ''}
      const id = __show.g().showTimeline.addLayerClip(__show.vars['track:' + ${J(s.track)}], media, ${s.at ?? 0}, ${J(opts)});
      if (id && ${J(s.var ?? null)}) __show.vars['clip:' + ${J(s.var ?? '')}] = id;
      return id;
    })()`);
    if (!id) throw new Error(`clip on ${s.track} was not placed`);
    await sleep(300);
  },
  async 'show.lane'(ctx, s) {
    // A keyframe lane under a track: { track, key, label, type, keys: [[t, v], ...] }.
    await ctx.eval(`(() => {
      const st = __show.g().showTimeline;
      const id = __show.vars['track:' + ${J(s.track)}];
      st.addTrackLane(id, { key: ${J(s.key ?? 'layer:opacity')}, label: ${J(s.label ?? 'Opacity')}, type: ${J(s.type ?? 'number')} });
      for (const [t, v] of ${J(s.keys ?? [])}) st.setLaneKey(id, ${J(s.key ?? 'layer:opacity')}, t, v);
    })()`);
    await sleep(300);
  },
  async 'show.split'(ctx, s) { await ctx.eval(`__show.g().showTimeline.splitLayerClips(${s.at})`); await sleep(300); },
  async 'show.seek'(ctx, s) { await ctx.eval(`__show.g().showTimeline.seek(${s.t})`); await sleep(s.settle ?? 600); },
  async 'show.play'(ctx, s) {
    if (s.from !== undefined) await ctx.eval(`__show.g().showTimeline.seek(${s.from})`);
    await ctx.eval('__show.g().showTimeline.play()');
  },
  async 'show.pause'(ctx) { await ctx.eval('__show.g().showTimeline.pause()'); await sleep(400); },
  async 'show.stop'(ctx) { await ctx.eval('__show.g().showTimeline.stop()'); await sleep(400); },
  async 'show.selectPreset'(ctx, s) {
    await ctx.eval(`(() => { const sh = __show.show(); const c = sh.presetClips[${s.index ?? 0}]; __show.g().showTimeline.select({ kind: 'preset', id: c.id }); })()`);
  },
  async 'project.select'(ctx, s) { await ctx.eval(`__show.g().project.selectLayer(__show.layerByName(${J(s.name)}).id)`); },
  async 'ui.hover'(ctx, s) {
    const rect = await ctx.eval(`(() => { const r = document.querySelector(${J(s.selector)})?.getBoundingClientRect(); return r ? { x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 40) } : null; })()`);
    if (!rect) throw new Error(`nothing at ${s.selector}`);
    await ctx.session.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y });
    await sleep(200);
  },
  async 'ui.key'(ctx, s) {
    const codes = { Delete: 46, Backspace: 8, Escape: 27 };
    for (const type of ['rawKeyDown', 'keyUp']) {
      await ctx.session.call('Input.dispatchKeyEvent', { type, key: s.key, code: s.key, windowsVirtualKeyCode: codes[s.key] ?? 0 });
    }
    await sleep(400);
  },
  async 'show.export'(ctx, s) {
    // A real offline render of the show (native capture, MP4), kept where
    // the encoder wrote it.
    const result = await ctx.eval(`(async () => {
      const r = await __show.g().offlineRender();
      const ok = await r.start({ durationSeconds: ${s.seconds ?? 2}, fps: ${s.fps ?? 30}, width: ${s.width ?? 640}, height: ${s.height ?? 360}, filename: 'show', outputMode: 'mp4', quality: 'archive', captureBackend: 'native' },
        { promptSave: false });
      return { ok, state: __show.read(r) };
    })()`, 300000);
    if (!result?.ok || !result.state?.lastOutputPath) throw new Error(`the render did not finish: ${result?.state?.status} ${result?.state?.errorMessage ?? ''}`);
    ctx.vars.exportFile = result.state.lastOutputPath;
    ctx.vars.exportFps = s.fps ?? 30;
    await sleep(500);
  },
  async 'show.tempo'(ctx, s) {
    // A one-segment tempo map: { bpm, offset (show s of bar 1), beatsPerBar }.
    await ctx.eval(`__show.g().showTimeline.setTempo({ offset: ${s.offset ?? 0}, segments: [{ bar: 1, bpm: ${s.bpm ?? 120}, beatsPerBar: ${s.beatsPerBar ?? 4}, beatUnit: 4 }], source: 'manual' })`);
    await sleep(200);
  },
  // ── Live takeover ────────────────────────────────────────────────────
  async 'takeover.engage'(ctx, s) {
    // { track, deck, row (0-based) } a VJ row, or { track, kind: 'vjMix' | 'black' }.
    const source = s.kind ? { kind: s.kind } : { kind: 'vjRow', deck: s.deck ?? 'A', row: s.row ?? 0 };
    const ok = await ctx.eval(`__show.g().takeover.takeOverTrack(__show.vars['track:' + ${J(s.track)}], ${J(source)}, ${J({ fadeIn: s.fadeIn ?? 0 })})`);
    if (!ok) throw new Error(`could not take ${s.track} over`);
    await sleep(s.settle ?? 800);
  },
  async 'takeover.release'(ctx, s) {
    // { track } or all; { mode, fade } (default: the takeover's own setting).
    const spec = s.mode ? J({ mode: s.mode, fadeSeconds: s.fade ?? 0 }) : 'undefined';
    await ctx.eval(s.track
      ? `__show.g().takeover.returnTrack(__show.vars['track:' + ${J(s.track)}], ${spec})`
      : `__show.g().takeover.store.release('all', ${spec})`);
    if (s.settle) await sleep(s.settle);
  },
  async 'takeover.underneath'(ctx, s) {
    const ok = await ctx.eval(`__show.g().takeover.store.setUnderneath(${J(s.mode ?? 'run')})`);
    if (!ok) throw new Error(`underneath ${s.mode} was refused`);
  },
  async wait(_ctx, s) { await sleep((s.seconds ?? 1) * 1000); },
  async eval(ctx, s) { ctx.vars.last = await ctx.eval(s.js, 60000); },
  // ── Stage Sim window (rehearsal, Rec, Render rehearsal) ─────────────
  async 'stage.open'(ctx) {
    await ctx.eval(`window.electronAPI.invoke('open_stage3d_window', { displayId: null })`);
    ctx.stage = await ctx.openPage((t) => t.url.includes('mode=stage-3d'));
    await waitIn(ctx.stage, `!!document.querySelector('[data-stage-show-transport]')`, 30000, 'the Stage Sim transport');
    await sleep(1500);
  },
  async 'stage.click'(ctx, s) {
    const r = await ctx.stage.eval(`(() => { const r = document.querySelector(${J(s.selector)})?.getBoundingClientRect(); return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; })()`);
    if (!r) throw new Error(`nothing at ${s.selector}`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await ctx.stage.call('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    }
    await sleep(s.settle ?? 400);
  },
  async 'stage.key'(ctx, s) {
    const codes = { Enter: 13, Home: 36, ArrowLeft: 37, ArrowRight: 39, Escape: 27 };
    const text = s.key === 'Enter' ? '\r' : undefined;
    await ctx.stage.call('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key: s.key, code: s.key, windowsVirtualKeyCode: codes[s.key] ?? 0, ...(text ? { text } : {}) });
    await ctx.stage.call('Input.dispatchKeyEvent', { type: 'keyUp', key: s.key, code: s.key, windowsVirtualKeyCode: codes[s.key] ?? 0 });
    await sleep(s.settle ?? 500);
  },
  async 'stage.eval'(ctx, s) { ctx.vars.last = await ctx.stage.eval(s.js, 60000); },
  async 'stage.waitFor'(ctx, s) { await waitIn(ctx.stage, s.js, (s.seconds ?? 30) * 1000, s.what ?? s.js); },
  async 'stage.close'(ctx) {
    await ctx.stage?.eval(`window.electronAPI.invoke('stage3d_window_closing')`).catch(() => {});
    ctx.stage = null;
    await sleep(1500);
  },
};

/** Poll `js` in a page until it is true. */
async function waitIn(page, js, ms, what) {
  const until = Date.now() + ms;
  for (;;) {
    if (await page.eval(js).catch(() => false)) return;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await sleep(250);
  }
}

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

/** The frame number a `framecode` fixture frame spells (nine bars, left =
 *  lowest bit), read from one frame of a video. */
function frameCode(file, frameIndex = 0) {
  const ffmpeg = process.env.GA_FFMPEG_PATH || require('ffmpeg-static');
  const w = 288; const h = 64;
  const raw = execFileSync(ffmpeg, ['-loglevel', 'error', '-i', file, '-vf', `select=eq(n\\,${frameIndex}),scale=${w}:${h}`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 16 * 1024 * 1024 });
  if (raw.length < w * h) return null;
  let code = 0;
  for (let bit = 0; bit < 9; bit++) {
    const x = bit * 32 + 16;
    let sum = 0;
    for (let y = h / 4; y < (3 * h) / 4; y++) sum += raw[y * w + x];
    if (sum / (h / 2) > 128) code |= 1 << bit;
  }
  return code;
}

/** Mean RGB (0..1) of one frame of a video (or an image), through the bundled ffmpeg. */
function frameMean(file, frameIndex = 0) {
  const ffmpeg = process.env.GA_FFMPEG_PATH || require('ffmpeg-static');
  const raw = execFileSync(ffmpeg, ['-loglevel', 'error', '-i', file, '-vf', `select=eq(n\\,${frameIndex}),scale=64:-2`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 64 * 1024 * 1024 });
  if (!raw.length) return null;
  const sum = [0, 0, 0];
  for (let i = 0; i < raw.length; i += 3) { sum[0] += raw[i]; sum[1] += raw[i + 1]; sum[2] += raw[i + 2]; }
  const n = raw.length / 3;
  return sum.map((v) => v / n / 255);
}

const CHECKS = {
  async 'output.colour'(ctx, s) {
    const snap = await ctx.eval('__show.snapshot()');
    if (!snap) return { pass: false, detail: 'no output frame' };
    const got = colourName(snap.mean_rgba);
    return { pass: got.name === s.is && got.distance < (s.tolerance ?? 0.25), detail: `output is ${got.name} (${snap.mean_rgba.slice(0, 3).map((v) => v.toFixed(2)).join(', ')})` };
  },
  async 'output.rgb'(ctx, s) {
    // The output's mean colour, numerically: { rgb: [r, g, b], within }.
    const snap = await ctx.eval('__show.snapshot()');
    if (!snap) return { pass: false, detail: 'no output frame' };
    const got = snap.mean_rgba.slice(0, 3);
    const off = Math.max(...got.map((v, i) => Math.abs(v - s.rgb[i])));
    return { pass: off <= (s.within ?? 0.03), detail: `output ${got.map((v) => v.toFixed(3)).join(', ')} vs ${s.rgb.map((v) => v.toFixed(3)).join(', ')}` };
  },
  async 'output.region'(ctx, s) {
    // Mean colour of a vertical strip of the output, numerically:
    // { x0, x1 (0..1 of the width), rgb, within }.
    const got = await ctx.eval(`(async () => {
      const snap = await __show.snapshot({ include_pixels: true, max_dim: 96 });
      if (!snap || !snap.rgba_b64) return null;
      const bin = atob(snap.rgba_b64);
      const x0 = Math.floor(${s.x0 ?? 0} * snap.width), x1 = Math.ceil(${s.x1 ?? 1} * snap.width);
      const sum = [0, 0, 0]; let n = 0;
      for (let y = 0; y < snap.height; y++) for (let x = x0 + 1; x < x1 - 1; x++) {
        const i = (y * snap.width + x) * 4;
        sum[0] += bin.charCodeAt(i + 2); sum[1] += bin.charCodeAt(i + 1); sum[2] += bin.charCodeAt(i); n++;
      }
      return sum.map((v) => v / Math.max(1, n) / 255);
    })()`);
    if (!got) return { pass: false, detail: 'no output pixels' };
    const off = Math.max(...got.map((v, i) => Math.abs(v - s.rgb[i])));
    return { pass: off <= (s.within ?? 0.05), detail: `x ${s.x0 ?? 0}..${s.x1 ?? 1}: ${got.map((v) => v.toFixed(3)).join(', ')} vs ${s.rgb.map((v) => v.toFixed(3)).join(', ')}` };
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
  // ── Layer tracks ─────────────────────────────────────────────────────
  async 'layer.colour'(ctx, s) {
    // `track` (the layer a track draws on) or `layer` (by name); `is` a
    // colour name, or `brightness` [value, tolerance] for grey clips.
    const id = s.track ? await ctx.eval(`__show.trackLayerId(${J(s.track)})`) : await ctx.eval(`__show.layerByName(${J(s.layer)})?.id ?? ${J(s.layer)}`);
    const snap = await ctx.eval(`__show.snapshot({ layer_id: ${J(id)} })`);
    if (s.absent) return { pass: !snap, detail: snap ? `${id} still draws` : `${id} is not drawn` };
    if (!snap) return { pass: false, detail: `no picture for ${id}` };
    const rgb = snap.mean_rgba.slice(0, 3);
    const alpha = snap.mean_rgba[3];
    const shown = rgb.map((v) => v.toFixed(3)).join(', ');
    if (s.brightness) {
      const mean = (rgb[0] + rgb[1] + rgb[2]) / 3;
      const [want, tol] = s.brightness;
      return { pass: Math.abs(mean - want) <= tol, detail: `${id} brightness ${mean.toFixed(3)} (want ${want} ± ${tol}; alpha ${alpha?.toFixed?.(2)})` };
    }
    const got = colourName(rgb);
    return { pass: got.name === s.is && got.distance < (s.tolerance ?? 0.25), detail: `${id} is ${got.name} (${shown})` };
  },
  async 'layer.mediaTime'(ctx, s) {
    // The decoder's own position against where the show says the clip is.
    const r = await ctx.eval(`(async () => {
      const id = __show.vars['track:' + ${J(s.track)}];
      const anchor = __show.tracks().anchor(id);
      if (!anchor) return { error: 'no video anchor for the track' };
      // Where the show says the clip is, just before and just after the
      // status read: the decoder is right if it lands between the two.
      const at = () => __show.trackState(${J(s.track)})?.clip?.mediaTime ?? null;
      await new Promise((res) => requestAnimationFrame(res));
      const before = at();
      const st = await window.electronAPI.invoke('native_renderer_get_status');
      await new Promise((res) => requestAnimationFrame(res));
      const after = at();
      const session = st.native_video_sessions.find((v) => v.source_id === anchor.sourceId);
      return { session: session ? { t: session.source_time_seconds, frame: session.source_frame_duration_seconds, state: session.state, phase: session.phase_error_seconds ?? null, gen: session.seek_generation } : null, before, after, source: anchor.sourceId };
    })()`);
    if (r.error) return { pass: false, detail: r.error };
    if (!r.session || r.session.t == null) return { pass: false, detail: `no playing session for ${r.source}` };
    // In frames: the frame the decoder shows against the frame the show
    // wants (the last one starting at or before the show's media time).
    const frame = s.frame ?? r.session.frame ?? 1 / 30;
    const got = Math.round(r.session.t / frame);
    const lo = Math.floor(Math.min(r.before, r.after) / frame + 1e-6);
    const hi = Math.floor(Math.max(r.before, r.after) / frame + 1e-6);
    const allowed = s.frames ?? 1;
    const off = got < lo ? got - lo : got > hi ? got - hi : 0;
    return { pass: Math.abs(off) <= allowed, detail: `decoder frame ${got} (${r.session.t.toFixed(3)} s), show frame ${lo === hi ? lo : `${lo}-${hi}`} (${r.before.toFixed(3)} s): ${off === 0 ? 'on the frame' : `${Math.abs(off)} frame${Math.abs(off) === 1 ? '' : 's'} ${off < 0 ? 'behind' : 'ahead'}`} (allowed ${allowed}); ${r.session.state}, phase error ${r.session.phase == null ? '-' : (r.session.phase * 1000).toFixed(1) + ' ms'}` };
  },
  async 'video.sessions'(ctx, s) {
    const sessions = await ctx.eval(`window.electronAPI.invoke('native_renderer_get_status').then((st) => st.native_video_sessions.filter((v) => v.source_id.startsWith(${J(s.prefix ?? 'show:')})).map((v) => v.source_id + ':' + v.state))`);
    const n = sessions.length;
    return { pass: n >= (s.min ?? 0) && n <= (s.max ?? Infinity), detail: `${n} session(s): ${sessions.join(', ') || 'none'}` };
  },
  async 'stage.true'(ctx, s) {
    const v = await ctx.stage.eval(s.js);
    return { pass: !!v, detail: `${s.label ?? s.js} → ${JSON.stringify(v)?.slice(0, 160)}` };
  },
  async 'eval.true'(ctx, s) {
    const v = await ctx.eval(s.js);
    return { pass: !!v, detail: `${s.label ?? s.js} → ${JSON.stringify(v)?.slice(0, 160)}` };
  },
  async 'export.frame'(ctx, s) {
    const file = ctx.vars.exportFile;
    if (!file || !fs.existsSync(file)) return { pass: false, detail: 'no render to read' };
    const rgb = frameMean(file, s.frame);
    if (!rgb) return { pass: false, detail: `no frame ${s.frame} in ${path.basename(file)}` };
    const label = `frame ${s.frame} (${(s.frame / (ctx.vars.exportFps ?? 30)).toFixed(2)} s)`;
    if (s.frameCode !== undefined) {
      const got = frameCode(file, s.frame);
      const off = got === null ? null : got - s.frameCode;
      return { pass: off !== null && Math.abs(off) <= (s.frames ?? 0), detail: `${label} shows clip frame ${got} (want ${s.frameCode}${off ? `, ${Math.abs(off)} frame${Math.abs(off) === 1 ? '' : 's'} ${off < 0 ? 'early' : 'late'}` : ''})` };
    }
    if (s.brightness) {
      const mean = (rgb[0] + rgb[1] + rgb[2]) / 3;
      const [want, tol] = s.brightness;
      return { pass: Math.abs(mean - want) <= tol, detail: `${label} brightness ${mean.toFixed(3)} (want ${want} ± ${tol})` };
    }
    const got = colourName(rgb);
    return { pass: got.name === s.is && got.distance < (s.tolerance ?? 0.25), detail: `${label} is ${got.name} (${rgb.map((v) => v.toFixed(2)).join(', ')})` };
  },
  async 'takeover.count'(ctx, s) {
    const sum = await ctx.eval('__show.g().takeover.summary()');
    return { pass: sum.count === s.is, detail: `${sum.count} surface(s) taken over${sum.surfaces.length ? `: ${sum.surfaces.map((x) => `${x.label} ${x.phase}`).join(', ')}` : ''}` };
  },
  async 'takeover.barRelease'(ctx, s) {
    // Plays the show, takes `track` over, asks for the hand-back on the next
    // bar and records the show evaluations around it: the takeover must be
    // gone on the first evaluation at or past the bar (within one frame).
    const r = await ctx.eval(`(async () => {
      const g = __show.g(); const T = g.takeover; const st = g.showTimeline;
      const id = __show.vars['track:' + ${J(s.track)}];
      st.seek(${s.from ?? 1}); await new Promise((r) => setTimeout(r, 300));
      st.play(); await new Promise((r) => setTimeout(r, 300));
      T.takeOverTrack(id, ${J(s.source ?? { kind: 'vjRow', deck: 'A', row: 0 })});
      while (__show.show().currentTime < ${s.askAt ?? 2.6}) await new Promise((r) => setTimeout(r, 10));
      const evals = [];
      const un = st.subscribe((x) => evals.push({ t: x.currentTime, active: !!T.frame() }));
      T.returnTrack(id, { mode: 'bar', fadeSeconds: 0 });
      const at = T.summary().surfaces[0]?.releaseAtShowTime ?? null;
      while (__show.show().currentTime < ${s.until ?? 4.6}) await new Promise((r) => setTimeout(r, 10));
      un(); st.pause();
      const i = evals.findIndex((e) => !e.active);
      const gaps = evals.slice(1).map((e, k) => e.t - evals[k].t).filter((x) => x > 0).sort((a, b) => a - b);
      return { at, last: evals[i - 1]?.t ?? null, first: evals[i]?.t ?? null, frame: gaps[Math.floor(gaps.length / 2)] ?? null };
    })()`, 30000);
    if (r.at === null || r.first === null || r.last === null) return { pass: false, detail: `no release seen: ${JSON.stringify(r)}` };
    const late = r.first - r.at;
    const pass = r.last < r.at && late >= -1e-6 && late <= (r.frame ?? 1 / 60) * 1.5;
    return { pass, detail: `bar at ${r.at.toFixed(3)} s: still taken over at ${r.last.toFixed(3)}, handed back at ${r.first.toFixed(3)} (${(late * 1000).toFixed(1)} ms past the bar; frames ${((r.frame ?? 0) * 1000).toFixed(1)} ms)` };
  },
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
