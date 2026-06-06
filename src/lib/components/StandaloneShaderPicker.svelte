<script lang="ts">
  import type { MobileShader, MobileShaderCategory } from '../mobile/standaloneShaderList';

  export let shaders: MobileShader[];
  export let onPick: (s: MobileShader) => void;
  export let onClose: () => void;

  type Filter = 'all' | MobileShaderCategory;
  let filter: Filter = 'all';

  $: filtered = filter === 'all' ? shaders : shaders.filter(s => s.category === filter);

  const CATEGORIES: { id: Filter; label: string }[] = [
    { id: 'all',     label: 'All' },
    { id: 'audio',   label: 'Audio' },
    { id: 'room',    label: 'Rooms' },
    { id: 'fluid',   label: 'Fluid' },
    { id: 'pattern', label: 'Pattern' },
    { id: 'kinetic', label: 'Kinetic' },
  ];
</script>

<div class="picker-bg" onclick={onClose} role="presentation">
  <div class="picker-sheet" onclick={(e) => e.stopPropagation()} role="presentation">
    <header class="picker-head">
      <h2>Pick a shader</h2>
      <button class="close-x" onclick={onClose} aria-label="Close">✕</button>
    </header>

    <div class="filters">
      {#each CATEGORIES as cat}
        <button
          class="filter-pill"
          class:active={filter === cat.id}
          onclick={() => filter = cat.id}
        >{cat.label}</button>
      {/each}
    </div>

    <div class="picker-grid">
      {#each filtered as s (s.id)}
        <button class="picker-card" onclick={() => onPick(s)}>
          <div class="picker-thumb cat-{s.category}">
            <span class="picker-letter">{s.name.charAt(0)}</span>
          </div>
          <span class="picker-name">{s.name}</span>
          <span class="picker-meta">{s.category}{s.audioNative ? ' · audio' : ''}</span>
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
    from { transform: translateY(20%); }
    to   { transform: translateY(0); }
  }

  .picker-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
  }
  .picker-head h2 { font-size: 16px; margin: 0; }
  .close-x {
    width: 30px; height: 30px;
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
    font-size: 12px;
  }
  .filter-pill.active { background: #BB86FC; color: #1a1a1f; border-color: #BB86FC; }

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
  .picker-card:active { transform: scale(0.97); }
  .picker-thumb {
    width: 100%;
    aspect-ratio: 1;
    border-radius: 6px;
    margin-bottom: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 28px;
    font-weight: 700;
    color: #fff;
  }
  /* Category-coded gradient backgrounds — stand in for real thumbnails. */
  .cat-audio  { background: linear-gradient(135deg, #FF6E6E, #BB86FC); }
  .cat-room   { background: linear-gradient(135deg, #34284A, #FF8577); }
  .cat-fluid  { background: linear-gradient(135deg, #1A5C8E, #69F0AE); }
  .cat-pattern{ background: linear-gradient(135deg, #2A2A30, #BB86FC); }
  .cat-kinetic{ background: linear-gradient(135deg, #FF8577, #FFC857); }
  .picker-letter { opacity: 0.95; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4); }

  .picker-name {
    font-size: 11px;
    font-weight: 600;
    line-height: 1.25;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .picker-meta {
    font-size: 9px;
    color: var(--text-muted, #888);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
</style>
