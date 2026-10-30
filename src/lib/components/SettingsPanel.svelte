<script lang="ts">
  import NdiOutputSettings from './NdiOutputSettings.svelte';
  import { uiLanguage, UI_LANGUAGES } from '../i18n';
  import { isMac } from '$lib/bridge';
  import { interfaceScale } from '../stores/interfaceScale';
  import { onMount, onDestroy } from 'svelte';
  import { tooltipsEnabled } from '../help/preferences';
  import { NATIVE_ENGINE_ONLY, settings, getSupportedFormats, COLOR_SCHEMES, CLAUDE_MODELS, GEMINI_MODELS, VEO_MODELS, LUMA_MODELS, DEFAULT_LAYER_SHADERS, type RecordingSettings, type OutputSettings, type ColorSchemeId, type FluidQualityMode, type ShaderQualityMode, type GpuInstrumentQualityMode, type ShaderAIProvider, type VideoAIProvider } from '../stores/settings';
  // Theme template registry — full visual style swap (fonts + surfaces
  // + corners + accents). See src/lib/theming/themes/.
  import { activeThemeId, themes } from '../theming/store';
  const themesList = themes.list();
  import {
    probeEncodeSupport,
    type CodecEncodeReport,
  } from '../utils/codecProbe';
  import { checkDecodeCapabilities, type DecodeCapabilityRow } from '../video/decodeCapabilities';
  import { decodeBadge, videoDecodeHealth } from '../video/videoDecodeHealth';
  import { convertForSmoothPlayback } from '../video/playbackConversionFlow';

  // Codec capability probe (Performance tab readout). Lazy.
  let codecEncode: CodecEncodeReport | null = null;
  let codecProbed = false;
  function runCodecProbe() {
    if (codecProbed) return;
    codecProbed = true;
    codecEncode = probeEncodeSupport();
  }
  // Video decoding as the render core sees it: one short clip per format.
  let decodeRows: DecodeCapabilityRow[] | null = null;
  let decodeChecking = false;
  let decodeError = '';
  async function runDecodeCheck() {
    if (decodeChecking) return;
    decodeChecking = true;
    decodeError = '';
    try {
      decodeRows = await checkDecodeCapabilities();
    } catch (error) {
      decodeError = error instanceof Error ? error.message : String(error);
    } finally {
      decodeChecking = false;
    }
  }
  $: slowProjectVideos = Object.entries($videoDecodeHealth)
    .map(([path, health]) => ({ path, health, badge: decodeBadge(health) }))
    .filter((entry) => !!entry.badge);
  import { validateAPIKey, validateLumaKey } from '../api/ai-client';
  import { updateInfo } from '../stores/updateChecker';
  import { updateModalOpen } from '../stores/uiState';
  import { project } from '../stores/layers';
  import {
    nativeRendererMainDriverGateChecks,
    nativeRendererModeLabel,
    nativeRendererRuntime,
  } from '../stores/nativeRenderer';
  import { checkForUpdate, getCachedVersionResult, type VersionCheckResult } from '../utils/versionCheck';
  import { getNativeRendererStatus } from '../api/native-renderer';
  import { openExternalUrl, invoke as bridgeInvoke, isElectron as bridgeIsElectron } from '../bridge';
  import { mergeRecordingCodecAvailability, recordingCodecOption, type RecordingCodecId, type RecordingCodecOption } from '../recording/recordingSources';

  // Version-check state for the Settings → Updates section.
  // Reads cached result on mount so the row shows last-known state
  // instantly (without re-hitting GitHub). The "Check for updates"
  // button forces a fresh API call.
  const appVersion: string = (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '?');
  // Seed from cache for instant render. getCachedVersionResult now
  // returns null if the cached `current` doesn't match the running
  // version — so on a fresh upgrade the badge stays hidden until a
  // real check completes, instead of showing stale "v1.1.3
  // available" data from a prior install.
  let versionInfo: VersionCheckResult | null = getCachedVersionResult();
  // Kick a non-forced refresh on mount so the panel updates if the
  // cache was invalidated (or absent). The cached-read above
  // remains the instant-render seed; this fills in afterwards.
  if (!versionInfo) {
    checkForUpdate({ force: false }).then(r => { versionInfo = r; }).catch(() => { /* silent */ });
  }
  let isCheckingUpdate = false;
  import { midiStore } from '../midi/midiStore';
  import ControllerLightsSettings from './ControllerLightsSettings.svelte';
  import { midiManager } from '../midi/midiManager';
  import {
    groupMappingsByControl,
    groupMatchesMessage,
    describeTarget,
    type MidiControlGroup,
  } from '../midi/midiMappingView';
  import { abletonLink } from '../sync/abletonLink';
  import AbletonLinkMonitor from './AbletonLinkMonitor.svelte';
  import { oscStore } from '../osc/oscStore';
  import { mcpStore } from '../mcp/mcpStore';
  import { CONTROL_PATH_EXAMPLES, normalizeControlPath, validateControlPath } from '../control/controlPaths';
  import { keyboardStore, formatKeyCombo, type KeyActionMode } from '../keyboard/keyboardStore';
  import WLEDMappingPanel from './WLEDMappingPanel.svelte';
  import WLEDGroupsPanel from './WLEDGroupsPanel.svelte';
  import PixelMapPanel from './PixelMapPanel.svelte';
  import DmxInputPanel from './DmxInputPanel.svelte';
  import ShowControlSettings from './show/ShowControlSettings.svelte';

  // ── MIDI mappings table ──
  // Grouped by the control rather than by the parameter, because a parameter
  // holds at most one mapping but a pad can be bound to any number of them,
  // and "unlearn this pad" is the thing that was impossible before this.
  $: midiMappingGroups = groupMappingsByControl($midiStore.mappings);
  let confirmClearMidiMappings = false;

  function clearMidiControl(group: MidiControlGroup) {
    for (const m of group.mappings) midiStore.removeMappingById(m.id);
  }


  // ── OSC Learn (in-app editor — never browser prompt()) ──
  let oscLearnOpen = false;
  let oscLearnPath = 'vj:0:trigger:0';
  function beginOscLearn() {
    oscLearnOpen = true;
    oscLearnPath = 'vj:0:trigger:0';
  }

  function confirmOscLearn() {
    const validation = validateControlPath(oscLearnPath);
    if (!validation.valid) return;
    if (oscStore.startLearn(validation.normalized)) {
      oscLearnOpen = false;
    }
  }
  let keyboardAddOpen = false;
  let keyboardAddPath = '';
  let keyboardAddMode: KeyActionMode = 'momentary';
  let keyboardAddMin = 0;
  let keyboardAddMax = 1;
  let keyboardAddStep = 0.05;
  $: nativeMainDriverGates = nativeRendererMainDriverGateChecks($nativeRendererRuntime);

  function beginKeyboardAdd() {
    keyboardAddOpen = true;
    keyboardAddPath = '';
    keyboardAddMode = 'momentary';
    keyboardAddMin = 0;
    keyboardAddMax = 1;
    keyboardAddStep = 0.05;
  }

  function startKeyboardAddLearn() {
    const path = keyboardAddPath.trim();
    if (!path) return;
    keyboardStore.startLearn(path, path, keyboardAddMode, {
      min: keyboardAddMin,
      max: keyboardAddMax,
      step: keyboardAddStep,
      value: keyboardAddMax,
    });
    keyboardAddOpen = false;
  }
  import MediaPipePanel from './MediaPipePanel.svelte';

  // Desktop recording codecs the bundled FFmpeg can encode (H.264 always).
  let nativeRecordingCodecs: RecordingCodecOption[] = mergeRecordingCodecAvailability(null);
  if (NATIVE_ENGINE_ONLY && bridgeIsElectron) {
    void bridgeInvoke<{ codecs?: Array<{ id: string; available?: boolean; reason?: string }> }>('native_recording_codecs')
      .then((result) => { nativeRecordingCodecs = mergeRecordingCodecAvailability(result?.codecs ?? null); })
      .catch(() => {});
  }
  // LicensePanel + tier-related imports removed — OSS build has no license UI.
  // Multi-Output / per-slice config (createDefaultSlice, maxOutputSlices,
  // OutputCanvasPreview) moved to the Screens tab — see ScreenPanel.svelte.
  import { isDesktopApp, getTextureShareLabel, invoke } from '$lib/bridge';
  import { liveOutput, toggleOutputFullscreen, toggleOutputWindow, openOutputDisplayMenu } from '../stores/liveOutput';
  import { getErrorLog, clearErrorLog, recordError, type ErrorEntry } from '../utils/errorReporter';
  import { openLogFolder, DEBUG_LOG_NAME } from '../utils/logFolder';
  import { isWebGPUSupported, probeWebGPU, getWebGPUInfo, type WebGPUInfo } from '../renderer/webgpuCapability';

  // Renderer panel state. Desktop native builds keep the legacy bridge flags
  // persisted for migration, but the controls are locked out by policy.
  let webgpuSupported = isWebGPUSupported();
  let webgpuInfo: WebGPUInfo = getWebGPUInfo();
  let webgpuProbing = false;
  async function refreshWebGPUStatus() {
    webgpuProbing = true;
    try {
      await probeWebGPU();
    } finally {
      webgpuSupported = isWebGPUSupported();
      webgpuInfo = getWebGPUInfo();
      webgpuProbing = false;
    }
  }

  // Snapshot of the renderer bridge flags at the time this settings
  // panel script first ran. The Electron renderer wires up which
  // canvas/bridge to mount at boot, so toggling editorWebGPU or the
  // legacy GPU effect bridge mid-session leaves the engine in a
  // half-broken state (grid disappears, layers stop receiving frames,
  // etc.). We compare current values against this snapshot to know
  // when a restart is required. Using $settings.experimental directly
  // (not the store wrapper) so the snapshot is a plain object frozen
  // at module-script-eval time.
  const bootRendererFlags = {
    editorWebGPU: $settings.experimental?.editorWebGPU ?? true,
    outputZeroCopy: $settings.experimental?.outputZeroCopy ?? true,
    allowMidChainGpuEffects: $settings.experimental?.allowMidChainGpuEffects ?? false,
  };
  $: gpuRestartRequired = !(NATIVE_ENGINE_ONLY && isDesktopApp) && (
    $settings.experimental?.editorWebGPU !== bootRendererFlags.editorWebGPU ||
    $settings.experimental?.outputZeroCopy !== bootRendererFlags.outputZeroCopy ||
    $settings.experimental?.allowMidChainGpuEffects !== bootRendererFlags.allowMidChainGpuEffects
  );

  let restarting = false;
  async function restartApp() {
    if (restarting) return;
    restarting = true;
    try {
      // Electron path — preferred. Goes through the whitelisted
      // app_relaunch IPC handler which calls app.relaunch() + exit(0)
      // so the new process boots cleanly with the new flags.
      const api = (window as any).electronAPI;
      if (api?.invoke) {
        await api.invoke('app_relaunch');
        return;
      }
      // Browser / dev-server fallback — full reload reboots Vite-side
      // module state, which is enough for the renderer-only flags
      // (editorWebGPU) since there is no separate main process.
      window.location.reload();
    } catch (err) {
      console.error('[SettingsPanel] restart failed', err);
      restarting = false;
    }
  }

  const tsLabel = getTextureShareLabel();

  let diagnosticsOpen = false;
  let errorLog: ErrorEntry[] = [];

  // AI key validation state
  let claudeKeyValidating = false;
  let claudeKeyValid: boolean | null = null;
  let geminiKeyValidating = false;
  let geminiKeyValid: boolean | null = null;
  let lumaKeyValidating = false;
  let lumaKeyValid: boolean | null = null;

  async function testClaudeKey() {
    if (!$settings.ai.claudeApiKey) { claudeKeyValid = false; return; }
    claudeKeyValidating = true;
    claudeKeyValid = await validateAPIKey('claude', $settings.ai.claudeApiKey, $settings.ai.claudeModel);
    claudeKeyValidating = false;
  }

  async function testGeminiKey() {
    if (!$settings.ai.geminiApiKey) { geminiKeyValid = false; return; }
    geminiKeyValidating = true;
    geminiKeyValid = await validateAPIKey('gemini', $settings.ai.geminiApiKey, $settings.ai.geminiModel);
    geminiKeyValidating = false;
  }

  async function testLumaKey() {
    if (!$settings.ai.lumaApiKey) { lumaKeyValid = false; return; }
    lumaKeyValidating = true;
    lumaKeyValid = await validateLumaKey($settings.ai.lumaApiKey);
    lumaKeyValidating = false;
  }

  export let isOpen = false;
  export let onClose: () => void = () => {};

  // Output display transforms now live in $settings.output (auto-broadcast
  // via state-sync to the output window; CSS-applied on the output canvas).
  // No props needed — read/write the store directly.
  $: outputRotation = $settings.output.outputRotation ?? 0;
  $: outputCropRegion = {
    x: $settings.output.outputCropX ?? 0,
    y: $settings.output.outputCropY ?? 0,
    width: $settings.output.outputCropWidth ?? 1,
    height: $settings.output.outputCropHeight ?? 1,
  };
  $: showOutputCursor = $settings.output.outputShowCursor ?? false;

  function setOutputRotation(deg: 0 | 90 | 180 | 270) {
    settings.update(s => ({ ...s, output: { ...s.output, outputRotation: deg } }));
  }
  function setOutputCrop(part: 'x' | 'y' | 'width' | 'height', v: number) {
    settings.update(s => ({
      ...s,
      output: {
        ...s.output,
        outputCropX:      part === 'x' ? v : (s.output.outputCropX ?? 0),
        outputCropY:      part === 'y' ? v : (s.output.outputCropY ?? 0),
        outputCropWidth:  part === 'width'  ? v : (s.output.outputCropWidth ?? 1),
        outputCropHeight: part === 'height' ? v : (s.output.outputCropHeight ?? 1),
      },
    }));
  }
  function resetOutputCrop() {
    settings.update(s => ({ ...s, output: { ...s.output, outputCropX: 0, outputCropY: 0, outputCropWidth: 1, outputCropHeight: 1 } }));
  }
  function setShowOutputCursor(val: boolean) {
    settings.update(s => ({ ...s, output: { ...s.output, outputShowCursor: val } }));
  }

  // ── Match Resolution ──────────────────────────────────────────────────────
  // Asks the Electron main process for the native pixel dimensions of the
  // display the output window is on (or would land on). Sets the project
  // canvas to those dimensions so source pixels = projector pixels = zero
  // scaling overhead in the GPU compositor.
  let matchResLabel = '';
  let matchResBusy = false;
  async function handleMatchResolution() {
    if (matchResBusy) return;
    matchResBusy = true;
    matchResLabel = '';
    try {
      const { invoke, isDesktopApp } = await import('$lib/bridge');
      if (!isDesktopApp) { matchResLabel = 'Desktop only'; return; }
      const info: any = await invoke('get_output_display_info');
      if (info?.nativeWidth && info?.nativeHeight) {
        project.setProjectDimensions(info.nativeWidth, info.nativeHeight);
        matchResLabel = `${info.label}: ${info.nativeWidth}x${info.nativeHeight}`;
      } else {
        matchResLabel = 'No display info returned';
      }
    } catch (e) {
      matchResLabel = 'Failed: ' + (e instanceof Error ? e.message : String(e));
    } finally {
      matchResBusy = false;
      setTimeout(() => { matchResLabel = ''; }, 4000);
    }
  }

  // MIDI
  $: midiDevices = $midiStore.devices.filter((d: any) => d.state === 'connected');
  $: midiSelectedId = $midiStore.selectedDeviceId;
  $: midiClockSelectedId = $midiStore.selectedClockInputId;
  $: midiAvailable = $midiStore.available;
  $: midiEditMode = $midiStore.editMode;

  function handleMidiDeviceChange(e: Event) {
    const id = (e.target as HTMLSelectElement).value;
    if (id) midiManager.selectDevice(id);
  }

  function handleMidiClockDeviceChange(e: Event) {
    const id = (e.target as HTMLSelectElement).value;
    midiManager.selectClockInputDevice(id || null);
  }

  // ── Sidebar nav ──────────────────────────────────────────────────────
  // Section IDs are namespaced category:slug. The sidebar lists categories
  // with their sections; selecting a section displays only that section in
  // the content pane. Advanced sections are hidden until showAdvanced is
  // toggled on (persisted to localStorage so power users don't re-flip it
  // every session).
  // Consolidated layout (2026-06):
  //   • Project (Canvas + Layers) folded into Output > Display — those
  //     three sections are all "what comes out of the renderer" so
  //     grouping them under Display matches users' mental model.
  //   • Output > Color Correction and Output > Edge Blending REMOVED:
  //     they now live on the Screens tab (per-slice) where they
  //     belong with the rest of the projector/screen calibration UI.
  //   • Recording and AI are top-level (no synthetic single-child
  //     category to read).
  //   • Advanced sections always visible; the Show-Advanced checkbox
  //     was demoted to a power-user no-op.
  type SectionId =
    | 'app:appearance' | 'app:updates'
    | 'output:display' | 'output:ndi'
    | 'performance:gpu' | 'performance:render-quality' | 'performance:video-decoding'
    | 'recording'
    | 'integrations:midi' | 'integrations:osc' | 'integrations:keyboard' | 'integrations:wled' | 'integrations:pixelmap' | 'integrations:dmxinput' | 'integrations:mediapipe'
    | 'show:timecode' | 'show:schedule' | 'show:startup' | 'show:projectors'
    | 'ai';
  interface SidebarSection { id: SectionId; label: string; advanced?: boolean }
  interface SidebarCategory { id: string; label: string; sections: SidebarSection[] }
  const SIDEBAR: SidebarCategory[] = [
    { id: 'app', label: 'App', sections: [
      { id: 'app:appearance', label: 'Appearance' },
      { id: 'app:updates', label: 'Updates' },
    ]},
    { id: 'output', label: 'Output', sections: [
      // Display is the single global-output section: cursor overlay,
      // rotation, blackout, plus Canvas (size/aspect) and Layers
      // (default layer behavior) which used to live under "Project".
      { id: 'output:display', label: 'Display' },
      { id: 'output:ndi', label: 'NDI output' },
    ]},
    { id: 'performance', label: 'Performance', sections: [
      { id: 'performance:gpu', label: 'Renderer' },
      { id: 'performance:render-quality', label: 'Render quality' },
      { id: 'performance:video-decoding', label: 'Video decoding' },
    ]},
    { id: 'recording', label: 'Recording', sections: [
      { id: 'recording', label: 'Recording' },
    ]},
    { id: 'integrations', label: 'Integrations', sections: [
      { id: 'integrations:midi', label: 'MIDI' },
      { id: 'integrations:osc', label: 'OSC' },
      { id: 'integrations:keyboard', label: 'Keyboard' },
      { id: 'integrations:wled', label: 'WLED' },
      { id: 'integrations:pixelmap', label: 'Pixel mapping' },
      { id: 'integrations:dmxinput', label: 'DMX input' },
      { id: 'integrations:mediapipe', label: 'MediaPipe' },
    ]},
    // Unattended shows: timecode chase, the schedule, start at boot and
    // PJLink projectors. The cue list itself lives beside the Show timeline.
    { id: 'show', label: 'Show control', sections: [
      { id: 'show:timecode', label: 'Timecode' },
      { id: 'show:schedule', label: 'Schedule' },
      { id: 'show:startup', label: 'Start at boot' },
      { id: 'show:projectors', label: 'Projectors' },
    ]},
    { id: 'ai', label: 'AI', sections: [
      { id: 'ai', label: 'AI' },
    ]},
  ];

  // Old top-tab hash values map to a section in the new layout — keeps
  // the integrated-GPU banner's "go to Performance" link (and similar
  // deep links) working without forcing every caller to learn the new
  // section-id shape.
  const HASH_TO_SECTION: Record<string, SectionId> = {
    general: 'app:appearance',
    output: 'output:display',
    performance: 'performance:render-quality',
    midi: 'integrations:midi',
    osc: 'integrations:osc',
    keyboard: 'integrations:keyboard',
    wled: 'integrations:wled',
    pixelmap: 'integrations:pixelmap',
    dmxinput: 'integrations:dmxinput',
    mediapipe: 'integrations:mediapipe',
    timecode: 'show:timecode',
    schedule: 'show:schedule',
    startup: 'show:startup',
    projectors: 'show:projectors',
    ai: 'ai',
  };

  let selectedSection: SectionId = 'app:appearance';
  // Advanced sections are always visible now — the checkbox was hiding
  // mildly intimidating but useful sections (MediaPipe, Renderer)
  // from users who would have benefited from finding them. Variable kept
  // as a constant so the existing visibility filter below still compiles.
  const showAdvanced = true;
  try {
    const saved = localStorage.getItem('ghostarcade-settings-section');
    if (saved && SIDEBAR.some(c => c.sections.some(s => s.id === saved))) {
      selectedSection = saved as SectionId;
    }
  } catch { /* ignore */ }
  $: try { localStorage.setItem('ghostarcade-settings-section', selectedSection); } catch { /* */ }

  // The guided tour jumps straight to a section (MIDI clock, Ableton Link).
  onMount(() => {
    const jump = (e: Event) => {
      const section = (e as CustomEvent<{ section?: string }>).detail?.section;
      if (section && SIDEBAR.some(c => c.sections.some(s => s.id === section))) selectedSection = section as SectionId;
    };
    window.addEventListener('ga-settings-section', jump);
    return () => window.removeEventListener('ga-settings-section', jump);
  });

  // Identify mode suppresses MIDI routing, so it must never outlive the view
  // that explains it is on. Leaving it running would hand someone a dead
  // controller with nothing on screen saying why.
  $: if (selectedSection !== 'integrations:midi' && $midiStore.identifyMode) {
    midiStore.setIdentifyMode(false);
  }
  $: if (!isOpen && $midiStore.identifyMode) midiStore.setIdentifyMode(false);

  // A section that throws while rendering used to take the whole panel down:
  // no boundary, so the error unwound the component and left a black panel
  // with no sidebar. Worse, the section is persisted above and restored on
  // open, so the panel reopened straight into the broken section every time,
  // and a reinstall kept it because user data survives reinstalls.
  //
  // Each section now renders inside a boundary. On failure the error goes to
  // Diagnostics, which is the only place a user can copy it from, and the
  // saved section is cleared so the next open lands on the default instead
  // of the thing that just failed.
  //
  // The fallback is rendered from this state, as one {#if} beside the
  // boundary, rather than through the boundary's `failed` snippet. Svelte
  // builds that snippet in a microtask per error, and a bad value used in
  // several expressions throws several times in one flush: every call found
  // no fallback yet to tear down, so they stacked, and reset only cleared the
  // last one, leaving stale fallbacks on screen beside the recovered section.
  // Keeping the section alongside the error also stops a fallback following
  // the user into a different section.
  let sectionFailure: { section: SectionId; error: unknown; reset: () => void } | null = null;

  function handleSectionError(error: unknown, reset: () => void) {
    // One failure can arrive as several calls in the same flush; record it once.
    if (sectionFailure?.section !== selectedSection) {
      recordError(error, `settings-section:${selectedSection}`);
      console.error('[Settings] section failed to render:', selectedSection, error);
    }
    // Keep the latest reset: each call replaced the boundary's previous state.
    sectionFailure = { section: selectedSection, error, reset };
    try { localStorage.removeItem('ghostarcade-settings-section'); } catch { /* */ }
  }

  function retrySection() {
    const failure = sectionFailure;
    sectionFailure = null;
    failure?.reset();
  }

  function leaveFailedSection() {
    sectionFailure = null;
    selectedSection = 'app:appearance';
  }

  // Is the NDI native addon built + the NDI runtime initialized? Drives
  // the "NDI" option's disabled state in the per-slice transport
  // dropdown. Probed once on mount; falls back to false if the
  // ghostNDI bridge isn't available (non-Electron build).
  let ndiAvailable = false;
  onMount(async () => {
    const h = (typeof window !== 'undefined' ? window.location.hash : '').replace(/^#/, '');
    if (h && HASH_TO_SECTION[h]) {
      selectedSection = HASH_TO_SECTION[h];
      try { history.replaceState(null, '', window.location.pathname + window.location.search); } catch { /* */ }
    }
    try {
      const ndi = (window as any).ghostNDI;
      if (ndi) {
        const r = await ndi.available();
        ndiAvailable = !!r?.available;
      }
    } catch { ndiAvailable = false; }
  });
  $: if (isOpen && typeof window !== 'undefined') {
    const h = window.location.hash.replace(/^#/, '');
    if (h && HASH_TO_SECTION[h]) {
      selectedSection = HASH_TO_SECTION[h];
      try { history.replaceState(null, '', window.location.pathname + window.location.search); } catch { /* */ }
    }
  }
  // Listen for a `close-settings` event so other components (e.g. the
  // MediaPipe binding form, which needs the user to reach a param
  // outside this modal) can dismiss us programmatically.
  function handleCloseRequest() { onClose(); }
  onMount(() => {
    if (typeof window === 'undefined') return;
    window.addEventListener('close-settings', handleCloseRequest);
  });
  onDestroy(() => {
    midiStore.setIdentifyMode(false);
    if (typeof window === 'undefined') return;
    window.removeEventListener('close-settings', handleCloseRequest);
  });
  // Lazy probes — run when the user first lands on a section that needs
  // the data. Cheaper than probing at mount for sections the user may
  // never open.
  $: if (selectedSection === 'performance:render-quality' && !codecProbed) runCodecProbe();
  $: if (selectedSection === 'performance:video-decoding' && !decodeRows && !decodeChecking && !decodeError && isDesktopApp) void runDecodeCheck();
  let webgpuProbedFromPanel = false;
  $: if (selectedSection === 'performance:gpu' && !webgpuProbedFromPanel) {
    webgpuProbedFromPanel = true;
    refreshWebGPUStatus();
  }

  // License panel state
  let licenseOpen = false;

  // Get supported formats
  const formats = getSupportedFormats();

  // Canvas size presets
  const canvasPresets = [
    { label: '1920 x 1080 (16:9 landscape)', width: 1920, height: 1080 },
    { label: '1080 x 1920 (9:16 portrait)', width: 1080, height: 1920 },
    { label: '1080 x 1080 (square)', width: 1080, height: 1080 },
    { label: '1024 x 768 (4:3)', width: 1024, height: 768 },
    { label: '3840 x 2160 (4K)', width: 3840, height: 2160 },
    { label: '1280 x 720 (720p)', width: 1280, height: 720 },
    { label: 'Custom', width: 0, height: 0 },
  ];

  let customWidth = $project.width;
  let customHeight = $project.height;
  let showCustomInputs = false;
  $: isCustomSize = showCustomInputs || !canvasPresets.slice(0, -1).some(
    p => p.width === $project.width && p.height === $project.height
  );

  function handleCanvasPresetChange(e: Event) {
    const value = (e.target as HTMLSelectElement).value;
    if (value === 'Custom') {
      showCustomInputs = true;
      customWidth = $project.width;
      customHeight = $project.height;
      return;
    }
    showCustomInputs = false;
    const preset = canvasPresets.find(p => p.label === value);
    if (preset && preset.width > 0) {
      project.setProjectDimensions(preset.width, preset.height);
      customWidth = preset.width;
      customHeight = preset.height;
    }
  }

  function applyCustomCanvasSize() {
    const w = Math.max(128, Math.min(7680, customWidth));
    const h = Math.max(128, Math.min(7680, customHeight));
    customWidth = w;
    customHeight = h;
    project.setProjectDimensions(w, h);
  }

  // Spout output resolution options
  const spoutResolutions: { value: OutputSettings['spoutResolution']; label: string }[] = [
    { value: 'match', label: 'Match canvas' },
    { value: 'output', label: 'Match output display' },
    { value: '720p', label: '1280×720 (720p)' },
    { value: '1080p', label: '1920×1080 (1080p)' },
    { value: 'WXGA', label: '1280×800 (WXGA)' },
    { value: 'WUXGA', label: '1920×1200 (WUXGA)' },
    { value: '4K', label: '3840×2160 (4K)' },
    { value: 'custom', label: 'Custom...' },
  ];

  // Detected output display resolution
  let detectedOutputRes: { width: number; height: number } | null = null;
  async function detectOutputDisplay() {
    try {
      const displays: any[] = await invoke('get_displays');
      const primary = displays.find((d: any) => d.isPrimary);
      const external = displays.find((d: any) => !d.isPrimary);
      // Prefer external display (projector), fallback to primary
      const target = external || primary;
      if (target) {
        detectedOutputRes = { width: target.width, height: target.height };
      }
    } catch {
      // Not in Electron/Tauri — no display detection
    }
  }
  // Detect on mount
  if (isDesktopApp) detectOutputDisplay();

  // Test pattern UI removed in v0.3.5 — kept import line empty to preserve
  // line numbers for any in-flight diffs. Re-add if reintroducing the UI.

  function handleSpoutToggle(e: Event) {
    const checked = (e.target as HTMLInputElement).checked;
    settings.setSpoutEnabled(checked);
  }

  function handleSpoutNameChange(e: Event) {
    const value = (e.target as HTMLInputElement).value;
    settings.setSpoutName(value);
  }

  function handleSpoutResolutionChange(e: Event) {
    const value = (e.target as HTMLSelectElement).value as OutputSettings['spoutResolution'];
    settings.setSpoutResolution(value);
  }

  // Bitrate options
  const bitrateOptions = [
    { value: 2500000, label: '2.5 Mbps (small files)' },
    { value: 5000000, label: '5 Mbps (balanced)' },
    { value: 8000000, label: '8 Mbps (high quality)' },
    { value: 12000000, label: '12 Mbps (best quality)' },
  ];

  const fluidQualityModes: { value: FluidQualityMode; label: string }[] = [
    { value: 'live', label: 'Live (fastest)' },
    { value: 'balanced', label: 'Balanced' },
    { value: 'quality', label: 'Quality (best visuals)' },
  ];

  /*
   * Labels state the scale the NATIVE core actually renders at, which is what
   * these now drive. The old 100/75/50/25 described the browser renderer's
   * scaling, and that path does not run in a native-only build -- the control
   * had no effect on anything at all. The core's tiers are 1.0 / 0.90 / 0.72 /
   * 0.56, so the percentages are those and not round numbers.
   */
  const shaderQualityModes: { value: ShaderQualityMode; label: string }[] = [
    { value: 'full', label: 'Native (100%)' },
    { value: 'high', label: 'Ultra (90%)' },
    { value: 'medium', label: 'Balanced (72%)' },
    { value: 'low', label: 'Performance (56%)' },
  ];

  const gpuInstrumentQualityModes: { value: GpuInstrumentQualityMode; label: string }[] = [
    { value: 'auto', label: 'Auto' },
    { value: 'low', label: 'Performance' },
    { value: 'balanced', label: 'Balanced' },
    { value: 'high', label: 'High' },
    { value: 'ultra', label: 'Ultra' },
  ];

  function handleFormatChange(e: Event) {
    const value = (e.target as HTMLSelectElement).value as RecordingSettings['format'];
    settings.setRecordingFormat(value);
  }

  function handleBitrateChange(e: Event) {
    const value = parseInt((e.target as HTMLSelectElement).value);
    settings.setVideoBitrate(value);
  }

  function handleAutoDownloadChange(e: Event) {
    const checked = (e.target as HTMLInputElement).checked;
    settings.setAutoDownload(checked);
  }

  function handleIncludeAudioChange(e: Event) {
    const checked = (e.target as HTMLInputElement).checked;
    settings.setIncludeAudio(checked);
  }

  async function handlePickDirectory() {
    await settings.pickSaveDirectory();
  }

  function handleClearDirectory() {
    settings.clearSaveDirectory();
  }

  function handleOverlayClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onClose();
    }
  }

  function handleColorSchemeChange(schemeId: ColorSchemeId) {
    settings.setColorScheme(schemeId);
  }

  function handleFluidQualityChange(e: Event) {
    const value = (e.target as HTMLSelectElement).value as FluidQualityMode;
    settings.setFluidQuality(value);
  }

  function handleShaderQualityChange(e: Event) {
    const value = (e.target as HTMLSelectElement).value as ShaderQualityMode;
    /* Storing it is the whole job: App.svelte watches this and pushes the
       matching tier to the native core, on change and at startup. */
    settings.setShaderQuality(value);
  }

  // Settings → Video Memory. Automatic is a quarter of the GPU's memory
  // (512 MB to 8 GB); the core reports the GPU's memory so the menu can
  // say what that comes to here.
  const videoMemoryChoices = [1024, 2048, 4096, 8192, 16384];
  let gpuMemoryMb = 0;
  $: autoVideoMemoryMb = gpuMemoryMb > 0 ? Math.min(8192, Math.max(512, Math.round(gpuMemoryMb / 4))) : 0;
  const formatMemory = (mb: number) => mb >= 1024 ? `${+(mb / 1024).toFixed(mb % 1024 ? 1 : 0)} GB` : `${mb} MB`;
  onMount(() => {
    if (!isDesktopApp) return;
    void getNativeRendererStatus()
      .then((status) => { gpuMemoryMb = Number(status?.gpu_memory_mb) || 0; })
      .catch(() => {});
  });
  function handleVideoMemoryChange(e: Event) {
    settings.setVideoMemoryMb(Number((e.target as HTMLSelectElement).value));
  }

  function handleGpuInstrumentQualityChange(e: Event) {
    const value = (e.target as HTMLSelectElement).value as GpuInstrumentQualityMode;
    settings.setGpuInstrumentQuality(value);
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if isOpen}
  <div data-help-page="settings" class="settings-overlay" onclick={handleOverlayClick} role="dialog" aria-modal="true">
    <div class="settings-panel">
      <div class="settings-header">
        <h2>Settings</h2>
        <button class="close-btn" onclick={onClose} aria-label="Close settings">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>

      <!-- Body: sidebar + content. Sidebar lists categories with their
           sections; clicking a section swaps the content pane. Advanced
           sections are filtered by the showAdvanced toggle at the
           bottom of the sidebar. -->
      <div class="settings-body">
        <aside class="settings-sidebar">
          {#each SIDEBAR as cat (cat.id)}
            {@const visibleSections = cat.sections.filter(s => showAdvanced || !s.advanced)}
            {#if visibleSections.length > 0}
              {#if visibleSections.length > 1}
                <!-- Only show the category header when there's more
                     than one section to group — single-section
                     categories (Recording, AI) used to read as
                     "Recording > Recording" which is silly. -->
                <div class="sidebar-category">{cat.label}</div>
              {/if}
              {#each visibleSections as sec (sec.id)}
                <button
                  class="sidebar-section"
                  class:active={selectedSection === sec.id}
                  onclick={() => selectedSection = sec.id}
                >{visibleSections.length === 1 ? cat.label : sec.label}</button>
              {/each}
            {/if}
          {/each}
        </aside>

      <div class="settings-content">
        <!-- Update Available Banner — single button opens the UpdateModal,
             which shows release notes and links to the public download page. -->
        {#if $updateInfo.available}
          <div class="update-banner">
            <div class="update-banner-content">
              <div class="update-badge">Update</div>
              <div class="update-text">
                <strong>Ghost Arcade Pro {$updateInfo.latestVersion}</strong> is available
                <span class="update-current">(you have v{$updateInfo.currentVersion})</span>
              </div>
            </div>
            <div class="update-links">
              <button class="update-cta-btn primary-btn" onclick={() => updateModalOpen.set(true)}>
                See what's new
              </button>
            </div>
          </div>
        {/if}

        {#key selectedSection}
        <svelte:boundary onerror={handleSectionError}>
        <!-- Appearance Section -->
        {#if selectedSection === 'output:ndi'}
          <section class="settings-section"><h3>NDI output</h3><NdiOutputSettings /></section>
        {/if}

        {#if selectedSection === 'app:appearance'}
        <section class="settings-section">
          <h3>Appearance</h3>
          <div class="setting-row">
            <div class="setting-label">
              <label class="label-text" for="ui-language">Language</label>
              <span class="label-hint">The language of menus, buttons and help. {isMac ? 'Cmd' : 'Ctrl'}+Shift+E always returns to English.</span>
            </div>
            <select id="ui-language" translate="no" value={$uiLanguage} onchange={e => uiLanguage.set(e.currentTarget.value)}>
              {#each UI_LANGUAGES as language}
                <option value={language.code}>{language.name}{language.beta ? ' · beta' : ''}</option>
              {/each}
            </select>
          </div>
          {#if isDesktopApp}
          <div class="setting-row">
            <div class="setting-label">
              <label class="label-text" for="interface-scale">Interface size</label>
              <span class="label-hint">Resize controls and text for your display. Projector output resolution stays unchanged.</span>
            </div>
            <select id="interface-scale" value={$interfaceScale} onchange={e => interfaceScale.set(Number(e.currentTarget.value))}>
              {#each [0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as scale}
                <option value={scale}>{Math.round(scale * 100)}%{scale === 1 ? ' · Default' : ''}</option>
              {/each}
            </select>
          </div>
          {/if}
          <div class="setting-row">
            <div class="setting-label">
              <label class="label-text" for="tooltips-enabled">Tooltips</label>
              <span class="label-hint">Show feature explanations and documentation links when hovering or focusing controls.</span>
            </div>
            <label class="toggle">
              <input id="tooltips-enabled" type="checkbox" checked={$tooltipsEnabled} onchange={e => tooltipsEnabled.set(e.currentTarget.checked)} />
              <span class="toggle-slider"></span>
            </label>
          </div>

          <!-- Theme Templates — a complete style overhaul (fonts,
               surfaces, accents, corner system) vs just an accent
               swap. New themes plug in via src/lib/theming/themes/.  -->
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Theme template</span>
              <span class="label-hint">Full visual style — fonts, surfaces, corner system, accents. Switches the whole app at once.</span>
            </div>
          </div>

          <div class="theme-template-grid">
            {#each themesList as theme}
              <button
                class="theme-template-card"
                class:active={$activeThemeId === theme.id}
                aria-pressed={$activeThemeId === theme.id}
                onclick={() => activeThemeId.set(theme.id)}
              >
                <div class="theme-preview" style="
                  background: {theme.tokens.void};
                  border-color: {theme.tokens.line3};
                  font-family: {theme.tokens.fontUi};
                ">
                  <div class="theme-bar" style="
                    background: {theme.tokens.bar};
                    border-bottom-color: {theme.tokens.line2};
                  "></div>
                  <div class="theme-body">
                    <div class="theme-panel" style="background: {theme.tokens.panel};">
                      <div class="theme-card" style="background: {theme.tokens.card};">
                        <i style="background: {theme.tokens.coral};"></i>
                        <i style="background: {theme.tokens.violet};"></i>
                        <i style="background: {theme.tokens.blue};"></i>
                      </div>
                    </div>
                  </div>
                </div>
                <span class="theme-name">{theme.name}</span>
                <span class="theme-desc">{theme.description ?? ''}</span>
              </button>
            {/each}
          </div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Accent scheme</span>
              <span class="label-hint">Fine-tune accent colours on top of the active theme template.</span>
            </div>
          </div>

          <div class="color-scheme-grid">
            {#each COLOR_SCHEMES as scheme}
              <button
                class="color-scheme-card"
                class:active={$settings.ui.colorScheme === scheme.id}
                onclick={() => handleColorSchemeChange(scheme.id)}
              >
                <div class="scheme-preview" style="
                  background: {scheme.colors.bgPrimary};
                  border-color: {scheme.colors.borderPrimary};
                ">
                  <div class="scheme-accent" style="background: {scheme.colors.accentPrimary};"></div>
                  <div class="scheme-accent-secondary" style="background: {scheme.colors.accentSecondary};"></div>
                </div>
                <span class="scheme-name">{scheme.name}</span>
                <span class="scheme-desc">{scheme.description}</span>
              </button>
            {/each}
          </div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Safe mode</span>
              <span class="label-hint">Add a confirmation prompt before deleting layers, shaders, clips, or media library entries. Useful when you're moving fast in a session and don't want a misclick to nuke a layer.</span>
            </div>
            <label class="toggle">
              <input type="checkbox" checked={$settings.ui.safeMode ?? false}
                onchange={(e) => settings.update(s => ({ ...s, ui: { ...s.ui, safeMode: (e.target as HTMLInputElement).checked } }))} />
              <span class="toggle-slider"></span>
            </label>
          </div>

          <!-- Flip VJ layout — used to be an icon in the VJ top bar; we
               moved it here because most users set it once and never touch
               it again, so it doesn't deserve permanent header real estate. -->
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Reverse VJ layout (right-handed)</span>
              <span class="label-hint">Mirrors the VJ mode layout so the clip grid sits on the right and the preview / controls land on the left. Useful for right-handed users who'd rather scrub the timeline with their dominant hand.</span>
            </div>
            <label class="toggle">
              <input type="checkbox" checked={$settings.ui.vjLayoutReversed ?? false}
                onchange={(e) => settings.update(s => ({ ...s, ui: { ...s.ui, vjLayoutReversed: (e.target as HTMLInputElement).checked } }))} />
              <span class="toggle-slider"></span>
            </label>
          </div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Snap to layers and canvas edges</span>
              <span class="label-hint">Dragged points snap to other layers and to the canvas edges. Hold {isMac ? 'Cmd' : 'Ctrl'} while dragging to move freely. Same as Snap in the status bar.</span>
            </div>
            <label class="toggle">
              <input type="checkbox" checked={$settings.ui.gridSettings?.snapToLayers !== false}
                onchange={(e) => settings.update(s => ({
                  ...s,
                  ui: {
                    ...s.ui,
                    gridSettings: {
                      ...(s.ui.gridSettings ?? { enabled: false, columns: 12, rows: 12, snapToGrid: false, snapToLayers: true }),
                      snapToLayers: (e.target as HTMLInputElement).checked,
                    },
                  },
                }))} />
              <span class="toggle-slider"></span>
            </label>
          </div>

          <!-- Mapping warp-handle drag granularity. Default 1px =
               every mouse-drag of a corner / edge / move handle
               snaps the result to an integer project pixel. Helps
               hit exact target pixels when aligning a layer to a
               physical surface edge. Fine-tune below 1px (sub) or
               drop the snap entirely (free). -->
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Warp drag granularity</span>
              <span class="label-hint">How precise mouse drags are in mapping mode. Snaps to the project's pixel grid (1920×1080 at default), independent of editor zoom. Lower = more precise; "free" disables snap entirely.</span>
            </div>
            <select
              value={$settings.ui.warpDragGranularity ?? '1px'}
              onchange={(e) => {
                const v = (e.target as HTMLSelectElement).value as 'free' | 'sub' | '1px' | '5px' | '10px';
                settings.update(s => ({ ...s, ui: { ...s.ui, warpDragGranularity: v } }));
              }}
            >
              <option value="1px">1 pixel (default)</option>
              <option value="sub">0.5 pixel (sub)</option>
              <option value="5px">5 pixels</option>
              <option value="10px">10 pixels</option>
              <option value="free">Free (no snap)</option>
            </select>
          </div>
        </section>

        {/if}
        <!-- Updates Section -->
        {#if selectedSection === 'app:updates'}
        <section class="settings-section">
          <h3>Updates</h3>
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Version</span>
              <span class="label-hint">
                Currently running v{appVersion}.
                {#if versionInfo?.error}
                  Last check failed: {versionInfo.error}.
                {:else if versionInfo?.hasUpdate && versionInfo.latest}
                  <strong class="accent-text">{versionInfo.latest}</strong> is available — open the download page to install it.
                {:else if versionInfo?.latest && !versionInfo.hasUpdate}
                  You're on the latest release.
                {:else}
                  Click to check for newer releases.
                {/if}
              </span>
            </div>
            <div class="button-group">
              {#if versionInfo?.hasUpdate && versionInfo.releaseUrl}
                <a
                  class="btn-update-link"
                  href={versionInfo.releaseUrl}
                  onclick={(event) => {
                    event.preventDefault();
                    openExternalUrl(versionInfo?.releaseUrl || '');
                  }}
                >Download page</a>
              {/if}
              <button
                class="btn-check-update"
                onclick={async () => { isCheckingUpdate = true; versionInfo = await checkForUpdate({ force: true }); isCheckingUpdate = false; }}
                disabled={isCheckingUpdate}
              >{isCheckingUpdate ? 'Checking…' : 'Check for updates'}</button>
            </div>
          </div>
        </section>

        {/if}
        <!-- Canvas Size Section -->
        <!-- Canvas + Layers used to live under a "Project" category but
             both describe output-frame behavior, so they were folded
             into the Display section. -->
        {#if selectedSection === 'output:display'}
        <!-- First on the Display page: sending the picture to the projector. -->
        <section class="settings-section">
          <h3>Output</h3>
          <!-- Send the output to the projector from here too: the same
               controls as the mapping toolbar and the VJ header, so it is
               reachable whichever mode the project opened in. -->
          <div class="setting-row output-send-row">
            <div class="setting-label">
              <span class="label-text">Projector</span>
              <span class="label-hint">
                {#if $liveOutput.mode === 'fullscreen'}
                  Fullscreen on the projector
                {:else if $liveOutput.mode === 'window'}
                  In a floating output window
                {:else}
                  Not sent to a projector yet
                {/if}
              </span>
            </div>
            <div class="output-send-buttons">
              <button
                class="secondary-btn output-send"
                class:active={$liveOutput.mode === 'fullscreen'}
                onclick={toggleOutputFullscreen}
                oncontextmenu={openOutputDisplayMenu}
                aria-pressed={$liveOutput.mode === 'fullscreen'}
                title="Fullscreen on the projector or external display"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <rect x="2.5" y="9" width="12" height="8" rx="2" />
                  <circle cx="7" cy="13" r="2.1" />
                  <path d="M14.5 11.2 21.5 7.5" />
                  <path d="M14.5 14.8 21.5 18.5" />
                  <path d="M21.5 7.5v11" />
                </svg>
                {$liveOutput.mode === 'fullscreen' ? 'Stop fullscreen' : 'Fullscreen output'}
              </button>
              <button
                class="secondary-btn"
                class:active={$liveOutput.mode === 'window'}
                onclick={toggleOutputWindow}
                aria-pressed={$liveOutput.mode === 'window'}
                title="A floating output window you can drag to any screen"
              >
                {$liveOutput.mode === 'window' ? 'Close Output' : 'Output Window'}
              </button>
              {#if isDesktopApp}
                <button
                  class="secondary-btn"
                  onclick={(e) => openOutputDisplayMenu(e)}
                  title="Choose which display the fullscreen output goes to"
                >
                  Choose display…
                </button>
              {/if}
            </div>
          </div>

          <!-- Match Resolution: snaps the project canvas to the native pixel
               dimensions of the display the output window is on (or would be).
               Eliminates source→projector scaling entirely. -->
        </section>
        {/if}

        {#if selectedSection === 'output:display'}
        <section class="settings-section">
          <h3>Canvas</h3>

          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Zoom speed</span>
              <span class="label-hint">How far the mapping canvas zooms per scroll or pinch. Lower it if a trackpad zooms too fast.</span>
            </div>
            <select value={String($settings.ui.canvasZoomSpeed ?? 1)}
              onchange={(e) => settings.update((s) => { const next = { ...s, ui: { ...s.ui, canvasZoomSpeed: Number((e.target as HTMLSelectElement).value) } }; return next; })}>
              <option value="0.25">Very slow</option>
              <option value="0.5">Slow</option>
              <option value="1">Normal</option>
              <option value="1.75">Fast</option>
              <option value="3">Very fast</option>
            </select>
          </div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Two-finger scroll</span>
              <span class="label-hint">On the mapping canvas. Zoom suits a mouse wheel; Pan suits a trackpad, where a pinch zooms.</span>
            </div>
            <select value={$settings.ui.canvasScrollGesture ?? 'zoom'}
              onchange={(e) => settings.update((s) => ({ ...s, ui: { ...s.ui, canvasScrollGesture: (e.target as HTMLSelectElement).value as 'zoom' | 'pan' } }))}>
              <option value="zoom">Zoom</option>
              <option value="pan">Pan</option>
            </select>
          </div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Resolution</span>
              <span class="label-hint">Current: {$project.width} x {$project.height}</span>
            </div>
            <select
              value={isCustomSize ? 'Custom' : canvasPresets.find(p => p.width === $project.width && p.height === $project.height)?.label || 'Custom'}
              onchange={handleCanvasPresetChange}
            >
              {#each canvasPresets as preset}
                <option value={preset.label}>{preset.label}</option>
              {/each}
            </select>
          </div>

          {#if isCustomSize}
            <div class="setting-row custom-size-row">
              <div class="setting-label">
                <span class="label-text">Custom size</span>
                <span class="label-hint">Min 128, Max 7680</span>
              </div>
              <div class="custom-size-inputs">
                <input
                  type="number"
                  class="text-input size-input"
                  bind:value={customWidth}
                  min="128"
                  max="7680"
                  placeholder="Width"
                />
                <span class="size-separator">x</span>
                <input
                  type="number"
                  class="text-input size-input"
                  bind:value={customHeight}
                  min="128"
                  max="7680"
                  placeholder="Height"
                />
                <button class="secondary-btn" onclick={applyCustomCanvasSize}>
                  Apply
                </button>
              </div>
            </div>
          {/if}
        </section>

        {/if}
        <!-- Default Layer Shader -->
        {#if selectedSection === 'output:display'}
        <section class="settings-section">
          <h3>Layers</h3>

          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Default layer shader</span>
              <span class="label-hint">Applied automatically when creating a new layer</span>
            </div>
            <select
              value={$settings.defaultLayerShader || 'grid'}
              onchange={(e) => settings.setDefaultLayerShader((e.target as HTMLSelectElement).value as any)}
            >
              {#each DEFAULT_LAYER_SHADERS as shader}
                <option value={shader.id}>{shader.label}</option>
              {/each}
            </select>
          </div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">New layer placement</span>
              <span class="label-hint">Where a newly-created layer lands in the layer list (Top = renders on top of everything)</span>
            </div>
            <select
              value={$settings.newLayerPlacement || 'top'}
              onchange={(e) => settings.setNewLayerPlacement((e.target as HTMLSelectElement).value as any)}
            >
              <option value="top">Top of list</option>
              <option value="aboveActive">Above active layer</option>
              <option value="belowActive">Below active layer</option>
              <option value="bottom">Bottom of list</option>
            </select>
          </div>
        </section>

        {/if}
        <!-- Recording Settings Section -->
        {#if selectedSection === 'recording'}
        <section class="settings-section">
          <h3>Recording</h3>

          {#if NATIVE_ENGINE_ONLY && bridgeIsElectron}
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Recording format</span>
              <span class="label-hint">File the REC button writes. ProRes 4444 and HAP Alpha keep transparency when recording a layer or the composition. Pick the source from the arrow beside REC.</span>
            </div>
            <select value={recordingCodecOption($settings.recording.nativeCodec).id} onchange={(e) => settings.setNativeRecordingCodec((e.currentTarget as HTMLSelectElement).value as RecordingCodecId)}>
              {#each nativeRecordingCodecs as codec}
                <option value={codec.id} disabled={!codec.available}>{codec.label}{codec.available ? '' : ' (unavailable)'}</option>
              {/each}
            </select>
          </div>
          {/if}

          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Video format</span>
              <span class="label-hint">Choose the format for screen recordings</span>
            </div>
            <select value={$settings.recording.format} onchange={handleFormatChange}>
              {#each formats as format}
                <option value={format.id} disabled={!format.supported}>
                  {format.label} {!format.supported ? '(not supported)' : ''}
                </option>
              {/each}
            </select>
          </div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Video quality</span>
              <span class="label-hint">Higher quality = larger file size</span>
            </div>
            <select value={$settings.recording.videoBitrate} onchange={handleBitrateChange}>
              {#each bitrateOptions as option}
                <option value={option.value}>{option.label}</option>
              {/each}
            </select>
          </div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Include Audio</span>
              <span class="label-hint">Record sound with the video: playing clips, mic and system audio. Turn off for a silent video file.</span>
            </div>
            <label class="toggle">
              <input
                type="checkbox"
                aria-label="Include audio in recordings"
                checked={$settings.recording.includeAudio !== false}
                onchange={handleIncludeAudioChange}
              />
              <span class="toggle-slider"></span>
            </label>
          </div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Auto-Download</span>
              <span class="label-hint">Automatically save recordings when stopped</span>
            </div>
            <label class="toggle">
              <input
                type="checkbox"
                checked={$settings.recording.autoDownload}
                onchange={handleAutoDownloadChange}
              />
              <span class="toggle-slider"></span>
            </label>
          </div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Save location</span>
              <span class="label-hint">{$settings.recording.saveDirectoryName}</span>
            </div>
            <div class="button-group">
              <button class="secondary-btn" onclick={handlePickDirectory}>
                Choose folder
              </button>
              {#if $settings.recording.saveDirectoryHandle}
                <button class="text-btn" onclick={handleClearDirectory}>
                  Reset
                </button>
              {/if}
            </div>
          </div>

          <div class="info-box">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="16" x2="12" y2="12"/>
              <line x1="12" y1="8" x2="12.01" y2="8"/>
            </svg>
            <p>
              {#if $settings.recording.saveDirectoryHandle}
                Recordings will be saved directly to: <strong>{$settings.recording.saveDirectoryName}</strong>
              {:else}
                Recordings will download to your browser's default Downloads folder.
              {/if}
            </p>
          </div>
        </section>

        {/if}
        <!-- Output Settings Section -->
        {#if selectedSection === 'output:display'}
        <section class="settings-section">
          <h3>Render quality</h3>

          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Fluid quality</span>
              <span class="label-hint">Controls fluid simulation smoothness vs fidelity</span>
            </div>
            <select value={$settings.ui.fluidQuality} onchange={handleFluidQualityChange}>
              {#each fluidQualityModes as mode}
                <option value={mode.value}>{mode.label}</option>
              {/each}
            </select>
          </div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Shader quality</span>
              <span class="label-hint">Render resolution for shader layers. Native renders at output size; lower tiers render smaller and upscale.</span>
            </div>
            <select value={$settings.ui.shaderQuality} onchange={handleShaderQualityChange}>
              {#each shaderQualityModes as mode}
                <option value={mode.value}>{mode.label}</option>
              {/each}
            </select>
          </div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">{tsLabel} output</span>
              <span class="label-hint">Share GPU texture to other applications</span>
            </div>
            <label class="toggle">
              <input
                type="checkbox"
                checked={$settings.output.spoutEnabled}
                onchange={handleSpoutToggle}
              />
              <span class="toggle-slider"></span>
            </label>
          </div>

          {#if $settings.output.spoutEnabled}
            <div class="setting-row">
              <div class="setting-label">
                <span class="label-text">Sender name</span>
                <span class="label-hint">Visible to {tsLabel} receivers (e.g. OBS)</span>
              </div>
              <input
                type="text"
                class="text-input"
                value={$settings.output.spoutName}
                onchange={handleSpoutNameChange}
                placeholder="ghostArcade"
              />
            </div>

            <div class="setting-row">
              <div class="setting-label">
                <span class="label-text">Output resolution</span>
                <span class="label-hint">{$settings.output.spoutResolution === 'output' && detectedOutputRes
                  ? `Detected: ${detectedOutputRes.width}×${detectedOutputRes.height}`
                  : `Resolution of the ${tsLabel} texture`}</span>
              </div>
              <select value={$settings.output.spoutResolution} onchange={handleSpoutResolutionChange}>
                {#each spoutResolutions as opt}
                  <option value={opt.value}>{opt.value === 'output' && detectedOutputRes
                    ? `Match output (${detectedOutputRes.width}×${detectedOutputRes.height})`
                    : opt.label}</option>
                {/each}
              </select>
            </div>

            {#if $settings.output.spoutResolution === 'custom'}
              <div class="setting-row">
                <div class="setting-label">
                  <span class="label-text">Custom size</span>
                </div>
                <div class="custom-res-inputs">
                  <input type="number" class="text-input small-input" min="128" max="7680" value={$settings.output.customWidth}
                    onchange={(e) => settings.update(s => { s.output.customWidth = parseInt((e.target as HTMLInputElement).value) || 1920; return s; })} />
                  <span>×</span>
                  <input type="number" class="text-input small-input" min="128" max="7680" value={$settings.output.customHeight}
                    onchange={(e) => settings.update(s => { s.output.customHeight = parseInt((e.target as HTMLInputElement).value) || 1080; return s; })} />
                </div>
              </div>
            {/if}

            <div class="info-box">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="16" x2="12" y2="12"/>
                <line x1="12" y1="8" x2="12.01" y2="8"/>
              </svg>
              <p>
                Output will be shared as <strong>"{$settings.output.spoutName}"</strong> to any
                {tsLabel}-compatible application on this machine (OBS, etc).
                Full GPU texture sharing is available in the desktop build.
              </p>
            </div>
          {/if}
        </section>

        <!-- Output Display Section -->
        <section class="settings-section">
          <h3>Display</h3>

          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Resolution</span>
              <span class="label-hint">
                Project canvas: <strong>{$project.width}×{$project.height}</strong>
                {#if matchResLabel}<br/><em class="accent-text">{matchResLabel}</em>{/if}
              </span>
            </div>
            <button class="secondary-btn" onclick={handleMatchResolution} disabled={matchResBusy}>
              {matchResBusy ? 'Detecting…' : 'Match output display'}
            </button>
          </div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Output rotation</span>
              <span class="label-hint">Rotate the output for portrait projectors</span>
            </div>
            <div class="rotation-buttons">
              <button class="rot-btn" class:active={outputRotation === 0} onclick={() => setOutputRotation(0)}>0°</button>
              <button class="rot-btn" class:active={outputRotation === 90} onclick={() => setOutputRotation(90)}>90°</button>
              <button class="rot-btn" class:active={outputRotation === 180} onclick={() => setOutputRotation(180)}>180°</button>
              <button class="rot-btn" class:active={outputRotation === 270} onclick={() => setOutputRotation(270)}>270°</button>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Input crop</span>
              <span class="label-hint">Crop the output region</span>
            </div>
          </div>
          <div class="crop-grid">
            <div class="crop-item">
              <span class="crop-label">X</span>
              <input type="range" min="0" max="0.9" step="0.01" value={outputCropRegion.x}
                oninput={(e) => setOutputCrop('x', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="crop-value">{Math.round(outputCropRegion.x * 100)}%</span>
            </div>
            <div class="crop-item">
              <span class="crop-label">Y</span>
              <input type="range" min="0" max="0.9" step="0.01" value={outputCropRegion.y}
                oninput={(e) => setOutputCrop('y', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="crop-value">{Math.round(outputCropRegion.y * 100)}%</span>
            </div>
            <div class="crop-item">
              <span class="crop-label">W</span>
              <input type="range" min="0.1" max="1" step="0.01" value={outputCropRegion.width}
                oninput={(e) => setOutputCrop('width', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="crop-value">{Math.round(outputCropRegion.width * 100)}%</span>
            </div>
            <div class="crop-item">
              <span class="crop-label">H</span>
              <input type="range" min="0.1" max="1" step="0.01" value={outputCropRegion.height}
                oninput={(e) => setOutputCrop('height', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="crop-value">{Math.round(outputCropRegion.height * 100)}%</span>
            </div>
            <button class="secondary-btn" onclick={resetOutputCrop}>
              Reset crop
            </button>
          </div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Show cursor on output</span>
              <span class="label-hint">Visualises mouse position on the output window</span>
            </div>
            <label class="toggle">
              <input
                type="checkbox"
                checked={showOutputCursor}
                onchange={(e) => setShowOutputCursor((e.target as HTMLInputElement).checked)}
              />
              <span class="toggle-slider"></span>
            </label>
          </div>

          {#if showOutputCursor}
            <!-- Cursor style + sizing knobs. Shown only when the
                 cursor is on so the panel doesn't carry dead-eye
                 controls when the user has it off. Each input mutates
                 settings.output.outputCursorXxx; WebGPUCanvas
                 subscribes and pushes the change to the output via
                 the MessagePort cursorStyle message. -->
            <div class="setting-row sub-row">
              <div class="setting-label">
                <span class="label-text">Style</span>
              </div>
              <select
                class="select-input"
                value={$settings.output.outputCursorStyle ?? 'crosshair'}
                onchange={(e) => settings.update(s => ({ ...s, output: { ...s.output, outputCursorStyle: (e.target as HTMLSelectElement).value as any } }))}
              >
                <option value="crosshair">Crosshair</option>
                <option value="circle">Circle</option>
                <option value="dot">Dot</option>
                <option value="reticle">Reticle</option>
                <option value="fullscreen">Fullscreen lines</option>
              </select>
            </div>

            <div class="setting-row sub-row">
              <div class="setting-label">
                <span class="label-text">Size</span>
                <span class="label-hint">{$settings.output.outputCursorSize ?? 28}px</span>
              </div>
              <input
                type="range"
                min="4" max="128" step="1"
                value={$settings.output.outputCursorSize ?? 28}
                oninput={(e) => settings.update(s => ({ ...s, output: { ...s.output, outputCursorSize: +(e.target as HTMLInputElement).value } }))}
              />
            </div>

            <div class="setting-row sub-row">
              <div class="setting-label">
                <span class="label-text">Thickness</span>
                <span class="label-hint">{$settings.output.outputCursorThickness ?? 2}px (1 = hairline for macro)</span>
              </div>
              <input
                type="range"
                min="1" max="12" step="1"
                value={$settings.output.outputCursorThickness ?? 2}
                oninput={(e) => settings.update(s => ({ ...s, output: { ...s.output, outputCursorThickness: +(e.target as HTMLInputElement).value } }))}
              />
            </div>

            <div class="setting-row sub-row">
              <div class="setting-label">
                <span class="label-text">Color</span>
              </div>
              <input
                type="color"
                value={$settings.output.outputCursorColor ?? '#ffffff'}
                oninput={(e) => settings.update(s => ({ ...s, output: { ...s.output, outputCursorColor: (e.target as HTMLInputElement).value } }))}
              />
            </div>

            <div class="setting-row sub-row">
              <div class="setting-label">
                <span class="label-text">Opacity</span>
                <span class="label-hint">{Math.round(($settings.output.outputCursorOpacity ?? 0.85) * 100)}%</span>
              </div>
              <input
                type="range"
                min="0.1" max="1" step="0.05"
                value={$settings.output.outputCursorOpacity ?? 0.85}
                oninput={(e) => settings.update(s => ({ ...s, output: { ...s.output, outputCursorOpacity: +(e.target as HTMLInputElement).value } }))}
              />
            </div>
          {/if}
        </section>

        <!-- Projection Tools section removed (v0.3.5):
             Blackout is available via the kill-output icon in the top bar;
             alignment/calibration handled by ISF shaders. The settings UI
             was causing accidental activation that overrode all output and
             made the app appear broken. State is force-reset to off on
             every app launch (see App.svelte). -->


        {/if}
        <!-- Edge Blending Section -->
        <!-- Edge Blending and Color Correction sections removed: both
             live on the Screens tab now (per-slice), where they sit
             next to the rest of the projector calibration tools. Their
             underlying $settings.output.* fields stay in the store so
             any leftover bindings continue to compile cleanly. -->
        <!-- The standalone WebRTC/WebGPU output transport toggles that used
             to live here are removed in the native branch. Desktop output is
             the render core's managed output window or unavailable. -->

        <!-- Performance Tab — opt-in knobs for users on weaker hardware.
             Defaults match the historical full-quality behaviour. Intro
             card shows under GPU since that's first in the sidebar. -->
        {#if selectedSection === 'performance:gpu'}
        <section class="settings-section">
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Tune the editor for your hardware</span>
              <span class="label-hint">
                If the app feels laggy, step these down until it feels smooth. None of these change your output content — only how the editor renders and the output stream encodes. Capable machines should leave everything at the defaults.
                <br/><br/>
                <a href="https://ghostarcade.live/docs/performance" target="_blank" rel="noopener noreferrer"
                   class="settings-link">
                  Full guide: optimizing Ghost Arcade for your machine →
                </a>
              </span>
            </div>
          </div>
        </section>

        <!-- ─────────────────────────────────────────────────────────────
             Renderer & Output — native renderer is the v2 path. The old
             transport fields still live in $settings.experimental for
             migration stability, but native-only desktop builds force them
             off.
             When WebGPU is unavailable, WebGPU-specific controls are
             disabled and the section explains why so users do not waste
             time hunting for an unavailable effect or output path.
             ───────────────────────────────────────────────────────── -->
        <section class="settings-section">
          <h3>Renderer &amp; output</h3>
          <!-- Restart-required banner. The renderer chooses which canvas
               and effect-chain path to mount at boot, so toggling these
               flags mid-session leaves a broken state (grid disappears,
               layers stop receiving frames). Banner appears whenever any
               of the three GPU toggles differs from its value at app
               startup; clicking Restart calls into Electron's relaunch
               IPC (or falls back to window.location.reload in dev/web). -->
          {#if gpuRestartRequired}
            <div class="gpu-restart-banner" role="alert">
              <div class="gpu-restart-text">
                <strong>Restart required.</strong>
                These renderer bridge settings only take effect on a fresh process —
                the editor will appear broken (no grid, missing frames)
                until you restart the app.
              </div>
              <button class="primary-btn" onclick={restartApp} disabled={restarting} >
                {restarting ? 'Restarting…' : 'Restart app'}
              </button>
            </div>
          {/if}
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text" style:color={webgpuSupported ? 'var(--ga-green, #46d18a)' : '#fbbf24'}>
                {#if webgpuProbing}
                  Probing WebGPU…
                {:else if webgpuSupported}
                  ✓ WebGPU detected
                {:else}
                  ⚠ WebGPU not available
                {/if}
              </span>
              <span class="label-hint">
                {#if webgpuSupported}
                  Adapter:
                  <strong>
                    {webgpuInfo.description || webgpuInfo.vendor || 'unknown'}
                    {#if webgpuInfo.architecture}({webgpuInfo.architecture}){/if}
                  </strong>
                  {#if webgpuInfo.isFallbackAdapter}
                    <br/><span class="native-runtime-warning">⚠ Software fallback adapter — performance will be limited.</span>
                  {/if}
                  <br/>
                  {#if NATIVE_ENGINE_ONLY && isDesktopApp}
                    Native-only mode is locked on. Preview, output, and recording are driven by the Rust/wgpu core; unavailable capabilities stay listed as blockers.
                  {:else}
                    Native core output is the v2 target path.
                  {/if}
                {:else}
                  {webgpuInfo.failReason ? `Reason: ${webgpuInfo.failReason}.` : 'Your browser/device did not return a WebGPU adapter.'}
                  <br/>
                  {#if NATIVE_ENGINE_ONLY && isDesktopApp}
                    Browser WebGPU is not used as a fallback in this build. Missing native capabilities are shown as blockers instead.
                  {:else}
                    Effects and layers that require WebGPU (e.g. <em>Fluid Sim</em>, the GPU Shader layer) are hidden in the picker so you don't try to add something that won't run.
                  {/if}
                {/if}
              </span>
            </div>
            <button class="primary-btn" onclick={refreshWebGPUStatus} disabled={webgpuProbing} >
              {webgpuProbing ? 'Probing…' : 'Re-probe'}
            </button>
          </div>

          <div class="setting-row native-runtime-row">
            <div class="setting-label">
              <span class="label-text">Native runtime</span>
              <span class="label-hint native-runtime-detail">
                {nativeRendererModeLabel($nativeRendererRuntime.driverMode)}
                · {$nativeRendererRuntime.backend ?? 'offline'}
                {#if $nativeRendererRuntime.adapterName}
                  · {$nativeRendererRuntime.adapterName}
                {/if}
                · graphs {$nativeRendererRuntime.nativeGraphSourceFrameLayers} layer{$nativeRendererRuntime.nativeGraphSourceFrameLayers === 1 ? '' : 's'}
                / {$nativeRendererRuntime.computeGraphRuns} run{$nativeRendererRuntime.computeGraphRuns === 1 ? '' : 's'}
                {#if $nativeRendererRuntime.nativeGraphRouteFailures > 0}
                  <br/>
                  <span class="native-runtime-warning">
                    Native graph misses:
                    {$nativeRendererRuntime.nativeGraphRouteFailures}
                    {#if $nativeRendererRuntime.nativeGraphRouteSuppressedFailures > 0}
                      ({$nativeRendererRuntime.nativeGraphRouteSuppressedFailures} suppressed)
                    {/if}
                    {#if $nativeRendererRuntime.nativeGraphRouteLastFailure}
                      · {$nativeRendererRuntime.nativeGraphRouteLastFailure}
                    {/if}
                  </span>
                {:else if $nativeRendererRuntime.nativeGraphSourceFrames}
                  <br/>Native graph routing clean.
                {/if}
                <br/>
                Native effect passes {$nativeRendererRuntime.nativeEffectCoverageNative}/{$nativeRendererRuntime.nativeEffectCoverageTotal}
                {#if $nativeRendererRuntime.nativeEffectCoverageMissing > 0}
                  · {$nativeRendererRuntime.nativeEffectCoverageMissing} pass-eligible not native yet
                {/if}
                {#if $nativeRendererRuntime.nativeBlockedLayerCount > 0}
                  <br/>
                  <span class="native-runtime-warning">
                    Native inventory blocked:
                    {$nativeRendererRuntime.nativeBlockedLayerCount}
                    layer{$nativeRendererRuntime.nativeBlockedLayerCount === 1 ? '' : 's'}
                    ({$nativeRendererRuntime.nativeBlockedEffectLayerCount} effect,
                    {$nativeRendererRuntime.nativeBlockedSourceLayerCount} source)
                    {#if $nativeRendererRuntime.nativeBlockedLayerLastReason}
                      · {$nativeRendererRuntime.nativeBlockedLayerLastReason}
                    {/if}
                  </span>
                {/if}
              </span>
            </div>
            <span
              class:ok={$nativeRendererRuntime.fullV2Ready}
              class:warn={$nativeRendererRuntime.nativeGraphRouteFailures > 0 || !$nativeRendererRuntime.fullV2Ready}
              class="native-runtime-pill"
            >
              {$nativeRendererRuntime.fullV2Ready ? 'Ready' : nativeRendererModeLabel($nativeRendererRuntime.driverMode)}
            </span>
          </div>
          <div class="native-runtime-gates" aria-label="Native renderer main-driver readiness gates">
            {#each nativeMainDriverGates as gate (gate.id)}
              <div
                class:ok={gate.ok}
                class:warn={!gate.ok}
                class="native-runtime-gate"
                title={gate.detail}
              >
                <span class="native-runtime-gate-state">{gate.ok ? 'OK' : 'Wait'}</span>
                <span class="native-runtime-gate-label">{gate.label}</span>
              </div>
            {/each}
          </div>
          {#if !$nativeRendererRuntime.fullV2Ready && $nativeRendererRuntime.blockers.length > 0}
            <div class="native-runtime-blockers">
              Waiting on {$nativeRendererRuntime.blockers.slice(0, 3).join(' · ')}
              {#if $nativeRendererRuntime.blockers.length > 3}
                · +{$nativeRendererRuntime.blockers.length - 3} more
              {/if}
            </div>
          {/if}

          {#if NATIVE_ENGINE_ONLY && isDesktopApp}
            <div class="setting-row">
              <div class="setting-label">
                <span class="label-text">Native engine mode</span>
                <span class="label-hint">
                  Locked on for this build. Browser/WebGPU comparison renderers and CPU-readback bridges are disabled; missing renderer capabilities stay visible as native blockers until they are implemented.
                </span>
              </div>
              <span class="native-runtime-pill warn">Native only</span>
            </div>
          {:else}
            <div class="setting-row">
              <div class="setting-label">
                <span class="label-text">Editor frame bridge</span>
                <span class="label-hint">
                  Use the WebGPU + VideoFrame bridge for the editor -> renderer handoff.
                  {#if !webgpuSupported}
                    <br/><em>Disabled - requires WebGPU.</em>
                  {/if}
                </span>
              </div>
              <label class="toggle">
                <input
                  type="checkbox"
                  checked={$settings.experimental.editorWebGPU}
                  disabled={!webgpuSupported}
                  onchange={(e) => settings.update(s => ({ ...s, experimental: { ...s.experimental, editorWebGPU: (e.target as HTMLInputElement).checked } }))}
                />
                <span class="toggle-slider"></span>
              </label>
            </div>

            <div class="setting-row">
              <div class="setting-label">
                <span class="label-text">Native output driver</span>
                <span class="label-hint">
                  Use the Rust/wgpu managed output window. Applies on next output-window open.
                </span>
              </div>
              <label class="toggle">
                <input
                  type="checkbox"
                  checked={$settings.experimental.outputNativeCore}
                  onchange={(e) => settings.update(s => ({ ...s, experimental: { ...s.experimental, outputNativeCore: (e.target as HTMLInputElement).checked } }))}
                />
                <span class="toggle-slider"></span>
              </label>
            </div>
          {/if}
        </section>

        {/if}
        {#if selectedSection === 'performance:render-quality'}
        <section class="settings-section">
          <h3>Render quality</h3>
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Shader quality</span>
              <span class="label-hint">Internal render resolution for shader layers. Native renders at output size; lower tiers render smaller and upscale.</span>
            </div>
            <select value={$settings.ui.shaderQuality} onchange={handleShaderQualityChange}>
              {#each shaderQualityModes as mode}
                <option value={mode.value}>{mode.label}</option>
              {/each}
            </select>
          </div>
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">GPU instrument budget</span>
              <span class="label-hint">Caps expensive WebGPU shader internals like particles, volume grids, emitters, and ray steps. Auto adapts live; fixed modes stay stable.</span>
            </div>
            <select value={$settings.performance.gpuInstrumentQuality ?? 'auto'} onchange={handleGpuInstrumentQualityChange}>
              {#each gpuInstrumentQualityModes as mode}
                <option value={mode.value}>{mode.label}</option>
              {/each}
            </select>
          </div>
          {#if isDesktopApp}
            <div class="setting-row">
              <div class="setting-label">
                <span class="label-text">Video memory</span>
                <span class="label-hint">Memory the playing videos' frames may use. Automatic takes a quarter of this GPU's memory{gpuMemoryMb ? ` (${formatMemory(gpuMemoryMb)}), ${formatMemory(autoVideoMemoryMb)} here` : ''}. Raise it if many videos playing at once stutter; lower it if other apps need the memory.</span>
              </div>
              <select value={String($settings.performance.videoMemoryMb ?? 0)} onchange={handleVideoMemoryChange}>
                <option value="0">Automatic{autoVideoMemoryMb ? ` (${formatMemory(autoVideoMemoryMb)})` : ''}</option>
                {#each videoMemoryChoices as mb}
                  <option value={String(mb)}>{formatMemory(mb)}</option>
                {/each}
              </select>
            </div>
          {/if}
        </section>

        <section class="settings-section">
          <h3>Editor render</h3>
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Editor frame rate cap</span>
              <span class="label-hint">
                Caps editor render fps. Projectors are 60Hz; rendering at 120/144/165Hz on a high-refresh monitor wastes GPU. Cap to 60 to free budget. Input remains responsive. Applies to mapping mode too.
              </span>
            </div>
            <select value={String($settings.performance.editorMaxFps)}
              onchange={(e) => settings.update(s => ({ ...s, performance: { ...s.performance, editorMaxFps: parseInt((e.target as HTMLSelectElement).value) as 0 | 30 | 60 } }))}>
              <option value="0">Uncapped (match display)</option>
              <option value="60">60 fps</option>
              <option value="30">30 fps</option>
            </select>
          </div>
        </section>

        <section class="settings-section">
          <h3>VJ preview</h3>
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Preview resolution</span>
              <span class="label-hint">Long-edge cap for the VJ mode preview. Lower frees GPU. Doesn't affect output.</span>
            </div>
            <select value={String($settings.performance.previewMaxDim)}
              onchange={(e) => settings.update(s => ({ ...s, performance: { ...s.performance, previewMaxDim: parseInt((e.target as HTMLSelectElement).value) } }))}>
              <option value="0">Full (match canvas)</option>
              <option value="1280">1280 px (720p)</option>
              <option value="960">960 px</option>
              <option value="640">640 px (recommended on integrated GPU)</option>
              <option value="480">480 px (minimum)</option>
            </select>
          </div>
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Preview refresh rate</span>
              <span class="label-hint">FPS for the preview canvas. 30 is enough to monitor; 15 frees a lot of budget.</span>
            </div>
            <select value={String($settings.performance.previewFrameRate)}
              onchange={(e) => settings.update(s => ({ ...s, performance: { ...s.performance, previewFrameRate: parseInt((e.target as HTMLSelectElement).value) as 60 | 30 | 15 } }))}>
              <option value="60">60 fps</option>
              <option value="30">30 fps</option>
              <option value="15">15 fps</option>
            </select>
          </div>
        </section>

        <section class="settings-section">
          <h3>Output stream</h3>
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Output frame rate</span>
              <span class="label-hint">Encoder rate for the output window. 60 = silky; 30 = projector standard; 24 = cinematic.</span>
            </div>
            <select value={String($settings.performance.outputFrameRate)}
              onchange={(e) => settings.update(s => ({ ...s, performance: { ...s.performance, outputFrameRate: parseInt((e.target as HTMLSelectElement).value) as 60 | 30 | 24 } }))}>
              <option value="60">60 fps</option>
              <option value="30">30 fps</option>
              <option value="24">24 fps</option>
            </select>
          </div>
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Max bitrate</span>
              <span class="label-hint">Encoder bitrate ceiling. Same-process loopback so the rate doesn't go on a wire — high = near-lossless, low = encoder works less.</span>
            </div>
            <select value={String($settings.performance.outputMaxBitrate)}
              onchange={(e) => settings.update(s => ({ ...s, performance: { ...s.performance, outputMaxBitrate: parseInt((e.target as HTMLSelectElement).value) } }))}>
              <option value="80000000">High — 80 Mbps</option>
              <option value="40000000">Medium — 40 Mbps</option>
              <option value="20000000">Low — 20 Mbps</option>
              <option value="10000000">Minimum — 10 Mbps</option>
            </select>
          </div>
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Quality vs smoothness</span>
              <span class="label-hint">How the encoder degrades under load: keep pixels (drop fps), keep smoothness (drop pixels), or balanced.</span>
            </div>
            <select value={$settings.performance.outputDegradationPreference}
              onchange={(e) => settings.update(s => ({ ...s, performance: { ...s.performance, outputDegradationPreference: (e.target as HTMLSelectElement).value as 'maintain-resolution' | 'maintain-framerate' | 'balanced' } }))}>
              <option value="maintain-resolution">Maintain resolution</option>
              <option value="maintain-framerate">Maintain frame rate</option>
              <option value="balanced">Balanced</option>
            </select>
          </div>
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Video codec</span>
              <span class="label-hint">
                Auto picks VP9 first (best quality/bitrate). Force H.264 if your machine has hardware H.264 — usually a big perf win.
                {#if codecEncode}
                  <br/>Available on this machine: {[codecEncode.vp9 && 'VP9', codecEncode.h264 && 'H.264', codecEncode.vp8 && 'VP8', codecEncode.av1 && 'AV1'].filter(Boolean).join(' · ') || 'none detected'}.
                {/if}
              </span>
            </div>
            <select value={$settings.performance.outputCodecPreference}
              onchange={(e) => settings.update(s => ({ ...s, performance: { ...s.performance, outputCodecPreference: (e.target as HTMLSelectElement).value as 'auto' | 'h264' | 'vp8' } }))}>
              <option value="auto">Auto (recommended)</option>
              <option value="h264">Force H.264</option>
              <option value="vp8">Force VP8 (compatibility)</option>
            </select>
          </div>
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-hint">
                <strong>Apply on next output-window open.</strong> Stream-tuning settings take effect when the output window opens — close and reopen the output for changes to apply.
              </span>
            </div>
          </div>
        </section>

        {/if}
        {#if selectedSection === 'performance:video-decoding'}
        <section class="settings-section">
          <h3>Video decoding</h3>
          <div class="setting-row">
            <div class="setting-label">
              <div class="label-hint">
                {#if !isDesktopApp}
                  Video decoding is checked in the desktop app.
                {:else if decodeChecking && !decodeRows}
                  Checking which formats this computer decodes in hardware…
                {:else if decodeError}
                  Could not check video decoding: {decodeError}
                {:else if decodeRows}
                  <table class="decode-table">
                    <tbody>
                      {#each decodeRows as row (row.id)}
                        <tr>
                          <th scope="row">{row.label}</th>
                          <td style:color={row.state === 'hardware' ? '#4caf50' : row.state === 'software' ? '#fbbf24' : row.state === 'failed' ? '#f87171' : '#999'}>{row.verdict}</td>
                          <td class="decode-reason">{row.reason}</td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                  Hardware formats play smoothly, including in reverse. Software formats use the CPU and may lag
                  with several layers. Convert them with File › Video Converter › <strong>Playback</strong>, or with
                  <strong>Convert for smooth playback</strong> on the SW badge of a clip.
                  <button class="text-btn" onclick={() => { decodeRows = null; void runDecodeCheck(); }} disabled={decodeChecking}>Check again</button>
                {/if}
              </div>
            </div>
          </div>
          {#if slowProjectVideos.length}
            <div class="setting-row">
              <div class="setting-label">
                <span class="label-text">Videos in use that may lag</span>
                {#each slowProjectVideos as entry (entry.path)}
                  <div class="decode-file">
                    <span class="file-name" translate="no" title={entry.path}>{entry.path.split(/[\\/]/).pop()}</span>
                    <span class="label-hint">{entry.badge?.title}</span>
                    {#if entry.badge?.canConvert}
                      <button class="text-btn" onclick={() => void convertForSmoothPlayback(entry.path)}>Convert for smooth playback</button>
                    {/if}
                  </div>
                {/each}
              </div>
            </div>
          {/if}
        </section>

        {/if}
        <!-- MIDI Settings Section -->
        {#if selectedSection === 'integrations:midi'}
        <section class="settings-section">
          <h3>MIDI controller</h3>

          {#if midiAvailable}
            <div class="setting-row">
              <div class="setting-label">
                <span class="label-text">MIDI device</span>
                <span class="label-hint">Select your MIDI controller input</span>
              </div>
              <select value={midiSelectedId || ''} onchange={handleMidiDeviceChange}>
                <option value="">No MIDI device</option>
                {#each midiDevices as device}
                  <option value={device.id}>{device.name}</option>
                {/each}
              </select>
            </div>

            <div class="setting-row">
              <div class="setting-label">
                <span class="label-text">MIDI Learn mode</span>
                <span class="label-hint">Click a parameter, then move a MIDI control to map it</span>
              </div>
              <button
                class="secondary-btn midi-learn-btn"
                data-tour="midi-learn"
                class:active={midiEditMode}
                disabled={midiDevices.length === 0 && !midiEditMode}
                onclick={() => midiStore.toggleEditMode()}
              >
                {midiEditMode ? 'Exit MIDI Learn' : midiDevices.length === 0 ? 'No MIDI device' : 'Enter MIDI Learn'}
              </button>
            </div>

            <div class="info-box">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="16" x2="12" y2="12"/>
                <line x1="12" y1="8" x2="12.01" y2="8"/>
              </svg>
              <p>
                In MIDI Learn mode, click any parameter slider in the main UI, then move a knob or fader on your MIDI controller to create a mapping. Press <strong>ESC</strong> to exit learn mode.
              </p>
            </div>

            <!-- Mappings table.
                 Reported by a user: they had learned a pad onto a parameter
                 inside a pre-made effect and could not unlearn it without
                 finding that exact effect and parameter again, and there was
                 nowhere in the app that listed what was mapped. midiStore has
                 held removeMappingById and clearAllMappings the whole time;
                 nothing ever rendered the array.

                 Grouped by control, not by parameter, because that is the
                 question being asked. A parameter holds one mapping, a pad can
                 hold many, so "what is this pad doing" is a group and
                 "unlearn it" is one button. -->
            <h3>Mappings ({$midiStore.mappings.length})</h3>
            <p class="settings-hint">
              Everything you have learned, grouped by the pad, key or knob it sits
              on. Removing a mapping here is the same as clearing it from the
              parameter itself. Mappings are saved for this machine, not inside the
              project, so they follow you between projects.
            </p>

            <div class="setting-row">
              <div class="setting-label">
                <span class="label-text">Find a control</span>
                <span class="label-hint">
                  Press a pad, key or knob and its mappings are highlighted below.
                  Nothing is triggered while this is on, so it is safe to press the
                  one you want to get rid of.
                </span>
              </div>
              <button
                class="secondary-btn midi-learn-btn"
                class:active={$midiStore.identifyMode}
                disabled={$midiStore.mappings.length === 0 || midiDevices.length === 0}
                onclick={() => midiStore.setIdentifyMode(!$midiStore.identifyMode)}
              >
                {$midiStore.identifyMode ? 'Stop finding' : 'Find a control'}
              </button>
            </div>

            {#if $midiStore.identifyMode}
              <div class="mm-identify">
                <span class="mm-identify-pulse"></span>
                {#if $midiStore.lastMessage}
                  Heard <strong>{$midiStore.lastMessage.type === 'note'
                    ? `Note ${$midiStore.lastMessage.number}`
                    : $midiStore.lastMessage.type === 'cc'
                      ? `CC ${$midiStore.lastMessage.number}`
                      : 'Pitch bend'}</strong>
                  on channel {$midiStore.lastMessage.channel + 1}
                {:else}
                  Waiting for a control. Routing is paused.
                {/if}
              </div>
            {/if}

            {#if $midiStore.mappings.length === 0}
              <div class="osc-empty">
                Nothing mapped yet. Turn on MIDI Learn above, click a control in the
                app, then move something on your controller.
              </div>
            {:else}
              <div class="mm-groups">
                {#each midiMappingGroups as group (group.key)}
                  <div
                    class="mm-group"
                    class:found={$midiStore.identifyMode && groupMatchesMessage(group, $midiStore.lastMessage)}
                  >
                    <div class="mm-group-head">
                      <span class="mm-control">{group.controlLabel}</span>
                      <span class="mm-channel">{group.channelLabel}</span>
                      <span class="mm-count">
                        {group.mappings.length} mapping{group.mappings.length === 1 ? '' : 's'}
                      </span>
                      <button
                        class="mm-clear"
                        onclick={() => clearMidiControl(group)}
                        title="Remove every mapping on this control"
                      >Clear control</button>
                    </div>

                    {#each group.mappings as m (m.id)}
                      {@const target = describeTarget(m.path, m.label, $project)}
                      <div class="mm-row" class:orphan={target.orphaned}>
                        <span class="mm-target">
                          {#if target.context}<span class="mm-context">{target.context}</span>{/if}
                          <span class="mm-label">{target.label}</span>
                          {#if target.orphaned}
                            <span
                              class="mm-orphan"
                              title="This effect is not in the project that is open. The mapping still holds the control."
                            >not in this project</span>
                          {/if}
                        </span>
                        <span class="mm-mode">{m.mode}</span>
                        <button
                          class="mm-del"
                          onclick={() => midiStore.removeMappingById(m.id)}
                          title="Remove this mapping"
                        >×</button>
                      </div>
                    {/each}
                  </div>
                {/each}
              </div>

              <div class="osc-add-row">
                {#if confirmClearMidiMappings}
                  <span class="settings-hint" style="margin: 0;">
                    Remove all {$midiStore.mappings.length}?
                  </span>
                  <button
                    class="osc-add-btn"
                    onclick={() => { midiStore.clearAllMappings(); confirmClearMidiMappings = false; }}
                  >Yes, clear everything</button>
                  <button class="osc-add-btn" onclick={() => confirmClearMidiMappings = false}>Cancel</button>
                {:else}
                  <button class="osc-add-btn" onclick={() => confirmClearMidiMappings = true}>
                    Clear all mappings
                  </button>
                {/if}
              </div>
            {/if}

            <ControllerLightsSettings />

            <!-- MIDI Clock — sync to / from external transport -->
            <h3 data-tour="midi-clock">MIDI clock</h3>

            <div class="setting-row">
              <div class="setting-label">
                <span class="label-text">Receive MIDI clock</span>
                <span class="label-hint">Sync BPM from a DAW, drum machine, or other clock master via the selected input device</span>
              </div>
              <label class="toggle">
                <input type="checkbox"
                  checked={$midiStore.clockInEnabled}
                  onchange={(e) => midiManager.setClockInEnabled((e.target as HTMLInputElement).checked)}
                />
                <span class="toggle-slider"></span>
              </label>
            </div>

            {#if $midiStore.clockInEnabled}
              <div class="setting-row sub-row">
                <div class="setting-label">
                  <span class="label-text">Clock input</span>
                  <span class="label-hint">Use a separate virtual MIDI port when clock and controls come from different places</span>
                </div>
                <select value={midiClockSelectedId || ''} onchange={handleMidiClockDeviceChange}>
                  <option value="">Same as MIDI device</option>
                  {#each midiDevices as device}
                    <option value={device.id}>{device.name}</option>
                  {/each}
                </select>
              </div>
              <div class="setting-row sub-row">
                <div class="setting-label">
                  <span class="label-text">Clock status</span>
                  <span class="label-hint">{$midiStore.clockInRunning ? 'Running' : 'Idle'}{$midiStore.clockInBPM ? ` · ${$midiStore.clockInBPM.toFixed(1)} BPM` : ''}</span>
                </div>
                <span class="clock-status-dot" class:on={$midiStore.clockInRunning}></span>
              </div>
            {/if}

            <div class="setting-row">
              <div class="setting-label">
                <span class="label-text">Send MIDI clock</span>
                <span class="label-hint">Drive slaved devices at the master BPM (24 PPQN) — use this to sync drum machines / synths to Ghost Arcade</span>
              </div>
              <label class="toggle">
                <input type="checkbox"
                  checked={$midiStore.clockOutEnabled}
                  onchange={(e) => midiManager.setClockOutEnabled((e.target as HTMLInputElement).checked)}
                />
                <span class="toggle-slider"></span>
              </label>
            </div>

            {#if $midiStore.clockOutEnabled || $midiStore.outputDevices.length > 0}
              <div class="setting-row">
                <div class="setting-label">
                  <span class="label-text">Output device</span>
                  <span class="label-hint">Where to send clock ticks</span>
                </div>
                <select
                  value={$midiStore.selectedOutputId || ''}
                  onchange={(e) => midiManager.selectOutputDevice((e.target as HTMLSelectElement).value || null)}
                >
                  <option value="">No output device</option>
                  {#each $midiStore.outputDevices.filter(d => d.state === 'connected') as device (device.id)}
                    <option value={device.id}>{device.name}</option>
                  {/each}
                </select>
              </div>
            {/if}

            <!-- Ableton Link — WiFi/LAN tempo session with DAWs, DJ
                 software, and other Link apps. Tempo flows both ways;
                 a running MIDI clock-in takes priority over Link. -->
            <h3 data-tour="ableton-link-title">Ableton Link</h3>

            <div class="setting-row" data-tour="ableton-link">
              <div class="setting-label">
                <span class="label-text">Enable Ableton Link</span>
                <span class="label-hint">Join the tempo session on your network — Serato, Rekordbox, Ableton Live and other Link apps sync automatically</span>
              </div>
              <label class="toggle">
                <input type="checkbox"
                  checked={$abletonLink.enabled}
                  onchange={(e) => (e.target as HTMLInputElement).checked ? abletonLink.enable() : abletonLink.disable()}
                />
                <span class="toggle-slider"></span>
              </label>
            </div>

            {#if $abletonLink.enabled}
              <div class="setting-row sub-row">
                <div class="setting-label">
                  <span class="label-text">Session</span>
                  <span class="label-hint">{$abletonLink.peers} peer{$abletonLink.peers === 1 ? '' : 's'} · {$abletonLink.tempo.toFixed(1)} BPM{$midiStore.clockInEnabled && $midiStore.clockInRunning ? ' · deferring to MIDI clock-in' : ''}</span>
                </div>
                <span class="clock-status-dot" class:on={$abletonLink.peers > 0}></span>
              </div>

              <!-- Beat / phase readout. Tempo alone was never enough to tell
                   whether Ghost Arcade was actually following the session's
                   downbeat; this shows the phase it is acting on. -->
              <div class="setting-row sub-row" style="align-items: flex-start;">
                <div class="setting-label">
                  <span class="label-text">Beat</span>
                  <span class="label-hint">
                    The highlighted beat should march in time with the music from your
                    other Link app. Clip launch quantization follows this phase.
                  </span>
                </div>
                <AbletonLinkMonitor />
              </div>
            {/if}
            {#if $abletonLink.error}
              <div class="setting-row sub-row">
                <span class="label-hint">Link unavailable: {$abletonLink.error}</span>
              </div>
            {/if}

          {:else}
            <div class="info-box">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="16" x2="12" y2="12"/>
                <line x1="12" y1="8" x2="12.01" y2="8"/>
              </svg>
              <p>No MIDI support detected. Connect a MIDI controller and refresh.</p>
            </div>
          {/if}
        </section>

        {/if}
        <!-- OSC Settings Section — UDP listener + bindings table.
             Enabling spins up a dgram socket in the Electron main
             process; incoming OSC messages are dispatched through
             the same midiRouter the MIDI mappings use, so every
             MIDI-mappable param gets OSC for free. -->
        {#if selectedSection === 'integrations:osc'}
        <section class="settings-section">
          <h3>OSC (Open Sound Control)</h3>

          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Enable OSC listener</span>
              <span class="label-hint">UDP socket in the desktop app — point TouchOSC / Lemur / your DAW at this machine's IP on the configured port.</span>
            </div>
            <label class="toggle">
              <input
                type="checkbox"
                checked={$oscStore.enabled}
                onchange={(e) => oscStore.setEnabled((e.target as HTMLInputElement).checked)}
              />
              <span class="toggle-slider"></span>
            </label>
          </div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Port</span>
              <span class="label-hint">UDP port to listen on. Common defaults: 8000 (TouchOSC default), 9000. Restart on change is automatic.</span>
            </div>
            <input
              type="number" min="1" max="65535" step="1"
              class="port-input"
              value={$oscStore.port}
              onchange={(e) => oscStore.setPort(parseInt((e.target as HTMLInputElement).value) || 8000)}
            />
          </div>

          <!-- MCP. Off by default and never auto-enabled: this is an open
               port that can black out the output mid-show, so switching it on
               should be a decision, not a convenience. -->
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">AI control (MCP)</span>
              <span class="label-hint">
                Let an AI client such as Claude Desktop operate Ghost Arcade: fire
                clips, move faders, launch columns, and look at the output to check
                the result. Listens on this machine only, and every request needs
                the token below.
              </span>
            </div>
            <label class="toggle">
              <input
                type="checkbox"
                checked={$mcpStore.enabled}
                onchange={(e) => mcpStore.setEnabled((e.target as HTMLInputElement).checked)}
              />
              <span class="toggle-slider"></span>
            </label>
          </div>

          {#if $mcpStore.enabled}
            <div class="setting-row">
              <div class="setting-label">
                <span class="label-text">Port</span>
                <span class="label-hint">Bound to 127.0.0.1. Nothing outside this machine can reach it.</span>
              </div>
              <input
                type="number" min="1" max="65535" step="1"
                class="port-input"
                value={$mcpStore.port}
                onchange={(e) => mcpStore.setPort(parseInt((e.target as HTMLInputElement).value) || 7420)}
              />
            </div>

            <div class="setting-row">
              <div class="setting-label">
                <span class="label-text">Status</span>
                <span class="label-hint">
                  {#if $mcpStore.running}
                    <span class="osc-status-dot listening"></span>
                    Serving on http://127.0.0.1:{$mcpStore.port}/
                  {:else if $mcpStore.lastError}
                    <span class="osc-status-dot error"></span>
                    {$mcpStore.lastError}
                  {:else}
                    <span class="osc-status-dot idle"></span>
                    Not running
                  {/if}
                </span>
              </div>
            </div>

            {#if $mcpStore.running && $mcpStore.token}
              <div class="setting-row">
                <div class="setting-label">
                  <span class="label-text">Token</span>
                  <span class="label-hint">
                    Send as <code>Authorization: Bearer &lt;token&gt;</code>. A new one is
                    issued each time this is switched on, so toggling it off and back
                    on revokes whatever a client is holding.
                  </span>
                </div>
                <button
                  class="osc-add-btn"
                  onclick={() => navigator.clipboard?.writeText($mcpStore.token ?? '')}
                >Copy token</button>
              </div>
            {/if}

            {#if $mcpStore.recentCalls.length > 0}
              <div class="setting-row">
                <div class="setting-label">
                  <span class="label-text">Recent calls</span>
                  <span class="label-hint">
                    {#each $mcpStore.recentCalls.slice(0, 5) as call (call.seq)}
                      <span class="mcp-call" class:failed={!call.ok}>{call.name}</span>
                    {/each}
                  </span>
                </div>
              </div>
            {/if}
          {/if}

          <!-- Output / feedback. Receive-only OSC leaves a surface guessing:
               a fader moved in the app never reaches the hardware. Sending
               state back is what makes a layout track the app. -->
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Send feedback</span>
              <span class="label-hint">
                Mirror app state back to your controller, so faders follow and clip
                buttons light when their clip is live. Uses the bindings below:
                whatever address you map, we answer on.
              </span>
            </div>
            <label class="toggle">
              <input
                type="checkbox"
                checked={$oscStore.outputEnabled}
                onchange={(e) => oscStore.setOutputEnabled((e.target as HTMLInputElement).checked)}
              />
              <span class="toggle-slider"></span>
            </label>
          </div>

          {#if $oscStore.outputEnabled}
            <div class="setting-row">
              <div class="setting-label">
                <span class="label-text">Send to</span>
                <span class="label-hint">
                  Host and port your controller listens on. 127.0.0.1 for an app on
                  this machine; use the tablet's IP for TouchOSC over Wi-Fi.
                </span>
              </div>
              <div class="button-group">
                <input
                  type="text"
                  class="port-input"
                  style="width: 120px;"
                  value={$oscStore.outputHost}
                  onchange={(e) => oscStore.setOutputTarget((e.target as HTMLInputElement).value, $oscStore.outputPort)}
                />
                <input
                  type="number" min="1" max="65535" step="1"
                  class="port-input"
                  value={$oscStore.outputPort}
                  onchange={(e) => oscStore.setOutputTarget($oscStore.outputHost, parseInt((e.target as HTMLInputElement).value) || 9000)}
                />
              </div>
            </div>
          {/if}

          <!-- Live status row — listening dot + error string. -->
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Status</span>
              <span class="label-hint">
                {#if $oscStore.listening}
                  <span class="osc-status-dot listening" title="Listening"></span>
                  Listening on UDP {$oscStore.port}
                {:else if $oscStore.lastError}
                  <span class="osc-status-dot error" title="Error"></span>
                  {$oscStore.lastError}
                {:else}
                  <span class="osc-status-dot idle"></span>
                  Not listening
                {/if}
              </span>
            </div>
          </div>

          {#if $oscStore.lastMessage}
            <div class="setting-row">
              <div class="setting-label">
                <span class="label-text">Last message</span>
                <span class="label-hint">
                  <code class="osc-last">{$oscStore.lastMessage.address}</code>
                  <span> · args: </span>
                  <code class="osc-last">{JSON.stringify($oscStore.lastMessage.args)}</code>
                  <span> · from {$oscStore.lastMessage.from}</span>
                </span>
              </div>
            </div>
          {/if}

          <!-- Learn state — when the user is mid-learn, show the
               pending target + a cancel button. The next OSC message
               will be bound to that path automatically. -->
          {#if $oscStore.learnTarget}
            <div class="osc-learn-banner">
              <span class="osc-learn-pulse"></span>
              <span>Listening for OSC message to bind <strong>{$oscStore.learnTarget.label ?? $oscStore.learnTarget.path}</strong> …</span>
              <button class="osc-learn-cancel" onclick={() => oscStore.cancelLearn()}>Cancel</button>
            </div>
          {/if}

          <div class="osc-template">
            <div>
              <strong>VJ / Pro DJ Link OSC template</strong>
              <p>
                Installs A/B clip and column triggers sized to your current deck,
                plus master, stop-all, and crossfader controls. Send from Beat Link
                Trigger, Open Beat Control, a DAW, or any OSC controller. Re-run it
                after adding layers or columns to cover the new cells.
              </p>
              <code>/ghost/vj/a/layer/1/clip/1</code>
              <span>→ Deck A, layer 1, clip 1</span>
              <code>/ghost/vj/a/column/1</code>
              <span>→ Deck A, fires column 1 across every layer at once</span>
            </div>
            <button class="osc-add-btn template" onclick={() => oscStore.installVjTemplate()}>
              Install template
            </button>
          </div>

          <h4>Bindings ({$oscStore.bindings.length})</h4>
          <p class="settings-hint">
            Each row maps an OSC address to a param path (the same path strings the MIDI router uses, e.g. <code>vj:0:opacity</code>). Trigger bindings accept numeric/boolean values, argument-less messages, and OSC Impulse.
          </p>

          {#if $oscStore.bindings.length === 0}
            <div class="osc-empty">
              No bindings yet. Add one manually, or click <strong>+ Learn</strong>, type a target path, and send an OSC message from your controller.
            </div>
          {:else}
            <div class="osc-bindings">
              <div class="osc-binding-head">
                <span>OSC address</span>
                <span>Param path</span>
                <span>Mode</span>
                <span>Min</span>
                <span>Max</span>
                <span>Inv</span>
                <span></span>
              </div>
              {#each $oscStore.bindings as b (b.id)}
                <div class="osc-binding-row">
                  <input
                    type="text"
                    value={b.address}
                    onchange={(e) => oscStore.updateBinding(b.id, { address: (e.target as HTMLInputElement).value })}
                    placeholder="/path/to/control"
                  />
                  <input
                    type="text"
                    value={b.path}
                    onchange={(e) => oscStore.updateBinding(b.id, { path: (e.target as HTMLInputElement).value })}
                    placeholder="vj:0:opacity"
                    class:invalid-path={!validateControlPath(b.path).valid}
                    aria-invalid={!validateControlPath(b.path).valid}
                    title={validateControlPath(b.path).reason ?? `Valid path: ${normalizeControlPath(b.path)}`}
                  />
                  <select
                    value={b.mode ?? 'auto'}
                    onchange={(e) => {
                      const value = (e.target as HTMLSelectElement).value;
                      oscStore.updateBinding(b.id, {
                        mode: value === 'auto' ? undefined : value as 'continuous' | 'trigger',
                      });
                    }}
                    title="Auto infers button-style paths; use Trigger for OSC bang/Impulse messages"
                  >
                    <option value="auto">Auto</option>
                    <option value="continuous">Control</option>
                    <option value="trigger">Trigger</option>
                  </select>
                  <input
                    type="number" step="any"
                    value={b.sourceMin}
                    onchange={(e) => oscStore.updateBinding(b.id, { sourceMin: parseFloat((e.target as HTMLInputElement).value) })}
                  />
                  <input
                    type="number" step="any"
                    value={b.sourceMax}
                    onchange={(e) => oscStore.updateBinding(b.id, { sourceMax: parseFloat((e.target as HTMLInputElement).value) })}
                  />
                  <label class="osc-inv">
                    <input
                      type="checkbox"
                      checked={b.invert}
                      onchange={(e) => oscStore.updateBinding(b.id, { invert: (e.target as HTMLInputElement).checked })}
                    />
                  </label>
                  <button
                    class="osc-binding-del"
                    onclick={() => oscStore.removeBinding(b.id)}
                    title="Remove binding"
                  >×</button>
                </div>
              {/each}
            </div>
          {/if}

          <div class="osc-add-row">
            <button
              class="osc-add-btn"
              onclick={() => oscStore.addBinding({ address: '/ghost/vj/master', argIndex: 0, path: 'vj:master:opacity', sourceMin: 0, sourceMax: 1, invert: false, mode: 'continuous' })}
            >+ Add binding</button>
            <button
              class="osc-add-btn learn"
              class:active={oscLearnOpen}
              onclick={beginOscLearn}
              title="Wait for the next OSC message and bind it to a param path"
            >+ Learn binding</button>
          </div>

          {#if oscLearnOpen}
            <div class="osc-learn-form">
              <label for="osc-learn-path">Target parameter</label>
              <div class="osc-learn-controls">
                <input
                  id="osc-learn-path"
                  type="text"
                  list="osc-path-examples"
                  bind:value={oscLearnPath}
                  class:invalid-path={!validateControlPath(oscLearnPath).valid}
                  onkeydown={(e) => {
                    if (e.key === 'Enter') confirmOscLearn();
                    if (e.key === 'Escape') oscLearnOpen = false;
                  }}
                />
                <button class="osc-add-btn learn" disabled={!validateControlPath(oscLearnPath).valid} onclick={confirmOscLearn}>
                  Listen
                </button>
                <button class="osc-add-btn" onclick={() => oscLearnOpen = false}>Cancel</button>
              </div>
              {#if validateControlPath(oscLearnPath).valid}
                <span class="osc-path-valid">Routes to <code>{normalizeControlPath(oscLearnPath)}</code></span>
              {:else}
                <span class="osc-path-error">{validateControlPath(oscLearnPath).reason}</span>
              {/if}
              <datalist id="osc-path-examples">
                {#each CONTROL_PATH_EXAMPLES as example}
                  <option value={example.path}>{example.label}</option>
                {/each}
              </datalist>
            </div>
          {/if}

          <details class="osc-path-reference">
            <summary>Parameter path reference</summary>
            <div class="osc-path-grid">
              {#each CONTROL_PATH_EXAMPLES as example}
                <button type="button" onclick={() => { oscLearnPath = example.path; oscLearnOpen = true; }}>
                  <code>{example.path}</code>
                  <span>{example.label}</span>
                </button>
              {/each}
            </div>
            <p>Legacy paths such as <code>vj:layer:0:opacity</code> are accepted and normalized automatically.</p>
          </details>
        </section>

        {/if}
        <!-- Keyboard control section — bind computer-keyboard keys to the
             same param paths MIDI/OSC use. Dispatched through midiRouter
             so every mappable param works. Source is discrete (key down/
             up), so each binding carries an action mode. -->
        {#if selectedSection === 'integrations:keyboard'}
        <section class="settings-section">
          <h3>Keyboard control</h3>
          <p class="settings-hint">
            Map computer-keyboard keys to any control — the same param paths MIDI and OSC use (e.g. <code>vj:column:0</code>, <code>vj:layer:0:opacity</code>). Works with or without a controller plugged in.
          </p>

          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Enable keyboard control</span>
              <span class="label-hint">While on, mapped keys act as dedicated controls and are intercepted (they won't also trigger app shortcuts). Keys typed into text fields are ignored.</span>
            </div>
            <label class="toggle">
              <input
                type="checkbox"
                checked={$keyboardStore.enabled}
                onchange={(e) => keyboardStore.setEnabled((e.target as HTMLInputElement).checked)}
              />
              <span class="toggle-slider"></span>
            </label>
          </div>

          {#if $keyboardStore.lastKey}
            <div class="setting-row">
              <div class="setting-label">
                <span class="label-text">Last key</span>
                <span class="label-hint">
                  <code class="osc-last">{formatKeyCombo($keyboardStore.lastKey)}</code>
                </span>
              </div>
            </div>
          {/if}

          {#if $keyboardStore.learnTarget}
            <div class="osc-learn-banner">
              <span class="osc-learn-pulse"></span>
              <span>Press a key to bind <strong>{$keyboardStore.learnTarget.label ?? $keyboardStore.learnTarget.path}</strong> …</span>
              <button class="osc-learn-cancel" onclick={() => keyboardStore.cancelLearn()}>Cancel</button>
            </div>
          {/if}

          <div class="osc-add-row keyboard-edit-row">
            <button
              class="osc-add-btn learn"
              class:active={$keyboardStore.editMode}
              onclick={() => keyboardStore.toggleEditMode()}
              title={$keyboardStore.editMode ? 'Exit keyboard edit mode' : 'Enter keyboard edit mode, then click a control and press a key'}
            >{$keyboardStore.editMode ? 'Exit keyboard edit' : 'Keyboard edit mode'}</button>
            <span class="settings-hint keyboard-edit-hint">Click any highlighted control, then press a key to assign it.</span>
          </div>

          <h4>Bindings ({$keyboardStore.bindings.length})</h4>
          <p class="settings-hint">
            <strong>Trigger</strong> fires on press (clips/columns/presets) · <strong>Toggle</strong> flips min↔max · <strong>Momentary</strong> = max while held, min on release · <strong>Nudge</strong> steps by the step amount each press (use a negative step for a "down" key).
          </p>

          {#if $keyboardStore.bindings.length === 0}
            <div class="osc-empty">
              No keyboard bindings yet. Use <strong>Keyboard edit mode</strong>, click a highlighted control, then press the key you want to bind.
            </div>
          {:else}
            <div class="osc-bindings" style="grid-template-columns: 0.9fr 1.5fr 0.9fr 0.55fr 0.55fr 0.6fr 28px;">
              <div class="osc-binding-head" style="grid-template-columns: 0.9fr 1.5fr 0.9fr 0.55fr 0.55fr 0.6fr 28px;">
                <span>Key</span>
                <span>Param path</span>
                <span>Mode</span>
                <span>Min</span>
                <span>Max</span>
                <span>Step</span>
                <span></span>
              </div>
              {#each $keyboardStore.bindings as b (b.id)}
                <div class="osc-binding-row" style="grid-template-columns: 0.9fr 1.5fr 0.9fr 0.55fr 0.55fr 0.6fr 28px;">
                  <button
                    class="kbd-combo"
                    onclick={() => keyboardStore.startLearn(b.path, b.label, b.mode)}
                    title="Click, then press a key to rebind"
                  >{b.code ? formatKeyCombo(b) : 'Set key…'}</button>
                  <input
                    type="text"
                    value={b.path}
                    onchange={(e) => keyboardStore.updateBinding(b.id, { path: (e.target as HTMLInputElement).value })}
                    placeholder="vj:layer:0:opacity"
                  />
                  <select
                    value={b.mode}
                    onchange={(e) => keyboardStore.updateBinding(b.id, { mode: (e.target as HTMLSelectElement).value as KeyActionMode })}
                  >
                    <option value="trigger">Trigger</option>
                    <option value="toggle">Toggle</option>
                    <option value="momentary">Momentary</option>
                    <option value="nudge">Nudge</option>
                  </select>
                  <input
                    type="number" step="any"
                    value={b.min}
                    onchange={(e) => keyboardStore.updateBinding(b.id, { min: parseFloat((e.target as HTMLInputElement).value) })}
                  />
                  <input
                    type="number" step="any"
                    value={b.max}
                    onchange={(e) => keyboardStore.updateBinding(b.id, { max: parseFloat((e.target as HTMLInputElement).value) })}
                  />
                  <input
                    type="number" step="any"
                    value={b.step}
                    disabled={b.mode !== 'nudge'}
                    onchange={(e) => keyboardStore.updateBinding(b.id, { step: parseFloat((e.target as HTMLInputElement).value) })}
                  />
                  <button
                    class="osc-binding-del"
                    onclick={() => keyboardStore.removeBinding(b.id)}
                    title="Remove binding"
                  >×</button>
                </div>
              {/each}
            </div>
          {/if}

          {#if keyboardAddOpen}
            <div class="osc-bindings keyboard-add-bindings" style="grid-template-columns: 0.9fr 1.5fr 0.9fr 0.55fr 0.55fr 0.6fr 28px;">
              <div class="osc-binding-row keyboard-add-row" style="grid-template-columns: 0.9fr 1.5fr 0.9fr 0.55fr 0.55fr 0.6fr 28px;">
                <button
                  class="kbd-combo kbd-learn"
                  onclick={startKeyboardAddLearn}
                  disabled={!keyboardAddPath.trim()}
                  title="Press this, then press the key to bind"
                >Learn key</button>
                <input
                  type="text"
                  bind:value={keyboardAddPath}
                  placeholder="vj:column:0"
                  onkeydown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      startKeyboardAddLearn();
                    }
                    e.stopPropagation();
                  }}
                />
                <select bind:value={keyboardAddMode}>
                  <option value="trigger">Trigger</option>
                  <option value="toggle">Toggle</option>
                  <option value="momentary">Momentary</option>
                  <option value="nudge">Nudge</option>
                </select>
                <input type="number" step="any" bind:value={keyboardAddMin} />
                <input type="number" step="any" bind:value={keyboardAddMax} />
                <input type="number" step="any" bind:value={keyboardAddStep} disabled={keyboardAddMode !== 'nudge'} />
                <button
                  class="osc-binding-del"
                  onclick={() => keyboardAddOpen = false}
                  title="Cancel"
                >x</button>
              </div>
            </div>
          {/if}

          <div class="osc-add-row">
            <button
              class="osc-add-btn learn"
              onclick={beginKeyboardAdd}
              title="Type a param path, then press the key to bind it to"
            >+ Add binding</button>
          </div>
        </section>

        {/if}
        <!-- WLED LED-controller section. Each controller is a WLED
             device on the LAN that the renderer pushes per-frame pixel
             data to via UDP (DRGB protocol). The shader's composite
             output is spatially sampled and shipped as RGB bytes
             through the main-process socket. See
             src/lib/wled/sender.ts + electron/main.js → wled_send_frame. -->
        {#if selectedSection === 'integrations:wled'}
        <section class="settings-section">
          <h3>WLED LED controllers</h3>
          <button class="osc-add-btn" onclick={() => openExternalUrl('https://ghostarcade.live/docs/wled')}>WLED setup guide ↗</button>
          <p class="settings-hint">
            Send the final composite to WLED LEDs on your local network. Colors and bright regions are spatially sampled across the image and shipped over UDP. Native output uses a shared preview stream, targeting 20 updates per second. WLED's default port is 21324; max 490 LEDs per controller for the DRGB protocol.
          </p>

          {#if ($project.wledControllers ?? []).length === 0}
            <div class="osc-empty">
              No WLED controllers configured. Click <strong>+ Add controller</strong> to send shader pixels to a WLED device on your LAN.
            </div>
          {:else}
            {#each ($project.wledControllers ?? []) as c (c.id)}
              <WLEDMappingPanel
                controller={c}
                onRemove={() => project.removeWLEDController(c.id)}
              />
            {/each}
          {/if}

          <div class="osc-add-row">
            <button
              class="osc-add-btn"
              onclick={() => project.addWLEDController({
                id: 'wled-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7),
                name: 'WLED ' + (($project.wledControllers ?? []).length + 1),
                ipAddr: '',
                port: 21324,
                ledCount: 32,
                enabled: false,
                brightness: 1,
                gamma: 1,
                samplingMode: 'dominant',
                ranges: [],
                mapping: {
                  mode: 'auto-grid',
                  axis: 'horizontal',
                  columns: 8,
                  serpentine: false,
                  reverse: false,
                  flipX: false,
                  flipY: false,
                  sourceRegion: { x: 0, y: 0, width: 1, height: 1 },
                  sampleRadius: 0.015,
                },
                calibration: {
                  redGain: 1,
                  greenGain: 1,
                  blueGain: 1,
                  saturation: 1,
                  blackThreshold: 0,
                  smoothing: 0,
                  colorMatrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
                },
                testPattern: 'off',
                testColor: '#ffffff',
              })}
            >+ Add controller</button>
          </div>
          <WLEDGroupsPanel />
        </section>

        {/if}
        <!-- Art-Net / sACN pixel mapping. Fixtures sample regions of the
             final composite and are sent as DMX universes from the main
             process. See src/lib/pixelmap/ + electron/pixelmap-output.cjs. -->
        {#if selectedSection === 'integrations:pixelmap'}
        <section class="settings-section">
          <h3>Art-Net and sACN pixel mapping</h3>
          <p class="settings-hint">
            Drive LED fixtures on Art-Net or sACN (E1.31) nodes from the final composite. Each fixture samples a region of the image, like a WLED controller, and is patched across universes automatically: 170 RGB or 128 RGBW pixels per universe, never splitting a pixel. Output runs at the frame rate you set, up to 60 fps. Turning output off, blackout, or disabling a fixture sends one black frame and then stops; sACN streams are terminated cleanly. LED FX from VJ mode (chase, strobe and the rest) run on fixtures too: target a fixture directly, or add it to an LED group below.
          </p>
          <PixelMapPanel />
          <!-- The same LED groups as the WLED section: fixtures join groups
               here and run LED FX (VJ mode) exactly like WLED controllers. -->
          <WLEDGroupsPanel />
        </section>
        {/if}
        {#if selectedSection === 'integrations:dmxinput'}
        <section class="settings-section">
          <h3>Art-Net and sACN DMX input</h3>
          <p class="settings-hint">
            Let a lighting desk drive the show. Ghost Arcade listens for Art-Net (UDP 6454) and sACN (UDP 5568) and binds desk channels to layer opacity, effect parameters, macros, the crossfader, and clip or column triggers. Faders can be 8-bit or 16-bit (coarse and fine), buttons fire on a threshold with hysteresis, and every binding has its own range and invert. Bindings save with the project; the on switch and network settings stay with this machine. Off by default.
          </p>
          <DmxInputPanel />
        </section>
        {/if}
        <!-- MediaPipe gesture input — runs Hand Landmarker + Gesture
             Recognizer in a worker, maps signals (palm position,
             pinch, canned gestures) to MIDI-style param paths via the
             shared midiRouter. -->
        {#if selectedSection === 'integrations:mediapipe'}
        <section class="settings-section">
          <h3>MediaPipe</h3>
          <p class="settings-hint">
            Use the webcam as a control input. Hand landmarks, pinch distance, palm position, and the canned MediaPipe gestures (open palm, fist, victory, thumb up/down, etc.) become signals that bind to any MIDI-mappable parameter through the same router OSC uses.
          </p>
          <MediaPipePanel />
        </section>
        {/if}
        <!-- Show control: timecode, schedule, start at boot, projectors.
             See src/lib/show/ and src/lib/components/show/. -->
        {#if selectedSection === 'show:timecode'}
        <section class="settings-section">
          <h3>Timecode</h3>
          <p class="settings-hint">
            Chase SMPTE timecode from LTC on an audio input or MTC over MIDI. The show timeline follows it and its markers fire their cues; cues with a timecode fire as it passes. Saved with the project.
          </p>
          <ShowControlSettings section="timecode" />
        </section>
        {/if}
        {#if selectedSection === 'show:schedule'}
        <section class="settings-section">
          <h3>Schedule</h3>
          <p class="settings-hint">
            Daily or weekly show times with date exceptions. The scheduler fires a cue at each start, stops the cue list at each stop, and can power the projectors. Saved with the project.
          </p>
          <ShowControlSettings section="schedule" />
        </section>
        {/if}
        {#if selectedSection === 'show:startup'}
        <section class="settings-section">
          <h3>Start at boot</h3>
          <p class="settings-hint">
            For installs: start with the computer, open a show and run it without anyone at the machine. These settings belong to this computer, not the project.
          </p>
          <ShowControlSettings section="startup" />
        </section>
        {/if}
        {#if selectedSection === 'show:projectors'}
        <section class="settings-section">
          <h3>Projectors</h3>
          <p class="settings-hint">
            PJLink (class 1, TCP 4352) power, shutter and input control with password authentication, and status polling. Cues and the scheduler can command these. Saved with the project.
          </p>
          <ShowControlSettings section="projectors" />
        </section>
        {/if}
        <!-- AI Settings Section -->
        {#if selectedSection === 'ai'}
        <section class="settings-section">
          <h3>AI</h3>

          <!-- Shader AI Provider -->
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Shader AI provider</span>
              <span class="label-hint">AI model used for shader generation</span>
            </div>
            <select value={$settings.ai.shaderProvider} onchange={(e) => settings.setShaderProvider((e.target as HTMLSelectElement).value as ShaderAIProvider)}>
              <option value="claude">Claude (Anthropic)</option>
              <option value="gemini">Gemini (Google)</option>
            </select>
          </div>

          <!-- API Keys section -->
          <!-- Claude API Key -->
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Claude API key
                {#if claudeKeyValid === true}<span class="key-badge valid">Valid</span>{:else if claudeKeyValid === false}<span class="key-badge invalid">Invalid</span>{/if}
              </span>
              <span class="label-hint"><a href="https://console.anthropic.com" target="_blank" class="settings-link">console.anthropic.com</a></span>
            </div>
            <div class="key-row">
              <input
                type="password"
                class="text-input key-input"
                placeholder="sk-ant-..."
                value={$settings.ai.claudeApiKey}
                oninput={(e) => { settings.setClaudeApiKey((e.target as HTMLInputElement).value); claudeKeyValid = null; }}
              />
              <button class="secondary-btn test-btn" onclick={testClaudeKey} disabled={claudeKeyValidating || !$settings.ai.claudeApiKey}>
                {claudeKeyValidating ? '...' : 'Test'}
              </button>
            </div>
          </div>

          <!-- Claude Model -->
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Claude model</span>
            </div>
            <select value={$settings.ai.claudeModel} onchange={(e) => settings.setClaudeModel((e.target as HTMLSelectElement).value)}>
              {#each CLAUDE_MODELS as model}
                <option value={model.id}>{model.label}</option>
              {/each}
            </select>
          </div>

          <!-- Gemini API Key -->
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Gemini API key
                {#if geminiKeyValid === true}<span class="key-badge valid">Valid</span>{:else if geminiKeyValid === false}<span class="key-badge invalid">Invalid</span>{/if}
              </span>
              <span class="label-hint">Also used for Veo video generation · <a href="https://aistudio.google.com/apikey" target="_blank" class="settings-link">aistudio.google.com</a></span>
            </div>
            <div class="key-row">
              <input
                type="password"
                class="text-input key-input"
                placeholder="AIza..."
                value={$settings.ai.geminiApiKey}
                oninput={(e) => { settings.setGeminiApiKey((e.target as HTMLInputElement).value); geminiKeyValid = null; }}
              />
              <button class="secondary-btn test-btn" onclick={testGeminiKey} disabled={geminiKeyValidating || !$settings.ai.geminiApiKey}>
                {geminiKeyValidating ? '...' : 'Test'}
              </button>
            </div>
          </div>

          <!-- Gemini Model -->
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Gemini model</span>
            </div>
            <select value={$settings.ai.geminiModel} onchange={(e) => settings.setGeminiModel((e.target as HTMLSelectElement).value)}>
              {#each GEMINI_MODELS as model}
                <option value={model.id}>{model.label}</option>
              {/each}
            </select>
          </div>

          <!-- Divider -->
          <div class="ai-divider"></div>

          <!-- Video AI: both providers' keys always visible -->
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Default video provider</span>
              <span class="label-hint">Which AI to use when generating videos</span>
            </div>
            <select value={$settings.ai.videoProvider} onchange={(e) => settings.setVideoProvider((e.target as HTMLSelectElement).value as VideoAIProvider)}>
              <option value="veo">Veo (Google)</option>
              <option value="luma">Luma Dream Machine</option>
            </select>
          </div>

          <!-- Veo Model -->
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Veo model</span>
              <span class="label-hint">Uses Gemini API key above</span>
            </div>
            <select value={$settings.ai.veoModel} onchange={(e) => settings.setVeoModel((e.target as HTMLSelectElement).value)}>
              {#each VEO_MODELS as model}
                <option value={model.id}>{model.label}</option>
              {/each}
            </select>
          </div>

          <!-- Luma API Key -->
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Luma API key
                {#if lumaKeyValid === true}<span class="key-badge valid">Valid</span>{:else if lumaKeyValid === false}<span class="key-badge invalid">Invalid</span>{/if}
              </span>
              <span class="label-hint"><a href="https://lumalabs.ai/dream-machine/api/keys" target="_blank" class="settings-link">lumalabs.ai/api/keys</a></span>
            </div>
            <div class="key-row">
              <input
                type="password"
                class="text-input key-input"
                placeholder="luma-..."
                value={$settings.ai.lumaApiKey}
                oninput={(e) => { settings.setLumaApiKey((e.target as HTMLInputElement).value); lumaKeyValid = null; }}
              />
              <button class="secondary-btn test-btn" onclick={testLumaKey} disabled={lumaKeyValidating || !$settings.ai.lumaApiKey}>
                {lumaKeyValidating ? '...' : 'Test'}
              </button>
            </div>
          </div>

          <!-- Luma Model -->
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Luma model</span>
            </div>
            <select value={$settings.ai.lumaModel} onchange={(e) => settings.setLumaModel((e.target as HTMLSelectElement).value)}>
              {#each LUMA_MODELS as model}
                <option value={model.id}>{model.label}</option>
              {/each}
            </select>
          </div>

        </section>
        {/if}

        </svelte:boundary>

        {#if sectionFailure && sectionFailure.section === selectedSection}
          <section class="settings-section settings-section-failed">
            <h3>This section could not load</h3>
            <p class="settings-failed-text">
              Something in this part of Settings failed. Everything else still works,
              so you can pick another section on the left.
            </p>
            <code class="settings-failed-message">{sectionFailure.error instanceof Error ? sectionFailure.error.message : String(sectionFailure.error)}</code>
            <div class="settings-failed-actions">
              <button class="osc-add-btn" onclick={retrySection}>Try again</button>
              <button class="osc-add-btn" onclick={leaveFailedSection}>Go to Appearance</button>
            </div>
            <p class="label-hint">
              The error was saved under Diagnostics at the bottom of this panel, so it can be
              copied into a bug report.
            </p>
          </section>
        {/if}
        {/key}
      </div>
      </div><!-- /.settings-body -->

      <div class="settings-footer">
        <!-- Diagnostics -->
        <div class="section">
          <h3>
            <button class="section-toggle" onclick={() => { diagnosticsOpen = !diagnosticsOpen; if (diagnosticsOpen) errorLog = getErrorLog(); }}>
              Diagnostics {diagnosticsOpen ? '▾' : '▸'}
            </button>
          </h3>
          {#if diagnosticsOpen}
            <div class="diagnostics">
              {#if isDesktopApp}
                <div class="diag-actions">
                  <button class="text-btn" onclick={() => { void openLogFolder(); }} title="Shows {DEBUG_LOG_NAME}. The last three launches are kept.">
                    Open log folder
                  </button>
                </div>
              {/if}
              <p class="hint">{errorLog.length} captured error{errorLog.length !== 1 ? 's' : ''}</p>
              {#if errorLog.length > 0}
                <div class="error-log">
                  {#each errorLog.slice().reverse() as entry}
                    <div class="error-entry">
                      <span class="error-time">{entry.timestamp.slice(0, 19).replace('T', ' ')}</span>
                      <span class="error-msg">{entry.message}</span>
                      {#if entry.source}
                        <span class="error-source">{entry.source}</span>
                      {/if}
                    </div>
                  {/each}
                </div>
                <div class="diag-actions">
                  <button class="text-btn" onclick={() => { navigator.clipboard.writeText(JSON.stringify(errorLog, null, 2)); }}>
                    Copy to clipboard
                  </button>
                  <button class="text-btn" onclick={() => { clearErrorLog(); errorLog = []; }}>
                    Clear log
                  </button>
                </div>
              {/if}
            </div>
          {/if}
        </div>

        <button class="secondary-btn" onclick={() => settings.reset()}>
          Reset to defaults
        </button>
        <button class="primary-btn" onclick={onClose}>
          Done
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  /* Dialog frame: the same backdrop, panel, header and close button as the
     other dialogs. */
  .settings-overlay {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: color-mix(in srgb, var(--ga-void, #0a0908) 76%, transparent);
    backdrop-filter: blur(8px);
    z-index: 200000;
  }

  .settings-panel {
    width: 100%;
    max-width: 960px;
    /* A fixed height, so the panel does not jump as sections change. */
    height: min(780px, calc(100vh - 48px));
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--ga-faceplate-bg, var(--ga-panel, #100f0d));
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    border-radius: var(--ga-r-hard, 5px);
    box-shadow: inset 0 1px 0 var(--ga-metal-hi, rgba(255, 255, 255, 0.08)), 0 24px 80px rgba(0, 0, 0, 0.58);
    color: var(--ga-ink-1, #ada9a2);
    font-size: var(--ga-text-body);
  }

  .settings-header {
    flex: 0 0 auto;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--ga-line-1, rgba(245, 236, 222, 0.07));
  }

  .settings-header h2 {
    margin: 0;
    font-size: var(--ga-text-heading);
    font-weight: var(--ga-weight-title);
    line-height: 1.3;
    letter-spacing: 0;
    color: var(--ga-ink-0, #f2ede4);
  }

  .close-btn {
    flex: 0 0 auto;
    width: 26px;
    height: 26px;
    display: inline-grid;
    place-items: center;
    padding: 0;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--ga-r-hard, 5px);
    color: var(--ga-ink-2, #89857e);
    cursor: pointer;
    transition: color 0.12s, background 0.12s, border-color 0.12s;
  }

  .close-btn:hover {
    color: var(--ga-ink-0, #f2ede4);
    background: var(--ga-raise, #26221c);
    border-color: var(--ga-line-2, rgba(245, 236, 222, 0.13));
  }

  /* Body: sidebar + content side-by-side, content scrolls independently */
  .settings-body {
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .settings-sidebar {
    width: 196px;
    flex-shrink: 0;
    overflow-y: auto;
    padding: 4px 0 12px;
    background: var(--ga-bar, #100f0d);
    border-right: 1px solid var(--ga-line-1, rgba(245, 236, 222, 0.07));
  }

  .sidebar-category {
    padding: 14px 16px 4px;
    font-size: var(--ga-text-eyebrow);
    font-weight: 700;
    letter-spacing: var(--ga-eyebrow-tracking);
    text-transform: uppercase;
    color: var(--ga-ink-2, #89857e);
    user-select: none;
  }

  .sidebar-section {
    display: flex;
    align-items: center;
    width: 100%;
    min-height: var(--ga-control-h);
    padding: 0 16px 0 22px;
    text-align: left;
    background: none;
    border: none;
    border-left: 2px solid transparent;
    color: var(--ga-ink-1, #ada9a2);
    font: inherit;
    font-size: var(--ga-text-body);
    font-weight: var(--ga-weight-body);
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }

  .sidebar-section:hover {
    color: var(--ga-ink-0, #f2ede4);
    background: rgba(255, 255, 255, 0.04);
  }

  .sidebar-section.active {
    color: var(--ga-selection-ink, #e0e8ff);
    background: var(--ga-selection-bg, #1f3170);
    border-left-color: var(--ga-selection-line, #5278ff);
  }

  .settings-content {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    padding: 16px 20px 24px;
  }

  /* One section-heading style: the eyebrow. */
  .settings-section {
    margin-bottom: 24px;
  }

  .settings-section:last-child {
    margin-bottom: 0;
  }

  .settings-section h3,
  .settings-section h4 {
    margin: 0 0 4px;
    font-size: var(--ga-text-eyebrow);
    font-weight: 700;
    letter-spacing: var(--ga-eyebrow-tracking);
    text-transform: uppercase;
    line-height: 1.2;
    color: var(--ga-ink-2, #89857e);
  }

  .settings-section > h3:not(:first-child),
  .settings-section > h4:not(:first-child) {
    margin-top: 24px;
  }

  /* One row layout: label left, hint under it, control right. */
  .setting-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    min-height: var(--ga-control-h);
    padding: 10px 0;
    border-bottom: 1px solid var(--ga-line-1, rgba(245, 236, 222, 0.07));
  }

  .setting-row:last-of-type {
    border-bottom: none;
  }

  /* Rows that only show under a parent toggle. */
  .setting-row.sub-row {
    padding-left: 16px;
  }
  .setting-row.sub-row input[type="range"] {
    width: 160px;
  }
  .setting-row.sub-row input[type="color"] {
    width: 40px;
    height: var(--ga-control-h-sm);
    padding: 0;
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    border-radius: var(--ga-r-hard, 5px);
    background: transparent;
    cursor: pointer;
  }
  .native-runtime-row {
    align-items: flex-start;
  }
  .native-runtime-detail {
    overflow-wrap: anywhere;
  }
  .native-runtime-warning {
    color: #fbbf24;
  }
  .native-runtime-pill {
    flex: 0 0 auto;
    min-width: 84px;
    max-width: 140px;
    padding: 4px 8px;
    border: 1px solid rgba(251, 191, 36, 0.45);
    border-radius: var(--ga-r-hard, 5px);
    color: #fbbf24;
    background: rgba(251, 191, 36, 0.08);
    font-size: var(--ga-text-meta);
    font-weight: 700;
    text-align: center;
    overflow-wrap: anywhere;
  }
  .native-runtime-pill.ok {
    border-color: color-mix(in srgb, var(--ga-green, #46d18a) 45%, transparent);
    color: var(--ga-green, #46d18a);
    background: color-mix(in srgb, var(--ga-green, #46d18a) 8%, transparent);
  }
  .native-runtime-pill.warn {
    border-color: rgba(251, 191, 36, 0.45);
    color: #fbbf24;
    background: rgba(251, 191, 36, 0.08);
  }
  .native-runtime-gates {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
    gap: 6px;
    margin: 0 0 12px;
    padding: 0 0 12px;
    border-bottom: 1px solid var(--ga-line-1, rgba(245, 236, 222, 0.07));
  }
  .native-runtime-gate {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    height: var(--ga-control-h);
    padding: 0 8px;
    border: 1px solid rgba(251, 191, 36, 0.28);
    border-radius: var(--ga-r-hard, 5px);
    background: rgba(251, 191, 36, 0.06);
    color: #fbbf24;
    font-size: var(--ga-text-meta);
    line-height: 1.2;
  }
  .native-runtime-gate.ok {
    border-color: color-mix(in srgb, var(--ga-green, #46d18a) 32%, transparent);
    background: color-mix(in srgb, var(--ga-green, #46d18a) 7%, transparent);
    color: var(--ga-green, #46d18a);
  }
  .native-runtime-gate-state {
    flex: 0 0 auto;
    font-size: var(--ga-text-eyebrow);
    font-weight: 700;
  }
  .native-runtime-gate-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .native-runtime-blockers {
    margin: 0 0 12px;
    padding: 8px 10px;
    border: 1px solid rgba(251, 191, 36, 0.25);
    border-radius: var(--ga-r-hard, 5px);
    background: rgba(251, 191, 36, 0.06);
    color: #fbbf24;
    font-size: var(--ga-text-meta);
    line-height: 1.4;
    overflow-wrap: anywhere;
  }

  .setting-label {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }

  .label-text {
    font-size: var(--ga-text-body);
    font-weight: var(--ga-weight-control);
    line-height: 1.35;
    color: var(--ga-ink-0, #f2ede4);
  }

  .label-hint,
  .settings-hint,
  .hint {
    font-size: var(--ga-text-meta);
    line-height: 1.45;
    color: var(--ga-ink-2, #89857e);
  }

  .settings-hint {
    margin: 0 0 12px;
  }

  /* Fields: 26px, the slot surface, hard corners. */
  select,
  .text-input,
  .port-input {
    box-sizing: border-box;
    height: var(--ga-control-h);
    background-color: var(--ga-slot, #060504);
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    border-radius: var(--ga-r-hard, 5px);
    color: var(--ga-ink-0, #f2ede4);
    font-family: inherit;
    font-size: var(--ga-text-control);
    font-weight: var(--ga-weight-body);
  }

  select {
    min-width: 180px;
    max-width: 280px;
    padding: 0 26px 0 8px;
    cursor: pointer;
  }

  .text-input {
    min-width: 180px;
    padding: 0 8px;
  }

  .port-input {
    width: 90px;
    padding: 0 8px;
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
  }

  select:hover,
  .text-input:hover,
  .port-input:hover {
    border-color: var(--ga-line-3, rgba(245, 236, 222, 0.24));
  }

  select:focus,
  .text-input:focus,
  .port-input:focus {
    outline: none;
    border-color: var(--ga-selection-line, #5278ff);
  }

  select option:disabled {
    color: var(--ga-ink-3, #39342c);
  }

  /* ── OSC settings styles ── */
  .osc-status-dot {
    display: inline-block;
    width: 8px; height: 8px;
    border-radius: 50%;
    margin-right: 6px;
    vertical-align: middle;
  }
  /* Section render failure. Amber like the other notices in this panel:
     it reports a problem, it is not an alarm the user caused. */
  .settings-section-failed {
    border: 1px solid rgba(255, 176, 0, 0.35);
    border-radius: var(--ga-r-hard, 5px);
    padding: 12px 16px;
  }
  .settings-failed-text {
    margin: 6px 0 10px;
    font-size: var(--ga-text-meta);
    line-height: 1.5;
    color: var(--ga-ink-1, #ada9a2);
  }
  .settings-failed-message {
    display: block;
    margin-bottom: 12px;
    padding: 8px 10px;
    border-radius: var(--ga-r-hard, 5px);
    background: var(--ga-slot, #060504);
    color: #ffb000;
    font-size: var(--ga-text-meta);
    white-space: pre-wrap;
    word-break: break-word;
  }
  .settings-failed-actions {
    display: flex;
    gap: 8px;
    margin-bottom: 8px;
  }

  /* Names what an agent has been doing, so its work is visible rather than
     inferred from the output changing on its own. */
  .mcp-call {
    display: inline-block;
    margin: 0 4px 2px 0;
    padding: 1px 5px;
    border-radius: 2px;
    background: rgba(163, 230, 53, 0.12);
    border: 1px solid rgba(163, 230, 53, 0.3);
    color: #a3e635;
    font-size: var(--ga-text-micro);
  }
  .mcp-call.failed {
    background: rgba(255, 176, 0, 0.12);
    border-color: rgba(255, 176, 0, 0.35);
    color: #ffb000;
  }

  .osc-status-dot.listening { background: var(--ga-green, #46d18a); box-shadow: 0 0 6px color-mix(in srgb, var(--ga-green, #46d18a) 60%, transparent); }
  .osc-status-dot.error     { background: var(--ga-rec, #ff3b30); }
  .osc-status-dot.idle      { background: var(--ga-ink-3, #39342c); }
  .osc-last {
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    color: var(--ga-ink-0, #f2ede4);
    font-size: var(--ga-text-meta);
    background: var(--ga-slot, #060504);
    padding: 1px 4px;
    border-radius: 3px;
  }
  .osc-learn-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 12px 0;
    padding: 6px 6px 6px 10px;
    background: rgba(255, 214, 102, 0.08);
    border: 1px solid rgba(255, 214, 102, 0.4);
    border-radius: var(--ga-r-hard, 5px);
    color: #ffd166;
    font-size: var(--ga-text-control);
  }
  .osc-learn-pulse {
    width: 8px; height: 8px;
    border-radius: 50%;
    background: #ffd166;
    animation: oscPulse 1s infinite;
  }
  @keyframes oscPulse {
    0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(255,214,102,0.6); }
    50% { opacity: 0.6; box-shadow: 0 0 0 6px rgba(255,214,102,0); }
  }
  .osc-learn-cancel {
    margin-left: auto;
    height: var(--ga-control-h-sm);
    padding: 0 10px;
    background: transparent;
    border: 1px solid rgba(255, 214, 102, 0.4);
    border-radius: var(--ga-r-hard, 5px);
    color: #ffd166;
    font: inherit;
    font-size: var(--ga-text-control);
    font-weight: var(--ga-weight-control);
    cursor: pointer;
  }
  .osc-learn-cancel:hover { background: rgba(255, 214, 102, 0.15); color: var(--ga-ink-0, #f2ede4); }

  .osc-empty {
    padding: 12px 16px;
    background: var(--ga-card, #16140f);
    border: 1px dashed var(--ga-line-2, rgba(245, 236, 222, 0.13));
    border-radius: var(--ga-r-hard, 5px);
    font-size: var(--ga-text-meta);
    line-height: 1.5;
    color: var(--ga-ink-2, #89857e);
    text-align: center;
  }
  .osc-empty strong { color: var(--ga-ink-1, #ada9a2); }
  .osc-bindings {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .osc-binding-head, .osc-binding-row {
    display: grid;
    grid-template-columns: minmax(130px, 2fr) minmax(130px, 2fr) 82px 60px 60px 32px 28px;
    gap: 6px;
    align-items: center;
  }
  .osc-binding-head {
    padding: 4px 0;
    font-size: var(--ga-text-eyebrow);
    font-weight: 700;
    letter-spacing: var(--ga-eyebrow-tracking);
    text-transform: uppercase;
    color: var(--ga-ink-2, #89857e);
  }
  /* Table cells use the compact 22px height. */
  .osc-binding-row input[type="text"],
  .osc-binding-row input[type="number"],
  .osc-binding-row select {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    max-width: none;
    height: var(--ga-control-h-sm);
    background-color: var(--ga-slot, #060504);
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    color: var(--ga-ink-0, #f2ede4);
    border-radius: var(--ga-r-hard, 5px);
    font-size: var(--ga-text-meta);
  }
  .osc-binding-row input[type="text"],
  .osc-binding-row input[type="number"] {
    padding: 0 6px;
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
  }
  .osc-binding-row select {
    padding: 0 20px 0 6px;
  }
  .osc-binding-row input:focus, .osc-binding-row select:focus { border-color: var(--ga-selection-line, #5278ff); outline: none; }
  .osc-binding-row input.invalid-path, .osc-learn-form input.invalid-path {
    border-color: #ff6868;
    box-shadow: 0 0 0 1px rgba(255, 104, 104, 0.18);
  }
  .osc-inv { display: flex; align-items: center; justify-content: center; cursor: pointer; }
  .osc-binding-del {
    display: inline-grid;
    place-items: center;
    width: var(--ga-control-h-sm);
    height: var(--ga-control-h-sm);
    padding: 0;
    background: transparent;
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    border-radius: var(--ga-r-hard, 5px);
    color: var(--ga-ink-2, #89857e);
    cursor: pointer;
  }
  .osc-binding-del:hover { background: color-mix(in srgb, var(--ga-rec, #ff3b30) 15%, transparent); color: var(--ga-rec, #ff3b30); }
  .osc-add-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin-top: 10px;
  }
  .osc-template {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 12px;
    margin-top: 12px;
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    background: var(--ga-card, #16140f);
    border-radius: var(--ga-r-hard, 5px);
  }
  .osc-template strong { color: var(--ga-ink-0, #f2ede4); font-size: var(--ga-text-body); font-weight: var(--ga-weight-control); }
  .osc-template p { color: var(--ga-ink-2, #89857e); font-size: var(--ga-text-meta); line-height: 1.45; margin: 4px 0 8px; }
  .osc-template code { color: var(--ga-blue-300, #8aa4ff); font-size: var(--ga-text-meta); }
  .osc-template span { color: var(--ga-ink-2, #89857e); font-size: var(--ga-text-meta); margin-left: 6px; }
  .osc-add-btn {
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    height: var(--ga-control-h);
    padding: 0 12px;
    background: var(--ga-raise, #26221c);
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    border-radius: var(--ga-r-hard, 5px);
    color: var(--ga-ink-1, #ada9a2);
    font: inherit;
    font-size: var(--ga-text-control);
    font-weight: var(--ga-weight-control);
    white-space: nowrap;
    cursor: pointer;
  }
  .osc-add-btn:hover:not(:disabled) { border-color: var(--ga-line-3, rgba(245, 236, 222, 0.24)); color: var(--ga-ink-0, #f2ede4); }
  .osc-add-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .osc-add-btn.template { flex: 0 0 auto; }
  .osc-add-btn.learn { border-color: rgba(255, 214, 102, 0.5); color: #ffd166; }
  .osc-add-btn.learn:hover:not(:disabled) { background: rgba(255, 214, 102, 0.1); color: var(--ga-ink-0, #f2ede4); }
  .osc-add-btn.learn.active {
    background: rgba(255, 214, 102, 0.22);
    border-color: #ffd166;
    color: var(--ga-ink-0, #f2ede4);
    box-shadow: 0 0 12px rgba(255, 214, 102, 0.22);
  }
  .osc-learn-form {
    display: grid;
    gap: 6px;
    margin-top: 10px;
    padding: 12px;
    border: 1px solid rgba(255, 214, 102, 0.35);
    background: rgba(255, 214, 102, 0.05);
    border-radius: var(--ga-r-hard, 5px);
  }
  .osc-learn-form label {
    color: var(--ga-ink-0, #f2ede4);
    font-size: var(--ga-text-control);
    font-weight: var(--ga-weight-control);
  }
  .osc-learn-controls {
    display: grid;
    grid-template-columns: minmax(180px, 1fr) auto auto;
    gap: 6px;
  }
  .osc-learn-controls input {
    box-sizing: border-box;
    min-width: 0;
    height: var(--ga-control-h);
    padding: 0 8px;
    color: var(--ga-ink-0, #f2ede4);
    background: var(--ga-slot, #060504);
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    border-radius: var(--ga-r-hard, 5px);
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    font-size: var(--ga-text-control);
  }
  .osc-path-valid, .osc-path-error { font-size: var(--ga-text-meta); }
  .osc-path-valid { color: var(--ga-green, #46d18a); }
  .osc-path-error { color: #ff7d7d; }
  .osc-path-reference {
    margin-top: 12px;
    color: var(--ga-ink-2, #89857e);
    font-size: var(--ga-text-meta);
  }
  .osc-path-reference summary { cursor: pointer; color: var(--ga-ink-1, #ada9a2); font-size: var(--ga-text-control); font-weight: var(--ga-weight-control); }
  .osc-path-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 4px;
    margin-top: 8px;
  }
  .osc-path-grid button {
    display: grid;
    gap: 2px;
    min-width: 0;
    padding: 6px 8px;
    text-align: left;
    background: var(--ga-card, #16140f);
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    border-radius: var(--ga-r-hard, 5px);
    color: var(--ga-ink-2, #89857e);
    font: inherit;
    font-size: var(--ga-text-meta);
    cursor: pointer;
  }
  .osc-path-grid button:hover { border-color: var(--ga-line-3, rgba(245, 236, 222, 0.24)); color: var(--ga-ink-1, #ada9a2); }
  .osc-path-grid code { color: var(--ga-blue-300, #8aa4ff); overflow-wrap: anywhere; }
  .keyboard-add-bindings { margin-top: 8px; }
  .keyboard-edit-row {
    align-items: center;
    margin-bottom: 8px;
  }
  .keyboard-edit-hint {
    margin: 0;
  }

  /* Keyboard binding combo cell — a click-to-rebind chip. */
  .kbd-combo {
    box-sizing: border-box;
    height: var(--ga-control-h-sm);
    padding: 0 8px;
    background: var(--ga-raise, #26221c);
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    border-radius: var(--ga-r-hard, 5px);
    color: var(--ga-ink-0, #f2ede4);
    cursor: pointer;
    font-family: var(--ga-font-mono, ui-monospace, monospace);
    font-size: var(--ga-text-meta);
    font-weight: var(--ga-weight-control);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .kbd-combo:hover { border-color: #ffd166; color: #ffd166; }
  .kbd-combo:disabled {
    opacity: 0.42;
    cursor: not-allowed;
  }
  .kbd-combo:disabled:hover {
    border-color: var(--ga-line-2, rgba(245, 236, 222, 0.13));
    color: var(--ga-ink-0, #f2ede4);
  }

  /* ── MIDI mappings table ────────────────────────────────────────
     A block per physical control with its bindings under it, rather than
     a flat list of parameters: the question people arrive with is "what is
     this pad doing", and a flat list makes them answer it themselves. */
  .mm-groups {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 10px;
  }

  .mm-group {
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    border-radius: var(--ga-r-hard, 5px);
    overflow: hidden;
    transition: border-color 0.15s, box-shadow 0.15s;
  }

  /* The control the user just pressed while finding. */
  .mm-group.found {
    border-color: var(--ga-selection-line, #5278ff);
    box-shadow: 0 0 0 1px var(--ga-selection-line, #5278ff);
  }

  .mm-group-head {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: var(--ga-control-h);
    padding: 4px 6px 4px 10px;
    background: var(--ga-card, #16140f);
  }

  .mm-control {
    font-family: var(--ga-font-mono, ui-monospace, monospace);
    font-size: var(--ga-text-control);
    color: var(--ga-ink-0, #f2ede4);
    font-weight: var(--ga-weight-control);
  }

  .mm-channel,
  .mm-count {
    font-size: var(--ga-text-meta);
    color: var(--ga-ink-2, #89857e);
  }

  .mm-count {
    margin-left: auto;
  }

  .mm-clear,
  .mm-del {
    box-sizing: border-box;
    height: var(--ga-control-h-sm);
    background: none;
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    color: var(--ga-ink-2, #89857e);
    border-radius: var(--ga-r-hard, 5px);
    cursor: pointer;
    font: inherit;
    font-size: var(--ga-text-meta);
    font-weight: var(--ga-weight-control);
    padding: 0 8px;
  }

  .mm-clear:hover,
  .mm-del:hover {
    color: var(--ga-rec, #ff3b30);
    border-color: color-mix(in srgb, var(--ga-rec, #ff3b30) 40%, transparent);
  }

  .mm-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 6px 4px 10px;
    border-top: 1px solid var(--ga-line-1, rgba(245, 236, 222, 0.07));
    font-size: var(--ga-text-control);
  }

  .mm-target {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: 6px;
    flex-wrap: wrap;
  }

  .mm-context {
    color: var(--ga-ink-2, #89857e);
  }

  .mm-context::after {
    content: ' ·';
  }

  .mm-label {
    color: var(--ga-ink-0, #f2ede4);
  }

  /* The mapping points at an effect that is not in the open project. It
     still holds the control, which is exactly why it is worth showing. */
  .mm-orphan {
    font-size: var(--ga-text-meta);
    color: #e0a458;
    border: 1px solid #e0a45844;
    border-radius: 3px;
    padding: 0 5px;
  }

  .mm-mode {
    font-size: var(--ga-text-meta);
    color: var(--ga-ink-2, #89857e);
  }

  .mm-del {
    width: var(--ga-control-h-sm);
    padding: 0;
    font-size: var(--ga-text-title);
    line-height: 1;
  }

  /* Routing is paused while this is up, so it says so. */
  .mm-identify {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    margin-bottom: 10px;
    border: 1px solid var(--ga-selection-line, #5278ff);
    border-radius: var(--ga-r-hard, 5px);
    background: var(--ga-selection-bg, #1f3170);
    font-size: var(--ga-text-control);
    color: var(--ga-selection-ink, #e0e8ff);
  }

  .mm-identify-pulse {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--ga-selection-ink, #e0e8ff);
    animation: mm-pulse 1.2s ease-in-out infinite;
  }

  @keyframes mm-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.25; }
  }

  /* Toggle switch: the same 26px height as the fields beside it. */
  .toggle {
    position: relative;
    display: inline-block;
    flex: 0 0 auto;
    width: 44px;
    height: var(--ga-control-h);
  }

  .toggle input {
    opacity: 0;
    width: 0;
    height: 0;
  }

  /* Scoped to .toggle on purpose. These rules are what give the slider its
     size, and it is absolutely positioned with all four offsets pinned: on a
     label that is not .toggle (no position, no width) the containing block
     becomes .settings-overlay and one slider paints an opaque box over the
     whole window, swallowing every click. That shipped in 2.0.3 as two
     toggles in the OSC section written with a class that has no CSS, and read
     as "the OSC tab blanks the app". Requiring the parent makes a stray
     slider render nothing instead of a full-screen blackout. */
  .toggle .toggle-slider {
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: var(--ga-slot, #060504);
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    transition: 0.2s;
    border-radius: var(--ga-control-h);
  }

  .toggle .toggle-slider::before {
    position: absolute;
    content: "";
    height: 18px;
    width: 18px;
    left: 3px;
    top: 3px;
    background-color: var(--ga-ink-2, #89857e);
    transition: 0.2s;
    border-radius: 50%;
  }

  .toggle input:checked + .toggle-slider {
    background-color: var(--ga-selection-bg, #1f3170);
    border-color: var(--ga-selection-line, #5278ff);
  }

  .toggle input:checked + .toggle-slider::before {
    transform: translateX(18px);
    background-color: var(--ga-selection-ink, #e0e8ff);
  }

  .toggle input:focus-visible + .toggle-slider {
    outline: 2px solid var(--ga-focus, #8aa4ff);
    outline-offset: 1px;
  }

  .toggle input:disabled + .toggle-slider {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .button-group {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .output-send-row {
    align-items: flex-start;
    flex-wrap: wrap;
  }
  .output-send-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .output-send {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .output-send-buttons .secondary-btn.active {
    color: var(--ga-live, #46d18a);
    border-color: color-mix(in srgb, var(--ga-live, #46d18a) 60%, transparent);
    background: color-mix(in srgb, var(--ga-live, #46d18a) 14%, transparent);
  }

  /* Buttons. In a row: 26px, 12px/600. The footer pair is 30px. */
  .secondary-btn,
  .primary-btn,
  .text-btn,
  .btn-check-update,
  .btn-update-link {
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: var(--ga-control-h);
    padding: 0 12px;
    border-radius: var(--ga-r-hard, 5px);
    font: inherit;
    font-size: var(--ga-text-control);
    font-weight: var(--ga-weight-control);
    white-space: nowrap;
    text-decoration: none;
    cursor: pointer;
    transition: color 0.12s, background 0.12s, border-color 0.12s, filter 0.12s;
  }

  .secondary-btn,
  .btn-check-update {
    background: var(--ga-raise, #26221c);
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    color: var(--ga-ink-1, #ada9a2);
  }

  .secondary-btn:hover:not(:disabled),
  .btn-check-update:hover:not(:disabled) {
    color: var(--ga-ink-0, #f2ede4);
    border-color: var(--ga-line-3, rgba(245, 236, 222, 0.24));
  }

  .text-btn {
    background: none;
    border: 1px solid transparent;
    color: var(--ga-ink-2, #89857e);
  }

  .text-btn:hover:not(:disabled) {
    color: var(--ga-ink-0, #f2ede4);
  }

  .primary-btn,
  .btn-update-link {
    background: var(--ga-ink-0, #f2ede4);
    border: 1px solid var(--ga-ink-0, #f2ede4);
    color: var(--ga-void, #0a0908);
  }

  .primary-btn:hover:not(:disabled),
  .btn-update-link:hover {
    filter: brightness(1.06);
  }

  .secondary-btn:disabled,
  .primary-btn:disabled,
  .text-btn:disabled,
  .btn-check-update:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .info-box {
    display: flex;
    gap: 8px;
    padding: 10px 12px;
    margin-top: 12px;
    background: var(--ga-card, #16140f);
    border: 1px solid var(--ga-line-1, rgba(245, 236, 222, 0.07));
    border-radius: var(--ga-r-hard, 5px);
  }

  .info-box svg {
    flex-shrink: 0;
    width: 14px;
    height: 14px;
    margin-top: 1px;
    color: var(--ga-ink-2, #89857e);
  }

  .info-box p {
    margin: 0;
    font-size: var(--ga-text-meta);
    color: var(--ga-ink-1, #ada9a2);
    line-height: 1.5;
  }

  .info-box strong {
    color: var(--ga-ink-0, #f2ede4);
  }

  /* Footer: Diagnostics on the left, the secondary + primary pair on the
     right, the same as every other dialog. */
  .settings-footer {
    flex: 0 0 auto;
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid var(--ga-line-1, rgba(245, 236, 222, 0.07));
  }

  .settings-footer > .section {
    flex: 1;
    min-width: 0;
    max-height: 30vh;
    overflow-y: auto;
  }

  .settings-footer > .section h3 {
    margin: 0;
    font-size: inherit;
  }

  .settings-footer > .secondary-btn,
  .settings-footer > .primary-btn {
    height: var(--ga-bar-control-h);
    padding: 0 14px;
    font-size: var(--ga-text-body);
  }

  .settings-footer > .primary-btn {
    min-width: 72px;
  }

  .custom-size-row {
    flex-wrap: wrap;
  }

  .custom-size-inputs,
  .custom-res-inputs {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .size-input,
  .small-input {
    width: 72px !important;
    min-width: 72px;
    text-align: center;
  }

  .size-separator,
  .custom-res-inputs span {
    color: var(--ga-ink-2, #89857e);
    font-size: var(--ga-text-control);
  }

  /* Theme Template cards — bigger preview than the accent cards
     because they need to convey font + surface + accent at once. */
  .theme-template-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
    margin: 4px 0 16px;
  }
  .theme-template-card {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
    padding: 8px 8px 12px;
    background: var(--ga-card, #16140f);
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    border-radius: var(--ga-r-hard, 5px);
    color: inherit;
    font: inherit;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
    text-align: left;
  }
  .theme-template-card:hover { border-color: var(--ga-line-3, rgba(245, 236, 222, 0.24)); }
  .theme-template-card.active {
    background: var(--ga-selection-bg, #1f3170);
    border-color: var(--ga-selection-line, #5278ff);
  }
  .theme-preview {
    width: 100%;
    height: 88px;
    border-radius: var(--ga-r-hard, 5px);
    border: 1px solid;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .theme-bar {
    height: 16px;
    border-bottom: 1px solid;
  }
  .theme-body { flex: 1; display: flex; padding: 8px; }
  .theme-panel {
    flex: 1;
    border-radius: 4px;
    padding: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .theme-card {
    background: rgba(255,255,255,.04);
    border-radius: 4px;
    padding: 6px 10px;
    display: flex;
    gap: 6px;
  }
  .theme-card i {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    box-shadow: 0 0 8px currentColor;
  }
  .theme-name { margin-top: 2px; padding: 0 4px; font-size: var(--ga-text-body); font-weight: var(--ga-weight-control); color: var(--ga-ink-0, #f2ede4); }
  .theme-desc { padding: 0 4px; font-size: var(--ga-text-meta); color: var(--ga-ink-2, #89857e); line-height: 1.4; }

  /* Color Scheme Selector */
  .color-scheme-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
    margin: 4px 0 8px;
  }

  .color-scheme-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 8px 8px 12px;
    background: var(--ga-card, #16140f);
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    border-radius: var(--ga-r-hard, 5px);
    color: inherit;
    font: inherit;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
  }

  .color-scheme-card:hover {
    border-color: var(--ga-line-3, rgba(245, 236, 222, 0.24));
  }

  .color-scheme-card.active {
    background: var(--ga-selection-bg, #1f3170);
    border-color: var(--ga-selection-line, #5278ff);
  }

  .scheme-preview {
    width: 100%;
    height: 44px;
    border-radius: var(--ga-r-hard, 5px);
    border: 1px solid;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 8px;
    box-sizing: border-box;
  }

  .scheme-accent {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    box-shadow: 0 0 10px currentColor;
  }

  .scheme-accent-secondary {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    opacity: 0.8;
  }

  .scheme-name {
    font-size: var(--ga-text-control);
    font-weight: var(--ga-weight-control);
    color: var(--ga-ink-0, #f2ede4);
  }

  .scheme-desc {
    font-size: var(--ga-text-meta);
    color: var(--ga-ink-2, #89857e);
    text-align: center;
  }

  /* AI Settings */
  .key-row {
    display: flex;
    gap: 6px;
    align-items: center;
  }

  .key-input {
    flex: 1;
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    min-width: 120px;
  }

  .key-badge {
    display: inline-block;
    font-size: var(--ga-text-meta);
    font-weight: var(--ga-weight-control);
    padding: 0 6px;
    border-radius: 3px;
    margin-left: 6px;
  }

  .key-badge.valid {
    background: color-mix(in srgb, var(--ga-green, #46d18a) 18%, transparent);
    color: var(--ga-green, #46d18a);
  }

  .key-badge.invalid {
    background: color-mix(in srgb, var(--ga-rec, #ff3b30) 18%, transparent);
    color: var(--ga-rec, #ff3b30);
  }

  .settings-link {
    color: var(--ga-blue-300, #8aa4ff);
    text-decoration: none;
  }

  .settings-link:hover {
    text-decoration: underline;
  }

  .accent-text {
    color: var(--ga-blue-300, #8aa4ff);
  }

  .ai-divider {
    height: 1px;
    background: var(--ga-line-2, rgba(245, 236, 222, 0.13));
    margin: 8px 0;
  }

  /* Rotation: a segmented control. */
  .rotation-buttons {
    display: inline-flex;
    height: var(--ga-control-h);
    padding: 2px;
    gap: 2px;
    box-sizing: border-box;
    background: var(--ga-slot, #060504);
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    border-radius: var(--ga-r-hard, 5px);
  }

  .rot-btn {
    min-width: 40px;
    padding: 0 8px;
    background: transparent;
    border: 0;
    border-radius: calc(var(--ga-r-hard, 5px) - 1px);
    color: var(--ga-ink-1, #ada9a2);
    font: inherit;
    font-size: var(--ga-text-control);
    font-weight: var(--ga-weight-control);
    font-variant-numeric: tabular-nums;
    cursor: pointer;
    transition: color 0.12s, background 0.12s;
  }

  .rot-btn:hover:not(.active) {
    color: var(--ga-ink-0, #f2ede4);
    background: rgba(255, 255, 255, 0.05);
  }

  .rot-btn.active {
    background: var(--ga-selection-bg, #1f3170);
    color: var(--ga-selection-ink, #e0e8ff);
    box-shadow: inset 0 0 0 1px var(--ga-selection-line, #5278ff);
  }

  /* Crop grid */
  .crop-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px 16px;
    padding: 4px 0 12px;
  }

  .crop-item {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .crop-label {
    font-size: var(--ga-text-control);
    color: var(--ga-ink-2, #89857e);
    min-width: 14px;
    font-weight: var(--ga-weight-control);
  }

  .crop-item input[type="range"] {
    flex: 1;
  }

  .crop-value {
    font-size: var(--ga-text-meta);
    color: var(--ga-ink-1, #ada9a2);
    min-width: 32px;
    text-align: right;
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
  }

  .crop-grid .secondary-btn {
    grid-column: 1 / -1;
    justify-self: start;
  }

  /* MIDI learn button */
  .midi-learn-btn.active {
    background: var(--ga-selection-bg, #1f3170);
    color: var(--ga-selection-ink, #e0e8ff);
    border-color: var(--ga-selection-line, #5278ff);
  }

  /* MIDI Clock running indicator — pulses when transport is active */
  .clock-status-dot {
    flex: 0 0 auto;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--ga-ink-3, #39342c);
    transition: background 0.2s;
  }
  .clock-status-dot.on {
    background: var(--ga-green, #46d18a);
    box-shadow: 0 0 10px color-mix(in srgb, var(--ga-green, #46d18a) 55%, transparent);
    animation: clockPulse 0.5s ease-in-out infinite;
  }
  @keyframes clockPulse {
    0%, 100% { opacity: 0.7; }
    50%      { opacity: 1; }
  }

  /* Diagnostics: a quiet disclosure in the footer. */
  .section-toggle {
    display: inline-flex;
    align-items: center;
    height: var(--ga-bar-control-h);
    padding: 0;
    background: none;
    border: none;
    color: var(--ga-ink-2, #89857e);
    font: inherit;
    font-size: var(--ga-text-control);
    font-weight: var(--ga-weight-control);
    cursor: pointer;
  }

  .section-toggle:hover {
    color: var(--ga-ink-0, #f2ede4);
  }

  .decode-table { border-collapse: collapse; margin: 0 0 8px; }
  .decode-table th { text-align: left; font-weight: var(--ga-weight-control); color: var(--ga-ink-1, #ada9a2); padding: 1px 12px 1px 0; white-space: nowrap; }
  .decode-table td { padding: 1px 12px 1px 0; vertical-align: top; }
  .decode-reason { opacity: 0.7; }
  .decode-file { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; margin-top: 6px; }

  .diagnostics {
    margin-top: 4px;
  }

  .diagnostics .hint {
    margin: 4px 0;
  }

  .error-log {
    max-height: 200px;
    overflow-y: auto;
    font-size: var(--ga-text-meta);
    background: var(--ga-slot, #060504);
    border: 1px solid var(--ga-line-1, rgba(245, 236, 222, 0.07));
    border-radius: var(--ga-r-hard, 5px);
    padding: 6px 8px;
    margin-top: 4px;
  }

  .error-entry {
    padding: 4px 0;
    border-bottom: 1px solid var(--ga-line-1, rgba(245, 236, 222, 0.07));
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .error-time,
  .error-source {
    color: var(--ga-ink-2, #89857e);
    font-size: var(--ga-text-meta);
  }

  .error-msg {
    color: #ff6b6b;
    word-break: break-word;
  }

  .diag-actions {
    display: flex;
    gap: 8px;
    margin-top: 6px;
  }

  /* Update banner */
  .update-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    margin-bottom: 16px;
    background: var(--ga-selection-bg, #1f3170);
    border: 1px solid var(--ga-selection-line, #5278ff);
    border-radius: var(--ga-r-hard, 5px);
  }
  .update-banner-content {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  .update-badge {
    flex: 0 0 auto;
    font-size: var(--ga-text-meta);
    font-weight: 700;
    background: var(--ga-selection-line, #5278ff);
    color: var(--ga-selection-ink, #e0e8ff);
    padding: 1px 6px;
    border-radius: 3px;
  }
  .update-text {
    font-size: var(--ga-text-body);
    color: var(--ga-selection-ink, #e0e8ff);
  }
  .update-current {
    font-size: var(--ga-text-meta);
    color: var(--ga-ink-1, #ada9a2);
  }
  .update-links {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  /* Banner shown above the GPU toggles when any of them has diverged
     from its boot-time value. Amber, attention-grabbing, but not as
     red as an error state — this is a "do this before continuing"
     prompt, not a failure. */
  .gpu-restart-banner {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 0 0 12px 0;
    padding: 10px 12px;
    background: rgba(251, 191, 36, 0.10);
    border: 1px solid rgba(251, 191, 36, 0.45);
    border-radius: var(--ga-r-hard, 5px);
  }
  .gpu-restart-text {
    flex: 1;
    color: #e6c66a;
    font-size: var(--ga-text-meta);
    line-height: 1.45;
  }
  .gpu-restart-text strong {
    color: #fbbf24;
  }
</style>
