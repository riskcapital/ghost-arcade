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
  import { t } from '../i18n';

  export let isOpen = false;
  export let onClose: () => void = () => {};

  // Settings start at defaults, but seed width/height from the current
  // project so users land on a sensible matching resolution.
  let settings: OfflineRenderSettings = { ...DEFAULT_OFFLINE_SETTINGS };
  let seededForOpen = false;
  function seedSettingsFromProject() {
    settings = {
      ...DEFAULT_OFFLINE_SETTINGS,
      width: $project.width || 1920,
      height: $project.height || 1080,
    };
  }
  $: if (isOpen && !seededForOpen) {
    seedSettingsFromProject();
    seededForOpen = true;
  }
  $: if (!isOpen && seededForOpen) {
    seededForOpen = false;
  }

  const RESOLUTION_PRESETS = [
    {
      labelKey: 'mediaTools.offline.presets.projectSize',  fn: () => ({ w: $project.width || 1920, h: $project.height || 1080 }),
    },
    { labelKey: 'mediaTools.offline.presets.hd720',     fn: () => ({ w: 1280, h: 720 }) },
    { labelKey: 'mediaTools.offline.presets.fhd1080',   fn: () => ({ w: 1920, h: 1080 }) },
    { labelKey: 'mediaTools.offline.presets.k2',    fn: () => ({ w: 2560, h: 1440 }) },
    { labelKey: 'mediaTools.offline.presets.k4',    fn: () => ({ w: 3840, h: 2160 }) },
    { labelKey: 'mediaTools.offline.presets.square1080',   fn: () => ({ w: 1080, h: 1080 }) },
    { labelKey: 'mediaTools.offline.presets.vertical1080', fn: () => ({ w: 1080, h: 1920 }) },
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
    offlineRender.start({ ...settings });
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

<!-- svelte:window must live at component root, not inside {#if}.
     The handler itself short-circuits when the modal is closed. -->
<svelte:window onkeydown={onKey} />

{#if isOpen}
  <div class="modal-backdrop" onclick={closeAndReset} role="presentation"></div>
  <div class="modal-shell" role="dialog" aria-label={$t('mediaTools.offline.ariaLabel')}>
    <header class="modal-head">
      <h2>{$t('mediaTools.offline.title')}</h2>
      <button
        class="close-btn"
        onclick={closeAndReset}
        disabled={isRunning}
        title={$t(isRunning ? 'mediaTools.offline.closeWhileRunning' : 'mediaTools.offline.closeTitle')}
        aria-label={$t(isRunning ? 'mediaTools.offline.closeWhileRunning' : 'mediaTools.offline.closeTitle')}>×</button
      >
    </header>

    {#if state.status === 'complete' && state.lastOutputKind === 'frames'}
      <!-- Success state — frame sequence folder. -->
      <div class="modal-body success">
        <div class="success-icon">✓</div>
        <h3>{$t('mediaTools.offline.success.framesExported')}</h3>
        <p class="success-meta">
          {state.lastOutputName ?? 'render'}_%06d.jpg · {$t('mediaTools.offline.success.frames', {
            values: { count: state.totalFrames },
          })} · {fmtTime(elapsedSec)}
        </p>
        {#if state.lastOutputPath}
          <p class="success-hint">
            {$t('mediaTools.offline.success.savedTo', { values: { path: state.lastOutputPath ?? '' } })}
          </p>
        {/if}
        <p class="success-hint">{$t('mediaTools.offline.success.manifestHint')}</p>
        <div class="actions">
          <button class="btn-primary" onclick={closeAndReset}>{$t('mediaTools.offline.success.done')}</button>
        </div>
      </div>
    {:else if state.status === 'complete' && state.lastOutputUrl}
      <!-- Success state — preview thumbnail + actions. -->
      <div class="modal-body success">
        <div class="success-icon">✓</div>
        <h3>{$t('mediaTools.offline.success.renderComplete')}</h3>
        <p class="success-meta">
          {state.lastOutputName ?? 'render'}.mp4 · {$t('mediaTools.offline.success.frames', {
            values: { count: state.totalFrames },
          })} · {fmtTime(elapsedSec)}
        </p>
        <video class="preview" src={state.lastOutputUrl} controls muted loop></video>
        <p class="success-hint">{$t('mediaTools.offline.success.addedToLibrary')}</p>
        <div class="actions">
          <button class="btn-primary" onclick={closeAndReset}>{$t('mediaTools.offline.success.done')}</button>
        </div>
      </div>
    {:else if isRunning}
      <!-- Progress state — bar + phase + cancel. -->
      <div class="modal-body progress">
        <div class="phase">
          {#if state.status === 'choosing-folder'}
            {$t('mediaTools.offline.progress.chooseFolder')}
          {:else if state.status === 'loading-ffmpeg'}
            {$t('mediaTools.offline.progress.loadingEncoder')}
          {:else if state.status === 'rendering'}
            {$t(
              isFrameOutput ? 'mediaTools.offline.progress.writingFrame' : 'mediaTools.offline.progress.renderingFrame',
              { values: { current: state.currentFrame, total: state.totalFrames } },
            )}
          {:else if state.status === 'encoding'}
            {$t('mediaTools.offline.progress.encodingMp4')}
          {:else if state.status === 'saving'}
            {$t(
              isFrameOutput
                ? 'mediaTools.offline.progress.finalizingFrames'
                : 'mediaTools.offline.progress.savingLibrary',
            )}
          {/if}
        </div>
        <div class="progress-bar">
          <div class="progress-fill" style="width: {progressPct}%"></div>
        </div>
        <div class="progress-meta">
          <span>{progressPct}%</span>
          <span>
            {$t('mediaTools.offline.progress.elapsed', { values: { time: fmtTime(elapsedSec) } })}
            {#if remainingSec > 0 && state.status === 'rendering'}
              · {$t('mediaTools.offline.progress.remaining', { values: { time: fmtTime(remainingSec) } })}
            {/if}
          </span>
        </div>
        <div class="actions">
          <button class="btn-secondary" onclick={cancel}>{$t('mediaTools.offline.progress.cancel')}</button>
        </div>
      </div>
    {:else if state.status === 'cancelled' || state.status === 'error'}
      <!-- Error / cancelled state. -->
      <div class="modal-body error">
        <div class="error-icon">{state.status === 'error' ? '!' : '×'}</div>
        <h3>
          {$t(
            state.status === 'error'
              ? 'mediaTools.offline.error.renderFailed'
              : 'mediaTools.offline.error.renderCancelled',
          )}
        </h3>
        {#if state.errorMessage}
          <p class="error-msg">{state.errorMessage}</p>
        {/if}
        <div class="actions">
          <button class="btn-secondary" onclick={() => offlineRender.reset()}
            >{$t('mediaTools.offline.error.backToSettings')}</button
          >
          <button class="btn-primary" onclick={closeAndReset}>{$t('mediaTools.offline.error.close')}</button>
        </div>
      </div>
    {:else}
      <!-- Settings form. -->
      <div class="modal-body">
        <div class="field">
          <label>{$t('mediaTools.offline.settings.filename')}</label>
          <input
            type="text"
            bind:value={settings.filename}
            placeholder={$t('mediaTools.offline.settings.filenamePlaceholder')}
          />
        </div>

        <div class="row">
          <div class="field">
            <label>{$t('mediaTools.offline.settings.duration')}</label>
            <input type="number" min="0.5" max="3600" step="0.5" bind:value={settings.durationSeconds} />
          </div>
          <div class="field">
            <label>{$t('mediaTools.offline.settings.frameRate')}</label>
            <select bind:value={settings.fps}>
              {#each FPS_PRESETS as fps}
                <option value={fps}>{$t('mediaTools.offline.settings.fps', { values: { fps } })}</option>
              {/each}
            </select>
          </div>
        </div>

        <div class="field">
          <label>{$t('mediaTools.offline.settings.resolution')}</label>
          <div class="preset-grid">
            {#each RESOLUTION_PRESETS as preset}
              {@const p = preset.fn()}
              {@const active = settings.width === p.w && settings.height === p.h}
              <button
                class="preset-btn"
                class:active
                onclick={() => {
                  settings.width = p.w;
                  settings.height = p.h;
                }}
              >
                <span class="preset-label">{$t(preset.labelKey)}</span>
                <span class="preset-dims">{p.w}×{p.h}</span>
              </button>
            {/each}
          </div>
          <div class="row tight">
            <div class="field small">
              <label>{$t('mediaTools.offline.settings.width')}</label>
              <input type="number" min="64" max="7680" step="2" bind:value={settings.width} />
            </div>
            <div class="field small">
              <label>{$t('mediaTools.offline.settings.height')}</label>
              <input type="number" min="64" max="4320" step="2" bind:value={settings.height} />
            </div>
          </div>
        </div>

        <div class="field">
          <label>{$t('mediaTools.offline.settings.output')}</label>
          <select bind:value={settings.outputMode}>
            <option value="mp4">{$t('mediaTools.offline.settings.mp4Video')}</option>
            <option value="frames">{$t('mediaTools.offline.settings.jpegSequence')}</option>
          </select>
        </div>

        <div class="field">
          <label
            >{$t(
              isFrameOutput
                ? 'mediaTools.offline.settings.compileQualityPreset'
                : 'mediaTools.offline.settings.quality',
            )}</label
          >
          <select bind:value={settings.quality}>
            <option value="web">{$t('mediaTools.offline.settings.qualityWeb')}</option>
            <option value="high">{$t('mediaTools.offline.settings.qualityHigh')}</option>
            <option value="archive">{$t('mediaTools.offline.settings.qualityArchive')}</option>
          </select>
        </div>

        <div class="summary">
          {#if isFrameOutput}
            {$t('mediaTools.offline.settings.summaryFrames', {
              values: {
                frames: Math.round(settings.durationSeconds * settings.fps),
                width: settings.width,
                height: settings.height,
              },
            })}
          {:else}
            {$t('mediaTools.offline.settings.summaryVideo', {
              values: {
                frames: Math.round(settings.durationSeconds * settings.fps),
                width: settings.width,
                height: settings.height,
              },
            })}
          {/if}
        </div>

        <div class="actions">
          <button class="btn-secondary" onclick={closeAndReset}>{$t('mediaTools.offline.settings.cancel')}</button>
          <button class="btn-primary" onclick={start} disabled={!settings.durationSeconds || !settings.fps}>
            {$t('mediaTools.offline.settings.start')}
          </button>
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(4px);
    z-index: 1100;
  }
  .modal-shell {
    position: fixed;
    top: 50%;
    left: 50%;
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
    width: 32px;
    height: 32px;
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
  .close-btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.06);
    color: #fff;
  }
  .close-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

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
  .field.small {
    flex: 1;
  }
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
  .row {
    display: flex;
    gap: 10px;
  }
  .row.tight {
    gap: 6px;
    margin-top: 6px;
  }
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
  .preset-label {
    font-size: 12px;
    font-weight: 500;
  }
  .preset-dims {
    font-size: 11px;
    font-family: var(--ga-font-mono, 'IBM Plex Mono', ui-monospace, monospace);
    color: #666;
  }
  .preset-btn.active .preset-dims {
    color: #4cd1ff;
  }

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
  .summary strong {
    color: #4cd1ff;
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
  .btn-primary:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
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
    font-family: var(--ga-font-mono, 'IBM Plex Mono', ui-monospace, monospace);
    color: var(--text-muted, #888);
  }
  .success {
    text-align: center;
  }
  .success-icon {
    width: 56px;
    height: 56px;
    background: rgba(76, 222, 128, 0.15);
    color: #4ade80;
    border: 1px solid #4ade80;
    border-radius: 50%;
    font-size: 29px;
    line-height: 56px;
    margin: 6px auto 12px;
  }
  .success h3 {
    margin: 0 0 4px;
    color: var(--text-primary, #ddd);
    font-size: 17px;
  }
  .success-meta {
    color: var(--text-muted, #888);
    font-size: 12px;
    font-family: var(--ga-font-mono, 'IBM Plex Mono', ui-monospace, monospace);
    margin: 0 0 12px;
  }
  .preview {
    width: 100%;
    max-height: 280px;
    border-radius: 5px;
    background: #000;
    margin-bottom: 8px;
  }
  .success-hint {
    color: #4ade80;
    font-size: 12px;
    margin: 8px 0 0;
  }

  .error {
    text-align: center;
  }
  .error-icon {
    width: 56px;
    height: 56px;
    background: rgba(255, 80, 80, 0.15);
    color: #ff5252;
    border: 1px solid #ff5252;
    border-radius: 50%;
    font-size: 29px;
    line-height: 56px;
    margin: 6px auto 12px;
    font-weight: 700;
  }
  .error h3 {
    margin: 0 0 8px;
    color: var(--text-primary, #ddd);
    font-size: 17px;
  }
  .error-msg {
    color: #ff8888;
    font-size: 13px;
    font-family: var(--ga-font-mono, 'IBM Plex Mono', ui-monospace, monospace); word-break: break-word; }
</style>
