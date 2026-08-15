<script lang="ts">
  /**
   * Offline render-to-video modal.
   *
   * Settings form (duration / fps / resolution preset / quality /
   * filename) → start button. While rendering, a progress bar and
   * cancel button replace the form. On completion, a preview link +
   * Done button.
   */

  import { offlineRender, revealOutputPath, DEFAULT_OFFLINE_SETTINGS, type OfflineRenderSettings } from '../recording/offlineRender';
  import { isDesktopApp } from '../bridge';
  import { getNativeRendererCapabilities } from '../api/native-renderer';
  import { project } from '../stores/layers';
  import { audioStore } from '../stores/audio';
  import { isAudioDrivenMod, modulationStore } from '../audio/modulation';

  export let isOpen = false;
  export let onClose: () => void = () => {};

  // Settings start at defaults, but seed width/height from the current
  // project so users land on a sensible matching resolution.
  let settings: OfflineRenderSettings = { ...DEFAULT_OFFLINE_SETTINGS };
  let seededForOpen = false;
  let captureBackendTouched = false;
  // The native shell has no WebGL engine — that backend reads the live
  // compositor canvas, which does not exist there.
  $: webglCaptureAvailable = !!offlineRender.getEngine();
  let nativeProbeStartedForOpen = false;
  let nativeFrameCaptureAvailable = false;
  let nativeFrameCaptureMessage = 'Desktop only';
  let nativeProbeGeneration = 0;

  function seedSettingsFromProject() {
    settings = {
      ...DEFAULT_OFFLINE_SETTINGS,
      width: $project.width || 1920,
      height: $project.height || 1080,
    };
    captureBackendTouched = false;
  }
  $: if (isOpen && !seededForOpen) {
    seedSettingsFromProject();
    seededForOpen = true;
  }
  $: if (!isOpen && seededForOpen) {
    seededForOpen = false;
    nativeProbeStartedForOpen = false;
    nativeFrameCaptureAvailable = false;
    nativeFrameCaptureMessage = 'Desktop only';
    nativeProbeGeneration += 1;
  }
  $: if (isOpen && !nativeProbeStartedForOpen) {
    nativeProbeStartedForOpen = true;
    refreshNativeFrameCaptureAvailability();
  }

  const RESOLUTION_PRESETS = [
    { label: 'Project size',  fn: () => ({ w: $project.width || 1920, h: $project.height || 1080 }) },
    { label: '720p (HD)',     fn: () => ({ w: 1280, h: 720 }) },
    { label: '1080p (FHD)',   fn: () => ({ w: 1920, h: 1080 }) },
    { label: '1440p (2K)',    fn: () => ({ w: 2560, h: 1440 }) },
    { label: '2160p (4K)',    fn: () => ({ w: 3840, h: 2160 }) },
    { label: 'Square 1080',   fn: () => ({ w: 1080, h: 1080 }) },
    { label: 'Vertical 1080', fn: () => ({ w: 1080, h: 1920 }) },
  ];
  const FPS_PRESETS = [24, 30, 60];

  $: state = $offlineRender;
  $: isFrameOutput = settings.outputMode === 'frames';
  $: isRunning = state.status !== 'idle' && state.status !== 'complete' && state.status !== 'cancelled' && state.status !== 'error';
  // Capture and encode report progress from different counters.
  $: progressPct =
    state.status === 'encoding'
      ? Math.round(state.encodeProgress * 100)
      : state.totalFrames > 0
        ? Math.round((state.currentFrame / state.totalFrames) * 100)
        : 0;
  $: elapsedSec = state.startedAtMs > 0
    ? Math.floor((performance.now() - state.startedAtMs) / 1000)
    : 0;
  $: estimatedTotalSec = state.totalFrames > 0 && state.currentFrame > 0
    ? Math.round((elapsedSec / state.currentFrame) * state.totalFrames)
    : 0;
  $: remainingSec = Math.max(0, estimatedTotalSec - elapsedSec);

  function fmtTime(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function start() {
    offlineRender.start({
      ...settings,
      captureBackend: (settings.captureBackend === 'native' && nativeFrameCaptureAvailable) || !webglCaptureAvailable
        ? 'native'
        : 'webgl',
    });
  }
  function cancel() {
    offlineRender.cancel();
  }
  // Esc closes when the modal is open AND we're not actively
  // rendering — matches every other modal's behaviour and keeps
  // keyboard-driven flows fast.
  function onKey(e: KeyboardEvent) {
    if (!isOpen) return;
    if (e.key === 'Escape' && !isRunning) closeAndReset();
  }

  function closeAndReset() {
    offlineRender.reset();
    onClose();
  }

  // Where the finished file actually is. The save dialog's destination
  // wins when the user picked one; otherwise it is still sitting in the
  // app's generated-video folder and the user needs to see that path.
  $: outputLocation = state.lastOutputSavedPath ?? state.lastOutputPath ?? null;
  $: canReveal = isDesktopApp && !!outputLocation;
  function reveal() {
    if (outputLocation) void revealOutputPath(outputLocation);
  }

  function onOutputModeChange() {
    captureBackendTouched = false;
    settings = {
      ...settings,
      captureBackend: nativeFrameCaptureAvailable || !webglCaptureAvailable ? 'native' : 'webgl',
    };
  }

  function selectCaptureBackend(captureBackend: 'webgl' | 'native') {
    if (captureBackend === 'native' && !nativeFrameCaptureAvailable) return;
    if (captureBackend === 'webgl' && !webglCaptureAvailable) return;
    captureBackendTouched = true;
    settings = { ...settings, captureBackend };
  }

  async function refreshNativeFrameCaptureAvailability() {
    const generation = ++nativeProbeGeneration;
    nativeFrameCaptureAvailable = false;
    nativeFrameCaptureMessage = 'Checking...';
    const hasDesktopBridge = isDesktopApp || (typeof window !== 'undefined' && !!window.__ELECTRON__);
    if (!hasDesktopBridge) {
      nativeFrameCaptureMessage = 'Desktop only';
      return;
    }
    try {
      const caps = await getNativeRendererCapabilities();
      if (generation !== nativeProbeGeneration) return;
      const available = !!caps?.features?.frame_snapshot_export
        && !!caps?.features?.native_frame_sequence_export
        && !!caps?.implemented_methods?.includes('export_frame_snapshot');
      nativeFrameCaptureAvailable = available;
      nativeFrameCaptureMessage = available ? 'Ready' : 'Not available';
      if (!captureBackendTouched) {
        settings = { ...settings, captureBackend: available || !webglCaptureAvailable ? 'native' : 'webgl' };
      } else if (!available && settings.captureBackend === 'native' && webglCaptureAvailable) {
        settings = { ...settings, captureBackend: 'webgl' };
      }
    } catch (err) {
      if (generation !== nativeProbeGeneration) return;
      nativeFrameCaptureAvailable = false;
      nativeFrameCaptureMessage = err instanceof Error && err.message ? err.message : 'Not available';
      if (settings.captureBackend === 'native' && webglCaptureAvailable) {
        settings = { ...settings, captureBackend: 'webgl' };
      }
    }
  }

  // Re-render the elapsed/remaining estimate periodically while
  // the render runs — the store doesn't re-publish on a timer so
  // we tick here for the display.
  let _tickInterval: ReturnType<typeof setInterval> | null = null;
  $: if (isRunning && _tickInterval === null) {
    _tickInterval = setInterval(() => {
      // Touch a reactive var so the elapsed/remaining derivations re-evaluate.
      _tickPulse = (_tickPulse + 1) % 1000;
    }, 250);
  }
  $: if (!isRunning && _tickInterval !== null) {
    clearInterval(_tickInterval);
    _tickInterval = null;
  }
  let _tickPulse = 0;
  // Reference _tickPulse so Svelte re-runs the elapsed derivations.
  $: void _tickPulse;

  // ─── Live audio input warning ──────────────────────────────────────
  //
  // The render loop pins every clock it owns to the export's virtual
  // timeline — including the visual-audio follower, so envelopes and LFOs
  // always advance by exactly 1/fps per frame. What it CANNOT pin is the
  // content of a live stream: a microphone or a system-audio capture only
  // exists in the present, so frame N of the export sees whatever was
  // playing when frame N happened to be captured, not what was playing
  // N/fps seconds in. A file source is decoded and analysed at virtual
  // time, so it comes out frame-accurate.
  //
  // Non-blocking on purpose — plenty of renders with a mic open aren't
  // actually driving anything off it, and a user who wants the take
  // should get the take.
  $: liveAudioInput = $audioStore.isActive
    && ($audioStore.inputType === 'microphone' || $audioStore.inputType === 'system');
  $: liveAudioInputLabel = $audioStore.inputType === 'system' ? 'System audio' : 'Microphone';
  // Audio-reactive content is either an explicit modulation assignment
  // fed by the analyser, or a visible layer whose renderer samples the
  // audio snapshot every frame (lines / light painting / splat / 3D model
  // / GPU instruments / pixel FX all do, unconditionally).
  $: hasAudioModulation = [...$modulationStore.values()].some(isAudioDrivenMod);
  $: hasAudioReactiveLayer = ($project.layers ?? []).some(layer => layer.visible && (
    !!layer.linesContent
    || !!layer.lightPaintingContent
    || !!layer.advLightPaintingContent
    || !!layer.splatContent
    || !!layer.model3dContent
    || !!layer.gpuLayerContent
    || !!layer.pixelFXContent
  ));
  $: showLiveAudioWarning = liveAudioInput && (hasAudioModulation || hasAudioReactiveLayer);
</script>

<!-- svelte:window must live at component root, not inside {#if}.
     The handler itself short-circuits when the modal is closed. -->
<svelte:window onkeydown={onKey} />

{#if isOpen}
<div class="modal-backdrop" onclick={closeAndReset} role="presentation"></div>
<div class="modal-shell" role="dialog" aria-label="Render to video">
  <header class="modal-head">
    <h2>Render to Video</h2>
    <button class="close-btn" onclick={closeAndReset} disabled={isRunning} title={isRunning ? 'Cancel before closing' : 'Close'}>×</button>
  </header>

  {#if state.status === 'complete' && state.lastOutputKind === 'frames'}
    <!-- Success state — frame sequence folder. -->
    <div class="modal-body success">
      <div class="success-icon">✓</div>
      <h3>Frames exported</h3>
      <p class="success-meta">{state.lastOutputName ?? 'render'}_%06d.jpg · {state.totalFrames} frames · {fmtTime(elapsedSec)}</p>
      {#if state.lastOutputPath}
        <p class="success-hint">Saved to</p>
        <p class="output-path" title={state.lastOutputPath}>{state.lastOutputPath}</p>
      {/if}
      <p class="success-hint">A manifest with an FFmpeg compile command was written beside the frames.</p>
      <div class="actions">
        {#if canReveal}
          <button class="btn-secondary" onclick={reveal}>Show in Finder</button>
        {/if}
        <button class="btn-primary" onclick={closeAndReset}>Done</button>
      </div>
    </div>

  {:else if state.status === 'complete' && state.lastOutputUrl}
    <!-- Success state — preview thumbnail + actions. -->
    <div class="modal-body success">
      <div class="success-icon">✓</div>
      <h3>Render complete</h3>
      <p class="success-meta">{state.lastOutputName ?? 'render'}.mp4 · {state.totalFrames} frames · {fmtTime(elapsedSec)}</p>
      <video class="preview" src={state.lastOutputUrl} controls muted loop></video>
      {#if state.lastOutputSavedPath}
        <p class="success-hint">Saved to</p>
        <p class="output-path" title={state.lastOutputSavedPath}>{state.lastOutputSavedPath}</p>
      {:else if state.lastOutputPath}
        <p class="success-hint">Added to the media library. Kept at</p>
        <p class="output-path" title={state.lastOutputPath}>{state.lastOutputPath}</p>
      {:else}
        <p class="success-hint">Added to media library + downloaded.</p>
      {/if}
      <div class="actions">
        {#if canReveal}
          <button class="btn-secondary" onclick={reveal}>Show in Finder</button>
        {/if}
        <button class="btn-primary" onclick={closeAndReset}>Done</button>
      </div>
    </div>

  {:else if isRunning}
    <!-- Progress state — bar + phase + cancel. -->
    <div class="modal-body progress">
      <div class="phase">
        {#if state.status === 'choosing-folder'}
          Choose an output folder…
        {:else if state.status === 'loading-ffmpeg'}
          Loading FFmpeg encoder…
        {:else if state.status === 'rendering'}
          {isFrameOutput ? 'Writing' : 'Rendering'} frame {state.currentFrame} / {state.totalFrames}
        {:else if state.status === 'encoding'}
          Encoding to MP4…
        {:else if state.status === 'saving'}
          {isFrameOutput ? 'Finalizing frame sequence…' : 'Saving — choose where to keep your video…'}
        {/if}
      </div>
      <div class="progress-bar">
        <div class="progress-fill" style="width: {progressPct}%"></div>
      </div>
      <div class="progress-meta">
        <span>{progressPct}%</span>
        <span>
          {fmtTime(elapsedSec)} elapsed
          {#if remainingSec > 0 && state.status === 'rendering'}
            · ~{fmtTime(remainingSec)} remaining
          {/if}
        </span>
      </div>
      <div class="actions">
        <button class="btn-secondary" onclick={cancel}>Cancel</button>
      </div>
    </div>

  {:else if state.status === 'cancelled' || state.status === 'error'}
    <!-- Error / cancelled state. -->
    <div class="modal-body error">
      <div class="error-icon">{state.status === 'error' ? '!' : '×'}</div>
      <h3>{state.status === 'error' ? 'Render failed' : 'Render cancelled'}</h3>
      {#if state.errorMessage}
        <p class="error-msg">{state.errorMessage}</p>
      {/if}
      <div class="actions">
        <button class="btn-secondary" onclick={() => offlineRender.reset()}>Back to settings</button>
        <button class="btn-primary" onclick={closeAndReset}>Close</button>
      </div>
    </div>

  {:else}
    <!-- Settings form. -->
    <div class="modal-body">
      <div class="field">
        <label>Filename</label>
        <input type="text" bind:value={settings.filename} placeholder="render" />
      </div>

      <div class="row">
        <div class="field">
          <label>Duration (seconds)</label>
          <input type="number" min="0.5" max="3600" step="0.5" bind:value={settings.durationSeconds} />
        </div>
        <div class="field">
          <label>Frame rate</label>
          <select bind:value={settings.fps}>
            {#each FPS_PRESETS as fps}
              <option value={fps}>{fps} fps</option>
            {/each}
          </select>
        </div>
      </div>

      <div class="field">
        <label>Resolution</label>
        <div class="preset-grid">
          {#each RESOLUTION_PRESETS as preset}
            {@const p = preset.fn()}
            {@const active = settings.width === p.w && settings.height === p.h}
            <button
              class="preset-btn"
              class:active
              onclick={() => { settings.width = p.w; settings.height = p.h; }}
            >
              <span class="preset-label">{preset.label}</span>
              <span class="preset-dims">{p.w}×{p.h}</span>
            </button>
          {/each}
        </div>
        <div class="row tight">
          <div class="field small">
            <label>Width</label>
            <input type="number" min="64" max="7680" step="2" bind:value={settings.width} />
          </div>
          <div class="field small">
            <label>Height</label>
            <input type="number" min="64" max="4320" step="2" bind:value={settings.height} />
          </div>
        </div>
      </div>

      <div class="field">
        <label>Output</label>
        <select bind:value={settings.outputMode} onchange={onOutputModeChange}>
          <option value="mp4">MP4 video</option>
          <option value="frames">JPEG frame sequence</option>
        </select>
      </div>

      <div class="field">
        <label>Renderer</label>
        <div class="engine-grid">
          <button
            type="button"
            class="engine-btn"
            class:active={settings.captureBackend !== 'native'}
            disabled={!webglCaptureAvailable}
            onclick={() => selectCaptureBackend('webgl')}
            title={webglCaptureAvailable ? 'Live WebGL compositor' : 'Not available — this build renders natively'}
          >
            <span class="engine-title">WebGL</span>
            <span class="engine-meta">{webglCaptureAvailable ? 'Current compositor' : 'Not in this build'}</span>
          </button>
          <button
            type="button"
            class="engine-btn"
            class:active={settings.captureBackend === 'native'}
            disabled={!nativeFrameCaptureAvailable}
            onclick={() => selectCaptureBackend('native')}
            title={nativeFrameCaptureAvailable ? 'Native Renderer' : nativeFrameCaptureMessage}
          >
            <span class="engine-title">Native Renderer</span>
            <span class="engine-meta">{nativeFrameCaptureMessage}</span>
          </button>
        </div>
      </div>

      <div class="field">
        <label>{isFrameOutput ? 'Compile quality preset' : 'Quality'}</label>
        <select bind:value={settings.quality}>
          <option value="web">Web (smaller file, CRF 23)</option>
          <option value="high">High (recommended, CRF 18)</option>
          <option value="archive">Archive (near-lossless, CRF 14, slow)</option>
        </select>
      </div>

      <div class="summary">
        {#if isFrameOutput}
          Will write <strong>{Math.round(settings.durationSeconds * settings.fps)}</strong> JPEG frames at
          <strong>{settings.width}×{settings.height}</strong> with
          <strong>{settings.captureBackend === 'native' ? 'Native Renderer' : 'WebGL'}</strong>.
        {:else}
          Will produce <strong>{Math.round(settings.durationSeconds * settings.fps)}</strong> frames at
          <strong>{settings.width}×{settings.height}</strong> with
          <strong>{settings.captureBackend === 'native' ? 'Native Renderer' : 'WebGL'}</strong>.
        {/if}
      </div>

      {#if showLiveAudioWarning}
        <div class="warn-note" role="status">
          <span class="warn-icon">!</span>
          <span>
            <strong>{liveAudioInputLabel} input can't be time-locked to an offline render.</strong>
            Reactive timing will follow real elapsed time, so the audio in the exported clip
            won't line up with the visuals if the render runs slower than real time.
            Use a file audio source for frame-accurate audio reactivity.
          </span>
        </div>
      {/if}

      <div class="actions">
        <button class="btn-secondary" onclick={closeAndReset}>Cancel</button>
        <button class="btn-primary" onclick={start} disabled={!settings.durationSeconds || !settings.fps}>
          Start Render
        </button>
      </div>
    </div>
  {/if}
</div>
{/if}

<style>
  .modal-backdrop {
    position: fixed; inset: 0;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(4px);
    z-index: 1100;
  }
  .modal-shell {
    position: fixed;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    width: 560px;
    max-width: calc(100vw - 40px);
    max-height: calc(100vh - 80px);
    background: var(--bg-primary, #0a0a0c);
    border: 1px solid #2a2a30;
    border-radius: 10px;
    box-shadow: 0 16px 60px rgba(0, 0, 0, 0.6);
    z-index: 1101;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    background: linear-gradient(180deg, #14141a, #0d0d11);
    border-bottom: 1px solid #1d1d22;
  }
  .modal-head h2 {
    margin: 0;
    font-size: 15px;
    letter-spacing: 2px;
    color: #4cd1ff;
    font-weight: 600;
  }
  .close-btn {
    /* 32×32 satisfies the 32px tap-target accessibility floor. */
    width: 32px; height: 32px;
    border: 1px solid var(--border-secondary, #2a2a30);
    background: transparent;
    color: var(--text-secondary, #aaa);
    border-radius: 4px;
    font-size: 19px;
    line-height: 1;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .close-btn:hover:not(:disabled) { background: rgba(255,255,255,0.06); color: #fff; }
  .close-btn:disabled { opacity: 0.3; cursor: not-allowed; }

  .modal-body {
    padding: 18px;
    overflow-y: auto;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 5px;
    margin-bottom: 14px;
  }
  .field.small { flex: 1; }
  .field label {
    font-size: 11px;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--text-muted, #888);
  }
  .field input,
  .field select {
    background: var(--bg-tertiary, #14141a);
    border: 1px solid #2a2a30;
    color: var(--text-primary, #ddd);
    border-radius: 4px;
    padding: 7px 10px;
    font-size: 13px;
    font-family: inherit;
  }
  .field input:focus,
  .field select:focus {
    border-color: #4cd1ff;
    outline: none;
  }
  .row { display: flex; gap: 10px; }
  .row.tight { gap: 6px; margin-top: 6px; }
  .preset-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 5px;
    margin-bottom: 4px;
  }
  .preset-btn {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    padding: 7px 10px;
    background: var(--bg-tertiary, #14141a);
    border: 1px solid #2a2a30;
    border-radius: 4px;
    color: var(--text-secondary, #aaa);
    cursor: pointer;
    text-align: left;
  }
  .preset-btn:hover {
    background: #1c1c22;
    border-color: #4cd1ff;
    color: #fff;
  }
  .preset-btn.active {
    background: rgba(76, 209, 255, 0.12);
    border-color: #4cd1ff;
    color: #4cd1ff;
  }
  .preset-label { font-size: 12px; font-weight: 500; }
  .preset-dims { font-size: 11px; font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace); color: #666; }
  .preset-btn.active .preset-dims { color: #4cd1ff; }

  .engine-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }
  .engine-btn {
    min-height: 54px;
    padding: 9px 10px;
    background: var(--bg-tertiary, #14141a);
    border: 1px solid #2a2a30;
    border-radius: 5px;
    color: var(--text-secondary, #aaa);
    cursor: pointer;
    text-align: left;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 3px;
  }
  .engine-btn:hover:not(:disabled) {
    background: #1c1c22;
    border-color: #4cd1ff;
    color: #fff;
  }
  .engine-btn.active {
    background: rgba(76, 209, 255, 0.12);
    border-color: #4cd1ff;
    color: #4cd1ff;
  }
  .engine-btn:disabled {
    cursor: not-allowed;
    opacity: 0.52;
  }
  .engine-title {
    font-size: 12px;
    font-weight: 650;
  }
  .engine-meta {
    font-size: 11px;
    color: #777;
    line-height: 1.25;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }
  .engine-btn.active .engine-meta { color: rgba(76, 209, 255, 0.82); }

  .summary {
    background: rgba(76, 209, 255, 0.05);
    border-left: 2px solid rgba(76, 209, 255, 0.4);
    padding: 8px 12px;
    border-radius: 0 4px 4px 0;
    font-size: 12px;
    color: var(--text-secondary, #aaa);
    line-height: 1.5;
    margin-bottom: 14px;
  }
  .summary strong { color: #4cd1ff; }

  .warn-note {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    background: rgba(255, 176, 32, 0.06);
    border-left: 2px solid rgba(255, 176, 32, 0.55);
    padding: 8px 12px;
    border-radius: 0 4px 4px 0;
    font-size: 12px;
    color: var(--text-secondary, #aaa);
    line-height: 1.5;
    margin-bottom: 14px;
  }
  .warn-note strong {
    color: #ffb020;
    font-weight: 600;
  }
  .warn-icon {
    flex: 0 0 auto;
    width: 16px;
    height: 16px;
    margin-top: 1px;
    border-radius: 50%;
    background: rgba(255, 176, 32, 0.18);
    color: #ffb020;
    font-size: 11px;
    font-weight: 700;
    line-height: 16px;
    text-align: center;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 18px;
  }
  .btn-primary,
  .btn-secondary {
    padding: 8px 18px;
    border-radius: 5px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }
  .btn-primary {
    background: linear-gradient(135deg, #4cd1ff, #6f5cff);
    color: #fff;
    border: none;
  }
  .btn-primary:hover:not(:disabled) {
    background: linear-gradient(135deg, #80dfff, #8a7aff);
  }
  .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn-secondary {
    background: transparent;
    border: 1px solid #2a2a30;
    color: var(--text-secondary, #aaa);
  }
  .btn-secondary:hover {
    border-color: #4cd1ff;
    color: #4cd1ff;
  }

  /* Progress + states */
  .progress .phase {
    font-size: 14px;
    color: #4cd1ff;
    margin-bottom: 8px;
    font-weight: 500;
    letter-spacing: 0.3px;
  }
  .progress-bar {
    height: 10px;
    background: var(--bg-tertiary, #14141a);
    border-radius: 5px;
    overflow: hidden;
    border: 1px solid #1d1d22;
  }
  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #4cd1ff, #6f5cff);
    transition: width 0.15s ease-out;
  }
  .progress-meta {
    display: flex;
    justify-content: space-between;
    margin-top: 6px;
    font-size: 12px;
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    color: var(--text-muted, #888);
  }
  .success { text-align: center; }
  .success-icon {
    width: 56px; height: 56px;
    background: rgba(76, 222, 128, 0.15);
    color: #4ade80;
    border: 1px solid #4ade80;
    border-radius: 50%;
    font-size: 29px;
    line-height: 56px;
    margin: 6px auto 12px;
  }
  .success h3 { margin: 0 0 4px; color: var(--text-primary, #ddd); font-size: 17px; }
  .success-meta { color: var(--text-muted, #888); font-size: 12px; font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace); margin: 0 0 12px; }
  .preview {
    width: 100%;
    max-height: 280px;
    border-radius: 5px;
    background: #000;
    margin-bottom: 8px;
  }
  .success-hint { color: #4ade80; font-size: 12px; margin: 8px 0 0; }
  /* The full path matters more than tidiness here — a user who dismissed
     the save dialog has no other way to find the file. Wrap, don't clip. */
  .output-path {
    margin: 4px 0 0;
    font-size: 11px;
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    color: var(--text-muted, #888);
    word-break: break-all;
    line-height: 1.4;
    user-select: text;
  }

  .error { text-align: center; }
  .error-icon {
    width: 56px; height: 56px;
    background: rgba(255, 80, 80, 0.15);
    color: #ff5252;
    border: 1px solid #ff5252;
    border-radius: 50%;
    font-size: 29px;
    line-height: 56px;
    margin: 6px auto 12px;
    font-weight: 700;
  }
  .error h3 { margin: 0 0 8px; color: var(--text-primary, #ddd); font-size: 17px; }
  .error-msg { color: #ff8888; font-size: 13px; font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace); word-break: break-word; }
</style>
