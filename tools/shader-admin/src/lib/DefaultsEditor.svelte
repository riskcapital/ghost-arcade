<script>
  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher();

  export let source = '';
  export let defaults = {};

  // Parse ISF metadata from shader source
  $: inputs = parseInputs(source);

  function parseInputs(src) {
    try {
      // Extract JSON metadata block from ISF comment
      const match = src.match(/\/\*\s*\{[\s\S]*?\}\s*\*\//);
      if (!match) return [];
      const jsonStr = match[0].replace(/^\/\*\s*/, '').replace(/\s*\*\/$/, '');
      const meta = JSON.parse(jsonStr);
      return (meta.INPUTS || []).filter(i => i.TYPE === 'float' || i.TYPE === 'long' || i.TYPE === 'bool' || i.TYPE === 'color');
    } catch {
      return [];
    }
  }

  function updateDefault(name, value) {
    defaults = { ...defaults, [name]: value };
    dispatch('change', defaults);
  }

  function clearDefault(name) {
    const { [name]: _, ...rest } = defaults;
    defaults = rest;
    dispatch('change', defaults);
  }
</script>

{#if inputs.length > 0}
  <div class="defaults-editor">
    <label class="section-label">Default Overrides ({Object.keys(defaults).length} set)</label>
    {#each inputs as input}
      <div class="param-row">
        <span class="param-name" title={input.NAME}>{input.LABEL || input.NAME}</span>
        <span class="param-type">{input.TYPE}</span>

        {#if input.TYPE === 'float'}
          <input
            type="range"
            min={input.MIN ?? 0}
            max={input.MAX ?? 1}
            step={((input.MAX ?? 1) - (input.MIN ?? 0)) / 100}
            value={defaults[input.NAME] ?? input.DEFAULT ?? input.MIN ?? 0}
            on:input={(e) => updateDefault(input.NAME, parseFloat(e.target.value))}
          />
          <span class="param-value">{(defaults[input.NAME] ?? input.DEFAULT ?? input.MIN ?? 0).toFixed(2)}</span>
        {:else if input.TYPE === 'long'}
          <select
            value={defaults[input.NAME] ?? input.DEFAULT ?? 0}
            on:change={(e) => updateDefault(input.NAME, parseInt(e.target.value))}
          >
            {#each (input.VALUES || []) as val, i}
              <option value={val}>{(input.LABELS || [])[i] || val}</option>
            {/each}
          </select>
        {:else if input.TYPE === 'bool'}
          <input
            type="checkbox"
            checked={defaults[input.NAME] ?? input.DEFAULT ?? false}
            on:change={(e) => updateDefault(input.NAME, e.target.checked)}
          />
        {:else if input.TYPE === 'color'}
          <span class="color-preview" style="background: rgba({((defaults[input.NAME] ?? input.DEFAULT ?? [1,1,1,1]).map(c => Math.round(c * 255))).join(',')})"></span>
        {/if}

        {#if defaults[input.NAME] !== undefined}
          <button class="clear-btn" on:click={() => clearDefault(input.NAME)} title="Clear override">x</button>
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .defaults-editor { margin-top: 16px; }
  .section-label { font-size: 11px; color: #888; text-transform: uppercase; display: block; margin-bottom: 8px; }

  .param-row {
    display: flex; align-items: center; gap: 6px; margin-bottom: 4px;
    padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.04);
  }
  .param-name { font-size: 11px; color: #ccc; width: 80px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-shrink: 0; }
  .param-type { font-size: 9px; color: #555; width: 30px; flex-shrink: 0; }
  .param-value { font-size: 10px; color: #888; width: 36px; text-align: right; flex-shrink: 0; }

  input[type="range"] { flex: 1; height: 14px; accent-color: #FF6B6B; }
  select { flex: 1; padding: 2px; background: #1a1a1e; border: 1px solid #333; color: #e0e0e0; border-radius: 3px; font-size: 10px; }
  input[type="checkbox"] { accent-color: #FF6B6B; }

  .color-preview { width: 20px; height: 20px; border-radius: 3px; border: 1px solid #444; flex-shrink: 0; }
  .clear-btn {
    background: none; border: none; color: #FF6B6B; font-size: 12px; cursor: pointer;
    padding: 0 4px; flex-shrink: 0;
  }
  .clear-btn:hover { color: #ff4757; }
</style>
