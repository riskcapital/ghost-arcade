<script lang="ts">
  import { pathToFileUrl } from '../storage/assetRegistry';
  import {
    cancelActiveVideoConversion,
    convertImageSequenceToMp4,
    convertWebMToMp4,
    isVideoConversionCancelled,
    pickImageSequenceFolder,
    pickVideoOutputPath,
    pickWebMVideo,
    PLAYBACK_LONG_EDGES,
    revealVideoOutput,
    videoConversionFormats,
    type VideoConversionFormat,
    type PickedSequenceFolder,
    type PickedVideoFile,
    type VideoConversionProgress,
  } from '../video/videoConverter';

  export let isOpen = false;
  export let onClose: () => void = () => {};

  type ConverterMode = 'webm' | 'sequence';

  let mode: ConverterMode = 'webm';
  let selectedVideo: PickedVideoFile | null = null;
  let selectedSequence: PickedSequenceFolder | null = null;
  let outputPath = '';
  let resultPath = '';
  let resultUrl = '';
  let errorMessage = '';
  let noticeMessage = '';
  let isDragging = false;
  let isConverting = false;
  let isCancelling = false;
  let fps = 30;
  let crf = 18;
  let preset = 'veryfast';
  let longEdge = 1920;
  let format: VideoConversionFormat = 'h264';
  let resultFormat: VideoConversionFormat = 'h264';
  $: outputFormat = videoConversionFormats.find(f => f.id === format)!;
  let progress: VideoConversionProgress = { stage: 'idle', progress: 0, message: '' };

  $: progressPct = Math.round((progress.progress || 0) * 100);
  $: activeSourceName = mode === 'webm'
    ? selectedVideo?.name
    : selectedSequence ? `${selectedSequence.name} (${selectedSequence.frameCount} frames)` : '';
  $: canStart = Boolean(outputPath && (mode === 'webm' ? selectedVideo : selectedSequence));

  function defaultOutputFromPath(filePath: string, fallback = 'converted-video'): string {
    if (!filePath) return `${fallback}-${format}.${outputFormat.extension}`;
    const dot = filePath.lastIndexOf('.');
    const slash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
    if (dot > slash) return `${filePath.slice(0, dot)}-${format}.${outputFormat.extension}`;
    return `${filePath}-${format}.${outputFormat.extension}`;
  }

  function resetResult() {
    resultPath = '';
    resultUrl = '';
  }

  function resetMessages() {
    errorMessage = '';
    noticeMessage = '';
    progress = { stage: 'idle', progress: 0, message: '' };
  }

  function resetAll() {
    selectedVideo = null;
    selectedSequence = null;
    outputPath = '';
    isDragging = false;
    isCancelling = false;
    resetMessages();
    resetResult();
  }

  function closeModal() {
    if (isConverting) return;
    resetAll();
    onClose();
  }

  function switchMode(next: ConverterMode) {
    if (isConverting || mode === next) return;
    mode = next;
    resetMessages();
    resetResult();
    refreshOutputPath();
  }

  function refreshOutputPath() {
    const source = mode === 'webm' ? selectedVideo?.path : selectedSequence?.defaultOutputPath;
    outputPath = source ? defaultOutputFromPath(source) : '';
  }

  function changeFormat(value: VideoConversionFormat) {
    format = value;
    // Svelte's reactive declaration flushes later; derive the extension here.
    outputFormat = videoConversionFormats.find(f => f.id === format)!;
    refreshOutputPath(); resetMessages(); resetResult();
  }

  async function chooseWebM() {
    if (isConverting) return;
    try {
      resetMessages();
      resetResult();
      const picked = await pickWebMVideo();
      if (!picked) return;
      selectedVideo = picked;
      mode = 'webm';
      refreshOutputPath();
    } catch (error: any) {
      errorMessage = error?.message || String(error);
    }
  }

  async function chooseSequence() {
    if (isConverting) return;
    try {
      resetMessages();
      resetResult();
      const picked = await pickImageSequenceFolder();
      if (!picked) return;
      selectedSequence = picked;
      mode = 'sequence';
      refreshOutputPath();
    } catch (error: any) {
      errorMessage = error?.message || String(error);
    }
  }

  async function chooseOutput() {
    if (isConverting) return;
    try {
      const defaultPath = outputPath
        || (mode === 'webm'
          ? selectedVideo?.defaultOutputPath ?? (selectedVideo ? defaultOutputFromPath(selectedVideo.path) : undefined)
          : selectedSequence?.defaultOutputPath);
      const picked = await pickVideoOutputPath(defaultPath, activeSourceName || 'converted-video', format);
      if (picked) outputPath = picked;
    } catch (error: any) {
      errorMessage = error?.message || String(error);
    }
  }

  function chooseDroppedFile(file: File | null | undefined) {
    if (!file || isConverting) return;
    const filePath = window.electronAPI?.getPathForFile?.(file) || '';
    if (!filePath) {
      errorMessage = 'Drag a file from disk, or use Choose Video so Ghost can access the source path.';
      return;
    }
    resetMessages();
    resetResult();
    selectedVideo = {
      path: filePath,
      name: file.name,
      size: file.size,
      defaultOutputPath: defaultOutputFromPath(filePath),
    };
    mode = 'webm';
    outputPath = selectedVideo.defaultOutputPath ?? '';
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    isDragging = false;
    chooseDroppedFile(event.dataTransfer?.files?.[0]);
  }

  function onDragOver(event: DragEvent) {
    event.preventDefault();
    if (!isConverting && mode === 'webm') isDragging = true;
  }

  function onDragLeave() {
    isDragging = false;
  }

  async function cancelConversion() {
    if (!isConverting || isCancelling) return;
    isCancelling = true;
    errorMessage = '';
    noticeMessage = '';
    progress = {
      stage: 'cancelled',
      progress: progress.progress,
      message: 'Cancelling conversion...',
    };
    try {
      await cancelActiveVideoConversion();
    } catch { /* main process may have already exited the job */ }
  }

  async function startConversion() {
    if (!canStart || isConverting) return;
    resetResult();
    resetMessages();
    isCancelling = false;
    isConverting = true;
    progress = { stage: mode === 'sequence' ? 'scanning' : 'preparing', progress: 0, message: 'Preparing encoder...' };

    try {
      const options = { crf, preset, format, longEdge };
      const result = mode === 'sequence'
        ? await convertImageSequenceToMp4(selectedSequence!.path, outputPath, fps, options, (p) => { progress = p; })
        : await convertWebMToMp4(selectedVideo!.path, outputPath, options, (p) => { progress = p; });
      resultFormat = format;
      resultPath = result.outputPath;
      resultUrl = pathToFileUrl(result.outputPath);
      noticeMessage = result.hdrSkipped
        ? `${outputFormat.label} ready. This video is HDR and this FFmpeg cannot convert HDR to SDR, so its colours may look washed out.`
        : `${outputFormat.label} ready.`;
      progress = { stage: 'complete', progress: 1, message: 'Conversion complete.', outputPath: result.outputPath };
    } catch (error: any) {
      if (isVideoConversionCancelled(error)) {
        progress = { stage: 'cancelled', progress: 0, message: 'Conversion cancelled.' };
        noticeMessage = 'Conversion cancelled.';
      } else {
        progress = { stage: 'error', progress: 0, message: 'Conversion failed' };
        errorMessage = error?.message || String(error);
      }
    } finally {
      isConverting = false;
      isCancelling = false;
    }
  }

  async function revealResult() {
    const path = resultPath || outputPath;
    if (!path) return;
    try {
      await revealVideoOutput(path);
    } catch (error: any) {
      errorMessage = error?.message || String(error);
    }
  }

  function formatBytes(bytes: number | undefined): string {
    if (!Number.isFinite(bytes) || !bytes || bytes <= 0) return '';
    const mb = bytes / (1024 * 1024);
    if (mb < 1024) return `${mb.toFixed(mb >= 10 ? 1 : 2)} MB`;
    return `${(mb / 1024).toFixed(2)} GB`;
  }

  function onKey(event: KeyboardEvent) {
    if (!isOpen) return;
    if (event.key === 'Escape' && !isConverting) closeModal();
  }
</script>

<svelte:window onkeydown={onKey} />

{#if isOpen}
  <div data-help-page="performance" class="modal-backdrop" onclick={closeModal} role="presentation"></div>
  <div data-help-page="performance" class="modal-shell" role="dialog" aria-label="Video converter">
    <header class="modal-head">
      <div>
        <h2>Video converter</h2>
        <p>Prepare videos and image sequences for playback or sharing.</p>
      </div>
      <button class="close-btn" onclick={closeModal} disabled={isConverting} title={isConverting ? 'Conversion is running' : 'Close'} aria-label="Close"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg></button>
    </header>

    <div class="modal-body">
      <div class="mode-tabs">
        <button class:active={mode === 'webm'} onclick={() => switchMode('webm')} disabled={isConverting}>Video file</button>
        <button class:active={mode === 'sequence'} onclick={() => switchMode('sequence')} disabled={isConverting}>Image sequence</button>
      </div>

      {#if mode === 'webm'}
        <button
          class="drop-zone"
          class:dragging={isDragging}
          onclick={chooseWebM}
          ondrop={onDrop}
          ondragover={onDragOver}
          ondragleave={onDragLeave}
          disabled={isConverting}
        >
          <span class="drop-title">{selectedVideo ? selectedVideo.name : 'Choose video'}</span>
          <span class="drop-meta">
            {#if selectedVideo}
              {formatBytes(selectedVideo.size) || selectedVideo.path}
            {:else}
              Drop a video file here or browse
            {/if}
          </span>
        </button>
      {:else}
        <button class="drop-zone sequence-zone" onclick={chooseSequence} disabled={isConverting}>
          <span class="drop-title">{selectedSequence ? selectedSequence.name : 'Choose image sequence folder'}</span>
          <span class="drop-meta">
            {#if selectedSequence}
              {selectedSequence.frameCount} frames · {selectedSequence.firstFrame} → {selectedSequence.lastFrame}
            {:else}
              Select a folder of numbered JPG or PNG frames
            {/if}
          </span>
        </button>
      {/if}

      <label class="field">
        <span>Output format</span>
        <select aria-label="Output format" value={format} disabled={isConverting}
          onchange={(e) => changeFormat(e.currentTarget.value as VideoConversionFormat)}>
          {#each videoConversionFormats as f}<option value={f.id}>{f.label}</option>{/each}
        </select>
      </label>
      <div class="settings-grid">
        {#if mode === 'sequence'}
          <label class="field">
            <span>FPS</span>
            <input type="number" min="1" max="240" step="1" bind:value={fps} disabled={isConverting} />
          </label>
        {/if}
        {#if format === 'playback'}
        <label class="field">
          <span>Longest edge</span>
          <select bind:value={longEdge} disabled={isConverting}>
            {#each PLAYBACK_LONG_EDGES as edge}<option value={edge}>{edge} px{edge === 1920 ? ' (recommended)' : ''}</option>{/each}
          </select>
        </label>
        {/if}
        {#if format === 'h264'}
        <label class="field">
          <span>Quality CRF</span>
          <input type="number" min="10" max="32" step="1" bind:value={crf} disabled={isConverting} />
        </label>
        <label class="field">
          <span>Speed</span>
          <select bind:value={preset} disabled={isConverting}>
            <option value="ultrafast">ultrafast</option>
            <option value="superfast">superfast</option>
            <option value="veryfast">veryfast</option>
            <option value="faster">faster</option>
            <option value="fast">fast</option>
            <option value="medium">medium</option>
          </select>
        </label>
        {/if}
      </div>

      <div class="path-row">
        <div>
          <span>Output</span>
          <strong>{outputPath || 'Choose an output path'}</strong>
        </div>
        <button class="btn-secondary row-btn" onclick={chooseOutput} disabled={isConverting}>Choose</button>
      </div>

      <div class="summary">
        <strong>{outputFormat.label}</strong> — {outputFormat.description}
        {#if format.startsWith('hap')}<br />HAP playback performance in Ghost Arcade still requires qualification.{/if}

      </div>

      {#if isConverting}
        <div class="progress-block">
          <div class="phase">{progress.message || 'Converting...'}</div>
          <div class="progress-bar">
            <div class="progress-fill" style="width: {progressPct}%"></div>
          </div>
          <div class="progress-meta">
            <span>{progressPct}%</span>
            <span>{progress.stage}</span>
          </div>
        </div>
      {/if}

      {#if errorMessage}
        <div class="error-box">
          <strong>Conversion failed</strong>
          <span>{errorMessage}</span>
        </div>
      {/if}

      {#if noticeMessage}
        <div class="notice-box">
          <strong>{noticeMessage}</strong>
        </div>
      {/if}

      {#if resultPath}
        <div class="success-box">
          <strong>Video saved</strong>
          <span>{resultPath}</span>
          {#if resultUrl && resultFormat === 'h264'}
            <video src={resultUrl} controls muted></video>
          {/if}
        </div>
      {/if}

      <div class="actions">
        <button class="btn-secondary secondary-btn" onclick={closeModal} disabled={isConverting}>Close</button>
        {#if resultPath || outputPath}
          <button class="btn-secondary secondary-btn" onclick={revealResult} disabled={isConverting}>Reveal</button>
        {/if}
        {#if isConverting}
          <button class="btn-danger" onclick={cancelConversion} disabled={isCancelling}>
            {isCancelling ? 'Cancelling...' : 'Cancel'}
          </button>
        {/if}
        <button class="btn-primary primary-btn" onclick={startConversion} disabled={!canStart || isConverting}>
          {isConverting ? 'Converting...' : 'Convert'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1100;
  }
  .modal-backdrop {
    background: color-mix(in srgb, var(--ga-void, #0a0908) 76%, transparent);
    backdrop-filter: blur(8px);
  }
  .modal-shell {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 600px;
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
  .modal-head p {
    margin: 2px 0 0;
    color: var(--ga-ink-2, #89857e);
    font-size: var(--ga-text-meta);
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
  /* Video file | Image sequence: a segmented control. */
  .mode-tabs {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 2px;
    height: var(--ga-bar-control-h);
    padding: 2px;
    box-sizing: border-box;
    margin-bottom: 12px;
    background: var(--ga-slot, #060504);
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    border-radius: var(--ga-r-hard, 5px);
  }
  .mode-tabs button {
    border: 0;
    border-radius: calc(var(--ga-r-hard, 5px) - 1px);
    background: transparent;
    color: var(--ga-ink-1, #ada9a2);
    font: inherit;
    font-size: var(--ga-text-control);
    font-weight: var(--ga-weight-control);
    cursor: pointer;
  }
  .mode-tabs button:hover:not(.active):not(:disabled) {
    color: var(--ga-ink-0, #f2ede4);
    background: rgba(255, 255, 255, 0.05);
  }
  .mode-tabs button.active {
    background: var(--ga-selection-bg, #1f3170);
    color: var(--ga-selection-ink, #e0e8ff);
    box-shadow: inset 0 0 0 1px var(--ga-selection-line, #5278ff);
  }
  .drop-zone {
    width: 100%;
    min-height: 96px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 16px;
    background: var(--ga-card, #16140f);
    border: 1px dashed var(--ga-line-3, rgba(245, 236, 222, 0.24));
    border-radius: var(--ga-r-hard, 5px);
    color: var(--ga-ink-0, #f2ede4);
    font: inherit;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
  }
  .drop-zone:hover:not(:disabled),
  .drop-zone.dragging {
    border-color: var(--ga-selection-line, #5278ff);
    background: var(--ga-selection-bg, #1f3170);
  }
  .drop-zone:disabled { cursor: not-allowed; opacity: 0.55; }
  .sequence-zone {
    border-style: solid;
  }
  .drop-title {
    max-width: 100%;
    overflow-wrap: anywhere;
    font-size: var(--ga-text-body);
    font-weight: var(--ga-weight-control);
  }
  .drop-meta {
    max-width: 100%;
    overflow-wrap: anywhere;
    font-size: var(--ga-text-meta);
    color: var(--ga-ink-2, #89857e);
  }
  .settings-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
    margin: 12px 0;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    color: var(--ga-ink-2, #89857e);
    font-size: var(--ga-text-meta);
    font-weight: var(--ga-weight-control);
  }
  .field input,
  .field select {
    box-sizing: border-box;
    height: var(--ga-control-h);
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    background-color: var(--ga-slot, #060504);
    color: var(--ga-ink-0, #f2ede4);
    border-radius: var(--ga-r-hard, 5px);
    padding: 0 8px;
    font: inherit;
    font-size: var(--ga-text-control);
    font-weight: var(--ga-weight-body);
  }
  .field select { padding-right: 26px; }
  .path-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 10px;
    align-items: center;
    padding: 8px 8px 8px 12px;
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    background: var(--ga-card, #16140f);
    border-radius: var(--ga-r-hard, 5px);
  }
  .path-row div {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .path-row span {
    color: var(--ga-ink-2, #89857e);
    font-size: var(--ga-text-meta);
    font-weight: var(--ga-weight-control);
  }
  .path-row strong {
    color: var(--ga-ink-0, #f2ede4);
    font-size: var(--ga-text-control);
    font-weight: var(--ga-weight-body);
    overflow-wrap: anywhere;
  }
  .row-btn {
    box-sizing: border-box;
    height: var(--ga-control-h);
    padding: 0 12px;
    border-radius: var(--ga-r-hard, 5px);
    background: var(--ga-raise, #26221c);
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    color: var(--ga-ink-1, #ada9a2);
    font: inherit;
    font-size: var(--ga-text-control);
    font-weight: var(--ga-weight-control);
    cursor: pointer;
  }
  .row-btn:hover:not(:disabled) { color: var(--ga-ink-0, #f2ede4); border-color: var(--ga-line-3, rgba(245, 236, 222, 0.24)); }
  .row-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .summary {
    background: var(--ga-card, #16140f);
    border-left: 2px solid var(--ga-selection-line, #5278ff);
    padding: 8px 12px;
    border-radius: 0 var(--ga-r-hard, 5px) var(--ga-r-hard, 5px) 0;
    font-size: var(--ga-text-meta);
    color: var(--ga-ink-1, #ada9a2);
    line-height: 1.5;
    margin: 12px 0;
  }
  .summary strong { color: var(--ga-ink-0, #f2ede4); font-weight: var(--ga-weight-control); }
  .progress-block {
    margin-top: 12px;
  }
  .phase {
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
  .error-box,
  .notice-box,
  .success-box {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 12px;
    padding: 10px 12px;
    border-radius: var(--ga-r-hard, 5px);
    font-size: var(--ga-text-meta);
  }
  .error-box strong,
  .notice-box strong,
  .success-box strong { font-size: var(--ga-text-body); font-weight: var(--ga-weight-control); }
  .error-box {
    background: rgba(255, 80, 80, 0.10);
    border: 1px solid rgba(255, 80, 80, 0.35);
    color: #ff9b9b;
  }
  .notice-box {
    background: var(--ga-card, #16140f);
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    color: var(--ga-ink-0, #f2ede4);
  }
  .success-box {
    background: color-mix(in srgb, var(--ga-green, #46d18a) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--ga-green, #46d18a) 35%, transparent);
    color: var(--ga-green, #46d18a);
  }
  .success-box span {
    color: var(--ga-ink-1, #ada9a2);
    overflow-wrap: anywhere;
  }
  .success-box video {
    width: 100%;
    max-height: 220px;
    margin-top: 6px;
    border-radius: var(--ga-r-hard, 5px);
    background: #000;
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
  .btn-secondary.secondary-btn,
  .btn-danger,
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
  .btn-secondary.secondary-btn {
    background: var(--ga-raise, #26221c);
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    color: var(--ga-ink-1, #ada9a2);
  }
  .btn-secondary.secondary-btn:hover:not(:disabled) {
    color: var(--ga-ink-0, #f2ede4);
    border-color: var(--ga-line-3, rgba(245, 236, 222, 0.24));
  }
  .btn-primary {
    background: var(--ga-ink-0, #f2ede4);
    border: 1px solid var(--ga-ink-0, #f2ede4);
    color: var(--ga-void, #0a0908);
  }
  .btn-primary:hover:not(:disabled) { filter: brightness(1.06); }
  .btn-secondary.secondary-btn:disabled,
  .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn-danger {
    background: rgba(255, 80, 80, 0.12);
    border: 1px solid rgba(255, 80, 80, 0.42);
    color: #ff9b9b;
  }
  .btn-danger:hover:not(:disabled) {
    background: rgba(255, 80, 80, 0.20);
    border-color: rgba(255, 120, 120, 0.70);
    color: #ffd0d0;
  }
  .btn-danger:disabled { opacity: 0.45; cursor: wait; }
</style>
