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
    revealVideoOutput,
    type PickedSequenceFolder,
    type PickedVideoFile,
    type VideoConversionProgress,
  } from '../video/videoConverter';
  import { t } from '../i18n';

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
  let progress: VideoConversionProgress = { stage: 'idle', progress: 0, message: '' };

  $: progressPct = Math.round((progress.progress || 0) * 100);
  $: activeSourceName = mode === 'webm'
    ? selectedVideo?.name
    : selectedSequence ? `${selectedSequence.name} (${selectedSequence.frameCount} frames)` : '';
  $: canStart = Boolean(outputPath && (mode === 'webm' ? selectedVideo : selectedSequence));

  function defaultOutputFromPath(filePath: string, fallback = 'converted-video.mp4'): string {
    if (!filePath) return fallback;
    const dot = filePath.lastIndexOf('.');
    const slash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
    if (dot > slash) return `${filePath.slice(0, dot)}.mp4`;
    return `${filePath}.mp4`;
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
    outputPath = next === 'webm'
      ? (selectedVideo?.defaultOutputPath ?? (selectedVideo ? defaultOutputFromPath(selectedVideo.path) : ''))
        : (selectedSequence?.defaultOutputPath ?? '');
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
      outputPath = picked.defaultOutputPath ?? defaultOutputFromPath(picked.path);
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
      outputPath = picked.defaultOutputPath ?? '';
    } catch (error: any) {
      errorMessage = error?.message || String(error);
    }
  }

  async function chooseOutput() {
    if (isConverting) return;
    try {
      const defaultPath = outputPath
        || (mode === 'webm'
          ? (selectedVideo?.defaultOutputPath ?? (selectedVideo ? defaultOutputFromPath(selectedVideo.path) : undefined))
          : selectedSequence?.defaultOutputPath);
      const picked = await pickVideoOutputPath(defaultPath, activeSourceName || 'converted-video');
      if (picked) outputPath = picked;
    } catch (error: any) {
      errorMessage = error?.message || String(error);
    }
  }

  function chooseDroppedFile(file: File | null | undefined) {
    if (!file || isConverting) return;
    const filePath = window.electronAPI?.getPathForFile?.(file) || '';
    if (!filePath) {
      errorMessage = $t('mediaTools.converter.errors.droppedFilePath');
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
      message: $t('mediaTools.converter.progress.cancelling'),
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
    progress = { stage: mode === 'sequence' ? 'scanning' : 'preparing', progress: 0, message: $t('mediaTools.converter.progress.preparingEncoder'),
    };

    try {
      const options = { crf, preset };
      const result = mode === 'sequence'
        ? await convertImageSequenceToMp4(selectedSequence!.path, outputPath, fps, options, (p) => { progress = p; })
        : await convertWebMToMp4(selectedVideo!.path, outputPath, options, (p) => { progress = p; });
      resultPath = result.outputPath;
      resultUrl = pathToFileUrl(result.outputPath);
      noticeMessage = $t('mediaTools.converter.notice.mp4Ready');
      progress = { stage: 'complete', progress: 1, message: $t(
          mode === 'sequence'
            ? 'mediaTools.converter.progress.sequenceComplete'
            : 'mediaTools.converter.progress.webmComplete',
        ), outputPath: result.outputPath,
      };
    } catch (error: any) {
      if (isVideoConversionCancelled(error)) {
        progress = { stage: 'cancelled', progress: 0, message: $t('mediaTools.converter.progress.conversionCancelled'),
        };
        noticeMessage = $t('mediaTools.converter.notice.conversionCancelled');
      } else {
        progress = { stage: 'error', progress: 0, message: $t('mediaTools.converter.errors.failed'),
        };
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

  function progressLabel(): string {
    const message = progress.message || '';
    if (!message) return $t('mediaTools.converter.progress.converting');
    if (message === 'Preparing encoder...') return $t('mediaTools.converter.progress.preparingEncoder');
    if (message === 'Scanning frame folder...') return $t('mediaTools.converter.progress.scanningFolder');
    if (message === 'Preparing native FFmpeg encoder...')
      return $t('mediaTools.converter.progress.preparingNativeEncoder');
    if (message === 'Finalizing MP4...') return $t('mediaTools.converter.progress.finalizingMp4');
    if (message === 'Conversion cancelled.') return $t('mediaTools.converter.progress.conversionCancelled');
    if (message === 'Image sequence MP4 complete.') return $t('mediaTools.converter.progress.sequenceComplete');
    if (message === 'WebM MP4 conversion complete.') return $t('mediaTools.converter.progress.webmComplete');
    if (message === 'Conversion failed') return $t('mediaTools.converter.errors.failed');

    const foundFrames = message.match(/^Found (\d+) frames\. Preparing encoder\.\.\.$/);
    if (foundFrames) {
      return $t('mediaTools.converter.progress.foundFrames', { values: { count: Number(foundFrames[1]) } });
    }
    const encodingFrames = message.match(/^Encoding (\d+) frames at ([\d.]+) fps\.\.\.$/);
    if (encodingFrames) {
      return $t('mediaTools.converter.progress.encodingFrames', {
        values: { count: Number(encodingFrames[1]), fps: encodingFrames[2] },
      });
    }
    const convertingWebm = message === 'Converting WebM to MP4...';
    if (convertingWebm) return $t('mediaTools.converter.progress.convertingWebm');
    const encodingMp4 = message.match(/^Encoding MP4 \((\d+)%\)\.\.\.$/);
    if (encodingMp4) {
      return $t('mediaTools.converter.progress.encodingMp4', { values: { percent: Number(encodingMp4[1]) } });
    }
    return message;
  }

  function progressStageLabel(): string {
    return $t(`mediaTools.converter.stages.${progress.stage}`);
  }

  function onKey(event: KeyboardEvent) {
    if (!isOpen) return;
    if (event.key === 'Escape' && !isConverting) closeModal();
  }
</script>

<svelte:window onkeydown={onKey} />

{#if isOpen}
  <div class="modal-backdrop" onclick={closeModal} role="presentation"></div>
  <div class="modal-shell" role="dialog" aria-label={$t('mediaTools.converter.ariaLabel')}>
    <header class="modal-head">
      <div>
        <h2>{$t('mediaTools.converter.title')}</h2>
        <p>{$t('mediaTools.converter.subtitle')}</p>
      </div>
      <button class="close-btn" onclick={closeModal} disabled={isConverting} title={$t(isConverting ? 'mediaTools.converter.runningCloseTitle' : 'mediaTools.converter.closeTitle')}
        aria-label={$t(isConverting ? 'mediaTools.converter.runningCloseTitle' : 'mediaTools.converter.closeTitle')}>×</button>
    </header>

    <div class="modal-body">
      <div class="mode-tabs">
        <button class:active={mode === 'webm'} onclick={() => switchMode('webm')} disabled={isConverting}>{$t('mediaTools.converter.modes.webmToMp4')}</button>
        <button class:active={mode === 'sequence'} onclick={() => switchMode('sequence')} disabled={isConverting}>{$t('mediaTools.converter.modes.jpgSequence')}</button>
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
          <span class="drop-title">{selectedVideo ? selectedVideo.name : $t('mediaTools.converter.source.chooseWebm')}</span>
          <span class="drop-meta">
            {#if selectedVideo}
              {formatBytes(selectedVideo.size) || selectedVideo.path}
            {:else}
              {$t('mediaTools.converter.source.webmDropHint')}
            {/if}
          </span>
        </button>
      {:else}
        <button class="drop-zone sequence-zone" onclick={chooseSequence} disabled={isConverting}>
          <span class="drop-title">{selectedSequence ? selectedSequence.name : $t('mediaTools.converter.source.chooseSequence')}</span>
          <span class="drop-meta">
            {#if selectedSequence}
              {$t('mediaTools.converter.source.frames', {
                values: {
                  count: selectedSequence.frameCount,
                  first: selectedSequence.firstFrame || '',
                  last: selectedSequence.lastFrame || '',
                },
              })}
            {:else}
              {$t('mediaTools.converter.source.sequenceHint')}
            {/if}
          </span>
        </button>
      {/if}

      <div class="settings-grid">
        {#if mode === 'sequence'}
          <label class="field">
            <span>{$t('mediaTools.converter.fields.fps')}</span>
            <input type="number" min="1" max="240" step="1" bind:value={fps} disabled={isConverting} />
          </label>
        {/if}
        <label class="field">
          <span>{$t('mediaTools.converter.fields.qualityCrf')}</span>
          <input type="number" min="10" max="32" step="1" bind:value={crf} disabled={isConverting} />
        </label>
        <label class="field">
          <span>{$t('mediaTools.converter.fields.speed')}</span>
          <select bind:value={preset} disabled={isConverting}>
            <option value="ultrafast">ultrafast</option>
            <option value="superfast">superfast</option>
            <option value="veryfast">veryfast</option>
            <option value="faster">faster</option>
            <option value="fast">fast</option>
            <option value="medium">medium</option>
          </select>
        </label>
      </div>

      <div class="path-row">
        <div>
          <span>{$t('mediaTools.converter.fields.output')}</span>
          <strong>{outputPath || $t('mediaTools.converter.fields.chooseOutputPath')}</strong>
        </div>
        <button class="btn-secondary" onclick={chooseOutput} disabled={isConverting}>{$t('mediaTools.converter.fields.choose')}</button>
      </div>

      <div class="summary">
        {$t('mediaTools.converter.fields.outputSummary')} <strong>MP4 / H.264</strong>, <strong>yuv420p</strong>, <strong>+faststart</strong>{$t(
          mode === 'webm' ? 'mediaTools.converter.fields.withAacAudio' : 'mediaTools.converter.fields.noAacAudio',
        )}
      </div>

      {#if isConverting}
        <div class="progress-block">
          <div class="phase">{progressLabel()}</div>
          <div class="progress-bar">
            <div class="progress-fill" style="width: {progressPct}%"></div>
          </div>
          <div class="progress-meta">
            <span>{progressPct}%</span>
            <span>{progressStageLabel()}</span>
          </div>
        </div>
      {/if}

      {#if errorMessage}
        <div class="error-box">
          <strong>{$t('mediaTools.converter.errors.failed')}</strong>
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
          <strong>{$t('mediaTools.converter.result.saved')}</strong>
          <span>{resultPath}</span>
          {#if resultUrl}
            <video src={resultUrl} controls muted></video>
          {/if}
        </div>
      {/if}

      <div class="actions">
        <button class="btn-secondary" onclick={closeModal} disabled={isConverting}>{$t('mediaTools.converter.result.close')}</button>
        {#if resultPath || outputPath}
          <button class="btn-secondary" onclick={revealResult} disabled={isConverting}>{$t('mediaTools.converter.result.reveal')}</button>
        {/if}
        {#if isConverting}
          <button class="btn-danger" onclick={cancelConversion} disabled={isCancelling}>
            {isCancelling ? $t('mediaTools.converter.progress.cancelling') : $t('mediaTools.converter.progress.cancel')}
          </button>
        {/if}
        <button class="btn-primary" onclick={startConversion} disabled={!canStart || isConverting}>
          {isConverting ? $t('mediaTools.converter.progress.converting') : $t('mediaTools.converter.result.convert')}
        </button>
      </div>
    </div>
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
    width: 600px;
    max-width: calc(100vw - 40px);
    max-height: calc(100vh - 80px);
    background: var(--bg-primary, #0a0a0c);
    border: 1px solid #2a2a30;
    border-radius: 8px;
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
    gap: 16px;
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
  .modal-head p {
    margin: 4px 0 0;
    color: var(--text-muted, #888);
    font-size: 11.5px;
  }
  .close-btn {
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
    flex: 0 0 auto;
  }
  .close-btn:hover:not(:disabled) { background: rgba(255,255,255,0.06); color: #fff; }
  .close-btn:disabled { opacity: 0.3; cursor: not-allowed; }
  .modal-body {
    padding: 18px;
    overflow-y: auto;
  }
  .mode-tabs {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    margin-bottom: 14px;
  }
  .mode-tabs button {
    height: 38px;
    border: 1px solid #2a2a30;
    background: #11141a;
    color: var(--text-secondary, #aaa);
    border-radius: 5px;
    font-weight: 700;
    cursor: pointer;
  }
  .mode-tabs button.active {
    color: #fff;
    border-color: rgba(76, 209, 255, 0.65);
    background: rgba(76, 209, 255, 0.12);
  }
  .drop-zone {
    width: 100%;
    min-height: 108px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 7px;
    padding: 18px;
    background: var(--bg-tertiary, #14141a);
    border: 1px dashed #3a3a44;
    border-radius: 7px;
    color: var(--text-primary, #ddd);
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
  }
  .drop-zone:hover:not(:disabled),
  .drop-zone.dragging {
    border-color: #4cd1ff;
    background: rgba(76, 209, 255, 0.08);
  }
  .drop-zone:disabled { cursor: not-allowed; opacity: 0.55; }
  .sequence-zone {
    border-style: solid;
  }
  .drop-title {
    max-width: 100%;
    overflow-wrap: anywhere;
    font-size: 14px;
    font-weight: 700;
  }
  .drop-meta {
    max-width: 100%;
    overflow-wrap: anywhere;
    font-size: 12px;
    color: var(--text-muted, #888);
  }
  .settings-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
    margin: 14px 0;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    color: var(--text-muted, #888);
    font-size: 11px;
  }
  .field input,
  .field select {
    height: 36px;
    border: 1px solid #2a2a30;
    background: #080a0d;
    color: #e5e7eb;
    border-radius: 4px;
    padding: 0 10px;
    font: inherit;
  }
  .path-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 10px;
    align-items: stretch;
    padding: 10px;
    border: 1px solid #242831;
    background: #0d1015;
    border-radius: 6px;
  }
  .path-row div {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .path-row span {
    color: var(--text-muted, #888);
    font-size: 11px;
  }
  .path-row strong {
    color: #d7dce4;
    font-size: 12px;
    font-weight: 500;
    overflow-wrap: anywhere;
  }
  .summary {
    background: rgba(76, 209, 255, 0.05);
    border-left: 2px solid rgba(76, 209, 255, 0.4);
    padding: 8px 12px;
    border-radius: 0 4px 4px 0;
    font-size: 12px;
    color: var(--text-secondary, #aaa);
    line-height: 1.5;
    margin: 14px 0;
  }
  .summary strong { color: #4cd1ff; }
  .progress-block {
    margin-top: 14px;
  }
  .phase {
    font-size: 14px;
    color: #4cd1ff;
    margin-bottom: 8px;
    font-weight: 500;
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
    background: linear-gradient(90deg, #4cd1ff, #49df93);
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
  .error-box,
  .notice-box,
  .success-box {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 14px;
    padding: 10px 12px;
    border-radius: 5px;
    font-size: 13px;
  }
  .error-box {
    background: rgba(255, 80, 80, 0.1);
    border: 1px solid rgba(255, 80, 80, 0.35);
    color: #ff9b9b;
  }
  .notice-box {
    background: rgba(76, 209, 255, 0.08);
    border: 1px solid rgba(76, 209, 255, 0.28);
    color: #9de7ff;
  }
  .success-box {
    background: rgba(76, 222, 128, 0.1);
    border: 1px solid rgba(76, 222, 128, 0.35);
    color: #86efac;
  }
  .success-box span {
    color: var(--text-secondary, #aaa);
    overflow-wrap: anywhere;
  }
  .success-box video {
    width: 100%;
    max-height: 220px;
    margin-top: 6px;
    border-radius: 5px;
    background: #000;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 18px;
  }
  .btn-primary,
  .btn-danger,
  .btn-secondary {
    min-height: 36px;
    padding: 8px 18px;
    border-radius: 5px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
  }
  .btn-primary {
    background: linear-gradient(135deg, #4cd1ff, #49df93);
    color: #071015;
    border: none;
  }
  .btn-primary:hover:not(:disabled) {
    filter: brightness(1.08);
  }
  .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn-danger {
    background: rgba(255, 80, 80, 0.12);
    border: 1px solid rgba(255, 80, 80, 0.42);
    color: #ff9b9b;
  }
  .btn-danger:hover:not(:disabled) {
    background: rgba(255, 80, 80, 0.2);
    border-color: rgba(255, 120, 120, 0.7);
    color: #ffd0d0;
  }
  .btn-danger:disabled { opacity: 0.45; cursor: wait; }
  .btn-secondary {
    background: transparent;
    border: 1px solid #2a2a30;
    color: var(--text-secondary, #aaa);
  }
  .btn-secondary:hover:not(:disabled) {
    border-color: #4cd1ff;
    color: #4cd1ff;
  }
  .btn-secondary:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
