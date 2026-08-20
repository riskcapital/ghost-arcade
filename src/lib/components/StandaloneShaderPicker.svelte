<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '../i18n';
  import type { MobileShader, MobileShaderCategory } from '../mobile/standaloneShaderList';
  import { getCachedThumb, warmThumbnails } from '../mobile/standaloneThumbnails';

  export let shaders: MobileShader[];
  export let onPick: (s: MobileShader) => void;
  export let onClose: () => void;

  type Filter = 'all' | MobileShaderCategory;
  let filter: Filter = 'all';

  $: filtered = filter === 'all' ? shaders : shaders.filter((s) => s.category === filter);

  const CATEGORIES: { id: Filter; label: string }[] = [
    { id: 'all',     label: 'standalone.shaderPicker.categories.all' },
    { id: 'audio',   label: 'standalone.shaderPicker.categories.audio' },
    { id: 'room',    label: 'standalone.shaderPicker.categories.room' },
    { id: 'fluid',   label: 'standalone.shaderPicker.categories.fluid' },
    { id: 'pattern', label: 'standalone.shaderPicker.categories.pattern' },
    { id: 'kinetic', label: 'standalone.shaderPicker.categories.kinetic' },
  ];

  // Per-shader cached thumbnail data-URLs. Refreshes whenever a new
  // shader's thumb generation completes — the {#key} block reads from
  // this map so any card that gets a fresh thumb mid-warmup updates
  // live without forcing a re-mount of unrelated cards.
  let thumbs: Record<string, string> = {};
  let warmDone = 0;
  let warmTotal = 0;

  function loadCachedThumbs(): void {
    const next: Record<string, string> = {};
    for (const s of shaders) {
      const t = getCachedThumb(s.id);
      if (t) next[s.id] = t;
    }
    thumbs = next;
  }

  onMount(() => {
    loadCachedThumbs();
    // Background warm — sequential, ~1.2s per shader. Cards
    // pop from placeholder → real thumb live as each completes.
    void warmThumbnails((done, total, lastId) => {
      warmDone = done;
      warmTotal = total;
      if (lastId) {
        const t = getCachedThumb(lastId);
        if (t && !thumbs[lastId]) thumbs = { ...thumbs, [lastId]: t };
      }
    });
  });

  $: warming = warmTotal > 0 && warmDone < warmTotal;
</script>

<div class="picker-bg" onclick={onClose} role="presentation">
  <div class="picker-sheet" onclick={(e) => e.stopPropagation()} role="presentation">
    <header class="picker-head">
      <h2>{$t('standalone.shaderPicker.title')}</h2>
      <button class="close-x" onclick={onClose} aria-label={$t('standalone.shaderPicker.close')}>✕</button>
    </header>

    <div class="filters">
      {#each CATEGORIES as cat}
        <button class="filter-pill" class:active={filter === cat.id} onclick={() => (filter = cat.id)}
          >{$t(cat.label)}</button
        >
      {/each}
    </div>

    {#if warming}
      <div class="warm-row" aria-live="polite">
        {$t('standalone.shaderPicker.warming', { values: { done: warmDone, total: warmTotal } })}
      </div>
    {/if}

    <div class="picker-grid">
      {#each filtered as s (s.id)}
        <button class="picker-card" onclick={() => onPick(s)}>
          {#if thumbs[s.id]}
            <div class="picker-thumb has-img">
              <img src={thumbs[s.id]} alt={s.name} loading="lazy" />
            </div>
          {:else}
            <div class="picker-thumb cat-{s.category}">
              <span class="picker-letter">{s.name.charAt(0)}</span>
            </div>
          {/if}
          <span class="picker-name">{s.name}</span>
          <span class="picker-meta"
            >{$t(`standalone.shaderPicker.categories.${s.category}`)}{s.audioNative
              ? $t('standalone.shaderPicker.audioMeta')
              : ''}</span
          >
        </button>
      {/each}
    </div>
  </div>
</div>

<style>
  .picker-bg {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    z-index: 30;
    display: flex;
    align-items: flex-end;
    justify-content: center;
  }
  .picker-sheet {
    width: 100%;
    max-width: 520px;
    max-height: 80vh;
    background: #0e0e14;
    border-top-left-radius: 18px;
    border-top-right-radius: 18px;
    padding: 14px 14px calc(env(safe-area-inset-bottom, 0px) + 16px);
    overflow-y: auto;
    animation: pop-up 0.18s ease-out;
  }
  @keyframes pop-up {
    from {
      transform: translateY(20%);
    }
    to {
      transform: translateY(0);
    }
  }

  .picker-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
  }
  .picker-head h2 {
    font-size: 17px;
    margin: 0;
  }
  .close-x {
    width: 30px;
    height: 30px;
    border: none;
    border-radius: 15px;
    background: #1c1c24;
    color: #fff;
  }

  .filters {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    padding-bottom: 10px;
    margin-bottom: 8px;
    -webkit-overflow-scrolling: touch;
  }
  .filter-pill {
    flex-shrink: 0;
    background: var(--bg-tertiary, #14141a);
    border: 1px solid #2a2a30;
    color: var(--text-primary, #ccc);
    padding: 6px 12px;
    border-radius: 14px;
    font-size: 13px;
  }
  .filter-pill.active {
    background: #bb86fc;
    color: #1a1a1f;
    border-color: #bb86fc;
  }

  .picker-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }
  .picker-card {
    background: transparent;
    border: 1px solid #1c1c24;
    border-radius: 10px;
    padding: 8px;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    text-align: left;
    color: #fff;
  }
  .picker-card:active {
    transform: scale(0.97);
  }
  .picker-thumb {
    width: 100%;
    aspect-ratio: 1;
    border-radius: 6px;
    margin-bottom: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 29px;
    font-weight: 700;
    color: #fff;
  }
  /* Category-coded gradient backgrounds — fallback for shaders that
     haven't been rendered to a thumbnail yet (first launch warmup). */
  .cat-audio  { background: linear-gradient(135deg, #ff6e6e, #bb86fc); }
  .cat-room   { background: linear-gradient(135deg, #34284a, #ff8577); }
  .cat-fluid  { background: linear-gradient(135deg, #1a5c8e, #69f0ae); }
  .cat-pattern{ background: linear-gradient(135deg, #2a2a30, #bb86fc); }
  .cat-kinetic{ background: linear-gradient(135deg, #ff8577, #ffc857); }
  .picker-letter { opacity: 0.95; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4); }

  /* Real rendered thumbnail — fills the .picker-thumb square. */
  .picker-thumb.has-img { background: #0a0a0d; overflow: hidden; }
  .picker-thumb.has-img img {
    width: 100%; height: 100%;
    object-fit: cover;
    display: block;
  }

  /* "Generating shader previews… N/30" indicator above the grid.
     Sits between the category filters and the grid; disappears once
     warmup completes. */
  .warm-row {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.55);
    padding: 4px 2px 8px;
  }

  .picker-name {
    font-size: 12px;
    font-weight: 600;
    line-height: 1.25;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .picker-meta {
    font-size: 10px;
    color: var(--text-muted, #888);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
</style>
