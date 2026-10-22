<script lang="ts">
  /**
   * Flux and RND for VJ mode, in the free space beside the program preview.
   *
   * Flux is the phone app's XY effect: across changes the character, up is
   * more intense, and the chosen modules combine. It plays on the render
   * core's output stage, so the program preview, the Output Window and every
   * Screen show it. Randomize throws every playing shader and/or effect
   * setting (the gear chooses) to a new random value, like Tab in Performer:
   * from the button, Tab, or MIDI (vj:flux:rnd). The effect picker slides up
   * over the pad from the FX button, so the pad stays large while playing.
   *
   * The panel sizes itself to the gap between the panel edge and the
   * preview, so the preview never moves; with too little room it shrinks to
   * two buttons.
   */
  import { onDestroy, onMount, tick } from 'svelte';
  import FluxPad from './studio/FluxPad.svelte';
  import { FLUX_BLENDS, FLUX_MODULES, type FluxState } from '../mobile/studio/flux';
  import { deskFlux } from '../stores/deskFlux';
  import { scrambleNow } from '../ableton/scrambleDecks';
  import type { ScrambleTarget } from '../ableton/beatScramble';

  /** The preview's column, and the preview inside it, to measure the gap. */
  export let wrapperEl: HTMLElement | null = null;
  export let previewEl: HTMLElement | null = null;
  /** Effects panel on the right: the gap is on the preview's right. */
  export let reversed = false;
  /** Changes whenever the preview moves without resizing (A/B centring). */
  export let layoutKey: unknown = null;

  const FULL_MIN = 170;
  const FULL_MAX = 640;
  const COMPACT_MIN = 60;

  const TARGET_KEY = 'ga.vj.randomize';
  const TARGETS: { id: ScrambleTarget; label: string }[] = [
    { id: 'both', label: 'Shader + FX' },
    { id: 'shader', label: 'Shader only' },
    { id: 'fx', label: 'FX only' },
  ];

  let room = 0;
  /** The module picker, blend and beat lock slide up over the pad. */
  let fxOpen = false;
  let optionsOpen = false;
  let target: ScrambleTarget = readTarget();
  let scrambled = false;

  function readTarget(): ScrambleTarget {
    try {
      const saved = localStorage.getItem(TARGET_KEY);
      if (saved === 'shader' || saved === 'fx' || saved === 'both') return saved;
    } catch { /* storage blocked */ }
    return 'both';
  }
  function setTarget(next: ScrambleTarget) {
    target = next;
    optionsOpen = false;
    try { localStorage.setItem(TARGET_KEY, next); } catch { /* storage blocked */ }
  }
  let scrambleTimer: ReturnType<typeof setTimeout> | undefined;

  $: flux = $deskFlux;
  $: mode = room >= FULL_MIN ? 'full' : room >= COMPACT_MIN ? 'compact' : 'none';
  // The panel fills the whole gap up to the preview, narrower when the
  // preview needs the room.
  $: width = Math.min(FULL_MAX, room);
  $: live = flux.active && flux.modules.length > 0;

  function change(next: FluxState) { deskFlux.set(next); }
  function patch(p: Partial<FluxState>) { deskFlux.update((s) => ({ ...s, ...p })); }
  function toggleModule(id: string) {
    patch({ modules: flux.modules.includes(id) ? flux.modules.filter((m) => m !== id) : [...flux.modules, id] });
  }
  function toggleStay() { patch({ latch: !flux.latch, active: !flux.latch }); }

  function rnd() {
    scrambleNow(target, 1);
    scrambled = true;
    clearTimeout(scrambleTimer);
    scrambleTimer = setTimeout(() => (scrambled = false), 180);
  }

  // The Randomize options close on any click outside them.
  function closeOptions(e: PointerEvent) {
    if (optionsOpen && !(e.target instanceof Element && e.target.closest('.vj-flux .randomize'))) optionsOpen = false;
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
  $: reversed, layoutKey, void tick().then(measure);

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

<svelte:window onkeydown={onKey} onpointerdown={closeOptions} />

{#if mode !== 'none'}
  <div class="vj-flux" class:compact={mode === 'compact'} class:narrow={mode === 'full' && width < 230} class:reversed style={`width:${mode === 'full' ? width : 56}px`}>
    {#if mode === 'full'}
      <div class="head">
        <div class="randomize" class:flash={scrambled}>
          <button class="rnd" onclick={rnd}
            title={`Randomize ${TARGETS.find((t) => t.id === target)?.label.toLowerCase()} settings on everything playing (Tab)`}
            aria-label="Randomize settings"
            data-midi-path="vj:flux:rnd" data-midi-label="Randomize" data-midi-mode="toggle">Randomize</button>
          <button class="gear" class:on={optionsOpen} aria-label="What Randomize changes" aria-expanded={optionsOpen}
            title="Choose what Randomize changes" onclick={() => (optionsOpen = !optionsOpen)}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          </button>
          {#if optionsOpen}
            <div class="options" role="radiogroup" aria-label="Randomize changes">
              {#each TARGETS as t (t.id)}
                <button role="radio" aria-checked={target === t.id} class:on={target === t.id} onclick={() => setTarget(t.id)}>{t.label}</button>
              {/each}
            </div>
          {/if}
        </div>
        <button class="chip" class:on={flux.latch} aria-pressed={flux.latch} onclick={toggleStay}
          title="Keep Flux on after you let go" data-midi-path="vj:flux:on" data-midi-label="Flux stay on" data-midi-mode="toggle">Stay on</button>
      </div>
      <div class="stage">
        <div class="pad">
          <span class="title" aria-hidden="true">FLUX <i class:live></i></span>
          <FluxPad value={flux} onchange={change} playHint="Drag to play" emptyHint="Pick effects with FX" />
        </div>
        <div class="drawer" class:open={fxOpen} aria-hidden={!fxOpen} inert={!fxOpen}>
          <div class="modules" role="group" aria-label="Flux effects: pick the ones to combine">
            {#each FLUX_MODULES as m (m.id)}
              <button class:on={flux.modules.includes(m.id)} aria-pressed={flux.modules.includes(m.id)} title={m.hint} onclick={() => toggleModule(m.id)}>{m.name}</button>
            {/each}
          </div>
          <div class="row">
            <select aria-label="Flux blend" title="How Flux mixes with the picture" value={flux.blend ?? 0} onchange={(e) => patch({ blend: Number((e.target as HTMLSelectElement).value) })}>
              {#each FLUX_BLENDS as name, i}<option value={i}>{name}</option>{/each}
            </select>
            <button class="chip" class:on={flux.beat} aria-pressed={flux.beat} onclick={() => patch({ beat: !flux.beat })} title="Lock Flux motion to the beat">Beat</button>
          </div>
        </div>
      </div>
      <div class="foot">
        <label title="How much of the Flux picture is mixed in">
          <span>{width < 230 ? 'Wet' : 'Wet / dry'}</span>
          <input type="range" min="0" max="1" step="0.01" value={flux.mix}
            oninput={(e) => patch({ mix: Number((e.target as HTMLInputElement).value) })}
            data-midi-path="vj:flux:mix" data-midi-label="Flux wet" data-midi-min="0" data-midi-max="1" />
        </label>
        <button class="fx" class:on={fxOpen} aria-expanded={fxOpen} onclick={() => (fxOpen = !fxOpen)}
          title={fxOpen ? 'Close the effect picker' : 'Choose the Flux effects, blend and beat lock'}>
          FX{#if flux.modules.length}<b>{flux.modules.length}</b>{/if}
        </button>
      </div>
    {:else}
      <button class="rnd tall" class:flash={scrambled} onclick={rnd} title="Scramble every playing shader and effect (Tab)"
        aria-label="Randomize settings" data-midi-path="vj:flux:rnd" data-midi-label="Randomize" data-midi-mode="toggle">RND</button>
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
  /* A skinny panel keeps every control, a little tighter. */
  .vj-flux.narrow { padding: 8px; gap: 6px; }
  .vj-flux.narrow .head { gap: 4px; }
  .vj-flux.narrow .randomize .rnd { letter-spacing: 0; padding: 6px 4px; }
  .vj-flux.narrow .chip { padding: 6px 5px; }
  .vj-flux.narrow .modules { gap: 3px; }
  .vj-flux.narrow .modules button { font-size: 9px; padding: 0 1px; }
  .vj-flux.compact { padding: 6px; align-items: stretch; }
  .head { display: flex; align-items: center; gap: 6px; position: relative; }
  .title { position: absolute; top: 7px; left: 8px; z-index: 5; pointer-events: none; font: 600 10px/1 var(--ga-font-mono, ui-monospace, monospace); letter-spacing: 0.14em; color: rgba(201, 207, 219, 0.7); }
  .title i { display: inline-block; width: 7px; height: 7px; margin-left: 3px; border-radius: 50%; background: #3a3f4b; vertical-align: 1px; }
  .title i.live { background: var(--ga-green, #3ddc84); box-shadow: 0 0 6px var(--ga-green, #3ddc84); }
  button, select {
    background: #161a22; border: 1px solid rgba(255, 255, 255, 0.14); border-radius: 4px;
    color: #d7dbe4; font-family: inherit; font-size: 11px; font-weight: 500; line-height: 1; padding: 6px 8px; cursor: pointer;
  }
  button:hover { border-color: rgba(255, 255, 255, 0.28); }
  .chip.on, .modules button.on, .gear.on, .fx.on, .options button.on { background: var(--ga-blue-900, #18234d); border-color: var(--ga-blue-400, #5278ff); color: #fff; }
  .randomize { flex: 1; min-width: 0; display: flex; }
  .randomize .rnd {
    flex: 1; min-width: 0; border-radius: 4px 0 0 4px; font-weight: 700; letter-spacing: 0.04em;
    border-color: rgba(187, 134, 252, 0.55); color: #e6d4ff; transition: background 0.15s;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .randomize .gear { flex: none; padding: 0 7px; border-radius: 0 4px 4px 0; border-left: none; border-color: rgba(187, 134, 252, 0.55); color: #cdb8f0; display: flex; align-items: center; }
  .randomize.flash .rnd { background: rgba(187, 134, 252, 0.45); }
  .options {
    position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 6; display: flex; gap: 4px; padding: 5px;
    background: #10131a; border: 1px solid rgba(255, 255, 255, 0.16); border-radius: 5px; box-shadow: 0 8px 24px #000a;
  }
  .options button { flex: 1; padding: 7px 4px; }
  .rnd.tall { font-weight: 700; border-color: rgba(187, 134, 252, 0.55); color: #e6d4ff; transition: background 0.15s; }
  .rnd.tall.flash { background: rgba(187, 134, 252, 0.45); }
  .tall { flex: 1; writing-mode: vertical-rl; text-orientation: mixed; padding: 6px 0; }
  /* The pad fills the panel; the effect picker slides up over its lower part. */
  .stage { position: relative; flex: 1; min-height: 90px; border-radius: 5px; overflow: hidden; }
  .pad {
    position: absolute; inset: 0; border-radius: 5px; overflow: hidden; border: 1px solid rgba(255, 255, 255, 0.12);
    background:
      linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px) 0 0 / 25% 25%,
      linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px) 0 0 / 25% 25%,
      radial-gradient(circle at 50% 100%, rgba(82, 120, 255, 0.16), transparent 70%), #07090d;
  }
  .drawer {
    position: absolute; left: 0; right: 0; bottom: 0; z-index: 5; max-height: 100%; overflow-y: auto;
    display: flex; flex-direction: column; gap: 6px; padding: 8px;
    background: rgba(13, 16, 21, 0.96); border-top: 1px solid rgba(255, 255, 255, 0.14);
    transform: translateY(102%); transition: transform 0.22s ease; scrollbar-width: thin;
  }
  .drawer.open { transform: translateY(0); }
  .modules { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); grid-auto-rows: 26px; gap: 4px; }
  .modules button { height: 26px; padding: 0 3px; font-size: 10px; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row { display: flex; gap: 6px; }
  .row select { flex: 1; min-width: 0; }
  .foot { display: flex; align-items: center; gap: 8px; }
  .foot label { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; font-size: 11px; color: #9aa0ac; white-space: nowrap; }
  .foot input { flex: 1; min-width: 0; accent-color: var(--ga-blue-400, #5278ff); }
  .fx { flex: none; font-weight: 700; letter-spacing: 0.06em; display: flex; align-items: center; gap: 4px; }
  .fx b { font-size: 9px; min-width: 14px; height: 14px; line-height: 14px; border-radius: 7px; background: var(--ga-blue-400, #5278ff); color: #fff; }
</style>
