<script lang="ts">
  import { vjClipLauncher } from '../stores/vjClipLauncher';
  let tray: HTMLDivElement;
  let trigger: HTMLButtonElement;
  let opened = false;
  function positionTray() {
    if (!tray?.matches(':popover-open')) return;
    const rect = trigger.getBoundingClientRect();
    const gap = 8;
    tray.style.left = `${Math.max(gap, Math.min(rect.left, window.innerWidth - tray.offsetWidth - gap))}px`;
    tray.style.top = `${Math.max(gap, Math.min(rect.bottom + gap, window.innerHeight - tray.offsetHeight - gap))}px`;
  }
  function toggleTray() {
    if (tray.matches(':popover-open')) tray.hidePopover();
    else { tray.showPopover(); positionTray(); }
  }
  let first = 0;
  let last = 1;
  $: groups = $vjClipLauncher.groups ?? [];
  $: deck = $vjClipLauncher.selectedDeck ?? 'A';
  $: valid = first >= 0 && last >= first && last < $vjClipLauncher.numLayers && !groups.some(g => first <= g.last && last >= g.first);
</script>
<svelte:window onresize={positionTray} />
<div class="groups">
  <button bind:this={trigger} class="groups-trigger" class:active={opened || groups.length > 0} aria-expanded={opened} onclick={toggleTray}
    title="Layer groups: one level and column launches for a range of adjacent layers">GROUPS</button>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div bind:this={tray} class="tray" popover="auto" role="group" aria-label="Layer groups"
    onkeydown={(e) => e.stopPropagation()}
    ontoggle={e => { opened = (e as ToggleEvent).newState === 'open'; positionTray(); }}>
    <strong>Layer groups</strong>
    <p>Give a range of adjacent layers one level fader and its own column launches. A group launch leaves the other layers playing.</p>
    {#each groups as group (group.id)}
      <div class="group">
        <div class="head">
          <input aria-label="Group name" value={group.name} onchange={e => vjClipLauncher.updateGroup(group.id, { name: e.currentTarget.value })} />
          <span>L{group.first + 1}–{group.last + 1}</span>
          <button title="Ungroup (keeps all clips)" onclick={() => vjClipLauncher.removeGroup(group.id)}>×</button>
        </div>
        <div class="controls">
          <input type="range" data-midi-path={`vj:group:${encodeURIComponent(group.id)}:level`} data-midi-label={`${group.name} level`} data-midi-min="0" data-midi-max="1" data-midi-step="0.001"
            aria-label={`${group.name} level`} min="0" max="1" step="0.01" value={group.opacity}
            oninput={e => vjClipLauncher.updateGroup(group.id, { opacity: Number(e.currentTarget.value) })} />
          <span>{Math.round(group.opacity * 100)}%</span>
        </div>
        <div class="launches" aria-label={`${group.name} column launches`}>
          <span>Launch · Deck {deck}</span>
          <div class="columns">
            {#each Array($vjClipLauncher.numColumns) as _, column}
              {@const queued = $vjClipLauncher.pendingTriggers.some(trigger => trigger.kind === 'column' && trigger.groupId === group.id && trigger.bank === deck && trigger.columnIndex === column)}
              <button data-midi-path={`${deck === 'B' ? 'vj-b' : 'vj'}:group:${encodeURIComponent(group.id)}:column:${column}`}
                data-midi-label={`${group.name} · Deck ${deck} · Column ${column + 1}`} data-midi-mode="trigger"
                class:queued aria-pressed={queued}
                onclick={() => vjClipLauncher.triggerColumn(column, deck, group.id)}>{column + 1}</button>
            {/each}
          </div>
        </div>
      </div>
    {/each}
    <div class="create">
      <label>From <select aria-label="First group layer" bind:value={first}>{#each Array($vjClipLauncher.numLayers) as _, i}<option value={i}>L{i + 1}</option>{/each}</select></label>
      <label>To <select aria-label="Last group layer" bind:value={last}>{#each Array($vjClipLauncher.numLayers) as _, i}<option value={i}>L{i + 1}</option>{/each}</select></label>
      <button disabled={!valid} onclick={() => vjClipLauncher.addGroup(first, last)}>+ Group</button>
    </div>
    {#if !valid}<p>Choose a free range of adjacent layers.</p>{/if}
  </div>
</div>
<style>
  .groups { position: relative; font-size: 12px; flex: 0 0 auto; }
  .groups-trigger { cursor: pointer; padding: 5px 9px; border: 1px solid var(--ga-border, #333); border-radius: 6px; color: var(--ga-text-dim, #c8d0dd); background: transparent; font-size: 10px; font-weight: 700; letter-spacing: 0.06em; white-space: nowrap; }
  .groups-trigger.active { color: var(--ga-text, #fff); border-color: var(--ga-accent, #4aa3ff); }
  .tray { position: fixed; inset: auto; margin: 0; box-sizing: border-box; color: var(--ga-text, #d6dfef); font-size: 12px; width: 340px; max-width: calc(100vw - 16px); max-height: min(65vh, 480px); overflow-y: auto; white-space: normal; padding: 12px; border: 1px solid var(--ga-border, #333); border-radius: 10px; background: var(--ga-surface, #16181d); box-shadow: 0 12px 32px rgba(0, 0, 0, 0.55); }
  p { color: var(--ga-text-dim, #9ea9ba); font-size: 11px; margin: 7px 0; }
  .group { border-top: 1px solid var(--ga-border, #2a2f3a); padding: 9px 0; }
  .head, .controls, .create { display: flex; gap: 7px; align-items: center; }
  .head { margin-bottom: 7px; }
  .head input { flex: 1; min-width: 0; }
  .controls input { flex: 1; min-width: 0; }
  .controls span { width: 34px; font-variant-numeric: tabular-nums; }
  .launches { margin-top: 8px; font-size: 11px; color: var(--ga-text-dim, #aebdd5); }
  .columns { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 5px; }
  .columns button { min-width: 26px; }
  .head input, select, .tray button { border: 1px solid var(--ga-border, #3a4252); border-radius: 5px; color: var(--ga-text, #d6dfef); background: #1d222b; padding: 4px 6px; font-size: 12px; }
  .tray button { cursor: pointer; } .tray button:disabled { opacity: .4; cursor: default; }
  /* Queued by launch quantize: matches the queued clip cells in the deck. */
  .tray .columns button.queued { border-color: #f97316; box-shadow: 0 0 6px rgba(249, 115, 22, 0.45); }
  .create { margin-top: 9px; }
</style>
