<script lang="ts">
  /**
   * The show's transport in the Stage Sim window.
   *
   * The editor plays the show (picture and sound); this bar only mirrors its
   * transport and sends it commands, so rehearsing never starts a second
   * audio clock. Keys while the stage view is up: Enter or Shift+Space play
   * and pause (Space alone stays the hand tool), ← / → jump between markers,
   * Home goes to the start. While tracks are taken over live in the editor,
   * a LIVE pill and Return hand them back from here.
   */
  import { onDestroy, onMount } from 'svelte';
  import {
    pauseCameraFollow,
    sendRehearsalCommand,
    stageCameraFollow,
    stageShow,
    stageViewLatencySeconds,
  } from '../../show/rehearsal/stageRehearsal';
  import { REHEARSAL_MAX_AUDIO_DELAY, createSeekThrottle, epochNow, formatShowClock, showTimeAt } from '../../show/rehearsal/rehearsalBridge';
  import { formatBarsBeats } from '../../show/tempoMap';

  const show = $derived($stageShow);
  const duration = $derived(show?.duration ?? 0);
  const hasLane = $derived((show?.cameraLane.length ?? 0) > 0);
  // The playhead ticks ~20 times a second; these keep their identity until
  // the arrangement changes, so the blocks below are not redrawn per tick.
  const presets = $derived(show?.presets ?? []);
  const cameraLane = $derived(show?.cameraLane ?? []);
  const markers = $derived(show?.markers ?? []);

  // ── Smooth clock: extrapolated between the editor's 20 Hz states ──────
  let now = $state(epochNow());
  const playing = $derived(!!show?.isPlaying);
  $effect(() => {
    if (!playing) return;
    let raf = 0;
    const frame = () => {
      now = epochNow();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  });

  let scrubTime = $state<number | null>(null);
  const time = $derived(scrubTime ?? (show ? showTimeAt(show, now) : 0));
  const barsBeats = $derived(show?.tempo ? formatBarsBeats(show.tempo, time) : null);
  const pct = (t: number) => (duration > 0 ? Math.max(0, Math.min(100, (t / duration) * 100)) : 0);

  function toggle() { sendRehearsalCommand({ op: 'toggle' }); }
  function stop() { sendRehearsalCommand({ op: 'stop' }); }
  function home() { sendRehearsalCommand({ op: 'home' }); }
  const takeover = $derived(show?.takeover ?? null);
  function returnTakeover(e: MouseEvent) { sendRehearsalCommand({ op: 'takeoverReturn', instant: e.shiftKey }); }
  function toggleLoop() { if (show) sendRehearsalCommand({ op: 'loop', on: !show.loop }); }

  // ── Scrubber ───────────────────────────────────────────────────────────
  let barEl = $state<HTMLDivElement | undefined>();
  // A drag sends at most ~10 seeks a second (each hard-seeks the editor's
  // audio and video); pressing and letting go land exactly.
  const seeks = createSeekThrottle((seconds) => sendRehearsalCommand({ op: 'seek', seconds }));
  function timeAtPointer(e: PointerEvent): number {
    if (!barEl || duration <= 0) return 0;
    const r = barEl.getBoundingClientRect();
    return Math.max(0, Math.min(duration, ((e.clientX - r.left) / Math.max(1, r.width)) * duration));
  }
  function scrubTo(t: number, force = false) {
    scrubTime = t;
    seeks.seek(t, force);
  }
  function onBarDown(e: PointerEvent) {
    if (e.button !== 0 || !show?.hasShow) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    scrubTo(timeAtPointer(e), true);
  }
  function onBarMove(e: PointerEvent) {
    if (scrubTime === null) return;
    scrubTo(timeAtPointer(e));
  }
  function onBarUp(e: PointerEvent) {
    if (scrubTime === null) return;
    scrubTo(timeAtPointer(e), true);
    // Hold the dragged position until the editor's state catches up.
    setTimeout(() => { scrubTime = null; }, 120);
  }

  // ── Audio sync ─────────────────────────────────────────────────────────
  let syncOpen = $state(false);
  let measuredMs = $state<number | null>(null);
  function setDelay(enabled: boolean, seconds: number) {
    sendRehearsalCommand({ op: 'audioDelay', enabled, seconds });
  }
  function openSync() {
    syncOpen = !syncOpen;
    if (syncOpen) measuredMs = Math.round(stageViewLatencySeconds() * 1000);
  }

  // ── Keys (window capture, ahead of the stage renderer's own keys) ─────
  function isTextEntry(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
  }
  function take(e: KeyboardEvent) {
    e.preventDefault();
    e.stopPropagation();
  }
  function onKeydown(e: KeyboardEvent) {
    if (!show?.hasShow || isTextEntry(e.target)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const space = e.code === 'Space' || e.key === ' ';
    if ((e.key === 'Enter' && !e.shiftKey) || (space && e.shiftKey)) {
      take(e);
      if (!e.repeat) toggle();
      return;
    }
    if (e.shiftKey) {
      // Shift+arrows keep trucking the camera: that is the user flying it.
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') pauseCameraFollow();
      return;
    }
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && markers.length > 0) {
      take(e);
      sendRehearsalCommand({ op: 'marker', dir: e.key === 'ArrowLeft' ? -1 : 1 });
      return;
    }
    if (e.key === 'Home') {
      take(e);
      home();
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') pauseCameraFollow();
  }

  // ── Grabbing the camera pauses "Follow show camera" ────────────────────
  let grab: { x: number; y: number } | null = null;
  function onPointerDown(e: PointerEvent) {
    grab = e.target instanceof HTMLCanvasElement ? { x: e.clientX, y: e.clientY } : null;
  }
  function onPointerMove(e: PointerEvent) {
    if (!grab || e.buttons === 0) return;
    if (Math.hypot(e.clientX - grab.x, e.clientY - grab.y) > 4) {
      grab = null;
      pauseCameraFollow();
    }
  }
  function onPointerUp() { grab = null; }
  function onWheel(e: WheelEvent) {
    if (e.target instanceof HTMLCanvasElement) pauseCameraFollow();
  }

  onMount(() => {
    window.addEventListener('keydown', onKeydown, { capture: true });
    window.addEventListener('pointerdown', onPointerDown, { capture: true });
    window.addEventListener('pointermove', onPointerMove, { capture: true });
    window.addEventListener('pointerup', onPointerUp, { capture: true });
    window.addEventListener('wheel', onWheel, { capture: true, passive: true });
  });
  onDestroy(() => {
    seeks.cancel();
    window.removeEventListener('keydown', onKeydown, { capture: true });
    window.removeEventListener('pointerdown', onPointerDown, { capture: true });
    window.removeEventListener('pointermove', onPointerMove, { capture: true });
    window.removeEventListener('pointerup', onPointerUp, { capture: true });
    window.removeEventListener('wheel', onWheel, { capture: true });
  });
</script>

{#if show?.hasShow}
  <div class="sst" data-stage-show-transport data-help-page="stage-simulator">
    <div class="sst-buttons">
      <button class="sst-btn" onclick={home} title="Go to the start (Home)" aria-label="Go to the start">⏮</button>
      <button
        class="sst-btn sst-play"
        class:on={show.isPlaying}
        onclick={toggle}
        disabled={show.chasing}
        title={show.chasing ? 'Timecode is driving the show' : show.isPlaying ? 'Pause the show (Enter)' : 'Play the show (Enter)'}
        aria-label={show.isPlaying ? 'Pause the show' : 'Play the show'}
        data-stage-show-play
      >{show.isPlaying ? '❚❚' : '▶'}</button>
      <button class="sst-btn" onclick={stop} disabled={show.chasing} title="Stop and go back to the start" aria-label="Stop the show">■</button>
    </div>

    <div class="sst-time" data-stage-show-time>
      <span class="sst-clock">{formatShowClock(time)}</span>
      <span class="sst-dur">/ {formatShowClock(duration)}</span>
      {#if barsBeats}<span class="sst-bars" title="Bar . beat">{barsBeats}</span>{/if}
    </div>

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="sst-bar"
      bind:this={barEl}
      onpointerdown={onBarDown}
      onpointermove={onBarMove}
      onpointerup={onBarUp}
      onpointercancel={onBarUp}
      title="Drag to move through the show"
      data-stage-show-scrubber
    >
      {#each presets as preset, i (preset.id)}
        <div
          class="sst-preset"
          class:odd={i % 2 === 1}
          style:left="{pct(preset.start)}%"
          style:width="{Math.max(0.3, pct(preset.start + preset.duration) - pct(preset.start))}%"
          title={preset.label}
        ></div>
      {/each}
      {#each cameraLane as clip (clip.id)}
        <div
          class="sst-shot"
          style:left="{pct(clip.startTime)}%"
          style:width="{Math.max(0.3, pct(clip.startTime + clip.duration) - pct(clip.startTime))}%"
        ></div>
      {/each}
      {#each markers as marker (marker.id)}
        <div class="sst-marker" style:left="{pct(marker.time)}%" title={marker.label || 'Marker'}></div>
      {/each}
      <div class="sst-head" style:left="{pct(time)}%"></div>
    </div>

    <div class="sst-buttons">
      <button
        class="sst-chip"
        class:on={show.loop}
        aria-pressed={show.loop}
        onclick={toggleLoop}
        title="Loop the show"
      >Loop</button>
      {#if hasLane}
        <button
          class="sst-chip"
          class:on={$stageCameraFollow}
          aria-pressed={$stageCameraFollow}
          onclick={() => stageCameraFollow.set(!$stageCameraFollow)}
          title="Move the camera with the show's Stage camera lane. Moving the camera by hand pauses it."
          data-stage-camera-follow
        >Follow show camera</button>
      {/if}
      <div class="sst-sync-wrap">
        <button
          class="sst-chip"
          class:on={show.audioDelay.enabled}
          aria-pressed={syncOpen}
          onclick={openSync}
          title="Delay the show's sound so it lines up with this view"
          data-stage-audio-sync
        >Audio sync</button>
        {#if syncOpen}
          <div class="sst-pop" data-stage-audio-sync-panel>
            <label class="sst-row">
              <input
                type="checkbox"
                checked={show.audioDelay.enabled}
                onchange={(e) => setDelay((e.currentTarget as HTMLInputElement).checked, show.audioDelay.seconds || (measuredMs ?? 0) / 1000)}
              />
              <span>Delay the show audio</span>
            </label>
            <label class="sst-row">
              <input
                type="range"
                min="0"
                max={REHEARSAL_MAX_AUDIO_DELAY * 1000}
                step="5"
                value={Math.round(show.audioDelay.seconds * 1000)}
                disabled={!show.audioDelay.enabled}
                oninput={(e) => setDelay(true, Number((e.currentTarget as HTMLInputElement).value) / 1000)}
              />
              <span class="sst-ms">{Math.round(show.audioDelay.seconds * 1000)} ms</span>
            </label>
            {#if measuredMs !== null}
              <button class="sst-chip" onclick={() => setDelay(true, (measuredMs ?? 0) / 1000)} title="This view runs about this far behind the output">Use measured: {measuredMs} ms</button>
            {/if}
            <p class="sst-note">The stage view runs a little behind the output. Only the speakers are delayed, and only while this window is open.</p>
          </div>
        {/if}
      </div>
      {#if takeover}
        <span class="sst-live" title="Surfaces taken over live; the show runs on underneath" data-stage-takeover-pill>LIVE {takeover.count}</span>
        <button class="sst-chip sst-return" onclick={returnTakeover} title="Hand every taken-over track back to the timeline (Shift: instantly)" data-stage-takeover-return>Return to timeline</button>
      {/if}
    </div>
  </div>
{/if}

<style>
  .sst {
    position: absolute;
    left: 50%;
    bottom: 56px;
    transform: translateX(-50%);
    width: min(860px, calc(100% - 32px));
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 10px;
    background: var(--ga-card, rgba(18, 18, 23, 0.92));
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: 10px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
    color: var(--ga-ink-0, #eee);
    font-size: var(--ga-text-control, 12px);
    pointer-events: auto;
    z-index: 24;
    box-sizing: border-box;
  }
  .sst-buttons { display: flex; align-items: center; gap: 4px; flex: none; }
  .sst-btn {
    width: 28px; height: 26px;
    display: inline-flex; align-items: center; justify-content: center;
    background: transparent;
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: 6px;
    color: var(--ga-ink-1, #ccc);
    font-size: 11px;
    cursor: pointer;
  }
  .sst-btn:hover:not(:disabled) { color: var(--ga-ink-0, #fff); border-color: var(--ga-line-3, rgba(255, 255, 255, 0.25)); }
  .sst-btn:disabled { opacity: 0.4; cursor: default; }
  .sst-play { width: 34px; }
  .sst-play.on { background: color-mix(in srgb, var(--ga-accent, #8b7cff) 28%, transparent); color: #fff; }
  .sst-time { display: flex; align-items: baseline; gap: 5px; flex: none; font-variant-numeric: tabular-nums; }
  .sst-clock { font-weight: 600; min-width: 46px; text-align: right; }
  .sst-dur { color: var(--ga-ink-2, #999); }
  .sst-bars { color: var(--ga-ink-1, #bbb); padding-left: 4px; }
  .sst-bar {
    position: relative;
    flex: 1 1 auto;
    min-width: 80px;
    height: 22px;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 4px;
    cursor: pointer;
    touch-action: none;
    overflow: hidden;
  }
  .sst-preset { position: absolute; top: 3px; height: 10px; background: rgba(255, 111, 94, 0.45); border-radius: 2px; }
  .sst-preset.odd { background: rgba(255, 111, 94, 0.3); }
  .sst-shot { position: absolute; bottom: 3px; height: 4px; background: rgba(92, 225, 230, 0.55); border-radius: 1px; }
  .sst-marker { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: var(--ga-amber, #f0c674); }
  .sst-head { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: #fff; box-shadow: 0 0 4px rgba(255, 255, 255, 0.7); }
  .sst-chip {
    height: 24px;
    padding: 0 8px;
    background: transparent;
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: 6px;
    color: var(--ga-ink-1, #ccc);
    font-size: 11px;
    white-space: nowrap;
    cursor: pointer;
  }
  .sst-chip.on { color: #fff; border-color: color-mix(in srgb, var(--ga-accent, #8b7cff) 70%, transparent); background: color-mix(in srgb, var(--ga-accent, #8b7cff) 22%, transparent); }
  .sst-sync-wrap { position: relative; }
  .sst-pop {
    position: absolute;
    right: 0;
    bottom: calc(100% + 8px);
    width: 250px;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: var(--ga-card, #121217);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: 8px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5);
  }
  .sst-row { display: flex; align-items: center; gap: 8px; }
  .sst-row input[type='range'] { flex: 1; }
  .sst-ms { min-width: 48px; text-align: right; font-variant-numeric: tabular-nums; }
  .sst-note { margin: 0; color: var(--ga-ink-2, #999); font-size: 11px; line-height: 1.35; }
  .sst-live {
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.06em;
    color: #1a0d02;
    background: #ff8c28;
    border-radius: 10px;
    padding: 2px 8px;
    white-space: nowrap;
    animation: sst-live-pulse 1.4s ease-in-out infinite;
  }
  @keyframes sst-live-pulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(255, 140, 40, 0.65); }
    50% { box-shadow: 0 0 0 5px rgba(255, 140, 40, 0); }
  }
  .sst-return { border-color: rgba(255, 140, 40, 0.6); color: #ffb070; white-space: nowrap; }
  @media (prefers-reduced-motion: reduce) { .sst-live { animation: none; } }
  @media (max-width: 720px) {
    .sst { flex-wrap: wrap; bottom: 12px; }
    .sst-bar { order: 10; flex-basis: 100%; }
  }
</style>
