<script lang="ts">
  import VJGroupEffects from './VJGroupEffects.svelte';
  import { vjClipLauncher } from '../stores/vjClipLauncher';
  let first = 0;
  let last = 1;
  $: groups = $vjClipLauncher.groups ?? [];
  $: valid = first >= 0 && last >= first && last < $vjClipLauncher.numLayers && !groups.some(g => first <= g.last && last >= g.first);
</script>
<details class="groups">
  <summary>Groups {groups.length || ''}</summary>
  <div class="tray">
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
      <label>From <select bind:value={first}>{#each Array($vjClipLauncher.numLayers) as _, i}<option value={i}>L{i + 1}</option>{/each}</select></label>
      <label>To <select bind:value={last}>{#each Array($vjClipLauncher.numLayers) as _, i}<option value={i}>L{i + 1}</option>{/each}</select></label>
      <button disabled={!valid || $vjClipLauncher.mapMode} onclick={() => vjClipLauncher.addGroup(first, last)}>+ Group</button>
    </div>
    {#if !valid}<p>Choose a free, contiguous layer range.</p>{/if}
    {#if $vjClipLauncher.mapMode}<p>Groups apply in Mix and Stage modes.</p>{/if}
  </div>
</details>
<style>
  .launches { margin-top: 8px; font-size: 11px; color: #aebdd5; }
  .columns { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 5px; }
  .columns button { min-width: 26px; }
  .columns button.queued { background: #213e79; border-color: #739ae8; }
  .groups { position: relative; font-size: 12px; }
  summary { cursor: pointer; list-style: none; padding: 7px 10px; border: 1px solid #343b48; border-radius: 6px; color: #c8d0dd; background: #15181d; }
  .groups[open] summary { background: #172b55; border-color: #3c5790; }
  .tray { position: absolute; bottom: calc(100% + 7px); left: 0; z-index: 200; width: 330px; max-height: min(65vh, 480px); overflow-y: auto; white-space: normal; padding: 12px; border: 1px solid #35435e; border-radius: 9px; background: #11151d; box-shadow: 0 10px 30px #0009; }
  p { color: #9ea9ba; font-size: 11px; margin: 7px 0; }
  .group { border-top: 1px solid #2b3342; padding: 9px 0; }
  .head, .controls, .create { display: flex; gap: 7px; align-items: center; }
  .head { margin-bottom: 7px; }
  .head input { flex: 1; min-width: 0; }
  .controls input { flex: 1; min-width: 0; accent-color: #476dc4; }
  .controls span { width: 34px; font-variant-numeric: tabular-nums; }
  input, select, button { border: 1px solid #344158; border-radius: 5px; color: #d6dfef; background: #182237; padding: 4px 6px; font-size: 12px; }
  button { cursor: pointer; } button:disabled { opacity: .4; cursor: default; }
  .create { margin-top: 9px; }
</style>
