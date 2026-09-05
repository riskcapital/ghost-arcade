// Settings Store
// Manages app-wide settings including recording preferences

import { writable, get } from 'svelte/store';
import { invoke, isDesktopApp } from '$lib/bridge';
import type { WarpCorners, MeshWarpGrid, Effect } from '../types';

// ============================================================================
// COLOR SCHEME DEFINITIONS
// ============================================================================

export type ColorSchemeId = 'midnight-coral' | 'purple-green' | 'cyberpunk';

export interface ColorScheme {
  id: ColorSchemeId;
  name: string;
  description: string;
  colors: {
    // Backgrounds
    bgPrimary: string;      // Main app background
    bgSecondary: string;    // Toolbar, panels
    bgTertiary: string;     // Cards, elevated surfaces
    bgOverlay: string;      // Modal overlays
    // Accents
    accentPrimary: string;  // Main accent (buttons, highlights)
    accentSecondary: string; // Secondary accent
    accentHover: string;    // Hover states
    // Text
    textPrimary: string;    // Main text
    textSecondary: string;  // Muted text
    textMuted: string;      // Very muted (hints)
    // Borders
    borderPrimary: string;  // Main borders
    borderSecondary: string; // Subtle borders
    // Status colors
    danger: string;         // Delete, record, errors
    success: string;        // Success states
    warning: string;        // Warnings
  };
}

// Midnight Coral - Dark with red/coral accents (DEFAULT - based on reference images)
// Ghost Chrome — the default accent. Ghostly white core with metallic
// light blue-grey support (the coral era lives on only in the scheme id,
// kept for saved-settings compatibility).
export const SCHEME_MIDNIGHT_CORAL: ColorScheme = {
  id: 'midnight-coral',
  name: 'Ghost Chrome',
  description: 'Ghostly white and metallic ice blue-grey accents',
  colors: {
    bgPrimary: '#0a0a0c',
    bgSecondary: 'rgba(18, 18, 22, 0.95)',
    bgTertiary: '#141418',
    bgOverlay: 'rgba(0, 0, 0, 0.85)',
    accentPrimary: '#dfe9f2',      // Ghostly white with an ice-blue tinge
    accentSecondary: '#9fb6c9',    // Metallic light blue-grey
    accentHover: '#f4f9fd',        // Near-white on hover
    textPrimary: '#e8e8e8',
    textSecondary: '#a0a0a0',
    textMuted: '#666666',
    borderPrimary: 'rgba(207, 223, 236, 0.28)',
    borderSecondary: 'rgba(255, 255, 255, 0.06)',
    danger: '#FF4757',
    success: '#2ED573',
    warning: '#FFA502',
  }
};

// Purple Green - Original GhostArcade theme
export const SCHEME_PURPLE_GREEN: ColorScheme = {
  id: 'purple-green',
  name: 'Purple Green',
  description: 'Classic purple and neon green',
  colors: {
    bgPrimary: '#0a0a0c',
    bgSecondary: 'rgba(18, 18, 22, 0.95)',
    bgTertiary: '#12121a',
    bgOverlay: 'rgba(0, 0, 0, 0.7)',
    accentPrimary: '#BB86FC',      // Purple
    accentSecondary: '#39FF14',    // Neon lime
    accentHover: '#CF6EFF',        // Lighter purple
    textPrimary: '#e0e0e0',
    textSecondary: '#888888',
    textMuted: '#555555',
    borderPrimary: 'rgba(187, 134, 252, 0.2)',
    borderSecondary: 'rgba(255, 255, 255, 0.06)',
    danger: '#FF6B6B',
    success: '#39FF14',
    warning: '#FF8800',
  }
};

// Cyberpunk - Wild neon colors, high contrast
export const SCHEME_CYBERPUNK: ColorScheme = {
  id: 'cyberpunk',
  name: 'Cyberpunk',
  description: 'Ultra neon with cyan and magenta',
  colors: {
    bgPrimary: '#050510',          // Deep blue-black
    bgSecondary: 'rgba(10, 10, 30, 0.95)',
    bgTertiary: '#0a0a1a',
    bgOverlay: 'rgba(5, 5, 20, 0.9)',
    accentPrimary: '#00FFFF',      // Cyan
    accentSecondary: '#FF00FF',    // Magenta
    accentHover: '#00CCCC',        // Darker cyan on hover
    textPrimary: '#00FF9F',        // Neon green text
    textSecondary: '#00CCCC',      // Cyan secondary
    textMuted: '#0088AA',          // Muted cyan
    borderPrimary: 'rgba(0, 255, 255, 0.3)',
    borderSecondary: 'rgba(255, 0, 255, 0.15)',
    danger: '#FF0066',             // Hot pink
    success: '#00FF9F',            // Neon green
    warning: '#FFFF00',            // Yellow
  }
};

export const COLOR_SCHEMES: ColorScheme[] = [
  SCHEME_MIDNIGHT_CORAL,
  SCHEME_PURPLE_GREEN,
  SCHEME_CYBERPUNK,
];

export function getColorScheme(id: ColorSchemeId): ColorScheme {
  return COLOR_SCHEMES.find(s => s.id === id) || SCHEME_MIDNIGHT_CORAL;
}

// Apply color scheme to CSS variables
export function applyColorScheme(scheme: ColorScheme) {
  const root = document.documentElement;
  const c = scheme.colors;

  root.style.setProperty('--bg-primary', c.bgPrimary);
  root.style.setProperty('--bg-secondary', c.bgSecondary);
  root.style.setProperty('--bg-tertiary', c.bgTertiary);
  root.style.setProperty('--bg-overlay', c.bgOverlay);
  root.style.setProperty('--accent-primary', c.accentPrimary);
  root.style.setProperty('--accent-secondary', c.accentSecondary);
  root.style.setProperty('--accent-hover', c.accentHover);
  root.style.setProperty('--text-primary', c.textPrimary);
  root.style.setProperty('--text-secondary', c.textSecondary);
  root.style.setProperty('--text-muted', c.textMuted);
  root.style.setProperty('--border-primary', c.borderPrimary);
  root.style.setProperty('--border-secondary', c.borderSecondary);
  root.style.setProperty('--danger', c.danger);
  root.style.setProperty('--success', c.success);
  root.style.setProperty('--warning', c.warning);

  // Reapply the active theme template AFTER the accent scheme writes
  // so the theme's depth ladder + ink stay authoritative — only the
  // accent vars come from the scheme. Late-bound import keeps the
  // theme store out of settings.ts's hot path on first load.
  void import('../theming/store').then(({ activeThemeId }) => {
    activeThemeId.refresh();
  }).catch(() => { /* boot ordering — theme not registered yet, ignore */ });
}

// ============================================================================
// AI MODEL LISTS
// ============================================================================

export interface AIModelOption {
  id: string;
  label: string;
}

export const CLAUDE_MODELS: AIModelOption[] = [
  { id: 'claude-fable-5', label: 'Claude Fable 5' },
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 (Fast)' },
];

export const GEMINI_MODELS: AIModelOption[] = [
  { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview' },
  { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
  { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview' },
  { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (Legacy)' },
];

export const VEO_MODELS: AIModelOption[] = [
  { id: 'veo-3.1-generate-preview', label: 'Veo 3.1 Preview' },
  { id: 'veo-3.1-fast-generate-preview', label: 'Veo 3.1 Fast Preview' },
  { id: 'veo-3.1-lite-generate-preview', label: 'Veo 3.1 Lite Preview' },
  { id: 'veo-2.0-generate-001', label: 'Veo 2.0 (Deprecated)' },
];

export const LUMA_MODELS: AIModelOption[] = [
  { id: 'ray-2', label: 'Ray 2 (Quality)' },
  { id: 'ray-flash-2', label: 'Ray Flash 2 (Fast)' },
];

// ============================================================================
// SETTINGS INTERFACES
// ============================================================================

export type ShaderAIProvider = 'claude' | 'gemini';
export type VideoAIProvider = 'veo' | 'luma';

export interface AISettings {
  // Shader generation
  shaderProvider: ShaderAIProvider;
  claudeApiKey: string;
  claudeModel: string;
  geminiApiKey: string;
  geminiModel: string;
  // Video generation
  videoProvider: VideoAIProvider;
  lumaApiKey: string;
  lumaModel: string;
  veoModel: string;
  // Replicate (SAM2 segmentation)
  replicateApiKey: string;
}

export interface GridSettings {
  enabled: boolean;
  columns: number;
  rows: number;
  snapToGrid: boolean;
  snapToLayers: boolean;
}

export type ShaderQualityMode = 'full' | 'high' | 'medium' | 'low';

export const SHADER_QUALITY_MULTIPLIERS: Record<ShaderQualityMode, number> = {
  full: 1.0,
  high: 0.75,
  medium: 0.5,
  low: 0.25,
};

export interface UISettings {
  colorScheme: ColorSchemeId;
  fluidQuality: FluidQualityMode;
  shaderQuality: ShaderQualityMode;
  gridSettings: GridSettings;
  /** VJ layout: false = controls left (default), true = controls right */
  vjLayoutReversed: boolean;
  /**
   * Safe Mode — add a confirmation prompt before destructive actions
   * (delete shader, delete clip, delete layer effect, etc.). For users
   * who move fast and accidentally nuke things. Default off; power
   * users opt-in via Settings → General.
   */
  safeMode: boolean;
  /**
   * Mouse warp-handle drag granularity. The mapping editor's corner /
   * edge handles snap drag positions to this pixel grid by default,
   * so projectionists can hit exact target pixels. '1px' is the
   * default — finest practical granularity for projection alignment
   * against physical surface edges. 'free' disables snap entirely
   * (the legacy behavior). 'sub' snaps to 0.5px for HiDPI work.
   * Step values are measured in PROJECT pixels (e.g. 1920×1080),
   * not container pixels — so a 1px nudge is exactly one output
   * pixel regardless of editor zoom. */
  warpDragGranularity: 'free' | 'sub' | '1px' | '5px' | '10px';
}

export type FluidQualityMode = 'live' | 'balanced' | 'quality';
export type GpuInstrumentQualityMode = 'auto' | 'low' | 'balanced' | 'high' | 'ultra';

export interface RecordingSettings {
  // Video format: 'webm-vp9', 'webm-vp8', 'mp4-h264'
  format: 'webm-vp9' | 'webm-vp8' | 'mp4-h264';
  // Video quality in bits per second
  videoBitrate: number;
  // Whether to auto-download recordings when stopped
  autoDownload: boolean;
  // Custom save directory handle (File System Access API)
  saveDirectoryHandle: FileSystemDirectoryHandle | null;
  // Display name for save directory
  saveDirectoryName: string;
  // Whether to include audio in recordings (from active audio source)
  includeAudio: boolean;
  // Audio bitrate in bits per second (default: 128000 = 128 kbps)
  audioBitrate: number;
}

/**
 * A single output slice — represents one projector/display in a multi-output setup.
 * Each slice crops a region of the master canvas and routes it to either a
 * texture-share sender (Spout / Syphon / NDI) or a dedicated fullscreen
 * Electron window on a physical display.
 */
export interface OutputSlice {
  id: string;
  name: string;                // User-friendly label (e.g. "Left", "Center", "Right")
  enabled: boolean;
  // Source crop region (normalized 0-1 coordinates on the master canvas)
  cropX: number;               // 0-1, left edge of slice
  cropY: number;               // 0-1, top edge of slice
  cropW: number;               // 0-1, width of slice
  cropH: number;               // 0-1, height of slice
  /** Where this slice routes its pixels:
   *    'sender'  — Spout / Syphon / NDI (existing texture-share path).
   *    'display' — a dedicated borderless fullscreen Electron window
   *                on the display identified by `displayId`. The slice
   *                renders its crop+blend at the display's native
   *                resolution. */
  targetType?: 'sender' | 'display';
  /** Electron `screen.getAllDisplays()` id when targetType === 'display'.
   *  Null/undefined means the slice falls back to sender output. */
  displayId?: number | null;
  /** Output transport. 'spout' / 'syphon' = platform-native local
   *  GPU texture share (Windows / macOS); 'ndi' = network device
   *  interface, cross-machine streaming. spoutName is reused as the
   *  sender name regardless of transport (the field's name is
   *  legacy from when only Spout was supported). */
  outputType?: 'spout' | 'syphon' | 'ndi';
  // Sender name for this slice (e.g. "ghostArcade-Left")
  spoutName: string;
  // Edge blending (per-slice, overlap widths as a fraction of the slice)
  edgeBlendLeft: number;       // 0-0.5
  edgeBlendRight: number;
  edgeBlendTop: number;
  edgeBlendBottom: number;
  /** Default S-curve power used when a per-edge gamma is unset. ~2.2
   *  matches sRGB encoding; bump toward 2.4–2.6 if the seam looks
   *  bright in the middle of the overlap (Paul Bourke piecewise
   *  formula — see src/lib/output/blendShader.ts). */
  edgeBlendGamma: number;
  /** Per-edge gamma overrides. Null/undefined falls back to
   *  edgeBlendGamma. Useful when one edge of the rig faces a
   *  different projector or screen material. */
  edgeBlendLeftGamma?: number;
  edgeBlendRightGamma?: number;
  edgeBlendTopGamma?: number;
  edgeBlendBottomGamma?: number;
  /** Black-level lift on the NON-overlap region of this slice. Real
   *  projectors emit some light at "black", so overlap zones look
   *  brighter than non-overlap even with a perfect alpha curve. Raise
   *  the floor of non-overlap pixels to match. Per-channel because
   *  projector black levels are rarely neutral. Typical: 0..0.05. */
  blackLevelR?: number;
  blackLevelG?: number;
  blackLevelB?: number;
  /** How far the black-level lift feathers into the blend zone.
   *  0 = hard step at the blend boundary, 1 = lift fades across the
   *  full blend width. Default 0.5 is a soft cosine roll-off. */
  blackLevelFeather?: number;
  // Color correction (per-slice)
  brightness: number;          // 0-2, default 1
  gamma: number;               // 0.2-5, default 1
  contrast: number;            // 0-2, default 1
  // Output rotation
  rotation: 0 | 90 | 180 | 270;

  // ─── Screen geometry (output-side warp) ───────────────────────────────
  // When `warpMode === 'rect'` (default) the screen's source region is
  // the rectangular crop above. 'corners' adds a 4-point quad warp on
  // top of that rect — useful for projector keystone correction.
  // 'mesh' is a per-cell bezier mesh for non-flat surfaces. Both modes
  // run in the GPU shader (blendRenderer.ts).
  //
  // These transforms are OUTPUT-SIDE — they apply after the editor's
  // composite, so a bumped projector can be realigned without touching
  // any layer or preset. The corners / mesh are sample positions on
  // the master canvas, normalized 0..1, that map to the projector's
  // unit quad (vUv 0..1 in the shader).
  warpMode?: 'rect' | 'corners' | 'mesh';
  /** Quad warp: 4 sample points on the master canvas. When omitted
   *  the four corners are derived from cropX/Y/W/H. */
  corners?: WarpCorners;
  /** Mesh warp: grid of sample points on the master canvas. */
  meshGrid?: MeshWarpGrid;

  // ─── Per-screen effect chain (deprecated) ─────────────────────────
  // Effects field retained for backward-compat with .gha files saved
  // during the brief Phase-3 window; the inspector no longer exposes
  // them and the renderer doesn't apply them. Will be removed in v2.
  effects?: Effect[];
  stageEffectId?: string | null;

  // ─── Output warp (projector-side distortion) ──────────────────────
  // Applied AFTER source sampling, BEFORE present. The operator's
  // "projector got bumped" rescue: warp the entire screen output
  // (every preset, every layer, all at once) to re-align with the
  // physical surface, without touching any per-layer warp.
  //
  // Coordinate space: corners / meshGrid points are normalized 0..1
  // in PROJECTOR space (the unit quad of what gets projected). The
  // shader inverse-bilinears through these to find the content UV
  // for each projector pixel — content stays bounded by the original
  // screen rectangle even when the warp pushes corners inward.
  outputWarp?: OutputWarp;
}

/** Output warp — see OutputSlice.outputWarp for context. */
export interface OutputWarp {
  enabled: boolean;
  mode: 'corners' | 'mesh';
  /** Corners mode: 4 positions on the projector's unit quad. When
   *  identity (TL=0,0 / TR=1,0 / BL=0,1 / BR=1,1) the warp is a
   *  no-op even when `enabled: true`. */
  corners?: WarpCorners;
  /** Mesh mode: grid of projector-unit-quad control points. */
  meshGrid?: MeshWarpGrid;
}

/** Alias — the user-facing concept is "Screen" (one per projector or
 *  sender). The OutputSlice name is retained internally for backward
 *  compat with v1.x settings + .gha files; new code should reference
 *  `Screen`. They are the same shape. */
export type Screen = OutputSlice;

export function createDefaultSlice(id: string, name: string, spoutSuffix: string, cropX = 0, cropW = 1): OutputSlice {
  return {
    id,
    name,
    enabled: true,
    cropX,
    cropY: 0,
    cropW,
    cropH: 1,
    targetType: 'sender',
    displayId: null,
    spoutName: `ghostArcade-${spoutSuffix}`,
    edgeBlendLeft: 0,
    edgeBlendRight: 0,
    edgeBlendTop: 0,
    edgeBlendBottom: 0,
    edgeBlendGamma: 2.2,
    blackLevelR: 0,
    blackLevelG: 0,
    blackLevelB: 0,
    blackLevelFeather: 0.5,
    brightness: 1,
    gamma: 1,
    contrast: 1,
    rotation: 0,
    warpMode: 'rect',
    effects: [],
    stageEffectId: null,
    outputWarp: { enabled: false, mode: 'corners' },
  };
}

/** Identity output-warp corners — the projector's unit quad untouched.
 *  When the user toggles "Output Warp" on, this is the starting state
 *  so flipping it on doesn't visually change anything; the operator
 *  drags the orange handles to introduce distortion. */
export function identityOutputCorners(): WarpCorners {
  return {
    topLeft:     { x: 0, y: 0 },
    topRight:    { x: 1, y: 0 },
    bottomLeft:  { x: 0, y: 1 },
    bottomRight: { x: 1, y: 1 },
  };
}

/** Identity output-warp mesh — a flat grid spanning the projector's
 *  unit quad. Used when flipping output warp into mesh mode. */
export function identityOutputMesh(rows = 5, cols = 5): MeshWarpGrid {
  const points: { x: number; y: number }[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: { x: number; y: number }[] = [];
    for (let c = 0; c < cols; c++) {
      row.push({ x: c / (cols - 1), y: r / (rows - 1) });
    }
    points.push(row);
  }
  return { rows, cols, points };
}

/** Build a 4-corner WarpCorners from a rect crop (master-canvas
 *  normalized coords). Used when the user flips warpMode from 'rect'
 *  to 'corners' so the quad starts visually identical to the rect
 *  and the operator can drag from there. */
export function cornersFromRect(s: { cropX: number; cropY: number; cropW: number; cropH: number }): WarpCorners {
  return {
    topLeft:     { x: s.cropX,           y: s.cropY },
    topRight:    { x: s.cropX + s.cropW, y: s.cropY },
    bottomLeft:  { x: s.cropX,           y: s.cropY + s.cropH },
    bottomRight: { x: s.cropX + s.cropW, y: s.cropY + s.cropH },
  };
}

/** Build a flat mesh grid (rows × cols control points) from a rect
 *  crop. The points start on a regular lattice spanning the rect;
 *  the operator drags individual ones to warp around obstacles. */
export function meshFromRect(
  s: { cropX: number; cropY: number; cropW: number; cropH: number },
  rows = 5,
  cols = 5,
): MeshWarpGrid {
  const points: { x: number; y: number }[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: { x: number; y: number }[] = [];
    for (let c = 0; c < cols; c++) {
      row.push({
        x: s.cropX + (s.cropW * c) / (cols - 1),
        y: s.cropY + (s.cropH * r) / (rows - 1),
      });
    }
    points.push(row);
  }
  return { rows, cols, points };
}

/** True when a master warp would actually change the output — i.e. it's
 *  enabled AND its geometry is non-identity. Enabling the warp without
 *  moving a handle is a no-op, so callers use this to avoid routing the
 *  output through the (costly) warp pass and to keep the zero-copy fast
 *  path until the operator actually warps something. */
export function masterWarpIsActive(warp?: OutputWarp | null): boolean {
  if (!warp?.enabled) return false;
  // Corners and mesh COMBINE (forward warp). Active if EITHER is
  // non-identity — a dragged corner quad OR a deformed mesh. Use an
  // epsilon (matching the mesh check below): a sub-pixel drag back toward
  // identity must read as identity again, else the warp pass stays
  // engaged forever and the zero-copy fast path is lost.
  const EPS = 1e-4;
  const c = warp.corners;
  const cornersWarped = !!c && (
    Math.abs(c.topLeft.x - 0) > EPS || Math.abs(c.topLeft.y - 0) > EPS ||
    Math.abs(c.topRight.x - 1) > EPS || Math.abs(c.topRight.y - 0) > EPS ||
    Math.abs(c.bottomLeft.x - 0) > EPS || Math.abs(c.bottomLeft.y - 1) > EPS ||
    Math.abs(c.bottomRight.x - 1) > EPS || Math.abs(c.bottomRight.y - 1) > EPS
  );
  if (cornersWarped) return true;
  const g = warp.meshGrid;
  if (g && g.rows >= 2 && g.cols >= 2) {
    for (let r = 0; r < g.rows; r++) {
      for (let cc = 0; cc < g.cols; cc++) {
        const p = g.points[r]?.[cc];
        if (!p) continue;
        if (Math.abs(p.x - cc / (g.cols - 1)) > 1e-4 || Math.abs(p.y - r / (g.rows - 1)) > 1e-4) return true;
      }
    }
  }
  return false;
}

/** Migrate an OutputSlice loaded from older settings/.gha files to
 *  the current shape. Idempotent — running it on an already-current
 *  slice returns it unchanged. */
export function migrateOutputSlice(s: Partial<OutputSlice> & { id: string }): OutputSlice {
  return {
    id: s.id,
    name: s.name ?? 'Slice',
    enabled: s.enabled ?? true,
    cropX: s.cropX ?? 0,
    cropY: s.cropY ?? 0,
    cropW: s.cropW ?? 1,
    cropH: s.cropH ?? 1,
    targetType: s.targetType ?? 'sender',
    displayId: s.displayId ?? null,
    outputType: s.outputType,
    spoutName: s.spoutName ?? `ghostArcade-${s.name ?? 'Slice'}`,
    edgeBlendLeft: s.edgeBlendLeft ?? 0,
    edgeBlendRight: s.edgeBlendRight ?? 0,
    edgeBlendTop: s.edgeBlendTop ?? 0,
    edgeBlendBottom: s.edgeBlendBottom ?? 0,
    edgeBlendGamma: s.edgeBlendGamma ?? 2.2,
    edgeBlendLeftGamma: s.edgeBlendLeftGamma,
    edgeBlendRightGamma: s.edgeBlendRightGamma,
    edgeBlendTopGamma: s.edgeBlendTopGamma,
    edgeBlendBottomGamma: s.edgeBlendBottomGamma,
    blackLevelR: s.blackLevelR ?? 0,
    blackLevelG: s.blackLevelG ?? 0,
    blackLevelB: s.blackLevelB ?? 0,
    blackLevelFeather: s.blackLevelFeather ?? 0.5,
    brightness: s.brightness ?? 1,
    gamma: s.gamma ?? 1,
    contrast: s.contrast ?? 1,
    rotation: s.rotation ?? 0,
    warpMode: s.warpMode ?? 'rect',
    corners: s.corners,
    meshGrid: s.meshGrid,
    effects: s.effects ?? [],
    stageEffectId: s.stageEffectId ?? null,
    // Output warp — projector-side distortion. Defaults to disabled
    // so legacy slices behave unchanged.
    outputWarp: s.outputWarp ?? { enabled: false, mode: 'corners' },
  };
}

export interface OutputSettings {
  // Spout output (Windows only — shares GPU textures between apps)
  spoutEnabled: boolean;
  spoutName: string; // Legacy single-sender name (used when slices empty)
  spoutResolution: '1080p' | '4K' | '720p' | 'WUXGA' | 'WXGA' | 'custom' | 'match' | 'output';
  customWidth: number;
  customHeight: number;
  // Output window state (not persisted — runtime only)
  outputWindowOpen: boolean;
  /*
   * Which physical display each output surface opens on.
   *
   * null means "auto": claim the first non-primary display nothing else has
   * taken. Every surface used to resolve `allDisplays.find(d => d.id !==
   * primary.id)` independently, so with a projector AND a monitor all three
   * landed on whichever the OS listed first and stacked on top of each other.
   *
   * Display ids are not stable across replug, so a stored id that no longer
   * exists falls back to auto rather than opening nothing.
   */
  displayAssignments: {
    liveOutput: number | 'windowed' | null;
    stageSim: number | 'windowed' | null;
    mapSim: number | 'windowed' | null;
  };
  // Projection controls
  blackout: boolean;
  testPattern: string;
  // Legacy single-output edge blending (used when slices empty)
  edgeBlendLeft: number;
  edgeBlendRight: number;
  edgeBlendTop: number;
  edgeBlendBottom: number;
  edgeBlendGamma: number;
  // Legacy single-output color correction
  brightness: number;
  gamma: number;
  contrast: number;
  // Multi-output slices (overrides legacy single-output when non-empty)
  slices: OutputSlice[];
  /** Master-canvas resolution — the "virtual canvas" all slices crop
   *  from. Convention (Resolume/MadMapper/Watchout): set this to the
   *  union of the physical outputs minus their overlap regions, e.g.
   *  for four 1920×1080 projectors with 15% horizontal overlap →
   *  ~6528×1080. The editor composites at the editor canvas size; the
   *  slice extractor scales the composite to masterCanvas before
   *  cropping, so each slice is a pixel-accurate window into the
   *  master regardless of editor zoom. Optional + defaults to
   *  1920×1080 so legacy projects work unchanged. */
  masterCanvasWidth: number;
  masterCanvasHeight: number;
  // ── Output-window display transforms ────────────────────────────────────
  // These ONLY affect the dedicated output window (second-display projection).
  // They live in settings so they auto-broadcast via the BroadcastChannel
  // sync, applied via CSS on the output canvas (zero render cost — runs on
  // the GPU compositor). Not persisted across sessions because they're
  // typically per-venue.
  outputRotation: 0 | 90 | 180 | 270;
  outputCropX: number;       // 0..0.9
  outputCropY: number;       // 0..0.9
  outputCropWidth: number;   // 0.1..1
  outputCropHeight: number;  // 0.1..1
  outputShowCursor: boolean; // crosshair overlay on output window
  /** Cursor style preset. Each renders differently:
   *    crosshair  — + shape with center gap
   *    circle     — hollow circle (good for finding things at a distance)
   *    dot        — filled small dot (minimal interference with content)
   *    reticle    — + with center gap + outer ring (sniper scope)
   *    fullscreen — vertical + horizontal lines spanning the whole canvas
   *                 (alignment work — every pixel of the cursor's row/col
   *                 is visible) */
  outputCursorStyle: 'crosshair' | 'circle' | 'dot' | 'reticle' | 'fullscreen';
  /** Cursor diameter in pixels (CSS px on the output window).
   *  16-128 reasonable. Smaller for macro projects. */
  outputCursorSize: number;
  /** Stroke thickness in pixels. 1 for hairline (macro projects),
   *  4+ for high-visibility VJ output. Affects all styles. */
  outputCursorThickness: number;
  /** Cursor colour (hex string e.g. #ffffff). */
  outputCursorColor: string;
  /** Cursor opacity 0..1. */
  outputCursorOpacity: number;
  // Dome projection
  domeEnabled: boolean;
  domeMode: 'angular' | 'stereographic' | 'orthographic' | 'equirectangular';
  domeFOV: number;           // degrees (90-360)
  domeRotation: number;      // degrees (0-360)
  domeTilt: number;          // degrees (-90 to 90)
  domeOffsetX: number;       // -1 to 1
  domeOffsetY: number;       // -1 to 1
  domeCurvature: number;     // 0 (flat) to 1 (full dome)
  domeTruncation: number;    // 0.5 to 1.0 (fraction of circle)
  // ─── Global master warp ───────────────────────────────────────────────
  // A single output-side warp applied to the ENTIRE master canvas before
  // it reaches any transport — the main output window (WebGPU shared-
  // texture OR WebRTC fallback) AND the senders. Per-Screen warp targets
  // one slice; this corrects the whole composite at once (the operator's
  // global keystone / surface-align rescue). Identity corners ⇒ visual
  // no-op even when enabled. Applied editor-side on a dedicated capture
  // canvas (see outputComposite.ts) so both output transports carry
  // already-warped pixels — a single source of truth, no per-window code.
  masterWarp?: OutputWarp;
}

export type DefaultLayerShader = 'crosshair' | 'grid' | 'outline' | 'testpattern' | 'none';

export const DEFAULT_LAYER_SHADERS: { id: DefaultLayerShader; label: string }[] = [
  { id: 'crosshair', label: 'Center Crosshair' },
  { id: 'grid', label: 'Simple Grid' },
  { id: 'outline', label: 'Blue Outline' },
  { id: 'testpattern', label: 'Test Pattern' },
  { id: 'none', label: 'Blank (No Shader)' },
];

/**
 * Renderer transition and diagnostic flags.
 *
 * These still live under `experimental` in persisted settings so older
 * installs migrate cleanly, but several of them are now production controls:
 * native core output is the v2 target route. The schema keeps the older
 * transport flags so 1.9-era settings load cleanly, but native-only desktop
 * builds force them off in `enforceNativeEngineOnly()`.
 */
export interface ExperimentalSettings {
  /** S4 pilot: enable the WebGPU + TSL particle-flow effect.
   *  Default false. Production users never see this; only enabled
   *  via the dev preferences panel + a machine that passes
   *  `webgpuCapability.probeWebGPU()`. */
  webgpuPilot: boolean;
  /** Output-window pixel transport mode. When false (default) the
   *  visible output window runs the legacy SpoutOutputApp full
   *  renderer (Pro v0.6.0 baseline — has its own decoders, state-sync,
   *  and the well-known cross-window drift / drag-freeze limitations).
   *  When true, the output window mounts OutputDisplayApp: a
   *  presentation-only `<video srcObject>` fed by the editor's
   *  `canvas.captureStream(60)` over a same-process WebRTC peer.
   *
   *  Superseded in native-only desktop builds. Remains in the schema for
   *  loading older settings and non-native diagnostic builds.
   */
  outputWebRTC: boolean;

  /** Editor VideoFrame bridge for non-native diagnostic builds. Native-only
   *  desktop mode disables it because the editor preview must be the core's
   *  single composite, not a browser-rendered copy. */
  editorWebGPU: boolean;

  /** Zero-copy GPU output transport for non-native diagnostic builds.
   *
   *  When true (default), the visible output window mounts
   *  OutputSharedTextureDisplayApp: a WebGPU presenter that receives
   *  VideoFrames from the editor via a cross-process MessagePort
   *  (set up by main.js as a MessageChannelMain) and binds them via
   *  `device.importExternalTexture({source: videoFrame})` for true
   *  zero-copy, GPU-resident sampling on a fullscreen quad. Editor
   *  side runs MediaStreamTrackProcessor on `canvas.captureStream(60)`
   *  to read GPU-backed VideoFrames and ships them through the port.
   *
   *  Why this beats the WebRTC escape hatch:
   *    - No encode/decode (WebRTC introduces VP9/H264 round-trip,
   *      ~5-15ms latency + lossy compression at low bitrates)
   *    - No format conversion (importExternalTexture binds the
   *      GpuMemoryBuffer directly; WebRTC always lands in YUV420
   *      and re-converts on display)
   *    - True 4K60 with no quality drop on degraded encoders
   *    - Multi-output ready: each presenter window calls
   *      importExternalTexture on its own MessagePort, no extra cost
   *    - Native compositor — modern Chromium media+WebGPU pipeline IS
   *      what Resolume builds in C++. We just consume it through web
   *      APIs.
   *
   *  Native-only desktop builds force this off; output comes from the
   *  Rust/wgpu core or stays unavailable.
   *
   *  Health monitoring: each VideoFrame's `format` field is logged on
   *  the first 5 frames; `'NV12'` / `'I420'` indicate GPU-backed
   *  zero-copy, `'BGRA'` indicates Chromium fell back to CPU readback.
   *  The output's health badge surfaces this so the operator can spot
   *  a degraded link mid-show. */
  outputZeroCopy: boolean;
  /** Route the visible output command to the Rust/wgpu render core's
   *  managed window. This is the v2.0 desktop output transport. */
  outputNativeCore: boolean;
  /**
   * Allow the legacy `gpuEffectRunner` CPU-readback bridge to run in the
   * comparison renderer when the user has a WebGPU effect (e.g. `gpuFluidSim`)
   * in their layer's effect chain.
   *
   * Native v2 always ignores this bridge. If an effect cannot be expressed
   * as a native graph/effect-pass, it should be disabled or ported rather
   * than mirrored through CPU pixels.
   *
   * When ON with native output disabled: mid-chain WebGPU effects work as
   * before, paying the CPU-readback cost.
   */
  allowMidChainGpuEffects: boolean;
}

/**
 * Performance settings — user-facing knobs to dial in the editor for
 * weaker hardware. Defaults match the historical full-quality
 * behaviour. All apply at runtime by reading the live store value at
 * the relevant hot path. Output Stream changes apply when the output
 * window opens.
 */
export interface PerformanceSettings {
  previewMaxDim: number;
  previewFrameRate: 60 | 30 | 15;
  /** Internal budget tier for WebGPU instrument layers. `auto` follows
   *  the device caps plus the adaptive live governor; fixed tiers keep
   *  counts/grid sizes stable for predictable show operation. */
  gpuInstrumentQuality: GpuInstrumentQualityMode;
  outputFrameRate: 60 | 30 | 24;
  outputMaxBitrate: number;
  outputDegradationPreference: 'maintain-resolution' | 'maintain-framerate' | 'balanced';
  outputCodecPreference: 'auto' | 'h264' | 'vp8';
  editorMaxFps: 0 | 30 | 60;
  stage3DFrameRate: 60 | 45 | 30 | 24;
  /**
   * Use the WebGL2 instanced renderer for the Light Painting layer.
   * Default true. Falls back to the legacy Canvas2D renderer
   * automatically if WebGL2 init fails on the user's hardware.
   *
   * The WebGL2 path renders all stamps for a stroke in a single
   * instanced draw call and bakes finished strokes into a persistent
   * framebuffer, so completed strokes stop costing per-frame work.
   * Roughly 5-10× faster than the Canvas2D rasteriser at the same
   * stamp count + brush size.
   */
  useWebGL2LightPainting: boolean;
}

/** Where new layers land in the project's layer list when added in
 *  mapping mode. 'top' = top of the list (legacy default, renders on
 *  top of everything). 'bottom' = end of the list. 'aboveActive' /
 *  'belowActive' = relative to the currently-selected layer. */
export type NewLayerPlacement = 'top' | 'aboveActive' | 'belowActive' | 'bottom';

export interface AppSettings {
  recording: RecordingSettings;
  output: OutputSettings;
  ui: UISettings;
  ai: AISettings;
  defaultLayerShader: DefaultLayerShader;
  newLayerPlacement: NewLayerPlacement;
  experimental: ExperimentalSettings;
  performance: PerformanceSettings;
}

// Ghost Arcade 2.0 native branch policy. The old renderer flags remain in the
// schema so older projects/settings load cleanly, but the desktop app no
// longer exposes or honors legacy renderer routes while this is true.
export const NATIVE_ENGINE_ONLY = true;

function enforceNativeEngineOnly(settings: AppSettings): AppSettings {
  if (!NATIVE_ENGINE_ONLY || !isDesktopApp) return settings;
  return {
    ...settings,
    experimental: {
      ...settings.experimental,
      outputNativeCore: true,
      outputZeroCopy: false,
      outputWebRTC: false,
      editorWebGPU: false,
      allowMidChainGpuEffects: false,
    },
  };
}

// Check which formats are supported by this browser
export function getSupportedFormats(): { id: string; label: string; mimeType: string; supported: boolean }[] {
  const formats = [
    { id: 'webm-vp9', label: 'WebM (VP9) - Best Quality', mimeType: 'video/webm;codecs=vp9' },
    { id: 'webm-vp8', label: 'WebM (VP8) - Good Compatibility', mimeType: 'video/webm;codecs=vp8' },
    { id: 'mp4-h264', label: 'MP4 (H.264) - Universal Playback', mimeType: 'video/mp4;codecs=avc1.424028' },
  ];

  return formats.map(f => ({
    ...f,
    supported: typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(f.mimeType)
  }));
}

// Get the MIME type for a format ID
export function getMimeType(formatId: string): string {
  const formats: Record<string, string> = {
    'webm-vp9': 'video/webm;codecs=vp9',
    'webm-vp8': 'video/webm;codecs=vp8',
    'mp4-h264': 'video/mp4;codecs=avc1.424028',
  };
  return formats[formatId] || 'video/webm';
}

// Get file extension for a format
export function getFileExtension(formatId: string): string {
  if (formatId.startsWith('mp4')) return 'mp4';
  return 'webm';
}

// Default settings
function createDefaultSettings(): AppSettings {
  // Find best supported format
  const supported = getSupportedFormats().filter(f => f.supported);
  const defaultFormat = supported.find(f => f.id === 'webm-vp9')?.id
    || supported.find(f => f.id === 'webm-vp8')?.id
    || 'webm-vp8';

  return enforceNativeEngineOnly({
    recording: {
      format: defaultFormat as RecordingSettings['format'],
      videoBitrate: 5000000, // 5 Mbps
      autoDownload: true,
      saveDirectoryHandle: null,
      saveDirectoryName: 'Downloads (default)',
      includeAudio: true,
      audioBitrate: 128000, // 128 kbps
    },
    output: {
      spoutEnabled: false,
      spoutName: 'ghostArcade',
      spoutResolution: 'match' as const,
      customWidth: 1920,
      customHeight: 1080,
      outputWindowOpen: false,
      displayAssignments: {
        liveOutput: null,
        stageSim: null,
        mapSim: null,
      },
      blackout: false,
      testPattern: 'none',
      edgeBlendLeft: 0,
      edgeBlendRight: 0,
      edgeBlendTop: 0,
      edgeBlendBottom: 0,
      edgeBlendGamma: 2.2,
      brightness: 1,
      gamma: 1,
      contrast: 1,
      slices: [],
      masterCanvasWidth: 1920,
      masterCanvasHeight: 1080,
      // Output-window display transforms (CSS-applied on output canvas)
      outputRotation: 0,
      outputCropX: 0,
      outputCropY: 0,
      outputCropWidth: 1,
      outputCropHeight: 1,
      outputShowCursor: false,
      outputCursorStyle: 'crosshair',
      outputCursorSize: 28,
      outputCursorThickness: 2,
      outputCursorColor: '#ffffff',
      outputCursorOpacity: 0.85,
      // Dome projection defaults
      domeEnabled: false,
      domeMode: 'angular',
      domeFOV: 180,
      domeRotation: 0,
      domeTilt: 0,
      domeOffsetX: 0,
      domeOffsetY: 0,
      domeCurvature: 1.0,
      domeTruncation: 1.0,
      // Global master warp — off + identity by default so existing
      // projects present an un-warped composite exactly as before.
      masterWarp: { enabled: false, mode: 'corners' },
    },
    ui: {
      colorScheme: 'midnight-coral', // Default to new dark coral theme
      fluidQuality: 'live',
      shaderQuality: 'full',
      gridSettings: {
        enabled: false,
        columns: 12,
        rows: 12,
        snapToGrid: false,
        snapToLayers: true,
      },
      vjLayoutReversed: false,
      warpDragGranularity: '1px',
      safeMode: false,
    },
    ai: {
      shaderProvider: 'claude',
      claudeApiKey: '',
      claudeModel: 'claude-sonnet-4-6',
      geminiApiKey: '',
      geminiModel: 'gemini-3.5-flash',
      videoProvider: 'veo',
      lumaApiKey: '',
      lumaModel: 'ray-2',
      veoModel: 'veo-3.1-generate-preview',
      replicateApiKey: '',
    },
    defaultLayerShader: 'grid',
    // Default 'top' matches legacy behavior (new layers prepended).
    newLayerPlacement: 'top',
    experimental: {
      // S4 pilot. Off by default. Enabling requires both the user
      // toggle in dev preferences AND `webgpuCapability.probeWebGPU()`
      // succeeding — neither alone unlocks the pilot.
      webgpuPilot: false,
      // Non-native diagnostic transport only. Native-only desktop builds
      // force this off through enforceNativeEngineOnly().
      outputWebRTC: false,
      // Non-native diagnostic transport only. Native-only desktop builds
      // force this off through enforceNativeEngineOnly().
      outputZeroCopy: false,
      // Native render-core managed output. This is the v2.0 desktop path.
      outputNativeCore: true,
      // Non-native diagnostic bridge only. Native-only desktop builds
      // force this off so preview pixels come from the core composite.
      editorWebGPU: false,
      // Legacy comparison-only CPU-readback bridge (gpuEffectRunner).
      // Native v2 ignores this even if a saved project has it enabled.
      allowMidChainGpuEffects: false,
    },
    performance: {
      // Defaults match the historical full-quality behaviour. Users on
      // weak hardware step these down via Settings → Performance.
      previewMaxDim: 0,               // 0 = no cap (match main canvas)
      previewFrameRate: 60,
      gpuInstrumentQuality: 'auto',
      outputFrameRate: 60,
      outputMaxBitrate: 80_000_000,   // 80 Mbps
      outputDegradationPreference: 'maintain-resolution',
      outputCodecPreference: 'auto',
      editorMaxFps: 0,                // 0 = uncapped (match rAF / refresh rate)
      stage3DFrameRate: 30,           // external Stage 3D view renders its own compositor
      useWebGL2LightPainting: true,   // WebGL2 instanced renderer ON by default
    },
  });
}

// Local storage key
const STORAGE_KEY = 'ghost-arcade_settings';
const APP_VERSION_KEY = 'ill_app_version';
// Bump this whenever stale localStorage may break the new build.
// Any mismatch clears problematic caches on startup.
// 0.3.10 bump: clears stale renderer/output state after native compositor
// fixes while keeping the v2 native managed output path enabled for testing.
const CURRENT_APP_VERSION = '0.3.10';

/**
 * Clear known-problematic localStorage on version change so a fresh install
 * of a new version can't be bricked by stale data from an older version.
 * Keeps user-owned data (saved presets, API keys, AI settings) — only wipes
 * runtime/cache state that's tied to internal implementation details.
 */
function runVersionMigration(): { versionChanged: boolean } {
  try {
    const stored = localStorage.getItem(APP_VERSION_KEY);
    if (stored === CURRENT_APP_VERSION) return { versionChanged: false };
    console.log('[migration] app version changed', stored, '→', CURRENT_APP_VERSION, '— clearing stale caches');

    // SynthVision Performer: clear session cache + shader cache that captured
    // old clip assignments / ISF shader snapshots. User presets live in a
    // different key and are NOT wiped.
    try { localStorage.removeItem('sv_session_cache'); } catch {}
    try { sessionStorage.removeItem('sv_session_cache'); } catch {}
    try { localStorage.removeItem('sv_isf_shader_cache'); } catch {}
    try { localStorage.removeItem('sv_keyboard_state'); } catch {}

    // Clear VJ clip launcher runtime state (stale clip/layer references)
    try { localStorage.removeItem('vj_clip_launcher_state'); } catch {}
    try { localStorage.removeItem('vj_runtime_state'); } catch {}

    // Force-disable any latched output modes that could hide everything on
    // first launch of a new version (user reported blackout+test pattern
    // being stuck on after upgrade). Also reset stale defaultLayerShader
    // values — we changed the default from 'crosshair' to 'grid' in v0.3.6
    // but loadSettings() spreads parsed-after-defaults, so users who'd
    // already opened the app keep the legacy value forever.
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.output) {
          parsed.output.blackout = false;
          parsed.output.testPattern = 'none';
        }
        if (parsed.defaultLayerShader === 'crosshair' || parsed.defaultLayerShader == null) {
          parsed.defaultLayerShader = 'grid';
        }
        // v2 native renderer target: keep existing installs on the native
        // managed output path and disable comparison transports in this branch.
        parsed.experimental = {
          ...(parsed.experimental || {}),
          outputNativeCore: true,
          outputZeroCopy: false,
          outputWebRTC: false,
          editorWebGPU: false,
          allowMidChainGpuEffects: false,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
      }
    } catch {}

    localStorage.setItem(APP_VERSION_KEY, CURRENT_APP_VERSION);
    return { versionChanged: true };
  } catch (err) {
    console.warn('[migration] failed:', err);
    return { versionChanged: false };
  }
}

// Run migration BEFORE loading settings so stale output flags are cleared first
runVersionMigration();

// Load settings from localStorage
function loadSettings(): AppSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Merge with defaults to handle new settings
      const defaults = createDefaultSettings();
      // Migrate legacy AI keys from individual localStorage entries
      const legacyClaude = localStorage.getItem('ai_claude_key') || '';
      const legacyGemini = localStorage.getItem('ai_gemini_key') || '';
      const legacyProvider = localStorage.getItem('ai_provider') || '';

      const settings = enforceNativeEngineOnly({
        ...defaults,
        ...parsed,
        recording: {
          ...defaults.recording,
          ...parsed.recording,
          // Can't restore directory handle from localStorage
          saveDirectoryHandle: null,
          saveDirectoryName: parsed.recording?.saveDirectoryName || 'Downloads (default)',
        },
        output: {
          ...defaults.output,
          ...parsed.output,
          // ── Projection-mapping setup is SESSION-SCOPED ──────────────
          // Slices (Screens), the master canvas size, and the master warp
          // are "the setup" — they travel with the .gha project file, not
          // localStorage. So they ALWAYS reset to defaults on launch; only
          // loading a project (layers.ts importProject) restores them.
          // This override comes AFTER `...parsed.output` deliberately, to
          // discard any stale per-launch copy.
          slices: [],
          masterCanvasWidth: defaults.output.masterCanvasWidth,
          masterCanvasHeight: defaults.output.masterCanvasHeight,
          masterWarp: { enabled: false, mode: 'corners' as const },
        },
        ui: {
          ...defaults.ui,
          ...parsed.ui,
          gridSettings: {
            ...defaults.ui.gridSettings,
            ...(parsed.ui?.gridSettings || {}),
          },
        },
        ai: {
          ...defaults.ai,
          ...(parsed.ai || {}),
          // Migration: pull from old localStorage keys if new ai section doesn't have them
          claudeApiKey: parsed.ai?.claudeApiKey || legacyClaude || '',
          geminiApiKey: parsed.ai?.geminiApiKey || legacyGemini || '',
          shaderProvider: parsed.ai?.shaderProvider || (legacyProvider as ShaderAIProvider) || defaults.ai.shaderProvider,
        },
        // S4: experimental flags. Spread defaults first so new
        // flags added in future sprints get merged in for users
        // with older saved settings.
        experimental: {
          ...defaults.experimental,
          ...(parsed.experimental || {}),
        },
        performance: {
          ...defaults.performance,
          ...(parsed.performance || {}),
        },
      });

      // Clean up legacy keys after migration
      if (legacyClaude) localStorage.removeItem('ai_claude_key');
      if (legacyGemini) localStorage.removeItem('ai_gemini_key');
      if (legacyProvider) localStorage.removeItem('ai_provider');

      // Defensive sanitization for output flags that can blank the entire
      // canvas if corrupted. A v0.3.5 init bug wrote testPattern: 'off'
      // (not a member of TestPatternType) into localStorage; downstream
      // Canvas.svelte fires drawTestPattern for any value !== 'none', so
      // 'off' painted the canvas pure black on every frame. Self-heal any
      // out-of-enum value (or non-boolean blackout) on every load.
      const VALID_TEST_PATTERNS = ['none', 'grid', 'crosshair', 'color-bars', 'white', 'gradient', 'checkerboard'];
      if (typeof settings.output?.testPattern !== 'string' || !VALID_TEST_PATTERNS.includes(settings.output.testPattern)) {
        settings.output.testPattern = 'none';
      }
      if (typeof settings.output?.blackout !== 'boolean') {
        settings.output.blackout = false;
      }

      // Apply the color scheme on load
      const scheme = getColorScheme(settings.ui.colorScheme);
      applyColorScheme(scheme);
      return settings;
    }
  } catch (err) {
    // The settings JSON got corrupted (browser crash mid-write, quota eviction
    // partial-write, disk flush failure, user manually edited localStorage).
    // Before: we silently reset to defaults — the user lost all their MIDI
    // mappings, keyboard presets, recording dir prefs, API keys, with no
    // indication beyond a console.warn that nobody sees.
    // Now: stash the corrupt string at `<key>.bak.<timestamp>` so it can be
    // hand-recovered or forensically inspected later, then fall through to
    // defaults. The backup only runs on actual corruption (parse throw),
    // not on clean first-run.
    console.error('Failed to load settings — stashing corrupt copy as backup:', err);
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        localStorage.setItem(`${STORAGE_KEY}.corrupt.${ts}`, raw);
        // Keep a rotating pointer so the UI can surface a "your settings were
        // reset; backup at X" notice in a later pass.
        localStorage.setItem(`${STORAGE_KEY}.lastCorruption`, ts);
      }
    } catch {
      // localStorage might be full or blocked. Nothing more we can do.
    }
  }
  const defaults = enforceNativeEngineOnly(createDefaultSettings());
  // Apply default color scheme
  applyColorScheme(getColorScheme(defaults.ui.colorScheme));
  return defaults;
}

// Save settings to localStorage (with API key encryption)
function saveSettings(settings: AppSettings) {
  try {
    settings = enforceNativeEngineOnly(settings);
    // Don't save the directory handle (not serializable)
    const toSave = {
      ...settings,
      recording: {
        ...settings.recording,
        saveDirectoryHandle: null,
      },
    };
    // Encrypt API keys before saving
    encryptApiKeys(toSave.ai).then(encryptedAi => {
      toSave.ai = encryptedAi;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    }).catch(() => {
      // Fallback: save without encryption
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    });
  } catch (err) {
    console.warn('Failed to save settings:', err);
  }
}

import { encryptValue, decryptValue, isEncrypted } from '../utils/crypto';

async function encryptApiKeys(ai: AppSettings['ai']): Promise<AppSettings['ai']> {
  const copy = { ...ai };
  if (copy.claudeApiKey && !isEncrypted(copy.claudeApiKey)) {
    copy.claudeApiKey = await encryptValue(copy.claudeApiKey);
  }
  if (copy.geminiApiKey && !isEncrypted(copy.geminiApiKey)) {
    copy.geminiApiKey = await encryptValue(copy.geminiApiKey);
  }
  if (copy.lumaApiKey && !isEncrypted(copy.lumaApiKey)) {
    copy.lumaApiKey = await encryptValue(copy.lumaApiKey);
  }
  return copy;
}

async function decryptApiKeys(ai: AppSettings['ai']): Promise<AppSettings['ai']> {
  const copy = { ...ai };
  if (copy.claudeApiKey && isEncrypted(copy.claudeApiKey)) {
    copy.claudeApiKey = await decryptValue(copy.claudeApiKey);
  }
  if (copy.geminiApiKey && isEncrypted(copy.geminiApiKey)) {
    copy.geminiApiKey = await decryptValue(copy.geminiApiKey);
  }
  if (copy.lumaApiKey && isEncrypted(copy.lumaApiKey)) {
    copy.lumaApiKey = await decryptValue(copy.lumaApiKey);
  }
  return copy;
}

// Create the store
function createSettingsStore() {
  const { subscribe, set, update } = writable<AppSettings>(loadSettings());

  // Decrypt API keys asynchronously after initial load
  const initial = loadSettings();
  if (initial.ai.claudeApiKey || initial.ai.geminiApiKey || initial.ai.lumaApiKey) {
    decryptApiKeys(initial.ai).then(decryptedAi => {
      update(s => ({ ...s, ai: { ...s.ai, ...decryptedAi } }));
    }).catch(() => { /* keys stay as-is if decryption fails */ });
  }

  return {
    subscribe,

    // Update recording settings
    setRecordingFormat(format: RecordingSettings['format']) {
      update(s => {
        const newSettings = {
          ...s,
          recording: { ...s.recording, format }
        };
        saveSettings(newSettings);
        return newSettings;
      });
    },

    setVideoBitrate(bitrate: number) {
      update(s => {
        const newSettings = {
          ...s,
          recording: { ...s.recording, videoBitrate: bitrate }
        };
        saveSettings(newSettings);
        return newSettings;
      });
    },

    setAutoDownload(enabled: boolean) {
      update(s => {
        const newSettings = {
          ...s,
          recording: { ...s.recording, autoDownload: enabled }
        };
        saveSettings(newSettings);
        return newSettings;
      });
    },

    // Set save directory — uses Electron native dialog or File System Access API
    async pickSaveDirectory(): Promise<boolean> {
      try {
        // Electron: use native dialog via IPC
        if (isDesktopApp) {
          const result = await invoke<{ path: string; name: string } | null>('pick_directory');
          if (!result) return false; // User cancelled

          // Create a minimal handle-like object that supports getFileHandle + createWritable
          const dirPath = result.path;
          const dirName = result.name;
          const handle = {
            name: dirName,
            _path: dirPath,
            async getFileHandle(filename: string, _opts?: { create?: boolean }) {
              const filePath = dirPath + '/' + filename;
              return {
                async createWritable() {
                  const chunks: Blob[] = [];
                  return {
                    async write(data: Blob | ArrayBuffer | string) {
                      if (data instanceof Blob) chunks.push(data);
                      else if (data instanceof ArrayBuffer) chunks.push(new Blob([data]));
                      else chunks.push(new Blob([data]));
                    },
                    async close() {
                      const blob = new Blob(chunks);
                      const arrayBuf = await blob.arrayBuffer();
                      const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuf)));
                      await invoke('save_file_binary', { path: filePath, base64Data: base64 });
                    },
                  };
                },
              };
            },
          };

          update(s => {
            const newSettings = {
              ...s,
              recording: {
                ...s.recording,
                saveDirectoryHandle: handle as any,
                saveDirectoryName: dirName,
                _saveDirectoryPath: dirPath,
              }
            };
            saveSettings(newSettings);
            return newSettings;
          });
          return true;
        }

        // Browser: File System Access API
        if (!('showDirectoryPicker' in window)) {
          alert('Your browser does not support folder selection. Recordings will be saved to Downloads.');
          return false;
        }

        const handle = await (window as any).showDirectoryPicker({
          mode: 'readwrite',
          startIn: 'documents',
        });

        update(s => {
          const newSettings = {
            ...s,
            recording: {
              ...s.recording,
              saveDirectoryHandle: handle,
              saveDirectoryName: handle.name,
            }
          };
          saveSettings(newSettings);
          return newSettings;
        });

        return true;
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          console.error('Failed to pick directory:', err);
        }
        return false;
      }
    },

    // Output settings
    setSpoutEnabled(enabled: boolean) {
      update(s => {
        const newSettings = {
          ...s,
          output: { ...s.output, spoutEnabled: enabled }
        };
        saveSettings(newSettings);
        return newSettings;
      });
    },

    setSpoutName(name: string) {
      update(s => {
        const newSettings = {
          ...s,
          output: { ...s.output, spoutName: name }
        };
        saveSettings(newSettings);
        return newSettings;
      });
    },

    setSpoutResolution(resolution: OutputSettings['spoutResolution']) {
      update(s => {
        const newSettings = {
          ...s,
          output: { ...s.output, spoutResolution: resolution }
        };
        saveSettings(newSettings);
        return newSettings;
      });
    },

    /** Assign an output surface to a display, or null to go back to auto. */
    setDisplayAssignment(
      surface: 'liveOutput' | 'stageSim' | 'mapSim',
      displayId: number | 'windowed' | null,
    ) {
      update((s) => ({
        ...s,
        output: {
          ...s.output,
          displayAssignments: { ...s.output.displayAssignments, [surface]: displayId },
        },
      }));
    },

    setOutputWindowOpen(open: boolean) {
      update(s => ({
        ...s,
        output: { ...s.output, outputWindowOpen: open }
      }));
      // Don't persist this — it's runtime-only state
    },

    clearSaveDirectory() {
      update(s => {
        const newSettings = {
          ...s,
          recording: {
            ...s.recording,
            saveDirectoryHandle: null,
            saveDirectoryName: 'Downloads (default)',
          }
        };
        saveSettings(newSettings);
        return newSettings;
      });
    },

    // UI settings
    setColorScheme(schemeId: ColorSchemeId) {
      const scheme = getColorScheme(schemeId);
      applyColorScheme(scheme);
      update(s => {
        const newSettings = {
          ...s,
          ui: { ...s.ui, colorScheme: schemeId }
        };
        saveSettings(newSettings);
        return newSettings;
      });
    },

    setFluidQuality(mode: FluidQualityMode) {
      update(s => {
        const newSettings = {
          ...s,
          ui: { ...s.ui, fluidQuality: mode }
        };
        saveSettings(newSettings);
        return newSettings;
      });
    },

    setShaderQuality(mode: ShaderQualityMode) {
      update(s => {
        const newSettings = {
          ...s,
          ui: { ...s.ui, shaderQuality: mode }
        };
        saveSettings(newSettings);
        return newSettings;
      });
    },

    setGpuInstrumentQuality(mode: GpuInstrumentQualityMode) {
      update(s => {
        const newSettings = {
          ...s,
          performance: { ...s.performance, gpuInstrumentQuality: mode }
        };
        saveSettings(newSettings);
        return newSettings;
      });
    },

    // Grid settings
    toggleGrid() {
      update(s => {
        const grid = s.ui.gridSettings || { enabled: false, columns: 12, rows: 12, snapToGrid: false, snapToLayers: true };
        const newSettings = {
          ...s,
          ui: { ...s.ui, gridSettings: { ...grid, enabled: !grid.enabled } }
        };
        saveSettings(newSettings);
        return newSettings;
      });
    },

    toggleSnap() {
      update(s => {
        const grid = s.ui.gridSettings || { enabled: false, columns: 12, rows: 12, snapToGrid: false, snapToLayers: true };
        const newSettings = {
          ...s,
          ui: { ...s.ui, gridSettings: { ...grid, snapToGrid: !grid.snapToGrid } }
        };
        saveSettings(newSettings);
        return newSettings;
      });
    },

    setGridDimensions(columns: number, rows: number) {
      update(s => {
        const grid = s.ui.gridSettings || { enabled: false, columns: 12, rows: 12, snapToGrid: false, snapToLayers: true };
        const newSettings = {
          ...s,
          ui: { ...s.ui, gridSettings: { ...grid, columns, rows } }
        };
        saveSettings(newSettings);
        return newSettings;
      });
    },

    // AI settings
    setShaderProvider(provider: ShaderAIProvider) {
      update(s => {
        const newSettings = { ...s, ai: { ...s.ai, shaderProvider: provider } };
        saveSettings(newSettings);
        return newSettings;
      });
    },

    setVideoProvider(provider: VideoAIProvider) {
      update(s => {
        const newSettings = { ...s, ai: { ...s.ai, videoProvider: provider } };
        saveSettings(newSettings);
        return newSettings;
      });
    },

    setClaudeApiKey(key: string) {
      update(s => {
        const newSettings = { ...s, ai: { ...s.ai, claudeApiKey: key } };
        saveSettings(newSettings);
        return newSettings;
      });
    },

    setClaudeModel(model: string) {
      update(s => {
        const newSettings = { ...s, ai: { ...s.ai, claudeModel: model } };
        saveSettings(newSettings);
        return newSettings;
      });
    },

    setGeminiApiKey(key: string) {
      update(s => {
        const newSettings = { ...s, ai: { ...s.ai, geminiApiKey: key } };
        saveSettings(newSettings);
        return newSettings;
      });
    },

    setGeminiModel(model: string) {
      update(s => {
        const newSettings = { ...s, ai: { ...s.ai, geminiModel: model } };
        saveSettings(newSettings);
        return newSettings;
      });
    },

    setLumaApiKey(key: string) {
      update(s => {
        const newSettings = { ...s, ai: { ...s.ai, lumaApiKey: key } };
        saveSettings(newSettings);
        return newSettings;
      });
    },

    setLumaModel(model: string) {
      update(s => {
        const newSettings = { ...s, ai: { ...s.ai, lumaModel: model } };
        saveSettings(newSettings);
        return newSettings;
      });
    },

    setVeoModel(model: string) {
      update(s => {
        const newSettings = { ...s, ai: { ...s.ai, veoModel: model } };
        saveSettings(newSettings);
        return newSettings;
      });
    },

    setReplicateApiKey(key: string) {
      update(s => {
        const newSettings = { ...s, ai: { ...s.ai, replicateApiKey: key } };
        saveSettings(newSettings);
        return newSettings;
      });
    },

    // Global master warp — merge-patch so callers can set just
    // { enabled } or just { corners } without clobbering the rest.
    setMasterWarp(patch: Partial<OutputWarp>) {
      update(s => {
        const prev = s.output.masterWarp ?? { enabled: false, mode: 'corners' as const };
        const newSettings = {
          ...s,
          output: { ...s.output, masterWarp: { ...prev, ...patch } },
        };
        saveSettings(newSettings);
        return newSettings;
      });
    },

    // Dome projection settings
    /**
     * Clear the output stage back to defaults for a brand-new project.
     *
     * Output settings live in global localStorage, not the project, so
     * everything the last session set up stays on: a user hit dome projection
     * that had latched from an earlier session and could not tell what was
     * transforming their output. Screens are worse than confusing — the
     * project saves outputSlices and restores them on load, so a NEW project
     * (which has none) simply inherited the previous project's screens.
     *
     * Reset is the whole output stage: screens, dome, master warp, crop,
     * rotation, edge blend, colour grade, and the latched blackout / test
     * pattern modes. The rule is that a new project should look like its
     * composition and nothing else.
     *
     * Cursor preferences are left alone. They are a UI preference about this
     * machine, not something that changes what the output looks like.
     */
    resetOutputStageForNewProject() {
      // Taken from the defaults factory rather than restated, so a new output
      // setting cannot be added there and silently miss this reset.
      const defaults = createDefaultSettings().output;
      update(s => {
        const next: AppSettings = {
          ...s,
          output: {
            ...s.output,
            slices: [],
            masterCanvasWidth: defaults.masterCanvasWidth,
            masterCanvasHeight: defaults.masterCanvasHeight,
            // createDefaultSettings builds a fresh object per call, so this
            // is not a shared reference and needs no defensive copy.
            masterWarp: defaults.masterWarp,
            blackout: defaults.blackout,
            testPattern: defaults.testPattern,
            domeEnabled: defaults.domeEnabled,
            domeMode: defaults.domeMode,
            domeFOV: defaults.domeFOV,
            domeRotation: defaults.domeRotation,
            domeTilt: defaults.domeTilt,
            domeOffsetX: defaults.domeOffsetX,
            domeOffsetY: defaults.domeOffsetY,
            domeCurvature: defaults.domeCurvature,
            domeTruncation: defaults.domeTruncation,
            outputRotation: defaults.outputRotation,
            outputCropX: defaults.outputCropX,
            outputCropY: defaults.outputCropY,
            outputCropWidth: defaults.outputCropWidth,
            outputCropHeight: defaults.outputCropHeight,
            edgeBlendLeft: defaults.edgeBlendLeft,
            edgeBlendRight: defaults.edgeBlendRight,
            edgeBlendTop: defaults.edgeBlendTop,
            edgeBlendBottom: defaults.edgeBlendBottom,
            edgeBlendGamma: defaults.edgeBlendGamma,
            brightness: defaults.brightness,
            contrast: defaults.contrast,
            gamma: defaults.gamma,
          },
        };
        saveSettings(next);
        return next;
      });
    },

    setDomeEnabled(enabled: boolean) {
      update(s => {
        const newSettings = { ...s, output: { ...s.output, domeEnabled: enabled } };
        saveSettings(newSettings);
        return newSettings;
      });
    },

    setDomeMode(mode: OutputSettings['domeMode']) {
      update(s => {
        const newSettings = { ...s, output: { ...s.output, domeMode: mode } };
        saveSettings(newSettings);
        return newSettings;
      });
    },

    updateDomeSetting<K extends keyof OutputSettings>(key: K, value: OutputSettings[K]) {
      update(s => {
        const newSettings = { ...s, output: { ...s.output, [key]: value } };
        saveSettings(newSettings);
        return newSettings;
      });
    },

    setDefaultLayerShader(shader: DefaultLayerShader) {
      update(s => {
        const newSettings = { ...s, defaultLayerShader: shader };
        saveSettings(newSettings);
        return newSettings;
      });
    },

    setNewLayerPlacement(placement: NewLayerPlacement) {
      update(s => {
        const newSettings = { ...s, newLayerPlacement: placement };
        saveSettings(newSettings);
        return newSettings;
      });
    },

    // Reset to defaults
    reset() {
      const defaults = createDefaultSettings();
      applyColorScheme(getColorScheme(defaults.ui.colorScheme));
      set(defaults);
      saveSettings(defaults);
    },

    // Generic update — for settings sections without dedicated setters
    update(fn: (s: AppSettings) => AppSettings) {
      update(s => {
        const newSettings = enforceNativeEngineOnly(fn(s));
        saveSettings(newSettings);
        return newSettings;
      });
    },

    // Get current value
    get(): AppSettings {
      return get({ subscribe });
    },
  };
}

export const settings = createSettingsStore();

// ============================================================================
// FREEZE (PAUSE OUTPUT) STORE
// ============================================================================
// Simple boolean store — when true, the Canvas render loop skips rendering
// so the last frame stays frozen on screen (and on Spout/output window).
export const outputFrozen = writable(false);
