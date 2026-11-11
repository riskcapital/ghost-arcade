<script lang="ts">
  /**
   * The LEDs group's row headers: one per WLED controller and per named
   * range. "+" puts a block on the row at the playhead (Follow the stage,
   * LED effect, Colour, Gradient, Chase, Look); "⌇+" adds a control line for
   * the controller (brightness, gamma) or a block on the row.
   */
  import { showTimeline } from '../../../stores/showTimeline';
  import { LED_BLOCK_KINDS, ledClipName, type LedBlockKind } from '../../../timeline/leds/ledClips';
  import { ledRows, ledGroupFolded, LED_GROUP_HEADER_HEIGHT, LED_ROW_HEIGHT, LED_KIND_LABELS, newLedBlockFields, type LedRow } from './ledRowsUi';
  import LinePicker from './LinePicker.svelte';
  import { formatPrecise } from './timeFormat';
  import { keepInWindow, portal } from './trackLayout';

  let menu: { x: number; y: number; row: LedRow } | null = $state(null);
  let picker: { x: number; y: number; row: LedRow } | null = $state(null);

  const pickerTargets = $derived.by(() => {
    if (!picker) return [];
    const row = picker.row;
    const blocks = $showTimeline.ledClips.filter((c) => c.rowId === row.id);
    return [
      ...blocks.map((c) => ({ target: { scope: 'block' as const, id: c.id }, label: `${ledClipName(c)} @ ${formatPrecise(c.startTime)}` })),
      { target: { scope: 'led' as const }, label: 'LED controllers' },
    ];
  });

  function openMenu(e: MouseEvent, row: LedRow) {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    menu = menu ? null : { x: r.left, y: r.bottom + 2, row };
  }
  function openPicker(e: MouseEvent, row: LedRow) {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    picker = picker ? null : { x: r.left, y: r.top - 4, row };
  }
  function add(kind: LedBlockKind) {
    if (!menu) return;
    showTimeline.addLedClip(menu.row.id, $showTimeline.currentTime, newLedBlockFields(kind));
    menu = null;
  }
  $effect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!(e.target as HTMLElement)?.closest?.('[data-led-add-menu]')) menu = null; };
    const t = setTimeout(() => window.addEventListener('mousedown', close), 0);
    return () => { clearTimeout(t); window.removeEventListener('mousedown', close); };
  });
</script>

{#if $ledRows.length}
  <div class="led-group" style:height="{LED_GROUP_HEADER_HEIGHT}px" data-led-group>
    <button type="button" class="fold" onclick={() => ledGroupFolded.update((v) => !v)} aria-label={$ledGroupFolded ? 'Show the LED rows' : 'Hide the LED rows'}>{$ledGroupFolded ? '▸' : '▾'}</button>
    <span class="name" title="Your WLED controllers and their ranges. Put blocks on them: follow the projected picture, an LED effect, a colour, gradient, chase or a Look. A row with blocks is dark between them.">LEDs</span>
  </div>
  {#if !$ledGroupFolded}
    {#each $ledRows as row (row.id)}
      <div class="led-row" class:range={row.kind === 'range'} class:off={!row.enabled} style:height="{LED_ROW_HEIGHT}px" data-led-row={row.id}>
        <span class="name" title={`${row.name}: ${row.ledCount} LEDs${row.enabled ? '' : ' (switched off in the WLED setup)'}`}>{row.kind === 'range' ? '└ ' : ''}{row.name}</span>
        <button type="button" class="add" onclick={(e) => openMenu(e, row)} title="Put an LED block here at the playhead" data-led-add={row.id}>+</button>
        <button type="button" class="add line" onclick={(e) => openPicker(e, row)} title="Add a control line: the controller's brightness, or a block's colour, speed or where line" data-led-line-picker={row.id}>⌇+</button>
      </div>
    {/each}
  {/if}
{/if}

{#if menu}
  <div class="led-menu" use:portal use:keepInWindow={menu} style:left="{menu.x}px" style:top="{menu.y}px" data-led-add-menu data-help-disabled>
    {#each LED_BLOCK_KINDS as kind (kind)}
      <button type="button" onclick={() => add(kind)} data-led-add-kind={kind}>{LED_KIND_LABELS[kind]}</button>
    {/each}
  </div>
{/if}
{#if picker}
  <LinePicker targets={pickerTargets} x={picker.x} y={picker.y} onclose={() => (picker = null)} />
{/if}

<style>
  .led-group, .led-row {
    display: flex; align-items: center; gap: 4px; padding: 0 6px 0 8px; box-sizing: border-box;
    border-bottom: 1px solid var(--ga-line, rgba(255, 255, 255, 0.07)); font-size: 12px; color: var(--ga-ink-1, #bbb);
  }
  .led-group { background: rgba(255, 159, 67, 0.08); }
  .led-group .name { color: #ff9f43; font-weight: 600; }
  .led-row { background: rgba(255, 159, 67, 0.03); }
  .led-row.range { padding-left: 18px; }
  .led-row.off .name { opacity: 0.5; text-decoration: line-through; }
  .name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fold { background: none; border: 0; color: var(--ga-ink-2, #888); cursor: pointer; padding: 0 2px; font-size: 11px; }
  .add {
    background: var(--ga-sunk, #0c0c10); border: 1px solid rgba(255, 159, 67, 0.4); color: rgba(255, 159, 67, 0.9);
    border-radius: 3px; font: inherit; font-size: 11px; line-height: 16px; padding: 0 5px; cursor: pointer;
  }
  .add.line { border-color: rgba(255, 217, 107, 0.4); color: rgba(255, 217, 107, 0.85); }
  .led-menu {
    position: fixed; z-index: 1000; display: flex; flex-direction: column; min-width: 150px; padding: 4px;
    background: var(--ga-card, #121217); border: 1px solid rgba(255, 159, 67, 0.5); border-radius: 5px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
  }
  .led-menu button { background: none; border: 0; text-align: left; color: var(--ga-ink-0, #e8e8e8); padding: 4px 8px; font: inherit; font-size: 12px; cursor: pointer; border-radius: 3px; }
  .led-menu button:hover { background: rgba(255, 159, 67, 0.16); }
</style>
