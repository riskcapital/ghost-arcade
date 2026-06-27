/**
 * Stage Designer surface store — manages SVG-imported (or hand-drawn)
 * polygon slice layouts for projection mapping.
 *
 * Slices are pure metadata in Phase 1 — no rendering integration yet.
 * Phase 2 wires Surface slices into the engine via the new polygon
 * geometry mode. Phase 3 routes slice content to per-slice outputs.
 *
 * Persistence: Project.surfaces[] (set up in types.ts). The wiring
 * into saveComposition / loadComposition lands in Phase 5.
 */

import { writable, derived, get } from 'svelte/store';
import type { Surface, SurfaceSlice, SurfaceSliceBinding, Point2D, BezierPoint, StageEffect, StageEffectType, SurfaceEffectAutomation } from '../types';
import { generateUUID } from '../utils/uuid';
import { syncStageEffectsFromSurfaces, createDefaultStageEffect } from './stageEffects';
import { getStageTemplate } from './stageTemplates';

// ─── State ───────────────────────────────────────────────

interface SurfaceState {
  surfaces: Surface[];
  activeSurfaceId: string | null;
  /** Selected slice id within the active surface. Null = nothing selected. */
  selectedSliceId: string | null;
  /** Full slice selection, with selectedSliceId acting as the primary item. */
  selectedSliceIds: string[];
}

const INITIAL_STATE: SurfaceState = {
  surfaces: [],
  activeSurfaceId: null,
  selectedSliceId: null,
  selectedSliceIds: [],
};

// ─── SVG → polygon import ────────────────────────────────
// Uses the browser's native SVGGeometryElement (getTotalLength +
// getPointAtLength) to sample ANY SVG geometry primitive (path, rect,
// circle, ellipse, line, polygon, polyline) into a dense polygon point
// list. This sidesteps writing a full SVG path parser — Chromium has
// one built in. Tradeoff: requires the SVG to be momentarily attached
// to the DOM so getBBox/length APIs work. We use a hidden offscreen
// <svg> for that.

/** Sampling density for non-polygonal SVG geometries (paths, circles,
 *  ellipses, arcs). 64 points = ~5° per segment on a circle, enough
 *  resolution that the polygon reads as smooth in the designer canvas
 *  without exploding the point count for downstream tessellation. */
const SVG_SAMPLE_POINTS = 64;

/** Tag types we successfully extract polygons from. */
const SVG_GEOM_TAGS = new Set(['path', 'polygon', 'polyline', 'rect', 'circle', 'ellipse', 'line']);

interface ParsedSurfaceSlice {
  name: string;
  polygon: BezierPoint[];
}

/** Ramer-Douglas-Peucker polyline simplification, adapted for
 *  BezierPoint arrays. Anchors with bezier handles (cpIn/cpOut) are
 *  ALWAYS kept since their handles encode curvature the simplification
 *  can't recover; only handle-less straight-segment anchors are
 *  candidates for removal. Tolerance is measured against the polygon's
 *  bbox so a sensible value works regardless of SVG units.
 *
 *  Cap controls the worst-case post-simplify point count — when the
 *  RDP pass leaves more than `cap` points, we bump tolerance and
 *  re-run. This keeps SVG-imported slices inside the engine's 64-point
 *  polygon-mask uniform budget no matter how dense the source path. */
function simplifyBezierPolygon(points: BezierPoint[], cap = 28): BezierPoint[] {
  if (points.length <= 3) return points;
  // Compute bbox for tolerance scaling.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  const diag = Math.hypot(maxX - minX, maxY - minY) || 1;

  function perpDistance(p: BezierPoint, a: BezierPoint, b: BezierPoint): number {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
    const projX = a.x + t * dx, projY = a.y + t * dy;
    return Math.hypot(p.x - projX, p.y - projY);
  }

  function rdp(pts: BezierPoint[], tol: number): BezierPoint[] {
    if (pts.length < 3) return pts.slice();
    // Find the farthest point from the line a→b (first to last).
    let maxDist = 0, idx = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      // Hard-keep anchors with handles — handles encode curvature
      // that we can't reconstruct after dropping the anchor.
      if (pts[i].cpIn || pts[i].cpOut) {
        if (maxDist < tol) { maxDist = tol + 1; idx = i; }
        continue;
      }
      const d = perpDistance(pts[i], pts[0], pts[pts.length - 1]);
      if (d > maxDist) { maxDist = d; idx = i; }
    }
    if (maxDist <= tol) return [pts[0], pts[pts.length - 1]];
    const left = rdp(pts.slice(0, idx + 1), tol);
    const right = rdp(pts.slice(idx), tol);
    return [...left.slice(0, -1), ...right];
  }

  // Iteratively raise tolerance until we're under the cap. Start at
  // 0.2% of the diagonal — visually imperceptible at typical SVG
  // sizes, removes redundant near-collinear samples from sampled
  // SVG primitives (circles, paths fallback).
  let tol = diag * 0.002;
  let simplified = rdp(points, tol);
  let guard = 8;
  while (simplified.length > cap && guard-- > 0) {
    tol *= 1.8;
    simplified = rdp(points, tol);
  }
  // RDP works on open polylines; we never want the closing segment
  // collapsed away, so guarantee at least 3 points.
  if (simplified.length < 3) simplified = points.slice(0, Math.min(3, points.length));
  return simplified;
}

/**
 * Minimal SVG path-d parser that turns C/Q/S/T commands into
 * BezierPoint anchors with cpIn/cpOut handles. M/L/H/V/Z become
 * straight-segment anchors. Falls back to sampling via
 * SVGGeometryElement for any path that doesn't parse cleanly here —
 * sampled curves are lossy (no handles) but visually correct.
 *
 * Returns null if the path d-string is too gnarly (e.g. unsupported
 * commands or arc commands which we don't yet expand). Caller can then
 * fall through to the sampling path.
 */
function parsePathDToBezier(d: string): BezierPoint[] | null {
  if (!d || typeof d !== 'string') return null;
  // Tokenize: split commands and numbers. SVG numbers can be exponents,
  // signed, decimals; this regex is permissive enough for hand-authored
  // and Illustrator output.
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g);
  if (!tokens || tokens.length === 0) return null;
  const result: BezierPoint[] = [];
  let cx = 0, cy = 0;          // current point
  let startX = 0, startY = 0;  // subpath start (for Z)
  // Reflected control point cache for S/T smooth commands. Per the SVG
  // spec these reflect the previous cubic/quadratic control point.
  let lastCubicCp: Point2D | null = null;
  let lastQuadCp: Point2D | null = null;
  let i = 0;
  function num(): number {
    const v = parseFloat(tokens![i++]);
    if (isNaN(v)) throw new Error('NaN');
    return v;
  }
  function pushAnchor(x: number, y: number, cpIn?: Point2D, cpOut?: Point2D) {
    const pt: BezierPoint = { x, y };
    if (cpIn) pt.cpIn = cpIn;
    if (cpOut) pt.cpOut = cpOut;
    result.push(pt);
  }
  try {
    let cmd = '';
    let isRel = false;
    while (i < tokens.length) {
      const t = tokens[i];
      if (/^[a-zA-Z]$/.test(t)) {
        cmd = t.toUpperCase();
        isRel = t !== cmd;
        i++;
      }
      if (cmd === 'M' || cmd === 'L') {
        const x = num() + (isRel ? cx : 0);
        const y = num() + (isRel ? cy : 0);
        if (cmd === 'M') {
          startX = x; startY = y;
          result.length = 0; // Stage slice = ONE subpath; reset if another M appears.
          pushAnchor(x, y);
        } else {
          pushAnchor(x, y);
        }
        cx = x; cy = y;
        lastCubicCp = null; lastQuadCp = null;
        // Implicit lineto continues the current command.
        if (cmd === 'M') cmd = 'L';
      } else if (cmd === 'H') {
        const x = num() + (isRel ? cx : 0);
        pushAnchor(x, cy);
        cx = x;
        lastCubicCp = null; lastQuadCp = null;
      } else if (cmd === 'V') {
        const y = num() + (isRel ? cy : 0);
        pushAnchor(cx, y);
        cy = y;
        lastCubicCp = null; lastQuadCp = null;
      } else if (cmd === 'C') {
        const c1x = num() + (isRel ? cx : 0);
        const c1y = num() + (isRel ? cy : 0);
        const c2x = num() + (isRel ? cx : 0);
        const c2y = num() + (isRel ? cy : 0);
        const x   = num() + (isRel ? cx : 0);
        const y   = num() + (isRel ? cy : 0);
        // Attach cpOut to the previous anchor (last pushed) and cpIn
        // to the new anchor. SVG stores them per-segment; we store them
        // per-vertex on either end of the segment.
        if (result.length > 0) result[result.length - 1].cpOut = { x: c1x, y: c1y };
        pushAnchor(x, y, { x: c2x, y: c2y });
        cx = x; cy = y;
        lastCubicCp = { x: c2x, y: c2y };
        lastQuadCp = null;
      } else if (cmd === 'S') {
        // Smooth cubic — reflect previous c2 around the current point.
        const reflected: Point2D = lastCubicCp
          ? { x: 2 * cx - lastCubicCp.x, y: 2 * cy - lastCubicCp.y }
          : { x: cx, y: cy };
        const c2x = num() + (isRel ? cx : 0);
        const c2y = num() + (isRel ? cy : 0);
        const x   = num() + (isRel ? cx : 0);
        const y   = num() + (isRel ? cy : 0);
        if (result.length > 0) result[result.length - 1].cpOut = reflected;
        pushAnchor(x, y, { x: c2x, y: c2y });
        cx = x; cy = y;
        lastCubicCp = { x: c2x, y: c2y };
        lastQuadCp = null;
      } else if (cmd === 'Q') {
        // Quadratic — convert to cubic by elevating degree. C1 = P0 +
        // 2/3(Q - P0), C2 = P2 + 2/3(Q - P2).
        const qx = num() + (isRel ? cx : 0);
        const qy = num() + (isRel ? cy : 0);
        const x  = num() + (isRel ? cx : 0);
        const y  = num() + (isRel ? cy : 0);
        const c1: Point2D = { x: cx + (2/3) * (qx - cx), y: cy + (2/3) * (qy - cy) };
        const c2: Point2D = { x:  x + (2/3) * (qx -  x), y:  y + (2/3) * (qy -  y) };
        if (result.length > 0) result[result.length - 1].cpOut = c1;
        pushAnchor(x, y, c2);
        cx = x; cy = y;
        lastQuadCp = { x: qx, y: qy };
        lastCubicCp = null;
      } else if (cmd === 'T') {
        const reflected: Point2D = lastQuadCp
          ? { x: 2 * cx - lastQuadCp.x, y: 2 * cy - lastQuadCp.y }
          : { x: cx, y: cy };
        const x = num() + (isRel ? cx : 0);
        const y = num() + (isRel ? cy : 0);
        const c1: Point2D = { x: cx + (2/3) * (reflected.x - cx), y: cy + (2/3) * (reflected.y - cy) };
        const c2: Point2D = { x:  x + (2/3) * (reflected.x -  x), y:  y + (2/3) * (reflected.y -  y) };
        if (result.length > 0) result[result.length - 1].cpOut = c1;
        pushAnchor(x, y, c2);
        cx = x; cy = y;
        lastQuadCp = reflected;
        lastCubicCp = null;
      } else if (cmd === 'Z') {
        // Close — return to subpath start. No new anchor (the next
        // segment is implicit between last anchor and result[0]). We
        // signal "closed" by the fact that the slice's polygon array
        // is used as a closed shape; nothing extra to push.
        cx = startX; cy = startY;
        lastCubicCp = null; lastQuadCp = null;
      } else if (cmd === 'A') {
        // SVG arc command — exact cubic-bezier expansion is nontrivial.
        // For now: bail to sampling path so the slice still imports
        // (just without the perfect handles).
        return null;
      } else {
        // Unknown command — bail.
        return null;
      }
    }
  } catch {
    return null;
  }
  return result.length >= 3 ? result : null;
}

/** Parse SVG source text into a list of {name, polygon} entries.
 *  Each <path>/<polygon>/etc becomes one slice. Honors viewBox: returned
 *  polygon coords are in viewBox space (so a 1920x1080 viewBox SVG
 *  yields slices in 0..1920, 0..1080). */
export function parseSurfaceSVG(svgSource: string): {
  width: number;
  height: number;
  slices: ParsedSurfaceSlice[];
} | null {
  if (!svgSource || typeof window === 'undefined') return null;
  let svgEl: SVGSVGElement | null = null;
  const hidden = document.createElement('div');
  hidden.style.cssText = 'position:absolute;left:-99999px;top:-99999px;width:0;height:0;overflow:hidden;';
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgSource, 'image/svg+xml');
    svgEl = doc.querySelector('svg');
    if (!svgEl) return null;

    // Resolve viewBox / width / height. Default to 1000x1000 if neither.
    let vbX = 0, vbY = 0, vbW = 1000, vbH = 1000;
    const vb = svgEl.getAttribute('viewBox');
    if (vb) {
      const p = vb.split(/[\s,]+/).map(Number).filter(n => !isNaN(n));
      if (p.length >= 4) { vbX = p[0]; vbY = p[1]; vbW = p[2]; vbH = p[3]; }
    } else {
      const w = parseFloat(svgEl.getAttribute('width') || '');
      const h = parseFloat(svgEl.getAttribute('height') || '');
      if (!isNaN(w) && !isNaN(h)) { vbW = w; vbH = h; }
    }

    // SVGGeometryElement.getPointAtLength() requires the element to be
    // rendered in the DOM tree (Chromium quirk — detached subtrees
    // return NaN for some primitives).  Clone into a hidden host.
    const clone = svgEl.cloneNode(true) as SVGSVGElement;
    hidden.appendChild(clone);
    document.body.appendChild(hidden);

    const slices: ParsedSurfaceSlice[] = [];
    let idx = 0;
    const geomEls = clone.querySelectorAll<SVGGeometryElement>(
      Array.from(SVG_GEOM_TAGS).join(',')
    );
    geomEls.forEach((el) => {
      const tag = el.tagName.toLowerCase();
      if (!SVG_GEOM_TAGS.has(tag)) return;
      // Skip degenerate paths that the browser can't measure.
      let len = 0;
      try { len = el.getTotalLength(); } catch { return; }
      if (!isFinite(len) || len <= 0) return;

      let polygon: BezierPoint[] = [];
      // For polygon / polyline, raw points are exact and unambiguous.
      if (tag === 'polygon' || tag === 'polyline') {
        const raw = el.getAttribute('points') || '';
        const nums = raw.split(/[\s,]+/).map(Number).filter(n => !isNaN(n));
        for (let j = 0; j + 1 < nums.length; j += 2) {
          polygon.push({ x: nums[j] - vbX, y: nums[j + 1] - vbY });
        }
      } else if (tag === 'path') {
        // Try the structured parser first so cubic / quadratic curves
        // come through with their handles intact. Bail to sampling on
        // unsupported commands (e.g. SVG arcs).
        const d = el.getAttribute('d') || '';
        const parsed = parsePathDToBezier(d);
        if (parsed) {
          // Translate to viewBox-origin space.
          polygon = parsed.map(p => ({
            x: p.x - vbX, y: p.y - vbY,
            cpIn:  p.cpIn  ? { x: p.cpIn.x  - vbX, y: p.cpIn.y  - vbY } : undefined,
            cpOut: p.cpOut ? { x: p.cpOut.x - vbX, y: p.cpOut.y - vbY } : undefined,
          }));
        } else {
          // Fallback sampling — straight-segment polygon, no handles.
          const steps = SVG_SAMPLE_POINTS;
          for (let s = 0; s < steps; s++) {
            const t = (s / steps) * len;
            try {
              const pt = el.getPointAtLength(t);
              polygon.push({ x: pt.x - vbX, y: pt.y - vbY });
            } catch {}
          }
        }
      } else if (tag === 'circle' || tag === 'ellipse') {
        // Exact 4-cubic-bezier representation — much better than the
        // 64-sample polyline approximation (which produces visibly
        // faceted edges at high zoom AND makes the slice unsuitable
        // for clean rotate / scale). The "magic constant" 4/3·tan(π/8)
        // ≈ 0.5523 produces a near-perfect circle: max error <0.027%
        // of radius. Same shape the premade Circle / Ellipse buttons
        // use, so SVG-imported circles edit identically.
        const cxRaw = parseFloat(el.getAttribute('cx') || '0');
        const cyRaw = parseFloat(el.getAttribute('cy') || '0');
        const cx = cxRaw - vbX;
        const cy = cyRaw - vbY;
        let rx: number, ry: number;
        if (tag === 'circle') {
          const r = parseFloat(el.getAttribute('r') || '0');
          rx = r; ry = r;
        } else {
          rx = parseFloat(el.getAttribute('rx') || '0');
          ry = parseFloat(el.getAttribute('ry') || '0');
        }
        if (rx > 0 && ry > 0) {
          const K = 0.5522847498307936;
          const Kx = K * rx, Ky = K * ry;
          polygon = [
            // Top (12 o'clock) — handles flow toward 3 and 9
            { x: cx,      y: cy - ry, cpIn: { x: cx + Kx, y: cy - ry }, cpOut: { x: cx - Kx, y: cy - ry } },
            // Left (9 o'clock)
            { x: cx - rx, y: cy,      cpIn: { x: cx - rx, y: cy - Ky }, cpOut: { x: cx - rx, y: cy + Ky } },
            // Bottom (6 o'clock)
            { x: cx,      y: cy + ry, cpIn: { x: cx - Kx, y: cy + ry }, cpOut: { x: cx + Kx, y: cy + ry } },
            // Right (3 o'clock)
            { x: cx + rx, y: cy,      cpIn: { x: cx + rx, y: cy + Ky }, cpOut: { x: cx + rx, y: cy - Ky } },
          ];
        }
      } else {
        // rect / line / other geometry — sample uniformly along
        // SVGGeometryElement's total length.
        const steps = SVG_SAMPLE_POINTS;
        for (let s = 0; s < steps; s++) {
          const t = (s / steps) * len;
          try {
            const pt = el.getPointAtLength(t);
            polygon.push({ x: pt.x - vbX, y: pt.y - vbY });
          } catch {}
        }
      }
      if (polygon.length >= 3) {
        // Imported polygons are kept at full fidelity — the user
        // can run Simplify from the slice inspector when they want
        // to reduce points. The engine's mask shader is sized to
        // accommodate dense SVG imports (see polygonMaskShader's
        // uPoints budget).
        slices.push({ name: `Polygon ${++idx}`, polygon });
      }
    });

    return { width: vbW, height: vbH, slices };
  } catch (err) {
    console.error('[surface] parseSurfaceSVG failed:', err);
    return null;
  } finally {
    if (hidden.parentNode) hidden.parentNode.removeChild(hidden);
  }
}

// ─── Store actions ───────────────────────────────────────

function createSurfaceStore() {
  const { subscribe, update, set } = writable<SurfaceState>({ ...INITIAL_STATE });

  function makeEmptySurface(name: string, width: number, height: number): Surface {
    return {
      id: generateUUID(),
      name,
      width,
      height,
      slices: [],
    };
  }

  /** Mirror the live surface state into project.surfaces / activeSurfaceId
   *  so project save (which serializes `project`) always captures the
   *  current Stage Designer state. `_isHydrating` blocks mirror writes
   *  during the load path so a freshly-loaded project's surfaces don't
   *  get clobbered by our initial empty state on import. */
  let _isHydrating = false;
  function mirrorToProject(next: SurfaceState) {
    if (_isHydrating) return;
    void import('./layers').then(({ project }) => {
      try {
        (project as any).update((p: any) => ({
          ...p,
          surfaces: next.surfaces,
          activeSurfaceId: next.activeSurfaceId,
        }));
      } catch (err) {
        // Project store may not be fully initialized at module load
        // time during cold start — best-effort, retry happens on the
        // next mutation.
        console.warn('[surface] mirrorToProject:', err);
      }
    });
  }
  // Every store change pushes through to project. Cheap shallow merge.
  subscribe(state => mirrorToProject(state));
  // Sync the stage-effects runtime (centroid cache + layer↔slice map +
  // RAF tick start/stop) whenever surfaces change. The store handles
  // its own idle detection so a stage with no enabled effects costs
  // nothing per frame.
  subscribe(state => syncStageEffectsFromSurfaces(state.surfaces));

  return {
    subscribe,

    /** Create a new empty surface and make it active. */
	    createSurface(name = 'Untitled Stage', width = 1920, height = 1080) {
	      const surface = makeEmptySurface(name, width, height);
	      update(s => ({
	        ...s,
	        surfaces: [...s.surfaces, surface],
	        activeSurfaceId: surface.id,
	        selectedSliceId: null,
	        selectedSliceIds: [],
	      }));
	      return surface.id;
	    },

	    setActiveSurface(id: string | null) {
	      update(s => ({ ...s, activeSurfaceId: id, selectedSliceId: null, selectedSliceIds: [] }));
	    },

    deleteSurface(id: string) {
      update(s => {
        const surfaces = s.surfaces.filter(x => x.id !== id);
        const activeSurfaceId = s.activeSurfaceId === id
          ? (surfaces[0]?.id ?? null)
          : s.activeSurfaceId;
	        return { ...s, surfaces, activeSurfaceId, selectedSliceId: null, selectedSliceIds: [] };
	      });
	    },

    renameSurface(id: string, name: string) {
      update(s => ({
        ...s,
        surfaces: s.surfaces.map(x => x.id === id ? { ...x, name } : x),
      }));
    },

    /** Replace the active surface's slices from a parsed SVG. Creates
     *  the surface implicitly if there isn't one yet — common path:
     *  user opens Stage Designer with no existing surface and drops a
     *  file. */
    importSVG(svgSource: string, opts?: { surfaceName?: string; replace?: boolean }): boolean {
      const parsed = parseSurfaceSVG(svgSource);
      if (!parsed || parsed.slices.length === 0) {
        console.warn('[surface] importSVG: no polygons extracted');
        return false;
      }
      update(s => {
        // Pick the target surface — active if present, else create one
        // sized to the SVG's viewBox so polygon coords land naturally.
        let surfaces = s.surfaces;
        let activeId = s.activeSurfaceId;
        let target = surfaces.find(x => x.id === activeId);
        if (!target) {
          target = makeEmptySurface(opts?.surfaceName ?? 'Imported Stage', parsed.width, parsed.height);
          surfaces = [...surfaces, target];
          activeId = target.id;
        }
        const newSlices: SurfaceSlice[] = parsed.slices.map((p, i) => ({
          id: generateUUID(),
          name: p.name,
          polygon: p.polygon,
          // Cycle through a small palette so adjacent slices read distinctly.
          color: SLICE_PALETTE[i % SLICE_PALETTE.length],
          visible: true,
          locked: false,
          sourceBinding: null,
        }));
        const updatedSlices = opts?.replace === false
          ? [...target.slices, ...newSlices]
          : newSlices;
        const updatedTarget: Surface = { ...target, slices: updatedSlices };
        surfaces = surfaces.map(x => x.id === activeId ? updatedTarget : x);
        return { ...s, surfaces, activeSurfaceId: activeId };
      });
      return true;
    },

    /** Apply a predesigned template (see stageTemplates.ts catalog).
     *  Replaces the active surface's existing slices with the template's
     *  generated set so the user lands on a clean starter geometry.
     *  Creates a default surface on demand if there isn't one yet —
     *  same convenience as importSVG. */
    applyTemplate(templateId: string) {
      const template = getStageTemplate(templateId);
      if (!template) {
        console.warn('[surface] applyTemplate: unknown template', templateId);
        return false;
      }
      update(s => {
        let surfaces = s.surfaces;
        let activeId = s.activeSurfaceId;
        let target = surfaces.find(x => x.id === activeId);
        if (!target) {
          target = makeEmptySurface('Imported Stage', 1920, 1080);
          surfaces = [...surfaces, target];
          activeId = target.id;
        }
        const generated = template.build(target.width, target.height);
        const newSlices: SurfaceSlice[] = generated.map((p, i) => ({
          id: generateUUID(),
          name: p.name,
          polygon: p.polygon,
          color: SLICE_PALETTE[i % SLICE_PALETTE.length],
          visible: true,
          locked: false,
          sourceBinding: null,
        }));
        surfaces = surfaces.map(x => x.id === activeId
          ? { ...x, slices: newSlices }
          : x
        );
	        return { ...s, surfaces, activeSurfaceId: activeId, selectedSliceId: null, selectedSliceIds: [] };
	      });
	      return true;
	    },

    // ─── Slice CRUD ───

    addSlice(polygon: BezierPoint[], name?: string): string | null {
      const state = get({ subscribe });
      const target = state.surfaces.find(x => x.id === state.activeSurfaceId);
      if (!target) return null;
      const slice: SurfaceSlice = {
        id: generateUUID(),
        name: name ?? `Polygon ${target.slices.length + 1}`,
        polygon,
        color: SLICE_PALETTE[target.slices.length % SLICE_PALETTE.length],
        visible: true,
        locked: false,
        sourceBinding: null,
      };
      update(s => ({
        ...s,
	        surfaces: s.surfaces.map(x =>
	          x.id === target.id ? { ...x, slices: [...x.slices, slice] } : x
	        ),
	        selectedSliceId: slice.id,
	        selectedSliceIds: [slice.id],
	      }));
	      return slice.id;
	    },

    updateSlice(sliceId: string, patch: Partial<SurfaceSlice>) {
      update(s => ({
        ...s,
        surfaces: s.surfaces.map(surface =>
          surface.id === s.activeSurfaceId
            ? {
                ...surface,
                slices: surface.slices.map(sl =>
                  sl.id === sliceId ? { ...sl, ...patch } : sl
                ),
              }
            : surface
        ),
      }));
    },

	    deleteSlice(sliceId: string) {
	      update(s => {
	        const selectedSliceIds = s.selectedSliceIds.filter(id => id !== sliceId);
	        const selectedSliceId = s.selectedSliceId === sliceId
	          ? selectedSliceIds[0] ?? null
	          : s.selectedSliceId;
	        return {
	          ...s,
	          surfaces: s.surfaces.map(surface =>
	            surface.id === s.activeSurfaceId
	              ? { ...surface, slices: surface.slices.filter(sl => sl.id !== sliceId) }
	              : surface
	          ),
	          selectedSliceId,
	          selectedSliceIds,
	        };
	      });
	    },

    reorderSlice(sliceId: string, toIndex: number) {
      update(s => ({
        ...s,
        surfaces: s.surfaces.map(surface => {
          if (surface.id !== s.activeSurfaceId) return surface;
          const idx = surface.slices.findIndex(sl => sl.id === sliceId);
          if (idx < 0) return surface;
          const newSlices = [...surface.slices];
          const [removed] = newSlices.splice(idx, 1);
          const clamped = Math.max(0, Math.min(toIndex, newSlices.length));
          newSlices.splice(clamped, 0, removed);
          return { ...surface, slices: newSlices };
        }),
      }));
    },

    /** Manually simplify one slice's polygon via RDP. Caller supplies
     *  the target anchor count; lower = more aggressive simplification.
     *  Anchors with bezier handles are protected (handles encode
     *  curvature that can't be recovered after deletion). */
    simplifySlice(sliceId: string, targetAnchors = 24) {
      update(s => {
        if (!s.activeSurfaceId) return s;
        return {
          ...s,
          surfaces: s.surfaces.map(surface => {
            if (surface.id !== s.activeSurfaceId) return surface;
            return {
              ...surface,
              slices: surface.slices.map(sl =>
                sl.id === sliceId
                  ? { ...sl, polygon: simplifyBezierPolygon(sl.polygon, targetAnchors) }
                  : sl
              ),
            };
          }),
        };
      });
    },

    bindSliceSource(sliceId: string, binding: SurfaceSliceBinding | null) {
      this.updateSlice(sliceId, { sourceBinding: binding });
    },

    setSliceOutputDestination(sliceId: string, destination: string | null) {
      this.updateSlice(sliceId, { outputDestination: destination });
    },

	    selectSlice(sliceId: string | null) {
	      update(s => ({ ...s, selectedSliceId: sliceId, selectedSliceIds: sliceId ? [sliceId] : [] }));
	    },

	    setSliceSelection(primarySliceId: string | null, sliceIds: string[]) {
	      update(s => {
	        const active = s.surfaces.find(surface => surface.id === s.activeSurfaceId);
	        const validIds = new Set(active?.slices.map(slice => slice.id) ?? []);
	        const normalized: string[] = [];
	        for (const id of sliceIds) {
	          if (!validIds.has(id) || normalized.includes(id)) continue;
	          normalized.push(id);
	        }
	        const nextPrimary = primarySliceId && normalized.includes(primarySliceId)
	          ? primarySliceId
	          : normalized[0] ?? null;
	        return {
	          ...s,
	          selectedSliceId: nextPrimary,
	          selectedSliceIds: normalized.length > 0 ? normalized : (nextPrimary ? [nextPrimary] : []),
	        };
	      });
	    },

    // ─── Stage Effects ─────────────────────────────────────────────
    // Effects live on the active surface. CRUD is identical in shape
    // to the slice actions above; the stageEffects store picks them
    // up via the syncStageEffectsFromSurfaces subscriber.

    addStageEffect(type: StageEffectType): string | null {
      const state = get({ subscribe });
      const target = state.surfaces.find(x => x.id === state.activeSurfaceId);
      if (!target) return null;
      const effect = createDefaultStageEffect(type);
      update(s => ({
        ...s,
        surfaces: s.surfaces.map(x =>
          x.id === target.id ? { ...x, effects: [...(x.effects ?? []), effect] } : x
        ),
      }));
      return effect.id;
    },

    updateStageEffect(effectId: string, patch: Partial<StageEffect>) {
      update(s => ({
        ...s,
        surfaces: s.surfaces.map(surface =>
          surface.id === s.activeSurfaceId
            ? {
                ...surface,
                effects: (surface.effects ?? []).map(e =>
                  e.id === effectId ? { ...e, ...patch } : e
                ),
              }
            : surface
        ),
      }));
    },

    updateStageEffectParam(effectId: string, key: string, value: number) {
      update(s => ({
        ...s,
        surfaces: s.surfaces.map(surface =>
          surface.id === s.activeSurfaceId
            ? {
                ...surface,
                effects: (surface.effects ?? []).map(e =>
                  e.id === effectId ? { ...e, params: { ...e.params, [key]: value } } : e
                ),
              }
            : surface
        ),
      }));
    },

    deleteStageEffect(effectId: string) {
      update(s => ({
        ...s,
        surfaces: s.surfaces.map(surface => {
          if (surface.id !== s.activeSurfaceId) return surface;
          const effects = (surface.effects ?? []).filter(e => e.id !== effectId);
          // If the live effect was the one being deleted, fall back
          // to "still" so the tick doesn't keep referencing a stale id.
          const activeEffectId = surface.activeEffectId === effectId ? 'still' : surface.activeEffectId;
          return { ...surface, effects, activeEffectId };
        }),
      }));
    },

    /** Make ONE effect (or 'still' / null) the currently-live effect
     *  on a surface. This is the radio-button activation model —
     *  exactly one effect runs at a time, replacing the prior
     *  multi-active-stacking design.
     *
     *  `surfaceId` defaults to the active surface so the in-VJ Stage
     *  tab can call this with just an effectId; the automation
     *  scheduler in stageEffects.ts passes an explicit surfaceId so
     *  it can drive multiple surfaces independently. */
    setActiveEffect(surfaceIdOrEffectId: string, effectId?: string | null) {
      // Disambiguate the two call shapes: setActiveEffect('still') vs
      // setActiveEffect(surfaceId, 'still'). If only one arg, treat
      // it as the effectId for the active surface.
      let surfaceId: string;
      let nextActive: string | null;
      if (arguments.length === 1) {
        const state = get({ subscribe });
        surfaceId = state.activeSurfaceId ?? '';
        nextActive = surfaceIdOrEffectId;
      } else {
        surfaceId = surfaceIdOrEffectId;
        nextActive = effectId ?? null;
      }
      if (!surfaceId) return;
      update(s => ({
        ...s,
        surfaces: s.surfaces.map(surface =>
          surface.id === surfaceId
            ? { ...surface, activeEffectId: nextActive }
            : surface
        ),
      }));
    },

    /** Toggle the per-surface automation scheduler. When playing,
     *  stageEffects.ts advances activeEffectId through the surface's
     *  enabled effects (and optionally 'still') at the configured
     *  interval. */
    toggleEffectAutomation() {
      update(s => ({
        ...s,
        surfaces: s.surfaces.map(surface => {
          if (surface.id !== s.activeSurfaceId) return surface;
          const cur = surface.effectAutomation ?? defaultAutomation();
          return { ...surface, effectAutomation: { ...cur, playing: !cur.playing } };
        }),
      }));
    },

    /** Replace the active surface's entire effects bundle in one
     *  shot — catalog of effects, which one is live, and automation
     *  state. Used by loadStagePreset to restore the snapshot a
     *  preset captured at save time. */
    setStageEffectsBundle(bundle: {
      effects: StageEffect[];
      activeEffectId: string | null;
      automation: SurfaceEffectAutomation | null;
    }) {
      update(s => {
        if (!s.activeSurfaceId) return s;
        return {
          ...s,
          surfaces: s.surfaces.map(surface =>
            surface.id === s.activeSurfaceId
              ? {
                  ...surface,
                  effects: bundle.effects ?? [],
                  activeEffectId: bundle.activeEffectId ?? null,
                  effectAutomation: bundle.automation ?? undefined,
                }
              : surface
          ),
        };
      });
    },

    /** Patch any subset of the automation config. */
    updateEffectAutomation(patch: Partial<SurfaceEffectAutomation>) {
      update(s => ({
        ...s,
        surfaces: s.surfaces.map(surface => {
          if (surface.id !== s.activeSurfaceId) return surface;
          const cur = surface.effectAutomation ?? defaultAutomation();
          return { ...surface, effectAutomation: { ...cur, ...patch } };
        }),
      }));
    },

    /** Reverse the apply-stage transform — recompute each slice's
     *  polygon (in surface coords) from its bound mapping layer's
     *  current corner-warp + customPoints. Called when the Stage
     *  Designer reopens, so the user can warp slice layers in
     *  mapping mode and have those edits show up in the designer
     *  when they go back. No-ops for slices with no layer binding
     *  or whose bound layer no longer exists (the slice keeps its
     *  prior polygon — a sensible fallback after layer deletion). */
    syncFromMappingLayers(layers: import('../types').Layer[]) {
      const state = get({ subscribe });
      const surface = state.surfaces.find(s => s.id === state.activeSurfaceId);
      if (!surface) return;
      const layerById = new Map(layers.map(l => [l.id, l]));
      const sw = Math.max(1, surface.width);
      const sh = Math.max(1, surface.height);

      const updatedSlices = surface.slices.map(slice => {
        if (slice.sourceBinding?.kind !== 'layer') return slice;
        const layer = layerById.get(slice.sourceBinding.layerId);
        if (!layer || !layer.corners || !layer.layerShape?.params?.customPoints) return slice;
        const corners = layer.corners;
        const pts = layer.layerShape.params.customPoints;
        if (pts.length < 3) return slice;
        // Forward bilinear in canvas-normalized (Y-up) space:
        //   p_canvas = bilinearMix(corners, uv)
        // Then convert to surface coords (Y-down, scaled by surface dims).
        const project = (uv: { x: number; y: number }) => {
          const u = uv.x, v = uv.y;
          const topX = corners.topLeft.x + (corners.topRight.x - corners.topLeft.x) * u;
          const topY = corners.topLeft.y + (corners.topRight.y - corners.topLeft.y) * u;
          const botX = corners.bottomLeft.x + (corners.bottomRight.x - corners.bottomLeft.x) * u;
          const botY = corners.bottomLeft.y + (corners.bottomRight.y - corners.bottomLeft.y) * u;
          const cx = botX + (topX - botX) * v;
          const cy = botY + (topY - botY) * v;
          // canvas Y-up → surface Y-down
          return { x: cx * sw, y: (1 - cy) * sh };
        };
        const newPoly: import('../types').BezierPoint[] = pts.map(p => ({
          x: project(p).x,
          y: project(p).y,
          cpIn:  p.cpIn  ? project(p.cpIn)  : undefined,
          cpOut: p.cpOut ? project(p.cpOut) : undefined,
        }));
        return { ...slice, polygon: newPoly };
      });

      // Only update if something actually changed — avoid a no-op
      // store write that would re-trigger the mirror subscriber.
      const changed = updatedSlices.some((s, i) => s !== surface.slices[i]);
      if (!changed) return;
      update(prev => ({
        ...prev,
        surfaces: prev.surfaces.map(sf =>
          sf.id === surface.id ? { ...sf, slices: updatedSlices } : sf
        ),
      }));
    },

    /** Restore from a project load. Sets `_isHydrating` so the mirror
     *  subscriber doesn't immediately overwrite the project's just-
     *  loaded data with this store's prior state. */
    hydrateFromProject(surfaces: Surface[], activeId: string | null) {
      _isHydrating = true;
	      set({
	        surfaces: surfaces ?? [],
	        activeSurfaceId: activeId ?? null,
	        selectedSliceId: null,
	        selectedSliceIds: [],
	      });
      // Re-enable mirror writes after the set propagates. Microtask
      // is enough — the subscriber has already fired synchronously.
      queueMicrotask(() => { _isHydrating = false; });
    },

    /** Convert the active surface's slices into custom-shape mapping
     *  layers and bind each slice to its new layer.  Called by the
     *  "Apply Stage" button in the designer. After this, the user is
     *  routed back to the main mapping workspace where they can drop
     *  content onto each layer like any other mapping target.
     *
     *  Re-application is idempotent: existing slice→layer links are
     *  updated in place (layer keeps its content + name customizations),
     *  and new slices get new layers.  Returns true on success. */
    async applyStage(): Promise<boolean> {
      const state = get({ subscribe });
      const surface = state.surfaces.find(x => x.id === state.activeSurfaceId);
      if (!surface || surface.slices.length === 0) {
        console.warn('[surface] applyStage: no surface or no slices to apply');
        return false;
      }
      // Late-bound import dodges the circular dep (layers store can
      // also import this store on project load).
      const { project } = await import('./layers');
      // Pre-existing slice → layer map (carried in sourceBinding).
      const existingLinks: Record<string, string> = {};
      for (const slice of surface.slices) {
        if (slice.sourceBinding?.kind === 'layer' && slice.sourceBinding.layerId) {
          existingLinks[slice.id] = slice.sourceBinding.layerId;
        }
      }
      const newLinks = (project as any).applyStageSurfaceToLayers(surface, existingLinks);
      // Write the resulting links back onto the slices so future
      // re-applies + per-slice render binding can find them.
      update(s => ({
        ...s,
        surfaces: s.surfaces.map(sf => sf.id === surface.id ? {
          ...sf,
          slices: sf.slices.map(sl => ({
            ...sl,
            sourceBinding: newLinks[sl.id]
              ? { kind: 'layer' as const, layerId: newLinks[sl.id] }
              : sl.sourceBinding,
          })),
        } : sf),
      }));
      // Pop the user back into the main mapping workspace so they can
      // start assigning content to the freshly-created layers.
      const { workspace } = await import('./workspace');
      workspace.closeAll();
      return true;
    },

    /** Wipe everything — used on project reset / new project. */
    reset() {
      set({ ...INITIAL_STATE });
    },
  };
}

function defaultAutomation(): SurfaceEffectAutomation {
  return {
    playing: false,
    mode: 'beat',
    seconds: 4,
    beats: 8,
  };
}

// Color palette for newly-created slices — cyans/violets/yellows so
// adjacent slices read distinctly in the designer overlay. Output
// rendering ignores this; it's pure UI.
const SLICE_PALETTE = [
  '#4cd1ff', '#bb86fc', '#ffd166', '#06d6a0', '#ef476f',
  '#f48c06', '#80ffdb', '#c77dff', '#ff70a6', '#9bf6ff',
];

export const surfaceStore = createSurfaceStore();

// ─── Derived stores ──────────────────────────────────────

export const activeSurface = derived(surfaceStore, $s =>
  $s.surfaces.find(x => x.id === $s.activeSurfaceId) ?? null
);

export const activeSurfaceSlices = derived(activeSurface, $s => $s?.slices ?? []);

export const selectedSlice = derived([surfaceStore, activeSurface], ([$s, $surface]) =>
  $surface?.slices.find(sl => sl.id === $s.selectedSliceId) ?? null
);

export const selectedSliceIds = derived(surfaceStore, $s => $s.selectedSliceIds ?? []);
