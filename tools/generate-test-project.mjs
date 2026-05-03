#!/usr/bin/env node
/**
 * generate-test-project.mjs
 *
 * Builds a comprehensive Pro-feature test project (.gha) that exercises
 * every major surface added in the recent dual-deck + crossfader + macros
 * + snapshots pass:
 *
 *   .gha format version 1.9.0:
 *     - 4-layer projection-mapping composition with shader/video/image/lines
 *     - VJ Clip Launcher: 4 layers × 8 columns, populated on BOTH banks
 *     - Crossfader enabled at 0.5 with dissolve transition + normal blend mode
 *     - Quantization 1bar (clip launches snap to bar boundaries)
 *     - All 8 macro knobs with sensible defaults + a couple set to pulse
 *     - 4 snapshots saved into slots 1, 2, 5, 9 with distinct scenes
 *     - 2 VJ compositions (clip-launcher presets) for instant scene swaps
 *     - 1 stage preset
 *     - 1 SynthVision keyboard preset
 *
 * Output:
 *     test-projects/Test_Full_Pro_v1.gha         (main, exercises everything)
 *     test-projects/README.md                    (what to look for)
 *
 * Usage:
 *     node tools/generate-test-project.mjs
 *
 * Re-run any time the .gha format bumps — the script is the source of
 * truth for the comprehensive-test fixture and the README explains what
 * a tester should verify in the app after loading the file.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(REPO_ROOT, 'test-projects');

// Use a deterministic UUID generator for the test project so re-running
// the script doesn't churn IDs in the committed file diff. Salt with a
// stable string per call site so each entity (layer 1, layer 2, snap 1,
// macro 1, etc.) gets a unique-but-stable id.
let _uuidCounter = 0;
function uuid(salt = '') {
  _uuidCounter += 1;
  const h = crypto.createHash('sha1').update(`testproj/${salt}/${_uuidCounter}`).digest('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
}

// ─── Shader sources (small, self-contained, no external deps) ────────────

const SOLID_COLOR_FS = `/*{
  "DESCRIPTION": "Solid colour fill — used as a layer-bg test",
  "CREDIT": "Ghost Arcade",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator"],
  "INPUTS": [
    {"NAME": "tint", "TYPE": "color", "DEFAULT": [0.95, 0.30, 0.18, 1.0]}
  ]
}*/
void main() { gl_FragColor = tint; }
`;

const RADIAL_PULSE_FS = `/*{
  "DESCRIPTION": "Radial pulse — speed + width + colour",
  "CREDIT": "Ghost Arcade",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator"],
  "INPUTS": [
    {"NAME": "speed", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 4.0},
    {"NAME": "width", "TYPE": "float", "DEFAULT": 0.25, "MIN": 0.05, "MAX": 1.0},
    {"NAME": "tint",  "TYPE": "color", "DEFAULT": [0.49, 0.78, 0.89, 1.0]}
  ]
}*/
void main() {
  vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
  vec2 c  = uv - 0.5;
  float r = length(c);
  float t = TIME * speed;
  float pulse = smoothstep(width, 0.0, abs(fract(r * 4.0 - t) - 0.5));
  gl_FragColor = vec4(tint.rgb * pulse, 1.0);
}
`;

const KALEIDOSCOPE_FS = `/*{
  "DESCRIPTION": "Kaleidoscope — segments + speed",
  "CREDIT": "Ghost Arcade",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator"],
  "INPUTS": [
    {"NAME": "segments", "TYPE": "float", "DEFAULT": 6.0, "MIN": 2.0, "MAX": 24.0},
    {"NAME": "speed",    "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 4.0},
    {"NAME": "saturation", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 2.0}
  ]
}*/
vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
  float a = atan(uv.y, uv.x);
  float r = length(uv);
  float seg = 6.28318 / segments;
  a = mod(a, seg);
  if (a > seg * 0.5) a = seg - a;
  vec2 p = vec2(cos(a), sin(a)) * r;
  float t = TIME * speed;
  vec3 col = hsv2rgb(vec3(p.x + t * 0.1, saturation, 0.5 + 0.5 * sin(p.y * 8.0 + t)));
  gl_FragColor = vec4(col, 1.0);
}
`;

const TUNNEL_FS = `/*{
  "DESCRIPTION": "Tunnel zoom — speed + depth",
  "CREDIT": "Ghost Arcade",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator"],
  "INPUTS": [
    {"NAME": "speed", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 4.0},
    {"NAME": "depth", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.5, "MAX": 4.0}
  ]
}*/
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
  float r = length(uv) * depth;
  float a = atan(uv.y, uv.x);
  float t = TIME * speed;
  float v = sin(1.0 / r * 4.0 + t * 2.0) * 0.5 + 0.5;
  float col = v * (0.4 + 0.6 * sin(a * 6.0 + t));
  gl_FragColor = vec4(vec3(col, col * 0.7, col * 1.2), 1.0);
}
`;

// ─── Helper builders ─────────────────────────────────────────────────────

const DEFAULT_CORNERS = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

function defaultMeshGrid() {
  const rows = 5, cols = 5;
  const points = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      row.push({ x: c / (cols - 1), y: r / (rows - 1) });
    }
    points.push(row);
  }
  return { rows, cols, points };
}

function makeShaderLayer({ name, shaderCode, shaderValues = {}, vjLayerIndex }) {
  const layerId = uuid(`layer/${name}`);
  return {
    id: layerId,
    name,
    type: 'media',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    position: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
    flipH: false,
    flipV: false,
    corners: DEFAULT_CORNERS,
    warpMode: 'corner',
    meshGrid: defaultMeshGrid(),
    mask: null,
    cropRegion: null,
    layerShape: 'rect',
    effects: [],
    edgeEffects: [],
    vjLayerIndex,
    contentFit: 'cover',
    renderQuality: 'high',
    parentGroupId: null,
    groupConfig: null,
    groupCollapsed: false,
    source: {
      id: uuid(`source/${name}`),
      type: 'shader',
      src: '',
      name: `${name} (shader)`,
      shaderCode,
      shaderInputs: [],
      shaderValues,
      shaderImageInputs: {},
      playbackMode: 'loop',
      playbackRate: 1,
    },
    linesContent: null,
    svgContent: null,
    colorContent: null,
    lightPaintingContent: null,
    textContent: null,
  };
}

function makeColorLayer({ name, color, opacity = 1, vjLayerIndex }) {
  return {
    id: uuid(`layer/${name}`),
    name,
    type: 'color',
    visible: true,
    locked: false,
    opacity,
    blendMode: 'normal',
    position: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
    flipH: false,
    flipV: false,
    corners: DEFAULT_CORNERS,
    warpMode: 'corner',
    meshGrid: defaultMeshGrid(),
    mask: null,
    cropRegion: null,
    layerShape: 'rect',
    effects: [],
    edgeEffects: [],
    vjLayerIndex,
    contentFit: 'cover',
    renderQuality: 'high',
    parentGroupId: null,
    groupConfig: null,
    groupCollapsed: false,
    source: null,
    linesContent: null,
    svgContent: null,
    colorContent: { color, opacity },
    lightPaintingContent: null,
    textContent: null,
  };
}

// VJ clip — minimal shape that the launcher's hydrate() accepts.
function shaderClip({ name, shaderCode, shaderValues = {} }) {
  return {
    id: uuid(`clip/${name}`),
    type: 'shader',
    name,
    src: '',
    thumbnail: null,
    shaderCode,
    shaderValues,
    spoutSource: null,
    effectSource: null,
    jsAnimation: null,
    effects: [],
  };
}

// VJ layer state (per-layer fader/blend/solo/mute on a deck).
function layerState({ opacity = 1, blendMode = 'normal', solo = false, mute = false, activeColumn = -1, activeClip = null } = {}) {
  return { opacity, blendMode, solo, mute, activeColumn, activeClip, effects: [] };
}

// ─── Build the main project ──────────────────────────────────────────────

const NUM_VJ_LAYERS = 4;
const NUM_VJ_COLUMNS = 8;

// Shared pool of clips that we'll thread into both banks. Bank A = "feel"
// scene (slow, lush, melodic). Bank B = "drop" scene (fast, harsh,
// rhythmic). The crossfader at 0.5 lets the operator scrub between the two.
const POOL_A = [
  shaderClip({ name: 'A1 · Pulse Slow',  shaderCode: RADIAL_PULSE_FS,  shaderValues: { speed: 0.4, width: 0.45, tint: [0.49, 0.78, 0.89, 1] } }),
  shaderClip({ name: 'A2 · Kaleido 6',   shaderCode: KALEIDOSCOPE_FS, shaderValues: { segments: 6, speed: 0.3, saturation: 0.9 } }),
  shaderClip({ name: 'A3 · Tunnel Lush', shaderCode: TUNNEL_FS,       shaderValues: { speed: 0.5, depth: 1.6 } }),
  shaderClip({ name: 'A4 · Solid Coral', shaderCode: SOLID_COLOR_FS,  shaderValues: { tint: [0.95, 0.30, 0.18, 1] } }),
  shaderClip({ name: 'A5 · Pulse Mid',   shaderCode: RADIAL_PULSE_FS,  shaderValues: { speed: 1.2, width: 0.20, tint: [0.6, 0.4, 0.9, 1] } }),
  shaderClip({ name: 'A6 · Kaleido 8',   shaderCode: KALEIDOSCOPE_FS, shaderValues: { segments: 8, speed: 0.6, saturation: 1.4 } }),
  shaderClip({ name: 'A7 · Tunnel Tight', shaderCode: TUNNEL_FS,      shaderValues: { speed: 1.1, depth: 2.4 } }),
  shaderClip({ name: 'A8 · Solid Cyan',  shaderCode: SOLID_COLOR_FS,  shaderValues: { tint: [0.28, 0.78, 0.85, 1] } }),
];

const POOL_B = [
  shaderClip({ name: 'B1 · Pulse Fast',  shaderCode: RADIAL_PULSE_FS,  shaderValues: { speed: 3.6, width: 0.10, tint: [1.0, 0.10, 0.55, 1] } }),
  shaderClip({ name: 'B2 · Kaleido 16',  shaderCode: KALEIDOSCOPE_FS, shaderValues: { segments: 16, speed: 2.0, saturation: 1.8 } }),
  shaderClip({ name: 'B3 · Tunnel Warp', shaderCode: TUNNEL_FS,       shaderValues: { speed: 3.0, depth: 3.5 } }),
  shaderClip({ name: 'B4 · Solid Magenta', shaderCode: SOLID_COLOR_FS, shaderValues: { tint: [1.0, 0.0, 0.7, 1] } }),
  shaderClip({ name: 'B5 · Pulse Strobe', shaderCode: RADIAL_PULSE_FS, shaderValues: { speed: 4.0, width: 0.05, tint: [1.0, 1.0, 1.0, 1] } }),
  shaderClip({ name: 'B6 · Kaleido Wild', shaderCode: KALEIDOSCOPE_FS, shaderValues: { segments: 12, speed: 4.0, saturation: 2.0 } }),
  shaderClip({ name: 'B7 · Tunnel Black', shaderCode: TUNNEL_FS,      shaderValues: { speed: 2.5, depth: 4.0 } }),
  shaderClip({ name: 'B8 · Solid Lime',  shaderCode: SOLID_COLOR_FS,  shaderValues: { tint: [0.1, 1.0, 0.3, 1] } }),
];

// Build clip grids. clipGrid[layer][column].
function buildGrid(pool) {
  return Array.from({ length: NUM_VJ_LAYERS }, (_, layerIdx) =>
    Array.from({ length: NUM_VJ_COLUMNS }, (_, colIdx) => {
      // Spread pool across the grid so every cell has something.
      const idx = (layerIdx * NUM_VJ_COLUMNS + colIdx) % pool.length;
      const base = pool[idx];
      // Each cell needs its own id so triggering doesn't collide.
      return { ...base, id: uuid(`gridcell/${layerIdx}-${colIdx}-${base.name}`) };
    })
  );
}

const clipGridA = buildGrid(POOL_A);
const clipGridB = buildGrid(POOL_B);

// Active state per bank: layer 0 has its column-2 clip live.
const layerStatesA = [
  layerState({ opacity: 1.0, blendMode: 'normal',     activeColumn: 2, activeClip: clipGridA[0][2] }),
  layerState({ opacity: 0.6, blendMode: 'screen',     activeColumn: -1 }),
  layerState({ opacity: 0.4, blendMode: 'add',        activeColumn: -1 }),
  layerState({ opacity: 0.0, blendMode: 'multiply',   activeColumn: -1, mute: true }),
];

const layerStatesB = [
  layerState({ opacity: 1.0, blendMode: 'normal',     activeColumn: 0, activeClip: clipGridB[0][0] }),
  layerState({ opacity: 0.5, blendMode: 'difference', activeColumn: -1 }),
  layerState({ opacity: 0.2, blendMode: 'overlay',    activeColumn: -1 }),
  layerState({ opacity: 1.0, blendMode: 'normal',     activeColumn: -1, solo: true }),
];

// Two blocks (a "block" = a clip-grid scene the user can swap). Bank A
// + Bank B grids live INSIDE each block (v1.8.0 schema).
const blockId1 = uuid('block/main');
const blockId2 = uuid('block/breakdown');
const blocks = [
  {
    id: blockId1,
    name: 'Main',
    clipGrid: clipGridA,
    bankBClipGrid: clipGridB,
  },
  {
    id: blockId2,
    name: 'Breakdown',
    clipGrid: buildGrid([...POOL_A].reverse()),
    bankBClipGrid: buildGrid([...POOL_B].reverse()),
  },
];

// Macros — assign meaningful destinations on a few of them so the
// operator can see the wiring. Format mirrors macros.ts hydrate()
// expectations exactly.
const macroIds = Array.from({ length: 8 }, (_, i) => `macro-${i + 1}`);
const macros = [
  // ENERGY: master opacity + crossfader value (one knob = whole-show energy)
  {
    id: macroIds[0], name: 'ENERGY', color: '#FF8577', value: 0.5,
    pulseMode: 'off', pulseShape: 'sine',
    destinations: [
      { id: uuid('dest/energy/master'),     targetPath: 'vj:master:opacity',   targetLabel: 'Master Opacity', min: 0.2, max: 1.0, curve: 'exp',  enabled: true },
      { id: uuid('dest/energy/xfade'),      targetPath: 'vj:crossfader:value', targetLabel: 'Crossfader',     min: 0.0, max: 1.0, curve: 'linear', enabled: true },
    ],
  },
  // CHAOS: kaleido segments + tunnel speed on layer 1
  {
    id: macroIds[1], name: 'CHAOS', color: '#7EC8E3', value: 0.0,
    pulseMode: 'off', pulseShape: 'sine',
    destinations: [
      { id: uuid('dest/chaos/segments'), targetPath: 'vj:1:shader:segments', targetLabel: 'L1 Segments', min: 4, max: 24, curve: 'linear', enabled: true },
      { id: uuid('dest/chaos/speed'),    targetPath: 'vj:2:shader:speed',     targetLabel: 'L2 Speed',    min: 0.5, max: 4.0, curve: 'exp', enabled: true },
    ],
  },
  // DRAMA: layer 0 opacity + layer 3 opacity inverse (push one, pull the other)
  {
    id: macroIds[2], name: 'DRAMA', color: '#BB86FC', value: 0.5,
    pulseMode: 'off', pulseShape: 'sine',
    destinations: [
      { id: uuid('dest/drama/L0'), targetPath: 'vj:0:opacity', targetLabel: 'L0 Opacity', min: 0, max: 1, curve: 'linear',  enabled: true },
      { id: uuid('dest/drama/L3'), targetPath: 'vj:3:opacity', targetLabel: 'L3 Opacity', min: 0, max: 1, curve: 'inverse', enabled: true },
    ],
  },
  // BUILD: pulse on 2-bar, drives layer 1 opacity (auto-rises across 2 bars)
  {
    id: macroIds[3], name: 'BUILD', color: '#22c55e', value: 0,
    pulseMode: '2bar', pulseShape: 'saw-up',
    destinations: [
      { id: uuid('dest/build/L1'), targetPath: 'vj:1:opacity', targetLabel: 'L1 Opacity', min: 0, max: 1, curve: 'linear', enabled: true },
    ],
  },
  // SUB: pulse 1/4 square, strobes layer 2 opacity
  {
    id: macroIds[4], name: 'SUB', color: '#f97316', value: 0,
    pulseMode: '1/4', pulseShape: 'square',
    destinations: [
      { id: uuid('dest/sub/L2'), targetPath: 'vj:2:opacity', targetLabel: 'L2 Opacity', min: 0, max: 0.6, curve: 'linear', enabled: true },
    ],
  },
  // AIR: empty — operator can MIDI-Learn live during testing
  { id: macroIds[5], name: 'AIR', color: '#3b82f6', value: 0.5, pulseMode: 'off', pulseShape: 'sine', destinations: [] },
  // FX: empty
  { id: macroIds[6], name: 'FX', color: '#ec4899', value: 0.5, pulseMode: 'off', pulseShape: 'sine', destinations: [] },
  // WILD: empty
  { id: macroIds[7], name: 'WILD', color: '#eab308', value: 0.5, pulseMode: 'off', pulseShape: 'sine', destinations: [] },
];

// Snapshots — populate slots 1, 2, 5, 9 with distinct scenes. Each
// snapshot captures crossfader, master opacity, per-layer state on
// both decks, and macro values. Slots 3, 4, 6, 7, 8, 10..16 stay empty
// so the operator can write live ones during testing.
function snapAt(slot, name, color, scene) {
  return {
    id: `snap-${slot}`,
    slot,
    name,
    color,
    capturedAt: 1715000000000 + slot * 1000, // deterministic past timestamp
    layerStatesA: scene.A,
    layerStatesB: scene.B,
    crossfaderEnabled: scene.crossfaderEnabled,
    crossfaderValue: scene.crossfaderValue,
    crossfaderTransition: scene.crossfaderTransition || 'dissolve',
    crossfaderCurve: scene.crossfaderCurve || 'constant-power',
    quantization: scene.quantization || '1bar',
    masterOpacity: scene.masterOpacity ?? 1,
    selectedDeck: scene.selectedDeck || 'A',
    macroValues: scene.macroValues,
  };
}

const snapshots = [
  snapAt(1, 'Open · Soft A', '#FF8577', {
    A: layerStatesA.map(ls => ({ opacity: ls.opacity, blendMode: ls.blendMode, solo: ls.solo, mute: ls.mute })),
    B: [0,0,0,0].map(() => ({ opacity: 0, blendMode: 'normal', solo: false, mute: false })),
    crossfaderEnabled: true, crossfaderValue: 0.0,
    masterOpacity: 0.6, selectedDeck: 'A',
    macroValues: { 'macro-1': 0.3, 'macro-2': 0.0, 'macro-3': 0.4, 'macro-4': 0, 'macro-5': 0, 'macro-6': 0.5, 'macro-7': 0.5, 'macro-8': 0.5 },
  }),
  snapAt(2, 'Build · Mix 50', '#7EC8E3', {
    A: layerStatesA.map(ls => ({ opacity: ls.opacity * 0.7, blendMode: ls.blendMode, solo: ls.solo, mute: ls.mute })),
    B: layerStatesB.map(ls => ({ opacity: ls.opacity * 0.5, blendMode: ls.blendMode, solo: ls.solo, mute: ls.mute })),
    crossfaderEnabled: true, crossfaderValue: 0.5,
    masterOpacity: 0.85, selectedDeck: 'A',
    macroValues: { 'macro-1': 0.55, 'macro-2': 0.4, 'macro-3': 0.6, 'macro-4': 0.5, 'macro-5': 0.3, 'macro-6': 0.5, 'macro-7': 0.5, 'macro-8': 0.5 },
  }),
  snapAt(5, 'Drop · Hard B', '#BB86FC', {
    A: [0,0,0,0].map(() => ({ opacity: 0, blendMode: 'normal', solo: false, mute: true })),
    B: layerStatesB.map(ls => ({ opacity: 1, blendMode: ls.blendMode, solo: ls.solo, mute: false })),
    crossfaderEnabled: true, crossfaderValue: 1.0,
    crossfaderTransition: 'cut',
    masterOpacity: 1.0, selectedDeck: 'B',
    macroValues: { 'macro-1': 1.0, 'macro-2': 0.95, 'macro-3': 0.9, 'macro-4': 1.0, 'macro-5': 1.0, 'macro-6': 0.5, 'macro-7': 0.5, 'macro-8': 0.5 },
  }),
  snapAt(9, 'Breakdown · Solo L3', '#22c55e', {
    A: [0,0,0,0].map((_, i) => ({ opacity: i === 3 ? 1 : 0, blendMode: 'normal', solo: i === 3, mute: i !== 3 })),
    B: [0,0,0,0].map(() => ({ opacity: 0, blendMode: 'normal', solo: false, mute: true })),
    crossfaderEnabled: true, crossfaderValue: 0.0,
    crossfaderTransition: 'wipeleft',
    masterOpacity: 0.4, selectedDeck: 'A',
    macroValues: { 'macro-1': 0.2, 'macro-2': 0.0, 'macro-3': 0.0, 'macro-4': 0, 'macro-5': 0, 'macro-6': 0.5, 'macro-7': 0.5, 'macro-8': 0.5 },
  }),
];

// Composition presets (clip-launcher scenes, separate from snapshots —
// these are full-state replacements vs snapshots which are quick recall).
const composition1Id = uuid('comp/festival');
const composition2Id = uuid('comp/intimate');

// Stage preset — saved positioning of layers on physical surfaces
const stagePresetId = uuid('stagepreset/main');
const stagePresets = [
  {
    id: stagePresetId,
    name: 'Main Wall + Side Cubes',
    createdAt: 1714900000000,
    layers: [
      { layerId: null, position: { x: 0.5, y: 0.5 }, scale: { x: 1, y: 1 }, rotation: 0, corners: DEFAULT_CORNERS },
    ],
  },
];

// SynthVision keyboard preset — one of the Pro performer-mode features
const svKeyboardPresets = [
  {
    id: uuid('sv/preset1'),
    name: 'Live Set 1',
    createdAt: 1714900000000,
    keyboardLayout: 'A2-C5',
    samples: [],
    notes: 'Test keyboard preset — assign clips during live use.',
  },
];

// Project layers — 4 layers exposing the main projection surfaces.
const layers = [
  makeShaderLayer({ name: 'L0 · Backdrop',  shaderCode: SOLID_COLOR_FS,    shaderValues: { tint: [0.05, 0.05, 0.10, 1] }, vjLayerIndex: 0 }),
  makeShaderLayer({ name: 'L1 · Pulse',     shaderCode: RADIAL_PULSE_FS,   shaderValues: { speed: 0.8, width: 0.30, tint: [0.49, 0.78, 0.89, 1] }, vjLayerIndex: 1 }),
  makeShaderLayer({ name: 'L2 · Kaleido',   shaderCode: KALEIDOSCOPE_FS,   shaderValues: { segments: 6, speed: 0.5, saturation: 1.2 }, vjLayerIndex: 2 }),
  makeShaderLayer({ name: 'L3 · Accent',    shaderCode: TUNNEL_FS,         shaderValues: { speed: 0.7, depth: 1.5 }, vjLayerIndex: 3 }),
];

const PROJECT_ID = uuid('project/main');

// Build the main project payload.
const mainProject = {
  version: '1.9.0',
  exportedAt: '2026-05-01T20:00:00.000Z',
  project: {
    id: PROJECT_ID,
    name: 'Test · Full Pro v1',
    width: 1920,
    height: 1080,
    selectedLayerId: layers[1].id,
    layers,
    vjMode: {
      enabled: true,
      activeCompositionId: composition1Id,
      masterOpacity: 0.85,
      compositions: [
        {
          id: composition1Id,
          name: 'Festival Main',
          thumbnail: null,
          createdAt: 1714900000000,
          layers: layers.map((l, i) => ({ ...l, opacity: i === 0 ? 0.5 : 1 })),
          synthVision: null,
        },
        {
          id: composition2Id,
          name: 'Intimate Set',
          thumbnail: null,
          createdAt: 1714900100000,
          layers: layers.map(l => ({ ...l, opacity: 0.6 })),
          synthVision: null,
        },
      ],
      decks: [],
      timeline: { clips: [], loop: false, totalDuration: 0, isPlaying: false, currentTime: 0 },
    },
    mediaFolders: [],
    stagePresets,
    svKeyboardPresets,
  },
  mediaLibrary: [],
  vjClipLauncher: {
    numLayers: NUM_VJ_LAYERS,
    numColumns: NUM_VJ_COLUMNS,
    blocks,
    activeBlockId: blockId1,
    layerStates: layerStatesA,
    bankBLayerStates: layerStatesB,
    crossfaderEnabled: true,
    crossfaderValue: 0.5,
    crossfaderTransition: 'dissolve',
    crossfaderCurve: 'constant-power',
    selectedDeck: 'A',
    quantization: '1bar',
    masterOpacity: 0.85,
    isOpen: true,
    isLive: false,
    compositionEffects: [],
    stageMode: false,
    stagePresetId: stagePresetId,
  },
  modulation: [],
  keyframeTimelines: [],
  macros: { macros },
  snapshots: { snapshots },
};

// ─── Write ───────────────────────────────────────────────────────────────

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const mainPath = path.join(OUT_DIR, 'Test_Full_Pro_v1.gha');

fs.writeFileSync(mainPath, JSON.stringify(mainProject, null, 2));

const mainStat = fs.statSync(mainPath);

console.log(`[generate-test-project] Wrote:`);
console.log(`  ${mainPath} (${(mainStat.size / 1024).toFixed(1)} KB)`);
console.log(`[generate-test-project] Done.`);
