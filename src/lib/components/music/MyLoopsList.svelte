<script lang="ts">
  /**
   * My loops: the loops saved from the live looper, in every project.
   * Each can go on a loop track (it plays from there) or into the session
   * grid (MIDI), be renamed in place, or deleted (a second press confirms).
   */
  import { onMount } from 'svelte';
  import { deleteUserLoop, refreshUserLoops, renameUserLoop, userLoops, type UserLoopEntry } from '../../music/userLoops';
  import { insertUserLoopInSession, loadUserLoopToTrack } from '../../music/loopStation';
  import { showToast } from '../../stores/errorToast';

  let { query = '', onadded }: { query?: string; onadded?: () => void } = $props();

  let confirmDelete = $state<string | null>(null);
  let error = $state<string | null>(null);

  onMount(() => {
    refreshUserLoops().catch((err) => (error = err instanceof Error ? err.message : String(err)));
  });

  const shown = $derived($userLoops.filter((l) => !query.trim() || l.name.toLowerCase().includes(query.trim().toLowerCase())));

  async function toTrack(l: UserLoopEntry) {
    const i = await loadUserLoopToTrack(l.id).catch(() => -1);
    if (i < 0) showToast('No empty loop track for it. Clear a track first.', 'info');
    else onadded?.();
  }

  async function toSession(l: UserLoopEntry) {
    if (await insertUserLoopInSession(l.id).catch(() => false)) onadded?.();
  }

  async function rename(l: UserLoopEntry, name: string) {
    if (!name.trim() || name.trim() === l.name) return;
    await renameUserLoop(l.id, name.trim()).catch((err) => showToast(`Could not rename: ${err instanceof Error ? err.message : String(err)}`, 'error'));
  }

  async function remove(l: UserLoopEntry) {
    if (confirmDelete !== l.id) {
      confirmDelete = l.id;
      return;
    }
    confirmDelete = null;
    await deleteUserLoop(l.id).catch((err) => showToast(`Could not delete: ${err instanceof Error ? err.message : String(err)}`, 'error'));
  }
</script>

<div class="mine" role="list" aria-label="My loops">
  {#if error}<p class="empty">{error}</p>{/if}
  {#each shown as l (l.id)}
    <div class="row" role="listitem">
      <span class="kind" class:audio={l.kind === 'audio'}>{l.kind === 'audio' ? 'Audio' : 'MIDI'}</span>
      <input class="name" value={l.name} aria-label="Loop name" onchange={(e) => rename(l, (e.currentTarget as HTMLInputElement).value)} onkeydown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()} />
      <span class="meta">{l.bars} bar{l.bars === 1 ? '' : 's'} · {Math.round(l.bpm)} BPM{l.kind === 'midi' ? ` · ${l.noteCount} notes` : ''}</span>
      <button class="text-btn small" onclick={() => toTrack(l)} title="Put it on a loop track and play it">To track</button>
      {#if l.kind === 'midi'}<button class="text-btn small" onclick={() => toSession(l)} title="Add it to the session grid as a clip">To session</button>{/if}
      <button class="text-btn small" class:danger={confirmDelete === l.id} onclick={() => remove(l)} title="Delete it from My loops">{confirmDelete === l.id ? 'Delete?' : 'Delete'}</button>
    </div>
  {:else}
    <p class="empty">No loops saved yet. Record a loop, then press Save on its track.</p>
  {/each}
</div>

<style>
  .mine { display: flex; flex-direction: column; overflow: auto; min-height: 0; }
  .row { display: flex; align-items: center; gap: 8px; padding: 6px 4px; border-bottom: 1px solid var(--studio-edge-soft); }
  .kind { flex: 0 0 42px; font-size: var(--ga-text-meta, 11px); color: var(--studio-accent); }
  .kind.audio { color: var(--studio-rec, #ff6b57); }
  .name { flex: 1 1 200px; min-width: 0; height: var(--ga-control-h, 26px); padding: 0 6px; border: 1px solid transparent; background: transparent; color: var(--studio-ink); border-radius: var(--studio-radius); font: inherit; }
  .name:hover, .name:focus { border-color: var(--studio-edge); background: var(--studio-slot); }
  .meta { flex: 0 1 auto; font-size: var(--ga-text-meta, 11px); color: var(--studio-muted); white-space: nowrap; }
  .danger { color: var(--studio-rec, #ff6b57); border-color: var(--studio-rec, #ff6b57); }
  .empty { margin: 8px 4px; font-size: var(--ga-text-meta, 11px); color: var(--studio-muted); }
</style>
