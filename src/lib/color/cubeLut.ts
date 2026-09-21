/** 3D subset of Adobe Cube 1.0. Rows are red-fastest, then green, then blue.
 * Parse once on import, never on the render clock. No implicit color-space conversion.
 */
export const MAX_CUBE_LUT_SIZE = 65;
export const MAX_CUBE_LUT_TEXT_LENGTH = 32 * 1024 * 1024;
export interface CubeLut {
  readonly title: string;
  readonly size: number;
  readonly domainMin: readonly number[];
  readonly domainMax: readonly number[];
  /** RGBA-aligned GPU storage entries; the fourth component is padding. */
  readonly rgba: readonly number[];
}
const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

export function parseCubeLut(text: string, fallbackTitle = 'Untitled LUT'): CubeLut {
  if (text.length > MAX_CUBE_LUT_TEXT_LENGTH) throw new Error('LUT exceeds the 32 MB text limit.');
  let size = 0;
  let title = fallbackTitle.slice(0, 256);
  let domainMin = [0, 0, 0];
  let domainMax = [1, 1, 1];
  const rgba: number[] = [];
  const seen = new Set<string>();
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);
  for (let index = 0; index < lines.length; index++) {
    const fail = (message: string): never => { throw new Error(`Line ${index + 1}: ${message}`); };
    const raw = lines[index].trim();
    if (!raw || raw.startsWith('#')) continue;
    // Keep # inside a quoted title; permit trailing comments on numeric rows.
    const line = raw.startsWith('TITLE') ? raw : raw.split('#', 1)[0].trim();
    const tokens = line.split(/\s+/);
    const key = tokens[0];
    const numbers = (values: string[], count: number): number[] => {
      if (values.length !== count) return fail(`Expected ${count} numeric values.`);
      return values.map((value) => {
        const number = Number(value);
        if (!decimal.test(value) || !Number.isFinite(number) || Math.abs(number) > 1e37) {
          return fail('Expected a finite decimal value within the GPU numeric range.');
        }
        return Math.fround(number);
      });
    };
    if (/^[A-Za-z_]/.test(key)) {
      if (rgba.length) fail('LUT headers must precede table data.');
      if (seen.has(key)) fail(`Duplicate ${key} header.`);
      seen.add(key);
      switch (key) {
        case 'TITLE': {
          const match = /^TITLE\s+"([^"\r\n]*)"\s*(?:#.*)?$/.exec(line);
          if (!match) fail('TITLE must be enclosed in double quotes.');
          title = match![1].slice(0, 256);
          break;
        }
        case 'LUT_3D_SIZE':
          if (tokens.length !== 2 || !/^\d+$/.test(tokens[1])) fail('LUT size must be an integer.');
          size = Number(tokens[1]);
          if (size < 2 || size > MAX_CUBE_LUT_SIZE) fail('Supported 3D LUT sizes are 2–65.');
          break;
        case 'DOMAIN_MIN': domainMin = numbers(tokens.slice(1), 3); break;
        case 'DOMAIN_MAX': domainMax = numbers(tokens.slice(1), 3); break;
        case 'LUT_3D_INPUT_RANGE': {
          const [min, max] = numbers(tokens.slice(1), 2);
          domainMin = [min, min, min];
          domainMax = [max, max, max];
          break;
        }
        case 'LUT_1D_SIZE': case 'LUT_1D_INPUT_RANGE':
          fail('1D and combined shaper LUTs are not supported. Export a standalone 3D .cube LUT.');
        default: fail(`Unsupported LUT header: ${key}.`);
      }
    } else {
      if (!size) fail('Missing LUT_3D_SIZE before table data.');
      if (rgba.length >= size ** 3 * 4) fail('Too many LUT table rows.');
      rgba.push(...numbers(tokens, 3), 0);
    }
  }
  if (seen.has('LUT_3D_INPUT_RANGE') && (seen.has('DOMAIN_MIN') || seen.has('DOMAIN_MAX'))) {
    throw new Error('Use DOMAIN_MIN/MAX or LUT_3D_INPUT_RANGE, not both.');
  }
  if (!size) throw new Error('Missing LUT_3D_SIZE.');
  if (rgba.length !== size ** 3 * 4) throw new Error(`Expected ${size ** 3} LUT rows; found ${rgba.length / 4}.`);
  for (let channel = 0; channel < 3; channel++) {
    const span = Math.fround(domainMax[channel] - domainMin[channel]);
    if (!(span > 0) || !Number.isFinite(Math.fround(1 / span))) {
      throw new Error('Each input domain must have a positive, GPU-representable range.');
    }
  }
  return Object.freeze({ title, size, domainMin: Object.freeze(domainMin), domainMax: Object.freeze(domainMax), rgba: Object.freeze(rgba) });
}
