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
