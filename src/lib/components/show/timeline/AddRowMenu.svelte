<script lang="ts">
  /**
   * "+ Row": every kind of row the Timeline has, each with a line saying
   * what it is for. Rows of Presets, Looks, Screen FX, Effects and the
   * camera appear once they hold something; adding one here shows it now,
   * empty, so a block can be dragged onto it.
   */
  import { get } from 'svelte/store';
  import { showTimeline } from '../../../stores/showTimeline';
  import { addRow } from '../../../timeline/sound/soundCommands';
  import { startGroupRow } from './groupRowUi';
  import { cameraLaneShown } from './cameraLaneUi';
  import { ledRows } from './ledRowsUi';
  import { askForRow, sendFold, type RowKind } from './rowSections';
  import { setLayersOpen } from './layersSection';
  import TimelineIcon, { type TimelineIconName } from './TimelineIcon.svelte';
  import TlPopover from './TlPopover.svelte';

  interface Props {
    anchor: HTMLElement | null | undefined;
    onclose: () => void;
    /** A stage-wide control line: the Timeline opens its line picker there. */
    online: (anchor: HTMLElement) => void;
    placement?: 'below' | 'above';
  }
  let { anchor, onclose, online, placement = 'below' }: Props = $props();

  const ITEMS: Array<{ kind: RowKind; label: string; desc: string; icon: TimelineIconName }> = [
    { kind: 'audio', label: 'Audio row', desc: 'Songs, stems and one-shots', icon: 'song' },
    { kind: 'ableton', label: 'Ableton clips row', desc: 'Plays clips in Ableton Live, lined up with the Timeline', icon: 'ableton' },
    { kind: 'group', label: 'Group row', desc: 'Blocks across pieces you pick on the canvas', icon: 'group' },
    { kind: 'layerOnPiece', label: 'Layer on a piece', desc: 'A row of its own drawn over a piece, with its own blend', icon: 'layer-add' },
    { kind: 'presets', label: 'Presets', desc: 'Saved mapping presets, with transitions between them', icon: 'preset' },
    { kind: 'looks', label: 'Looks', desc: 'Shape Looks the pieces wear for a block\'s span', icon: 'look' },
    { kind: 'screenfx', label: 'Screen FX', desc: 'A pulse, sweep, chase or strobe across the pieces', icon: 'fx' },
    { kind: 'effects', label: 'Effects', desc: 'Composition effects switched on for a span', icon: 'sliders' },
    { kind: 'leds', label: 'LEDs', desc: 'Your WLED controllers and ranges', icon: 'led' },
    { kind: 'camera', label: 'Camera', desc: 'Stage Sim shots its camera follows', icon: 'camera' },
    { kind: 'line', label: 'Control line', desc: 'A stage-wide line: an effect, an LED or a world setting', icon: 'control' },
  ];

  let pickPiece = $state(false);
  // Read once when the list opens: a menu, not a view that follows edits.
  const pieces = $derived(pickPiece ? get(showTimeline).layerTracks.filter((t) => !t.subRow && (t.row?.kind ?? 'piece') === 'piece') : []);

  function choose(kind: RowKind) {
    switch (kind) {
      case 'audio': addRow('audio'); sendFold({ kind: 'open', id: 'audio' }); break;
      case 'ableton': addRow('live'); sendFold({ kind: 'open', id: 'audio' }); break;
      case 'group': startGroupRow(); break;
      case 'layerOnPiece': {
        const s = get(showTimeline);
        const sel = s.selection?.kind === 'track' ? s.layerTracks.find((t) => t.id === s.selection!.id) : null;
        if (sel && !sel.group) { showTimeline.addSubRow(sel.layerId); setLayersOpen(true); break; }
        pickPiece = true;
        return;
      }
      case 'presets': case 'looks': case 'screenfx': case 'effects':
        askForRow(kind);
        sendFold({ kind: 'open', id: 'stage' });
        break;
      case 'camera':
        cameraLaneShown.set(true);
        askForRow('camera');
        sendFold({ kind: 'open', id: 'stage' });
        break;
      case 'leds': break;
      case 'line':
        if (anchor) online(anchor);
        askForRow('control');
        sendFold({ kind: 'open', id: 'control' });
        break;
    }
    onclose();
  }
</script>

<TlPopover {anchor} {onclose} {placement} width={300} label="Add a row">
  {#if pickPiece}
    <div class="tl-mi-head">Layer on which piece?</div>
    {#each pieces as p (p.id)}
      <button class="tl-mi" onclick={() => { showTimeline.addSubRow(p.layerId); setLayersOpen(true); onclose(); }}><TimelineIcon name="piece" size={14} /><span class="layer-name">{p.layerName}</span></button>
    {:else}
      <div class="tl-pop-row arm-note">Add layers in Mapping first: each one is a piece.</div>
    {/each}
  {:else}
    {#each ITEMS as item (item.kind)}
      {@const disabled = item.kind === 'leds' && !$ledRows.length}
      <button class="tl-mi" {disabled} onclick={() => choose(item.kind)} title={disabled ? 'Set up a WLED controller in Settings first: each one gets a row' : item.desc} data-add-row={item.kind}>
        <TimelineIcon name={item.icon} size={15} />
        <span class="tl-mi-col"><span>{item.label}</span><span class="tl-mi-desc">{disabled ? 'Set up a WLED controller in Settings first' : item.desc}</span></span>
      </button>
    {/each}
  {/if}
</TlPopover>

<style>
  :global(.tl-pop) .arm-note { white-space: normal; font-size: 11px; color: var(--ga-ink-2, #89857e); }
</style>
