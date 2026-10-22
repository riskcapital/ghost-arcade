<script lang="ts">
  /**
   * Flux and RND for VJ mode, in the free space beside the program preview.
   *
   * Flux is the phone app's XY effect: across changes the character, up is
   * more intense, and the chosen modules combine. It plays on the render
   * core's output stage, so the program preview, the Output Window and every
   * Screen show it. RND throws every playing shader and effect setting to a
   * new random value, like Tab in Performer: from the button, Tab, or MIDI
   * (vj:flux:rnd).
   *
   * The panel sizes itself to the gap between the panel edge and the
   * preview, so the preview never moves; with too little room it shrinks to
   * two buttons.
   */
  import { onDestroy, onMount } from 'svelte';
  import FluxPad from './studio/FluxPad.svelte';
  import { FLUX_BLENDS, FLUX_MODULES, type FluxState } from '../mobile/studio/flux';
  import { deskFlux } from '../stores/deskFlux';
  import { scrambleNow } from '../ableton/scrambleDecks';

  /** The preview's column, and the preview inside it, to measure the gap. */
  export let wrapperEl: HTMLElement | null = null;
  export let previewEl: HTMLElement | null = null;
  /** Effects panel on the right: the gap is on the preview's right. */
  export let reversed = false;

  const FULL_MIN = 190;
  const FULL_MAX = 300;
  const COMPACT_MIN = 60;

  let room = 0;
  let scrambled = false;
  let scrambleTimer: ReturnType<typeof setTimeout> | undefined;

  $: flux = $deskFlux;
  $: mode = room >= FULL_MIN ? 'full' : room >= COMPACT_MIN ? 'compact' : 'none';
  $: width = Math.min(FULL_MAX, room);
  $: live = flux.active && flux.modules.length > 0;

  function change(next: FluxState) { deskFlux.set(next); }
  function patch(p: Partial<FluxState>) { deskFlux.update((s) => ({ ...s, ...p })); }
  function toggleModule(id: string) {
    patch({ modules: flux.modules.includes(id) ? flux.modules.filter((m) => m !== id) : [...flux.modules, id] });
  }
  function toggleStay() { patch({ latch: !flux.latch, active: !flux.latch }); }

  function rnd() {
    scrambleNow('both', 1);
    scrambled = true;
    clearTimeout(scrambleTimer);
    scrambleTimer = setTimeout(() => (scrambled = false), 180);
  }

  function measure() {
    if (!wrapperEl || !previewEl) { room = 0; return; }
    const outer = wrapperEl.getBoundingClientRect();
    const inner = previewEl.getBoundingClientRect();
    const gap = reversed ? outer.right - inner.right : inner.left - outer.left;
    room = Math.max(0, Math.floor(gap - 8));
  }

  // Tab plays RND anywhere in VJ mode, except while typing, inside a
  // dialog, or when Performer has the keyboard (it handles Tab itself).
  function onKey(e: KeyboardEvent) {
    if (e.key !== 'Tab' || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    const target = e.target instanceof Element ? e.target : null;
    if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], dialog')) return;
    e.preventDefault();
    rnd();
  }

  // MIDI / OSC / keyboard bindings: vj:flux:rnd, :on, :x, :y, :mix.
  function onControl(e: Event) {
    const { action, value } = (e as CustomEvent<{ action?: string; value: number }>).detail ?? { value: 0 };
    const v = Math.max(0, Math.min(1, Number(value) || 0));
    if (action === 'rnd') { if (value > 0) rnd(); }
    else if (action === 'on') { if (value > 0) toggleStay(); }
    else if (action === 'x') patch({ x: v, active: true, latch: true });
    else if (action === 'y') patch({ y: v, active: true, latch: true });
    else if (action === 'mix') patch({ mix: v });
  }

  let observer: ResizeObserver | null = null;
  $: if (observer) { observer.disconnect(); if (wrapperEl) observer.observe(wrapperEl); if (previewEl) observer.observe(previewEl); measure(); }
  $: reversed, measure();

  onMount(() => {
    observer = new ResizeObserver(() => measure());
    window.addEventListener('resize', measure);
    window.addEventListener('vj-flux', onControl);
    measure();
  });
  onDestroy(() => {
    observer?.disconnect();
    window.removeEventListener('resize', measure);
    window.removeEventListener('vj-flux', onControl);
    clearTimeout(scrambleTimer);
    // Leaving VJ mode never leaves Flux stuck on a projector.
    deskFlux.update((s) => ({ ...s, active: false, latch: false }));
  });
</script>

<svelte:window onkeydown={onKey} />

{#if mode !== 'none'}
  <div class="vj-flux" class:compact={mode === 'compact'} class:reversed style={`width:${mode === 'full' ? width : 56}px`}>
    {#if mode === 'full'}
      <div class="head">
        <span class="title">FLUX <i class:live></i></span>
        <button class="chip" class:on={flux.latch} aria-pressed={flux.latch} onclick={toggleStay}
          title="Keep Flux on after you let go" data-midi-path="vj:flux:on" data-midi-label="Flux stay on" data-midi-mode="toggle">Stay on</button>
        <button class="rnd" class:flash={scrambled} onclick={rnd}
          title="Scramble every playing shader and effect (Tab)" aria-label="Scramble shader and effect settings"
          data-midi-path="vj:flux:rnd" data-midi-label="RND scramble" data-midi-mode="toggle">RND</button>
      </div>
      <div class="pad">
        <FluxPad value={flux} onchange={change} playHint="Drag to play" emptyHint="Pick modules below" />
      </div>
      <div class="modules" role="group" aria-label="Flux modules: pick the ones to combine">
        {#each FLUX_MODULES as m (m.id)}
          <button class:on={flux.modules.includes(m.id)} aria-pressed={flux.modules.includes(m.id)} title={m.hint} onclick={() => toggleModule(m.id)}>{m.name}</button>
        {/each}
      </div>
      <div class="foot">
        <label title="How much of the Flux picture is mixed in">
          <span>Wet</span>
          <input type="range" min="0" max="1" step="0.01" value={flux.mix}
            oninput={(e) => patch({ mix: Number((e.target as HTMLInputElement).value) })}
            data-midi-path="vj:flux:mix" data-midi-label="Flux wet" data-midi-min="0" data-midi-max="1" />
        </label>
        <div class="row">
          <select aria-label="Flux blend" value={flux.blend ?? 0} onchange={(e) => patch({ blend: Number((e.target as HTMLSelectElement).value) })}>
            {#each FLUX_BLENDS as name, i}<option value={i}>{name}</option>{/each}
          </select>
          <button class="chip" class:on={flux.beat} aria-pressed={flux.beat} onclick={() => patch({ beat: !flux.beat })} title="Lock Flux motion to the beat">Beat</button>
        </div>
      </div>
    {:else}
      <button class="rnd tall" class:flash={scrambled} onclick={rnd} title="Scramble every playing shader and effect (Tab)"
        aria-label="Scramble shader and effect settings" data-midi-path="vj:flux:rnd" data-midi-label="RND scramble" data-midi-mode="toggle">RND</button>
      <button class="chip tall" class:on={flux.latch} aria-pressed={flux.latch} onclick={toggleStay} title="Flux on or off (widen the window for the pad)">FLUX</button>
    {/if}
  </div>
{/if}

<style>
  .vj-flux {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    z-index: 3;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px;
    box-sizing: border-box;
    background: #0d1015;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 6px;
    min-height: 0;
    overflow: hidden;
  }
  .vj-flux.reversed { left: auto; right: 0; }
  .vj-flux.compact { padding: 6px; align-items: stretch; }
  .head { display: flex; align-items: center; gap: 6px; }
  .title { flex: 1; font: 600 11px/1 var(--ga-font-mono, ui-monospace, monospace); letter-spacing: 0.14em; color: #c9cfdb; }
  .title i { display: inline-block; width: 7px; height: 7px; margin-left: 4px; border-radius: 50%; background: #3a3f4b; vertical-align: 1px; }
  .title i.live { background: var(--ga-green, #3ddc84); box-shadow: 0 0 6px var(--ga-green, #3ddc84); }
  button, select {
    background: #161a22; border: 1px solid rgba(255, 255, 255, 0.14); border-radius: 4px;
    color: #d7dbe4; font-family: inherit; font-size: 11px; font-weight: 500; line-height: 1; padding: 6px 8px; cursor: pointer;
  }
  button:hover { border-color: rgba(255, 255, 255, 0.28); }
  .chip.on, .modules button.on { background: var(--ga-blue-900, #18234d); border-color: var(--ga-blue-400, #5278ff); color: #fff; }
  .rnd { font-weight: 700; letter-spacing: 0.08em; border-color: rgba(187, 134, 252, 0.55); color: #e6d4ff; transition: background 0.15s; }
  .rnd.flash { background: rgba(187, 134, 252, 0.45); }
  .tall { flex: 1; writing-mode: vertical-rl; text-orientation: mixed; padding: 6px 0; }
  .pad {
    position: relative; flex: 0 1 auto; width: 100%; aspect-ratio: 1; max-height: 46%; min-height: 80px; align-self: center;
    border-radius: 5px; overflow: hidden; border: 1px solid rgba(255, 255, 255, 0.12);
    background:
      linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px) 0 0 / 25% 25%,
      linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px) 0 0 / 25% 25%,
      radial-gradient(circle at 50% 100%, rgba(82, 120, 255, 0.16), transparent 70%), #07090d;
  }
  .modules {
    flex: 1 1 0; min-height: 30px; overflow-y: auto; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-auto-rows: 26px; gap: 5px; align-content: start; scrollbar-width: thin; padding-right: 2px;
  }
  .modules button { height: 26px; min-height: 26px; padding: 0 6px; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .foot { display: flex; flex-direction: column; gap: 6px; }
  .foot label { display: flex; align-items: center; gap: 8px; font-size: 11px; color: #9aa0ac; }
  .foot input { flex: 1; min-width: 0; accent-color: var(--ga-blue-400, #5278ff); }
  .row { display: flex; gap: 6px; }
  .row select { flex: 1; min-width: 0; }
</style>
