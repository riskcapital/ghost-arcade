<script lang="ts">
  import { project, selectedSVGLayer, selectedSVGContent, layers } from '../stores/layers';
  import type {
    Layer, SVGFillMode, SVGColorMode, SVGContent,
    SVGRenderMode, SVGMaterialPreset, SVGLightPreset, SVGOutlineStyle, SVGConnectionStyle,
  } from '../types';
  import { t } from '../i18n';

  // Tray state
  export let isOpen = false;
  export let embedded = false;

  // Drag and drop state
  let isDragOver = false;

  // Fill mode options
  const fillModes: { value: SVGFillMode; label: string }[] = [
    { value: 'liquid', label: 'creative.svg.fillModes.liquid' },
    { value: 'solid', label: 'creative.svg.fillModes.solid' },
    { value: 'gradient', label: 'creative.svg.fillModes.gradient' },
    { value: 'shimmer', label: 'creative.svg.fillModes.shimmer' },
    { value: 'pulse', label: 'creative.svg.fillModes.pulse' },
    { value: 'noise', label: 'creative.svg.fillModes.noise' },
    { value: 'particles', label: 'creative.svg.fillModes.particles' },
    { value: 'fluid', label: 'creative.svg.fillModes.fluid' },
    { value: 'flow', label: 'creative.svg.fillModes.flow' },
  ];

  const renderModes: { value: SVGRenderMode; label: string }[] = [
    { value: 'flat', label: 'creative.svg.renderModes.flat' },
    { value: 'extrude', label: 'creative.svg.renderModes.extrude' },
  ];
  const materialPresets: { value: SVGMaterialPreset; label: string }[] = [
    { value: 'holographic', label: 'creative.svg.materials.holographic' },
    { value: 'chrome', label: 'creative.svg.materials.chrome' },
    { value: 'glass', label: 'creative.svg.materials.glass' },
    { value: 'neon', label: 'creative.svg.materials.neon' },
    { value: 'matte', label: 'creative.svg.materials.matte' },
  ];
  const lightPresets: { value: SVGLightPreset; label: string }[] = [
    { value: 'studio', label: 'creative.svg.lights.studio' },
    { value: 'neon', label: 'creative.svg.lights.neon' },
    { value: 'rim', label: 'creative.svg.lights.rim' },
  ];
  const outlineStyles: { value: SVGOutlineStyle; label: string }[] = [
    { value: 'solid', label: 'creative.svg.outlineStyles.solid' },
    { value: 'dashed', label: 'creative.svg.outlineStyles.dashed' },
    { value: 'gradient', label: 'creative.svg.outlineStyles.gradient' },
    { value: 'double', label: 'creative.svg.outlineStyles.double' },
    { value: 'taper', label: 'creative.svg.outlineStyles.taper' },
    { value: 'glow-pulse', label: 'creative.svg.outlineStyles.glowPulse' },
  ];
  const connectionStyles: { value: SVGConnectionStyle; label: string }[] = [
    { value: 'arc', label: 'creative.svg.connectionStyles.arc' },
    { value: 'straight', label: 'creative.svg.connectionStyles.straight' },
    { value: 'electric', label: 'creative.svg.connectionStyles.electric' },
    { value: 'orbital', label: 'creative.svg.connectionStyles.orbital' },
    { value: 'beaded', label: 'creative.svg.connectionStyles.beaded' },
    { value: 'gravity', label: 'creative.svg.connectionStyles.gravity' },
    { value: 'dataflow', label: 'creative.svg.connectionStyles.dataflow' },
  ];

  // Color mode options
  const colorModes: { value: SVGColorMode; label: string }[] = [
    { value: 'perShape', label: 'creative.svg.colorModes.perShape' },
    { value: 'rainbow', label: 'creative.svg.colorModes.rainbow' },
    { value: 'monochrome', label: 'creative.svg.colorModes.monochrome' },
    { value: 'complementary', label: 'creative.svg.colorModes.complementary' },
    { value: 'analogous', label: 'creative.svg.colorModes.analogous' },
    { value: 'white', label: 'creative.svg.colorModes.white' },
  ];

  // Preset configurations
  const presets = [
    { name: 'creative.svg.presets.default', key: 'default' },
    { name: 'creative.svg.presets.electric', key: 'electric' },
    { name: 'creative.svg.presets.organic', key: 'organic' },
    { name: 'creative.svg.presets.neon', key: 'neon' },
    { name: 'creative.svg.presets.minimal', key: 'minimal' },
    { name: 'creative.svg.presets.chaos', key: 'chaos' },
    { name: 'creative.svg.presets.hologram', key: 'hologram' },
    { name: 'creative.svg.presets.chrome3d', key: 'chrome3d' },
    { name: 'creative.svg.presets.glass3d', key: 'glass3d' },
  ];

  // Collapsed sections state
  let expandedSections: Record<string, boolean> = {
    source: true,
    position: true,
    threeD: false,
    fillMode: false,
    colorMode: false,
    effects: false,
    organic: false,
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

  // Editable value readouts: typing a number commits it through the
  // sibling slider (reuses that slider's oninput → store wiring, so no
  // per-field param key needs threading). Clamps to the slider's range.
  function syncFromNumber(e: Event) {
    const num = e.currentTarget as HTMLInputElement;
    const range = num.previousElementSibling as HTMLInputElement | null;
    if (!range || range.type !== 'range') return;
    let v = parseFloat(num.value);
    if (Number.isNaN(v)) return;
    const min = parseFloat(range.min), max = parseFloat(range.max);
    if (!Number.isNaN(min)) v = Math.max(min, v);
    if (!Number.isNaN(max)) v = Math.min(max, v);
    range.value = String(v);
    range.dispatchEvent(new Event('input', { bubbles: true }));
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
      console.error($t('creative.svg.source.loadError'), err);
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
          console.error($t('creative.svg.source.loadError'), err);
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
      // ── 3D presets: drop a logo, pick one, it spins in 3D ──────────
      hologram: {
        renderMode: 'extrude', materialPreset: 'holographic',
        extrudeDepth: 32, bevelEnabled: true, bevelSize: 2.5,
        iridescence: 1, materialMetalness: 0.45, materialRoughness: 0.15,
        envIntensity: 1.2, lightPreset: 'neon', lightIntensity: 1.1,
        rotateSpeedY: 0.35, rotateSpeedX: 0.05, floatAmount: 10, floatSpeed: 0.8,
        colorMode: 'rainbow', colorCycleEnabled: true,
        bloomStrength: 0.5, bloomThreshold: 0.25, outlineStyle: 'double',
        // calmer effect bed so the 3D solid is the star
        particlesEnabled: false, lightningEnabled: false, plasmaEnabled: false,
        nebulaEnabled: true, glowEnabled: true,
      },
      chrome3d: {
        renderMode: 'extrude', materialPreset: 'chrome',
        extrudeDepth: 26, bevelEnabled: true, bevelSize: 2,
        materialMetalness: 1, materialRoughness: 0.08, envIntensity: 1.5,
        lightPreset: 'studio', lightIntensity: 1.2,
        rotateSpeedY: 0.4, floatAmount: 6, floatSpeed: 0.7,
        colorMode: 'white', bloomStrength: 0.35, bloomThreshold: 0.3,
        particlesEnabled: false, lightningEnabled: false, plasmaEnabled: false,
        nebulaEnabled: true,
      },
      glass3d: {
        renderMode: 'extrude', materialPreset: 'glass',
        extrudeDepth: 40, bevelEnabled: true, bevelSize: 3,
        glassTransmission: 0.95, materialRoughness: 0.06, envIntensity: 1.3,
        lightPreset: 'rim', lightIntensity: 1.0,
        rotateSpeedY: 0.3, rotateSpeedX: 0.08, floatAmount: 12, floatSpeed: 0.6,
        colorMode: 'analogous', bloomStrength: 0.45, bloomThreshold: 0.28,
        particlesEnabled: false, lightningEnabled: false, plasmaEnabled: false,
        nebulaEnabled: true,
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
  $: svgLayers = $layers.filter((l) => l.type === 'svg') as Layer[];
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
    <h3>{$t('creative.svg.title')}</h3>
  </div>

  <div class="tray-content">
    {#if !$selectedSVGLayer}
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M3 15l6-6 4 4 8-8" />
          <circle cx="8" cy="8" r="2" />
        </svg>
        <p>{$t('creative.svg.empty.noLayer')}</p>
        <p class="hint">{$t('creative.svg.empty.selectHint')}</p>
      </div>
    {:else}
      <!-- SVG Source Section -->
      <div class="section">
        <button class="section-header" onclick={() => toggleSection('source')}>
          <span>{$t('creative.svg.sections.source')}</span>
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
            aria-label={$t('creative.svg.source.dropZoneAria')}
          >
            {#if $selectedSVGContent?.svgSource}
              <div class="svg-loaded">
                <div class="svg-preview">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#67E8F9" stroke-width="2">
                    <path d="M9 12l2 2 4-4" />
                    <circle cx="12" cy="12" r="10" />
                  </svg>
                  <span>{$t('creative.svg.source.loaded')}</span>
                </div>
                <div class="svg-actions">
                  <label class="action-btn replace">
                    <input type="file" accept=".svg" onchange={handleSVGUpload} />
                    {$t('creative.svg.source.replace')}
                  </label>
                  <button class="action-btn clear" onclick={clearSVGSource}>
                    {$t('creative.svg.source.clear')}
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
                <p>{$t('creative.svg.source.dropHere')}</p>
                <label class="upload-btn">
                  <input type="file" accept=".svg" onchange={handleSVGUpload} />
                  {$t('creative.svg.source.upload')}
                </label>
              </div>
            {/if}
          </div>
        {/if}
      </div>

      <!-- Position & Scale Section -->
      <div class="section">
        <button class="section-header" onclick={() => toggleSection('position')}>
          <span>{$t('creative.svg.sections.position')}</span>
          <span class="toggle">{expandedSections.position ? '-' : '+'}</span>
        </button>
        {#if expandedSections.position && $selectedSVGContent}
          <div class="section-content">
            <div class="param-row">
              <label>{$t('creative.svg.labels.panX')}</label>
              <input
                type="range"
                min="-1"
                max="1"
                step="0.01"
                value={$selectedSVGContent.panX ?? 0}
                oninput={(e) => updateParam('panX', parseFloat((e.target as HTMLInputElement).value))}
              />
              <input class="value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={($selectedSVGContent.panX ?? 0).toFixed(2)} />
            </div>
            <div class="param-row">
              <label>{$t('creative.svg.labels.panY')}</label>
              <input
                type="range"
                min="-1"
                max="1"
                step="0.01"
                value={$selectedSVGContent.panY ?? 0}
                oninput={(e) => updateParam('panY', parseFloat((e.target as HTMLInputElement).value))}
              />
              <input class="value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={($selectedSVGContent.panY ?? 0).toFixed(2)} />
            </div>
            <div class="param-row">
              <label>{$t('creative.common.scale')}</label>
              <input
                type="range"
                min="0.1"
                max="3"
                step="0.01"
                value={$selectedSVGContent.contentScale ?? 1}
                oninput={(e) => updateParam('contentScale', parseFloat((e.target as HTMLInputElement).value))}
              />
              <input class="value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={($selectedSVGContent.contentScale ?? 1).toFixed(2)} />
            </div>
            <button class="reset-position-btn" onclick={() => {
              updateParam('panX', 0);
              updateParam('panY', 0);
              updateParam('contentScale', 1);
            }}>
              {$t('creative.svg.labels.resetPosition')}
            </button>
          </div>
        {/if}
      </div>

      <!-- 3D / Material Section -->
      <div class="section">
        <button class="section-header" onclick={() => toggleSection('threeD')}>
          <span>{$t('creative.svg.sections.threeD')}</span>
          <span class="toggle">{expandedSections.threeD ? '-' : '+'}</span>
        </button>
        {#if expandedSections.threeD && $selectedSVGContent}
          <div class="section-content">
            <div class="param-row">
              <label>{$t('creative.svg.labels.renderMode')}</label>
              <select
                value={$selectedSVGContent.renderMode ?? 'flat'}
                onchange={(e) => updateParam('renderMode', (e.target as HTMLSelectElement).value)}
              >
                {#each renderModes as m}<option value={m.value}>{$t(m.label)}</option>{/each}
              </select>
            </div>

            {#if ($selectedSVGContent.renderMode ?? 'flat') === 'extrude'}
              <div class="param-row">
                <label>{$t('creative.svg.labels.material')}</label>
                <select
                  value={$selectedSVGContent.materialPreset ?? 'holographic'}
                  onchange={(e) => updateParam('materialPreset', (e.target as HTMLSelectElement).value)}
                >
                  {#each materialPresets as m}<option value={m.value}>{$t(m.label)}</option>{/each}
                </select>
              </div>
              <div class="param-row">
                <label>{$t('creative.common.depth')}</label>
                <input type="range" min="0" max="120" step="1"
                  value={$selectedSVGContent.extrudeDepth ?? 28}
                  oninput={(e) => updateParam('extrudeDepth', parseFloat((e.target as HTMLInputElement).value))} />
                <input class="value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={Math.round($selectedSVGContent.extrudeDepth ?? 28)} />
              </div>
              <div class="param-row">
                <label>
                  <input type="checkbox" checked={$selectedSVGContent.bevelEnabled ?? true}
                    onchange={() => toggleParam('bevelEnabled')} />{$t('creative.common.bevel')}</label>
              </div>
              {#if $selectedSVGContent.bevelEnabled ?? true}
                <div class="param-row">
                  <label>{$t('creative.common.bevelSize')}</label>
                  <input type="range" min="0" max="6" step="0.1"
                    value={$selectedSVGContent.bevelSize ?? 2}
                    oninput={(e) => updateParam('bevelSize', parseFloat((e.target as HTMLInputElement).value))} />
                  <input class="value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={($selectedSVGContent.bevelSize ?? 2).toFixed(1)} />
                </div>
              {/if}
              {#if ($selectedSVGContent.materialPreset ?? 'holographic') === 'holographic'}
                <div class="param-row">
                  <label>{$t('creative.svg.labels.iridescence')}</label>
                  <input type="range" min="0" max="1" step="0.01"
                    value={$selectedSVGContent.iridescence ?? 1}
                    oninput={(e) => updateParam('iridescence', parseFloat((e.target as HTMLInputElement).value))} />
                  <input class="value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={($selectedSVGContent.iridescence ?? 1).toFixed(2)} />
                </div>
              {/if}
              {#if ($selectedSVGContent.materialPreset ?? 'holographic') === 'glass'}
                <div class="param-row">
                  <label>{$t('creative.svg.labels.transmission')}</label>
                  <input type="range" min="0" max="1" step="0.01"
                    value={$selectedSVGContent.glassTransmission ?? 0.9}
                    oninput={(e) => updateParam('glassTransmission', parseFloat((e.target as HTMLInputElement).value))} />
                  <input class="value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={($selectedSVGContent.glassTransmission ?? 0.9).toFixed(2)} />
                </div>
              {/if}
              <div class="param-row">
                <label>{$t('creative.svg.labels.metalness')}</label>
                <input type="range" min="0" max="1" step="0.01"
                  value={$selectedSVGContent.materialMetalness ?? 0.6}
                  oninput={(e) => updateParam('materialMetalness', parseFloat((e.target as HTMLInputElement).value))} />
                <input class="value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={($selectedSVGContent.materialMetalness ?? 0.6).toFixed(2)} />
              </div>
              <div class="param-row">
                <label>{$t('creative.common.roughness')}</label>
                <input type="range" min="0" max="1" step="0.01"
                  value={$selectedSVGContent.materialRoughness ?? 0.25}
                  oninput={(e) => updateParam('materialRoughness', parseFloat((e.target as HTMLInputElement).value))} />
                <input class="value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={($selectedSVGContent.materialRoughness ?? 0.25).toFixed(2)} />
              </div>
              <div class="param-row">
                <label>{$t('creative.svg.labels.reflections')}</label>
                <input type="range" min="0" max="2" step="0.01"
                  value={$selectedSVGContent.envIntensity ?? 1}
                  oninput={(e) => updateParam('envIntensity', parseFloat((e.target as HTMLInputElement).value))} />
                <input class="value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={($selectedSVGContent.envIntensity ?? 1).toFixed(2)} />
              </div>
              <div class="param-row">
                <label>{$t('creative.svg.labels.lights')}</label>
                <select
                  value={$selectedSVGContent.lightPreset ?? 'studio'}
                  onchange={(e) => updateParam('lightPreset', (e.target as HTMLSelectElement).value)}
                >
                  {#each lightPresets as m}<option value={m.value}>{$t(m.label)}</option>{/each}
                </select>
              </div>
              <div class="param-row">
                <label>{$t('creative.svg.labels.lightPower')}</label>
                <input type="range" min="0" max="3" step="0.05"
                  value={$selectedSVGContent.lightIntensity ?? 1}
                  oninput={(e) => updateParam('lightIntensity', parseFloat((e.target as HTMLInputElement).value))} />
                <input class="value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={($selectedSVGContent.lightIntensity ?? 1).toFixed(2)} />
              </div>
              <div class="param-row">
                <label>{$t('creative.svg.labels.fov')}</label>
                <input type="range" min="25" max="75" step="1"
                  value={$selectedSVGContent.cameraFov ?? 40}
                  oninput={(e) => updateParam('cameraFov', parseFloat((e.target as HTMLInputElement).value))} />
                <input class="value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={Math.round($selectedSVGContent.cameraFov ?? 40)} />
              </div>
              <div class="param-subhead">{$t('creative.svg.subheads.rotateManual')}</div>
              <div class="param-row">
                <label>{$t('creative.svg.labels.rotateX')}</label>
                <input type="range" min="-180" max="180" step="1"
                  value={$selectedSVGContent.rotateX ?? 0}
                  oninput={(e) => updateParam('rotateX', parseFloat((e.target as HTMLInputElement).value))} />
                <input class="value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={Math.round($selectedSVGContent.rotateX ?? 0)} />
              </div>
              <div class="param-row">
                <label>{$t('creative.svg.labels.rotateY')}</label>
                <input type="range" min="-180" max="180" step="1"
                  value={$selectedSVGContent.rotateY ?? 0}
                  oninput={(e) => updateParam('rotateY', parseFloat((e.target as HTMLInputElement).value))} />
                <input class="value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={Math.round($selectedSVGContent.rotateY ?? 0)} />
              </div>
              <div class="param-row">
                <label>{$t('creative.svg.labels.rotateZ')}</label>
                <input type="range" min="-180" max="180" step="1"
                  value={$selectedSVGContent.rotateZ ?? 0}
                  oninput={(e) => updateParam('rotateZ', parseFloat((e.target as HTMLInputElement).value))} />
                <input class="value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={Math.round($selectedSVGContent.rotateZ ?? 0)} />
              </div>
              <div class="param-subhead">{$t('creative.svg.subheads.autoSpin')}</div>
              <div class="param-row">
                <label>{$t('creative.svg.labels.spinX')}</label>
                <input type="range" min="-1.5" max="1.5" step="0.01"
                  value={$selectedSVGContent.rotateSpeedX ?? 0}
                  oninput={(e) => updateParam('rotateSpeedX', parseFloat((e.target as HTMLInputElement).value))} />
                <input class="value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={($selectedSVGContent.rotateSpeedX ?? 0).toFixed(2)} />
              </div>
              <div class="param-row">
                <label>{$t('creative.svg.labels.spinY')}</label>
                <input type="range" min="-1.5" max="1.5" step="0.01"
                  value={$selectedSVGContent.rotateSpeedY ?? 0.25}
                  oninput={(e) => updateParam('rotateSpeedY', parseFloat((e.target as HTMLInputElement).value))} />
                <input class="value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={($selectedSVGContent.rotateSpeedY ?? 0.25).toFixed(2)} />
              </div>
              <div class="param-row">
                <label>{$t('creative.svg.labels.spinZ')}</label>
                <input type="range" min="-1.5" max="1.5" step="0.01"
                  value={$selectedSVGContent.rotateSpeedZ ?? 0}
                  oninput={(e) => updateParam('rotateSpeedZ', parseFloat((e.target as HTMLInputElement).value))} />
                <input class="value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={($selectedSVGContent.rotateSpeedZ ?? 0).toFixed(2)} />
              </div>
              <div class="param-row">
                <label>{$t('creative.svg.labels.float')}</label>
                <input type="range" min="0" max="40" step="1"
                  value={$selectedSVGContent.floatAmount ?? 8}
                  oninput={(e) => updateParam('floatAmount', parseFloat((e.target as HTMLInputElement).value))} />
                <input class="value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={Math.round($selectedSVGContent.floatAmount ?? 8)} />
              </div>
              <div class="param-row">
                <label>{$t('creative.common.bloom')}</label>
                <input type="range" min="0" max="4" step="0.05"
                  value={$selectedSVGContent.bloomStrength ?? 0}
                  oninput={(e) => updateParam('bloomStrength', parseFloat((e.target as HTMLInputElement).value))} />
                <input class="value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={($selectedSVGContent.bloomStrength ?? 0).toFixed(2)} />
              </div>
            {/if}
          </div>
        {/if}
      </div>

      <!-- Presets -->
      <div class="section">
        <div class="section-header static">
          <span>{$t('creative.svg.sections.presets')}</span>
        </div>
        <div class="section-content presets">
          {#each presets as preset}
            <button class="preset-btn" onclick={() => applyPreset(preset.key)}>
              {$t(preset.name)}
            </button>
          {/each}
          <button class="preset-btn reset" onclick={resetToDefaults}>
            {$t('creative.svg.presets.reset')}
          </button>
        </div>
      </div>

      <!-- Fill Mode Section -->
      <div class="section">
        <button class="section-header" onclick={() => toggleSection('fillMode')}>
          <span>{$t('creative.svg.sections.fillMode')}</span>
          <span class="toggle">{expandedSections.fillMode ? '-' : '+'}</span>
        </button>
        {#if expandedSections.fillMode && $selectedSVGContent}
          <div class="section-content">
            <div class="param-row">
              <label>{$t('creative.common.mode')}</label>
              <select
                value={$selectedSVGContent.fillMode}
                onchange={(e) => updateParam('fillMode', (e.target as HTMLSelectElement).value)}
              >
                {#each fillModes as mode}
                  <option value={mode.value}>{$t(mode.label)}</option>
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
                  />{$t('creative.common.enabled')}</label>
              </div>
              <div class="param-row">
                <label>{$t('creative.common.speed')}</label>
                <input
                  type="range"
                  min="0.05"
                  max="1"
                  step="0.01"
                  value={$selectedSVGContent.liquidSpeed}
                  oninput={(e) => updateParam('liquidSpeed', parseFloat((e.target as HTMLInputElement).value))}
                />
                <input class="value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={$selectedSVGContent.liquidSpeed.toFixed(2)} />
              </div>
              <div class="param-row">
                <label>{$t('creative.svg.labels.waveAmp')}</label>
                <input
                  type="range"
                  min="0.02"
                  max="0.15"
                  step="0.01"
                  value={$selectedSVGContent.liquidWaveAmp}
                  oninput={(e) => updateParam('liquidWaveAmp', parseFloat((e.target as HTMLInputElement).value))}
                />
                <input class="value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={$selectedSVGContent.liquidWaveAmp.toFixed(2)} />
              </div>
            {/if}

            {#if $selectedSVGContent.fillMode === 'gradient'}
              <div class="param-row">
                <label>{$t('creative.common.angle')}</label>
                <input
                  type="range"
                  min="0"
                  max="360"
                  step="1"
                  value={$selectedSVGContent.gradientAngle}
                  oninput={(e) => updateParam('gradientAngle', parseFloat((e.target as HTMLInputElement).value))}
                />
                <input class="value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={$selectedSVGContent.gradientAngle} />
              </div>
              <div class="param-row">
                <label>{$t('creative.svg.labels.spread')}</label>
                <input
                  type="range"
                  min="0.1"
                  max="0.8"
                  step="0.01"
                  value={$selectedSVGContent.gradientSpread}
                  oninput={(e) => updateParam('gradientSpread', parseFloat((e.target as HTMLInputElement).value))}
                />
                <input class="value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={$selectedSVGContent.gradientSpread.toFixed(2)} />
              </div>
            {/if}

            {#if $selectedSVGContent.fillMode === 'shimmer'}
              <div class="param-row">
                <label>{$t('creative.common.speed')}</label>
                <input
                  type="range"
                  min="1"
                  max="15"
                  step="0.1"
                  value={$selectedSVGContent.shimmerSpeed}
                  oninput={(e) => updateParam('shimmerSpeed', parseFloat((e.target as HTMLInputElement).value))}
                />
                <input class="value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={$selectedSVGContent.shimmerSpeed.toFixed(1)} />
              </div>
              <div class="param-row">
                <label>{$t('creative.common.scale')}</label>
                <input
                  type="range"
                  min="0.02"
                  max="0.3"
                  step="0.01"
                  value={$selectedSVGContent.shimmerScale}
                  oninput={(e) => updateParam('shimmerScale', parseFloat((e.target as HTMLInputElement).value))}
                />
                <input class="value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={$selectedSVGContent.shimmerScale.toFixed(2)} />
              </div>
              <div class="param-row">
                <label>{$t('creative.common.intensity')}</label>
                <input
                  type="range"
                  min="0.2"
                  max="1.5"
                  step="0.01"
                  value={$selectedSVGContent.shimmerIntensity}
                  oninput={(e) => updateParam('shimmerIntensity', parseFloat((e.target as HTMLInputElement).value))}
                />
                <input class="value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={$selectedSVGContent.shimmerIntensity.toFixed(2)} />
              </div>
            {/if}

            {#if $selectedSVGContent.fillMode === 'pulse'}
              <div class="param-row">
                <label>{$t('creative.common.speed')}</label>
                <input
                  type="range"
                  min="0.5"
                  max="10"
                  step="0.1"
                  value={$selectedSVGContent.pulseSpeed}
                  oninput={(e) => updateParam('pulseSpeed', parseFloat((e.target as HTMLInputElement).value))}
                />
                <input class="value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={$selectedSVGContent.pulseSpeed.toFixed(1)} />
              </div>
              <div class="param-row">
                <label>{$t('creative.svg.labels.ringScale')}</label>
                <input
                  type="range"
                  min="2"
                  max="30"
                  step="1"
                  value={$selectedSVGContent.pulseRingScale}
                  oninput={(e) => updateParam('pulseRingScale', parseFloat((e.target as HTMLInputElement).value))}
                />
                <input class="value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={$selectedSVGContent.pulseRingScale} />
              </div>
            {/if}

            {#if $selectedSVGContent.fillMode === 'noise'}
              <div class="param-row">
                <label>{$t('creative.common.scale')}</label>
                <input
                  type="range"
                  min="0.005"
                  max="0.1"
                  step="0.001"
                  value={$selectedSVGContent.noiseScale}
                  oninput={(e) => updateParam('noiseScale', parseFloat((e.target as HTMLInputElement).value))}
                />
                <input class="value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={$selectedSVGContent.noiseScale.toFixed(3)} />
              </div>
              <div class="param-row">
                <label>{$t('creative.common.speed')}</label>
                <input
                  type="range"
                  min="0.1"
                  max="2"
                  step="0.01"
                  value={$selectedSVGContent.noiseSpeed}
                  oninput={(e) => updateParam('noiseSpeed', parseFloat((e.target as HTMLInputElement).value))}
                />
                <input class="value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={$selectedSVGContent.noiseSpeed.toFixed(2)} />
              </div>
            {/if}

            {#if $selectedSVGContent.fillMode === 'particles'}
              <div class="param-row">
                <label>{$t('creative.svg.labels.density')}</label>
                <input
                  type="range"
                  min="50"
                  max="500"
                  step="10"
                  value={$selectedSVGContent.particleFillDensity}
                  oninput={(e) => updateParam('particleFillDensity', parseFloat((e.target as HTMLInputElement).value))}
                />
                <input class="value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={$selectedSVGContent.particleFillDensity} />
              </div>
              <div class="param-row">
                <label>{$t('creative.svg.labels.size')}</label>
                <input
                  type="range"
                  min="1"
                  max="10"
                  step="0.1"
                  value={$selectedSVGContent.particleFillSize}
                  oninput={(e) => updateParam('particleFillSize', parseFloat((e.target as HTMLInputElement).value))}
                />
                <input class="value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={$selectedSVGContent.particleFillSize.toFixed(1)} />
              </div>
            {/if}

            {#if $selectedSVGContent.fillMode === 'fluid' || $selectedSVGContent.fillMode === 'flow'}
              <div class="param-row">
                <label>{$t('creative.svg.labels.fluidScale')}</label>
                <input type="range" min="0.5" max="6" step="0.1"
                  value={$selectedSVGContent.fluidScale ?? 2.5}
                  oninput={(e) => updateParam('fluidScale', parseFloat((e.target as HTMLInputElement).value))} />
                <input class="value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={($selectedSVGContent.fluidScale ?? 2.5).toFixed(1)} />
              </div>
              <div class="param-row">
                <label>{$t('creative.svg.labels.fluidSpeed')}</label>
                <input type="range" min="0.1" max="3" step="0.05"
                  value={$selectedSVGContent.fluidSpeed ?? 0.6}
                  oninput={(e) => updateParam('fluidSpeed', parseFloat((e.target as HTMLInputElement).value))} />
                <input class="value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={($selectedSVGContent.fluidSpeed ?? 0.6).toFixed(2)} />
              </div>
              <div class="param-row">
                <label>{$t('creative.common.turbulence')}</label>
                <input type="range" min="0" max="2" step="0.05"
                  value={$selectedSVGContent.fluidTurbulence ?? 1}
                  oninput={(e) => updateParam('fluidTurbulence', parseFloat((e.target as HTMLInputElement).value))} />
                <input class="value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={($selectedSVGContent.fluidTurbulence ?? 1).toFixed(2)} />
              </div>
            {/if}

            <!-- Volumetric particle fill (fills the shape interior) -->
            <div class="param-row">
              <label>
                <input type="checkbox" checked={$selectedSVGContent.particleFillEnabled ?? false}
                  onchange={() => toggleParam('particleFillEnabled')} />{$t('creative.svg.labels.particleFill')}</label>
            </div>
            {#if $selectedSVGContent.particleFillEnabled}
              <div class="param-row">
                <label>{$t('creative.svg.labels.fillDensity')}</label>
                <input type="range" min="50" max="500" step="10"
                  value={$selectedSVGContent.particleFillDensity}
                  oninput={(e) => updateParam('particleFillDensity', parseFloat((e.target as HTMLInputElement).value))} />
                <input class="value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={$selectedSVGContent.particleFillDensity} />
              </div>
              <div class="param-row">
                <label>{$t('creative.svg.labels.fillSpeed')}</label>
                <input type="range" min="0.1" max="3" step="0.05"
                  value={$selectedSVGContent.particleFillSpeed}
                  oninput={(e) => updateParam('particleFillSpeed', parseFloat((e.target as HTMLInputElement).value))} />
                <input class="value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={$selectedSVGContent.particleFillSpeed.toFixed(2)} />
              </div>
            {/if}

            <!-- Outline (always visible) -->
            <div class="param-row">
              <label>{$t('creative.svg.labels.outlineStyle')}</label>
              <select
                value={$selectedSVGContent.outlineStyle ?? 'solid'}
                onchange={(e) => updateParam('outlineStyle', (e.target as HTMLSelectElement).value)}
              >
                {#each outlineStyles as s}<option value={s.value}>{$t(s.label)}</option>{/each}
              </select>
            </div>
            <div class="param-row">
              <label>{$t('creative.svg.labels.outline')}</label>
              <input
                type="range"
                min="1"
                max="10"
                step="0.5"
                value={$selectedSVGContent.outlineThickness}
                oninput={(e) => updateParam('outlineThickness', parseFloat((e.target as HTMLInputElement).value))}
              />
              <input class="value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={$selectedSVGContent.outlineThickness.toFixed(1)} />
            </div>
          </div>
        {/if}
      </div>

      <!-- Color Mode Section -->
      <div class="section">
        <button class="section-header" onclick={() => toggleSection('colorMode')}>
          <span>{$t('creative.svg.sections.colorMode')}</span>
          <span class="toggle">{expandedSections.colorMode ? '-' : '+'}</span>
        </button>
        {#if expandedSections.colorMode && $selectedSVGContent}
          <div class="section-content">
            <div class="param-row">
              <label>{$t('creative.common.mode')}</label>
              <select
                value={$selectedSVGContent.colorMode}
                onchange={(e) => updateParam('colorMode', (e.target as HTMLSelectElement).value)}
              >
                {#each colorModes as mode}
                  <option value={mode.value}>{$t(mode.label)}</option>
                {/each}
              </select>
            </div>

            {#if $selectedSVGContent.colorMode === 'monochrome' || $selectedSVGContent.colorMode === 'complementary' || $selectedSVGContent.colorMode === 'analogous'}
              <div class="param-row">
                <label>{$t('creative.svg.labels.hue')}</label>
                <input
                  type="range"
                  min="0"
                  max="360"
                  step="1"
                  value={$selectedSVGContent.monochromeHue}
                  oninput={(e) => updateParam('monochromeHue', parseFloat((e.target as HTMLInputElement).value))}
                />
                <input class="value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={$selectedSVGContent.monochromeHue} />
              </div>
            {/if}

            <div class="param-row">
              <label>
                <input
                  type="checkbox"
                  checked={$selectedSVGContent.colorCycleEnabled}
                  onchange={() => toggleParam('colorCycleEnabled')}
                />{$t('creative.svg.labels.colorCycle')}</label>
            </div>

            {#if $selectedSVGContent.colorCycleEnabled}
              <div class="param-row">
                <label>{$t('creative.common.speed')}</label>
                <input
                  type="range"
                  min="0.05"
                  max="1"
                  step="0.01"
                  value={$selectedSVGContent.colorCycleSpeed}
                  oninput={(e) => updateParam('colorCycleSpeed', parseFloat((e.target as HTMLInputElement).value))}
                />
                <input class="value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={$selectedSVGContent.colorCycleSpeed.toFixed(2)} />
              </div>
            {/if}
          </div>
        {/if}
      </div>

      <!-- Effects Section -->
      <div class="section">
        <button class="section-header" onclick={() => toggleSection('effects')}>
          <span>{$t('creative.svg.sections.effects')}</span>
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
                />{$t('creative.svg.labels.energyPulses')}</label>
              {#if $selectedSVGContent.energyEnabled}
                <div class="effect-params">
                  <div class="mini-param">
                    <span>{$t('creative.common.speed')}</span>
                    <input
                      type="range"
                      min="50"
                      max="500"
                      value={$selectedSVGContent.energySpeed}
                      oninput={(e) => updateParam('energySpeed', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <input class="mini-value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={$selectedSVGContent.energySpeed} />
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
                />{$t('creative.svg.labels.connections')}</label>
              {#if $selectedSVGContent.connectionsEnabled}
                <div class="effect-params">
                  <div class="mini-param">
                    <span>{$t('creative.svg.labels.style')}</span>
                    <select
                      value={$selectedSVGContent.connectionStyle ?? 'arc'}
                      onchange={(e) => updateParam('connectionStyle', (e.target as HTMLSelectElement).value)}
                    >
                      {#each connectionStyles as s}<option value={s.value}>{$t(s.label)}</option>{/each}
                    </select>
                  </div>
                  <div class="mini-param">
                    <span>{$t('creative.svg.labels.range')}</span>
                    <input
                      type="range"
                      min="50"
                      max="400"
                      step="10"
                      value={$selectedSVGContent.connectionRange ?? 200}
                      oninput={(e) => updateParam('connectionRange', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <input class="mini-value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={Math.round($selectedSVGContent.connectionRange ?? 200)} />
                  </div>
                  <div class="mini-param">
                    <span>{$t('creative.svg.labels.pulse')}</span>
                    <input
                      type="range"
                      min="0.5"
                      max="6"
                      step="0.1"
                      value={$selectedSVGContent.connectionPulseSpeed}
                      oninput={(e) => updateParam('connectionPulseSpeed', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <input class="mini-value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={$selectedSVGContent.connectionPulseSpeed?.toFixed(1)} />
                  </div>
                  <div class="mini-param">
                    <span>{$t('creative.common.thickness')}</span>
                    <input
                      type="range"
                      min="1"
                      max="8"
                      step="0.5"
                      value={$selectedSVGContent.connectionThickness}
                      oninput={(e) => updateParam('connectionThickness', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <input class="mini-value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={$selectedSVGContent.connectionThickness?.toFixed(1)} />
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
                />{$t('creative.svg.labels.vertexGlow')}</label>
              {#if $selectedSVGContent.glowEnabled}
                <div class="effect-params">
                  <div class="mini-param">
                    <span>{$t('creative.svg.labels.pulse')}</span>
                    <input
                      type="range"
                      min="0.5"
                      max="8"
                      step="0.1"
                      value={$selectedSVGContent.glowPulseSpeed}
                      oninput={(e) => updateParam('glowPulseSpeed', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <input class="mini-value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={$selectedSVGContent.glowPulseSpeed?.toFixed(1)} />
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
                />{$t('creative.svg.labels.ripples')}</label>
              {#if $selectedSVGContent.ripplesEnabled}
                <div class="effect-params">
                  <div class="mini-param">
                    <span>{$t('creative.common.speed')}</span>
                    <input
                      type="range"
                      min="0.3"
                      max="3"
                      step="0.1"
                      value={$selectedSVGContent.rippleSpeed}
                      oninput={(e) => updateParam('rippleSpeed', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <input class="mini-value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={$selectedSVGContent.rippleSpeed?.toFixed(1)} />
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
                />{$t('creative.svg.labels.lightning')}</label>
              {#if $selectedSVGContent.lightningEnabled}
                <div class="effect-params">
                  <div class="mini-param">
                    <span>{$t('creative.svg.labels.frequency')}</span>
                    <input
                      type="range"
                      min="0.1"
                      max="4"
                      step="0.1"
                      value={$selectedSVGContent.lightningFrequency}
                      oninput={(e) => updateParam('lightningFrequency', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <input class="mini-value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={$selectedSVGContent.lightningFrequency?.toFixed(1)} />
                  </div>
                  <div class="mini-param">
                    <span>{$t('creative.common.thickness')}</span>
                    <input
                      type="range"
                      min="1"
                      max="8"
                      step="0.5"
                      value={$selectedSVGContent.lightningThickness}
                      oninput={(e) => updateParam('lightningThickness', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <input class="mini-value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={$selectedSVGContent.lightningThickness?.toFixed(1)} />
                  </div>
                  <div class="mini-param">
                    <span>{$t('creative.common.branches')}</span>
                    <input
                      type="range"
                      min="0"
                      max="6"
                      step="1"
                      value={$selectedSVGContent.lightningBranches}
                      oninput={(e) => updateParam('lightningBranches', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <input class="mini-value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={$selectedSVGContent.lightningBranches} />
                  </div>
                  <div class="mini-param">
                    <span>{$t('creative.svg.labels.duration')}</span>
                    <input
                      type="range"
                      min="0.05"
                      max="0.4"
                      step="0.01"
                      value={$selectedSVGContent.lightningDuration}
                      oninput={(e) => updateParam('lightningDuration', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <input class="mini-value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={$selectedSVGContent.lightningDuration?.toFixed(2)} />
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
                />{$t('creative.svg.labels.edgeFlow')}</label>
              {#if $selectedSVGContent.edgeFlowEnabled}
                <div class="effect-params">
                  <div class="mini-param">
                    <span>{$t('creative.common.speed')}</span>
                    <input
                      type="range"
                      min="0.5"
                      max="4"
                      step="0.1"
                      value={$selectedSVGContent.edgeFlowSpeed}
                      oninput={(e) => updateParam('edgeFlowSpeed', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <input class="mini-value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={$selectedSVGContent.edgeFlowSpeed?.toFixed(1)} />
                  </div>
                  <div class="mini-param">
                    <span>{$t('creative.common.thickness')}</span>
                    <input
                      type="range"
                      min="1"
                      max="6"
                      step="0.5"
                      value={$selectedSVGContent.edgeFlowThickness}
                      oninput={(e) => updateParam('edgeFlowThickness', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <input class="mini-value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={$selectedSVGContent.edgeFlowThickness?.toFixed(1)} />
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
                />{$t('creative.svg.labels.innerGlow')}</label>
              {#if $selectedSVGContent.innerGlowEnabled}
                <div class="effect-params">
                  <div class="mini-param">
                    <span>{$t('creative.common.intensity')}</span>
                    <input
                      type="range"
                      min="0.1"
                      max="1"
                      step="0.05"
                      value={$selectedSVGContent.innerGlowIntensity}
                      oninput={(e) => updateParam('innerGlowIntensity', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <input class="mini-value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={$selectedSVGContent.innerGlowIntensity?.toFixed(2)} />
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
                />{$t('creative.svg.labels.nebulaBg')}</label>
              {#if $selectedSVGContent.nebulaEnabled}
                <div class="effect-params">
                  <div class="mini-param">
                    <span>{$t('creative.common.intensity')}</span>
                    <input
                      type="range"
                      min="0.1"
                      max="0.8"
                      step="0.05"
                      value={$selectedSVGContent.nebulaIntensity}
                      oninput={(e) => updateParam('nebulaIntensity', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <input class="mini-value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={$selectedSVGContent.nebulaIntensity?.toFixed(2)} />
                  </div>
                  <div class="mini-param">
                    <span>{$t('creative.common.speed')}</span>
                    <input
                      type="range"
                      min="0.05"
                      max="0.5"
                      step="0.01"
                      value={$selectedSVGContent.nebulaSpeed}
                      oninput={(e) => updateParam('nebulaSpeed', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <input class="mini-value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={$selectedSVGContent.nebulaSpeed?.toFixed(2)} />
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
                />{$t('creative.svg.labels.heartbeat')}</label>
              {#if $selectedSVGContent.heartbeatEnabled}
                <div class="effect-params">
                  <div class="mini-param">
                    <span>{$t('creative.common.speed')}</span>
                    <input
                      type="range"
                      min="0.3"
                      max="2.5"
                      step="0.1"
                      value={$selectedSVGContent.heartbeatSpeed}
                      oninput={(e) => updateParam('heartbeatSpeed', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <input class="mini-value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={$selectedSVGContent.heartbeatSpeed?.toFixed(1)} />
                  </div>
                  <div class="mini-param">
                    <span>{$t('creative.common.intensity')}</span>
                    <input
                      type="range"
                      min="0.1"
                      max="0.8"
                      step="0.05"
                      value={$selectedSVGContent.heartbeatIntensity}
                      oninput={(e) => updateParam('heartbeatIntensity', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <input class="mini-value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={$selectedSVGContent.heartbeatIntensity?.toFixed(2)} />
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
                />{$t('creative.svg.labels.plasmaTendrils')}</label>
              {#if $selectedSVGContent.plasmaEnabled}
                <div class="effect-params">
                  <div class="mini-param">
                    <span>{$t('creative.common.intensity')}</span>
                    <input
                      type="range"
                      min="0.2"
                      max="1.5"
                      step="0.05"
                      value={$selectedSVGContent.plasmaIntensity}
                      oninput={(e) => updateParam('plasmaIntensity', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <input class="mini-value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={$selectedSVGContent.plasmaIntensity?.toFixed(2)} />
                  </div>
                  <div class="mini-param">
                    <span>{$t('creative.common.speed')}</span>
                    <input
                      type="range"
                      min="0.5"
                      max="5"
                      step="0.1"
                      value={$selectedSVGContent.plasmaSpeed}
                      oninput={(e) => updateParam('plasmaSpeed', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <input class="mini-value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={$selectedSVGContent.plasmaSpeed?.toFixed(1)} />
                  </div>
                  <div class="mini-param">
                    <span>{$t('creative.common.thickness')}</span>
                    <input
                      type="range"
                      min="1"
                      max="8"
                      step="0.5"
                      value={$selectedSVGContent.plasmaThickness}
                      oninput={(e) => updateParam('plasmaThickness', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <input class="mini-value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={$selectedSVGContent.plasmaThickness?.toFixed(1)} />
                  </div>
                  <div class="mini-param">
                    <span>{$t('creative.common.opacity')}</span>
                    <input
                      type="range"
                      min="0.2"
                      max="1"
                      step="0.05"
                      value={$selectedSVGContent.plasmaOpacity}
                      oninput={(e) => updateParam('plasmaOpacity', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <input class="mini-value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={$selectedSVGContent.plasmaOpacity?.toFixed(2)} />
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
                />{$t('creative.svg.labels.particleLinks')}</label>
              {#if $selectedSVGContent.particleLinksEnabled}
                <div class="effect-params">
                  <div class="mini-param">
                    <span>{$t('creative.svg.labels.distance')}</span>
                    <input
                      type="range"
                      min="20"
                      max="150"
                      step="5"
                      value={$selectedSVGContent.particleLinkDistance}
                      oninput={(e) => updateParam('particleLinkDistance', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <input class="mini-value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={$selectedSVGContent.particleLinkDistance} />
                  </div>
                  <div class="mini-param">
                    <span>{$t('creative.common.opacity')}</span>
                    <input
                      type="range"
                      min="0.1"
                      max="1"
                      step="0.05"
                      value={$selectedSVGContent.particleLinkOpacity}
                      oninput={(e) => updateParam('particleLinkOpacity', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <input class="mini-value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={$selectedSVGContent.particleLinkOpacity?.toFixed(2)} />
                  </div>
                  <div class="mini-param">
                    <span>{$t('creative.common.thickness')}</span>
                    <input
                      type="range"
                      min="1"
                      max="6"
                      step="0.5"
                      value={$selectedSVGContent.particleLinkThickness}
                      oninput={(e) => updateParam('particleLinkThickness', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <input class="mini-value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={$selectedSVGContent.particleLinkThickness?.toFixed(1)} />
                  </div>
                  <div class="mini-param">
                    <span>{$t('creative.svg.labels.maxLinks')}</span>
                    <input
                      type="range"
                      min="100"
                      max="2000"
                      step="50"
                      value={$selectedSVGContent.particleLinkMaxLinks}
                      oninput={(e) => updateParam('particleLinkMaxLinks', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <input class="mini-value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={$selectedSVGContent.particleLinkMaxLinks} />
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
                />{$t('creative.svg.labels.echoLayers')}</label>
              {#if $selectedSVGContent.echoEnabled}
                <div class="effect-params">
                  <div class="mini-param">
                    <span>{$t('creative.common.layers')}</span>
                    <input
                      type="range"
                      min="1"
                      max="8"
                      step="1"
                      value={$selectedSVGContent.echoLayers}
                      oninput={(e) => updateParam('echoLayers', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <input class="mini-value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={$selectedSVGContent.echoLayers} />
                  </div>
                  <div class="mini-param">
                    <span>{$t('creative.common.spacing')}</span>
                    <input
                      type="range"
                      min="3"
                      max="20"
                      step="1"
                      value={$selectedSVGContent.echoSpacing}
                      oninput={(e) => updateParam('echoSpacing', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <input class="mini-value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={$selectedSVGContent.echoSpacing} />
                  </div>
                  <div class="mini-param">
                    <span>{$t('creative.common.thickness')}</span>
                    <input
                      type="range"
                      min="1"
                      max="6"
                      step="0.5"
                      value={$selectedSVGContent.echoThickness}
                      oninput={(e) => updateParam('echoThickness', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <input class="mini-value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={$selectedSVGContent.echoThickness?.toFixed(1)} />
                  </div>
                  <div class="mini-param">
                    <span>{$t('creative.common.opacity')}</span>
                    <input
                      type="range"
                      min="0.1"
                      max="0.6"
                      step="0.05"
                      value={$selectedSVGContent.echoOpacity}
                      oninput={(e) => updateParam('echoOpacity', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <input class="mini-value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={$selectedSVGContent.echoOpacity?.toFixed(2)} />
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
                />{$t('creative.svg.labels.arcBridges')}</label>
              {#if $selectedSVGContent.arcBridgesEnabled}
                <div class="effect-params">
                  <div class="mini-param">
                    <span>{$t('creative.svg.labels.height')}</span>
                    <input
                      type="range"
                      min="5"
                      max="40"
                      step="1"
                      value={$selectedSVGContent.arcBridgeHeight}
                      oninput={(e) => updateParam('arcBridgeHeight', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <input class="mini-value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={$selectedSVGContent.arcBridgeHeight} />
                  </div>
                  <div class="mini-param">
                    <span>{$t('creative.common.thickness')}</span>
                    <input
                      type="range"
                      min="1"
                      max="8"
                      step="0.5"
                      value={$selectedSVGContent.arcBridgeThickness}
                      oninput={(e) => updateParam('arcBridgeThickness', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <input class="mini-value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={$selectedSVGContent.arcBridgeThickness?.toFixed(1)} />
                  </div>
                  <div class="mini-param">
                    <span>{$t('creative.common.opacity')}</span>
                    <input
                      type="range"
                      min="0.1"
                      max="0.8"
                      step="0.05"
                      value={$selectedSVGContent.arcBridgeOpacity}
                      oninput={(e) => updateParam('arcBridgeOpacity', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <input class="mini-value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={$selectedSVGContent.arcBridgeOpacity?.toFixed(2)} />
                  </div>
                </div>
              {/if}
            </div>

            <!-- Organic: Warp -->
            <div class="effect-group">
              <label class="effect-toggle">
                <input type="checkbox" checked={$selectedSVGContent.organicWarpEnabled ?? false}
                  onchange={() => toggleParam('organicWarpEnabled')} />{$t('creative.svg.labels.organicWarp')}</label>
              {#if $selectedSVGContent.organicWarpEnabled}
                <div class="effect-params">
                  <div class="mini-param">
                    <span>{$t('creative.common.amount')}</span>
                    <input type="range" min="0" max="30" step="0.5"
                      value={$selectedSVGContent.warpAmount ?? 6}
                      oninput={(e) => updateParam('warpAmount', parseFloat((e.target as HTMLInputElement).value))} />
                    <input class="mini-value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={($selectedSVGContent.warpAmount ?? 6).toFixed(1)} />
                  </div>
                  <div class="mini-param">
                    <span>{$t('creative.common.speed')}</span>
                    <input type="range" min="0.1" max="3" step="0.05"
                      value={$selectedSVGContent.warpSpeed ?? 0.8}
                      oninput={(e) => updateParam('warpSpeed', parseFloat((e.target as HTMLInputElement).value))} />
                    <input class="mini-value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={($selectedSVGContent.warpSpeed ?? 0.8).toFixed(2)} />
                  </div>
                </div>
              {/if}
            </div>

            <!-- Organic: Breathe -->
            <div class="effect-group">
              <label class="effect-toggle">
                <input type="checkbox" checked={$selectedSVGContent.breatheEnabled ?? false}
                  onchange={() => toggleParam('breatheEnabled')} />{$t('creative.svg.labels.breathe')}</label>
              {#if $selectedSVGContent.breatheEnabled}
                <div class="effect-params">
                  <div class="mini-param">
                    <span>{$t('creative.common.amount')}</span>
                    <input type="range" min="0" max="0.3" step="0.01"
                      value={$selectedSVGContent.breatheAmount ?? 0.08}
                      oninput={(e) => updateParam('breatheAmount', parseFloat((e.target as HTMLInputElement).value))} />
                    <input class="mini-value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={($selectedSVGContent.breatheAmount ?? 0.08).toFixed(2)} />
                  </div>
                  <div class="mini-param">
                    <span>{$t('creative.common.speed')}</span>
                    <input type="range" min="0.2" max="3" step="0.05"
                      value={$selectedSVGContent.breatheSpeed ?? 1}
                      oninput={(e) => updateParam('breatheSpeed', parseFloat((e.target as HTMLInputElement).value))} />
                    <input class="mini-value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={($selectedSVGContent.breatheSpeed ?? 1).toFixed(2)} />
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
                />{$t('creative.svg.labels.colorCycle')}</label>
              {#if $selectedSVGContent.colorCycleEnabled}
                <div class="effect-params">
                  <div class="mini-param">
                    <span>{$t('creative.common.speed')}</span>
                    <input
                      type="range"
                      min="0.05"
                      max="1"
                      step="0.01"
                      value={$selectedSVGContent.colorCycleSpeed}
                      oninput={(e) => updateParam('colorCycleSpeed', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <input class="mini-value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={$selectedSVGContent.colorCycleSpeed?.toFixed(2)} />
                  </div>
                  <div class="mini-param">
                    <span>{$t('creative.common.saturation')}</span>
                    <input
                      type="range"
                      min="0.3"
                      max="1"
                      step="0.05"
                      value={$selectedSVGContent.colorCycleSaturation}
                      oninput={(e) => updateParam('colorCycleSaturation', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <input class="mini-value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={$selectedSVGContent.colorCycleSaturation?.toFixed(2)} />
                  </div>
                  <div class="mini-param">
                    <span>{$t('creative.svg.labels.lightness')}</span>
                    <input
                      type="range"
                      min="0.3"
                      max="0.8"
                      step="0.05"
                      value={$selectedSVGContent.colorCycleLightness}
                      oninput={(e) => updateParam('colorCycleLightness', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <input class="mini-value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={$selectedSVGContent.colorCycleLightness?.toFixed(2)} />
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
                />{$t('creative.svg.labels.perShapeColors')}</label>
            </div>

            <!-- Particles (edge particles) -->
            <div class="effect-group">
              <label class="effect-toggle">
                <input
                  type="checkbox"
                  checked={$selectedSVGContent.particlesEnabled}
                  onchange={() => toggleParam('particlesEnabled')}
                />{$t('creative.svg.labels.edgeParticles')}</label>
              {#if $selectedSVGContent.particlesEnabled}
                <div class="effect-params">
                  <div class="mini-param">
                    <span>{$t('creative.common.speed')}</span>
                    <input
                      type="range"
                      min="20"
                      max="300"
                      value={$selectedSVGContent.particleSpeed}
                      oninput={(e) => updateParam('particleSpeed', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <input class="mini-value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={$selectedSVGContent.particleSpeed} />
                  </div>
                  <div class="mini-param">
                    <span>{$t('creative.svg.labels.size')}</span>
                    <input
                      type="range"
                      min="1"
                      max="5"
                      step="0.1"
                      value={$selectedSVGContent.particleSize}
                      oninput={(e) => updateParam('particleSize', parseFloat((e.target as HTMLInputElement).value))}
                    />
                    <input class="mini-value vnum" type="number" inputmode="decimal" onchange={syncFromNumber} value={$selectedSVGContent.particleSize?.toFixed(1)} />
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
        <span>{$t('creative.svg.layers.title')}</span>
      </div>
      {#each svgLayers as layer (layer.id)}
        <button
          class="layer-item"
          class:selected={$selectedSVGLayer?.id === layer.id}
          onclick={() => project.selectLayer(layer.id)}
        >
          <span class="layer-name">{layer.name}</span>
          {#if layer.svgContent?.svgSource}
            <span class="layer-status loaded">{$t('creative.svg.layers.loaded')}</span>
          {:else}
            <span class="layer-status empty">{$t('creative.svg.layers.empty')}</span>
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
    font-size: 13px;
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
    font-size: 15px;
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
    font-size: 12px;
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
    font-size: 13px;
  }

  .section-header.static {
    cursor: default;
  }

  .section-header:hover:not(.static) {
    background: var(--bg-tertiary, #161618);
  }

  .toggle {
    font-size: 15px;
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
    font-size: 12px;
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
    font-size: 12px;
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
    color: #bb86fc;
    font-weight: 600;
    font-size: 13px;
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
    font-size: 12px;
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
    font-size: 12px;
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
    font-size: 12px;
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
    gap: 10px;
    margin-bottom: 11px;
    min-height: 22px;
  }

  /* Sub-label that groups related rows (e.g. Rotate vs Auto-spin) with a
     little breathing room above so dense panels don't read as a wall. */
  .param-subhead {
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-muted, #888);
    margin: 12px 0 7px;
    padding-bottom: 4px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  }
  .param-subhead:first-child {
    margin-top: 2px;
  }

  .param-row label {
    flex: 0 0 70px;
    color: var(--text-secondary, #aaa);
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
  }

  .param-row input[type='range'] {
    flex: 1;
    height: 4px;
    background: #333;
    border-radius: 2px;
    -webkit-appearance: none;
    appearance: none;
  }

  .param-row input[type='range']::-webkit-slider-thumb {
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
    font-size: 12px;
  }

  .param-row .value {
    flex: 0 0 45px;
    text-align: right;
    color: var(--text-muted, #888);
    font-family: var(--ga-font-mono, 'IBM Plex Mono', ui-monospace, monospace);
    font-size: 11px;
  }

  /* Editable numeric readouts — look like the old text values but you can
     click in and type. Spinner chrome hidden; subtle affordance on hover. */
  .vnum {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid transparent;
    border-radius: 3px;
    padding: 2px 4px;
    margin: 0;
    color: #cbd1da;
    -moz-appearance: textfield;
    appearance: textfield;
    cursor: text;
    transition:
      border-color 0.12s,
      background 0.12s;
  }
  .vnum:hover {
    border-color: rgba(255, 255, 255, 0.18);
  }
  .vnum:focus {
    outline: none;
    border-color: #ff00aa;
    background: rgba(0, 0, 0, 0.35);
    color: #fff;
  }
  .vnum::-webkit-inner-spin-button,
  .vnum::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  .param-row .value.vnum {
    flex: 0 0 58px;
  }
  .mini-value.vnum {
    flex: 0 0 46px;
    text-align: right;
    font-size: 11px;
  }

  .effects-grid {
    display: flex;
    flex-direction: column;
    gap: 9px;
  }

  .effect-group {
    background: #222;
    border-radius: 4px;
    padding: 9px 10px;
  }

  .effect-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-primary, #ccc);
    cursor: pointer;
    font-weight: 500;
    font-size: 12px;
  }

  .effect-toggle input[type='checkbox'] {
    margin: 0;
    accent-color: #ff00aa;
  }

  .effect-params {
    margin-top: 9px;
    padding-left: 12px;
    overflow: hidden;
  }

  .mini-param {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 9px;
    min-height: 20px;
    min-width: 0;
  }
  .mini-param:last-child {
    margin-bottom: 2px;
  }

  .mini-param span {
    flex: 0 0 52px;
    font-size: 11px;
    color: var(--text-muted, #888);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .mini-param input[type='range'] {
    flex: 1;
    min-width: 0;
    height: 3px;
    background: #333;
    border-radius: 2px;
    -webkit-appearance: none;
    appearance: none;
  }

  .mini-param input[type='range']::-webkit-slider-thumb {
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
    font-size: 10px;
    color: var(--text-muted, #888);
    font-family: var(--ga-font-mono, 'IBM Plex Mono', ui-monospace, monospace);
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
    font-size: 11px;
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
    font-size: 12px;
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
    font-size: 10px;
    padding: 2px 5px;
    border-radius: 3px;
  }

  .layer-status.loaded {
    background: #bb86fc33;
    color: #bb86fc;
  }

  .layer-status.empty {
    background: #66666633;
    color: #666;
  }
</style>
