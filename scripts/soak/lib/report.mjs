// Writes report.json and report.html into the session folder. The HTML is
// one self-contained file (inline SVG charts, no scripts from the web), so it
// opens anywhere and can be attached to a release ticket as is.
import fs from 'node:fs';
import path from 'node:path';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtDur = (ms) => { const s = Math.round(ms / 1000); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); return `${h ? `${h}h ` : ''}${m}m ${s % 60}s`; };
const COLORS = ['#2f6fdf', '#d9534f', '#2a9d5b', '#e09b2d', '#8a5cd6', '#1aa3b8', '#c2457a', '#6b7280'];

/** A line chart: series = [{ name, points: [[tMs, value]] }]; marks = [{ t, label, color }]. */
function chart(title, series, { unit = '', marks = [], height = 220 } = {}) {
  const W = 920; const Hh = height; const L = 56; const R = 12; const T = 28; const B = 26;
  const all = series.flatMap((s) => s.points).filter(([, v]) => Number.isFinite(v));
  if (!all.length) return `<section class="chart"><h3>${esc(title)}</h3><p class="muted">no data</p></section>`;
  const t0 = Math.min(...all.map(([t]) => t)); const t1 = Math.max(...all.map(([t]) => t), t0 + 1);
  let v0 = Math.min(0, ...all.map(([, v]) => v)); let v1 = Math.max(...all.map(([, v]) => v));
  if (v1 === v0) v1 = v0 + 1;
  v1 += (v1 - v0) * 0.05;
  const x = (t) => L + ((t - t0) / (t1 - t0)) * (W - L - R);
  const y = (v) => T + (1 - (v - v0) / (v1 - v0)) * (Hh - T - B);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => v0 + f * (v1 - v0));
  const tticks = [0, 0.25, 0.5, 0.75, 1].map((f) => t0 + f * (t1 - t0));
  const lines = series.map((s, i) => {
    const pts = s.points.filter(([, v]) => Number.isFinite(v));
    if (!pts.length) return '';
    const d = pts.map(([t, v], k) => `${k ? 'L' : 'M'}${x(t).toFixed(1)},${y(v).toFixed(1)}`).join('');
    return `<path d="${d}" fill="none" stroke="${s.color ?? COLORS[i % COLORS.length]}" stroke-width="1.6"${s.dashed ? ' stroke-dasharray="4 3"' : ''}/>` +
      (s.dots ? pts.map(([t, v]) => `<circle cx="${x(t).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3" fill="${s.color ?? COLORS[i % COLORS.length]}"/>`).join('') : '');
  }).join('');
  const markEls = marks.filter((m) => m.t >= t0 && m.t <= t1).map((m) => `<line x1="${x(m.t)}" x2="${x(m.t)}" y1="${T}" y2="${Hh - B}" stroke="${m.color ?? '#d9534f'}" stroke-width="1" stroke-dasharray="3 3"><title>${esc(m.label)}</title></line>`).join('');
  const legend = series.map((s, i) => `<span><i style="background:${s.color ?? COLORS[i % COLORS.length]}"></i>${esc(s.name)}</span>`).join('');
  return `<section class="chart"><h3>${esc(title)}</h3><div class="legend">${legend}</div>
<svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="${esc(title)}">
${ticks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v >= 100 ? v.toFixed(0) : v.toFixed(1)}${esc(unit)}</text>`).join('')}
${tticks.map((t) => `<text x="${x(t)}" y="${Hh - 8}" text-anchor="middle">${((t) / 60000).toFixed(0)}m</text>`).join('')}
${markEls}${lines}
</svg></section>`;
}

export function writeReport(sessionDir, data) {
  const { meta, analysis, samples, baselines, incidents, trace, screenshots } = data;
  const json = { meta, pass: analysis.pass, failedFindings: analysis.failedCount, findings: analysis.findings, areas: analysis.areas, topErrors: analysis.topErrors, incidents, failures: trace.filter((e) => e.kind === 'action' && e.status === 'fail'), checkpoints: baselines.length, samples: samples.length };
  fs.writeFileSync(path.join(sessionDir, 'report.json'), JSON.stringify(json, null, 2));

  const marks = incidents.map((i) => ({ t: i.t, label: `${i.kind}: ${i.detail ?? ''}` }));
  const S = (get) => samples.map((s) => [s.t, get(s)]);
  const roles = ['main', 'renderer', 'gpu', 'core', 'utility', 'audio'];
  const charts = [
    chart('Memory by process (MB, resident)', roles.map((r) => ({ name: r, points: S((s) => s.proc?.roles?.[r]?.rssMB) })), { unit: '', marks }),
    chart('Memory at checkpoints (same blank state, after GC)', [
      ...roles.slice(0, 4).map((r, i) => ({ name: `${r} MB`, points: baselines.map((b) => [b.t, b.proc?.roles?.[r]?.rssMB]), dots: true, color: COLORS[i] })),
      { name: 'JS heap MB', points: baselines.map((b) => [b.t, b.renderer?.heapMB]), dots: true, color: COLORS[4] },
    ], { marks }),
    chart('Reference scene at checkpoints: core fps and GPU ms', [{ name: 'fps', points: baselines.map((b) => [b.t, b.refFps]), dots: true }, { name: 'GPU ms', points: baselines.map((b) => [b.t, b.refGpuMs]), dots: true }], { marks }),
    chart('Editor JS heap (MB)', [{ name: 'used', points: S((s) => s.renderer?.heapMB) }, { name: 'total', points: S((s) => s.renderer?.heapTotalMB), dashed: true }], { marks }),
    chart('Frame rate', [{ name: 'render core fps', points: S((s) => s.core?.fps) }, { name: 'editor fps', points: S((s) => s.editorFps) }], { marks }),
    chart('Render core frame cost (ms)', [{ name: 'GPU avg', points: S((s) => s.core?.gpuMs) }, { name: 'GPU max', points: S((s) => s.core?.gpuMaxMs), dashed: true }, { name: 'CPU avg', points: S((s) => s.core?.cpuMs) }], { marks }),
    chart('CPU (% of one core)', roles.slice(0, 4).map((r) => ({ name: r, points: S((s) => s.proc?.roles?.[r]?.cpuPct) })), { marks }),
    chart('Console errors per sample interval', [{ name: 'errors', points: S((s) => s.errors?.errors) }, { name: 'warnings', points: S((s) => s.errors?.warnings) }, { name: 'exceptions', points: S((s) => s.errors?.exceptions) }], { marks }),
    chart('Dropped frames and audio gaps per interval', [{ name: 'dropped frames', points: S((s) => s.deltas?.droppedFrames) }, { name: 'audio underflows', points: S((s) => s.deltas?.audioUnderflows) }, { name: 'video underflows', points: S((s) => s.deltas?.videoUnderflows) }], { marks }),
    chart('DOM nodes and event listeners', [{ name: 'nodes', points: S((s) => s.renderer?.nodes) }, { name: 'listeners', points: S((s) => s.renderer?.listeners) }], { marks }),
    chart('Temp and profile folders (MB)', [{ name: 'temp', points: S((s) => s.temp?.tmpMB) }, { name: 'profile', points: S((s) => s.temp?.profileMB) }], { marks }),
    chart('Store updates per second', [...new Set(samples.flatMap((s) => Object.keys(s.publish ?? {})))].map((k) => ({ name: k, points: S((s) => s.publish?.[k]) })), { marks }),
    chart('GPU memory (core, MB)', [{ name: 'gpu_memory_mb', points: S((s) => s.core?.gpuMemMB) }, { name: 'video cache MB', points: S((s) => s.core?.videoCacheMB) }], { marks }),
  ].join('\n');

  const sev = (s) => `<span class="sev ${s}">${s}</span>`;
  const findings = analysis.findings
    .slice().sort((a, b) => ['fail', 'warn', 'info', 'pass'].indexOf(a.severity) - ['fail', 'warn', 'info', 'pass'].indexOf(b.severity))
    .map((f) => `<tr><td>${sev(f.severity)}</td><td>${esc(f.area)}</td><td>${esc(f.title)}</td><td>${esc(f.value)}</td><td>${esc(f.threshold)}</td></tr>`).join('');
  const areas = Object.values(analysis.areas).sort((a, b) => a.area.localeCompare(b.area))
    .map((a) => `<tr><td>${sev(a.status === 'not run' ? 'info' : a.status)}</td><td>${esc(a.area)}</td><td>${a.runs}</td><td>${a.passed}</td><td>${a.failed}</td><td>${a.skipped}</td><td>${a.warnings}</td><td>${(a.ms / Math.max(1, a.runs) / 1000).toFixed(1)} s</td></tr>`).join('');
  const failures = trace.filter((e) => e.kind === 'action' && e.status === 'fail').slice(0, 300)
    .map((e) => `<tr><td>${e.step}</td><td>${fmtDur(e.t)}</td><td>${esc(e.action)}</td><td>${esc(e.note ?? '')}</td><td>${esc(e.error)}</td><td>${e.shot ? `<a href="${esc(e.shot)}">editor</a>` : ''} ${e.outputShot ? `<a href="${esc(e.outputShot)}">output</a>` : ''}</td><td><code>${esc(e.replay)}</code></td></tr>`).join('');
  const inc = incidents.map((i) => `<tr><td>${fmtDur(i.t)}</td><td>${esc(i.kind)}</td><td>${i.run}</td><td>${i.step ?? ''}</td><td>${esc(i.detail ?? '')}</td><td>${i.shot ? `<a href="${esc(i.shot)}">shot</a>` : ''}</td></tr>`).join('');
  const errors = analysis.topErrors.map((g) => `<tr><td>${g.count}</td><td>${esc(g.level)}</td><td>${fmtDur(g.first)}</td><td><code>${esc(g.example)}</code></td><td>${g.steps.join(', ')}</td></tr>`).join('');
  const shots = (screenshots ?? []).slice(-24).map((s) => `<figure><a href="${esc(s.file)}"><img loading="lazy" src="${esc(s.file)}" alt=""></a><figcaption>${fmtDur(s.t)} ${esc(s.label)}</figcaption></figure>`).join('');

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Soak ${esc(meta.result)} · ${esc(meta.startedAt)}</title>
<style>
:root{--bg:#fff;--fg:#1d2330;--muted:#6b7280;--line:#e5e7eb;--card:#f7f8fa}
@media (prefers-color-scheme:dark){:root{--bg:#14171c;--fg:#e8eaee;--muted:#9aa3b2;--line:#2a2f38;--card:#1b1f26}}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 -apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:1000px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:32px 0 8px}h3{font-size:14px;margin:0 0 4px}
.banner{padding:14px 16px;border-radius:8px;font-weight:600;margin:12px 0}.banner.pass{background:#e3f6ea;color:#14532d}.banner.fail{background:#fde8e8;color:#7f1d1d}
@media (prefers-color-scheme:dark){.banner.pass{background:#12351f;color:#bbf7d0}.banner.fail{background:#3b1414;color:#fecaca}}
table{border-collapse:collapse;width:100%;font-size:13px}td,th{border-bottom:1px solid var(--line);padding:5px 6px;text-align:left;vertical-align:top}th{color:var(--muted);font-weight:600}
.sev{display:inline-block;padding:1px 7px;border-radius:9px;font-size:12px;font-weight:600}.sev.fail{background:#d9534f;color:#fff}.sev.warn{background:#e09b2d;color:#fff}.sev.pass{background:#2a9d5b;color:#fff}.sev.info{background:#9aa3b2;color:#fff}
.meta{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:6px 16px;color:var(--muted)}.meta b{color:var(--fg);font-weight:600}
.chart{background:var(--card);border-radius:8px;padding:10px 12px;margin:12px 0}.chart svg{width:100%;height:auto}.chart text{fill:var(--muted);font-size:10px}.chart .grid{stroke:var(--line)}
.legend{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:12px;color:var(--muted)}.legend i{display:inline-block;width:10px;height:3px;margin-right:4px;vertical-align:middle}
code{font-size:12px;word-break:break-all}.muted{color:var(--muted)}
.shots{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px}.shots img{width:100%;border-radius:4px;border:1px solid var(--line)}figure{margin:0}figcaption{font-size:11px;color:var(--muted)}
.scroll{overflow-x:auto}
</style></head><body><main>
<h1>Ghost Arcade soak test</h1>
<div class="banner ${analysis.pass ? 'pass' : 'fail'}">${analysis.pass ? 'PASS' : `FAIL: ${analysis.failedCount} check(s) over their thresholds`}${meta.interrupted ? ` (stopped early: ${esc(meta.interrupted)})` : ''}</div>
<div class="meta">
<div>App <b>${esc(meta.app)}</b></div><div>Version <b>${esc(meta.appVersion)}</b></div><div>Commit <b>${esc(meta.git?.commit)}${meta.git?.dirty ? ' (changed)' : ''}</b> ${esc(meta.git?.branch)}</div>
<div>Machine <b>${esc(meta.machine?.platform)}</b></div><div>CPU <b>${esc(meta.machine?.cpu)}</b></div><div>GPU <b>${esc(meta.machine?.adapter)}</b> ${esc(meta.machine?.backend)}</div>
<div>Seed <b>${meta.seed}</b></div><div>Ran <b>${fmtDur(meta.durationMs)}</b> of ${meta.hours} h</div><div>Steps <b>${meta.steps}</b>, launches <b>${meta.launches}</b></div>
<div>Areas <b>${esc(meta.areas.join(', '))}</b></div><div>Window <b>${meta.hidden ? 'hidden' : 'visible'}</b></div><div>Started <b>${esc(meta.startedAt)}</b></div>
</div>
<p class="muted">Command: <code>${esc(meta.command)}</code></p>
<h2>Checks</h2><div class="scroll"><table><tr><th></th><th>Area</th><th>Check</th><th>Value</th><th>Threshold</th></tr>${findings}</table></div>
<h2>Areas</h2><div class="scroll"><table><tr><th></th><th>Area</th><th>Actions</th><th>Passed</th><th>Failed</th><th>Skipped</th><th>Warnings</th><th>Avg time</th></tr>${areas}</table></div>
<h2>Incidents (crashes, hangs, recoveries, restarts)</h2>${inc ? `<div class="scroll"><table><tr><th>When</th><th>What</th><th>Launch</th><th>Step</th><th>Detail</th><th></th></tr>${inc}</table></div>` : '<p class="muted">None.</p>'}
<h2>Charts</h2><p class="muted">Dashed red lines mark incidents.</p>${charts}
<h2>Failed actions (with replay)</h2>${failures ? `<div class="scroll"><table><tr><th>Step</th><th>When</th><th>Action</th><th>Args</th><th>Error</th><th>Shots</th><th>Replay</th></tr>${failures}</table></div>` : '<p class="muted">None.</p>'}
<h2>Top console errors</h2>${errors ? `<div class="scroll"><table><tr><th>Count</th><th>Level</th><th>First</th><th>Example</th><th>Steps</th></tr>${errors}</table></div>` : '<p class="muted">None.</p>'}
<h2>Screenshots</h2><div class="shots">${shots || '<p class="muted">None.</p>'}</div>
<h2>Files</h2><p class="muted">trace.jsonl (every step), telemetry.jsonl (every sample), console.jsonl, logs/ (app output and debug logs per launch), shots/, renders/, report.json.</p>
</main></body></html>`;
  const file = path.join(sessionDir, 'report.html');
  fs.writeFileSync(file, html);
  return file;
}
