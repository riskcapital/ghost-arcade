<script lang="ts">
  /**
   * How a patch jack looks, for every patchable instrument (Audio Lab's
   * StudioJack, Analog Synth): a ringed socket with its legend. What a press
   * does, and whether a cable is in it or on its way, is up to the instrument.
   */
  let {
    jack,
    kind = null,
    label = '',
    title = '',
    ariaLabel = '',
    labelAbove = false,
    plugged = false,
    accepts = false,
    source = false,
    dim = false,
    target = false,
    onpointerdown,
  }: {
    /** The jack's id, on `data-jack`, where the cables find it. */
    jack: string;
    /** `control` draws the control ring; anything else the sound ring. */
    kind?: string | null;
    label?: string;
    title?: string;
    ariaLabel?: string;
    /** The label sits over the jack, so a cable going down from it does not cover the name. */
    labelAbove?: boolean;
    /** A cable is in it: a lit centre, so what is connected reads with the cables hidden. */
    plugged?: boolean;
    /** A cable in the hand could go here. */
    accepts?: boolean;
    /** The cable in the hand comes from here. */
    source?: boolean;
    /** A cable is in the hand and cannot go here. */
    dim?: boolean;
    /** The cable in the hand will drop here. */
    target?: boolean;
    onpointerdown: (e: PointerEvent) => void;
  } = $props();
</script>

<span class="jack-wrap" class:accepts class:dim class:label-above={labelAbove}>
  <button
    class="jack {kind ?? ''}"
    class:plugged
    class:accepts
    class:source
    class:target
    data-jack={jack}
    aria-label={ariaLabel || title || label || jack}
    title={title || label}
    {onpointerdown}
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
  .jack-wrap.label-above { flex-direction: column-reverse; }
  .jack {
    width: 18px;
    height: 18px;
    padding: 0;
    box-sizing: border-box;
    border-radius: 50%;
    border: 3px solid var(--studio-jack-ring, #c9d3ee);
    background: var(--studio-slot);
    box-shadow: inset 0 0 0 2px var(--studio-cell), 0 1px 0 rgba(255, 255, 255, 0.06);
    cursor: grab;
    touch-action: none;
    transition: transform 120ms ease;
  }
  .jack.control { border-color: var(--studio-jack-cv, #7ec8e3); }
  .jack.plugged { background: radial-gradient(circle, var(--studio-accent) 0 3px, #03050b 3.5px); }
  .jack.accepts {
    border-color: var(--studio-accent);
    transform: scale(1.25);
    box-shadow: 0 0 0 3px var(--studio-accent-soft), 0 0 12px var(--studio-accent);
    animation: invite 0.9s ease-in-out infinite alternate;
  }
  .jack.target {
    transform: scale(1.45);
    box-shadow: 0 0 0 4px var(--studio-accent), 0 0 18px var(--studio-accent);
    animation: none;
  }
  .jack.source { border-color: var(--studio-ink); box-shadow: 0 0 0 3px var(--studio-accent-soft); }
  .jack-wrap.accepts .jack-label { color: var(--studio-accent); }
  .jack-wrap.dim { opacity: 0.22; transition: opacity 120ms ease; }
  @keyframes invite {
    from { box-shadow: 0 0 0 2px var(--studio-accent-soft), 0 0 6px var(--studio-accent); }
    to { box-shadow: 0 0 0 5px var(--studio-accent-soft), 0 0 16px var(--studio-accent); }
  }
  @media (prefers-reduced-motion: reduce) {
    .jack.accepts { animation: none; }
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
