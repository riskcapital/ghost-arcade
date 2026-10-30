<script lang="ts">
  import { mediaLibrary } from '../stores/media';
  import { createAssetRefFromFile } from '../storage/assetRegistry';
  import { GPU_SHADER_CATALOG, getShaderDef } from '../renderer/gpuShaderCatalog';
  import { carryGpuShaderInput, gpuLayerAwaitingInput } from '../renderer/gpuShaderInput';
  import type { GPULayerContent } from '../types';
  import type { MediaItem } from '../stores/media';
  import type { ParamControl } from '../renderer/gpuShaderTypes';

  export let content: GPULayerContent;
  export let onUpdate: (updates: Partial<GPULayerContent>) => void;

  let fileInput: HTMLInputElement;
  let fileSourceKey = '';

  $: shaderDef = getShaderDef(content.shaderId) || GPU_SHADER_CATALOG[0];
  // Source-driven shader with an empty picker: it draws nothing, so the
  // panel asks for an input.
  $: awaitingInput = gpuLayerAwaitingInput(content.shaderId, content.params);
  $: libraryItems = ($mediaLibrary || []).filter(
    (item: MediaItem) => item.type === 'image' || item.type === 'video',
  );
  $: groupedParams = (() => {
    const groups = new Map<string, ParamControl[]>();
    for (const param of shaderDef?.paramSchema || []) {
      if (!isParamVisible(param)) continue;
      const group = param.group || '';
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group)!.push(param);
    }
    return Array.from(groups.entries());
  })();

  function isParamVisible(param: ParamControl): boolean {
    const showWhen = param.showWhen;
    if (!showWhen) return true;
    return Object.entries(showWhen).every(([key, expected]) => {
      const actual = content.params[key] ?? shaderDef?.defaultParams[key];
      return actual === expected;
    });
  }

  function paramValue(param: ParamControl): any {
    return content.params[param.key] ?? (param as any).default;
  }

  function setShader(shaderId: string) {
    if (shaderId === content.shaderId) return;
    const nextDef = getShaderDef(shaderId);
    if (!nextDef) return;
    const paramsByShader = { ...(content.paramsByShader || {}) };
    paramsByShader[content.shaderId] = { ...content.params };
    onUpdate({
      shaderId,
      // The picked input comes along to another input-driven shader.
      params: carryGpuShaderInput(content.shaderId, content.params, shaderId,
        { ...nextDef.defaultParams, ...(paramsByShader[shaderId] || {}) }, nextDef),
      paramsByShader,
    });
  }

  function setParam(key: string, value: any) {
    onUpdate({ params: { ...content.params, [key]: value } });
  }

  function colorHex(value: [number, number, number] | undefined): string {
    const rgb = value || [255, 255, 255];
    return `#${rgb.map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, '0')).join('')}`;
  }

  function setColor(key: string, hex: string) {
    setParam(key, [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ]);
  }

  function sourceLabel(source: any): string {
    if (!source) return 'No source';
    if (source.type === 'media') {
      return libraryItems.find((item: MediaItem) => item.id === source.mediaId)?.name || 'Media source';
    }
    if (source.type === 'file') return source.name || 'Local file';
    return 'Source';
  }

  function openFilePicker(key: string) {
    fileSourceKey = key;
    fileInput?.click();
  }

  function onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !fileSourceKey) return;
    const { assetRef, runtimeUrl } = createAssetRefFromFile(file);
    setParam(fileSourceKey, {
      type: 'file',
      url: runtimeUrl,
      mime: file.type,
      name: file.name,
      assetRef,
    });
    input.value = '';
    fileSourceKey = '';
  }
</script>

<div data-help-page="gpu-instruments" class="gpu-clip-panel">
  <div class="section-label">Shader</div>
  <div class="shader-grid">
    {#each GPU_SHADER_CATALOG as shader}
      <button
        class="shader-button"
        class:active={content.shaderId === shader.id}
        onclick={() => setShader(shader.id)}
      >
        <span>{shader.label}</span>
        <small>{shader.category}</small>
      </button>
    {/each}
  </div>

  <div class="section-label">Layer</div>
  <label class="range-row">
    <span>Background</span>
    <input type="range" min="0" max="1" step="0.01" value={content.bgOpacity ?? 1}
      oninput={(event) => onUpdate({ bgOpacity: Number((event.target as HTMLInputElement).value) })} />
    <output>{Math.round((content.bgOpacity ?? 1) * 100)}%</output>
  </label>

  {#each groupedParams as [group, params]}
    {#if group}<div class="section-label">{group}</div>{/if}
    <div class="control-group">
      {#each params as param}
        {#if param.kind === 'slider'}
          <label class="range-row">
            <span>{param.label}</span>
            <input type="range" min={param.min} max={param.max} step={param.step} value={paramValue(param)}
              oninput={(event) => setParam(param.key, Number((event.target as HTMLInputElement).value))} />
            <output>{Number(paramValue(param)).toFixed(param.step < 0.1 ? 2 : 1)}</output>
          </label>
        {:else if param.kind === 'angle'}
          <label class="range-row">
            <span>{param.label}</span>
            <input type="range" min="-180" max="360" step="0.5" value={paramValue(param)}
              oninput={(event) => setParam(param.key, Number((event.target as HTMLInputElement).value))} />
            <output>{Number(paramValue(param)).toFixed(1)}&deg;</output>
          </label>
        {:else if param.kind === 'toggle'}
          <label class="toggle-row">
            <span>{param.label}</span>
            <input type="checkbox" checked={!!paramValue(param)}
              onchange={(event) => setParam(param.key, (event.target as HTMLInputElement).checked)} />
          </label>
        {:else if param.kind === 'select'}
          <label class="select-row">
            <span>{param.label}</span>
            <select value={paramValue(param)} onchange={(event) => setParam(param.key, (event.target as HTMLSelectElement).value)}>
              {#each param.options as option}
                <option value={option.value}>{option.label}</option>
              {/each}
            </select>
          </label>
        {:else if param.kind === 'color'}
          <label class="color-row">
            <span>{param.label}</span>
            <input type="color" value={colorHex(paramValue(param))}
              oninput={(event) => setColor(param.key, (event.target as HTMLInputElement).value)} />
          </label>
        {:else if param.kind === 'media-source'}
          {@const source = paramValue(param)}
          {@const allowed = param.sources}
          {@const showMedia = !allowed || allowed.includes('media')}
          {@const showFile = !allowed || allowed.includes('file')}
          {@const awaiting = !source && awaitingInput}
          <div class="source-control">
            <div class="source-header">
              <span>{param.label}</span>
              <em class:awaiting>{awaiting ? 'Select an input' : sourceLabel(source)}</em>
              {#if source}<button title="Clear source" onclick={() => setParam(param.key, null)}>×</button>{/if}
            </div>
            {#if awaiting}
              <div class="source-awaiting-hint">This shader builds its picture from an image or video. Pick one to start.</div>
            {/if}
            {#if showMedia && libraryItems.length}
              <div class="media-grid">
                {#each libraryItems as item}
                  <button
                    class="media-cell"
                    class:active={source?.type === 'media' && source.mediaId === item.id}
                    title={item.name}
                    onclick={() => setParam(param.key, { type: 'media', mediaId: item.id })}
                  >
                    {#if item.thumbnail || item.type === 'image'}
                      <img src={item.thumbnail || item.src} alt={item.name} />
                    {:else}
                      <span>Video</span>
                    {/if}
                  </button>
                {/each}
              </div>
            {/if}
            {#if showFile}
              <button class="file-button" onclick={() => openFilePicker(param.key)}>Choose file</button>
            {/if}
          </div>
        {/if}
      {/each}
    </div>
  {/each}
</div>

<input data-help-page="gpu-instruments" bind:this={fileInput} type="file" accept="image/*,video/*,.ply,.splat" onchange={onFileSelected} hidden />

<style>
  .gpu-clip-panel { display: flex; flex-direction: column; gap: 8px; padding: 8px 10px 14px; color: var(--ga-ink-1, #ada9a2); font-size: var(--ga-text-control, 12px); }
  .section-label { margin-top: 6px; color: var(--ga-ink-2, #89857e); font-size: var(--ga-text-eyebrow, 10px); font-weight: 700; letter-spacing: var(--ga-eyebrow-tracking, 0.08em); line-height: 1.2; text-transform: uppercase; }
  .shader-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px; }
  button { font-family: inherit; }
  .shader-button { min-height: 44px; padding: 6px 8px; border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13)); border-radius: var(--ga-r-hard, 5px); background: var(--ga-card, #16140f); color: var(--ga-ink-0, #f2ede4); font-size: var(--ga-text-control, 12px); font-weight: var(--ga-weight-control, 600); text-align: left; cursor: pointer; }
  .shader-button:hover { border-color: var(--ga-line-3, rgba(245, 236, 222, 0.24)); }
  .shader-button.active { border-color: var(--ga-selection-line, #5278ff); background: var(--ga-selection-bg, #1f3170); color: var(--ga-selection-ink, #e0e8ff); }
  .shader-button span, .shader-button small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .shader-button small { margin-top: 2px; color: var(--ga-ink-2, #89857e); font-size: var(--ga-text-meta, 11px); font-weight: var(--ga-weight-body, 500); }
  .shader-button.active small { color: var(--ga-selection-ink, #e0e8ff); opacity: 0.75; }
  .control-group { display: flex; flex-direction: column; gap: 6px; }
  .range-row { display: grid; grid-template-columns: minmax(80px, 0.9fr) minmax(90px, 1.6fr) 44px; align-items: center; gap: 8px; min-height: var(--ga-control-h-sm, 22px); }
  .range-row input { width: 100%; accent-color: var(--ga-slider-fill, var(--ga-selection-line, #5278ff)); }
  output { color: var(--ga-ink-1, #ada9a2); font: var(--ga-text-meta, 11px) var(--ga-font-mono, monospace); font-variant-numeric: tabular-nums; text-align: right; }
  .toggle-row, .color-row, .select-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: var(--ga-control-h, 26px); }
  .toggle-row input { accent-color: var(--ga-selection-line, #5278ff); }
  select, .file-button { height: var(--ga-control-h, 26px); box-sizing: border-box; border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13)); border-radius: var(--ga-r-hard, 5px); padding: 0 8px; font-size: var(--ga-text-control, 12px); }
  select { min-width: 130px; background: var(--ga-slot, #060504); color: var(--ga-ink-0, #f2ede4); }
  .file-button { background: var(--ga-card, #16140f); color: var(--ga-ink-1, #ada9a2); font-weight: var(--ga-weight-control, 600); }
  .file-button:hover { border-color: var(--ga-line-3, rgba(245, 236, 222, 0.24)); color: var(--ga-ink-0, #f2ede4); }
  input[type='color'] { width: 38px; height: 22px; padding: 0; border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13)); border-radius: var(--ga-r-hard, 5px); background: transparent; }
  .source-control { padding: 8px; border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13)); border-radius: var(--ga-r-hard, 5px); background: var(--ga-sub, #1e1b16); }
  .source-header { display: flex; align-items: center; gap: 6px; }
  .source-header em { margin-left: auto; max-width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ga-ink-1, #ada9a2); font-size: var(--ga-text-meta, 11px); font-style: normal; }
  .source-header button { width: 22px; height: 22px; padding: 0; border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13)); border-radius: var(--ga-r-hard, 5px); background: var(--ga-card, #16140f); color: var(--ga-ink-1, #ada9a2); cursor: pointer; }
  .source-header button:hover { border-color: var(--ga-line-3, rgba(245, 236, 222, 0.24)); color: var(--ga-ink-0, #f2ede4); }
  .source-header em.awaiting { color: #fbbf24; }
  .source-awaiting-hint { font-size: var(--ga-text-meta, 11px); line-height: 1.4; color: #d1a54a; margin: 2px 0 4px; }
  .media-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 4px; max-height: 150px; margin-top: 8px; overflow-y: auto; }
  .media-cell { aspect-ratio: 1; padding: 0; overflow: hidden; border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13)); border-radius: var(--ga-r-hard, 5px); background: var(--ga-slot, #060504); color: var(--ga-ink-2, #89857e); font-size: var(--ga-text-micro, 9px); cursor: pointer; }
  .media-cell:hover { border-color: var(--ga-line-3, rgba(245, 236, 222, 0.24)); }
  .media-cell.active { border-color: var(--ga-selection-line, #5278ff); box-shadow: inset 0 0 0 1px var(--ga-selection-line, #5278ff); }
  .media-cell img { width: 100%; height: 100%; object-fit: cover; }
  .file-button { width: 100%; margin-top: 8px; cursor: pointer; }
</style>
