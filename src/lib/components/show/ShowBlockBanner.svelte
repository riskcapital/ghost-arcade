<script lang="ts">
  /**
   * Top of the Properties panel while a show block is being edited: which
   * block it is, that the panels now change that block (not the mapping
   * layer), and the way back to the layer. For a piece the current look does
   * not have (no layer to show properties for) it carries the block's own
   * opacity and blend mode too.
   */
  import type { BlendMode } from '../../types';
  import { blendModeLabel, BLEND_MODE_ORDER as BLEND_MODES } from '../../types';
  import { activeBlock, setBlockBlendMode, setBlockOpacity, stopEditingBlock } from '../../show/tracks/showBlockEdit';
  import { showTimeline } from '../../stores/showTimeline';

  const block = $derived($activeBlock);
  const label = $derived(block ? block.clip.label || block.clip.media.name : '');
  const opacity = $derived(block ? block.clip.opacity ?? 1 : 1);
  const blend = $derived(block ? block.layer.blendMode : 'normal');

  function back() {
    showTimeline.selectLayerClips([]);
    stopEditingBlock();
  }
</script>

{#if block}
  <div class="sbb" data-show-block-banner>
    <div class="sbb-head">
      <span class="sbb-badge">Show block</span>
      <span class="sbb-name media-name" title={label}>{label}</span>
      <button class="sbb-back" onclick={back} title="Stop editing the block: the panels show the mapping layer again">Back to layer</button>
    </div>
    <div class="sbb-hint">
      On {block.track.layerName}.
      Shader parameters, sketch controls, opacity and blend mode below change this block only.
    </div>
    {#if !block.onStage}
      <div class="sbb-row">
        <label for="sbb-opacity">Opacity</label>
        <input id="sbb-opacity" type="range" min="0" max="1" step="0.01" value={opacity}
          oninput={(e) => setBlockOpacity(parseFloat((e.currentTarget as HTMLInputElement).value))} data-block-opacity />
        <span class="sbb-value">{Math.round(opacity * 100)}%</span>
      </div>
      <div class="sbb-row">
        <label for="sbb-blend">Blend mode</label>
        <select id="sbb-blend" value={blend} onchange={(e) => setBlockBlendMode((e.currentTarget as HTMLSelectElement).value as BlendMode)} data-block-blend>
          {#each BLEND_MODES as mode (mode)}
            <option value={mode}>{blendModeLabel(mode)}</option>
          {/each}
        </select>
      </div>
    {/if}
  </div>
{/if}

<style>
  .sbb {
    margin: 8px 10px 4px;
    padding: 8px 10px;
    border: 1px solid rgba(255, 217, 107, 0.45);
    border-radius: var(--ga-r-soft, 6px);
    background: rgba(255, 217, 107, 0.06);
    font-size: var(--ga-text-control, 12px);
    color: var(--ga-ink-1, #bbb);
  }
  .sbb-head { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .sbb-badge {
    flex: 0 0 auto;
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #1a1204;
    background: #FFD96B;
    border-radius: 3px;
    padding: 1px 5px;
  }
  .sbb-name { flex: 1 1 auto; min-width: 0; color: var(--ga-ink-0, #eee); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sbb-back {
    flex: 0 0 auto;
    height: 20px;
    padding: 0 6px;
    font: inherit;
    font-size: var(--ga-text-meta, 11px);
    color: var(--ga-ink-1, #bbb);
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: 3px;
    cursor: pointer;
  }
  .sbb-back:hover { color: #fff; border-color: rgba(255, 217, 107, 0.7); }
  .sbb-hint { margin-top: 4px; font-size: var(--ga-text-meta, 11px); color: var(--ga-ink-2, #888); line-height: 1.35; }
  .sbb-row { display: grid; grid-template-columns: 84px minmax(0, 1fr) auto; align-items: center; gap: 8px; margin-top: 6px; }
  .sbb-value { font-size: var(--ga-text-meta, 11px); color: var(--ga-ink-2, #888); min-width: 32px; text-align: right; }
</style>
