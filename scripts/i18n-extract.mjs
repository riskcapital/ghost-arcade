// Collects the interface's English text into src/lib/i18n/source.json, the
// list every language pack translates. Run after changing interface text:
//   node scripts/i18n-extract.mjs
import fs from 'fs';
import path from 'path';

const ROOT = 'src';
const SKIP_DIRS = new Set(['mobile', 'i18n', 'node_modules']);
const ATTRS = /\b(title|placeholder|aria-label|data-help|alt)="([^"]*)"/g;
const PROP_KEYS = 'label|title|name|description|hint|text|message|tooltip|placeholder|help|subtitle|heading|caption|summary|detail|body';
const found = new Map(); // text -> first file

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

/** UI-looking string literals. `loose` = inside a template expression. */
function scanStrings(code, file, loose) {
  const take = (value) => {
    if (!/[A-Za-z]{2}/.test(value)) return;
    const sentence = /\s/.test(value.trim());
    const capital = /^[A-Z][a-z]/.test(value);
    if (!sentence && !capital) return;
    if (/^[A-Z][a-zA-Z]+$/.test(value) && /[a-z][A-Z]/.test(value)) return; // CamelCase identifier
    if (/[\\<>$]|\.(svelte|ts|js|css|png|json)\b|^https?:|^[./]/.test(value)) return;
    add(value.replace(/\$\{[^}]*\}/g, '\u0001').split('\u0001').reduce((acc, part, idx) => idx ? `${acc}{${idx - 1}}${part}` : part, ''), file);
  };
  if (loose) {
    for (const m of code.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) take((m[1] ?? m[2] ?? m[3]).replace(/\\(['"`])/g, '$1'));
    return;
  }
  const keyed = new RegExp(`\\b(?:${PROP_KEYS})\\s*:\\s*(?:'((?:[^'\\\\\\n]|\\\\.)*)'|"((?:[^"\\\\\\n]|\\\\.)*)"|\`((?:[^\`\\\\]|\\\\.)*)\`)`, 'g');
  for (const m of code.matchAll(keyed)) take((m[1] ?? m[2] ?? m[3]).replace(/\\(['"`])/g, '$1'));
  const called = /\b(?:showToast|toast|alert|confirm|notify|setStatus|showError|showMessage)\(\s*(?:'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`)/g;
  for (const m of code.matchAll(called)) take((m[1] ?? m[2] ?? m[3]).replace(/\\(['"`])/g, '$1'));
}

for (const file of files(ROOT)) {
  const source = fs.readFileSync(file, 'utf8');
  if (file.endsWith('.ts')) { scanStrings(source, file, false); continue; }
  let template = source.replace(/<!--[^]*?-->/g, '');
  for (const m of template.matchAll(/<script[^>]*>([^]*?)<\/script>/g)) scanStrings(m[1], file, false);
  template = template.replace(/<script[^>]*>[^]*?<\/script>/g, '').replace(/<style[^>]*>[^]*?<\/style>/g, '');
  scanTemplate(template, file);
}

const list = [...found.keys()].sort((a, b) => a.localeCompare(b));
fs.writeFileSync('src/lib/i18n/source.json', JSON.stringify(list, null, 1) + '\n');
console.log(`${list.length} strings, ${list.join(' ').split(/\s+/).length} words`);
