<script lang="ts">
  import { onMount } from 'svelte';
  export let projectPath: string | null = null;
  export let exportProject: () => Promise<string>;
  export let applyProject: (json: string) => void;
  export let onClose: () => void;
  type Media = { id: string; name: string; path: string; missing: boolean; size: number; uses: number };
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
      const json = await invoke('project_media_relink', { json: await exportProject(), projectPath, id: item.id, replacementPath: picked.filePath });
      applyProject(json);
      message = 'Media relinked. Save the project to keep this change.';
      media = await invoke('project_media_scan', { json: await exportProject(), projectPath });
    } catch (e: any) { error = e.message || String(e); }
    finally { busy = false; }
  }
  async function collect() {
    busy = true; error = ''; message = ''; resultPath = '';
    try {
      const picked = await invoke('save_project_dialog', { title: 'Collect Project and Media', defaultPath: 'Portable_Show.gha', filters: [{ name: 'Ghost Arcade Project', extensions: ['gha'] }] });
      if (picked.canceled || !picked.filePath) return;
      message = 'Copying media. Large shows may take a few minutes…';
      const result = await invoke('project_media_collect', { json: await exportProject(), projectPath, outputPath: picked.filePath });
      resultPath = result.outputPath;
      message = `Portable copy saved with ${result.filesCopied} media file${result.filesCopied === 1 ? '' : 's'}. Move the project and its Media folder together.`;
    } catch (e: any) { message = ''; error = e.message || String(e); }
    finally { busy = false; }
  }
  onMount(scan);
</script>

<div data-help-page="projects" class="backdrop">
  <section role="dialog" aria-modal="true" aria-labelledby="media-title" class="modal">
    <header><h2 id="media-title">Project Media</h2><button disabled={busy} onclick={onClose} aria-label="Close media manager">×</button></header>
    <p>Check local media, locate missing files, or collect a portable copy of this show.</p>
    <p class="hint">Relinking reloads the project and interrupts playback. Collecting leaves your current show open. Online media and live inputs still need their original connections.</p>
    <div class="summary">{media.length} local reference{media.length === 1 ? '' : 's'} · {media.filter(m => m.missing).length} missing</div>
    <div class="list">
      {#each media as item (item.id)}
        <div class="item">
          <div class="details"><strong>{item.name}</strong><span title={item.path}>{item.path || 'No saved location'}</span><small class:missing={item.missing}>{item.missing ? 'Missing' : 'Available'} · {item.uses} reference{item.uses === 1 ? '' : 's'}</small></div>
          <button disabled={busy} onclick={() => locate(item)}>{item.missing ? 'Locate…' : 'Replace…'}</button>
        </div>
      {:else}<p>{busy ? 'Checking media…' : 'No local media references in this project.'}</p>{/each}
    </div>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if message}<p role="status">{message}</p>{/if}
    {#if resultPath}<p class="result">{resultPath}</p>{/if}
    <footer><button disabled={busy} onclick={scan}>Refresh</button><button disabled={busy || media.some(m => m.missing)} onclick={collect}>Collect project and media…</button><button disabled={busy} onclick={onClose}>Close</button></footer>
  </section>
</div>

<style>
  .backdrop { position:fixed; inset:0; z-index:1200; background:#000b; display:flex; align-items:center; justify-content:center; }
  .modal { width:min(760px,92vw); max-height:88vh; overflow:auto; background:#191b20; border:1px solid #42464f; border-radius:12px; padding:22px; color:#e6e8ef; font-size:13px; }
  header, footer, .item { display:flex; align-items:center; gap:12px; }
  header { justify-content:space-between; } h2 { margin:0; font-size:20px; }
  p { line-height:1.5; } .hint { color:#aaaeb9; } .summary { margin:18px 0 8px; }
  .list { max-height:40vh; overflow:auto; border-top:1px solid #363941; }
  .item { padding:12px 0; border-bottom:1px solid #363941; }
  .details { flex:1; min-width:0; display:flex; flex-direction:column; gap:5px; }
  .details span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#9da4b4; }
  small { color:#8ccca4; } .missing,.error { color:#ffad9c; }
  button { border:1px solid #4c5260; background:#292e38; color:inherit; border-radius:6px; padding:8px 12px; cursor:pointer; }
  button:disabled { opacity:.45; cursor:default; } footer { margin-top:18px; flex-wrap:wrap; justify-content:flex-end; }
  .result { overflow-wrap:anywhere; color:#a5caff; }
</style>
