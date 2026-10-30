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
  import { isDesktopApp, invoke } from '../bridge';
  import { mergeRecordingCodecAvailability, type RecordingCodecOption } from '../recording/recordingSources';
  import { getNativeRendererCapabilities } from '../api/native-renderer';
  import { project } from '../stores/layers';
  import { showTimeline } from '../stores/showTimeline';
  import { audioInputType, audioIsActive } from '../stores/audio';
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
  // Render to Video writes the opaque program output, so only the codecs
  // without alpha are offered (H.264, ProRes 422 HQ, HAP).
  let offlineCodecs: RecordingCodecOption[] = mergeRecordingCodecAvailability(null).filter(codec => !codec.alpha);
  if (isDesktopApp) {
    void invoke<{ codecs?: Array<{ id: string; available?: boolean; reason?: string }> }>('native_recording_codecs')
      .then((result) => { offlineCodecs = mergeRecordingCodecAvailability(result?.codecs ?? null).filter(codec => !codec.alpha); })
      .catch(() => {});
  }

  // A programmed show already knows how long it is — seed the duration
  // from it so "render my show" is one click. Falls back to the default
  // when the show timeline is empty.
  $: showDuration = $showTimeline.duration;
  $: showIsProgrammed = showDuration > 0
    && ($showTimeline.presetClips.length > 0 || $showTimeline.audioTracks.length > 0);

  function seedSettingsFromProject() {
    settings = {
      ...DEFAULT_OFFLINE_SETTINGS,
      width: $project.width || 1920,
      height: $project.height || 1080,
      ...(showIsProgrammed
        ? { durationSeconds: Math.max(0.5, Math.round(showDuration * 100) / 100) }
        : {}),
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
  $: liveAudioInput = $audioIsActive
    && ($audioInputType === 'microphone' || $audioInputType === 'system');
  $: liveAudioInputLabel = $audioInputType === 'system' ? 'System audio' : 'Microphone';
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
  // A show with audio drives the render's reactivity from its own tracks,
  // at render time, whatever input is live.
  $: showHasAudio = $showTimeline.audioTracks.some(t => !t.muted && t.volume > 0 && !!t.url);
  $: showLiveAudioWarning = liveAudioInput && !showHasAudio && (hasAudioModulation || hasAudioReactiveLayer);
</script>

<!-- svelte:window must live at component root, not inside {#if}.
     The handler itself short-circuits when the modal is closed. -->
<svelte:window onkeydown={onKey} />

{#if isOpen}
<div data-help-page="frame-locked-export" class="modal-backdrop" onclick={closeAndReset} role="presentation"></div>
<div data-help-page="frame-locked-export" class="modal-shell" role="dialog" aria-label="Render to video">
  <header class="modal-head">
    <h2>Render to video</h2>
    <button class="close-btn" onclick={closeAndReset} disabled={isRunning} title={isRunning ? 'Cancel before closing' : 'Close'} aria-label="Close"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg></button>
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
          <button class="btn-secondary secondary-btn" onclick={reveal}>Show in Finder</button>
        {/if}
        <button class="btn-primary primary-btn" onclick={closeAndReset}>Done</button>
      </div>
    </div>

  {:else if state.status === 'complete' && state.lastOutputUrl}
    <!-- Success state — preview thumbnail + actions. -->
    <div class="modal-body success">
      <div class="success-icon">✓</div>
      <h3>Render complete</h3>
      <p class="success-meta">{state.lastOutputName ?? 'render'}.mp4 · {state.totalFrames} frames · {fmtTime(elapsedSec)}</p>
      <video class="preview" src={state.lastOutputUrl} controls muted loop></video>
      {#if state.lastOutputAudioNote}
        <p class="success-hint">{state.lastOutputAudioNote}</p>
      {/if}
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
          <button class="btn-secondary secondary-btn" onclick={reveal}>Show in Finder</button>
        {/if}
        <button class="btn-primary primary-btn" onclick={closeAndReset}>Done</button>
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
        <button class="btn-secondary secondary-btn" onclick={cancel}>Cancel</button>
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
        <button class="btn-secondary secondary-btn" onclick={() => offlineRender.reset()}>Back to settings</button>
        <button class="btn-primary primary-btn" onclick={closeAndReset}>Close</button>
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
          {#if showIsProgrammed}
            <button
              class="show-length-btn"
              type="button"
              onclick={() => settings.durationSeconds = Math.max(0.5, Math.round(showDuration * 100) / 100)}
              title="Match the show timeline's total programmed length"
            >Show length: {showDuration.toFixed(1)}s</button>
          {/if}
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
            title={nativeFrameCaptureAvailable ? 'Native renderer' : nativeFrameCaptureMessage}
          >
            <span class="engine-title">Native renderer</span>
            <span class="engine-meta">{nativeFrameCaptureMessage}</span>
          </button>
        </div>
      </div>

      {#if isDesktopApp && !isFrameOutput}
        <div class="field">
          <label>Video codec</label>
          <select value={settings.codec ?? 'h264'} onchange={(e) => { settings = { ...settings, codec: (e.currentTarget as HTMLSelectElement).value as OfflineRenderSettings['codec'] }; }}>
            {#each offlineCodecs as codec}
              <option value={codec.id} disabled={!codec.available}>{codec.label}{codec.available ? '' : ' (unavailable)'}</option>
            {/each}
          </select>
        </div>
      {/if}

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
          <strong>{settings.captureBackend === 'native' ? 'Native renderer' : 'WebGL'}</strong>.
        {:else}
          Will produce <strong>{Math.round(settings.durationSeconds * settings.fps)}</strong> frames at
          <strong>{settings.width}×{settings.height}</strong> with
          <strong>{settings.captureBackend === 'native' ? 'Native renderer' : 'WebGL'}</strong>.
        {/if}
      </div>

      {#if showHasAudio && !isFrameOutput && isDesktopApp}
        <p class="audio-note">The show's audio is added to the video.</p>
      {/if}

      {#if showLiveAudioWarning}
        <div class="warn-note" role="status">
          <span class="warn-icon">!</span>
          <span>
            <strong>{liveAudioInputLabel} input can't be time-locked to an offline render.</strong>
            Reactive timing will follow real elapsed time, so the audio in the exported clip
            won't line up with the visuals if the render runs slower than real time.
            For frame-accurate reactivity, put the song on the Show timeline
            (File › New show from audio).
          </span>
        </div>
      {/if}

      <div class="actions">
        <button class="btn-secondary secondary-btn" onclick={closeAndReset}>Cancel</button>
        <button class="btn-primary primary-btn" onclick={start} disabled={!settings.durationSeconds || !settings.fps}>
          Start render
        </button>
      </div>
    </div>
  {/if}
</div>
{/if}

<style>
  .show-length-btn {
    box-sizing: border-box;
    align-self: flex-start;
    height: var(--ga-control-h-sm);
    margin-top: 4px;
    padding: 0 8px;
    background: var(--ga-raise, #26221c);
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    border-radius: var(--ga-r-hard, 5px);
    color: var(--ga-ink-1, #ada9a2);
    font: inherit;
    font-size: var(--ga-text-meta);
    font-weight: var(--ga-weight-control);
    cursor: pointer;
  }
  .show-length-btn:hover { color: var(--ga-ink-0, #f2ede4); border-color: var(--ga-line-3, rgba(245, 236, 222, 0.24)); }

  .modal-backdrop {
    position: fixed; inset: 0;
    z-index: 1100;
  }
  .modal-backdrop {
    background: color-mix(in srgb, var(--ga-void, #0a0908) 76%, transparent);
    backdrop-filter: blur(8px);
  }
  .modal-shell {
    position: fixed;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    width: 560px;
    max-width: calc(100vw - 48px);
    max-height: calc(100vh - 48px);
    z-index: 1101;
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
  .modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--ga-line-1, rgba(245, 236, 222, 0.07));
  }
  .modal-head h2 {
    margin: 0;
    font-size: var(--ga-text-heading);
    font-weight: var(--ga-weight-title);
    line-height: 1.3;
    letter-spacing: 0;
    text-transform: none;
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
  .close-btn:hover:not(:disabled) {
    color: var(--ga-ink-0, #f2ede4);
    background: var(--ga-raise, #26221c);
    border-color: var(--ga-line-2, rgba(245, 236, 222, 0.13));
  }
  .close-btn:disabled { opacity: 0.35; cursor: not-allowed; }

  .modal-body {
    padding: 16px;
    overflow-y: auto;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 12px;
  }
  .field.small { flex: 1; }
  .field label {
    font-size: var(--ga-text-meta);
    font-weight: var(--ga-weight-control);
    color: var(--ga-ink-2, #89857e);
  }
  .field input,
  .field select {
    box-sizing: border-box;
    height: var(--ga-control-h);
    background-color: var(--ga-slot, #060504);
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    color: var(--ga-ink-0, #f2ede4);
    border-radius: var(--ga-r-hard, 5px);
    padding: 0 8px;
    font-size: var(--ga-text-control);
    font-family: inherit;
  }
  .field select { padding-right: 26px; }
  .field input:focus,
  .field select:focus {
    border-color: var(--ga-selection-line, #5278ff);
    outline: none;
  }
  .row { display: flex; gap: 10px; }
  .row.tight { gap: 6px; margin-top: 6px; }
  .preset-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
    margin-bottom: 4px;
  }
  .preset-btn,
  .engine-btn {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    padding: 6px 10px;
    background: var(--ga-card, #16140f);
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    border-radius: var(--ga-r-hard, 5px);
    color: var(--ga-ink-1, #ada9a2);
    font: inherit;
    cursor: pointer;
    text-align: left;
  }
  .preset-btn:hover:not(.active),
  .engine-btn:hover:not(:disabled):not(.active) {
    border-color: var(--ga-line-3, rgba(245, 236, 222, 0.24));
    color: var(--ga-ink-0, #f2ede4);
  }
  .preset-btn.active,
  .engine-btn.active {
    background: var(--ga-selection-bg, #1f3170);
    border-color: var(--ga-selection-line, #5278ff);
    color: var(--ga-selection-ink, #e0e8ff);
  }
  .preset-label { font-size: var(--ga-text-control); font-weight: var(--ga-weight-control); }
  .preset-dims { font-size: var(--ga-text-meta); font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace); color: var(--ga-ink-2, #89857e); }
  .preset-btn.active .preset-dims { color: inherit; opacity: 0.8; }

  .engine-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }
  .engine-btn {
    min-height: 48px;
    justify-content: center;
  }
  .engine-btn:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
  .engine-title {
    font-size: var(--ga-text-control);
    font-weight: var(--ga-weight-control);
  }
  .engine-meta {
    font-size: var(--ga-text-meta);
    color: var(--ga-ink-2, #89857e);
    line-height: 1.25;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }
  .engine-btn.active .engine-meta { color: inherit; opacity: 0.8; }

  .summary {
    background: var(--ga-card, #16140f);
    border-left: 2px solid var(--ga-selection-line, #5278ff);
    padding: 8px 12px;
    border-radius: 0 var(--ga-r-hard, 5px) var(--ga-r-hard, 5px) 0;
    font-size: var(--ga-text-meta);
    color: var(--ga-ink-1, #ada9a2);
    line-height: 1.5;
    margin-bottom: 12px;
  }
  .summary strong { color: var(--ga-ink-0, #f2ede4); font-weight: var(--ga-weight-control); }

  .warn-note {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    background: rgba(255, 176, 32, 0.06);
    border-left: 2px solid rgba(255, 176, 32, 0.55);
    padding: 8px 12px;
    border-radius: 0 var(--ga-r-hard, 5px) var(--ga-r-hard, 5px) 0;
    font-size: var(--ga-text-meta);
    color: var(--ga-ink-1, #ada9a2);
    line-height: 1.5;
    margin-bottom: 12px;
  }
  .warn-note strong {
    color: #ffb020;
    font-weight: var(--ga-weight-control);
  }
  .warn-icon {
    flex: 0 0 auto;
    width: 16px;
    height: 16px;
    margin-top: 1px;
    border-radius: 50%;
    background: rgba(255, 176, 32, 0.18);
    color: #ffb020;
    font-size: var(--ga-text-meta);
    font-weight: 700;
    line-height: 16px;
    text-align: center;
  }

  /* The action row reads as the dialog footer: full width, hairline above,
     pinned to the bottom while the form scrolls. */
  .actions {
    position: sticky;
    bottom: 0;
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin: 16px -16px -16px;
    padding: 12px 16px;
    border-top: 1px solid var(--ga-line-1, rgba(245, 236, 222, 0.07));
    background: var(--ga-panel, #100f0d);
  }
  .btn-secondary,
  .btn-primary {
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: var(--ga-bar-control-h);
    padding: 0 14px;
    border-radius: var(--ga-r-hard, 5px);
    font: inherit;
    font-size: var(--ga-text-body);
    font-weight: var(--ga-weight-control);
    white-space: nowrap;
    cursor: pointer;
    transition: color 0.12s, border-color 0.12s, filter 0.12s;
  }
  .btn-secondary {
    background: var(--ga-raise, #26221c);
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    color: var(--ga-ink-1, #ada9a2);
  }
  .btn-secondary:hover:not(:disabled) {
    color: var(--ga-ink-0, #f2ede4);
    border-color: var(--ga-line-3, rgba(245, 236, 222, 0.24));
  }
  .btn-primary {
    background: var(--ga-ink-0, #f2ede4);
    border: 1px solid var(--ga-ink-0, #f2ede4);
    color: var(--ga-void, #0a0908);
  }
  .btn-primary:hover:not(:disabled) { filter: brightness(1.06); }
  .btn-secondary:disabled,
  .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }

  /* Progress + states */
  .progress .phase {
    font-size: var(--ga-text-body);
    color: var(--ga-ink-0, #f2ede4);
    margin-bottom: 8px;
    font-weight: var(--ga-weight-control);
  }
  .progress-bar {
    height: 6px;
    background: var(--ga-slot, #060504);
    border-radius: 3px;
    overflow: hidden;
    border: 1px solid var(--ga-line-1, rgba(245, 236, 222, 0.07));
  }
  .progress-fill {
    height: 100%;
    background: var(--ga-selection-line, #5278ff);
    transition: width 0.15s ease-out;
  }
  .progress-meta {
    display: flex;
    justify-content: space-between;
    margin-top: 6px;
    font-size: var(--ga-text-meta);
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    color: var(--ga-ink-2, #89857e);
  }
  .success { text-align: center; }
  .success-icon,
  .error-icon {
    width: 44px; height: 44px;
    border-radius: 50%;
    font-size: 22px;
    font-weight: 700;
    line-height: 44px;
    margin: 4px auto 12px;
  }
  .success-icon {
    background: color-mix(in srgb, var(--ga-green, #46d18a) 15%, transparent);
    color: var(--ga-green, #46d18a);
    border: 1px solid var(--ga-green, #46d18a);
  }
  .success h3,
  .error h3 { margin: 0 0 4px; color: var(--ga-ink-0, #f2ede4); font-size: var(--ga-text-title); font-weight: var(--ga-weight-title); }
  .success-meta { color: var(--ga-ink-2, #89857e); font-size: var(--ga-text-meta); font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace); margin: 0 0 12px; }
  .preview {
    width: 100%;
    max-height: 280px;
    border-radius: var(--ga-r-hard, 5px);
    background: #000;
    margin-bottom: 8px;
  }
  .success-hint { color: var(--ga-ink-1, #ada9a2); font-size: var(--ga-text-meta); margin: 8px 0 0; }
  .audio-note {
    margin: 0;
    font-size: var(--ga-text-meta);
    color: var(--ga-ink-2, #89857e);
  }
  /* The full path matters more than tidiness here — a user who dismissed
     the save dialog has no other way to find the file. Wrap, don't clip. */
  .output-path {
    margin: 4px 0 0;
    font-size: var(--ga-text-meta);
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    color: var(--ga-ink-0, #f2ede4);
    word-break: break-all;
    line-height: 1.4;
    user-select: text;
  }

  .error { text-align: center; }
  .error-icon {
    background: color-mix(in srgb, var(--ga-rec, #ff3b30) 15%, transparent);
    color: var(--ga-rec, #ff3b30);
    border: 1px solid var(--ga-rec, #ff3b30);
  }
  .error-msg { color: #ff8888; font-size: var(--ga-text-meta); font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace); word-break: break-word; }
</style>
