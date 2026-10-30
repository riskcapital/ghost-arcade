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
      </div>
      <div class="stage">
        <div class="pad">
          <!-- The pad's own header: its name and the latch that belongs to it. -->
          <div class="pad-head">
            <span class="title" aria-hidden="true">Flux <i class:live></i></span>
            <button class="chip" class:on={flux.latch} aria-pressed={flux.latch} onclick={toggleStay}
              title="Keep Flux on after you let go" data-midi-path="vj:flux:on" data-midi-label="Flux stay on" data-midi-mode="toggle">Stay on</button>
          </div>
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
      <button class="chip tall" class:on={flux.latch} aria-pressed={flux.latch} onclick={toggleStay} title="Flux on or off (widen the window for the pad)">Flux</button>
    {/if}
  </div>
{/if}

<style>
  /* One button family for the whole panel: 26px, hairline, sentence case;
     the chosen state uses the selection colours. */
  .vj-flux {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    z-index: 3;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px;
    box-sizing: border-box;
    background: var(--ga-panel, #100f0d);
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    border-radius: 6px;
    min-height: 0;
    overflow: hidden;
  }
  .vj-flux.reversed { left: auto; right: 0; }
  /* A skinny panel keeps every control, a little tighter. */
  .vj-flux.narrow { gap: 6px; }
  .vj-flux.narrow .randomize .rnd { padding: 0 6px; }
  .vj-flux.narrow .chip { padding: 0 6px; }
  .vj-flux.narrow .modules { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .vj-flux.narrow .modules button { font-size: var(--ga-text-meta, 11px); }
  .vj-flux.compact { padding: 6px; gap: 6px; align-items: stretch; }
  .head { display: flex; align-items: center; gap: 6px; position: relative; }
  button, select {
    height: var(--ga-control-h, 26px);
    box-sizing: border-box;
    padding: 0 10px;
    background: var(--ga-card, #16140f);
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    border-radius: var(--ga-r-hard, 5px);
    color: var(--ga-ink-1, #ada9a2);
    font-family: inherit;
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-control, 600);
    letter-spacing: 0;
    line-height: 1;
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s, color 0.12s;
  }
  button:hover { border-color: var(--ga-line-3, rgba(245, 236, 222, 0.24)); color: var(--ga-ink-0, #f2ede4); }
  .chip.on, .modules button.on, .gear.on, .fx.on, .options button.on {
    background: var(--ga-selection-bg, #1f3170);
    border-color: var(--ga-selection-line, #5278ff);
    color: var(--ga-selection-ink, #e0e8ff);
  }
  /* Randomize and its options read as one split button. */
  .randomize { flex: 1; min-width: 0; display: flex; }
  .randomize .rnd {
    flex: 1; min-width: 0; border-radius: var(--ga-r-hard, 5px) 0 0 var(--ga-r-hard, 5px);
    color: var(--ga-ink-0, #f2ede4);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .randomize .gear {
    flex: none; width: var(--ga-control-h, 26px); padding: 0; border-left: none;
    border-radius: 0 var(--ga-r-hard, 5px) var(--ga-r-hard, 5px) 0;
    display: flex; align-items: center; justify-content: center;
  }
  .randomize.flash .rnd, .rnd.tall.flash { background: var(--ga-selection-bg, #1f3170); border-color: var(--ga-selection-line, #5278ff); color: var(--ga-selection-ink, #e0e8ff); }
  .options {
    position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 6; display: flex; gap: 4px; padding: 4px;
    background: var(--ga-sub, #1e1b16); border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    border-radius: var(--ga-r-hard, 5px); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
  }
  .options button { flex: 1; min-width: 0; padding: 0 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tall { flex: 1; height: auto; writing-mode: vertical-rl; text-orientation: mixed; padding: 6px 0; }
  .rnd.tall { color: var(--ga-ink-0, #f2ede4); }
  /* The pad fills the panel; the effect picker slides up over its lower part. */
  .stage { position: relative; flex: 1; min-height: 90px; border-radius: var(--ga-r-hard, 5px); overflow: hidden; }
  .pad {
    position: absolute; inset: 0; border-radius: var(--ga-r-hard, 5px); overflow: hidden;
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    background:
      linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px) 0 0 / 25% 25%,
      linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px) 0 0 / 25% 25%,
      radial-gradient(circle at 50% 100%, var(--ga-blue-a16, rgba(82, 120, 255, 0.16)), transparent 70%),
      var(--ga-slot, #060504);
  }
  .pad-head {
    position: absolute; top: 4px; left: 8px; right: 4px; z-index: 5;
    display: flex; align-items: center; justify-content: space-between; gap: 6px;
    pointer-events: none;
  }
  .pad-head .chip { pointer-events: auto; height: var(--ga-control-h-sm, 22px); padding: 0 8px; }
  .vj-flux.narrow .pad-head .chip { padding: 0 6px; }
  /* Eyebrow: the panel's one uppercase label. */
  .title {
    display: inline-flex; align-items: center; gap: 6px;
    font-size: var(--ga-text-eyebrow, 10px); font-weight: 700; line-height: 1;
    letter-spacing: var(--ga-eyebrow-tracking, 0.08em); text-transform: uppercase;
    color: var(--ga-ink-2, #89857e);
  }
  .title i { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--ga-ink-3, #39342c); }
  .title i.live { background: var(--ga-green, #46d18a); box-shadow: 0 0 6px var(--ga-green, #46d18a); }
  .drawer {
    position: absolute; left: 0; right: 0; bottom: 0; z-index: 5; max-height: 100%; overflow-y: auto;
    display: flex; flex-direction: column; gap: 6px; padding: 8px;
    background: color-mix(in srgb, var(--ga-panel, #100f0d) 96%, transparent);
    border-top: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    transform: translateY(102%); transition: transform 0.22s ease; scrollbar-width: thin;
  }
  .drawer.open { transform: translateY(0); }
  .modules { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 4px; }
  .modules button { padding: 0 4px; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row { display: flex; gap: 6px; }
  .row select { flex: 1; min-width: 0; }
  .foot { display: flex; align-items: center; gap: 8px; }
  .foot label {
    flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px;
    font-size: var(--ga-text-control, 12px); font-weight: var(--ga-weight-body, 500);
    color: var(--ga-ink-1, #ada9a2); white-space: nowrap;
  }
  .foot input { flex: 1; min-width: 0; accent-color: var(--ga-selection-line, #5278ff); }
  .fx { flex: none; display: flex; align-items: center; gap: 6px; }
  /* Count badge on the FX button. */
  .fx b {
    min-width: 14px; height: 14px; padding: 0 3px; box-sizing: border-box; border-radius: 7px;
    font-size: var(--ga-text-micro, 9px); font-weight: 700; line-height: 14px; text-align: center;
    background: var(--ga-selection-line, #5278ff); color: var(--ga-selection-ink, #e0e8ff);
  }
</style>
