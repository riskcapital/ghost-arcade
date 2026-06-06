<script lang="ts">
  import { project, selectedSVGLayer, selectedSVGContent, layers } from '../stores/layers';
  import type { Layer, SVGFillMode, SVGColorMode, SVGContent } from '../types';

  // Tray state
  export let isOpen = false;
  export let embedded = false;

  // Drag and drop state
  let isDragOver = false;

  // Fill mode options
  const fillModes: { value: SVGFillMode; label: string }[] = [
    { value: 'liquid', label: 'Liquid' },
    { value: 'solid', label: 'Solid' },
    { value: 'gradient', label: 'Gradient' },
    { value: 'shimmer', label: 'Shimmer' },
    { value: 'pulse', label: 'Pulse' },
    { value: 'noise', label: 'Noise' },
    { value: 'particles', label: 'Particles' },
  ];

  // Color mode options
  const colorModes: { value: SVGColorMode; label: string }[] = [
    { value: 'perShape', label: 'Per Shape' },
    { value: 'rainbow', label: 'Rainbow' },
    { value: 'monochrome', label: 'Monochrome' },
    { value: 'complementary', label: 'Complementary' },
    { value: 'analogous', label: 'Analogous' },
    { value: 'white', label: 'White' },
  ];

  // Preset configurations
  const presets = [
    { name: 'Default', key: 'default' },
    { name: 'Electric', key: 'electric' },
    { name: 'Organic', key: 'organic' },
    { name: 'Neon', key: 'neon' },
    { name: 'Minimal', key: 'minimal' },
    { name: 'Chaos', key: 'chaos' },
  ];

  // Collapsed sections state
  let expandedSections: Record<string, boolean> = {
    source: true,
    position: true,
    fillMode: false,
    colorMode: false,
    effects: false,
  };

  function toggleSection(section: string) {
    expandedSections[section] = !expandedSections[section];
  }

  function toggleTray() {
    isOpen = !isOpen;
  }

  // Update a numeric parameter
  function updateParam(key: keyof SVGContent, value: number | boolean | string) {
    if ($selectedSVGLayer) {
      project.setSVGParam($selectedSVGLayer.id, key, value);
    }
  }

  // Toggle a boolean parameter
  function toggleParam(key: keyof SVGContent) {
    if ($selectedSVGLayer) {
      project.toggleSVGEffect($selectedSVGLayer.id, key);
    }
  }

  // Handle SVG file upload
  async function handleSVGUpload(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !$selectedSVGLayer) return;

    try {
      const svgSource = await file.text();
      project.setSVGSource($selectedSVGLayer.id, svgSource);
    } catch (err) {
      console.error('Failed to load SVG:', err);
    }
    input.value = '';
  }

  // Handle drop
  async function handleDrop(e: DragEvent) {
    e.preventDefault();
    isDragOver = false;

    const files = e.dataTransfer?.files;
    if (!files || !$selectedSVGLayer) return;

    for (const file of files) {
      if (file.name.toLowerCase().endsWith('.svg')) {
        try {
          const svgSource = await file.text();
          project.setSVGSource($selectedSVGLayer.id, svgSource);
        } catch (err) {
          console.error('Failed to load SVG:', err);
        }
        break;
      }
    }
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    isDragOver = true;
  }

  function handleDragLeave() {
    isDragOver = false;
  }

  // Clear SVG source
  function clearSVGSource() {
    if ($selectedSVGLayer) {
      project.setSVGSource($selectedSVGLayer.id, '');
    }
  }

  // Apply a preset
  function applyPreset(preset: string) {
    if (!$selectedSVGLayer) return;

    const presetConfigs: Record<string, Partial<SVGContent>> = {
      default: {
        fillMode: 'liquid',
        colorMode: 'perShape',
        liquidEnabled: true,
        particlesEnabled: true,
        energyEnabled: true,
        connectionsEnabled: true,
        glowEnabled: true,
        ripplesEnabled: true,
        lightningEnabled: true,
        edgeFlowEnabled: true,
        innerGlowEnabled: true,
        nebulaEnabled: true,
        heartbeatEnabled: true,
        plasmaEnabled: true,
        particleLinksEnabled: true,
        echoEnabled: true,
        arcBridgesEnabled: true,
        colorCycleEnabled: true,
      },
      electric: {
        fillMode: 'shimmer',
        colorMode: 'rainbow',
        particleSpeed: 200,
        lightningFrequency: 3,
        lightningEnabled: true,
        particlesEnabled: true,
        energyEnabled: true,
        plasmaEnabled: false,
        echoEnabled: false,
        colorCycleSpeed: 0.8,
      },
      organic: {
        fillMode: 'liquid',
        colorMode: 'analogous',
        liquidSpeed: 0.2,
        heartbeatEnabled: true,
        heartbeatSpeed: 0.5,
        ripplesEnabled: true,
        particlesEnabled: false,
        lightningEnabled: false,
        plasmaEnabled: true,
        plasmaSpeed: 1.0,
      },
      neon: {
        fillMode: 'shimmer',
        colorMode: 'rainbow',
        shimmerSpeed: 10,
        shimmerIntensity: 1.2,
        glowEnabled: true,
        innerGlowEnabled: true,
        edgeFlowEnabled: true,
        outlineThickness: 4,
      },
      minimal: {
        fillMode: 'solid',
        colorMode: 'monochrome',
        particlesEnabled: false,
        energyEnabled: false,
        connectionsEnabled: false,
        ripplesEnabled: false,
        lightningEnabled: false,
        plasmaEnabled: false,
        particleLinksEnabled: false,
        echoEnabled: false,
        arcBridgesEnabled: false,
        nebulaEnabled: false,
        heartbeatEnabled: false,
        glowEnabled: false,
      },
      chaos: {
        fillMode: 'noise',
        colorMode: 'rainbow',
        particlesEnabled: true,
        particleSpeed: 250,
        energyEnabled: true,
        energySpeed: 400,
        lightningEnabled: true,
        lightningFrequency: 4,
        plasmaEnabled: true,
        plasmaSpeed: 5,
        ripplesEnabled: true,
        rippleSpeed: 3,
        colorCycleEnabled: true,
        colorCycleSpeed: 1,
      },
    };

    const config = presetConfigs[preset];
    if (config) {
      project.updateSVGContent($selectedSVGLayer.id, config);
    }
  }

  // Reset to defaults
  function resetToDefaults() {
    if ($selectedSVGLayer) {
      project.resetSVGContent($selectedSVGLayer.id);
    }
  }

  // Get SVG layers from the project
  $: svgLayers = $layers.filter(l => l.type === 'svg') as Layer[];
</script>

{#if !embedded}
<!-- Toggle button -->
<button class="tray-toggle" class:open={isOpen} onclick={toggleTray}>
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    {#if isOpen}
      <path d="M9 18l6-6-6-6" />
    {:else}
      <path d="M15 18l-6-6 6-6" />
    {/if}
  </svg>
  <span class="toggle-label">SVG</span>
</button>
{/if}

<!-- Slide-out tray -->
<div class="svg-tray" class:open={isOpen || embedded} class:embedded>
  <div class="tray-header">
    <h3>SVG Controls</h3>
  </div>

  <div class="tray-content">
    {#if !$selectedSVGLayer}
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M3 15l6-6 4 4 8-8" />
          <circle cx="8" cy="8" r="2" />
        </svg>
        <p>No SVG layer selected</p>
        <p class="hint">Select an SVG layer in the Layers panel</p>
      </div>
    {:else}
      <!-- SVG Source Section -->
      <div class="section">
        <button class="section-header" onclick={() => toggleSection('source')}>
          <span>SVG Source</span>
          <span class="toggle">{expandedSections.source ? '-' : '+'}</span>
        </button>
        {#if expandedSections.source}
          <div
            class="section-content source-area"
            class:dragover={isDragOver}
            ondrop={handleDrop}
            ondragover={handleDragOver}
            ondragleave={handleDragLeave}
            role="region"
            aria-label="SVG drop zone"
          >
            {#if $selectedSVGContent?.svgSource}
              <div class="svg-loaded">
                <div class="svg-preview">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#67E8F9" stroke-width="2">
                    <path d="M9 12l2 2 4-4" />
                    <circle cx="12" cy="12" r="10" />
                  </svg>
                  <span>SVG Loaded</span>
                </div>
                <div class="svg-actions">
                  <label class="action-btn replace">
                    <input type="file" accept=".svg" onchange={handleSVGUpload} />
                    Replace
                  </label>
                  <button class="action-btn clear" onclick={clearSVGSource}>
                    Clear
                  </button>
                </div>
              </div>
            {:else}
              <div class="upload-area">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                <p>Drop SVG here</p>
                <label class="upload-btn">
                  <input type="file" accept=".svg" onchange={handleSVGUpload} />
                  Upload SVG
                </label>
              </div>
            {/if}
          </div>
        {/if}
      </div>

      <!-- Position & Scale Section -->
      <div class="section">
        <button class="section-header" onclick={() => toggleSection('position')}>
          <span>Position & Scale</span>
          <span class="toggle">{expandedSections.position ? '-' : '+'}</span>
        </button>
        {#if expandedSections.position && $selectedSVGContent}
          <div class="section-content">
            <div class="param-row">
              <label>Pan X</label>
              <input
                type="range"
                min="-1"
                max="1"
                step="0.01"
                value={$selectedSVGContent.panX ?? 0}
                oninput={(e) => updateParam('panX', parseFloat((e.target as HTMLInputElement).value))}
              />
              <span class="value">{($selectedSVGContent.panX ?? 0).toFixed(2)}</span>
            </div>
            <div class="param-row">
              <label>Pan Y</label>
              <input
                type="range"
                min="-1"
                max="1"
                step="0.01"
                value={$selectedSVGContent.panY ?? 0}
                oninput={(e) => updateParam('panY', parseFloat((e.target as HTMLInputElement).value))}
              />
              <span class="value">{($selectedSVGContent.panY ?? 0).toFixed(2)}</span>
            </div>
            <div class="param-row">
              <label>Scale</label>
              <input
                type="range"
                min="0.1"
                max="3"
                step="0.01"
                value={$selectedSVGContent.contentScale ?? 1}
                oninput={(e) => updateParam('contentScale', parseFloat((e.target as HTMLInputElement).value))}
              />
              <span class="value">{($selectedSVGContent.contentScale ?? 1).toFixed(2)}</span>
            </div>
            <button class="reset-position-btn" onclick={() => {
              updateParam('panX', 0);
              updateParam('panY', 0);
              updateParam('contentScale', 1);
            }}>
              Reset Position
            </button>
          </div>
        {/if}
      </div>

      <!-- Presets -->
      <div class="section">
        <div class="section-header static">
          <span>Presets</span>
        </div>
        <div class="section-content presets">
          {#each presets as preset}
            <button class="preset-btn" onclick={() => applyPreset(preset.key)}>
              {preset.name}
            </button>
          {/each}
          <button class="preset-btn reset" onclick={resetToDefaults}>
            Reset
          </button>
        </div>
      </div>

      <!-- Fill Mode Section -->
      <div class="section">
        <button class="section-header" onclick={() => toggleSection('fillMode')}>
          <span>Fill Mode</span>
          <span class="toggle">{expandedSections.fillMode ? '-' : '+'}</span>
        </button>
        {#if expandedSections.fillMode && $selectedSVGContent}
          <div class="section-content">
            <div class="param-row">
              <label>Mode</label>
              <select
                value={$selectedSVGContent.fillMode}
                onchange={(e) => updateParam('fillMode', (e.target as HTMLSelectElement).value)}
              >
                {#each fillModes as mode}
                  <option value={mode.value}>{mode.label}</option>
                {/each}
              </select>
            </div>

            {#if $selectedSVGContent.fillMode === 'liquid'}
              <div class="param-row">
                <label>
                  <input
                    type="checkbox"
                    checked={$selectedSVGContent.liquidEnabled}
                    onchange={() => toggleParam('liquidEnabled')}
                  />
                  Enabled
                </label>
              </div>
              <div class="param-row">
                <label>Speed</label>
                <input
                  type="range"
                  min="0.05"
                  max="1"
                  step="0.01"
                  value={$selectedSVGContent.liquidSpeed}
                  oninput={(e) => updateParam('liquidSpeed', parseFloat((e.target as HTMLInputElement).value))}
                />
                <span class="value">{$selectedSVGContent.liquidSpeed.toFixed(2)}</span>
              </div>
              <div class="param-row">
                <label>Wave Amp</label>
                <input
                  type="range"
                  min="0.02"
                  max="0.15"
                  step="0.01"
                  value={$selectedSVGContent.liquidWaveAmp}
                  oninput={(e) => updateParam('liquidWaveAmp', parseFloat((e.target as HTMLInputElement).value))}
                />
                <span class="value">{$selectedSVGContent.liquidWaveAmp.toFixed(2)}</span>
              </div>
            {/if}

            {#if $selectedSVGContent.fillMode === 'gradient'}
              <div class="param-row">
                <label>Angle</label>
                <input
                  type="range"
                  min="0"
                  max="360"
                  step="1"
                  value={$selectedSVGContent.gradientAngle}
                  oninput={(e) => updateParam('gradientAngle', parseFloat((e.target as HTMLInputElement).value))}
                />
                <span class="value">{$selectedSVGContent.gradientAngle}deg</span>
              </div>
              <div class="param-row">
                <label>Spread</label>
                <input
                  type="range"
                  min="0.1"
                  max="0.8"
                  step="0.01"
                  value={$selectedSVGContent.gradientSpread}
                  oninput={(e) => updateParam('gradientSpread', parseFloat((e.target as HTMLInputElement).value))}
                />
                <span class="value">{$selectedSVGContent.gradientSpread.toFixed(2)}</span>
              </div>
            {/if}

            {#if $selectedSVGContent.fillMode === 'shimmer'}
              <div class="param-row">
                <label>Speed</label>
                <input
                  type="range"
                  min="1"
                  max="15"
                  step="0.1"
                  value={$selectedSVGContent.shimmerSpeed}
                  oninput={(e) => updateParam('shimmerSpeed', parseFloat((e.target as HTMLInputElement).value))}
                />
                <span class="value">{$selectedSVGContent.shimmerSpeed.toFixed(1)}</span>
              </div>
              <div class="param-row">
                <label>Scale</label>
                <input
                  type="range"
                  min="0.02"
                  max="0.3"
                  step="0.01"
                  value={$selectedSVGContent.shimmerScale}
                  oninput={(e) => updateParam('shimmerScale', parseFloat((e.target as HTMLInputElement).value))}
                />
                <span class="value">{$selectedSVGContent.shimmerScale.toFixed(2)}</span>
              </div>
              <div class="param-row">
                <label>Intensity</label>
                <input
                  type="range"
                  min="0.2"
                  max="1.5"
                  step="0.01"
                  value={$selectedSVGContent.shimmerIntensity}
                  oninput={(e) => updateParam('shimmerIntensity', parseFloat((e.target as HTMLInputElement).value))}
                />
                <span class="value">{$selectedSVGContent.shimmerIntensity.toFixed(2)}</span>
              </div>
            {/if}

            {#if $selectedSVGContent.fillMode === 'pulse'}
              <div class="param-row">
                <label>Speed</label>
                <input
                  type="range"
                  min="0.5"
                  max="10"
                  step="0.1"
                  value={$selectedSVGContent.pulseSpeed}
                  oninput={(e) => updateParam('pulseSpeed', parseFloat((e.target as HTMLInputElement).value))}
                />
                <span class="value">{$selectedSVGContent.pulseSpeed.toFixed(1)}</span>
              </div>
              <div class="param-row">
                <label>Ring Scale</label>
                <input
                  type="range"
                  min="2"
                  max="30"
                  step="1"
                  value={$selectedSVGContent.pulseRingScale}
                  oninput={(e) => updateParam('pulseRingScale', parseFloat((e.target as HTMLInputElement).value))}
                />
                <span class="value">{$selectedSVGContent.pulseRingScale}</span>
              </div>
            {/if}

            {#if $selectedSVGContent.fillMode === 'noise'}
              <div class="param-row">
                <label>Scale</label>
                <input
                  type="range"
                  min="0.005"
                  max="0.1"
                  step="0.001"
                  value={$selectedSVGContent.noiseScale}
                  oninput={(e) => updateParam('noiseScale', parseFloat((e.target as HTMLInputElement).value))}
                />
                <span class="value">{$selectedSVGContent.noiseScale.toFixed(3)}</span>
              </div>
              <div class="param-row">
                <label>Speed</label>
                <input
                  type="range"
                  min="0.1"
                  max="2"
                  step="0.01"
                  value={$selectedSVGContent.noiseSpeed}
                  oninput={(e) => updateParam('noiseSpeed', parseFloat((e.target as HTMLInputElement).value))}
                />
                <span class="value">{$selectedSVGContent.noiseSpeed.toFixed(2)}</span>
              </div>
            {/if}

            {#if $selectedSVGContent.fillMode === 'particles'}
              <div class="param-row">
                <label>Density</label>
                <input
                  type="range"
                  min="50"
                  max="500"
                  step="10"
                  value={$selectedSVGContent.particleFillDensity}
                  oninput={(e) => updateParam('particleFillDensity', parseFloat((e.target as HTMLInputElement).value))}
                />
                <span class="value">{$selectedSVGContent.particleFillDensity}</span>
              </div>
              <div class="param-row">
                <label>Size</label>
                <input
                  type="range"
                  min="1"
                  max="10"
                  step="0.1"
                  value={$selectedSVGContent.particleFillSize}
                  oninput={(e) => updateParam('particleFillSize', parseFloat((e.target as HTMLInputElement).value))}
                />
                <span class="value">{$selectedSVGContent.particleFillSize.toFixed(1)}</span>
              </div>
            {/if}

            <!-- Outline thickness (always visible) -->
            <div class="param-row">
              <label>Outline</label>
              <input
                type="range"
                min="1"
                max="10"
                step="0.5"
                value={$selectedSVGContent.outlineThickness}
                oninput={(e) => updateParam('outlineThickness', parseFloat((e.target as HTMLInputElement).value))}
              />
              <span class="value">{$selectedSVGContent.outlineThickness.toFixed(1)}</span>
            </div>
          </div>
        {/if}
      </div>

      <!-- Color Mode Section -->
      <div class="section">
        <button class="section-header" onclick={() => toggleSection('colorMode')}>
          <span>Color Mode</span>
          <span class="toggle">{expandedSections.colorMode ? '-' : '+'}</span>
        </button>
        {#if expandedSections.colorMode && $selectedSVGContent}
          <div class="section-content">
            <div class="param-row">
              <label>Mode</label>
              <select
                value={$selectedSVGContent.colorMode}
                onchange={(e) => updateParam('colorMode', (e.target as HTMLSelectElement).value)}
              >
                {#each colorModes as mode}
                  <option value={mode.value}>{mode.label}</option>
                {/each}
              </select>
            </div>

            {#if $selectedSVGContent.colorMode === 'monochrome' || $selectedSVGContent.colorMode === 'complementary' || $selectedSVGContent.colorMode === 'analogous'}
              <div class="param-row">
                <label>Hue</label>
                <input
                  type="range"
                  min="0"
                  max="360"
                  step="1"
                  value={$selectedSVGContent.monochromeHue}
                  oninput={(e) => updateParam('monochromeHue', parseFloat((e.target as HTMLInputElement).value))}
                />
                <span class="value">{$selectedSVGContent.monochromeHue}deg</span>
              </div>
            {/if}

            <div class="param-row">
              <label>
                <input
                  type="checkbox"
                  checked={$selectedSVGContent.colorCycleEnabled}
                  onchange={() => toggleParam('colorCycleEnabled')}
                />
                Color Cycle
              </label>
            </div>

            {#if $selectedSVGContent.colorCycleEnabled}
              <div class="param-row">
                <label>Speed</label>
                <input
                  type="range"
                  min="0.05"
                  max="1"
                  step="0.01"
                  value={$selectedSVGContent.colorCycleSpeed}
                  oninput={(e) => updateParam('colorCycleSpeed', parseFloat((e.target as HTMLInputElement).value))}
                />
                <span class="value">{$selectedSVGContent.colorCycleSpeed.toFixed(2)}</span>
              </div>
            {/if}
          </div>
        {/if}
      </div>

      <!-- Effects Section -->
      <div class="section">
        <button class="section-header" onclick={() => toggleSection('effects')}>
          <span>Effects</span>
          <span class="toggle">{expandedSections.effects ? '-' : '+'}</span>
        </button>
        {#if expandedSections.effects && $selectedSVGContent}
          <div class="section-content effects-grid">
            <!-- Energy Pulses -->
            <div class="effect-group">
              <label class="effect-toggle">
                <input
                  type="checkbox"
                  checked={$selectedSVGContent.energyEnabled}
                  onchange={() => toggleParam('energyEnabled')}
                />
                Energy Pulses
              </label>
              {#if $selectedSVGContent.energyEnabled}
                <div class="effect-params">
                  <div class="mini-param">
                    <span>Speed</span>
                    <input
                      type="range"
                      min="50"
                      max="500"
                      value={$selectedSVGContent.energySpeed}
                      oninput={(e) => updateParam('energySpeed', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <span class="mini-value">{$selectedSVGContent.energySpeed}</span>
                  </div>
                </div>
              {/if}
            </div>

            <!-- Connections -->
            <div class="effect-group">
              <label class="effect-toggle">
                <input
                  type="checkbox"
                  checked={$selectedSVGContent.connectionsEnabled}
                  onchange={() => toggleParam('connectionsEnabled')}
                />
                Connections
              </label>
              {#if $selectedSVGContent.connectionsEnabled}
                <div class="effect-params">
                  <div class="mini-param">
                    <span>Pulse</span>
                    <input
                      type="range"
                      min="0.5"
                      max="6"
                      step="0.1"
                      value={$selectedSVGContent.connectionPulseSpeed}
                      oninput={(e) => updateParam('connectionPulseSpeed', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <span class="mini-value">{$selectedSVGContent.connectionPulseSpeed?.toFixed(1)}</span>
                  </div>
                  <div class="mini-param">
                    <span>Thickness</span>
                    <input
                      type="range"
                      min="1"
                      max="8"
                      step="0.5"
                      value={$selectedSVGContent.connectionThickness}
                      oninput={(e) => updateParam('connectionThickness', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <span class="mini-value">{$selectedSVGContent.connectionThickness?.toFixed(1)}</span>
                  </div>
                </div>
              {/if}
            </div>

            <!-- Vertex Glow -->
            <div class="effect-group">
              <label class="effect-toggle">
                <input
                  type="checkbox"
                  checked={$selectedSVGContent.glowEnabled}
                  onchange={() => toggleParam('glowEnabled')}
                />
                Vertex Glow
              </label>
              {#if $selectedSVGContent.glowEnabled}
                <div class="effect-params">
                  <div class="mini-param">
                    <span>Pulse</span>
                    <input
                      type="range"
                      min="0.5"
                      max="8"
                      step="0.1"
                      value={$selectedSVGContent.glowPulseSpeed}
                      oninput={(e) => updateParam('glowPulseSpeed', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <span class="mini-value">{$selectedSVGContent.glowPulseSpeed?.toFixed(1)}</span>
                  </div>
                </div>
              {/if}
            </div>

            <!-- Ripples -->
            <div class="effect-group">
              <label class="effect-toggle">
                <input
                  type="checkbox"
                  checked={$selectedSVGContent.ripplesEnabled}
                  onchange={() => toggleParam('ripplesEnabled')}
                />
                Ripples
              </label>
              {#if $selectedSVGContent.ripplesEnabled}
                <div class="effect-params">
                  <div class="mini-param">
                    <span>Speed</span>
                    <input
                      type="range"
                      min="0.3"
                      max="3"
                      step="0.1"
                      value={$selectedSVGContent.rippleSpeed}
                      oninput={(e) => updateParam('rippleSpeed', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <span class="mini-value">{$selectedSVGContent.rippleSpeed?.toFixed(1)}</span>
                  </div>
                </div>
              {/if}
            </div>

            <!-- Lightning -->
            <div class="effect-group">
              <label class="effect-toggle">
                <input
                  type="checkbox"
                  checked={$selectedSVGContent.lightningEnabled}
                  onchange={() => toggleParam('lightningEnabled')}
                />
                Lightning
              </label>
              {#if $selectedSVGContent.lightningEnabled}
                <div class="effect-params">
                  <div class="mini-param">
                    <span>Frequency</span>
                    <input
                      type="range"
                      min="0.1"
                      max="4"
                      step="0.1"
                      value={$selectedSVGContent.lightningFrequency}
                      oninput={(e) => updateParam('lightningFrequency', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <span class="mini-value">{$selectedSVGContent.lightningFrequency?.toFixed(1)}</span>
                  </div>
                  <div class="mini-param">
                    <span>Thickness</span>
                    <input
                      type="range"
                      min="1"
                      max="8"
                      step="0.5"
                      value={$selectedSVGContent.lightningThickness}
                      oninput={(e) => updateParam('lightningThickness', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <span class="mini-value">{$selectedSVGContent.lightningThickness?.toFixed(1)}</span>
                  </div>
                  <div class="mini-param">
                    <span>Branches</span>
                    <input
                      type="range"
                      min="0"
                      max="6"
                      step="1"
                      value={$selectedSVGContent.lightningBranches}
                      oninput={(e) => updateParam('lightningBranches', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <span class="mini-value">{$selectedSVGContent.lightningBranches}</span>
                  </div>
                  <div class="mini-param">
                    <span>Duration</span>
                    <input
                      type="range"
                      min="0.05"
                      max="0.4"
                      step="0.01"
                      value={$selectedSVGContent.lightningDuration}
                      oninput={(e) => updateParam('lightningDuration', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <span class="mini-value">{$selectedSVGContent.lightningDuration?.toFixed(2)}</span>
                  </div>
                </div>
              {/if}
            </div>

            <!-- Edge Flow -->
            <div class="effect-group">
              <label class="effect-toggle">
                <input
                  type="checkbox"
                  checked={$selectedSVGContent.edgeFlowEnabled}
                  onchange={() => toggleParam('edgeFlowEnabled')}
                />
                Edge Flow
              </label>
              {#if $selectedSVGContent.edgeFlowEnabled}
                <div class="effect-params">
                  <div class="mini-param">
                    <span>Speed</span>
                    <input
                      type="range"
                      min="0.5"
                      max="4"
                      step="0.1"
                      value={$selectedSVGContent.edgeFlowSpeed}
                      oninput={(e) => updateParam('edgeFlowSpeed', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <span class="mini-value">{$selectedSVGContent.edgeFlowSpeed?.toFixed(1)}</span>
                  </div>
                  <div class="mini-param">
                    <span>Thickness</span>
                    <input
                      type="range"
                      min="1"
                      max="6"
                      step="0.5"
                      value={$selectedSVGContent.edgeFlowThickness}
                      oninput={(e) => updateParam('edgeFlowThickness', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <span class="mini-value">{$selectedSVGContent.edgeFlowThickness?.toFixed(1)}</span>
                  </div>
                </div>
              {/if}
            </div>

            <!-- Inner Glow -->
            <div class="effect-group">
              <label class="effect-toggle">
                <input
                  type="checkbox"
                  checked={$selectedSVGContent.innerGlowEnabled}
                  onchange={() => toggleParam('innerGlowEnabled')}
                />
                Inner Glow
              </label>
              {#if $selectedSVGContent.innerGlowEnabled}
                <div class="effect-params">
                  <div class="mini-param">
                    <span>Intensity</span>
                    <input
                      type="range"
                      min="0.1"
                      max="1"
                      step="0.05"
                      value={$selectedSVGContent.innerGlowIntensity}
                      oninput={(e) => updateParam('innerGlowIntensity', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <span class="mini-value">{$selectedSVGContent.innerGlowIntensity?.toFixed(2)}</span>
                  </div>
                </div>
              {/if}
            </div>

            <!-- Nebula BG -->
            <div class="effect-group">
              <label class="effect-toggle">
                <input
                  type="checkbox"
                  checked={$selectedSVGContent.nebulaEnabled}
                  onchange={() => toggleParam('nebulaEnabled')}
                />
                Nebula BG
              </label>
              {#if $selectedSVGContent.nebulaEnabled}
                <div class="effect-params">
                  <div class="mini-param">
                    <span>Intensity</span>
                    <input
                      type="range"
                      min="0.1"
                      max="0.8"
                      step="0.05"
                      value={$selectedSVGContent.nebulaIntensity}
                      oninput={(e) => updateParam('nebulaIntensity', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <span class="mini-value">{$selectedSVGContent.nebulaIntensity?.toFixed(2)}</span>
                  </div>
                  <div class="mini-param">
                    <span>Speed</span>
                    <input
                      type="range"
                      min="0.05"
                      max="0.5"
                      step="0.01"
                      value={$selectedSVGContent.nebulaSpeed}
                      oninput={(e) => updateParam('nebulaSpeed', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <span class="mini-value">{$selectedSVGContent.nebulaSpeed?.toFixed(2)}</span>
                  </div>
                </div>
              {/if}
            </div>

            <!-- Heartbeat -->
            <div class="effect-group">
              <label class="effect-toggle">
                <input
                  type="checkbox"
                  checked={$selectedSVGContent.heartbeatEnabled}
                  onchange={() => toggleParam('heartbeatEnabled')}
                />
                Heartbeat
              </label>
              {#if $selectedSVGContent.heartbeatEnabled}
                <div class="effect-params">
                  <div class="mini-param">
                    <span>Speed</span>
                    <input
                      type="range"
                      min="0.3"
                      max="2.5"
                      step="0.1"
                      value={$selectedSVGContent.heartbeatSpeed}
                      oninput={(e) => updateParam('heartbeatSpeed', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <span class="mini-value">{$selectedSVGContent.heartbeatSpeed?.toFixed(1)}</span>
                  </div>
                  <div class="mini-param">
                    <span>Intensity</span>
                    <input
                      type="range"
                      min="0.1"
                      max="0.8"
                      step="0.05"
                      value={$selectedSVGContent.heartbeatIntensity}
                      oninput={(e) => updateParam('heartbeatIntensity', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <span class="mini-value">{$selectedSVGContent.heartbeatIntensity?.toFixed(2)}</span>
                  </div>
                </div>
              {/if}
            </div>

            <!-- Plasma Tendrils -->
            <div class="effect-group">
              <label class="effect-toggle">
                <input
                  type="checkbox"
                  checked={$selectedSVGContent.plasmaEnabled}
                  onchange={() => toggleParam('plasmaEnabled')}
                />
                Plasma Tendrils
              </label>
              {#if $selectedSVGContent.plasmaEnabled}
                <div class="effect-params">
                  <div class="mini-param">
                    <span>Intensity</span>
                    <input
                      type="range"
                      min="0.2"
                      max="1.5"
                      step="0.05"
                      value={$selectedSVGContent.plasmaIntensity}
                      oninput={(e) => updateParam('plasmaIntensity', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <span class="mini-value">{$selectedSVGContent.plasmaIntensity?.toFixed(2)}</span>
                  </div>
                  <div class="mini-param">
                    <span>Speed</span>
                    <input
                      type="range"
                      min="0.5"
                      max="5"
                      step="0.1"
                      value={$selectedSVGContent.plasmaSpeed}
                      oninput={(e) => updateParam('plasmaSpeed', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <span class="mini-value">{$selectedSVGContent.plasmaSpeed?.toFixed(1)}</span>
                  </div>
                  <div class="mini-param">
                    <span>Thickness</span>
                    <input
                      type="range"
                      min="1"
                      max="8"
                      step="0.5"
                      value={$selectedSVGContent.plasmaThickness}
                      oninput={(e) => updateParam('plasmaThickness', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <span class="mini-value">{$selectedSVGContent.plasmaThickness?.toFixed(1)}</span>
                  </div>
                  <div class="mini-param">
                    <span>Opacity</span>
                    <input
                      type="range"
                      min="0.2"
                      max="1"
                      step="0.05"
                      value={$selectedSVGContent.plasmaOpacity}
                      oninput={(e) => updateParam('plasmaOpacity', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <span class="mini-value">{$selectedSVGContent.plasmaOpacity?.toFixed(2)}</span>
                  </div>
                </div>
              {/if}
            </div>

            <!-- Particle Links -->
            <div class="effect-group">
              <label class="effect-toggle">
                <input
                  type="checkbox"
                  checked={$selectedSVGContent.particleLinksEnabled}
                  onchange={() => toggleParam('particleLinksEnabled')}
                />
                Particle Links
              </label>
              {#if $selectedSVGContent.particleLinksEnabled}
                <div class="effect-params">
                  <div class="mini-param">
                    <span>Distance</span>
                    <input
                      type="range"
                      min="20"
                      max="150"
                      step="5"
                      value={$selectedSVGContent.particleLinkDistance}
                      oninput={(e) => updateParam('particleLinkDistance', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <span class="mini-value">{$selectedSVGContent.particleLinkDistance}</span>
                  </div>
                  <div class="mini-param">
                    <span>Opacity</span>
                    <input
                      type="range"
                      min="0.1"
                      max="1"
                      step="0.05"
                      value={$selectedSVGContent.particleLinkOpacity}
                      oninput={(e) => updateParam('particleLinkOpacity', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <span class="mini-value">{$selectedSVGContent.particleLinkOpacity?.toFixed(2)}</span>
                  </div>
                  <div class="mini-param">
                    <span>Thickness</span>
                    <input
                      type="range"
                      min="1"
                      max="6"
                      step="0.5"
                      value={$selectedSVGContent.particleLinkThickness}
                      oninput={(e) => updateParam('particleLinkThickness', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <span class="mini-value">{$selectedSVGContent.particleLinkThickness?.toFixed(1)}</span>
                  </div>
                  <div class="mini-param">
                    <span>Max Links</span>
                    <input
                      type="range"
                      min="100"
                      max="2000"
                      step="50"
                      value={$selectedSVGContent.particleLinkMaxLinks}
                      oninput={(e) => updateParam('particleLinkMaxLinks', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <span class="mini-value">{$selectedSVGContent.particleLinkMaxLinks}</span>
                  </div>
                </div>
              {/if}
            </div>

            <!-- Echo Layers -->
            <div class="effect-group">
              <label class="effect-toggle">
                <input
                  type="checkbox"
                  checked={$selectedSVGContent.echoEnabled}
                  onchange={() => toggleParam('echoEnabled')}
                />
                Echo Layers
              </label>
              {#if $selectedSVGContent.echoEnabled}
                <div class="effect-params">
                  <div class="mini-param">
                    <span>Layers</span>
                    <input
                      type="range"
                      min="1"
                      max="8"
                      step="1"
                      value={$selectedSVGContent.echoLayers}
                      oninput={(e) => updateParam('echoLayers', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <span class="mini-value">{$selectedSVGContent.echoLayers}</span>
                  </div>
                  <div class="mini-param">
                    <span>Spacing</span>
                    <input
                      type="range"
                      min="3"
                      max="20"
                      step="1"
                      value={$selectedSVGContent.echoSpacing}
                      oninput={(e) => updateParam('echoSpacing', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <span class="mini-value">{$selectedSVGContent.echoSpacing}</span>
                  </div>
                  <div class="mini-param">
                    <span>Thickness</span>
                    <input
                      type="range"
                      min="1"
                      max="6"
                      step="0.5"
                      value={$selectedSVGContent.echoThickness}
                      oninput={(e) => updateParam('echoThickness', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <span class="mini-value">{$selectedSVGContent.echoThickness?.toFixed(1)}</span>
                  </div>
                  <div class="mini-param">
                    <span>Opacity</span>
                    <input
                      type="range"
                      min="0.1"
                      max="0.6"
                      step="0.05"
                      value={$selectedSVGContent.echoOpacity}
                      oninput={(e) => updateParam('echoOpacity', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <span class="mini-value">{$selectedSVGContent.echoOpacity?.toFixed(2)}</span>
                  </div>
                </div>
              {/if}
            </div>

            <!-- Arc Bridges -->
            <div class="effect-group">
              <label class="effect-toggle">
                <input
                  type="checkbox"
                  checked={$selectedSVGContent.arcBridgesEnabled}
                  onchange={() => toggleParam('arcBridgesEnabled')}
                />
                Arc Bridges
              </label>
              {#if $selectedSVGContent.arcBridgesEnabled}
                <div class="effect-params">
                  <div class="mini-param">
                    <span>Height</span>
                    <input
                      type="range"
                      min="5"
                      max="40"
                      step="1"
                      value={$selectedSVGContent.arcBridgeHeight}
                      oninput={(e) => updateParam('arcBridgeHeight', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <span class="mini-value">{$selectedSVGContent.arcBridgeHeight}</span>
                  </div>
                  <div class="mini-param">
                    <span>Thickness</span>
                    <input
                      type="range"
                      min="1"
                      max="8"
                      step="0.5"
                      value={$selectedSVGContent.arcBridgeThickness}
                      oninput={(e) => updateParam('arcBridgeThickness', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <span class="mini-value">{$selectedSVGContent.arcBridgeThickness?.toFixed(1)}</span>
                  </div>
                  <div class="mini-param">
                    <span>Opacity</span>
                    <input
                      type="range"
                      min="0.1"
                      max="0.8"
                      step="0.05"
                      value={$selectedSVGContent.arcBridgeOpacity}
                      oninput={(e) => updateParam('arcBridgeOpacity', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <span class="mini-value">{$selectedSVGContent.arcBridgeOpacity?.toFixed(2)}</span>
                  </div>
                </div>
              {/if}
            </div>

            <!-- Color Cycle -->
            <div class="effect-group">
              <label class="effect-toggle">
                <input
                  type="checkbox"
                  checked={$selectedSVGContent.colorCycleEnabled}
                  onchange={() => toggleParam('colorCycleEnabled')}
                />
                Color Cycle
              </label>
              {#if $selectedSVGContent.colorCycleEnabled}
                <div class="effect-params">
                  <div class="mini-param">
                    <span>Speed</span>
                    <input
                      type="range"
                      min="0.05"
                      max="1"
                      step="0.01"
                      value={$selectedSVGContent.colorCycleSpeed}
                      oninput={(e) => updateParam('colorCycleSpeed', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <span class="mini-value">{$selectedSVGContent.colorCycleSpeed?.toFixed(2)}</span>
                  </div>
                  <div class="mini-param">
                    <span>Saturation</span>
                    <input
                      type="range"
                      min="0.3"
                      max="1"
                      step="0.05"
                      value={$selectedSVGContent.colorCycleSaturation}
                      oninput={(e) => updateParam('colorCycleSaturation', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <span class="mini-value">{$selectedSVGContent.colorCycleSaturation?.toFixed(2)}</span>
                  </div>
                  <div class="mini-param">
                    <span>Lightness</span>
                    <input
                      type="range"
                      min="0.3"
                      max="0.8"
                      step="0.05"
                      value={$selectedSVGContent.colorCycleLightness}
                      oninput={(e) => updateParam('colorCycleLightness', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <span class="mini-value">{$selectedSVGContent.colorCycleLightness?.toFixed(2)}</span>
                  </div>
                </div>
              {/if}
            </div>

            <!-- Per-Shape Colors -->
            <div class="effect-group">
              <label class="effect-toggle">
                <input
                  type="checkbox"
                  checked={$selectedSVGContent.perShapeColors}
                  onchange={() => toggleParam('perShapeColors')}
                />
                Per-Shape Colors
              </label>
            </div>

            <!-- Particles (edge particles) -->
            <div class="effect-group">
              <label class="effect-toggle">
                <input
                  type="checkbox"
                  checked={$selectedSVGContent.particlesEnabled}
                  onchange={() => toggleParam('particlesEnabled')}
                />
                Edge Particles
              </label>
              {#if $selectedSVGContent.particlesEnabled}
                <div class="effect-params">
                  <div class="mini-param">
                    <span>Speed</span>
                    <input
                      type="range"
                      min="20"
                      max="300"
                      value={$selectedSVGContent.particleSpeed}
                      oninput={(e) => updateParam('particleSpeed', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <span class="mini-value">{$selectedSVGContent.particleSpeed}</span>
                  </div>
                  <div class="mini-param">
                    <span>Size</span>
                    <input
                      type="range"
                      min="1"
                      max="5"
                      step="0.1"
                      value={$selectedSVGContent.particleSize}
                      oninput={(e) => updateParam('particleSize', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <span class="mini-value">{$selectedSVGContent.particleSize?.toFixed(1)}</span>
                  </div>
                </div>
              {/if}
            </div>
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <!-- Layer list at bottom -->
  {#if svgLayers.length > 0}
    <div class="layer-list">
      <div class="layer-list-header">
        <span>SVG Layers</span>
      </div>
      {#each svgLayers as layer (layer.id)}
        <button
          class="layer-item"
          class:selected={$selectedSVGLayer?.id === layer.id}
          onclick={() => project.selectLayer(layer.id)}
        >
          <span class="layer-name">{layer.name}</span>
          {#if layer.svgContent?.svgSource}
            <span class="layer-status loaded">Loaded</span>
          {:else}
            <span class="layer-status empty">Empty</span>
          {/if}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .tray-toggle {
    position: fixed;
    right: 0;
    top: calc(50% + 120px);
    transform: translateY(-50%);
    background: #333;
    border: none;
    border-radius: 8px 0 0 8px;
    padding: 12px 8px;
    cursor: pointer;
    color: #ff00aa;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    z-index: 100;
    transition: all 0.3s ease;
  }

  .tray-toggle:hover {
    background: #444;
    padding-right: 12px;
  }

  .tray-toggle.open {
    right: 320px;
  }

  .toggle-label {
    writing-mode: vertical-rl;
    text-orientation: mixed;
    font-size: 12px;
    font-weight: 600;
  }

  .svg-tray {
    position: fixed;
    right: -320px;
    top: 48px;
    bottom: 28px;
    width: 320px;
    background: var(--bg-secondary, #111114);
    border-left: 1px solid #333;
    display: flex;
    flex-direction: column;
    z-index: 99;
    transition: right 0.3s ease;
  }

  .svg-tray.open {
    right: 0;
  }

  .svg-tray.embedded {
    position: relative;
    right: auto;
    top: auto;
    bottom: auto;
    width: 100%;
    height: 100%;
    border-left: none;
    z-index: auto;
    transition: none;
  }

  .tray-header {
    padding: 12px 16px;
    border-bottom: 1px solid #333;
    flex-shrink: 0;
  }

  .tray-header h3 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary, #eee);
  }

  .tray-content {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    text-align: center;
    color: #666;
    padding: 20px;
  }

  .empty-state svg {
    margin-bottom: 12px;
    opacity: 0.5;
  }

  .empty-state p {
    margin: 4px 0;
  }

  .hint {
    font-size: 11px;
    color: #555;
  }

  .section {
    margin-bottom: 8px;
    border: 1px solid #333;
    border-radius: 4px;
    background: var(--bg-primary, #0d0d10);
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px;
    background: var(--bg-secondary, #111114);
    border: none;
    border-radius: 4px 4px 0 0;
    cursor: pointer;
    width: 100%;
    color: #fff;
    font-weight: 500;
    font-size: 12px;
  }

  .section-header.static {
    cursor: default;
  }

  .section-header:hover:not(.static) {
    background: var(--bg-tertiary, #161618);
  }

  .toggle {
    font-size: 14px;
    color: var(--text-muted, #888);
  }

  .section-content {
    padding: 8px;
  }

  .source-area {
    transition: background 0.15s;
  }

  .source-area.dragover {
    background: #333;
    border: 2px dashed #ff00aa;
  }

  .upload-area {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    color: #666;
    padding: 16px 8px;
  }

  .upload-area svg {
    margin-bottom: 8px;
    opacity: 0.5;
  }

  .upload-area p {
    margin: 4px 0;
    font-size: 11px;
  }

  .upload-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-top: 8px;
    padding: 6px 14px;
    background: #ff00aa;
    color: #fff;
    border: none;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
  }

  .upload-btn:hover {
    background: #ff33bb;
  }

  .upload-btn input {
    display: none;
  }

  .svg-loaded {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 8px;
  }

  .svg-preview {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .svg-preview span {
    color: #BB86FC;
    font-weight: 600;
    font-size: 12px;
  }

  .svg-actions {
    display: flex;
    gap: 8px;
    width: 100%;
  }

  .action-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 6px;
    border: none;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }

  .action-btn.replace {
    background: #333;
    color: var(--text-primary, #eee);
  }

  .action-btn.replace:hover {
    background: #444;
  }

  .action-btn.replace input {
    display: none;
  }

  .action-btn.clear {
    background: #ff4444;
    color: #fff;
  }

  .action-btn.clear:hover {
    background: #ff5555;
  }

  .presets {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .preset-btn {
    padding: 4px 8px;
    background: var(--bg-tertiary, #161618);
    border: 1px solid #444;
    color: var(--text-primary, #ccc);
    border-radius: 3px;
    cursor: pointer;
    font-size: 11px;
  }

  .preset-btn:hover {
    background: #3a3a3a;
    color: #fff;
  }

  .preset-btn.reset {
    background: #3a2a2a;
    border-color: #553;
  }

  .preset-btn.reset:hover {
    background: #4a3a3a;
  }

  .reset-position-btn {
    width: 100%;
    padding: 6px;
    margin-top: 8px;
    background: #333;
    border: 1px solid #444;
    color: var(--text-primary, #ccc);
    border-radius: 4px;
    cursor: pointer;
    font-size: 11px;
    font-weight: 500;
    transition: all 0.15s;
  }

  .reset-position-btn:hover {
    background: #444;
    color: #fff;
  }

  .param-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }

  .param-row label {
    flex: 0 0 70px;
    color: var(--text-secondary, #aaa);
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
  }

  .param-row input[type="range"] {
    flex: 1;
    height: 4px;
    background: #333;
    border-radius: 2px;
    -webkit-appearance: none;
    appearance: none;
  }

  .param-row input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 12px;
    height: 12px;
    background: #ff00aa;
    border-radius: 50%;
    cursor: pointer;
  }

  .param-row select {
    flex: 1;
    background: var(--bg-tertiary, #161618);
    border: 1px solid #444;
    color: #fff;
    padding: 4px;
    border-radius: 3px;
    font-size: 11px;
  }

  .param-row .value {
    flex: 0 0 45px;
    text-align: right;
    color: var(--text-muted, #888);
    font-family: monospace;
    font-size: 10px;
  }

  .effects-grid {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .effect-group {
    background: #222;
    border-radius: 4px;
    padding: 6px 8px;
  }

  .effect-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-primary, #ccc);
    cursor: pointer;
    font-weight: 500;
    font-size: 11px;
  }

  .effect-toggle input[type="checkbox"] {
    margin: 0;
    accent-color: #ff00aa;
  }

  .effect-params {
    margin-top: 6px;
    padding-left: 12px;
    overflow: hidden;
  }

  .mini-param {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-bottom: 4px;
    min-width: 0;
  }

  .mini-param span {
    flex: 0 0 52px;
    font-size: 10px;
    color: var(--text-muted, #888);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .mini-param input[type="range"] {
    flex: 1;
    min-width: 0;
    height: 3px;
    background: #333;
    border-radius: 2px;
    -webkit-appearance: none;
    appearance: none;
  }

  .mini-param input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 10px;
    height: 10px;
    background: #ff00aa;
    border-radius: 50%;
    cursor: pointer;
  }

  .mini-value {
    flex: 0 0 32px;
    text-align: right;
    font-size: 9px;
    color: var(--text-muted, #888);
    font-family: monospace;
  }

  .layer-list {
    border-top: 1px solid #333;
    flex-shrink: 0;
    max-height: 150px;
    overflow-y: auto;
  }

  .layer-list-header {
    padding: 6px 12px;
    background: var(--bg-primary, #0d0d10);
    font-size: 10px;
    color: var(--text-muted, #888);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .layer-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 8px 12px;
    background: none;
    border: none;
    border-bottom: 1px solid #333;
    color: var(--text-primary, #ccc);
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s;
    text-align: left;
  }

  .layer-item:hover {
    background: #333;
  }

  .layer-item.selected {
    background: var(--bg-tertiary, #161618);
    border-left: 3px solid #ff00aa;
    color: #fff;
  }

  .layer-item .layer-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .layer-status {
    font-size: 9px;
    padding: 2px 5px;
    border-radius: 3px;
  }

  .layer-status.loaded {
    background: #BB86FC33;
    color: #BB86FC;
  }

  .layer-status.empty {
    background: #66666633;
    color: #666;
  }
</style>
