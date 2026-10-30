<script lang="ts">
  /**
   * A patch jack. Drag from an output to an input to patch a cable; drag a
   * plugged input to move its cable, or drop it on nothing to unplug it.
   */
  import { cableDrag } from '../../music/cablePatching';
  import { canConnect, isOutputJack, jackKind } from '../../music/studioSets';
  import { musicStudio } from '../../music/musicStudioStore';

  let { id, label = '', title = '' }: { id: string; label?: string; title?: string } = $props();

  const output = $derived(isOutputJack(id));
  const kind = $derived(jackKind(id));
  const plugged = $derived($musicStudio.cables[$musicStudio.set].some((c) => c.from === id || c.to === id));
  const dragging = $derived($cableDrag);
  // While a cable is in the hand, the jacks it can plug into light up and the rest step back.
  const accepts = $derived(!!dragging && canConnect(dragging.from, id));
  const source = $derived(!!dragging && dragging.from === id);
  const dim = $derived(!!dragging && !accepts && !source);

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

<span class="jack-wrap" class:output class:accepts class:dim>
  <button
    class="jack {kind}"
    class:plugged
    class:accepts
    class:source
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
    border: 3px solid var(--studio-jack-ring, #c9d3ee);
    background: #03050b;
    box-shadow: inset 0 0 0 2px #121833, 0 1px 0 rgba(255, 255, 255, 0.06);
    cursor: grab;
    touch-action: none;
    transition: transform 120ms ease;
  }
  .jack.control { border-color: var(--studio-jack-cv, #7ec8e3); }
  .jack.accepts {
    border-color: var(--studio-accent);
    transform: scale(1.25);
    box-shadow: 0 0 0 3px var(--studio-accent-soft), 0 0 12px var(--studio-accent);
    animation: invite 0.9s ease-in-out infinite alternate;
  }
  .jack.source { border-color: var(--studio-ink); box-shadow: 0 0 0 3px var(--studio-accent-soft); }
  .jack-wrap.accepts .jack-label { color: var(--studio-accent); }
  .jack-wrap.dim { opacity: 0.22; transition: opacity 120ms ease; }
  @keyframes invite {
    from { box-shadow: 0 0 0 2px var(--studio-accent-soft), 0 0 6px var(--studio-accent); }
    to { box-shadow: 0 0 0 5px var(--studio-accent-soft), 0 0 16px var(--studio-accent); }
  }
  .jack:focus-visible { outline: 2px solid var(--studio-accent); outline-offset: 2px; }
  .jack-label {
    font-size: var(--ga-text-micro, 9px);
    font-weight: 700;
    letter-spacing: var(--ga-eyebrow-tracking, 0.08em);
    line-height: 1.2;
    color: var(--studio-muted);
    text-transform: uppercase;
    white-space: nowrap;
  }
</style>
