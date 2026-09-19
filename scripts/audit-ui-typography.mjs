import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Inventory declarations, not computed browser styles. Keep the location of
// every finding so inherited styles and intentional canvas typography can be
// reviewed separately instead of bulk-replacing all small numbers.
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : /\.(svelte|css)$/.test(path) ? [path] : [];
  });
}
const inventory = files('src').map(file => {
  const declarations = [];
  readFileSync(file, 'utf8').split('\n').forEach((text, index) => {
    for (const match of text.matchAll(/\b(font-size|font-family|font-weight|letter-spacing|border-radius)\s*:\s*([^;}]+)/g)) {
      declarations.push({ line: index + 1, property: match[1], value: match[2].trim() });
    }
  });
  return { file, declarations };
});
const histogram = property => Object.fromEntries([...inventory.flatMap(entry => entry.declarations)
  .filter(entry => entry.property === property).reduce((map, entry) => map.set(entry.value, (map.get(entry.value) ?? 0) + 1), new Map())]
  .sort((a, b) => b[1] - a[1]));
const report = {
  scope: 'All src/**/*.svelte and src/**/*.css; source declarations, not computed styles',
  files_scanned: inventory.length,
  font_sizes: histogram('font-size'), font_families: histogram('font-family'), corner_radii: histogram('border-radius'),
  files: inventory,
};
const output = process.argv.find(arg => arg.startsWith('--output='))?.slice(9);
if (output) writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ files_scanned: report.files_scanned,
  font_size_declarations: Object.values(report.font_sizes).reduce((a,b)=>a+b,0),
  top_sizes: Object.entries(report.font_sizes).slice(0,15),
  most_declarations: inventory.map(entry => ({file:entry.file,count:entry.declarations.length})).sort((a,b)=>b.count-a.count).slice(0,15),
}, null, 2));
