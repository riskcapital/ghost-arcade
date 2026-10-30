<script lang="ts">
  /**
   * Demo Reel panel — shot-based sizzle-reel recorder.
   *
   * Workflow: set the stage look + camera → Save Shot (or drag a move
   * template onto the strip) → repeat with different visuals → tweak
   * per-shot duration / easing / move → Preview (realtime approximate)
   * → Render Reel (deterministic offline MP4 via stageReelRender).
   *
   * Lives in the Stage 3D designer as a bottom strip, toggled from the
   * topbar. Drag-and-drop: template cards drop onto the strip to create
   * a shot from the CURRENT camera; shots drag to reorder.
   */
  import { get } from 'svelte/store';
  import {
    demoReel, MOVE_TEMPLATES, moveTemplate, sequenceDuration, shotAtTime,
    evaluateShotCamera, type DemoShot, type ReelEasing,
  } from '../../stage3d/demoReel';
  import { stage3dScene, stage3DRendererControls } from '../../stage3d/store';
  import { stageReelRender } from '../../recording/stageReelRender';

  export let onClose: () => void = () => {};

  $: shots = $demoReel.shots;
  $: settings = $demoReel.settings;
  $: totalSec = sequenceDuration(shots);
  $: render = $stageReelRender;
  $: rendering = render.status === 'choosing-folder' || render.status === 'loading-ffmpeg' || render.status === 'rendering'
    || render.status === 'encoding' || render.status === 'saving';

  let selectedShotId: string | null = null;
  $: selectedShot = shots.find(s => s.id === selectedShotId) ?? null;

  // ── Shot capture ──────────────────────────────────────────────────────

  /** Small JPEG of the current 3D view for the shot card. */
  async function captureThumbnail(): Promise<string | undefined> {
    const controls = get(stage3DRendererControls);
    if (!controls) return undefined;
    try {
      const frame = await controls.captureFrame();
      const src = document.createElement('canvas');
      src.width = frame.width; src.height = frame.height;
      const sctx = src.getContext('2d')!;
      const clamped = new Uint8ClampedArray(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength);
      sctx.putImageData(new ImageData(clamped as Uint8ClampedArray<ArrayBuffer>, frame.width, frame.height), 0, 0);
      const thumb = document.createElement('canvas');
      thumb.width = 128; thumb.height = 72;
      thumb.getContext('2d')!.drawImage(src, 0, 0, 128, 72);
      return thumb.toDataURL('image/jpeg', 0.7);
    } catch {
      return undefined;
    }
  }

  async function saveShot(moveId = 'static') {
    const controls = get(stage3DRendererControls);
    if (!controls) return;
    const camera = controls.getCameraState();
    const thumbnail = await captureThumbnail();
    const shot = demoReel.addShot(camera, get(stage3dScene), moveId, thumbnail);
    selectedShotId = shot.id;
  }

  async function recaptureShot(shot: DemoShot) {
    const controls = get(stage3DRendererControls);
    if (!controls) return;
    const thumbnail = await captureThumbnail();
    demoReel.updateShotCapture(shot.id, controls.getCameraState(), get(stage3dScene), thumbnail);
  }

  // ── Drag & drop ───────────────────────────────────────────────────────

  let dragOverIndex: number | null = null;

  function onTemplateDragStart(e: DragEvent, templateId: string) {
    e.dataTransfer?.setData('application/x-reel-template', templateId);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
  }
  function onShotDragStart(e: DragEvent, shotId: string) {
    e.dataTransfer?.setData('application/x-reel-shot', shotId);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  }
  function onStripDragOver(e: DragEvent, index: number) {
    e.preventDefault();
    dragOverIndex = index;
  }
  async function onStripDrop(e: DragEvent, index: number) {
    e.preventDefault();
    dragOverIndex = null;
    const templateId = e.dataTransfer?.getData('application/x-reel-template');
    const shotId = e.dataTransfer?.getData('application/x-reel-shot');
    if (templateId) {
      await saveShot(templateId);
      // addShot appends — move the new shot to the drop slot.
      const all = get(demoReel).shots;
      const created = all[all.length - 1];
      if (created) demoReel.reorderShot(created.id, index);
    } else if (shotId) {
      demoReel.reorderShot(shotId, index);
    }
  }

  // ── Realtime preview ─────────────────────────────────────────────────

  let previewing = false;
  let previewRaf = 0;

  function stopPreview() {
    previewing = false;
    cancelAnimationFrame(previewRaf);
    get(stage3DRendererControls)?.releaseCamera();
  }

  function startPreview() {
    if (shots.length === 0) return;
    const controls = get(stage3DRendererControls);
    if (!controls) return;
    const restoreScene = JSON.parse(JSON.stringify(get(stage3dScene)));
    previewing = true;
    const t0 = performance.now();
    let lastIndex = -1;
    const tick = () => {
      if (!previewing) return;
      const t = (performance.now() - t0) / 1000;
      const seq = get(demoReel).shots;
      if (t >= sequenceDuration(seq)) {
        stopPreview();
        try { stage3dScene.loadScene(restoreScene); } catch { /* keep */ }
        return;
      }
      const at = shotAtTime(seq, t);
      if (at) {
        if (at.index !== lastIndex) {
          lastIndex = at.index;
          stage3dScene.loadScene(JSON.parse(JSON.stringify(at.shot.stage)));
        }
        controls.setCameraState(evaluateShotCamera(at.shot, at.progress));
      }
      previewRaf = requestAnimationFrame(tick);
    };
    previewRaf = requestAnimationFrame(tick);
  }

  // ── Render ───────────────────────────────────────────────────────────

  async function renderReel() {
    if (rendering) return;
    stopPreview();
    await stageReelRender.start(get(demoReel).shots, get(demoReel).settings);
  }

  const RESOLUTIONS = [
    { label: '1080p', w: 1920, h: 1080 },
    { label: '1440p', w: 2560, h: 1440 },
    { label: '4K',    w: 3840, h: 2160 },
  ];

  function fmtSec(s: number): string {
    return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
  }
</script>

<div data-help-page="stage-simulator" class="reel-panel">
  <div class="reel-head">
    <span class="reel-title">Demo reel</span>
    <span class="reel-total">{shots.length} shot{shots.length === 1 ? '' : 's'} · {fmtSec(totalSec)}</span>
    <div class="reel-spacer"></div>
    {#if previewing}
      <button class="rbtn" onclick={stopPreview}>⏹ Stop</button>
    {:else}
      <button class="rbtn" onclick={startPreview} disabled={shots.length === 0 || rendering}>▶ Preview</button>
    {/if}
    <button class="rbtn primary" onclick={renderReel} disabled={shots.length === 0 || rendering}>
      {rendering ? 'Rendering…' : 'Render reel'}
    </button>
    <button class="rbtn" onclick={onClose} title="Close panel">✕</button>
  </div>

  {#if rendering || render.status === 'error' || render.status === 'complete'}
    <div class="reel-progress" class:error={render.status === 'error'}>
      {#if render.status === 'choosing-folder'}
        <span>Choose an output folder…</span>
      {:else if render.status === 'rendering'}
        <span>{settings.outputMode === 'frames' ? 'Writing' : 'Rendering'} frame {render.currentFrame}/{render.totalFrames}</span>
        <progress max={render.totalFrames} value={render.currentFrame}></progress>
      {:else if render.status === 'encoding'}
        <span>Encoding MP4…</span>
        <progress max="1" value={render.encodeProgress}></progress>
      {:else if render.status === 'loading-ffmpeg'}
        <span>Loading encoder…</span>
      {:else if render.status === 'saving'}
        <span>Saving…</span>
      {:else if render.status === 'error'}
        <span>Render failed: {render.errorMessage}</span>
        <button class="rbtn" onclick={() => stageReelRender.reset()}>Dismiss</button>
      {:else if render.status === 'complete'}
        {#if render.lastOutputKind === 'frames'}
          <span>✓ Saved “{render.lastOutputName}” frames to {render.lastOutputPath ?? 'the selected folder'}.</span>
        {:else}
          <span>✓ Saved “{render.lastOutputName}” to the media library + downloads.</span>
        {/if}
        <button class="rbtn" onclick={() => stageReelRender.reset()}>Dismiss</button>
      {/if}
      {#if rendering}
        <button class="rbtn" onclick={() => stageReelRender.cancel()}>Cancel</button>
      {/if}
    </div>
  {/if}

  <div class="reel-body">
    <!-- Move template tray — drag onto the strip (or click to append). -->
    <div class="tray">
      <div class="tray-head">Camera moves <span class="tray-hint">drag → strip</span></div>
      {#each MOVE_TEMPLATES.filter(t => t.id !== 'custom') as tpl}
        <button
          class="tpl-card"
          draggable="true"
          ondragstart={(e) => onTemplateDragStart(e, tpl.id)}
          onclick={() => saveShot(tpl.id)}
          title="Click to add a shot with the current camera + look"
        >
          <span class="tpl-icon">{tpl.icon}</span>{tpl.label}
        </button>
      {/each}
      <button class="tpl-card save" onclick={() => saveShot('static')}>+ Save shot (current view)</button>
    </div>

    <!-- Sequence strip -->
    <div class="strip"
      role="list"
      ondragover={(e) => onStripDragOver(e, shots.length)}
      ondrop={(e) => onStripDrop(e, shots.length)}
    >
      {#if shots.length === 0}
        <div class="strip-empty">Drag a camera move here — or set up your stage and hit “Save shot”.</div>
      {/if}
      {#each shots as shot, i (shot.id)}
        <div
          class="shot-card"
          class:selected={selectedShotId === shot.id}
          class:drag-over={dragOverIndex === i}
          role="listitem"
          draggable="true"
          ondragstart={(e) => onShotDragStart(e, shot.id)}
          ondragover={(e) => { e.stopPropagation(); onStripDragOver(e, i); }}
          ondrop={(e) => { e.stopPropagation(); onStripDrop(e, i); }}
          onclick={() => { selectedShotId = shot.id; }}
        >
          {#if shot.thumbnail}
            <img class="shot-thumb" src={shot.thumbnail} alt={shot.name} draggable="false" />
          {:else}
            <div class="shot-thumb placeholder">{moveTemplate(shot.moveId).icon}</div>
          {/if}
          <div class="shot-meta">
            <span class="shot-name">{i + 1}. {shot.name}</span>
            <span class="shot-move">{moveTemplate(shot.moveId).label} · {shot.durationSec.toFixed(1)}s</span>
          </div>
          <button class="shot-del" onclick={(e) => { e.stopPropagation(); demoReel.removeShot(shot.id); if (selectedShotId === shot.id) selectedShotId = null; }} title="Delete shot">✕</button>
        </div>
      {/each}
    </div>

    <!-- Shot inspector + output settings -->
    <div class="inspector">
      {#if selectedShot}
        <div class="insp-head">{selectedShot.name}</div>
        <label class="insp-row">
          <span>Move</span>
          <select value={selectedShot.moveId} onchange={(e) => demoReel.setShotMove(selectedShot!.id, (e.target as HTMLSelectElement).value)}>
            {#each MOVE_TEMPLATES as tpl}
              <option value={tpl.id}>{tpl.icon} {tpl.label}</option>
            {/each}
          </select>
        </label>
        <label class="insp-row">
          <span>Duration</span>
          <input type="number" min="0.5" max="60" step="0.5" value={selectedShot.durationSec}
            oninput={(e) => demoReel.updateShot(selectedShot!.id, { durationSec: Math.max(0.5, parseFloat((e.target as HTMLInputElement).value) || 5) })} />
          <span class="unit">s</span>
        </label>
        <label class="insp-row">
          <span>Easing</span>
          <select value={selectedShot.easing} onchange={(e) => demoReel.updateShot(selectedShot!.id, { easing: (e.target as HTMLSelectElement).value as ReelEasing })}>
            <option value="linear">Linear</option>
            <option value="ease-in">Ease in</option>
            <option value="ease-out">Ease out</option>
            <option value="ease-in-out">Ease in-out</option>
          </select>
        </label>
        <button class="rbtn wide" onclick={() => recaptureShot(selectedShot!)}
          title="Re-save this shot's camera + stage look from the current view">
          Update from current view
        </button>
      {:else}
        <div class="insp-empty">Select a shot to edit it.</div>
      {/if}

      <div class="insp-divider"></div>
      <div class="insp-head eyebrow">Output</div>
      <label class="insp-row">
        <span>Res</span>
        <select
          value={`${settings.width}x${settings.height}`}
          onchange={(e) => {
            const r = RESOLUTIONS.find(r => `${r.w}x${r.h}` === (e.target as HTMLSelectElement).value);
            if (r) demoReel.setSettings({ width: r.w, height: r.h });
          }}>
          {#each RESOLUTIONS as r}
            <option value={`${r.w}x${r.h}`}>{r.label}</option>
          {/each}
        </select>
      </label>
      <label class="insp-row">
        <span>FPS</span>
        <select value={String(settings.fps)} onchange={(e) => demoReel.setSettings({ fps: Number((e.target as HTMLSelectElement).value) as 24 | 30 | 60 })}>
          <option value="24">24</option>
          <option value="30">30</option>
          <option value="60">60</option>
        </select>
      </label>
      <label class="insp-row">
        <span>Type</span>
        <select
          value={settings.outputMode ?? 'mp4'}
          onchange={(e) => demoReel.setSettings({ outputMode: (e.target as HTMLSelectElement).value as 'mp4' | 'frames' })}>
          <option value="mp4">MP4</option>
          <option value="frames">Frames</option>
        </select>
      </label>
      <label class="insp-row">
        <span>Quality</span>
        <select value={settings.quality} onchange={(e) => demoReel.setSettings({ quality: (e.target as HTMLSelectElement).value as 'high' | 'web' | 'archive' })}>
          <option value="web">Web</option>
          <option value="high">High</option>
          <option value="archive">Archive</option>
        </select>
      </label>
      <label class="insp-row">
        <span>Trans</span>
        <select
          value={settings.transition ?? 'cut'}
          onchange={(e) => demoReel.setSettings({ transition: (e.target as HTMLSelectElement).value as 'cut' | 'cross-dissolve' })}>
          <option value="cut">Cut</option>
          <option value="cross-dissolve">Cross dissolve</option>
        </select>
      </label>
      {#if (settings.transition ?? 'cut') === 'cross-dissolve'}
        <label class="insp-row">
          <span>Fade</span>
          <input type="number" min="0.1" max="5" step="0.1" value={settings.transitionDurationSec ?? 0.75}
            oninput={(e) => demoReel.setSettings({ transitionDurationSec: Math.max(0.1, Math.min(5, parseFloat((e.target as HTMLInputElement).value) || 0.75)) })} />
          <span class="unit">s</span>
        </label>
      {/if}
      <label class="insp-row">
        <span>Name</span>
        <input type="text" value={settings.filename} oninput={(e) => demoReel.setSettings({ filename: (e.target as HTMLInputElement).value })} />
      </label>
    </div>
  </div>
</div>

<style>
  .reel-panel {
    position: absolute;
    left: 0; right: 0; bottom: 0;
    background: color-mix(in srgb, var(--ga-panel, #100f0d) 96%, transparent);
    border-top: 1px solid var(--ga-line-2);
    z-index: 30;
    display: flex;
    flex-direction: column;
    max-height: 46vh;
    color: var(--ga-ink-0);
    font-size: var(--ga-text-control, 12px);
  }
  .reel-head {
    display: flex; align-items: center; gap: 6px;
    height: 44px;
    box-sizing: border-box;
    padding: 0 12px;
    border-bottom: 1px solid var(--ga-line-2);
  }
  .reel-title { font-size: var(--ga-text-title, 14px); font-weight: var(--ga-weight-title, 650); margin-right: 6px; }
  .reel-total { color: var(--ga-ink-2); font-size: var(--ga-text-meta, 11px); }
  .reel-spacer { flex: 1; }
  .rbtn {
    height: var(--ga-control-h, 26px);
    box-sizing: border-box;
    background: var(--ga-card); color: var(--ga-ink-0);
    border: 1px solid var(--ga-line-2); border-radius: var(--ga-r-hard, 5px);
    padding: 0 10px; cursor: pointer;
    font: inherit;
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-control, 600);
    white-space: nowrap;
  }
  .rbtn:hover:not(:disabled) { border-color: var(--ga-line-3); }
  .rbtn:disabled { opacity: 0.45; cursor: default; }
  .rbtn.primary {
    background: var(--ga-accent-gradient, var(--ga-ink-0));
    border-color: var(--ga-violet-line, var(--ga-line-3));
    color: var(--ga-void, #0a0908);
    border-radius: var(--ga-r-soft, 8px);
  }
  .rbtn.primary:hover:not(:disabled) { filter: brightness(1.06); }
  .rbtn.wide { width: 100%; margin-top: 6px; }
  .reel-progress {
    display: flex; align-items: center; gap: 10px;
    padding: 6px 12px;
    background: var(--ga-card);
    border-bottom: 1px solid var(--ga-line-2);
  }
  .reel-progress.error { color: var(--ga-rec, #ff3b30); }
  .reel-progress progress { flex: 1; height: 8px; }
  .reel-body {
    display: grid;
    grid-template-columns: 190px 1fr 230px;
    gap: 0;
    min-height: 0;
  }
  .tray {
    border-right: 1px solid var(--ga-line-2);
    padding: 8px;
    overflow-y: auto;
    display: flex; flex-direction: column; gap: 4px;
  }
  .tray-head {
    color: var(--ga-ink-2);
    text-transform: uppercase;
    font-size: var(--ga-text-eyebrow, 10px);
    font-weight: 700;
    letter-spacing: var(--ga-eyebrow-tracking, 0.08em);
    margin-bottom: 4px;
    display: flex; justify-content: space-between;
  }
  .tray-hint { text-transform: none; letter-spacing: 0; font-weight: 500; }
  .tpl-card {
    display: flex; align-items: center; gap: 8px;
    min-height: var(--ga-control-h, 26px);
    background: var(--ga-card); color: var(--ga-ink-0);
    border: 1px solid var(--ga-line-2); border-radius: var(--ga-r-hard, 5px);
    padding: 3px 8px; cursor: grab;
    font: inherit;
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-control, 600);
    text-align: left;
  }
  .tpl-card:hover { border-color: var(--ga-line-3); }
  .tpl-card.save { border-style: dashed; color: var(--ga-ink-1); margin-top: 6px; cursor: pointer; }
  .tpl-icon { width: 16px; text-align: center; }
  .strip {
    display: flex; align-items: stretch; gap: 8px;
    padding: 10px;
    overflow-x: auto;
    min-height: 110px;
  }
  .strip-empty {
    display: flex; align-items: center; justify-content: center;
    flex: 1; color: var(--ga-ink-2); border: 1px dashed var(--ga-line-2);
    border-radius: var(--ga-r-soft, 8px); padding: 18px; font-size: var(--ga-text-meta, 11px);
  }
  .shot-card {
    position: relative;
    display: flex; flex-direction: column;
    width: 150px; flex: 0 0 150px;
    background: var(--ga-card); border: 1px solid var(--ga-line-2); border-radius: var(--ga-r-tile, 7px);
    cursor: grab; overflow: hidden;
  }
  .shot-card.selected { border-color: var(--ga-selection-line); box-shadow: inset 0 0 0 1px var(--ga-selection-line); }
  .shot-card.drag-over { border-color: var(--ga-line-3); }
  .shot-thumb { width: 100%; height: 72px; object-fit: cover; background: var(--ga-slot); }
  .shot-thumb.placeholder {
    display: flex; align-items: center; justify-content: center;
    font-size: 27px; color: var(--ga-ink-3);
  }
  .shot-meta { display: flex; flex-direction: column; padding: 5px 7px; gap: 2px; }
  .shot-name { font-weight: 600; font-size: var(--ga-text-control, 12px); }
  .shot-move { color: var(--ga-ink-2); font-size: var(--ga-text-meta, 11px); }
  .shot-del {
    position: absolute; top: 3px; right: 3px;
    background: color-mix(in srgb, var(--ga-void, #0a0908) 75%, transparent); color: var(--ga-ink-1);
    border: none; border-radius: var(--ga-r-hard, 5px); cursor: pointer;
    width: 18px; height: 18px; font-size: var(--ga-text-meta, 11px); line-height: 1;
  }
  .shot-del:hover { color: var(--ga-rec, #ff3b30); }
  .inspector {
    border-left: 1px solid var(--ga-line-2);
    padding: 10px;
    overflow-y: auto;
    display: flex; flex-direction: column; gap: 6px;
  }
  .insp-head {
    font-weight: var(--ga-weight-title, 650);
    font-size: var(--ga-text-title, 14px);
    color: var(--ga-ink-0);
  }
  .insp-head.eyebrow {
    font-size: var(--ga-text-eyebrow, 10px);
    font-weight: 700;
    letter-spacing: var(--ga-eyebrow-tracking, 0.08em);
    color: var(--ga-ink-2);
    text-transform: uppercase;
  }
  .insp-empty { color: var(--ga-ink-2); padding: 8px 0; font-size: var(--ga-text-meta, 11px); }
  .insp-divider { border-top: 1px solid var(--ga-line-2); margin: 8px 0 4px; }
  .insp-row {
    display: flex; align-items: center; gap: 8px;
  }
  .insp-row span:first-child { width: 58px; color: var(--ga-ink-1); }
  .insp-row select, .insp-row input {
    flex: 1; min-width: 0;
    height: var(--ga-control-h, 26px);
    box-sizing: border-box;
    background: var(--ga-slot); color: var(--ga-ink-0);
    border: 1px solid var(--ga-line-2); border-radius: var(--ga-r-hard, 5px);
    padding: 0 6px;
    font: inherit;
    font-size: var(--ga-text-control, 12px);
  }
  .insp-row .unit { width: auto; color: var(--ga-ink-2); }
</style>
