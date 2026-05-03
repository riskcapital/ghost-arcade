// Lines Layer Types — Line drawing with projection-mapping-grade effects
// No fills, no shapes — only lines with stroke effects and draw animations
import type { Point2D } from '../types';
import { generateUUID } from '../types';

export type { Point2D };

// ============================================================================
// DRAWING TOOL MODES
// ============================================================================

export type LineToolMode = 'select' | 'freehand' | 'pointClick';

// ============================================================================
// LINE SHAPES (only 2, not 18)
// ============================================================================

export interface FreehandLine {
  type: 'freehand';
  points: Point2D[];
  smoothing: number;        // 0-1 path smoothing
  pressure?: number[];      // Optional per-point pressure sensitivity
}

export interface PointClickLine {
  type: 'pointClick';
  points: Point2D[];
  closed: boolean;
  cornerStyle: 'sharp' | 'rounded' | 'chamfer';
  cornerRadius?: number;
}

export type LineShape = FreehandLine | PointClickLine;

// ============================================================================
// LINE STROKE TYPES (existing + 3 new)
// ============================================================================

export type LineStrokeType =
  // Basic
  | 'solid'
  | 'dashed'
  | 'dotted'
  // Glow family
  | 'glow'
  | 'neon'
  // Energy family
  | 'electric'
  | 'fire'
  // Animated path effects
  | 'snake'
  | 'multiTail'    // NEW: multiple animated tails following with spacing
  | 'pulse'
  | 'scanner'
  // Color
  | 'rainbow'
  // Projection mapping specials
  | 'laser'        // Clean bright projection line
  | 'pipe';        // 3D cylindrical tube illusion for PVC pipe mapping

// ── Existing stroke interfaces (from drawing/types.ts) ──

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
  length: number;        // 0-1, how much of the path is lit
  speed: number;
  tailFade: boolean;
  headGlow: boolean;
  bidirectional: boolean;
  snakeCount: number;    // Number of snakes on the path (1-8)
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

// ── NEW stroke interfaces ──

export interface MultiTailStroke {
  type: 'multiTail';
  color: [number, number, number, number];
  width: number;
  tailCount: number;         // 2-12 tails
  tailLength: number;        // 0-1, length of each tail segment
  spacing: number;           // 0-1, distance between tail starts
  speed: number;
  tailFade: boolean;         // Fade from head to tail end
  headGlow: boolean;         // Bright head point on each tail
  colorShift: boolean;       // Each tail shifts hue
  colorShiftAmount: number;  // 0-1 hue rotation per tail
}

export interface LaserStroke {
  type: 'laser';
  color: [number, number, number, number];
  width: number;
  intensity: number;         // Core brightness 0-3
  scatter: number;           // Atmospheric scatter glow 0-1
  flicker: number;           // Random intensity flicker 0-1
}

export interface PipeStroke {
  type: 'pipe';
  color: [number, number, number, number];
  width: number;
  depth: number;             // 3D depth illusion 0-1
  edgeLight: number;         // Edge highlight intensity 0-2
  edgeLightColor: [number, number, number, number];
  specular: number;          // Specular highlight band 0-1
  roughness: number;         // Surface roughness 0-1
}

// ── Line stroke union (no 'none' — lines must have a stroke) ──

export type LineStroke =
  | SolidStroke
  | DashedStroke
  | DottedStroke
  | GlowStroke
  | NeonStroke
  | ElectricStroke
  | SnakeStroke
  | MultiTailStroke
  | PulseStroke
  | ScannerStroke
  | RainbowStroke
  | LaserStroke
  | PipeStroke
  | FireStroke;

// ============================================================================
// DRAW ANIMATION (progress-based, borrowed from light painting)
// ============================================================================

export type LineLoopMode = 'once' | 'loop' | 'pingpong' | 'continuous';

export interface LineDrawAnimation {
  enabled: boolean;
  drawProgress: number;      // 0-1 how much of line is drawn (static or animated start)
  drawSpeed: number;         // Speed of draw animation 0.1-10
  trailLength: number;       // How much trail persists 0-1 (0 = full persist, 1 = instant fade)
  loopMode: LineLoopMode;
  reverse: boolean;          // Draw from end to start
  easing: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';
}

// ============================================================================
// PER-ELEMENT WARP (reused from drawing system for projection mapping)
// ============================================================================

export interface ShapeWarpCorners {
  topLeft: { x: number; y: number };
  topRight: { x: number; y: number };
  bottomLeft: { x: number; y: number };
  bottomRight: { x: number; y: number };
}

export interface ShapeMeshWarp {
  rows: number;
  cols: number;
  points: { x: number; y: number }[][];
}

// ============================================================================
// LINE ELEMENT (Shape + Stroke + DrawAnimation — no fill, no shape animation)
// ============================================================================

export interface LineElement {
  id: string;
  name: string;
  shape: LineShape;
  stroke: LineStroke;
  drawAnimation: LineDrawAnimation;
  visible: boolean;
  locked: boolean;
  zIndex: number;
  position: Point2D;        // Offset in normalized coords (0-1)
  rotation: number;         // Degrees
  scale: Point2D;
  // Per-element warp for projection mapping
  warpCorners: ShapeWarpCorners;
  warpEnabled: boolean;
  meshWarp: ShapeMeshWarp;
  meshWarpEnabled: boolean;
  // Compositing
  blendMode: 'normal' | 'add' | 'multiply' | 'screen';
  opacity: number;
}

// ============================================================================
// LINES CONTENT (replaces GenerativeContent on the Layer)
// ============================================================================

export interface LinesContent {
  elements: LineElement[];
  backgroundColor: [number, number, number, number]; // RGBA 0-1
  selectedElementId: string | null;
  // Layer-level animation settings
  globalDrawSpeed: number;       // Multiplier for all draw animations 0.1-5
  staggerMode: 'simultaneous' | 'sequential' | 'cascade' | 'solo' | 'random' | 'wave';
  staggerDelay: number;          // ms between staggered line starts
  waveWindowSize: number;        // How many elements visible at once in 'wave' mode
  // Layer-level post-process
  bloom: number;                 // Post-process bloom intensity 0-3
  afterglow: number;             // Lingering glow 0-1
  // Shared shader mask mode
  sharedShaderMode: boolean;     // When true, lines act as mask windows into a shared shader
  sharedShaderSourceId: string;  // ISF shader or video sourceId to render through all lines
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

export function createDefaultShapeWarp(): ShapeWarpCorners {
  return {
    topLeft: { x: 0, y: 0 },
    topRight: { x: 1, y: 0 },
    bottomLeft: { x: 0, y: 1 },
    bottomRight: { x: 1, y: 1 },
  };
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

export function createDefaultFreehandLine(points: Point2D[] = []): FreehandLine {
  return {
    type: 'freehand',
    points: points.length > 0
      ? points
      : [{ x: 0.3, y: 0.5 }, { x: 0.5, y: 0.3 }, { x: 0.7, y: 0.5 }],
    smoothing: 0.5,
  };
}

export function createDefaultPointClickLine(points: Point2D[] = []): PointClickLine {
  return {
    type: 'pointClick',
    points: points.length > 0
      ? points
      : [{ x: 0.2, y: 0.5 }, { x: 0.5, y: 0.2 }, { x: 0.8, y: 0.5 }],
    closed: false,
    cornerStyle: 'sharp',
  };
}

export function createDefaultLineStroke(): GlowStroke {
  return {
    type: 'glow',
    color: [0, 1, 0.5, 1],
    width: 3,
    glowSize: 15,
    glowIntensity: 1,
    pulseSpeed: 0,
  };
}

export function createDefaultDrawAnimation(): LineDrawAnimation {
  return {
    enabled: false,
    drawProgress: 1,       // Fully drawn by default
    drawSpeed: 1,
    trailLength: 0,        // Full persist
    loopMode: 'loop',
    reverse: false,
    easing: 'linear',
  };
}

export function createLineElement(shape: LineShape): LineElement {
  return {
    id: generateUUID(),
    name: shape.type === 'freehand' ? 'Freehand Line' : 'Point-Click Line',
    shape,
    stroke: createDefaultLineStroke(),
    drawAnimation: createDefaultDrawAnimation(),
    visible: true,
    locked: false,
    zIndex: 0,
    position: { x: 0, y: 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    warpCorners: createDefaultShapeWarp(),
    warpEnabled: false,
    meshWarp: createDefaultShapeMesh(3, 3),
    meshWarpEnabled: false,
    blendMode: 'add',
    opacity: 1,
  };
}

export function createDefaultLinesContent(): LinesContent {
  return {
    elements: [],
    backgroundColor: [0, 0, 0, 0],
    selectedElementId: null,
    globalDrawSpeed: 1,
    staggerMode: 'simultaneous',
    staggerDelay: 200,
    waveWindowSize: 3,
    bloom: 0,
    afterglow: 0,
    sharedShaderMode: false,
    sharedShaderSourceId: '',
  };
}
