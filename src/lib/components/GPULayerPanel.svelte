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
  import { project, selectedLayer, layers, scheduleHistorySnapshot, recordDiscreteAction } from '../stores/layers';
  import { NATIVE_ENGINE_ONLY, settings } from '../stores/settings';
  import EffectParamRow from './EffectParamRow.svelte';
  import { clearGPUParamRanges } from '../audio/modulation';
  import {
    GPU_SHADER_CATALOG,
    NATIVE_READY_GPU_SHADER_CATALOG,
    PICKER_GPU_SHADER_CATALOG,
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
  import { carryGpuShaderInput, gpuLayerAwaitingInput } from '../renderer/gpuShaderInput';
  import { cameraLiveSourceError, listNativeCameras } from '../renderer/cameraLiveSource';
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
    /*
     * Native mode lists the capture addon's cameras, not the browser's. The
     * two id spaces do not interchange: handing a navigator.mediaDevices
     * deviceId to native_live_capture_start_camera matches no device, and the
     * layer sits blank with no error to explain it.
     */
    if (nativeSourceInventoryLocked) {
      cameraDevices = (await listNativeCameras())
        .map((device) => ({ deviceId: device.id, label: device.name }) as MediaDeviceInfo);
      return;
    }
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
    void enumerateCameras();
    cameraErrorPoll = setInterval(() => {
      const src = content?.params?.source as any;
      cameraError = src?.type === 'camera' ? cameraLiveSourceError(String(src.deviceId ?? '')) : null;
    }, 700);
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
    if (cameraErrorPoll) {
      clearInterval(cameraErrorPoll);
      cameraErrorPoll = null;
    }
    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.removeEventListener) {
      navigator.mediaDevices.removeEventListener('devicechange', enumerateCameras);
    }
  });

  let fileInput: HTMLInputElement;
  type SourceKind = 'media' | 'layer' | 'file' | 'camera' | 'spout';

  /*
   * Which sub-picker is showing. Remembered per param key so choosing "Camera"
   * and finding no camera picked yet does not snap the dropdown back to
   * whatever the stored source was.
   */
  let sourceKindChoice: Record<string, SourceKind> = {};

  /* `chosen` is passed in rather than read from sourceKindChoice inside here:
     the template's {@const} only re-evaluates when something it references
     changes, and it cannot see a store read that happens inside a function
     body. Reading it here left the dropdown switching while the picker below
     it never followed. */
  function sourceKindFor(
    chosen: SourceKind | undefined,
    src: any,
    offered: Record<SourceKind, boolean>,
  ): SourceKind {
    if (chosen && offered[chosen]) return chosen;
    // No explicit choice: follow the bound source, so re-opening the panel
    // lands on the picker that produced what is playing.
    const bound = String(src?.type ?? '') as SourceKind;
    if (bound && offered[bound]) return bound;
    return (['media', 'layer', 'file', 'camera', 'spout'] as SourceKind[])
      .find((kind) => offered[kind]) ?? 'file';
  }

  function setSourceKind(key: string, kind: string) {
    sourceKindChoice = { ...sourceKindChoice, [key]: kind as SourceKind };
    /* Enumerate on demand. The mount-time call can run before the panel knows
       whether it is in native mode, and the two id spaces come from different
       APIs -- so a list gathered too early is either empty or the wrong one. */
    if (kind === 'camera') void enumerateCameras();
    // Switching kind does NOT clear the bound source. Opening the dropdown to
    // look at what else is available should not black out the layer.
  }

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
      if (cam?.label) return `camera · ${cam.label}`;
      // Falling back to "default" was a lie whenever the list had not loaded
      // yet: a named device would read as the default camera.
      return src.deviceId ? 'camera · (device not listed)' : 'camera · default';
    }
    if (src.type === 'spout') return `${textureShareLabel.toLowerCase()} · ${src.senderName || '?'}`;
    return 'unknown';
  }

  const NATIVE_CAMERA_SOURCE_SHADERS = new Set(['flythrough', 'pixel-particles']);

  $: layer = $selectedLayer;
  $: content = (layer && layer.type === 'gpu' ? layer.gpuLayerContent : null) as GPULayerContent | null;
  $: layerId = layer?.id ?? null;
  $: shaderDef = content ? getShaderDef(content.shaderId) : null;
  $: nativeOutputCoreEnabled = !!$settings.experimental?.outputNativeCore;
  $: nativeSourceInventoryLocked = NATIVE_ENGINE_ONLY && nativeOutputCoreEnabled;
  // Both surfaces exclude archived shaders; an archived id already saved in
  // a project still loads and renders, it just isn't offered for NEW picks.
  $: shaderPickerCatalog = nativeOutputCoreEnabled ? NATIVE_READY_GPU_SHADER_CATALOG : PICKER_GPU_SHADER_CATALOG;
  $: currentShaderNativeReady = !nativeOutputCoreEnabled || !content || isNativeReadyGpuShaderId(content.shaderId);
  // This shader builds its picture from an input and none is picked yet:
  // it draws nothing, so the panel asks for one.
  $: awaitingInput = !!content && gpuLayerAwaitingInput(content.shaderId, content.params);
  /*
   * Native mode hides the live-capture pickers because most of them have no
   * native ingest. Flythrough and Pixel Particles now do -- the sync opens the
   * camera and pushes frames as a source frame -- so the camera picker is
   * offered for those two. Spout/Syphon stays hidden: still no graph input.
   */
  // Re-enumerate when the answer to "which API lists the cameras" changes.
  /*
   * The camera start failure -- a denied OS permission, most often -- is only
   * known to the sync, which learns it a frame or two after the user picks.
   * Polled rather than pushed so the panel can say what went wrong: without
   * this the layer just stays black and the picker looks like it worked.
   */
  let cameraError: string | null = null;
  let cameraErrorPoll: ReturnType<typeof setInterval> | null = null;

  let lastCameraInventoryMode: boolean | null = null;
  $: if (nativeSourceInventoryLocked !== lastCameraInventoryMode) {
    lastCameraInventoryMode = nativeSourceInventoryLocked;
    void enumerateCameras();
  }

  $: cameraIngestReady =
    !nativeSourceInventoryLocked ||
    NATIVE_CAMERA_SOURCE_SHADERS.has(String(content?.shaderId ?? '').trim().toLowerCase());

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
    // The picked input comes along to another input-driven shader.
    const nextParams = carryGpuShaderInput(prevId, prevParams, id, restored
      ? { ...def.defaultParams, ...restored }
      : { ...def.defaultParams }, def);
    project.updateGPULayerContent(layerId, {
      shaderId: id,
      params: nextParams,
      paramsByShader: stash,
    } as any);
    recordDiscreteAction();
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
    scheduleHistorySnapshot(`gpu:${layerId}:bgOpacity`);
  }

  function setParam(key: string, value: any) {
    if (!layerId) return;
    project.updateGPULayerParams(layerId, { [key]: value });
    // Debounced, not hooked in the store: updateGPULayerParams is also
    // called continuously by the audio-reactive modulation engine
    // (src/lib/audio/autoEngine.ts, src/lib/audio/modulation.ts), so
    // recording has to happen here — at the UI call site — or the
    // debounce would never quiet down while modulation is active.
    scheduleHistorySnapshot(`gpu-param:${layerId}:${key}`);
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
  <div data-help-page="gpu-instruments" class="gpu-panel">
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
          label="Background opacity"
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
            {@const _showMedia = (!_allowed || _allowed.includes('media')) && libraryItems.length > 0}
            {@const _showLayer = (!_allowed || _allowed.includes('layer')) && mediaLayers.length > 0}
            {@const _showFile  = !_allowed || _allowed.includes('file')}
            {@const _showLive  = (!_allowed || _allowed.includes('live')) && showLiveSources && cameraIngestReady}
            {@const _showShare = (!_allowed || _allowed.includes('live')) && !nativeSourceInventoryLocked
                                  && isDesktopApp && $spoutSenders.length > 0}
            {@const _accept    = (p as any).accept as string | undefined}
            {@const _awaiting = !_src && awaitingInput}
            {@const _kind = sourceKindFor(sourceKindChoice[p.key], _src, { media: _showMedia, layer: _showLayer, file: _showFile, camera: _showLive, spout: _showShare })}
            <div class="src-active">
              <span class="src-active-label">{p.label}</span>
              <span class="src-now" class:empty={!_src && !_awaiting} class:awaiting={_awaiting}>
                {_awaiting ? 'Select an input' : sourceLabel(_src)}
              </span>
              {#if _src}
                <button class="mini-x" title="Clear" onclick={() => clearSource(p.key)}>×</button>
              {/if}
            </div>
            {#if _awaiting}
              <div class="src-awaiting-hint">This shader builds its picture from an image, video or live feed. Pick one below to start.</div>
            {/if}

            <!-- One dropdown chooses WHERE the pixels come from, and only that
                 picker follows. The sub-pickers used to all be on screen at
                 once, so a file button and a camera list sat in separate places
                 with no indication they were alternatives for the same slot. -->
            <select class="src-select" value={_kind}
              onchange={(e) => setSourceKind(p.key, (e.target as HTMLSelectElement).value)}>
              {#if _showMedia}<option value="media">Media library</option>{/if}
              {#if _showLayer}<option value="layer">Another layer</option>{/if}
              {#if _showFile}<option value="file">File</option>{/if}
              {#if _showLive}<option value="camera">Camera</option>{/if}
              {#if _showShare}<option value="spout">{textureShareLabel}</option>{/if}
            </select>

            {#if _kind === 'media' && _showMedia}
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
                    <span class="media-cell-label">{item.name}</span>
                  </button>
                {/each}
              </div>
            {:else if _kind === 'layer' && _showLayer}
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
            {:else if _kind === 'file' && _showFile}
              <button class="mini-action wide" onclick={() => openFilePicker(p.key)}>
                {_accept ? `Pick file (${_accept})…` : 'Upload one-off file…'}
              </button>
            {:else if _kind === 'camera' && _showLive}
              {#if cameraDevices.length > 0}
                <select class="src-select"
                  value={_src && _src.type === 'camera' ? (_src.deviceId || '') : ''}
                  onchange={(e) => {
                    const v = (e.target as HTMLSelectElement).value;
                    if (v === '') { clearSource(p.key); return; }
                    pickCameraSource(p.key, v === '__default__' ? '' : v);
                  }}>
                  <option value="">— pick a camera —</option>
                  {#if !nativeSourceInventoryLocked}
                    <!-- The capture addon opens a named device; it has no
                         "let the OS pick" mode, so offering one here would
                         start a session against a device id of ''. -->
                    <option value="__default__">Default camera</option>
                  {/if}
                  {#each cameraDevices as cam, i}
                    <option value={cam.deviceId}>{cam.label || `Camera ${i + 1}`}</option>
                  {/each}
                </select>
              {:else}
                <button class="mini-action wide" onclick={enumerateCameras}>
                  Detect cameras…
                </button>
              {/if}
              {#if cameraError}
                <div class="src-error">{cameraError}</div>
              {/if}
            {:else if _kind === 'spout' && _showShare}
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
  <input data-help-page="gpu-instruments" type="file" bind:this={fileInput} accept="image/*,video/*,.ply,.splat" onchange={onFileSelected} style="display:none" />
{:else}
  <div data-help-page="gpu-instruments" class="empty">Select a GPU layer.</div>
{/if}

<style>
  .gpu-panel { padding: 12px; color: var(--ga-ink-0); font-size: var(--ga-text-body); }
  /* Eyebrow section label, same as every layer editor. */
  .sec-label { text-transform: uppercase; font-size: var(--ga-text-eyebrow); font-weight: 700; letter-spacing: var(--ga-eyebrow-tracking); color: var(--ga-ink-2); margin: 16px 0 8px; display: flex; align-items: center; gap: 6px; }
  .gpu-panel > .sec-label:first-child { margin-top: 0; }
  .sec-label.sub { margin-top: 16px; }
  .active-name { margin-left: auto; font-size: var(--ga-text-control); font-weight: var(--ga-weight-control); color: var(--ga-ink-0); text-transform: none; letter-spacing: 0; }
  .shader-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
  .shader-btn {
    background: var(--ga-card);
    border: 1px solid var(--ga-line-2);
    color: var(--ga-ink-1);
    padding: 6px 8px;
    border-radius: var(--ga-r-hard);
    cursor: pointer;
    text-align: left;
    transition: border-color 0.08s, color 0.08s, background 0.08s;
  }
  .shader-btn:hover { color: var(--ga-ink-0); border-color: var(--ga-line-3); }
  .shader-btn.active { background: var(--ga-selection-bg); border-color: var(--ga-selection-line); color: var(--ga-selection-ink); }
  .shader-btn-label { font-size: var(--ga-text-control); font-weight: var(--ga-weight-control); }
  .shader-btn-cat { font-size: var(--ga-text-meta); color: var(--ga-ink-2); margin-top: 1px; }
  .shader-btn.active .shader-btn-cat { color: inherit; opacity: 0.75; }
  .slider-col { display: flex; flex-direction: column; gap: 8px; }
  .toggle-row { display: flex; align-items: center; gap: 8px; min-height: var(--ga-control-h-sm); font-size: var(--ga-text-control); color: var(--ga-ink-1); cursor: pointer; }
  .toggle-row input { accent-color: var(--ga-selection-line); }
  .select-row { display: flex; flex-direction: column; gap: 4px; }
  .select-row label { font-size: var(--ga-text-control); color: var(--ga-ink-1); }
  .select-row select {
    height: var(--ga-control-h); background: var(--ga-slot); border: 1px solid var(--ga-line-2); color: var(--ga-ink-0);
    padding: 0 8px; border-radius: var(--ga-r-hard); font-size: var(--ga-text-control); cursor: pointer;
  }
  .select-row select:focus { outline: none; border-color: var(--ga-focus); }
  .color-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: var(--ga-control-h); }
  .color-row label { font-size: var(--ga-text-control); color: var(--ga-ink-1); }
  .color-row input[type="color"] {
    width: 36px; height: var(--ga-control-h-sm); padding: 0; border: 1px solid var(--ga-line-2); border-radius: var(--ga-r-hard); cursor: pointer; background: transparent;
  }
  /* Media-source picker */
  .src-active { display: flex; align-items: center; gap: 6px; min-height: var(--ga-control-h-sm); margin-bottom: 6px; }
  .src-active-label { font-size: var(--ga-text-control); color: var(--ga-ink-1); }
  .src-now { margin-left: auto; font-size: var(--ga-text-meta); color: var(--ga-ink-0); background: var(--ga-sub); border: 1px solid var(--ga-line-2); padding: 1px 6px; border-radius: var(--ga-r-hard); max-width: 140px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .src-now.empty { color: var(--ga-ink-2); background: transparent; border-color: transparent; }
  .src-now.awaiting { color: #fbbf24; background: rgba(251, 191, 36, 0.10); border-color: rgba(251, 191, 36, 0.28); }
  .src-error {
    margin-top: 6px;
    padding: 6px 8px;
    font-size: var(--ga-text-meta);
    line-height: 1.35;
    color: #ffb4a8;
    background: rgba(255, 80, 60, 0.08);
    border: 1px solid rgba(255, 80, 60, 0.28);
    border-radius: var(--ga-r-hard);
  }

  .src-awaiting-hint { font-size: var(--ga-text-meta); line-height: 1.35; color: #d1a54a; margin: -2px 0 8px; }
  .mini-x { background: transparent; border: 1px solid var(--ga-line-2); color: var(--ga-ink-2); width: var(--ga-control-h-sm); height: var(--ga-control-h-sm); border-radius: var(--ga-r-hard); cursor: pointer; font-size: 14px; }
  .mini-x:hover { color: var(--ga-ink-0); border-color: var(--ga-line-3); }
  .src-select { width: 100%; height: var(--ga-control-h); background: var(--ga-slot); border: 1px solid var(--ga-line-2); color: var(--ga-ink-0); padding: 0 8px; border-radius: var(--ga-r-hard); font-size: var(--ga-text-control); cursor: pointer; margin-top: 6px; }
  .src-select option:disabled { color: var(--ga-ink-3); }
  .live-sources { margin-top: 10px; padding-top: 8px; border-top: 1px dashed var(--ga-line-2); display: flex; flex-direction: column; gap: 0; }
  .live-label { font-size: var(--ga-text-eyebrow); font-weight: 700; text-transform: uppercase; letter-spacing: var(--ga-eyebrow-tracking); color: var(--ga-ink-2); margin-bottom: 4px; }
  .mini-action.wide { width: 100%; height: var(--ga-control-h); background: var(--ga-sub); border: 1px solid var(--ga-line-2); color: var(--ga-ink-1); padding: 0 10px; border-radius: var(--ga-r-hard); cursor: pointer; font-size: var(--ga-text-control); font-weight: var(--ga-weight-control); margin-top: 6px; }
  .mini-action.wide:hover { color: var(--ga-ink-0); border-color: var(--ga-line-3); }
  .media-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(64px, 1fr)); gap: 4px; max-height: 200px; overflow-y: auto; padding: 4px; margin-top: 6px; background: var(--ga-slot); border: 1px solid var(--ga-line-2); border-radius: var(--ga-r-hard); }
  .media-cell { position: relative; background: var(--ga-card); border: 1px solid var(--ga-line-1); border-radius: var(--ga-r-hard); padding: 0; cursor: pointer; overflow: hidden; aspect-ratio: 1; display: flex; flex-direction: column; }
  .media-cell:hover { border-color: var(--ga-line-3); }
  .media-cell.active { border-color: var(--ga-selection-line); box-shadow: 0 0 0 1px var(--ga-selection-line); }
  .media-cell:disabled { cursor: not-allowed; opacity: 0.48; filter: grayscale(0.55); }
  .media-cell:disabled:hover { border-color: var(--ga-line-1); }
  .media-cell.native-pending::after { content: ''; position: absolute; inset: 0; background: rgba(5, 7, 10, 0.28); pointer-events: none; }
  .native-badge {
    position: absolute;
    top: 4px;
    right: 4px;
    z-index: 1;
    border: 1px solid var(--ga-line-3);
    background: rgba(10, 9, 8, 0.88);
    color: var(--ga-ink-1);
    border-radius: var(--ga-r-hard);
    font-size: var(--ga-text-micro);
    font-weight: 700;
    line-height: 1;
    padding: 3px 4px;
    text-transform: uppercase;
    letter-spacing: var(--ga-eyebrow-tracking);
  }
  .media-thumb { width: 100%; height: 100%; object-fit: cover; display: block; }
  .video-placeholder { background: var(--ga-card); color: var(--ga-ink-2); display: flex; align-items: center; justify-content: center; font-size: 20px; width: 100%; height: 100%; }
  .media-cell-label { position: absolute; left: 0; right: 0; bottom: 0; background: linear-gradient(transparent, rgba(0,0,0,0.85)); color: var(--ga-ink-0); font-size: var(--ga-text-eyebrow); padding: 10px 4px 3px; text-overflow: ellipsis; white-space: nowrap; overflow: hidden; text-align: left; }
  .empty { padding: 24px; text-align: center; color: var(--ga-ink-2); font-size: var(--ga-text-body); }
</style>
