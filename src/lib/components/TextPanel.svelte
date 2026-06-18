<script lang="ts">
  import { project, selectedLayer } from '../stores/layers';
  import type { TextAnimationType } from '../types';

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

  const animationTypes: { value: TextAnimationType; label: string; description: string }[] = [
    { value: 'none', label: 'None', description: 'Static text' },
    { value: 'ticker', label: 'Ticker', description: 'Horizontal scrolling marquee' },
    { value: 'letterReveal', label: 'Letter Reveal', description: 'Letters appear with glow burst' },
    { value: 'typewriter', label: 'Typewriter', description: 'Typing with cursor blink' },
    { value: 'fadeInLetters', label: 'Fade In', description: 'Sequential letter fade' },
    { value: 'waveY', label: 'Wave Y', description: 'Vertical sine wave' },
    { value: 'waveX', label: 'Wave X', description: 'Horizontal sine wave' },
    { value: 'elastic', label: 'Elastic', description: 'Bounce in with overshoot' },
    { value: 'scramble', label: 'Scramble', description: 'Random chars resolve' },
    { value: 'glitch3d', label: 'Glitch 3D', description: 'RGB split + skew + noise' },
    { value: 'perspective3d', label: 'Perspective 3D', description: 'Rotating faux-3D' },
    { value: 'flipLetters', label: 'Flip Letters', description: 'Y-axis letter rotation' },
    { value: 'spiralIn', label: 'Spiral In', description: 'Letters spiral to position' },
    { value: 'explode', label: 'Explode', description: 'Burst out and reassemble' },
    { value: 'liquid', label: 'Liquid', description: 'Fluid distortion warping' },
    { value: 'neonPulse', label: 'Neon Pulse', description: 'Glowing neon with flicker' },
    { value: 'matrixRain', label: 'Matrix Rain', description: 'Digital rain cascade' },
    { value: 'bounce', label: 'Bounce', description: 'Physics bounce from top' },
  ];

  $: layer = $selectedLayer;
  $: tc = layer?.textContent;
  $: anim = tc?.animation;
</script>

{#if layer && tc}
  <div class="text-panel">
    <h3>Text Layer</h3>

    <!-- Text Input -->
    <div class="section">
      <label class="section-label">Text</label>
      <textarea
        class="text-input"
        value={tc.text}
        oninput={(e) => project.updateTextContent(layer.id, { text: (e.target as HTMLTextAreaElement).value })}
        rows={3}
        placeholder="Enter text..."
      ></textarea>
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
          {#each availableFonts as font}
            <option value={font} style="font-family: '{font}'">{font}</option>
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
        <label>Line Height</label>
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
        <label>Stroke W</label>
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
          <label>Extrude Color</label>
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
          <label>Light Angle</label>
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
          {#each animationTypes as at}
            <option value={at.value} title={at.description}>{at.label}</option>
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
  .text-panel {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px;
    overflow-y: auto;
    max-height: 100%;
    font-size: 13px;
    color: var(--text-primary, #ccc);
  }

  h3 {
    margin: 0 0 6px 0;
    font-size: 15px;
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
    font-size: 12px;
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
    font-size: 14px;
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
    font-size: 12px;
    color: var(--text-secondary, #aaa);
    flex-shrink: 0;
  }

  .property-row input[type="range"] {
    flex: 1;
    height: 4px;
    accent-color: #ff00aa;
  }

  .property-row input[type="color"] {
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
    font-size: 12px;
    border-radius: 3px;
  }

  .value {
    min-width: 38px;
    text-align: right;
    font-size: 11px;
    color: var(--text-muted, #888);
    font-family: monospace;
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
    font-size: 12px;
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
    font-size: 11px;
    cursor: pointer;
    border-radius: 2px;
  }

  .btn-small:hover {
    background: #333;
  }

  .animation-section select {
    font-size: 12px;
  }

  .anim-description {
    font-size: 11px;
    color: #666;
    font-style: italic;
    padding: 2px 6px;
  }

  .property-row input[type="checkbox"] {
    accent-color: #ff00aa;
  }
</style>
