<script lang="ts">
  /**
   * SnapshotBank — 16-slot bank of live-state snapshots.
   *
   * Each slot holds a complete capture of: per-layer opacity / blend / solo
   * / mute (both decks), crossfader state, quantization, master opacity,
   * macro values. Click a populated slot to recall it; shift-click any
   * slot to overwrite with current state; right-click for the action menu.
   *
   * Renders as a tight icon-grid that floats over the VJ overlay, anchored
   * to the bottom-right. Collapsible to a single launcher button when not
   * in use, so it stays out of the way during normal play.
   */
  import { snapshots } from '../stores/snapshots';

  export let placement: 'floating' | 'inline' = 'floating';

  let expanded = false;

  function handleClick(idx: number, e: MouseEvent) {
    if (e.shiftKey) {
      // Shift-click = save current state to this slot
      snapshots.save(idx);
      return;
    }
    snapshots.recall(idx);
  }

  function handleContext(e: MouseEvent, idx: number) {
    e.preventDefault();
    ctxIndex = idx;
    ctxX = e.clientX;
    ctxY = e.clientY;
  }

  let ctxIndex: number | null = null;
  let ctxX = 0;
  let ctxY = 0;
  let ctxEl: HTMLDivElement | null = null;

  let renamingIdx: number | null = null;
  let renameDraft = '';

  function closeCtx() { ctxIndex = null; }
  function ctxSave() {
    if (ctxIndex !== null) snapshots.save(ctxIndex);
    closeCtx();
  }
  function ctxRecall() {
    if (ctxIndex !== null) snapshots.recall(ctxIndex);
    closeCtx();
  }
  function ctxClear() {
    if (ctxIndex !== null && confirm('Clear this snapshot?')) snapshots.clear(ctxIndex);
    closeCtx();
  }
  function ctxRename() {
    if (ctxIndex !== null) {
      renamingIdx = ctxIndex;
      renameDraft = $snapshots.snapshots[ctxIndex]?.name || '';
    }
    closeCtx();
  }
  function commitRename() {
    if (renamingIdx !== null && renameDraft.trim()) {
      snapshots.rename(renamingIdx, renameDraft.trim().slice(0, 18));
    }
    renamingIdx = null;
  }

  function onWindowClick(e: MouseEvent) {
    if (ctxIndex === null) return;
    const t = e.target as Node;
    if (ctxEl && !ctxEl.contains(t)) closeCtx();
  }

  function fmtAge(ts: number): string {
    if (!ts) return '';
    const ago = (Date.now() - ts) / 1000;
    if (ago < 60) return `${Math.round(ago)}s`;
    if (ago < 3600) return `${Math.round(ago / 60)}m`;
    if (ago < 86400) return `${Math.round(ago / 3600)}h`;
    return `${Math.round(ago / 86400)}d`;
  }

  // Live count of populated slots — drives the badge on the collapsed
  // launcher button. `$:` reactive so it tracks the snapshots store.
  $: populatedCount = $snapshots.snapshots.filter(s => s.capturedAt > 0).length;
  $: inline = placement === 'inline';
</script>

<svelte:window onclick={onWindowClick} />

<div class="snap-bank" class:expanded class:inline title="Snapshots — click to recall · shift-click to save · right-click for menu">
  <button class="snap-handle" onclick={() => expanded = !expanded} title={expanded ? 'Collapse snapshots' : 'Expand snapshots'}>
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="3" width="7" height="7"/>
      <rect x="14" y="3" width="7" height="7"/>
      <rect x="3" y="14" width="7" height="7"/>
      <rect x="14" y="14" width="7" height="7"/>
    </svg>
    <span class="snap-handle-label">SNAPS</span>
    {#if populatedCount > 0}
      <span class="snap-handle-count">{populatedCount}</span>
    {/if}
  </button>

  {#if expanded}
    <div class="snap-grid">
      {#each $snapshots.snapshots as snap, idx (snap.id)}
        {@const populated = snap.capturedAt > 0}
        {@const isActive = $snapshots.activeId === snap.id}
        <div class="snap-cell-wrap">
          <button
            class="snap-cell"
            class:populated
            class:active={isActive}
            style="--snap-color: {snap.color}"
            onclick={(e) => handleClick(idx, e)}
            oncontextmenu={(e) => handleContext(e, idx)}
            data-midi-path="vj:snapshot:{idx + 1}"
            data-midi-label="Snapshot {idx + 1}"
            data-midi-mode="toggle"
            title={populated
              ? `${snap.name || `Snapshot ${idx + 1}`} · saved ${fmtAge(snap.capturedAt)} ago`
              : `Slot ${idx + 1} · empty (shift-click to save current state)`}
          >
            <span class="snap-num">{idx + 1}</span>
            {#if populated}
              <span class="snap-dot"></span>
            {/if}
          </button>
          {#if renamingIdx === idx}
            <input
              class="snap-rename"
              type="text"
              autofocus
              bind:value={renameDraft}
              onblur={commitRename}
              onkeydown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') { renamingIdx = null; } }}
            />
          {:else if populated && snap.name}
            <span class="snap-name">{snap.name}</span>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

{#if ctxIndex !== null}
  {@const slot = $snapshots.snapshots[ctxIndex]}
  <div class="snap-ctx" bind:this={ctxEl} style="left:{ctxX}px;top:{ctxY}px">
    {#if slot && slot.capturedAt > 0}
      <button class="snap-ctx-item snap-ctx-primary" onclick={ctxRecall}>Recall</button>
      <button class="snap-ctx-item" onclick={ctxSave}>Overwrite with current state</button>
      <button class="snap-ctx-item" onclick={ctxRename}>Rename</button>
      <div class="snap-ctx-sep"></div>
      <button class="snap-ctx-item snap-ctx-danger" onclick={ctxClear}>Clear</button>
    {:else}
      <button class="snap-ctx-item snap-ctx-primary" onclick={ctxSave}>Save current state here</button>
      <button class="snap-ctx-item" onclick={ctxRename}>Rename slot</button>
    {/if}
  </div>
{/if}

<style>
  .snap-bank {
    position: fixed;
    bottom: 18px;
    right: 18px;
    z-index: 8500;
    background: rgba(20, 20, 26, 0.92);
    backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    padding: 6px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5);
    transition: padding 0.18s;
  }
  .snap-bank.expanded {
    padding: 8px;
  }
  .snap-bank.inline {
    position: relative;
    inset: auto;
    z-index: 40;
    padding: 0;
    background: transparent;
    border: 0;
    border-radius: 0;
    box-shadow: none;
    backdrop-filter: none;
  }
  .snap-bank.inline.expanded {
    padding: 0;
  }

  .snap-handle {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px 4px 6px;
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 4px;
    color: var(--text-secondary, #aaa);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.1em;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }
  .snap-handle:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
  }
  .snap-bank.inline .snap-handle {
    height: var(--vj-control-h, 30px);
    padding: 0 var(--vj-snap-pad-x, 9px) 0 calc(var(--vj-snap-pad-x, 9px) - 2px);
    background: rgba(9, 11, 15, 0.88);
    border-color: rgba(255, 255, 255, 0.14);
    font-size: var(--vj-snap-font, 12px);
  }
  .snap-bank.inline .snap-handle:hover,
  .snap-bank.inline.expanded .snap-handle {
    border-color: rgba(187, 134, 252, 0.55);
    color: #efe6ff;
    background: rgba(187, 134, 252, 0.12);
  }
  .snap-handle-label { letter-spacing: 0.16em; }
  .snap-handle-count {
    background: #BB86FC;
    color: #000;
    font-size: 11px;
    font-weight: 800;
    padding: 1px 5px;
    border-radius: 7px;
    min-width: 14px;
    text-align: center;
  }

  .snap-grid {
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    gap: 4px;
    margin-top: 6px;
    width: 290px;
  }
  .snap-bank.inline .snap-grid {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    margin-top: 0;
    padding: 8px;
    background: rgba(20, 20, 26, 0.96);
    backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.10);
    border-radius: 8px;
    box-shadow: 0 14px 36px rgba(0, 0, 0, 0.58);
  }

  .snap-cell-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
  }

  .snap-cell {
    position: relative;
    width: 32px;
    height: 32px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 4px;
    color: #666;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 700;
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    transition: background 0.12s, border-color 0.12s, color 0.12s, transform 0.12s;
  }
  .snap-cell:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
    transform: translateY(-1px);
  }
  .snap-cell.populated {
    background: var(--snap-color);
    border-color: var(--snap-color);
    color: #000;
  }
  .snap-cell.populated:hover {
    filter: brightness(1.15);
  }
  .snap-cell.active {
    box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.4), 0 0 14px var(--snap-color);
  }

  .snap-num {
    pointer-events: none;
  }
  .snap-dot {
    position: absolute;
    bottom: 2px;
    right: 2px;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.45);
  }

  .snap-name {
    font-size: 10px;
    color: var(--text-secondary, #aaa);
    max-width: 32px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: center;
    margin-top: 2px;
  }

  .snap-rename {
    width: 32px;
    background: rgba(0, 0, 0, 0.4);
    border: 1px solid rgba(255, 255, 255, 0.18);
    color: #fff;
    font-size: 10px;
    text-align: center;
    border-radius: 2px;
    margin-top: 2px;
    padding: 1px 2px;
  }

  /* Right-click context menu */
  .snap-ctx {
    position: fixed;
    z-index: 9000;
    background: var(--bg-tertiary, #1a1a1e);
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 5px;
    padding: 4px 0;
    min-width: 200px;
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.6);
  }
  .snap-ctx-item {
    display: block;
    width: 100%;
    background: none;
    border: none;
    color: var(--text-primary, #ccc);
    font-size: 13px;
    text-align: left;
    padding: 6px 14px;
    cursor: pointer;
    font-family: inherit;
  }
  .snap-ctx-item:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
  }
  .snap-ctx-primary {
    color: #FF8577;
    font-weight: 700;
  }
  .snap-ctx-primary:hover {
    background: rgba(255, 133, 119, 0.12);
    color: #ffa899;
  }
  .snap-ctx-danger { color: #ff6b6b; }
  .snap-ctx-danger:hover { background: rgba(255, 80, 80, 0.12); color: #ff4444; }
  .snap-ctx-sep {
    height: 1px;
    background: rgba(255, 255, 255, 0.08);
    margin: 4px 0;
  }
</style>
