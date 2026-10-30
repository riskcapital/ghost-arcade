<script lang="ts">
  /**
   * Export Package: the show and all its media in one .zip. Asks where to
   * save, shows progress while the media is packed (it can be cancelled),
   * then what went in and what the other computer still needs.
   */
  import { onDestroy, onMount } from 'svelte';
  export let projectPath: string | null = null;
  export let projectName = 'Project';
  export let exportProject: () => Promise<string>;
  export let onClose: () => void;

  type Result = { outputPath: string; files: number; bytes: number; missing: string[]; fonts: string[] };
  let phase: 'choosing' | 'packing' | 'done' | 'error' = 'choosing';
  let progress = { done: 0, total: 0, file: '' as string | null };
  let result: Result | null = null;
  let error = '';
  let cancelling = false;
  const api = (window as any).electronAPI;
  let stopProgress: (() => void) | null = null;

  const size = (bytes: number) => {
    if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
    if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
    return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
  };
  $: percent = progress.total ? Math.min(100, Math.floor((progress.done / progress.total) * 100)) : 0;

  async function run() {
    stopProgress = api.on?.('project-package-progress', (p: typeof progress) => { phase = 'packing'; progress = p; }) ?? null;
    try {
      const json = await exportProject();
      const answer = await api.invoke('export_project_package', { json, projectPath, projectName });
      if (answer?.canceled) { onClose(); return; }
      result = answer;
      phase = 'done';
    } catch (e: any) {
      error = e?.message || String(e);
      phase = 'error';
    } finally {
      stopProgress?.();
      stopProgress = null;
    }
  }
  async function cancel() {
    cancelling = true;
    await api.invoke('cancel_project_package').catch(() => {});
  }
  onMount(run);
  onDestroy(() => stopProgress?.());
</script>

<div data-help-page="projects" class="backdrop modal-backdrop">
  <div role="dialog" aria-modal="true" aria-labelledby="package-title" class="modal modal-panel">
    <header class="modal-header"><h2 id="package-title">Export package</h2></header>
    {#if phase === 'choosing'}
      <div class="body"><p>Choose where to save the package.</p></div>
    {:else if phase === 'packing'}
      <div class="body">
        <p>Packing the project and its media…</p>
        <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={percent}><span style="width:{percent}%"></span></div>
        <p class="detail">{percent}% · {size(progress.done)} of {size(progress.total)}{progress.file ? ` · ${progress.file.replace(/^Media\//, '')}` : ''}</p>
      </div>
      <footer><button class="secondary secondary-btn" disabled={cancelling} onclick={cancel}>{cancelling ? 'Cancelling…' : 'Cancel'}</button></footer>
    {:else if phase === 'done' && result}
      <div class="body">
        <p>Packed with the project: {result.files} {result.files === 1 ? 'media file' : 'media files'} ({size(result.bytes)}).</p>
        <p class="result">{result.outputPath}</p>
        <p class="hint">On the other computer, choose File → Open package…, or unzip it and open the project inside.</p>
        {#if result.missing.length}
          <p class="warn">Not in the package, because they could not be found:</p>
          <ul>{#each result.missing as name}<li>{name}</li>{/each}</ul>
        {/if}
        {#if result.fonts.length}
          <p class="hint">Fonts are not packed. Install these on the other computer: {result.fonts.join(', ')}.</p>
        {/if}
      </div>
      <footer><button class="primary primary-btn" onclick={onClose}>Done</button></footer>
    {:else}
      <div class="body"><p class="error" role="alert">{error}</p></div>
      <footer><button class="secondary secondary-btn" onclick={onClose}>Close</button></footer>
    {/if}
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; z-index: 1200; display: flex; align-items: center; justify-content: center; padding: 24px; }
  .backdrop {
    background: color-mix(in srgb, var(--ga-void, #0a0908) 76%, transparent);
    backdrop-filter: blur(8px);
  }
  .modal {
    width: min(560px, 92vw);
    max-height: 88vh;
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
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--ga-line-1, rgba(245, 236, 222, 0.07));
  }
  h2 {
    margin: 0;
    font-size: var(--ga-text-heading);
    font-weight: var(--ga-weight-title);
    line-height: 1.3;
    letter-spacing: 0;
    text-transform: none;
    color: var(--ga-ink-0, #f2ede4);
  }
  .body { padding: 12px 16px; overflow-y: auto; }
  p { line-height: 1.5; margin: 6px 0; }
  .hint, .detail { color: var(--ga-ink-2, #89857e); font-size: var(--ga-text-meta); }
  .warn, .error { color: #ffad9c; }
  .result { overflow-wrap: anywhere; color: var(--ga-ink-0, #f2ede4); font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace); font-size: var(--ga-text-meta); }
  ul { margin: 4px 0 0; padding-left: 18px; max-height: 22vh; overflow: auto; color: var(--ga-ink-1, #ada9a2); }
  .bar { height: 6px; border-radius: 3px; background: var(--ga-slot, #060504); border: 1px solid var(--ga-line-1, rgba(245, 236, 222, 0.07)); overflow: hidden; margin-top: 12px; }
  .bar span { display: block; height: 100%; background: var(--ga-selection-line, #5278ff); transition: width .15s linear; }
  footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid var(--ga-line-1, rgba(245, 236, 222, 0.07));
  }
  .secondary,
  .primary {
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
  .secondary {
    background: var(--ga-raise, #26221c);
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    color: var(--ga-ink-1, #ada9a2);
  }
  .secondary:hover:not(:disabled) {
    color: var(--ga-ink-0, #f2ede4);
    border-color: var(--ga-line-3, rgba(245, 236, 222, 0.24));
  }
  .primary {
    background: var(--ga-ink-0, #f2ede4);
    border: 1px solid var(--ga-ink-0, #f2ede4);
    color: var(--ga-void, #0a0908);
  }
  .primary:hover:not(:disabled) { filter: brightness(1.06); }
  .secondary:disabled,
  .primary:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
