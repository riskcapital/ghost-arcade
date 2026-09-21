// Usage: node scripts/audit-context-help.mjs [path-to-ghostarcade-web]
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const catalog = readFileSync(join(root, 'src/lib/help/topics.ts'), 'utf8');
const topics = [...catalog.matchAll(/^  (?:'([a-z-]+)'|([a-z]+)): \{ title:/gm)].map(m => m[1] || m[2]);
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
}
const files = walk(join(root, 'src')).filter(f => f.endsWith('.svelte'));
let scopes = 0;
const errors = [];
for (const file of files) {
  for (const match of readFileSync(file, 'utf8').matchAll(/data-help-page="([^"]+)"/g)) {
    scopes++;
    if (!topics.includes(match[1])) errors.push(`${file}: unknown topic ${match[1]}`);
  }
}
if (process.argv[2]) {
  const website = resolve(process.argv[2]);
  for (const topic of topics) {
    if (!existsSync(join(website, 'src/app/docs', topic, 'page.tsx'))) errors.push(`Missing website route: /docs/${topic}`);
  }
}
console.log(JSON.stringify({ topics: topics.length, panelScopes: scopes, errors }, null, 2));
process.exitCode = errors.length ? 1 : 0;
