<script lang="ts">
  import { project, selectedLayer } from '../stores/layers';
  import type { TextAnimationType } from '../types';
  import TextMotionControls from './TextMotionControls.svelte';
  import { TEXT_ANIMATIONS, TEXT_ANIMATION_GROUPS, TEXT_EDIT_LIMIT, wordCount } from '../text/textMotionCatalog';
  import { installedFontChoices, isFontInstalled } from '../text/fontAvailability';

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

  const animationTypes = TEXT_ANIMATIONS;

  $: layer = $selectedLayer;
  $: tc = layer?.textContent;
  // Only fonts this computer has: a missing one draws as the default font.
  $: fontChoices = installedFontChoices(availableFonts, tc?.fontFamily);
  $: anim = tc?.animation;
</script>

{#if layer && tc}
  <div data-help-page="layers" class="text-panel">
    <h3>Text layer</h3>

    <!-- Text Input -->
    <div class="section">
      <label class="section-label">Text</label>
      {#if tc.text.length > TEXT_EDIT_LIMIT}
        <div class="long-text">
          <span>{wordCount(tc.text).toLocaleString()} words loaded. It begins: “{tc.text.slice(0, 90).replace(/\s+/g, ' ')}…”</span>
          <button type="button" onclick={() => project.updateTextContent(layer.id, { text: '' })}>Clear</button>
        </div>
      {:else}
        <textarea
          class="text-input"
          value={tc.text}
          oninput={(e) => project.updateTextContent(layer.id, { text: (e.target as HTMLTextAreaElement).value })}
          rows={3}
          placeholder="Enter text…"
        ></textarea>
      {/if}
    </div>

    <!-- Tile and long text -->
    <div class="section">
      <label class="section-label">Repeat and Read</label>
      <TextMotionControls content={tc} onUpdate={(updates) => project.updateTextContent(layer.id, updates)} />
    </div>

    <!-- Font Settings -->
    <div class="section">
      <label class="section-label">Font</label>

      <div class="property-row">
        <label>Family</label>
        <select
          value={tc.fontFamily}
          onclick={() => detectFonts()}
          onchange={(e) => project.updateTextContent(layer.id, { fontFamily: (e.target as HTMLSelectElement).value })}
        >
          {#each fontChoices as font}
            <option value={font} style="font-family: '{font}'">{isFontInstalled(font) ? font : `${font} (not installed)`}</option>
          {/each}
        </select>
      </div>

      <div class="property-row">
        <label>Size</label>
        <input
          type="range" min="12" max="500" step="1"
          value={tc.fontSize}
          oninput={(e) => project.updateTextContent(layer.id, { fontSize: parseInt((e.target as HTMLInputElement).value) })}
        />
        <span class="value">{tc.fontSize}px</span>
      </div>

      <div class="property-row">
        <label>Weight</label>
        <input
          type="range" min="100" max="900" step="100"
          value={tc.fontWeight}
          oninput={(e) => project.updateTextContent(layer.id, { fontWeight: parseInt((e.target as HTMLInputElement).value) })}
        />
        <span class="value">{tc.fontWeight}</span>
      </div>

      <div class="property-row">
        <label>Style</label>
        <select
          value={tc.fontStyle}
          onchange={(e) => project.updateTextContent(layer.id, { fontStyle: (e.target as HTMLSelectElement).value as 'normal' | 'italic' })}
        >
          <option value="normal">Normal</option>
          <option value="italic">Italic</option>
        </select>
      </div>

      <div class="property-row">
        <label>Align</label>
        <div class="button-group">
          <button class:active={tc.alignment === 'left'} onclick={() => project.updateTextContent(layer.id, { alignment: 'left' })}>L</button>
          <button class:active={tc.alignment === 'center'} onclick={() => project.updateTextContent(layer.id, { alignment: 'center' })}>C</button>
          <button class:active={tc.alignment === 'right'} onclick={() => project.updateTextContent(layer.id, { alignment: 'right' })}>R</button>
        </div>
      </div>
    </div>

    <!-- Spacing -->
    <div class="section">
      <label class="section-label">Spacing</label>

      <div class="property-row">
        <label>Letter</label>
        <input
          type="range" min="-20" max="50" step="1"
          value={tc.letterSpacing}
          oninput={(e) => project.updateTextContent(layer.id, { letterSpacing: parseInt((e.target as HTMLInputElement).value) })}
        />
        <span class="value">{tc.letterSpacing}px</span>
      </div>

      <div class="property-row">
        <label>Line height</label>
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
      <label class="section-label">Colors</label>

      <div class="property-row">
        <label>Fill</label>
        <input
          type="color"
          value={tc.color}
          oninput={(e) => project.updateTextContent(layer.id, { color: (e.target as HTMLInputElement).value })}
        />
      </div>

      <div class="property-row">
        <label>Stroke</label>
        <input
          type="color"
          value={tc.strokeColor}
          oninput={(e) => project.updateTextContent(layer.id, { strokeColor: (e.target as HTMLInputElement).value })}
        />
      </div>

      <div class="property-row">
        <label>Stroke width</label>
        <input
          type="range" min="0" max="20" step="0.5"
          value={tc.strokeWidth}
          oninput={(e) => project.updateTextContent(layer.id, { strokeWidth: parseFloat((e.target as HTMLInputElement).value) })}
        />
        <span class="value">{tc.strokeWidth}px</span>
      </div>

      <div class="property-row">
        <label>Background</label>
        <input
          type="color"
          value={tc.backgroundColor === 'transparent' ? '#000000' : tc.backgroundColor}
          oninput={(e) => project.updateTextContent(layer.id, { backgroundColor: (e.target as HTMLInputElement).value })}
        />
        <button
          class="btn-small"
          onclick={() => project.updateTextContent(layer.id, { backgroundColor: 'transparent' })}
        >Clear</button>
      </div>
    </div>

    <!-- Shadow -->
    <div class="section">
      <label class="section-label">Shadow</label>

      <div class="property-row">
        <label>Color</label>
        <input
          type="color"
          value={tc.shadowColor.startsWith('rgba') ? '#000000' : tc.shadowColor}
          oninput={(e) => project.updateTextContent(layer.id, { shadowColor: (e.target as HTMLInputElement).value })}
        />
      </div>

      <div class="property-row">
        <label>Blur</label>
        <input
          type="range" min="0" max="50" step="1"
          value={tc.shadowBlur}
          oninput={(e) => project.updateTextContent(layer.id, { shadowBlur: parseFloat((e.target as HTMLInputElement).value) })}
        />
        <span class="value">{tc.shadowBlur}px</span>
      </div>

      <div class="property-row">
        <label>Offset X</label>
        <input
          type="range" min="-30" max="30" step="1"
          value={tc.shadowOffsetX}
          oninput={(e) => project.updateTextContent(layer.id, { shadowOffsetX: parseFloat((e.target as HTMLInputElement).value) })}
        />
        <span class="value">{tc.shadowOffsetX}px</span>
      </div>

      <div class="property-row">
        <label>Offset Y</label>
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
      <label class="section-label">3D</label>

      <div class="property-row">
        <label>
          <input
            type="checkbox"
            checked={tc.enable3D}
            onchange={() => project.updateTextContent(layer.id, { enable3D: !tc.enable3D })}
          />
          Enable 3D
        </label>
      </div>

      {#if tc.enable3D}
        <div class="property-row">
          <label>Depth</label>
          <input
            type="range" min="1" max="100" step="1"
            value={tc.extrudeDepth}
            oninput={(e) => project.updateTextContent(layer.id, { extrudeDepth: parseInt((e.target as HTMLInputElement).value) })}
          />
          <span class="value">{tc.extrudeDepth}px</span>
        </div>

        <div class="property-row">
          <label>Extrude color</label>
          <input
            type="color"
            value={tc.extrudeColor}
            oninput={(e) => project.updateTextContent(layer.id, { extrudeColor: (e.target as HTMLInputElement).value })}
          />
        </div>

        <div class="property-row">
          <label>Rotate X</label>
          <input
            type="range" min="-90" max="90" step="1"
            value={tc.rotateX}
            oninput={(e) => project.updateTextContent(layer.id, { rotateX: parseInt((e.target as HTMLInputElement).value) })}
          />
          <span class="value">{tc.rotateX}&deg;</span>
        </div>

        <div class="property-row">
          <label>Rotate Y</label>
          <input
            type="range" min="-90" max="90" step="1"
            value={tc.rotateY}
            oninput={(e) => project.updateTextContent(layer.id, { rotateY: parseInt((e.target as HTMLInputElement).value) })}
          />
          <span class="value">{tc.rotateY}&deg;</span>
        </div>

        <div class="property-row">
          <label>Rotate Z</label>
          <input
            type="range" min="-180" max="180" step="1"
            value={tc.rotateZ}
            oninput={(e) => project.updateTextContent(layer.id, { rotateZ: parseInt((e.target as HTMLInputElement).value) })}
          />
          <span class="value">{tc.rotateZ}&deg;</span>
        </div>

        <div class="property-row">
          <label>Light angle</label>
          <input
            type="range" min="0" max="360" step="1"
            value={tc.lightAngle}
            oninput={(e) => project.updateTextContent(layer.id, { lightAngle: parseInt((e.target as HTMLInputElement).value) })}
          />
          <span class="value">{tc.lightAngle}&deg;</span>
        </div>

        <div class="property-row">
          <label>Light</label>
          <input
            type="range" min="0" max="1" step="0.01"
            value={tc.lightIntensity}
            oninput={(e) => project.updateTextContent(layer.id, { lightIntensity: parseFloat((e.target as HTMLInputElement).value) })}
          />
          <span class="value">{(tc.lightIntensity * 100).toFixed(0)}%</span>
        </div>

        <div class="property-row">
          <label>Bevel</label>
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
      <label class="section-label">Animation</label>

      <div class="property-row">
        <label>Type</label>
        <select
          value={anim?.type ?? 'none'}
          onchange={(e) => project.updateTextAnimation(layer.id, { type: (e.target as HTMLSelectElement).value as TextAnimationType })}
        >
          {#each TEXT_ANIMATION_GROUPS as group}
            <optgroup label={group}>
              {#each animationTypes.filter(a => a.group === group) as at}<option value={at.value}>{at.label}</option>{/each}
            </optgroup>
          {/each}
        </select>
      </div>

      {#if anim && anim.type !== 'none'}
        <div class="property-row">
          <label>Speed</label>
          <input
            type="range" min="0.1" max="5" step="0.1"
            value={anim.speed}
            oninput={(e) => project.updateTextAnimation(layer.id, { speed: parseFloat((e.target as HTMLInputElement).value) })}
          />
          <span class="value">{anim.speed.toFixed(1)}x</span>
        </div>

        <div class="property-row">
          <label>Intensity</label>
          <input
            type="range" min="0" max="1" step="0.01"
            value={anim.intensity}
            oninput={(e) => project.updateTextAnimation(layer.id, { intensity: parseFloat((e.target as HTMLInputElement).value) })}
          />
          <span class="value">{(anim.intensity * 100).toFixed(0)}%</span>
        </div>

        <div class="property-row">
          <label>Stagger</label>
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
            Loop
          </label>
        </div>

        <div class="property-row">
          <label>Direction</label>
          <select
            value={anim.direction}
            onchange={(e) => project.updateTextAnimation(layer.id, { direction: (e.target as HTMLSelectElement).value as 'forward' | 'reverse' | 'alternate' })}
          >
            <option value="forward">Forward</option>
            <option value="reverse">Reverse</option>
            <option value="alternate">Alternate</option>
          </select>
        </div>
      {/if}
    </div>

    <!-- Animation Description -->
    {#if anim && anim.type !== 'none'}
      <div class="anim-description">
        {animationTypes.find(a => a.value === anim.type)?.description ?? ''}
      </div>
    {/if}
  </div>
{/if}

<style>
  .long-text { display: flex; gap: 8px; align-items: flex-start; padding: 8px; font-size: var(--ga-text-meta); line-height: 1.4; border-radius: var(--ga-r-hard); color: var(--ga-ink-1); background: var(--ga-card); border: 1px solid var(--ga-line-1); }
  .long-text span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .long-text button { flex: none; height: var(--ga-control-h-sm); padding: 0 10px; background: var(--ga-sub); border: 1px solid var(--ga-line-2); border-radius: var(--ga-r-hard); color: var(--ga-ink-1); font-size: var(--ga-text-control); font-weight: var(--ga-weight-control); cursor: pointer; }
  .long-text button:hover { color: var(--ga-ink-0); border-color: var(--ga-line-3); }
  .text-panel {
    display: flex;
    flex-direction: column;
    padding: 12px;
    overflow-y: auto;
    max-height: 100%;
    font-size: var(--ga-text-control);
    color: var(--ga-ink-0);
  }

  h3 {
    margin: 0 0 8px 0;
    font-size: var(--ga-text-title);
    font-weight: var(--ga-weight-title);
    color: var(--ga-ink-0);
  }

  .section {
    padding: 12px 0;
    border-top: 1px solid var(--ga-line-1);
  }

  /* Eyebrow section label, same as every layer editor. */
  .section-label {
    display: block;
    font-size: var(--ga-text-eyebrow);
    font-weight: 700;
    color: var(--ga-ink-2);
    text-transform: uppercase;
    letter-spacing: var(--ga-eyebrow-tracking);
    margin-bottom: 8px;
  }

  .text-input {
    width: 100%;
    background: var(--ga-slot);
    border: 1px solid var(--ga-line-2);
    color: var(--ga-ink-0);
    padding: 6px 8px;
    font-size: var(--ga-text-body);
    border-radius: var(--ga-r-hard);
    resize: vertical;
    font-family: inherit;
    box-sizing: border-box;
  }

  .text-input:focus {
    border-color: var(--ga-focus);
    outline: none;
  }

  .property-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: var(--ga-control-h);
    margin-bottom: 2px;
  }

  .property-row > label {
    width: 84px;
    font-size: var(--ga-text-control);
    color: var(--ga-ink-1);
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .property-row > label:has(input) { width: auto; color: var(--ga-ink-0); cursor: pointer; }

  .property-row input[type="range"] {
    flex: 1;
    min-width: 0;
    height: 4px;
    accent-color: var(--ga-slider-fill, var(--ga-blue));
  }

  .property-row input[type="color"] {
    width: 36px;
    height: var(--ga-control-h-sm);
    border: 1px solid var(--ga-line-2);
    background: none;
    cursor: pointer;
    padding: 0;
    border-radius: var(--ga-r-hard);
  }

  .property-row select {
    flex: 1;
    min-width: 0;
    height: var(--ga-control-h);
    background: var(--ga-slot);
    border: 1px solid var(--ga-line-2);
    color: var(--ga-ink-0);
    padding: 0 8px;
    font-size: var(--ga-text-control);
    border-radius: var(--ga-r-hard);
  }

  .value {
    min-width: 40px;
    text-align: right;
    font-size: var(--ga-text-meta);
    color: var(--ga-ink-1);
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    font-variant-numeric: tabular-nums;
  }

  .button-group {
    display: flex;
    gap: 2px;
    padding: 2px;
    background: var(--ga-slot);
    border: 1px solid var(--ga-line-2);
    border-radius: var(--ga-r-hard);
  }

  .button-group button {
    min-width: 32px;
    height: calc(var(--ga-control-h) - 6px);
    background: transparent;
    border: 1px solid transparent;
    color: var(--ga-ink-1);
    padding: 0 8px;
    font-size: var(--ga-text-control);
    font-weight: var(--ga-weight-control);
    cursor: pointer;
    border-radius: calc(var(--ga-r-hard) - 1px);
  }

  .button-group button:hover:not(.active) {
    color: var(--ga-ink-0);
    background: rgba(255, 255, 255, 0.05);
  }

  .button-group button.active {
    background: var(--ga-selection-bg);
    color: var(--ga-selection-ink);
    border-color: var(--ga-selection-line);
  }

  .btn-small {
    height: var(--ga-control-h-sm);
    background: var(--ga-sub);
    border: 1px solid var(--ga-line-2);
    color: var(--ga-ink-1);
    padding: 0 10px;
    font-size: var(--ga-text-control);
    font-weight: var(--ga-weight-control);
    cursor: pointer;
    border-radius: var(--ga-r-hard);
  }

  .btn-small:hover {
    color: var(--ga-ink-0);
    border-color: var(--ga-line-3);
  }

  .anim-description {
    font-size: var(--ga-text-meta);
    line-height: 1.45;
    color: var(--ga-ink-2);
    padding: 0 0 8px;
  }

  .property-row input[type="checkbox"] {
    accent-color: var(--ga-selection-line);
  }
</style>
