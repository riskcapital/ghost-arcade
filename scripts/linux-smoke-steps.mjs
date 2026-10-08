// The steps of scripts/linux-smoke.mjs. Each one drives the app the way a
// person would (real CDP mouse and keyboard input) and reads results back as
// numbers. `t` is the step API from the runner: t.c is the CDP page driver.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { el, sleep } from './linux-smoke-cdp.mjs';
import { decodePng, snapshotImage, stats } from './linux-smoke-image.mjs';

/** Call a main-process handler through the app's own preload bridge. */
export async function rpc(c, method, params = {}, timeoutMs = 60000) {
  const text = await c.eval(`(async()=>JSON.stringify(await window.electronAPI.invoke(${JSON.stringify(method)}, ${JSON.stringify(params)})) ?? 'null')()`, timeoutMs);
  return text == null ? null : JSON.parse(text);
}

/** The core's own picture of an output: 'output' (program) or 'slice:<id>'. */
export async function coreSnapshot(c, source = 'output', attempts = 8) {
  let lastError = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const snapshot = await rpc(c, 'native_renderer_get_output_shared_texture_snapshot', { include_pixels: true, capture_source: source }, 120000);
      if (snapshot?.rgba_b64) return { snapshot, image: snapshotImage(snapshot) };
      lastError = new Error(`no pixels: ${JSON.stringify(snapshot)?.slice(0, 200)}`);
    } catch (error) { lastError = error; }
    await sleep(500); // "live readback busy" while another capture is in flight
  }
  throw lastError;
}

/** What is on screen in the editor window, as an image and its CSS-to-pixel scale. */
export async function pageImage(c) {
  const shot = await c.send('Page.captureScreenshot', { format: 'png' });
  const image = decodePng(Buffer.from(shot.data, 'base64'));
  const cssWidth = await c.eval('window.innerWidth');
  return { image, scale: image.width / cssWidth, png: Buffer.from(shot.data, 'base64') };
}

export const dismissWelcome = async (c) => {
  if (await c.exists(el.button('Get started'))) { await c.clickElement(el.button('Get started')); await sleep(400); }
};

export async function openTab(c, name) {
  await c.clickElement(el.button(name));
  await sleep(350);
}

/** Layers tab > + Add Layer > one menu entry. Returns the layer row count. */
export async function addLayer(c, menuEntry) {
  await openTab(c, 'Layers');
  if (!(await c.exists("document.querySelector('.add-layer-menu')"))) await c.clickElement(el.button('+ Add Layer'));
  await c.waitFor("!!document.querySelector('.add-layer-menu')", 5000, 'Add Layer menu');
  await c.clickElement(el.button(menuEntry, "document.querySelector('.add-layer-menu')"));
  await sleep(800);
}

const round = (value, digits = 2) => Math.round(Number(value) * 10 ** digits) / 10 ** digits;

/** Frame-time numbers the core reports about itself. */
export async function frameTimes(c) {
  const s = await rpc(c, 'native_renderer_get_stats');
  return {
    cpuMs: round(s.avg_render_cpu_ms), gpuMs: s.gpu_timing_supported ? round(s.avg_render_gpu_ms) : null,
    lastGpuMs: s.gpu_timing_supported ? round(s.last_render_gpu_ms) : null,
    framesPresented: s.frames_presented, framesSubmitted: s.frames_submitted,
    targetFps: s.effective_target_fps, budgetOverruns: s.frame_budget_overruns,
  };
}

/** Frames the core finishes per second, measured over a wall-clock window. */
export async function measuredFps(c, windowMs = 3000) {
  const before = await rpc(c, 'native_renderer_get_stats');
  const start = Date.now();
  await sleep(windowMs);
  const after = await rpc(c, 'native_renderer_get_stats');
  const seconds = (Date.now() - start) / 1000;
  const frames = Number(after.gpu_frames_completed ?? after.frames_presented) - Number(before.gpu_frames_completed ?? before.frames_presented);
  return { fps: round(frames / seconds, 1), frameMs: frames > 0 ? round((seconds * 1000) / frames, 1) : null, frames };
}

// ── a ──────────────────────────────────────────────────────────────────────
const stepHandshake = {
  id: 'a', title: 'App window loads and the core handshake completes',
  async run(t) {
    const { c } = t;
    await c.waitFor("document.readyState==='complete' && !!window.electronAPI && document.querySelectorAll('button').length>5", 120000, 'editor UI');
    t.check('editor window rendered its UI', true, `${await c.eval("document.querySelectorAll('button').length")} buttons, title "${await c.eval('document.title')}"`);
    const started = Date.now();
    let caps = null;
    // The broker allows a non-macOS core 180 s to start (first-run pipeline compiles).
    while (Date.now() - started < 240000) {
      caps = await rpc(c, 'native_renderer_get_capabilities');
      if (caps?.core_capabilities_confirmed) break;
      await sleep(1000);
    }
    const features = Object.values(caps?.features || {}).filter(Boolean).length;
    const status = await rpc(c, 'native_renderer_get_status');
    t.number('handshakeSeconds', round((Date.now() - started) / 1000, 1));
    t.number('featuresOn', `${features}/${Object.keys(caps?.features || {}).length}`);
    t.number('methods', (caps?.implemented_methods || []).length);
    t.number('backend', status?.backend);
    t.number('adapter', status?.adapter_name);
    t.number('coreVersion', caps?.core_version);
    t.check('core capability handshake confirmed', caps?.core_capabilities_confirmed === true, caps?.core_capabilities_error || '');
    t.check('capabilities are the core\'s own, not the all-false defaults', features >= 20 && (caps?.implemented_methods || []).length >= 20, `${features} features on, ${(caps?.implemented_methods || []).length} methods`);
    t.check('core is running with a ready backend', status?.running === true && status?.backend_ready === true, `running=${status?.running} backend_ready=${status?.backend_ready} error=${status?.last_frame_error || ''}`);
    if (t.isLinux) {
      t.check('backend is Vulkan', String(status?.backend).toLowerCase() === 'vulkan', String(status?.backend));
      const slices = await rpc(c, 'native_renderer_get_slice_output_state');
      t.number('screenPresentation', `${slices?.platform} available=${slices?.available}${slices?.reason ? ` (${slices.reason})` : ''}`);
      t.check('core can present Screens on X11', slices?.available === true && slices?.platform === 'x11', JSON.stringify(slices)?.slice(0, 300));
      t.number('editorPreviewExport', caps?.output_shared_texture_export?.platform);
    }
    t.shared.caps = caps;
    await dismissWelcome(c);
    await t.shot('a-editor');
  },
};

// ── b ──────────────────────────────────────────────────────────────────────
const stepComposite = {
  id: 'b', title: 'A shader layer shows a non-black composite in the editor',
  async run(t) {
    const { c } = t;
    await dismissWelcome(c);
    await addLayer(c, 'GPU Shader');
    const rows = await c.eval("document.body.innerText.includes('Properties (Media)')");
    t.check('GPU Shader layer was added and selected', rows, 'inspector shows the layer properties');
    // Software Vulkan needs a while for the first frames of a new graph.
    let core = null;
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      core = await coreSnapshot(c, 'output');
      if (stats(core.image).nonBlackFraction > 0.02) break;
      await sleep(1500);
    }
    const coreStats = stats(core.image);
    t.number('coreComposite', `${core.image.width}x${core.image.height} meanLuma=${coreStats.meanLuma} nonBlack=${coreStats.nonBlackFraction} colours=${coreStats.distinctColours}`);
    t.check('core composite is not black', coreStats.nonBlackFraction > 0.02 && coreStats.maxLuma > 0.1, JSON.stringify(coreStats));
    fs.writeFileSync(path.join(t.outDir, 'b-core-composite.json'), JSON.stringify({ ...core.snapshot, rgba_b64: undefined, stats: coreStats }, null, 1));
    const rect = await c.center("document.querySelector('canvas.main-canvas')");
    if (t.isLinux) {
      // No native presenter on Linux: the editor canvas itself carries the
      // composite (CPU mirror), so a screenshot of the page must show it.
      let view = null;
      const until = Date.now() + 60000;
      while (Date.now() < until) {
        const page = await pageImage(c);
        view = stats(page.image, { x: rect.l * page.scale, y: rect.t * page.scale, width: rect.w * page.scale, height: rect.h * page.scale });
        if (view.nonBlackFraction > 0.02) break;
        await sleep(1500);
      }
      t.number('editorPreview', `${Math.round(rect.w)}x${Math.round(rect.h)} css px meanLuma=${view.meanLuma} nonBlack=${view.nonBlackFraction} colours=${view.distinctColours}`);
      t.check('editor preview shows the composite (not black, not flat)', view.nonBlackFraction > 0.02 && view.distinctColours > 4, JSON.stringify(view));
      const pending = await c.eval("document.body.innerText.includes('Native engine starting')");
      t.check('"Native engine starting" overlay has lifted', !pending);
    } else {
      t.skip('editor preview pixels: this platform presents the composite in a native layer under the page, which a page screenshot cannot see');
    }
    const fps = await measuredFps(c, 3000);
    const times = await frameTimes(c);
    t.number('frameTime', `${fps.frameMs} ms/frame measured (${fps.fps} fps), core avg cpu ${times.cpuMs} ms, gpu ${times.gpuMs ?? 'n/a'} ms`);
    t.check('core keeps producing frames', fps.frames > 0, `${fps.frames} frames in 3 s`);
    await t.shot('b-editor');
  },
};

// ── h (quit) ───────────────────────────────────────────────────────────────
const stepQuit = {
  id: 'h', title: 'Output Window, fullscreen, clean quit',
  async run(t) {
    const { c } = t;
    if (t.args.attach || t.args.keepOpen) { t.skip('quit: attached to an app this run did not start'); return; }
    const before = t.descendants();
    const cores = before.filter((p) => /ghost-render-core/.test(p.command) && !/ffmpeg/.test(p.command));
    t.number('coreProcesses', cores.length);
    t.check('exactly one render core process is running', cores.length === 1, cores.map((p) => `${p.pid} ${p.command.slice(0, 80)}`).join(' | '));
    const closeButton = "document.querySelector('button.win-close')";
    if (await c.exists(closeButton)) {
      await c.clickElement(closeButton).catch(() => {}); // the page goes away mid-click
    } else {
      t.note('no DOM close button on this platform (OS title bar); asking the app to quit with SIGTERM');
      t.app().kill('SIGTERM');
    }
    const exit = await Promise.race([t.app().exited, sleep(20000).then(() => null)]);
    t.check('app process exits within 20 s of Close', !!exit, exit ? `code=${exit.code} signal=${exit.signal}` : 'still running');
    await sleep(1500);
    const orphans = before.filter((p) => t.alive(p.pid));
    t.number('processesBefore', before.length);
    t.number('orphans', orphans.length);
    t.check('no orphan processes (core, helpers, ffmpeg) survive the quit', orphans.length === 0, orphans.map((p) => `${p.pid} ${p.command.slice(0, 100)}`).join(' | '));
    if (t.isLinux) {
      let stray = '';
      try { stray = execFileSync('pgrep', ['-fl', 'ghost-render-core'], { encoding: 'utf8' }).trim(); } catch { /* none */ }
      t.check('no ghost-render-core left on the machine', stray === '', stray);
    }
  },
};

export const STEPS = [stepHandshake, stepComposite, stepQuit];
