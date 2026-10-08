// Steps of scripts/phone-scan-e2e.mjs (kept apart so each file stays readable).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const PROJECT = `(() => { let p; window.__ghostArcade.project.subscribe((v) => { p = v; })(); return p; })()`;
const MB = 1024 * 1024;

/** Accept, decline, the real file, the Media Library. */
export async function transferChecks(s) {
  const { check, phone, scan, ply, sha } = s;
  // 1. Nobody gets in without the pairing code.
  check('unpaired sender is refused (no code)', (await phone('')).status === 401);
  check('unpaired sender is refused (wrong code)', (await phone('?pair=AAAAAAAAAAAAAAAA')).status === 401);

  // 2. Decline: nothing is written.
  const before = s.filesNow();
  let { ws } = await phone();
  let job = scan.sendScan({ socket: ws, bytes: ply.slice(0, 50_000), name: 'declined.ply', points: 3000 });
  await s.waitFor(`!!document.querySelector('[data-scan-offer]')`, 10000, 'accept prompt');
  const promptText = await s.page(`document.querySelector('[data-scan-offer]').innerText`);
  check('desktop asks before receiving', /wants to send a scan/.test(promptText) && /declined\.ply/.test(promptText) && /3,000 points/.test(promptText), promptText.replace(/\n/g, ' | '));
  await s.click('[data-scan-offer] .scan-btn:not(.primary)');
  let outcome = await job.done;
  check('decline reaches the phone, nothing saved', outcome.state === 'declined' && s.filesNow().join() === before.join(), outcome.message);
  ws.close();

  // 3. The real scan from the phone pipeline.
  ({ ws } = await phone());
  const sizes = [];
  s.tamper(ws, (m) => { sizes.push(JSON.stringify(m).length); return m; });
  const phases = new Set();
  const started = Date.now();
  job = scan.sendScan({ socket: ws, bytes: ply, name: s.plyName, points: 206947, voxelMm: 8, onProgress: (p) => phases.add(p.phase) });
  await s.click('[data-scan-accept]');
  outcome = await job.done;
  const seconds = (Date.now() - started) / 1000;
  ws.close();
  const savedPath = path.join(s.scanDir, outcome.name || '');
  const saved = outcome.state === 'saved' && existsSync(savedPath) ? readFileSync(savedPath) : Buffer.alloc(0);
  check('scan saved on the desktop', outcome.state === 'saved', `${outcome.name} in ${seconds.toFixed(2)} s`);
  check('file is byte-identical', saved.length === ply.length && sha(saved) === sha(ply), `${saved.length} bytes, sha256 ${sha(saved).slice(0, 16)}`);
  check('sent in chunks under the 10 MB message limit', sizes.filter((n) => n > 100_000).length === Math.ceil(ply.length / MB) && Math.max(...sizes) < 10 * MB, `${sizes.filter((n) => n > 100_000).length} chunks, largest message ${(Math.max(...sizes) / MB).toFixed(2)} MB`);
  check('phone saw checking, waiting and sending', ['checking', 'waiting', 'sending'].every((p) => phases.has(p)), [...phases].join(' '));
  check('no partial files left', !readdirSync(s.scanDir).some((n) => n.startsWith('.incoming-')));
  s.savedName = outcome.name;

  await s.waitFor(`!!document.querySelector('[data-scan-arrived]')`, 5000, 'arrival notice');
  const notice = await s.page(`document.querySelector('[data-scan-arrived]').innerText`);
  check('desktop says the scan arrived and offers a layer', /Scan received/.test(notice) && /Add as Point Cloud layer/.test(notice), notice.replace(/\n/g, ' | '));
}

/** The Media Library lists the scan (the library panel shows for a media layer). */
export async function libraryChecks(s) {
  const { check } = s;
  const splatLayers = () => s.page(`(${PROJECT}).layers.filter((l) => l.type === 'splat').length`);
  await s.click('button', 'Add Layer');
  await s.click('button', 'Media Layer');
  await s.waitFor(`!!document.querySelector('[data-tray-tab="scans"]')`, 8000, 'Scan tab in the Media Library');
  await s.click('[data-tray-tab="scans"]');
  const row = await s.waitFor(`(() => { const r = document.querySelector('[data-scan-item=${JSON.stringify(s.savedName)}]'); return r && r.getClientRects().length ? r.innerText : null; })()`, 5000, 'scan row');
  check('scan is listed in the Media Library, Scan tab', /206,947 points/.test(row) && row.includes(s.savedName), row.replace(/\n/g, ' | '));
  const before = await splatLayers();
  await s.click(`[data-scan-item=${JSON.stringify(s.savedName)}] .scan-add`);
  await s.delay(600);
  check('"Add as Point Cloud layer" works from the library too', (await splatLayers()) === before + 1, `${before} -> ${await splatLayers()} point cloud layers`);
}

function litStats(snap) {
  const w = snap.width, h = snap.height;
  const data = Buffer.from(snap.rgba_b64, 'base64');
  // A scaled snapshot is tightly packed; the reported row padding is the full-size frame's.
  const stride = Math.floor(data.length / h);
  let minX = w, maxX = -1, minY = h, maxY = -1, lit = 0;
  const rows = [];
  for (let y = 0; y < h; y++) {
    let a = w, b = -1;
    for (let x = 0; x < w; x++) {
      const o = y * stride + x * 4;
      if (data[o] + data[o + 1] + data[o + 2] > 36) { lit++; if (x < a) a = x; if (x > b) b = x; }
    }
    rows.push(b >= a ? [a, b] : null);
    if (b >= a) { if (a < minX) minX = a; if (b > maxX) maxX = b; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  if (!lit) return { lit: 0 };
  const band = (from, to) => { // widest lit row in a band of the lit box, as a fraction of frame width
    let widest = 0;
    for (let y = Math.round(minY + (maxY - minY) * from); y <= Math.round(minY + (maxY - minY) * to); y++) if (rows[y]) widest = Math.max(widest, rows[y][1] - rows[y][0] + 1);
    return widest / w;
  };
  // Fill: how much of the lit box is actually covered (a gap-free scan from the front is mostly covered).
  return {
    lit, w, h, data, stride,
    width: (maxX - minX + 1) / w, height: (maxY - minY + 1) / h,
    centreX: (minX + maxX + 1) / 2 / w, centreY: (minY + maxY + 1) / 2 / h,
    topWidth: band(0, 0.12), bottomWidth: band(0.88, 1), fill: lit / ((maxX - minX + 1) * (maxY - minY + 1)),
  };
}
async function snapshot(s) {
  return s.page(`window.electronAPI.invoke('native_renderer_get_frame_snapshot', { max_dim: 480, include_pixels: true })`);
}

/** Add as Point Cloud layer: loads, upright, framed, sized, solid. */
export async function layerChecks(s) {
  const { check } = s;
  await s.click('[data-scan-add-layer]');
  const layer = await s.waitFor(`(() => { const p = ${PROJECT}; const l = p.layers.find((x) => x.type === 'splat' && x.splatContent && x.splatContent.activePointCount > 0);
    return l ? { name: l.name, height: p.height, c: (({ filePath, pointCount, activePointCount, pointSize, solidPoints, autoPointSizeFor, dataType, renderMode, importOrientation, cameraFov }) =>
      ({ filePath, pointCount, activePointCount, pointSize, solidPoints, autoPointSizeFor, dataType, renderMode, importOrientation, cameraFov }))(l.splatContent) } : null; })()`, 30000, 'point cloud layer to load');
  const c = layer.c;
  check('layer added and loaded from the saved file', c.pointCount === 206947 && c.activePointCount === 206947 && c.filePath.startsWith('ghost-asset://') && decodeURIComponent(c.filePath).endsWith(s.savedName), `${layer.name}: ${c.activePointCount} points`);
  check('solid points on for the new scan layer', c.solidPoints === true && c.renderMode === 'points' && c.dataType === 'pointcloud');
  // Expected size from the file's own spacing: 1.5 x gap (see splatPointSizeForSpacing).
  const header = Buffer.from(s.ply.slice(0, 2000)).toString('latin1');
  const voxel = Number(/comment voxel_size_m ([0-9.]+)/.exec(header)?.[1]);
  const tanHalf = Math.tan(((c.cameraFov ?? 50) / 2 * Math.PI) / 180);
  const expectLo = 1.5 * voxel * (4 / 3.2) * layer.height / (36 * tanHalf) - 0.06;
  const expectHi = 1.5 * voxel * (4 / 2.8) * layer.height / (36 * tanHalf) + 0.06;
  check('point size set from voxel_size_m', voxel > 0 && c.pointSize >= expectLo && c.pointSize <= expectHi && c.autoPointSizeFor === s.savedName,
    `voxel ${voxel} m -> Point Size ${c.pointSize} (default 3), output height ${layer.height}, field of view ${c.cameraFov}`);
  check('imported as authored (no rotation applied)', (c.importOrientation ?? 'authored') === 'authored', String(c.importOrientation));

  await s.delay(2500);
  let stats = litStats(await snapshot(s));
  for (let i = 0; i < 20 && !stats.lit; i++) { await s.delay(500); stats = litStats(await snapshot(s)); }
  s.solidStats = stats;
  const f = (v) => Number(v).toFixed(3);
  check('scan is drawn in the output', stats.lit > 2000, `${stats.lit} lit pixels of ${stats.w}x${stats.h}`);
  // Expected picture, from the file's own bounds: the cloud fills a 4-unit frame on its longest
  // side, the camera sits 5 away. The near edge of the floor is the widest thing in view.
  const bounds = /comment bounds_min ([-0-9.e]+) ([-0-9.e]+) ([-0-9.e]+)[\s\S]*?comment bounds_max ([-0-9.e]+) ([-0-9.e]+) ([-0-9.e]+)/.exec(header);
  const size = bounds ? [bounds[4] - bounds[1], bounds[5] - bounds[2], bounds[6] - bounds[3]] : [2.988, 1.595, 1.728];
  const norm = 4 / Math.max(...size);
  const nearWidth = (size[0] * norm / 2) / ((5 - size[2] * norm / 2) * tanHalf * (stats.w / stats.h));
  check('framed: centred and filling the view', Math.abs(stats.centreX - 0.5) < 0.04 && Math.abs(stats.centreY - 0.5) < 0.12 && stats.width > nearWidth * 0.85 && stats.width < nearWidth * 1.08 && stats.height > 0.25 && stats.height < 0.7,
    `box ${f(stats.width)} x ${f(stats.height)} of the frame (near edge expected ${f(nearWidth)} wide), centre ${f(stats.centreX)}, ${f(stats.centreY)}`);
  // Upright and facing the viewer: the floor's near edge (bottom of the picture) is wider than the
  // top of the far wall. Upside down or back to front, this flips.
  check('upright: floor in front at the bottom, wall behind at the top', stats.bottomWidth > stats.topWidth * 1.2, `top rows ${f(stats.topWidth)} wide, bottom rows ${f(stats.bottomWidth)} wide`);
  check('gaps closed at the automatic point size', stats.fill > 0.6, `${f(stats.fill)} of the scan's box is covered`);

  // The Solid Points checkbox is live: turning it off with a real click changes the picture
  // (the wall shows through the crate again), turning it back on restores it.
  const box = `input[data-midi-path="map:splat:solidPoints"]`;
  const visible = await s.page(`(() => { const el = document.querySelector(${JSON.stringify(box)}); return !!el && el.getClientRects().length > 0; })()`);
  if (!visible) { check('Solid Points checkbox is in the layer panel', false, 'not visible with the layer selected'); return; }
  await s.click(box);
  await s.delay(1200);
  const soft = litStats(await snapshot(s));
  const softOn = await s.page(`(${PROJECT}).layers.find((x) => x.type === 'splat').splatContent.solidPoints`);
  let changed = 0;
  for (let y = 0; y < stats.h; y++) for (let x = 0; x < stats.w; x++) {
    const o = y * stats.stride + x * 4;
    if (Math.abs(stats.data[o] - soft.data[o]) + Math.abs(stats.data[o + 1] - soft.data[o + 1]) + Math.abs(stats.data[o + 2] - soft.data[o + 2]) > 30) changed++;
  }
  await s.click(box);
  await s.delay(1200);
  const back = litStats(await snapshot(s));
  let restoredDiff = 0;
  for (let y = 0; y < stats.h; y++) for (let x = 0; x < stats.w; x++) {
    const o = y * stats.stride + x * 4;
    if (Math.abs(stats.data[o] - back.data[o]) + Math.abs(stats.data[o + 1] - back.data[o + 1]) + Math.abs(stats.data[o + 2] - back.data[o + 2]) > 30) restoredDiff++;
  }
  check('Solid Points checkbox changes the picture and restores it', softOn === false && changed > 200 && restoredDiff < changed / 10, `${changed} pixels differ with it off, ${restoredDiff} after turning it back on`);
}

/** Hostile name, damaged chunk, abort, resume, oversize. */
export async function faultChecks(s) {
  const { check, phone, scan, ply, sha } = s;
  const outside = () => [s.profile, path.join(s.profile, 'project-assets'), path.dirname(s.profile), '/tmp', '/private/tmp'].flatMap((d) => { try { return readdirSync(d).filter((n) => /evil|authorized_keys/i.test(n)).map((n) => path.join(d, n)); } catch { return []; } });
  const outsideBefore = outside();

  // 5. A modified phone offers a path and an overlong name. Tick "Always accept" here, with real clicks.
  let { ws } = await phone();
  s.tamper(ws, (m) => (m.type === 'studio_scan_offer' ? { ...m, name: `../../../../tmp/${'evil'.repeat(60)}/../.ssh/authorized_keys` } : m));
  let job = scan.sendScan({ socket: ws, bytes: ply.slice(0, 60_000), name: 'x', points: 4000 });
  await s.click('[data-scan-offer] .scan-always input');
  await s.click('[data-scan-accept]');
  let outcome = await job.done;
  ws.close();
  const all = s.filesNow();
  check('hostile name is reduced to a plain file in the scan folder', outcome.state === 'saved' && /^authorized_keys( \(\d+\))?\.ply$/.test(outcome.name) && all.includes(outcome.name) && outside().join() === outsideBefore.join(), `saved as ${outcome.name}`);

  ({ ws } = await phone());
  s.tamper(ws, (m) => (m.type === 'studio_scan_offer' ? { ...m, name: 'N'.repeat(280) } : m));
  outcome = await scan.sendScan({ socket: ws, bytes: ply.slice(0, 60_000), name: 'x', points: 4000 }).done;
  ws.close();
  check('overlong name is cut to 80 characters, accepted without a prompt after "Always accept"', outcome.state === 'saved' && /^N{80}( \(\d+\))?\.ply$/.test(outcome.name) && s.filesNow().includes(outcome.name), `${outcome.name.length} characters`);

  // 6. Oversize offer (65 MB): stopped at the server, the phone gets a plain failure.
  ({ ws } = await phone());
  s.tamper(ws, (m) => (m.type === 'studio_scan_offer' ? { ...m, bytes: 65 * MB } : m));
  outcome = await scan.sendScan({ socket: ws, bytes: ply.slice(0, 60_000), name: 'huge', points: 1, answerMs: 400 }).done;
  ws.close();
  check('oversize offer is not accepted', outcome.state === 'failed' && !s.filesNow().some((n) => n.startsWith('huge')), outcome.message);

  // 7. One chunk damaged on the way: asked for again, file still identical.
  ({ ws } = await phone());
  let damage = 1, chunkMessages = 0;
  s.tamper(ws, (m) => {
    if (m.type !== 'studio_scan_chunk') return m;
    chunkMessages++;
    return m.index === 1 && damage-- > 0 ? { ...m, data: `AAAAAAAA${m.data.slice(8)}` } : m;
  });
  outcome = await scan.sendScan({ socket: ws, bytes: ply, name: 'damaged chunk.ply', points: 206947 }).done;
  ws.close();
  const repaired = outcome.state === 'saved' ? readFileSync(path.join(s.scanDir, outcome.name)) : Buffer.alloc(0);
  check('damaged chunk is sent again and the file is identical', sha(repaired) === sha(ply) && chunkMessages === Math.ceil(ply.length / MB) + 1, `${chunkMessages} chunk messages for ${Math.ceil(ply.length / MB)} chunks`);

  // 8. Damage that passes the chunk check: the whole-file hash rejects it.
  ({ ws } = await phone());
  s.tamper(ws, (m) => {
    if (m.type !== 'studio_scan_chunk' || m.index !== 1) return m;
    const part = new Uint8Array(Buffer.from(m.data, 'base64'));
    part[1000] ^= 0xff;
    return { ...m, crc32: scan.crc32(part), data: scan.bytesToBase64(part) };
  });
  outcome = await scan.sendScan({ socket: ws, bytes: ply, name: 'damaged file.ply', points: 206947 }).done;
  ws.close();
  check('a file that fails the hash check is not kept', outcome.state === 'failed' && !s.filesNow().some((n) => n.startsWith('damaged file')), outcome.message);

  // 9. Abort part way.
  ({ ws } = await phone());
  job = scan.sendScan({ socket: ws, bytes: ply, name: 'aborted.ply', points: 206947, onProgress: (p) => { if (p.phase === 'sending' && p.sent >= MB) job.abort(); } });
  outcome = await job.done;
  await s.delay(500);
  ws.close();
  const leftovers = readdirSync(s.scanDir).filter((n) => n.startsWith('.incoming-'));
  check('abort part way leaves nothing', outcome.state === 'aborted' && !s.filesNow().some((n) => n.startsWith('aborted')) && leftovers.length === 0, `${leftovers.length} partial files`);
  const cards = await s.page(`document.querySelectorAll('[data-scan-progress]').length`);
  check('desktop progress card is gone after the abort', cards === 0, `${cards} cards`);

  // 10. Connection drops part way; the phone reconnects and sends again with the same request.
  ({ ws } = await phone());
  let firstChunks = 0;
  s.tamper(ws, (m) => { if (m.type === 'studio_scan_chunk') firstChunks++; return m; });
  const first = ws;
  job = scan.sendScan({ socket: ws, bytes: ply, name: 'resumed.ply', points: 206947, onProgress: (p) => { if (p.phase === 'sending' && p.sent >= MB) first.terminate(); } });
  outcome = await job.done;
  const dropped = outcome.state;
  await s.delay(300);
  ({ ws } = await phone());
  let secondChunks = 0, firstIndex = -1;
  s.tamper(ws, (m) => { if (m.type === 'studio_scan_chunk') { if (firstIndex < 0) firstIndex = m.index; secondChunks++; } return m; });
  outcome = await scan.sendScan({ socket: ws, bytes: ply, name: 'resumed.ply', points: 206947, requestId: job.requestId }).done;
  ws.close();
  const resumed = outcome.state === 'saved' ? readFileSync(path.join(s.scanDir, outcome.name)) : Buffer.alloc(0);
  check('resume after a dropped connection carries on, file identical', dropped === 'failed' && sha(resumed) === sha(ply) && firstIndex >= 1 && firstChunks + secondChunks === Math.ceil(ply.length / MB),
    `first connection sent ${firstChunks} chunk(s), second started at chunk ${firstIndex} and sent ${secondChunks}`);
  check('no partial files left at the end', !readdirSync(s.scanDir).some((n) => n.startsWith('.incoming-')), s.filesNow().join(', '));
}
