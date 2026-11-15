<script lang="ts" module>
  /**
   * The Timeline's icons: one stroke family (24 grid, stroke 1.4, round
   * caps), drawn in currentColor so a button's own colour states carry over.
   */
  type El = { t: 'path' | 'circle' | 'rect'; d?: string; cx?: number; cy?: number; r?: number; x?: number; y?: number; w?: number; h?: number; rx?: number; fill?: string; stroke?: string; sw?: number; opacity?: number };
  const PATHS = {
    // Transport and time
    play: [{ t: 'path', d: 'M7 4.5l12 7.5-12 7.5z', fill: 'currentColor', stroke: 'none' }],
    pause: [{ t: 'path', d: 'M8.5 5v14M15.5 5v14' }],
    stop: [{ t: 'rect', x: 6, y: 6, w: 12, h: 12, rx: 1.5, fill: 'currentColor', stroke: 'none' }],
    home: [{ t: 'path', d: 'M6 5v14M19 5l-9 7 9 7z' }],
    loop: [{ t: 'path', d: 'M17 3l3 3-3 3M4 11V9a3 3 0 0 1 3-3h13M7 21l-3-3 3-3M20 13v2a3 3 0 0 1-3 3H4' }],
    caret: [{ t: 'path', d: 'M7 10l5 5 5-5' }],
    chevron: [{ t: 'path', d: 'M6 9l6 6 6-6' }],
    'chevron-right': [{ t: 'path', d: 'M9 6l6 6-6 6' }],
    tempo: [{ t: 'path', d: 'M9 3h6l3 18H6z' }, { t: 'path', d: 'M12 15l5-8' }],
    // Edit tools
    select: [{ t: 'path', d: 'M6 3.5l12.5 7.2-5.6 1.6-2.4 5.6z' }],
    razor: [{ t: 'circle', cx: 6, cy: 6.5, r: 2.5 }, { t: 'circle', cx: 6, cy: 17.5, r: 2.5 }, { t: 'path', d: 'M8.2 8L20 18M8.2 16L20 6' }],
    ripple: [{ t: 'path', d: 'M7 4H4v16h3M10 12h10M16.5 8.5L20 12l-3.5 3.5' }],
    roll: [{ t: 'path', d: 'M12 4v16M3 12h5M16 12h5M6 9.5L3.5 12 6 14.5M18 9.5l2.5 2.5-2.5 2.5' }],
    slip: [{ t: 'rect', x: 3, y: 7, w: 18, h: 10, rx: 1.5 }, { t: 'path', d: 'M8 12h8M10 10l-2 2 2 2M14 10l2 2-2 2' }],
    forward: [{ t: 'path', d: 'M4 4v16M8 12h12M16.5 8.5L20 12l-3.5 3.5M8 7h3M8 17h3' }],
    pen: [{ t: 'path', d: 'M4 20l1-4L16 5l3 3L8 19zM14 7l3 3' }],
    snap: [{ t: 'path', d: 'M6 3v8a6 6 0 0 0 12 0V3M6 7h4M14 7h4' }],
    'zoom-in': [{ t: 'circle', cx: 11, cy: 11, r: 6.5 }, { t: 'path', d: 'M20.5 20.5l-4.8-4.8M11 8v6M8 11h6' }],
    'zoom-out': [{ t: 'circle', cx: 11, cy: 11, r: 6.5 }, { t: 'path', d: 'M20.5 20.5l-4.8-4.8M8 11h6' }],
    fit: [{ t: 'path', d: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5' }],
    // Show and window
    speaker: [{ t: 'path', d: 'M11 5L6.5 9H3v6h3.5l4.5 4z' }, { t: 'path', d: 'M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13' }],
    'speaker-off': [{ t: 'path', d: 'M11 5L6.5 9H3v6h3.5l4.5 4z' }, { t: 'path', d: 'M16 9.5l5 5M21 9.5l-5 5' }],
    record: [{ t: 'circle', cx: 12, cy: 12, r: 5.5, fill: 'currentColor', stroke: 'none' }],
    pads: [{ t: 'rect', x: 3.5, y: 3.5, w: 7, h: 7, rx: 1.5 }, { t: 'rect', x: 13.5, y: 3.5, w: 7, h: 7, rx: 1.5 }, { t: 'rect', x: 3.5, y: 13.5, w: 7, h: 7, rx: 1.5 }, { t: 'rect', x: 13.5, y: 13.5, w: 7, h: 7, rx: 1.5 }],
    expand: [{ t: 'path', d: 'M14 4h6v6M10 20H4v-6M20 4l-6.5 6.5M4 20l6.5-6.5' }],
    collapse: [{ t: 'path', d: 'M20 10h-6V4M4 14h6v6M14 10l6.5-6.5M10 14l-6.5 6.5' }],
    help: [{ t: 'circle', cx: 12, cy: 12, r: 9 }, { t: 'path', d: 'M9.6 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.6M12 17h.01' }],
    more: [{ t: 'circle', cx: 5.5, cy: 12, r: .9, fill: 'currentColor' }, { t: 'circle', cx: 12, cy: 12, r: .9, fill: 'currentColor' }, { t: 'circle', cx: 18.5, cy: 12, r: .9, fill: 'currentColor' }],
    close: [{ t: 'path', d: 'M6 6l12 12M18 6L6 18' }],
    plus: [{ t: 'path', d: 'M12 5v14M5 12h14' }],
    check: [{ t: 'path', d: 'M5 12.5l4.5 4.5L19 7.5' }],
    keyboard: [{ t: 'rect', x: 3, y: 6.5, w: 18, h: 11, rx: 2 }, { t: 'path', d: 'M7 10.5h.01M10.5 10.5h.01M14 10.5h.01M17 10.5h.01M8 14h8' }],
    out: [{ t: 'path', d: 'M7 17L17 7M9 7h8v8' }],
    gear: [{ t: 'circle', cx: 12, cy: 12, r: 3 }, { t: 'path', d: 'M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1' }],
    pin: [{ t: 'path', d: 'M12 3v4M8 7h8l-1 6 3 3H6l3-3zM12 16v5' }],
    search: [{ t: 'circle', cx: 11, cy: 11, r: 6.5 }, { t: 'path', d: 'M20.5 20.5l-4.8-4.8' }],
    // Rows
    eye: [{ t: 'path', d: 'M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z' }, { t: 'circle', cx: 12, cy: 12, r: 2.8 }],
    'eye-off': [{ t: 'path', d: 'M3 3l18 18M10.6 5.6A10 10 0 0 1 12 5.5c6.4 0 10 6.5 10 6.5a17 17 0 0 1-3 3.8M6.6 6.9C3.8 8.6 2 12 2 12s3.6 6.5 10 6.5c1.8 0 3.3-.5 4.6-1.2' }],
    solo: [{ t: 'path', d: 'M4.5 14v-2a7.5 7.5 0 0 1 15 0v2' }, { t: 'rect', x: 3.5, y: 14, w: 4, h: 6, rx: 1.5 }, { t: 'rect', x: 16.5, y: 14, w: 4, h: 6, rx: 1.5 }],
    lock: [{ t: 'rect', x: 5, y: 11, w: 14, h: 9.5, rx: 2 }, { t: 'path', d: 'M8 11V8a4 4 0 0 1 8 0v3' }],
    unlock: [{ t: 'rect', x: 5, y: 11, w: 14, h: 9.5, rx: 2 }, { t: 'path', d: 'M8 11V8a4 4 0 0 1 7.5-2' }],
    'line-add': [{ t: 'path', d: 'M3 17l5-6 4 3 5-7' }, { t: 'path', d: 'M19 3v6M16 6h6' }],
    'layer-add': [{ t: 'path', d: 'M12 3l9 5-9 5-9-5z' }, { t: 'path', d: 'M3 13l9 5 4-2.2' }, { t: 'path', d: 'M19 15v6M16 18h6' }],
    live: [{ t: 'circle', cx: 12, cy: 12, r: 2, fill: 'currentColor' }, { t: 'path', d: 'M8.5 15.5a5 5 0 0 1 0-7M15.5 8.5a5 5 0 0 1 0 7M5.6 18.4a9 9 0 0 1 0-12.8M18.4 5.6a9 9 0 0 1 0 12.8' }],
    ret: [{ t: 'path', d: 'M9 14L4 9l5-5' }, { t: 'path', d: 'M4 9h11a5 5 0 0 1 0 10h-3' }],
    song: [{ t: 'path', d: 'M9 18V5l11-2v13' }, { t: 'circle', cx: 6, cy: 18, r: 3 }, { t: 'circle', cx: 17, cy: 16, r: 3 }],
    group: [{ t: 'rect', x: 3.5, y: 8, w: 10, h: 10, rx: 1.5 }, { t: 'path', d: 'M8.5 8V5.5A1.5 1.5 0 0 1 10 4h8.5A1.5 1.5 0 0 1 20 5.5V14a1.5 1.5 0 0 1-1.5 1.5H13.5' }],
    layers: [{ t: 'path', d: 'M12 3l9 5-9 5-9-5z' }, { t: 'path', d: 'M3 12.5l9 5 9-5' }, { t: 'path', d: 'M3 16.5l9 5 9-5', opacity: .55 }],
    piece: [{ t: 'path', d: 'M5 6l14-1.5V19L5 17.5z' }],
    stage: [{ t: 'rect', x: 3, y: 4.5, w: 18, h: 11, rx: 1.5 }, { t: 'path', d: 'M8 20h8M12 15.5V20' }],
    control: [{ t: 'path', d: 'M3 17l5-6 4 3 5-7 4 4' }, { t: 'circle', cx: 8, cy: 11, r: 1.2, fill: 'currentColor' }, { t: 'circle', cx: 17, cy: 7, r: 1.2, fill: 'currentColor' }],
    flag: [{ t: 'path', d: 'M6 21V4h11l-2.5 4L17 12H6' }],
    marker: [{ t: 'path', d: 'M6 21V4h11l-2.5 4L17 12H6' }],
    sections: [{ t: 'path', d: 'M3 5h5v14H3zM10 5h4v14h-4zM16 5h5v14h-5z' }],
    cues: [{ t: 'path', d: 'M9 6h11M9 12h11M9 18h11' }, { t: 'path', d: 'M4 6h.01M4 12h.01M4 18h.01', sw: 2.6 }],
    handoff: [{ t: 'path', d: 'M4 12h11M11.5 8.5L15 12l-3.5 3.5M19 5v14' }],
    jump: [{ t: 'path', d: 'M4 17V9a4 4 0 0 1 4-4h9' }, { t: 'path', d: 'M14 2l3 3-3 3' }, { t: 'path', d: 'M4 20h.01' }],
    hold: [{ t: 'path', d: 'M8.5 5v14M15.5 5v14' }],
    phrases: [{ t: 'rect', x: 3.5, y: 3.5, w: 7, h: 7, rx: 1.5 }, { t: 'rect', x: 13.5, y: 3.5, w: 7, h: 7, rx: 1.5 }, { t: 'rect', x: 3.5, y: 13.5, w: 7, h: 7, rx: 1.5 }, { t: 'rect', x: 13.5, y: 13.5, w: 7, h: 7, rx: 1.5 }],
    sparkle: [{ t: 'path', d: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z' }, { t: 'path', d: 'M19 15l.7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7z' }],
    fx: [{ t: 'path', d: 'M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8' }],
    wave: [{ t: 'path', d: 'M3 12h1.5M7 8.5v7M10.5 5v14M14 8v8M17.5 10v4M21 12h0' }],
    media: [{ t: 'rect', x: 3, y: 5, w: 18, h: 14, rx: 2 }, { t: 'path', d: 'M10 9l5 3-5 3z', fill: 'currentColor' }],
    split: [{ t: 'path', d: 'M12 3v18M7 7l-3 5 3 5M17 7l3 5-3 5' }],
    dup: [{ t: 'rect', x: 8, y: 8, w: 12, h: 12, rx: 2 }, { t: 'path', d: 'M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8' }],
    trash: [{ t: 'path', d: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3' }],
    camera: [{ t: 'path', d: 'M3 8h4l2-3h6l2 3h4v11H3z' }, { t: 'circle', cx: 12, cy: 13, r: 3.2 }],
    led: [{ t: 'path', d: 'M3 12h18' }, { t: 'circle', cx: 6, cy: 12, r: 1.6 }, { t: 'circle', cx: 12, cy: 12, r: 1.6 }, { t: 'circle', cx: 18, cy: 12, r: 1.6 }],
    look: [{ t: 'path', d: 'M4 18L12 4l8 14z' }, { t: 'path', d: 'M8.5 11.5h7' }],
    preset: [{ t: 'rect', x: 4, y: 4, w: 16, h: 16, rx: 2 }, { t: 'path', d: 'M4 9h16M9 20V9' }],
    ableton: [{ t: 'path', d: 'M4 6v12M8 6v12M12 6v12M16 9h4M16 13h4M16 17h4' }],
    blackout: [{ t: 'circle', cx: 12, cy: 12, r: 8.5 }, { t: 'path', d: 'M6 6l12 12' }],
    sliders: [{ t: 'path', d: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0' }, { t: 'circle', cx: 16, cy: 6, r: 2 }, { t: 'circle', cx: 10, cy: 12, r: 2 }, { t: 'circle', cx: 18, cy: 18, r: 2 }],
    back: [{ t: 'path', d: 'M15 6l-6 6 6 6' }],
    reset: [{ t: 'path', d: 'M6 5v14M19 5l-9 7 9 7z' }],
  } satisfies Record<string, readonly El[]>;

  export type TimelineIconName = keyof typeof PATHS;
</script>

<script lang="ts">
  interface Props {
    name: TimelineIconName;
    size?: number;
  }
  let { name, size = 16 }: Props = $props();
</script>

<svg class="tl-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  {#each (PATHS[name] as readonly El[]) ?? [] as el, i (i)}
    {#if el.t === 'path'}
      <path d={el.d} fill={el.fill} stroke={el.stroke} stroke-width={el.sw} opacity={el.opacity} />
    {:else if el.t === 'circle'}
      <circle cx={el.cx} cy={el.cy} r={el.r} fill={el.fill} stroke={el.stroke} />
    {:else}
      <rect x={el.x} y={el.y} width={el.w} height={el.h} rx={el.rx} fill={el.fill} stroke={el.stroke} />
    {/if}
  {/each}
</svg>

<style>
  .tl-icon { flex-shrink: 0; display: block; }
</style>
