<script>
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import { LivePreviewRenderer, parseISFMetadata, getInputDefault } from './isfRenderer.js';

  const dispatch = createEventDispatcher();

  export let entry = null;
  export let source = '';

  let canvas;
  let renderer = null;
  let inputs = [];
  let paramValues = {};
  let compiledOk = false;
  let generatingThumb = false;
  let thumbSaved = false;

  $: if (source && canvas) {
    loadShader(source, entry?.defaults || {});
  }

  function loadShader(src, defaults) {
    if (!canvas) return;
    inputs = [];
    paramValues = {};
    compiledOk = false;

    const metadata = parseISFMetadata(src);
    inputs = (metadata.INPUTS || []).filter(i =>
      ['float', 'long', 'bool', 'color', 'point2D'].includes(i.TYPE)
    );

    // Initialize param values from defaults, then shader defaults
    for (const input of inputs) {
      if (defaults && defaults[input.NAME] !== undefined) {
        paramValues[input.NAME] = defaults[input.NAME];
      } else {
        paramValues[input.NAME] = getInputDefault(input);
      }
    }

    if (!renderer) {
      renderer = new LivePreviewRenderer(canvas);
    }

    compiledOk = renderer.loadShader(src, paramValues);
    if (compiledOk) {
      renderer.startAnimation();
    }
  }

  function updateParam(name, value) {
    paramValues[name] = value;
    paramValues = paramValues; // reactivity
    if (renderer) renderer.setParam(name, value);
    dispatch('paramsChange', paramValues);
  }

  function saveDefaults() {
    // Build defaults object (only include values that differ from shader defaults)
    const defaults = {};
    for (const input of inputs) {
      const shaderDefault = getInputDefault(input);
      const currentVal = paramValues[input.NAME];
      if (currentVal !== undefined && JSON.stringify(currentVal) !== JSON.stringify(shaderDefault)) {
        defaults[input.NAME] = currentVal;
      }
    }
    dispatch('saveDefaults', defaults);
  }

  async function generateThumbnail() {
    if (!renderer || !compiledOk || !entry) return;
    generatingThumb = true;
    thumbSaved = false;

    try {
      const dataUrl = renderer.captureDataURL(0.85);

      const res = await fetch('/api/thumbnail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: entry.file, dataUrl }),
      });

      if (res.ok) {
        thumbSaved = true;
        dispatch('thumbnailSaved', entry.file);
        setTimeout(() => { thumbSaved = false; }, 3000);
      }
    } catch (err) {
      console.error('Failed to save thumbnail:', err);
    }

    generatingThumb = false;
  }

  function resetToShaderDefaults() {
    for (const input of inputs) {
      paramValues[input.NAME] = getInputDefault(input);
      if (renderer) renderer.setParam(input.NAME, paramValues[input.NAME]);
    }
    paramValues = paramValues;
    dispatch('paramsChange', paramValues);
  }

  onDestroy(() => {
    if (renderer) { renderer.destroy(); renderer = null; }
  });
</script>

<div class="shader-preview">
  <div class="preview-canvas-wrap">
    <canvas bind:this={canvas} width={640} height={360}></canvas>
    {#if !compiledOk && source}
      <div class="compile-error">⚠ Shader failed to compile</div>
    {/if}
  </div>

  <div class="preview-controls">
    <div class="controls-header">
      <h3>{entry?.file?.replace('.fs', '') || 'No shader selected'}</h3>
      <div class="controls-btns">
        <button class="btn-reset" on:click={resetToShaderDefaults} title="Reset to shader defaults">↺ Reset</button>
        <button class="btn-save" on:click={saveDefaults} title="Save parameter overrides to manifest">💾 Save Params</button>
        <button class="btn-thumb" on:click={generateThumbnail} disabled={generatingThumb || !compiledOk}
          title="Capture current preview as thumbnail">
          {generatingThumb ? '⏳...' : '📸 Save Thumbnail'}
        </button>
      </div>
    </div>
    {#if thumbSaved}
      <div class="thumb-saved">✅ Thumbnail saved!</div>
    {/if}

    <div class="params-list">
      {#each inputs as input (input.NAME)}
        <div class="param-row">
          <label class="param-label" title={input.NAME}>{input.LABEL || input.NAME}</label>
          <span class="param-type">{input.TYPE}</span>

          {#if input.TYPE === 'float'}
            <input
              type="range"
              min={input.MIN ?? 0}
              max={input.MAX ?? 1}
              step={((input.MAX ?? 1) - (input.MIN ?? 0)) / 200}
              value={paramValues[input.NAME] ?? 0}
              on:input={(e) => updateParam(input.NAME, parseFloat(e.target.value))}
            />
            <span class="param-val">{(paramValues[input.NAME] ?? 0).toFixed(3)}</span>

          {:else if input.TYPE === 'long'}
            <select
              value={paramValues[input.NAME] ?? 0}
              on:change={(e) => updateParam(input.NAME, parseInt(e.target.value))}
            >
              {#each (input.VALUES || []) as val, i}
                <option value={val}>{(input.LABELS || [])[i] || val}</option>
              {/each}
            </select>

          {:else if input.TYPE === 'bool'}
            <input
              type="checkbox"
              checked={paramValues[input.NAME] ?? false}
              on:change={(e) => updateParam(input.NAME, e.target.checked)}
            />

          {:else if input.TYPE === 'color'}
            {@const c = paramValues[input.NAME] ?? [1,1,1,1]}
            <div class="color-row">
              <span class="color-swatch" style="background: rgba({c.map(v => Math.round(v * 255)).join(',')})"></span>
              <input type="range" min={0} max={1} step={0.01} value={c[0]}
                on:input={(e) => updateParam(input.NAME, [parseFloat(e.target.value), c[1], c[2], c[3]])} />
              <input type="range" min={0} max={1} step={0.01} value={c[1]}
                on:input={(e) => updateParam(input.NAME, [c[0], parseFloat(e.target.value), c[2], c[3]])} />
              <input type="range" min={0} max={1} step={0.01} value={c[2]}
                on:input={(e) => updateParam(input.NAME, [c[0], c[1], parseFloat(e.target.value), c[3]])} />
            </div>

          {:else if input.TYPE === 'point2D'}
            {@const p = paramValues[input.NAME] ?? [0.5, 0.5]}
            <input type="range" min={0} max={1} step={0.01} value={p[0]}
              on:input={(e) => updateParam(input.NAME, [parseFloat(e.target.value), p[1]])} />
            <input type="range" min={0} max={1} step={0.01} value={p[1]}
              on:input={(e) => updateParam(input.NAME, [p[0], parseFloat(e.target.value)])} />
          {/if}

          {#if entry?.defaults?.[input.NAME] !== undefined}
            <span class="override-badge" title="Has manifest override">●</span>
          {/if}
        </div>
      {/each}

      {#if inputs.length === 0 && source}
        <div class="no-params">No adjustable parameters</div>
      {/if}
    </div>
  </div>
</div>

<style>
  .shader-preview {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .preview-canvas-wrap {
    position: relative;
    background: #000;
    flex-shrink: 0;
  }
  .preview-canvas-wrap canvas {
    width: 100%;
    display: block;
    border-radius: 4px 4px 0 0;
  }
  .compile-error {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0,0,0,0.85);
    color: #ff4757;
    font-size: 14px;
    font-weight: 600;
  }

  .preview-controls {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
  }

  .controls-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 8px;
    margin-bottom: 8px;
  }
  .controls-header h3 {
    font-size: 13px;
    font-weight: 600;
    margin: 0;
    word-break: break-word;
    flex: 1;
  }
  .controls-btns {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  .controls-btns button {
    font-size: 10px;
    padding: 4px 8px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    white-space: nowrap;
  }
  .btn-reset { background: #333; color: #ccc; }
  .btn-reset:hover { background: #444; }
  .btn-save { background: #1a6aff; color: white; }
  .btn-save:hover { background: #3580ff; }
  .btn-thumb { background: #2ed573; color: #000; font-weight: 600; }
  .btn-thumb:hover { background: #26c960; }
  .btn-thumb:disabled { opacity: 0.4; cursor: not-allowed; }

  .thumb-saved {
    color: #2ed573;
    font-size: 11px;
    margin-bottom: 8px;
    text-align: center;
  }

  .params-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .param-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 0;
    border-bottom: 1px solid rgba(255,255,255,0.04);
    flex-wrap: wrap;
  }
  .param-label {
    font-size: 11px;
    color: #ccc;
    width: 90px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .param-type {
    font-size: 9px;
    color: #555;
    width: 32px;
    flex-shrink: 0;
  }
  .param-val {
    font-size: 10px;
    color: #888;
    width: 44px;
    text-align: right;
    flex-shrink: 0;
    font-family: monospace;
  }

  input[type="range"] { flex: 1; min-width: 60px; height: 16px; accent-color: #FF6B6B; }
  select {
    flex: 1; min-width: 60px; padding: 3px; background: #1a1a1e;
    border: 1px solid #333; color: #e0e0e0; border-radius: 3px; font-size: 11px;
  }
  input[type="checkbox"] { accent-color: #FF6B6B; }

  .color-row {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 1;
  }
  .color-swatch {
    width: 20px;
    height: 20px;
    border-radius: 3px;
    border: 1px solid #444;
    flex-shrink: 0;
  }
  .color-row input[type="range"] { flex: 1; min-width: 40px; }

  .override-badge { color: #FF6B6B; font-size: 8px; flex-shrink: 0; }

  .no-params {
    color: #555;
    font-size: 12px;
    text-align: center;
    padding: 20px;
  }
</style>
