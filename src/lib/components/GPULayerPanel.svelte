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
  import { project, selectedLayer, layers } from '../stores/layers';
  import { NATIVE_ENGINE_ONLY, settings } from '../stores/settings';
  import EffectParamRow from './EffectParamRow.svelte';
  import { clearGPUParamRanges } from '../audio/modulation';
  import {
    GPU_SHADER_CATALOG,
    NATIVE_READY_GPU_SHADER_CATALOG,
    getShaderDef,
    isNativeReadyGpuShaderId,
  } from '../renderer/gpuShaderCatalog';
  import { keyframeTimeline } from '../stores/keyframeTimeline';
  import { mediaLibrary } from '../stores/media';
  import { spoutSenders, startSpoutScanner } from '../stores/spout';
  import { isDesktopApp, getTextureShareLabel } from '../bridge';
  import type { GPULayerContent, Layer } from '../types';
  import type { MediaItem } from '../stores/media';
  import type { ParamControl } from '../renderer/gpuShaderTypes';
  import { createAssetRefFromFile, resolveAssetRefForRuntime } from '../storage/assetRegistry';
  import NumericInput from './NumericInput.svelte';

  // Media-source picker support (for shaders with kind: 'media-source'
  // controls, e.g. pixel-particles). Lists media library items + the
  // project's media layers as picking targets, plus a one-off file
  // upload.
  $: mediaLayers = ($project?.layers ?? []).filter(
    (l: Layer) => l.type === 'media' && l.source && (l.source.type === 'image' || l.source.type === 'video'),
  );
  // Index into the project's layer list — needed by EffectParamRow so
  // the modulation engine + autoEngine can route writes to the same
  // layer that owns this panel's GPU content.
  $: layerIndex = layerId ? $layers.findIndex(l => l.id === layerId) : -1;
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
  $: nativeOutputCoreEnabled = !!$settings.experimental?.outputNativeCore;
  $: nativeSourceInventoryLocked = NATIVE_ENGINE_ONLY && nativeOutputCoreEnabled;
  $: shaderPickerCatalog = nativeOutputCoreEnabled ? NATIVE_READY_GPU_SHADER_CATALOG : GPU_SHADER_CATALOG;
  $: currentShaderNativeReady = !nativeOutputCoreEnabled || !content || isNativeReadyGpuShaderId(content.shaderId);

  function nativeReadablePickerUri(src: string | undefined | null, ref: any): string {
    return resolveAssetRefForRuntime(ref, undefined, String(src ?? '')) ?? String(src ?? '');
  }

  function isNativeLocalMediaUri(uri: string | undefined | null): boolean {
    const value = String(uri ?? '').trim();
    if (!value) return false;
    if (/^(blob:|data:|https?:)/i.test(value)) return false;
    if (/^(ghost-asset:\/\/|file:\/\/)/i.test(value)) return true;
    if (value.startsWith('/')) return true;
    if (/^[A-Za-z]:[\\/]/.test(value)) return true;
    return false;
  }

  function mediaItemNativeReady(item: MediaItem): boolean {
    if (!nativeSourceInventoryLocked) return true;
    if (item.broken) return false;
    return isNativeLocalMediaUri(nativeReadablePickerUri(item.src, item._assetRef));
  }

  function mediaItemNativeReason(item: MediaItem): string {
    if (!nativeSourceInventoryLocked) return item.name;
    if (item.broken) return item.brokenReason || 'Media is marked broken.';
    return mediaItemNativeReady(item)
      ? item.name
      : 'Native mode needs a local file-backed source. Re-import this media from disk.';
  }

  function mediaLayerNativeReady(mediaLayer: Layer): boolean {
    if (!nativeSourceInventoryLocked) return true;
    const src = mediaLayer.source;
    if (!src || (src.type !== 'image' && src.type !== 'video')) return false;
    if (src.broken) return false;
    return isNativeLocalMediaUri(nativeReadablePickerUri(src.src, (src as any)._assetRef));
  }

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
    if (nativeOutputCoreEnabled && !isNativeReadyGpuShaderId(id)) return;
    const def = getShaderDef(id);
    if (!def) return;
    // The new shader will have a different set of param keys; clear
    // the modulation-engine range cache for this layer so a stale key
    // from the previous shader doesn't clamp a same-named param of the
    // new shader to the wrong span.
    if (layerIndex >= 0) clearGPUParamRanges(layerIndex);
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

  function prewarmShader(id: string) {
    if (!layerId || !content || content.shaderId === id) return;
    const fn = (window as any).__ghostPrewarmGpuShader;
    if (typeof fn === 'function') fn(layerId, id);
  }

  // Layer-level (not per-shader) — fades the dark background of the
  // shader output so the layer below shows through. Lives on
  // gpuLayerContent itself, separate from the shader's paramSchema,
  // so it persists across shader swaps.
  function setBgOpacity(value: number) {
    if (!layerId || !content) return;
    project.updateGPULayerContent(layerId, { bgOpacity: value });
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
      {#each shaderPickerCatalog as s}
        <button
          class="shader-btn"
          class:active={content.shaderId === s.id}
          onmouseenter={() => prewarmShader(s.id)}
          onfocus={() => prewarmShader(s.id)}
          ontouchstart={() => prewarmShader(s.id)}
          onclick={() => setShader(s.id)}
        >
          <div class="shader-btn-label">{s.label}</div>
          <div class="shader-btn-cat">{s.category}</div>
        </button>
      {/each}
    </div>
    {#if currentShaderNativeReady}
      <!-- Universal layer-level controls (apply to every GPU shader,
           not just the current one). Background Opacity keys out the
           shader's dark areas so the layer below shows through. -->
      <div class="sec-label sub">Layer</div>
      <div class="slider-col">
        <NumericInput
          label="Background Opacity"
          value={content.bgOpacity ?? 1.0}
          min={0}
          max={1}
          step={0.01}
          midiPath="map:gpu:__bgOpacity"
          midiLabel="GPU Background Opacity"
          on:input={(e) => setBgOpacity(e.detail)}
        />
      </div>

      <!-- Dynamic per-shader params, grouped. -->
      {#each groupedParams as [groupName, params]}
        {#if groupName}
          <div class="sec-label sub">{groupName}</div>
        {/if}
        <div class="slider-col">
          {#each params as p}
            {#if p.kind === 'slider'}
            <EffectParamRow
              label={p.label}
              value={paramValue(p)}
              min={p.min}
              max={p.max}
              step={p.step}
              layerIndex={layerIndex}
              effectId=""
              paramName={p.key}
              effectKind="gpu"
              target="mapping"
              onChange={(v) => setParam(p.key, v)}
            />
          {:else if p.kind === 'angle'}
            <EffectParamRow
              label={p.label}
              value={paramValue(p)}
              min={-180}
              max={360}
              step={0.5}
              layerIndex={layerIndex}
              effectId=""
              paramName={p.key}
              effectKind="gpu"
              target="mapping"
              displayValue={(v) => `${v.toFixed(1)}°`}
              onChange={(v) => setParam(p.key, v)}
            />
          {:else if p.kind === 'toggle'}
            <label class="toggle-row">
              <input type="checkbox" checked={paramValue(p)}
                onchange={(e) => setParam(p.key, (e.target as HTMLInputElement).checked)}
                data-midi-path={`map:gpu:${p.key}`}
                data-midi-label={p.label}
                data-midi-min={0}
                data-midi-max={1}
                data-midi-step={1}
                data-midi-mode="toggle" />
              {p.label}
            </label>
          {:else if p.kind === 'select'}
            {@const _optValues = p.options.map(o => String(o.value))}
            <div class="select-row">
              <label>{p.label}</label>
              <select value={paramValue(p)}
                onchange={(e) => setParam(p.key, (e.target as HTMLSelectElement).value)}
                data-midi-path={`map:gpu:${p.key}`}
                data-midi-label={p.label}
                data-midi-min={0}
                data-midi-max={Math.max(0, _optValues.length - 1)}
                data-midi-step={1}
                data-midi-discrete={_optValues.join(',')}>
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
                    {@const _nativeMediaReady = mediaItemNativeReady(item)}
                    <button class="media-cell"
                      class:active={_src && _src.type === 'media' && _src.mediaId === item.id}
                      class:native-pending={!_nativeMediaReady}
                      title={mediaItemNativeReason(item)}
                      disabled={!_nativeMediaReady}
                      onclick={() => _nativeMediaReady && pickMediaSource(p.key, item)}>
                      {#if item.thumbnail}
                        <img src={item.thumbnail} alt={item.name} class="media-thumb" />
                      {:else if item.type === 'image'}
                        <img src={item.src} alt={item.name} class="media-thumb" />
                      {:else}
                        <div class="media-thumb video-placeholder">▶</div>
                      {/if}
                      {#if !_nativeMediaReady}
                        <span class="native-badge">pending</span>
                      {/if}
                      <span class="media-cell-label">{item.name}</span>
                    </button>
                  {/each}
                </div>
              {/if}
            {/if}
            {#if _showLayer && mediaLayers.length > 0}
              <select class="src-select"
                value={_src && _src.type === 'layer' ? _src.layerId : ''}
                onchange={(e) => pickLayerSource(p.key, (e.target as HTMLSelectElement).value)}>
                <option value="">— pick a media layer —</option>
                {#each mediaLayers as ml}
                  {@const _nativeLayerReady = mediaLayerNativeReady(ml)}
                  <option value={ml.id} disabled={!_nativeLayerReady}>
                    {ml.name} ({ml.source?.type}){_nativeLayerReady ? '' : ' · pending native source'}
                  </option>
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
                {#if !nativeSourceInventoryLocked && cameraDevices.length > 0}
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
                {:else if !nativeSourceInventoryLocked}
                  <button class="mini-action wide" onclick={enumerateCameras}>
                    Detect cameras…
                  </button>
                {/if}

                {#if !nativeSourceInventoryLocked && isDesktopApp}
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
    {/if}
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
  .gpu-panel { padding: 8px 12px; color: #d4d8e0; font-size: 13px; }
  .sec-label { text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px; opacity: 0.7; margin: 12px 0 6px; display: flex; align-items: center; gap: 6px; }
  .sec-label.sub { margin-top: 14px; }
  .active-name { margin-left: auto; font-size: 11.5px; color: #67e8f9; opacity: 0.95; text-transform: none; letter-spacing: 0; }
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
  .shader-btn-label { font-size: 13px; font-weight: 500; }
  .shader-btn-cat { font-size: 10.5px; opacity: 0.7; margin-top: 2px; }
  .slider-col { display: flex; flex-direction: column; gap: 8px; }
  .toggle-row { display: flex; align-items: center; gap: 6px; font-size: 12px; cursor: pointer; }
  .toggle-row input { accent-color: #67e8f9; }
  .select-row { display: flex; flex-direction: column; gap: 3px; }
  .select-row label { font-size: 11.5px; opacity: 0.85; }
  .select-row select {
    background: #1f2330; border: 1px solid #333a4a; color: #d4d8e0;
    padding: 6px 8px; border-radius: 3px; font-size: 12.5px; cursor: pointer;
  }
  .select-row select:focus { outline: none; border-color: #67e8f9; }
  .color-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .color-row label { font-size: 11.5px; opacity: 0.85; }
  .color-row input[type="color"] {
    width: 36px; height: 22px; padding: 0; border: 1px solid #333a4a; border-radius: 3px; cursor: pointer; background: transparent;
  }
  /* Media-source picker */
  .src-active { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
  .src-active-label { font-size: 11.5px; opacity: 0.85; }
  .src-now { margin-left: auto; font-size: 10.5px; color: #67e8f9; background: rgba(103, 232, 249, 0.08); padding: 1px 6px; border-radius: 8px; max-width: 140px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .src-now.empty { color: #6b7280; background: transparent; opacity: 0.55; }
  .mini-x { background: transparent; border: 1px solid #333a4a; color: var(--text-secondary, #aaa); width: 22px; height: 22px; border-radius: 3px; cursor: pointer; font-size: 14px; }
  .mini-x:hover { background: #262b3a; color: #fff; }
  .src-select { width: 100%; background: #1f2330; border: 1px solid #333a4a; color: #d4d8e0; padding: 5px 8px; border-radius: 3px; font-size: 12px; cursor: pointer; margin-top: 6px; }
  .src-select option:disabled { color: #6b7280; }
  .live-sources { margin-top: 10px; padding-top: 8px; border-top: 1px dashed #2a2f3d; display: flex; flex-direction: column; gap: 0; }
  .live-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.5px; color: #8a96a6; opacity: 0.8; margin-bottom: 4px; }
  .mini-action.wide { width: 100%; background: #1a1d27; border: 1px solid #2a2f3d; color: #b0b6c0; padding: 6px 10px; border-radius: 3px; cursor: pointer; font-size: 12px; margin-top: 6px; }
  .mini-action.wide:hover { background: #262b3a; color: #fff; border-color: #4a5366; }
  .media-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(64px, 1fr)); gap: 4px; max-height: 200px; overflow-y: auto; padding: 2px; background: #14171f; border: 1px solid #2a2f3d; border-radius: 4px; }
  .media-cell { position: relative; background: #1a1d27; border: 1px solid #2a2f3d; border-radius: 3px; padding: 0; cursor: pointer; overflow: hidden; aspect-ratio: 1; display: flex; flex-direction: column; }
  .media-cell:hover { border-color: #4a5366; }
  .media-cell.active { border-color: #67e8f9; box-shadow: 0 0 0 1px rgba(103, 232, 249, 0.3); }
  .media-cell:disabled { cursor: not-allowed; opacity: 0.48; filter: grayscale(0.55); }
  .media-cell:disabled:hover { border-color: #2a2f3d; }
  .media-cell.native-pending::after { content: ''; position: absolute; inset: 0; background: rgba(5, 7, 10, 0.28); pointer-events: none; }
  .native-badge {
    position: absolute;
    top: 4px;
    right: 4px;
    z-index: 1;
    border: 1px solid rgba(167, 139, 250, 0.55);
    background: rgba(18, 14, 30, 0.88);
    color: #c4b5fd;
    border-radius: 3px;
    font-size: 9px;
    line-height: 1;
    padding: 3px 4px;
    text-transform: uppercase;
    letter-spacing: 0.25px;
  }
  .media-thumb { width: 100%; height: 100%; object-fit: cover; display: block; }
  .video-placeholder { background: #232838; color: #67e8f9; display: flex; align-items: center; justify-content: center; font-size: 19px; width: 100%; height: 100%; }
  .media-cell-label { position: absolute; left: 0; right: 0; bottom: 0; background: linear-gradient(transparent, rgba(0,0,0,0.85)); color: #d4d8e0; font-size: 10px; padding: 10px 4px 3px; text-overflow: ellipsis; white-space: nowrap; overflow: hidden; text-align: left; }
  .empty { padding: 24px; text-align: center; opacity: 0.5; font-size: 13px; }
</style>
