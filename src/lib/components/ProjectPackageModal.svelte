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

<div data-help-page="projects" class="backdrop">
  <div role="dialog" aria-modal="true" aria-labelledby="package-title" class="modal">
    <header><h2 id="package-title">Export Package</h2></header>
    {#if phase === 'choosing'}
      <p>Choose where to save the package.</p>
    {:else if phase === 'packing'}
      <p>Packing the project and its media…</p>
      <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={percent}><span style="width:{percent}%"></span></div>
      <p class="detail">{percent}% · {size(progress.done)} of {size(progress.total)}{progress.file ? ` · ${progress.file.replace(/^Media\//, '')}` : ''}</p>
      <footer><button disabled={cancelling} onclick={cancel}>{cancelling ? 'Cancelling…' : 'Cancel'}</button></footer>
    {:else if phase === 'done' && result}
      <p>Packed with the project: {result.files} {result.files === 1 ? 'media file' : 'media files'} ({size(result.bytes)}).</p>
      <p class="result">{result.outputPath}</p>
      <p class="hint">On the other computer, choose File → Open Package…, or unzip it and open the project inside.</p>
      {#if result.missing.length}
        <p class="warn">Not in the package, because they could not be found:</p>
        <ul>{#each result.missing as name}<li>{name}</li>{/each}</ul>
      {/if}
      {#if result.fonts.length}
        <p class="hint">Fonts are not packed. Install these on the other computer: {result.fonts.join(', ')}.</p>
      {/if}
      <footer><button onclick={onClose}>Done</button></footer>
    {:else}
      <p class="error" role="alert">{error}</p>
      <footer><button onclick={onClose}>Close</button></footer>
    {/if}
  </div>
</div>

<style>
  .backdrop { position:fixed; inset:0; z-index:1200; background:#000b; display:flex; align-items:center; justify-content:center; }
  .modal { width:min(560px,92vw); max-height:88vh; overflow:auto; background:#191b20; border:1px solid #42464f; border-radius:12px; padding:22px; color:#e6e8ef; font-size:13px; }
  h2 { margin:0 0 6px; font-size:20px; }
  p { line-height:1.5; margin:10px 0; } .hint, .detail { color:#aaaeb9; } .warn, .error { color:#ffad9c; }
  .result { overflow-wrap:anywhere; color:var(--ga-blue-200); }
  ul { margin:4px 0 0; padding-left:18px; max-height:22vh; overflow:auto; color:#d8dbe3; }
  .bar { height:8px; border-radius:4px; background:#2c2f37; overflow:hidden; margin-top:14px; }
  .bar span { display:block; height:100%; background:var(--ga-blue-400, #5b8cff); transition:width .15s linear; }
  footer { display:flex; justify-content:flex-end; margin-top:18px; }
  button { border:1px solid #4c5260; background:var(--ga-blue-mute-800); color:inherit; border-radius:6px; padding:8px 12px; cursor:pointer; }
  button:disabled { opacity:.45; cursor:default; }
</style>
