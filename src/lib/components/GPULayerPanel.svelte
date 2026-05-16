<script lang="ts">
  /**
   * GPULayerPanel — sidebar UI for the gpu layer type. Top section
   * is the shader picker (dropdown of every entry in
   * GPU_SHADER_CATALOG); below that, the panel renders dynamic
   * controls based on the selected shader's paramSchema.
   *
   * Adding a new shader requires no panel changes — the schema-
   * driven UI picks it up automatically.
   */
  import { onMount, onDestroy } from 'svelte';
  import { project, selectedLayer } from '../stores/layers';
  import { GPU_SHADER_CATALOG, getShaderDef } from '../renderer/gpuShaderCatalog';
  import { keyframeTimeline } from '../stores/keyframeTimeline';
  import { mediaLibrary } from '../stores/media';
  import { spoutSenders, startSpoutScanner } from '../stores/spout';
  import { isDesktopApp, getTextureShareLabel } from '../bridge';
  import type { GPULayerContent, Layer } from '../types';
  import type { MediaItem } from '../stores/media';
  import type { ParamControl } from '../renderer/gpuShaderTypes';
  import { createAssetRefFromFile } from '../storage/assetRegistry';
  import NumericInput from './NumericInput.svelte';

  // Media-source picker support (for shaders with kind: 'media-source'
  // controls, e.g. pixel-particles). Lists media library items + the
  // project's media layers as picking targets, plus a one-off file
  // upload.
  $: mediaLayers = ($project?.layers ?? []).filter(
    (l: Layer) => l.type === 'media' && l.source && (l.source.type === 'image' || l.source.type === 'video'),
  );
  $: libraryItems = ($mediaLibrary ?? []).filter(
    (m: MediaItem) => m.type === 'image' || m.type === 'video',
  );

  // Live capture sources — webcams (browser API) + Spout/Syphon senders
  // (desktop-only via the platform bridge). Webcam list is enumerated
  // once on mount; the spout list is a global store the desktop scanner
  // refreshes every few seconds.
  let cameraDevices: MediaDeviceInfo[] = [];
  $: textureShareLabel = getTextureShareLabel(); // "Spout" on Win, "Syphon" on Mac
  $: showLiveSources = isDesktopApp || cameraDevices.length > 0;

  async function enumerateCameras() {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return;
    try {
      // First call returns devices without labels until the user has
      // granted permission once. We list them anyway — picking one
      // will trigger getUserMedia in the renderer, which prompts.
      const all = await navigator.mediaDevices.enumerateDevices();
      cameraDevices = all.filter((d) => d.kind === 'videoinput');
    } catch (err) {
      console.warn('[GPULayerPanel] enumerateDevices failed:', err);
    }
  }

  onMount(() => {
    enumerateCameras();
    // Re-enumerate whenever a device is plugged/unplugged so the
    // dropdown stays in sync without a panel re-mount.
    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', enumerateCameras);
    }
    // Poke the spout scanner; it's safe to call repeatedly and only
    // does anything in desktop mode.
    startSpoutScanner();
  });

  onDestroy(() => {
    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.removeEventListener) {
      navigator.mediaDevices.removeEventListener('devicechange', enumerateCameras);
    }
  });

  let fileInput: HTMLInputElement;
  function pickMediaSource(key: string, mediaItem: MediaItem) {
    setParam(key, { type: 'media', mediaId: mediaItem.id });
  }
  function pickLayerSource(key: string, layerId: string) {
    setParam(key, layerId ? { type: 'layer', layerId } : null);
  }
  function pickCameraSource(key: string, deviceId: string) {
    setParam(key, { type: 'camera', deviceId });
  }
  function pickSpoutSource(key: string, senderName: string) {
    setParam(key, { type: 'spout', senderName });
  }
  function clearSource(key: string) { setParam(key, null); }
  let _fileSourceKey: string = '';
  function openFilePicker(key: string) {
    _fileSourceKey = key;
    fileInput?.click();
  }
  function onFileSelected(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !_fileSourceKey) return;
    // Capture an AssetRef so save/reload restores the source. Without it the
    // blob URL dies on session end and this GPU layer comes back with a dead src.
    const { assetRef, runtimeUrl: url } = createAssetRefFromFile(file);
    // Stash the original filename on the source object. Blob URLs
    // drop the extension (they look like `blob:http://.../uuid`), so
    // the runner relies on this field to detect .ply / .splat files
    // and route them to the point-cloud parser instead of trying to
    // decode the bytes as an image.
    setParam(_fileSourceKey, { type: 'file', url, mime: file.type, name: file.name, assetRef });
    input.value = '';
    _fileSourceKey = '';
  }
  function sourceLabel(src: any): string {
    if (!src) return 'no source';
    if (src.type === 'media') {
      const item = libraryItems.find((m: MediaItem) => m.id === src.mediaId);
      return item ? `media · ${item.name}` : 'media · ?';
    }
    if (src.type === 'layer') {
      const ml = mediaLayers.find((l) => l.id === src.layerId);
      return ml ? `layer · ${ml.name}` : 'layer · ?';
    }
    if (src.type === 'file') return 'file';
    if (src.type === 'camera') {
      const cam = cameraDevices.find((d) => d.deviceId === src.deviceId);
      return `camera · ${cam?.label || 'default'}`;
    }
    if (src.type === 'spout') return `${textureShareLabel.toLowerCase()} · ${src.senderName || '?'}`;
    return 'unknown';
  }

  $: layer = $selectedLayer;
  $: content = (layer && layer.type === 'gpu' ? layer.gpuLayerContent : null) as GPULayerContent | null;
  $: layerId = layer?.id ?? null;
  $: shaderDef = content ? getShaderDef(content.shaderId) : null;

  // Helper: a param is visible if it has no `showWhen`, OR every
  // key in `showWhen` matches the current params value. Lets shaders
  // hide mode-specific controls when they don't apply.
  function isParamVisible(p: ParamControl): boolean {
    const sw = (p as any).showWhen;
    if (!sw) return true;
    if (!content) return true;
    for (const [key, expected] of Object.entries(sw)) {
      const actual = content.params[key] ?? (shaderDef as any)?.defaultParams?.[key];
      if (actual !== expected) return false;
    }
    return true;
  }

  // Group VISIBLE params by their `group` property. Empty groups
  // (everything filtered) are dropped so the panel doesn't show
  // bare section headings with nothing underneath.
  $: groupedParams = (() => {
    if (!shaderDef) return [];
    const groups = new Map<string, ParamControl[]>();
    for (const p of shaderDef.paramSchema) {
      if (!isParamVisible(p)) continue;
      const g = p.group ?? '';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(p);
    }
    return Array.from(groups.entries());
  })();

  /** Read a param value, falling back to the schema default if the
   *  user hasn't edited it yet. */
  function paramValue(p: ParamControl): any {
    if (!content) return (p as any).default;
    const v = content.params[p.key];
    return v !== undefined ? v : (p as any).default;
  }

  function setShader(id: string) {
    if (!layerId || !content || content.shaderId === id) return;
    const def = getShaderDef(id);
    if (!def) return;
    // Switching shader USED to wipe params to defaults — meant the source
    // picker selection (and every slider) was lost the moment the user
    // clicked another shader. Now we stash the outgoing shader's params
    // under `paramsByShader[oldId]` and restore them on return.
    //
    // Active `params` always mirrors the current shader's slot so the
    // rest of the codebase (GPU runner, modulation, keyframes) sees the
    // same shape it always has.
    const prevId = content.shaderId;
    const prevParams = { ...content.params };
    const stash: Record<string, Record<string, any>> = { ...(content.paramsByShader || {}) };
    if (prevId) stash[prevId] = prevParams;
    const restored = stash[id];
    const nextParams = restored
      ? { ...def.defaultParams, ...restored }
      : { ...def.defaultParams };
    project.updateGPULayerContent(layerId, {
      shaderId: id,
      params: nextParams,
      paramsByShader: stash,
    } as any);
  }

  function setParam(key: string, value: any) {
    if (!layerId) return;
    project.updateGPULayerParams(layerId, { [key]: value });
    // Hand the same change to the keyframe timeline. autoRecord
    // is a no-op when the user hasn't armed the track; when they
    // have, every drag becomes a keyframe at the current playhead.
    // Track key uses the `gpu:` prefix so Canvas's keyframe
    // override loop knows to write back into gpuLayerContent.params.
    if (typeof value === 'number' || typeof value === 'boolean') {
      const label = `gpu:${key}`;
      keyframeTimeline.autoRecord(layerId, label, value, label, typeof value === 'boolean' ? 'boolean' : 'number');
    }
  }
</script>

{#if content && layerId && shaderDef}
  <div class="gpu-panel">
    <div class="sec-label">
      Shader
      <span class="active-name">{shaderDef.label}</span>
    </div>

    <!-- Shader picker — every entry in the catalog, grouped by category. -->
    <div class="shader-grid">
      {#each GPU_SHADER_CATALOG as s}
        <button class="shader-btn" class:active={content.shaderId === s.id} onclick={() => setShader(s.id)}>
          <div class="shader-btn-label">{s.label}</div>
          <div class="shader-btn-cat">{s.category}</div>
        </button>
      {/each}
    </div>

    {#if shaderDef.description}
      <div class="hint">{shaderDef.description}</div>
    {/if}

    <!-- Dynamic per-shader params, grouped. -->
    {#each groupedParams as [groupName, params]}
      {#if groupName}
        <div class="sec-label sub">{groupName}</div>
      {/if}
      <div class="slider-col">
        {#each params as p}
          {#if p.kind === 'slider'}
            <NumericInput
              label={p.label}
              value={paramValue(p)}
              min={p.min}
              max={p.max}
              step={p.step}
              on:input={(e) => setParam(p.key, e.detail)}
            />
          {:else if p.kind === 'angle'}
            <NumericInput
              label={p.label}
              value={paramValue(p)}
              min={-180}
              max={360}
              step={0.5}
              displayValue={(v) => `${v.toFixed(1)}°`}
              on:input={(e) => setParam(p.key, e.detail)}
            />
          {:else if p.kind === 'toggle'}
            <label class="toggle-row">
              <input type="checkbox" checked={paramValue(p)}
                onchange={(e) => setParam(p.key, (e.target as HTMLInputElement).checked)} />
              {p.label}
            </label>
          {:else if p.kind === 'select'}
            <div class="select-row">
              <label>{p.label}</label>
              <select value={paramValue(p)}
                onchange={(e) => setParam(p.key, (e.target as HTMLSelectElement).value)}>
                {#each p.options as opt}
                  <option value={opt.value}>{opt.label}</option>
                {/each}
              </select>
            </div>
          {:else if p.kind === 'media-source'}
            <!-- Media-source picker: thumbnail grid of media library
                 items + dropdown of media layers + one-off file
                 upload + live capture. The picked source is stored as
                 { type, mediaId | layerId | url | deviceId | senderName }.
                 The shader can restrict which sub-pickers appear via
                 the `sources` array on the schema entry — e.g. Point
                 Cloud FX sets `sources: ['file']` because PLY/.splat
                 only meaningfully arrive via file upload. -->
            {@const _src = paramValue(p)}
            {@const _allowed = (p as any).sources as ('media' | 'layer' | 'file' | 'live')[] | undefined}
            {@const _showMedia = !_allowed || _allowed.includes('media')}
            {@const _showLayer = !_allowed || _allowed.includes('layer')}
            {@const _showFile  = !_allowed || _allowed.includes('file')}
            {@const _showLive  = (!_allowed || _allowed.includes('live')) && showLiveSources}
            {@const _accept    = (p as any).accept as string | undefined}
            <div class="src-active">
              <span class="src-active-label">{p.label}</span>
              <span class="src-now" class:empty={!_src}>{sourceLabel(_src)}</span>
              {#if _src}
                <button class="mini-x" title="Clear" onclick={() => clearSource(p.key)}>×</button>
              {/if}
            </div>
            {#if _showMedia}
              {#if libraryItems.length > 0}
                <div class="media-grid">
                  {#each libraryItems as item}
                    <button class="media-cell"
                      class:active={_src && _src.type === 'media' && _src.mediaId === item.id}
                      title={item.name}
                      onclick={() => pickMediaSource(p.key, item)}>
                      {#if item.thumbnail}
                        <img src={item.thumbnail} alt={item.name} class="media-thumb" />
                      {:else if item.type === 'image'}
                        <img src={item.src} alt={item.name} class="media-thumb" />
                      {:else}
                        <div class="media-thumb video-placeholder">▶</div>
                      {/if}
                      <span class="media-cell-label">{item.name}</span>
                    </button>
                  {/each}
                </div>
              {:else}
                <div class="hint mini">No media in library — drop files on the Media Tray, or use the file upload below.</div>
              {/if}
            {/if}
            {#if _showLayer && mediaLayers.length > 0}
              <select class="src-select"
                value={_src && _src.type === 'layer' ? _src.layerId : ''}
                onchange={(e) => pickLayerSource(p.key, (e.target as HTMLSelectElement).value)}>
                <option value="">— pick a media layer —</option>
                {#each mediaLayers as ml}
                  <option value={ml.id}>{ml.name} ({ml.source?.type})</option>
                {/each}
              </select>
            {/if}
            {#if _showFile}
              <button class="mini-action wide" onclick={() => openFilePicker(p.key)}>
                {_accept ? `Pick file (${_accept})…` : 'Upload one-off file…'}
              </button>
            {/if}

            <!-- Live capture sources: webcam + Spout/Syphon. Hidden if
                 nothing is available (web build with no camera) OR if
                 the shader excluded `live` from its `sources` filter. -->
            {#if _showLive}
              <div class="live-sources">
                <div class="live-label">Live capture</div>
                {#if cameraDevices.length > 0}
                  <select class="src-select"
                    value={_src && _src.type === 'camera' ? (_src.deviceId || '') : ''}
                    onchange={(e) => {
                      const v = (e.target as HTMLSelectElement).value;
                      if (v === '') { clearSource(p.key); return; }
                      pickCameraSource(p.key, v === '__default__' ? '' : v);
                    }}>
                    <option value="">— pick a camera —</option>
                    <option value="__default__">Default camera</option>
                    {#each cameraDevices as cam, i}
                      <option value={cam.deviceId}>{cam.label || `Camera ${i + 1}`}</option>
                    {/each}
                  </select>
                {:else}
                  <button class="mini-action wide" onclick={enumerateCameras}>
                    Detect cameras…
                  </button>
                {/if}

                {#if isDesktopApp}
                  {#if $spoutSenders.length > 0}
                    <select class="src-select"
                      value={_src && _src.type === 'spout' ? (_src.senderName || '') : ''}
                      onchange={(e) => {
                        const v = (e.target as HTMLSelectElement).value;
                        if (v === '') { clearSource(p.key); return; }
                        pickSpoutSource(p.key, v);
                      }}>
                      <option value="">— pick a {textureShareLabel} sender —</option>
                      {#each $spoutSenders as sender}
                        <option value={sender}>{sender}</option>
                      {/each}
                    </select>
                  {:else}
                    <div class="hint mini">No active {textureShareLabel} senders. Start a sender from another app (Resolume, OBS plugin, TouchDesigner, etc.) and it'll appear here.</div>
                  {/if}
                {/if}
              </div>
            {/if}
          {:else if p.kind === 'color'}
            <!-- Color picker — shows the current color as a swatch
                 next to the label, click to open the native color
                 picker. Stored as [r, g, b] integers 0-255 to match
                 the convention used by other panels (light painting). -->
            {@const _c = paramValue(p) ?? [255, 255, 255]}
            {@const _hex = '#' + (_c as number[]).map((v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}
            <div class="color-row">
              <label>{p.label}</label>
              <input type="color" value={_hex}
                onchange={(e) => {
                  const h = (e.target as HTMLInputElement).value;
                  setParam(p.key, [
                    parseInt(h.slice(1, 3), 16),
                    parseInt(h.slice(3, 5), 16),
                    parseInt(h.slice(5, 7), 16),
                  ]);
                }} />
            </div>
          {/if}
        {/each}
      </div>
    {/each}
  </div>
  <!-- accept includes .ply / .splat for the Point Cloud FX shader.
       The runner detects those extensions in the URL and routes to
       the dedicated ArrayBuffer parser instead of trying to decode
       as a 2D image / video. The browser sniffs mime as
       application/octet-stream for those formats so we have to list
       extensions explicitly. -->
  <input type="file" bind:this={fileInput} accept="image/*,video/*,.ply,.splat" onchange={onFileSelected} style="display:none" />
{:else}
  <div class="empty">Select a GPU layer.</div>
{/if}

<style>
  .gpu-panel { padding: 8px 12px; color: #d4d8e0; font-size: 12px; }
  .sec-label { text-transform: uppercase; font-size: 10px; letter-spacing: 0.5px; opacity: 0.7; margin: 12px 0 6px; display: flex; align-items: center; gap: 6px; }
  .sec-label.sub { margin-top: 14px; }
  .active-name { margin-left: auto; font-size: 10.5px; color: #67e8f9; opacity: 0.95; text-transform: none; letter-spacing: 0; }
  .shader-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }
  .shader-btn {
    background: #1a1d27;
    border: 1px solid #2a2f3d;
    color: #b0b6c0;
    padding: 8px 10px;
    border-radius: 4px;
    cursor: pointer;
    text-align: left;
    transition: all 0.08s;
  }
  .shader-btn:hover { background: #262b3a; color: #fff; border-color: #4a5366; }
  .shader-btn.active { background: linear-gradient(135deg, #1e3a8a 0%, #1e293b 100%); border-color: #67e8f9; color: #67e8f9; }
  .shader-btn-label { font-size: 12px; font-weight: 500; }
  .shader-btn-cat { font-size: 9.5px; opacity: 0.7; margin-top: 2px; }
  .hint { margin-top: 8px; padding: 6px 8px; background: #14171f; border-left: 2px solid #67e8f9; font-size: 10.5px; color: #8a96a6; line-height: 1.4; border-radius: 0 3px 3px 0; }
  .slider-col { display: flex; flex-direction: column; gap: 8px; }
  .toggle-row { display: flex; align-items: center; gap: 6px; font-size: 11px; cursor: pointer; }
  .toggle-row input { accent-color: #67e8f9; }
  .select-row { display: flex; flex-direction: column; gap: 3px; }
  .select-row label { font-size: 10.5px; opacity: 0.85; }
  .select-row select {
    background: #1f2330; border: 1px solid #333a4a; color: #d4d8e0;
    padding: 6px 8px; border-radius: 3px; font-size: 11.5px; cursor: pointer;
  }
  .select-row select:focus { outline: none; border-color: #67e8f9; }
  .color-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .color-row label { font-size: 10.5px; opacity: 0.85; }
  .color-row input[type="color"] {
    width: 36px; height: 22px; padding: 0; border: 1px solid #333a4a; border-radius: 3px; cursor: pointer; background: transparent;
  }
  /* Media-source picker */
  .src-active { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
  .src-active-label { font-size: 10.5px; opacity: 0.85; }
  .src-now { margin-left: auto; font-size: 9.5px; color: #67e8f9; background: rgba(103, 232, 249, 0.08); padding: 1px 6px; border-radius: 8px; max-width: 140px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .src-now.empty { color: #6b7280; background: transparent; opacity: 0.55; }
  .mini-x { background: transparent; border: 1px solid #333a4a; color: #aaa; width: 22px; height: 22px; border-radius: 3px; cursor: pointer; font-size: 13px; }
  .mini-x:hover { background: #262b3a; color: #fff; }
  .src-select { width: 100%; background: #1f2330; border: 1px solid #333a4a; color: #d4d8e0; padding: 5px 8px; border-radius: 3px; font-size: 11px; cursor: pointer; margin-top: 6px; }
  .live-sources { margin-top: 10px; padding-top: 8px; border-top: 1px dashed #2a2f3d; display: flex; flex-direction: column; gap: 0; }
  .live-label { font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.5px; color: #8a96a6; opacity: 0.8; margin-bottom: 4px; }
  .mini-action.wide { width: 100%; background: #1a1d27; border: 1px solid #2a2f3d; color: #b0b6c0; padding: 6px 10px; border-radius: 3px; cursor: pointer; font-size: 11px; margin-top: 6px; }
  .mini-action.wide:hover { background: #262b3a; color: #fff; border-color: #4a5366; }
  .hint.mini { padding: 5px 8px; font-size: 10px; }
  .media-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(64px, 1fr)); gap: 4px; max-height: 200px; overflow-y: auto; padding: 2px; background: #14171f; border: 1px solid #2a2f3d; border-radius: 4px; }
  .media-cell { position: relative; background: #1a1d27; border: 1px solid #2a2f3d; border-radius: 3px; padding: 0; cursor: pointer; overflow: hidden; aspect-ratio: 1; display: flex; flex-direction: column; }
  .media-cell:hover { border-color: #4a5366; }
  .media-cell.active { border-color: #67e8f9; box-shadow: 0 0 0 1px rgba(103, 232, 249, 0.3); }
  .media-thumb { width: 100%; height: 100%; object-fit: cover; display: block; }
  .video-placeholder { background: #232838; color: #67e8f9; display: flex; align-items: center; justify-content: center; font-size: 18px; width: 100%; height: 100%; }
  .media-cell-label { position: absolute; left: 0; right: 0; bottom: 0; background: linear-gradient(transparent, rgba(0,0,0,0.85)); color: #d4d8e0; font-size: 9px; padding: 10px 4px 3px; text-overflow: ellipsis; white-space: nowrap; overflow: hidden; text-align: left; }
  .empty { padding: 24px; text-align: center; opacity: 0.5; font-size: 12px; }
</style>
