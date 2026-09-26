// Every Edge Effect type the native core draws, with the parameters the
// Edge Effects panel shows and the defaults a new effect of that type gets.
// The panel, preset validation and the native packer all read this list.

export type EdgeParamKind = 'number' | 'color' | 'select' | 'toggle';

export interface EdgeParamOption {
  value: string;
  label: string;
}

export interface EdgeParamDef {
  key: string;
  label: string;
  kind: EdgeParamKind;
  min?: number;
  max?: number;
  step?: number;
  options?: EdgeParamOption[];
  format?: 'percent' | 'px' | 'x' | 'deg' | 'int' | 'plain';
}

export interface EdgeTypeDef {
  type: string;
  label: string;
  group: string;
  defaults: Record<string, unknown>;
  params: EdgeParamDef[];
  /** Also drawn by the legacy WebGL editor renderer (web builds). */
  webgl?: boolean;
}

const rgba = (r: number, g: number, b: number, a = 1) => [r, g, b, a];

const color = (key = 'color', label = 'Colour'): EdgeParamDef => ({ key, label, kind: 'color' });
const width: EdgeParamDef = { key: 'width', label: 'Width', kind: 'number', min: 0.25, max: 40, step: 0.25, format: 'px' };
const speed = (min = -3, max = 3, label = 'Speed'): EdgeParamDef => ({ key: 'speed', label, kind: 'number', min, max, step: 0.05, format: 'x' });
const pxParam = (key: string, label: string, min: number, max: number, step = 1): EdgeParamDef => ({ key, label, kind: 'number', min, max, step, format: 'px' });
const pct = (key: string, label: string, min = 0, max = 1, step = 0.01): EdgeParamDef => ({ key, label, kind: 'number', min, max, step, format: 'percent' });
const num = (key: string, label: string, min: number, max: number, step = 0.01, format: EdgeParamDef['format'] = 'plain'): EdgeParamDef => ({ key, label, kind: 'number', min, max, step, format });
const deg = (key = 'angle', label = 'Angle'): EdgeParamDef => ({ key, label, kind: 'number', min: -180, max: 180, step: 1, format: 'deg' });
const select = (key: string, label: string, options: Array<[string, string]>): EdgeParamDef => ({
  key, label, kind: 'select', options: options.map(([value, text]) => ({ value, label: text })),
});
const toggle = (key: string, label: string): EdgeParamDef => ({ key, label, kind: 'toggle' });

// ---------------------------------------------------------------------------
// Strokes
// ---------------------------------------------------------------------------

export const EDGE_STROKE_TYPES: EdgeTypeDef[] = [
  { type: 'none', label: 'None', group: 'Classic', defaults: { type: 'none' }, params: [], webgl: true },
  {
    type: 'solid', label: 'Solid', group: 'Classic', webgl: true,
    defaults: { type: 'solid', color: rgba(1, 1, 1), width: 3 },
    params: [color(), width],
  },
  {
    type: 'glow', label: 'Glow', group: 'Classic', webgl: true,
    defaults: { type: 'glow', color: rgba(0, 1, 0.5), width: 3, glowSize: 15, glowIntensity: 1, pulseSpeed: 1 },
    params: [color(), width, pxParam('glowSize', 'Glow size', 2, 80), num('glowIntensity', 'Intensity', 0.1, 3, 0.1), num('pulseSpeed', 'Pulse', 0, 5, 0.1)],
  },
  {
    type: 'neon', label: 'Neon', group: 'Classic', webgl: true,
    defaults: { type: 'neon', color: rgba(1, 0, 1), width: 2, glowSize: 20, glowIntensity: 1.5, pulseSpeed: 0.5, flickerSpeed: 3 },
    params: [color(), width, pxParam('glowSize', 'Glow size', 2, 80), num('flickerSpeed', 'Flicker', 0, 10, 0.1)],
  },
  {
    type: 'snake', label: 'Snake', group: 'Classic', webgl: true,
    defaults: { type: 'snake', color: rgba(0, 1, 0.5), width: 3, length: 0.3, speed: 1, tailFade: true, headGlow: true, bidirectional: false, snakeCount: 1 },
    params: [color(), width, pct('length', 'Length', 0.05, 0.95, 0.05), speed(0.1, 3), num('snakeCount', 'Snakes', 1, 8, 1, 'int')],
  },
  {
    type: 'pulse', label: 'Pulse', group: 'Classic', webgl: true,
    defaults: { type: 'pulse', color: rgba(0, 1, 1), width: 3, pulseCount: 3, speed: 1, fadeLength: 0.15 },
    params: [color(), width, num('pulseCount', 'Pulses', 1, 8, 1, 'int'), pct('fadeLength', 'Length', 0.02, 0.5), speed(0.1, 3)],
  },
  {
    type: 'rainbow', label: 'Rainbow', group: 'Classic', webgl: true,
    defaults: { type: 'rainbow', color: rgba(1, 1, 1), width: 3, speed: 1 },
    params: [width, speed(0.1, 3)],
  },
  {
    type: 'dashed', label: 'Dashed', group: 'Classic', webgl: true,
    defaults: { type: 'dashed', color: rgba(1, 1, 1), width: 2, dashLength: 0.2, gapLength: 0.1, speed: 0.5 },
    params: [color(), width, num('dashLength', 'Dash', 0.02, 1, 0.01), num('gapLength', 'Gap', 0.02, 1, 0.01), speed(-3, 3)],
  },
  {
    type: 'electric', label: 'Electric', group: 'Classic', webgl: true,
    defaults: { type: 'electric', color: rgba(0.3, 0.5, 1), width: 2, arcIntensity: 1, speed: 1 },
    params: [color(), width, num('arcIntensity', 'Arc', 0.1, 3, 0.1), speed(0.1, 3)],
  },
  {
    type: 'strobe', label: 'Blinking', group: 'Border', webgl: true,
    defaults: { type: 'strobe', color: rgba(1, 1, 1), width: 3, rate: 4 },
    params: [color(), width, num('rate', 'Rate', 0.25, 20, 0.25, 'plain')],
  },
  {
    type: 'scanner', label: 'Scanner', group: 'Classic', webgl: true,
    defaults: { type: 'scanner', color: rgba(0, 1, 0), width: 3, beamWidth: 0.1, trailLength: 0.3, speed: 1 },
    params: [color(), width, pct('beamWidth', 'Beam', 0.02, 0.3), pct('trailLength', 'Trail', 0.05, 0.8, 0.05), speed(0.1, 3)],
  },
  {
    type: 'fire', label: 'Fire', group: 'Classic', webgl: true,
    defaults: { type: 'fire', color: rgba(1, 0.5, 0), width: 4, speed: 1 },
    params: [width, speed(0.1, 3)],
  },
  {
    type: 'half', label: 'Half', group: 'Border',
    defaults: { type: 'half', color: rgba(1, 1, 1), width: 3, speed: 0.25 },
    params: [color(), width, speed(-2, 2)],
  },
  {
    type: 'quarter', label: 'Quarter', group: 'Border',
    defaults: { type: 'quarter', color: rgba(1, 1, 1), width: 3, speed: 0.25 },
    params: [color(), width, speed(-2, 2)],
  },
  {
    type: 'line', label: 'Line', group: 'Border',
    defaults: { type: 'line', color: rgba(1, 1, 1), width: 3, length: 0.2, speed: 0.3, mode: 'normal', cap: 'round' },
    params: [color(), width, pct('length', 'Length', 0.01, 1), speed(-2, 2), select('mode', 'Mode', [['normal', 'Normal'], ['boomerang', 'Boomerang'], ['yoyo', 'Yoyo']])],
  },
  {
    type: 'comet', label: 'Comet', group: 'Tracers',
    defaults: { type: 'comet', color: rgba(0.4, 0.9, 1), width: 3, tailLength: 0.35, headSize: 2, speed: 0.3 },
    params: [color(), width, pct('tailLength', 'Tail', 0.02, 1), num('headSize', 'Head', 1, 6, 0.1, 'x'), speed(-2, 2)],
  },
  {
    type: 'dashPattern', label: 'Dash pattern', group: 'Vector',
    defaults: { type: 'dashPattern', color: rgba(1, 1, 1), width: 3, dash1: 24, gap1: 12, dash2: 0, gap2: 0, speed: 40, cap: 'butt' },
    params: [color(), width, pxParam('dash1', 'Dash 1', 0, 300), pxParam('gap1', 'Gap 1', 0, 300), pxParam('dash2', 'Dash 2', 0, 300), pxParam('gap2', 'Gap 2', 0, 300), num('speed', 'Speed', -400, 400, 1, 'px')],
  },
  {
    type: 'marchingAnts', label: 'Marching ants', group: 'Vector',
    defaults: { type: 'marchingAnts', color: rgba(1, 1, 1), width: 2, dash1: 10, gap1: 8, speed: 30, beatLock: true },
    params: [color(), width, pxParam('dash1', 'Dash', 1, 200), pxParam('gap1', 'Gap', 1, 200), num('speed', 'Speed', -400, 400, 1, 'px'), toggle('beatLock', 'Lock to beat')],
  },
  {
    type: 'offset', label: 'Offset outlines', group: 'Vector',
    defaults: { type: 'offset', color: rgba(1, 1, 1), width: 2, count: 4, spacing: 16, direction: 'outset', speed: 0 },
    params: [color(), width, num('count', 'Copies', 1, 12, 1, 'int'), pxParam('spacing', 'Spacing', 2, 120), select('direction', 'Direction', [['inset', 'Inside'], ['outset', 'Outside'], ['both', 'Both']]), num('speed', 'Drift', -200, 200, 1, 'px')],
  },
  {
    type: 'inner', label: 'Inner lines', group: 'Structure',
    defaults: { type: 'inner', color: rgba(1, 1, 1), width: 2, count: 4, spacing: 14, speed: 0 },
    params: [color(), width, num('count', 'Lines', 1, 12, 1, 'int'), pxParam('spacing', 'Spacing', 2, 120), num('speed', 'Drift', -200, 200, 1, 'px')],
  },
  {
    type: 'wireframe', label: 'Wireframe', group: 'Structure',
    defaults: { type: 'wireframe', color: rgba(1, 1, 1), width: 1.5, spokes: true, triangles: true, outline: true },
    params: [color(), width, toggle('spokes', 'Lines to centre'), toggle('triangles', 'Triangles'), toggle('outline', 'Outline')],
  },
  {
    type: 'corners', label: 'Corner accents', group: 'Accents',
    defaults: { type: 'corners', color: rgba(1, 1, 1), width: 4, length: 30, cap: 'square' },
    params: [color(), width, pxParam('length', 'Length', 2, 300)],
  },
  {
    type: 'vertexDots', label: 'Vertex dots', group: 'Accents',
    defaults: { type: 'vertexDots', color: rgba(1, 1, 1), width: 2, radius: 6, burst: 1 },
    params: [color(), pxParam('radius', 'Radius', 1, 60, 0.5), num('burst', 'Beat burst', 0, 3, 0.05, 'x'), width],
  },
  {
    type: 'zigzag', label: 'Zig-zag', group: 'Vector',
    defaults: { type: 'zigzag', color: rgba(1, 1, 1), width: 2, amplitude: 6, wavelength: 24, speed: 0 },
    params: [color(), width, pxParam('amplitude', 'Amplitude', 0, 60, 0.5), pxParam('wavelength', 'Wavelength', 4, 300), speed(-5, 5)],
  },
  {
    type: 'wiggle', label: 'Wiggle', group: 'Vector',
    defaults: { type: 'wiggle', color: rgba(1, 1, 1), width: 2, amplitude: 5, wavelength: 40, speed: 0.5, seed: 1 },
    params: [color(), width, pxParam('amplitude', 'Amplitude', 0, 60, 0.5), pxParam('wavelength', 'Wavelength', 4, 300), speed(-5, 5), num('seed', 'Seed', 0, 100, 1, 'int')],
  },
];

/** Stroke geometry shown for every stroke type. */
export const EDGE_STROKE_SHAPE_PARAMS: EdgeParamDef[] = [
  select('widthMode', 'Width', [['pixels', 'Output pixels'], ['surface', 'Scale with surface']]),
  select('cap', 'Caps', [['butt', 'Butt'], ['round', 'Round'], ['square', 'Square']]),
  select('join', 'Joins', [['miter', 'Miter'], ['round', 'Round'], ['bevel', 'Bevel']]),
  num('miterLimit', 'Miter limit', 1, 10, 0.1),
];

/** Trim path, shown for every stroke type. */
export const EDGE_TRIM_PARAMS: EdgeParamDef[] = [
  pct('trimStart', 'Trim start'),
  pct('trimEnd', 'Trim end'),
  num('trimOffset', 'Trim offset', -1, 1, 0.01, 'percent'),
  select('trimMode', 'Trim animation', [['none', 'None'], ['drawOn', 'Draw on'], ['drawOff', 'Draw off'], ['boomerang', 'Boomerang']]),
  num('trimSpeed', 'Trim speed', 0, 4, 0.05, 'x'),
];

// ---------------------------------------------------------------------------
// Fills
// ---------------------------------------------------------------------------

const progressParams: EdgeParamDef[] = [
  select('progressMode', 'Timing', [['loop', 'Loop'], ['pingpong', 'Back and forth'], ['beat', 'Beat'], ['manual', 'Manual']]),
  num('speed', 'Speed', 0, 4, 0.05, 'x'),
  pct('progress', 'Progress'),
];

export const EDGE_FILL_TYPES: EdgeTypeDef[] = [
  { type: 'none', label: 'None', group: 'Classic', defaults: { type: 'none' }, params: [], webgl: true },
  {
    type: 'solid', label: 'Solid', group: 'Classic', webgl: true,
    defaults: { type: 'solid', color: rgba(1, 1, 1), opacity: 0.5 },
    params: [color(), pct('opacity', 'Opacity')],
  },
  {
    type: 'gradient', label: 'Gradient', group: 'Classic', webgl: true,
    defaults: { type: 'gradient', color: rgba(1, 0, 0), color2: rgba(0, 0, 1), angle: 0, gradientType: 'linear', speed: 0 },
    params: [color('color', 'Colour 1'), color('color2', 'Colour 2'), select('gradientType', 'Shape', [['linear', 'Linear'], ['radial', 'Radial'], ['angular', 'Angular'], ['diamond', 'Diamond']]), deg(), num('speed', 'Speed', -3, 3, 0.05, 'x')],
  },
  {
    type: 'plasma', label: 'Plasma', group: 'Classic', webgl: true,
    defaults: { type: 'plasma', scale: 3, complexity: 3, palette: 'neon', speed: 1 },
    params: [num('scale', 'Scale', 1, 20, 0.5), num('complexity', 'Complexity', 1, 6, 1, 'int'), select('palette', 'Palette', [['rainbow', 'Rainbow'], ['fire', 'Fire'], ['ocean', 'Ocean'], ['neon', 'Neon']]), speed(0.1, 3)],
  },
  {
    type: 'liquid', label: 'Liquid', group: 'Classic', webgl: true,
    defaults: { type: 'liquid', color: rgba(0, 0.5, 1), viscosity: 0.5, turbulence: 0.5, speed: 1, metallic: 0.5 },
    params: [color(), pct('viscosity', 'Viscosity'), pct('turbulence', 'Turbulence'), pct('metallic', 'Metallic'), speed(0.1, 3)],
  },
  {
    type: 'fire', label: 'Fire', group: 'Classic', webgl: true,
    defaults: { type: 'fire', intensity: 1, turbulence: 0.5, speed: 1, palette: 'orange' },
    params: [num('intensity', 'Intensity', 0.1, 2, 0.05), pct('turbulence', 'Turbulence'), select('palette', 'Palette', [['orange', 'Orange'], ['blue', 'Blue'], ['green', 'Green'], ['purple', 'Purple']]), speed(0.1, 3)],
  },
  {
    type: 'electric', label: 'Electric', group: 'Classic', webgl: true,
    defaults: { type: 'electric', color: rgba(0.3, 0.5, 1), intensity: 1, arcCount: 5, speed: 1 },
    params: [color(), num('intensity', 'Intensity', 0.1, 3, 0.05), num('arcCount', 'Arcs', 1, 12, 0.5), speed(0.1, 3)],
  },
  {
    type: 'holographic', label: 'Holographic', group: 'Classic', webgl: true,
    defaults: { type: 'holographic', hueShift: 0.5, scanlines: true, flicker: 0.3, speed: 1 },
    params: [pct('hueShift', 'Hue shift'), toggle('scanlines', 'Scanlines'), pct('flicker', 'Flicker'), speed(0.1, 3)],
  },
  {
    type: 'noise', label: 'Noise', group: 'Classic', webgl: true,
    defaults: { type: 'noise', color1: rgba(0, 0, 0), color2: rgba(1, 1, 1), scale: 5, octaves: 4, speed: 0.5, turbulence: 0.5 },
    params: [color('color1', 'Colour 1'), color('color2', 'Colour 2'), num('scale', 'Scale', 1, 30, 0.5), pct('turbulence', 'Turbulence'), speed(0, 3)],
  },
  {
    type: 'randomColor', label: 'Random colour', group: 'Colour',
    defaults: { type: 'randomColor', saturation: 0.85, brightness: 1, opacity: 1, beatChange: false },
    params: [pct('saturation', 'Saturation'), pct('brightness', 'Brightness'), pct('opacity', 'Opacity'), toggle('beatChange', 'New colour each beat')],
  },
  {
    type: 'inside', label: 'Inside', group: 'Reveal',
    defaults: { type: 'inside', color: rgba(1, 1, 1), progressMode: 'loop', speed: 0.5, progress: 1 },
    params: [color(), ...progressParams],
  },
  {
    type: 'outside', label: 'Outside', group: 'Reveal',
    defaults: { type: 'outside', color: rgba(1, 1, 1), progressMode: 'loop', speed: 0.5, progress: 1 },
    params: [color(), ...progressParams],
  },
  {
    type: 'corner', label: 'Corner', group: 'Reveal',
    defaults: { type: 'corner', color: rgba(1, 1, 1), corner: 0, progressMode: 'loop', speed: 0.5, progress: 1 },
    params: [color(), num('corner', 'Corner', 0, 63, 1, 'int'), ...progressParams],
  },
  {
    type: 'swipe', label: 'Swipe', group: 'Reveal',
    defaults: { type: 'swipe', color: rgba(1, 1, 1), angle: 0, softness: 0, progressMode: 'loop', speed: 0.5, progress: 1 },
    params: [color(), deg(), pxParam('softness', 'Softness', 0, 200), ...progressParams],
  },
  {
    type: 'globalSwipe', label: 'Group swipe', group: 'Reveal',
    defaults: { type: 'globalSwipe', color: rgba(1, 1, 1), angle: 0, softness: 0, progressMode: 'loop', speed: 0.5, progress: 1 },
    params: [color(), deg(), pxParam('softness', 'Softness', 0, 200), ...progressParams],
  },
  {
    type: 'iris', label: 'Iris', group: 'Reveal',
    defaults: { type: 'iris', color: rgba(1, 1, 1), progressMode: 'loop', speed: 0.5, progress: 1 },
    params: [color(), ...progressParams],
  },
  {
    type: 'clockWipe', label: 'Clock wipe', group: 'Reveal',
    defaults: { type: 'clockWipe', color: rgba(1, 1, 1), progressMode: 'loop', speed: 0.5, progress: 1 },
    params: [color(), ...progressParams],
  },
  {
    type: 'stairs', label: 'Stairs', group: 'Reveal',
    defaults: { type: 'stairs', color: rgba(1, 1, 1), steps: 6, angle: 90, progressMode: 'loop', speed: 0.5, progress: 1 },
    params: [color(), num('steps', 'Steps', 2, 24, 1, 'int'), deg(), ...progressParams],
  },
  {
    type: 'scanLine', label: 'Scan line', group: 'Reveal',
    defaults: { type: 'scanLine', color: rgba(1, 1, 1), lineWidth: 4, angle: 90, progressMode: 'pingpong', speed: 0.5, progress: 0.5 },
    params: [color(), pxParam('lineWidth', 'Line width', 0.5, 80, 0.5), deg(), ...progressParams],
  },
  {
    type: 'hypnotic', label: 'Hypnotic', group: 'Pattern',
    defaults: { type: 'hypnotic', color: rgba(1, 1, 1), color2: rgba(0, 0, 0, 0), band: 20, speed: 0.5 },
    params: [color('color', 'Colour 1'), color('color2', 'Colour 2'), pxParam('band', 'Band', 2, 200), num('speed', 'Speed', -3, 3, 0.05, 'x')],
  },
  {
    type: 'stripes', label: 'Stripes', group: 'Pattern',
    defaults: { type: 'stripes', color: rgba(1, 1, 1), color2: rgba(0, 0, 0, 0), angle: 45, stripeWidth: 16, speed: 0.5 },
    params: [color('color', 'Colour 1'), color('color2', 'Colour 2'), deg(), pxParam('stripeWidth', 'Stripe width', 1, 200), num('speed', 'Speed', -3, 3, 0.05, 'x')],
  },
  {
    type: 'doubleStripes', label: 'Double stripes', group: 'Pattern',
    defaults: { type: 'doubleStripes', color: rgba(1, 1, 1), color2: rgba(0, 0, 0, 0), angle: 45, stripeWidth: 12, speed: 0.4 },
    params: [color('color', 'Colour 1'), color('color2', 'Colour 2'), deg(), pxParam('stripeWidth', 'Stripe width', 1, 200), num('speed', 'Speed', -3, 3, 0.05, 'x')],
  },
  {
    type: 'mosaic', label: 'Mosaic', group: 'Pattern',
    defaults: { type: 'mosaic', color: rgba(1, 1, 1), color2: rgba(0, 0, 0, 0), cell: 24, progressMode: 'loop', speed: 0.5, progress: 1 },
    params: [color('color', 'Colour 1'), color('color2', 'Colour 2'), pxParam('cell', 'Cell', 4, 200), ...progressParams],
  },
  {
    type: 'halftone', label: 'Halftone', group: 'Pattern',
    defaults: { type: 'halftone', color: rgba(1, 1, 1), color2: rgba(0, 0, 0, 0), cell: 14, angle: 45, source: 'gradient', speed: 0.3 },
    params: [color('color', 'Dots'), color('color2', 'Background'), pxParam('cell', 'Cell', 4, 100), deg(), select('source', 'Dot size from', [['gradient', 'Moving gradient'], ['audio', 'Audio level']]), num('speed', 'Speed', -3, 3, 0.05, 'x')],
  },
  {
    type: 'hatch', label: 'Hatch', group: 'Pattern',
    defaults: { type: 'hatch', color: rgba(1, 1, 1), color2: rgba(0, 0, 0, 0), spacing: 12, lineWidth: 2, angle: 45, rotateSpeed: 0 },
    params: [color('color', 'Lines'), color('color2', 'Background'), pxParam('spacing', 'Spacing', 2, 200), pxParam('lineWidth', 'Line width', 0.25, 40, 0.25), deg(), num('rotateSpeed', 'Rotation', -180, 180, 1, 'deg')],
  },
  {
    type: 'grid', label: 'Grid', group: 'Pattern',
    defaults: { type: 'grid', color: rgba(1, 1, 1), color2: rgba(0, 0, 0, 0), spacing: 24, lineWidth: 1.5, angle: 0, rotateSpeed: 0 },
    params: [color('color', 'Lines'), color('color2', 'Background'), pxParam('spacing', 'Spacing', 2, 200), pxParam('lineWidth', 'Line width', 0.25, 40, 0.25), deg(), num('rotateSpeed', 'Rotation', -180, 180, 1, 'deg')],
  },
  {
    type: 'pattern', label: 'Pattern', group: 'Pattern',
    defaults: { type: 'pattern', color: rgba(1, 1, 1), backgroundColor: rgba(0, 0, 0, 0), pattern: 'hexagon', scale: 24, lineWidth: 2, angle: 0, rotateSpeed: 0 },
    params: [color('color', 'Lines'), color('backgroundColor', 'Background'), select('pattern', 'Pattern', [['dots', 'Dots'], ['lines', 'Lines'], ['grid', 'Grid'], ['crosshatch', 'Crosshatch'], ['chevron', 'Chevron'], ['hexagon', 'Hexagon']]), pxParam('scale', 'Scale', 4, 200), pxParam('lineWidth', 'Line or dot size', 0.25, 40, 0.25), deg(), num('rotateSpeed', 'Rotation', -180, 180, 1, 'deg')],
  },
  {
    type: 'radialGlow', label: 'Radial glow', group: 'Structure',
    defaults: { type: 'radialGlow', color: rgba(1, 1, 1), radius: 1.5, intensity: 1.2, pulseSpeed: 0 },
    params: [color(), num('radius', 'Radius', 0.1, 3, 0.05, 'x'), num('intensity', 'Intensity', 0.1, 3, 0.05), num('pulseSpeed', 'Pulse', 0, 5, 0.1)],
  },
  {
    type: 'origami', label: 'Origami', group: 'Structure',
    defaults: { type: 'origami', color: rgba(1, 1, 1), depth: 0.7, speed: 0.3 },
    params: [color(), pct('depth', 'Folding'), num('speed', 'Speed', -3, 3, 0.05, 'x')],
  },
];

// ---------------------------------------------------------------------------
// Animations
// ---------------------------------------------------------------------------

export const EDGE_ANIMATION_TYPES: EdgeTypeDef[] = [
  { type: 'none', label: 'None', group: 'Classic', defaults: { type: 'none' }, params: [], webgl: true },
  {
    type: 'concentric', label: 'Concentric', group: 'Classic', webgl: true,
    defaults: { type: 'concentric', count: 5, spacing: 0.04, speed: 1, direction: 'out', fadeOut: true, scaleVariation: 0 },
    params: [select('direction', 'Direction', [['in', 'Internal'], ['out', 'External'], ['both', 'Both']]), num('count', 'Count', 1, 20, 1, 'int'), num('spacing', 'Spacing', 0.01, 0.1, 0.005, 'percent'), speed(0.1, 3)],
  },
  {
    type: 'breathe', label: 'Breathe', group: 'Classic', webgl: true,
    defaults: { type: 'breathe', speed: 1, minScale: 0.8, maxScale: 1.2 },
    params: [num('minScale', 'Smallest', 0.1, 2, 0.01, 'x'), num('maxScale', 'Largest', 0.1, 3, 0.01, 'x'), speed(0.1, 3)],
  },
  {
    type: 'rotate', label: 'Rotate', group: 'Classic', webgl: true,
    defaults: { type: 'rotate', speed: 1, direction: 'cw' },
    params: [select('direction', 'Direction', [['cw', 'Clockwise'], ['ccw', 'Counter-clockwise']]), speed(0, 5)],
  },
  {
    type: 'radiate', label: 'Radiate', group: 'Classic', webgl: true,
    defaults: { type: 'radiate', rays: 8, speed: 1 },
    params: [num('rays', 'Rays', 2, 32, 1, 'int'), speed(-3, 3)],
  },
  {
    type: 'ripple', label: 'Ripple', group: 'Classic', webgl: true,
    defaults: { type: 'ripple', speed: 1, wavelength: 0.1, amplitude: 0.02, count: 5, spacing: 0.04, decay: 1 },
    params: [num('count', 'Rings', 3, 10, 1, 'int'), num('spacing', 'Spacing', 0.01, 0.2, 0.005, 'percent'), num('decay', 'Decay', 0, 4, 0.05), speed(0.1, 3)],
  },
  {
    type: 'wave', label: 'Wave', group: 'Classic', webgl: true,
    defaults: { type: 'wave', speed: 1, wavelength: 0.2, amplitude: 0.03, frequency: 1 },
    params: [num('amplitude', 'Amplitude', 0, 3, 0.01), num('frequency', 'Frequency', 0.1, 5, 0.05), speed(0.1, 3)],
  },
  {
    type: 'glitch', label: 'Glitch', group: 'Classic', webgl: true,
    defaults: { type: 'glitch', intensity: 0.5, speed: 2, rgbSplit: true, blockSize: 1 },
    params: [num('intensity', 'Intensity', 0, 3, 0.05), num('blockSize', 'Block size', 0.2, 5, 0.1), speed(0.1, 5)],
  },
  {
    type: 'flipX', label: 'Flip X', group: '3D',
    defaults: { type: 'flipX', speed: 0.25, perspective: 0.6 },
    params: [num('speed', 'Turns per second', -2, 2, 0.01), pct('perspective', 'Perspective')],
  },
  {
    type: 'flipY', label: 'Flip Y', group: '3D',
    defaults: { type: 'flipY', speed: 0.25, perspective: 0.6 },
    params: [num('speed', 'Turns per second', -2, 2, 0.01), pct('perspective', 'Perspective')],
  },
  {
    type: 'elastic', label: 'Elastic', group: 'Motion',
    defaults: { type: 'elastic', amount: 0.3, bounciness: 3, speed: 0.5 },
    params: [pct('amount', 'Amount'), num('bounciness', 'Bounces', 1, 10, 0.5), speed(0.05, 3)],
  },
  {
    type: 'orbit', label: 'Orbit', group: 'Motion',
    defaults: { type: 'orbit', radius: 20, speed: 0.3, direction: 'cw', elliptical: false, ellipseRatio: 1 },
    params: [pxParam('radius', 'Radius', 0, 300), speed(-3, 3)],
  },
  {
    type: 'bounce', label: 'Bounce', group: 'Motion',
    defaults: { type: 'bounce', height: 30, speed: 1, squash: 0 },
    params: [pxParam('height', 'Height', 0, 300), speed(0.05, 5)],
  },
  {
    type: 'shake', label: 'Shake', group: 'Motion',
    defaults: { type: 'shake', intensity: 6, speed: 1, decay: false },
    params: [pxParam('intensity', 'Intensity', 0, 80, 0.5), speed(0.05, 5)],
  },
];

/** Effect-level controls shown under every effect. */
export const EDGE_EFFECT_LEVEL_PARAMS: EdgeParamDef[] = [
  toggle('customCenter', 'Custom centre'),
  pct('centerX', 'Centre X'),
  pct('centerY', 'Centre Y'),
  select('chaseMode', 'Group chase', [['none', 'Off'], ['order', 'Layer order'], ['leftToRight', 'Left to right'], ['radial', 'From the centre']]),
  num('chaseSpread', 'Chase delay', 0, 4, 0.05, 'plain'),
];

export function edgeTypeDef(kind: 'stroke' | 'fill' | 'animation', type: string): EdgeTypeDef | undefined {
  const list = kind === 'stroke' ? EDGE_STROKE_TYPES : kind === 'fill' ? EDGE_FILL_TYPES : EDGE_ANIMATION_TYPES;
  return list.find((def) => def.type === type);
}

/** A fresh stroke, fill or animation object of `type` with its defaults. */
export function edgeTypeDefaults(kind: 'stroke' | 'fill' | 'animation', type: string): Record<string, unknown> {
  const def = edgeTypeDef(kind, type);
  return def ? JSON.parse(JSON.stringify(def.defaults)) : { type: 'none' };
}

const KNOWN = {
  stroke: new Set([...EDGE_STROKE_TYPES.map((t) => t.type), 'dotted', 'video']),
  fill: new Set([...EDGE_FILL_TYPES.map((t) => t.type), 'radialGradient', 'video']),
  animation: new Set([...EDGE_ANIMATION_TYPES.map((t) => t.type), 'morph', 'explode', 'implode']),
};

export function isKnownEdgeType(kind: 'stroke' | 'fill' | 'animation', type: unknown): boolean {
  return typeof type === 'string' && KNOWN[kind].has(type);
}
