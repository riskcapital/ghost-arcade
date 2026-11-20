// The soak runner's own checks: npm run soak:selftest
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeRng } from './rng.mjs';
import { regression, errorKey, analyse, median } from './detect.mjs';
import { treeOf, roleOf, folderSize } from './proc.mjs';

const config = JSON.parse(fs.readFileSync(new URL('../soak.config.json', import.meta.url), 'utf8'));

test('the same seed and step give the same choices', () => {
  const a = makeRng(42).fork(7); const b = makeRng(42).fork(7);
  const seqA = Array.from({ length: 20 }, () => a.next());
  const seqB = Array.from({ length: 20 }, () => b.next());
  assert.deepEqual(seqA, seqB);
  assert.notDeepEqual(seqA, Array.from({ length: 20 }, makeRng(42).fork(8).next));
  const r = makeRng(1);
  for (let i = 0; i < 1000; i++) { const v = r.int(2, 5); assert.ok(v >= 2 && v <= 5); }
  assert.equal(makeRng(3).weighted([{ weight: 0, n: 'a' }, { weight: 1, n: 'b' }]).n, 'b');
  assert.equal(makeRng(3).weighted([{ weight: 0 }]), null);
});

test('regression finds a slope', () => {
  const r = regression([[0, 10], [1, 12], [2, 14], [3, 16]]);
  assert.ok(Math.abs(r.slope - 2) < 1e-9);
  assert.ok(r.r2 > 0.99);
  assert.equal(median([3, 1, 2]), 2);
});

test('error messages group without their numbers and ids', () => {
  assert.equal(errorKey('Failed at 12 for 0f8fad5b-d9cb-469f-a165-70867728950e'), errorKey('Failed at 99 for 7c9e6679-7425-40de-944b-e07fc1f90ae7'));
});

test('a steady leak at checkpoints fails; flat memory passes', () => {
  const H = 3600000;
  const mk = (perHour) => Array.from({ length: 8 }, (_, i) => ({ t: (i * H) / 4, run: 1, step: i * 60, checkpoint: true, sinceLaunchMs: (i * H) / 4 + 120000,
    proc: { totalMB: 2000 + i * perHour / 4, roles: { main: { rssMB: 200 }, renderer: { rssMB: 1000 + (i * perHour) / 4 }, gpu: { rssMB: 100 }, core: { rssMB: 150 } } },
    renderer: { heapMB: 80, nodes: 5000, listeners: 900 }, refFps: 60, refGpuMs: 2 }));
  const run = (baselines) => analyse({ samples: baselines, baselines, incidents: [], trace: [], console: [], config, durationMs: 2 * H, hidden: false });
  const leaky = run(mk(400));
  assert.equal(leaky.findings.find((f) => f.id === 'memory.renderer-MB').severity, 'fail');
  const flat = run(mk(0));
  assert.equal(flat.findings.find((f) => f.id === 'memory.renderer-MB').severity, 'pass');
  assert.ok(flat.pass, flat.findings.filter((f) => f.severity === 'fail').map((f) => f.title).join(', '));
});

test('a crash fails the run; area failure rates are judged per area', () => {
  const trace = [
    ...Array.from({ length: 9 }, (_, i) => ({ kind: 'action', area: 'vj', status: 'pass', step: i })),
    { kind: 'action', area: 'render', status: 'fail', step: 10, error: 'frames' },
  ];
  const r = analyse({ samples: [], baselines: [], incidents: [{ kind: 'crash', t: 1 }], trace, console: [], config, durationMs: 60000, hidden: false });
  assert.equal(r.findings.find((f) => f.id === 'stability.crashes').severity, 'fail');
  assert.equal(r.areas.render.status, 'fail');
  assert.equal(r.areas.vj.status, 'pass');
});

test('process tree and roles', () => {
  const rows = [
    { pid: 1, ppid: 0, args: 'Electron' }, { pid: 2, ppid: 1, args: 'Helper --type=renderer' },
    { pid: 3, ppid: 1, args: 'Helper --type=gpu-process' }, { pid: 4, ppid: 1, args: '/x/ghost-render-core --ipc' },
    { pid: 5, ppid: 2, args: 'Helper --type=utility --utility-sub-type=audio.mojom.AudioService' }, { pid: 9, ppid: 8, args: 'other' },
  ];
  assert.deepEqual(treeOf(rows, 1).map((r) => r.pid).sort(), [1, 2, 3, 4, 5]);
  assert.deepEqual([1, 2, 3, 4, 5].map((p) => roleOf(rows.find((r) => r.pid === p).args, 1, p)), ['main', 'renderer', 'gpu', 'core', 'audio']);
});

test('folder size', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soak-test-'));
  fs.mkdirSync(path.join(dir, 'a'));
  fs.writeFileSync(path.join(dir, 'a', 'f'), Buffer.alloc(2 * 1048576));
  assert.deepEqual(folderSize(dir), { mb: 2, files: 1 });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.deepEqual(folderSize(dir), { mb: 0, files: 0 });
});
