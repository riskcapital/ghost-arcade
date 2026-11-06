<script lang="ts">
  /**
   * The Preview monitor's button in the VJ toolbar: choose a display and a
   * layout, open or close it. While it is open this also sends it the status
   * line (tempo, beat, block, mode, crossfader, recording). The pictures
   * themselves go from the render core to that display directly.
   */
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { invoke, isDesktopApp } from '../bridge';
  import { audioStore } from '../stores/audio';
  import { vjClipLauncher, vjCrossfader } from '../stores/vjClipLauncher';
  import type { PreviewMonitorLayout } from '../output/previewMonitorLayout';

  let { recording = false }: { recording?: boolean } = $props();

  interface Display { id: number; label: string; name?: string; width: number; height: number; isPrimary: boolean; scaleFactor: number }
  interface MonitorState { supported: boolean; reason: string | null; open: boolean; waiting: boolean; displayId: number | null; layout: PreviewMonitorLayout }

  const STORAGE_KEY = 'ga.previewMonitor';
  let monitor = $state<MonitorState>({ supported: true, reason: null, open: false, waiting: false, displayId: null, layout: 'multiview' });
  let menuOpen = $state(false);
  let displays = $state<Display[]>([]);
  let chosen = $state<number | null>(null);
  let layout = $state<PreviewMonitorLayout>('multiview');
  let error = $state('');
  let busy = $state(false);
  let root = $state<HTMLElement | null>(null);

  function remembered(): { displayLabel?: string; layout?: PreviewMonitorLayout } {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
  }
  function remember(display: Display | undefined) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ displayLabel: display?.label, layout })); } catch { /* private window */ }
  }

  async function refreshDisplays() {
    try { displays = (await invoke('get_displays')) as Display[]; } catch { displays = []; }
    const r = remembered();
    if (chosen === null || !displays.some((d) => d.id === chosen)) {
      // The display it went on last time, else the first one that is not this screen.
      chosen = (r.displayLabel ? displays.find((d) => d.label === r.displayLabel)?.id : undefined)
        ?? displays.find((d) => !d.isPrimary)?.id
        ?? displays[0]?.id
        ?? null;
    }
  }

  async function toggleMenu() {
    menuOpen = !menuOpen;
    error = '';
    if (menuOpen) await refreshDisplays();
  }

  async function open() {
    if (chosen === null) return;
    busy = true;
    error = '';
    try {
      const result = await invoke('preview_monitor_open', { displayId: chosen, layout });
      if (!result?.ok) error = result?.error || 'The Preview monitor could not open.';
      else {
        remember(displays.find((d) => d.id === chosen));
        menuOpen = false;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  async function close() {
    await invoke('preview_monitor_close').catch(() => {});
  }

  async function setLayout(next: PreviewMonitorLayout) {
    layout = next;
    remember(displays.find((d) => d.id === chosen));
    if (monitor.open) await invoke('preview_monitor_set_layout', { layout: next }).catch(() => {});
  }

  function displayName(d: Display): string {
    return `${d.name || d.label || `Display ${d.id}`} · ${Math.round(d.width * d.scaleFactor)}×${Math.round(d.height * d.scaleFactor)}${d.isPrimary ? ' · this screen' : ''}`;
  }

  // The status line, sent only when something on it changed. Read on a timer
  // rather than subscribed: the audio store moves every frame.
  let beatCount = 0;
  let lastPhase = 0;
  let lastSent = '';
  function statusNow() {
    const audio = get(audioStore);
    const vj = get(vjClipLauncher);
    const phase = Number(audio.beatPhase) || 0;
    if (phase < lastPhase - 0.5) beatCount++;
    lastPhase = phase;
    return {
      bpm: Math.round((Number(audio.bpm) || 0) * 10) / 10,
      beat: beatCount % 4,
      block: vj.blocks.find((b) => b.id === vj.activeBlockId)?.name ?? '',
      mode: vj.isOpen ? (vj.stageMode ? 'Stage' : vj.mapMode ? 'Map' : 'Mix') : 'Mapping',
      crossfader: Math.round(get(vjCrossfader) * 100) / 100,
      decks: vj.isOpen && !!vj.crossfaderEnabled,
      recording,
      live: vj.isOpen ? vj.isLive : true,
    };
  }

  $effect(() => {
    if (!monitor.open) return;
    lastSent = '';
    const timer = setInterval(() => {
      const status = statusNow();
      const sig = JSON.stringify(status);
      if (sig === lastSent) return;
      lastSent = sig;
      void invoke('preview_monitor_status', status).catch(() => {});
    }, 50);
    return () => {
      clearInterval(timer);
      // Leaving VJ mode: the monitor goes on showing the program, without VJ details.
      void invoke('preview_monitor_status', { bpm: statusNow().bpm, mode: 'Mapping', decks: false, live: true }).catch(() => {});
    };
  });

  onMount(() => {
    if (!isDesktopApp) return;
    const apply = (s: Partial<MonitorState> | null) => {
      if (!s) return;
      monitor = { ...monitor, ...s } as MonitorState;
      if (s.layout) layout = s.layout;
    };
    void invoke('preview_monitor_get_state').then(apply).catch(() => {});
    layout = remembered().layout === 'program' ? 'program' : 'multiview';
    const off = window.electronAPI?.on?.('preview-monitor-state', apply);
    const outside = (e: PointerEvent) => { if (menuOpen && root && !root.contains(e.target as Node)) menuOpen = false; };
    window.addEventListener('pointerdown', outside, true);
    return () => {
      off?.();
      window.removeEventListener('pointerdown', outside, true);
    };
  });
</script>

{#if isDesktopApp}
  <div class="pm" bind:this={root}>
    <button
      class="minimize-btn pm-btn"
      class:on={monitor.open}
      class:waiting={monitor.waiting}
      aria-pressed={monitor.open}
      aria-haspopup="dialog"
      aria-expanded={menuOpen}
      onclick={toggleMenu}
      title={monitor.open ? 'Preview monitor is open' : monitor.waiting ? 'Preview monitor: waiting for its display' : 'Preview monitor: the program and decks on a display of your own'}
    >
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="2" y="4" width="20" height="13" rx="1.5" /><path d="M8 21h8M12 17v4M11 8h7v5h-7zM5 8h3M5 12h3" />
      </svg>
      <span>Preview</span>
    </button>
    {#if menuOpen}
      <div class="menu" role="dialog" aria-label="Preview monitor">
        <p class="title">Preview monitor</p>
        <p class="hint">The program, and the decks with the crossfader on, on a display of your own. The Live Output keeps going to the projector.</p>
        {#if !monitor.supported}
          <p class="error">{monitor.reason}</p>
        {:else}
          <span class="label">Display</span>
          <div class="list" role="radiogroup" aria-label="Display">
            {#each displays as d (d.id)}
              <label class="row" class:current={monitor.open && monitor.displayId === d.id}>
                <input type="radio" name="pm-display" value={d.id} checked={chosen === d.id} onchange={() => (chosen = d.id)} />
                <span>{displayName(d)}</span>
              </label>
            {/each}
            {#if displays.length < 2}<p class="hint">Only one display is connected. Connect the monitor, then choose it here.</p>{/if}
          </div>
          <span class="label">Layout</span>
          <div class="seg" role="radiogroup" aria-label="Layout">
            <button class:on={layout === 'multiview'} aria-pressed={layout === 'multiview'} onclick={() => setLayout('multiview')} title="The program large, Deck A and Deck B beside it">Multiview</button>
            <button class:on={layout === 'program'} aria-pressed={layout === 'program'} onclick={() => setLayout('program')} title="Only the program, as large as it goes">Program only</button>
          </div>
          {#if error}<p class="error" role="alert">{error}</p>{/if}
          {#if monitor.waiting && !monitor.open}<p class="hint">Its display is unplugged. It opens again when the display is back.</p>{/if}
          <div class="actions">
            {#if monitor.open || monitor.waiting}<button class="secondary" onclick={close}>Close</button>{/if}
            <button class="primary" disabled={busy || chosen === null || (monitor.open && monitor.displayId === chosen)} onclick={open}>
              {monitor.open ? 'Move here' : 'Open'}
            </button>
          </div>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .pm { position: relative; display: inline-flex; }
  .pm-btn { display: inline-flex; align-items: center; gap: 5px; }
  .pm-btn.on { color: var(--ga-selection-ink, #e0e8ff); background: var(--ga-selection-bg, #1f3170); border-color: var(--ga-selection-line, #5278ff); }
  .pm-btn.waiting { color: var(--ga-amber, #e0a63a); }
  .menu {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 50;
    width: 320px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    background: var(--ga-panel, #12141a);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-soft, 8px);
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
    color: var(--ga-ink-0, #eef0f4);
    font-size: var(--ga-text-control, 12px);
  }
  .title { margin: 0; font-weight: 650; font-size: var(--ga-text-title, 13px); }
  .hint { margin: 0; color: var(--ga-ink-2, #8a93a8); font-size: var(--ga-text-meta, 11px); line-height: 1.4; }
  .label { font-size: var(--ga-text-eyebrow, 10px); font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ga-ink-2, #8a93a8); }
  .list { display: flex; flex-direction: column; gap: 4px; }
  .row { display: flex; align-items: center; gap: 8px; padding: 4px 6px; border-radius: var(--ga-r-hard, 4px); cursor: pointer; }
  .row:hover { background: rgba(255, 255, 255, 0.04); }
  .row.current { color: var(--ga-selection-ink, #e0e8ff); }
  .seg { display: flex; gap: 4px; }
  .seg button, .actions button {
    flex: 1;
    height: var(--ga-control-h-sm, 26px);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    background: transparent;
    color: inherit;
    border-radius: var(--ga-r-hard, 4px);
    font: inherit;
    cursor: pointer;
  }
  .seg button.on { color: var(--ga-selection-ink, #e0e8ff); background: var(--ga-selection-bg, #1f3170); border-color: var(--ga-selection-line, #5278ff); }
  .actions { display: flex; gap: 6px; }
  .actions .primary { background: var(--ga-selection-bg, #1f3170); border-color: var(--ga-selection-line, #5278ff); }
  .actions button:disabled { opacity: 0.5; cursor: default; }
  .error { margin: 0; color: var(--ga-rec, #ff3b30); font-size: var(--ga-text-meta, 11px); line-height: 1.4; }
</style>
