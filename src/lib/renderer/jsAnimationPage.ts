/**
 * Reading a three.js / p5.js page's declared parameters.
 *
 * Pages describe their sliders in `window.shaderParamDefs = [...]` and their
 * starting values in `window.shaderParams = {...}`. These used to be
 * evaluated with `new Function` in the editor, which runs whatever an
 * imported file puts there with the editor's privileges. The literals are
 * parsed here instead, accepting only plain data: objects, arrays, strings,
 * numbers, booleans and null. Anything else (a function call, `Math.PI`, a
 * template with `${}`) makes that block unreadable rather than executable.
 */
import type { JSAnimationSource } from '../types';
import { extractJSParams } from '../api/ai-client';

export type JsAnimationParam = NonNullable<JSAnimationSource['params']>[number];
type ParamValue = number | boolean | number[];

class LiteralParser {
  private i: number;

  constructor(private readonly s: string, start: number) {
    this.i = start;
  }

  parse(): unknown {
    this.space();
    return this.value();
  }

  private space() {
    for (;;) {
      const c = this.s[this.i];
      if (c === ' ' || c === '\n' || c === '\r' || c === '\t') {
        this.i++;
      } else if (c === '/' && this.s[this.i + 1] === '/') {
        const nl = this.s.indexOf('\n', this.i);
        this.i = nl < 0 ? this.s.length : nl + 1;
      } else if (c === '/' && this.s[this.i + 1] === '*') {
        const end = this.s.indexOf('*/', this.i + 2);
        if (end < 0) throw new Error('unterminated comment');
        this.i = end + 2;
      } else {
        return;
      }
    }
  }

  private value(): unknown {
    const c = this.s[this.i];
    if (c === '{') return this.object();
    if (c === '[') return this.array();
    if (c === '"' || c === "'" || c === '`') return this.string();
    if (c === '-' || c === '+' || c === '.' || (c >= '0' && c <= '9')) return this.number();
    const word = /^(true|false|null)(?![\w$])/.exec(this.s.slice(this.i, this.i + 6));
    if (word) {
      this.i += word[1].length;
      return word[1] === 'true' ? true : word[1] === 'false' ? false : null;
    }
    throw new Error(`unexpected ${c ?? 'end of input'}`);
  }

  private object(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    this.i++;
    this.space();
    while (this.s[this.i] !== '}') {
      const key = this.key();
      this.space();
      if (this.s[this.i] !== ':') throw new Error('expected :');
      this.i++;
      this.space();
      out[key] = this.value();
      this.space();
      if (this.s[this.i] === ',') {
        this.i++;
        this.space();
      } else if (this.s[this.i] !== '}') {
        throw new Error('expected , or }');
      }
    }
    this.i++;
    return out;
  }

  private key(): string {
    const c = this.s[this.i];
    if (c === '"' || c === "'") return this.string();
    const m = /^[A-Za-z_$][\w$]*/.exec(this.s.slice(this.i, this.i + 256));
    if (!m) throw new Error('expected key');
    this.i += m[0].length;
    return m[0];
  }

  private array(): unknown[] {
    const out: unknown[] = [];
    this.i++;
    this.space();
    while (this.s[this.i] !== ']') {
      out.push(this.value());
      this.space();
      if (this.s[this.i] === ',') {
        this.i++;
        this.space();
      } else if (this.s[this.i] !== ']') {
        throw new Error('expected , or ]');
      }
    }
    this.i++;
    return out;
  }

  private string(): string {
    const quote = this.s[this.i++];
    let out = '';
    while (this.i < this.s.length) {
      const c = this.s[this.i++];
      if (c === quote) return out;
      if (c === '\\') {
        const next = this.s[this.i++];
        out += next === 'n' ? '\n' : next === 't' ? '\t' : next;
      } else if (quote === '`' && c === '$' && this.s[this.i] === '{') {
        throw new Error('template expression');
      } else {
        out += c;
      }
    }
    throw new Error('unterminated string');
  }

  private number(): number {
    const m = /^([+-]?)(0x[0-9a-f]+|(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)/i.exec(this.s.slice(this.i, this.i + 64));
    if (!m) throw new Error('expected number');
    this.i += m[0].length;
    const n = Number(m[2]) * (m[1] === '-' ? -1 : 1);
    if (!Number.isFinite(n)) throw new Error('bad number');
    return n;
  }
}

function literalAfter(html: string, pattern: RegExp): unknown {
  const match = pattern.exec(html);
  if (!match) return undefined;
  try {
    return new LiteralParser(html, match.index + match[0].length).parse();
  } catch {
    return undefined;
  }
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((n) => typeof n === 'number');
}

export function parseShaderParamDefs(html: string): JsAnimationParam[] {
  const list = literalAfter(html, /window\.shaderParamDefs\s*=\s*/);
  if (!Array.isArray(list)) return [];
  const params: JsAnimationParam[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const def = item as Record<string, unknown>;
    if (typeof def.name !== 'string') continue;
    const min = typeof def.min === 'number' ? def.min : undefined;
    const max = typeof def.max === 'number' ? def.max : undefined;
    const label = typeof def.label === 'string' ? def.label : def.name;
    if (def.type === 'number') {
      params.push({ name: def.name, type: 'number', default: typeof def.default === 'number' ? def.default : 0, min, max, label });
    } else if (def.type === 'boolean') {
      params.push({ name: def.name, type: 'boolean', default: def.default === true, label });
    } else if (def.type === 'color') {
      params.push({ name: def.name, type: 'color', default: isNumberArray(def.default) ? def.default : [1, 1, 1], label });
    }
  }
  return params;
}

export function parseShaderParamValues(html: string): Record<string, ParamValue> {
  const object = literalAfter(html, /window\.shaderParams\s*=\s*/);
  if (!object || typeof object !== 'object' || Array.isArray(object)) return {};
  const values: Record<string, ParamValue> = {};
  for (const [key, value] of Object.entries(object)) {
    if (typeof value === 'number' || typeof value === 'boolean' || isNumberArray(value)) values[key] = value;
  }
  return values;
}

export function isP5Page(html: string): boolean {
  return /p5\.(min\.)?js|new\s+p5\s*\(/i.test(html);
}

/**
 * The media source description for a page: whether it is p5 or three.js, and
 * its sliders, from `shaderParamDefs` when it declares them, otherwise from
 * the flat `window.shaderParams` literal the AI generator's pages use.
 */
export function jsAnimationFromHtml(htmlCode: string): JSAnimationSource {
  const animationType = isP5Page(htmlCode) ? 'p5js' : 'threejs';
  const declared = parseShaderParamDefs(htmlCode);
  const params = declared.length > 0 ? declared : (extractJSParams(htmlCode) ?? []);
  if (params.length === 0) return { animationType, htmlCode };
  const values = parseShaderParamValues(htmlCode);
  const paramValues: Record<string, ParamValue> = {};
  for (const param of params) paramValues[param.name] = values[param.name] ?? param.default;
  return { animationType, htmlCode, params, paramValues };
}
