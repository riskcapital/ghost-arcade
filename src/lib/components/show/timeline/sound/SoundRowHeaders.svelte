<script lang="ts">
  /**
   * The Timeline's sound rows in the label column: name (click to open the
   * row: effects, ducking, Live), mute / solo, level, ⌇+ for a control line
   * on the row's level or effects, and the row's lines under it. A Live row
   * says which Live track it plays and whether Live is there.
   */
  import { showTimeline } from '../../../../stores/showTimeline';
  import { abletonBridge } from '../../../../ableton/abletonBridge';
  import { resolveLiveTrack } from '../../../../timeline/sound/liveSchedule';
  import { addRow, setRowVolume, toggleMute, toggleSolo } from '../../../../timeline/sound/soundCommands';
  import type { SoundRow } from '../../../../timeline/sound/soundModel';
  import { lineLayout, soundLineGroup } from '../lineUi';
  import LineHeaders from '../LineHeaders.svelte';
  import LinePicker from '../LinePicker.svelte';
  import { showSlice } from '../timelineSlices';
  import { SOUND_FOOTER_HEIGHT, SOUND_ROW_HEIGHT, soundLayout } from './soundRowLayout';
  import { autoShowOpen } from '../autoshow/autoShowUi';

  const selection = showSlice('selection');
  const audioTracks = showSlice('audioTracks');
  /** The Song row (the first row) has a song on it: ✦ Auto show is offered there. */
  const songOnRow = $derived($audioTracks.some((t) => t.lane === 0 && !!t.url));
  const layout = $derived($soundLayout);
  const bridge = $derived($abletonBridge);
  let picker: { x: number; y: number; row: SoundRow } | null = $state(null);

  function openPicker(e: MouseEvent, row: SoundRow) {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    picker = picker ? null : { x: r.left, y: r.top - 4, row };
  }

  function liveStatus(row: SoundRow): { text: string; warn: boolean } {
    if (!bridge.connected) return { text: row.live?.trackName ? `${row.live.trackName} · Live not connected` : 'Live not connected', warn: true };
    if (!row.live || (row.live.track < 0 && !row.live.trackName)) return { text: 'Pick a Live track', warn: true };
    const ti = resolveLiveTrack(row.live, bridge.tracks);
    if (ti === null) return { text: `${row.live.trackName || 'Track'} · not in the set`, warn: true };
    return { text: bridge.tracks[ti].name, warn: false };
  }
</script>

{#each layout.rows as row, i (row.id)}
  {@const lines = $lineLayout.lines.get(soundLineGroup(row.id)) ?? []}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="sound-head"
    class:live={row.kind === 'live'}
    class:selected={$selection?.kind === 'soundRow' && $selection.id === row.id}
    class:muted={row.muted}
    style="height: {SOUND_ROW_HEIGHT}px"
    data-sound-row={row.id}
    onclick={() => showTimeline.select({ kind: 'soundRow', id: row.id })}
  >
    <div class="sh-top">
      <span class="sh-kind" title={row.kind === 'live' ? 'Live row: plays clips in Ableton Live' : 'Sound row'}>{row.kind === 'live' ? 'L' : '♪'}</span>
      <span class="sh-name" title={row.name}>{row.name}</span>
      {#if row.fx.length}<span class="sh-fx" title="Effects on this row">FX {row.fx.length}</span>{/if}
      <button class="sh-btn" class:on={row.muted} onclick={(e) => { e.stopPropagation(); toggleMute(row.id); }} title="Mute this row" data-sound-mute>M</button>
      <button class="sh-btn solo" class:on={row.solo} onclick={(e) => { e.stopPropagation(); toggleSolo(row.id); }} title="Solo this row" data-sound-solo>S</button>
      <button class="sh-btn" onclick={(e) => openPicker(e, row)} title="Add a control line for this row's level or effects" data-sound-line-add>⌇+</button>
    </div>
    <div class="sh-bottom">
      {#if row.kind === 'live'}
        {@const st = liveStatus(row)}
        <span class="sh-live" class:warn={st.warn} title={st.text}>{st.text}</span>
      {:else}
        {#if i === 0 && songOnRow}
          <button class="sh-auto" onclick={(e) => { e.stopPropagation(); autoShowOpen.set(true); }} title="Auto show: a whole show on your mapping from this song" data-auto-show-song>✦ Auto show</button>
        {/if}
        <input
          class="sh-vol"
          type="range" min="0" max="1" step="0.01"
          value={row.volume}
          onclick={(e) => e.stopPropagation()}
          oninput={(e) => setRowVolume(row.id, +(e.currentTarget as HTMLInputElement).value)}
          title="Row level"
          aria-label="Row level"
          data-sound-volume
        />
        <span class="sh-val">{Math.round(row.volume * 100)}</span>
      {/if}
    </div>
  </div>
  {#if lines.length}
    <LineHeaders groupId={soundLineGroup(row.id)} {lines} expanded={$lineLayout.expanded.has(soundLineGroup(row.id))} />
  {/if}
  {#if i === layout.rows.length - 1}
    <div class="sound-foot" style="height: {SOUND_FOOTER_HEIGHT}px">
      <button class="sf-btn" onclick={() => addRow('audio')} title="A new sound row for songs, stems and one-shots" data-sound-add-row>+ Sound row</button>
      <button class="sf-btn" onclick={() => addRow('live')} title="A row that plays clips in Ableton Live, lined up with the Timeline" data-sound-add-live>+ Live row</button>
    </div>
  {/if}
{/each}

{#if picker}
  <LinePicker targets={[{ target: { scope: 'sound', id: picker.row.id }, label: picker.row.name }]} x={picker.x} y={picker.y} onclose={() => (picker = null)} />
{/if}

<style>
  .sound-head {
    box-sizing: border-box;
    border-bottom: 1px solid var(--ga-line, rgba(255, 255, 255, 0.07));
    padding: 4px 6px 4px 8px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 3px;
    cursor: pointer;
    background: rgba(92, 225, 230, 0.03);
    font-size: var(--ga-text-meta, 11px);
    color: var(--ga-ink-1, #b8b8c2);
  }
  .sound-head.live { background: rgba(255, 160, 60, 0.05); }
  .sound-head.selected { background: rgba(255, 217, 107, 0.09); box-shadow: inset 2px 0 0 #FFD96B; }
  .sound-head.muted .sh-name { opacity: 0.5; }
  .sh-top, .sh-bottom { display: flex; align-items: center; gap: 4px; min-width: 0; }
  .sh-kind {
    flex: 0 0 auto;
    width: 14px;
    text-align: center;
    font-weight: 700;
    color: #5ce1e6;
  }
  .live .sh-kind { color: #ffa03c; }
  .sh-name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
    color: var(--ga-ink-0, #e8e8ee);
  }
  .sh-fx {
    flex: 0 0 auto;
    font-size: 9px;
    padding: 0 4px;
    border-radius: 3px;
    background: rgba(167, 139, 250, 0.2);
    color: #c9b8ff;
  }
  .sh-btn {
    flex: 0 0 auto;
    min-width: 18px;
    height: 17px;
    padding: 0 3px;
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.14));
    border-radius: 3px;
    background: none;
    color: var(--ga-ink-1, #b8b8c2);
    font: inherit;
    font-size: 10px;
    cursor: pointer;
  }
  .sh-btn:hover { color: #fff; border-color: rgba(255, 255, 255, 0.3); }
  .sh-auto {
    flex: 0 0 auto;
    height: 17px;
    padding: 0 6px;
    border-radius: 3px;
    border: 1px solid rgba(255, 211, 107, 0.45);
    background: rgba(255, 211, 107, 0.08);
    color: #ffd36b;
    font: inherit;
    font-size: 10px;
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
  }
  .sh-auto:hover { background: rgba(255, 211, 107, 0.18); color: #fff; }
  .sh-btn.on { background: #ff4757; border-color: #ff4757; color: #fff; }
  .sh-btn.solo.on { background: #ffd96b; border-color: #ffd96b; color: #111; }
  .sh-vol { flex: 1 1 auto; min-width: 0; height: 12px; margin: 0; accent-color: #5ce1e6; }
  .sh-val { flex: 0 0 22px; text-align: right; font-variant-numeric: tabular-nums; }
  .sh-live { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #ffc68a; }
  .sh-live.warn { color: var(--ga-ink-2, #7d7d88); font-style: italic; }
  .sound-foot {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 6px;
    box-sizing: border-box;
    border-bottom: 1px solid var(--ga-line, rgba(255, 255, 255, 0.07));
  }
  .sf-btn {
    border: 1px dashed var(--ga-line-3, rgba(255, 255, 255, 0.24));
    border-radius: 3px;
    background: none;
    color: var(--ga-ink-1, #b8b8c2);
    font: inherit;
    font-size: 10px;
    padding: 1px 6px;
    cursor: pointer;
  }
  .sf-btn:hover { color: #fff; border-style: solid; }
</style>
