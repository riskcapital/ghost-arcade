import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';

const root = process.cwd();
const TYPES_PATH = join(root, 'src', 'lib', 'types.ts');
const NATIVE_EFFECT_PASS_PATH = join(root, 'src', 'lib', 'renderer', 'nativeEffectPass.ts');
const DEFAULT_SCAN_TARGETS = [
  join(root, 'public'),
  join(root, 'user-shaders'),
];
const SKIP_DIR_NAMES = new Set([
  '.git',
  '.svelte-kit',
  'build',
  'dist',
  'dist-electron',
  'dist-native-mobile',
  'node_modules',
  'target',
]);
const JSON_EXTENSIONS = new Set([
  '.gha',
  '.ghost',
  '.ghost-projection',
  '.json',
]);
const SOURCE_EXTENSIONS = new Set([
  '.svelte',
  '.ts',
]);
const SOURCE_SKIP_BASENAMES = new Set([
  'effectCatalog.ts',
  'effects.ts',
  'nativeEffectPass.ts',
  'types.ts',
]);

function usage() {
  console.log(`Usage: node scripts/native-effect-usage-rank.mjs [options] [file-or-dir ...]

Options:
  --include-source   Also regex-scan .ts/.svelte source fixtures.
  --json             Print machine-readable JSON.
  --help             Show this help.

Without paths, scans public/ and user-shaders/. Point it at exported
.ghost/.gha/.json project folders for real usage-ranked native effect waves.`);
}

function readText(path) {
  return readFileSync(path, 'utf8');
}

function parseEffectTypeIds() {
  const source = readText(TYPES_PATH);
  const match = source.match(/export\s+type\s+EffectType\s*=([\s\S]*?);/);
  if (!match) throw new Error(`Could not locate EffectType union in ${TYPES_PATH}`);
  const ids = new Set();
  const re = /'([^']+)'/g;
  let item;
  while ((item = re.exec(match[1]))) ids.add(item[1]);
  return ids;
}

function parseNativeManifestIds() {
  const source = readText(NATIVE_EFFECT_PASS_PATH);
  const ids = new Set();
  const re = /\{\s*id:\s*'([^']+)'/g;
  let item;
  while ((item = re.exec(source))) ids.add(item[1]);
  if (!ids.size) throw new Error(`Could not parse native effect manifest in ${NATIVE_EFFECT_PASS_PATH}`);
  return ids;
}

function nativeIdForEffectId(id) {
  return String(id)
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/_/g, '-')
    .toLowerCase();
}

function isProbablyJsonProjectFile(path) {
  const name = path.toLowerCase();
  if (name.endsWith('.ghost-projection.json')) return true;
  const ext = extname(name);
  return JSON_EXTENSIONS.has(ext);
}

function isSourceFile(path) {
  return SOURCE_EXTENSIONS.has(extname(path).toLowerCase());
}

function shouldSkipSource(path) {
  return SOURCE_SKIP_BASENAMES.has(path.split('/').pop() || '');
}

function listFiles(targets, includeSource) {
  const files = [];
  const visit = (path) => {
    if (!existsSync(path)) return;
    const stat = statSync(path);
    if (stat.isDirectory()) {
      const name = path.split('/').pop() || '';
      if (SKIP_DIR_NAMES.has(name)) return;
      for (const entry of readdirSync(path)) visit(join(path, entry));
      return;
    }
    if (!stat.isFile()) return;
    if (isProbablyJsonProjectFile(path)) {
      files.push(path);
    } else if (includeSource && isSourceFile(path) && !shouldSkipSource(path)) {
      files.push(path);
    }
  };
  for (const target of targets) visit(resolve(target));
  return files;
}

function increment(map, id, file) {
  const current = map.get(id) ?? { id, count: 0, files: new Map() };
  current.count += 1;
  current.files.set(file, (current.files.get(file) ?? 0) + 1);
  map.set(id, current);
}

function scanEffectArray(value, file, appEffectIds, counts) {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const type = item.type;
    if (typeof type === 'string' && appEffectIds.has(type)) {
      increment(counts, type, file);
    }
  }
}

function scanJsonNode(node, file, appEffectIds, counts, parentKey = '') {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    if (parentKey === 'effects' || parentKey === 'compositionEffects') {
      scanEffectArray(node, file, appEffectIds, counts);
    }
    for (const child of node) scanJsonNode(child, file, appEffectIds, counts, parentKey);
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === 'effects' || key === 'compositionEffects') {
      scanEffectArray(value, file, appEffectIds, counts);
    }
    scanJsonNode(value, file, appEffectIds, counts, key);
  }
}

function scanJsonFile(path, appEffectIds, counts) {
  let parsed;
  try {
    parsed = JSON.parse(readText(path));
  } catch {
    return false;
  }
  scanJsonNode(parsed, path, appEffectIds, counts);
  return true;
}

function scanSourceFile(path, appEffectIds, counts) {
  const source = readText(path);
  const arrayRe = /(?:effects|compositionEffects)\s*:\s*\[([\s\S]*?)\]/g;
  let arrayMatch;
  while ((arrayMatch = arrayRe.exec(source))) {
    const typeRe = /type\s*:\s*['"]([^'"]+)['"]/g;
    let typeMatch;
    while ((typeMatch = typeRe.exec(arrayMatch[1]))) {
      if (appEffectIds.has(typeMatch[1])) increment(counts, typeMatch[1], path);
    }
  }
  const effectTypeRe = /effectType\s*:\s*['"]([^'"]+)['"]/g;
  let effectTypeMatch;
  while ((effectTypeMatch = effectTypeRe.exec(source))) {
    if (appEffectIds.has(effectTypeMatch[1])) increment(counts, effectTypeMatch[1], path);
  }
  return true;
}

function summarize(counts, nativeIds) {
  const rows = [...counts.values()]
    .map((entry) => {
      const nativeId = nativeIdForEffectId(entry.id);
      return {
        id: entry.id,
        nativeId,
        native: nativeIds.has(nativeId),
        count: entry.count,
        files: [...entry.files.entries()]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .map(([path, count]) => ({ path: relative(root, path) || path, count })),
      };
    })
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
  const totalCount = rows.reduce((sum, row) => sum + row.count, 0);
  const nativeCount = rows.filter((row) => row.native).reduce((sum, row) => sum + row.count, 0);
  return {
    totalCount,
    nativeCount,
    missingCount: totalCount - nativeCount,
    usedEffectCount: rows.length,
    nativeUsedEffectCount: rows.filter((row) => row.native).length,
    rows,
    missingRows: rows.filter((row) => !row.native),
    nativeRows: rows.filter((row) => row.native),
  };
}

function printTable(title, rows, limit = 20) {
  console.log(`\n${title}`);
  if (!rows.length) {
    console.log('  none');
    return;
  }
  for (const row of rows.slice(0, limit)) {
    const topFiles = row.files.slice(0, 3).map((file) => `${file.path}${file.count > 1 ? ` x${file.count}` : ''}`).join(', ');
    console.log(`  ${String(row.count).padStart(4)}  ${row.id.padEnd(24)} -> ${row.nativeId.padEnd(24)} ${topFiles}`);
  }
}

function main() {
  const args = process.argv.slice(2);
  const includeSource = args.includes('--include-source');
  const jsonOutput = args.includes('--json');
  if (args.includes('--help')) {
    usage();
    return;
  }
  const targets = args.filter((arg) => !arg.startsWith('--'));
  const resolvedTargets = targets.length ? targets : DEFAULT_SCAN_TARGETS;
  const appEffectIds = parseEffectTypeIds();
  const nativeIds = parseNativeManifestIds();
  const counts = new Map();
  const files = listFiles(resolvedTargets, includeSource);
  let parsedFiles = 0;

  for (const file of files) {
    if (isProbablyJsonProjectFile(file)) {
      if (scanJsonFile(file, appEffectIds, counts)) parsedFiles += 1;
    } else if (includeSource && isSourceFile(file)) {
      if (scanSourceFile(file, appEffectIds, counts)) parsedFiles += 1;
    }
  }

  const summary = summarize(counts, nativeIds);
  const payload = {
    targets: resolvedTargets.map((target) => relative(root, resolve(target)) || resolve(target)),
    filesScanned: files.length,
    filesParsed: parsedFiles,
    appEffectCount: appEffectIds.size,
    nativeEffectCount: nativeIds.size,
    ...summary,
  };

  if (jsonOutput) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log('Native effect usage rank');
  console.log(`Targets: ${payload.targets.join(', ') || '(none)'}`);
  console.log(`Files: ${payload.filesParsed}/${payload.filesScanned} parsed`);
  console.log(`Manifest: ${payload.nativeEffectCount}/${payload.appEffectCount} app effects native`);
  if (!summary.totalCount) {
    console.log('No saved effect-chain usage found. Point this at exported Ghost project/preset JSON for a real priority list.');
    return;
  }
  const coverage = summary.totalCount > 0 ? (summary.nativeCount / summary.totalCount) * 100 : 0;
  console.log(`Usage coverage: ${summary.nativeCount}/${summary.totalCount} effect instances native (${coverage.toFixed(1)}%)`);
  console.log(`Used effect IDs: ${summary.nativeUsedEffectCount}/${summary.usedEffectCount} native`);
  printTable('Top missing native effects', summary.missingRows);
  printTable('Top already native effects', summary.nativeRows, 12);
}

main();
