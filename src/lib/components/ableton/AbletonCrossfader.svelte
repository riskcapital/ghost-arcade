<script lang="ts">
  /**
   * Crossfader — a DJ mixer's fader: a recessed slot with a scale, a
   * ridged cap that slides with the hand, and deck lamps that light with
   * each side's level. Grab the cap and it moves relative to the grab;
   * press anywhere on the slot and it jumps there. Double-click centres it.
   * Arrow keys nudge, Home and End cut to a deck.
   */
  export let value: number;
  export let linked = false;
  export let compact = false;
  export let onChange: (value: number) => void;

  const TICKS = 11;

  let slot: HTMLDivElement;
  let dragging = false;
  let grabOffset = 0;

  // Constant-power levels, as a mixer hears them.
  $: levelA = Math.cos((value * Math.PI) / 2);
  $: levelB = Math.sin((value * Math.PI) / 2);

  function valueAt(clientX: number): number {
    const rect = slot.getBoundingClientRect();
    const inset = rect.height * 0.5;
    return Math.max(0, Math.min(1, (clientX - rect.left - inset) / Math.max(1, rect.width - inset * 2)));
  }

  function onPointerDown(event: PointerEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    slot.setPointerCapture(event.pointerId);
    const onCap = (event.target as HTMLElement).closest('.cap');
    grabOffset = onCap ? valueAt(event.clientX) - value : 0;
    dragging = true;
    if (!onCap) onChange(valueAt(event.clientX));
  }

  function onPointerMove(event: PointerEvent) {
    if (!dragging) return;
    onChange(Math.max(0, Math.min(1, valueAt(event.clientX) - grabOffset)));
  }

  function onPointerUp(event: PointerEvent) {
    dragging = false;
    if (slot.hasPointerCapture(event.pointerId)) slot.releasePointerCapture(event.pointerId);
  }

  function onKeyDown(event: KeyboardEvent) {
    const step = event.shiftKey ? 0.1 : 0.02;
    let next: number | null = null;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = value - step;
    else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = value + step;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = 1;
    if (next === null) return;
    event.preventDefault();
    onChange(Math.max(0, Math.min(1, next)));
  }
</script>

<div class="xfader" class:compact class:dragging>
  <div class="lamps">
    <button class="lamp a" style="--level: {levelA}" onclick={() => onChange(0)} title="Cut to deck A">A</button>
    <span class="state">{linked ? 'Linked' : 'Live only'}</span>
    <button class="lamp b" style="--level: {levelB}" onclick={() => onChange(1)} title="Cut to deck B">B</button>
  </div>
  <div
    class="slot"
    bind:this={slot}
    role="slider"
    tabindex="0"
    aria-label="Crossfader"
    aria-valuemin="0"
    aria-valuemax="100"
    aria-valuenow={Math.round(value * 100)}
    aria-valuetext={value < 0.02 ? 'Deck A' : value > 0.98 ? 'Deck B' : `${Math.round(value * 100)}% to B`}
    title="Moves Live's crossfader{linked ? " and Ghost Arcade's" : ''}. Double-click to centre"
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
    ondblclick={() => onChange(0.5)}
    onkeydown={onKeyDown}
  >
    <div class="scale" aria-hidden="true">
      {#each Array(TICKS) as _, i}
        <span class="tick" class:major={i === 0 || i === TICKS - 1 || i === (TICKS - 1) / 2} style="left: {(i / (TICKS - 1)) * 100}%"></span>
      {/each}
    </div>
    <div class="groove" aria-hidden="true"></div>
    <div class="travel" aria-hidden="true">
      <div class="cap" style="left: {value * 100}%">
        <span class="grip"></span>
      </div>
    </div>
  </div>
  <div class="cuts">
    <button onclick={() => onChange(0)}>◀ A</button>
    <button onclick={() => onChange(0.5)}>Centre</button>
    <button onclick={() => onChange(1)}>B ▶</button>
  </div>
</div>

<style>
  .xfader {
    --a: #5dcaa5;
    --b: #f0997b;
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
    padding: 10px 12px 8px;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: linear-gradient(180deg, #15181e, #0d0f13);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
    user-select: none;
  }
  .lamps { display: flex; align-items: center; justify-content: space-between; }
  .lamp {
    width: 28px;
    height: 22px;
    border-radius: 3px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    font: inherit;
    font-weight: 800;
    font-size: 12px;
    cursor: pointer;
    color: color-mix(in srgb, var(--deck) calc(var(--level) * 100%), #4a4f58);
    background: color-mix(in srgb, var(--deck) calc(var(--level) * 22%), #0b0d10);
    box-shadow: 0 0 calc(var(--level) * 14px) color-mix(in srgb, var(--deck) calc(var(--level) * 60%), transparent);
  }
  .lamp.a { --deck: var(--a); }
  .lamp.b { --deck: var(--b); }
  .state { font-size: 9px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--ga-ink-2, #8a909b); }

  .slot {
    position: relative;
    height: 46px;
    border-radius: 6px;
    cursor: pointer;
    outline: none;
    touch-action: none;
  }
  .slot:focus-visible { box-shadow: 0 0 0 1px var(--ga-ink-0, #eef0f4); }
  /* The scale runs over the cap's travel, which is inset by half the slot's
     height so the cap never overhangs the ends. */
  .scale, .travel { position: absolute; left: 23px; right: 23px; top: 0; bottom: 0; }
  .tick { position: absolute; top: 4px; width: 1px; height: 6px; background: rgba(255, 255, 255, 0.18); transform: translateX(-0.5px); }
  .tick.major { height: 9px; background: rgba(255, 255, 255, 0.42); }
  .scale::after { content: ''; position: absolute; left: 0; right: 0; bottom: 4px; border-bottom: 1px dashed rgba(255, 255, 255, 0.1); }
  .groove {
    position: absolute;
    left: 14px;
    right: 14px;
    top: 50%;
    height: 6px;
    transform: translateY(-50%);
    border-radius: 3px;
    background: #020304;
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.9), 0 1px 0 rgba(255, 255, 255, 0.06);
  }
  .cap {
    position: absolute;
    top: 50%;
    width: 22px;
    height: 40px;
    transform: translate(-50%, -50%);
    border-radius: 3px;
    background:
      linear-gradient(90deg, rgba(0, 0, 0, 0.35), transparent 30%, transparent 70%, rgba(0, 0, 0, 0.35)),
      linear-gradient(180deg, #e9ebef, #9aa0aa 48%, #c9ccd2 52%, #7d838d);
    box-shadow: 0 3px 8px rgba(0, 0, 0, 0.7), inset 0 1px 0 rgba(255, 255, 255, 0.7);
    cursor: grab;
    will-change: left;
  }
  .grip {
    position: absolute;
    inset: 5px 4px;
    background: repeating-linear-gradient(180deg, rgba(0, 0, 0, 0.32) 0 1px, transparent 1px 4px);
    border-radius: 1px;
  }
  .grip::after { content: ''; position: absolute; left: 50%; top: -3px; bottom: -3px; width: 2px; transform: translateX(-50%); background: #fff; box-shadow: 0 0 4px rgba(255, 255, 255, 0.8); }
  .dragging .cap { cursor: grabbing; }
  .cuts { display: flex; justify-content: space-between; gap: 4px; }
  .cuts button {
    flex: 1;
    height: 20px;
    border-radius: 3px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: transparent;
    color: var(--ga-ink-2, #8a909b);
    font: inherit;
    font-size: 10px;
    letter-spacing: 0.06em;
    cursor: pointer;
  }
  .cuts button:hover { color: var(--ga-ink-0, #eef0f4); border-color: rgba(255, 255, 255, 0.28); }
  .compact { padding: 6px 8px; gap: 5px; }
  .compact .slot { height: 38px; }
  .compact .cap { height: 32px; width: 18px; }
  .compact .scale, .compact .travel { left: 19px; right: 19px; }
  .compact .cuts { display: none; }
</style>
