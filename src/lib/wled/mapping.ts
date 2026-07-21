import type {
  WLEDColorCalibration,
  WLEDColorSamplingMode,
  WLEDMappingConfig,
  WLEDNormalizedPoint,
  WLEDSourceRegion,
  WLEDTestPattern,
} from '../types';
import { computeWLEDSamplingGrid } from './sampling';

const MAX_LED_COUNT = 490;

export interface ResolvedWLEDMapping {
  mode: 'auto-grid' | 'strip' | 'matrix' | 'custom';
  axis: 'horizontal' | 'vertical';
  columns: number;
  serpentine: boolean;
  reverse: boolean;
  flipX: boolean;
  flipY: boolean;
  sourceRegion: WLEDSourceRegion;
  points: WLEDNormalizedPoint[];
  sampleRadius: number;
}

export interface WLEDPixelOptions {
  brightness?: number;
  gamma?: number;
  calibration?: WLEDColorCalibration;
}

function clamp(value: number, min = 0, max = 1): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function sanitizeWLEDCount(ledCount: number): number {
  return Math.max(1, Math.min(MAX_LED_COUNT, Math.floor(ledCount) || 1));
}

export function createDefaultWLEDMapping(): WLEDMappingConfig {
  return {
    mode: 'auto-grid',
    axis: 'horizontal',
    columns: 8,
    serpentine: false,
    reverse: false,
    flipX: false,
    flipY: false,
    sourceRegion: { x: 0, y: 0, width: 1, height: 1 },
    sampleRadius: 0.015,
  };
}

export function resolveWLEDSourceRegion(region?: Partial<WLEDSourceRegion>): WLEDSourceRegion {
  const x = clamp(region?.x ?? 0, 0, 0.99);
  const y = clamp(region?.y ?? 0, 0, 0.99);
  const width = clamp(region?.width ?? 1, 0.01, Math.max(0.01, 1 - x));
  const height = clamp(region?.height ?? 1, 0.01, Math.max(0.01, 1 - y));
  return { x, y, width, height };
}

function sanitizePoint(point: Partial<WLEDNormalizedPoint> | undefined): WLEDNormalizedPoint {
  return {
    x: clamp(point?.x ?? 0.5),
    y: clamp(point?.y ?? 0.5),
  };
}

function gridPoints(
  count: number,
  columns: number,
  axis: 'horizontal' | 'vertical',
  serpentine: boolean
): WLEDNormalizedPoint[] {
  const safeColumns = Math.max(1, Math.min(count, Math.floor(columns) || 1));
  const rows = Math.max(1, Math.ceil(count / safeColumns));
  const result: WLEDNormalizedPoint[] = [];

  for (let index = 0; index < count; index += 1) {
    let column: number;
    let row: number;
    if (axis === 'vertical') {
      column = Math.floor(index / rows);
      row = index % rows;
      if (serpentine && column % 2 === 1) row = rows - 1 - row;
    } else {
      row = Math.floor(index / safeColumns);
      column = index % safeColumns;
      if (serpentine && row % 2 === 1) column = safeColumns - 1 - column;
    }
    result.push({
      x: (column + 0.5) / safeColumns,
      y: (row + 0.5) / rows,
    });
  }
  return result;
}

export function buildWLEDBasePoints(
  ledCount: number,
  mapping: Partial<WLEDMappingConfig> | undefined,
  sourceAspect = 16 / 9
): WLEDNormalizedPoint[] {
  const count = sanitizeWLEDCount(ledCount);
  const mode = mapping?.mode ?? 'auto-grid';
  const axis = mapping?.axis ?? 'horizontal';

  if (mode === 'strip') {
    if (count === 1) return [{ x: 0.5, y: 0.5 }];
    return Array.from({ length: count }, (_, index) => {
      const position = index / (count - 1);
      return axis === 'vertical'
        ? { x: 0.5, y: position }
        : { x: position, y: 0.5 };
    });
  }

  if (mode === 'custom') {
    const fallbackGrid = computeWLEDSamplingGrid(count, sourceAspect);
    const fallback = gridPoints(count, fallbackGrid.columns, 'horizontal', false);
    return Array.from({ length: count }, (_, index) =>
      sanitizePoint(mapping?.points?.[index] ?? fallback[index])
    );
  }

  const columns = mode === 'matrix'
    ? Math.max(1, Math.min(count, Math.floor(mapping?.columns ?? 8) || 1))
    : computeWLEDSamplingGrid(count, sourceAspect).columns;
  return gridPoints(count, columns, axis, mapping?.serpentine ?? false);
}

export function resolveWLEDMapping(
  ledCount: number,
  mapping: Partial<WLEDMappingConfig> | undefined,
  sourceAspect = 16 / 9
): ResolvedWLEDMapping {
  const count = sanitizeWLEDCount(ledCount);
  const mode = mapping?.mode ?? 'auto-grid';
  const axis = mapping?.axis ?? 'horizontal';
  const region = resolveWLEDSourceRegion(mapping?.sourceRegion);
  let points = buildWLEDBasePoints(count, mapping, sourceAspect);

  if (mapping?.flipX) points = points.map(point => ({ ...point, x: 1 - point.x }));
  if (mapping?.flipY) points = points.map(point => ({ ...point, y: 1 - point.y }));
  if (mapping?.reverse) points = [...points].reverse();

  points = points.map(point => ({
    x: clamp(region.x + point.x * region.width),
    y: clamp(region.y + point.y * region.height),
  }));

  return {
    mode,
    axis,
    columns: Math.max(1, Math.min(count, Math.floor(mapping?.columns ?? 8) || 1)),
    serpentine: mapping?.serpentine ?? false,
    reverse: mapping?.reverse ?? false,
    flipX: mapping?.flipX ?? false,
    flipY: mapping?.flipY ?? false,
    sourceRegion: region,
    points,
    sampleRadius: clamp(mapping?.sampleRadius ?? 0.015, 0, 0.12),
  };
}

function gammaCorrect(value: number, gamma: number): number {
  if (gamma === 1 || gamma <= 0) return value;
  return Math.pow(clamp(value / 255), gamma) * 255;
}

export function srgbByteToLinear(value: number): number {
  const encoded = clamp(value / 255);
  return encoded <= 0.04045
    ? encoded / 12.92
    : Math.pow((encoded + 0.055) / 1.055, 2.4);
}

export function linearToSrgbByte(value: number): number {
  const linear = clamp(value);
  const encoded = linear <= 0.0031308
    ? linear * 12.92
    : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055;
  return clamp(encoded) * 255;
}

function rgbToHsv(red: number, green: number, blue: number): [number, number, number] {
  const r = clamp(red / 255);
  const g = clamp(green / 255);
  const b = clamp(blue / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;
  if (delta > 0) {
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue = ((hue / 6) + 1) % 1;
  }
  return [hue, max <= 0 ? 0 : delta / max, max];
}

function matrix3(calibration: WLEDColorCalibration): number[] {
  const matrix = calibration.colorMatrix;
  if (!matrix || matrix.length !== 9 || matrix.some(value => !Number.isFinite(value))) {
    return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  }
  return matrix;
}

function applyColorCalibration(
  red: number,
  green: number,
  blue: number,
  options: WLEDPixelOptions,
  previous: Uint8Array | undefined,
  offset: number
): [number, number, number] {
  const calibration = options.calibration ?? {};
  const saturation = clamp(calibration.saturation ?? 1, 0, 2);
  let linearRed = srgbByteToLinear(red);
  let linearGreen = srgbByteToLinear(green);
  let linearBlue = srgbByteToLinear(blue);
  const sourceLuma = linearRed * 0.2126 + linearGreen * 0.7152 + linearBlue * 0.0722;
  linearRed = sourceLuma + (linearRed - sourceLuma) * saturation;
  linearGreen = sourceLuma + (linearGreen - sourceLuma) * saturation;
  linearBlue = sourceLuma + (linearBlue - sourceLuma) * saturation;

  const matrix = matrix3(calibration);
  const matrixRed = linearRed * matrix[0] + linearGreen * matrix[1] + linearBlue * matrix[2];
  const matrixGreen = linearRed * matrix[3] + linearGreen * matrix[4] + linearBlue * matrix[5];
  const matrixBlue = linearRed * matrix[6] + linearGreen * matrix[7] + linearBlue * matrix[8];
  let r = matrixRed * clamp(calibration.redGain ?? 1, 0, 2);
  let g = matrixGreen * clamp(calibration.greenGain ?? 1, 0, 2);
  let b = matrixBlue * clamp(calibration.blueGain ?? 1, 0, 2);

  const threshold = clamp(calibration.blackThreshold ?? 0, 0, 0.5);
  if (sourceLuma < threshold) r = g = b = 0;

  const brightness = clamp(options.brightness ?? 1);
  const gamma = clamp(options.gamma ?? 1, 0.5, 3);
  r = gammaCorrect(linearToSrgbByte(r * brightness), gamma);
  g = gammaCorrect(linearToSrgbByte(g * brightness), gamma);
  b = gammaCorrect(linearToSrgbByte(b * brightness), gamma);

  const smoothing = clamp(calibration.smoothing ?? 0, 0, 0.95);
  if (previous && previous.length > offset + 2 && smoothing > 0) {
    r = previous[offset] * smoothing + r * (1 - smoothing);
    g = previous[offset + 1] * smoothing + g * (1 - smoothing);
    b = previous[offset + 2] * smoothing + b * (1 - smoothing);
  }
  return [r, g, b];
}

interface SampleAccumulator {
  linearRed: number;
  linearGreen: number;
  linearBlue: number;
  samples: number;
  dominantRed: number[];
  dominantGreen: number[];
  dominantBlue: number[];
  dominantWeight: number[];
  highlight: [number, number, number];
  highlightScore: number;
}

function createAccumulator(): SampleAccumulator {
  return {
    linearRed: 0,
    linearGreen: 0,
    linearBlue: 0,
    samples: 0,
    dominantRed: Array(12).fill(0),
    dominantGreen: Array(12).fill(0),
    dominantBlue: Array(12).fill(0),
    dominantWeight: Array(12).fill(0),
    highlight: [0, 0, 0],
    highlightScore: -1,
  };
}

function addSample(accumulator: SampleAccumulator, red: number, green: number, blue: number) {
  const linearRed = srgbByteToLinear(red);
  const linearGreen = srgbByteToLinear(green);
  const linearBlue = srgbByteToLinear(blue);
  accumulator.linearRed += linearRed;
  accumulator.linearGreen += linearGreen;
  accumulator.linearBlue += linearBlue;
  accumulator.samples += 1;

  const [hue, saturation, value] = rgbToHsv(red, green, blue);
  const hueBin = Math.min(11, Math.floor(hue * 12));
  const chromaWeight = Math.max(0.015, saturation * (0.25 + value * 0.75));
  accumulator.dominantRed[hueBin] += linearRed * chromaWeight;
  accumulator.dominantGreen[hueBin] += linearGreen * chromaWeight;
  accumulator.dominantBlue[hueBin] += linearBlue * chromaWeight;
  accumulator.dominantWeight[hueBin] += chromaWeight;

  const luma = linearRed * 0.2126 + linearGreen * 0.7152 + linearBlue * 0.0722;
  const highlightScore = luma * (0.35 + saturation * 0.65);
  if (highlightScore > accumulator.highlightScore) {
    accumulator.highlightScore = highlightScore;
    accumulator.highlight = [linearRed, linearGreen, linearBlue];
  }
}

function resolveSample(
  accumulator: SampleAccumulator,
  mode: WLEDColorSamplingMode,
  exact: [number, number, number]
): [number, number, number] {
  if (mode === 'exact') return exact;
  const count = Math.max(1, accumulator.samples);
  const average: [number, number, number] = [
    accumulator.linearRed / count,
    accumulator.linearGreen / count,
    accumulator.linearBlue / count,
  ];
  if (mode === 'average') return average;
  if (mode === 'highlight') return accumulator.highlight;

  let dominantBin = 0;
  for (let index = 1; index < accumulator.dominantWeight.length; index += 1) {
    if (accumulator.dominantWeight[index] > accumulator.dominantWeight[dominantBin]) {
      dominantBin = index;
    }
  }
  const weight = Math.max(0.0001, accumulator.dominantWeight[dominantBin]);
  const dominant: [number, number, number] = [
    accumulator.dominantRed[dominantBin] / weight,
    accumulator.dominantGreen[dominantBin] / weight,
    accumulator.dominantBlue[dominantBin] / weight,
  ];
  if (mode === 'dominant' || mode === 'palette') return dominant;

  const averageLuma = average[0] * 0.2126 + average[1] * 0.7152 + average[2] * 0.0722;
  const dominantLuma = Math.max(0.0001, dominant[0] * 0.2126 + dominant[1] * 0.7152 + dominant[2] * 0.0722);
  const scale = averageLuma / dominantLuma;
  return [dominant[0] * scale, dominant[1] * scale, dominant[2] * scale];
}

/** Sample arbitrary normalized points into uncalibrated sRGB bytes. */
export function sampleWLEDSourcePixels(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  points: WLEDNormalizedPoint[],
  sampleRadius: number,
  output: Uint8Array,
  mode: WLEDColorSamplingMode = 'average'
): Uint8Array {
  const safeWidth = Math.max(1, Math.floor(width));
  const safeHeight = Math.max(1, Math.floor(height));
  const radius = Math.max(0, Math.round(clamp(sampleRadius, 0, 0.12) * Math.min(safeWidth, safeHeight)));

  for (let ledIndex = 0; ledIndex < points.length && ledIndex * 3 + 2 < output.length; ledIndex += 1) {
    const point = points[ledIndex];
    const centerX = Math.round(clamp(point.x) * (safeWidth - 1));
    const centerY = Math.round(clamp(point.y) * (safeHeight - 1));
    const centerOffset = (centerY * safeWidth + centerX) * 4;
    const exact: [number, number, number] = [
      srgbByteToLinear(rgba[centerOffset] ?? 0),
      srgbByteToLinear(rgba[centerOffset + 1] ?? 0),
      srgbByteToLinear(rgba[centerOffset + 2] ?? 0),
    ];
    const accumulator = createAccumulator();

    for (let y = Math.max(0, centerY - radius); y <= Math.min(safeHeight - 1, centerY + radius); y += 1) {
      for (let x = Math.max(0, centerX - radius); x <= Math.min(safeWidth - 1, centerX + radius); x += 1) {
        const sourceOffset = (y * safeWidth + x) * 4;
        addSample(
          accumulator,
          rgba[sourceOffset] ?? 0,
          rgba[sourceOffset + 1] ?? 0,
          rgba[sourceOffset + 2] ?? 0
        );
      }
    }

    const targetOffset = ledIndex * 3;
    const sampled = resolveSample(accumulator, mode, exact);
    output[targetOffset] = Math.round(linearToSrgbByte(sampled[0]));
    output[targetOffset + 1] = Math.round(linearToSrgbByte(sampled[1]));
    output[targetOffset + 2] = Math.round(linearToSrgbByte(sampled[2]));
  }
  return output;
}

export function calibrateWLEDPixels(
  source: Uint8Array,
  output: Uint8Array,
  options: WLEDPixelOptions = {},
  previous?: Uint8Array
): Uint8Array {
  const length = Math.min(source.length, output.length);
  for (let offset = 0; offset + 2 < length; offset += 3) {
    const calibrated = applyColorCalibration(
      source[offset],
      source[offset + 1],
      source[offset + 2],
      options,
      previous,
      offset
    );
    output[offset] = Math.round(clamp(calibrated[0], 0, 255));
    output[offset + 1] = Math.round(clamp(calibrated[1], 0, 255));
    output[offset + 2] = Math.round(clamp(calibrated[2], 0, 255));
  }
  return output;
}

/** Backwards-compatible sample + calibration convenience. */
export function sampleWLEDPixels(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  points: WLEDNormalizedPoint[],
  sampleRadius: number,
  output: Uint8Array,
  options: WLEDPixelOptions = {},
  previous?: Uint8Array,
  mode: WLEDColorSamplingMode = 'average'
): Uint8Array {
  const source = new Uint8Array(output.length);
  sampleWLEDSourcePixels(rgba, width, height, points, sampleRadius, source, mode);
  return calibrateWLEDPixels(source, output, options, previous);
}

export function parseWLEDHexColor(hex: string | undefined): [number, number, number] {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex ?? '');
  if (!match) return [255, 255, 255];
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** Fill setup patterns in physical LED order, using the same calibration. */
export function fillWLEDTestPattern(
  pattern: WLEDTestPattern,
  color: string | undefined,
  nowMs: number,
  output: Uint8Array,
  options: WLEDPixelOptions = {},
  previous?: Uint8Array
): Uint8Array {
  const count = Math.floor(output.length / 3);
  const solid = parseWLEDHexColor(color);
  const chaseIndex = count > 0 ? Math.floor(nowMs / 80) % count : 0;
  for (let index = 0; index < count; index += 1) {
    let source: [number, number, number];
    if (pattern === 'rainbow') {
      const hue = count <= 1 ? 0 : index / count;
      const phase = hue * 6;
      const channel = (offset: number) =>
        255 * clamp(Math.abs(((phase + offset) % 6) - 3) - 1);
      source = [channel(0), channel(4), channel(2)];
    } else if (pattern === 'chase') {
      source = index === chaseIndex ? solid : [0, 0, 0];
    } else {
      source = solid;
    }
    const offset = index * 3;
    const calibrated = applyColorCalibration(source[0], source[1], source[2], options, previous, offset);
    output[offset] = Math.round(clamp(calibrated[0], 0, 255));
    output[offset + 1] = Math.round(clamp(calibrated[1], 0, 255));
    output[offset + 2] = Math.round(clamp(calibrated[2], 0, 255));
  }
  return output;
}
