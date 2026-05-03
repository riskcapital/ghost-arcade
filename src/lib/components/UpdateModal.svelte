<script lang="ts">
  /**
   * UpdateModal — shown when a newer release is available.
   *
   * Three-state flow:
   *   1. idle       — show release notes + "Download & Install" button
   *   2. downloading — disable button, show indeterminate spinner + "Downloading..."
   *   3. ready      — button becomes "Install Now" → launches installer + quits app
   *
   * Falls back to opening the release page in a browser tab if not in Electron.
   */

  import { onMount, onDestroy } from 'svelte';
  import { updateInfo } from '../stores/updateChecker';

  export let open = false;
  export let onClose: () => void = () => {};

  type State = 'idle' | 'downloading' | 'ready' | 'failed';
  let state: State = 'idle';
  let installerPath: string = '';
  let errorMessage: string = '';
  let progressPercent: number = -1;          // -1 = indeterminate
  let progressText: string = '';
  let cleanupProgressListener: (() => void) | null = null;

  function isElectron(): boolean {
    return typeof window !== 'undefined' && !!(window as any).__ELECTRON__;
  }

  function platformDownloadUrl(): string | undefined {
    const urls = $updateInfo.downloadUrls;
    if (!urls) return undefined;
    // Best guess for current platform
    if (isElectron()) {
      const platform = (window as any).electronAPI?.platform;
      if (platform === 'win32') return urls.windows;
      if (platform === 'darwin') {
        // Prefer arm64 — Apple Silicon is the more common case in 2026
        return urls.macArm || urls.macIntel;
      }
    }
    return urls.windows || urls.macArm || urls.macIntel;
  }

  async function startDownload() {
    const url = platformDownloadUrl();
    if (!url) {
      errorMessage = 'No download URL available for your platform';
      state = 'failed';
      return;
    }
    if (!isElectron()) {
      // Browser fallback — just open the URL in a new tab
      window.open(url, '_blank');
      return;
    }
    const api = (window as any).electronAPI;
    if (!api?.invoke) {
      window.open(url, '_blank');
      return;
    }

    state = 'downloading';
    errorMessage = '';
    progressPercent = -1;
    progressText = 'Starting...';

    // Listen for progress events (cleaned up on modal close)
    if (api.on) {
      cleanupProgressListener = api.on('update-download-progress', (data: { received: number; total: number; percent: number }) => {
        progressPercent = data.percent;
        const recvMb = (data.received / 1024 / 1024).toFixed(1);
        if (data.total > 0) {
          const totalMb = (data.total / 1024 / 1024).toFixed(0);
          progressText = `${recvMb} / ${totalMb} MB`;
        } else {
          progressText = `${recvMb} MB`;
        }
      });
    }

    try {
      const result = await api.invoke('download_update_installer', { url });
      if (!result?.success) {
        errorMessage = result?.error || 'Download failed';
        state = 'failed';
        return;
      }
      installerPath = result.path;
      state = 'ready';
    } catch (e: any) {
      errorMessage = e?.message || String(e);
      state = 'failed';
    } finally {
      if (cleanupProgressListener) {
        cleanupProgressListener();
        cleanupProgressListener = null;
      }
    }
  }

  async function launchInstaller() {
    if (!installerPath) return;
    const api = (window as any).electronAPI;
    if (!api?.invoke) return;
    try {
      const result = await api.invoke('launch_update_installer', { path: installerPath });
      if (!result?.success) {
        errorMessage = `Failed to launch: ${result?.error || 'unknown error'}`;
        state = 'failed';
      }
      // On success, the app will quit ~500ms later (handled in main process)
    } catch (e: any) {
      errorMessage = e?.message || String(e);
      state = 'failed';
    }
  }

  function close() {
    if (state === 'downloading') return; // don't allow close mid-download
    if (cleanupProgressListener) {
      cleanupProgressListener();
      cleanupProgressListener = null;
    }
    onClose();
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
  }

  onDestroy(() => {
    if (cleanupProgressListener) cleanupProgressListener();
  });
</script>

<svelte:window onkeydown={handleKey} />

{#if open}
  <div class="update-modal-backdrop" onclick={close}>
    <div class="update-modal" onclick={(e) => e.stopPropagation()}>
      <div class="update-modal-header">
        <div>
          <div class="update-eyebrow">Update available</div>
          <h2>Ghost Arcade v{$updateInfo.latestVersion}</h2>
          <p class="update-version-line">You have v{$updateInfo.currentVersion}</p>
        </div>
        <button class="update-close" onclick={close} disabled={state === 'downloading'} aria-label="Close">×</button>
      </div>

      <div class="update-modal-body">
        {#if state === 'idle' || state === 'failed'}
          {#if $updateInfo.releaseNotes}
            <h3 class="update-notes-heading">What's new</h3>
            <pre class="update-notes">{$updateInfo.releaseNotes}</pre>
          {:else}
            <p class="update-no-notes">No release notes available.</p>
          {/if}
          {#if errorMessage}
            <div class="update-error">
              <strong>Error:</strong> {errorMessage}
            </div>
          {/if}
        {:else if state === 'downloading'}
          <div class="update-progress">
            <div class="update-spinner" aria-hidden="true"></div>
            <div class="update-progress-label">Downloading installer…</div>
            <div class="update-progress-meta">{progressText}</div>
          </div>
        {:else if state === 'ready'}
          <div class="update-progress">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin: 0 auto 16px; display: block;">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            <div class="update-progress-label">Download complete</div>
            <p class="update-ready-hint">Click Install Now to launch the installer. Ghost Arcade will close so the upgrade can complete.</p>
          </div>
        {/if}
      </div>

      <div class="update-modal-footer">
        {#if state === 'idle' || state === 'failed'}
          {#if $updateInfo.releaseUrl}
            <a class="update-link" href={$updateInfo.releaseUrl} target="_blank" rel="noopener">View on GitHub →</a>
          {/if}
          <button class="update-secondary" onclick={close}>Maybe Later</button>
          <button class="update-primary" onclick={startDownload} disabled={!platformDownloadUrl()}>
            {state === 'failed' ? 'Retry Download' : 'Download & Install'}
          </button>
        {:else if state === 'downloading'}
          <button class="update-secondary" disabled>Downloading…</button>
        {:else if state === 'ready'}
          <button class="update-secondary" onclick={close}>Install Later</button>
          <button class="update-primary" onclick={launchInstaller}>Install Now</button>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .update-modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 9999;
    background: rgba(10, 10, 10, 0.85);
    backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }

  .update-modal {
    background: #14141a;
    border: 1px solid rgba(126, 200, 227, 0.18);
    border-radius: 8px;
    width: 100%;
    max-width: 580px;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  }

  .update-modal-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    padding: 24px 28px 16px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .update-eyebrow {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: #7EC8E3;
    margin-bottom: 4px;
  }

  .update-modal-header h2 {
    font-size: 22px;
    font-weight: 600;
    margin: 0 0 4px;
    color: #fff;
  }

  .update-version-line {
    font-size: 12px;
    color: #888;
    margin: 0;
  }

  .update-close {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.06);
    border: none;
    color: #aaa;
    font-size: 22px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
  }
  .update-close:hover:not(:disabled) {
    background: rgba(255, 50, 50, 0.25);
    color: #fff;
  }
  .update-close:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .update-modal-body {
    padding: 16px 28px;
    overflow-y: auto;
    flex: 1;
  }

  .update-notes-heading {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #aaa;
    margin: 0 0 10px;
  }

  .update-notes {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 13px;
    line-height: 1.5;
    color: #d4d4d4;
    white-space: pre-wrap;
    margin: 0 0 16px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 6px;
    padding: 14px 16px;
  }

  .update-no-notes {
    font-size: 13px;
    color: #777;
    font-style: italic;
    margin: 0;
  }

  .update-error {
    margin-top: 12px;
    padding: 10px 12px;
    border-radius: 6px;
    background: rgba(255, 50, 50, 0.1);
    border: 1px solid rgba(255, 50, 50, 0.25);
    color: #ff8c7c;
    font-size: 13px;
  }

  .update-progress {
    text-align: center;
    padding: 24px 0 12px;
  }

  .update-spinner {
    width: 40px;
    height: 40px;
    margin: 0 auto 16px;
    border: 3px solid rgba(255, 255, 255, 0.08);
    border-top-color: #7EC8E3;
    border-right-color: #FF8577;
    border-radius: 50%;
    animation: update-spin 0.9s linear infinite;
  }
  @keyframes update-spin { to { transform: rotate(360deg); } }

  .update-progress-label {
    font-size: 14px;
    font-weight: 500;
    color: #fff;
    margin-bottom: 6px;
  }

  .update-progress-meta {
    font-size: 12px;
    color: #888;
    font-variant-numeric: tabular-nums;
  }

  .update-ready-hint {
    font-size: 12px;
    color: #888;
    margin: 12px auto 0;
    max-width: 360px;
    line-height: 1.5;
  }

  .update-modal-footer {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 16px 28px;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }

  .update-link {
    color: #7EC8E3;
    font-size: 12px;
    text-decoration: none;
    margin-right: auto;
  }
  .update-link:hover { text-decoration: underline; }

  .update-secondary {
    padding: 8px 16px;
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 4px;
    color: #aaa;
    font-size: 13px;
    cursor: pointer;
    transition: all 0.15s;
  }
  .update-secondary:hover:not(:disabled) {
    border-color: rgba(255, 255, 255, 0.3);
    color: #fff;
  }
  .update-secondary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .update-primary {
    padding: 8px 18px;
    background: linear-gradient(90deg, #FF8577, #7EC8E3);
    border: none;
    border-radius: 4px;
    color: #0a0a0a;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }
  .update-primary:hover:not(:disabled) {
    filter: brightness(1.1);
    transform: translateY(-1px);
  }
  .update-primary:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
