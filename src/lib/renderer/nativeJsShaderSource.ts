import type { JSAnimationSource } from '$lib/types';

export type NativeJavascriptShaderSource = {
  shaderCode: string;
  shaderValues: Record<string, number | boolean | number[]>;
};

type JavascriptParam = NonNullable<JSAnimationSource['params']>[number];

const FRAGMENT_NAMES = new Set([
  'fragmentshader',
  'fragmentsource',
  'fragment',
  'fragshader',
  'fragsource',
  'frag',
  'fssource',
  'fs',
]);

const nativeJavascriptShaderCache = new WeakMap<
  JSAnimationSource,
  { htmlCode: string; paramsSignature: string; shaderCode: string }
>();

function readQuotedValue(source: string, quoteIndex: number): string | null {
  const quote = source[quoteIndex];
  if (quote !== '`' && quote !== '"' && quote !== "'") return null;
  let output = '';
  let escaped = false;
  for (let index = quoteIndex + 1; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) {
      output += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      output += char;
      continue;
    }
    if (char === quote) return output;
    output += char;
  }
  return null;
}

function shaderCandidate(value: string | null): string | null {
  if (!value || value.includes('${')) return null;
  const decoded = value
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t');
  return /\bvoid\s+main\s*\(/.test(decoded) ? decoded.trim() : null;
}

export function extractJavascriptFragmentShader(htmlCode: string): string | null {
  const scriptPattern = /<script\b[^>]*type\s*=\s*["'](?:x-shader\/x-fragment|x-fragment|fragment)["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of htmlCode.matchAll(scriptPattern)) {
    const candidate = shaderCandidate(match[1]);
    if (candidate) return candidate;
  }

  const declarationPattern = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([`"'])/g;
  for (const match of htmlCode.matchAll(declarationPattern)) {
    if (!FRAGMENT_NAMES.has(match[1].toLowerCase())) continue;
    const quoteIndex = (match.index ?? 0) + match[0].length - 1;
    const candidate = shaderCandidate(readQuotedValue(htmlCode, quoteIndex));
    if (candidate) return candidate;
  }

  const propertyPattern = /\bfragmentShader\s*:\s*([`"'])/g;
  for (const match of htmlCode.matchAll(propertyPattern)) {
    const quoteIndex = (match.index ?? 0) + match[0].length - 1;
    const candidate = shaderCandidate(readQuotedValue(htmlCode, quoteIndex));
    if (candidate) return candidate;
  }
  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceIdentifier(source: string, identifier: string, replacement: string): string {
  const identifierPattern = new RegExp(`\\b${escapeRegExp(identifier)}\\b`, 'g');
  const declarationPattern = new RegExp(
    `\\b(?:float|int|bool|vec[234]|mat[234])\\s+${escapeRegExp(identifier)}\\b`,
  );
  const functionPattern = /\b(?:void|float|int|bool|vec[234]|mat[234])\s+[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{/g;
  let output = '';
  let cursor = 0;
  for (const match of source.matchAll(functionPattern)) {
    const start = match.index ?? 0;
    if (start < cursor) continue;
    let depth = 0;
    let end = -1;
    for (let index = start; index < source.length; index += 1) {
      if (source[index] === '{') depth += 1;
      if (source[index] === '}') {
        depth -= 1;
        if (depth === 0) {
          end = index + 1;
          break;
        }
      }
    }
    if (end < 0) continue;
    output += source.slice(cursor, start).replace(identifierPattern, replacement);
    const fn = source.slice(start, end);
    output += declarationPattern.test(fn) ? fn : fn.replace(identifierPattern, replacement);
    cursor = end;
  }
  output += source.slice(cursor).replace(identifierPattern, replacement);
  return output;
}

function removeUniform(source: string, identifier: string): string {
  return source.replace(
    new RegExp(`^[ \\t]*uniform\\s+(?:float|int|bool|vec[234])\\s+${escapeRegExp(identifier)}\\s*;[ \\t]*$`, 'gm'),
    '',
  );
}

function uniformLocations(htmlCode: string): Map<string, string> {
  const locations = new Map<string, string>();
  const pattern = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^;\n]*?getUniformLocation\s*\([^,]+,\s*["']([A-Za-z_$][\w$]*)["']\s*\)/g;
  for (const match of htmlCode.matchAll(pattern)) locations.set(match[1], match[2]);
  return locations;
}

function normalizedUniformName(name: string): string {
  const stripped = name.replace(/^u[_-]?/i, '');
  return stripped ? stripped[0].toLowerCase() + stripped.slice(1) : name;
}

function uniformParamBindings(
  htmlCode: string,
  params: readonly JavascriptParam[],
): Map<string, string> {
  const locations = uniformLocations(htmlCode);
  const paramNames = new Set(params.map((param) => param.name));
  const bindings = new Map<string, string>();
  const setterPattern = /\bgl\.uniform(?:[1-4](?:f|i|fv|iv)|Matrix[234]fv)\s*\(\s*([A-Za-z_$][\w$]*)([\s\S]*?)\)\s*;/g;
  for (const match of htmlCode.matchAll(setterPattern)) {
    const uniformName = locations.get(match[1]) ?? match[1];
    const args = match[2];
    const directParam = params.find((param) =>
      new RegExp(`(?:shaderParams|params|sp|p)\\s*(?:\\.\\s*${escapeRegExp(param.name)}\\b|\\[\\s*["']${escapeRegExp(param.name)}["']\\s*\\])`).test(args),
    );
    if (directParam) bindings.set(uniformName, directParam.name);
  }
  for (const uniformName of locations.values()) {
    const normalized = normalizedUniformName(uniformName);
    if (paramNames.has(normalized) && !bindings.has(uniformName)) {
      bindings.set(uniformName, normalized);
    }
  }
  return bindings;
}

function declaredUniformType(source: string, identifier: string): string | null {
  const match = source.match(
    new RegExp(`\\buniform\\s+(float|int|bool|vec[234])\\s+${escapeRegExp(identifier)}\\s*;`),
  );
  return match?.[1] ?? null;
}

function paramExpression(param: JavascriptParam, uniformType: string | null): string {
  if (param.type !== 'color') return param.name;
  if (uniformType === 'vec2') return `${param.name}.xy`;
  if (uniformType === 'vec3') return `${param.name}.rgb`;
  return param.name;
}

function isDeclaredUniform(source: string, identifier: string, type?: string): boolean {
  const typePattern = type ? escapeRegExp(type) : '(?:float|int|bool|vec[234])';
  return new RegExp(`\\buniform\\s+${typePattern}\\s+${escapeRegExp(identifier)}\\s*;`).test(source);
}

function inputMetadata(param: JavascriptParam) {
  if (param.type === 'boolean') {
    return { NAME: param.name, TYPE: 'bool', DEFAULT: Boolean(param.default) };
  }
  if (param.type === 'color') {
    const values = Array.isArray(param.default) ? param.default.slice(0, 4) : [1, 1, 1, 1];
    while (values.length < 4) values.push(1);
    return { NAME: param.name, TYPE: 'color', DEFAULT: values };
  }
  return {
    NAME: param.name,
    TYPE: 'float',
    DEFAULT: typeof param.default === 'number' ? param.default : 0,
    ...(typeof param.min === 'number' ? { MIN: param.min } : {}),
    ...(typeof param.max === 'number' ? { MAX: param.max } : {}),
    ...(param.label ? { LABEL: param.label } : {}),
  };
}

export function nativeShaderSourceFromJavascript(
  jsAnimation: JSAnimationSource | null | undefined,
): NativeJavascriptShaderSource | null {
  if (!jsAnimation?.htmlCode) return null;
  const params = jsAnimation.params ?? [];
  const paramsSignature = JSON.stringify(params);
  const cached = nativeJavascriptShaderCache.get(jsAnimation);
  let shaderCode = cached?.htmlCode === jsAnimation.htmlCode && cached.paramsSignature === paramsSignature
    ? cached.shaderCode
    : null;
  if (!shaderCode) {
    const fragment = extractJavascriptFragmentShader(jsAnimation.htmlCode);
    if (!fragment) return null;
    const bindings = uniformParamBindings(jsAnimation.htmlCode, params);
    let body = fragment;

    for (const timeName of ['t', 'time', 'uTime', 'u_time']) {
      if (!isDeclaredUniform(body, timeName, 'float')) continue;
      body = removeUniform(body, timeName);
      const speedParam = params.find((param) => param.name === 'speed' && param.type === 'number');
      body = replaceIdentifier(body, timeName, speedParam ? '(TIME * speed)' : 'TIME');
    }
    for (const resolutionName of ['r', 'resolution', 'uResolution', 'u_resolution']) {
      if (!isDeclaredUniform(body, resolutionName, 'vec2')) continue;
      body = removeUniform(body, resolutionName);
      body = replaceIdentifier(body, resolutionName, 'RENDERSIZE');
    }

    for (const [uniformName, paramName] of bindings) {
      const param = params.find((candidate) => candidate.name === paramName);
      if (!param || !isDeclaredUniform(body, uniformName)) continue;
      const uniformType = declaredUniformType(body, uniformName);
      body = removeUniform(body, uniformName);
      body = replaceIdentifier(body, uniformName, paramExpression(param, uniformType));
    }

    const metadata = {
      ISFVSN: '2',
      DESCRIPTION: 'Native shader-backed JavaScript media source',
      INPUTS: params.map(inputMetadata),
    };
    shaderCode = `/*${JSON.stringify(metadata)}*/\n${body.trim()}\n`;
    nativeJavascriptShaderCache.set(jsAnimation, {
      htmlCode: jsAnimation.htmlCode,
      paramsSignature,
      shaderCode,
    });
  }
  const shaderValues: Record<string, number | boolean | number[]> = {};
  for (const param of params) {
    shaderValues[param.name] = jsAnimation.paramValues?.[param.name] ?? param.default;
  }
  return {
    shaderCode,
    shaderValues,
  };
}
