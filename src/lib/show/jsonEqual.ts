/**
 * `sameJson(a, b)` answers `JSON.stringify(a) === JSON.stringify(b)` for
 * plain data without building either string: it stops at the first
 * difference and skips anything both sides share by reference. The show
 * store uses it where an edit runs on every pointer move (a key drag on a
 * long lane) and stringifying the whole lane twice per move was the cost.
 *
 * Same rules as JSON: key order counts, keys whose value JSON leaves out
 * (undefined, functions, symbols) are not there, those values are null in
 * an array, NaN and ±Infinity are null, and toJSON() is honoured.
 */

const OMIT = Symbol('omit');

/** The value as JSON sees it: OMIT for what it leaves out, null for non-finite numbers. */
function jsonValue(value: unknown, key: string): unknown {
  if (value !== null && typeof value === 'object' && typeof (value as { toJSON?: unknown }).toJSON === 'function') {
    value = (value as { toJSON: (key: string) => unknown }).toJSON(key);
  }
  switch (typeof value) {
    case 'undefined':
    case 'function':
    case 'symbol':
      return OMIT;
    case 'number':
      return Number.isFinite(value) ? value : null;
    default:
      return value;
  }
}

function equalValues(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  const arrayA = Array.isArray(a);
  if (arrayA !== Array.isArray(b)) return false;
  if (arrayA) {
    const x = a as unknown[];
    const y = b as unknown[];
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) {
      if (x[i] === y[i]) continue;
      const vx = jsonValue(x[i], String(i));
      const vy = jsonValue(y[i], String(i));
      if (!equalValues(vx === OMIT ? null : vx, vy === OMIT ? null : vy)) return false;
    }
    return true;
  }
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const kx = Object.keys(x);
  const ky = Object.keys(y);
  let i = 0;
  let j = 0;
  for (;;) {
    let vx: unknown = OMIT;
    while (i < kx.length && (vx = jsonValue(x[kx[i]], kx[i])) === OMIT) i++;
    let vy: unknown = OMIT;
    while (j < ky.length && (vy = jsonValue(y[ky[j]], ky[j])) === OMIT) j++;
    const endX = i >= kx.length;
    const endY = j >= ky.length;
    if (endX || endY) return endX && endY;
    if (kx[i] !== ky[j] || !equalValues(vx, vy)) return false;
    i++;
    j++;
  }
}

/** JSON.stringify(a) === JSON.stringify(b), without the strings. */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b && (typeof a !== 'number' || Number.isFinite(a))) return true;
  const va = jsonValue(a, '');
  const vb = jsonValue(b, '');
  if (va === OMIT || vb === OMIT) return va === vb;
  return equalValues(va, vb);
}
