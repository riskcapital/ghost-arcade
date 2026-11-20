// Process-tree memory and CPU on macOS, Linux and Windows, with no extra
// packages: `ps` on macOS/Linux, PowerShell's Win32_Process on Windows.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const IS_WIN = process.platform === 'win32';

function run(cmd, args, timeoutMs = 20000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout) => resolve(err ? '' : String(stdout)));
  });
}

/** `[h:]mm:ss.cc` or `d-hh:mm:ss` (ps cputime) to seconds. */
function psTime(s) {
  let days = 0;
  let rest = s.trim();
  if (rest.includes('-')) { const [d, r] = rest.split('-'); days = Number(d); rest = r; }
  const parts = rest.split(':').map(Number);
  let secs = 0;
  for (const p of parts) secs = secs * 60 + p;
  return days * 86400 + secs;
}

/** Every process: { pid, ppid, rssMB, cpuSec, args }. */
export async function listProcesses() {
  if (IS_WIN) {
    const ps = 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize,PrivatePageCount,KernelModeTime,UserModeTime,Name,CommandLine | ConvertTo-Json -Compress';
    const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], 30000);
    let rows = [];
    try { rows = JSON.parse(out); } catch { return []; }
    if (!Array.isArray(rows)) rows = [rows];
    return rows.map((r) => ({
      pid: r.ProcessId,
      ppid: r.ParentProcessId,
      rssMB: (Number(r.WorkingSetSize) || 0) / 1048576,
      privateMB: (Number(r.PrivatePageCount) || 0) / 1048576,
      // 100 ns units.
      cpuSec: ((Number(r.KernelModeTime) || 0) + (Number(r.UserModeTime) || 0)) / 1e7,
      args: r.CommandLine || r.Name || '',
    }));
  }
  const out = await run('ps', ['-A', '-o', 'pid=,ppid=,rss=,time=,args=']);
  const rows = [];
  for (const line of out.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    rows.push({ pid: Number(m[1]), ppid: Number(m[2]), rssMB: Number(m[3]) / 1024, cpuSec: psTime(m[4]), args: m[5] });
  }
  return rows;
}

/** The root and everything below it. */
export function treeOf(rows, rootPid) {
  const found = [];
  const root = rows.find((r) => r.pid === rootPid);
  if (root) found.push(root);
  const queue = [rootPid];
  const seen = new Set([rootPid]);
  while (queue.length) {
    const parent = queue.shift();
    for (const r of rows) {
      if (r.ppid === parent && !seen.has(r.pid)) { seen.add(r.pid); found.push(r); queue.push(r.pid); }
    }
  }
  return found;
}

/** What a process in the app's tree is for. */
export function roleOf(args, rootPid, pid) {
  if (pid === rootPid) return 'main';
  if (/ghost-render-core/i.test(args)) return 'core';
  const type = args.match(/--type=([a-z-]+)/)?.[1];
  if (type === 'renderer') return 'renderer';
  if (type === 'gpu-process') return 'gpu';
  if (type === 'utility') return /audio/i.test(args) ? 'audio' : 'utility';
  if (/ffmpeg/i.test(args)) return 'ffmpeg';
  if (type) return type;
  return 'other';
}

/**
 * Memory and CPU of the app's tree, summed per role. CPU% is from cputime
 * deltas since the previous call (pass the previous result as `prev`).
 */
export async function sampleTree(rootPid, prev = null) {
  const rows = await listProcesses();
  const tree = treeOf(rows, rootPid);
  const now = Date.now();
  const roles = {};
  const pids = {};
  for (const p of tree) {
    const role = roleOf(p.args, rootPid, p.pid);
    const r = (roles[role] ??= { count: 0, rssMB: 0, cpuSec: 0, cpuPct: 0 });
    r.count++;
    r.rssMB += p.rssMB;
    r.cpuSec += p.cpuSec;
    pids[p.pid] = { role, cpuSec: p.cpuSec };
  }
  if (prev?.pids && prev.at) {
    const dt = (now - prev.at) / 1000;
    for (const [pid, info] of Object.entries(pids)) {
      const before = prev.pids[pid];
      if (before && dt > 0) roles[info.role].cpuPct += Math.max(0, (info.cpuSec - before.cpuSec) / dt * 100);
    }
  }
  for (const r of Object.values(roles)) { r.rssMB = Math.round(r.rssMB * 10) / 10; r.cpuPct = Math.round(r.cpuPct * 10) / 10; }
  const totalMB = Math.round(Object.values(roles).reduce((s, r) => s + r.rssMB, 0));
  return { at: now, roles, pids, totalMB, processCount: tree.length };
}

/** Kill a process and everything below it. */
export async function killTree(rootPid, signal = 'SIGTERM') {
  if (!rootPid) return;
  if (IS_WIN) {
    await run('taskkill', ['/PID', String(rootPid), '/T', ...(signal === 'SIGKILL' ? ['/F'] : [])]);
    return;
  }
  const tree = treeOf(await listProcesses(), rootPid);
  for (const p of tree.reverse()) {
    try { process.kill(p.pid, signal); } catch { /* gone */ }
  }
}

export function alive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; }
}

/** Size of a folder in MB (and its file count); missing = 0. */
export function folderSize(dir, { maxFiles = 200000 } = {}) {
  let bytes = 0;
  let files = 0;
  const stack = [dir];
  while (stack.length && files < maxFiles) {
    const d = stack.pop();
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) {
        try { bytes += fs.statSync(p).size; files++; } catch { /* gone */ }
      }
    }
  }
  return { mb: Math.round(bytes / 1048576 * 10) / 10, files };
}

/** `16.0M` / `240K` / `1.2G` (vmmap sizes) to MB. */
export function vmSizeMB(s) {
  const m = String(s).match(/^([\d.]+)([KMGT]?)$/);
  if (!m) return 0;
  const n = Number(m[1]);
  return { '': n / 1048576, K: n / 1024, M: n, G: n * 1024, T: n * 1048576 }[m[2]];
}

/**
 * macOS: what a process's memory is made of, from `vmmap --summary`.
 * `footprintMB` is the physical footprint (what Activity Monitor calls Memory,
 * and what memory pressure acts on); `rss` from ps also counts clean pages of
 * shared libraries, which grow as more code runs and are not a leak.
 * `regions` keeps every region type with at least 1 MB resident or dirty:
 * { type: { res, dirty, swap } } in MB. `malloc` is the bytes allocated per zone.
 * Null elsewhere or when vmmap fails.
 */
export async function vmSummary(pid) {
  if (process.platform !== 'darwin' || !pid) return null;
  const out = await run('vmmap', ['--summary', String(pid)], 60000);
  return out ? parseVmmapSummary(out) : null;
}

/** The parts of `vmmap --summary` output that vmSummary keeps. */
export function parseVmmapSummary(out) {
  const r1 = (x) => Math.round(x * 10) / 10;
  const fp = out.match(/^Physical footprint:\s+(\S+)/m);
  const regions = {};
  const malloc = {};
  let table = null;
  for (const line of out.split('\n')) {
    if (/^REGION TYPE/.test(line)) { table = 'region'; continue; }
    if (/^MALLOC ZONE/.test(line)) { table = 'malloc'; continue; }
    if (!table || /^=+/.test(line) || !line.trim()) continue;
    if (/^TOTAL/.test(line)) { table = null; continue; }
    const tok = line.trim().split(/\s+/);
    const isSize = (x) => /^[\d.]+[KMGT]$/.test(x ?? '');
    if (table === 'region') {
      // name (may have spaces), virtual, resident, dirty, swapped, volatile, nonvol, empty, count
      const i = tok.findIndex((_, k) => k > 0 && [0, 1, 2, 3, 4, 5, 6].every((j) => isSize(tok[k + j])) && /^\d+$/.test(tok[k + 7] ?? ''));
      if (i < 0) continue;
      const res = vmSizeMB(tok[i + 1]); const dirty = vmSizeMB(tok[i + 2]); const swap = vmSizeMB(tok[i + 3]);
      if (res >= 1 || dirty + swap >= 1) regions[tok.slice(0, i).join(' ')] = { res: r1(res), dirty: r1(dirty), swap: r1(swap) };
    } else {
      // zone, virtual, resident, dirty, swapped, allocation count, bytes allocated, ...
      if (tok.length < 7 || !isSize(tok[1]) || !/^\d+$/.test(tok[5])) continue;
      malloc[tok[0].replace(/_0x[0-9a-f]+$/, '')] = { count: Number(tok[5]), allocMB: r1(vmSizeMB(tok[6])), dirtyMB: r1(vmSizeMB(tok[3]) + vmSizeMB(tok[4])) };
    }
  }
  return { footprintMB: fp ? r1(vmSizeMB(fp[1])) : null, regions, malloc };
}
