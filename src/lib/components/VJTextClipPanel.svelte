<script lang="ts">
  import type { TextAnimation, TextAnimationType, TextContent } from '../types';
  import { installedFontChoices, isFontInstalled } from '../text/fontAvailability';
  import TextMotionControls from './TextMotionControls.svelte';
  import { TEXT_ANIMATIONS, TEXT_EDIT_LIMIT, wordCount } from '../text/textMotionCatalog';

  export let content: TextContent;
  export let onUpdate: (updates: Partial<TextContent>) => void;

  const fonts = [
    'Arial', 'Arial Black', 'Helvetica', 'Verdana', 'Tahoma', 'Trebuchet MS',
    'Impact', 'Georgia', 'Times New Roman', 'Courier New', 'Segoe UI', 'Roboto',
    'Montserrat', 'Oswald', 'Futura', 'Gill Sans', 'Century Gothic', 'Copperplate',
  ];
  const animations = TEXT_ANIMATIONS;

  function setAnimation(updates: Partial<TextAnimation>) {
    onUpdate({ animation: { ...content.animation, ...updates } });
  }
</script>

<div data-help-page="clip-launcher" class="text-clip-panel">
  <section>
    <div class="section-label">Text</div>
    {#if content.text.length > TEXT_EDIT_LIMIT}
      <p class="long-text">{wordCount(content.text).toLocaleString()} words loaded. <button type="button" onclick={() => onUpdate({ text: '' })}>Clear</button></p>
    {:else}
      <textarea rows="3" value={content.text} oninput={(event) => onUpdate({ text: (event.target as HTMLTextAreaElement).value })}></textarea>
    {/if}
  </section>

  <section>
    <div class="section-label">Repeat and read</div>
    <TextMotionControls {content} {onUpdate} />
  </section>

  <section>
    <div class="section-label">Typography</div>
    <label class="select-row"><span>Font</span><select value={content.fontFamily} onchange={(event) => onUpdate({ fontFamily: (event.target as HTMLSelectElement).value })}>{#each installedFontChoices(fonts, content.fontFamily) as font}<option value={font}>{isFontInstalled(font) ? font : `${font} (not installed)`}</option>{/each}</select></label>
    <label class="range-row"><span>Size</span><input type="range" min="12" max="500" step="1" value={content.fontSize} oninput={(event) => onUpdate({ fontSize: Number((event.target as HTMLInputElement).value) })} /><output>{content.fontSize}px</output></label>
    <label class="range-row"><span>Weight</span><input type="range" min="100" max="900" step="100" value={content.fontWeight} oninput={(event) => onUpdate({ fontWeight: Number((event.target as HTMLInputElement).value) })} /><output>{content.fontWeight}</output></label>
    <label class="select-row"><span>Style</span><select value={content.fontStyle} onchange={(event) => onUpdate({ fontStyle: (event.target as HTMLSelectElement).value as 'normal' | 'italic' })}><option value="normal">Normal</option><option value="italic">Italic</option></select></label>
    <div class="button-row"><span>Align</span><div>{#each ['left', 'center', 'right'] as alignment}<button class:active={content.alignment === alignment} onclick={() => onUpdate({ alignment: alignment as TextContent['alignment'] })}>{alignment.slice(0, 1).toUpperCase()}</button>{/each}</div></div>
    <label class="range-row"><span>Letter</span><input type="range" min="-20" max="50" step="1" value={content.letterSpacing} oninput={(event) => onUpdate({ letterSpacing: Number((event.target as HTMLInputElement).value) })} /><output>{content.letterSpacing}px</output></label>
    <label class="range-row"><span>Line</span><input type="range" min="0.5" max="3" step="0.05" value={content.lineHeight} oninput={(event) => onUpdate({ lineHeight: Number((event.target as HTMLInputElement).value) })} /><output>{content.lineHeight.toFixed(2)}</output></label>
  </section>

  <section>
    <div class="section-label">Appearance</div>
    <label class="color-row"><span>Fill</span><input type="color" value={content.color} oninput={(event) => onUpdate({ color: (event.target as HTMLInputElement).value })} /></label>
    <label class="color-row"><span>Stroke</span><input type="color" value={content.strokeColor} oninput={(event) => onUpdate({ strokeColor: (event.target as HTMLInputElement).value })} /></label>
    <label class="range-row"><span>Stroke width</span><input type="range" min="0" max="20" step="0.5" value={content.strokeWidth} oninput={(event) => onUpdate({ strokeWidth: Number((event.target as HTMLInputElement).value) })} /><output>{content.strokeWidth}px</output></label>
    <div class="color-row"><span>Background</span><div><input type="color" value={content.backgroundColor === 'transparent' ? '#000000' : content.backgroundColor} oninput={(event) => onUpdate({ backgroundColor: (event.target as HTMLInputElement).value })} /><button onclick={() => onUpdate({ backgroundColor: 'transparent' })}>Clear</button></div></div>
    <label class="color-row"><span>Shadow</span><input type="color" value={content.shadowColor.startsWith('rgba') ? '#000000' : content.shadowColor} oninput={(event) => onUpdate({ shadowColor: (event.target as HTMLInputElement).value })} /></label>
    <label class="range-row"><span>Shadow blur</span><input type="range" min="0" max="50" step="1" value={content.shadowBlur} oninput={(event) => onUpdate({ shadowBlur: Number((event.target as HTMLInputElement).value) })} /><output>{content.shadowBlur}px</output></label>
  </section>

  <section>
    <div class="section-label">Animation</div>
    <label class="select-row"><span>Type</span><select value={content.animation.type} onchange={(event) => setAnimation({ type: (event.target as HTMLSelectElement).value as TextAnimationType })}>{#each animations as animation}<option value={animation.value}>{animation.label}</option>{/each}</select></label>
    {#if content.animation.type !== 'none'}
      <label class="range-row"><span>Speed</span><input type="range" min="0.1" max="5" step="0.1" value={content.animation.speed} oninput={(event) => setAnimation({ speed: Number((event.target as HTMLInputElement).value) })} /><output>{content.animation.speed.toFixed(1)}x</output></label>
      <label class="range-row"><span>Intensity</span><input type="range" min="0" max="1" step="0.01" value={content.animation.intensity} oninput={(event) => setAnimation({ intensity: Number((event.target as HTMLInputElement).value) })} /><output>{Math.round(content.animation.intensity * 100)}%</output></label>
      <label class="range-row"><span>Stagger</span><input type="range" min="0.01" max="0.5" step="0.01" value={content.animation.staggerDelay} oninput={(event) => setAnimation({ staggerDelay: Number((event.target as HTMLInputElement).value) })} /><output>{Math.round(content.animation.staggerDelay * 1000)}ms</output></label>
      <label class="select-row"><span>Direction</span><select value={content.animation.direction} onchange={(event) => setAnimation({ direction: (event.target as HTMLSelectElement).value as TextAnimation['direction'] })}><option value="forward">Forward</option><option value="reverse">Reverse</option><option value="alternate">Alternate</option></select></label>
      <label class="toggle-row"><span>Loop</span><input type="checkbox" checked={content.animation.loop} onchange={(event) => setAnimation({ loop: (event.target as HTMLInputElement).checked })} /></label>
    {/if}
  </section>

  <section>
    <div class="section-label">3D</div>
    <label class="toggle-row"><span>Enable 3D</span><input type="checkbox" checked={content.enable3D} onchange={(event) => onUpdate({ enable3D: (event.target as HTMLInputElement).checked })} /></label>
    {#if content.enable3D}
      <label class="range-row"><span>Depth</span><input type="range" min="1" max="100" step="1" value={content.extrudeDepth} oninput={(event) => onUpdate({ extrudeDepth: Number((event.target as HTMLInputElement).value) })} /><output>{content.extrudeDepth}px</output></label>
      <label class="color-row"><span>Depth color</span><input type="color" value={content.extrudeColor} oninput={(event) => onUpdate({ extrudeColor: (event.target as HTMLInputElement).value })} /></label>
      <label class="range-row"><span>Rotate X</span><input type="range" min="-90" max="90" step="1" value={content.rotateX} oninput={(event) => onUpdate({ rotateX: Number((event.target as HTMLInputElement).value) })} /><output>{content.rotateX}&deg;</output></label>
      <label class="range-row"><span>Rotate Y</span><input type="range" min="-90" max="90" step="1" value={content.rotateY} oninput={(event) => onUpdate({ rotateY: Number((event.target as HTMLInputElement).value) })} /><output>{content.rotateY}&deg;</output></label>
      <label class="range-row"><span>Rotate Z</span><input type="range" min="-180" max="180" step="1" value={content.rotateZ} oninput={(event) => onUpdate({ rotateZ: Number((event.target as HTMLInputElement).value) })} /><output>{content.rotateZ}&deg;</output></label>
      <label class="range-row"><span>Light</span><input type="range" min="0" max="1" step="0.01" value={content.lightIntensity} oninput={(event) => onUpdate({ lightIntensity: Number((event.target as HTMLInputElement).value) })} /><output>{Math.round(content.lightIntensity * 100)}%</output></label>
      <label class="range-row"><span>Bevel</span><input type="range" min="0" max="10" step="0.5" value={content.bevelSize} oninput={(event) => onUpdate({ bevelSize: Number((event.target as HTMLInputElement).value) })} /><output>{content.bevelSize}px</output></label>
    {/if}
  </section>
</div>

<style>
  .text-clip-panel { display: flex; flex-direction: column; gap: 0; padding: 0 10px 14px; color: var(--ga-ink-1, #ada9a2); font-size: var(--ga-text-control, 12px); }
  /* Flat sections: an eyebrow and a hairline, as in the other clip panels. */
  section { padding: 10px 0; border-top: 1px solid var(--ga-line-1, rgba(245, 236, 222, 0.07)); display: flex; flex-direction: column; gap: 4px; }
  section:first-child { border-top: 0; }
  .section-label { margin-bottom: 4px; color: var(--ga-ink-2, #89857e); font-size: var(--ga-text-eyebrow, 10px); font-weight: 700; letter-spacing: var(--ga-eyebrow-tracking, 0.08em); line-height: 1.2; text-transform: uppercase; }
  textarea { width: 100%; box-sizing: border-box; resize: vertical; border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13)); border-radius: var(--ga-r-hard, 5px); background: var(--ga-slot, #060504); color: var(--ga-ink-0, #f2ede4); padding: 6px 8px; font: inherit; font-size: var(--ga-text-control, 12px); }
  .long-text { margin: 0; color: var(--ga-ink-1, #ada9a2); font-size: var(--ga-text-meta, 11px); }
  .range-row { display: grid; grid-template-columns: 80px minmax(80px, 1fr) 44px; align-items: center; gap: 8px; min-height: var(--ga-control-h, 26px); }
  .range-row input { width: 100%; accent-color: var(--ga-slider-fill, var(--ga-selection-line, #5278ff)); }
  output { color: var(--ga-ink-1, #ada9a2); font: var(--ga-text-meta, 11px) var(--ga-font-mono, monospace); font-variant-numeric: tabular-nums; text-align: right; }
  .select-row, .color-row, .toggle-row, .button-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: var(--ga-control-h, 26px); }
  select { height: var(--ga-control-h, 26px); box-sizing: border-box; min-width: 150px; max-width: 70%; border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13)); border-radius: var(--ga-r-hard, 5px); background: var(--ga-slot, #060504); color: var(--ga-ink-0, #f2ede4); padding: 0 8px; font-size: var(--ga-text-control, 12px); }
  input[type='color'] { width: 38px; height: 22px; padding: 0; border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13)); border-radius: var(--ga-r-hard, 5px); background: transparent; }
  input[type='checkbox'] { accent-color: var(--ga-selection-line, #5278ff); }
  button { height: var(--ga-control-h-sm, 22px); box-sizing: border-box; padding: 0 8px; border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13)); border-radius: var(--ga-r-hard, 5px); background: var(--ga-card, #16140f); color: var(--ga-ink-1, #ada9a2); font-family: inherit; font-size: var(--ga-text-control, 12px); font-weight: var(--ga-weight-control, 600); cursor: pointer; }
  button:hover:not(.active) { border-color: var(--ga-line-3, rgba(245, 236, 222, 0.24)); color: var(--ga-ink-0, #f2ede4); }
  button.active { border-color: var(--ga-selection-line, #5278ff); background: var(--ga-selection-bg, #1f3170); color: var(--ga-selection-ink, #e0e8ff); }
  .button-row div, .color-row div { display: flex; gap: 4px; align-items: center; }
  .button-row button { width: 32px; padding: 0; }
</style>
