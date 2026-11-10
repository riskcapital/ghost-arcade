// Collects the interface's English text into src/lib/i18n/source.json, the
// list every language pack translates. Run after changing interface text:
//   npm run i18n:extract        (node scripts/i18n-extract.mjs)
// Then translate the new entries into each pack in src/lib/i18n/locales/
// (`node scripts/i18n-extract.mjs --missing` lists them per pack).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = 'src';
const SKIP_DIRS = new Set(['mobile', 'i18n', 'node_modules']);
const ATTRS = /\b(title|placeholder|aria-label|data-help|alt)="([^"]*)"/g;
const PROP_KEYS = 'label|title|name|description|hint|text|message|tooltip|placeholder|help|subtitle|heading|caption|summary|detail|body';
let found = new Map(); // text -> first file

function files(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) files(path.join(dir, entry.name), out); }
    else if (/\.(svelte|ts)$/.test(entry.name) && !/\.(test|d)\.ts$/.test(entry.name)) out.push(path.join(dir, entry.name));
  }
  return out;
}
const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&times;': '×', '&nbsp;': ' ', '&quot;': '"', '&#39;': "'", '&mdash;': '—', '&ndash;': '–', '&hellip;': '…', '&middot;': '·', '&rarr;': '→', '&larr;': '←' };
const decode = (s) => s.replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e] ?? e);

function add(raw, file) {
  let text = decode(raw).replace(/\s+/g, ' ').trim();
  // Runtime turns numbers into placeholders too, so store the same shape.
  if (!text.includes('{0}')) {
    let n = 0;
    const numbered = text.replace(/\d+(?:[.,:]\d+)*/g, () => `{${n++}}`);
    if (n) text = numbered;
  }
  const words = text.replace(/\{\d+\}/g, '');
  if (words.replace(/[^A-Za-z]/g, '').length < 2) return;
  if (text.length > 400) return;
  if (/^[a-z0-9_.:/#-]+$/.test(words.trim()) && !/^[a-z]+$/.test(words.trim())) return; // ids, paths, css
  if (/[{};]\s*$|=>|\bfunction\b|\bconst\b|^\s*\/\//.test(words)) return;
  if (!found.has(text)) found.set(text, file);
}

/** Replace {expr} with {0},{1}… and return the string literals inside them. */
function placeholders(text, literals) {
  let out = ''; let index = 0; let i = 0;
  while (i < text.length) {
    if (text[i] !== '{') { out += text[i++]; continue; }
    let depth = 1; let j = i + 1;
    while (j < text.length && depth > 0) {
      const c = text[j];
      if (c === "'" || c === '"' || c === '`') { const q = c; j++; while (j < text.length && text[j] !== q && (q === '`' || text[j] !== '\n')) { if (text[j] === '\\') j++; j++; } }
      else if (c === '{') depth++; else if (c === '}') depth--;
      j++;
    }
    const expr = text.slice(i + 1, j - 1);
    literals.push(expr);
    if (/^[#:/@]/.test(expr.trim())) out += '\u0000'; // block tag: a break in the text
    else out += `{${index++}}`;
    i = j;
  }
  return out;
}

function scanTemplate(template, file) {
  const literals = [];
  let i = 0; let text = '';
  const flush = () => {
    for (const piece of placeholders(text, literals).split('\u0000')) {
      // Renumber per piece so each starts at {0}.
      let n = 0; add(piece.replace(/\{\d+\}/g, () => `{${n++}}`), file);
    }
    text = '';
  };
  while (i < template.length) {
    const c = template[i];
    if (c === '{') { // keep whole expression in text, including any < inside it
      let depth = 1; let j = i + 1;
      while (j < template.length && depth > 0) {
        const d = template[j];
        if (d === "'" || d === '"' || d === '`') { const q = d; j++; while (j < template.length && template[j] !== q && (q === '`' || template[j] !== '\n')) { if (template[j] === '\\') j++; j++; } }
        else if (d === '{') depth++; else if (d === '}') depth--;
        j++;
      }
      text += template.slice(i, j); i = j; continue;
    }
    if (c === '<' && /[A-Za-z/!]/.test(template[i + 1] ?? '')) {
      flush();
      let j = i + 1; let depth = 0;
      while (j < template.length) {
        const d = template[j];
        if (depth <= 0 && (d === '"' || d === "'")) { const q = d; j++; while (j < template.length && template[j] !== q) j++; }
        else if (depth > 0 && (d === '"' || d === "'" || d === '`')) { const q = d; j++; while (j < template.length && template[j] !== q && (q === '`' || template[j] !== '\n')) { if (template[j] === '\\') j++; j++; } }
        else if (d === '{') depth++; else if (d === '}') depth--;
        else if (d === '>' && depth <= 0) break;
        j++;
      }
      const tag = template.slice(i, j + 1);
      for (const m of tag.matchAll(ATTRS)) {
        const value = placeholders(m[2], literals);
        if (value.replace(/\{\d+\}/g, '').trim()) add(value.replace(/\u0000/g, ' '), file);
      }
      for (const m of tag.matchAll(/=\{([^]*?)\}(?=[\s/>])/g)) literals.push(m[1]);
      i = j + 1; continue;
    }
    text += c; i++;
  }
  flush();
  for (const expr of literals) scanStrings(expr, file, true);
}

// ── String literals ─────────────────────────────────────────────────────
// Read with a small scanner, not a regex: a template literal can hold
// `${...}` with strings (and other template literals) of its own inside.

/** Index just past the string literal that starts at `i` (a quote). */
function skipString(code, i) {
  const q = code[i];
  let j = i + 1;
  while (j < code.length) {
    const c = code[j];
    if (c === '\\') { j += 2; continue; }
    if (c === q) return j + 1;
    if (q !== '`' && c === '\n') return j;
    if (q === '`' && c === '$' && code[j + 1] === '{') { j = skipExpr(code, j + 2); continue; }
    j++;
  }
  return j;
}

/** Index just past the `}` closing an expression that starts at `i`. */
function skipExpr(code, i) {
  let depth = 1;
  while (i < code.length) {
    const c = code[i];
    if (c === "'" || c === '"' || c === '`') { i = skipString(code, i); continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i + 1;
    i++;
  }
  return i;
}

/**
 * A template literal's body as interface text: each `${...}` becomes {0},
 * {1}… (what the runtime matches against). Escaped quotes and `$` are kept
 * as the character; any other escape stays visible, so the text is dropped
 * as not interface text.
 */
export function templateText(body) {
  let out = '';
  let n = 0;
  let i = 0;
  while (i < body.length) {
    const c = body[i];
    if (c === '\\') {
      const next = body[i + 1] ?? '';
      out += /['"`$\\{}]/.test(next) && next !== '\\' ? next : c + next;
      i += 2;
      continue;
    }
    if (c === '$' && body[i + 1] === '{') {
      i = skipExpr(body, i + 2);
      out += `{${n++}}`;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Every string literal in `code` at the top level (not inside another
 *  literal's `${...}`): [start, end, quote, body]. */
function literals(code) {
  const out = [];
  let i = 0;
  while (i < code.length) {
    const c = code[i];
    if (c === '/' && code[i + 1] === '/') { const e = code.indexOf('\n', i); i = e < 0 ? code.length : e; continue; }
    if (c === '/' && code[i + 1] === '*') { const e = code.indexOf('*/', i + 2); i = e < 0 ? code.length : e + 2; continue; }
    if (c === "'" || c === '"' || c === '`') {
      const end = skipString(code, i);
      out.push([i, end, c, code.slice(i + 1, Math.max(i + 1, end - 1))]);
      i = end;
      continue;
    }
    i++;
  }
  return out;
}

/** A literal's text: plain quotes unescaped, template placeholders numbered. */
function literalText(quote, body) {
  return quote === '`' ? templateText(body) : body.replace(/\\(['"`])/g, '$1');
}

function take(value, file) {
  if (!/[A-Za-z]{2}/.test(value.replace(/\{\d+\}/g, ''))) return;
  const sentence = /\s/.test(value.trim());
  const capital = /^[A-Z][a-z]/.test(value) || /^\{\d+\}\s+[A-Za-z]/.test(value);
  if (!sentence && !capital) return;
  if (/^[A-Z][a-zA-Z]+$/.test(value) && /[a-z][A-Z]/.test(value)) return; // CamelCase identifier
  if (/[\\<>$]|\.(svelte|ts|js|css|png|json)\b|^https?:|^[./]/.test(value)) return;
  if (/^[Mm][\d{}\s.,\-MmZzLlHhVvCcSsQqTtAa]*$/.test(value)) return; // SVG path data
  add(value, file);
}

// Interface text kept in a table (labels by mode or state) or in a variable
// that is plainly text: `const END_ACTION_LABELS: Record<…, string> = {…}`,
// `const LOCK_TEXT = {…}`, `const audioTitle = $derived(…)`.
const TABLE_NAME = /(?:LABELS?|TEXTS?|TITLES?|NAMES?|HINTS?|MESSAGES?|TOOLTIPS?|CAPTIONS?)$/;
const TEXT_VAR = /(?:Text|Title|Label|Labels|Hint|Message|Tooltip|Caption|Name)$/;

/** The initializer of each declaration whose name says it holds text. */
function textDeclarations(code) {
  const out = [];
  const decl = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(:\s*[^=;]+?)?\s*=\s*/g;
  for (const m of code.matchAll(decl)) {
    const name = m[1];
    const type = m[2] ?? '';
    void type;
    if (!TABLE_NAME.test(name) && !TEXT_VAR.test(name)) continue;
    // The initializer: up to a `;` or a line break at depth 0.
    let i = m.index + m[0].length;
    let depth = 0;
    const from = i;
    while (i < code.length) {
      const c = code[i];
      if (c === "'" || c === '"' || c === '`') { i = skipString(code, i); continue; }
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') { if (depth === 0) break; depth--; }
      else if (depth === 0 && (c === ';' || c === '\n' || c === ',')) break;
      i++;
    }
    out.push(code.slice(from, i));
  }
  return out;
}

/** UI-looking string literals. `loose` = inside a template expression. */
function scanStrings(code, file, loose) {
  if (loose) {
    for (const [, , q, body] of literals(code)) take(literalText(q, body), file);
    return;
  }
  const all = literals(code);
  const at = new Map(all.map((l) => [l[0], l]));
  const literalAfter = (re) => {
    for (const m of code.matchAll(re)) {
      const l = at.get(m.index + m[0].length);
      if (l) take(literalText(l[2], l[3]), file);
    }
  };
  literalAfter(new RegExp(`\\b(?:${PROP_KEYS})\\s*:\\s*`, 'g'));
  literalAfter(/\b(?:showToast|toast|alert|confirm|notify|setStatus|showError|showMessage)\(\s*/g);
  for (const init of textDeclarations(code)) {
    for (const [, , q, body] of literals(init)) take(literalText(q, body), file);
  }
}

/** The interface text in one source file. */
export function extractFrom(source, file = 'x.svelte') {
  const before = found;
  found = new Map();
  try {
    scanFile(source, file);
    return [...found.keys()];
  } finally {
    found = before;
  }
}

function scanFile(source, file) {
  if (file.endsWith('.ts')) { scanStrings(source, file, false); return; }
  let template = source.replace(/<!--[^]*?-->/g, '');
  for (const m of template.matchAll(/<script[^>]*>([^]*?)<\/script>/g)) scanStrings(m[1], file, false);
  template = template.replace(/<script[^>]*>[^]*?<\/script>/g, '').replace(/<style[^>]*>[^]*?<\/style>/g, '');
  scanTemplate(template, file);
}

export const SOURCE_FILE = 'src/lib/i18n/source.json';

/** Every interface string under src/, sorted the same way on any machine. */
export function extractAll() {
  found = new Map();
  for (const file of files(ROOT)) scanFile(fs.readFileSync(file, 'utf8'), file);
  return [...found.keys()].sort((a, b) => a.localeCompare(b, 'en'));
}

function main() {
  const list = extractAll();
  if (process.argv.includes('--missing')) {
    const dir = 'src/lib/i18n/locales';
    for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const pack = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      const missing = list.filter((s) => !(s in pack));
      console.log(`${name}: ${missing.length} missing`);
      for (const s of missing) console.log(`  ${JSON.stringify(s)}`);
    }
    return;
  }
  // A list with one-space indent: the format the packs' tools expect.
  fs.writeFileSync(SOURCE_FILE, JSON.stringify(list, null, 1) + '\n');
  console.log(`${list.length} strings, ${list.join(' ').split(/\s+/).length} words`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
