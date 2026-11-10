<script lang="ts">
  /**
   * One keyframe lane, drawn as its value curve with a diamond per key.
   *
   * Store-independent: it gets a `KeyframeTrack` and reports edits through
   * callbacks, so the show's lanes (show seconds) can use it without the
   * per-preset Keyframes tray's store. The curve is `evaluateTrack` itself,
   * so what is drawn is what plays.
   *
   * - Double-click: add a key there (value from the height you clicked).
   * - Drag a key: move it in time and value (several selected keys move in
   *   time together). Hold Cmd/Ctrl to move without snapping.
   * - Shift-click: add to the selection. Right-click: easing and delete.
   */
  import type { KeyframeEasing, KeyframeTrack } from '../../../types';
  import { evaluateTrack, KEYFRAME_EASINGS } from '../../../keyframes/easing';
  import { LANE_KEY_EPSILON } from '../../../show/tracks/showTrackLanes';
  import { laneValueToY, laneYToValue, portal } from './trackLayout';

  interface Props {
    lane: KeyframeTrack;
    zoom: number;
    viewStart: number;
    viewEnd: number;
    height: number;
    min: number;
    max: number;
    /** The parameter is not on the layer right now: shown greyed, still editable. */
    inactive?: boolean;
    locked?: boolean;
    selectedTimes: readonly number[];
    snap: (t: number) => number;
    onaddkey: (time: number, value: number | boolean) => void;
    onmovekey: (from: number, to: number, value: number | boolean | undefined, dragId: string) => void;
    onshiftkeys: (times: number[], delta: number, dragId: string) => void;
    onselectkeys: (times: number[], additive: boolean) => void;
    ondeletekeys: (times: number[]) => void;
    oneasing: (times: number[], easing: KeyframeEasing) => void;
  }

  let {
    lane, zoom, viewStart, viewEnd, height, min, max, inactive = false, locked = false,
    selectedTimes, snap, onaddkey, onmovekey, onshiftkeys, onselectkeys, ondeletekeys, oneasing,
  }: Props = $props();

  let el: HTMLDivElement | undefined = $state();
  const isBool = $derived(lane.type === 'boolean');
  const keys = $derived(isBool
    ? lane.boolKeyframes.map((k) => ({ time: k.time, value: k.value ? 1 : 0, easing: 'step' as KeyframeEasing }))
    : lane.keyframes.map((k) => ({ time: k.time, value: k.value, easing: k.easing })));
  const visibleKeys = $derived(keys.filter((k) => k.time >= viewStart - 1 && k.time <= viewEnd + 1));

  function isSelected(time: number): boolean {
    return selectedTimes.some((t) => Math.abs(t - time) < LANE_KEY_EPSILON);
  }

  /** The curve over the visible window, a point every 3 px. */
  const curve = $derived.by(() => {
    if (!keys.length) return '';
    const t0 = Math.max(0, viewStart);
    const t1 = Math.max(t0 + 0.001, viewEnd);
    const step = 3 / Math.max(0.0001, zoom);
    let d = '';
    for (let t = t0, i = 0; t <= t1 + step && i < 4000; t += step, i++) {
      const raw = evaluateTrack(lane, t);
      const v = typeof raw === 'boolean' ? (raw ? 1 : 0) : Number(raw ?? 0);
      const x = (t - t0) * zoom;
      const y = laneValueToY(v, isBool ? 0 : min, isBool ? 1 : max, height);
      d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    }
    return d;
  });

  function timeAt(clientX: number): number {
    if (!el) return 0;
    return Math.max(0, (clientX - el.getBoundingClientRect().left) / zoom);
  }
  function valueAt(clientY: number): number {
    if (!el) return 0;
    const y = clientY - el.getBoundingClientRect().top;
    return laneYToValue(y, min, max, height);
  }

  let dragSeq = 0;

  function pressKey(e: MouseEvent, key: { time: number; value: number }) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    menu = null;
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    const already = isSelected(key.time);
    if (additive) onselectkeys(already ? selectedTimes.filter((t) => Math.abs(t - key.time) >= LANE_KEY_EPSILON) : [...selectedTimes, key.time], false);
    else if (!already) onselectkeys([key.time], false);
    if (locked || (additive && already)) return;
    const group = additive || already ? (already ? [...selectedTimes] : [...selectedTimes, key.time]) : [key.time];
    const grab = timeAt(e.clientX) - key.time;
    const dragId = `${Date.now()}-${++dragSeq}`;
    let current = key.time;
    let moved = false;
    const startX = e.clientX;
    const startY = e.clientY;
    const onMove = (ev: MouseEvent) => {
      if (!moved && Math.abs(ev.clientX - startX) < 3 && Math.abs(ev.clientY - startY) < 3) return;
      moved = true;
      let t = Math.max(0, timeAt(ev.clientX) - grab);
      if (!(ev.metaKey || ev.ctrlKey)) t = snap(t);
      if (group.length > 1) {
        const delta = t - current;
        if (Math.abs(delta) < 1e-9) return;
        onshiftkeys(group.map((g) => g + (current - key.time)), delta, dragId);
        current = t;
        return;
      }
      const value = isBool ? undefined : valueAt(ev.clientY);
      onmovekey(current, t, value, dragId);
      current = t;
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (moved) {
        if (group.length > 1) onselectkeys(group.map((g) => g + (current - key.time)), false);
        else onselectkeys([current], false);
        swallowClick();
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  /** The grid seeks on click; a drag that ends here is not a click. */
  function swallowClick() {
    const stop = (ev: Event) => { ev.stopPropagation(); };
    window.addEventListener('click', stop, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 0);
  }

  function addAt(e: MouseEvent) {
    if (locked) return;
    e.stopPropagation();
    const t = e.metaKey || e.ctrlKey ? timeAt(e.clientX) : snap(timeAt(e.clientX));
    if (isBool) {
      const now = evaluateTrack(lane, t);
      onaddkey(t, !(now === true));
    } else {
      onaddkey(t, valueAt(e.clientY));
    }
  }

  // ── Context menu ─────────────────────────────────────────────────────
  let menu: { x: number; y: number; time: number } | null = $state(null);

  function openMenu(e: MouseEvent, time: number) {
    e.preventDefault();
    e.stopPropagation();
    if (!isSelected(time)) onselectkeys([time], false);
    menu = { x: e.clientX, y: e.clientY, time };
  }

  function menuTimes(): number[] {
    if (!menu) return [];
    return isSelected(menu.time) && selectedTimes.length ? [...selectedTimes] : [menu.time];
  }

  $effect(() => {
    if (!menu) return;
    const close = () => { menu = null; };
    const t = setTimeout(() => window.addEventListener('mousedown', close), 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousedown', close);
    };
  });

  function fmtValue(v: number): string {
    return isBool ? (v ? 'On' : 'Off') : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="kl-lane"
  class:inactive
  class:bool={isBool}
  style:height="{height}px"
  bind:this={el}
  ondblclick={addAt}
  data-lane-key={lane.key}
>
  {#if curve}
    <svg
      class="kl-curve"
      style:left="{Math.max(0, viewStart) * zoom}px"
      width={Math.max(1, (viewEnd - Math.max(0, viewStart)) * zoom + 6)}
      height={height}
      aria-hidden="true"
    >
      <path d={curve} />
    </svg>
  {/if}
  {#each visibleKeys as key (key.time)}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="kl-key"
      class:selected={isSelected(key.time)}
      style:left="{key.time * zoom}px"
      style:top="{laneValueToY(key.value, isBool ? 0 : min, isBool ? 1 : max, height)}px"
      onmousedown={(e) => pressKey(e, key)}
      oncontextmenu={(e) => openMenu(e, key.time)}
      ondblclick={(e) => e.stopPropagation()}
      title={`${lane.label}: ${fmtValue(key.value)} at ${key.time.toFixed(2)}s`}
      data-key-time={key.time}
    ></div>
  {/each}
</div>

{#if menu}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="kl-menu" use:portal style:left="{menu.x}px" style:top="{menu.y}px" onmousedown={(e) => e.stopPropagation()}>
    {#if !isBool}
      <div class="kl-menu-head">Easing to the next key</div>
      {#each KEYFRAME_EASINGS as opt}
        <button class="kl-menu-item" title={opt.hint} onclick={() => { oneasing(menuTimes(), opt.value); menu = null; }}>{opt.label}</button>
      {/each}
      <div class="kl-menu-sep"></div>
    {/if}
    <button class="kl-menu-item danger" onclick={() => { ondeletekeys(menuTimes()); menu = null; }}>Delete key</button>
  </div>
{/if}

<style>
  .kl-lane {
    position: relative;
    box-sizing: border-box;
    border-bottom: 1px solid var(--ga-line, rgba(255, 255, 255, 0.05));
    background: rgba(255, 255, 255, 0.015);
  }
  .kl-lane.inactive { opacity: 0.4; }
  .kl-curve {
    position: absolute;
    top: 0;
    pointer-events: none;
    overflow: visible;
  }
  .kl-curve path {
    fill: none;
    stroke: color-mix(in srgb, var(--ga-coral, #ff6f5e) 70%, transparent);
    stroke-width: 1.5;
  }
  .kl-lane.bool .kl-curve path { stroke: var(--ga-blue-200, #9db4ff); }
  .kl-key {
    position: absolute;
    width: 9px;
    height: 9px;
    margin: -4.5px 0 0 -4.5px;
    transform: rotate(45deg);
    background: var(--ga-coral, #ff6f5e);
    border: 1px solid rgba(0, 0, 0, 0.6);
    box-sizing: border-box;
    cursor: grab;
    z-index: 2;
  }
  .kl-lane.bool .kl-key { background: var(--ga-blue-200, #9db4ff); }
  .kl-key:hover { background: color-mix(in srgb, var(--ga-coral, #ff6f5e) 70%, #ffffff); }
  .kl-key.selected {
    background: #FFD96B;
    box-shadow: 0 0 6px rgba(255, 217, 107, 0.9);
  }
  .kl-menu {
    position: fixed;
    z-index: 10000;
    min-width: 170px;
    padding: 4px;
    background: var(--ga-raise, #14141a);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-soft, 6px);
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.6);
    transform: translateY(-100%);
  }
  .kl-menu-head {
    font-size: var(--ga-text-eyebrow, 10px);
    text-transform: uppercase;
    letter-spacing: var(--ga-eyebrow-tracking, 0.08em);
    color: var(--ga-ink-2, #7a7a86);
    padding: 4px 8px;
  }
  .kl-menu-item {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: 0;
    color: var(--ga-ink-0, #ddd);
    font: inherit;
    font-size: var(--ga-text-control, 12px);
    padding: 4px 8px;
    border-radius: 3px;
    cursor: pointer;
  }
  .kl-menu-item:hover { background: var(--ga-selection-bg, #1f3170); color: var(--ga-selection-ink, #e0e8ff); }
  .kl-menu-item.danger { color: var(--ga-rec, #ff4757); }
  .kl-menu-sep { height: 1px; margin: 4px 0; background: var(--ga-line-2, rgba(255, 255, 255, 0.12)); }
</style>
