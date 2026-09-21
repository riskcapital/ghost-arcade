import { MAX_CUBE_LUT_SIZE, parseCubeLut, type CubeLut } from './cubeLut';

/** Validate project/preset data as strictly as imported files. */
export function validateCubeLut(value: unknown): CubeLut {
  const lut = value as CubeLut;
  if (!lut || typeof lut !== 'object' || !Number.isInteger(lut.size) || lut.size < 2 || lut.size > MAX_CUBE_LUT_SIZE
    || typeof lut.title !== 'string' || lut.title.length > 256
    || !Array.isArray(lut.rgba) || lut.rgba.length !== lut.size ** 3 * 4) throw new Error('Invalid saved 3D LUT.');
  const validNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e37;
  if (![lut.domainMin, lut.domainMax].every(a => Array.isArray(a) && a.length === 3 && a.every(validNumber))
    || !lut.rgba.every(validNumber)) throw new Error('Invalid LUT numeric data.');
  const min = lut.domainMin.map(Math.fround), max = lut.domainMax.map(Math.fround);
  if (min.some((v, i) => !(max[i] > v) || !Number.isFinite(Math.fround(1 / (max[i] - v))))) throw new Error('Invalid LUT input domain.');
  return Object.freeze({ title: lut.title, size: lut.size, domainMin: Object.freeze(min), domainMax: Object.freeze(max), rgba: Object.freeze(lut.rgba.map(Math.fround)) });
}

const identity = parseCubeLut('LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1');
type Entry = { handle: number; lut: CubeLut };
const assets = new WeakMap<object, Entry>();
const handles = new Map<number, WeakRef<Entry>>();
let nextHandle = 1;

/** A nested asset keeps its identity when strength/modulation changes. No table hashing per frame. */
export function cubeLutHandle(value: unknown): number {
  if (!value) return 0;
  if (typeof value !== 'object') throw new Error('Invalid LUT asset.');
  const known = assets.get(value);
  if (known) return known.handle;
  const entry = { handle: nextHandle++, lut: validateCubeLut(value) };
  assets.set(value, entry);
  handles.set(entry.handle, new WeakRef(entry));
  if (entry.handle % 32 === 0) for (const [id, ref] of handles) if (!ref.deref()) handles.delete(id);
  return entry.handle;
}
export function cubeLutForHandle(handle = 0): CubeLut {
  if (handle === 0) return identity;
  const entry = handles.get(handle)?.deref();
  if (!entry) throw new Error('LUT asset is no longer available.');
  return entry.lut;
}
