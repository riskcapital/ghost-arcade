import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const binary = resolve('native-renderer/target/release', process.platform === 'win32' ? 'ghost-render-core.exe' : 'ghost-render-core');
const deadline = (promise, label, ms = 15000) => {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
  })]).finally(() => clearTimeout(timer));
};
function ready(child) {
  return new Promise((resolveReady, reject) => {
    let buffer = '';
    child.stdout.on('data', chunk => {
      buffer += chunk;
      for (const line of buffer.split('\n').slice(0, -1)) {
        try { const message = JSON.parse(line); if (message.id === 1 && message.ok) resolveReady(); } catch {}
      }
      buffer = buffer.slice(buffer.lastIndexOf('\n') + 1);
    });
    child.once('error', reject);
    child.once('exit', code => reject(new Error(`Exited before ready: ${code}`)));
  });
}

// EOF must terminate a ready renderer, without a shutdown RPC.
const core = spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'] });
core.stderr.resume();
try {
  const initialized = ready(core);
  core.stdin.write(JSON.stringify({ id: 1, method: 'status', params: {} }) + '\n');
  await deadline(initialized, 'Renderer ready');
  const exited = once(core, 'exit');
  core.stdin.end();
  const [code, signal] = await deadline(exited, 'Owner pipe EOF');
  assert.equal(code, 0); assert.equal(signal, null);
  console.log('PASS: owner pipe EOF exits cleanly');
} finally { if (core.exitCode === null) core.kill('SIGKILL'); }

// Abrupt broker death closes stdin even without application cleanup hooks.
// The core inherits the broker stdout pipe: it stays open until BOTH exit.
const broker = spawn(process.execPath, ['--input-type=module', '-e', `
  import { spawn } from 'node:child_process';
  const core = spawn(process.argv[1], [], { stdio: ['pipe', 'inherit', 'inherit'] });
  core.stdin.write(JSON.stringify({ id: 1, method: 'status', params: {} }) + '\\n');
  console.log(JSON.stringify({ childPid: core.pid }));
  setInterval(() => {}, 1000);
`, binary], { stdio: ['ignore', 'pipe', 'pipe'] });
broker.stderr.resume();
let childPid;
broker.stdout.on('data', chunk => {
  for (const line of String(chunk).split('\n')) {
    try { childPid = JSON.parse(line).childPid ?? childPid; } catch {}
  }
});
try {
  await deadline(ready(broker), 'Broker renderer ready');
  const closed = once(broker.stdout, 'end');
  broker.kill('SIGKILL');
  await deadline(closed, 'Renderer exit after broker crash');
  childPid = undefined;
  console.log('PASS: abrupt broker death releases renderer stdout');
} finally {
  if (broker.exitCode === null) broker.kill('SIGKILL');
  if (childPid) { try { process.kill(childPid, 'SIGKILL'); } catch {} }
}
