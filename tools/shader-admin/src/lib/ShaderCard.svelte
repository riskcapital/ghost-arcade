<script>
  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher();

  export let entry;
  export let selected = false;
  export let bulkSelected = false;
  export let bulkMode = false;
  export let thumbnailUrl = null;

  $: displayName = entry.file
    .replace('.fs', '')
    .replace(/^DM-/, '')
    .replace(/^SM-/, '')
    .replace(/^AR-/, '')
    .replace(/^cube shaders\//, '');

  $: tierClass = entry.tier || 'demo';

  $: isEnabled = entry.enabled !== false; // default true if missing
  $: isDefaultLoad = entry.defaultLoad === true;

  function handleTierClick(e, tier) {
    e.stopPropagation();
    dispatch('tierChange', tier);
  }

  function handleEnableToggle(e) {
    e.stopPropagation();
    dispatch('enableToggle', !isEnabled);
  }

  function handleDefaultLoadToggle(e) {
    e.stopPropagation();
    dispatch('defaultLoadToggle', !isDefaultLoad);
  }

  function handleDelete(e) {
    e.stopPropagation();
    dispatch('delete');
  }
</script>

<div class="shader-card" class:selected class:bulkSelected class:disabled={!isEnabled} class:default-load={isDefaultLoad} on:click>
  {#if bulkMode}
    <div class="bulk-check">
      <input type="checkbox" checked={bulkSelected} on:click|stopPropagation />
    </div>
  {/if}

  <div class="enable-check">
    <input type="checkbox" checked={isEnabled} on:click={handleEnableToggle} title={isEnabled ? 'Included in build' : 'Excluded from build'} />
  </div>

  {#if isEnabled}
    <div class="default-load-check">
      <input type="checkbox" checked={isDefaultLoad} on:click={handleDefaultLoadToggle} title={isDefaultLoad ? 'Loads by default in tray' : 'Available in library only'} />
      <span class="default-load-label">D</span>
    </div>
  {/if}

  <!-- Delete button (visible on hover) -->
  <button class="delete-btn" on:click={handleDelete} title="Remove from manifest">×</button>

  <div class="card-thumb">
    {#if thumbnailUrl}
      <img src={thumbnailUrl} alt={displayName} loading="lazy" />
    {:else}
      <div class="thumb-placeholder">
        <span class="thumb-icon">◇</span>
      </div>
    {/if}
  </div>

  <div class="card-body">
    <div class="card-header">
      <span class="card-name" title={entry.file}>{displayName}</span>
      <span class="card-tier {tierClass}">{entry.tier?.toUpperCase() || 'DEMO'}</span>
    </div>

    <div class="card-meta">
      {#if entry.category}
        <span class="card-cat">{entry.category}</span>
      {/if}
      {#if entry.featured}
        <span class="card-featured">★</span>
      {/if}
      {#if isDefaultLoad}
        <span class="card-default-badge" title="Loads by default">⬡</span>
      {/if}
      {#if Object.keys(entry.defaults || {}).length > 0}
        <span class="card-defaults" title="Has default overrides">⚙</span>
      {/if}
    </div>

    {#if isEnabled}
      <div class="card-tier-btns">
        <button class:active={entry.tier === 'demo'} on:click={(e) => handleTierClick(e, 'demo')}>D</button>
        <button class:active={entry.tier === 'starter'} on:click={(e) => handleTierClick(e, 'starter')}>S</button>
        <button class:active={entry.tier === 'pro'} on:click={(e) => handleTierClick(e, 'pro')}>P</button>
      </div>
    {:else}
      <div class="card-excluded">EXCLUDED</div>
    {/if}
  </div>
</div>

<style>
  .shader-card {
    background: #1a1a1e;
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 6px;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
    position: relative;
    overflow: hidden;
  }
  .shader-card:hover { border-color: rgba(255,255,255,0.15); background: #1e1e24; }
  .shader-card.selected { border-color: #FF6B6B; background: #1e1418; }
  .shader-card.bulkSelected { border-color: #6eb5ff; background: #141a24; }
  .shader-card.default-load { border-color: rgba(110,181,255,0.3); }

  .shader-card.disabled { opacity: 0.4; }
  .shader-card.disabled:hover { opacity: 0.55; }

  .bulk-check { position: absolute; top: 6px; right: 6px; z-index: 2; }

  .enable-check {
    position: absolute; top: 6px; left: 6px; z-index: 2;
  }
  .enable-check input {
    width: 14px; height: 14px; accent-color: #2ed573; cursor: pointer;
    filter: drop-shadow(0 0 2px rgba(0,0,0,0.8));
  }

  .default-load-check {
    position: absolute; top: 6px; left: 28px; z-index: 2;
    display: flex; align-items: center; gap: 2px;
  }
  .default-load-check input {
    width: 14px; height: 14px; accent-color: #6eb5ff; cursor: pointer;
    filter: drop-shadow(0 0 2px rgba(0,0,0,0.8));
  }
  .default-load-label {
    font-size: 8px; font-weight: 700; color: #6eb5ff;
    text-shadow: 0 0 3px rgba(0,0,0,0.8);
  }

  .delete-btn {
    position: absolute; top: 4px; right: 4px; z-index: 3;
    width: 18px; height: 18px; border-radius: 50%;
    background: rgba(255,50,50,0.8); border: none;
    color: white; font-size: 14px; line-height: 1;
    cursor: pointer; display: flex; align-items: center; justify-content: center;
    opacity: 0; transition: opacity 0.15s;
    padding: 0;
  }
  .shader-card:hover .delete-btn { opacity: 1; }
  .delete-btn:hover { background: #ff2222; }

  .card-thumb {
    width: 100%;
    aspect-ratio: 16/9;
    background: #111;
    overflow: hidden;
  }
  .card-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .thumb-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
  }
  .thumb-icon {
    font-size: 22px;
    color: rgba(255,255,255,0.12);
  }

  .card-body { padding: 8px 10px 10px; }

  .card-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 6px; }
  .card-name { font-size: 11px; font-weight: 500; word-break: break-word; flex: 1; line-height: 1.3; }
  .card-tier {
    font-size: 9px; padding: 2px 5px; border-radius: 4px; font-weight: 700;
    white-space: nowrap; flex-shrink: 0;
  }
  .card-tier.demo { background: #333; color: #aaa; }
  .card-tier.starter { background: #1a3a6a; color: #6eb5ff; }
  .card-tier.pro { background: #5a3a00; color: #ffb347; }

  .card-meta { margin-top: 3px; display: flex; align-items: center; gap: 6px; }
  .card-cat { font-size: 10px; color: #666; }
  .card-featured { color: #ffb347; font-size: 12px; }
  .card-defaults { font-size: 10px; color: #FF6B6B; }
  .card-default-badge { font-size: 10px; color: #6eb5ff; }

  .card-tier-btns { display: flex; gap: 3px; margin-top: 5px; }
  .card-tier-btns button {
    flex: 1; padding: 3px; font-size: 10px; font-weight: 700;
    background: #222; border: 1px solid #333; color: #666;
    border-radius: 3px; cursor: pointer;
  }
  .card-tier-btns button:hover { border-color: #555; }
  .card-tier-btns button.active { background: #FF6B6B; color: white; border-color: #FF6B6B; }

  .card-excluded {
    font-size: 9px; color: #555; text-align: center; margin-top: 5px;
    letter-spacing: 1px; font-weight: 600;
  }
</style>
