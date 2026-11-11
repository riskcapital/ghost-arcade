<script lang="ts">
  /**
   * The label column for a group's control lines: each line's colour, name
   * and the value it sends at the playhead; what it follows; "touch a knob
   * to bind"; on/off; remove. Collapsed, the lines are chips over the one
   * overlaid lane (click a chip to edit that line); expanded, one header per
   * lane. ⤢ switches between the two.
   */
  import { showTimeline } from '../../../stores/showTimeline';
  import { controlLineFrame } from '../../../timeline/lines/lineRuntime';
  import type { ControlLine } from '../../../timeline/lines/lineModel';
  import { bindNextControl, lineRecordState, lineSelection } from '../../../timeline/lines/timelineLines';
  import { sameTarget } from '../../../timeline/lines/paramRegistry';
  import {
    LINE_DEPTH_HEIGHT,
    LINE_LANE_HEIGHT,
    LINE_OVERLAY_HEIGHT,
    activeLineIn,
    followLabel,
    formatLineValue,
    frameValue,
    toggleLineGroup,
  } from './lineUi';
  import LineFollowPopover from './LineFollowPopover.svelte';

  interface Props {
    groupId: string;
    lines: ControlLine[];
    expanded: boolean;
    locked?: boolean;
    /** Name of the block a block line belongs to, by clip id. */
    blockNames?: Record<string, string>;
  }
  let { groupId, lines, expanded, locked = false, blockNames = {} }: Props = $props();

  const frame = $derived($controlLineFrame);
  const sel = $derived($lineSelection);
  const rec = $derived($lineRecordState);
  const active = $derived(activeLineIn(lines, sel?.lineId));
  let follow: { lineId: string; x: number; y: number } | null = $state(null);
  const followLine = $derived(follow ? lines.find((l) => l.id === follow!.lineId) ?? null : null);

  function nameOf(line: ControlLine): string {
    const base = line.label ?? line.key;
    if (line.target.scope === 'block') return `${blockNames[line.target.id] ?? 'Block'} · ${base}`;
    return base;
  }
  function select(line: ControlLine) {
    lineSelection.set(sel?.lineId === line.id ? sel : { lineId: line.id, points: [] });
  }
  function remove(line: ControlLine) {
    showTimeline.editLines((list) => list.filter((l) => l.id !== line.id));
    if (sel?.lineId === line.id) lineSelection.set(null);
  }
  function toggleEnabled(line: ControlLine) {
    showTimeline.editLines((list) => list.map((l) => (l.id === line.id ? (l.enabled === false ? (({ enabled: _e, ...rest }) => rest)(l) : { ...l, enabled: false }) : l)));
  }
  function openFollow(e: MouseEvent, line: ControlLine) {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    follow = follow?.lineId === line.id ? null : { lineId: line.id, x: r.left, y: r.top - 4 };
  }
  function bind(e: MouseEvent, line: ControlLine) {
    e.stopPropagation();
    bindNextControl(line.target, line.key, nameOf(line));
  }
  const binding = (line: ControlLine) => !!rec.bindPending && rec.bindPending.key === line.key && sameTarget(rec.bindPending.target, line.target);
</script>

{#snippet actions(line: ControlLine)}
  <button class="lh-btn" class:on={!!line.follow} disabled={locked} onmousedown={(e) => e.stopPropagation()} onclick={(e) => openFollow(e, line)} title="What this line follows: the song, a stem, the beat, a Live knob, a MIDI CC" data-line-follow-btn>{followLabel(line.follow?.source)}</button>
  <button class="lh-btn" class:armed={binding(line)} onmousedown={(e) => e.stopPropagation()} onclick={(e) => bind(e, line)} title="Touch a knob to bind: the next MIDI control you move drives this line (and records it when armed)" data-line-bind>{binding(line) ? 'touch…' : '🎛'}</button>
  <button class="lh-btn" class:off={line.enabled === false} disabled={locked} onmousedown={(e) => e.stopPropagation()} onclick={() => toggleEnabled(line)} title={line.enabled === false ? 'Off: kept, drives nothing. Click to turn it on' : 'On: click to turn this line off without deleting it'} data-line-enable>{line.enabled === false ? 'off' : 'on'}</button>
  <button class="lh-btn" disabled={locked} onmousedown={(e) => e.stopPropagation()} onclick={() => remove(line)} title="Remove this line" aria-label="Remove this line" data-line-remove>×</button>
{/snippet}

<div class="lh" data-line-headers={groupId}>
  {#if !expanded}
    <div class="lh-overlay" style:height="{LINE_OVERLAY_HEIGHT}px">
      <div class="lh-chips">
        {#each lines as line (line.id)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <span
            class="lh-chip"
            class:active={line.id === active?.id}
            class:off={line.enabled === false}
            style:--line-color={line.color ?? '#ff5c8a'}
            onclick={() => select(line)}
            title={`${nameOf(line)}: click to edit this line`}
            data-line-chip={line.id}
          >
            <span class="lh-dot"></span>
            <span class="lh-name">{nameOf(line)}</span>
            <span class="lh-val" data-line-value>{formatLineValue(line, frameValue(frame, line))}</span>
          </span>
        {/each}
      </div>
      <div class="lh-bar">
        {#if active}{@render actions(active)}{/if}
        <button class="lh-btn" onmousedown={(e) => e.stopPropagation()} onclick={() => toggleLineGroup(groupId)} title="One lane per line" data-line-expand>⤢</button>
      </div>
    </div>
  {:else}
    {#each lines as line, i (line.id)}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="lh-row"
        class:active={sel?.lineId === line.id}
        class:off={line.enabled === false}
        style:height="{LINE_LANE_HEIGHT}px"
        style:--line-color={line.color ?? '#ff5c8a'}
        onclick={() => select(line)}
        data-line-header={line.id}
      >
        <div class="lh-line">
          <span class="lh-dot"></span>
          <span class="lh-name" title={nameOf(line)}>{nameOf(line)}</span>
          <span class="lh-val" data-line-value>{formatLineValue(line, frameValue(frame, line))}</span>
          {#if i === 0}
            <button class="lh-btn lh-fold" onmousedown={(e) => e.stopPropagation()} onclick={(e) => { e.stopPropagation(); toggleLineGroup(groupId); }} title="Overlay the lines in one lane" data-line-expand>⤡</button>
          {/if}
        </div>
        <div class="lh-line lh-tools">{@render actions(line)}</div>
      </div>
      {#if line.follow?.depthPoints}
        <div class="lh-depth" style:height="{LINE_DEPTH_HEIGHT}px" style:--line-color={line.color ?? '#ff5c8a'}>depth</div>
      {/if}
    {/each}
  {/if}
</div>

{#if follow && followLine}
  <LineFollowPopover line={followLine} x={follow.x} y={follow.y} onclose={() => (follow = null)} />
{/if}

<style>
  .lh { font-size: 11px; color: var(--ga-ink-1, #aaa); }
  .lh-overlay, .lh-row, .lh-depth {
    box-sizing: border-box;
    border-bottom: 1px solid var(--ga-line, rgba(255, 255, 255, 0.06));
    padding: 3px 4px 3px 14px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    background: rgba(255, 255, 255, 0.012);
  }
  .lh-row.active { background: color-mix(in srgb, var(--line-color) 9%, transparent); }
  .lh-chips { display: flex; flex-wrap: wrap; gap: 2px 6px; overflow: hidden; max-height: 30px; }
  .lh-chip { display: inline-flex; align-items: center; gap: 3px; cursor: pointer; max-width: 100%; border-radius: 3px; padding: 0 2px; }
  .lh-chip.active { background: color-mix(in srgb, var(--line-color) 18%, transparent); color: var(--ga-ink-0, #eee); }
  .lh-chip.off, .lh-row.off { opacity: 0.5; }
  .lh-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--line-color); flex: none; }
  .lh-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .lh-val { font-variant-numeric: tabular-nums; color: var(--ga-ink-0, #ddd); margin-left: auto; padding-left: 4px; flex: none; }
  .lh-bar, .lh-line { display: flex; align-items: center; gap: 3px; min-width: 0; }
  .lh-bar { justify-content: flex-end; }
  .lh-btn {
    background: var(--ga-sunk, #0c0c10);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.1));
    color: var(--ga-ink-1, #aaa);
    border-radius: 3px;
    padding: 0 5px;
    height: 16px;
    font: inherit;
    font-size: 10px;
    line-height: 14px;
    cursor: pointer;
    white-space: nowrap;
    max-width: 82px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .lh-btn:disabled { opacity: 0.4; cursor: default; }
  .lh-btn.on { color: var(--line-color, #5ce1e6); border-color: currentColor; }
  .lh-btn.off { color: var(--ga-ink-2, #666); }
  .lh-btn.armed { color: var(--ga-rec, #ff4757); border-color: var(--ga-rec, #ff4757); animation: lh-blink 0.8s steps(2) infinite; }
  .lh-fold { margin-left: 2px; }
  .lh-depth { color: var(--ga-ink-2, #777); font-size: 10px; padding-left: 26px; justify-content: center; }
  @keyframes lh-blink { 50% { opacity: 0.45; } }
</style>
