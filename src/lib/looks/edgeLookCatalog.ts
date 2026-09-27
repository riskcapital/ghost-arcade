// The curated Looks. Each recipe reads colours a (primary), b (secondary)
// and c (accent) so every Look works in every palette. Beat reactions use
// the beat clock unless noted, so they move on a tapped or typed tempo too.

import type { EdgeEffectReact } from '../types';
import type { LookDef } from './edgeLooks';

const beat = (mode: EdgeEffectReact['mode'], amount: number, extra: Partial<EdgeEffectReact> = {}): EdgeEffectReact =>
  ({ mode, source: 'beat', amount, ...extra });

export const EDGE_LOOKS: LookDef[] = [
  {
    id: 'neon-pulse', name: 'Neon Pulse', palette: 'neon',
    blurb: 'Neon outlines that pump on every beat, rippling across the group.',
    build: ({ a, b }) => [
      { stroke: { type: 'neon', color: a, width: 3, glowSize: 26, flickerSpeed: 0 }, blendMode: 'add', react: beat('pulse', 0.8, { chaseBeats: 0.125 }) },
      { stroke: { type: 'offset', color: b, width: 1.5, count: 2, spacing: 12, direction: 'inset' }, opacity: 0.7, react: beat('boost', 0.7, { chaseBeats: 0.125 }) },
    ],
  },
  {
    id: 'kick-strobe', name: 'Kick Strobe', palette: 'neon',
    blurb: 'Solid faces flash on the kick; the beat clock drives it with no audio.',
    build: ({ a, white }) => [
      { fill: { type: 'solid', color: a, opacity: 1 }, react: { mode: 'strobe', source: 'kick', amount: 1, decay: 1.5 } },
      { stroke: { type: 'solid', color: white, width: 2 } },
    ],
  },
  {
    id: 'comet-chase', name: 'Comet Chase', palette: 'ice',
    blurb: 'Comets race around each shape, one shape after another.',
    build: ({ a, b }) => [
      { stroke: { type: 'solid', color: b, width: 1.5 }, opacity: 0.35 },
      { stroke: { type: 'comet', color: a, width: 4, tailLength: 0.5, headSize: 2.5, speed: 0.35 }, chaseMode: 'order', chaseSpread: 1.2, react: beat('boost', 0.7) },
    ],
  },
  {
    id: 'beat-step', name: 'Beat Step', palette: 'candy',
    blurb: 'One shape lights per beat, stepping through the group.',
    build: ({ a, b }) => [
      { fill: { type: 'solid', color: a, opacity: 0.9 }, react: beat('step', 1) },
      { stroke: { type: 'solid', color: b, width: 2 }, opacity: 0.85 },
    ],
  },
  {
    id: 'stripe-sweep', name: 'Stripe Sweep', palette: 'acid',
    blurb: 'Diagonal stripes roll left to right and punch on the beat.',
    build: ({ a, clear }) => [
      { fill: { type: 'stripes', color: a, color2: clear, angle: 45, stripeWidth: 14, speed: 0.8 }, chaseMode: 'leftToRight', chaseSpread: 1, react: beat('pulse', 0.55, { chaseBeats: 0.25 }) },
      { stroke: { type: 'solid', color: a, width: 2 } },
    ],
  },
  {
    id: 'halftone-breathe', name: 'Halftone Breathe', palette: 'sunset',
    blurb: 'Print-style dots swell and fade with the pulse.',
    build: ({ a, b, clear }) => [
      { fill: { type: 'halftone', color: a, color2: clear, cell: 16, angle: 30, source: 'gradient', speed: 0.4 }, react: beat('pulse', 0.6, { decay: 0.5, chaseBeats: 0.25 }) },
      { stroke: { type: 'solid', color: b, width: 1.5 } },
    ],
  },
  {
    id: 'wireframe-origami', name: 'Wireframe Origami', palette: 'ice',
    blurb: 'Folding facets under a wireframe that flares on the beat.',
    build: ({ a, b }) => [
      { fill: { type: 'origami', color: a, depth: 0.8, speed: 0.3 }, chaseMode: 'order', chaseSpread: 1 },
      { stroke: { type: 'wireframe', color: b, width: 1.5 }, react: beat('boost', 0.8, { chaseBeats: 0.25 }) },
    ],
  },
  {
    id: 'marching-ants', name: 'Marching Ants', palette: 'mono',
    blurb: 'Dashes that march one cycle per beat, with corner accents that pop.',
    build: ({ a, c }) => [
      { stroke: { type: 'marchingAnts', color: a, width: 3, dash1: 14, gap1: 10, beatLock: true } },
      { stroke: { type: 'corners', color: c, width: 5, length: 26 }, react: beat('boost', 1) },
    ],
  },
  {
    id: 'radar-scan', name: 'Radar Scan', palette: 'ocean',
    blurb: 'A scan line sweeps across the stage; outlines glow with the beat.',
    build: ({ a, b }) => [
      { fill: { type: 'scanLine', color: a, lineWidth: 10, angle: 90, progressMode: 'pingpong', speed: 0.5 }, chaseMode: 'leftToRight', chaseSpread: 1 },
      { stroke: { type: 'glow', color: b, width: 2, glowSize: 16, pulseSpeed: 0 }, blendMode: 'add', react: beat('pulse', 0.5) },
    ],
  },
  {
    id: 'hypno-rings', name: 'Hypno Rings', palette: 'candy',
    blurb: 'Concentric bands pour inward under a neon edge.',
    build: ({ a, b, clear }) => [
      { fill: { type: 'hypnotic', color: a, color2: clear, band: 16, speed: 0.7 } },
      { stroke: { type: 'neon', color: b, width: 2, glowSize: 18, flickerSpeed: 0 }, blendMode: 'add', react: beat('pulse', 0.6, { chaseBeats: 0.125 }) },
    ],
  },
  {
    id: 'hue-hop', name: 'Hue Hop', palette: 'neon',
    blurb: 'Faces jump to a new colour on every beat, out of step with each other.',
    build: ({ a, white }) => [
      { fill: { type: 'solid', color: a, opacity: 0.85 }, react: beat('pulse', 0.35, { hueStep: 1 / 6, chaseBeats: 1 }) },
      { stroke: { type: 'solid', color: white, width: 2 } },
    ],
  },
  {
    id: 'laser-grid', name: 'Laser Grid', palette: 'acid',
    blurb: 'A turning laser grid that pulses out from the centre.',
    build: ({ a }) => [
      { fill: { type: 'grid', color: a, spacing: 22, lineWidth: 1.5, rotateSpeed: 12 }, chaseMode: 'radial', react: beat('pulse', 0.7, { chaseBeats: 0.25 }) },
      { stroke: { type: 'glow', color: a, width: 2, glowSize: 20, pulseSpeed: 0 }, blendMode: 'add' },
    ],
  },
  {
    id: 'iris-pop', name: 'Iris Pop', palette: 'sunset',
    blurb: 'Each face opens like an iris, once per beat.',
    build: ({ a, b }) => [
      { fill: { type: 'iris', color: a, progressMode: 'beat', speed: 1, progress: 1 } },
      { stroke: { type: 'solid', color: b, width: 2 } },
    ],
  },
  {
    id: 'electric-nodes', name: 'Electric Nodes', palette: 'ice',
    blurb: 'Crackling arcs with corner nodes that burst on the beat.',
    build: ({ a, c }) => [
      { stroke: { type: 'electric', color: a, width: 2, arcIntensity: 1.5, speed: 1.2 }, blendMode: 'add' },
      { stroke: { type: 'vertexDots', color: c, width: 2, radius: 6, burst: 1.5 }, react: beat('boost', 0.8) },
    ],
  },
  {
    id: 'zigzag', name: 'Zig-Zag', palette: 'acid',
    blurb: 'Edges vibrate as running zig-zags that pulse with the beat.',
    build: ({ a, b }) => [
      { stroke: { type: 'solid', color: b, width: 1 }, opacity: 0.4 },
      { stroke: { type: 'zigzag', color: a, width: 3, amplitude: 7, wavelength: 28, speed: 2 }, react: beat('pulse', 0.6, { chaseBeats: 0.25 }) },
    ],
  },
  {
    id: 'clock-wipe', name: 'Clock Wipe', palette: 'ocean',
    blurb: 'Faces fill like clock hands, one after another.',
    build: ({ a, b }) => [
      { fill: { type: 'clockWipe', color: a, progressMode: 'loop', speed: 0.5 }, opacity: 0.9, chaseMode: 'order', chaseSpread: 1 },
      { stroke: { type: 'solid', color: b, width: 2 }, react: beat('boost', 0.8) },
    ],
  },
  {
    id: 'echo-rings', name: 'Echo Rings', palette: 'neon',
    blurb: 'Glowing outlines throw echoes outward in time with the music.',
    build: ({ a }) => [
      { stroke: { type: 'glow', color: a, width: 3, glowSize: 18, pulseSpeed: 0 }, animation: { type: 'concentric', direction: 'out', count: 4, spacing: 0.04, speed: 0.8 }, blendMode: 'add', react: beat('pulse', 0.6, { chaseBeats: 0.125 }) },
    ],
  },
  {
    id: 'mosaic-shimmer', name: 'Mosaic Shimmer', palette: 'candy',
    blurb: 'Tiles flip in and out, spreading from the centre.',
    build: ({ a, b, clear }) => [
      { fill: { type: 'mosaic', color: a, color2: clear, cell: 20, progressMode: 'loop', speed: 0.6 }, chaseMode: 'radial', chaseSpread: 1 },
      { stroke: { type: 'solid', color: b, width: 1.5 }, react: beat('pulse', 0.5) },
    ],
  },
  {
    id: 'flip-cards', name: 'Flip Cards', palette: 'sunset',
    blurb: 'Faces flip over like cards in a wave.',
    build: ({ a, b }) => [
      { fill: { type: 'solid', color: a, opacity: 0.85 }, animation: { type: 'flipY', speed: 0.5, perspective: 0.6 }, chaseMode: 'order', chaseSpread: 1 },
      { stroke: { type: 'solid', color: b, width: 2 }, animation: { type: 'flipY', speed: 0.5, perspective: 0.6 }, chaseMode: 'order', chaseSpread: 1, react: beat('boost', 0.6) },
    ],
  },
  {
    id: 'twin-snakes', name: 'Twin Snakes', palette: 'acid',
    blurb: 'Two snakes chase round every edge over a dotted track.',
    build: ({ a, b }) => [
      { stroke: { type: 'dashed', color: b, width: 1.5, dashLength: 0.04, gapLength: 0.05, speed: 0.4 }, opacity: 0.6 },
      { stroke: { type: 'snake', color: a, width: 4, length: 0.22, snakeCount: 2, speed: 0.8 }, chaseMode: 'order', chaseSpread: 0.8, react: beat('boost', 0.7) },
    ],
  },
  {
    id: 'gradient-glow', name: 'Gradient Glow', palette: 'ocean',
    blurb: 'Slow-turning colour gradients that breathe on the beat.',
    build: ({ a, b, c }) => [
      { fill: { type: 'gradient', color: a, color2: b, gradientType: 'angular', angle: 0, speed: 0.4 }, opacity: 0.85, react: beat('pulse', 0.45, { decay: 0.6, chaseBeats: 0.25 }) },
      { stroke: { type: 'glow', color: c, width: 2, glowSize: 14, pulseSpeed: 0 }, blendMode: 'add' },
    ],
  },
  {
    id: 'rush-hour', name: 'Rush Hour', palette: 'fire',
    blurb: 'Fast double stripes with a hard strobe that rolls through the group.',
    build: ({ a, c, clear }) => [
      { fill: { type: 'doubleStripes', color: a, color2: clear, angle: -30, stripeWidth: 10, speed: 1.2 }, react: beat('strobe', 0.7, { chaseBeats: 0.5 }) },
      { stroke: { type: 'solid', color: c, width: 2 } },
    ],
  },
];

export function edgeLook(id: string | undefined): LookDef | undefined {
  return EDGE_LOOKS.find((look) => look.id === id);
}
