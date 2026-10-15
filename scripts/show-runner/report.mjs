// One self-contained HTML page per run: pass/fail per step, the recorded
// output, golden-frame comparisons and performance, plus how to re-run.
import fs from 'node:fs';
import path from 'node:path';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function showSection(r) {
  const steps = r.steps.map((s) => {
    const failed = s.error || s.checks.some((c) => !c.pass);
    const checks = s.checks.map((c) => `<li class="${c.pass ? 'ok' : 'bad'}"><b>${esc(c.name)}</b> ${esc(c.detail)}</li>`).join('');
    return `<tr class="${failed ? 'bad' : 'ok'}"><td>${s.index}</td><td class="t">${esc(s.at)}s</td><td>${esc(s.label)}${s.error ? `<div class="err">${esc(s.error)}</div>` : ''}${checks ? `<ul>${checks}</ul>` : ''}</td><td>${failed ? 'FAIL' : 'pass'}</td></tr>`;
  }).join('');
  const images = r.images.map((im) => `
    <figure>
      <figcaption>${esc(im.name)}${im.meanDiff != null ? ` · ${(im.meanDiff * 100).toFixed(2)}% different` : ''}${im.note ? ` · ${esc(im.note)}` : ''}</figcaption>
      <div class="imgs">
        <div><img src="${esc(im.current)}"><span>this run</span></div>
        ${im.golden ? `<div><img src="${esc(im.golden)}"><span>golden</span></div>` : ''}
        ${im.diff ? `<div><img src="${esc(im.diff)}"><span>difference</span></div>` : ''}
      </div>
    </figure>`).join('');
  const perf = r.perf.length ? `<table class="perf"><tr><th>At step</th><th>Core fps</th><th>Editor fps</th><th>GPU ms</th></tr>${r.perf.map((p) => `<tr><td>${esc(p.step)}</td><td>${p.coreFps}</td><td>${p.editorFps}</td><td>${p.gpuMs ?? '?'}</td></tr>`).join('')}</table>` : '';
  return `
  <section class="show ${r.pass ? 'ok' : 'bad'}" id="${esc(r.id)}">
    <h2><span class="badge">${r.pass ? 'PASS' : 'FAIL'}</span> ${esc(r.name)}</h2>
    ${r.description ? `<p class="desc">${esc(r.description)}</p>` : ''}
    ${r.error ? `<p class="err">${esc(r.error)}</p>` : ''}
    ${r.video ? `<video src="${esc(r.video)}" controls muted loop></video>` : ''}
    <table class="steps"><tr><th>#</th><th>Time</th><th>Step</th><th></th></tr>${steps}</table>
    ${images ? `<div class="images">${images}</div>` : ''}
    ${perf}
  </section>`;
}

export function writeReport(dir, { results, machine, git, command, when }) {
  const passed = results.filter((r) => r.pass).length;
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Show Runner report</title>
<style>
  :root { color-scheme: dark; --bg:#0b0d12; --card:#14171f; --line:#262b36; --ink:#e7ebf3; --dim:#98a1b3; --ok:#46d18a; --bad:#ff6b5e; }
  body { margin:0; background:var(--bg); color:var(--ink); font:14px/1.5 -apple-system, system-ui, sans-serif; }
  main { max-width: 1100px; margin: 0 auto; padding: 24px 16px 60px; }
  h1 { margin: 0 0 6px; font-size: 24px; }
  .meta { color: var(--dim); font-size: 13px; margin-bottom: 18px; }
  .meta code { color: var(--ink); }
  .summary { display:flex; flex-wrap:wrap; gap:8px; margin-bottom: 24px; }
  .summary a { text-decoration:none; padding:6px 10px; border-radius:8px; border:1px solid var(--line); background:var(--card); color:var(--ink); }
  .summary a.ok { border-color: color-mix(in srgb, var(--ok) 50%, transparent); }
  .summary a.bad { border-color: var(--bad); color: var(--bad); }
  .show { background: var(--card); border:1px solid var(--line); border-radius: 12px; padding: 18px; margin-bottom: 18px; }
  .show.bad { border-color: color-mix(in srgb, var(--bad) 60%, transparent); }
  h2 { margin: 0 0 6px; font-size: 18px; }
  .badge { font-size: 11px; padding: 2px 7px; border-radius: 5px; vertical-align: middle; background: var(--ok); color:#06120b; }
  .bad .badge { background: var(--bad); color:#1a0503; }
  .desc { color: var(--dim); margin: 0 0 12px; }
  video { width: 100%; max-height: 420px; background:#000; border-radius: 8px; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 6px 8px; border-top: 1px solid var(--line); vertical-align: top; }
  th { color: var(--dim); font-weight: 600; }
  tr.bad td:last-child { color: var(--bad); font-weight: 700; }
  tr.ok td:last-child { color: var(--ok); }
  td.t { color: var(--dim); white-space: nowrap; }
  ul { margin: 4px 0 0; padding-left: 16px; }
  li.bad { color: var(--bad); } li.ok { color: var(--dim); }
  .err { color: var(--bad); }
  .images { display: grid; gap: 12px; margin-top: 14px; }
  figure { margin: 0; } figcaption { color: var(--dim); font-size: 12px; margin-bottom: 6px; }
  .imgs { display:flex; flex-wrap: wrap; gap: 8px; }
  .imgs div { display:flex; flex-direction:column; gap: 4px; font-size: 11px; color: var(--dim); }
  .imgs img { width: 300px; max-width: 100%; image-rendering: pixelated; border-radius: 6px; border: 1px solid var(--line); }
  .perf { margin-top: 14px; }
</style></head><body><main>
<h1>Show Runner · ${passed}/${results.length} passed</h1>
<div class="meta">${esc(when)} · <code>${esc(git.branch)}@${esc(git.commit)}${git.dirty ? ' (uncommitted changes)' : ''}</code> · ${esc(machine.adapter)} (${esc(machine.backend)}) · ${esc(machine.platform)}<br>Re-run: <code>${esc(command)}</code></div>
<nav class="summary">${results.map((r) => `<a class="${r.pass ? 'ok' : 'bad'}" href="#${esc(r.id)}">${r.pass ? '✓' : '✗'} ${esc(r.name)}</a>`).join('')}</nav>
${results.map(showSection).join('')}
</main></body></html>`;
  const file = path.join(dir, 'index.html');
  fs.writeFileSync(file, html);
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify({ results, machine, git, command, when }, null, 2));
  return file;
}
