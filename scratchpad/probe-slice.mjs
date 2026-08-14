import { spawn } from 'child_process';
const bin = 'native-renderer/target/release/ghost-render-core';
const child = spawn(bin, [], { stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '';
const pending = new Map();
let id = 1;
child.stdout.on('data', (c) => {
  buf += c;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    } catch { /* notifications */ }
  }
});
child.stderr.on('data', (c) => process.stderr.write('[core-err] ' + c));
const send = (method, params = {}) => new Promise((res, rej) => {
  const myId = id++;
  pending.set(myId, res);
  child.stdin.write(JSON.stringify({ id: myId, method, params }) + '\n');
  setTimeout(() => rej(new Error('timeout ' + method)), 5000);
});
const show = (label, r) => console.log(label, JSON.stringify(r?.result ?? r?.error ?? r).slice(0, 400));
try {
  show('start ->', await send('start', { backend: 'metal', width: 1280, height: 720, decode_backend: 'ffmpeg_software' }));
  const caps = await send('capabilities');
  const cmds = caps?.result?.implemented_command_types ?? [];
  console.log('has set_slice_outputs   :', cmds.includes('set_slice_outputs'));
  console.log('has set_output_stage    :', cmds.includes('set_output_stage'));
  console.log('has set_composite_effects:', cmds.includes('set_composite_effects'));
  console.log('has set_output_state    :', cmds.includes('set_output_state'));
  show('set_output_state ->', await send('set_output_state', { blackout: true, frozen: false }));
  show('set_composite_effects ->', await send('set_composite_effects', { effects: [{ descriptor: 'hue:0.25', mix: 0.5 }, { descriptor: 'blur:4', mix: 1 }] }));
  show('set_output_stage ->', await send('set_output_stage', {
    domeEnabled: false, cropX: 0.1, cropWidth: 0.5, brightness: 1.2,
    masterWarp: {
      enabled: true, mode: 'mesh',
      corners: { topLeft: {x:0.02,y:0.01}, topRight: {x:0.98,y:0.0}, bottomRight: {x:1.0,y:0.99}, bottomLeft: {x:0.0,y:1.0} },
      meshGrid: { rows: 3, cols: 3, points: [
        [{x:0,y:0},{x:0.5,y:0.02},{x:1,y:0}],
        [{x:0.01,y:0.5},{x:0.52,y:0.5},{x:0.99,y:0.5}],
        [{x:0,y:1},{x:0.5,y:0.98},{x:1,y:1}] ] },
    },
  }));
  show('set_slice_outputs ->', await send('set_slice_outputs', { slices: [
    { id: 'screen-left', width: 1920, height: 1080, cropX: 0, cropW: 0.5, edgeBlendRight: 0.1, edgeBlendGamma: 2.4, blackLevelR: 0.02 },
    { id: 'screen-right', width: 1920, height: 1080, cropX: 0.5, cropW: 0.5, edgeBlendLeft: 0.1,
      warpMode: 'corners',
      corners: { topLeft: {x:0.5,y:0.02}, topRight: {x:1.0,y:0.0}, bottomRight: {x:0.98,y:1.0}, bottomLeft: {x:0.5,y:0.98} } },
    { id: 'screen-mesh', width: 1280, height: 720, warpMode: 'mesh',
      meshGrid: { rows: 3, cols: 3, points: [
        [{x:0,y:0},{x:0.5,y:0.05},{x:1,y:0}],
        [{x:0,y:0.5},{x:0.5,y:0.5},{x:1,y:0.5}],
        [{x:0,y:1},{x:0.5,y:0.95},{x:1,y:1}] ] } },
    { id: 'screen-toobig', width: 1280, height: 720, warpMode: 'mesh',
      meshGrid: { rows: 24, cols: 24, points: [] } },
  ] }));
  show('slice_output_state (immediate) ->', await send('get_slice_output_state'));
  // Slice targets are created lazily inside the render loop, so give the
  // core a few frames before asking again.
  await new Promise((r) => setTimeout(r, 1500));
  show('slice_output_state (after render) ->', await send('get_slice_output_state'));
  await new Promise((r) => setTimeout(r, 1000));
  show('slice_output_state (frames advance) ->', await send('get_slice_output_state'));
} catch (e) {
  console.error('PROBE FAILED:', e.message);
} finally {
  child.kill();
}
