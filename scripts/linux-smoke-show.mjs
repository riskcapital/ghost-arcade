// Steps f, g and h of scripts/linux-smoke.mjs: recording, VJ mode with audio,
// and the Output Window, fullscreen and quit. See linux-smoke-steps.mjs.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { el, sleep } from './linux-smoke-cdp.mjs';
import { decodePng, stats } from './linux-smoke-image.mjs';
import { findTool, recordTake } from './linux-smoke-live.mjs';
import { addLayer, layerNames, rpc, round, setLayerVisible } from './linux-smoke-steps.mjs';

/** Is frame 10 of a video black? Decoded with ffmpeg into a PNG we can read. */
function videoFrameStats(file, outDir, name) {
  const ffmpeg = findTool('ffmpeg');
  if (!ffmpeg) return null;
  const png = path.join(outDir, `${name}.png`);
  try {
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-i', file, '-vf', 'select=gte(n\\,10)', '-frames:v', '1', '-pix_fmt', 'rgb24', png], { timeout: 120000 });
    return stats(decodePng(fs.readFileSync(png)));
  } catch { return null; }
}

async function chooseRecordSource(c, selector) {
  await c.clickElement("document.querySelector('[data-testid=\"rec-source-toggle\"]')");
  await c.waitFor("!!document.querySelector('.rec-source-pop')", 5000, 'recording source menu');
  const label = await c.eval(`document.querySelector('.rec-source-pop ${selector}')?.textContent.trim() || ''`);
  if (label) await c.clickElement(`document.querySelector('.rec-source-pop ${selector}')`);
  await c.key('Escape');
  await sleep(300);
  return label;
}

// ── f ──────────────────────────────────────────────────────────────────────
export const stepRecording = {
  id: 'f', title: 'REC writes an MP4 with frames; other targets record or say why not',
  async run(t) {
    const { c } = t;
    const profile = t.args.profile || path.join(t.outDir, 'profile');
    // Something to record: the first content layer, or a new shader layer.
    let names = (await layerNames(c)).filter((name) => !/Interactive/.test(name));
    if (!names.length) { await addLayer(c, 'GPU Shader'); names = (await layerNames(c)).filter((name) => !/Interactive/.test(name)); }
    await setLayerVisible(c, names[0], true);
    // Stopping a take otherwise opens the OS save dialog, which input cannot reach.
    await c.clickElement(el.byTitle('Settings'));
    await c.clickElement(el.button('Recording'));
    const row = "[...document.querySelectorAll('.setting-row')].find(r=>r.querySelector('.label-text')?.textContent.trim()==='Auto-Download')";
    if (await c.eval(`${row}.querySelector('input').checked`)) await c.clickElement(`${row}.querySelector('.toggle')`);
    t.check('Auto-Download switched off in Settings', (await c.eval(`${row}.querySelector('input').checked`)) === false);
    await c.clickElement(el.button('Done'));
    await sleep(400);

    await chooseRecordSource(c, '[data-rec-source="composition"]');
    const program = await recordTake(t, 6, profile);
    const probe = program.probe;
    t.number('programTake', probe ? `${probe.frames} frames, ${probe.width}x${probe.height} ${probe.codec}, ${round(probe.duration, 1)} s, ${Math.round(probe.bytes / 1024)} kB` : `no file${program.message ? ` (${program.message})` : ''}`);
    t.check('program recording produced a video file', !!program.file, program.file ? path.basename(program.file) : program.message || 'no new .mp4 in the profile or temp folders');
    t.check('the file has frames (ffprobe)', Number(probe?.frames) > 0, probe?.error || `${probe?.frames} frames`);
    t.check('REC button returned to idle', !program.stuck);
    if (program.file) {
      fs.copyFileSync(program.file, path.join(t.outDir, 'f-program.mp4'));
      const frame = videoFrameStats(program.file, t.outDir, 'f-program-frame');
      t.number('programFrame', frame ? `meanLuma=${frame.meanLuma} nonBlack=${frame.nonBlackFraction} meanRgb=${frame.meanRgb}` : 'not decoded');
      t.check('recorded frame is not black', !!frame && frame.nonBlackFraction > 0.02, JSON.stringify(frame));
    }
    // One layer, then one Screen: each must either record or refuse in words.
    for (const [kind, selector] of [['layer', '[data-rec-source^="layer:"]'], ['screen', '[data-rec-source^="screen:"]']]) {
      const label = await chooseRecordSource(c, selector);
      if (!label) { t.note(`no ${kind} recording source is listed`); continue; }
      const take = await recordTake(t, 4, profile);
      const frames = Number(take.probe?.frames || 0);
      const outcome = frames > 0 ? `records (${frames} frames, ${take.probe.width}x${take.probe.height})`
        : take.message ? `refused: "${take.message}"` : take.file ? 'left a file with no frames and no message' : 'nothing happened and nothing was said';
      t.number(`${kind}Target`, `"${label}" ${outcome}`);
      t.check(`${kind} target records, or says clearly that it cannot`, (frames > 0 || !!take.message) && !take.stuck, outcome);
      if (!frames && take.message) t.check(`${kind} target's message names what is unavailable`, /not available|unavailable|cannot|can't|only/i.test(take.message), take.message);
    }
    await chooseRecordSource(c, '[data-rec-source="composition"]');
  },
};

// ── g ──────────────────────────────────────────────────────────────────────
const trayItem = (name) => `[...document.querySelectorAll('.media-item')].find(e=>e.textContent.replace(/\\s+/g,' ').includes(${JSON.stringify(name)}))`;
const clipCell = (name) => `[...document.querySelectorAll('.clip-cell.has-clip')].find(e=>e.textContent.includes(${JSON.stringify(name)}))`;
const programMean = async (c) => {
  const s = await rpc(c, 'native_renderer_get_output_shared_texture_snapshot', { include_pixels: false }, 120000);
  return { rgb: (s?.mean_rgba || [0, 0, 0]).slice(0, 3).map((v) => round(v, 3)), luma: round(s?.average_luma ?? 0, 3), checksum: s?.checksum };
};
const distance = (a, b) => round(Math.max(...a.rgb.map((v, i) => Math.abs(v - b.rgb[i]))), 3);
/** Wait until the program output settles on a picture other than `not`. */
async function settledMean(c, not = null, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  let last = await programMean(c);
  while (Date.now() < deadline) {
    await sleep(1200);
    const next = await programMean(c);
    if (distance(next, last) < 0.01 && (!not || distance(next, not) > 0.03) && next.luma > 0.02) return next;
    last = next;
  }
  return last;
}

export const stepVj = {
  id: 'g', title: 'VJ mode: launch clips, crossfade, play a clip with sound',
  async run(t) {
    const { c } = t;
    await c.clickElement(el.byTitle('Open VJ Mixer'));
    await c.waitFor("document.querySelectorAll('.clip-cell').length>0 && document.querySelectorAll('.media-item').length>3", 60000, 'VJ grid and media library');
    await c.clickElement(trayItem('TestBars'));
    await c.waitFor(`!!(${clipCell('TestBars')})`, 15000, 'TestBars clip in the grid');
    await c.clickElement(clipCell('TestBars'));
    const deckA = await settledMean(c);
    t.number('deckA', `TestBars mean rgb ${deckA.rgb} luma ${deckA.luma}`);
    t.check('launching a clip puts a picture on the output', deckA.luma > 0.05, JSON.stringify(deckA));

    await c.clickElement(el.buttonStarting('Split Deck A/B'));
    await c.waitFor("!!document.querySelector('.xfade-vertical-input')", 10000, 'crossfader');
    await c.clickElement(el.byTitle('Select layer 1 on Deck B'));
    await c.clickElement(trayItem('GridMatrix'));
    await c.waitFor(`!!(${clipCell('GridMatrix')})`, 15000, 'GridMatrix clip on Deck B');
    await c.clickElement(clipCell('GridMatrix'));
    await sleep(1500);
    await c.clickElement(el.byTitle('Cut to Deck B'));
    const deckB = await settledMean(c, deckA);
    const fader = await c.center("document.querySelector('.xfade-vertical-input')");
    await c.click(fader.x, fader.y);
    const half = await c.eval("document.querySelector('.xfade-vertical-input').value");
    const mix = await settledMean(c, deckB);
    await c.clickElement(el.byTitle('Cut to Deck A'));
    const back = await settledMean(c, mix);
    t.number('crossfade', `A ${deckA.rgb} -> B ${deckB.rgb}; fader at ${half}: ${mix.rgb}; back on A ${back.rgb}`);
    t.check('cutting to Deck B changes the output', distance(deckA, deckB) > 0.03, `difference ${distance(deckA, deckB)}`);
    t.check('crossfader at the middle mixes both decks', Number(half) > 0.3 && Number(half) < 0.7 && distance(mix, deckA) > 0.02 && distance(mix, deckB) > 0.02, `fader ${half}, from A ${distance(mix, deckA)}, from B ${distance(mix, deckB)}`);
    t.check('cutting back to Deck A restores its picture', distance(back, deckA) < 0.03, `difference ${distance(back, deckA)}`);
    await t.shot('g-vj');
    t.shared.vjOpen = true;
  },
};
