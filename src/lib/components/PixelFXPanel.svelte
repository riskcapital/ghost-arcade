<script lang="ts">
  /**
   * PixelFX panel — controls for the pixel-fx layer type. Talks to
   * the project store via project.updatePixelFXContent(layerId,
   * updates); the WebGPUPixelParticles renderer reads the layer's
   * content each frame and reconciles state into its GPU pipeline.
   *
   * Source loading: file picker → blob URL → store. The renderer
   * sees a new sourceUrl and asynchronously loads the image into a
   * GPU texture before the next encodeFrame.
   */
  import { project, selectedLayer } from '../stores/layers';
  import { mediaLibrary } from '../stores/media';
  import type { PixelFXMode, PixelFXContent, Layer } from '../types';
  import type { MediaItem } from '../stores/media';
  import { createAssetRefFromFile } from '../storage/assetRegistry';
  import NumericInput from './NumericInput.svelte';

  $: layer = $selectedLayer;
  $: content = (layer && layer.type === 'pixel-fx' ? layer.pixelFXContent : null) as PixelFXContent | null;
  $: layerId = layer?.id ?? null;
  // All MEDIA layers in the project (image / video) — valid sources
  // for the "from layer" picker. Layers preserve trim/playback state,
  // so this is useful when you've configured a media layer and want
  // the pixel-fx to consume that exact configuration.
  $: mediaLayers = ($project?.layers ?? []).filter(
    (l: Layer) => l.type === 'media' && l.source && (l.source.type === 'image' || l.source.type === 'video'),
  );
  // Media Library items — what the Media Tray displays. Image +
  // video only (other types like shader / threejs render to a
  // canvas which would need a per-layer render-to-texture pipeline).
  $: libraryItems = ($mediaLibrary ?? []).filter(
    (m: MediaItem) => m.type === 'image' || m.type === 'video',
  );
  // Currently selected media item (for "currently using" badge).
  $: selectedMedia = libraryItems.find((m: MediaItem) => m.id === content?.sourceMediaId) ?? null;

  // Per-mode knob metadata: which positions are meaningful + their
  // human label + min/max/step. The compute shader's knobs vec4 is
  // one struct interpreted differently per mode; we surface only the
  // sliders that have meaning for the current mode.
  type KnobDef = { label: string; min: number; max: number; step: number; idx: 0 | 1 | 2 | 3 };
  const KNOB_LAYOUT: Record<PixelFXMode, KnobDef[]> = {
    'identity': [],
    'depth-shift': [
      { label: 'Depth',     min: 0,    max: 3,    step: 0.01, idx: 0 },
      { label: 'Auto-spin Speed', min: -2,  max: 2, step: 0.01, idx: 2 },
      { label: 'Spin Axis (0=Y, 1=X)', min: 0, max: 1, step: 1, idx: 3 },
    ],
    'sand-fall': [
      { label: 'Fall Speed',min: 0.05, max: 3,    step: 0.01, idx: 0 },
      { label: 'Floor Y',   min: -1.5, max: 1.5,  step: 0.01, idx: 1 },
      { label: 'X Drift',   min: 0,    max: 0.2,  step: 0.001, idx: 2 },
      { label: 'Density',   min: 0.05, max: 1,    step: 0.01, idx: 3 },
    ],
    'scatter': [
      { label: 'Wobble Amp',min: 0,    max: 0.3,  step: 0.005, idx: 0 },
      { label: 'Recovery',  min: 0,    max: 5,    step: 0.05, idx: 1 },
      { label: 'Noise Freq',min: 0.5,  max: 30,   step: 0.5,  idx: 2 },
    ],
    'halftone': [
      { label: 'Cell Size', min: 0.003,max: 0.05, step: 0.001,idx: 0 },
    ],
    'stipple-noise': [
      { label: 'Wobble Amp',min: 0,    max: 0.05, step: 0.001, idx: 0 },
      { label: 'Wobble Freq',min: 5,   max: 100,  step: 1,     idx: 1 },
    ],
    'dissolve': [
      { label: 'Spread',    min: 0,    max: 4,    step: 0.05, idx: 0 },
      { label: 'Cycle Speed',min: 0.05,max: 3,    step: 0.05, idx: 1 },
      { label: 'Swirl',     min: -3,   max: 3,    step: 0.05, idx: 2 },
    ],
    // Flythrough mode doesn't use the generic knobs[] — all its
    // tuning lives in the `flythrough*` named fields on PixelFXContent.
    // Kept as empty here so the Record<PixelFXMode, ...> typecheck
    // passes; the panel renders a dedicated flythrough section below.
    'flythrough': [],
  };

  // Default knob values per mode. Spin defaults to 0 for depth-shift
  // (use camera Yaw/Pitch instead). Sand-fall defaults give a slow
  // continuous full-density flow.
  const DEFAULTS: Record<PixelFXMode, [number, number, number, number]> = {
    'identity':       [0, 0, 0, 0],
    'depth-shift':    [0.6, 0, 0, 0],         // depth, _, spin=0, axis=Y
    'sand-fall':      [0.4, -1.0, 0.02, 1.0], // fall_speed, floor, drift, density
    'scatter':        [0.04, 1.5, 4.0, 0],
    'halftone':       [0.012, 1.0, 0, 0],
    'stipple-noise':  [0.008, 35.0, 0, 0],
    'dissolve':       [1.6, 0.6, 0.5, 0],     // spread, cycle_speed, swirl
    'flythrough':     [0, 0, 0, 0],           // unused — see flythrough* fields
  };

  const MODES: { id: PixelFXMode; label: string; hint: string }[] = [
    { id: 'depth-shift',   label: 'Depth Shift',  hint: 'Pixels displaced by luminance into Z. Use camera Yaw/Pitch (or Auto-spin) to view from any angle. Optional movable light source for shading.' },
    { id: 'flythrough',    label: 'Flythrough',   hint: 'Endless point-cloud tunnel: the source is replicated into N slabs along Z and the camera flies through them on a loop. Optional worm/brush-stroke topology where particles trail along their velocity vectors. Pair with curl-noise flow for fluid swirls through the tunnel.' },
    { id: 'sand-fall',     label: 'Sand Fall',    hint: 'Continuous rain of pixel-grains from anchor down to floor. Each grain has its own phase so the stream looks granular and never stops.' },
    { id: 'scatter',       label: 'Scatter',      hint: 'Pixels wobble around their anchor following a noise field. Image holds shape but constantly trembles.' },
    { id: 'halftone',      label: 'Halftone',     hint: 'Snap to a coarse grid; dot size scales with luminance. Print-style stipple.' },
    { id: 'stipple-noise', label: 'Stipple Ink',  hint: 'Tight micro-wobble around anchor. Hand-drawn ink stipple animation.' },
    { id: 'dissolve',      label: 'Dissolve',     hint: 'Continuously cycling swirl-and-fade. Particles loop from anchor outward and back.' },
    { id: 'identity',      label: 'Identity',     hint: 'Pixels at their anchor with subtle shimmer. Use camera controls to frame as a static 3D image.' },
  ];

  function setMode(mode: PixelFXMode) {
    if (!layerId || !content) return;
    project.updatePixelFXContent(layerId, { mode, knobs: DEFAULTS[mode] });
  }
  function patch(updates: Partial<PixelFXContent>) {
    if (!layerId) return;
    project.updatePixelFXContent(layerId, updates);
  }
  /** Use a Media Library item as the source. Clears the file/layer
   *  source so there's a single active source at any time. */
  function pickMedia(item: MediaItem) {
    if (!layerId) return;
    project.updatePixelFXContent(layerId, {
      sourceType: 'media',
      sourceMediaId: item.id,
      sourceLayerId: null,
      sourceUrl: null,
    });
  }
  function setKnob(idx: 0 | 1 | 2 | 3, value: number) {
    if (!layerId || !content) return;
    const next: [number, number, number, number] = [...content.knobs];
    next[idx] = value;
    project.updatePixelFXContent(layerId, { knobs: next });
  }

  let fileInput: HTMLInputElement;
  function pickFile() { fileInput?.click(); }
  function onFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !layerId) return;
    // Capture an AssetRef so save/reload restores the source. Without it the
    // blob URL dies on session end and the layer comes back with a dead src.
    const { assetRef, runtimeUrl: url } = createAssetRefFromFile(file);
    const isVideo = file.type.startsWith('video/');
    project.updatePixelFXContent(layerId, {
      sourceType: isVideo ? 'video' : 'image',
      sourceUrl: url,
      _sourceAssetRef: assetRef,
    } as any);
    input.value = '';
  }

  $: knobDefs = content ? KNOB_LAYOUT[content.mode] : [];
  $: activeModeMeta = content ? MODES.find(m => m.id === content.mode) : null;
</script>

{#if content && layerId}
  <div class="pfx-panel">
    <div class="sec-label">
      Source
      {#if selectedMedia}
        <span class="src-now">{selectedMedia.name}</span>
      {:else if content.sourceType === 'layer' && content.sourceLayerId}
        {@const sl = mediaLayers.find((l) => l.id === content.sourceLayerId)}
        <span class="src-now">layer · {sl?.name ?? '?'}</span>
      {:else if content.sourceUrl}
        <span class="src-now">file</span>
      {:else}
        <span class="src-now empty">no source</span>
      {/if}
    </div>

    <!-- Media Library grid — primary picker. Same items the Media
         Tray displays. Click a thumbnail to use as the pixel-fx
         source. Image and video supported (videos pump per-frame so
         playback comes through). -->
    <div class="src-section">
      <label class="src-section-label">Media Library</label>
      {#if libraryItems.length === 0}
        <div class="hint mini">No media in your library yet. Drop images/videos onto the Media Tray to add them, or use the file picker below.</div>
      {:else}
        <div class="media-grid">
          {#each libraryItems as item}
            <button class="media-cell"
              class:active={content.sourceMediaId === item.id && content.sourceType === 'media'}
              title={item.name}
              onclick={() => pickMedia(item)}>
              {#if item.thumbnail}
                <img src={item.thumbnail} alt={item.name} class="media-thumb" />
              {:else if item.type === 'image'}
                <img src={item.src} alt={item.name} class="media-thumb" />
              {:else}
                <div class="media-thumb video-placeholder">▶</div>
              {/if}
              <span class="media-cell-label">{item.name}</span>
              {#if item.broken}
                <span class="media-broken-badge" title={item.brokenReason ?? 'unavailable'}>!</span>
              {/if}
            </button>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Layer source — pull from a media layer in the composition.
         Useful when the source layer has trim / playback / blend
         settings you want the pixel-fx to inherit. -->
    {#if mediaLayers.length > 0}
      <div class="src-section">
        <label class="src-section-label">Or from a layer</label>
        <select class="src-select"
          value={content.sourceType === 'layer' ? (content.sourceLayerId ?? '') : ''}
          onchange={(e) => {
            const v = (e.target as HTMLSelectElement).value;
            if (v) {
              patch({ sourceType: 'layer', sourceLayerId: v, sourceMediaId: null, sourceUrl: null });
            } else {
              patch({ sourceLayerId: null });
            }
          }}>
          <option value="">— none —</option>
          {#each mediaLayers as ml}
            <option value={ml.id}>{ml.name} ({ml.source?.type})</option>
          {/each}
        </select>
      </div>
    {/if}

    <!-- File picker — direct upload as a one-off (won't end up in
         the Media Library). Mainly for quick experiments; for
         anything reusable, drop it on the Media Tray instead. -->
    <div class="src-section">
      <label class="src-section-label">Or upload a one-off</label>
      <div class="source-row">
        <button class="src-btn" onclick={pickFile}>
          {#if content.sourceUrl && content.sourceType !== 'layer' && content.sourceType !== 'media'}
            <span class="src-status ok">●</span> {content.sourceType.toUpperCase()} loaded
          {:else}
            <span class="src-status">○</span> Pick file…
          {/if}
        </button>
        {#if content.sourceUrl && content.sourceType !== 'layer' && content.sourceType !== 'media'}
          <button class="mini-btn" title="Clear file"
            onclick={() => patch({ sourceUrl: null })}>×</button>
        {/if}
      </div>
    </div>
    <input type="file" bind:this={fileInput} accept="image/*,video/*" onchange={onFile} style="display:none" />

    <div class="sec-label">Effect</div>
    <div class="mode-grid">
      {#each MODES as m}
        <button class="mode-btn" class:active={content.mode === m.id} onclick={() => setMode(m.id)}>
          {m.label}
        </button>
      {/each}
    </div>
    {#if activeModeMeta}
      <div class="hint">{activeModeMeta.hint}</div>
    {/if}

    {#if knobDefs.length > 0}
      <div class="sec-label sub">Mode Params</div>
      <div class="slider-col">
        {#each knobDefs as kd}
          <NumericInput
            label={kd.label}
            value={content.knobs[kd.idx]}
            min={kd.min}
            max={kd.max}
            step={kd.step}
            on:input={(e) => setKnob(kd.idx, e.detail)}
          />
        {/each}
      </div>
    {/if}

    <div class="sec-label sub">Particles</div>
    <div class="slider-col">
      <NumericInput
        label="Count"
        value={content.particleCount}
        min={10000} max={1000000} step={10000}
        displayValue={(v) => `${(v / 1000).toFixed(0)}K`}
        on:input={(e) => patch({ particleCount: Math.round(e.detail) })} />
      <NumericInput
        label="Size"
        value={content.baseSize}
        min={0.001} max={0.02} step={0.0005}
        on:input={(e) => patch({ baseSize: e.detail })} />
      <NumericInput
        label="Opacity"
        value={content.opacity}
        min={0} max={1} step={0.01}
        on:input={(e) => patch({ opacity: e.detail })} />
      <NumericInput
        label="Anchor Jitter"
        value={content.anchorJitter}
        min={0} max={1} step={0.01}
        on:input={(e) => patch({ anchorJitter: e.detail })} />
    </div>

    <!-- Camera — applies to ALL modes (depth-shift uses Z too; flat
         modes still respect FOV / Yaw / Pitch / Pan / Distance for
         framing). Yaw / Pitch let you orbit without auto-spinning. -->
    <div class="sec-label sub">Camera</div>
    <div class="slider-col">
      <NumericInput label="FOV" value={content.fovDeg} min={20} max={100} step={1}
        displayValue={(v) => `${v.toFixed(0)}°`}
        on:input={(e) => patch({ fovDeg: e.detail })} />
      <NumericInput label="Distance (Zoom)" value={content.cameraZ} min={0.5} max={8} step={0.05}
        on:input={(e) => patch({ cameraZ: e.detail })} />
      <NumericInput label="Yaw" value={content.cameraYaw ?? 0} min={-180} max={180} step={1}
        displayValue={(v) => `${v.toFixed(0)}°`}
        on:input={(e) => patch({ cameraYaw: e.detail })} />
      <NumericInput label="Pitch" value={content.cameraPitch ?? 0} min={-90} max={90} step={1}
        displayValue={(v) => `${v.toFixed(0)}°`}
        on:input={(e) => patch({ cameraPitch: e.detail })} />
      <NumericInput label="Pan X" value={content.panX ?? 0} min={-1.5} max={1.5} step={0.01}
        on:input={(e) => patch({ panX: e.detail })} />
      <NumericInput label="Pan Y" value={content.panY ?? 0} min={-1.5} max={1.5} step={0.01}
        on:input={(e) => patch({ panY: e.detail })} />
      <button class="reset-cam" type="button"
        onclick={() => patch({ fovDeg: 50, cameraZ: 2.2, cameraYaw: 0, cameraPitch: 0, panX: 0, panY: 0 })}>
        Reset Camera
      </button>
    </div>

    <!-- Noise displacement — only for depth-shift right now.
         Wobbles each particle with a flowing 2D noise field, in
         addition to the auto-spin. amp_xy = wobble strength in the
         image plane, amp_z = wobble in depth. Set both to 0 to
         disable cleanly (compute shader skips the work). -->
    {#if content.mode === 'depth-shift'}
      <div class="sec-label sub">Noise Flow</div>
      <div class="slider-col">
        <NumericInput label="Wobble XY" value={content.noiseAmpXY ?? 0} min={0} max={0.5} step={0.005}
          on:input={(e) => patch({ noiseAmpXY: e.detail })} />
        <NumericInput label="Wobble Z" value={content.noiseAmpZ ?? 0} min={0} max={2} step={0.01}
          on:input={(e) => patch({ noiseAmpZ: e.detail })} />
        <NumericInput label="Frequency" value={content.noiseFreq ?? 4} min={0.5} max={30} step={0.1}
          on:input={(e) => patch({ noiseFreq: e.detail })} />
        <NumericInput label="Speed" value={content.noiseSpeed ?? 0.5} min={0} max={3} step={0.01}
          on:input={(e) => patch({ noiseSpeed: e.detail })} />
      </div>
    {/if}

    <!-- Light — only meaningful for depth-shift (other modes are
         flat with no surface normal). When enabled, the source is
         shaded by a movable point light using a Lambert term over
         the heightmap normal derived from luminance. -->
    {#if content.mode === 'depth-shift'}
      <div class="sec-label sub">
        Light
        <label class="toggle-inline">
          <input type="checkbox"
            checked={content.lightEnabled ?? false}
            onchange={(e) => patch({ lightEnabled: (e.target as HTMLInputElement).checked })} />
          <span>{(content.lightEnabled ?? false) ? 'on' : 'off'}</span>
        </label>
      </div>
      {#if content.lightEnabled}
        <div class="slider-col">
          <NumericInput label="Light X" value={content.lightX ?? 1} min={-2} max={2} step={0.01}
            on:input={(e) => patch({ lightX: e.detail })} />
          <NumericInput label="Light Y" value={content.lightY ?? 1} min={-2} max={2} step={0.01}
            on:input={(e) => patch({ lightY: e.detail })} />
          <NumericInput label="Light Z" value={content.lightZ ?? 1.5} min={0.05} max={4} step={0.01}
            on:input={(e) => patch({ lightZ: e.detail })} />
          <NumericInput label="Intensity" value={content.lightIntensity ?? 1.5} min={0} max={4} step={0.01}
            on:input={(e) => patch({ lightIntensity: e.detail })} />
          <NumericInput label="Ambient" value={content.lightAmbient ?? 0.25} min={0} max={1} step={0.01}
            on:input={(e) => patch({ lightAmbient: e.detail })} />
          <NumericInput label="Surface Strength" value={content.lightHeightStrength ?? 1.5} min={0} max={4} step={0.01}
            on:input={(e) => patch({ lightHeightStrength: e.detail })} />
        </div>
      {/if}
    {/if}

    <!-- Flythrough mode — endless tunnel + worm-stroke topology.
         Surfaced as a dedicated section because none of the
         flythrough knobs map to the generic 4-position `knobs[]`
         vector that the older modes use; they're named fields on
         PixelFXContent.  The layout follows the section pattern
         everywhere else in the panel (sec-label sub → slider-col). -->
    {#if content.mode === 'flythrough'}
      <div class="sec-label sub">Flythrough — Camera Motion</div>
      <div class="slider-col">
        <NumericInput label="Fly Speed"
          value={content.flythroughFlySpeed ?? 0.8}
          min={-2} max={6} step={0.05}
          on:input={(e) => patch({ flythroughFlySpeed: e.detail })} />
        <NumericInput label="Tunnel Depth"
          value={content.flythroughTunnelDepth ?? 2.0}
          min={0.5} max={6} step={0.05}
          on:input={(e) => patch({ flythroughTunnelDepth: e.detail })} />
        <NumericInput label="Slab Count"
          value={content.flythroughSlabCount ?? 4}
          min={2} max={8} step={1}
          displayValue={(v) => `${Math.round(v)} slabs`}
          on:input={(e) => patch({ flythroughSlabCount: Math.round(e.detail) })} />
      </div>

      <div class="sec-label sub">Topology</div>
      <div class="mode-grid">
        <button class="mode-btn"
          class:active={(content.flythroughTopology ?? 'strokes') === 'points'}
          onclick={() => patch({ flythroughTopology: 'points' })}>
          Points
        </button>
        <button class="mode-btn"
          class:active={(content.flythroughTopology ?? 'strokes') === 'strokes'}
          onclick={() => patch({ flythroughTopology: 'strokes' })}>
          Worm Strokes
        </button>
      </div>
      <div class="hint">
        Points = classic billboarded particles. Strokes = quads extruded along
        each particle's velocity vector — volumetric brush-stroke / worm look.
      </div>

      {#if (content.flythroughTopology ?? 'strokes') === 'strokes'}
        <div class="slider-col">
          <NumericInput label="Stroke Length"
            value={content.flythroughStrokeLength ?? 0.08}
            min={0.01} max={0.4} step={0.005}
            on:input={(e) => patch({ flythroughStrokeLength: e.detail })} />
          <NumericInput label="Stroke Width"
            value={content.flythroughStrokeWidth ?? 0.006}
            min={0.001} max={0.05} step={0.0005}
            on:input={(e) => patch({ flythroughStrokeWidth: e.detail })} />
        </div>
      {/if}

      <div class="sec-label sub">Flow & Anchor</div>
      <div class="slider-col">
        <NumericInput label="Flow Strength"
          value={content.flythroughFlowStrength ?? 0.4}
          min={0} max={2} step={0.01}
          on:input={(e) => patch({ flythroughFlowStrength: e.detail })} />
        <NumericInput label="Flow Scale"
          value={content.flythroughFlowScale ?? 2.0}
          min={0.5} max={8} step={0.05}
          on:input={(e) => patch({ flythroughFlowScale: e.detail })} />
        <NumericInput label="Anchor Pull"
          value={content.flythroughAnchorPull ?? 1.2}
          min={0} max={3} step={0.01}
          on:input={(e) => patch({ flythroughAnchorPull: e.detail })} />
        <NumericInput label="Depth Strength"
          value={content.flythroughDepthStrength ?? 0.5}
          min={0} max={1.5} step={0.01}
          on:input={(e) => patch({ flythroughDepthStrength: e.detail })} />
      </div>

      <div class="sec-label sub">Depth Source</div>
      <div class="mode-grid">
        <button class="mode-btn"
          class:active={(content.flythroughDepthSource ?? 'luminance') === 'luminance'}
          onclick={() => patch({ flythroughDepthSource: 'luminance' })}>
          Luma
        </button>
        <button class="mode-btn"
          class:active={(content.flythroughDepthSource ?? 'luminance') === 'inverse-luminance'}
          onclick={() => patch({ flythroughDepthSource: 'inverse-luminance' })}>
          Inverse Luma
        </button>
        <button class="mode-btn"
          class:active={(content.flythroughDepthSource ?? 'luminance') === 'edge-density'}
          onclick={() => patch({ flythroughDepthSource: 'edge-density' })}>
          Edges
        </button>
      </div>

      <div class="sec-label sub">
        Audio Reactive
        <label class="toggle-inline">
          <input type="checkbox"
            checked={content.flythroughAudioReactive ?? false}
            onchange={(e) => patch({ flythroughAudioReactive: (e.target as HTMLInputElement).checked })} />
          <span>{(content.flythroughAudioReactive ?? false) ? 'on' : 'off'}</span>
        </label>
      </div>
      {#if content.flythroughAudioReactive}
        <div class="hint">
          Bass modulates Fly Speed; treble modulates Flow Strength. Your configured
          values stay the no-audio baseline.
        </div>
      {/if}
    {/if}
  </div>
{:else}
  <div class="empty">Select a Pixel FX layer.</div>
{/if}

<style>
  .pfx-panel { padding: 8px 12px; color: #d4d8e0; font-size: 14px; }
  .sec-label { text-transform: uppercase; font-size: 12px; letter-spacing: 0.5px; opacity: 0.7; margin: 12px 0 6px; display: flex; align-items: center; gap: 6px; }
  .sec-label.sub { margin-top: 16px; }
  .src-section { margin-bottom: 10px; }
  .src-section-label { display: block; font-size: 12px; opacity: 0.6; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.4px; }
  .src-select { width: 100%; background: #1f2330; border: 1px solid #333a4a; color: #d4d8e0; padding: 6px 8px; border-radius: 3px; font-size: 13.5px; cursor: pointer; }
  .src-select:focus { outline: none; border-color: #67e8f9; }
  .hint.mini { margin-top: 4px; padding: 4px 6px; font-size: 12px; }
  .source-row { display: flex; gap: 6px; align-items: center; }

  /* Media library thumbnail grid */
  .media-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
    gap: 4px;
    max-height: 220px;
    overflow-y: auto;
    padding: 2px;
    background: #14171f;
    border: 1px solid #2a2f3d;
    border-radius: 4px;
  }
  .media-cell {
    position: relative;
    background: #1a1d27;
    border: 1px solid #2a2f3d;
    border-radius: 3px;
    padding: 0;
    cursor: pointer;
    overflow: hidden;
    aspect-ratio: 1;
    display: flex;
    flex-direction: column;
    transition: transform 0.06s, border-color 0.06s;
  }
  .media-cell:hover { border-color: #4a5366; transform: translateY(-1px); }
  .media-cell.active { border-color: #67e8f9; box-shadow: 0 0 0 1px rgba(103, 232, 249, 0.3); }
  .media-thumb { width: 100%; height: 100%; object-fit: cover; display: block; }
  .video-placeholder {
    background: #232838;
    color: #67e8f9;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 24px;
    width: 100%; height: 100%;
  }
  .media-cell-label {
    position: absolute;
    left: 0; right: 0; bottom: 0;
    background: linear-gradient(transparent, rgba(0,0,0,0.85));
    color: #d4d8e0;
    font-size: 11px;
    padding: 12px 4px 3px;
    text-overflow: ellipsis;
    white-space: nowrap;
    overflow: hidden;
    text-align: left;
  }
  .media-broken-badge {
    position: absolute; top: 2px; right: 2px;
    background: #c33;
    color: #fff;
    width: 14px; height: 14px;
    border-radius: 50%;
    font-size: 11px; font-weight: bold;
    display: flex; align-items: center; justify-content: center;
  }
  .src-now {
    margin-left: auto;
    font-size: 11.5px;
    font-weight: 400;
    opacity: 0.85;
    color: #67e8f9;
    background: rgba(103, 232, 249, 0.08);
    padding: 1px 6px;
    border-radius: 8px;
    text-transform: none;
    letter-spacing: 0;
    max-width: 140px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .src-now.empty { color: #6b7280; background: transparent; opacity: 0.55; }
  .src-btn { flex: 1; background: #1f2330; border: 1px solid #333a4a; color: #d4d8e0; padding: 8px 10px; border-radius: 4px; cursor: pointer; text-align: left; font-size: 14px; }
  .src-btn:hover { background: #262b3a; }
  .src-status { display: inline-block; width: 12px; opacity: 0.6; }
  .src-status.ok { color: #67e8f9; opacity: 1; }
  .mini-btn { background: transparent; border: 1px solid #333a4a; color: var(--text-secondary, #aaa); width: 26px; height: 26px; border-radius: 4px; cursor: pointer; font-size: 16px; }
  .mini-btn:hover { background: #262b3a; color: #fff; }
  .mode-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
  .mode-btn { background: #1a1d27; border: 1px solid #2a2f3d; color: #b0b6c0; padding: 6px 8px; border-radius: 3px; cursor: pointer; font-size: 13px; transition: all 0.1s; }
  .mode-btn:hover { background: #262b3a; color: #fff; }
  .mode-btn.active { background: linear-gradient(135deg, #1e3a8a 0%, #1e293b 100%); border-color: #67e8f9; color: #67e8f9; }
  .hint { margin-top: 6px; padding: 6px 8px; background: #14171f; border-left: 2px solid #67e8f9; font-size: 12.5px; color: #8a96a6; line-height: 1.4; border-radius: 0 3px 3px 0; }
  .slider-col { display: flex; flex-direction: column; gap: 8px; }
  .toggle-inline { display: inline-flex; align-items: center; gap: 4px; margin-left: auto; font-size: 12px; opacity: 0.8; cursor: pointer; }
  .toggle-inline input { accent-color: #67e8f9; }
  .reset-cam { background: #1a1d27; border: 1px solid #2a2f3d; color: #b0b6c0; padding: 5px 10px; border-radius: 3px; cursor: pointer; font-size: 13px; margin-top: 4px; }
  .reset-cam:hover { background: #262b3a; color: #fff; border-color: #4a5366; }
  .sc { display: flex; flex-direction: column; gap: 2px; }
  .sc label { font-size: 12.5px; opacity: 0.85; display: flex; justify-content: space-between; }
  .sc label b { color: #67e8f9; font-weight: 500; font-variant-numeric: tabular-nums; }
  .sc input[type="range"] { width: 100%; accent-color: #67e8f9; }
  .empty { padding: 24px; text-align: center; opacity: 0.5; font-size: 14px; }
</style>
