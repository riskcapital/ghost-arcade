// Drawing Layer Types - Shapes, Effects, and Animations
import type { Point2D } from '../types';
import { generateUUID } from '../types';

export type { Point2D };

// ============================================================================
// SHAPE PRIMITIVES
// ============================================================================

export type ShapeType =
  | 'line'
  | 'polyline'
  | 'freehand'
  | 'pointClickLine'
  | 'circle'
  | 'ellipse'
  | 'rectangle'
  | 'roundedRect'
  | 'triangle'
  | 'polygon'
  | 'star'
  | 'arc'
  | 'ring'
  | 'spiral'
  | 'wave'
  | 'bezier'
  | 'text';

export interface BaseShape {
  id: string;
  type: ShapeType;
  visible: boolean;
  locked: boolean;
  position: Point2D;      // Center position (0-1 normalized)
  rotation: number;       // Degrees
  scale: Point2D;         // Scale multiplier
  zIndex: number;
  // Optional custom vertices - when set, these override the parametric shape
  // Allows shapes to be warped/distorted by dragging individual vertices
  customVertices?: Point2D[];
}

export interface LineShape extends BaseShape {
  type: 'line';
  points: [Point2D, Point2D];  // Start and end
}

export interface PolylineShape extends BaseShape {
  type: 'polyline';
  points: Point2D[];
  closed: boolean;
}

export interface FreehandShape extends BaseShape {
  type: 'freehand';
  points: Point2D[];
  smoothing: number;  // 0-1, how much to smooth the path
  pressure?: number[]; // Optional pressure sensitivity per point
}

export interface PointClickLineShape extends BaseShape {
  type: 'pointClickLine';
  points: Point2D[];
  closed: boolean;
  cornerStyle: 'sharp' | 'rounded' | 'chamfer';
  cornerRadius?: number;
}

export interface CircleShape extends BaseShape {
  type: 'circle';
  radius: number;  // 0-1 normalized
}

export interface EllipseShape extends BaseShape {
  type: 'ellipse';
  radiusX: number;
  radiusY: number;
}

export interface RectangleShape extends BaseShape {
  type: 'rectangle';
  width: number;
  height: number;
}

export interface RoundedRectShape extends BaseShape {
  type: 'roundedRect';
  width: number;
  height: number;
  cornerRadius: number;
}

export interface TriangleShape extends BaseShape {
  type: 'triangle';
  size: number;
  style: 'equilateral' | 'isoceles' | 'right';
}

export interface PolygonShape extends BaseShape {
  type: 'polygon';
  sides: number;  // 3-12
  radius: number;
}

export interface StarShape extends BaseShape {
  type: 'star';
  points: number;     // 3-12 star points
  outerRadius: number;
  innerRadius: number;
}

export interface ArcShape extends BaseShape {
  type: 'arc';
  radius: number;
  startAngle: number;  // Degrees
  endAngle: number;
}

export interface RingShape extends BaseShape {
  type: 'ring';
  outerRadius: number;
  innerRadius: number;
}

export interface SpiralShape extends BaseShape {
  type: 'spiral';
  turns: number;
  startRadius: number;
  endRadius: number;
}

export interface WaveShape extends BaseShape {
  type: 'wave';
  amplitude: number;
  frequency: number;
  length: number;
}

export interface BezierShape extends BaseShape {
  type: 'bezier';
  points: Point2D[];       // Control points
  controlPoints: Point2D[]; // Bezier handles
}

export interface TextShape extends BaseShape {
  type: 'text';
  text: string;
  fontSize: number;
  fontFamily: string;
  fontWeight: 'normal' | 'bold';
}

export type Shape =
  | LineShape
  | PolylineShape
  | FreehandShape
  | PointClickLineShape
  | CircleShape
  | EllipseShape
  | RectangleShape
  | RoundedRectShape
  | TriangleShape
  | PolygonShape
  | StarShape
  | ArcShape
  | RingShape
  | SpiralShape
  | WaveShape
  | BezierShape
  | TextShape;

// ============================================================================
// FILL EFFECTS
// ============================================================================

export type FillType =
  | 'none'
  | 'solid'
  | 'gradient'
  | 'radialGradient'
  | 'video'
  | 'pattern'
  | 'noise'
  | 'plasma'
  | 'liquid'
  | 'fire'
  | 'electric'
  | 'holographic';

export interface SolidFill {
  type: 'solid';
  color: [number, number, number, number]; // RGBA 0-1
}

export interface GradientStop {
  position: number;  // 0-1
  color: [number, number, number, number];
}

export interface GradientFill {
  type: 'gradient';
  angle: number;  // Degrees
  stops: GradientStop[];
  animated: boolean;
  animationSpeed: number;
}

export interface RadialGradientFill {
  type: 'radialGradient';
  center: Point2D;
  stops: GradientStop[];
  animated: boolean;
  animationSpeed: number;
}

export interface VideoFill {
  type: 'video';
  sourceId: string;  // Reference to media library
  fit: 'cover' | 'contain' | 'stretch';
  playbackSpeed: number;
}

export interface PatternFill {
  type: 'pattern';
  pattern: 'dots' | 'lines' | 'grid' | 'crosshatch' | 'chevron' | 'hexagon';
  scale: number;
  color: [number, number, number, number];
  backgroundColor: [number, number, number, number];
  animated: boolean;
  animationSpeed: number;
}

export interface NoiseFill {
  type: 'noise';
  scale: number;
  octaves: number;
  color1: [number, number, number, number];
  color2: [number, number, number, number];
  animated: boolean;
  animationSpeed: number;
}

export interface PlasmaFill {
  type: 'plasma';
  scale: number;
  complexity: number;
  palette: 'rainbow' | 'fire' | 'ocean' | 'neon' | 'custom';
  customColors?: [number, number, number, number][];
  speed: number;
}

export interface LiquidFill {
  type: 'liquid';
  color: [number, number, number, number];
  viscosity: number;
  turbulence: number;
  speed: number;
  metallic: number;
}

export interface FireFill {
  type: 'fire';
  intensity: number;
  palette: 'orange' | 'blue' | 'green' | 'purple';
  speed: number;
  turbulence: number;
}

export interface ElectricFill {
  type: 'electric';
  color: [number, number, number, number];
  intensity: number;
  arcCount: number;
  speed: number;
}

export interface HolographicFill {
  type: 'holographic';
  baseColor: [number, number, number, number];
  shiftAmount: number;
  scanlines: boolean;
  flicker: number;
}

export type Fill =
  | { type: 'none' }
  | SolidFill
  | GradientFill
  | RadialGradientFill
  | VideoFill
  | PatternFill
  | NoiseFill
  | PlasmaFill
  | LiquidFill
  | FireFill
  | ElectricFill
  | HolographicFill;

// ============================================================================
// STROKE/OUTLINE EFFECTS
// ============================================================================

export type StrokeType =
  | 'none'
  | 'solid'
  | 'dashed'
  | 'dotted'
  | 'glow'
  | 'neon'
  | 'electric'
  | 'snake'
  | 'pulse'
  | 'rainbow'
  | 'fire'
  | 'scanner'
  | 'video';

export interface SolidStroke {
  type: 'solid';
  color: [number, number, number, number];
  width: number;
  cap: 'butt' | 'round' | 'square';
  join: 'miter' | 'round' | 'bevel';
}

export interface DashedStroke {
  type: 'dashed';
  color: [number, number, number, number];
  width: number;
  dashLength: number;
  gapLength: number;
  animated: boolean;
  animationSpeed: number;
}

export interface DottedStroke {
  type: 'dotted';
  color: [number, number, number, number];
  width: number;
  dotSize: number;
  spacing: number;
  animated: boolean;
  animationSpeed: number;
}

export interface GlowStroke {
  type: 'glow';
  color: [number, number, number, number];
  width: number;
  glowSize: number;
  glowIntensity: number;
  pulseSpeed: number;  // 0 = no pulse
}

export interface NeonStroke {
  type: 'neon';
  color: [number, number, number, number];
  width: number;
  glowSize: number;
  flickerSpeed: number;
  flickerIntensity: number;
}

export interface ElectricStroke {
  type: 'electric';
  color: [number, number, number, number];
  width: number;
  arcIntensity: number;
  speed: number;
  branches: number;
}

export interface SnakeStroke {
  type: 'snake';
  color: [number, number, number, number];
  width: number;
  length: number;      // 0-1, how much of the path is lit (can go above 1 for multiple loops)
  speed: number;
  tailFade: boolean;
  headGlow: boolean;
  bidirectional: boolean;
  snakeCount: number;  // Number of snakes on the path (1-8)
}

export interface PulseStroke {
  type: 'pulse';
  color: [number, number, number, number];
  width: number;
  pulseCount: number;
  speed: number;
  fadeLength: number;
  direction: 'forward' | 'backward' | 'both';
}

export interface RainbowStroke {
  type: 'rainbow';
  width: number;
  saturation: number;
  brightness: number;
  speed: number;
  segments: number;
}

export interface FireStroke {
  type: 'fire';
  color: [number, number, number, number];
  width: number;
  intensity: number;
  speed: number;
}

export interface ScannerStroke {
  type: 'scanner';
  color: [number, number, number, number];
  width: number;
  beamWidth: number;
  speed: number;
  trail: number;
}

export interface VideoStroke {
  type: 'video';
  sourceId: string;
  width: number;
}

export type Stroke =
  | { type: 'none' }
  | SolidStroke
  | DashedStroke
  | DottedStroke
  | GlowStroke
  | NeonStroke
  | ElectricStroke
  | SnakeStroke
  | PulseStroke
  | RainbowStroke
  | FireStroke
  | ScannerStroke
  | VideoStroke;

// ============================================================================
// ANIMATION EFFECTS (Applied to shapes)
// ============================================================================

export type AnimationType =
  | 'none'
  | 'concentric'
  | 'radiate'
  | 'breathe'
  | 'rotate'
  | 'orbit'
  | 'bounce'
  | 'shake'
  | 'morph'
  | 'wave'
  | 'ripple'
  | 'explode'
  | 'implode'
  | 'glitch';

export interface ConcentricAnimation {
  type: 'concentric';
  count: number;         // Number of concentric copies
  spacing: number;       // Space between copies
  speed: number;         // Animation speed
  direction: 'in' | 'out' | 'both';
  fadeOut: boolean;
  scaleVariation: number;
}

export interface RadiateAnimation {
  type: 'radiate';
  rays: number;          // Number of rays
  speed: number;
  length: number;
  rotation: number;
  rotationSpeed: number;
}

export interface BreatheAnimation {
  type: 'breathe';
  minScale: number;
  maxScale: number;
  speed: number;
  easing: 'linear' | 'sine' | 'ease';
}

export interface RotateAnimation {
  type: 'rotate';
  speed: number;
  direction: 'cw' | 'ccw';
  oscillate: boolean;
  oscillateAngle: number;
}

export interface OrbitAnimation {
  type: 'orbit';
  radius: number;
  speed: number;
  direction: 'cw' | 'ccw';
  elliptical: boolean;
  ellipseRatio: number;
}

export interface BounceAnimation {
  type: 'bounce';
  height: number;
  speed: number;
  squash: number;
}

export interface ShakeAnimation {
  type: 'shake';
  intensity: number;
  speed: number;
  decay: boolean;
}

export interface MorphAnimation {
  type: 'morph';
  targetShape: ShapeType;
  speed: number;
  easing: 'linear' | 'sine' | 'elastic';
}

export interface WaveAnimation {
  type: 'wave';
  amplitude: number;
  frequency: number;
  speed: number;
  axis: 'x' | 'y' | 'both';
}

export interface RippleAnimation {
  type: 'ripple';
  count: number;
  speed: number;
  decay: number;
  maxRadius: number;
}

export interface ExplodeAnimation {
  type: 'explode';
  particleCount: number;
  speed: number;
  spread: number;
  gravity: number;
  loop: boolean;
}

export interface ImplodeAnimation {
  type: 'implode';
  particleCount: number;
  speed: number;
  startRadius: number;
  loop: boolean;
}

export interface GlitchAnimation {
  type: 'glitch';
  intensity: number;
  speed: number;
  rgbSplit: boolean;
  blockSize: number;
}

export type Animation =
  | { type: 'none' }
  | ConcentricAnimation
  | RadiateAnimation
  | BreatheAnimation
  | RotateAnimation
  | OrbitAnimation
  | BounceAnimation
  | ShakeAnimation
  | MorphAnimation
  | WaveAnimation
  | RippleAnimation
  | ExplodeAnimation
  | ImplodeAnimation
  | GlitchAnimation;

// ============================================================================
// DRAWING ELEMENT (Shape + Fill + Stroke + Animation)
// ============================================================================

// Per-shape corner warp for projection mapping
export interface ShapeWarpCorners {
  topLeft: { x: number; y: number };
  topRight: { x: number; y: number };
  bottomLeft: { x: number; y: number };
  bottomRight: { x: number; y: number };
}

export function createDefaultShapeWarp(): ShapeWarpCorners {
  return {
    topLeft: { x: 0, y: 0 },
    topRight: { x: 1, y: 0 },
    bottomLeft: { x: 0, y: 1 },
    bottomRight: { x: 1, y: 1 },
  };
}

// Per-shape mesh warp for fine-grained deformation
export interface ShapeMeshWarp {
  rows: number;
  cols: number;
  // Grid points in 0-1 normalized space (relative to shape bounds)
  // points[row][col] = { x, y }
  points: { x: number; y: number }[][];
}

export function createDefaultShapeMesh(rows: number = 3, cols: number = 3): ShapeMeshWarp {
  const points: { x: number; y: number }[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: { x: number; y: number }[] = [];
    for (let c = 0; c < cols; c++) {
      row.push({
        x: c / (cols - 1),
        y: r / (rows - 1),
      });
    }
    points.push(row);
  }
  return { rows, cols, points };
}

export interface DrawingElement {
  id: string;
  name: string;
  shape: Shape;
  fill: Fill;
  stroke: Stroke;
  animation: Animation;
  // Per-shape corner warp (relative to shape bounds)
  warpCorners: ShapeWarpCorners;
  warpEnabled: boolean;
  // Per-shape mesh warp for fine-grained deformation
  meshWarp: ShapeMeshWarp;
  meshWarpEnabled: boolean;
  shadowEnabled: boolean;
  shadow?: {
    color: [number, number, number, number];
    blur: number;
    offsetX: number;
    offsetY: number;
  };
  blendMode: 'normal' | 'add' | 'multiply' | 'screen';
  opacity: number;
}

// ============================================================================
// DRAWING LAYER
// ============================================================================

export interface DrawingLayer {
  id: string;
  name: string;
  elements: DrawingElement[];
  backgroundColor: [number, number, number, number];
  visible: boolean;
  locked: boolean;
  opacity: number;
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

export function createDefaultCircle(): CircleShape {
  return {
    id: generateUUID(),
    type: 'circle',
    visible: true,
    locked: false,
    position: { x: 0.5, y: 0.5 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    zIndex: 0,
    radius: 0.2,
  };
}

export function createDefaultRectangle(): RectangleShape {
  return {
    id: generateUUID(),
    type: 'rectangle',
    visible: true,
    locked: false,
    position: { x: 0.5, y: 0.5 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    zIndex: 0,
    width: 0.3,
    height: 0.2,
  };
}

export function createDefaultTriangle(): TriangleShape {
  return {
    id: generateUUID(),
    type: 'triangle',
    visible: true,
    locked: false,
    position: { x: 0.5, y: 0.5 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    zIndex: 0,
    size: 0.2,
    style: 'equilateral',
  };
}

export function createDefaultLine(): LineShape {
  return {
    id: generateUUID(),
    type: 'line',
    visible: true,
    locked: false,
    position: { x: 0.5, y: 0.5 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    zIndex: 0,
    points: [{ x: 0.3, y: 0.5 }, { x: 0.7, y: 0.5 }],
  };
}

export function createDefaultFreehand(points: Point2D[] = []): FreehandShape {
  return {
    id: generateUUID(),
    type: 'freehand',
    visible: true,
    locked: false,
    position: { x: 0, y: 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    zIndex: 0,
    points: points.length > 0 ? points : [{ x: 0.3, y: 0.5 }, { x: 0.5, y: 0.3 }, { x: 0.7, y: 0.5 }],
    smoothing: 0.5,
  };
}

export function createDefaultPointClickLine(points: Point2D[] = []): PointClickLineShape {
  return {
    id: generateUUID(),
    type: 'pointClickLine',
    visible: true,
    locked: false,
    position: { x: 0, y: 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    zIndex: 0,
    points: points.length > 0 ? points : [{ x: 0.2, y: 0.5 }, { x: 0.5, y: 0.2 }, { x: 0.8, y: 0.5 }],
    closed: false,
    cornerStyle: 'sharp',
  };
}

export function createDefaultPolygon(sides: number = 6): PolygonShape {
  return {
    id: generateUUID(),
    type: 'polygon',
    visible: true,
    locked: false,
    position: { x: 0.5, y: 0.5 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    zIndex: 0,
    sides,
    radius: 0.15,
  };
}

export function createDefaultStar(points: number = 5): StarShape {
  return {
    id: generateUUID(),
    type: 'star',
    visible: true,
    locked: false,
    position: { x: 0.5, y: 0.5 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    zIndex: 0,
    points,
    outerRadius: 0.2,
    innerRadius: 0.1,
  };
}

export function createDefaultRing(): RingShape {
  return {
    id: generateUUID(),
    type: 'ring',
    visible: true,
    locked: false,
    position: { x: 0.5, y: 0.5 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    zIndex: 0,
    outerRadius: 0.2,
    innerRadius: 0.15,
  };
}

export function createDefaultSpiral(): SpiralShape {
  return {
    id: generateUUID(),
    type: 'spiral',
    visible: true,
    locked: false,
    position: { x: 0.5, y: 0.5 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    zIndex: 0,
    turns: 3,
    startRadius: 0.02,
    endRadius: 0.2,
  };
}

export function createDefaultFill(): SolidFill {
  return {
    type: 'solid',
    color: [1, 1, 1, 1],
  };
}

export function createDefaultStroke(): GlowStroke {
  return {
    type: 'glow',
    color: [0, 1, 0.5, 1],
    width: 3,
    glowSize: 15,
    glowIntensity: 1,
    pulseSpeed: 1,
  };
}

export function createDefaultAnimation(): ConcentricAnimation {
  return {
    type: 'concentric',
    count: 5,
    spacing: 0.03,
    speed: 1,
    direction: 'out',
    fadeOut: true,
    scaleVariation: 0,
  };
}

export function createDrawingElement(shape: Shape): DrawingElement {
  return {
    id: generateUUID(),
    name: `${shape.type.charAt(0).toUpperCase() + shape.type.slice(1)}`,
    shape,
    fill: { type: 'none' },
    stroke: createDefaultStroke(),
    animation: { type: 'none' },
    warpCorners: createDefaultShapeWarp(),
    warpEnabled: false,
    meshWarp: createDefaultShapeMesh(3, 3),
    meshWarpEnabled: false,
    shadowEnabled: false,
    blendMode: 'add',
    opacity: 1,
  };
}

export function createDrawingLayer(name: string): DrawingLayer {
  return {
    id: generateUUID(),
    name,
    elements: [],
    backgroundColor: [0, 0, 0, 0],
    visible: true,
    locked: false,
    opacity: 1,
  };
}
