#!/usr/bin/env node
// Checks the AI models the app offers (src/lib/api/ai-models.json) against
// the providers before a release:
//   npm run check:ai-models              (node scripts/check-ai-models.mjs)
//   npm run check:ai-models -- --strict  (legacy models being retired fail too)
//
// With a provider's key in the environment it asks that provider's model
// list. Keys are read from the environment only and never printed:
//   ANTHROPIC_API_KEY                Claude: GET /v1/models (lifecycle, retires_at)
//   GEMINI_API_KEY or GOOGLE_API_KEY Gemini: GET /v1beta/models
//   LUMA_AGENTS_API_KEY              Luma Agents: GET /v1/credits (key check only)
//   LUMA_API_KEY                     Dream Machine: GET /generations?limit=1
// Without a key it reads the provider's public model and deprecation pages
// instead ("docs" mode). That is weaker: it shows what the docs say, not what
// your account can use. Google's API has no lifecycle fields and Luma has no
// model list, so their deprecation pages are always read.
//
// Fails (exit 1) when a model the app offers or defaults to is missing,
// deprecated, scheduled to shut down, or has a recommended replacement.
// Warns about newer models the app does not offer yet. A model marked
// "legacy" in ai-models.json (kept for older keys) only warns while it is
// being retired, unless --strict; once it is gone it fails like any other.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const CATALOG_URL = new URL('../src/lib/api/ai-models.json', import.meta.url);

// Set by runChecks for each run.
let catalog;
let strict = false;
let environment = {};
let fetchImpl = globalThis.fetch;
let failures = [];
let warnings = [];
let notes = [];
const env = (name) => String(environment[name] ?? '').trim();
const fail = (msg) => failures.push(msg);
const warn = (msg) => warnings.push(msg);

let retryDelayMs = 1000;

async function request(url, init = {}, tries = 3) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(20_000) });
      if (res.status >= 500 && attempt < tries) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      if (attempt >= tries) throw err;
      await new Promise((r) => setTimeout(r, retryDelayMs * attempt));
    }
  }
}

async function page(url) {
  const res = await request(url, { headers: { Accept: 'text/markdown, text/plain;q=0.9, */*;q=0.1' } });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.text();
}

const offered = (provider) => catalog[provider].models;
const ids = (provider) => offered(provider).map((m) => m.id);
const day = (iso) => (iso ? String(iso).slice(0, 10) : '');

// ─── Claude ─────────────────────────────────────────────────────────────

async function claudeModels(key) {
  const list = [];
  let after = '';
  let version = '2026-10-21';
  for (let guard = 0; guard < 20; guard++) {
    const url = `https://api.anthropic.com/v1/models?limit=1000${after ? `&after_id=${encodeURIComponent(after)}` : ''}`;
    const res = await request(url, { headers: { 'x-api-key': key, 'anthropic-version': version } });
    if (res.status === 400 && version !== '2023-06-01') { version = '2023-06-01'; guard--; continue; }
    if (!res.ok) throw new Error(`model list answered ${res.status}`);
    const data = await res.json();
    list.push(...(data.data ?? []));
    if (!data.has_more || !data.last_id) break;
    after = data.last_id;
  }
  return { list, version };
}

async function checkClaude() {
  const key = env('ANTHROPIC_API_KEY');
  const mine = offered('claude');
  if (!ids('claude').includes(catalog.claude.default)) fail(`Claude: the default ${catalog.claude.default} is not in the list`);

  if (key) {
    notes.push('Claude: checked against the API (your account)');
    const { list, version } = await claudeModels(key);
    const byId = new Map(list.map((m) => [m.id, m]));
    for (const m of mine) {
      let info = byId.get(m.id);
      if (!info) {
        const res = await request(`https://api.anthropic.com/v1/models/${encodeURIComponent(m.id)}`, { headers: { 'x-api-key': key, 'anthropic-version': version } });
        info = res.ok ? await res.json() : null;
      }
      if (!info) { fail(`Claude: ${m.id} is not available to this account (missing from /v1/models)`); continue; }
      if (info.lifecycle && info.lifecycle !== 'active') fail(`Claude: ${m.id} is ${info.lifecycle}${info.retires_at ? `, retiring ${day(info.retires_at)}` : ''}`);
      else if (info.retires_at) fail(`Claude: ${m.id} is scheduled to retire ${day(info.retires_at)}`);
      else if (info.deprecated_at) fail(`Claude: ${m.id} was deprecated ${day(info.deprecated_at)}`);
      if (!info.lifecycle) warn(`Claude: the API did not report a lifecycle for ${m.id} (anthropic-version ${version})`);
    }
    // Newer models in a line the app offers.
    for (const m of mine) {
      const ours = byId.get(m.id);
      if (!ours?.created_at || !m.line) continue;
      for (const other of list) {
        if (other.line !== m.line || other.id === m.id || (other.lifecycle && other.lifecycle !== 'active')) continue;
        if (Date.parse(other.created_at) > Date.parse(ours.created_at) && !ids('claude').includes(other.id)) {
          warn(`Claude: ${other.id} (${other.display_name}) is newer than ${m.id}`);
        }
      }
    }
    return;
  }

  notes.push('Claude: DOCS MODE (no ANTHROPIC_API_KEY): read the public deprecation and overview pages');
  const deprecations = await page('https://platform.claude.com/docs/en/about-claude/model-deprecations.md');
  const status = new Map();
  for (const line of deprecations.split('\n')) {
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length >= 5 && /^claude-/.test(cells[1])) status.set(cells[1], { state: cells[2], deprecated: cells[3], retires: cells[4] });
  }
  if (!status.size) throw new Error('could not read the model status table on the Claude deprecations page');
  for (const m of mine) {
    const row = status.get(m.id);
    if (!row) fail(`Claude: ${m.id} is not in the model status table (docs)`);
    else if (!/^active$/i.test(row.state)) fail(`Claude: ${m.id} is ${row.state} (deprecated ${row.deprecated}, retires ${row.retires}) (docs)`);
  }
  const overview = await page('https://platform.claude.com/docs/en/models/overview.md');
  const idRow = overview.split('\n').find((l) => /^\|\s*Claude API ID\s*\|/.test(l));
  if (!idRow) throw new Error('could not find the Claude API ID row on the models overview page');
  for (const id of idRow.match(/claude-[a-z0-9-]+/g) ?? []) {
    if (!ids('claude').includes(id)) warn(`Claude: ${id} is a latest model the app does not offer (docs)`);
  }
}

// ─── Gemini (text and Omni video) ───────────────────────────────────────

/** Rows of every {% table %} on Google's deprecations page, with the heading above each table. */
function geminiDeprecationRows(md) {
  const rows = [];
  let heading = '';
  const lines = md.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const h = /^#{2,3}\s+(.*?)(\s*\{%.*)?$/.exec(lines[i]);
    if (h) { heading = h[1]; continue; }
    if (!/\{%\s*table\s*%\}/.test(lines[i])) continue;
    const block = [];
    for (i++; i < lines.length && !/\{%\s*\/table\s*%\}/.test(lines[i]); i++) block.push(lines[i]);
    const [, ...bodies] = block.join('\n').split(/\n\s*---\s*\n/);
    for (const body of bodies) {
      const cells = body.split(/\n\s*\*(?:\s|$)/).map((c) => c.replace(/^\s*\*\s?/, '').replace(/\s+/g, ' ').trim());
      const id = /`([^`]+)`/.exec(cells[0] ?? '')?.[1];
      if (id) rows.push({ id, heading, release: cells[1] ?? '', shutdown: cells[2] ?? '', replacement: cells[3] ?? '' });
    }
  }
  return rows;
}

const TEXT_MODEL = /^gemini-\d+(?:\.\d+)?-(?:flash|flash-lite|pro|pro-preview|flash-preview|[a-z]+)$/;
const NOT_TEXT = /tts|live|image|embedding|transcribe|translate|robotics|computer-use|audio|decision|banana|omni|exp/;

async function checkGemini() {
  const key = env('GEMINI_API_KEY') || env('GOOGLE_API_KEY');
  const text = offered('gemini');
  const video = offered('omni');
  if (!ids('gemini').includes(catalog.gemini.default)) fail(`Gemini: the default ${catalog.gemini.default} is not in the list`);
  if (!ids('omni').includes(catalog.omni.default)) fail(`Gemini Omni: the default ${catalog.omni.default} is not in the list`);

  const rows = geminiDeprecationRows(await page('https://aistudio.google.com/docs/deprecations.md'));
  if (rows.length < 5) throw new Error('could not read the tables on the Gemini deprecations page');
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const m of [...text, ...video]) {
    const row = byId.get(m.id);
    if (!row) { warn(`Gemini: ${m.id} is not on the deprecations page, so its lifecycle is unknown (docs)`); continue; }
    if (/deprecated/i.test(row.heading)) fail(`Gemini: ${m.id} is shut down (${row.shutdown}); replacement ${row.replacement || 'none listed'} (docs)`);
    else if (row.shutdown && !/no shutdown date|^n\/a$/i.test(row.shutdown)) fail(`Gemini: ${m.id} shuts down ${row.shutdown}; replacement ${row.replacement || 'none listed'} (docs)`);
    else if (row.replacement) fail(`Gemini: Google recommends ${row.replacement} instead of ${m.id} (docs)`);
  }

  let available = null;
  if (key) {
    notes.push('Gemini: checked against the API (your key) and the deprecations page');
    available = new Map();
    let token = '';
    for (let guard = 0; guard < 20; guard++) {
      const res = await request(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`, { headers: { 'x-goog-api-key': key } });
      if (!res.ok) throw new Error(`model list answered ${res.status}`);
      const data = await res.json();
      for (const m of data.models ?? []) available.set(String(m.name).replace(/^models\//, ''), m);
      if (!data.nextPageToken) break;
      token = data.nextPageToken;
    }
    for (const m of text) {
      const info = available.get(m.id);
      if (!info) fail(`Gemini: ${m.id} is not in this key's model list`);
      else if (!info.supportedGenerationMethods?.includes('generateContent')) fail(`Gemini: ${m.id} does not support generateContent`);
    }
    for (const m of video) if (!available.has(m.id)) fail(`Gemini Omni: ${m.id} is not in this key's model list`);
  } else {
    notes.push('Gemini: DOCS MODE (no GEMINI_API_KEY): read the public models and deprecations pages');
    const models = await page('https://aistudio.google.com/docs/models.md');
    for (const m of [...text, ...video]) if (!models.includes(m.id)) fail(`Gemini: ${m.id} is not on the models page (docs)`);
  }

  // Newer models the app does not offer: current rows with no shutdown and no replacement.
  const candidates = new Set(rows
    .filter((r) => !/deprecated/i.test(r.heading) && /no shutdown date/i.test(r.shutdown) && !r.replacement)
    .map((r) => r.id));
  if (available) for (const [id, m] of available) if (m.supportedGenerationMethods?.includes('generateContent')) candidates.add(id);
  // A text model counts as newer when its version is above the newest one the
  // app offers with the same suffix (3.9 Flash after 3.8 Flash), or, for a new
  // suffix, at least the newest version the app offers at all (a fifth Gemini 4).
  const version = (id) => Number(/^gemini-(\d+(?:\.\d+)?)-/.exec(id)?.[1] ?? 0);
  const suffix = (id) => id.replace(/^gemini-\d+(?:\.\d+)?-/, '');
  const newest = Math.max(...ids('gemini').map(version));
  const isNewer = (id) => {
    const same = ids('gemini').filter((o) => suffix(o) === suffix(id)).map(version);
    return same.length ? version(id) > Math.max(...same) : version(id) >= newest;
  };
  for (const id of candidates) {
    const isText = TEXT_MODEL.test(id) && !NOT_TEXT.test(id) && isNewer(id);
    const isVideo = /^gemini-omni-[\d.]+-[a-z]+$/.test(id);
    if (isText && !ids('gemini').includes(id)) warn(`Gemini: ${id} is a current text model the app does not offer`);
    if (isVideo && !ids('omni').includes(id)) warn(`Gemini Omni: ${id} is a current video model the app does not offer`);
  }
}

// ─── Luma ───────────────────────────────────────────────────────────────

async function checkLuma() {
  const agents = offered('luma').filter((m) => m.service !== 'dream-machine');
  const legacy = offered('luma').filter((m) => m.service === 'dream-machine');
  if (!ids('luma').includes(catalog.luma.default)) fail(`Luma: the default ${catalog.luma.default} is not in the list`);
  notes.push('Luma: no model list API; read the public Luma Agents and Dream Machine pages');

  const modelsPage = await page('https://docs.agents.lumalabs.ai/guides/model/index.md');
  const listed = new Set([...modelsPage.matchAll(/`(ray-\d+(?:\.\d+)?)`/g)].map((m) => m[1]));
  for (const m of agents) if (!listed.has(m.id)) fail(`Luma: ${m.id} is not on the Luma Agents models page (docs)`);
  for (const id of listed) if (!ids('luma').includes(id)) warn(`Luma: ${id} is on the Luma Agents models page and the app does not offer it`);

  const migration = await page('https://docs.agents.lumalabs.ai/guides/videos/migration/index.md');
  const retiring = new Set();
  const start = migration.search(/retiring models/i);
  if (start >= 0) {
    for (const line of migration.slice(start).split('\n').slice(1)) {
      const item = /^\s*-\s+(.+?)\s*$/.exec(line);
      if (item) retiring.add(item[1].toLowerCase());
      else if (retiring.size && line.trim()) break;
    }
  }
  if (!retiring.size) warn('Luma: could not read the list of retiring models on the migration page');
  for (const m of [...agents, ...legacy]) {
    const name = (m.docsName ?? m.label).toLowerCase();
    if (!retiring.has(name)) continue;
    const msg = `Luma: ${m.id} (${m.docsName ?? m.label}) is being retired; Luma says to move to ray-3.2 (docs)`;
    if (m.legacy && !strict) warn(`${msg}. Kept as a legacy choice for older keys.`);
    else fail(msg);
  }

  if (legacy.length) {
    const dreamMachine = await page('https://docs.lumalabs.ai/docs/video-generation.md');
    for (const m of legacy) if (!dreamMachine.includes(m.id)) fail(`Luma: ${m.id} is no longer on the Dream Machine API page (docs)`);
  }

  const agentsKey = env('LUMA_AGENTS_API_KEY');
  if (agentsKey) {
    const res = await request('https://agents.lumalabs.ai/v1/credits', { headers: { Authorization: `Bearer ${agentsKey}` } });
    if (!res.ok) fail(`Luma Agents: the key check (GET /v1/credits) answered ${res.status}`);
    else notes.push('Luma Agents: key accepted (GET /v1/credits)');
  }
  const dmKey = env('LUMA_API_KEY');
  if (dmKey && legacy.length) {
    const res = await request('https://api.lumalabs.ai/dream-machine/v1/generations?limit=1', { headers: { Authorization: `Bearer ${dmKey}` } });
    if (res.status === 404 || res.status === 410) fail(`Luma Dream Machine: the API answered ${res.status}; it may be shut down`);
    else if (!res.ok) warn(`Luma Dream Machine: the key check answered ${res.status}`);
    else notes.push('Luma Dream Machine: key accepted');
  }
}

// ─── Run ────────────────────────────────────────────────────────────────

/**
 * Run every check. Returns { failures, warnings, notes } and never throws.
 * `options.env` holds the keys (default process.env); `options.fetch` and
 * `options.retryDelayMs` let tests stand in for the network.
 */
export async function runChecks(options = {}) {
  catalog = options.catalog ?? JSON.parse(readFileSync(CATALOG_URL, 'utf8'));
  strict = !!options.strict;
  environment = options.env ?? process.env;
  fetchImpl = options.fetch ?? globalThis.fetch;
  retryDelayMs = options.retryDelayMs ?? 1000;
  failures = [];
  warnings = [];
  notes = [];
  for (const [name, check] of [['Claude', checkClaude], ['Gemini', checkGemini], ['Luma', checkLuma]]) {
    try {
      await check();
    } catch (err) {
      fail(`${name}: could not check (${err instanceof Error ? err.message : err})`);
    }
  }
  return { failures, warnings, notes };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const catalogArg = process.argv.find((a) => a.startsWith('--catalog='))?.slice('--catalog='.length);
  const result = await runChecks({
    strict: process.argv.includes('--strict'),
    catalog: catalogArg ? JSON.parse(readFileSync(catalogArg, 'utf8')) : undefined,
  });
  for (const n of result.notes) console.log(`  ${n}`);
  for (const w of result.warnings) console.log(`WARN ${w}`);
  for (const f of result.failures) console.log(`FAIL ${f}`);
  console.log(result.failures.length
    ? `\n${result.failures.length} problem(s) with the AI model list. Update src/lib/api/ai-models.json (and the migration map) before releasing.`
    : `\nAI model list OK${result.warnings.length ? ` (${result.warnings.length} warning(s))` : ''}.`);
  process.exit(result.failures.length ? 1 : 0);
}
