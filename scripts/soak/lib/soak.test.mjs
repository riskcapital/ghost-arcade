// The soak runner's own checks: npm run soak:selftest
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeRng } from './rng.mjs';
import { regression, errorKey, analyse, median } from './detect.mjs';
import { treeOf, roleOf, folderSize, vmSizeMB, parseVmmapSummary } from './proc.mjs';

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

test('with footprints measured, the leak check uses them, and resident memory is for reading', () => {
  const H = 3600000;
  // Resident memory climbs 400 MB/h (freed pages, shared code); the footprint climbs `fpPerHour`.
  const mk = (fpPerHour) => Array.from({ length: 8 }, (_, i) => ({ t: (i * H) / 4, run: 1, step: i * 60, checkpoint: true, sinceLaunchMs: (i * H) / 4 + 120000,
    proc: { totalMB: 2000, roles: { main: { rssMB: 200 + i * 100 }, renderer: { rssMB: 1000 }, gpu: { rssMB: 100 }, core: { rssMB: 150 } } },
    vm: { main: { footprintMB: 80 + (i * fpPerHour) / 4 }, renderer: { footprintMB: 400 }, gpu: { footprintMB: 300 }, core: { footprintMB: 350 } },
    renderer: { heapMB: 80, nodes: 5000, listeners: 900 }, refFps: 60, refGpuMs: 2 }));
  const run = (baselines) => analyse({ samples: baselines, baselines, incidents: [], trace: [], console: [], config, durationMs: 2 * H, hidden: false });
  const flat = run(mk(0));
  const main = flat.findings.find((f) => f.id === 'memory.main-MB');
  assert.equal(main.severity, 'pass');
  assert.match(main.title, /footprint/);
  assert.equal(flat.findings.find((f) => f.id === 'memory.main-resident-MB').severity, 'info');
  assert.equal(run(mk(200)).findings.find((f) => f.id === 'memory.main-MB').severity, 'fail');
  // A run without footprints (Windows, Linux) still judges resident memory.
  const noVm = mk(0).map(({ vm, ...b }) => b);
  assert.equal(run(noVm).findings.find((f) => f.id === 'memory.main-MB').severity, 'fail');
});

test('growth in the warm-up minutes is shown but not judged; growth after it is', () => {
  const M = 60000;
  // Checkpoints every 5 minutes for an hour. The footprint climbs 300 MB in the
  // first 15 minutes (first use of features), then `after` MB per hour.
  const mk = (after, nodesAfter = 0) => Array.from({ length: 13 }, (_, i) => {
    const min = i * 5;
    const fp = 150 + Math.min(min, 15) * 20 + (Math.max(0, min - 15) / 60) * after;
    return { t: min * M, run: 1, step: i * 60, checkpoint: true, sinceLaunchMs: min * M + 60000,
      proc: { totalMB: 2000, roles: { main: { rssMB: 200 }, renderer: { rssMB: 600 }, gpu: { rssMB: 100 }, core: { rssMB: 150 } } },
      vm: { main: { footprintMB: 80 }, renderer: { footprintMB: fp }, gpu: { footprintMB: 300 }, core: { footprintMB: 350 } },
      renderer: { heapMB: 80, nodes: min < 15 ? 2000 + min * 3000 : 50000 + (min - 15) * nodesAfter, listeners: 900 }, refFps: 60, refGpuMs: 2 };
  });
  const run = (baselines) => analyse({ samples: baselines, baselines, incidents: [], trace: [], console: [], config, durationMs: 3600000, hidden: false });
  const warm = run(mk(0)).findings;
  assert.equal(warm.find((f) => f.id === 'memory.nodes').severity, 'pass');
  assert.equal(run(mk(0, 500)).findings.find((f) => f.id === 'memory.nodes').severity, 'fail');
  assert.equal(warm.find((f) => f.id === 'memory.renderer-MB').severity, 'pass');
  const whole = warm.find((f) => f.id === 'memory.renderer-MB-whole-run');
  assert.equal(whole.severity, 'info');
  assert.ok(parseFloat(whole.value) > config.thresholds.leakMBPerHour.renderer, whole.value);
  assert.equal(run(mk(200)).findings.find((f) => f.id === 'memory.renderer-MB').severity, 'fail');
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

test('vmmap summary parsing', () => {
  assert.equal(vmSizeMB('16.0M'), 16);
  assert.equal(vmSizeMB('512K'), 0.5);
  assert.equal(vmSizeMB('1.5G'), 1536);
  const text = [
    'Physical footprint:         332.1M',
    '                                VIRTUAL RESIDENT    DIRTY  SWAPPED VOLATILE   NONVOL    EMPTY   REGION ',
    'REGION TYPE                        SIZE     SIZE     SIZE     SIZE     SIZE     SIZE     SIZE    COUNT (non-coalesced) ',
    '===========                     ======= ========    =====  ======= ========   ======    =====  ======= ',
    'owned unmapped (graphics)         141.8M   141.8M   141.8M       0K       0K       0K       0K        1 ',
    'MALLOC_SMALL                      48.0M    39.9M    39.9M       0K       0K       0K       0K        6         see MALLOC ZONE table below',
    'Memory Tag 253                    80.0M    41.5M    34.4M       0K       0K       0K       0K       10 ',
    'tiny                                16K      16K      16K       0K       0K       0K       0K        1 ',
    '===========                     ======= ========    =====  ======= ========   ======    =====  ======= ',
    'TOTAL                             1.0G     500M     300M       0K       0K       0K       0K      100 ',
    '',
    '                                 VIRTUAL   RESIDENT      DIRTY    SWAPPED ALLOCATION      BYTES DIRTY+SWAP          REGION',
    'MALLOC ZONE                         SIZE       SIZE       SIZE       SIZE      COUNT  ALLOCATED  FRAG SIZE  % FRAG   COUNT',
    '===========                      =======  =========  =========  =========  =========  =========  =========  ======  ======',
    'DefaultMallocZone_0x100c14000      96.0M      80.0M      76.0M         0K      62843      59.4M      16.6M     22%       8',
  ].join('\n');
  const vm = parseVmmapSummary(text);
  assert.equal(vm.footprintMB, 332.1);
  assert.deepEqual(vm.regions['owned unmapped (graphics)'], { res: 141.8, dirty: 141.8, swap: 0 });
  assert.deepEqual(vm.regions['Memory Tag 253'], { res: 41.5, dirty: 34.4, swap: 0 });
  assert.equal(vm.regions.tiny, undefined);
  assert.equal(vm.regions.TOTAL, undefined);
  assert.deepEqual(vm.malloc.DefaultMallocZone, { count: 62843, allocMB: 59.4, dirtyMB: 76 });
});

test('the Audio Lab dock button: covered or already on is not clicked', async () => {
  const { dockTogglePlan } = await import('./actions.mjs');
  // Under the Shader Library (left open by a monkey step) the click would land on a shader card.
  assert.deepEqual(dockTogglePlan({ state: 'covered', by: 'div.shader-library-modal' }), { skip: 'the button is under div.shader-library-modal' });
  // Already open: a click on the toggle would close it.
  assert.deepEqual(dockTogglePlan({ state: 'open' }), { click: false });
  assert.deepEqual(dockTogglePlan({ state: 'closed' }), { click: true });
  assert.ok(dockTogglePlan({ state: 'hidden' }).skip);
  assert.ok(dockTogglePlan({ state: 'absent' }).skip);
  assert.ok(dockTogglePlan(null).skip);
});

test('the live-set profile plays a set: only performing actions, every one of them real', async () => {
  const { ACTIONS, PROFILES } = await import('./actions.mjs');
  const live = PROFILES['live-set'];
  assert.ok(live && typeof live.setup === 'function');
  assert.equal(live.blankCheckpoints, false);
  const names = Object.keys(live.weights);
  for (const name of names) assert.ok(ACTIONS.some((a) => a.name === name), `no action ${name}`);
  const areas = new Set(names.map((n) => ACTIONS.find((a) => a.name === n).area));
  for (const editing of ['templates', 'mapping', 'render', 'project', 'settings', 'window', 'monkey', 'interactive', 'addons']) {
    assert.ok(!areas.has(editing), `${editing} is editing churn, not a set`);
  }
  // Most of a set is just playing.
  const total = names.reduce((s, n) => s + live.weights[n], 0);
  assert.ok(live.weights['live.keepPlaying'] / total >= 0.3);
  // An ordinary run never picks the live-set-only action.
  assert.equal(ACTIONS.find((a) => a.name === 'live.keepPlaying').weight, 0);
});
