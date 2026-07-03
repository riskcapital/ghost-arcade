/**
 * GpuShader — interface every WebGPU shader implementation that
 * lives inside a `gpu` layer must satisfy. The renderer treats all
 * implementations uniformly: instantiate, set params, encode each
 * frame, dispose.
 *
 * Each shader brings its own params (planet has planetType + camera,
 * particles have mode + source, etc.). The shape is opaque to the
 * runner — the panel renders it via the shader's paramSchema.
 */
import type { GhostGpuRuntime } from './gpuRuntime';
import type { GhostGpuGovernorSnapshot, GhostGpuQualityTier } from './gpuCaps';

export interface GpuShaderImpl {
  /** Apply the user's params (merged with defaults). Cheap setter
   *  — called every frame from the render loop. */
  setParams(params: Record<string, any>): void;
  /** Encode the per-frame work into the supplied encoder, rendering
   *  to the given target view (the gpu layer's canvas surface).
   *  width/height are the canvas pixel dimensions. dt is seconds
   *  since the previous frame for stateful animation. time is an
   *  optional absolute seconds clock supplied by deterministic
   *  offline export; realtime renderers may omit it. */
  encodeFrame(
    encoder: any,
    targetView: any,
    targetFormat: any,
    width: number,
    height: number,
    dt: number,
    time?: number,
  ): void;
  /** Optional: shaders that read pixels from a media source (image,
   *  video, layer) override this. The runner resolves the user's
   *  source param into one of these element kinds and calls per
   *  frame (videos / canvases) or once on change (still images). */
  setSource?(source: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | ImageBitmap): void;
  /** Optional: zero-copy variant for callers that already hold a flat
   *  RGBA8 byte buffer (e.g. Spout/Syphon receivers, custom GPU
   *  capture). Skips the HTMLCanvasElement / ImageBitmap intermediates
   *  used by setSource. Caller guarantees data.length === width*height*4. */
  setSourceFromBytes?(data: Uint8Array, width: number, height: number): void;
  /** Optional: shaders that need to know when the canvas resized.
   *  Pure fragment shaders can ignore it (they sample resolution
   *  from the bind-group uniform). */
  resize?(width: number, height: number): void;
  /** Optional dev/profiling hook. Implementations can expose lightweight
   *  pass/resource stats without coupling the renderer to each shader's
   *  internal engine. */
  getDebugStats?(): Record<string, any>;
  /** Free GPU resources. Called when the user switches to a
   *  different shader within the same layer or removes the layer. */
  dispose(): void;
}

export interface GpuShaderQualityContext {
  capsTier: GhostGpuQualityTier;
  suggestedTier: GhostGpuQualityTier;
  qualityScale: number;
  adaptive: boolean;
  governor?: GhostGpuGovernorSnapshot | null;
}

export interface GpuShaderQualityTierBudget {
  /** Clamp expensive numeric params at this tier while preserving
   *  user-authored values below the cap. Numeric strings are preserved
   *  as strings so select-backed params like gridSize stay valid. */
  maxParams?: Record<string, number>;
  /** Params whose caps should also follow the adaptive qualityScale. */
  scaleMaxParams?: string[];
  /** Last-resort fixed overrides for a tier. Use sparingly; maxParams
   *  keeps user intent intact and should be preferred. */
  forceParams?: Record<string, any>;
}

export interface GpuShaderQualityApplyResult {
  params: Record<string, any>;
  applied: Record<string, { from: any; to: any; cap?: number }>;
  context: GpuShaderQualityContext;
}

/**
 * One entry per parameter the shader exposes for UI editing. The
 * panel walks this schema to render the right control type with
 * the right range / options. Keeping the schema declarative means
 * adding a new shader only requires writing the impl + the schema —
 * no UI plumbing.
 */
// Optional visibility predicate. When set, the param is only shown
// in the UI if EVERY entry in `showWhen` matches the current value
// of the corresponding key in the layer's params. Used to hide
// mode-specific params when they don't apply (e.g. only show
// 'Depth Shift' params when mode === 'depth-shift'). The renderer
// keeps reading every param from the schema so toggling the mode
// is non-destructive — values stay around even when hidden.
type CommonParam = { showWhen?: Record<string, any> };

export type ParamControl =
  | (CommonParam & { kind: 'slider'; key: string; label: string; min: number; max: number; step: number; default: number; group?: string })
  | (CommonParam & { kind: 'angle'; key: string; label: string; default: number; group?: string })       // sugar over slider in degrees
  | (CommonParam & { kind: 'toggle'; key: string; label: string; default: boolean; group?: string })
  | (CommonParam & { kind: 'select'; key: string; label: string; options: { value: string; label: string }[]; default: string; group?: string })
  | (CommonParam & { kind: 'color'; key: string; label: string; default: [number, number, number]; group?: string })
  // Source-picker — surfaces the same media-library / layer / file /
  // camera / spout picker that the existing pixel-fx panel uses. The
  // shader's `setSource` will be wired automatically by the renderer.
  //
  // `sources` optionally restricts which source kinds appear in the
  // UI. Useful when a shader can only meaningfully consume specific
  // kinds (e.g. Point Cloud FX accepts only `.ply` / `.splat` file
  // uploads — the media library + layer + live capture options
  // would just produce errors). Omit to show all kinds (current
  // default behaviour, used by every shader except point clouds).
  // `accept` further restricts the file input's MIME / extension
  // filter so the OS file dialog doesn't surface incompatible files.
  | (CommonParam & {
      kind: 'media-source';
      key: string;
      label: string;
      group?: string;
      sources?: ('media' | 'layer' | 'file' | 'live')[];
      accept?: string;
    });

/**
 * Registry entry — declarative metadata for one GPU shader. The
 * `create` factory builds an instance against the given device.
 * The renderer uses `defaultParams` to initialise a new layer's
 * param object on first use.
 */
export interface GpuShaderDef {
  id: string;
  label: string;
  description: string;
  /** Category for grouping in the picker UI (e.g. 'Generative',
   *  'Source-driven', 'Post-effect'). */
  category: string;
  /** Build an instance bound to a device. */
  create(device: any, presentFormat: any, runtime?: GhostGpuRuntime): GpuShaderImpl;
  /** Optional lightweight warm-up used by the picker before a shader is
   *  selected. Prefer compiling/caching modules + pipelines here without
   *  allocating full simulation buffers. */
  prewarm?(device: any, presentFormat: any, runtime?: GhostGpuRuntime): void | Promise<void>;
  /** Optional internal budgets for adaptive quality. These do not add
   *  visible UI controls; they cap hidden cost so heavy instruments can
   *  stay live on slower GPUs and recover when the governor steps back up. */
  qualityBudgets?: Partial<Record<GhostGpuQualityTier, GpuShaderQualityTierBudget>>;
  /** Schema for UI generation + initial param population. */
  paramSchema: ParamControl[];
  /** Convenience: derived from paramSchema by gpuShaderCatalog at
   *  registration time. Saves the runner from re-walking the
   *  schema every frame. */
  defaultParams: Record<string, any>;
  /** True if the shader consumes a source texture (media/video/
   *  another layer). The panel renders the source picker when set. */
  needsSource?: boolean;
}

/** Build a `defaultParams` object from a paramSchema array.
 *  Convenience for shader registration — the catalog calls this
 *  so each entry's defaults are pre-flattened. */
export function deriveDefaults(schema: ParamControl[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const p of schema) {
    out[p.key] = (p as any).default;
  }
  return out;
}
