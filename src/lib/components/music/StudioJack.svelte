<script lang="ts">
  /**
   * A patch jack. Drag from an output to an input to patch a cable; drag a
   * plugged input to move its cable, or drop it on nothing to unplug it.
   */
  import { cableDrag } from '../../music/cablePatching';
  import { isOutputJack, jackKind } from '../../music/studioSets';
  import { musicStudio } from '../../music/musicStudioStore';

  let { id, label = '', title = '' }: { id: string; label?: string; title?: string } = $props();

  const output = $derived(isOutputJack(id));
  const kind = $derived(jackKind(id));
  const plugged = $derived($musicStudio.cables[$musicStudio.set].some((c) => c.from === id || c.to === id));
  const dragging = $derived($cableDrag);
  const accepts = $derived(!!dragging && !output && jackKind(dragging.from) === kind);

  function down(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (output) {
      cableDrag.set({ from: id, x: e.clientX, y: e.clientY });
      return;
    }
    // Pick up the cable already plugged in here and carry it from its source.
    const s = $musicStudio;
    const cable = s.cables[s.set].find((c) => c.to === id);
    if (!cable) return;
    musicStudio.disconnectCable(cable.id);
    cableDrag.set({ from: cable.from, x: e.clientX, y: e.clientY });
  }
</script>

<span class="jack-wrap" class:output>
  <button
    class="jack {kind}"
    class:plugged
    class:accepts
    data-jack={id}
    aria-label={title || label || id}
    title={title || label}
    onpointerdown={down}
  ></button>
  {#if label}<span class="jack-label">{label}</span>{/if}
</span>

<style>
  .jack-wrap {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    flex: 0 0 auto;
  }
  .jack {
    width: 18px;
    height: 18px;
    padding: 0;
    box-sizing: border-box;
    border-radius: 50%;
    border: 3px solid var(--studio-jack-ring, #cfc7b2);
    background: #050505;
    box-shadow: inset 0 0 0 2px #1a1816, 0 1px 0 rgba(255, 255, 255, 0.06);
    cursor: grab;
    touch-action: none;
  }
  .jack.control { border-color: var(--studio-jack-cv, #8fa9bd); }
  .jack.accepts { box-shadow: 0 0 0 3px var(--studio-accent-soft), 0 0 10px var(--studio-accent); }
  .jack:focus-visible { outline: 2px solid var(--studio-accent); outline-offset: 2px; }
  .jack-label {
    font-size: 8px;
    font-weight: 800;
    letter-spacing: 0.08em;
    color: var(--studio-muted);
    text-transform: uppercase;
    white-space: nowrap;
  }
</style>
