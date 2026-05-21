/**
 * Stage Designer template catalog — one-click starter layouts.
 *
 * Each template is a function that takes the surface dimensions and
 * returns a list of `{ name, polygon }` slices. The store's
 * applyTemplate action calls into here, replaces (or appends to) the
 * active surface's slice list, and the user lands on a workable
 * geometry without drawing anything by hand.
 *
 * Layouts are designed at 1920×1080 reference and scale by aspect —
 * percentages everywhere, not absolute pixels. A 4K surface gets the
 * same proportional design.
 */

import type { BezierPoint, Point2D } from '../types';

export interface StageTemplate {
  id: string;
  label: string;
  /** Glyph for the palette button. Single character / short emoji. */
  icon: string;
  /** Builds the slice list. width / height are the active surface's
   *  dimensions; the function should generate slices proportional to
   *  those so an upscaled surface looks identical. */
  build: (width: number, height: number) => Array<{ name: string; polygon: BezierPoint[] }>;
}

// ─── Helpers ────────────────────────────────────────────────────────

/** Build a rectangle polygon in surface coords. */
function rectPolygon(x: number, y: number, w: number, h: number): BezierPoint[] {
  return [
    { x: x,     y: y },
    { x: x + w, y: y },
    { x: x + w, y: y + h },
    { x: x,     y: y + h },
  ];
}

/** Build a cubic-bezier circle polygon. Same 4-quadrant representation
 *  the premade Circle shape uses — `4/3 · tan(π/8)` magic constant. */
function circlePolygon(cx: number, cy: number, r: number): BezierPoint[] {
  const K = 0.5522847498307936 * r;
  return [
    { x: cx,     y: cy - r, cpIn: { x: cx + K, y: cy - r }, cpOut: { x: cx - K, y: cy - r } },
    { x: cx - r, y: cy,     cpIn: { x: cx - r, y: cy - K }, cpOut: { x: cx - r, y: cy + K } },
    { x: cx,     y: cy + r, cpIn: { x: cx - K, y: cy + r }, cpOut: { x: cx + K, y: cy + r } },
    { x: cx + r, y: cy,     cpIn: { x: cx + r, y: cy + K }, cpOut: { x: cx + r, y: cy - K } },
  ];
}

/** Hexagon polygon (pointy-top), centered at (cx, cy) with radius r. */
function hexagonPolygon(cx: number, cy: number, r: number): BezierPoint[] {
  const out: BezierPoint[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
    out.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return out;
}

/** Diamond (square rotated 45°). */
function diamondPolygon(cx: number, cy: number, r: number): BezierPoint[] {
  return [
    { x: cx,     y: cy - r },
    { x: cx + r, y: cy     },
    { x: cx,     y: cy + r },
    { x: cx - r, y: cy     },
  ];
}

// ─── Templates ──────────────────────────────────────────────────────

export const STAGE_TEMPLATES: StageTemplate[] = [
  {
    id: 'wall-of-circles',
    label: 'Wall of Circles',
    icon: '◯',
    build: (w, h) => {
      // 4 cols × 3 rows = 12 circles. Sized to ~80% of the per-cell
      // box so there's visible margin between neighbors.
      const cols = 4, rows = 3;
      const cellW = w / cols, cellH = h / rows;
      const r = Math.min(cellW, cellH) * 0.4;
      const out: Array<{ name: string; polygon: BezierPoint[] }> = [];
      let n = 1;
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const cx = (col + 0.5) * cellW;
          const cy = (row + 0.5) * cellH;
          out.push({ name: `Circle ${n++}`, polygon: circlePolygon(cx, cy, r) });
        }
      }
      return out;
    },
  },
  {
    id: 'vertical-stripes',
    label: 'Vertical Stripes',
    icon: '⊟',
    build: (w, h) => {
      // 8 thin vertical rectangles with even gaps between them.
      // Stripe width = 60% of column width; the 40% margin leaves
      // each stripe visually separated.
      const n = 8;
      const cellW = w / n;
      const stripeW = cellW * 0.6;
      const offset = (cellW - stripeW) / 2;
      const out: Array<{ name: string; polygon: BezierPoint[] }> = [];
      for (let i = 0; i < n; i++) {
        const x = i * cellW + offset;
        out.push({
          name: `Stripe ${i + 1}`,
          polygon: rectPolygon(x, h * 0.08, stripeW, h * 0.84),
        });
      }
      return out;
    },
  },
  {
    id: 'triptych',
    label: 'Triptych',
    icon: '⊞',
    build: (w, h) => {
      // Classic concert-stage triptych — wide cinema-ratio screen
      // in the middle, two vertical screens flanking it.
      const sidePad = w * 0.04;
      const sideW = w * 0.18;
      const sideH = h * 0.78;
      const sideY = (h - sideH) / 2;
      const centerW = w - 2 * sideW - 2 * sidePad - sidePad * 2;
      const centerH = h * 0.5;
      const centerX = sidePad + sideW + sidePad;
      const centerY = (h - centerH) / 2;
      return [
        { name: 'Left Vertical',  polygon: rectPolygon(sidePad, sideY, sideW, sideH) },
        { name: 'Center Cinema',  polygon: rectPolygon(centerX, centerY, centerW, centerH) },
        { name: 'Right Vertical', polygon: rectPolygon(w - sidePad - sideW, sideY, sideW, sideH) },
      ];
    },
  },
  {
    id: 'hexagon-wall',
    label: 'Hexagon Wall',
    icon: '⬡',
    build: (w, h) => {
      // 5×3 hex grid with proper honeycomb offset (every other row
      // shifted by half a cell). Hex pointy-up; radius derived from
      // the cell box so the grid fills the surface neatly.
      const cols = 5, rows = 3;
      const cellW = w / (cols + 0.5);  // +0.5 so offset row still fits
      const cellH = h / rows;
      const r = Math.min(cellW, cellH) * 0.45;
      const out: Array<{ name: string; polygon: BezierPoint[] }> = [];
      let n = 1;
      for (let row = 0; row < rows; row++) {
        const offset = row % 2 === 0 ? 0 : cellW / 2;
        for (let col = 0; col < cols; col++) {
          const cx = offset + (col + 0.5) * cellW;
          const cy = (row + 0.5) * cellH;
          out.push({ name: `Hex ${n++}`, polygon: hexagonPolygon(cx, cy, r) });
        }
      }
      return out;
    },
  },
  {
    id: 'concert',
    label: 'Concert Stage',
    icon: '◫',
    build: (w, h) => {
      // Big center screen + four smaller corner accents — typical
      // arena rig where the main visual is the centerpiece with
      // peripheral "moving lights" effect surfaces.
      const cw = w * 0.5, ch = h * 0.55;
      const cx = (w - cw) / 2, cy = (h - ch) / 2.2;
      const acc = Math.min(w, h) * 0.13;
      const margin = w * 0.05;
      return [
        { name: 'Main Screen',  polygon: rectPolygon(cx, cy, cw, ch) },
        { name: 'Accent TL',    polygon: circlePolygon(margin + acc, margin + acc, acc) },
        { name: 'Accent TR',    polygon: circlePolygon(w - margin - acc, margin + acc, acc) },
        { name: 'Accent BL',    polygon: circlePolygon(margin + acc, h - margin - acc, acc) },
        { name: 'Accent BR',    polygon: circlePolygon(w - margin - acc, h - margin - acc, acc) },
      ];
    },
  },
  {
    id: 'pillar-array',
    label: 'Pillar Array',
    icon: '|||',
    build: (w, h) => {
      // 6 tall narrow columns — like LED battens lined up across
      // the stage front. Thinner + taller than the Vertical Stripes
      // template (which is symmetric / medium height).
      const n = 6;
      const cellW = w / n;
      const stripeW = cellW * 0.35;
      const offset = (cellW - stripeW) / 2;
      const out: Array<{ name: string; polygon: BezierPoint[] }> = [];
      for (let i = 0; i < n; i++) {
        const x = i * cellW + offset;
        out.push({
          name: `Pillar ${i + 1}`,
          polygon: rectPolygon(x, h * 0.03, stripeW, h * 0.94),
        });
      }
      return out;
    },
  },
  {
    id: 'horizontal-bars',
    label: 'Horizontal Bars',
    icon: '☰',
    build: (w, h) => {
      // 6 stacked horizontal rectangles — like a venue's tier of
      // LED ribbon strips around a balcony.
      const n = 6;
      const cellH = h / n;
      const barH = cellH * 0.55;
      const offset = (cellH - barH) / 2;
      const out: Array<{ name: string; polygon: BezierPoint[] }> = [];
      for (let i = 0; i < n; i++) {
        const y = i * cellH + offset;
        out.push({
          name: `Bar ${i + 1}`,
          polygon: rectPolygon(w * 0.05, y, w * 0.9, barH),
        });
      }
      return out;
    },
  },
  {
    id: 'diamond-grid',
    label: 'Diamond Grid',
    icon: '◇',
    build: (w, h) => {
      // 4×3 diamond grid with row-offset like the hex wall. Reads
      // like LED panel tiles rotated 45° for a stylized stage.
      const cols = 4, rows = 3;
      const cellW = w / (cols + 0.5);
      const cellH = h / rows;
      const r = Math.min(cellW, cellH) * 0.42;
      const out: Array<{ name: string; polygon: BezierPoint[] }> = [];
      let n = 1;
      for (let row = 0; row < rows; row++) {
        const offset = row % 2 === 0 ? 0 : cellW / 2;
        for (let col = 0; col < cols; col++) {
          const cx = offset + (col + 0.5) * cellW;
          const cy = (row + 0.5) * cellH;
          out.push({ name: `Diamond ${n++}`, polygon: diamondPolygon(cx, cy, r) });
        }
      }
      return out;
    },
  },
];

export function getStageTemplate(id: string): StageTemplate | undefined {
  return STAGE_TEMPLATES.find(t => t.id === id);
}
