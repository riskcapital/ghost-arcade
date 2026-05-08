// Settings Store
// Manages app-wide settings including recording preferences

import { writable, get } from 'svelte/store';
import { invoke, isDesktopApp } from '$lib/bridge';

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
export const SCHEME_MIDNIGHT_CORAL: ColorScheme = {
  id: 'midnight-coral',
  name: 'Midnight Coral',
  description: 'Dark theme with red/coral accents',
  colors: {
    bgPrimary: '#0a0a0c',
    bgSecondary: 'rgba(18, 18, 22, 0.95)',
    bgTertiary: '#141418',
    bgOverlay: 'rgba(0, 0, 0, 0.85)',
    accentPrimary: '#FF6B6B',      // Coral red
    accentSecondary: '#FF8585',    // Lighter coral
    accentHover: '#FF5252',        // Brighter on hover
    textPrimary: '#e8e8e8',
    textSecondary: '#a0a0a0',
    textMuted: '#666666',
    borderPrimary: 'rgba(255, 107, 107, 0.15)',
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
}

// ============================================================================
// AI MODEL LISTS
// ============================================================================

export interface AIModelOption {
  id: string;
  label: string;
}

export const CLAUDE_MODELS: AIModelOption[] = [
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 (Fast)' },
  { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5 (Legacy)' },
];

export const GEMINI_MODELS: AIModelOption[] = [
  { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite (Fast)' },
];

export const VEO_MODELS: AIModelOption[] = [
  { id: 'veo-2.0-generate-001', label: 'Veo 2.0' },
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
}

export type FluidQualityMode = 'live' | 'balanced' | 'quality';

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
 * Each slice crops a region of the canvas and sends it to its own Spout sender.
 */
export interface OutputSlice {
  id: string;
  name: string;                // User-friendly label (e.g. "Left", "Center", "Right")
  enabled: boolean;
  // Source crop region (normalized 0-1 coordinates on the canvas)
  cropX: number;               // 0-1, left edge of slice
  cropY: number;               // 0-1, top edge of slice
  cropW: number;               // 0-1, width of slice
  cropH: number;               // 0-1, height of slice
  // Spout sender
  spoutName: string;           // Sender name for this slice (e.g. "ghostArcade-Left")
  // Edge blending (per-slice)
  edgeBlendLeft: number;       // 0-0.5
  edgeBlendRight: number;
  edgeBlendTop: number;
  edgeBlendBottom: number;
  edgeBlendGamma: number;      // Default 2.2
  // Color correction (per-slice)
  brightness: number;          // 0-2, default 1
  gamma: number;               // 0.2-5, default 1
  contrast: number;            // 0-2, default 1
  // Output rotation
  rotation: 0 | 90 | 180 | 270;
}

export function createDefaultSlice(id: string, name: string, spoutSuffix: string, cropX = 0, cropW = 1): OutputSlice {
  return {
    id,
    name,
    enabled: true,
    cropX,
    cropY: 0,
    cropW,
    cropH: 1,
    spoutName: `ghostArcade-${spoutSuffix}`,
    edgeBlendLeft: 0,
    edgeBlendRight: 0,
    edgeBlendTop: 0,
    edgeBlendBottom: 0,
    edgeBlendGamma: 2.2,
    brightness: 1,
    gamma: 1,
    contrast: 1,
    rotation: 0,
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
 * Experimental flags for in-progress feature work. These are
 * deliberately NOT surfaced in the normal settings UI — the
 * preferences panel only renders them when a dev-mode URL override
 * (`?dev=1`) is present. Production users see no UI for these
 * regardless of localStorage state.
 *
 * Each flag has its own kill switch via URL param so a feature in
 * trouble can be disabled without re-launching the app:
 *   - `?webgpu-disable=1` forces webgpuPilot off (overrides
 *     localStorage). Combined with the capability probe so a
 *     machine without WebGPU also sees the pilot disabled even
 *     when the user toggled it on.
 */
export interface ExperimentalSettings {
  /** S4 pilot: enable the WebGPU + TSL particle-flow effect.
   *  Default false. Production users never see this; only enabled
   *  via the dev preferences panel + a machine that passes
   *  `webgpuCapability.probeWebGPU()`. */
  webgpuPilot: boolean;
}

export interface AppSettings {
  recording: RecordingSettings;
  output: OutputSettings;
  ui: UISettings;
  ai: AISettings;
  defaultLayerShader: DefaultLayerShader;
  experimental: ExperimentalSettings;
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

  return {
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
      // Output-window display transforms (CSS-applied on output canvas)
      outputRotation: 0,
      outputCropX: 0,
      outputCropY: 0,
      outputCropWidth: 1,
      outputCropHeight: 1,
      outputShowCursor: false,
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
    },
    ai: {
      shaderProvider: 'claude',
      claudeApiKey: '',
      claudeModel: 'claude-sonnet-4-6',
      geminiApiKey: '',
      geminiModel: 'gemini-2.5-flash',
      videoProvider: 'veo',
      lumaApiKey: '',
      lumaModel: 'ray-2',
      veoModel: 'veo-2.0-generate-001',
      replicateApiKey: '',
    },
    defaultLayerShader: 'grid',
    experimental: {
      // S4 pilot. Off by default. Enabling requires both the user
      // toggle in dev preferences AND `webgpuCapability.probeWebGPU()`
      // succeeding — neither alone unlocks the pilot.
      webgpuPilot: false,
    },
  };
}

// Local storage key
const STORAGE_KEY = 'ghost-arcade_settings';
const APP_VERSION_KEY = 'ill_app_version';
// Bump this whenever stale localStorage may break the new build.
// Any mismatch clears problematic caches on startup.
const CURRENT_APP_VERSION = '0.3.7';

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

      const settings = {
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
      };

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
  const defaults = createDefaultSettings();
  // Apply default color scheme
  applyColorScheme(getColorScheme(defaults.ui.colorScheme));
  return defaults;
}

// Save settings to localStorage (with API key encryption)
function saveSettings(settings: AppSettings) {
  try {
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

    // Dome projection settings
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
        const newSettings = fn(s);
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
