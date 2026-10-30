<script lang="ts">
  import { onMount } from 'svelte';
  export let projectPath: string | null = null;
  export let exportProject: () => Promise<string>;
  export let applyProject: (json: string) => void;
  export let onClose: () => void;
  type Media = { id: string; name: string; path: string; missing: boolean; size: number; uses: number; icloud?: 'dataless' | 'placeholder' | null };
  let media: Media[] = [];
  let busy = false;
  let message = '';
  let error = '';
  let resultPath = '';
  const invoke = (command: string, args: any) => (window as any).electronAPI.invoke(command, args);
  async function scan() {
    busy = true; error = '';
    try { media = await invoke('project_media_scan', { json: await exportProject(), projectPath }); }
    catch (e: any) { error = e.message || String(e); }
    finally { busy = false; }
  }
  async function locate(item: Media) {
    busy = true; error = ''; message = '';
    try {
      const picked = await invoke('open_project_dialog', { title: `Locate ${item.name}`, filters: [{ name: 'Media files', extensions: ['*'] }] });
      if (picked.canceled || !picked.filePath) return;
      const result = await invoke('project_media_relink', { json: await exportProject(), projectPath, id: item.id, replacementPath: picked.filePath });
      applyProject(result.json);
      // Other missing files in the same folder are relinked with it.
      message = result.alsoFound
        ? `Media relinked, with ${result.alsoFound} other missing file${result.alsoFound === 1 ? '' : 's'} found in the same folder. Save the project to keep this.`
        : 'Media relinked. Save the project to keep this change.';
      media = await invoke('project_media_scan', { json: await exportProject(), projectPath });
    } catch (e: any) { error = e.message || String(e); }
    finally { busy = false; }
  }
  // iCloud keeps only a stub of a file it has not downloaded; this starts the
  // download. The list is checked again a little later.
  async function downloadFromIcloud(item: Media) {
    busy = true; error = ''; message = '';
    try {
      await invoke('media_icloud_download', { items: [{ file: item.path, state: item.icloud }] });
      message = `Downloading ${item.name} from iCloud. It shows as Available here once it is on this Mac.`;
      setTimeout(() => { if (!busy) void scan(); }, 4000);
    } catch (e: any) { error = e.message || String(e); }
    finally { busy = false; }
  }
  async function collect() {
    busy = true; error = ''; message = ''; resultPath = '';
    try {
      const picked = await invoke('save_project_dialog', { title: 'Collect project and media', defaultPath: 'Portable_Show.gha', filters: [{ name: 'Ghost Arcade Project', extensions: ['gha'] }] });
      if (picked.canceled || !picked.filePath) return;
      message = 'Copying media. Large shows may take a few minutes…';
      const result = await invoke('project_media_collect', { json: await exportProject(), projectPath, outputPath: picked.filePath });
      resultPath = result.outputPath;
      const missing = result.missing?.length ? ` ${result.missing.length} missing file${result.missing.length === 1 ? ' was' : 's were'} left out: ${result.missing.join(', ')}.` : '';
      const fonts = result.fonts?.length ? ` Fonts are not copied; the other computer needs ${result.fonts.join(', ')}.` : '';
      message = `Portable copy saved with ${result.filesCopied} media file${result.filesCopied === 1 ? '' : 's'}. Move the project and its Media folder together.${missing}${fonts}`;
    } catch (e: any) { message = ''; error = e.message || String(e); }
    finally { busy = false; }
  }
  onMount(scan);
</script>

<div data-help-page="projects" class="backdrop modal-backdrop">
  <section role="dialog" aria-modal="true" aria-labelledby="media-title" class="modal modal-panel">
    <header class="modal-header"><h2 id="media-title">Project media</h2><button class="close" disabled={busy} onclick={onClose} aria-label="Close media manager"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg></button></header>
    <div class="body">
      <p>Check local media, locate missing files, or collect a portable copy of this show.</p>
      <p class="hint">Relinking reloads the project and interrupts playback. Collecting leaves your current show open. Online media and live inputs still need their original connections.</p>
      <div class="summary">{media.length} local reference{media.length === 1 ? '' : 's'} · {media.filter(m => m.missing && !m.icloud).length} missing{media.some(m => m.icloud) ? ` · ${media.filter(m => m.icloud).length} in iCloud` : ''}</div>
      <div class="list">
        {#each media as item (item.id)}
          <div class="item">
            <div class="details"><strong>{item.name}</strong><span title={item.path}>{item.path || 'No saved location'}</span><small class:missing={item.missing && !item.icloud} class:icloud={!!item.icloud}>{item.icloud ? 'In iCloud, not downloaded' : item.missing ? 'Missing' : 'Available'} · {item.uses} reference{item.uses === 1 ? '' : 's'}</small></div>
            {#if item.icloud}
              <button class="row-btn" disabled={busy} onclick={() => downloadFromIcloud(item)}>Download</button>
            {:else}
              <button class="row-btn" disabled={busy} onclick={() => locate(item)}>{item.missing ? 'Locate…' : 'Replace…'}</button>
            {/if}
          </div>
        {:else}<p>{busy ? 'Checking media…' : 'No local media references in this project.'}</p>{/each}
      </div>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      {#if message}<p role="status">{message}</p>{/if}
      {#if resultPath}<p class="result">{resultPath}</p>{/if}
    </div>
    <footer><button class="secondary secondary-btn refresh" disabled={busy} onclick={scan}>Refresh</button><button class="secondary secondary-btn" disabled={busy} onclick={collect}>Collect project and media…</button><button class="primary primary-btn" disabled={busy} onclick={onClose}>Close</button></footer>
  </section>
</div>

<style>
  .backdrop { position: fixed; inset: 0; z-index: 1200; display: flex; align-items: center; justify-content: center; padding: 24px; }
  .backdrop {
    background: color-mix(in srgb, var(--ga-void, #0a0908) 76%, transparent);
    backdrop-filter: blur(8px);
  }
  .modal {
    width: min(760px, 92vw);
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
  .close {
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
  .close:hover:not(:disabled) {
    color: var(--ga-ink-0, #f2ede4);
    background: var(--ga-raise, #26221c);
    border-color: var(--ga-line-2, rgba(245, 236, 222, 0.13));
  }
  .close:disabled { opacity: 0.35; cursor: not-allowed; }
  .body { padding: 12px 16px; overflow-y: auto; }
  p { line-height: 1.5; margin: 6px 0; }
  .hint { color: var(--ga-ink-2, #89857e); font-size: var(--ga-text-meta); }
  .summary { margin: 16px 0 6px; color: var(--ga-ink-0, #f2ede4); font-weight: var(--ga-weight-control); }
  .list { max-height: 40vh; overflow: auto; border-top: 1px solid var(--ga-line-1, rgba(245, 236, 222, 0.07)); }
  .item { display: flex; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--ga-line-1, rgba(245, 236, 222, 0.07)); }
  .details { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .details strong { color: var(--ga-ink-0, #f2ede4); font-weight: var(--ga-weight-control); }
  .details span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ga-ink-2, #89857e); font-size: var(--ga-text-meta); }
  small { font-size: var(--ga-text-meta); color: var(--ga-green, #46d18a); }
  .missing, .error { color: #ffad9c; }
  .icloud { color: var(--ga-blue-300, #8aa4ff); }
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
  footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid var(--ga-line-1, rgba(245, 236, 222, 0.07));
  }
  footer { flex-wrap: wrap; }
  /* Refresh sits apart, on the left; the pair stays on the right. */
  .refresh { margin-right: auto; }
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
  .result { overflow-wrap: anywhere; color: var(--ga-ink-0, #f2ede4); font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace); font-size: var(--ga-text-meta); }
</style>
