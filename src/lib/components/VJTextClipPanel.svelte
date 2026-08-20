<script lang="ts">
  import type { TextAnimation, TextAnimationType, TextContent } from '../types';
  import { t } from '../i18n';

  export let content: TextContent;
  export let onUpdate: (updates: Partial<TextContent>) => void;

  const fonts = [
    'Arial', 'Arial Black', 'Helvetica', 'Verdana', 'Tahoma', 'Trebuchet MS',
    'Impact', 'Georgia', 'Times New Roman', 'Courier New', 'Segoe UI', 'Roboto',
    'Montserrat', 'Oswald', 'Futura', 'Gill Sans', 'Century Gothic', 'Copperplate',
  ];
  const animations: { value: TextAnimationType; labelKey: string }[] = [
    { value: 'none', labelKey: 'textTools.animation.types.none.label' }, { value: 'ticker', labelKey: 'textTools.animation.types.ticker.label' },
    { value: 'letterReveal', labelKey: 'textTools.animation.types.letterReveal.label' }, { value: 'typewriter', labelKey: 'textTools.animation.types.typewriter.label' },
    { value: 'fadeInLetters', labelKey: 'textTools.animation.types.fadeInLetters.label' }, { value: 'waveY', labelKey: 'textTools.animation.types.waveY.label' },
    { value: 'waveX', labelKey: 'textTools.animation.types.waveX.label' }, { value: 'elastic', labelKey: 'textTools.animation.types.elastic.label' },
    { value: 'scramble', labelKey: 'textTools.animation.types.scramble.label' }, { value: 'glitch3d', labelKey: 'textTools.animation.types.glitch3d.label' },
    { value: 'perspective3d', labelKey: 'textTools.animation.types.perspective3d.label' }, { value: 'flipLetters', labelKey: 'textTools.animation.types.flipLetters.label' },
    { value: 'spiralIn', labelKey: 'textTools.animation.types.spiralIn.label' }, { value: 'explode', labelKey: 'textTools.animation.types.explode.label' },
    { value: 'liquid', labelKey: 'textTools.animation.types.liquid.label' }, { value: 'neonPulse', labelKey: 'textTools.animation.types.neonPulse.label' },
    { value: 'matrixRain', labelKey: 'textTools.animation.types.matrixRain.label' }, { value: 'bounce', labelKey: 'textTools.animation.types.bounce.label' },
  ];

  function setAnimation(updates: Partial<TextAnimation>) {
    onUpdate({ animation: { ...content.animation, ...updates } });
  }
</script>

<div class="text-clip-panel">
  <section>
    <div class="section-label">{$t('textTools.labels.text')}</div>
    <textarea rows="3" value={content.text} oninput={(event) => onUpdate({ text: (event.target as HTMLTextAreaElement).value })}></textarea>
  </section>

  <section>
    <div class="section-label">{$t('textTools.labels.typography')}</div>
    <label class="select-row"><span>{$t('textTools.labels.font')}</span><select value={content.fontFamily} onchange={(event) => onUpdate({ fontFamily: (event.target as HTMLSelectElement).value })}>{#each fonts as font}<option value={font}>{font}</option>{/each}</select></label>
    <label class="range-row"><span>{$t('textTools.labels.size')}</span><input type="range" min="12" max="500" step="1" value={content.fontSize} oninput={(event) => onUpdate({ fontSize: Number((event.target as HTMLInputElement).value) })} /><output>{content.fontSize}px</output></label>
    <label class="range-row"><span>{$t('textTools.labels.weight')}</span><input type="range" min="100" max="900" step="100" value={content.fontWeight} oninput={(event) => onUpdate({ fontWeight: Number((event.target as HTMLInputElement).value) })} /><output>{content.fontWeight}</output></label>
    <label class="select-row"><span>{$t('textTools.labels.style')}</span><select value={content.fontStyle} onchange={(event) => onUpdate({ fontStyle: (event.target as HTMLSelectElement).value as 'normal' | 'italic' })}><option value="normal">{$t('textTools.labels.normal')}</option><option value="italic">{$t('textTools.labels.italic')}</option></select></label>
    <div class="button-row"><span>{$t('textTools.labels.align')}</span><div>{#each ['left', 'center', 'right'] as alignment}<button class:active={content.alignment === alignment} onclick={() => onUpdate({ alignment: alignment as TextContent['alignment'] })}>{alignment.slice(0, 1).toUpperCase()}</button>{/each}</div></div>
    <label class="range-row"><span>{$t('textTools.labels.letter')}</span><input type="range" min="-20" max="50" step="1" value={content.letterSpacing} oninput={(event) => onUpdate({ letterSpacing: Number((event.target as HTMLInputElement).value) })} /><output>{content.letterSpacing}px</output></label>
    <label class="range-row"><span>{$t('textTools.labels.line')}</span><input type="range" min="0.5" max="3" step="0.05" value={content.lineHeight} oninput={(event) => onUpdate({ lineHeight: Number((event.target as HTMLInputElement).value) })} /><output>{content.lineHeight.toFixed(2)}</output></label>
  </section>

  <section>
    <div class="section-label">{$t('textTools.labels.appearance')}</div>
    <label class="color-row"><span>{$t('textTools.labels.fill')}</span><input type="color" value={content.color} oninput={(event) => onUpdate({ color: (event.target as HTMLInputElement).value })} /></label>
    <label class="color-row"><span>{$t('textTools.labels.stroke')}</span><input type="color" value={content.strokeColor} oninput={(event) => onUpdate({ strokeColor: (event.target as HTMLInputElement).value })} /></label>
    <label class="range-row"><span>{$t('textTools.labels.strokeWidth')}</span><input type="range" min="0" max="20" step="0.5" value={content.strokeWidth} oninput={(event) => onUpdate({ strokeWidth: Number((event.target as HTMLInputElement).value) })} /><output>{content.strokeWidth}px</output></label>
    <div class="color-row"><span>{$t('textTools.labels.background')}</span><div><input type="color" value={content.backgroundColor === 'transparent' ? '#000000' : content.backgroundColor} oninput={(event) => onUpdate({ backgroundColor: (event.target as HTMLInputElement).value })} /><button onclick={() => onUpdate({ backgroundColor: 'transparent' })}>{$t('textTools.labels.clear')}</button></div></div>
    <label class="color-row"><span>{$t('textTools.labels.shadow')}</span><input type="color" value={content.shadowColor.startsWith('rgba') ? '#000000' : content.shadowColor} oninput={(event) => onUpdate({ shadowColor: (event.target as HTMLInputElement).value })} /></label>
    <label class="range-row"><span>{$t('textTools.labels.shadowBlur')}</span><input type="range" min="0" max="50" step="1" value={content.shadowBlur} oninput={(event) => onUpdate({ shadowBlur: Number((event.target as HTMLInputElement).value) })} /><output>{content.shadowBlur}px</output></label>
  </section>

  <section>
    <div class="section-label">{$t('textTools.labels.animation')}</div>
    <label class="select-row"><span>{$t('textTools.labels.type')}</span><select value={content.animation.type} onchange={(event) => setAnimation({ type: (event.target as HTMLSelectElement).value as TextAnimationType })}>{#each animations as animation}<option value={animation.value}>{$t(animation.labelKey)}</option>{/each}</select></label>
    {#if content.animation.type !== 'none'}
      <label class="range-row"><span>{$t('textTools.labels.speed')}</span><input type="range" min="0.1" max="5" step="0.1" value={content.animation.speed} oninput={(event) => setAnimation({ speed: Number((event.target as HTMLInputElement).value) })} /><output>{content.animation.speed.toFixed(1)}x</output></label>
      <label class="range-row"><span>{$t('textTools.labels.intensity')}</span><input type="range" min="0" max="1" step="0.01" value={content.animation.intensity} oninput={(event) => setAnimation({ intensity: Number((event.target as HTMLInputElement).value) })} /><output>{Math.round(content.animation.intensity * 100)}%</output></label>
      <label class="range-row"><span>{$t('textTools.labels.stagger')}</span><input type="range" min="0.01" max="0.5" step="0.01" value={content.animation.staggerDelay} oninput={(event) => setAnimation({ staggerDelay: Number((event.target as HTMLInputElement).value) })} /><output>{Math.round(content.animation.staggerDelay * 1000)}ms</output></label>
      <label class="select-row"><span>{$t('textTools.labels.direction')}</span><select value={content.animation.direction} onchange={(event) => setAnimation({ direction: (event.target as HTMLSelectElement).value as TextAnimation['direction'] })}><option value="forward">{$t('textTools.labels.forward')}</option><option value="reverse">{$t('textTools.labels.reverse')}</option><option value="alternate">{$t('textTools.labels.alternate')}</option></select></label>
      <label class="toggle-row"><span>{$t('textTools.labels.loop')}</span><input type="checkbox" checked={content.animation.loop} onchange={(event) => setAnimation({ loop: (event.target as HTMLInputElement).checked })} /></label>
    {/if}
  </section>

  <section>
    <div class="section-label">{$t('textTools.labels.threeD')}</div>
    <label class="toggle-row"><span>{$t('textTools.labels.enableThreeD')}</span><input type="checkbox" checked={content.enable3D} onchange={(event) => onUpdate({ enable3D: (event.target as HTMLInputElement).checked })} /></label>
    {#if content.enable3D}
      <label class="range-row"><span>{$t('textTools.labels.depth')}</span><input type="range" min="1" max="100" step="1" value={content.extrudeDepth} oninput={(event) => onUpdate({ extrudeDepth: Number((event.target as HTMLInputElement).value) })} /><output>{content.extrudeDepth}px</output></label>
      <label class="color-row"><span>{$t('textTools.labels.depthColor')}</span><input type="color" value={content.extrudeColor} oninput={(event) => onUpdate({ extrudeColor: (event.target as HTMLInputElement).value })} /></label>
      <label class="range-row"><span>{$t('textTools.labels.rotateX')}</span><input type="range" min="-90" max="90" step="1" value={content.rotateX} oninput={(event) => onUpdate({ rotateX: Number((event.target as HTMLInputElement).value) })} /><output>{content.rotateX}&deg;</output></label>
      <label class="range-row"><span>{$t('textTools.labels.rotateY')}</span><input type="range" min="-90" max="90" step="1" value={content.rotateY} oninput={(event) => onUpdate({ rotateY: Number((event.target as HTMLInputElement).value) })} /><output>{content.rotateY}&deg;</output></label>
      <label class="range-row"><span>{$t('textTools.labels.rotateZ')}</span><input type="range" min="-180" max="180" step="1" value={content.rotateZ} oninput={(event) => onUpdate({ rotateZ: Number((event.target as HTMLInputElement).value) })} /><output>{content.rotateZ}&deg;</output></label>
      <label class="range-row"><span>{$t('textTools.labels.light')}</span><input type="range" min="0" max="1" step="0.01" value={content.lightIntensity} oninput={(event) => onUpdate({ lightIntensity: Number((event.target as HTMLInputElement).value) })} /><output>{Math.round(content.lightIntensity * 100)}%</output></label>
      <label class="range-row"><span>{$t('textTools.labels.bevel')}</span><input type="range" min="0" max="10" step="0.5" value={content.bevelSize} oninput={(event) => onUpdate({ bevelSize: Number((event.target as HTMLInputElement).value) })} /><output>{content.bevelSize}px</output></label>
    {/if}
  </section>
</div>

<style>
  .text-clip-panel { display: flex; flex-direction: column; gap: 7px; padding: 8px 10px 14px; color: #c9cbd3; font-size: 12px; }
  section { padding: 7px; border: 1px solid #292b34; background: #111219; }
  .section-label { margin-bottom: 7px; color: #8e919b; font-size: 10px; letter-spacing: 1px; text-transform: uppercase; }
  textarea { width: 100%; box-sizing: border-box; resize: vertical; border: 1px solid #343641; border-radius: 3px; background: #08090d; color: #fff; padding: 7px; font: inherit; }
  .range-row { display: grid; grid-template-columns: 72px minmax(80px, 1fr) 42px; align-items: center; gap: 7px; min-height: 28px; }
  .range-row input { width: 100%; accent-color: #49d298; }
  output { color: #66e0f2; font: 10px var(--ga-font-mono, monospace); text-align: right; }
  .select-row, .color-row, .toggle-row, .button-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 30px; }
  select { min-width: 150px; max-width: 70%; border: 1px solid #343641; border-radius: 3px; background: #08090d; color: #d7d9df; padding: 5px 7px; }
  input[type='color'] { width: 38px; height: 25px; padding: 0; border: 1px solid #3b3e49; background: transparent; }
  input[type='checkbox'] { accent-color: #b67aff; }
  button { min-height: 25px; border: 1px solid #3a3d48; border-radius: 3px; background: #1b1d25; color: #b8bac2; cursor: pointer; }
  button.active { border-color: #c27aff; background: #6d3a8c; color: #fff; }
  .button-row div, .color-row div { display: flex; gap: 3px; align-items: center; }
  .button-row button { width: 31px; }
</style>
