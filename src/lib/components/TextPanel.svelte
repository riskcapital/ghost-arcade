<script lang="ts">
  import { project, selectedLayer } from '../stores/layers';
  import type { TextAnimationType } from '../types';
  import { t } from '../i18n';

  // System font list (common cross-platform fonts + variable fonts)
  const systemFonts = [
    'Arial', 'Arial Black', 'Helvetica', 'Verdana', 'Tahoma', 'Trebuchet MS',
    'Impact', 'Georgia', 'Times New Roman', 'Palatino Linotype',
    'Courier New', 'Lucida Console', 'Comic Sans MS',
    'Segoe UI', 'Roboto', 'Open Sans', 'Montserrat', 'Oswald', 'Raleway',
    'Futura', 'Gill Sans', 'Century Gothic', 'Franklin Gothic Medium',
    'Garamond', 'Bookman Old Style', 'Brush Script MT',
    'Copperplate', 'Papyrus', 'Luminari',
  ];

  // Detected system fonts
  let availableFonts: string[] = [...systemFonts];
  let fontsDetected = false;

  // Try to enumerate system fonts (Font Access API)
  async function detectFonts() {
    if (fontsDetected) return;
    if ('queryLocalFonts' in window) {
      try {
        const fonts = await (window as any).queryLocalFonts();
        const families = new Set<string>();
        for (const font of fonts) {
          families.add(font.family);
        }
        if (families.size > 0) {
          availableFonts = [...families].sort();
          fontsDetected = true;
        }
      } catch {
        // Permission denied or not supported - use fallback list
      }
    }
  }
  // Auto-detect on mount (works when permission already granted)
  detectFonts();

  const animationTypes: { value: TextAnimationType; labelKey: string; descriptionKey: string }[] = [
    { value: 'none',
      labelKey: 'textTools.animation.types.none.label',
      descriptionKey: 'textTools.animation.types.none.description',
    },
    { value: 'ticker',
      labelKey: 'textTools.animation.types.ticker.label',
      descriptionKey: 'textTools.animation.types.ticker.description',
    },
    { value: 'letterReveal',
      labelKey: 'textTools.animation.types.letterReveal.label',
      descriptionKey: 'textTools.animation.types.letterReveal.description',
    },
    { value: 'typewriter',
      labelKey: 'textTools.animation.types.typewriter.label',
      descriptionKey: 'textTools.animation.types.typewriter.description',
    },
    { value: 'fadeInLetters',
      labelKey: 'textTools.animation.types.fadeInLetters.label',
      descriptionKey: 'textTools.animation.types.fadeInLetters.description',
    },
    { value: 'waveY',
      labelKey: 'textTools.animation.types.waveY.label',
      descriptionKey: 'textTools.animation.types.waveY.description',
    },
    { value: 'waveX',
      labelKey: 'textTools.animation.types.waveX.label',
      descriptionKey: 'textTools.animation.types.waveX.description',
    },
    { value: 'elastic',
      labelKey: 'textTools.animation.types.elastic.label',
      descriptionKey: 'textTools.animation.types.elastic.description',
    },
    { value: 'scramble',
      labelKey: 'textTools.animation.types.scramble.label',
      descriptionKey: 'textTools.animation.types.scramble.description',
    },
    { value: 'glitch3d',
      labelKey: 'textTools.animation.types.glitch3d.label',
      descriptionKey: 'textTools.animation.types.glitch3d.description',
    },
    { value: 'perspective3d',
      labelKey: 'textTools.animation.types.perspective3d.label',
      descriptionKey: 'textTools.animation.types.perspective3d.description',
    },
    { value: 'flipLetters',
      labelKey: 'textTools.animation.types.flipLetters.label',
      descriptionKey: 'textTools.animation.types.flipLetters.description',
    },
    { value: 'spiralIn',
      labelKey: 'textTools.animation.types.spiralIn.label',
      descriptionKey: 'textTools.animation.types.spiralIn.description',
    },
    { value: 'explode',
      labelKey: 'textTools.animation.types.explode.label',
      descriptionKey: 'textTools.animation.types.explode.description',
    },
    { value: 'liquid',
      labelKey: 'textTools.animation.types.liquid.label',
      descriptionKey: 'textTools.animation.types.liquid.description',
    },
    { value: 'neonPulse',
      labelKey: 'textTools.animation.types.neonPulse.label',
      descriptionKey: 'textTools.animation.types.neonPulse.description',
    },
    { value: 'matrixRain',
      labelKey: 'textTools.animation.types.matrixRain.label',
      descriptionKey: 'textTools.animation.types.matrixRain.description',
    },
    { value: 'bounce',
      labelKey: 'textTools.animation.types.bounce.label',
      descriptionKey: 'textTools.animation.types.bounce.description',
    },
  ];

  $: layer = $selectedLayer;
  $: tc = layer?.textContent;
  $: anim = tc?.animation;
</script>

{#if layer && tc}
  <div class="text-panel">
    <h3>{$t('textTools.textLayer.heading')}</h3>

    <!-- Text Input -->
    <div class="section">
      <label class="section-label">{$t('textTools.labels.text')}</label>
      <textarea
        class="text-input"
        value={tc.text}
        oninput={(e) => project.updateTextContent(layer.id, { text: (e.target as HTMLTextAreaElement).value })}
        rows={3}
        placeholder={$t('textTools.textLayer.placeholder')}
      ></textarea>
    </div>

    <!-- Font Settings -->
    <div class="section">
      <label class="section-label">{$t('textTools.labels.font')}</label>

      <div class="property-row">
        <label>{$t('textTools.labels.family')}</label>
        <select
          value={tc.fontFamily}
          onclick={() => detectFonts()}
          onchange={(e) => project.updateTextContent(layer.id, { fontFamily: (e.target as HTMLSelectElement).value })}
        >
          {#each availableFonts as font}
            <option value={font} style="font-family: '{font}'">{font}</option>
          {/each}
        </select>
      </div>

      <div class="property-row">
        <label>{$t('textTools.labels.size')}</label>
        <input
          type="range" min="12" max="500" step="1"
          value={tc.fontSize}
          oninput={(e) => project.updateTextContent(layer.id, { fontSize: parseInt((e.target as HTMLInputElement).value) })}
        />
        <span class="value">{tc.fontSize}px</span>
      </div>

      <div class="property-row">
        <label>{$t('textTools.labels.weight')}</label>
        <input
          type="range" min="100" max="900" step="100"
          value={tc.fontWeight}
          oninput={(e) => project.updateTextContent(layer.id, { fontWeight: parseInt((e.target as HTMLInputElement).value) })}
        />
        <span class="value">{tc.fontWeight}</span>
      </div>

      <div class="property-row">
        <label>{$t('textTools.labels.style')}</label>
        <select
          value={tc.fontStyle}
          onchange={(e) => project.updateTextContent(layer.id, { fontStyle: (e.target as HTMLSelectElement).value as 'normal' | 'italic',
            })}
        >
          <option value="normal">{$t('textTools.labels.normal')}</option>
          <option value="italic">{$t('textTools.labels.italic')}</option>
        </select>
      </div>

      <div class="property-row">
        <label>{$t('textTools.labels.align')}</label>
        <div class="button-group">
          <button class:active={tc.alignment === 'left'} onclick={() => project.updateTextContent(layer.id, { alignment: 'left' })}>L</button>
          <button class:active={tc.alignment === 'center'} onclick={() => project.updateTextContent(layer.id, { alignment: 'center' })}>C</button>
          <button class:active={tc.alignment === 'right'} onclick={() => project.updateTextContent(layer.id, { alignment: 'right' })}>R</button>
        </div>
      </div>
    </div>

    <!-- Spacing -->
    <div class="section">
      <label class="section-label">{$t('textTools.labels.spacing')}</label>

      <div class="property-row">
        <label>{$t('textTools.labels.letter')}</label>
        <input
          type="range" min="-20" max="50" step="1"
          value={tc.letterSpacing}
          oninput={(e) => project.updateTextContent(layer.id, { letterSpacing: parseInt((e.target as HTMLInputElement).value) })}
        />
        <span class="value">{tc.letterSpacing}px</span>
      </div>

      <div class="property-row">
        <label>{$t('textTools.labels.lineHeight')}</label>
        <input
          type="range" min="0.5" max="3" step="0.05"
          value={tc.lineHeight}
          oninput={(e) => project.updateTextContent(layer.id, { lineHeight: parseFloat((e.target as HTMLInputElement).value) })}
        />
        <span class="value">{tc.lineHeight.toFixed(2)}</span>
      </div>
    </div>

    <!-- Colors -->
    <div class="section">
      <label class="section-label">{$t('textTools.labels.colors')}</label>

      <div class="property-row">
        <label>{$t('textTools.labels.fill')}</label>
        <input
          type="color"
          value={tc.color}
          oninput={(e) => project.updateTextContent(layer.id, { color: (e.target as HTMLInputElement).value })}
        />
      </div>

      <div class="property-row">
        <label>{$t('textTools.labels.stroke')}</label>
        <input
          type="color"
          value={tc.strokeColor}
          oninput={(e) => project.updateTextContent(layer.id, { strokeColor: (e.target as HTMLInputElement).value })}
        />
      </div>

      <div class="property-row">
        <label>{$t('textTools.labels.strokeWidth')}</label>
        <input
          type="range" min="0" max="20" step="0.5"
          value={tc.strokeWidth}
          oninput={(e) => project.updateTextContent(layer.id, { strokeWidth: parseFloat((e.target as HTMLInputElement).value) })}
        />
        <span class="value">{tc.strokeWidth}px</span>
      </div>

      <div class="property-row">
        <label>{$t('textTools.labels.background')}</label>
        <input
          type="color"
          value={tc.backgroundColor === 'transparent' ? '#000000' : tc.backgroundColor}
          oninput={(e) => project.updateTextContent(layer.id, { backgroundColor: (e.target as HTMLInputElement).value })}
        />
        <button
          class="btn-small"
          onclick={() => project.updateTextContent(layer.id, { backgroundColor: 'transparent' })}
        >{$t('textTools.labels.clear')}</button>
      </div>
    </div>

    <!-- Shadow -->
    <div class="section">
      <label class="section-label">{$t('textTools.labels.shadow')}</label>

      <div class="property-row">
        <label>{$t('textTools.labels.color')}</label>
        <input
          type="color"
          value={tc.shadowColor.startsWith('rgba') ? '#000000' : tc.shadowColor}
          oninput={(e) => project.updateTextContent(layer.id, { shadowColor: (e.target as HTMLInputElement).value })}
        />
      </div>

      <div class="property-row">
        <label>{$t('textTools.labels.blur')}</label>
        <input
          type="range" min="0" max="50" step="1"
          value={tc.shadowBlur}
          oninput={(e) => project.updateTextContent(layer.id, { shadowBlur: parseFloat((e.target as HTMLInputElement).value) })}
        />
        <span class="value">{tc.shadowBlur}px</span>
      </div>

      <div class="property-row">
        <label>{$t('textTools.labels.offsetX')}</label>
        <input
          type="range" min="-30" max="30" step="1"
          value={tc.shadowOffsetX}
          oninput={(e) => project.updateTextContent(layer.id, { shadowOffsetX: parseFloat((e.target as HTMLInputElement).value) })}
        />
        <span class="value">{tc.shadowOffsetX}px</span>
      </div>

      <div class="property-row">
        <label>{$t('textTools.labels.offsetY')}</label>
        <input
          type="range" min="-30" max="30" step="1"
          value={tc.shadowOffsetY}
          oninput={(e) => project.updateTextContent(layer.id, { shadowOffsetY: parseFloat((e.target as HTMLInputElement).value) })}
        />
        <span class="value">{tc.shadowOffsetY}px</span>
      </div>
    </div>

    <!-- 3D Extrusion -->
    <div class="section">
      <label class="section-label">{$t('textTools.labels.threeD')}</label>

      <div class="property-row">
        <label>
          <input
            type="checkbox"
            checked={tc.enable3D}
            onchange={() => project.updateTextContent(layer.id, { enable3D: !tc.enable3D })}
          />
          {$t('textTools.labels.enableThreeD')}
        </label>
      </div>

      {#if tc.enable3D}
        <div class="property-row">
          <label>{$t('textTools.labels.depth')}</label>
          <input
            type="range" min="1" max="100" step="1"
            value={tc.extrudeDepth}
            oninput={(e) => project.updateTextContent(layer.id, { extrudeDepth: parseInt((e.target as HTMLInputElement).value) })}
          />
          <span class="value">{tc.extrudeDepth}px</span>
        </div>

        <div class="property-row">
          <label>{$t('textTools.labels.extrudeColor')}</label>
          <input
            type="color"
            value={tc.extrudeColor}
            oninput={(e) => project.updateTextContent(layer.id, { extrudeColor: (e.target as HTMLInputElement).value })}
          />
        </div>

        <div class="property-row">
          <label>{$t('textTools.labels.rotateX')}</label>
          <input
            type="range" min="-90" max="90" step="1"
            value={tc.rotateX}
            oninput={(e) => project.updateTextContent(layer.id, { rotateX: parseInt((e.target as HTMLInputElement).value) })}
          />
          <span class="value">{tc.rotateX}&deg;</span>
        </div>

        <div class="property-row">
          <label>{$t('textTools.labels.rotateY')}</label>
          <input
            type="range" min="-90" max="90" step="1"
            value={tc.rotateY}
            oninput={(e) => project.updateTextContent(layer.id, { rotateY: parseInt((e.target as HTMLInputElement).value) })}
          />
          <span class="value">{tc.rotateY}&deg;</span>
        </div>

        <div class="property-row">
          <label>{$t('textTools.labels.rotateZ')}</label>
          <input
            type="range" min="-180" max="180" step="1"
            value={tc.rotateZ}
            oninput={(e) => project.updateTextContent(layer.id, { rotateZ: parseInt((e.target as HTMLInputElement).value) })}
          />
          <span class="value">{tc.rotateZ}&deg;</span>
        </div>

        <div class="property-row">
          <label>{$t('textTools.labels.lightAngle')}</label>
          <input
            type="range" min="0" max="360" step="1"
            value={tc.lightAngle}
            oninput={(e) => project.updateTextContent(layer.id, { lightAngle: parseInt((e.target as HTMLInputElement).value) })}
          />
          <span class="value">{tc.lightAngle}&deg;</span>
        </div>

        <div class="property-row">
          <label>{$t('textTools.labels.light')}</label>
          <input
            type="range" min="0" max="1" step="0.01"
            value={tc.lightIntensity}
            oninput={(e) => project.updateTextContent(layer.id, { lightIntensity: parseFloat((e.target as HTMLInputElement).value) })}
          />
          <span class="value">{(tc.lightIntensity * 100).toFixed(0)}%</span>
        </div>

        <div class="property-row">
          <label>{$t('textTools.labels.bevel')}</label>
          <input
            type="range" min="0" max="10" step="0.5"
            value={tc.bevelSize}
            oninput={(e) => project.updateTextContent(layer.id, { bevelSize: parseFloat((e.target as HTMLInputElement).value) })}
          />
          <span class="value">{tc.bevelSize}px</span>
        </div>
      {/if}
    </div>

    <!-- Animation -->
    <div class="section animation-section">
      <label class="section-label">{$t('textTools.labels.animation')}</label>

      <div class="property-row">
        <label>{$t('textTools.labels.type')}</label>
        <select
          value={anim?.type ?? 'none'}
          onchange={(e) => project.updateTextAnimation(layer.id, { type: (e.target as HTMLSelectElement).value as TextAnimationType })}
        >
          {#each animationTypes as at}
            <option value={at.value} title={$t(at.descriptionKey)}>{$t(at.labelKey)}</option>
          {/each}
        </select>
      </div>

      {#if anim && anim.type !== 'none'}
        <div class="property-row">
          <label>{$t('textTools.labels.speed')}</label>
          <input
            type="range" min="0.1" max="5" step="0.1"
            value={anim.speed}
            oninput={(e) => project.updateTextAnimation(layer.id, { speed: parseFloat((e.target as HTMLInputElement).value) })}
          />
          <span class="value">{anim.speed.toFixed(1)}x</span>
        </div>

        <div class="property-row">
          <label>{$t('textTools.labels.intensity')}</label>
          <input
            type="range" min="0" max="1" step="0.01"
            value={anim.intensity}
            oninput={(e) => project.updateTextAnimation(layer.id, { intensity: parseFloat((e.target as HTMLInputElement).value) })}
          />
          <span class="value">{(anim.intensity * 100).toFixed(0)}%</span>
        </div>

        <div class="property-row">
          <label>{$t('textTools.labels.stagger')}</label>
          <input
            type="range" min="0.01" max="0.5" step="0.01"
            value={anim.staggerDelay}
            oninput={(e) => project.updateTextAnimation(layer.id, { staggerDelay: parseFloat((e.target as HTMLInputElement).value) })}
          />
          <span class="value">{(anim.staggerDelay * 1000).toFixed(0)}ms</span>
        </div>

        <div class="property-row">
          <label>
            <input
              type="checkbox"
              checked={anim.loop}
              onchange={() => project.updateTextAnimation(layer.id, { loop: !anim.loop })}
            />
            {$t('textTools.labels.loop')}
          </label>
        </div>

        <div class="property-row">
          <label>{$t('textTools.labels.direction')}</label>
          <select
            value={anim.direction}
            onchange={(e) => project.updateTextAnimation(layer.id, { direction: (e.target as HTMLSelectElement).value as 'forward' | 'reverse' | 'alternate',
              })}
          >
            <option value="forward">{$t('textTools.labels.forward')}</option>
            <option value="reverse">{$t('textTools.labels.reverse')}</option>
            <option value="alternate">{$t('textTools.labels.alternate')}</option>
          </select>
        </div>
      {/if}
    </div>

    <!-- Animation Description -->
    {#if anim && anim.type !== 'none'}
      <div class="anim-description">
        {$t(animationTypes.find((a) => a.value === anim.type)?.descriptionKey ?? '')}
      </div>
    {/if}
  </div>
{/if}

<style>
  .text-panel {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px;
    overflow-y: auto;
    max-height: 100%;
    font-size: 12px;
    color: var(--text-primary, #ccc);
  }

  h3 {
    margin: 0 0 6px 0;
    font-size: 14px;
    color: #fff;
    border-bottom: 1px solid #444;
    padding-bottom: 4px;
  }

  .section {
    background: #0d0d14;
    border-radius: 4px;
    padding: 6px;
    margin-bottom: 4px;
  }

  .section-label {
    display: block;
    font-size: 11px;
    color: var(--text-muted, #888);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 4px;
  }

  .text-input {
    width: 100%;
    background: #111;
    border: 1px solid #333;
    color: #fff;
    padding: 6px;
    font-size: 13px;
    border-radius: 3px;
    resize: vertical;
    font-family: inherit;
    box-sizing: border-box;
  }

  .text-input:focus {
    border-color: #ff00aa;
    outline: none;
  }

  .property-row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 3px;
  }

  .property-row > label {
    min-width: 55px;
    font-size: 11px;
    color: var(--text-secondary, #aaa);
    flex-shrink: 0;
  }

  .property-row input[type='range'] {
    flex: 1;
    height: 4px;
    accent-color: #ff00aa;
  }

  .property-row input[type='color'] {
    width: 28px;
    height: 22px;
    border: 1px solid #444;
    background: none;
    cursor: pointer;
    padding: 0;
    border-radius: 3px;
  }

  .property-row select {
    flex: 1;
    background: #111;
    border: 1px solid #333;
    color: var(--text-primary, #ccc);
    padding: 2px 4px;
    font-size: 11px;
    border-radius: 3px;
  }

  .value {
    min-width: 38px;
    text-align: right;
    font-size: 10px;
    color: var(--text-muted, #888);
    font-family: var(--ga-font-mono, 'IBM Plex Mono', ui-monospace, monospace);
  }

  .button-group {
    display: flex;
    gap: 2px;
  }

  .button-group button {
    background: #222;
    border: 1px solid #444;
    color: var(--text-secondary, #aaa);
    padding: 2px 8px;
    font-size: 11px;
    cursor: pointer;
    border-radius: 2px;
  }

  .button-group button.active {
    background: #ff00aa;
    color: #fff;
    border-color: #ff00aa;
  }

  .button-group button:hover {
    background: #333;
  }

  .btn-small {
    background: #222;
    border: 1px solid #444;
    color: var(--text-secondary, #aaa);
    padding: 1px 6px;
    font-size: 10px;
    cursor: pointer;
    border-radius: 2px;
  }

  .btn-small:hover {
    background: #333;
  }

  .animation-section select {
    font-size: 11px;
  }

  .anim-description {
    font-size: 10px;
    color: #666;
    font-style: italic;
    padding: 2px 6px;
  }

  .property-row input[type='checkbox'] {
    accent-color: #ff00aa;
  }
</style>
