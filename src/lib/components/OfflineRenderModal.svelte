<script lang="ts">
  /**
   * Offline render-to-video modal.
   *
   * Settings form (duration / fps / resolution preset / quality /
   * filename) → start button. While rendering, a progress bar and
   * cancel button replace the form. On completion, a preview link +
   * Done button.
   */

  import { offlineRender, DEFAULT_OFFLINE_SETTINGS, type OfflineRenderSettings } from '../recording/offlineRender';
  import { project } from '../stores/layers';

  export let isOpen = false;
  export let onClose: () => void = () => {};

  // Settings start at defaults, but seed width/height from the current
  // project so users land on a sensible matching resolution.
  let settings: OfflineRenderSettings = { ...DEFAULT_OFFLINE_SETTINGS };
  $: if (isOpen) {
    settings = {
      ...DEFAULT_OFFLINE_SETTINGS,
      width: $project.width || 1920,
      height: $project.height || 1080,
    };
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
  $: isRunning = state.status !== 'idle' && state.status !== 'complete' && state.status !== 'cancelled' && state.status !== 'error';
  // Progress bar source depends on phase. While capturing frames it
  // tracks frame N / totalFrames. While encoding it tracks ffmpeg's
  // own progress event (which the store re-publishes as
  // encodeProgress). Previously the bar froze at 100% during the
  // encode pass because we never updated currentFrame past total —
  // user reported it as "stuck", which it wasn't, but it sure looked
  // that way for the 30-90s the wasm libx264 takes.
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
    offlineRender.start(settings);
  }
  function cancel() {
    offlineRender.cancel();
  }
  function closeAndReset() {
    offlineRender.reset();
    onClose();
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
</script>

{#if isOpen}
<div class="modal-backdrop" onclick={closeAndReset} role="presentation"></div>
<div class="modal-shell" role="dialog" aria-label="Render to video">
  <header class="modal-head">
    <h2>Render to Video</h2>
    <button class="close-btn" onclick={closeAndReset} disabled={isRunning} title={isRunning ? 'Cancel before closing' : 'Close'}>×</button>
  </header>

  {#if state.status === 'complete' && state.lastOutputUrl}
    <!-- Success state — preview thumbnail + actions. -->
    <div class="modal-body success">
      <div class="success-icon">✓</div>
      <h3>Render complete</h3>
      <p class="success-meta">{state.lastOutputName ?? 'render'}.mp4 · {state.totalFrames} frames · {fmtTime(elapsedSec)}</p>
      <video class="preview" src={state.lastOutputUrl} controls muted loop></video>
      <p class="success-hint">Added to media library + downloaded.</p>
      <div class="actions">
        <button class="btn-primary" onclick={closeAndReset}>Done</button>
      </div>
    </div>

  {:else if isRunning}
    <!-- Progress state — bar + phase + cancel. -->
    <div class="modal-body progress">
      <div class="phase">
        {#if state.status === 'loading-ffmpeg'}
          Loading FFmpeg encoder…
        {:else if state.status === 'rendering'}
          Rendering frame {state.currentFrame} / {state.totalFrames}
        {:else if state.status === 'encoding'}
          Encoding to MP4…
        {:else if state.status === 'saving'}
          Saving to library…
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
      {#if state.status === 'rendering'}
        <p class="progress-hint">The editor preview will look unusual while rendering — it's driven by the virtual clock instead of wall time. Don't switch projects or close the app.</p>
      {:else if state.status === 'encoding'}
        <!-- libx264 in wasm is single-threaded and slow — set
             expectations honestly. A 10s/1080p clip is ~30-90s of
             encode wall time on a typical laptop. -->
        <p class="progress-hint">Compressing frames to MP4 with libx264. This usually takes 1-3× the clip's duration. Don't close the app.</p>
      {/if}
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
      <p class="lede">Deterministic frame-by-frame render. No drops, exact timing, any resolution.</p>

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
        <label>Quality</label>
        <select bind:value={settings.quality}>
          <option value="web">Web (smaller file, CRF 23)</option>
          <option value="high">High (recommended, CRF 18)</option>
          <option value="archive">Archive (near-lossless, CRF 14, slow)</option>
        </select>
      </div>

      <div class="summary">
        Will produce <strong>{Math.round(settings.durationSeconds * settings.fps)}</strong> frames at
        <strong>{settings.width}×{settings.height}</strong>.
        FFmpeg loads on first run (~30MB).
      </div>

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
    background: #0a0a0c;
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
    font-size: 14px;
    letter-spacing: 2px;
    color: #4cd1ff;
    font-weight: 600;
  }
  .close-btn {
    width: 28px; height: 28px;
    border: 1px solid #2a2a30;
    background: transparent;
    color: #aaa;
    border-radius: 4px;
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
  }
  .close-btn:hover:not(:disabled) { background: rgba(255,255,255,0.06); color: #fff; }
  .close-btn:disabled { opacity: 0.3; cursor: not-allowed; }

  .modal-body {
    padding: 18px;
    overflow-y: auto;
  }
  .lede {
    color: #aaa;
    font-size: 12px;
    margin: 0 0 16px;
    line-height: 1.5;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 5px;
    margin-bottom: 14px;
  }
  .field.small { flex: 1; }
  .field label {
    font-size: 10px;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: #888;
  }
  .field input,
  .field select {
    background: #14141a;
    border: 1px solid #2a2a30;
    color: #ddd;
    border-radius: 4px;
    padding: 7px 10px;
    font-size: 12px;
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
    background: #14141a;
    border: 1px solid #2a2a30;
    border-radius: 4px;
    color: #aaa;
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
  .preset-label { font-size: 11px; font-weight: 500; }
  .preset-dims { font-size: 10px; font-family: monospace; color: #666; }
  .preset-btn.active .preset-dims { color: #4cd1ff; }

  .summary {
    background: rgba(76, 209, 255, 0.05);
    border-left: 2px solid rgba(76, 209, 255, 0.4);
    padding: 8px 12px;
    border-radius: 0 4px 4px 0;
    font-size: 11px;
    color: #aaa;
    line-height: 1.5;
    margin-bottom: 14px;
  }
  .summary strong { color: #4cd1ff; }

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
    font-size: 12px;
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
    color: #aaa;
  }
  .btn-secondary:hover {
    border-color: #4cd1ff;
    color: #4cd1ff;
  }

  /* Progress + states */
  .progress .phase {
    font-size: 13px;
    color: #4cd1ff;
    margin-bottom: 8px;
    font-weight: 500;
    letter-spacing: 0.3px;
  }
  .progress-bar {
    height: 10px;
    background: #14141a;
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
    font-size: 11px;
    font-family: monospace;
    color: #888;
  }
  .progress-hint {
    font-size: 10.5px;
    color: #666;
    line-height: 1.5;
    margin: 12px 0 0;
  }

  .success { text-align: center; }
  .success-icon {
    width: 56px; height: 56px;
    background: rgba(76, 222, 128, 0.15);
    color: #4ade80;
    border: 1px solid #4ade80;
    border-radius: 50%;
    font-size: 28px;
    line-height: 56px;
    margin: 6px auto 12px;
  }
  .success h3 { margin: 0 0 4px; color: #ddd; font-size: 16px; }
  .success-meta { color: #888; font-size: 11px; font-family: monospace; margin: 0 0 12px; }
  .preview {
    width: 100%;
    max-height: 280px;
    border-radius: 5px;
    background: #000;
    margin-bottom: 8px;
  }
  .success-hint { color: #4ade80; font-size: 11px; margin: 8px 0 0; }

  .error { text-align: center; }
  .error-icon {
    width: 56px; height: 56px;
    background: rgba(255, 80, 80, 0.15);
    color: #ff5252;
    border: 1px solid #ff5252;
    border-radius: 50%;
    font-size: 28px;
    line-height: 56px;
    margin: 6px auto 12px;
    font-weight: 700;
  }
  .error h3 { margin: 0 0 8px; color: #ddd; font-size: 16px; }
  .error-msg { color: #ff8888; font-size: 12px; font-family: monospace; word-break: break-word; }
</style>
