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
import type { Surface, SurfaceSlice, SurfaceSliceBinding, Point2D } from '../types';
import { generateUUID } from '../utils/uuid';

// ─── State ───────────────────────────────────────────────

interface SurfaceState {
  surfaces: Surface[];
  activeSurfaceId: string | null;
  /** Selected slice id within the active surface. Null = nothing selected. */
  selectedSliceId: string | null;
}

const INITIAL_STATE: SurfaceState = {
  surfaces: [],
  activeSurfaceId: null,
  selectedSliceId: null,
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
  polygon: Point2D[];
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

      const polygon: Point2D[] = [];
      // For polygon / polyline, prefer the raw points list (no
      // resampling — preserves user intent and is exact).
      if (tag === 'polygon' || tag === 'polyline') {
        const raw = el.getAttribute('points') || '';
        const nums = raw.split(/[\s,]+/).map(Number).filter(n => !isNaN(n));
        for (let i = 0; i + 1 < nums.length; i += 2) {
          polygon.push({ x: nums[i] - vbX, y: nums[i + 1] - vbY });
        }
      } else {
        // Sample curved / rect / arc geometry uniformly along its length.
        const steps = SVG_SAMPLE_POINTS;
        for (let s = 0; s < steps; s++) {
          const t = (s / steps) * len;
          try {
            const pt = el.getPointAtLength(t);
            polygon.push({ x: pt.x - vbX, y: pt.y - vbY });
          } catch {
            // Single sample failure isn't fatal — skip it.
          }
        }
      }
      if (polygon.length >= 3) {
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
      }));
      return surface.id;
    },

    setActiveSurface(id: string | null) {
      update(s => ({ ...s, activeSurfaceId: id, selectedSliceId: null }));
    },

    deleteSurface(id: string) {
      update(s => {
        const surfaces = s.surfaces.filter(x => x.id !== id);
        const activeSurfaceId = s.activeSurfaceId === id
          ? (surfaces[0]?.id ?? null)
          : s.activeSurfaceId;
        return { ...s, surfaces, activeSurfaceId, selectedSliceId: null };
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

    // ─── Slice CRUD ───

    addSlice(polygon: Point2D[], name?: string): string | null {
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
      update(s => ({
        ...s,
        surfaces: s.surfaces.map(surface =>
          surface.id === s.activeSurfaceId
            ? { ...surface, slices: surface.slices.filter(sl => sl.id !== sliceId) }
            : surface
        ),
        selectedSliceId: s.selectedSliceId === sliceId ? null : s.selectedSliceId,
      }));
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

    bindSliceSource(sliceId: string, binding: SurfaceSliceBinding | null) {
      this.updateSlice(sliceId, { sourceBinding: binding });
    },

    setSliceOutputDestination(sliceId: string, destination: string | null) {
      this.updateSlice(sliceId, { outputDestination: destination });
    },

    selectSlice(sliceId: string | null) {
      update(s => ({ ...s, selectedSliceId: sliceId }));
    },

    /** Wipe everything — used on project reset / new project. */
    reset() {
      set({ ...INITIAL_STATE });
    },
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
