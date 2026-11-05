<script lang="ts">
  /**
   * The Preview monitor: the operator's own display beside the projector.
   * The pictures (the program, and with the crossfader on, Deck A and Deck
   * B) are drawn by native presenter views under this page, straight from
   * the render core. This page lays them out, tells the main process where
   * each one goes, cuts holes for them, and draws what sits around them:
   * names with tally lights, and a status line with the tempo, the beat,
   * the block, the crossfader, recording and the time.
   */
  import { onMount } from 'svelte';
  import { previewMonitorGeometry, maskPath, type PreviewMonitorLayout, type PreviewTile, type Rect } from './lib/output/previewMonitorLayout';

  interface MonitorState { layout: PreviewMonitorLayout; decks: boolean; aspect: number }
  interface MonitorStatus {
    bpm?: number;
    beat?: number;
    block?: string;
    mode?: string;
    crossfader?: number;
    decks?: boolean;
    recording?: boolean;
    live?: boolean;
  }

  const api = (window as any).electronAPI as {
    invoke: (command: string, args?: unknown) => Promise<any>;
    on: (channel: string, callback: (...args: any[]) => void) => () => void;
  } | undefined;

  let width = $state(window.innerWidth);
  let height = $state(window.innerHeight);
  let monitor = $state<MonitorState>({ layout: 'multiview', decks: false, aspect: 16 / 9 });
  let status = $state<MonitorStatus>({});
  let clock = $state('');

  const geometry = $derived(previewMonitorGeometry(width, height, monitor.aspect, monitor.layout, monitor.decks));
  const holes = $derived(Object.values(geometry.tiles) as Rect[]);
  const fader = $derived(Math.max(0, Math.min(1, status.crossfader ?? 0)));
  /** How much of each deck is going out, for its tally. */
  const onAir = $derived<Record<'deck-a' | 'deck-b', number>>({ 'deck-a': 1 - fader, 'deck-b': fader });
  const names: Record<PreviewTile, string> = { program: 'Program', 'deck-a': 'Deck A', 'deck-b': 'Deck B' };

  // Tell the main process where the pictures are whenever they move.
  let sentSig = '';
  $effect(() => {
    const tiles = geometry.tiles;
    const sig = JSON.stringify(tiles) + window.devicePixelRatio;
    if (sig === sentSig) return;
    sentSig = sig;
    void api?.invoke('preview_monitor_tiles', { tiles, pixelRatio: window.devicePixelRatio }).catch(() => {});
  });

  onMount(() => {
    // The arcade theme paints the body with !important; the pictures sit under the page.
    document.documentElement.style.setProperty('background', 'transparent', 'important');
    document.body.style.setProperty('background', 'transparent', 'important');
    document.getElementById('splash')?.remove();

    const resize = () => { width = window.innerWidth; height = window.innerHeight; sentSig = ''; };
    window.addEventListener('resize', resize);
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') void api?.invoke('preview_monitor_close'); };
    window.addEventListener('keydown', key);
    const offState = api?.on('preview-monitor-state', (next: Partial<MonitorState>) => {
      monitor = {
        layout: next.layout === 'program' ? 'program' : 'multiview',
        decks: !!next.decks,
        aspect: Number(next.aspect) > 0 ? Number(next.aspect) : monitor.aspect,
      };
    });
    const offStatus = api?.on('preview-monitor-status', (next: MonitorStatus) => { status = next ?? {}; });
    void api?.invoke('preview_monitor_get_state').then((s: Partial<MonitorState>) => {
      if (s?.layout) monitor = { ...monitor, layout: s.layout === 'program' ? 'program' : 'multiview' };
    }).catch(() => {});
    const tickClock = () => { clock = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); };
    tickClock();
    const timer = setInterval(tickClock, 1000);
    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', key);
      offState?.();
      offStatus?.();
      clearInterval(timer);
    };
  });

  const px = (r: Rect) => `left: ${r.x}px; top: ${r.y}px; width: ${r.width}px; height: ${r.height}px`;
</script>

<div class="monitor">
  <svg class="mask" width={width} height={height} viewBox="0 0 {width} {height}" aria-hidden="true">
    <path d={maskPath(width, height, holes)} fill-rule="evenodd" />
  </svg>

  {#each Object.entries(geometry.labels) as [tile, rect] (tile)}
    {@const t = tile as PreviewTile}
    {@const tally = t === 'program' ? (status.live === false ? 0 : 1) : monitor.decks ? onAir[t] : 0}
    <div class="plate" class:program={t === 'program'} style={px(rect)}>
      <span class="tally" style="opacity: {0.18 + 0.82 * tally}"></span>
      <span class="name">{names[t]}</span>
      {#if t === 'program'}
        <span class="meta">{status.live === false ? 'Not live' : 'On air'}</span>
      {:else}
        <span class="meta">{Math.round(tally * 100)}%</span>
      {/if}
    </div>
  {/each}
  {#each Object.entries(geometry.tiles) as [tile, rect] (tile)}
    <div class="frame" class:program={tile === 'program'} style={px(rect)}></div>
  {/each}

  <div class="status" style={px(geometry.status)}>
    <div class="tempo">
      <span class="bpm">{status.bpm ? status.bpm.toFixed(1) : '—'}</span>
      <span class="unit">BPM</span>
      <span class="beats" aria-label="Beat {((status.beat ?? 0) % 4) + 1}">
        {#each [0, 1, 2, 3] as i (i)}<i class:on={(status.beat ?? -1) % 4 === i} class:down={i === 0}></i>{/each}
      </span>
    </div>
    <div class="where">
      <span class="block">{status.block || 'No block'}</span>
      {#if status.mode}<span class="mode">{status.mode}</span>{/if}
    </div>
    {#if monitor.decks}
      <div class="xfade" aria-label="Crossfader {Math.round(fader * 100)}% to B">
        <span>A</span>
        <span class="track"><span class="knob" style="left: {fader * 100}%"></span></span>
        <span>B</span>
      </div>
    {/if}
    <div class="right">
      {#if status.recording}<span class="rec"><i></i>Rec</span>{/if}
      <span class="clock">{clock}</span>
    </div>
  </div>
</div>

<style>
  .monitor {
    position: fixed;
    inset: 0;
    overflow: hidden;
    color: #e8ecf6;
    font-family: var(--ga-font, system-ui, sans-serif);
    user-select: none;
    cursor: none;
    --pm-bg: #07080b;
    --pm-line: rgba(255, 255, 255, 0.14);
    --pm-muted: #8a93a8;
    --pm-live: #ff3b30;
    --pm-deck: #5278ff;
  }
  .mask { position: absolute; inset: 0; }
  .mask path { fill: var(--pm-bg); }
  .frame { position: absolute; box-shadow: 0 0 0 1px var(--pm-line); pointer-events: none; }
  .frame.program { box-shadow: 0 0 0 2px color-mix(in srgb, var(--pm-live) 70%, transparent); }
  .plate {
    position: absolute;
    display: flex;
    align-items: center;
    gap: 0.6em;
    font-size: clamp(12px, 1.3vh, 22px);
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  .tally { width: 0.75em; height: 0.75em; border-radius: 50%; background: var(--pm-deck); box-shadow: 0 0 0.6em var(--pm-deck); }
  .plate.program .tally { background: var(--pm-live); box-shadow: 0 0 0.6em var(--pm-live); }
  .name { font-weight: 700; }
  .meta { margin-left: auto; color: var(--pm-muted); font-variant-numeric: tabular-nums; }
  .status {
    position: absolute;
    display: flex;
    align-items: center;
    gap: 3vh;
    padding: 0 1.5vh;
    border-top: 1px solid var(--pm-line);
    font-size: clamp(13px, 1.6vh, 26px);
  }
  .tempo { display: flex; align-items: baseline; gap: 0.5em; }
  .bpm { font-family: var(--ga-font-mono, ui-monospace, monospace); font-size: 2em; font-weight: 700; font-variant-numeric: tabular-nums; }
  .unit { color: var(--pm-muted); letter-spacing: 0.12em; }
  .beats { display: inline-flex; gap: 0.4em; margin-left: 0.6em; align-self: center; }
  .beats i { width: 0.8em; height: 0.8em; border-radius: 50%; background: rgba(255, 255, 255, 0.12); }
  .beats i.on { background: #e8ecf6; }
  .beats i.down.on { background: var(--pm-live); }
  .where { display: flex; align-items: baseline; gap: 0.8em; min-width: 0; }
  .block { font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .mode { color: var(--pm-muted); text-transform: uppercase; letter-spacing: 0.12em; font-size: 0.8em; }
  .xfade { display: flex; align-items: center; gap: 0.6em; color: var(--pm-muted); }
  .xfade .track { position: relative; width: 22vh; height: 0.35em; border-radius: 1em; background: rgba(255, 255, 255, 0.14); }
  .xfade .knob { position: absolute; top: 50%; width: 0.5em; height: 1.4em; border-radius: 0.15em; background: #e8ecf6; transform: translate(-50%, -50%); }
  .right { margin-left: auto; display: flex; align-items: center; gap: 1.2em; }
  .rec { display: inline-flex; align-items: center; gap: 0.4em; color: var(--pm-live); font-weight: 700; text-transform: uppercase; letter-spacing: 0.12em; }
  .rec i { width: 0.7em; height: 0.7em; border-radius: 50%; background: var(--pm-live); }
  .clock { font-family: var(--ga-font-mono, ui-monospace, monospace); font-variant-numeric: tabular-nums; color: var(--pm-muted); }
</style>
