<script lang="ts">
  import { STAGE_PRESETS, clonePreset } from '../../stage3d/presets';
  import type { Stage3DScene } from '../../stage3d/types';
  import { createEmptyScene } from '../../stage3d/types';
  import { t } from '../../i18n';

  export let onClose: () => void;
  export let onPick: (scene: Stage3DScene) => void;

  const presetMessageKeys: Record<string, { nameKey: string; descriptionKey: string }> = {
    'preset-festival': {
      nameKey: 'stageShow.picker.presets.festival.name',
      descriptionKey: 'stageShow.picker.presets.festival.description',
    },
    'preset-arena': {
      nameKey: 'stageShow.picker.presets.arena.name',
      descriptionKey: 'stageShow.picker.presets.arena.description',
    },
    'preset-club': {
      nameKey: 'stageShow.picker.presets.club.name',
      descriptionKey: 'stageShow.picker.presets.club.description',
    },
  };

  function pickPreset(presetId: string) {
    const cloned = clonePreset(presetId);
    if (cloned) onPick(cloned);
  }

  function pickEmpty() {
    onPick(createEmptyScene($t('stageShow.picker.untitledStage')));
  }
</script>

<div class="picker-bg" onclick={onClose} role="presentation">
  <div class="picker-card" onclick={(e) => e.stopPropagation()} role="presentation">
    <header>
      <h2>{$t('stageShow.picker.title')}</h2>
      <button class="close-x" onclick={onClose} aria-label={$t('stageShow.picker.close')}>✕</button>
    </header>

    <div class="picker-grid">
      <!-- Empty / blank canvas -->
      <button class="preset-card" onclick={pickEmpty}>
        <div class="thumb empty">
          <span class="thumb-glyph">+</span>
        </div>
        <span class="preset-name">{$t('stageShow.picker.blankStage')}</span>
        <span class="preset-desc">{$t('stageShow.picker.blankDescription')}</span>
      </button>

      {#each STAGE_PRESETS as entry (entry.preset.id)}
        {@const messages = presetMessageKeys[entry.preset.id]}
        <button class="preset-card" onclick={() => pickPreset(entry.preset.id)}>
          <div class="thumb" style="background: linear-gradient(135deg, {entry.thumbnailGradient[0]}, {entry.thumbnailGradient[1]});">
            <span class="thumb-letter">{entry.preset.name.charAt(0)}</span>
          </div>
          <span class="preset-name">{messages ? $t(messages.nameKey) : entry.preset.name}</span>
          <span class="preset-desc">{messages ? $t(messages.descriptionKey) : entry.description}</span>
        </button>
      {/each}
    </div>
  </div>
</div>

<style>
  .picker-bg {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(8px);
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .picker-card {
    width: 100%;
    max-width: 640px;
    max-height: 85vh;
    overflow-y: auto;
    background: #0c0e16;
    border: 1px solid #2a2c36;
    border-radius: 16px;
    padding: 20px;
    color: #fff;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
  }
  h2 { margin: 0; font-size: 18px; font-weight: 600; }
  .close-x {
    background: #1c1e28;
    border: none;
    color: #fff;
    width: 30px;
    height: 30px;
    border-radius: 15px;
    cursor: pointer;
  }
  .picker-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 12px;
  }
  .preset-card {
    background: #14161e;
    border: 1px solid #2a2c36;
    border-radius: 12px;
    padding: 12px;
    text-align: left;
    color: #fff;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
    transition: transform 0.1s ease-out, border-color 0.15s ease-out;
  }
  .preset-card:hover { border-color: #bb86fc; transform: translateY(-2px); }
  .preset-card:active { transform: scale(0.98); }
  .thumb {
    width: 100%;
    aspect-ratio: 16 / 10;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 4px;
  }
  .thumb.empty {
    background: #1c1e28;
    border: 1px dashed #3a3c46;
  }
  .thumb-letter, .thumb-glyph {
    font-size: 37px;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.85);
    text-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
  }
  .thumb-glyph { color: #666; font-weight: 300; font-size: 45px; }
  .preset-name {
    font-size: 14px;
    font-weight: 600;
  }
  .preset-desc {
    font-size: 12px;
    color: #999;
    line-height: 1.4;
  }
</style>
