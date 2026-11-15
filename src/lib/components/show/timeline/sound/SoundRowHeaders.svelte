<script lang="ts">
  /**
   * The Timeline's audio rows in the header column, under the Audio
   * section: the row's name and a line about it (the song's tempo and
   * length, or the Live track an Ableton clips row plays), Mute, Solo and
   * the level, then ⋯ for its effects, a control line, Detect tempo, rename
   * and remove. Click a row to open its settings (effects, ducking, Live).
   */
  import { showTimeline } from '../../../../stores/showTimeline';
  import { abletonBridge } from '../../../../ableton/abletonBridge';
  import { resolveLiveTrack } from '../../../../timeline/sound/liveSchedule';
  import { removeRow, renameRow, setRowVolume, toggleMute, toggleSolo } from '../../../../timeline/sound/soundCommands';
  import type { SoundRow } from '../../../../timeline/sound/soundModel';
  import { detectShowTempo } from '../../../../show/tempoDetect';
  import { showToast } from '../../../../stores/errorToast';
  import { lineLayout, soundLineGroup } from '../lineUi';
  import LineHeaders from '../LineHeaders.svelte';
  import LinePicker from '../LinePicker.svelte';
  import TlPopover from '../TlPopover.svelte';
  import TimelineIcon from '../TimelineIcon.svelte';
  import { showSlice } from '../timelineSlices';
  import { formatPrecise } from '../timeFormat';
  import { soundLayout } from './soundRowLayout';

  const selection = showSlice('selection');
  const audioTracks = showSlice('audioTracks');
  const tempo = showSlice('tempo');
  const layout = $derived($soundLayout);
  const bridge = $derived($abletonBridge);
  let picker: { x: number; y: number; row: SoundRow } | null = $state(null);
  let menu: { anchor: HTMLElement; row: SoundRow; lane: number } | null = $state(null);
  let renaming: string | null = $state(null);

  function liveStatus(row: SoundRow): { text: string; warn: boolean } {
    if (!bridge.connected) return { text: row.live?.trackName ? `${row.live.trackName} · Live not connected` : 'Live not connected', warn: true };
    if (!row.live || (row.live.track < 0 && !row.live.trackName)) return { text: 'Pick a Live track', warn: true };
    const ti = resolveLiveTrack(row.live, bridge.tracks);
    if (ti === null) return { text: `${row.live.trackName || 'Track'} · not in the set`, warn: true };
    return { text: bridge.tracks[ti].name, warn: false };
  }

  /** The line under an audio row's name: the song's tempo and length. */
  function audioMeta(lane: number): string {
    const on = $audioTracks.filter((t) => t.lane === lane);
    if (!on.length) return layout.empty && lane === 0 ? 'The show follows it' : 'empty';
    const seg = $tempo?.segments[0];
    const len = Math.max(...on.map((t) => t.startTime + t.duration)) - Math.min(...on.map((t) => t.startTime));
    const parts = [
      ...(seg && lane === 0 ? [`${Math.round(seg.bpm * 10) / 10} BPM`, `${seg.beatsPerBar}/${seg.beatUnit}`] : []),
      on.length > 1 ? `${on.length} files` : formatPrecise(len),
    ];
    return parts.join(' · ');
  }
  /** The row's name: the song's own on the first row while the row has its default name. */
  function rowName(row: SoundRow, lane: number): string {
    if (row.kind === 'audio' && lane === 0 && /^Audio( \d+)?$/.test(row.name)) {
      const first = $audioTracks.find((t) => t.lane === 0);
      if (first) return first.name.replace(/\.[a-z0-9]+$/i, '');
    }
    return row.name;
  }

  function openMenu(e: MouseEvent, row: SoundRow, lane: number) {
    e.stopPropagation();
    menu = menu?.row.id === row.id ? null : { anchor: e.currentTarget as HTMLElement, row, lane };
  }
  function lineFromMenu() {
    if (!menu) return;
    const r = menu.anchor.getBoundingClientRect();
    picker = { x: r.left, y: r.top - 4, row: menu.row };
    menu = null;
  }
  async function detectTempo(lane: number) {
    menu = null;
    const first = $audioTracks.find((t) => t.lane === lane && !!t.url);
    if (!first) return;
    const result = await detectShowTempo(first.id);
    showToast(result.ok ? `${Math.round(result.bpm * 10) / 10} BPM: the grid follows the song` : result.reason === 'no-pulse' ? 'No steady beat found' : 'This track could not be read', result.ok ? 'info' : 'warning');
  }
  function focusInput(node: HTMLInputElement) { node.focus(); node.select(); }
</script>

{#each layout.rows as row, i (row.id)}
  {@const lines = $lineLayout.lines.get(soundLineGroup(row.id)) ?? []}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="sound-head"
    class:live={row.kind === 'live'}
    class:first={i === 0}
    class:empty={layout.empty && i === 0}
    class:selected={$selection?.kind === 'soundRow' && $selection.id === row.id}
    class:muted={row.muted}
    style="height: {layout.strips[i]}px"
    data-sound-row={row.id}
    onclick={() => showTimeline.select({ kind: 'soundRow', id: row.id })}
  >
    <span class="sh-stripe" aria-hidden="true"></span>
    <span class="sh-kind" title={row.kind === 'live' ? 'Ableton clips row: plays clips in Ableton Live' : 'Audio row'}><TimelineIcon name={row.kind === 'live' ? 'ableton' : 'song'} size={15} /></span>
    <div class="sh-col">
      {#if renaming === row.id}
        <input class="sh-rename" type="text" value={row.name} use:focusInput
          onclick={(e) => e.stopPropagation()}
          onkeydown={(e) => { e.stopPropagation(); if (e.key === 'Enter') { renameRow(row.id, (e.currentTarget as HTMLInputElement).value); renaming = null; } else if (e.key === 'Escape') renaming = null; }}
          onblur={(e) => { renameRow(row.id, (e.currentTarget as HTMLInputElement).value); renaming = null; }}
          aria-label="Row name" />
      {:else}
        <span class="sh-name file-name" title={row.name} ondblclick={(e) => { e.stopPropagation(); renaming = row.id; }}>{layout.empty && i === 0 ? 'Audio' : rowName(row, i)}</span>
      {/if}
      {#if row.kind === 'live'}
        {@const st = liveStatus(row)}
        <span class="sh-meta" class:warn={st.warn} title={st.text}>{st.text}</span>
      {:else}
        <span class="sh-meta">{audioMeta(i)}{#if row.fx.length} · FX {row.fx.length}{/if}</span>
      {/if}
    </div>
    {#if !(layout.empty && i === 0)}
      <div class="sh-ctl">
        <button class="sh-btn" class:on={row.muted} onclick={(e) => { e.stopPropagation(); toggleMute(row.id); }} title="Mute this row" aria-pressed={row.muted} data-sound-mute>M</button>
        <button class="sh-btn" class:on={row.solo} onclick={(e) => { e.stopPropagation(); toggleSolo(row.id); }} title="Solo this row" aria-pressed={row.solo} data-sound-solo>S</button>
        {#if row.kind !== 'live'}
          <span class="sh-vol-wrap">
            <input
              class="sh-vol"
              type="range" min="0" max="1" step="0.01"
              value={row.volume}
              onclick={(e) => e.stopPropagation()}
              oninput={(e) => setRowVolume(row.id, +(e.currentTarget as HTMLInputElement).value)}
              title="Row level: {Math.round(row.volume * 100)}"
              aria-label="Row level"
              data-sound-volume
            />
          </span>
        {/if}
        <button class="sh-btn more" onclick={(e) => openMenu(e, row, i)} title="More for this row: effects, a control line, detect tempo, rename, remove" aria-label="More for this row" data-sound-more><TimelineIcon name="more" size={14} /></button>
      </div>
    {/if}
  </div>
  {#if lines.length}
    <LineHeaders groupId={soundLineGroup(row.id)} {lines} expanded={$lineLayout.expanded.has(soundLineGroup(row.id))} />
  {/if}
{/each}

{#if menu}
  {@const m = menu}
  <TlPopover anchor={m.anchor} onclose={() => (menu = null)} width={240} label="Audio row">
    <button class="tl-mi" onclick={() => { showTimeline.select({ kind: 'soundRow', id: m.row.id }); menu = null; }} data-sound-fx-open><TimelineIcon name="fx" size={14} />Effects on this row{#if m.row.fx.length}<span class="tl-mi-key">{m.row.fx.length}</span>{/if}</button>
    <button class="tl-mi" onclick={lineFromMenu} data-sound-line-add><TimelineIcon name="line-add" size={14} />Add control line</button>
    {#if m.row.kind === 'audio'}
      <button class="tl-mi" disabled={!$audioTracks.some((t) => t.lane === m.lane && !!t.url)} onclick={() => void detectTempo(m.lane)} data-sound-detect-tempo><TimelineIcon name="tempo" size={14} />Detect tempo</button>
    {/if}
    <div class="tl-mi-sep"></div>
    <button class="tl-mi" onclick={() => { renaming = m.row.id; menu = null; }}><TimelineIcon name="pen" size={14} />Rename</button>
    <button class="tl-mi danger" disabled={layout.rows.length <= 1} onclick={() => { removeRow(m.row.id); menu = null; }} data-sound-remove-row><TimelineIcon name="trash" size={14} />Remove row</button>
  </TlPopover>
{/if}

{#if picker}
  <LinePicker targets={[{ target: { scope: 'sound', id: picker.row.id }, label: picker.row.name }]} x={picker.x} y={picker.y} onclose={() => (picker = null)} />
{/if}

<style>
  .sound-head {
    position: relative;
    box-sizing: border-box;
    border-bottom: 1px solid var(--ga-line, rgba(245, 236, 222, 0.07));
    padding: 0 4px 0 12px;
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }
  .sound-head:hover { background: rgba(245, 236, 222, 0.035); }
  .sound-head.selected { background: rgba(255, 114, 95, 0.07); }
  .sound-head.selected::after { content: ''; position: absolute; right: 0; top: 0; bottom: 0; width: 2px; background: var(--tl-on, #ff725f); }
  .sh-stripe { position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: color-mix(in srgb, #5ce1e6 85%, transparent); }
  .live .sh-stripe { background: color-mix(in srgb, #ffa03c 85%, transparent); }
  .sh-kind { flex: 0 0 auto; display: inline-flex; color: var(--ga-icon, #5278ff); }
  .sh-col { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .sh-name {
    font-size: var(--ga-text-body, 13px);
    font-weight: 600;
    color: var(--ga-ink-0, #f2ede4);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .muted .sh-name { opacity: 0.5; }
  .sh-meta { font-size: var(--ga-text-meta, 11px); color: var(--ga-ink-2, #89857e); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sh-meta.warn { color: var(--tl-on, #ff725f); }
  .sh-rename {
    width: 100%; height: 18px; box-sizing: border-box; padding: 0 4px;
    font: inherit; font-size: var(--ga-text-control, 12px); font-weight: 600; color: var(--ga-ink-0, #fff);
    background: var(--ga-slot, #060504); border: 1px solid var(--ga-selection-line, #5278ff); border-radius: 3px; outline: none;
  }
  .sh-ctl { flex: 0 0 auto; display: flex; align-items: center; gap: 1px; }
  .sh-btn {
    width: 22px;
    height: 22px;
    display: grid;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--ga-ink-2, #89857e);
    font: inherit;
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
  }
  .sh-btn:hover { background: var(--ga-raise, #26221c); color: var(--ga-ink-0, #f2ede4); }
  .sh-btn.on { color: var(--tl-on, #ff725f); background: var(--tl-on-soft, rgba(255, 114, 95, 0.13)); }
  .sh-vol-wrap { width: 40px; display: flex; margin: 0 2px; }
  .sh-vol { width: 100%; min-width: 0; height: 12px; margin: 0; accent-color: var(--ga-ink-1, #ada9a2); }
</style>
