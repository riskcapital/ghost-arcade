// Steps e and f of scripts/linux-smoke.mjs: the Interactive Studio and
// recording. See linux-smoke-steps.mjs for the conventions.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { el, sleep } from './linux-smoke-cdp.mjs';
import { stats } from './linux-smoke-image.mjs';
import {
  addLayer, layerNames, measuredFps, pageImage, rpc, setCheckbox, setLayerVisible, typeAheadSelect,
} from './linux-smoke-steps.mjs';

const PREVIEW = "document.querySelector('canvas[aria-label=\"Live native effect preview\"]')";
const ADD_EFFECT = "document.querySelector('button.add-effect-button')";

/** What the Studio's own live preview shows, as picture statistics. */
async function studioPreview(c) {
  const rect = await c.center(PREVIEW);
  const page = await pageImage(c);
  return stats(page.image, { x: rect.l * page.scale, y: rect.t * page.scale, width: rect.w * page.scale, height: rect.h * page.scale });
}

/** Poll the preview until it is clearly brighter than the empty stage. */
async function waitForPicture(c, baseline, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await studioPreview(c);
    if (last.nonBlackFraction > baseline.nonBlackFraction + 0.02 && last.meanLuma > baseline.meanLuma + 0.004) return { ...last, ok: true };
    await sleep(1500);
  }
  return { ...last, ok: false };
}

// ── e ──────────────────────────────────────────────────────────────────────
export const stepInteractive = {
  id: 'e', title: 'Interactive layer renders a simple style and a compute style',
  async run(t) {
    const { c } = t;
    for (const name of await layerNames(c)) await setLayerVisible(c, name, false);
    await addLayer(c, 'Interactive');
    await c.waitFor(`!!(${ADD_EFFECT}) && !!(${PREVIEW})`, 30000, 'Interactive Studio');
    const enabled = (name) => `document.querySelector('input[aria-label="Enable ${name}"]')`;
    // Empty stage first (only the shape outlines), so "renders" has a baseline.
    await setCheckbox(c, enabled('Living Architecture'), false);
    await sleep(2500);
    const empty = await studioPreview(c);
    t.number('emptyStage', `meanLuma=${empty.meanLuma} nonBlack=${empty.nonBlackFraction}`);

    await setCheckbox(c, enabled('Living Architecture'), true);
    const simple = await waitForPicture(c, empty, 120000);
    const simpleFps = await measuredFps(c, 4000);
    t.number('livingArchitecture', `meanLuma=${simple.meanLuma} nonBlack=${simple.nonBlackFraction} colours=${simple.distinctColours}; ${simpleFps.frameMs} ms/frame (${simpleFps.fps} fps)`);
    t.check('simple style (Living Architecture) renders in the Studio preview', simple.ok, JSON.stringify(simple));
    await t.shot('e-living-architecture');

    await setCheckbox(c, enabled('Living Architecture'), false);
    await c.clickElement(ADD_EFFECT);
    await c.clickElement("[...document.querySelectorAll('.add-effect-menu button')].find(b=>b.textContent.trim()==='Fire')");
    const added = 'Fire';
    await c.waitFor(`!!(${enabled('Fire')})`, 8000, 'Fire in the effect stack');
    const stack = await c.eval("JSON.stringify([...document.querySelectorAll('.effect-card')].map(e=>e.getAttribute('aria-label')+':'+e.querySelector('input').checked))");
    t.number('effectStack', stack);
    const fire = await waitForPicture(c, empty, 120000);
    const fireFps = await measuredFps(c, 4000);
    t.number('fire', `meanLuma=${fire.meanLuma} nonBlack=${fire.nonBlackFraction} colours=${fire.distinctColours}; ${fireFps.frameMs} ms/frame (${fireFps.fps} fps)`);
    t.check('compute style (Fire) renders in the Studio preview', fire.ok, `${JSON.stringify(fire)} (select showed "${added}")`);
    t.check('core keeps producing frames with a compute style running', fireFps.frames > 0, `${fireFps.frames} frames in 4 s`);
    const status = await rpc(c, 'native_renderer_get_status');
    t.check('core reports no shader or frame error', status?.running === true && !status?.last_shader_error && !status?.last_frame_error, `shader=${status?.last_shader_error || ''} frame=${status?.last_frame_error || ''}`);
    await t.shot('e-fire');
    await c.clickElement(el.button('Close'));
    await sleep(500);
    for (const name of await layerNames(c)) if (/Interactive/.test(name)) await setLayerVisible(c, name, false);
  },
};

// ── f ──────────────────────────────────────────────────────────────────────
function findTool(name) {
  for (const candidate of [name, `/usr/bin/${name}`, `/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`]) {
    try { execFileSync(candidate, ['-version'], { stdio: 'ignore' }); return candidate; } catch { /* next */ }
  }
  return null;
}

/** Video files a recording may have written: the profile and the encoder's temp folders. */
function recordingFiles(profile) {
  const found = [];
  const walk = (dir, depth) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (depth < 3 && !/Cache|GPUCache|blob_storage|Service Worker/.test(entry.name)) walk(full, depth + 1); }
      else if (/\.(mp4|mov)$/i.test(entry.name)) found.push(full);
    }
  };
  if (profile) walk(profile, 0);
  for (const tmp of new Set([os.tmpdir(), '/tmp'])) {
    let entries = [];
    try { entries = fs.readdirSync(tmp); } catch { continue; }
    for (const name of entries) if (/^ghost-native-(mp4|audio)-/.test(name)) walk(path.join(tmp, name), 2);
  }
  return found;
}

/** Frame count, size and codec of a video file, from ffprobe. */
export function probeVideo(file) {
  const ffprobe = findTool('ffprobe');
  if (!ffprobe) return null;
  try {
    const text = execFileSync(ffprobe, ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries',
      'stream=codec_name,width,height,nb_read_frames,avg_frame_rate:format=duration,size', '-of', 'json', file], { encoding: 'utf8', timeout: 120000 });
    const json = JSON.parse(text);
    const stream = json.streams?.[0] || {};
    return { frames: Number(stream.nb_read_frames || 0), width: stream.width, height: stream.height, codec: stream.codec_name, duration: Number(json.format?.duration || 0), bytes: Number(json.format?.size || 0) };
  } catch (error) {
    return { frames: 0, error: String(error.stderr || error.message).slice(0, 200) };
  }
}

/** One take: press REC, wait, press Stop, and report what came of it. */
async function recordTake(t, seconds, profile) {
  const { c } = t;
  const before = new Set(recordingFiles(profile));
  const dialogsBefore = c.dialogs.length;
  await c.clickElement("document.querySelector('button.rec-btn')");
  const started = Date.now();
  let recording = false;
  // A refused take says so (alert) within a few seconds; a real one shows Stop Rec.
  while (Date.now() - started < 15000 && c.dialogs.length === dialogsBefore) {
    recording = await c.exists("document.querySelector('.stop-rec-btn')");
    if (recording && Date.now() - started > seconds * 1000) break;
    await sleep(400);
  }
  recording = await c.exists("document.querySelector('.stop-rec-btn')");
  if (recording && c.dialogs.length === dialogsBefore) {
    await c.clickElement("document.querySelector('.stop-rec-btn')");
  }
  // Finishing the file takes a while on a slow machine.
  let file = null;
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    await sleep(1000);
    const fresh = recordingFiles(profile).filter((entry) => !before.has(entry));
    const idle = await c.exists("document.querySelector('button.rec-btn')");
    if (fresh.length && idle) { file = fresh.sort((x, y) => fs.statSync(y).mtimeMs - fs.statSync(x).mtimeMs)[0]; break; }
    if (idle && (c.dialogs.length > dialogsBefore || Date.now() - started > 25000) && !fresh.length) break;
  }
  await sleep(1500);
  const message = c.dialogs.slice(dialogsBefore).map((dialog) => dialog.message).join(' | ');
  return { file, probe: file ? probeVideo(file) : null, message, stuck: await c.exists("document.querySelector('.stop-rec-btn')") };
}

export { recordTake, recordingFiles, findTool };
