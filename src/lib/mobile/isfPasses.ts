// Multi-pass ISF for the phone's renderer: the pieces that are plain text and
// arithmetic, kept apart from WebGL so they can be tested.
//
// A shader with PASSES draws several times a frame. Every pass but the last
// writes into a named buffer (its TARGET) that later passes, and the next
// frame when it is PERSISTENT, read as a sampler of that name. PASSINDEX says
// which pass is drawing, and RENDERSIZE is the size of the buffer being drawn.
// Buffer sizes are expressions of the output size ("$WIDTH/2") or numbers.

export interface PassSpec {
  /** The buffer this pass draws into; none for the picture itself. */
  target?: string;
  persistent: boolean;
  /** Holds values beyond 0..1 (state, accumulated light). */
  float: boolean;
  width?: string;
  height?: string;
}

/** The passes a shader declares, or none for an ordinary single-pass shader. */
export function passSpecs(metadata: { PASSES?: unknown }): PassSpec[] {
  if (!Array.isArray(metadata.PASSES) || !metadata.PASSES.length) return [];
  return metadata.PASSES.map((raw) => {
    const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const target = typeof p.TARGET === 'string' && /^[A-Za-z_]\w*$/.test(p.TARGET) ? p.TARGET : undefined;
    const size = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : undefined);
    return { target, persistent: p.PERSISTENT === true, float: p.FLOAT === true, width: size(p.WIDTH), height: size(p.HEIGHT) };
  });
}

/** The buffers a shader's passes draw into, each once, in pass order. */
export function passTargets(specs: PassSpec[]): PassSpec[] {
  const seen = new Map<string, PassSpec>();
  for (const s of specs) if (s.target) {
    const known = seen.get(s.target);
    // Any pass declaring it persistent or float makes the buffer so.
    if (known) { known.persistent ||= s.persistent; known.float ||= s.float; known.width ??= s.width; known.height ??= s.height; }
    else seen.set(s.target, { ...s });
  }
  return [...seen.values()];
}

/**
 * A buffer dimension: `expr` with $WIDTH and $HEIGHT standing for the picture's
 * size, using numbers, + - * / and brackets, rounded down to at least one
 * pixel. A missing or unreadable expression is the picture's own `fallback`.
 */
export function passSize(expr: string | undefined, width: number, height: number, fallback: number): number {
  if (expr === undefined || !expr.trim()) return Math.max(1, Math.floor(fallback));
  const tokens = expr.replace(/\$WIDTH/g, ` ${width} `).replace(/\$HEIGHT/g, ` ${height} `).match(/\d+\.?\d*|\.\d+|[-+*/()]|\S/g) ?? [];
  let at = 0;
  const fail = () => { throw new Error('bad size'); };
  const primary = (): number => {
    const t = tokens[at++];
    if (t === '(') { const v = sum(); if (tokens[at++] !== ')') fail(); return v; }
    if (t === '-') return -primary();
    if (t === '+') return primary();
    const n = Number(t);
    if (t === undefined || !Number.isFinite(n)) fail();
    return n;
  };
  const product = (): number => {
    let v = primary();
    while (tokens[at] === '*' || tokens[at] === '/') { const op = tokens[at++]; const r = primary(); v = op === '*' ? v * r : v / r; }
    return v;
  };
  const sum = (): number => {
    let v = product();
    while (tokens[at] === '+' || tokens[at] === '-') { const op = tokens[at++]; const r = product(); v = op === '+' ? v + r : v - r; }
    return v;
  };
  try {
    const v = sum();
    if (at !== tokens.length || !Number.isFinite(v)) fail();
    return Math.max(1, Math.min(8192, Math.floor(v)));
  } catch {
    return Math.max(1, Math.floor(fallback));
  }
}

/** Replace every call `name(args)` in `glsl`, with nested brackets handled. Definitions are left alone. */
function rewriteCalls(glsl: string, name: string, replace: (args: string[]) => string | null): string {
  const pattern = new RegExp(`\\b${name}\\s*\\(`, 'g');
  let out = '', last = 0, m: RegExpExecArray | null;
  while ((m = pattern.exec(glsl))) {
    // A definition ("vec4 IMG_PIXEL(sampler2D img, ...") is preceded by a type name.
    if (/\b(?:vec[234]|float|int|void|bool)\s+$/.test(glsl.slice(Math.max(0, m.index - 12), m.index))) continue;
    let depth = 1, i = m.index + m[0].length;
    const args: string[] = [];
    let start = i;
    for (; i < glsl.length && depth > 0; i++) {
      const c = glsl[i];
      if (c === '(') depth++;
      else if (c === ')') { depth--; if (depth === 0) args.push(glsl.slice(start, i)); }
      else if (c === ',' && depth === 1) { args.push(glsl.slice(start, i)); start = i + 1; }
    }
    if (depth !== 0) break;
    const replaced = replace(args.map((a) => a.trim()));
    if (replaced === null) continue;
    out += glsl.slice(last, m.index) + replaced;
    last = i;
    pattern.lastIndex = i;
  }
  return out + glsl.slice(last);
}

/** The image macros that need a buffer's own size, written out for the buffers a shader draws. */
export function rewriteBufferMacros(source: string, targets: string[]): string {
  const known = new Set(targets);
  let out = rewriteCalls(source, 'IMG_SIZE', ([img]) => (known.has(img) ? `_${img}_imgSize` : null));
  out = rewriteCalls(out, 'IMG_THIS_PIXEL', ([img]) => (known.has(img) ? `texture2D(${img}, isf_FragNormCoord)` : null));
  out = rewriteCalls(out, 'IMG_THIS_NORM_PIXEL', ([img]) => (known.has(img) ? `texture2D(${img}, isf_FragNormCoord)` : null));
  out = rewriteCalls(out, 'IMG_PIXEL', ([img, coord]) => (known.has(img) && coord ? `texture2D(${img}, (${coord}) / _${img}_imgSize)` : null));
  return out;
}

/** Declares PASSINDEX and each buffer's sampler and size after the precision line the parser writes. */
export function declarePasses(glsl: string, targets: string[]): string {
  const lines: string[] = [];
  if (!/uniform\s+int\s+PASSINDEX\s*;/.test(glsl)) lines.push('uniform int PASSINDEX;');
  for (const t of targets) {
    if (!new RegExp(`uniform\\s+sampler2D\\s+${t}\\s*;`).test(glsl)) lines.push(`uniform sampler2D ${t};`);
    if (!new RegExp(`uniform\\s+vec2\\s+_${t}_imgSize\\s*;`).test(glsl)) lines.push(`uniform vec2 _${t}_imgSize;`);
  }
  if (!lines.length) return glsl;
  const precision = /precision\s+(?:highp|mediump|lowp)\s+float\s*;/.exec(glsl);
  const at = precision ? precision.index + precision[0].length : 0;
  return glsl.slice(0, at) + '\n' + lines.join('\n') + '\n' + glsl.slice(at);
}
