#!/usr/bin/env node
/**
 * Render a thumbnail for every shader in public/ISF/manifest.json and write
 * them to public/ISF/thumbs, with an index.json keyed like the app's
 * thumbnail cache (src/lib/isf/thumbnail.ts). The app shows these instead
 * of compiling the whole library the first time the VJ library opens.
 *
 * Renders through the running dev app, so the images match what the app
 * would draw itself. Start the dev app with a debugging port first:
 *
 *   npx electron . --remote-debugging-port=9234
 *   node scripts/build-isf-thumbnails.mjs --cdp 9234
 *
 * Run it again after changing library shaders; stale entries are removed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const cdpPort = Number(args[args.indexOf('--cdp') + 1] || 9234);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'public', 'ISF', 'thumbs');

const pages = await fetch(`http://127.0.0.1:${cdpPort}/json/list`).then((r) => r.json());
const page = pages.find((p) => p.type === 'page' && /^https?:\/\/localhost/.test(p.url) && !p.url.includes('mode='));
if (!page) throw new Error(`No app page on debugging port ${cdpPort}. Start the dev app with --remote-debugging-port=${cdpPort}.`);

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let nextId = 1;
const waits = new Map();
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  const wait = waits.get(message.id);
  if (wait) { waits.delete(message.id); wait(message); }
};
async function evaluate(expression) {
  const id = nextId++;
  const reply = await new Promise((resolve) => {
    waits.set(id, resolve);
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  });
  const result = reply.result;
  if (result?.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result?.result?.value;
}

// The library as the VJ panel loads it: the raw text of each file.
const files = await evaluate(`(async () => {
  const manifest = await fetch('./ISF/manifest.json').then((r) => r.json());
  const entries = manifest.version === 2 ? manifest.shaders : manifest.shaders.map((f) => ({ file: f }));
  return entries.map((entry) => entry.file);
})()`);
console.log(`${files.length} library shaders`);

fs.mkdirSync(outDir, { recursive: true });
const index = {};
const BATCH = 12;
for (let start = 0; start < files.length; start += BATCH) {
  const batch = files.slice(start, start + BATCH);
  const rendered = await evaluate(`(async () => {
    const thumbs = await import('/src/lib/isf/thumbnail.ts');
    const out = [];
    for (const file of ${JSON.stringify(batch)}) {
      try {
        const code = await fetch('./ISF/' + file.split('/').map(encodeURIComponent).join('/')).then((r) => r.text());
        const dataUrl = await thumbs.generateShaderThumbnail(code, 0.5);
        out.push({ file, key: thumbs.shaderThumbnailKey(code), dataUrl });
      } catch (err) {
        out.push({ file, error: String(err) });
      }
    }
    return out;
  })()`);
  for (const item of rendered) {
    if (!item.dataUrl?.startsWith('data:image/jpeg;base64,')) {
      console.warn(`skipped ${item.file}: ${item.error || 'no image'}`);
      continue;
    }
    const name = `${item.key.replace(/^-/, 'n')}.jpg`;
    fs.writeFileSync(path.join(outDir, name), Buffer.from(item.dataUrl.split(',')[1], 'base64'));
    index[item.key] = name;
  }
  process.stdout.write(`\r${Math.min(files.length, start + BATCH)}/${files.length}`);
}
process.stdout.write('\n');

// Drop images no shader uses any more.
const keep = new Set(Object.values(index));
for (const name of fs.readdirSync(outDir)) {
  if (name.endsWith('.jpg') && !keep.has(name)) fs.rmSync(path.join(outDir, name));
}
fs.writeFileSync(path.join(outDir, 'index.json'), `${JSON.stringify(index, null, 0)}\n`);
console.log(`wrote ${Object.keys(index).length} thumbnails to ${path.relative(root, outDir)}`);
ws.close();
