import fs from 'fs';
const m = JSON.parse(fs.readFileSync('public/ISF/manifest.json', 'utf8'));
const active = m.shaders.filter(s => s.enabled !== false);
let missing = 0;
for (const s of active) {
  if (!fs.existsSync('public/ISF/' + s.file)) {
    missing++;
    console.log('MISSING:', s.file);
  }
}
console.log(`Active: ${active.length}, Missing: ${missing}`);
