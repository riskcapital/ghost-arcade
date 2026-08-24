// Native SVG layer renderer. Geometry and authored paint are parsed on the app
// side; animation, materials, effects, extrusion, and compositing run in core.
import type { SVGContent } from '../types';

export const SVG_NATIVE_SHADER_ID = 'svg/render-v6';
export const SVG_MAX_CONTOURS = 32;
export const SVG_MAX_POINTS = 768;

const HEADER_VEC4S = 19;
const CONTOUR_ARRAYS = 5;
const TOTAL_VEC4S = HEADER_VEC4S + SVG_MAX_CONTOURS * CONTOUR_ARRAYS + SVG_MAX_POINTS;
export const SVG_UNIFORM_BYTES = TOTAL_VEC4S * 16;

type SvgPoint = { x: number; y: number };
type SvgColor = [number, number, number, number];
type SvgMatrix = [number, number, number, number, number, number];
export type SvgNativeContour = {
  points: SvgPoint[];
  closed: boolean;
  fill: SvgColor | null;
  stroke: SvgColor | null;
  strokeWidth: number;
  /** Shape-element index: subpaths of one <path> share a group so even-odd
   * parity across them punches holes (letter counters, donut logos). */
  group: number;
};

type SvgNativeGraphOptions = {
  sourceId: string;
  content: SVGContent;
  width: number;
  height: number;
  time: number;
  frameDelta?: number;
  frameIndex?: number;
  includeSnapshot?: boolean;
  /*
   * Chromium-rasterized copy of the authored SVG, uploaded as a source frame
   * by the sync (see svgRaster.ts). When present and ready, `source` render
   * mode samples it instead of the parsed-contour reconstruction — exact
   * gradients, arcs, text, masks, and no contour caps.
   */
  rasterSourceId?: string;
  rasterReady?: boolean;
};

const FILL_CODES: Record<string, number> = {
  solid: 0, gradient: 1, shimmer: 2, pulse: 3, noise: 4,
  liquid: 5, particles: 6, fluid: 7, flow: 8,
};
const COLOR_CODES: Record<string, number> = {
  perShape: 0, rainbow: 1, monochrome: 2,
  complementary: 3, analogous: 4, white: 5,
};
const RENDER_CODES: Record<string, number> = { source: 0, flat: 1, extrude: 2 };
const MATERIAL_CODES: Record<string, number> = {
  holographic: 0, chrome: 1, glass: 2, neon: 3, matte: 4,
};
const LIGHT_CODES: Record<string, number> = { studio: 0, neon: 1, rim: 2 };

const NAMED_COLORS: Record<string, SvgColor> = {
  black: [0, 0, 0, 1], white: [1, 1, 1, 1], red: [1, 0, 0, 1],
  green: [0, 0.5019608, 0, 1], blue: [0, 0, 1, 1], yellow: [1, 1, 0, 1],
  cyan: [0, 1, 1, 1], aqua: [0, 1, 1, 1], magenta: [1, 0, 1, 1],
  fuchsia: [1, 0, 1, 1], gray: [0.5019608, 0.5019608, 0.5019608, 1],
  grey: [0.5019608, 0.5019608, 0.5019608, 1], orange: [1, 0.6470588, 0, 1],
  purple: [0.5019608, 0, 0.5019608, 1], transparent: [0, 0, 0, 0],
};

function finite(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
function numberList(value: string | undefined): number[] {
  return (value?.match(/[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi) ?? [])
    .map(Number).filter(Number.isFinite);
}
function attributesFromTag(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(tag))) attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? '';
  return attributes;
}
function cssDeclarations(value = ''): Record<string, string> {
  const declarations: Record<string, string> = {};
  for (const part of value.split(';')) {
    const separator = part.indexOf(':');
    if (separator < 0) continue;
    declarations[part.slice(0, separator).trim().toLowerCase()] = part.slice(separator + 1).trim();
  }
  return declarations;
}
function cssClassRules(source: string): Map<string, Record<string, string>> {
  const rules = new Map<string, Record<string, string>>();
  for (const block of source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    for (const rule of block[1].matchAll(/\.([\w-]+)\s*\{([^}]*)\}/g)) {
      rules.set(rule[1], { ...(rules.get(rule[1]) ?? {}), ...cssDeclarations(rule[2]) });
    }
  }
  return rules;
}
const IDENTITY_MATRIX: SvgMatrix = [1, 0, 0, 1, 0, 0];
function multiplyMatrix(a: SvgMatrix, b: SvgMatrix): SvgMatrix {
  return [
    a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
function parseTransform(value = ''): SvgMatrix {
  let result: SvgMatrix = IDENTITY_MATRIX;
  for (const match of value.matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/gi)) {
    const name = match[1].toLowerCase();
    const values = numberList(match[2]);
    let next: SvgMatrix = IDENTITY_MATRIX;
    if (name === 'matrix' && values.length >= 6) next = values.slice(0, 6) as SvgMatrix;
    else if (name === 'translate') next = [1, 0, 0, 1, values[0] ?? 0, values[1] ?? 0];
    else if (name === 'scale') next = [values[0] ?? 1, 0, 0, values[1] ?? values[0] ?? 1, 0, 0];
    else if (name === 'rotate') {
      const angle = (values[0] ?? 0) * Math.PI / 180; const c = Math.cos(angle); const s = Math.sin(angle);
      const rotation: SvgMatrix = [c, s, -s, c, 0, 0];
      if (values.length >= 3) {
        const [cx, cy] = [values[1], values[2]];
        next = multiplyMatrix(multiplyMatrix([1, 0, 0, 1, cx, cy], rotation), [1, 0, 0, 1, -cx, -cy]);
      } else next = rotation;
    } else if (name === 'skewx') next = [1, 0, Math.tan((values[0] ?? 0) * Math.PI / 180), 1, 0, 0];
    else if (name === 'skewy') next = [1, Math.tan((values[0] ?? 0) * Math.PI / 180), 0, 1, 0, 0];
    result = multiplyMatrix(result, next);
  }
  return result;
}
function transformPoint(point: SvgPoint, matrix: SvgMatrix): SvgPoint {
  return { x: matrix[0] * point.x + matrix[2] * point.y + matrix[4], y: matrix[1] * point.x + matrix[3] * point.y + matrix[5] };
}
function parseColor(value: string | undefined, opacity = 1): SvgColor | null {
  if (!value || value.trim().toLowerCase() === 'none') return null;
  const normalized = value.trim().toLowerCase();
  const named = NAMED_COLORS[normalized];
  if (named) return [named[0], named[1], named[2], named[3] * opacity];
  if (/^#[0-9a-f]{3,8}$/i.test(normalized)) {
    let hex = normalized.slice(1);
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map((part) => part + part).join('');
    if (hex.length === 6) hex += 'ff';
    if (hex.length === 8) {
      const parsed = [0, 2, 4, 6].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255) as SvgColor;
      parsed[3] *= opacity;
      return parsed;
    }
  }
  const components = numberList(normalized);
  if (normalized.startsWith('rgb') && components.length >= 3) {
    const percent = normalized.includes('%');
    const scale = percent ? 100 : 255;
    return [
      clamp(components[0] / scale, 0, 1), clamp(components[1] / scale, 0, 1),
      clamp(components[2] / scale, 0, 1), clamp((components[3] ?? 1) * opacity, 0, 1),
    ];
  }
  // url(#gradient) and unsupported CSS paints receive a neutral authored fill
  // instead of disappearing. Generated modes can recolor it normally.
  if (normalized.startsWith('url(')) return [1, 1, 1, opacity];
  return null;
}
function styleForTag(
  attributes: Record<string, string>,
  classes: Map<string, Record<string, string>>,
  closed: boolean,
  inherited: Record<string, string> = {},
  inheritedOpacity = 1,
): Pick<SvgNativeContour, 'fill' | 'stroke' | 'strokeWidth'> {
  let style: Record<string, string> = { ...inherited };
  for (const className of (attributes.class ?? '').split(/\s+/).filter(Boolean)) {
    style = { ...style, ...(classes.get(className) ?? {}) };
  }
  style = { ...style, ...cssDeclarations(attributes.style) };
  for (const key of ['fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity']) {
    if (attributes[key] !== undefined) style[key] = attributes[key];
  }
  // The parser has already composed element and ancestor opacity into this
  // value. Applying style.opacity again makes authored SVGs unexpectedly dim.
  const opacity = clamp(inheritedOpacity, 0, 1);
  const fillOpacity = opacity * clamp(finite(style['fill-opacity'], 1), 0, 1);
  const strokeOpacity = opacity * clamp(finite(style['stroke-opacity'], 1), 0, 1);
  const defaultFill = closed && style.fill === undefined ? 'black' : style.fill;
  const defaultStroke = !closed && style.stroke === undefined ? 'black' : style.stroke;
  return {
    fill: parseColor(defaultFill, fillOpacity),
    stroke: parseColor(defaultStroke, strokeOpacity),
    strokeWidth: Math.max(0, finite(style['stroke-width'], defaultStroke ? 1 : 0)),
  };
}

function resolvedStyle(
  attributes: Record<string, string>,
  classes: Map<string, Record<string, string>>,
  inherited: Record<string, string>,
): Record<string, string> {
  const style = { ...inherited };
  for (const className of (attributes.class ?? '').split(/\s+/).filter(Boolean)) Object.assign(style, classes.get(className) ?? {});
  Object.assign(style, cssDeclarations(attributes.style));
  for (const key of ['fill', 'stroke', 'stroke-width', 'fill-opacity', 'stroke-opacity']) {
    if (attributes[key] !== undefined) style[key] = attributes[key];
  }
  return style;
}

function sampleCubic(a: SvgPoint, b: SvgPoint, c: SvgPoint, d: SvgPoint, count = 12): SvgPoint[] {
  return Array.from({ length: count }, (_, index) => {
    const t = (index + 1) / count;
    const q = 1 - t;
    return { x: q ** 3 * a.x + 3 * q ** 2 * t * b.x + 3 * q * t ** 2 * c.x + t ** 3 * d.x,
      y: q ** 3 * a.y + 3 * q ** 2 * t * b.y + 3 * q * t ** 2 * c.y + t ** 3 * d.y };
  });
}
function sampleQuadratic(a: SvgPoint, b: SvgPoint, c: SvgPoint, count = 10): SvgPoint[] {
  return Array.from({ length: count }, (_, index) => {
    const t = (index + 1) / count;
    const q = 1 - t;
    return { x: q ** 2 * a.x + 2 * q * t * b.x + t ** 2 * c.x,
      y: q ** 2 * a.y + 2 * q * t * b.y + t ** 2 * c.y };
  });
}

type BareContour = Pick<SvgNativeContour, 'points' | 'closed'>;
function parsePathContours(path: string): BareContour[] {
  const tokens = path.match(/[a-zA-Z]|[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi) ?? [];
  const contours: BareContour[] = [];
  let tokenIndex = 0;
  let command = '';
  let current: SvgPoint = { x: 0, y: 0 };
  let start: SvgPoint = { x: 0, y: 0 };
  let cubicControl: SvgPoint | null = null;
  let quadraticControl: SvgPoint | null = null;
  let points: SvgPoint[] = [];
  const isCommand = (token: string | undefined) => !!token && /^[a-zA-Z]$/.test(token);
  const hasNumbers = (count: number) => tokenIndex + count <= tokens.length
    && !tokens.slice(tokenIndex, tokenIndex + count).some(isCommand);
  const read = () => finite(tokens[tokenIndex++], 0);
  const point = (relative: boolean): SvgPoint => {
    const x = read(); const y = read();
    return relative ? { x: current.x + x, y: current.y + y } : { x, y };
  };
  const finish = (closed: boolean) => {
    if (points.length >= (closed ? 3 : 2)) contours.push({ points, closed });
    points = [];
  };
  while (tokenIndex < tokens.length) {
    if (isCommand(tokens[tokenIndex])) command = tokens[tokenIndex++];
    if (!command) break;
    const relative = command === command.toLowerCase();
    const upper = command.toUpperCase();
    if (upper === 'Z') { finish(true); current = { ...start }; command = ''; continue; }
    if (upper === 'M' && hasNumbers(2)) {
      if (points.length) finish(false);
      current = point(relative); start = { ...current }; points = [{ ...current }];
      command = relative ? 'l' : 'L'; continue;
    }
    if (upper === 'L' && hasNumbers(2)) { current = point(relative); points.push({ ...current }); continue; }
    if (upper === 'H' && hasNumbers(1)) { const x = read(); current = { x: relative ? current.x + x : x, y: current.y }; points.push({ ...current }); continue; }
    if (upper === 'V' && hasNumbers(1)) { const y = read(); current = { x: current.x, y: relative ? current.y + y : y }; points.push({ ...current }); continue; }
    if (upper === 'C' && hasNumbers(6)) {
      const c1 = point(relative); const c2 = point(relative); const end = point(relative);
      points.push(...sampleCubic(current, c1, c2, end)); current = end; cubicControl = c2; quadraticControl = null; continue;
    }
    if (upper === 'S' && hasNumbers(4)) {
      const c1 = cubicControl ? { x: current.x * 2 - cubicControl.x, y: current.y * 2 - cubicControl.y } : { ...current };
      const c2 = point(relative); const end = point(relative);
      points.push(...sampleCubic(current, c1, c2, end)); current = end; cubicControl = c2; quadraticControl = null; continue;
    }
    if (upper === 'Q' && hasNumbers(4)) {
      const control = point(relative); const end = point(relative);
      points.push(...sampleQuadratic(current, control, end)); current = end; quadraticControl = control; cubicControl = null; continue;
    }
    if (upper === 'T' && hasNumbers(2)) {
      const control: SvgPoint = quadraticControl
        ? { x: current.x * 2 - quadraticControl.x, y: current.y * 2 - quadraticControl.y }
        : { ...current };
      const end = point(relative); points.push(...sampleQuadratic(current, control, end));
      current = end; quadraticControl = control; cubicControl = null; continue;
    }
    if (upper === 'A' && hasNumbers(7)) {
      read(); read(); read(); read(); read(); current = point(relative); points.push({ ...current }); continue;
    }
    tokenIndex += 1;
  }
  if (points.length) finish(false);
  return contours;
}
function ellipseContour(cx: number, cy: number, rx: number, ry: number): BareContour {
  return { closed: true, points: Array.from({ length: 48 }, (_, index) => {
    const angle = index / 48 * Math.PI * 2;
    return { x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry };
  }) };
}

export function parseSvgNativeContours(source: string): SvgNativeContour[] {
  const contours: SvgNativeContour[] = [];
  let nextGroup = 0;
  const classes = cssClassRules(source);
  type Context = { name: string; style: Record<string, string>; opacity: number; transform: SvgMatrix; hidden: boolean };
  const stack: Context[] = [{ name: 'root', style: {}, opacity: 1, transform: IDENTITY_MATRIX, hidden: false }];
  const shapeNames = new Set(['path', 'polygon', 'polyline', 'rect', 'circle', 'ellipse', 'line']);
  const hiddenNames = new Set(['defs', 'clippath', 'mask', 'symbol', 'pattern', 'lineargradient', 'radialgradient']);
  const tags = source.match(/<\/?[a-zA-Z][^>]*>/g) ?? [];
  for (const tag of tags) {
    const closing = /^<\//.test(tag);
    const name = tag.match(/^<\/?([a-zA-Z][\w:-]*)/)?.[1]?.toLowerCase();
    if (!name) continue;
    if (closing) {
      for (let index = stack.length - 1; index > 0; index -= 1) {
        const popped = stack.pop();
        if (popped?.name === name) break;
      }
      continue;
    }
    const attributes = attributesFromTag(tag);
    const parent = stack[stack.length - 1];
    const style = resolvedStyle(attributes, classes, parent.style);
    const opacity = parent.opacity * clamp(finite(attributes.opacity ?? cssDeclarations(attributes.style).opacity, 1), 0, 1);
    const transform = multiplyMatrix(parent.transform, parseTransform(attributes.transform));
    const hidden = parent.hidden || hiddenNames.has(name) || attributes.display === 'none' || attributes.visibility === 'hidden';
    let shapes: BareContour[] = [];
    if (name === 'path') shapes = parsePathContours(attributes.d ?? '');
    else if (name === 'polygon' || name === 'polyline') {
      const values = numberList(attributes.points);
      const points: SvgPoint[] = [];
      for (let index = 0; index + 1 < values.length; index += 2) points.push({ x: values[index], y: values[index + 1] });
      if (points.length >= 2) shapes = [{ points, closed: name === 'polygon' }];
    } else if (name === 'rect') {
      const x = finite(attributes.x, 0); const y = finite(attributes.y, 0);
      const width = Math.max(0, finite(attributes.width, 0)); const height = Math.max(0, finite(attributes.height, 0));
      if (width > 0 && height > 0) shapes = [{ closed: true, points: [
        { x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height },
      ] }];
    } else if (name === 'circle') {
      const r = Math.max(0, finite(attributes.r, 0));
      if (r > 0) shapes = [ellipseContour(finite(attributes.cx, 0), finite(attributes.cy, 0), r, r)];
    } else if (name === 'ellipse') {
      const rx = Math.max(0, finite(attributes.rx, 0)); const ry = Math.max(0, finite(attributes.ry, 0));
      if (rx > 0 && ry > 0) shapes = [ellipseContour(finite(attributes.cx, 0), finite(attributes.cy, 0), rx, ry)];
    } else if (name === 'line') shapes = [{ closed: false, points: [
      { x: finite(attributes.x1, 0), y: finite(attributes.y1, 0) },
      { x: finite(attributes.x2, 0), y: finite(attributes.y2, 0) },
    ] }];
    if (!hidden && shapeNames.has(name) && shapes.length) {
      const group = nextGroup;
      nextGroup += 1;
      for (const shape of shapes) contours.push({
        ...shape,
        points: shape.points.map((point) => transformPoint(point, transform)),
        ...styleForTag(attributes, classes, shape.closed, style, opacity),
        group,
      });
    }
    const selfClosing = /\/\s*>$/.test(tag);
    if (!selfClosing && !shapeNames.has(name) && !['style', 'stop'].includes(name)) stack.push({ name, style, opacity, transform, hidden });
  }
  return contours.filter((contour) => contour.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)));
}

function effectBits(content: SVGContent): number {
  const flags: Array<keyof SVGContent> = [
    'liquidEnabled', 'particlesEnabled', 'energyEnabled', 'connectionsEnabled', 'glowEnabled',
    'ripplesEnabled', 'lightningEnabled', 'edgeFlowEnabled', 'innerGlowEnabled', 'nebulaEnabled',
    'heartbeatEnabled', 'plasmaEnabled', 'particleLinksEnabled', 'echoEnabled', 'arcBridgesEnabled',
    'particleFillEnabled', 'organicWarpEnabled', 'growthEnabled', 'breatheEnabled',
  ];
  return flags.reduce((bits, key, index) => bits | (content[key] ? 1 << index : 0), 0);
}
function rotatePoint(x: number, y: number, z: number, rx: number, ry: number, rz: number): [number, number, number] {
  const cx = Math.cos(rx); const sx = Math.sin(rx); const cy = Math.cos(ry); const sy = Math.sin(ry);
  const cz = Math.cos(rz); const sz = Math.sin(rz);
  let py = y * cx - z * sx; let pz = y * sx + z * cx; let px = x;
  const px2 = px * cy + pz * sy; pz = -px * sy + pz * cy; px = px2;
  return [px * cz - py * sz, px * sz + py * cz, pz];
}
function setHeader(data: Float32Array, index: number, values: number[]) {
  data.set(values.map((value) => finite(value, 0)).slice(0, 4), index * 4);
}

let svgParseCacheSource = '';
let svgParseCacheContours: SvgNativeContour[] = [];
function cachedSvgContours(source: string): SvgNativeContour[] {
  if (source !== svgParseCacheSource) {
    svgParseCacheSource = source;
    svgParseCacheContours = parseSvgNativeContours(source);
  }
  return svgParseCacheContours;
}

function packedSvgData(options: SvgNativeGraphOptions): Float32Array {
  const width = Math.max(1, Math.round(options.width)); const height = Math.max(1, Math.round(options.height));
  const content = options.content; const parsed = cachedSvgContours(content.svgSource);
  const allPoints = parsed.flatMap((contour) => contour.points);
  const minX = allPoints.length ? Math.min(...allPoints.map((point) => point.x)) : 0;
  const minY = allPoints.length ? Math.min(...allPoints.map((point) => point.y)) : 0;
  const maxX = allPoints.length ? Math.max(...allPoints.map((point) => point.x)) : 1;
  const maxY = allPoints.length ? Math.max(...allPoints.map((point) => point.y)) : 1;
  const sourceWidth = Math.max(1e-4, maxX - minX); const sourceHeight = Math.max(1e-4, maxY - minY);
  const fitScale = Math.min(width / sourceWidth, height / sourceHeight) * 0.78 * clamp(finite(content.contentScale, 1), 0.05, 8);
  const centerX = (minX + maxX) * 0.5; const centerY = (minY + maxY) * 0.5;
  const offsetX = width * (0.5 + clamp(finite(content.panX, 0), -2, 2) * 0.5);
  const offsetY = height * (0.5 + clamp(finite(content.panY, 0), -2, 2) * 0.5);
  const time = finite(options.time, 0);
  const renderMode = RENDER_CODES[content.renderMode] ?? 0;
  const breathe = content.breatheEnabled
    ? 1 + Math.sin(time * finite(content.breatheSpeed, 1) * Math.PI * 2) * clamp(finite(content.breatheAmount, 0.08), 0, 0.5)
    : 1;
  const floatY = renderMode === 2 ? Math.sin(time * finite(content.floatSpeed, 0.8)) * finite(content.floatAmount, 0) : 0;
  const rx = (finite(content.rotateX, 0) * Math.PI / 180) + time * finite(content.rotateSpeedX, 0);
  const ry = (finite(content.rotateY, 0) * Math.PI / 180) + time * finite(content.rotateSpeedY, 0);
  const rz = (finite(content.rotateZ, 0) * Math.PI / 180) + time * finite(content.rotateSpeedZ, 0);
  const depth = renderMode === 2 ? clamp(finite(content.extrudeDepth, 24), 0, 160) : 0;
  const fov = clamp(finite(content.cameraFov, 45), 20, 90) * Math.PI / 180;
  const focal = height * 0.5 / Math.tan(fov * 0.5);
  const data = new Float32Array(TOTAL_VEC4S * 4);
  const metaBase = HEADER_VEC4S;
  const fillBase = metaBase + SVG_MAX_CONTOURS;
  const strokeBase = fillBase + SVG_MAX_CONTOURS;
  const styleBase = strokeBase + SVG_MAX_CONTOURS;
  const boundsBase = styleBase + SVG_MAX_CONTOURS;
  const pointBase = boundsBase + SVG_MAX_CONTOURS;
  let contourCount = 0; let pointCount = 0;
  const projected = (point: SvgPoint, z: number): SvgPoint => {
    const localX = (point.x - centerX) * fitScale * breathe;
    const localY = (point.y - centerY) * fitScale * breathe;
    if (renderMode !== 2) return { x: localX + offsetX, y: localY + offsetY };
    const [x, y, projectedZ] = rotatePoint(localX, localY, z, rx, ry, rz);
    const perspective = focal / Math.max(focal * 0.22, focal + projectedZ);
    return { x: x * perspective + offsetX, y: y * perspective + offsetY + floatY };
  };
  for (const contour of parsed) {
    if (contourCount >= SVG_MAX_CONTOURS || pointCount >= SVG_MAX_POINTS) break;
    const sourcePoints = contour.points.slice(0, SVG_MAX_POINTS - pointCount);
    if (sourcePoints.length < 2) continue;
    const start = pointCount;
    let bbMinX = Infinity; let bbMinY = Infinity; let bbMaxX = -Infinity; let bbMaxY = -Infinity;
    for (const raw of sourcePoints) {
      const front = projected(raw, depth * 0.5); const back = projected(raw, -depth * 0.5);
      data.set([front.x, front.y, back.x, back.y], (pointBase + pointCount) * 4);
      bbMinX = Math.min(bbMinX, front.x, back.x); bbMinY = Math.min(bbMinY, front.y, back.y);
      bbMaxX = Math.max(bbMaxX, front.x, back.x); bbMaxY = Math.max(bbMaxY, front.y, back.y);
      pointCount += 1;
    }
    const fill = contour.fill ?? [0, 0, 0, 0]; const stroke = contour.stroke ?? [0, 0, 0, 0];
    data.set([start, sourcePoints.length, contour.closed ? 1 : 0, contourCount / Math.max(1, parsed.length)], (metaBase + contourCount) * 4);
    data.set(fill, (fillBase + contourCount) * 4);
    data.set(stroke, (strokeBase + contourCount) * 4);
    data.set([contour.strokeWidth * fitScale, fill[3] > 0 ? 1 : 0, stroke[3] > 0 ? 1 : 0, contour.group], (styleBase + contourCount) * 4);
    // Padded bbox: distance-field effects (glow/echo/outline) reach beyond
    // the geometry; anything past the pad is culled per pixel.
    const reach = contour.strokeWidth * fitScale + 150;
    data.set([bbMinX - reach, bbMinY - reach, bbMaxX + reach, bbMaxY + reach], (boundsBase + contourCount) * 4);
    contourCount += 1;
  }

  setHeader(data, 0, [width, height, time, clamp(finite(options.frameDelta, 1 / 60), 0, 0.1)]);
  setHeader(data, 1, [contourCount, pointCount, FILL_CODES[content.fillMode] ?? 0, COLOR_CODES[content.colorMode] ?? 0]);
  setHeader(data, 2, [clamp(finite(content.outlineThickness, 2), 0, 32), (((finite(content.monochromeHue, 190) % 360) + 360) % 360) / 360, content.colorCycleEnabled ? 1 : 0, clamp(finite(content.colorCycleSpeed, 0.15), 0, 4)]);
  setHeader(data, 3, [clamp(finite(content.colorCycleSaturation, 0.85), 0, 1), clamp(finite(content.colorCycleLightness, 0.55), 0.05, 1), finite(content.gradientAngle, 0) * Math.PI / 180, clamp(finite(content.gradientSpread, 0.4), 0.02, 2)]);
  setHeader(data, 4, [finite(content.shimmerSpeed, 5), finite(content.shimmerScale, 0.08), finite(content.shimmerIntensity, 0.6), finite(content.pulseSpeed, 2)]);
  setHeader(data, 5, [finite(content.noiseScale, 0.03), finite(content.noiseSpeed, 0.5), finite(content.noiseContrast, 0.5), finite(content.innerGlowIntensity, 0.4)]);
  setHeader(data, 6, [renderMode, depth, fov, content.bevelEnabled ? finite(content.bevelSize, 2) : 0]);
  setHeader(data, 7, [MATERIAL_CODES[content.materialPreset] ?? 0, finite(content.materialMetalness, 0.4), finite(content.materialRoughness, 0.2), finite(content.iridescence, 0.8)]);
  setHeader(data, 8, [finite(content.glassTransmission, 0.9), finite(content.envIntensity, 1), LIGHT_CODES[content.lightPreset] ?? 0, finite(content.lightIntensity, 1)]);
  setHeader(data, 9, [effectBits(content), finite(content.bloomStrength, 0), finite(content.bloomThreshold, 0.25), finite(content.chromatic, 0)]);
  setHeader(data, 10, [finite(content.vignette, 0), finite(content.liquidSpeed, 0.4), finite(content.liquidWaveAmp, 0.08), finite(content.edgeFlowSpeed, 1.5)]);
  setHeader(data, 11, [finite(content.particleSpeed, 80), finite(content.particleSize, 2.5), finite(content.energySpeed, 150), finite(content.energySize, 1)]);
  setHeader(data, 12, [finite(content.glowPulseSpeed, 2), finite(content.glowSize, 1), finite(content.glowIntensity, 0.8), finite(content.rippleSpeed, 1)]);
  setHeader(data, 13, [finite(content.rippleSize, 1), finite(content.rippleOpacity, 0.5), finite(content.plasmaIntensity, 0.8), finite(content.plasmaSpeed, 2)]);
  setHeader(data, 14, [finite(content.warpAmount, 0), finite(content.warpSpeed, 1), finite(content.heartbeatSpeed, 1), finite(content.heartbeatIntensity, 0.3)]);
  setHeader(data, 15, [finite(content.fluidScale, 2), finite(content.fluidSpeed, 1), finite(content.fluidTurbulence, 0.8), finite(content.particleFillDensity, 200)]);
  setHeader(data, 16, [finite(content.echoLayers, 3), finite(content.echoSpacing, 8), finite(content.echoOpacity, 0.25), finite(content.growthSpeed, 0.6)]);
  setHeader(data, 17, [finite(content.lightningFrequency, 1.5), finite(content.lightningThickness, 3), finite(content.nebulaIntensity, 0.3), finite(content.nebulaSpeed, 0.2)]);
  /* Raster path: pan/scale are applied to UVs in the shader rather than baked
     into the raster, so dragging those sliders never forces a re-upload. */
  setHeader(data, 18, [
    options.rasterReady ? 1 : 0,
    clamp(finite(content.panX, 0), -2, 2),
    clamp(finite(content.panY, 0), -2, 2),
    clamp(finite(content.contentScale, 1), 0.05, 8),
  ]);
  return data;
}

export function buildSvgNativeComputeGraph(options: SvgNativeGraphOptions) {
  const data = packedSvgData(options);
  const sourceId = String(options.sourceId || 'svg-native-source');
  const safeSourceId = sourceId.replace(/[^a-zA-Z0-9:_-]+/g, '_');
  const uniformId = `svg:${safeSourceId}:uniform`;
  return {
    state: null as null,
    config: {
      buffers: [{ id: uniformId, kind: 'uniform', byte_length: SVG_UNIFORM_BYTES, initial_f32: Array.from(data) }],
      passes: [],
      render_passes: [{
        name: 'svg-render-v3', shader_id: SVG_NATIVE_SHADER_ID, vertex_entry: 'vs_full', fragment_entry: 'fs_svg',
        target: 'source_frame', source_id: sourceId, seq: Math.max(0, Math.round(options.frameIndex ?? 0)),
        clear: true, clear_color: [0, 0, 0, 0], include_snapshot: !!options.includeSnapshot,
        blend: 'replace', primitive: 'triangle-list', vertex_count: 3, instance_count: 1,
        bindings: [
          { binding: 0, resource: uniformId, kind: 'uniform' },
          // allow_missing: before the first raster upload the core binds its
          // empty frame, and h18.x keeps the shader off the raster path.
          options.rasterSourceId && options.rasterReady
            ? { binding: 1, kind: 'source-frame-texture', source_id: options.rasterSourceId }
            : { binding: 1, kind: 'source-frame-texture', allow_missing: true },
          { binding: 2, kind: 'source-frame-sampler' },
        ],
      }],
      readbacks: [],
    }, sourceId, passCount: 1,
  };
}
export function getSvgNativeShaderSource() {
  return { shaderId: SVG_NATIVE_SHADER_ID, stage: 'render' as const, entry: 'fs_svg', source: SVG_NATIVE_WGSL };
}
export function buildSvgNativePrecompileCommands() {
  const shader = getSvgNativeShaderSource();
  return [{ type: 'precompile_shader' as const, shader_id: shader.shaderId, stage: shader.stage, entry: shader.entry, source: shader.source }];
}

export const SVG_NATIVE_WGSL = /* wgsl */`
struct SvgData {
  h0: vec4<f32>, h1: vec4<f32>, h2: vec4<f32>, h3: vec4<f32>, h4: vec4<f32>, h5: vec4<f32>,
  h6: vec4<f32>, h7: vec4<f32>, h8: vec4<f32>, h9: vec4<f32>, h10: vec4<f32>, h11: vec4<f32>,
  h12: vec4<f32>, h13: vec4<f32>, h14: vec4<f32>, h15: vec4<f32>, h16: vec4<f32>, h17: vec4<f32>,
  h18: vec4<f32>,
  contours: array<vec4<f32>, ${SVG_MAX_CONTOURS}>,
  fills: array<vec4<f32>, ${SVG_MAX_CONTOURS}>,
  strokes: array<vec4<f32>, ${SVG_MAX_CONTOURS}>,
  styles: array<vec4<f32>, ${SVG_MAX_CONTOURS}>,
  bounds: array<vec4<f32>, ${SVG_MAX_CONTOURS}>,
  points: array<vec4<f32>, ${SVG_MAX_POINTS}>,
}
@group(0) @binding(0) var<uniform> svg: SvgData;
@group(0) @binding(1) var raster_tex: texture_2d<f32>;
@group(0) @binding(2) var raster_samp: sampler;
struct VertexOutput { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> }
@vertex fn vs_full(@builtin(vertex_index) i: u32) -> VertexOutput {
  let x = f32((i << 1u) & 2u); let y = f32(i & 2u); var o: VertexOutput;
  o.position = vec4<f32>(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0); o.uv = vec2<f32>(x, y); return o;
}
fn hash2(p: vec2<f32>) -> f32 { return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453); }
fn noise2(p: vec2<f32>) -> f32 {
  let i = floor(p); let f = fract(p); let u = f*f*(3.0-2.0*f);
  return mix(mix(hash2(i), hash2(i+vec2<f32>(1.0,0.0)), u.x), mix(hash2(i+vec2<f32>(0.0,1.0)), hash2(i+vec2<f32>(1.0,1.0)), u.x), u.y);
}
fn hsv(h: f32, s: f32, v: f32) -> vec3<f32> {
  let q = fract(vec3<f32>(h)+vec3<f32>(0.0,0.6666667,0.3333333));
  return v * mix(vec3<f32>(1.0), clamp(abs(q*6.0-3.0)-1.0, vec3<f32>(0.0), vec3<f32>(1.0)), s);
}
fn seg_dist(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>) -> f32 {
  let d=b-a; let t=clamp(dot(p-a,d)/max(dot(d,d),0.0001),0.0,1.0); return distance(p,a+d*t);
}
fn cross2(a: vec2<f32>, b: vec2<f32>) -> f32 { return a.x*b.y-a.y*b.x; }
fn fmod(a: f32, b: f32) -> f32 { return a-b*floor(a/b); }
fn in_tri(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>, c: vec2<f32>) -> bool {
  let d1=cross2(b-a,p-a); let d2=cross2(c-b,p-b); let d3=cross2(a-c,p-c);
  return !((d1<0.0||d2<0.0||d3<0.0)&&(d1>0.0||d2>0.0||d3>0.0));
}
fn bit_on(bits: u32, index: u32) -> bool { return (bits & (1u << index)) != 0u; }
fn generated_color(ci: i32, p: vec2<f32>) -> vec3<f32> {
  let cycle=svg.h2.z*svg.h0.z*svg.h2.w; let mode=i32(svg.h1.w+0.5); var h=fract(svg.h2.y+svg.contours[ci].w+cycle);
  if(mode==1){h=fract(p.x/svg.h0.x+p.y/svg.h0.y*0.35+cycle);} else if(mode==2){h=fract(svg.h2.y+cycle);}
  else if(mode==3){h=fract(svg.h2.y+f32(ci%2)*0.5+cycle);} else if(mode==4){h=fract(svg.h2.y+svg.contours[ci].w*0.16+cycle);} else if(mode==5){return vec3<f32>(1.0);}
  return hsv(h,svg.h3.x,svg.h3.y);
}
fn material_face_color(ci: i32, p: vec2<f32>, resolution: vec2<f32>, time: f32, face_light: f32) -> vec3<f32> {
  let material=i32(svg.h7.x+0.5); var c=generated_color(ci,p)*face_light;
  if(material==0){c=hsv(fract(p.y/resolution.y+time*0.05),0.8,0.7)*face_light;}
  else if(material==1){c=vec3<f32>(0.25+0.65*abs(sin(p.y*0.025)))*face_light;}
  else if(material==2){c=(generated_color(ci,p)*0.35+vec3<f32>(0.1,0.22,0.3))*face_light;}
  else if(material==3){c=generated_color(ci,p)*0.8*face_light;}
  return c;
}
@fragment fn fs_svg(input: VertexOutput) -> @location(0) vec4<f32> {
  let resolution=max(svg.h0.xy,vec2<f32>(1.0)); var p=input.uv*resolution; let time=svg.h0.z;
  let render_mode=i32(svg.h6.x+0.5); let bits=u32(svg.h9.x+0.5);
  // Authored mode: sample the Chromium raster. Pan/scale on UVs; premultiplied
  // output to match the contour path below. This is the whole fidelity story —
  // gradients, arcs, text and masks are Chromium's, not a reconstruction.
  if(render_mode==0 && svg.h18.x>0.5){
    let uv=(input.uv-vec2<f32>(svg.h18.y,svg.h18.z)*0.5-0.5)/max(svg.h18.w,0.05)+0.5;
    if(uv.x<0.0||uv.y<0.0||uv.x>1.0||uv.y>1.0){ return vec4<f32>(0.0); }
    let texel=textureSampleLevel(raster_tex,raster_samp,uv,0.0);
    return vec4<f32>(texel.rgb*texel.a,texel.a);
  }
  if(bit_on(bits,16u)){ let n=noise2(p*0.008+vec2<f32>(time*svg.h14.y,-time*svg.h14.y)); p += (n-0.5)*svg.h14.x; }
  if(bit_on(bits,0u)){ p.x += sin(p.y*0.025+time*svg.h10.y*4.0)*svg.h10.z*60.0; }
  var front_rgb=vec3<f32>(0.0); var front_a=0.0; var nearest=100000.0; var nearest_ci=0;
  var front_any=false; var back_any=false; var side_any=false; var back_ci=0; var side_ci=0;
  var stroke_rgb=vec3<f32>(0.0); var stroke_a=0.0;
  // Even-odd parity accumulates ACROSS the subpaths of one shape element so
  // inner contours punch holes (letter counters, donut logos) instead of
  // painting on top.
  var group_id=-1.0; var group_front=false; var group_back=false; var group_ci=0;
  let count=min(i32(svg.h1.x+0.5),${SVG_MAX_CONTOURS});
  let aa_px=1.25;
  for(var ci=0;ci<${SVG_MAX_CONTOURS};ci+=1){
    if(ci>=count){break;} let contour_info=svg.contours[ci]; let start=i32(contour_info.x+0.5); let n=i32(contour_info.y+0.5);
    let this_group=svg.styles[ci].w;
    if(this_group!=group_id){
      // Flush the previous shape element's fill.
      if(group_front){
        front_any=true; let source=svg.fills[group_ci]; var c=source.rgb; var alpha=source.a;
        if(render_mode!=0){c=generated_color(group_ci,p);alpha=1.0;}
        front_rgb=mix(front_rgb,c,alpha); front_a=alpha+front_a*(1.0-alpha);
      }
      if(render_mode==2 && group_back){back_any=true;back_ci=group_ci;}
      group_id=this_group; group_front=false; group_back=false; group_ci=ci;
    }
    // Padded-bbox cull: pixels beyond a contour's reach skip its segment
    // loop entirely (fill parity outside the bbox is provably zero).
    let bb=svg.bounds[ci];
    if(p.x<bb.x||p.y<bb.y||p.x>bb.z||p.y>bb.w){continue;}
    var front_inside=false; var back_inside=false; var contour_d=100000.0;
    for(var j=0;j<${SVG_MAX_POINTS};j+=1){
      if(j>=n){break;}
      // Open paths must not acquire a synthetic closing segment.
      if(j==n-1 && contour_info.z<0.5){continue;}
      let next=select(j+1,0,j==n-1); if(next>=n){continue;}
      let a=svg.points[start+j]; let b=svg.points[start+next];
      let d=seg_dist(p,a.xy,b.xy); if(d<nearest){nearest=d;nearest_ci=ci;} contour_d=min(contour_d,d);
      if(render_mode==2){
        let back_d=seg_dist(p,a.zw,b.zw); if(back_d<nearest){nearest=back_d;nearest_ci=ci;} contour_d=min(contour_d,back_d);
      }
      if(contour_info.z>0.5 && ((a.y>p.y)!=(b.y>p.y))){ let ix=(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x; if(p.x<ix){front_inside=!front_inside;} }
      if(render_mode==2 && contour_info.z>0.5 && ((a.w>p.y)!=(b.w>p.y))){ let ix=(b.z-a.z)*(p.y-a.w)/(b.w-a.w)+a.z; if(p.x<ix){back_inside=!back_inside;} }
      if(render_mode==2 && (in_tri(p,a.xy,b.xy,b.zw)||in_tri(p,a.xy,b.zw,a.zw))){side_any=true;side_ci=ci;}
    }
    if(front_inside){group_front=!group_front;}
    if(back_inside){group_back=!group_back;}
    // Authored strokes composite per contour with their OWN distance so a
    // shape never wears its neighbour's stroke colour.
    if(render_mode==0 && svg.styles[ci].z>0.5){
      let authored=svg.strokes[ci]; let half_w=max(svg.styles[ci].x*0.5,0.5);
      let cov=(1.0-smoothstep(half_w-aa_px,half_w+aa_px,contour_d))*authored.a;
      if(cov>0.001){
        stroke_rgb=mix(stroke_rgb,authored.rgb,cov);
        stroke_a=cov+stroke_a*(1.0-cov);
      }
    }
  }
  // Flush the final group.
  if(group_front){
    front_any=true; let source=svg.fills[group_ci]; var c=source.rgb; var alpha=source.a;
    if(render_mode!=0){c=generated_color(group_ci,p);alpha=1.0;}
    front_rgb=mix(front_rgb,c,alpha); front_a=alpha+front_a*(1.0-alpha);
  }
  if(render_mode==2 && group_back){back_any=true;back_ci=group_ci;}
  var color=vec3<f32>(0.0); var alpha=0.0;
  if(render_mode==2 && back_any){color=material_face_color(back_ci,p,resolution,time,0.48);alpha=1.0;}
  if(render_mode==2 && side_any){
    let material=i32(svg.h7.x+0.5); let side_alpha=select(1.0-svg.h8.x*0.45,1.0,material!=2);
    let side_color=material_face_color(side_ci,p,resolution,time,0.72);
    color=mix(color,side_color,side_alpha);alpha=side_alpha+alpha*(1.0-side_alpha);
  }
  if(front_a>0.0){color=mix(color,front_rgb,front_a);alpha=front_a+alpha*(1.0-front_a);}
  if(render_mode==1 && front_any){alpha=1.0;}
  let inside_any=front_any||back_any||side_any;
  let aa=max(fwidth(nearest),0.8); var edge=1.0-smoothstep(svg.h2.x,svg.h2.x+aa,nearest);
  if(render_mode==0){
    color=mix(color,stroke_rgb,stroke_a); alpha=stroke_a+alpha*(1.0-stroke_a); edge=stroke_a;
  } else { color=mix(color,min(color*1.8,vec3<f32>(1.0)),edge); alpha=max(alpha,edge); }
  let fill_mode=i32(svg.h1.z+0.5);
  if(alpha>0.0 && render_mode!=0){
    if(fill_mode==1){let dir=vec2<f32>(cos(svg.h3.z),sin(svg.h3.z));color*=mix(0.4,1.35,0.5+0.5*sin(dot(p/resolution,dir)*6.283/max(svg.h3.w,0.02)));}
    else if(fill_mode==2){color+=pow(max(0.0,sin((p.x+p.y)*svg.h4.y+time*svg.h4.x)),8.0)*svg.h4.z;}
    else if(fill_mode==3){alpha*=0.6+0.4*sin(time*svg.h4.w+length(p-resolution*0.5)*0.035);}
    else if(fill_mode==4||fill_mode==5||fill_mode==7||fill_mode==8){let n=noise2(p*svg.h5.x+vec2<f32>(time*svg.h5.y,-time*svg.h5.y));color*=mix(0.35,1.5,mix(n,smoothstep(0.25,0.75,n),svg.h5.z));}
    else if(fill_mode==6||bit_on(bits,15u)){let cell=fract(p*max(0.02,sqrt(svg.h15.w)*0.002));alpha*=1.0-smoothstep(0.08,0.24,length(cell-0.5));}
  }
  if(bit_on(bits,10u)){let beat=pow(max(0.0,sin(time*svg.h14.z*6.283)),8.0)*svg.h14.w;color*=1.0+beat;}
  if(bit_on(bits,11u)&&alpha>0.0){color+=hsv(fract(time*svg.h13.w*0.07+p.x/resolution.x),0.9,1.0)*svg.h13.z*(0.5+0.5*sin(p.y*0.04+time*svg.h13.w));}
  if(bit_on(bits,7u)){let flow=pow(max(0.0,sin(nearest*0.35-time*svg.h10.w*6.0)),10.0);color+=generated_color(nearest_ci,p)*flow*edge*2.0;alpha=max(alpha,flow*edge);}
  if(bit_on(bits,8u)&&inside_any){color+=generated_color(nearest_ci,p)*exp(-nearest*0.08)*svg.h5.w;}
  if(bit_on(bits,4u)){let glow=exp(-nearest/max(2.0,svg.h12.y*14.0))*svg.h12.z*(0.7+0.3*sin(time*svg.h12.x));color+=generated_color(nearest_ci,p)*glow;alpha=max(alpha,glow*0.7);}
  if(bit_on(bits,5u)){let rings=pow(max(0.0,sin(nearest/max(1.0,svg.h13.x)*0.4-time*svg.h12.w*5.0)),12.0)*svg.h13.y;color+=generated_color(nearest_ci,p)*rings;alpha=max(alpha,rings);}
  if(bit_on(bits,1u)||bit_on(bits,12u)){let cell=floor(p/max(5.0,svg.h11.y*6.0));let dot=step(0.86,hash2(cell+floor(time*svg.h11.x*0.03)));color+=generated_color(nearest_ci,p)*dot*exp(-nearest*0.045);alpha=max(alpha,dot*exp(-nearest*0.06));}
  if(bit_on(bits,2u)){let pulse=pow(max(0.0,sin(nearest*0.08-time*svg.h11.z*0.025)),18.0)*svg.h11.w;color+=vec3<f32>(pulse);alpha=max(alpha,pulse);}
  let envelope=exp(-nearest*0.012);
  if(bit_on(bits,6u)){let strike=step(0.985,hash2(vec2<f32>(floor(time*svg.h17.x*8.0),floor(p.y*0.02))));let line=exp(-abs(p.x-resolution.x*(0.5+0.36*sin(p.y*0.025+time*4.0)))/max(1.0,svg.h17.y))*envelope;color+=vec3<f32>(0.7,0.85,1.0)*strike*line;alpha=max(alpha,strike*line);}
  if(bit_on(bits,9u)){let neb=noise2(p*0.006+time*svg.h17.w)*svg.h17.z*envelope;color+=hsv(fract(p.x/resolution.x+time*0.03),0.7,neb);alpha=max(alpha,neb*0.35);}
  if(bit_on(bits,13u)){let echo=exp(-abs(nearest-svg.h16.y*(1.0+floor(fmod(time*2.0,max(1.0,svg.h16.x)))))*0.12)*svg.h16.z;color+=generated_color(nearest_ci,p)*echo;alpha=max(alpha,echo);}
  if(bit_on(bits,3u)||bit_on(bits,14u)){let bridge=pow(max(0.0,sin((p.x+p.y)*0.025-time*3.0)),22.0)*exp(-nearest*0.02);color+=generated_color(nearest_ci,p)*bridge*0.6;alpha=max(alpha,bridge*0.35);}
  if(bit_on(bits,17u)&&alpha>0.0){
    let progress=clamp(p.x/resolution.x,0.0,1.0);let sweep=fract(time*max(0.05,svg.h16.w)*0.15);
    let reveal=1.0-smoothstep(sweep,min(1.0,sweep+0.06),progress);let head=1.0-smoothstep(0.0,0.035,abs(progress-sweep));
    alpha*=reveal;color=color*reveal+generated_color(nearest_ci,p)*head*1.5;
  }
  let bloom=max(0.0,svg.h9.y)*(1.0-smoothstep(svg.h9.z,1.0,max(color.r,max(color.g,color.b))));color+=color*bloom;
  let vig=1.0-svg.h10.x*smoothstep(0.25,0.72,distance(input.uv,vec2<f32>(0.5)));color*=vig;
  return vec4<f32>(color*clamp(alpha,0.0,1.0),clamp(alpha,0.0,1.0));
}
`;
