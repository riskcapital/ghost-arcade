<script lang="ts">
  /**
   * The Timeline's sound rows in the grid.
   *
   * Audio blocks (songs, stems, one-shots): drag to move (also onto another
   * row), drag an edge to trim, drag a top corner to fade. Blocks on a row
   * may overlap: the overlap crossfades (drawn as an X). Live rows hold Live
   * clip blocks in the clip's colour and name ("missing clip" when the set
   * no longer has it). Build blocks rise into their drop. Everything snaps
   * to the grid; Esc during a drag puts it back.
   *
   * Right-click a row for a library sound, a build or a Live clip there.
   * Drop audio files on a row to add them to it.
   */
  import { get } from 'svelte/store';
  import { showTimeline } from '../../../../stores/showTimeline';
  import { abletonBridge } from '../../../../ableton/abletonBridge';
  import { isShowAudioFile } from '../../../../audio/showAudioImport';

  /** What the file picker offers: what the show plays, and what it converts. */
  const SHOW_AUDIO_ACCEPT = 'audio/*,.mp3,.wav,.ogg,.opus,.m4a,.aac,.flac,.webm,.aif,.aiff,.aifc,.wma,.caf,.ac3,.ape,.amr,.mka,.alac';
  import { soundGroups } from '../../../../music/sounds/library';
  import { offGrid, resolveLiveSlot, resolveLiveTrack, type LiveEnv } from '../../../../timeline/sound/liveSchedule';
  import { effectiveFades, type BuildBlock, type LiveClipBlock, type SoundRow } from '../../../../timeline/sound/soundModel';
  import {
    addBuildBlock,
    addFilesToRow,
    addLibrarySound,
    addLiveBlock,
    moveAudioBlock,
    moveBuildBlock,
    moveLiveBlock,
    setAudioFade,
    trimAudioBlock,
    trimBuildBlock,
    trimLiveBlock,
  } from '../../../../timeline/sound/soundCommands';
  import type { ShowAudioTrack } from '../../../../types';
  import { followPointer } from '../dragSession';
  import { lineLayout, soundLineGroup } from '../lineUi';
  import LineLanes from '../LineLanes.svelte';
  import { cachedWavePath, WAVE_VIEW_H } from '../waveform';
  import { formatPrecise } from '../timeFormat';
  import { keepInWindow, portal, trimEdgeWidth } from '../trackLayout';
  import { showSlice } from '../timelineSlices';
  import { liveColor, SOUND_FOOTER_HEIGHT, SOUND_ROW_HEIGHT, soundLayout, soundRowAt } from './soundRowLayout';

  interface Props {
    zoom: number;
    viewStart: number;
    viewEnd: number;
  }
  let { zoom, viewStart, viewEnd }: Props = $props();

  const tracksStore = showSlice('audioTracks');
  const soundStore = showSlice('sound');
  const selection = showSlice('selection');
  const tempoStore = showSlice('tempo');
  const layout = $derived($soundLayout);
  const tracks = $derived($tracksStore);
  const sound = $derived($soundStore);
  const bridge = $derived($abletonBridge);
  let stackEl: HTMLDivElement | undefined = $state();

  const byLane = $derived.by(() => {
    const out = new Map<number, ShowAudioTrack[]>();
    for (const t of tracks) {
      const list = out.get(t.lane);
      if (list) list.push(t);
      else out.set(t.lane, [t]);
    }
    return out;
  });

  const liveEnv = $derived<LiveEnv>({ tempo: $tempoStore, setQuantize: bridge.quantize, numerator: bridge.numerator, denominator: bridge.denominator, protocol: bridge.protocol });

  const inView = (start: number, duration: number) => start * zoom + Math.max(6, duration * zoom) >= viewStart * zoom - 24 && start * zoom <= viewEnd * zoom + 24;

  // ── Pointer maths ────────────────────────────────────────────────────────
  function timeAt(e: MouseEvent): number {
    if (!stackEl) return 0;
    return Math.max(0, (e.clientX - stackEl.getBoundingClientRect().left) / zoom);
  }
  function rowAt(e: MouseEvent): number {
    if (!stackEl) return 0;
    return soundRowAt(layout, e.clientY - stackEl.getBoundingClientRect().top);
  }

  type Kind = 'audio' | 'liveClip' | 'build';
  let dragging = false;

  function startMove(e: MouseEvent, kind: Kind, id: string, startTime: number) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    showTimeline.select({ kind, id });
    const grab = timeAt(e) - startTime;
    const before = showTimeline.exportArrangement();
    let moved = false;
    followPointer({
      move: (ev) => {
        moved = true;
        dragging = true;
        const t = timeAt(ev) - grab;
        const lane = rowAt(ev);
        if (kind === 'audio') moveAudioBlock(id, t, lane >= 0 && layout.rows[lane]?.kind === 'audio' ? lane : undefined);
        else if (kind === 'liveClip') moveLiveBlock(id, t, lane >= 0 ? lane : undefined);
        else moveBuildBlock(id, t);
      },
      end: () => { dragging = false; },
      cancel: () => { dragging = false; if (moved) showTimeline.restoreArrangement(before); },
    });
  }

  function startTrim(e: MouseEvent, kind: Kind, id: string, edge: 'start' | 'end') {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    showTimeline.select({ kind, id });
    const before = showTimeline.exportArrangement();
    let moved = false;
    followPointer({
      move: (ev) => {
        moved = true;
        const t = timeAt(ev);
        if (kind === 'audio') trimAudioBlock(id, edge, t);
        else if (kind === 'liveClip') trimLiveBlock(id, edge, t);
        else trimBuildBlock(id, edge, t);
      },
      end: () => {},
      cancel: () => { if (moved) showTimeline.restoreArrangement(before); },
    });
  }

  function startFade(e: MouseEvent, track: ShowAudioTrack, edge: 'in' | 'out') {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    showTimeline.select({ kind: 'audio', id: track.id });
    const before = showTimeline.exportArrangement();
    let moved = false;
    followPointer({
      move: (ev) => {
        moved = true;
        const t = timeAt(ev);
        const s = edge === 'in' ? t - track.startTime : track.startTime + track.duration - t;
        setAudioFade(track.id, edge, Math.max(0, s));
      },
      end: () => {},
      cancel: () => { if (moved) showTimeline.restoreArrangement(before); },
    });
  }

  // ── Drawing helpers ──────────────────────────────────────────────────────
  /** The fade envelope over a block (its width in px, 0..100 high): the line and the shade above it. */
  function envelope(track: ShowAudioTrack, width: number): { line: string; shade: string } | null {
    const f = effectiveFades(track, byLane.get(track.lane) ?? []);
    if (!(f.fadeIn > 0) && !(f.fadeOut > 0)) return null;
    const fi = Math.min(width, f.fadeIn * zoom);
    const fo = Math.min(width, f.fadeOut * zoom);
    const pts: string[] = [];
    const steps = 12;
    for (let i = 0; i <= steps; i++) {
      const x = (fi * i) / steps;
      pts.push(`${x.toFixed(1)},${(100 - Math.sin((i / steps) * (Math.PI / 2)) * 100).toFixed(1)}`);
    }
    for (let i = steps; i >= 0; i--) {
      const x = width - (fo * i) / steps;
      pts.push(`${x.toFixed(1)},${(100 - Math.sin((i / steps) * (Math.PI / 2)) * 100).toFixed(1)}`);
    }
    const line = `M${pts.join(' L')}`;
    return { line, shade: `M0,0 L${pts.join(' L')} L${width},0 Z` };
  }

  /** Overlaps on a row (crossfades), for the X. */
  function overlaps(list: ShowAudioTrack[]): Array<{ start: number; end: number }> {
    const out: Array<{ start: number; end: number }> = [];
    const sorted = [...list].sort((a, b) => a.startTime - b.startTime);
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i];
        const b = sorted[j];
        const end = Math.min(a.startTime + a.duration, b.startTime + b.duration);
        if (b.startTime < end) out.push({ start: b.startTime, end });
      }
    }
    return out;
  }

  function liveInfo(row: SoundRow, b: LiveClipBlock): { name: string; color: string; missing: boolean; playing: boolean; offGrid: boolean } {
    const ti = bridge.connected ? resolveLiveTrack(row.live, bridge.tracks) : null;
    const track = ti === null ? undefined : bridge.tracks[ti];
    const slot = track ? resolveLiveSlot(b, track) : null;
    const clip = track && slot !== null ? track.slots[slot] : null;
    const missing = bridge.connected && (!track || slot === null);
    return {
      name: clip?.name || b.clipName || `Slot ${b.slot + 1}`,
      color: liveColor(clip?.color ?? b.color),
      missing,
      playing: !!track && slot !== null && track.playing === slot,
      offGrid: offGrid(b.startTime, row.live?.launch ?? 'beat', liveEnv),
    };
  }

  function buildLabel(b: BuildBlock): string {
    const style = { edm: 'EDM', dub: 'Dub', techno: 'Techno', trap: 'Trap' }[b.style];
    return `Build → drop · ${style}`;
  }

  // ── Context menu and drops ───────────────────────────────────────────────
  let menu: { x: number; y: number; row: SoundRow; at: number; sub: 'sounds' | 'clips' | null } | null = $state(null);
  const groups = soundGroups((s) => s.kind !== 'loop');

  function openMenu(e: MouseEvent, row: SoundRow) {
    e.preventDefault();
    e.stopPropagation();
    menu = { x: e.clientX, y: e.clientY, row, at: timeAt(e), sub: null };
  }

  function liveClipsOf(row: SoundRow) {
    const ti = resolveLiveTrack(row.live, bridge.tracks);
    if (ti === null) return [];
    return bridge.tracks[ti].slots.flatMap((c, slot) => (c ? [{ slot, name: c.name, color: c.color, length: c.length }] : []));
  }

  $effect(() => {
    if (!menu) return;
    const close = (ev: MouseEvent) => {
      if ((ev.target as HTMLElement)?.closest?.('[data-sound-menu]')) return;
      menu = null;
    };
    const t = setTimeout(() => window.addEventListener('mousedown', close), 0);
    return () => { clearTimeout(t); window.removeEventListener('mousedown', close); };
  });

  function onDragOver(e: DragEvent, row: SoundRow) {
    if (row.kind !== 'audio' || !e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  }

  // ─── Audio from this computer ───────────────────────────────────────
  // The same as dropping files on the row, through a file picker.
  let fileInput: HTMLInputElement | undefined = $state();
  let pickTarget: { rowId: string; at: number } | null = null;

  function pickAudioFiles(rowId: string, at: number) {
    pickTarget = { rowId, at };
    fileInput?.click();
  }

  function onAudioFilesPicked(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []).filter((f) => isShowAudioFile(f.name, f.type));
    input.value = '';
    const target = pickTarget;
    pickTarget = null;
    if (target && files.length) void addFilesToRow(files, target.rowId, target.at);
  }

  function onDrop(e: DragEvent, row: SoundRow) {
    const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => isShowAudioFile(f.name, f.type));
    if (row.kind !== 'audio' || !files.length) return;
    e.preventDefault();
    e.stopPropagation();
    void addFilesToRow(files, row.id, timeAt(e));
  }

  const selected = (kind: string, id: string) => $selection?.kind === kind && $selection.id === id;
</script>

<input class="hidden-file" type="file" accept={SHOW_AUDIO_ACCEPT} multiple bind:this={fileInput} onchange={onAudioFilesPicked} />
<div class="sound-stack" bind:this={stackEl} style="height: {layout.total}px" data-sound-stack>
  {#each layout.rows as row, lane (row.id)}
    {@const lines = $lineLayout.lines.get(soundLineGroup(row.id)) ?? []}
    {@const rowTracks = byLane.get(lane) ?? []}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="sound-lane"
      class:live={row.kind === 'live'}
      class:muted={row.muted}
      style="height: {SOUND_ROW_HEIGHT}px"
      oncontextmenu={(e) => openMenu(e, row)}
      ondragover={(e) => onDragOver(e, row)}
      ondrop={(e) => onDrop(e, row)}
      data-sound-lane={row.id}
    >
      {#if row.kind === 'audio'}
        {#if !rowTracks.length && !sound.builds.some((b) => b.lane === lane)}
          {#if lane === 0 && !$tracksStore.length}
            <span class="lane-hint song-hint" data-auto-show-song-hint>Drop a song here or
              <button type="button" class="hint-pick" onmousedown={(e) => e.stopPropagation()}
                onclick={(e) => { e.stopPropagation(); pickAudioFiles(row.id, 0); }} data-sound-pick-song>choose one</button>,
              then ✦ Auto show</span>
          {:else}
            <span class="lane-hint">Drop audio here or
              <button type="button" class="hint-pick" onmousedown={(e) => e.stopPropagation()}
                onclick={(e) => { e.stopPropagation(); pickAudioFiles(row.id, 0); }} data-sound-pick>choose a file</button>,
              or right-click for a sound from the library or a build</span>
          {/if}
        {/if}
        {#each rowTracks as track (track.id)}
          {#if inView(track.startTime, track.duration)}
            {@const w = Math.max(6, track.duration * zoom)}
            {@const env = envelope(track, w)}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="show-block sound-block"
              class:selected={selected('audio', track.id)}
              class:missing={!track.url}
              class:muted={track.muted}
              class:oneshot={!!track.sound}
              style="left: {track.startTime * zoom}px; width: {w}px; --edge-w: {trimEdgeWidth(w)}px"
              onmousedown={(e) => startMove(e, 'audio', track.id, track.startTime)}
              title={`${track.name} · ${formatPrecise(track.duration)}${track.url ? '' : ' (media missing)'}`}
              data-sound-block={track.id}
            >
              <svg class="wave" viewBox="0 0 1000 {WAVE_VIEW_H}" preserveAspectRatio="none" aria-hidden="true">
                <path d={cachedWavePath(track.peaks, track.offset, track.duration, track.sourceDuration)} />
              </svg>
              {#if env}
                <svg class="fade" viewBox="0 0 {w} 100" preserveAspectRatio="none" aria-hidden="true">
                  <path class="fade-shade" d={env.shade} />
                  <path class="fade-line" d={env.line} />
                </svg>
              {/if}
              <span class="block-label">{track.sound ? '✦ ' : ''}{track.muted ? '🔇 ' : ''}{track.name}</span>
              <div class="handle left" onmousedown={(e) => startTrim(e, 'audio', track.id, 'start')}></div>
              <div class="handle right" onmousedown={(e) => startTrim(e, 'audio', track.id, 'end')}></div>
              <div class="fade-handle in" style="left: {Math.min(w - 8, (track.fadeIn ?? 0) * zoom)}px" onmousedown={(e) => startFade(e, track, 'in')} title="Drag to fade in" data-sound-fade-in></div>
              <div class="fade-handle out" style="right: {Math.min(w - 8, (track.fadeOut ?? 0) * zoom)}px" onmousedown={(e) => startFade(e, track, 'out')} title="Drag to fade out" data-sound-fade-out></div>
            </div>
          {/if}
        {/each}
        {#each overlaps(rowTracks) as o}
          <svg class="xfade" style="left: {o.start * zoom}px; width: {Math.max(2, (o.end - o.start) * zoom)}px" viewBox="0 0 10 10" preserveAspectRatio="none" aria-hidden="true">
            <path d="M0,0 L10,10 M0,10 L10,0" />
          </svg>
        {/each}
      {:else}
        {#if !sound.live.some((b) => b.lane === lane)}
          <span class="lane-hint">Right-click to place a clip from the Live track; open the row to pick its track</span>
        {/if}
        {#each sound.live.filter((b) => b.lane === lane) as b (b.id)}
          {#if inView(b.startTime, b.duration)}
            {@const info = liveInfo(row, b)}
            {@const w = Math.max(6, b.duration * zoom)}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="show-block live-block"
              class:selected={selected('liveClip', b.id)}
              class:missing={info.missing}
              class:playing={info.playing}
              style="left: {b.startTime * zoom}px; width: {w}px; --clip: {info.color}; --edge-w: {trimEdgeWidth(w)}px"
              onmousedown={(e) => startMove(e, 'liveClip', b.id, b.startTime)}
              title={info.missing ? `Missing clip: ${b.clipName || `slot ${b.slot + 1}`} is not on this Live track` : `${info.name}${info.offGrid ? ' · not on the launch grid: Live starts it on the next step' : ''}`}
              data-live-block={b.id}
            >
              <span class="block-label">{info.missing ? `missing clip · ${b.clipName || `slot ${b.slot + 1}`}` : `▶ ${info.name}`}{info.offGrid && !info.missing ? ' ↦' : ''}</span>
              <div class="handle left" onmousedown={(e) => startTrim(e, 'liveClip', b.id, 'start')}></div>
              <div class="handle right" onmousedown={(e) => startTrim(e, 'liveClip', b.id, 'end')}></div>
            </div>
          {/if}
        {/each}
      {/if}
      {#each sound.builds.filter((b) => b.lane === lane) as b (b.id)}
        {#if inView(b.startTime, b.duration)}
          {@const w = Math.max(6, b.duration * zoom)}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="show-block build-block"
            class:selected={selected('build', b.id)}
            style="left: {b.startTime * zoom}px; width: {w}px; --edge-w: {trimEdgeWidth(w)}px"
            onmousedown={(e) => startMove(e, 'build', b.id, b.startTime)}
            title="Build: the row filters, opens its echo and reverb, rolls and rises into the drop at the block's end"
            data-build-block={b.id}
          >
            <svg class="rise" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="M0,100 L100,8 L100,100 Z" /></svg>
            <span class="block-label">{buildLabel(b)}</span>
            <div class="handle left" onmousedown={(e) => startTrim(e, 'build', b.id, 'start')}></div>
            <div class="handle right" onmousedown={(e) => startTrim(e, 'build', b.id, 'end')}></div>
          </div>
        {/if}
      {/each}
    </div>
    {#if lines.length}
      <LineLanes groupId={soundLineGroup(row.id)} {lines} expanded={$lineLayout.expanded.has(soundLineGroup(row.id))} {zoom} {viewStart} {viewEnd} />
    {/if}
  {/each}
  <div class="sound-foot-strip" style="height: {SOUND_FOOTER_HEIGHT}px"></div>
</div>

{#if menu}
  <div class="sound-menu" use:portal use:keepInWindow={menu} style="left: {menu.x}px; top: {menu.y}px" data-sound-menu data-help-disabled>
    {#if menu.sub === 'sounds'}
      <div class="sm-title">Sound at {formatPrecise(menu.at)}</div>
      <div class="sm-scroll">
        {#each groups as g}
          <div class="sm-group">{g.label}</div>
          {#each g.sounds as s}
            <button class="sm-item" title={s.blurb} onclick={() => { const m = menu!; menu = null; void addLibrarySound(m.row.id, s.id, m.at); }} data-sound-lib={s.id}>{s.name}</button>
          {/each}
        {/each}
      </div>
    {:else if menu.sub === 'clips'}
      {@const clips = liveClipsOf(menu.row)}
      <div class="sm-title">Live clip at {formatPrecise(menu.at)}</div>
      {#if !clips.length}
        <div class="sm-note">{bridge.connected ? 'The row has no Live track with clips. Open the row to pick its track.' : 'Live is not connected (Ableton panel).'}</div>
      {/if}
      <div class="sm-scroll">
        {#each clips as c}
          <button class="sm-item" onclick={() => { const m = menu!; menu = null; addLiveBlock(m.row.id, c, m.at); }} data-live-clip-pick={c.slot}>
            <span class="sm-swatch" style="background: {liveColor(c.color)}"></span>{c.name || `Slot ${c.slot + 1}`}
          </button>
        {/each}
      </div>
    {:else}
      {#if menu.row.kind === 'audio'}
        <button class="sm-item" onclick={() => { const m = menu!; menu = null; pickAudioFiles(m.row.id, m.at); }} data-sound-menu-file>Audio file from this computer…</button>
        <button class="sm-item" onclick={() => (menu = menu && { ...menu, sub: 'sounds' })} data-sound-menu-sounds>Sound from the library ▸</button>
      {:else}
        <button class="sm-item" onclick={() => (menu = menu && { ...menu, sub: 'clips' })} data-sound-menu-clips>Live clip ▸</button>
      {/if}
      {#if menu.row.kind === 'audio'}
        <button class="sm-item" onclick={() => { const m = menu!; menu = null; addBuildBlock(m.row.id, m.at); }} data-sound-menu-build>Build → drop here</button>
      {/if}
      <button class="sm-item" onclick={() => { const m = menu!; menu = null; showTimeline.select({ kind: 'soundRow', id: m.row.id }); }}>Row settings…</button>
    {/if}
  </div>
{/if}

<style>
  .sound-stack { position: relative; }
  .sound-lane {
    position: relative;
    border-bottom: 1px solid var(--ga-line, rgba(255, 255, 255, 0.07));
    box-sizing: border-box;
    background: rgba(92, 225, 230, 0.012);
  }
  .sound-lane.live { background: rgba(255, 160, 60, 0.02); }
  .sound-lane.muted { opacity: 0.55; }
  .lane-hint.song-hint { color: #ffd36b; opacity: 0.85; font-weight: 600; }
  .hidden-file { display: none; }
  /* The hint is click-through; its file link is not. */
  .hint-pick {
    pointer-events: auto;
    padding: 0;
    background: none;
    border: none;
    color: inherit;
    font: inherit;
    text-decoration: underline;
    text-underline-offset: 2px;
    cursor: pointer;
  }
  .hint-pick:hover { color: var(--ga-ink-0, #fff); }
  .lane-hint {
    position: absolute;
    left: 12px;
    top: 50%;
    transform: translateY(-50%);
    font-size: var(--ga-text-meta, 11px);
    color: var(--ga-ink-2, #55555f);
    pointer-events: none;
    white-space: nowrap;
  }
  .show-block {
    position: absolute;
    top: 4px;
    bottom: 4px;
    border-radius: 4px;
    overflow: hidden;
    cursor: grab;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    user-select: none;
  }
  .show-block:active { cursor: grabbing; }
  .show-block.selected { box-shadow: 0 0 0 1px #FFD96B, 0 0 10px rgba(255, 217, 107, 0.3); z-index: 3; }
  .sound-block {
    background: linear-gradient(180deg, rgba(92, 225, 230, 0.16), rgba(92, 225, 230, 0.07));
    border: 1px solid rgba(92, 225, 230, 0.45);
  }
  .sound-block.oneshot {
    background: linear-gradient(180deg, rgba(167, 139, 250, 0.22), rgba(167, 139, 250, 0.08));
    border-color: rgba(167, 139, 250, 0.55);
  }
  .sound-block.muted { opacity: 0.45; }
  .sound-block.missing, .live-block.missing {
    background: repeating-linear-gradient(135deg, rgba(255, 71, 87, 0.16) 0 6px, rgba(255, 71, 87, 0.06) 6px 12px);
    border: 1px solid rgba(255, 71, 87, 0.6);
  }
  .live-block {
    background: color-mix(in srgb, var(--clip) 38%, transparent);
    border: 1px solid color-mix(in srgb, var(--clip) 85%, white 0%);
  }
  .live-block.playing { box-shadow: inset 0 0 0 1px #fff, 0 0 8px color-mix(in srgb, var(--clip) 70%, transparent); }
  /* A band along the bottom of the row: the row's own sound stays visible above it. */
  .show-block.build-block {
    top: auto;
    height: 18px;
    bottom: 3px;
    background: rgba(255, 209, 102, 0.1);
    border: 1px solid rgba(255, 209, 102, 0.55);
    z-index: 2;
  }
  .build-block .block-label { font-size: 10px; }
  .rise { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
  .rise path { fill: rgba(255, 209, 102, 0.22); }
  .wave { position: absolute; inset: 4px 0; width: 100%; height: calc(100% - 8px); pointer-events: none; }
  .wave path { fill: rgba(92, 225, 230, 0.55); }
  .oneshot .wave path { fill: rgba(196, 176, 255, 0.6); }
  .fade { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
  .fade-shade { fill: rgba(0, 0, 0, 0.38); }
  .fade-line { fill: none; stroke: rgba(255, 255, 255, 0.7); stroke-width: 1; vector-effect: non-scaling-stroke; }
  .xfade { position: absolute; top: 4px; bottom: 4px; height: calc(100% - 8px); pointer-events: none; z-index: 2; }
  .xfade path { stroke: rgba(255, 255, 255, 0.55); stroke-width: 1; vector-effect: non-scaling-stroke; fill: none; }
  .block-label {
    position: relative;
    z-index: 1;
    font-size: 11px;
    font-weight: 600;
    color: #e8e8ee;
    padding: 0 8px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.85);
    pointer-events: none;
  }
  .handle { position: absolute; top: 10px; bottom: 0; width: var(--edge-w, 7px); z-index: 2; cursor: ew-resize; }
  .handle.left { left: 0; }
  .handle.right { right: 0; }
  .handle:hover { background: rgba(255, 255, 255, 0.25); }
  .fade-handle {
    position: absolute;
    top: 0;
    width: 8px;
    height: 8px;
    z-index: 4;
    cursor: ew-resize;
    background: rgba(255, 255, 255, 0.85);
    opacity: 0;
    transition: opacity 0.1s;
  }
  .fade-handle.in { border-radius: 0 0 4px 0; }
  .fade-handle.out { border-radius: 0 0 0 4px; }
  .sound-block:hover .fade-handle, .sound-block.selected .fade-handle { opacity: 1; }
  .sound-foot-strip { border-bottom: 1px solid var(--ga-line, rgba(255, 255, 255, 0.07)); box-sizing: border-box; }
  .sound-menu {
    position: fixed;
    z-index: 10000;
    min-width: 180px;
    max-width: 260px;
    background: var(--ga-surface-2, #1c1c22);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.14));
    border-radius: 6px;
    padding: 4px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    font-size: 12px;
    transform: translateY(-100%);
  }
  .sm-scroll { max-height: 280px; overflow-y: auto; }
  .sm-title { font-size: 10px; color: var(--ga-ink-2, #7d7d88); padding: 2px 6px 4px; text-transform: uppercase; letter-spacing: 0.04em; }
  .sm-group { font-size: 10px; color: var(--ga-ink-2, #7d7d88); padding: 6px 6px 2px; }
  .sm-note { padding: 4px 6px; color: var(--ga-ink-1, #b8b8c2); }
  .sm-item {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    text-align: left;
    background: none;
    border: 0;
    border-radius: 4px;
    color: var(--ga-ink-0, #e8e8ee);
    font: inherit;
    padding: 4px 6px;
    cursor: pointer;
  }
  .sm-item:hover { background: rgba(255, 255, 255, 0.08); }
  .sm-swatch { width: 10px; height: 10px; border-radius: 2px; flex: 0 0 auto; }
</style>
