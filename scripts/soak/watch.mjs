// Watches a soak run from outside and exits when it needs a person:
//   exit 0  the run finished (prints PASS/FAIL and the report path)
//   exit 3  the run looks stalled (heartbeat file not updated for --stall minutes)
//   exit 4  a new incident (crash, hang, editor reload, core restart) when --on-incident
//   exit 5  the runner process is gone without finishing (a report is rebuilt from its files)
//
//   npm run soak:watch -- <session folder> [--stall 10] [--pid <runner pid>] [--on-incident]
//
// Pair it with every long or unattended run: a done flag alone never says a
// run died half way.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const dir = path.resolve(args.find((a) => !a.startsWith('--') && !/^\d+$/.test(a)) ?? '.');
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const stallMin = Number(opt('--stall', 10));
const pid = Number(opt('--pid', 0)) || null;
const onIncident = args.includes('--on-incident');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (p) => { try { process.kill(p, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const lines = (f) => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).length; } catch { return 0; } };

const hbFile = path.join(dir, 'heartbeat.json');
const incFile = path.join(dir, 'incidents.jsonl');
let seenIncidents = lines(incFile);
console.log(`[watch] ${dir} (stall after ${stallMin} min${pid ? `, runner pid ${pid}` : ''})`);
for (;;) {
  await sleep(15000);
  let hb = null;
  try { hb = JSON.parse(fs.readFileSync(hbFile, 'utf8')); } catch { /* not yet */ }
  if (hb?.finished) {
    console.log(`[watch] finished: ${hb.reason} -> ${hb.pass ? 'PASS' : 'FAIL'}; report ${path.join(dir, 'report.html')}`);
    process.exit(0);
  }
  const n = lines(incFile);
  if (n > seenIncidents) {
    const fresh = fs.readFileSync(incFile, 'utf8').split('\n').filter(Boolean).slice(seenIncidents);
    seenIncidents = n;
    for (const l of fresh) console.log(`[watch] incident: ${l.slice(0, 300)}`);
    if (onIncident) process.exit(4);
  }
  if (pid && !alive(pid)) {
    console.log('[watch] the runner is gone without finishing; rebuilding the report from its files');
    spawnSync(process.execPath, [path.join(here, 'run.mjs'), '--report-only', dir], { stdio: 'inherit' });
    process.exit(5);
  }
  const age = hb ? (Date.now() - Date.parse(hb.at)) / 60000 : (Date.now() - fs.statSync(dir).mtimeMs) / 60000;
  if (age > stallMin) {
    console.log(`[watch] no heartbeat for ${age.toFixed(1)} min (last: step ${hb?.step}, run ${hb?.run})`);
    process.exit(3);
  }
}
