<script lang="ts">
  /**
   * The Stage group's Screen FX and Effects row headers. "+" puts a block on
   * the row at the playhead (a Screen FX type / a composition effect, or a
   * copy of one from the Composition panel); "⌇+" adds a control line for a
   * block on the row.
   */
  import { get } from 'svelte/store';
  import { showTimeline } from '../../../stores/showTimeline';
  import { showSlice } from './timelineSlices';
  import type { StageClipRow } from '../../../timeline/stagefx/stageClips';
  import { formatPrecise } from './timeFormat';
  import LinePicker from './LinePicker.svelte';
  import StageFxBlockPicker from './StageFxBlockPicker.svelte';
  import { STAGE_FX_ROWS, STAGE_FX_ROW_HEIGHT, STAGE_ROW_NAMES, blockName, newBlockEffect, newScreenFx, type StageBlockPick } from './stageFxRowsUi';
  import TimelineIcon from './TimelineIcon.svelte';

  interface Props {
    /** The rows that show (a row appears once it has blocks, or was asked for). */
    rows?: readonly StageClipRow[];
  }
  let { rows = STAGE_FX_ROWS }: Props = $props();

  let menu: { x: number; y: number; row: StageClipRow } | null = $state(null);
  let picker: { x: number; y: number; row: StageClipRow } | null = $state(null);

  const stageClipsStore = showSlice('stageClips');
  const selectionStore = showSlice('selection');
  const stageClips = $derived($stageClipsStore);
  const counts = $derived({
    screenfx: stageClips.filter((c) => c.row === 'screenfx').length,
    effects: stageClips.filter((c) => c.row === 'effects').length,
  });
  const pickerTargets = $derived.by(() => {
    if (!picker) return [];
    const row = picker.row;
    const selected = $selectionStore?.kind === 'stageClip' ? $selectionStore.id : null;
    return stageClips
      .filter((c) => c.row === row)
      .sort((a, b) => (a.id === selected ? -1 : b.id === selected ? 1 : a.startTime - b.startTime))
      .map((c) => ({ target: { scope: 'block' as const, id: c.id }, label: `${blockName(c)} @ ${formatPrecise(c.startTime)}` }));
  });

  const TIPS: Record<StageClipRow, string> = {
    screenfx: 'Screen FX along the Timeline: a pulse, sweep, chase, strobe… across the pieces for a block\'s span. Drag a card from the Composition panel\'s Screen FX tab here, or +. With blocks on this row the Timeline owns the Screen FX: none between blocks, and the Screen FX tab\'s auto play waits.',
    effects: 'Composition effects along the Timeline: a block switches an effect over the whole stage on for its span (on top of the Effects tab\'s own). Drag a card from the Composition panel\'s Effects tab here, or +. Overlapping blocks crossfade.',
  };

  function openMenu(e: MouseEvent, row: StageClipRow) {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    menu = menu?.row === row ? null : { x: r.left, y: Math.max(8, Math.min(r.bottom + 2, window.innerHeight - 370)), row };
  }
  function openPicker(e: MouseEvent, row: StageClipRow) {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    picker = picker ? null : { x: r.left, y: r.top - 4, row };
  }
  function add(pick: StageBlockPick) {
    if (!menu) return;
    const at = get(showTimeline).currentTime;
    if (menu.row === 'screenfx' && pick.screenFx) {
      showTimeline.addStageClip('screenfx', at, { screenFx: newScreenFx(pick.screenFx.type, pick.screenFx.from) });
    } else if (menu.row === 'effects' && pick.effect) {
      showTimeline.addStageClip('effects', at, { effect: newBlockEffect(pick.effect.type, pick.effect.params, pick.effect.from) });
    }
    menu = null;
  }
</script>

{#each rows as row (row)}
  <div class="sfx-row" class:effects={row === 'effects'} style:height="{STAGE_FX_ROW_HEIGHT}px" data-stage-fx-row={row}>
    <span class="sfx-stripe" aria-hidden="true"></span>
    <span class="sfx-icon"><TimelineIcon name={row === 'screenfx' ? 'fx' : 'sliders'} size={15} /></span>
    <span class="name" title={TIPS[row]}>{STAGE_ROW_NAMES[row]}</span>
    <button type="button" class="add" onclick={(e) => openMenu(e, row)} title={row === 'screenfx' ? 'Put a Screen FX block here at the playhead' : 'Put an effect block here at the playhead'} aria-label={row === 'screenfx' ? 'Put a Screen FX block here at the playhead' : 'Put an effect block here at the playhead'} data-stage-fx-add={row}><TimelineIcon name="plus" size={14} /></button>
    {#if counts[row] > 0}
      <button type="button" class="add" onclick={(e) => openPicker(e, row)} title="Add a control line for a block on this row: any of its settings, colors or its where line" aria-label="Add a control line" data-stage-fx-line-picker={row}><TimelineIcon name="line-add" size={14} /></button>
    {/if}
  </div>
{/each}

{#if menu}
  <StageFxBlockPicker row={menu.row} x={menu.x} y={menu.y} onpick={add} onclose={() => (menu = null)} />
{/if}
{#if picker}
  <LinePicker targets={pickerTargets} x={picker.x} y={picker.y} onclose={() => (picker = null)} />
{/if}

<style>
  .sfx-row {
    position: relative;
    display: flex; align-items: center; gap: 6px; padding: 0 4px 0 12px; box-sizing: border-box;
    border-bottom: 1px solid var(--ga-line, rgba(245, 236, 222, 0.07));
  }
  .sfx-row:hover { background: rgba(245, 236, 222, 0.035); }
  .sfx-stripe { position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: color-mix(in srgb, #ff6f5e 75%, transparent); }
  .effects .sfx-stripe { background: color-mix(in srgb, #c77dff 75%, transparent); }
  .sfx-icon { display: inline-flex; color: var(--ga-icon, #5278ff); }
  .name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--ga-text-body, 13px); font-weight: 600; color: var(--ga-ink-0, #f2ede4); }
  .add {
    width: 22px; height: 22px; display: grid; place-items: center; padding: 0;
    background: transparent; border: 0; border-radius: 4px; color: var(--ga-ink-2, #89857e); cursor: pointer;
  }
  .add:hover { background: var(--ga-raise, #26221c); color: var(--ga-ink-0, #f2ede4); }
</style>
