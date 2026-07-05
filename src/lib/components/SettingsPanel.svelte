<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { settings, getSupportedFormats, COLOR_SCHEMES, CLAUDE_MODELS, GEMINI_MODELS, VEO_MODELS, LUMA_MODELS, DEFAULT_LAYER_SHADERS, type RecordingSettings, type OutputSettings, type ColorSchemeId, type FluidQualityMode, type ShaderQualityMode, type GpuInstrumentQualityMode, type ShaderAIProvider, type VideoAIProvider } from '../stores/settings';
  // Theme template registry — full visual style swap (fonts + surfaces
  // + corners + accents). See src/lib/theming/themes/.
  import { activeThemeId, themes } from '../theming/store';
  const themesList = themes.list();
  import {
    probeDecodeSupport,
    probeEncodeSupport,
    formatDecodeSupport,
    type CodecDecodeReport,
    type CodecEncodeReport,
  } from '../utils/codecProbe';

  // Codec capability probe (Performance tab readout). Lazy.
  let codecDecode: CodecDecodeReport | null = null;
  let codecEncode: CodecEncodeReport | null = null;
  let codecProbed = false;
  async function runCodecProbe() {
    if (codecProbed) return;
    codecProbed = true;
    codecEncode = probeEncodeSupport();
    codecDecode = await probeDecodeSupport();
  }
  import { validateAPIKey, validateLumaKey } from '../api/ai-client';
  import { updateInfo } from '../stores/updateChecker';
  import { updateModalOpen } from '../stores/uiState';
  import { project } from '../stores/layers';
  import { checkForUpdate, getCachedVersionResult, type VersionCheckResult } from '../utils/versionCheck';
  import { openExternalUrl } from '../bridge';

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
  import { midiManager } from '../midi/midiManager';
  import { abletonLink } from '../sync/abletonLink';
  import { oscStore } from '../osc/oscStore';
  import { keyboardStore, formatKeyCombo, type KeyActionMode } from '../keyboard/keyboardStore';
  let keyboardAddOpen = false;
  let keyboardAddPath = '';
  let keyboardAddMode: KeyActionMode = 'momentary';
  let keyboardAddMin = 0;
  let keyboardAddMax = 1;
  let keyboardAddStep = 0.05;

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
  // LicensePanel + tier-related imports removed — OSS build has no license UI.
  // Multi-Output / per-slice config (createDefaultSlice, maxOutputSlices,
  // OutputCanvasPreview) moved to the Screens tab — see ScreenPanel.svelte.
  import { isDesktopApp, getTextureShareLabel, invoke } from '$lib/bridge';
  import { getErrorLog, clearErrorLog, type ErrorEntry } from '../utils/errorReporter';
  import { isWebGPUSupported, probeWebGPU, getWebGPUInfo, type WebGPUInfo } from '../renderer/webgpuCapability';

  // GPU Acceleration panel state — populated by the WebGPU capability probe.
  // We display the adapter info read-only and expose the two production
  // toggles (editor-side bridge + zero-copy output transport). The probe
  // is idempotent, so calling it from onMount is cheap on repeat opens.
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

  // Snapshot of the experimental GPU flags at the time this settings
  // panel script first ran. The Electron renderer wires up which
  // canvas/bridge to mount at boot, so toggling editorWebGPU or
  // allowMidChainGpuEffects mid-session leaves the engine in a
  // half-broken state (grid disappears, layers stop receiving frames,
  // etc.). We compare current values against this snapshot to know
  // when a restart is required. Using $settings.experimental directly
  // (not the store wrapper) so the snapshot is a plain object frozen
  // at module-script-eval time.
  const bootExperimentalGPU = {
    editorWebGPU: $settings.experimental?.editorWebGPU ?? true,
    outputZeroCopy: $settings.experimental?.outputZeroCopy ?? true,
    allowMidChainGpuEffects: $settings.experimental?.allowMidChainGpuEffects ?? true,
  };
  $: gpuRestartRequired =
    $settings.experimental?.editorWebGPU !== bootExperimentalGPU.editorWebGPU ||
    $settings.experimental?.outputZeroCopy !== bootExperimentalGPU.outputZeroCopy ||
    $settings.experimental?.allowMidChainGpuEffects !== bootExperimentalGPU.allowMidChainGpuEffects;

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
  $: midiAvailable = $midiStore.available;
  $: midiEditMode = $midiStore.editMode;

  function handleMidiDeviceChange(e: Event) {
    const id = (e.target as HTMLSelectElement).value;
    if (id) midiManager.selectDevice(id);
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
    | 'output:display'
    | 'performance:gpu' | 'performance:render-quality' | 'performance:video-decoding'
    | 'recording'
    | 'integrations:midi' | 'integrations:osc' | 'integrations:keyboard' | 'integrations:wled' | 'integrations:mediapipe'
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
    ]},
    { id: 'performance', label: 'Performance', sections: [
      { id: 'performance:gpu', label: 'GPU Acceleration' },
      { id: 'performance:render-quality', label: 'Render Quality' },
      { id: 'performance:video-decoding', label: 'Video Decoding' },
    ]},
    { id: 'recording', label: 'Recording', sections: [
      { id: 'recording', label: 'Recording' },
    ]},
    { id: 'integrations', label: 'Integrations', sections: [
      { id: 'integrations:midi', label: 'MIDI' },
      { id: 'integrations:osc', label: 'OSC' },
      { id: 'integrations:keyboard', label: 'Keyboard' },
      { id: 'integrations:wled', label: 'WLED' },
      { id: 'integrations:mediapipe', label: 'MediaPipe' },
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
    mediapipe: 'integrations:mediapipe',
    ai: 'ai',
  };

  let selectedSection: SectionId = 'app:appearance';
  // Advanced sections are always visible now — the checkbox was hiding
  // mildly intimidating but useful sections (MediaPipe, GPU Acceleration)
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
    if (typeof window === 'undefined') return;
    window.removeEventListener('close-settings', handleCloseRequest);
  });
  // Lazy probes — run when the user first lands on a section that needs
  // the data. Cheaper than probing at mount for sections the user may
  // never open.
  $: if (selectedSection === 'performance:render-quality' && !codecProbed) runCodecProbe();
  $: if (selectedSection === 'performance:video-decoding' && !codecProbed) runCodecProbe();
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
    { label: '1920 x 1080 (16:9 Landscape)', width: 1920, height: 1080 },
    { label: '1080 x 1920 (9:16 Portrait)', width: 1080, height: 1920 },
    { label: '1080 x 1080 (Square)', width: 1080, height: 1080 },
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
    { value: 'match', label: 'Match Canvas' },
    { value: 'output', label: 'Match Output Display' },
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
    { value: 2500000, label: '2.5 Mbps (Small files)' },
    { value: 5000000, label: '5 Mbps (Balanced)' },
    { value: 8000000, label: '8 Mbps (High quality)' },
    { value: 12000000, label: '12 Mbps (Best quality)' },
  ];

  const fluidQualityModes: { value: FluidQualityMode; label: string }[] = [
    { value: 'live', label: 'Live (fastest)' },
    { value: 'balanced', label: 'Balanced' },
    { value: 'quality', label: 'Quality (best visuals)' },
  ];

  const shaderQualityModes: { value: ShaderQualityMode; label: string }[] = [
    { value: 'full', label: 'Full (100%)' },
    { value: 'high', label: 'High (75%)' },
    { value: 'medium', label: 'Medium (50%)' },
    { value: 'low', label: 'Low (25%)' },
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
    settings.setShaderQuality(value);
  }

  function handleGpuInstrumentQualityChange(e: Event) {
    const value = (e.target as HTMLSelectElement).value as GpuInstrumentQualityMode;
    settings.setGpuInstrumentQuality(value);
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if isOpen}
  <div class="settings-overlay" onclick={handleOverlayClick} role="dialog" aria-modal="true">
    <div class="settings-panel">
      <div class="settings-header">
        <h2>Settings</h2>
        <button class="close-btn" onclick={onClose} aria-label="Close settings">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
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
              <div class="update-badge">UPDATE</div>
              <div class="update-text">
                <strong>Ghost Arcade v{$updateInfo.latestVersion}</strong> is available
                <span class="update-current">(you have v{$updateInfo.currentVersion})</span>
              </div>
            </div>
            <div class="update-links">
              <button class="update-cta-btn" onclick={() => updateModalOpen.set(true)}>
                See what's new
              </button>
            </div>
          </div>
        {/if}

        <!-- Appearance Section -->
        {#if selectedSection === 'app:appearance'}
        <section class="settings-section">
          <h3>Appearance</h3>

          <!-- Theme Templates — a complete style overhaul (fonts,
               surfaces, accents, corner system) vs just an accent
               swap. New themes plug in via src/lib/theming/themes/.  -->
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Theme Template</span>
              <span class="label-hint">Full visual style — fonts, surfaces, corner system, accents. Switches the whole app at once.</span>
            </div>
          </div>

          <div class="theme-template-grid">
            {#each themesList as theme}
              <button
                class="theme-template-card"
                class:active={$activeThemeId === theme.id}
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
              <span class="label-text">Accent Scheme</span>
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
              <span class="label-text">Safe Mode</span>
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
              <span class="label-text">Snap to other layers</span>
              <span class="label-hint">In mapping mode, snap warp handles to nearby layer edges, centers, and canvas edges. Turn off if the snap is fighting you — handles will then move pixel-by-pixel with no magnetism.</span>
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
              class="port-input"
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
                  <strong style="color: #BB86FC;">{versionInfo.latest}</strong> is available — open the download page to install it.
                {:else if versionInfo?.latest && !versionInfo.hasUpdate}
                  You're on the latest release.
                {:else}
                  Click to check for newer releases.
                {/if}
              </span>
            </div>
            <div style="display: flex; gap: 8px; align-items: center;">
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
        <section class="settings-section">
          <h3>Canvas</h3>

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
                <span class="label-text">Custom Size</span>
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
              <span class="label-text">Default Layer Shader</span>
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
              <span class="label-text">New Layer Placement</span>
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

          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Video Format</span>
              <span class="label-hint">Choose the format for screen recordings</span>
            </div>
            <select value={$settings.recording.format} onchange={handleFormatChange}>
              {#each formats as format}
                <option value={format.id} disabled={!format.supported}>
                  {format.label} {!format.supported ? '(Not supported)' : ''}
                </option>
              {/each}
            </select>
          </div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Video Quality</span>
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
              <span class="label-text">Save Location</span>
              <span class="label-hint">{$settings.recording.saveDirectoryName}</span>
            </div>
            <div class="button-group">
              <button class="secondary-btn" onclick={handlePickDirectory}>
                Choose Folder
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
          <h3>Render Quality</h3>

          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Fluid Quality</span>
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
              <span class="label-text">Shader Quality</span>
              <span class="label-hint">Default render resolution for shader layers (override per-layer in Layer Panel)</span>
            </div>
            <select value={$settings.ui.shaderQuality} onchange={handleShaderQualityChange}>
              {#each shaderQualityModes as mode}
                <option value={mode.value}>{mode.label}</option>
              {/each}
            </select>
          </div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">{tsLabel} Output</span>
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
                <span class="label-text">Sender Name</span>
                <span class="label-hint">Visible to {tsLabel} receivers (e.g. OBS, TouchDesigner)</span>
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
                <span class="label-text">Output Resolution</span>
                <span class="label-hint">{$settings.output.spoutResolution === 'output' && detectedOutputRes
                  ? `Detected: ${detectedOutputRes.width}×${detectedOutputRes.height}`
                  : `Resolution of the ${tsLabel} texture`}</span>
              </div>
              <select value={$settings.output.spoutResolution} onchange={handleSpoutResolutionChange}>
                {#each spoutResolutions as opt}
                  <option value={opt.value}>{opt.value === 'output' && detectedOutputRes
                    ? `Match Output (${detectedOutputRes.width}×${detectedOutputRes.height})`
                    : opt.label}</option>
                {/each}
              </select>
            </div>

            {#if $settings.output.spoutResolution === 'custom'}
              <div class="setting-row">
                <div class="setting-label">
                  <span class="label-text">Custom Size</span>
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
                {tsLabel}-compatible application on this machine (OBS, TouchDesigner, etc).
                Full GPU texture sharing is available in the desktop build.
              </p>
            </div>
          {/if}
        </section>

        <!-- Output Display Section -->
        <section class="settings-section">
          <h3>Display</h3>

          <!-- Match Resolution: snaps the project canvas to the native pixel
               dimensions of the display the output window is on (or would be).
               Eliminates source→projector scaling entirely. -->
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Resolution</span>
              <span class="label-hint">
                Project canvas: <strong>{$project.width}×{$project.height}</strong>
                {#if matchResLabel}<br/><em style="color: #BB86FC;">{matchResLabel}</em>{/if}
              </span>
            </div>
            <button class="secondary-btn" onclick={handleMatchResolution} disabled={matchResBusy}>
              {matchResBusy ? 'Detecting…' : 'Match Output Display'}
            </button>
          </div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Output Rotation</span>
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
              <span class="label-text">Input Crop</span>
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
              Reset Crop
            </button>
          </div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Show Cursor on Output</span>
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
        <!-- The standalone WebRTC output transport toggle that used to
             live here was removed. Native core output is the default,
             WebGPU zero-copy is the fallback, and WebRTC remains a hidden
             escape hatch for debugging transport regressions. -->

        <!-- Performance Tab — opt-in knobs for users on weaker hardware.
             Defaults match the historical full-quality behaviour. Intro
             card shows under GPU since that's first in the sidebar. -->
        {#if selectedSection === 'performance:gpu'}
        <section class="settings-section">
          <div class="setting-row" style="border-bottom: 1px solid rgba(255,255,255,0.06); padding-bottom: 12px;">
            <div class="setting-label" style="flex: 1;">
              <span class="label-text" style="color: #BB86FC;">Tune the editor for your hardware</span>
              <span class="label-hint" style="line-height: 1.5;">
                If the app feels laggy, step these down until it feels smooth. None of these change your output content — only how the editor renders and the output stream encodes. Capable machines should leave everything at the defaults.
                <br/><br/>
                <a href="https://ghostarcade.live/docs/performance" target="_blank" rel="noopener noreferrer"
                   style="color: #BB86FC; text-decoration: underline; font-weight: 600;">
                  Full guide: optimizing Ghost Arcade for your machine →
                </a>
              </span>
            </div>
          </div>
        </section>

        <!-- ─────────────────────────────────────────────────────────────
             Renderer & Output — native renderer first, WebGPU fallback
             second, and legacy paths kept for diagnostics. The fields
             still live in $settings.experimental for migration stability.
             When WebGPU is unavailable, WebGPU-specific controls are
             disabled and the section explains why so users do not waste
             time hunting for an unavailable effect or output path.
             ───────────────────────────────────────────────────────── -->
        <section class="settings-section">
          <h3>Renderer &amp; Output</h3>
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
                These GPU settings only take effect on a fresh process —
                the editor will appear broken (no grid, missing frames)
                until you restart the app.
              </div>
              <button class="primary-btn" onclick={restartApp} disabled={restarting} style="white-space: nowrap;">
                {restarting ? 'Restarting…' : 'Restart app'}
              </button>
            </div>
          {/if}
          <div class="setting-row" style="border-bottom: 1px solid rgba(255,255,255,0.06); padding-bottom: 10px;">
            <div class="setting-label" style="flex: 1;">
              <span class="label-text" style:color={webgpuSupported ? '#4caf50' : '#fbbf24'}>
                {#if webgpuProbing}
                  Probing WebGPU…
                {:else if webgpuSupported}
                  ✓ WebGPU detected
                {:else}
                  ⚠ WebGPU not available
                {/if}
              </span>
              <span class="label-hint" style="line-height: 1.5;">
                {#if webgpuSupported}
                  Adapter:
                  <strong>
                    {webgpuInfo.description || webgpuInfo.vendor || 'unknown'}
                    {#if webgpuInfo.architecture}({webgpuInfo.architecture}){/if}
                  </strong>
                  {#if webgpuInfo.isFallbackAdapter}
                    <br/><span style="color: #fbbf24;">⚠ Software fallback adapter — performance will be limited.</span>
                  {/if}
                  <br/>
                  Hardware-accelerated rendering paths are available. Native core output is the primary path; WebGPU zero-copy remains the fast fallback.
                {:else}
                  {webgpuInfo.failReason ? `Reason: ${webgpuInfo.failReason}.` : 'Your browser/device did not return a WebGPU adapter.'}
                  <br/>
                  Effects and layers that require WebGPU (e.g. <em>Fluid Sim</em>, the GPU Shader layer) are hidden in the picker so you don't try to add something that won't run. The legacy WebGL pipeline keeps the rest of the app working normally.
                {/if}
              </span>
            </div>
            <button class="primary-btn" onclick={refreshWebGPUStatus} disabled={webgpuProbing} style="white-space: nowrap;">
              {webgpuProbing ? 'Probing…' : 'Re-probe'}
            </button>
          </div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Editor GPU bridge</span>
              <span class="label-hint">
                Use the WebGPU + VideoFrame bridge for the editor → output handoff. When off, falls back to the legacy WebGL transport (works everywhere, slightly higher latency, no zero-copy).
                {#if !webgpuSupported}
                  <br/><em style="color: #999;">Disabled — requires WebGPU.</em>
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
              <span class="label-text">Native render core output</span>
              <span class="label-hint">
                Use the Rust/wgpu managed output window from the Output Window controls. This is the v2 driver path; turn it off only to force the zero-copy WebGPU fallback. Apply on next output-window open.
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

          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Zero-copy GPU output</span>
              <span class="label-hint">
                Send frames to the fallback output window via WebGPU's <code>importExternalTexture</code> — no encode/decode round trip, true 4K60. Used when native core output is off or unavailable. Apply on next output-window open.
                {#if !webgpuSupported}
                  <br/><em style="color: #999;">Disabled — requires WebGPU.</em>
                {/if}
              </span>
            </div>
            <label class="toggle">
              <input
                type="checkbox"
                checked={$settings.experimental.outputZeroCopy}
                disabled={!webgpuSupported}
                onchange={(e) => settings.update(s => ({ ...s, experimental: { ...s.experimental, outputZeroCopy: (e.target as HTMLInputElement).checked } }))}
              />
              <span class="toggle-slider"></span>
            </label>
          </div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Mid-chain GPU effects</span>
              <span class="label-hint">
                Allow WebGPU effects (e.g. <em>Fluid Sim</em>) in the middle of a layer's effect chain. Adds a ~3 ms GPU↔CPU round-trip per affected effect; turn off if you're not using GPU effects and want the steady-state path purely WebGL.
                {#if !webgpuSupported}
                  <br/><em style="color: #999;">Disabled — requires WebGPU.</em>
                {/if}
              </span>
            </div>
            <label class="toggle">
              <input
                type="checkbox"
                checked={$settings.experimental.allowMidChainGpuEffects}
                disabled={!webgpuSupported}
                onchange={(e) => settings.update(s => ({ ...s, experimental: { ...s.experimental, allowMidChainGpuEffects: (e.target as HTMLInputElement).checked } }))}
              />
              <span class="toggle-slider"></span>
            </label>
          </div>
        </section>

        {/if}
        {#if selectedSection === 'performance:render-quality'}
        <section class="settings-section">
          <h3>Render Quality</h3>
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Shader Quality</span>
              <span class="label-hint">Internal render resolution for shader layers. Full = native; lower scales then upscales.</span>
            </div>
            <select value={$settings.ui.shaderQuality} onchange={handleShaderQualityChange}>
              <option value="full">Full</option>
              <option value="high">High (0.75x)</option>
              <option value="medium">Medium (0.5x)</option>
              <option value="low">Low (0.25x)</option>
            </select>
          </div>
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">GPU Instrument Budget</span>
              <span class="label-hint">Caps expensive WebGPU shader internals like particles, volume grids, emitters, and ray steps. Auto adapts live; fixed modes stay stable.</span>
            </div>
            <select value={$settings.performance.gpuInstrumentQuality ?? 'auto'} onchange={handleGpuInstrumentQualityChange}>
              {#each gpuInstrumentQualityModes as mode}
                <option value={mode.value}>{mode.label}</option>
              {/each}
            </select>
          </div>
        </section>

        <section class="settings-section">
          <h3>Editor Render</h3>
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Editor Frame Rate Cap</span>
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
          <h3>VJ Preview</h3>
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Preview Resolution</span>
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
              <span class="label-text">Preview Refresh Rate</span>
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
          <h3>Output Stream</h3>
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Output Frame Rate</span>
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
              <span class="label-text">Max Bitrate</span>
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
              <span class="label-text">Quality vs Smoothness</span>
              <span class="label-hint">How the encoder degrades under load: keep pixels (drop fps), keep smoothness (drop pixels), or balanced.</span>
            </div>
            <select value={$settings.performance.outputDegradationPreference}
              onchange={(e) => settings.update(s => ({ ...s, performance: { ...s.performance, outputDegradationPreference: (e.target as HTMLSelectElement).value as 'maintain-resolution' | 'maintain-framerate' | 'balanced' } }))}>
              <option value="maintain-resolution">Maintain Resolution</option>
              <option value="maintain-framerate">Maintain Frame Rate</option>
              <option value="balanced">Balanced</option>
            </select>
          </div>
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Video Codec</span>
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
          <div class="setting-row" style="border-top: 1px solid rgba(255,255,255,0.06); padding-top: 8px; margin-top: 4px;">
            <div class="setting-label" style="flex: 1;">
              <span class="label-hint" style="opacity: 0.7;">
                <strong>Apply on next output-window open.</strong> Stream-tuning settings take effect when the output window opens — close and reopen the output for changes to apply.
              </span>
            </div>
          </div>
        </section>

        {/if}
        {#if selectedSection === 'performance:video-decoding'}
        <section class="settings-section">
          <h3>Video Decoding (read-only)</h3>
          <div class="setting-row">
            <div class="setting-label" style="flex: 1;">
              <span class="label-hint" style="line-height: 1.7;">
                {#if codecDecode}
                  <strong>H.264:</strong> <span style:color={codecDecode.h264 === 'hw' ? '#4caf50' : codecDecode.h264 === 'sw' ? '#fbbf24' : '#999'}>{formatDecodeSupport(codecDecode.h264)}</span>
                  &nbsp;·&nbsp;
                  <strong>HEVC:</strong> <span style:color={codecDecode.hevc === 'hw' ? '#4caf50' : codecDecode.hevc === 'sw' ? '#fbbf24' : '#999'}>{formatDecodeSupport(codecDecode.hevc)}</span>
                  &nbsp;·&nbsp;
                  <strong>VP9:</strong> <span style:color={codecDecode.vp9 === 'hw' ? '#4caf50' : codecDecode.vp9 === 'sw' ? '#fbbf24' : '#999'}>{formatDecodeSupport(codecDecode.vp9)}</span>
                  &nbsp;·&nbsp;
                  <strong>AV1:</strong> <span style:color={codecDecode.av1 === 'hw' ? '#4caf50' : codecDecode.av1 === 'sw' ? '#fbbf24' : '#999'}>{formatDecodeSupport(codecDecode.av1)}</span>
                  <br/><br/>
                  For best playback performance, re-encode your video clips with a codec your machine decodes in <strong style="color: #4caf50;">hardware</strong>.
                  <a href="https://ghostarcade.live/docs/performance#video-codecs" target="_blank" rel="noopener noreferrer"
                     style="color: #BB86FC; text-decoration: underline;">
                    See ffmpeg recipes →
                  </a>
                {:else}
                  Probing decode capabilities…
                {/if}
              </span>
            </div>
          </div>
        </section>

        {/if}
        <!-- MIDI Settings Section -->
        {#if selectedSection === 'integrations:midi'}
        <section class="settings-section">
          <h3>MIDI Controller</h3>

          {#if midiAvailable}
            <div class="setting-row">
              <div class="setting-label">
                <span class="label-text">MIDI Device</span>
                <span class="label-hint">Select your MIDI controller input</span>
              </div>
              <select value={midiSelectedId || ''} onchange={handleMidiDeviceChange}>
                <option value="">No MIDI Device</option>
                {#each midiDevices as device}
                  <option value={device.id}>{device.name}</option>
                {/each}
              </select>
            </div>

            <div class="setting-row">
              <div class="setting-label">
                <span class="label-text">MIDI Learn Mode</span>
                <span class="label-hint">Click a parameter, then move a MIDI control to map it</span>
              </div>
              <button
                class="secondary-btn midi-learn-btn"
                class:active={midiEditMode}
                disabled={midiDevices.length === 0 && !midiEditMode}
                onclick={() => midiStore.toggleEditMode()}
              >
                {midiEditMode ? 'Exit MIDI Learn' : midiDevices.length === 0 ? 'No MIDI Device' : 'Enter MIDI Learn'}
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

            <!-- MIDI Clock — sync to / from external transport -->
            <h3 style="margin-top: 18px;">MIDI Clock</h3>

            <div class="setting-row">
              <div class="setting-label">
                <span class="label-text">Receive MIDI Clock</span>
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
              <div class="setting-row" style="padding-left: 16px;">
                <div class="setting-label">
                  <span class="label-text">Clock Status</span>
                  <span class="label-hint">{$midiStore.clockInRunning ? 'Running' : 'Idle'}{$midiStore.clockInBPM ? ` · ${$midiStore.clockInBPM.toFixed(1)} BPM` : ''}</span>
                </div>
                <span class="clock-status-dot" class:on={$midiStore.clockInRunning}></span>
              </div>
            {/if}

            <div class="setting-row">
              <div class="setting-label">
                <span class="label-text">Send MIDI Clock</span>
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
                  <span class="label-text">Output Device</span>
                  <span class="label-hint">Where to send clock ticks</span>
                </div>
                <select
                  value={$midiStore.selectedOutputId || ''}
                  onchange={(e) => midiManager.selectOutputDevice((e.target as HTMLSelectElement).value || null)}
                >
                  <option value="">No Output Device</option>
                  {#each $midiStore.outputDevices.filter(d => d.state === 'connected') as device (device.id)}
                    <option value={device.id}>{device.name}</option>
                  {/each}
                </select>
              </div>
            {/if}

            <!-- Ableton Link — WiFi/LAN tempo session with DAWs, DJ
                 software, and other Link apps. Tempo flows both ways;
                 a running MIDI clock-in takes priority over Link. -->
            <h3 style="margin-top: 18px;">Ableton Link</h3>

            <div class="setting-row">
              <div class="setting-label">
                <span class="label-text">Enable Ableton Link</span>
                <span class="label-hint">Join the tempo session on your network — Serato, Rekordbox, Ableton Live, Resolume and other Link apps sync automatically</span>
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
              <div class="setting-row" style="padding-left: 16px;">
                <div class="setting-label">
                  <span class="label-text">Session</span>
                  <span class="label-hint">{$abletonLink.peers} peer{$abletonLink.peers === 1 ? '' : 's'} · {$abletonLink.tempo.toFixed(1)} BPM{$midiStore.clockInEnabled && $midiStore.clockInRunning ? ' · deferring to MIDI clock-in' : ''}</span>
                </div>
                <span class="clock-status-dot" class:on={$abletonLink.peers > 0}></span>
              </div>
            {/if}
            {#if $abletonLink.error}
              <div class="setting-row" style="padding-left: 16px;">
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
              <span class="label-text">Enable OSC Listener</span>
              <span class="label-hint">UDP socket in the desktop app — point TouchOSC / Lemur / your DAW at this machine's IP on the configured port.</span>
            </div>
            <label class="toggle">
              <input
                type="checkbox"
                checked={$oscStore.enabled}
                onchange={(e) => oscStore.setEnabled((e.target as HTMLInputElement).checked)}
              />
              <span class="slider"></span>
            </label>
          </div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Port</span>
              <span class="label-hint">UDP port to listen on. Common defaults: 8000 (TouchOSC default), 9000 (TouchDesigner). Restart on change is automatic.</span>
            </div>
            <input
              type="number" min="1" max="65535" step="1"
              class="port-input"
              value={$oscStore.port}
              onchange={(e) => oscStore.setPort(parseInt((e.target as HTMLInputElement).value) || 8000)}
            />
          </div>

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
                  <span style="color: var(--text-muted, #888);"> · args: </span>
                  <code class="osc-last">{JSON.stringify($oscStore.lastMessage.args)}</code>
                  <span style="color: #555;"> · from {$oscStore.lastMessage.from}</span>
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

          <h4 style="margin-top: 14px;">Bindings ({$oscStore.bindings.length})</h4>
          <p class="settings-hint" style="margin-bottom: 8px;">
            Each row maps an OSC address to a param path (the same path strings the MIDI router uses, e.g. <code>vj:layer:0:opacity</code>). Use <strong>+ Add</strong> to enter one manually, or <strong>+ Learn</strong> to bind by sending the next OSC message.
          </p>

          {#if $oscStore.bindings.length === 0}
            <div class="osc-empty">
              No bindings yet. Add one manually, or click <strong>+ Learn</strong>, type a target path, and send an OSC message from your controller.
            </div>
          {:else}
            <div class="osc-bindings">
              <div class="osc-binding-head">
                <span>OSC Address</span>
                <span>Param Path</span>
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
                    placeholder="vj:layer:0:opacity"
                  />
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
              onclick={() => oscStore.addBinding({ address: '/example', argIndex: 0, path: 'vj:layer:0:opacity', sourceMin: 0, sourceMax: 1, invert: false })}
            >+ Add binding</button>
            <button
              class="osc-add-btn learn"
              onclick={() => {
                const path = prompt('Target param path (e.g. vj:layer:0:opacity):');
                if (path && path.trim()) oscStore.startLearn(path.trim());
              }}
              title="Wait for the next OSC message and bind it to a param path"
            >+ Learn binding</button>
          </div>
        </section>

        {/if}
        <!-- Keyboard control section — bind computer-keyboard keys to the
             same param paths MIDI/OSC use. Dispatched through midiRouter
             so every mappable param works. Source is discrete (key down/
             up), so each binding carries an action mode. -->
        {#if selectedSection === 'integrations:keyboard'}
        <section class="settings-section">
          <h3>Keyboard Control</h3>
          <p class="settings-hint" style="margin-bottom: 12px;">
            Map computer-keyboard keys to any control — the same param paths MIDI and OSC use (e.g. <code>vj:column:0</code>, <code>vj:layer:0:opacity</code>). Works with or without a controller plugged in.
          </p>

          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Enable Keyboard Control</span>
              <span class="label-hint">While on, mapped keys act as dedicated controls and are intercepted (they won't also trigger app shortcuts). Keys typed into text fields are ignored.</span>
            </div>
            <label class="toggle">
              <input
                type="checkbox"
                checked={$keyboardStore.enabled}
                onchange={(e) => keyboardStore.setEnabled((e.target as HTMLInputElement).checked)}
              />
              <span class="slider"></span>
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
              title={$keyboardStore.editMode ? 'Exit Keyboard Edit Mode' : 'Enter Keyboard Edit Mode, then click a control and press a key'}
            >{$keyboardStore.editMode ? 'Exit Keyboard Edit' : 'Keyboard Edit Mode'}</button>
            <span class="settings-hint keyboard-edit-hint">Click any highlighted control, then press a key to assign it.</span>
          </div>

          <h4 style="margin-top: 14px;">Bindings ({$keyboardStore.bindings.length})</h4>
          <p class="settings-hint" style="margin-bottom: 8px;">
            <strong>trigger</strong> fires on press (clips/columns/presets) · <strong>toggle</strong> flips min↔max · <strong>momentary</strong> = max while held, min on release · <strong>nudge</strong> steps by the step amount each press (use a negative step for a "down" key).
          </p>

          {#if $keyboardStore.bindings.length === 0}
            <div class="osc-empty">
              No keyboard bindings yet. Use <strong>Keyboard Edit Mode</strong>, click a highlighted control, then press the key you want to bind.
            </div>
          {:else}
            <div class="osc-bindings" style="grid-template-columns: 0.9fr 1.5fr 0.9fr 0.55fr 0.55fr 0.6fr 28px;">
              <div class="osc-binding-head" style="grid-template-columns: 0.9fr 1.5fr 0.9fr 0.55fr 0.55fr 0.6fr 28px;">
                <span>Key</span>
                <span>Param Path</span>
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
                    <option value="trigger">trigger</option>
                    <option value="toggle">toggle</option>
                    <option value="momentary">momentary</option>
                    <option value="nudge">nudge</option>
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
                  <option value="trigger">trigger</option>
                  <option value="toggle">toggle</option>
                  <option value="momentary">momentary</option>
                  <option value="nudge">nudge</option>
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
             output is downsampled to (ledCount × 1) and shipped as RGB
             bytes through the main-process socket. See
             src/lib/wled/sender.ts + electron/main.js → wled_send_frame. -->
        {#if selectedSection === 'integrations:wled'}
        <section class="settings-section">
          <h3>WLED LED Controllers</h3>
          <p class="settings-hint" style="margin-bottom: 12px;">
            Send the shader's output to WLED LED strips on your local network. Each controller taps the final composite and ships RGB pixels over UDP at ~60Hz. WLED's default port is 21324; max 490 LEDs per controller for the DRGB protocol.
          </p>

          {#if ($project.wledControllers ?? []).length === 0}
            <div class="osc-empty">
              No WLED controllers configured. Click <strong>+ Add controller</strong> to send shader pixels to a WLED device on your LAN.
            </div>
          {:else}
            <div class="osc-bindings" style="grid-template-columns: 1.4fr 1.4fr 0.8fr 0.8fr 1fr 1fr 0.6fr 36px;">
              <div class="osc-binding-head" style="grid-template-columns: 1.4fr 1.4fr 0.8fr 0.8fr 1fr 1fr 0.6fr 36px;">
                <span>Name</span>
                <span>IP Address</span>
                <span>Port</span>
                <span>LEDs</span>
                <span>Brightness</span>
                <span>Gamma</span>
                <span>On</span>
                <span></span>
              </div>
              {#each ($project.wledControllers ?? []) as c (c.id)}
                <div class="osc-binding-row" style="grid-template-columns: 1.4fr 1.4fr 0.8fr 0.8fr 1fr 1fr 0.6fr 36px;">
                  <input
                    type="text"
                    value={c.name}
                    onchange={(e) => project.updateWLEDController(c.id, { name: (e.target as HTMLInputElement).value })}
                    placeholder="Strip name"
                  />
                  <input
                    type="text"
                    value={c.ipAddr}
                    onchange={(e) => project.updateWLEDController(c.id, { ipAddr: (e.target as HTMLInputElement).value })}
                    placeholder="192.168.1.50"
                  />
                  <input
                    type="number" min="1" max="65535" step="1"
                    value={c.port}
                    onchange={(e) => project.updateWLEDController(c.id, { port: parseInt((e.target as HTMLInputElement).value) || 21324 })}
                  />
                  <input
                    type="number" min="1" max="490" step="1"
                    value={c.ledCount}
                    onchange={(e) => project.updateWLEDController(c.id, { ledCount: Math.max(1, Math.min(490, parseInt((e.target as HTMLInputElement).value) || 1)) })}
                  />
                  <input
                    type="number" min="0" max="1" step="0.05"
                    value={c.brightness ?? 1}
                    onchange={(e) => project.updateWLEDController(c.id, { brightness: Math.max(0, Math.min(1, parseFloat((e.target as HTMLInputElement).value))) })}
                  />
                  <input
                    type="number" min="0.5" max="3" step="0.1"
                    value={c.gamma ?? 1}
                    onchange={(e) => project.updateWLEDController(c.id, { gamma: Math.max(0.5, Math.min(3, parseFloat((e.target as HTMLInputElement).value))) })}
                  />
                  <label class="osc-inv">
                    <input
                      type="checkbox"
                      checked={c.enabled}
                      onchange={(e) => project.updateWLEDController(c.id, { enabled: (e.target as HTMLInputElement).checked })}
                    />
                  </label>
                  <button
                    class="osc-binding-del"
                    onclick={() => project.removeWLEDController(c.id)}
                    title="Remove controller"
                  >×</button>
                </div>
              {/each}
            </div>
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
              })}
            >+ Add controller</button>
          </div>
        </section>

        {/if}
        <!-- MediaPipe gesture input — runs Hand Landmarker + Gesture
             Recognizer in a worker, maps signals (palm position,
             pinch, canned gestures) to MIDI-style param paths via the
             shared midiRouter. -->
        {#if selectedSection === 'integrations:mediapipe'}
        <section class="settings-section">
          <h3>MediaPipe</h3>
          <p class="settings-hint" style="margin-bottom: 12px;">
            Use the webcam as a control input. Hand landmarks, pinch distance, palm position, and the canned MediaPipe gestures (open palm, fist, victory, thumb up/down, etc.) become signals that bind to any MIDI-mappable parameter through the same router OSC uses.
          </p>
          <MediaPipePanel />
        </section>
        {/if}
        <!-- AI Settings Section -->
        {#if selectedSection === 'ai'}
        <section class="settings-section">
          <h3>AI</h3>

          <!-- Shader AI Provider -->
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Shader AI Provider</span>
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
              <span class="label-text">Claude API Key
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
              <span class="label-text">Claude Model</span>
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
              <span class="label-text">Gemini API Key
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
              <span class="label-text">Gemini Model</span>
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
              <span class="label-text">Default Video Provider</span>
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
              <span class="label-text">Veo Model</span>
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
              <span class="label-text">Luma API Key
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
              <span class="label-text">Luma Model</span>
            </div>
            <select value={$settings.ai.lumaModel} onchange={(e) => settings.setLumaModel((e.target as HTMLSelectElement).value)}>
              {#each LUMA_MODELS as model}
                <option value={model.id}>{model.label}</option>
              {/each}
            </select>
          </div>

        </section>
        {/if}
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
                    Copy to Clipboard
                  </button>
                  <button class="text-btn" onclick={() => { clearErrorLog(); errorLog = []; }}>
                    Clear Log
                  </button>
                </div>
              {/if}
            </div>
          {/if}
        </div>

        <button class="text-btn" onclick={() => settings.reset()}>
          Reset to Defaults
        </button>
        <button class="primary-btn" onclick={onClose}>
          Done
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .settings-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200000;
    backdrop-filter: blur(4px);
  }

  .settings-panel {
    background: var(--bg-primary, #0d0d10);
    border: 1px solid #333;
    border-radius: 12px;
    width: 92%;
    max-width: 900px;  /* widened to fit sidebar + content */
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  }

  /* Body: sidebar + content side-by-side, content scrolls independently */
  .settings-body {
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .settings-sidebar {
    width: 200px;
    flex-shrink: 0;
    border-right: 1px solid #1f1f24;
    overflow-y: auto;
    padding: 12px 0 80px;  /* bottom padding leaves room for the toggle */
    background: #0a0a0d;
    position: relative;
  }

  .sidebar-category {
    padding: 14px 16px 4px;
    font-size: 11px;
    font-weight: 700;
    color: #555;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    user-select: none;
  }

  .sidebar-section {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    color: var(--text-secondary, #aaa);
    font-size: 14px;
    padding: 7px 16px 7px 24px;
    cursor: pointer;
    border-left: 2px solid transparent;
    transition: background 0.12s, color 0.12s;
  }

  .sidebar-section:hover {
    color: var(--text-primary, #e0e0e0);
    background: rgba(187, 134, 252, 0.04);
  }

  .sidebar-section.active {
    color: #BB86FC;
    background: rgba(187, 134, 252, 0.10);
    border-left-color: #BB86FC;
    padding-left: 22px;  /* compensate for 2px border */
    font-weight: 500;
  }

  .sidebar-adv-tag {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.08em;
    padding: 1px 4px;
    border-radius: 2px;
    background: rgba(245, 158, 11, 0.18);
    color: #f59e0b;
  }

  .sidebar-advanced-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
    font-size: 12px;
    color: var(--text-muted, #888);
    cursor: pointer;
    border-top: 1px solid #1f1f24;
    background: #0a0a0d;
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    user-select: none;
  }

  .sidebar-advanced-toggle:hover {
    color: var(--text-primary, #ccc);
  }

  .sidebar-advanced-toggle input[type="checkbox"] {
    accent-color: #BB86FC;
    cursor: pointer;
  }

  .settings-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 20px;
    border-bottom: 1px solid #333;
  }

  .settings-header h2 {
    margin: 0;
    font-size: 19px;
    font-weight: 600;
    color: var(--text-primary, #eee);
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--text-muted, #888);
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
  }

  .close-btn:hover {
    background: #333;
    color: var(--text-primary, #eee);
  }

  .settings-tabs {
    display: flex;
    padding: 0 20px;
    gap: 0;
    border-bottom: 1px solid #333;
  }

  .settings-tab {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-muted, #888);
    font-size: 14px;
    font-weight: 600;
    padding: 10px 16px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .settings-tab:hover {
    color: var(--text-primary, #ccc);
  }

  .settings-tab.active {
    color: #BB86FC;
    border-bottom-color: #BB86FC;
  }

  .tier-indicator {
    display: inline-block;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.05em;
    padding: 1px 5px;
    border-radius: 3px;
    color: #000;
    margin-left: 4px;
    vertical-align: middle;
  }

  /* Dev tier override box */
  .dev-tier-box {
    background: rgba(245, 158, 11, 0.06);
    border: 1px solid rgba(245, 158, 11, 0.3);
    border-radius: 8px;
    padding: 12px 14px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .dev-tier-header {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .dev-tier-label {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    padding: 2px 6px;
    border-radius: 3px;
    background: #f59e0b;
    color: #000;
  }

  .dev-tier-sublabel {
    font-size: 12px;
    color: #f59e0b;
    font-weight: 500;
  }

  .dev-tier-select {
    background: var(--bg-primary, #0d0d1a);
    border: 1px solid rgba(245, 158, 11, 0.3);
    border-radius: 6px;
    padding: 6px 10px;
    color: var(--text-primary, #e0e0e0);
    font-size: 13px;
    cursor: pointer;
    min-width: 200px;
  }

  .dev-tier-select:focus {
    outline: none;
    border-color: #f59e0b;
  }

  .pro-badge {
    display: inline-block;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.06em;
    padding: 2px 6px;
    border-radius: 3px;
    background: #f59e0b;
    color: #000;
    vertical-align: middle;
  }

  .locked-label {
    font-size: 17px;
    opacity: 0.5;
  }

  .pro-gate-notice {
    background: rgba(245, 158, 11, 0.08);
    border: 1px solid rgba(245, 158, 11, 0.2);
    border-radius: 6px;
    padding: 10px 12px;
    font-size: 13px;
    color: #999;
    line-height: 1.5;
  }

  .settings-content {
    flex: 1;
    overflow-y: auto;
    padding: 20px;
  }

  .settings-section {
    margin-bottom: 24px;
  }

  .settings-section:last-child {
    margin-bottom: 0;
  }

  .settings-section h3 {
    margin: 0 0 16px 0;
    font-size: 15px;
    font-weight: 600;
    color: #BB86FC;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .setting-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 0;
    border-bottom: 1px solid #161618;
  }

  .setting-row:last-of-type {
    border-bottom: none;
  }

  /* Sub-rows are nested controls under a parent toggle (e.g. cursor
     style/size when "Show Cursor" is on). Tighter padding + indent. */
  .setting-row.sub-row {
    padding: 6px 0 6px 14px;
    border-bottom: 1px solid #131315;
  }
  .setting-row.sub-row .label-text {
    font-size: 12px;
    color: var(--text-secondary, #aaa);
  }
  .setting-row.sub-row .label-hint {
    font-size: 11px;
    color: #666;
  }
  .setting-row.sub-row input[type="range"] {
    width: 140px;
    accent-color: #6df;
  }
  .setting-row.sub-row input[type="color"] {
    width: 32px;
    height: 24px;
    border: 1px solid #2a2a30;
    background: transparent;
    cursor: pointer;
    padding: 0;
  }
  .select-input {
    background: #1c1c20;
    color: var(--text-primary, #ddd);
    border: 1px solid #2a2a30;
    padding: 4px 8px;
    border-radius: 3px;
    font-size: 12px;
    cursor: pointer;
  }

  .setting-label {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }

  .label-text {
    font-size: 15px;
    color: var(--text-primary, #eee);
  }

  .label-hint {
    font-size: 13px;
    color: #666;
  }

  select {
    background: var(--bg-tertiary, #161618);
    border: 1px solid #444;
    border-radius: 6px;
    padding: 8px 12px;
    color: var(--text-primary, #eee);
    font-size: 14px;
    cursor: pointer;
    min-width: 180px;
  }

  select:hover {
    border-color: #555;
  }

  select:focus {
    outline: none;
    border-color: #BB86FC;
  }

  .text-input {
    background: var(--bg-tertiary, #161618);
    border: 1px solid #444;
    border-radius: 6px;
    padding: 8px 12px;
    color: var(--text-primary, #eee);
    font-size: 14px;
    min-width: 180px;
  }

  .text-input:hover {
    border-color: #555;
  }

  .text-input:focus {
    outline: none;
    border-color: #BB86FC;
  }

  select option:disabled {
    color: #666;
  }

  /* Updates section buttons */
  .btn-check-update {
    background: var(--bg-tertiary, #161618);
    border: 1px solid #444;
    border-radius: 6px;
    padding: 8px 14px;
    color: var(--text-primary, #ddd);
    font-size: 13px;
    cursor: pointer;
    white-space: nowrap;
  }
  .btn-check-update:hover:not(:disabled) {
    background: #1f1f23;
    border-color: #777;
    color: #fff;
  }
  .btn-check-update:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .btn-update-link {
    background: rgba(187, 134, 252, 0.12);
    border: 1px solid #BB86FC;
    border-radius: 6px;
    padding: 8px 14px;
    color: #BB86FC;
    font-size: 13px;
    text-decoration: none;
    white-space: nowrap;
  }
  .btn-update-link:hover {
    background: rgba(187, 134, 252, 0.24);
    color: #fff;
  }

  /* Toggle switch */
  /* ── OSC settings styles ── */
  .port-input {
    width: 90px;
    background: var(--bg-tertiary, #14141a);
    border: 1px solid #2a2a30;
    color: var(--text-primary, #ddd);
    border-radius: 4px;
    padding: 5px 8px;
    font-family: var(--ga-font-mono, 'IBM Plex Mono', ui-monospace, monospace);
    font-size: 13px;
  }
  .port-input:focus { border-color: #4cd1ff; outline: none; }
  .osc-status-dot {
    display: inline-block;
    width: 8px; height: 8px;
    border-radius: 50%;
    margin-right: 6px;
    vertical-align: middle;
  }
  .osc-status-dot.listening { background: #4ade80; box-shadow: 0 0 6px rgba(74,222,128,0.6); }
  .osc-status-dot.error     { background: #ff5252; }
  .osc-status-dot.idle      { background: #555; }
  .osc-last {
    font-family: var(--ga-font-mono, 'IBM Plex Mono', ui-monospace, monospace);
    color: #b6e8ff;
    font-size: 12px;
    background: rgba(76,209,255,0.06);
    padding: 1px 4px;
    border-radius: 3px;
  }
  .osc-learn-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 12px 0;
    padding: 8px 10px;
    background: rgba(255,214,102,0.08);
    border: 1px solid rgba(255,214,102,0.4);
    border-radius: 5px;
    color: #ffd166;
    font-size: 13px;
  }
  .osc-learn-pulse {
    width: 10px; height: 10px;
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
    background: transparent;
    border: 1px solid rgba(255,214,102,0.4);
    color: #ffd166;
    padding: 3px 10px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
  }
  .osc-learn-cancel:hover { background: rgba(255,214,102,0.15); color: #fff; }

  .osc-empty {
    padding: 16px;
    background: var(--bg-tertiary, #14141a);
    border: 1px dashed #2a2a30;
    border-radius: 5px;
    font-size: 13px;
    color: var(--text-muted, #888);
    text-align: center;
  }
  .osc-bindings {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .osc-binding-head, .osc-binding-row {
    display: grid;
    grid-template-columns: 2fr 2fr 60px 60px 32px 28px;
    gap: 6px;
    align-items: center;
  }
  .osc-binding-head {
    font-size: 10.5px;
    letter-spacing: 1px;
    color: #555;
    text-transform: uppercase;
    padding: 4px 4px;
  }
  .osc-binding-row input[type="text"], .osc-binding-row input[type="number"] {
    background: var(--bg-tertiary, #14141a);
    border: 1px solid #2a2a30;
    color: var(--text-primary, #ddd);
    border-radius: 3px;
    padding: 4px 6px;
    font-family: var(--ga-font-mono, 'IBM Plex Mono', ui-monospace, monospace);
    font-size: 12px;
    width: 100%;
  }
  .osc-binding-row input:focus { border-color: #4cd1ff; outline: none; }
  .osc-inv { display: flex; align-items: center; justify-content: center; cursor: pointer; }
  .osc-binding-del {
    background: transparent;
    border: 1px solid #2a2a30;
    color: var(--text-muted, #888);
    width: 24px; height: 24px;
    border-radius: 3px;
    cursor: pointer;
  }
  .osc-binding-del:hover { background: rgba(255,68,68,0.15); color: #ff8888; }
  .osc-add-row {
    display: flex;
    gap: 6px;
    margin-top: 10px;
  }
  .osc-add-btn {
    background: var(--bg-tertiary, #14141a);
    border: 1px solid #2a2a30;
    color: var(--text-primary, #ddd);
    padding: 5px 12px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
  }
  .osc-add-btn:hover { border-color: #4cd1ff; color: #4cd1ff; }
  .osc-add-btn.learn { border-color: rgba(255,214,102,0.5); color: #ffd166; }
  .osc-add-btn.learn:hover { background: rgba(255,214,102,0.1); color: #fff; }
  .osc-add-btn.learn.active {
    background: rgba(255,214,102,0.22);
    border-color: #ffd166;
    color: #fff;
    box-shadow: 0 0 12px rgba(255,214,102,0.22);
  }
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
    background: var(--bg-tertiary, #14141a);
    border: 1px solid #2a2a30;
    color: var(--text-primary, #ddd);
    height: 24px;
    padding: 0 8px;
    border-radius: 3px;
    cursor: pointer;
    font-family: var(--ga-font-mono, ui-monospace, monospace);
    font-size: 12px;
    font-weight: 600;
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
    border-color: #2a2a30;
    color: var(--text-primary, #ddd);
  }

  .toggle {
    position: relative;
    display: inline-block;
    width: 48px;
    height: 26px;
  }

  .toggle input {
    opacity: 0;
    width: 0;
    height: 0;
  }

  .toggle-slider {
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: #444;
    transition: 0.2s;
    border-radius: 26px;
  }

  .toggle-slider::before {
    position: absolute;
    content: "";
    height: 20px;
    width: 20px;
    left: 3px;
    bottom: 3px;
    background-color: var(--text-muted, #888);
    transition: 0.2s;
    border-radius: 50%;
  }

  .toggle input:checked + .toggle-slider {
    background-color: #BB86FC33;
  }

  .toggle input:checked + .toggle-slider::before {
    transform: translateX(22px);
    background-color: #BB86FC;
  }

  .button-group {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .secondary-btn {
    background: #333;
    border: 1px solid #444;
    border-radius: 6px;
    padding: 8px 14px;
    color: var(--text-primary, #eee);
    font-size: 14px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .secondary-btn:hover {
    background: #3a3a3a;
    border-color: #555;
  }

  .text-btn {
    background: none;
    border: none;
    color: var(--text-muted, #888);
    font-size: 14px;
    cursor: pointer;
    padding: 8px 12px;
    transition: color 0.15s;
  }

  .text-btn:hover {
    color: var(--text-primary, #eee);
  }

  .primary-btn {
    background: #BB86FC;
    border: none;
    border-radius: 6px;
    padding: 10px 20px;
    color: #000;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }

  .primary-btn:hover {
    background: #5dd3e3;
  }

  .info-box {
    display: flex;
    gap: 10px;
    padding: 12px;
    background: var(--bg-secondary, #111114);
    border-radius: 8px;
    margin-top: 12px;
  }

  .info-box svg {
    flex-shrink: 0;
    color: #BB86FC;
    margin-top: 2px;
  }

  .info-box p {
    margin: 0;
    font-size: 13px;
    color: var(--text-muted, #888);
    line-height: 1.5;
  }

  .info-box strong {
    color: var(--text-secondary, #aaa);
  }

  .settings-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 20px;
    border-top: 1px solid #333;
  }

  .custom-size-row {
    flex-wrap: wrap;
  }

  .custom-size-inputs {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .size-input {
    width: 72px;
    min-width: 72px;
    text-align: center;
  }

  .size-separator {
    color: var(--text-muted, #888);
    font-size: 14px;
  }

  /* Theme Template cards — bigger preview than the accent cards
     because they need to convey font + surface + accent at once. */
  .theme-template-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 14px;
    margin: 8px 0 24px;
  }
  .theme-template-card {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
    padding: 10px 10px 14px;
    background: var(--bg-tertiary, #161618);
    border: 2px solid transparent;
    border-radius: 10px;
    cursor: pointer;
    transition: all 0.18s;
    text-align: left;
  }
  .theme-template-card:hover { background: var(--bg-tertiary, #1a1a1e); border-color: #444; }
  .theme-template-card.active { background: var(--bg-tertiary, #1a1a1e); border-color: var(--accent-primary, #FF6B6B); }
  .theme-preview {
    width: 100%;
    height: 96px;
    border-radius: 8px;
    border: 1px solid;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .theme-bar {
    height: 18px;
    border-bottom: 1px solid;
  }
  .theme-body { flex: 1; display: flex; padding: 8px; }
  .theme-panel {
    flex: 1;
    border-radius: 6px;
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
  .theme-name { font-size: 15px; font-weight: 600; color: var(--text-primary, #fff); margin-top: 2px; }
  .theme-desc { font-size: 12px; color: var(--text-secondary, #888); line-height: 1.4; }

  /* Color Scheme Selector */
  .color-scheme-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
    margin-top: 8px;
  }

  .color-scheme-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 12px;
    background: var(--bg-tertiary, #161618);
    border: 2px solid transparent;
    border-radius: 10px;
    cursor: pointer;
    transition: all 0.2s;
  }

  .color-scheme-card:hover {
    background: var(--bg-tertiary, #1a1a1e);
    border-color: #444;
  }

  .color-scheme-card.active {
    border-color: var(--accent-primary, #FF6B6B);
    background: var(--bg-tertiary, #1a1a1e);
  }

  .scheme-preview {
    width: 100%;
    height: 48px;
    border-radius: 6px;
    border: 1px solid;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 8px;
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
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary, #eee);
  }

  .scheme-desc {
    font-size: 11px;
    color: #666;
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
    font-family: var(--ga-font-mono, 'IBM Plex Mono', ui-monospace, monospace);
    min-width: 120px;
  }

  .test-btn {
    padding: 8px 10px;
    white-space: nowrap;
  }

  .key-badge {
    display: inline-block;
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 4px;
    margin-left: 6px;
    text-transform: none;
    font-weight: 400;
  }

  .key-badge.valid {
    background: #22c55e33;
    color: #22c55e;
  }

  .key-badge.invalid {
    background: #ef444433;
    color: #ef4444;
  }

  .settings-link {
    color: #BB86FC;
    text-decoration: none;
  }

  .settings-link:hover {
    text-decoration: underline;
  }

  .ai-divider {
    height: 1px;
    background: #333;
    margin: 8px 0;
  }

  /* Rotation buttons */
  .rotation-buttons {
    display: flex;
    gap: 4px;
  }

  .rot-btn {
    background: var(--bg-tertiary, #161618);
    border: 1px solid #444;
    border-radius: 6px;
    padding: 6px 12px;
    color: var(--text-secondary, #aaa);
    font-size: 13px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .rot-btn:hover {
    border-color: #666;
    color: var(--text-primary, #eee);
  }

  .rot-btn.active {
    background: #BB86FC22;
    border-color: #BB86FC;
    color: #BB86FC;
  }

  /* Crop grid */
  .crop-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    padding: 8px 0 12px;
  }

  .crop-item {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .crop-label {
    font-size: 13px;
    color: var(--text-muted, #888);
    min-width: 16px;
    font-weight: 600;
  }

  .crop-item input[type="range"] {
    flex: 1;
    height: 4px;
    -webkit-appearance: none;
    background: #000000;
    border-radius: 2px;
    cursor: pointer;
  }

  .crop-item input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #BB86FC;
    cursor: pointer;
  }

  .crop-value {
    font-size: 12px;
    color: var(--text-muted, #888);
    min-width: 32px;
    text-align: right;
    font-family: var(--ga-font-mono, 'IBM Plex Mono', ui-monospace, monospace);
  }

  .crop-grid .secondary-btn {
    grid-column: 1 / -1;
    justify-self: start;
  }

  /* MIDI learn button */
  .midi-learn-btn.active {
    background: #BB86FC;
    color: #000;
    border-color: #BB86FC;
  }

  /* MIDI Clock running indicator — pulses when transport is active */
  .clock-status-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #444;
    transition: background 0.2s;
  }
  .clock-status-dot.on {
    background: #2ED573;
    box-shadow: 0 0 10px rgba(46, 213, 115, 0.55);
    animation: clockPulse 0.5s ease-in-out infinite;
  }
  @keyframes clockPulse {
    0%, 100% { opacity: 0.7; }
    50%      { opacity: 1; }
  }

  .section-toggle {
    background: none;
    border: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
    padding: 0;
  }

  .diagnostics {
    margin-top: 8px;
  }

  .error-log {
    max-height: 200px;
    overflow-y: auto;
    font-size: 12px;
    background: var(--bg-secondary, #1a1a2e);
    border-radius: 4px;
    padding: 6px;
    margin-top: 4px;
  }

  .error-entry {
    padding: 3px 0;
    border-bottom: 1px solid #ffffff10;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .error-time {
    color: var(--text-muted, #888);
    font-size: 11px;
  }

  .error-msg {
    color: #ff6b6b;
    word-break: break-word;
  }

  .error-source {
    color: #666;
    font-size: 11px;
  }

  .diag-actions {
    display: flex;
    gap: 8px;
    margin-top: 6px;
  }

  .section-hint {
    font-size: 12px;
    color: #666;
    margin: -4px 0 12px 0;
    line-height: 1.4;
  }

  /* ── Slice manager ───────────────────────────────────────────────────── */
  .slice-presets {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
    flex-wrap: wrap;
  }
  .slice-presets-label {
    font-size: 13px;
    color: var(--text-muted, #888);
  }

  .slice-card {
    background: #111116;
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 6px;
    margin-bottom: 6px;
    overflow: hidden;
    transition: border-color 0.15s;
  }
  .slice-card.expanded {
    border-color: rgba(187, 134, 252, 0.25);
  }

  .slice-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    cursor: pointer;
    user-select: none;
  }
  .slice-header:hover {
    background: rgba(255, 255, 255, 0.03);
  }

  .slice-toggle {
    flex-shrink: 0;
  }

  .slice-name {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary, #e0e0e0);
    min-width: 60px;
  }

  .slice-info {
    font-size: 12px;
    color: #666;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .slice-chevron {
    font-size: 13px;
    color: #666;
    flex-shrink: 0;
  }

  .slice-remove {
    background: none;
    border: none;
    color: #555;
    font-size: 19px;
    cursor: pointer;
    padding: 0 4px;
    line-height: 1;
    border-radius: 4px;
    flex-shrink: 0;
    transition: color 0.15s, background 0.15s;
  }
  .slice-remove:hover {
    color: #ff4757;
    background: rgba(255, 71, 87, 0.1);
  }

  .slice-body {
    padding: 8px 12px 14px;
    border-top: 1px solid rgba(255, 255, 255, 0.04);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .slice-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .slice-field-label {
    font-size: 12px;
    color: var(--text-muted, #888);
    min-width: 80px;
    font-weight: 600;
  }

  .slice-input {
    flex: 1;
    background: #0a0a0e;
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: var(--text-primary, #e0e0e0);
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 13px;
    font-family: var(--ga-font-mono, 'IBM Plex Mono', ui-monospace, monospace);
  }
  .slice-input:focus {
    border-color: rgba(187, 134, 252, 0.4);
    outline: none;
  }

  .slice-subsection {
    margin-top: 4px;
  }

  .slice-subsection-title {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #666;
    display: block;
    margin-bottom: 4px;
  }

  .add-slice-btn {
    margin-top: 8px;
  }

  .master-canvas-block {
    margin-bottom: 10px;
  }
  .master-canvas-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .master-canvas-row .slice-input.num {
    width: 80px;
  }
  .master-canvas-row .dim-x {
    color: #777;
    margin: 0 -4px;
    font-family: var(--ga-font-mono, 'IBM Plex Mono', ui-monospace, monospace);
  }
  .secondary-btn.small {
    padding: 2px 8px;
    font-size: 13px;
    line-height: 1.4;
  }

  .clear-slices-btn {
    margin-top: 4px;
    color: var(--text-muted, #888) !important;
    border-color: rgba(255, 255, 255, 0.06) !important;
  }

  .custom-res-inputs {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .custom-res-inputs span {
    color: var(--text-muted, #888);
    font-size: 13px;
  }
  .small-input {
    width: 70px !important;
  }

  /* Update banner */
  .update-banner {
    background: linear-gradient(135deg, rgba(168, 85, 247, 0.12), rgba(126, 200, 227, 0.08));
    border: 1px solid rgba(168, 85, 247, 0.3);
    border-radius: 6px;
    padding: 12px 14px;
    margin-bottom: 12px;
  }
  .update-banner-content {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
  }
  .update-badge {
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.1em;
    background: #a855f7;
    color: #fff;
    padding: 2px 6px;
    border-radius: 3px;
  }
  .update-text {
    font-size: 13px;
    color: var(--text-primary, #e0e0e0);
  }
  .update-current {
    font-size: 12px;
    color: var(--text-muted, #666);
  }
  .update-links {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .update-link {
    font-size: 12px;
    font-weight: 600;
    padding: 4px 10px;
    background: rgba(168, 85, 247, 0.15);
    border: 1px solid rgba(168, 85, 247, 0.3);
    color: #a855f7;
    border-radius: 3px;
    text-decoration: none;
    transition: all 0.15s;
  }
  .update-link:hover {
    background: rgba(168, 85, 247, 0.25);
  }
  .update-link-notes {
    font-size: 12px;
    color: var(--text-secondary, #888);
    text-decoration: none;
    padding: 4px 8px;
  }
  .update-link-notes:hover {
    color: var(--text-primary, #e0e0e0);
    text-decoration: underline;
  }
  .update-cta-btn {
    font-size: 13px;
    font-weight: 600;
    padding: 6px 14px;
    background: linear-gradient(90deg, #FF8577, #7EC8E3);
    border: none;
    color: #0a0a0a;
    border-radius: 4px;
    cursor: pointer;
    transition: filter 0.15s, transform 0.15s;
  }
  .update-cta-btn:hover {
    filter: brightness(1.1);
    transform: translateY(-1px);
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
    border-radius: 4px;
  }
  .gpu-restart-text {
    flex: 1;
    color: #e6c66a;
    font-size: 13px;
    line-height: 1.45;
  }
  .gpu-restart-text strong {
    color: #fbbf24;
  }
</style>
