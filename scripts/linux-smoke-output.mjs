// Steps g2 and h of scripts/linux-smoke.mjs: a clip with sound on a machine
// with no sound device, then the Output Window, fullscreen and a clean quit.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { el, sleep } from './linux-smoke-cdp.mjs';
import { stats } from './linux-smoke-image.mjs';
import { findTool } from './linux-smoke-live.mjs';
import { dropFile, rpc, round } from './linux-smoke-steps.mjs';
import { findWindows, rootScreenshot, rootSize, windowInfo, windowState } from './linux-smoke-x11.mjs';

const corePids = (t) => t.descendants().filter((p) => /ghost-render-core/.test(p.command)).map((p) => p.pid);

// ── g2 ─────────────────────────────────────────────────────────────────────
export const stepClipAudio = {
  id: 'g2', title: 'A video clip with sound plays; no sound device does not crash the core',
  async run(t) {
    const { c } = t;
    const ffmpeg = findTool('ffmpeg');
    if (!ffmpeg) { t.skip('no ffmpeg on this machine to make a test clip with an audio track'); return; }
    const clip = path.join(t.outDir, 'g2-tone-clip.mp4');
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
      '-t', '6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clip], { timeout: 120000 });
    if (!(await c.exists("document.querySelector('.clip-cell')"))) {
      await c.clickElement(el.byTitle('Open VJ Mixer'));
      await c.waitFor("document.querySelectorAll('.clip-cell').length>0", 60000, 'VJ grid');
    }
    const before = corePids(t);
    const item = "[...document.querySelectorAll('.media-item')].find(e=>e.textContent.includes('g2-tone-clip'))";
    await dropFile(c, "document.querySelector('.media-content[aria-label=\"Media drop zone\"]')", clip);
    if (!(await c.waitFor(`!!(${item})`, 8000, 'clip in the media library').catch(() => false))) {
      await c.clickElement("[...document.querySelectorAll('.media-tray .tab, .tab')].find(b=>/^Vid/.test(b.textContent.trim()))");
      await c.waitFor(`!!(${item})`, 20000, 'clip under the Vid tab');
    }
    await c.clickElement(el.byTitle('Select layer 2 on Deck A'));
    await c.clickElement(item);
    const cell = "[...document.querySelectorAll('.clip-cell.has-clip')].find(e=>e.textContent.includes('g2-tone-clip'))";
    await c.waitFor(`!!(${cell})`, 20000, 'clip in the grid');
    await c.clickElement(cell);
    // Decode is FFmpeg software decode in the core on Linux; give it time.
    let status = null;
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      status = await rpc(c, 'native_renderer_get_status');
      if (Number(status?.native_video_frame_decodes) > 3) break;
      await sleep(1000);
    }
    const first = await rpc(c, 'native_renderer_get_output_shared_texture_snapshot', { include_pixels: false }, 120000);
    await sleep(2500);
    const second = await rpc(c, 'native_renderer_get_output_shared_texture_snapshot', { include_pixels: false }, 120000);
    const after = await rpc(c, 'native_renderer_get_status');
    t.number('videoDecode', `${after?.native_video_frame_decodes} frames decoded (${after?.native_video_software_frames} software, ${after?.native_video_hardware_frames} hardware), failures ${after?.native_video_frame_decode_failures}, last error "${after?.native_video_frame_decode_last_error}"`);
    t.check('the core decodes the video clip', Number(after?.native_video_frame_decodes) > 3, `${after?.native_video_frame_decodes} frames`);
    t.check('the playing clip changes the output over time', first?.checksum !== second?.checksum, `${first?.checksum} -> ${second?.checksum}`);
    const audio = await rpc(c, 'native_renderer_audio_status').catch((error) => ({ error: String(error.message) }));
    const devices = await rpc(c, 'native_renderer_audio_devices').catch((error) => ({ error: String(error.message) }));
    const deviceCount = Array.isArray(devices?.devices) ? devices.devices.length : Array.isArray(devices) ? devices.length : null;
    t.number('audio', `devices=${deviceCount ?? JSON.stringify(devices)?.slice(0, 120)} status=${JSON.stringify(audio)?.slice(0, 260)}`);
    const now = corePids(t);
    t.check('the core survived playing sound (same process, still running)', after?.running === true && now.length === 1 && (t.args.attach || now[0] === before[0]), `before ${before} after ${now}`);
    t.check('no panic in the app log', !/panicked at|thread '.*' panicked/.test(t.appLogText()), t.appLogText().split('\n').find((line) => /panicked/.test(line)) || '');
    await t.shot('g2-clip');
  },
};

// ── h ──────────────────────────────────────────────────────────────────────
const outputStatus = async (c) => {
  const s = await rpc(c, 'native_renderer_get_status');
  return { attached: !!s?.output_window_attached, ready: !!s?.output_swapchain_ready, presented: Number(s?.swapchain_presented || 0), last: s?.swapchain_last_present_result, error: s?.swapchain_last_present_error };
};

const OUTPUT_TITLE = '^Ghost Arcade Native Output$';

export const stepOutputAndQuit = {
  id: 'h', title: 'Output Window opens, fullscreen toggles, the app quits cleanly',
  async run(t) {
    const { c } = t;
    if (await c.exists(el.button('Exit VJ'))) { await c.clickElement(el.button('Exit VJ')); await sleep(1500); }
    await c.clickElement(el.byTitle('Open Output Window'));
    let out = null;
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      out = await outputStatus(c);
      if (out.attached && out.presented > 0) break;
      await sleep(1000);
    }
    t.check('Output Window is attached to the core', out.attached && out.ready, JSON.stringify(out));
    const later = (await sleep(3000), await outputStatus(c));
    t.number('outputPresent', `${out.presented} -> ${later.presented} frames presented in 3 s (last result ${later.last})`);
    if (t.isLinux) {
      t.check('core presents frames into the Output Window', later.presented > out.presented, `${out.presented} -> ${later.presented}, last ${later.last} ${later.error || ''}`);
      const id = findWindows(OUTPUT_TITLE).map((entry) => windowInfo(entry)).find((info) => info?.viewable && info.width > 100);
      t.number('x11OutputWindow', id ? `${id.id} ${id.width}x${id.height}+${id.x}+${id.y}` : 'not found');
      t.check('Output Window is on the X display', !!id, 'no viewable "Ghost Arcade Native Output" window');
      const root = rootScreenshot(path.join(t.outDir, 'h-x11-output-window.png'));
      if (id && root) {
        const shown = stats(root, { x: id.x, y: id.y, width: id.width, height: id.height });
        t.number('x11OutputPicture', `meanLuma=${shown.meanLuma} nonBlack=${shown.nonBlackFraction}`);
        t.check('Output Window shows the picture on the display', shown.nonBlackFraction > 0.02, JSON.stringify(shown));
      }
      await c.clickElement(el.button('Fullscreen'));
      const size = rootSize();
      let full = null;
      for (let i = 0; i < 30; i++) {
        await sleep(500);
        full = findWindows(OUTPUT_TITLE).map((entry) => ({ ...windowInfo(entry), state: windowState(entry) })).find((info) => info?.viewable && info.width === size?.width && info.height === size?.height) || null;
        if (full) break;
      }
      t.number('x11Fullscreen', full ? `${full.width}x${full.height}+${full.x}+${full.y} ${full.state}` : `no window at ${size?.width}x${size?.height}`);
      t.check('Fullscreen makes the output cover the display', !!full, full ? '' : JSON.stringify(findWindows(OUTPUT_TITLE).map((entry) => windowInfo(entry))));
      const fullOut = await outputStatus(c);
      await sleep(2000);
      const fullLater = await outputStatus(c);
      t.check('frames keep being presented in fullscreen', fullLater.presented > fullOut.presented, `${fullOut.presented} -> ${fullLater.presented}`);
      rootScreenshot(path.join(t.outDir, 'h-x11-fullscreen.png'));
    } else {
      t.note(`presented ${out.presented} -> ${later.presented}; another window may cover the output on this desktop, so presentation is not asserted here`);
      await c.clickElement(el.button('Fullscreen'));
      await sleep(2500);
      t.check('output stays attached in fullscreen', (await outputStatus(c)).attached);
    }
    // In the native build the Fullscreen button, pressed again, closes the output.
    await c.clickElement(el.button('Fullscreen'));
    let closed = false;
    for (let i = 0; i < 20 && !closed; i++) { await sleep(500); closed = !(await outputStatus(c)).attached; }
    t.check('leaving fullscreen closes the output', closed);

    if (t.args.attach || t.args.keepOpen) { t.skip('quit: attached to an app this run did not start'); return; }
    const before = t.descendants();
    const cores = before.filter((p) => /ghost-render-core/.test(p.command));
    t.number('processes', `${before.length} below the app, ${cores.length} render core`);
    t.check('exactly one render core process is running', cores.length === 1, cores.map((p) => p.pid).join(','));
    if (await c.exists("document.querySelector('button.win-close')")) {
      await c.clickElement("document.querySelector('button.win-close')");
      // Unsaved work: the app asks first, as it should.
      const asked = await c.waitFor("!!document.querySelector('.close-modal .btn-discard')", 6000, 'Unsaved Changes dialog').catch(() => false);
      t.number('unsavedPrompt', asked ? 'shown' : 'not shown');
      if (asked) await c.clickElement("document.querySelector('.close-modal .btn-discard')").catch(() => {});
    } else {
      t.note('no DOM close button on this platform (OS title bar); asking the app to quit with SIGTERM');
      t.app().kill('SIGTERM');
    }
    const exit = await Promise.race([t.app().exited, sleep(20000).then(() => null)]);
    t.check('app exits within 20 s of Close', !!exit, exit ? `code=${exit.code} signal=${exit.signal}` : 'still running');
    await sleep(2000);
    const orphans = before.filter((p) => t.alive(p.pid));
    t.number('orphans', orphans.length);
    t.check('no process survives the quit (core, helpers, ffmpeg)', orphans.length === 0, orphans.map((p) => `${p.pid} ${p.command.slice(0, 90)}`).join(' | '));
    if (t.isLinux) {
      let stray = '';
      try { stray = execFileSync('pgrep', ['-fl', 'ghost-render-core'], { encoding: 'utf8' }).trim(); } catch { /* none */ }
      t.check('no ghost-render-core left on the machine', stray === '', stray);
    }
  },
};
