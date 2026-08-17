import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const root = process.cwd();
const rendererRoot = join(root, 'src', 'lib', 'renderer');
const stdlibRoot = join(rendererRoot, 'wgsl');
const nativeRendererRoot = join(root, 'native-renderer', 'src');
const bin = join(
  root,
  'native-renderer',
  'target',
  'release',
  process.platform === 'win32' ? 'ghost-render-core.exe' : 'ghost-render-core',
);

const WGSL_TEMPLATE_RE = /\b(?:const|let)\s+([A-Za-z0-9_]+)\s*=\s*\/\*\s*wgsl\s*\*\/\s*`([\s\S]*?)`/g;
const WGSL_MODULE_CALL_RE = /\bcreate(?:AndWarm)?WgslShaderModule\s*\(([\s\S]*?)\)/g;
const NUMERIC_CONST_RE = /\bconst\s+([A-Z][A-Z0-9_]*)\s*=\s*(-?\d+(?:\.\d+)?)\s*;/g;
// Constants are frequently DERIVED from other constants
// (`const MAX_CHUNKS = MAX_POINTS / CHUNK_POINTS;`). Capturing only literals
// made any shader interpolating a derived constant unverifiable, which is why
// this check had been failing on lightPaintingNative.ts. Resolve simple
// arithmetic over already-known constants instead.
const DERIVED_CONST_RE =
  /\bconst\s+([A-Z][A-Z0-9_]*)\s*=\s*([A-Z][A-Z0-9_]*|-?\d+(?:\.\d+)?)\s*([*/+-])\s*([A-Z][A-Z0-9_]*|-?\d+(?:\.\d+)?)\s*;/g;
// Bare identifiers plus simple binary expressions over known constants
// (`${MAX_STROKES * STROKE_VEC4S}`) — the instrument shaders size their
// storage arrays with inline products, and leaving those unresolved put a
// literal `${…}` into the assembled WGSL, which is why the three
// instrument modules failed this gate since it was introduced.
const INTERPOLATION_RE = /\$\{\s*([A-Za-z0-9_]+(?:\s*[*/+-]\s*[A-Za-z0-9_]+)?)\s*\}/g;
const INCLUDE_RE = /^[ \t]*#include\s+(?:<([^>\r\n]+)>|"([^"\r\n]+)")\s*$/gm;
const RUST_WGSL_RAW_CONST_RE = /\bconst\s+([A-Z0-9_]+_WGSL)\s*:\s*&str\s*=\s*r#"([\s\S]*?)"#;/g;
const RUST_WGSL_CONCAT_CONST_RE = /\bconst\s+([A-Z0-9_]+_WGSL)\s*:\s*&str\s*=\s*concat!\(\s*include_str!\("([^"]+)"\)\s*,\s*r#"([\s\S]*?)"#\s*\);/g;

function walkFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      walkFiles(path, out);
    } else if (/\.(ts|svelte)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

function normalizeIncludeName(raw) {
  return raw.trim().replace(/^\.?\//, '').replace(/\.wgsl$/i, '');
}

function loadStdlib() {
  const modules = new Map();
  for (const entry of readdirSync(stdlibRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.wgsl')) continue;
    const name = entry.name.replace(/\.wgsl$/i, '');
    modules.set(name, readFileSync(join(stdlibRoot, entry.name), 'utf8'));
  }
  return modules;
}

function splitTopLevelArgs(source) {
  const args = [];
  let start = 0;
  let depth = 0;
  let quote = null;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const prev = source[i - 1];
    if (quote) {
      if (ch === quote && prev !== '\\') quote = null;
      continue;
    }
    if (ch === '\'' || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) {
      args.push(source.slice(start, i).trim());
      start = i + 1;
    }
  }
  args.push(source.slice(start).trim());
  return args;
}

function extractModuleSourceNames(source) {
  const names = new Set();
  for (const match of source.matchAll(WGSL_MODULE_CALL_RE)) {
    const args = splitTopLevelArgs(match[1] ?? '');
    const sourceArg = args[1] ?? '';
    if (/^[A-Za-z0-9_]+$/.test(sourceArg)) names.add(sourceArg);
  }
  return names;
}

function resolveIncludes(source, modules, sourceName) {
  const emitted = new Set();
  const visit = (code, name, stack) => code.replace(INCLUDE_RE, (_match, angleName, quoteName) => {
    const includeName = normalizeIncludeName(angleName ?? quoteName ?? '');
    if (!includeName) throw new Error(`Empty WGSL include in ${name}`);
    if (stack.includes(includeName)) {
      throw new Error(`Circular WGSL include: ${[...stack, includeName].join(' -> ')}`);
    }
    if (emitted.has(includeName)) return `// SKIP duplicate #include <${includeName}>`;
    const moduleSource = modules.get(includeName);
    if (moduleSource === undefined) throw new Error(`Unknown WGSL include "${includeName}" in ${name}`);
    emitted.add(includeName);
    return `// BEGIN #include <${includeName}>\n${visit(moduleSource, includeName, [...stack, includeName])}\n// END #include <${includeName}>`;
  });
  return visit(source, sourceName, [sourceName]);
}

// Record ids and the skip-list below are compared against forward-slash paths.
// `relative()` yields backslashes on Windows, which silently broke both: the
// skip never matched, and record ids differed from the macOS run.
function repoPath(absolute) {
  return relative(root, absolute).split(sep).join('/');
}

function extractFileRecords(path) {
  const source = readFileSync(path, 'utf8');
  const relativeFile = repoPath(path);
  const wgsl = new Map();
  const numerics = new Map();

  for (const match of source.matchAll(WGSL_TEMPLATE_RE)) {
    wgsl.set(match[1], match[2] ?? '');
  }
  for (const match of source.matchAll(NUMERIC_CONST_RE)) {
    numerics.set(match[1], match[2]);
  }
  // Repeat to a fixpoint so a derived constant can itself feed another one.
  // Bounded by pass count: a cycle stops making progress and simply exits.
  for (let pass = 0; pass < 8; pass += 1) {
    let progressed = false;
    for (const match of source.matchAll(DERIVED_CONST_RE)) {
      const [, name, lhs, op, rhs] = match;
      if (numerics.has(name)) continue;
      const left = numerics.has(lhs) ? Number(numerics.get(lhs)) : Number(lhs);
      const right = numerics.has(rhs) ? Number(numerics.get(rhs)) : Number(rhs);
      if (!Number.isFinite(left) || !Number.isFinite(right)) continue;
      const value =
        op === '*' ? left * right :
        op === '/' ? left / right :
        op === '+' ? left + right : left - right;
      if (!Number.isFinite(value)) continue;
      numerics.set(name, String(value));
      progressed = true;
    }
    if (!progressed) break;
  }
  const moduleSourceNames = extractModuleSourceNames(source);

  const resolving = new Set();
  const resolveTemplate = (name) => {
    const body = wgsl.get(name);
    if (body === undefined) throw new Error(`Unknown WGSL symbol ${name}`);
    if (resolving.has(name)) throw new Error(`Circular WGSL template interpolation in ${relativeFile}: ${name}`);
    resolving.add(name);
    try {
      return body.replace(INTERPOLATION_RE, (_match, expr) => {
        const resolveTerm = (term) => {
          const symbol = term.trim();
          if (wgsl.has(symbol)) return resolveTemplate(symbol);
          if (numerics.has(symbol)) return numerics.get(symbol);
          if (/^-?\d+(?:\.\d+)?$/.test(symbol)) return symbol;
          throw new Error(`${relativeFile}:${name} references unsupported WGSL interpolation \${${expr}}`);
        };
        const binary = expr.match(/^(.+?)\s*([*/+-])\s*(.+)$/);
        if (binary) {
          const left = Number(resolveTerm(binary[1]));
          const right = Number(resolveTerm(binary[3]));
          if (Number.isFinite(left) && Number.isFinite(right)) {
            const value = binary[2] === '*' ? left * right
              : binary[2] === '/' ? left / right
              : binary[2] === '+' ? left + right
              : left - right;
            return String(value);
          }
        }
        return resolveTerm(expr);
      });
    } finally {
      resolving.delete(name);
    }
  };

  const records = [...wgsl.keys()]
    .filter((name) => looksLikeStandaloneTaggedWgsl(name, wgsl.get(name) ?? '', moduleSourceNames))
    .map((name) => ({
      id: `${relativeFile}:${name}`,
      stage: 'module',
      entry: 'main',
      source: resolveTemplate(name),
    }));

  for (const name of moduleSourceNames) {
    if (!wgsl.has(name)) {
      throw new Error(`Shader module call references unknown WGSL symbol ${name}`);
    }
  }

  return records;
}

function looksLikeWgsl(source) {
  const s = source.trim();
  return s.includes('@vertex')
    || s.includes('@fragment')
    || s.includes('@compute')
    || s.includes('var<')
    || s.includes('vec2<')
    || s.includes('vec3<')
    || s.includes('vec4<')
    || (s.includes('fn ') && s.includes('->'));
}

function looksLikeStandaloneTaggedWgsl(name, source, moduleSourceNames) {
  if (moduleSourceNames.has(name)) return true;
  return source.includes('@vertex')
    || source.includes('@fragment')
    || source.includes('@compute')
    || source.includes('var<')
    || /\bstruct\s+[A-Za-z0-9_]+/.test(source);
}

function extractFunctionNames(source, prefix) {
  const names = new Set();
  const re = new RegExp(`\\bfn\\s+(${prefix}[A-Za-z0-9_]*)\\s*\\(`, 'g');
  for (const match of source.matchAll(re)) {
    names.add(match[1]);
  }
  return names;
}

function assertNativeHeartbeatAudioStdlibParity(stdlib) {
  const audioStdlib = stdlib.get('audio');
  if (!audioStdlib) throw new Error('WGSL stdlib is missing audio.wgsl');
  const heartbeatPath = join(nativeRendererRoot, 'heartbeat.wgsl');
  const heartbeat = readFileSync(heartbeatPath, 'utf8');
  const required = extractFunctionNames(audioStdlib, 'ghost_audio_');
  const available = extractFunctionNames(heartbeat, 'ghost_audio_');
  const missing = [...required].filter((name) => !available.has(name));
  if (missing.length) {
    throw new Error(
      `native-renderer/src/heartbeat.wgsl is missing shared audio helper(s): ${missing.join(', ')}`,
    );
  }
}

function assertNativeStage3DLightingStdlibUsage(stdlib) {
  const lightingStdlib = stdlib.get('lighting');
  if (!lightingStdlib) throw new Error('WGSL stdlib is missing lighting.wgsl');
  const required = ['ghost_safe_normalize3', 'ghost_lambert', 'ghost_apply_directional_light'];
  const shared = extractFunctionNames(lightingStdlib, 'ghost_');
  const missingShared = required.filter((name) => !shared.has(name));
  if (missingShared.length) {
    throw new Error(`src/lib/renderer/wgsl/lighting.wgsl is missing required native helper(s): ${missingShared.join(', ')}`);
  }

  const nativeMain = readFileSync(join(nativeRendererRoot, 'main.rs'), 'utf8');
  const sharedIncludePath = 'include_str!("../../src/lib/renderer/wgsl/lighting.wgsl")';
  const localCopies = required.filter((name) => new RegExp(`\\bfn\\s+${name}\\s*\\(`).test(nativeMain));
  if (!nativeMain.includes(sharedIncludePath) || localCopies.length) {
    throw new Error(
      `native Stage3D mesh shader must consume shared lighting.wgsl directly: ${
        localCopies.length ? `local copies=${localCopies.join(', ')}` : 'include_str missing'
      }`,
    );
  }
}

function extractNativeRustWgslRecords() {
  const mainPath = join(nativeRendererRoot, 'main.rs');
  const source = readFileSync(mainPath, 'utf8');
  const records = [];
  const concatConstNames = new Set();

  for (const match of source.matchAll(RUST_WGSL_CONCAT_CONST_RE)) {
    const [, name, includePath, body] = match;
    concatConstNames.add(name);
    const includeSource = readFileSync(resolve(nativeRendererRoot, includePath), 'utf8');
    records.push({
      id: `native-renderer/src/main.rs:${name}`,
      stage: 'module',
      entry: 'main',
      source: `${includeSource}\n${body ?? ''}`,
    });
  }

  for (const match of source.matchAll(RUST_WGSL_RAW_CONST_RE)) {
    const [, name, body] = match;
    if (concatConstNames.has(name)) continue;
    records.push({
      id: `native-renderer/src/main.rs:${name}`,
      stage: 'module',
      entry: 'main',
      source: body ?? '',
    });
  }

  return records.filter((record) => looksLikeWgsl(record.source));
}

function collectRecords() {
  const stdlib = loadStdlib();
  assertNativeHeartbeatAudioStdlibParity(stdlib);
  assertNativeStage3DLightingStdlibUsage(stdlib);
  const records = [];
  const failures = [];

  for (const path of walkFiles(rendererRoot)) {
    const relativePath = repoPath(path);
    if (relativePath.endsWith('src/lib/renderer/wgsl/shaderModule.ts')) continue;
    try {
      for (const record of extractFileRecords(path)) {
        try {
          records.push({
            ...record,
            source: resolveIncludes(record.source, stdlib, record.id),
          });
        } catch (err) {
          failures.push(`${record.id}: ${err?.message ?? err}`);
        }
      }
    } catch (err) {
      failures.push(`${relativePath}: ${err?.message ?? err}`);
    }
  }

  for (const [name, source] of stdlib) {
    if (!looksLikeWgsl(source)) continue;
    records.push({
      id: `src/lib/renderer/wgsl/${name}.wgsl`,
      stage: 'module',
      entry: 'main',
      source,
    });
  }

  for (const entry of readdirSync(nativeRendererRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.wgsl')) continue;
    const source = readFileSync(join(nativeRendererRoot, entry.name), 'utf8');
    if (!looksLikeWgsl(source)) continue;
    records.push({
      id: `native-renderer/src/${entry.name}`,
      stage: 'module',
      entry: 'main',
      source,
    });
  }
  records.push(...extractNativeRustWgslRecords());

  if (failures.length) {
    throw new Error(`WGSL source assembly failed:\n${failures.join('\n')}`);
  }
  return records.filter((record) => looksLikeWgsl(record.source));
}

function createRpcProcess() {
  if (!existsSync(bin)) {
    throw new Error(`native render-core binary is missing: ${bin}\nRun npm run native:build first.`);
  }

  const child = spawn(bin, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  let nextId = 1;
  let stdout = '';
  let stderr = '';
  const pending = new Map();

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    let index = stdout.indexOf('\n');
    while (index >= 0) {
      const line = stdout.slice(0, index).trim();
      stdout = stdout.slice(index + 1);
      if (line) {
        const message = JSON.parse(line);
        const wait = pending.get(message.id);
        if (wait) {
          clearTimeout(wait.timer);
          pending.delete(message.id);
          if (message.ok) wait.resolve(message.result);
          else wait.reject(new Error(message.error || `${wait.method} failed`));
        }
      }
      index = stdout.indexOf('\n');
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  const send = (method, params = {}, timeoutMs = 8000) => new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`native render-core timed out handling ${method}`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer, method });
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  });

  const close = async () => {
    try {
      await send('shutdown', {}, 1000);
    } catch {
      // The process may already be gone after a failing parse batch.
    }
    child.kill();
    return stderr.trim();
  };

  return { send, close };
}

async function main() {
  const records = collectRecords();
  const rpc = createRpcProcess();
  const chunkSize = 8;

  try {
    for (let i = 0; i < records.length; i += chunkSize) {
      const commands = records.slice(i, i + chunkSize).map((record) => ({
        type: 'precompile_shader',
        shader_id: record.id,
        stage: record.stage,
        entry: record.entry,
        source: record.source,
      }));
      await rpc.send('submit_commands', { commands }, 12000);
    }

    const snapshot = await rpc.send('snapshot', {}, 8000);
    const status = snapshot.status ?? {};
    const registry = Array.isArray(snapshot.shader_registry) ? snapshot.shader_registry : [];
    const compiledIds = new Set(registry.map((record) => record.shader_id));
    const missing = records.filter((record) => !compiledIds.has(record.id));

    if (status.shader_precompile_failed || status.shader_precompile_dropped || missing.length) {
      const details = [
        `compiled=${status.shader_precompile_compiled ?? 0}/${records.length}`,
        `failed=${status.shader_precompile_failed ?? 0}`,
        `dropped=${status.shader_precompile_dropped ?? 0}`,
        status.last_shader_error ? `last_error=${status.last_shader_error}` : '',
        missing.length ? `missing:\n${missing.map((record) => `  - ${record.id}`).join('\n')}` : '',
        // Without the core's own message a failure here is undiagnosable —
        // you get a count and no reason, which is what made this gate easy
        // to ignore.
        status.last_shader_error ? `last core shader error:\n  ${status.last_shader_error}` : '',
      ].filter(Boolean).join('\n');
      throw new Error(`Native WGSL compatibility check failed:\n${details}`);
    }

    console.log(`Native WGSL compatibility check passed: ${records.length} shaders parsed by naga.`);
  } finally {
    const stderr = await rpc.close();
    if (stderr) console.error(stderr.split('\n').slice(-12).join('\n'));
  }
}

main().catch((err) => {
  console.error(err?.stack || err?.message || err);
  process.exit(1);
});
