<script lang="ts">
  import {
    cancelActiveVideoConversion,
    convertWebMToMp4,
    isVideoConversionCancelled,
    type VideoConversionProgress,
  } from '../video/videoConverter';

  export let isOpen = false;
  export let onClose: () => void = () => {};

  let fileInput: HTMLInputElement | null = null;
  let selectedFile: File | null = null;
  let resultBlob: Blob | null = null;
  let resultUrl: string | null = null;
  let resultName = '';
  let errorMessage = '';
  let noticeMessage = '';
  let isDragging = false;
  let isConverting = false;
  let isCancelling = false;
  let progress: VideoConversionProgress = { stage: 'idle', progress: 0, message: '' };

  $: progressPct = Math.round((progress.progress || 0) * 100);

  function resetResult() {
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultBlob = null;
    resultUrl = null;
    resultName = '';
  }

  function resetAll() {
    selectedFile = null;
    errorMessage = '';
    noticeMessage = '';
    progress = { stage: 'idle', progress: 0, message: '' };
    isDragging = false;
    isCancelling = false;
    resetResult();
    if (fileInput) fileInput.value = '';
  }

  function closeModal() {
    if (isConverting) return;
    resetAll();
    onClose();
  }

  function pickFile() {
    if (isConverting) return;
    fileInput?.click();
  }

  function chooseFile(file: File | null | undefined) {
    if (!file || isConverting) return;
    resetResult();
    errorMessage = '';
    noticeMessage = '';
    progress = { stage: 'idle', progress: 0, message: '' };
    selectedFile = file;
  }

  function onFileInput(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    chooseFile(input.files?.[0]);
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    isDragging = false;
    chooseFile(event.dataTransfer?.files?.[0]);
  }

  function onDragOver(event: DragEvent) {
    event.preventDefault();
    if (!isConverting) isDragging = true;
  }

  function onDragLeave() {
    isDragging = false;
  }

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function downloadAgain() {
    if (resultBlob && resultName) downloadBlob(resultBlob, resultName);
  }

  function cancelConversion() {
    if (!isConverting || isCancelling) return;
    isCancelling = true;
    errorMessage = '';
    noticeMessage = '';
    progress = {
      stage: 'cancelled',
      progress: progress.progress,
      message: 'Cancelling conversion...',
    };
    if (!cancelActiveVideoConversion()) {
      isConverting = false;
      isCancelling = false;
      noticeMessage = 'Conversion cancelled.';
    }
  }

  async function startConversion() {
    if (!selectedFile || isConverting) return;
    resetResult();
    errorMessage = '';
    noticeMessage = '';
    isCancelling = false;
    isConverting = true;
    progress = { stage: 'loading', progress: 0, message: 'Loading FFmpeg encoder...' };

    try {
      const result = await convertWebMToMp4(selectedFile, (p) => {
        progress = p;
      });
      resultBlob = result.blob;
      resultName = result.filename;
      resultUrl = URL.createObjectURL(result.blob);
      downloadBlob(result.blob, result.filename);
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

  function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
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
  <div class="modal-backdrop" onclick={closeModal} role="presentation"></div>
  <div class="modal-shell" role="dialog" aria-label="Video Converter">
    <header class="modal-head">
      <h2>Video Converter</h2>
      <button class="close-btn" onclick={closeModal} disabled={isConverting} title={isConverting ? 'Conversion is running' : 'Close'}>×</button>
    </header>

    <div class="modal-body">
      <p class="lede">Convert WebM videos to high-quality MP4 for proposals, client review, and playback tools that prefer H.264.</p>

      <button
        class="drop-zone"
        class:dragging={isDragging}
        onclick={pickFile}
        ondrop={onDrop}
        ondragover={onDragOver}
        ondragleave={onDragLeave}
        disabled={isConverting}
      >
        <span class="drop-title">{selectedFile ? selectedFile.name : 'Choose WebM Video'}</span>
        <span class="drop-meta">
          {#if selectedFile}
            {formatBytes(selectedFile.size)}
          {:else}
            Drop a .webm file here or browse
          {/if}
        </span>
      </button>

      <input
        bind:this={fileInput}
        type="file"
        accept="video/webm,.webm"
        onchange={onFileInput}
        style="display: none"
      />

      <div class="summary">
        Output: <strong>MP4 / H.264</strong> at CRF 18, <strong>yuv420p</strong>, <strong>+faststart</strong>, with AAC audio when present.
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
          <p class="hint">FFmpeg runs locally in the app. Large files can take a while; keep Ghost Arcade open.</p>
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

      {#if resultUrl && resultName}
        <div class="success-box">
          <strong>MP4 ready</strong>
          <span>{resultName}</span>
          <video src={resultUrl} controls muted></video>
        </div>
      {/if}

      <div class="actions">
        <button class="btn-secondary" onclick={closeModal} disabled={isConverting}>Close</button>
        {#if isConverting}
          <button class="btn-danger" onclick={cancelConversion} disabled={isCancelling}>
            {isCancelling ? 'Cancelling...' : 'Cancel'}
          </button>
        {/if}
        {#if resultBlob}
          <button class="btn-secondary" onclick={downloadAgain}>Download Again</button>
        {/if}
        <button class="btn-primary" onclick={startConversion} disabled={!selectedFile || isConverting}>
          {isConverting ? 'Converting...' : 'Convert to MP4'}
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
    width: 520px;
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
    font-size: 14px;
    letter-spacing: 2px;
    color: #4cd1ff;
    font-weight: 600;
  }
  .close-btn {
    width: 32px;
    height: 32px;
    border: 1px solid var(--border-secondary, #2a2a30);
    background: transparent;
    color: var(--text-secondary, #aaa);
    border-radius: 4px;
    font-size: 18px;
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
  .lede {
    color: var(--text-secondary, #aaa);
    font-size: 12px;
    margin: 0 0 16px;
    line-height: 1.5;
  }
  .drop-zone {
    width: 100%;
    min-height: 116px;
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
  .drop-title {
    max-width: 100%;
    overflow-wrap: anywhere;
    font-size: 13px;
    font-weight: 700;
  }
  .drop-meta {
    font-size: 11px;
    color: var(--text-muted, #888);
  }
  .summary {
    background: rgba(76, 209, 255, 0.05);
    border-left: 2px solid rgba(76, 209, 255, 0.4);
    padding: 8px 12px;
    border-radius: 0 4px 4px 0;
    font-size: 11px;
    color: var(--text-secondary, #aaa);
    line-height: 1.5;
    margin: 14px 0;
  }
  .summary strong { color: #4cd1ff; }
  .progress-block {
    margin-top: 14px;
  }
  .phase {
    font-size: 13px;
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
    background: linear-gradient(90deg, #4cd1ff, #6f5cff);
    transition: width 0.15s ease-out;
  }
  .progress-meta {
    display: flex;
    justify-content: space-between;
    margin-top: 6px;
    font-size: 11px;
    font-family: monospace;
    color: var(--text-muted, #888);
  }
  .hint {
    color: #666;
    font-size: 10.5px;
    line-height: 1.5;
    margin: 10px 0 0;
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
    font-size: 12px;
  }
  .error-box {
    background: rgba(255, 80, 80, 0.10);
    border: 1px solid rgba(255, 80, 80, 0.35);
    color: #ff9b9b;
  }
  .notice-box {
    background: rgba(76, 209, 255, 0.08);
    border: 1px solid rgba(76, 209, 255, 0.28);
    color: #9de7ff;
  }
  .success-box {
    background: rgba(76, 222, 128, 0.10);
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
