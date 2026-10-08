<script lang="ts">
  /**
   * "+ Add": the full-height picker for a new clip. Three sources: Visuals (the shader library),
   * Photos and videos (import, plus what is already on this device) and Camera.
   * Tap a visual or a file to preview it at the top; tap Add (or the same tile again) to put it
   * on the deck. The preview has its own small renderer and never changes the output.
   */
  import { onDestroy, onMount, tick } from 'svelte';
  import Icon from './StudioIcon.svelte';
  import ClipThumbnail from './ClipThumbnail.svelte';
  import { ShaderAudition, searchVisuals } from '../../mobile/studio/audition';
  import { getAsset } from '../../mobile/studio/assets';
  import { shaderThumbnail, type Clip } from '../../mobile/studio/model';

  type Visual = { id: string; name: string; category: string };
  type Source = 'visuals' | 'media' | 'camera';

  /** Where the clip will go, for example "L2 · slot 5". Empty when the next free slot is used. */
  export let target = '';
  export let visuals: Visual[] = [];
  /** Photos and videos already imported on this device. */
  export let media: Clip[] = [];
  /** Whether this device can offer the LiDAR depth camera. */
  export let depth = false;
  /** Shown in normal-size text when the depth camera cannot be offered. */
  export let depthReason = 'Depth camera needs a LiDAR sensor (iPhone Pro or iPad Pro). This device does not have one.';
  export let source: Source = 'visuals';
  export let onvisual: (id: string) => void = () => {};
  export let onclip: (clip: Clip) => void = () => {};
  export let onimport: (kind: 'video' | 'photo' | 'any') => void = () => {};
  export let oncamera: (facing: 'user' | 'environment') => void = () => {};
  export let ondepth: () => void = () => {};
  export let onremove: (clip: Clip) => void = () => {};
  export let onclose: () => void = () => {};

  const SOURCES: { id: Source; label: string; icon: string }[] = [
    { id: 'visuals', label: 'Visuals', icon: 'grid' },
    { id: 'media', label: 'Photos and videos', icon: 'library' },
    { id: 'camera', label: 'Camera', icon: 'camera' },
  ];
  let search = '', category = 'all';
  let failed = new Set<string>();
  /** The visual being previewed. */
  let chosen: Visual | null = null;
  let chosenClip: Clip | null = null;
  let clipUrl = '';
  let previewState: 'idle' | 'loading' | 'live' | 'still' = 'idle';
  let canvas: HTMLCanvasElement;
  let audition: ShaderAudition | undefined;
  let root: HTMLElement;
  let returnFocus: HTMLElement | null = null;

  $: categories = ['all', ...new Set(visuals.map((s) => s.category))];
  $: shown = searchVisuals(visuals, category, search).filter((s) => !failed.has(s.id));
  const title = (cat: string) => (cat === 'all' ? 'All' : cat[0].toUpperCase() + cat.slice(1));

  async function preview(visual: Visual) {
    if (chosen?.id === visual.id) { onvisual(visual.id); return; }
    chosen = visual;
    previewState = 'loading';
    await tick();
    try {
      audition ??= new ShaderAudition(canvas);
      if (await audition.show(visual.id)) previewState = 'live';
    } catch {
      // No second GPU context to spare, or the shader would not build: the picture still shows it.
      if (chosen?.id === visual.id) previewState = 'still';
    }
  }
  function releaseClip() { if (clipUrl) URL.revokeObjectURL(clipUrl); clipUrl = ''; }
  async function previewClip(clip: Clip) {
    if (chosenClip?.id === clip.id) { onclip(clip); return; }
    releaseClip();
    chosenClip = clip;
    const blob = clip.assetId ? await getAsset(clip.assetId).catch(() => undefined) : undefined;
    if (blob && chosenClip?.id === clip.id) clipUrl = URL.createObjectURL(blob);
  }
  function pick(next: Source) {
    if (next === source) return;
    // Each tab draws its own preview; the old one is released with the tab it belonged to.
    if (source === 'visuals') { audition?.destroy(); audition = undefined; chosen = null; previewState = 'idle'; }
    if (source === 'media') { chosenClip = null; releaseClip(); }
    source = next;
  }
  function key(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onclose(); return; }
    if (e.key !== 'Tab') return;
    // Keep keyboard focus inside the picker while it covers the studio.
    const items = [...root.querySelectorAll<HTMLElement>('button:not([disabled]),input,select,[tabindex="0"]')].filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  onMount(() => {
    returnFocus = document.activeElement as HTMLElement | null;
    root.querySelector<HTMLElement>('[data-picker-close]')?.focus({ preventScroll: true });
  });
  onDestroy(() => {
    audition?.destroy();
    releaseClip();
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  });
</script>

<div class="clip-picker" bind:this={root} role="dialog" aria-modal="true" aria-label={target ? `Add a clip to ${target}` : 'Add a clip'} data-clip-picker onkeydown={key}>
  <header>
    <button class="back" data-picker-close aria-label="Close and go back to the deck" onclick={onclose}><Icon name="left" size={18} />Deck</button>
    <h2>Add a clip{#if target}<small>{target}</small>{/if}</h2>
  </header>
  <div class="sources" role="tablist" aria-label="Clip source">
    {#each SOURCES as s}<button role="tab" aria-selected={source === s.id} class:active={source === s.id} data-picker-source={s.id} onclick={() => pick(s.id)}><Icon name={s.icon} size={18} /><span>{s.label}</span></button>{/each}
  </div>

  {#if source === 'visuals'}
    <div class="audition" class:empty={!chosen} data-audition={previewState} aria-live="polite">
      {#if chosen}
        <div class="stage">
          <img src={shaderThumbnail(chosen.id)} alt="" />
          <canvas bind:this={canvas} class:live={previewState === 'live'} aria-label={`Preview of ${chosen.name}`}></canvas>
          {#if previewState === 'loading'}<span class="badge">Loading preview…</span>{:else if previewState === 'live'}<span class="badge live">PREVIEW</span>{/if}
        </div>
        <div class="about">
          <strong>{chosen.name}</strong><small>{title(chosen.category)} · Preview only. The output does not change.</small>
          <button class="add" data-picker-add onclick={() => chosen && onvisual(chosen.id)}><Icon name="plus" size={18} />Add to deck</button>
        </div>
      {:else}<p>Tap a visual to preview it here. Tap Add to put it on the deck.</p>{/if}
    </div>
    <label class="search"><Icon name="search" size={18} /><input type="search" placeholder="Search visuals" bind:value={search} aria-label="Search visuals" enterkeyhint="search" autocapitalize="off" autocomplete="off" /></label>
    <div class="chips" role="group" aria-label="Kind of visual">
      {#each categories as cat}<button class:active={category === cat} aria-pressed={category === cat} onclick={() => (category = cat)}>{title(cat)}</button>{/each}
    </div>
    <div class="scroll" data-picker-scroll>
      <div class="grid">
        {#each shown as visual (visual.id)}
          <button class="tile" class:chosen={chosen?.id === visual.id} aria-pressed={chosen?.id === visual.id} aria-label={chosen?.id === visual.id ? `Add ${visual.name} to the deck` : `Preview ${visual.name}`} data-visual={visual.id} onclick={() => preview(visual)}>
            <img src={shaderThumbnail(visual.id)} alt="" loading="lazy" decoding="async" onerror={() => (failed = new Set([...failed, visual.id]))} />
            <strong>{visual.name}</strong>
          </button>
        {/each}
      </div>
      {#if !shown.length}<p class="none" role="status">No visuals match “{search}”.</p>{/if}
    </div>
  {:else if source === 'media'}
    <div class="scroll" data-picker-scroll>
      <div class="choices">
        <button data-import="photo" onclick={() => onimport('photo')}><Icon name="library" size={22} /><span><strong>Photos</strong><small>From your photo library</small></span></button>
        <button data-import="video" onclick={() => onimport('video')}><Icon name="play" size={22} /><span><strong>Videos</strong><small>From your photo library</small></span></button>
        <button data-import="any" onclick={() => onimport('any')}><Icon name="upload" size={22} /><span><strong>Files</strong><small>Photos and videos from Files</small></span></button>
      </div>
      <h3>On this device <span>{media.length}</span></h3>
      {#if chosenClip}
        <div class="audition" data-audition="clip">
          <div class="stage">{#if clipUrl}{#if chosenClip.kind === 'video'}<video src={clipUrl} muted loop autoplay playsinline aria-label={`Preview of ${chosenClip.name}`}></video>{:else}<img class="shown" src={clipUrl} alt={`Preview of ${chosenClip.name}`} />{/if}{/if}</div>
          <div class="about"><strong>{chosenClip.name}</strong><small>{chosenClip.kind === 'video' ? 'Video' : 'Photo'} · Preview only.</small>
            <button class="add" data-picker-add onclick={() => chosenClip && onclip(chosenClip)}><Icon name="plus" size={18} />Add to deck</button></div>
        </div>
      {/if}
      {#each media as clip (clip.id)}
        <div class="row" class:chosen={chosenClip?.id === clip.id}>
          <button class="file" aria-pressed={chosenClip?.id === clip.id} aria-label={chosenClip?.id === clip.id ? `Add ${clip.name} to the deck` : `Preview ${clip.name}`} data-media={clip.id} onclick={() => previewClip(clip)}>
            <span class="thumb"><ClipThumbnail {clip} /></span><span class="name"><strong>{clip.name}</strong><small>{clip.kind === 'video' ? 'Video' : 'Photo'}</small></span>
          </button>
          <button class="remove" aria-label={`Remove ${clip.name} from this set`} onclick={() => { if (chosenClip?.id === clip.id) { chosenClip = null; releaseClip(); } onremove(clip); }}><Icon name="trash" size={18} /></button>
        </div>
      {/each}
      {#if !media.length}<p class="none">Nothing imported yet. Photos and videos you add are kept on this device for your next session.</p>{/if}
      <p class="note">H.264 MP4 is the most reliable video format on iPhone and iPad.</p>
    </div>
  {:else}
    <div class="scroll" data-picker-scroll>
      <div class="choices">
        <button data-camera="environment" onclick={() => oncamera('environment')}><Icon name="camera" size={22} /><span><strong>Rear camera</strong><small>Live picture from the back camera</small></span></button>
        <button data-camera="user" onclick={() => oncamera('user')}><Icon name="camera" size={22} /><span><strong>Front camera</strong><small>Live picture from the selfie camera</small></span></button>
        <button data-camera="depth" disabled={!depth} onclick={ondepth}><Icon name="depth" size={22} /><span><strong>Depth camera</strong><small>Live LiDAR depth as a clip</small></span></button>
      </div>
      {#if !depth}<p class="reason" data-depth-reason>{depthReason}</p>{/if}
      <p class="note">The camera starts when you launch its clip, and iOS asks for permission the first time.</p>
    </div>
  {/if}
</div>

<style>
  .clip-picker {
    position: fixed; inset: 0; z-index: 55; display: flex; flex-direction: column; min-height: 0;
    padding: max(10px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) 0 max(12px, env(safe-area-inset-left));
    background: var(--ga-void); color: var(--ga-ink-0);
  }
  button { font: inherit; color: var(--ga-ink-0); background: var(--ga-hardware-bg); border: 1px solid var(--ga-line-2); border-radius: 6px; touch-action: manipulation; cursor: pointer; }
  button:disabled { opacity: .45; }
  button:focus-visible, input:focus-visible { outline: 2px solid var(--ga-focus); outline-offset: 2px; }
  header { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 12px; margin-bottom: 8px; }
  .back { display: flex; align-items: center; gap: 4px; min-height: 44px; padding: 0 14px 0 8px; font-size: 13px; }
  h2 { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 10px; margin: 0; font-size: 18px; font-weight: 600; line-height: 1.2; }
  h2 small { font-size: 12px; font-weight: 500; color: var(--ga-ink-1); }
  .sources { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; margin-bottom: 10px; }
  .sources button { display: flex; align-items: center; justify-content: center; gap: 6px; min-height: 48px; padding: 4px 6px; font-size: 12px; line-height: 1.2; }
  .sources button.active, .chips button.active { background: var(--ga-selection-bg); border-color: var(--ga-selection-line); color: var(--ga-selection-ink); }
  .audition {
    flex: none; display: grid; grid-template-columns: minmax(0, 42%) minmax(0, 1fr); gap: 10px; align-items: center;
    margin-bottom: 8px; padding: 8px; border: 1px solid var(--ga-line-2); border-radius: var(--ga-r-soft); background: var(--ga-card);
  }
  .audition.empty { display: block; padding: 10px 12px; }
  .audition p { margin: 0; font-size: 13px; line-height: 1.4; color: var(--ga-ink-1); }
  .stage { position: relative; aspect-ratio: 16 / 9; overflow: hidden; border-radius: 5px; background: var(--ga-slot); }
  .stage img, .stage canvas, .stage video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .stage canvas { opacity: 0; }
  .stage canvas.live { opacity: 1; }
  .badge { position: absolute; left: 6px; bottom: 6px; padding: 2px 6px; border-radius: 3px; background: #000a; font-size: 10px; letter-spacing: .06em; color: var(--ga-ink-0); }
  .badge.live { color: var(--ga-green); }
  .about { display: grid; gap: 3px; min-width: 0; }
  .about strong { font-size: 15px; font-weight: 600; overflow-wrap: anywhere; }
  .about small { font-size: 12px; line-height: 1.35; color: var(--ga-ink-1); }
  .add { display: flex; align-items: center; justify-content: center; gap: 6px; min-height: 44px; margin-top: 5px; font-size: 13px; font-weight: 650; background: var(--ga-blue-500); border-color: var(--ga-blue-400); color: #fff; }
  .add :global(svg) { color: #fff !important; }
  .search { flex: none; display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 12px; margin-bottom: 8px; border: 1px solid var(--ga-line-2); border-radius: 6px; background: var(--ga-slot); }
  .search input { flex: 1; min-width: 0; height: 42px; border: 0; background: none; color: var(--ga-ink-0); font: inherit; font-size: 16px; outline-offset: -2px; }
  .chips { flex: none; display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; margin-bottom: 8px; padding-bottom: 1px; }
  .chips::-webkit-scrollbar { display: none; }
  .chips button { flex: none; min-height: 44px; padding: 0 14px; font-size: 13px; }
  /* The list ends above the home indicator: nothing tappable scrolls through that strip. */
  .scroll { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; padding-bottom: 16px; margin-bottom: env(safe-area-inset-bottom); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 6px; }
  .tile { position: relative; display: grid; padding: 0; overflow: hidden; text-align: left; content-visibility: auto; contain-intrinsic-size: 104px 86px; background: var(--ga-slot); }
  .tile img { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; display: block; pointer-events: none; }
  .tile strong { padding: 5px 7px 6px; font-size: 12px; font-weight: 550; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tile.chosen { border-color: var(--ga-blue-300); box-shadow: inset 0 0 0 2px var(--ga-blue-400); }
  .choices { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 6px; margin-bottom: 14px; }
  .choices button { display: flex; align-items: center; gap: 12px; min-height: 60px; padding: 8px 14px; text-align: left; }
  .choices span, .name { display: grid; gap: 2px; min-width: 0; }
  .choices strong, .name strong { font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .choices small, .name small { font-size: 12px; color: var(--ga-ink-1); }
  h3 { display: flex; justify-content: space-between; margin: 0 0 8px; font-size: 12px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--ga-ink-1); }
  .row { display: grid; grid-template-columns: minmax(0, 1fr) 48px; gap: 4px; margin-bottom: 4px; }
  .file { display: grid; grid-template-columns: 72px minmax(0, 1fr); align-items: center; gap: 12px; min-height: 52px; padding: 4px 10px 4px 4px; text-align: left; }
  .row.chosen .file { border-color: var(--ga-blue-300); box-shadow: inset 0 0 0 2px var(--ga-blue-400); }
  .thumb { position: relative; display: grid; place-items: center; width: 72px; aspect-ratio: 16 / 9; overflow: hidden; border-radius: 4px; background: var(--ga-slot); }
  .remove { display: grid; place-items: center; min-height: 48px; padding: 0; }
  .none, .note, .reason { margin: 10px 2px; font-size: 14px; line-height: 1.45; color: var(--ga-ink-1); }
  .reason { color: var(--ga-ink-0); }
  .note { font-size: 13px; }
  @media (min-width: 700px) {
    .clip-picker { padding-left: max(24px, env(safe-area-inset-left)); padding-right: max(24px, env(safe-area-inset-right)); }
    .audition { grid-template-columns: minmax(0, 340px) minmax(0, 1fr); }
    .grid { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
    .sources button { font-size: 14px; }
  }
  @media (max-height: 480px) {
    /* Phone held sideways (Split View rows, not the iPhone app): the preview sits beside the list. */
    .audition { grid-template-columns: minmax(0, 150px) minmax(0, 1fr); }
  }
</style>
