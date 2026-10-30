<script lang="ts">
  import VJGroupEffects from './VJGroupEffects.svelte';
  import { vjClipLauncher } from '../stores/vjClipLauncher';
  let tray: HTMLDivElement;
  let trigger: HTMLButtonElement;
  let opened = false;
  function positionTray() {
    if (!tray?.matches(':popover-open')) return;
    const rect = trigger.getBoundingClientRect();
    const gap = 8;
    tray.style.left = `${Math.max(gap, Math.min(rect.left, window.innerWidth - tray.offsetWidth - gap))}px`;
    const above = rect.top - tray.offsetHeight - gap;
    tray.style.top = `${Math.max(gap, above >= gap ? above : Math.min(rect.bottom + gap, window.innerHeight - tray.offsetHeight - gap))}px`;
  }
  function toggleTray() {
    if (tray.matches(':popover-open')) tray.hidePopover();
    else { tray.showPopover(); positionTray(); }
  }
  let first = 0;
  let last = 1;
  $: groups = $vjClipLauncher.groups ?? [];
  $: valid = first >= 0 && last >= first && last < $vjClipLauncher.numLayers && !groups.some(g => first <= g.last && last >= g.first);
</script>
<svelte:window onresize={positionTray} />
<div data-help-page="vj-mode" class="groups">
  <button bind:this={trigger} class="groups-trigger" class:active={opened} aria-expanded={opened} onclick={toggleTray} data-help="Combine adjacent VJ layers into one image with shared level, blend, effects, and group-only column launches. Applies in Mix and Stage modes.">▸ Groups {groups.length || ''}</button>
  <div bind:this={tray} class="tray" popover="auto" role="group" aria-label="Layer groups" ontoggle={e => { opened = (e as ToggleEvent).newState === 'open'; positionTray(); }}>
    <strong>Layer groups</strong>
    <p>Combine adjacent layers after the deck crossfade. Group level and blend apply to the combined image.</p>
    {#each groups as group (group.id)}
      <div class="group">
        <div class="head">
          <input aria-label="Group name" value={group.name} onchange={e => vjClipLauncher.updateGroup(group.id, { name: e.currentTarget.value })} />
          <span>L{group.first + 1}–{group.last + 1}</span>
          <button title="Ungroup — keep all clips" onclick={() => vjClipLauncher.removeGroup(group.id)}>×</button>
        </div>
        <div class="controls">
          <input type="range" data-midi-path={`vj:group:${encodeURIComponent(group.id)}:level`} data-midi-label={`${group.name} level`} data-midi-min="0" data-midi-max="1" data-midi-step="0.001" aria-label={`${group.name} level`} min="0" max="1" step="0.001" value={group.opacity} oninput={e => vjClipLauncher.updateGroup(group.id, { opacity: e.currentTarget.valueAsNumber })} />
          <span>{Math.round(group.opacity * 100)}%</span>
          <select aria-label={`${group.name} blend`} value={group.blendMode} onchange={e => vjClipLauncher.updateGroup(group.id, { blendMode: e.currentTarget.value })}>
            {#each ['normal', 'add', 'multiply', 'screen', 'overlay', 'difference', 'lighten', 'darken'] as mode}<option value={mode}>{mode}</option>{/each}
          </select>
        </div>
        <div class="launches" aria-label={`${group.name} column launches`}>
          <span>Launch · Deck {$vjClipLauncher.selectedDeck}</span>
          <div class="columns">
            {#each Array($vjClipLauncher.numColumns) as _, column}
              {@const queued = $vjClipLauncher.pendingTriggers.some(trigger => trigger.groupId === group.id && trigger.bank === $vjClipLauncher.selectedDeck && trigger.columnIndex === column)}
              <button data-midi-path={`${$vjClipLauncher.selectedDeck === 'B' ? 'vj-b' : 'vj'}:group:${encodeURIComponent(group.id)}:column:${column}`} data-midi-label={`${group.name} · Deck ${$vjClipLauncher.selectedDeck} · Column ${column + 1}`} data-midi-min="0" data-midi-max="1" data-midi-step="1" class:queued title={`Launch column ${column + 1} in ${group.name} on Deck ${$vjClipLauncher.selectedDeck}`} aria-pressed={queued} onclick={() => vjClipLauncher.triggerColumn(column, $vjClipLauncher.selectedDeck, group.id)}>{column + 1}</button>
            {/each}
          </div>
        </div>
        <VJGroupEffects {group} />
      </div>
    {/each}
    <div class="create">
      <label>From <select aria-label="First group layer" data-help="Choose the first row in this adjacent-layer group. Groups cannot overlap." bind:value={first}>{#each Array($vjClipLauncher.numLayers) as _, i}<option value={i}>L{i + 1}</option>{/each}</select></label>
      <label>To <select aria-label="Last group layer" data-help="Choose the last row in this adjacent-layer group. All rows between the two endpoints are included." bind:value={last}>{#each Array($vjClipLauncher.numLayers) as _, i}<option value={i}>L{i + 1}</option>{/each}</select></label>
      <button disabled={!valid} onclick={() => vjClipLauncher.addGroup(first, last)}>+ Group</button>
    </div>
    {#if !valid}<p>Choose a free, contiguous layer range.</p>{/if}
    {#if $vjClipLauncher.mapMode}<p>In Map, a surface whose Source is a group shows that group's rows.</p>{/if}
  </div>
</div>
<style>
  .groups { position: relative; font-size: var(--ga-text-control, 12px); }
  .groups-trigger { cursor: pointer; list-style: none; height: var(--ga-control-h, 26px); padding: 0 10px; box-sizing: border-box; border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13)); border-radius: var(--ga-r-hard, 5px); color: var(--ga-ink-1, #ada9a2); background: var(--ga-card, #16140f); font-size: var(--ga-text-control, 12px); font-weight: var(--ga-weight-control, 600); }
  .groups-trigger:hover:not(.active) { border-color: var(--ga-line-3, rgba(245, 236, 222, 0.24)); color: var(--ga-ink-0, #f2ede4); }
  .groups-trigger.active { background: var(--ga-selection-bg, #1f3170); border-color: var(--ga-selection-line, #5278ff); color: var(--ga-selection-ink, #e0e8ff); }
  .tray { position: fixed; inset: auto; margin: 0; box-sizing: border-box; color: var(--ga-ink-0, #f2ede4); font-size: var(--ga-text-control, 12px); width: 356px; max-width: calc(100vw - 16px); max-height: min(65vh, 480px); overflow-y: auto; white-space: normal; padding: 12px; border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13)); border-radius: var(--ga-r-soft, 8px); background: var(--ga-card, #16140f); box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6); }
  .tray > strong { display: block; font-size: var(--ga-text-title, 14px); font-weight: var(--ga-weight-title, 650); }
  p { color: var(--ga-ink-2, #89857e); font-size: var(--ga-text-meta, 11px); line-height: 1.45; margin: 6px 0 10px; }
  .group { border-top: 1px solid var(--ga-line-1, rgba(245, 236, 222, 0.07)); padding: 10px 0; }
  .head, .controls, .create { display: flex; gap: 6px; align-items: center; }
  .head { margin-bottom: 6px; }
  .head input { flex: 1; min-width: 0; }
  .head span { color: var(--ga-ink-2, #89857e); font-size: var(--ga-text-meta, 11px); font-variant-numeric: tabular-nums; }
  .controls input { flex: 1; min-width: 0; accent-color: var(--ga-slider-fill, var(--ga-selection-line, #5278ff)); }
  .controls span { width: 34px; text-align: right; color: var(--ga-ink-1, #ada9a2); font: var(--ga-text-meta, 11px) var(--ga-font-mono, monospace); font-variant-numeric: tabular-nums; }
  input, select, button { height: var(--ga-control-h, 26px); box-sizing: border-box; border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13)); border-radius: var(--ga-r-hard, 5px); color: var(--ga-ink-0, #f2ede4); background: var(--ga-slot, #060504); padding: 0 8px; font-family: inherit; font-size: var(--ga-text-control, 12px); }
  input[type="range"] { height: auto; padding: 0; border: 0; background: transparent; }
  button { cursor: pointer; background: var(--ga-card, #16140f); color: var(--ga-ink-1, #ada9a2); font-weight: var(--ga-weight-control, 600); }
  button:hover:not(:disabled) { border-color: var(--ga-line-3, rgba(245, 236, 222, 0.24)); color: var(--ga-ink-0, #f2ede4); }
  button:disabled { opacity: .4; cursor: default; }
  .head button { width: var(--ga-control-h, 26px); padding: 0; flex: none; }
  .launches { margin-top: 8px; font-size: var(--ga-text-meta, 11px); color: var(--ga-ink-2, #89857e); }
  .columns { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
  .columns button { height: var(--ga-control-h-sm, 22px); min-width: 26px; padding: 0 6px; font-variant-numeric: tabular-nums; }
  .columns button.queued { background: var(--ga-selection-bg, #1f3170); border-color: var(--ga-selection-line, #5278ff); color: var(--ga-selection-ink, #e0e8ff); }
  .create { margin-top: 10px; }
  .create label { display: flex; align-items: center; gap: 6px; color: var(--ga-ink-1, #ada9a2); }
</style>
