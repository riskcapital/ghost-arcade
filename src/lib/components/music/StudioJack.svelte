<script lang="ts">
  /**
   * A patch jack. Drag from an output to an input to patch a cable; drag a
   * plugged input to move its cable, or drop it on nothing to unplug it.
   * The look is PatchJack's, shared with Analog Synth.
   */
  import { cableDrag, lastUnplugged } from '../../music/cablePatching';
  import { canConnect, isOutputJack, jackKind } from '../../music/studioSets';
  import { musicStudio } from '../../music/musicStudioStore';
  import PatchJack from './PatchJack.svelte';

  /** `labelAbove`: the label sits over the jack, so a cable going down from it does not cover the name. */
  let { id, label = '', title = '', labelAbove = false }: { id: string; label?: string; title?: string; labelAbove?: boolean } = $props();

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
    const s = $musicStudio;
    const mine = s.cables[s.set].filter((c) => c.from === id || c.to === id);
    // Alt- or Ctrl-click: unplug everything in this jack.
    if ((e.altKey || e.ctrlKey || e.metaKey) && mine.length) {
      for (const c of mine) musicStudio.disconnectCable(c.id);
      lastUnplugged.set({ cables: mine, at: Date.now() });
      return;
    }
    if (output) {
      cableDrag.set({ from: id, x: e.clientX, y: e.clientY });
      return;
    }
    // Pick up the last cable plugged in here and carry it from its source.
    const cable = mine.filter((c) => c.to === id).at(-1);
    if (!cable) return;
    musicStudio.disconnectCable(cable.id);
    cableDrag.set({ from: cable.from, x: e.clientX, y: e.clientY, carry: cable });
  }
</script>

<PatchJack
  jack={id}
  {kind}
  {label}
  ariaLabel={title || label || id}
  title={plugged ? `${title || label} (drag a cable off to move or unplug it; Alt-click unplugs all; right-click for the list)` : title || label}
  {labelAbove}
  {plugged}
  {accepts}
  {source}
  {dim}
  onpointerdown={down}
/>
