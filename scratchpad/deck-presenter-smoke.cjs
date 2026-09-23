const { app, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const { createInterface } = require('readline');
const path = require('path');
const fs = require('fs');
app.setPath('userData', path.join(app.getPath('temp'), 'ghost-deck-presenter-smoke'));
let child, window, addon;
app.whenReady().then(async () => {
  const root = path.resolve(__dirname, '..');
  addon = require(path.join(root, 'electron/native/build/Release/dxgi_preview_addon.node'));
  window = new BrowserWindow({ show: false, width: 640, height: 400 });
  await window.loadURL('about:blank');
  child = spawn(path.join(root, 'native-renderer/target/release/ghost-render-core.exe'), [], { windowsHide: true });
  child.stderr.resume();
  let serial = 0;
  const pending = new Map();
  createInterface({ input: child.stdout }).on('line', line => {
    const m = JSON.parse(line), waiter = pending.get(m.id);
    if (waiter) { pending.delete(m.id); m.ok ? waiter.resolve(m.result) : waiter.reject(Error(m.error)); }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++serial, timer = setTimeout(() => reject(Error(method + ' timeout')), 15000);
    pending.set(id, { resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
  await send('start', { config: { backend: 'd3d12', width: 320, height: 180, source_frame_size: 64, target_fps: 60 } });
  await send('submit_commands', { commands: ['a', 'b'].flatMap((bank, i) => [
    { type: 'upload_source_frame', source_id: bank, width: 64, height: 64, rgba_b64: Buffer.from(Array.from({ length: 4096 }, () => i ? [0, 255, 0, 255] : [255, 0, 0, 255]).flat()).toString('base64'), seq: 1 },
    { type: 'upsert_layer', layer_id: bank, opacity: 0, deck_monitor_bank: bank, deck_monitor_opacity: 1, corners: { topLeft: { x: 0, y: 1 }, topRight: { x: 1, y: 1 }, bottomRight: { x: 1, y: 0 }, bottomLeft: { x: 0, y: 0 } } },
    { type: 'bind_media_source', layer_id: bank, source_id: bank, uri: 'test://' + bank, source_type: 'image' },
  ]) });
  for (const [i, bank] of ['a', 'b'].entries()) {
    if (!addon.monitorAttach('deck-' + bank, window.getNativeWindowHandle(), { x: 10 + i * 300, y: 10, width: 280, height: 158, contentWidth: 280, contentHeight: 158 })) throw Error('attach failed: ' + bank);
  }
  let presents = 0;
  for (let i = 0; i < 30; i++) {
    await send('frame_snapshot', { include_pixels: false });
    const state = await send('deck_monitor_state');
    if (!state.available) throw Error('no DXGI deck exports');
    for (const bank of state.banks) {
      if (!addon.monitorSetSharedTexture('deck-' + bank.bank, bank.shared_name, bank.width, bank.height)) throw Error('present failed: ' + bank.bank);
      presents++;
    }
    await new Promise(resolve => setTimeout(resolve, 33));
  }
  for (const bank of ['a', 'b']) if (!addon.monitorDetach('deck-' + bank)) throw Error('detach failed');
  await send('shutdown');
  const result = { passed: true, platform: process.platform, nativeWindowAttach: true, presents, bothMonitorsDetached: true };
  fs.writeFileSync(path.join(root, 'reports/windows-deck-presenter-2026-09-23.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  window.destroy(); app.exit(0);
}).catch(error => { console.error(error); child?.kill(); window?.destroy(); app.exit(1); });
