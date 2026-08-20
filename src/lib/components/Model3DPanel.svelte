<script lang="ts">
  import { onDestroy } from 'svelte';
  import { project, selectedLayer } from '../stores/layers';
  import { showLoading, hideLoading } from '../stores/loading';
  import type {
    Model3DMaterialType,
    Model3DWireframeMode,
    Model3DVertexDecoration,
    Model3DDeformationType,
    Model3DAnimationType,
    Model3DEchoType,
    Model3DLightingPreset,
    Model3DContent,
  } from '../types';
  import { createAssetRefFromFile } from '../storage/assetRegistry';
  import { t } from '../i18n';

  // Material types with descriptions
  const materialTypes: { value: Model3DMaterialType; labelKey: string; descriptionKey: string }[] = [
    { value: 'source',
      labelKey: 'model3d.labels.modelMaterials',
      descriptionKey: 'model3d.descriptions.modelMaterials',
    },
    { value: 'standard', labelKey: 'model3d.labels.standardPbr', descriptionKey: 'model3d.descriptions.standardPbr' },
    { value: 'wireframe',
      labelKey: 'model3d.labels.wireframeOnly',
      descriptionKey: 'model3d.descriptions.wireframeOnly',
    },
    { value: 'glass', labelKey: 'model3d.labels.glass', descriptionKey: 'model3d.descriptions.glass' },
    { value: 'chrome', labelKey: 'model3d.labels.chrome', descriptionKey: 'model3d.descriptions.chrome' },
    { value: 'hologram', labelKey: 'model3d.labels.hologram', descriptionKey: 'model3d.descriptions.hologram' },
    { value: 'lava', labelKey: 'model3d.labels.lava', descriptionKey: 'model3d.descriptions.lava' },
    { value: 'ice', labelKey: 'model3d.labels.ice', descriptionKey: 'model3d.descriptions.ice' },
    { value: 'neon', labelKey: 'model3d.labels.neon', descriptionKey: 'model3d.descriptions.neon' },
    { value: 'xray', labelKey: 'model3d.labels.xray', descriptionKey: 'model3d.descriptions.xray' },
    { value: 'toon', labelKey: 'model3d.labels.toonCel', descriptionKey: 'model3d.descriptions.toonCel' },
    { value: 'fresnel', labelKey: 'model3d.labels.fresnel', descriptionKey: 'model3d.descriptions.fresnel' },
    { value: 'dissolve', labelKey: 'model3d.labels.dissolve', descriptionKey: 'model3d.descriptions.dissolve' },
    { value: 'glitch', labelKey: 'model3d.labels.glitch', descriptionKey: 'model3d.descriptions.glitch' },
    { value: 'normal', labelKey: 'model3d.labels.normalMap', descriptionKey: 'model3d.descriptions.normalMap' },
    { value: 'depth', labelKey: 'model3d.labels.depth', descriptionKey: 'model3d.descriptions.depth' },
  ];

  // Wireframe modes
  const wireframeModes: { value: Model3DWireframeMode; labelKey: string }[] = [
    { value: 'none', labelKey: 'model3d.labels.none' },
    { value: 'classic', labelKey: 'model3d.labels.classic' },
    { value: 'animated', labelKey: 'model3d.labels.animatedFlow' },
    { value: 'glow', labelKey: 'model3d.labels.softGlow' },
    { value: 'neon', labelKey: 'model3d.labels.neonTubes' },
    { value: 'pulse', labelKey: 'model3d.labels.pulsing' },
    { value: 'rainbow', labelKey: 'model3d.labels.rainbow' },
    { value: 'dotted', labelKey: 'model3d.labels.dotted' },
    { value: 'thick', labelKey: 'model3d.labels.thickLines' },
  ];

  // Vertex decorations
  const vertexDecorations: { value: Model3DVertexDecoration; labelKey: string }[] = [
    { value: 'none', labelKey: 'model3d.labels.none' },
    { value: 'spheres', labelKey: 'model3d.labels.spheres' },
    { value: 'cubes', labelKey: 'model3d.labels.cubes' },
    { value: 'pyramids', labelKey: 'model3d.labels.pyramids' },
    { value: 'points', labelKey: 'model3d.labels.points' },
    { value: 'stars', labelKey: 'model3d.labels.stars' },
    { value: 'diamonds', labelKey: 'model3d.labels.diamonds' },
  ];

  // Deformation types
  const deformationTypes: { value: Model3DDeformationType; labelKey: string; descriptionKey: string }[] = [
    { value: 'none', labelKey: 'model3d.labels.none', descriptionKey: 'model3d.descriptions.noneDeformation' },
    { value: 'noise', labelKey: 'model3d.labels.noise', descriptionKey: 'model3d.descriptions.noise' },
    { value: 'wave', labelKey: 'model3d.labels.wave', descriptionKey: 'model3d.descriptions.wave' },
    { value: 'pulse', labelKey: 'model3d.labels.pulse', descriptionKey: 'model3d.descriptions.pulse' },
    { value: 'bulge', labelKey: 'model3d.labels.bulge', descriptionKey: 'model3d.descriptions.bulge' },
    { value: 'twist', labelKey: 'model3d.labels.twist', descriptionKey: 'model3d.descriptions.twist' },
    { value: 'swirl', labelKey: 'model3d.labels.swirl', descriptionKey: 'model3d.descriptions.swirl' },
    { value: 'bend', labelKey: 'model3d.labels.bend', descriptionKey: 'model3d.descriptions.bend' },
    { value: 'taper', labelKey: 'model3d.labels.taper', descriptionKey: 'model3d.descriptions.taper' },
    { value: 'spherify', labelKey: 'model3d.labels.spherify', descriptionKey: 'model3d.descriptions.spherify' },
    { value: 'inflate', labelKey: 'model3d.labels.inflate', descriptionKey: 'model3d.descriptions.inflate' },
    { value: 'breathe', labelKey: 'model3d.labels.breathe', descriptionKey: 'model3d.descriptions.breathe' },
    { value: 'explode', labelKey: 'model3d.labels.explode', descriptionKey: 'model3d.descriptions.explode' },
    { value: 'implode', labelKey: 'model3d.labels.implode', descriptionKey: 'model3d.descriptions.implode' },
    { value: 'shatter', labelKey: 'model3d.labels.shatter', descriptionKey: 'model3d.descriptions.shatter' },
    { value: 'fracture', labelKey: 'model3d.labels.fracture', descriptionKey: 'model3d.descriptions.fracture' },
    { value: 'melt', labelKey: 'model3d.labels.melt', descriptionKey: 'model3d.descriptions.melt' },
    { value: 'pixelate', labelKey: 'model3d.labels.voxelize', descriptionKey: 'model3d.descriptions.pixelate' },
    { value: 'jelly', labelKey: 'model3d.labels.jelly', descriptionKey: 'model3d.descriptions.jelly' },
    { value: 'tentacle', labelKey: 'model3d.labels.tentacle', descriptionKey: 'model3d.descriptions.tentacle' },
    { value: 'magnetic', labelKey: 'model3d.labels.magnetic', descriptionKey: 'model3d.descriptions.magnetic' },
  ];

  // Animation types
  const animationTypes: { value: Model3DAnimationType; labelKey: string; descriptionKey: string }[] = [
    { value: 'none', labelKey: 'model3d.labels.none', descriptionKey: 'model3d.descriptions.noneAnimation' },
    { value: 'rotate', labelKey: 'model3d.labels.rotate', descriptionKey: 'model3d.descriptions.rotate' },
    { value: 'orbit', labelKey: 'model3d.labels.orbit', descriptionKey: 'model3d.descriptions.orbit' },
    { value: 'bounce', labelKey: 'model3d.labels.bounce', descriptionKey: 'model3d.descriptions.bounce' },
    { value: 'swing', labelKey: 'model3d.labels.swing', descriptionKey: 'model3d.descriptions.swing' },
    { value: 'float', labelKey: 'model3d.labels.float', descriptionKey: 'model3d.descriptions.float' },
    { value: 'shake', labelKey: 'model3d.labels.shake', descriptionKey: 'model3d.descriptions.shake' },
    { value: 'spiral', labelKey: 'model3d.labels.spiral', descriptionKey: 'model3d.descriptions.spiral' },
    { value: 'fadeIn', labelKey: 'model3d.labels.fadeIn', descriptionKey: 'model3d.descriptions.fadeIn' },
    { value: 'scaleIn', labelKey: 'model3d.labels.scaleIn', descriptionKey: 'model3d.descriptions.scaleIn' },
    { value: 'unfold', labelKey: 'model3d.labels.unfold', descriptionKey: 'model3d.descriptions.unfold' },
    { value: 'assemble', labelKey: 'model3d.labels.assemble', descriptionKey: 'model3d.descriptions.assemble' },
    { value: 'grow', labelKey: 'model3d.labels.grow', descriptionKey: 'model3d.descriptions.grow' },
    { value: 'morphLoop', labelKey: 'model3d.labels.morphLoop', descriptionKey: 'model3d.descriptions.morphLoop' },
    { value: 'colorCycle', labelKey: 'model3d.labels.colorCycle', descriptionKey: 'model3d.descriptions.colorCycle' },
    { value: 'texturePan', labelKey: 'model3d.labels.texturePan', descriptionKey: 'model3d.descriptions.texturePan' },
  ];

  // Echo types
  const echoTypes: { value: Model3DEchoType; labelKey: string; descriptionKey: string }[] = [
    { value: 'none', labelKey: 'model3d.labels.none', descriptionKey: 'model3d.descriptions.noneEcho' },
    { value: 'ghostTrail', labelKey: 'model3d.labels.ghostTrail', descriptionKey: 'model3d.descriptions.ghostTrail' },
    { value: 'stream', labelKey: 'model3d.labels.stream', descriptionKey: 'model3d.descriptions.stream' },
    { value: 'swarm', labelKey: 'model3d.labels.swarm', descriptionKey: 'model3d.descriptions.swarm' },
    { value: 'grid', labelKey: 'model3d.labels.grid3d', descriptionKey: 'model3d.descriptions.grid3d' },
    { value: 'radial', labelKey: 'model3d.labels.radial', descriptionKey: 'model3d.descriptions.radial' },
    { value: 'spiral', labelKey: 'model3d.labels.spiral', descriptionKey: 'model3d.descriptions.spiralEcho' },
    { value: 'random', labelKey: 'model3d.labels.random', descriptionKey: 'model3d.descriptions.random' },
    { value: 'fountain', labelKey: 'model3d.labels.fountain', descriptionKey: 'model3d.descriptions.fountain' },
    { value: 'tornado', labelKey: 'model3d.labels.tornado', descriptionKey: 'model3d.descriptions.tornado' },
    { value: 'explosion', labelKey: 'model3d.labels.explosion', descriptionKey: 'model3d.descriptions.explosion' },
    { value: 'orbit', labelKey: 'model3d.labels.orbit', descriptionKey: 'model3d.descriptions.orbitEcho' },
    { value: 'matrix', labelKey: 'model3d.labels.matrix', descriptionKey: 'model3d.descriptions.matrix' },
    { value: 'dna', labelKey: 'model3d.labels.dna', descriptionKey: 'model3d.descriptions.dna' },
    { value: 'kaleidoscope',
      labelKey: 'model3d.labels.kaleidoscope',
      descriptionKey: 'model3d.descriptions.kaleidoscope',
    },
  ];

  // Lighting presets
  const lightingPresets: { value: Model3DLightingPreset; labelKey: string }[] = [
    { value: 'studio', labelKey: 'model3d.labels.studio3Point' },
    { value: 'dramatic', labelKey: 'model3d.labels.dramatic' },
    { value: 'neon', labelKey: 'model3d.labels.neonRim' },
    { value: 'sunrise', labelKey: 'model3d.labels.sunrise' },
    { value: 'moonlight', labelKey: 'model3d.labels.moonlight' },
    { value: 'disco', labelKey: 'model3d.labels.disco' },
    { value: 'none', labelKey: 'model3d.labels.noneUnlit' },
  ];

  // Optional props for dual-mode (mapping mode vs VJ mode)
  export let content: Model3DContent | null = null;
  export let onUpdate: ((updates: Partial<Model3DContent>) => void) | null = null;
  export let onFileLoad: (() => void) | null = null;
  export let compact: boolean = false;

  // Collapsible sections state
  let showMaterial = true;
  let showWireframe = false;
  let showDeformation = false;
  let showAnimation = true;
  let showEcho = false;
  let showTransform = false;
  let showCamera = false;
  let showLighting = false;
  let showAudio = false;
  let showBeatSync = false;

  // Dual-mode: use provided content prop or fall back to selected layer
  $: layer = $selectedLayer;
  $: mc = (content || layer?.model3dContent) as Model3DContent;
  $: isVJMode = !!onUpdate;

  // Track blob URLs + the original File so we can re-create a blob without
  // re-prompting the user. Cached at module scope so it survives panel
  // unmount-remount cycles (e.g. switching to VJ mode and back).
  let currentBlobUrl: string | null = null;
  let currentFileName: string = '';

  // NB: do NOT revoke the blob URL on panel destroy. The panel unmounts
  // every time the user switches modes, but the layer's modelData still
  // references this URL — revoking it leaves the renderer pointing at a
  // dead blob, and the model silently disappears until the user re-picks
  // the file. Blobs stay alive until the modelData is replaced, the layer
  // is deleted, or the page reloads (acceptable lifecycle here).

  // Last selected File, kept in module memory so the reload button can
  // re-create a fresh blob without prompting the user. Lost on page reload
  // (then the reload button falls through to the file picker).
  let cachedFile: File | null = null;

  // File input handler
  async function handleFileSelect(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    if (!isVJMode && !layer) return;

    const file = input.files[0];
    await loadModelFromFile(file);
  }

  async function loadModelFromFile(file: File) {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!['glb', 'gltf', 'obj', 'fbx'].includes(ext || '')) {
      alert($t('spatial.model3d.file.supportedFormats'));
      return;
    }

    showLoading($t('spatial.model3d.file.loading'));
    try {
      // Revoke previous URL only when replacing it with a new blob — safe
      // because nothing else references it once we overwrite modelData.
      if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);

      // Capture both runtime URL and durable AssetRef. The blob URL is for
      // immediate three.js loading; the AssetRef is what survives save/reload.
      const { assetRef, runtimeUrl: blobUrl } = createAssetRefFromFile(file);
      currentBlobUrl = blobUrl;
      currentFileName = file.name;
      cachedFile = file;

      console.log('[Model3DPanel] Created blob URL for model:', blobUrl);

      doUpdate({
        modelData: blobUrl,
        modelFormat: ext as any,
        modelName: file.name,
        _assetRef: assetRef,
      } as any);
    } catch (err) {
      console.error($t('spatial.model3d.file.loadError'), err);
    } finally {
      hideLoading();
    }
  }

  /**
   * Reload the current model — re-create a fresh blob URL from the cached
   * File object. Useful if the renderer state got dropped (rare but possible
   * after extensive mode switching). If we've lost the cached File (e.g.
   * after app restart), fall back to opening the file picker.
   */
  async function reloadModel() {
    if (cachedFile) {
      console.log('[Model3DPanel] Reloading from cached File');
      await loadModelFromFile(cachedFile);
    } else {
      // No File in memory — open the file picker so user can re-select
      const input = document.getElementById('model3d-file-input') as HTMLInputElement | null;
      input?.click();
    }
  }

  // Unified update function — routes to VJ callback or mapping store
  function doUpdate(updates: Partial<Model3DContent>) {
    if (onUpdate) {
      onUpdate(updates);
    } else if (layer) {
      project.updateModel3DContent(layer.id, updates);
    }
  }

  // Helper to update content (alias for doUpdate for backward compatibility in template)
  function updateContent(updates: Partial<Model3DContent>) {
    doUpdate(updates);
  }

  // Helper to update nested echo config
  function updateEcho(updates: Partial<Model3DContent['echo']>) {
    if (mc) {
      doUpdate({ echo: { ...mc.echo, ...updates } });
    }
  }

  // Helper to update nested camera config
  function updateCamera(updates: Partial<Model3DContent['camera']>) {
    if (mc) {
      doUpdate({ camera: { ...mc.camera, ...updates } });
    }
  }

  function frameCamera() {
    updateCamera({
      distance: 5,
      fov: 50,
      orbitX: 0,
      orbitY: 20,
      roll: 0,
      panX: 0,
      panY: 0,
    });
  }

  function resetModelTransform() {
    updateContent({
      scaleUniform: 1,
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,
      positionX: 0,
      positionY: 0,
      positionZ: 0,
    });
  }

  // Helper to update nested audio config
  function updateAudio(updates: Partial<Model3DContent['audio']>) {
    if (mc) {
      doUpdate({ audio: { ...mc.audio, ...updates } });
    }
  }

  // RGB to hex
  function rgbToHex(r: number, g: number, b: number): string {
    return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
  }

  // Hex to RGB
  function hexToRgb(hex: string): [number, number, number] {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)]
      : [200, 200, 200];
  }
</script>

{#if isVJMode ? mc : layer && mc}
  <div class="model3d-panel" class:compact>
    {#if !compact}<h3>{$t('spatial.model3d.title')}</h3>{/if}

    <!-- File Loading -->
    <div class="section">
      <label class="section-label">{$t('spatial.model3d.file.section')}</label>
      <div class="file-row">
        {#if onFileLoad}
          <button class="file-button" onclick={onFileLoad}>{$t('spatial.model3d.file.loadFile')}</button>
        {:else}
          <input
            type="file"
            accept=".glb,.gltf,.obj,.fbx"
            onchange={handleFileSelect}
            id="model3d-file-input"
          />
          <label for="model3d-file-input" class="file-button">{$t('spatial.model3d.file.loadModel')}</label>
        {/if}
        {#if mc.modelData}
          <button
            type="button"
            class="reload-button"
            onclick={reloadModel}
            title={$t('spatial.model3d.file.reloadTitle')}
            aria-label={$t('spatial.model3d.file.reloadAria')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          </button>
        {/if}
      </div>
      {#if mc.modelData}
        <div class="file-info">
          <span class="filename">{currentFileName || mc.modelName || $t('spatial.model3d.file.loaded')}</span>
          <span class="format">{mc.modelFormat.toUpperCase()}</span>
          {#if mc.vertexCount > 0}
            <span class="vertex-count">{$t('spatial.model3d.file.vertices', { values: { count: mc.vertexCount.toLocaleString()} })}</span>
            <span class="face-count">{$t('spatial.model3d.file.faces', { values: { count: mc.faceCount.toLocaleString()} })}</span>
          {/if}
        </div>
      {:else}
        <p class="hint">{$t('spatial.model3d.file.supported')}</p>
      {/if}
    </div>

    <!-- Material Section -->
    <div class="section collapsible" class:open={showMaterial}>
      <button class="section-header" onclick={() => (showMaterial = !showMaterial)}>
        <span>{$t('spatial.model3d.sections.material')}</span>
        <span class="chevron">{showMaterial ? '−' : '+'}</span>
      </button>
      {#if showMaterial}
        <div class="section-content">
          <div class="property-row">
            <label>{$t('spatial.common.type')}</label>
            <select
              value={mc.materialType}
              onchange={(e) => updateContent({ materialType: (e.target as HTMLSelectElement).value as Model3DMaterialType })}
              data-midi-path="map:model3d:materialType"
              data-midi-label={$t('spatial.common.type')}
              data-midi-min="0"
              data-midi-max="15"
              data-midi-step="1"
              data-midi-discrete="source,standard,wireframe,glass,chrome,hologram,lava,ice,neon,xray,toon,fresnel,dissolve,glitch,normal,depth"
            >
              {#each materialTypes as mat}
                <option value={mat.value} title={$t(`spatial.${mat.descriptionKey}`)}>{$t(`spatial.${mat.labelKey}`)}</option>
              {/each}
            </select>
          </div>

          <div class="property-row">
            <label>{$t('spatial.common.color')}</label>
            <input
              type="color"
              value={rgbToHex(mc.materialColor[0], mc.materialColor[1], mc.materialColor[2])}
              oninput={(e) => updateContent({ materialColor: hexToRgb((e.target as HTMLInputElement).value) })}
            />
          </div>

          <div class="property-row">
            <label>{$t('spatial.common.opacity')}</label>
            <input
              type="range" min="0" max="1" step="0.01"
              value={mc.materialOpacity}
              oninput={(e) => updateContent({ materialOpacity: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:model3d:materialOpacity"
              data-midi-label={$t('spatial.common.opacity')}
              data-midi-min="0"
              data-midi-max="1"
              data-midi-step="0.01"
            />
            <span class="value">{(mc.materialOpacity * 100).toFixed(0)}%</span>
          </div>

          {#if mc.materialType === 'standard'}
            <div class="property-row">
              <label>{$t('spatial.model3d.labels.roughness')}</label>
              <input
                type="range" min="0" max="1" step="0.01"
                value={mc.materialRoughness}
                oninput={(e) => updateContent({ materialRoughness: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:materialRoughness"
                data-midi-label={$t('spatial.model3d.labels.roughness')}
                data-midi-min="0"
                data-midi-max="1"
                data-midi-step="0.01"
              />
              <span class="value">{mc.materialRoughness.toFixed(2)}</span>
            </div>

            <div class="property-row">
              <label>{$t('spatial.model3d.labels.metalness')}</label>
              <input
                type="range" min="0" max="1" step="0.01"
                value={mc.materialMetalness}
                oninput={(e) => updateContent({ materialMetalness: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:materialMetalness"
                data-midi-label={$t('spatial.model3d.labels.metalness')}
                data-midi-min="0"
                data-midi-max="1"
                data-midi-step="0.01"
              />
              <span class="value">{mc.materialMetalness.toFixed(2)}</span>
            </div>

            <div class="property-row">
              <label>{$t('spatial.model3d.labels.emissive')}</label>
              <input
                type="color"
                value={rgbToHex(mc.materialEmissive[0], mc.materialEmissive[1], mc.materialEmissive[2])}
                oninput={(e) => updateContent({ materialEmissive: hexToRgb((e.target as HTMLInputElement).value) })}
              />
            </div>

            <div class="property-row">
              <label>{$t('spatial.model3d.labels.emissiveIntensity')}</label>
              <input
                type="range" min="0" max="5" step="0.1"
                value={mc.materialEmissiveIntensity}
                oninput={(e) => updateContent({ materialEmissiveIntensity: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:materialEmissiveIntensity"
                data-midi-label={$t('spatial.model3d.labels.emissiveIntensity')}
                data-midi-min="0"
                data-midi-max="5"
                data-midi-step="0.1"
              />
              <span class="value">{mc.materialEmissiveIntensity.toFixed(1)}</span>
            </div>
          {/if}

          {#if mc.materialType === 'hologram'}
            <div class="property-row">
              <label>{$t('spatial.model3d.labels.scanSpeed')}</label>
              <input
                type="range" min="0" max="10" step="0.1"
                value={mc.hologramScanSpeed}
                oninput={(e) => updateContent({ hologramScanSpeed: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:hologramScanSpeed"
                data-midi-label={$t('spatial.model3d.labels.scanSpeed')}
                data-midi-min="0"
                data-midi-max="10"
                data-midi-step="0.1"
              />
              <span class="value">{mc.hologramScanSpeed.toFixed(1)}</span>
            </div>

            <div class="property-row">
              <label>{$t('spatial.model3d.labels.scanCount')}</label>
              <input
                type="range" min="5" max="100" step="1"
                value={mc.hologramScanCount}
                oninput={(e) => updateContent({ hologramScanCount: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:hologramScanCount"
                data-midi-label={$t('spatial.model3d.labels.scanCount')}
                data-midi-min="5"
                data-midi-max="100"
                data-midi-step="1"
              />
              <span class="value">{mc.hologramScanCount}</span>
            </div>

            <div class="property-row">
              <label>{$t('spatial.model3d.labels.glitch')}</label>
              <input
                type="range" min="0" max="1" step="0.01"
                value={mc.hologramGlitchIntensity}
                oninput={(e) => updateContent({ hologramGlitchIntensity: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:hologramGlitchIntensity"
                data-midi-label={$t('spatial.model3d.labels.glitch')}
                data-midi-min="0"
                data-midi-max="1"
                data-midi-step="0.01"
              />
              <span class="value">{(mc.hologramGlitchIntensity * 100).toFixed(0)}%</span>
            </div>

            <div class="property-row">
              <label>{$t('spatial.model3d.labels.rimColor')}</label>
              <input
                type="color"
                value={rgbToHex(mc.hologramRimColor[0], mc.hologramRimColor[1], mc.hologramRimColor[2])}
                oninput={(e) => updateContent({ hologramRimColor: hexToRgb((e.target as HTMLInputElement).value) })}
              />
            </div>
          {/if}

          {#if mc.materialType === 'lava'}
            <div class="property-row">
              <label>{$t('spatial.model3d.labels.flowSpeed')}</label>
              <input
                type="range" min="0" max="5" step="0.1"
                value={mc.lavaFlowSpeed}
                oninput={(e) => updateContent({ lavaFlowSpeed: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:lavaFlowSpeed"
                data-midi-label={$t('spatial.model3d.labels.flowSpeed')}
                data-midi-min="0"
                data-midi-max="5"
                data-midi-step="0.1"
              />
              <span class="value">{mc.lavaFlowSpeed.toFixed(1)}</span>
            </div>

            <div class="property-row">
              <label>{$t('spatial.model3d.labels.crackIntensity')}</label>
              <input
                type="range" min="0" max="2" step="0.1"
                value={mc.lavaCrackIntensity}
                oninput={(e) => updateContent({ lavaCrackIntensity: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:lavaCrackIntensity"
                data-midi-label={$t('spatial.model3d.labels.crackIntensity')}
                data-midi-min="0"
                data-midi-max="2"
                data-midi-step="0.1"
              />
              <span class="value">{mc.lavaCrackIntensity.toFixed(1)}</span>
            </div>

            <div class="property-row">
              <label>{$t('spatial.model3d.labels.glowColor')}</label>
              <input
                type="color"
                value={rgbToHex(mc.lavaGlowColor[0], mc.lavaGlowColor[1], mc.lavaGlowColor[2])}
                oninput={(e) => updateContent({ lavaGlowColor: hexToRgb((e.target as HTMLInputElement).value) })}
              />
            </div>
          {/if}

          {#if mc.materialType === 'glass'}
            <div class="property-row">
              <label>{$t('spatial.model3d.labels.ior')}</label>
              <input
                type="range" min="1" max="2.5" step="0.01"
                value={mc.glassIOR}
                oninput={(e) => updateContent({ glassIOR: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:glassIOR"
                data-midi-label={$t('spatial.model3d.labels.ior')}
                data-midi-min="1"
                data-midi-max="2.5"
                data-midi-step="0.01"
              />
              <span class="value">{mc.glassIOR.toFixed(2)}</span>
            </div>

            <div class="property-row">
              <label>{$t('spatial.model3d.labels.thickness')}</label>
              <input
                type="range" min="0" max="2" step="0.1"
                value={mc.glassThickness}
                oninput={(e) => updateContent({ glassThickness: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:glassThickness"
                data-midi-label={$t('spatial.model3d.labels.thickness')}
                data-midi-min="0"
                data-midi-max="2"
                data-midi-step="0.1"
              />
              <span class="value">{mc.glassThickness.toFixed(1)}</span>
            </div>
          {/if}

          {#if mc.materialType === 'dissolve'}
            <div class="property-row">
              <label>{$t('spatial.common.amount')}</label>
              <input
                type="range" min="0" max="1" step="0.01"
                value={mc.dissolveAmount}
                oninput={(e) => updateContent({ dissolveAmount: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:dissolveAmount"
                data-midi-label={$t('spatial.common.amount')}
                data-midi-min="0"
                data-midi-max="1"
                data-midi-step="0.01"
              />
              <span class="value">{(mc.dissolveAmount * 100).toFixed(0)}%</span>
            </div>

            <div class="property-row">
              <label>{$t('spatial.model3d.labels.edgeColor')}</label>
              <input
                type="color"
                value={rgbToHex(mc.dissolveEdgeColor[0], mc.dissolveEdgeColor[1], mc.dissolveEdgeColor[2])}
                oninput={(e) => updateContent({ dissolveEdgeColor: hexToRgb((e.target as HTMLInputElement).value) })}
              />
            </div>

            <div class="property-row">
              <label>{$t('spatial.model3d.labels.edgeWidth')}</label>
              <input
                type="range" min="0.01" max="0.2" step="0.01"
                value={mc.dissolveEdgeWidth}
                oninput={(e) => updateContent({ dissolveEdgeWidth: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:dissolveEdgeWidth"
                data-midi-label={$t('spatial.model3d.labels.edgeWidth')}
                data-midi-min="0.01"
                data-midi-max="0.2"
                data-midi-step="0.01"
              />
              <span class="value">{mc.dissolveEdgeWidth.toFixed(2)}</span>
            </div>
          {/if}

          {#if mc.materialType === 'fresnel'}
            <div class="property-row">
              <label>{$t('spatial.model3d.labels.power')}</label>
              <input
                type="range" min="0.5" max="5" step="0.1"
                value={mc.fresnelPower}
                oninput={(e) => updateContent({ fresnelPower: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:fresnelPower"
                data-midi-label={$t('spatial.model3d.labels.power')}
                data-midi-min="0.5"
                data-midi-max="5"
                data-midi-step="0.1"
              />
              <span class="value">{mc.fresnelPower.toFixed(1)}</span>
            </div>

            <div class="property-row">
              <label>{$t('spatial.model3d.labels.fresnelColor')}</label>
              <input
                type="color"
                value={rgbToHex(mc.fresnelColor[0], mc.fresnelColor[1], mc.fresnelColor[2])}
                oninput={(e) => updateContent({ fresnelColor: hexToRgb((e.target as HTMLInputElement).value) })}
              />
            </div>
          {/if}

          {#if mc.materialType === 'toon'}
            <div class="property-row">
              <label>{$t('spatial.model3d.labels.levels')}</label>
              <input
                type="range" min="2" max="8" step="1"
                value={mc.toonLevels}
                oninput={(e) => updateContent({ toonLevels: parseInt((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:toonLevels"
                data-midi-label={$t('spatial.model3d.labels.levels')}
                data-midi-min="2"
                data-midi-max="8"
                data-midi-step="1"
              />
              <span class="value">{mc.toonLevels}</span>
            </div>
          {/if}

          {#if mc.materialType === 'chrome'}
            <div class="property-row">
              <label>{$t('spatial.model3d.labels.reflectivity')}</label>
              <input
                type="range" min="0" max="2" step="0.1"
                value={mc.chromeReflectivity}
                oninput={(e) => updateContent({ chromeReflectivity: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:chromeReflectivity"
                data-midi-label={$t('spatial.model3d.labels.reflectivity')}
                data-midi-min="0"
                data-midi-max="2"
                data-midi-step="0.1"
              />
              <span class="value">{mc.chromeReflectivity.toFixed(1)}</span>
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Wireframe Section -->
    <div class="section collapsible" class:open={showWireframe}>
      <button class="section-header" onclick={() => (showWireframe = !showWireframe)}>
        <span>{$t('spatial.model3d.sections.wireframe')}</span>
        <span class="chevron">{showWireframe ? '−' : '+'}</span>
      </button>
      {#if showWireframe}
        <div class="section-content">
          <div class="property-row">
            <label>{$t('spatial.model3d.labels.wireframe')}</label>
            <select
              value={mc.wireframeMode}
              onchange={(e) => updateContent({ wireframeMode: (e.target as HTMLSelectElement).value as Model3DWireframeMode })}
              data-midi-path="map:model3d:wireframeMode"
              data-midi-label={$t('spatial.model3d.labels.wireframe')}
              data-midi-min="0"
              data-midi-max="8"
              data-midi-step="1"
              data-midi-discrete="none,classic,animated,glow,neon,pulse,rainbow,dotted,thick"
            >
              {#each wireframeModes as mode}
                <option value={mode.value}>{$t(`spatial.${mode.labelKey}`)}</option>
              {/each}
            </select>
          </div>

          {#if mc.wireframeMode !== 'none'}
            <div class="property-row">
              <label>{$t('spatial.common.color')}</label>
              <input
                type="color"
                value={rgbToHex(mc.wireframeColor[0], mc.wireframeColor[1], mc.wireframeColor[2])}
                onchange={(e) => updateContent({ wireframeColor: hexToRgb((e.target as HTMLInputElement).value) })}
              />
            </div>

            <div class="property-row">
              <label>{$t('spatial.common.opacity')}</label>
              <input
                type="range" min="0" max="1" step="0.01"
                value={mc.wireframeOpacity}
                oninput={(e) => updateContent({ wireframeOpacity: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:wireframeOpacity"
                data-midi-label={$t('spatial.common.opacity')}
                data-midi-min="0"
                data-midi-max="1"
                data-midi-step="0.01"
              />
              <span class="value">{(mc.wireframeOpacity * 100).toFixed(0)}%</span>
            </div>

            <div class="property-row">
              <label>{$t('spatial.model3d.labels.thickness')}</label>
              <input
                type="range" min="0.5" max="5" step="0.1"
                value={mc.wireframeThickness}
                oninput={(e) => updateContent({ wireframeThickness: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:wireframeThickness"
                data-midi-label={$t('spatial.model3d.labels.thickness')}
                data-midi-min="0.5"
                data-midi-max="5"
                data-midi-step="0.1"
              />
              <span class="value">{mc.wireframeThickness.toFixed(1)}</span>
            </div>

            {#if mc.wireframeMode === 'animated' || mc.wireframeMode === 'pulse' || mc.wireframeMode === 'rainbow' || mc.wireframeMode === 'dotted'}
              <div class="property-row">
                <label>{$t('spatial.common.speed')}</label>
                <input
                  type="range" min="0" max="5" step="0.1"
                  value={mc.wireframeAnimSpeed}
                  oninput={(e) => updateContent({ wireframeAnimSpeed: parseFloat((e.target as HTMLInputElement).value) })}
                  data-midi-path="map:model3d:wireframeAnimSpeed"
                  data-midi-label={$t('spatial.common.speed')}
                  data-midi-min="0"
                  data-midi-max="5"
                  data-midi-step="0.1"
                />
                <span class="value">{mc.wireframeAnimSpeed.toFixed(1)}</span>
              </div>
            {/if}
          {/if}

          <div class="property-row">
            <label>{$t('spatial.model3d.labels.vertices')}</label>
            <select
              value={mc.vertexDecoration}
              onchange={(e) => updateContent({ vertexDecoration: (e.target as HTMLSelectElement).value as Model3DVertexDecoration })}
              data-midi-path="map:model3d:vertexDecoration"
              data-midi-label={$t('spatial.model3d.labels.vertices')}
              data-midi-min="0"
              data-midi-max="6"
              data-midi-step="1"
              data-midi-discrete="none,spheres,cubes,pyramids,points,stars,diamonds"
            >
              {#each vertexDecorations as deco}
                <option value={deco.value}>{$t(`spatial.${deco.labelKey}`)}</option>
              {/each}
            </select>
          </div>

          {#if mc.vertexDecoration !== 'none'}
            <div class="property-row">
              <label>{$t('spatial.common.size')}</label>
              <input
                type="range" min="0.001" max="0.2" step="0.001"
                value={mc.vertexDecorationSize}
                oninput={(e) => updateContent({ vertexDecorationSize: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:vertexDecorationSize"
                data-midi-label={$t('spatial.common.size')}
                data-midi-min="0.001"
                data-midi-max="0.2"
                data-midi-step="0.001"
              />
              <span class="value">{mc.vertexDecorationSize.toFixed(3)}</span>
            </div>

            <div class="property-row">
              <label>{$t('spatial.common.color')}</label>
              <input
                type="color"
                value={rgbToHex(mc.vertexDecorationColor[0], mc.vertexDecorationColor[1], mc.vertexDecorationColor[2])}
                onchange={(e) => updateContent({ vertexDecorationColor: hexToRgb((e.target as HTMLInputElement).value) })}
              />
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Deformation Section -->
    <div class="section collapsible" class:open={showDeformation}>
      <button class="section-header" onclick={() => (showDeformation = !showDeformation)}>
        <span>{$t('spatial.model3d.sections.deformation')}</span>
        <span class="chevron">{showDeformation ? '−' : '+'}</span>
      </button>
      {#if showDeformation}
        <div class="section-content">
          <div class="property-row">
            <label>{$t('spatial.common.type')}</label>
            <select
              value={mc.deformationType}
              onchange={(e) => updateContent({ deformationType: (e.target as HTMLSelectElement).value as Model3DDeformationType })}
              data-midi-path="map:model3d:deformationType"
              data-midi-label={$t('spatial.common.type')}
              data-midi-min="0"
              data-midi-max="14"
              data-midi-step="1"
              data-midi-discrete="none,noise,wave,twist,bend,taper,spherify,inflate,explode,implode,shatter,melt,pixelate,jelly,breathe"
            >
              {#each deformationTypes as def}
                <option value={def.value} title={$t(`spatial.${def.descriptionKey}`)}>{$t(`spatial.${def.labelKey}`)}</option>
              {/each}
            </select>
          </div>

          {#if mc.deformationType !== 'none'}
            <div class="property-row">
              <label>{$t('spatial.common.intensity')}</label>
              <input
                type="range" min="0" max="2" step="0.01"
                value={mc.deformationIntensity}
                oninput={(e) => updateContent({ deformationIntensity: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:deformationIntensity"
                data-midi-label={$t('spatial.common.intensity')}
                data-midi-min="0"
                data-midi-max="2"
                data-midi-step="0.01"
              />
              <span class="value">{mc.deformationIntensity.toFixed(2)}</span>
            </div>

            <div class="property-row">
              <label>{$t('spatial.common.speed')}</label>
              <input
                type="range" min="0" max="5" step="0.1"
                value={mc.deformationSpeed}
                oninput={(e) => updateContent({ deformationSpeed: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:deformationSpeed"
                data-midi-label={$t('spatial.common.speed')}
                data-midi-min="0"
                data-midi-max="5"
                data-midi-step="0.1"
              />
              <span class="value">{mc.deformationSpeed.toFixed(1)}</span>
            </div>

            <div class="property-row">
              <label>{$t('spatial.common.scale')}</label>
              <input
                type="range" min="0.1" max="10" step="0.1"
                value={mc.deformationScale}
                oninput={(e) => updateContent({ deformationScale: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:deformationScale"
                data-midi-label={$t('spatial.common.scale')}
                data-midi-min="0.1"
                data-midi-max="10"
                data-midi-step="0.1"
              />
              <span class="value">{mc.deformationScale.toFixed(1)}</span>
            </div>

            <div class="property-row">
              <label>{$t('spatial.model3d.labels.spread')}</label>
              <input
                type="range" min="0" max="6" step="0.05"
                value={mc.deformationSpread ?? 1}
                oninput={(e) => updateContent({ deformationSpread: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:deformationSpread"
                data-midi-label={$t('spatial.model3d.labels.spread')}
                data-midi-min="0"
                data-midi-max="6"
                data-midi-step="0.05"
              />
              <span class="value">{(mc.deformationSpread ?? 1).toFixed(2)}</span>
            </div>

            <div class="property-row">
              <label>{$t('spatial.common.axis')}</label>
              <select
                value={mc.deformationAxis}
                onchange={(e) => updateContent({ deformationAxis: (e.target as HTMLSelectElement).value as any })}
                data-midi-path="map:model3d:deformationAxis"
                data-midi-label={$t('spatial.common.axis')}
                data-midi-min="0"
                data-midi-max="3"
                data-midi-step="1"
                data-midi-discrete="all,x,y,z"
              >
                <option value="all">{$t('spatial.model3d.axes.all')}</option>
                <option value="x">{$t('spatial.model3d.axes.x')}</option>
                <option value="y">{$t('spatial.model3d.axes.y')}</option>
                <option value="z">{$t('spatial.model3d.axes.z')}</option>
              </select>
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Animation Section -->
    <div class="section collapsible" class:open={showAnimation}>
      <button class="section-header" onclick={() => (showAnimation = !showAnimation)}>
        <span>{$t('spatial.model3d.sections.animation')}</span>
        <span class="chevron">{showAnimation ? '−' : '+'}</span>
      </button>
      {#if showAnimation}
        <div class="section-content">
          <!-- File Animation (GLTF/FBX embedded) -->
          {#if mc.hasFileAnimations}
            <div class="property-row checkbox">
              <label>
                <input
                  type="checkbox"
                  checked={mc.useFileAnimation !== false}
                  onchange={(e) => updateContent({ useFileAnimation: (e.target as HTMLInputElement).checked })}
                  data-midi-path="map:model3d:useFileAnimation"
                  data-midi-label={$t('spatial.model3d.labels.playFileAnimation')}
                  data-midi-mode="toggle"
                />
                {$t('spatial.model3d.labels.playFileAnimation')}
              </label>
            </div>
            {#if mc.useFileAnimation !== false}
              <div class="property-row">
                <label>{$t('spatial.model3d.labels.playbackSpeed')}</label>
                <input
                  type="range" min="0" max="5" step="0.1"
                  value={mc.fileAnimationSpeed ?? 1}
                  oninput={(e) => updateContent({ fileAnimationSpeed: parseFloat((e.target as HTMLInputElement).value) })}
                  data-midi-path="map:model3d:fileAnimationSpeed"
                  data-midi-label={$t('spatial.model3d.labels.fileAnimSpeed')}
                  data-midi-min="0"
                  data-midi-max="5"
                  data-midi-step="0.1"
                />
                <span class="value">{(mc.fileAnimationSpeed ?? 1).toFixed(1)}x</span>
              </div>
            {/if}
            <div class="section-divider"></div>
          {/if}

          <div class="property-row">
            <label>{$t('spatial.common.type')}</label>
            <select
              value={mc.animationType}
              onchange={(e) => updateContent({ animationType: (e.target as HTMLSelectElement).value as Model3DAnimationType })}
              data-midi-path="map:model3d:animationType"
              data-midi-label={$t('spatial.common.type')}
              data-midi-min="0"
              data-midi-max="15"
              data-midi-step="1"
              data-midi-discrete="none,rotate,orbit,bounce,swing,float,shake,spiral,fadeIn,scaleIn,unfold,assemble,grow,morphLoop,colorCycle,texturePan"
            >
              {#each animationTypes as anim}
                <option value={anim.value} title={$t(`spatial.${anim.descriptionKey}`)}>{$t(`spatial.${anim.labelKey}`)}</option>
              {/each}
            </select>
          </div>

          {#if mc.animationType !== 'none'}
            <div class="property-row">
              <label>{$t('spatial.common.speed')}</label>
              <input
                type="range" min="0" max="5" step="0.1"
                value={mc.animationSpeed}
                oninput={(e) => updateContent({ animationSpeed: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:animationSpeed"
                data-midi-label={$t('spatial.common.speed')}
                data-midi-min="0"
                data-midi-max="5"
                data-midi-step="0.1"
              />
              <span class="value">{mc.animationSpeed.toFixed(1)}</span>
            </div>

            <div class="property-row">
              <label>{$t('spatial.common.intensity')}</label>
              <input
                type="range" min="0" max="2" step="0.1"
                value={mc.animationIntensity}
                oninput={(e) => updateContent({ animationIntensity: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:animationIntensity"
                data-midi-label={$t('spatial.common.intensity')}
                data-midi-min="0"
                data-midi-max="2"
                data-midi-step="0.1"
              />
              <span class="value">{mc.animationIntensity.toFixed(1)}</span>
            </div>

            <div class="property-row checkbox">
              <label>
                <input
                  type="checkbox"
                  checked={mc.animationLoop}
                  onchange={(e) => updateContent({ animationLoop: (e.target as HTMLInputElement).checked })}
                  data-midi-path="map:model3d:animationLoop"
                  data-midi-label={$t('spatial.model3d.labels.loopAnimation')}
                  data-midi-mode="toggle"
                />
                {$t('spatial.model3d.labels.loopAnimation')}
              </label>
            </div>

            {#if !mc.animationLoop}
              <div class="property-row">
                <label>{$t('spatial.common.progress')}</label>
                <input
                  type="range" min="0" max="1" step="0.01"
                  value={mc.animationProgress}
                  oninput={(e) => updateContent({ animationProgress: parseFloat((e.target as HTMLInputElement).value) })}
                  data-midi-path="map:model3d:animationProgress"
                  data-midi-label={$t('spatial.common.progress')}
                  data-midi-min="0"
                  data-midi-max="1"
                  data-midi-step="0.01"
                />
                <span class="value">{(mc.animationProgress * 100).toFixed(0)}%</span>
              </div>
            {/if}
          {/if}
        </div>
      {/if}
    </div>

    <!-- Echo/Instancing Section -->
    <div class="section collapsible" class:open={showEcho}>
      <button class="section-header" onclick={() => (showEcho = !showEcho)}>
        <span>{$t('spatial.model3d.sections.echo')}</span>
        <span class="chevron">{showEcho ? '−' : '+'}</span>
      </button>
      {#if showEcho}
        <div class="section-content">
          <div class="property-row checkbox">
            <label>
              <input
                type="checkbox"
                checked={mc.echo.enabled}
            onchange={(e) => {
              const enabled = (e.target as HTMLInputElement).checked;
              updateEcho({
                enabled,
                ...(enabled && mc.echo.type === 'none' ? { type: 'ghostTrail' } : {}),
                  });
            }}
                data-midi-path="map:model3d:echo.enabled"
                data-midi-label={$t('spatial.model3d.labels.enableEcho')}
                data-midi-mode="toggle"
              />
              {$t('spatial.model3d.labels.enableEcho')}
            </label>
          </div>

          {#if mc.echo.enabled}
            <div class="property-row">
              <label>{$t('spatial.common.type')}</label>
              <select
                value={mc.echo.type}
                onchange={(e) => updateEcho({ type: (e.target as HTMLSelectElement).value as Model3DEchoType })}
                data-midi-path="map:model3d:echo.type"
                data-midi-label={$t('spatial.common.type')}
                data-midi-min="0"
                data-midi-max="14"
                data-midi-step="1"
                data-midi-discrete="none,ghostTrail,stream,swarm,grid,radial,spiral,random,fountain,tornado,explosion,orbit,matrix,dna,kaleidoscope"
              >
                {#each echoTypes as echo}
                  <option value={echo.value} title={$t(`spatial.${echo.descriptionKey}`)}>{$t(`spatial.${echo.labelKey}`)}</option>
                {/each}
              </select>
            </div>

            {#if mc.echo.type !== 'none'}
              <div class="property-row">
                <label>{$t('spatial.model3d.labels.count')}</label>
                <input
                  type="range" min="1" max="50" step="1"
                  value={mc.echo.count}
                  oninput={(e) => updateEcho({ count: parseInt((e.target as HTMLInputElement).value) })}
                  data-midi-path="map:model3d:echo.count"
                  data-midi-label={$t('spatial.model3d.labels.count')}
                  data-midi-min="1"
                  data-midi-max="50"
                  data-midi-step="1"
                />
                <span class="value">{mc.echo.count}</span>
              </div>

              <div class="property-row">
                <label>{$t('spatial.model3d.labels.spacing')}</label>
                <input
                  type="range" min="0.1" max="3" step="0.1"
                  value={mc.echo.spacing}
                  oninput={(e) => updateEcho({ spacing: parseFloat((e.target as HTMLInputElement).value) })}
                  data-midi-path="map:model3d:echo.spacing"
                  data-midi-label={$t('spatial.model3d.labels.spacing')}
                  data-midi-min="0.1"
                  data-midi-max="3"
                  data-midi-step="0.1"
                />
                <span class="value">{mc.echo.spacing.toFixed(1)}</span>
              </div>

              <div class="property-row">
                <label>{$t('spatial.model3d.labels.fadeRate')}</label>
                <input
                  type="range" min="0" max="1" step="0.01"
                  value={mc.echo.fadeRate}
                  oninput={(e) => updateEcho({ fadeRate: parseFloat((e.target as HTMLInputElement).value) })}
                  data-midi-path="map:model3d:echo.fadeRate"
                  data-midi-label={$t('spatial.model3d.labels.fadeRate')}
                  data-midi-min="0"
                  data-midi-max="1"
                  data-midi-step="0.01"
                />
                <span class="value">{mc.echo.fadeRate.toFixed(2)}</span>
              </div>

              <div class="property-row">
                <label>{$t('spatial.model3d.labels.scaleVariation')}</label>
                <input
                  type="range" min="0" max="1" step="0.01"
                  value={mc.echo.scaleVariation}
                  oninput={(e) => updateEcho({ scaleVariation: parseFloat((e.target as HTMLInputElement).value) })}
                  data-midi-path="map:model3d:echo.scaleVariation"
                  data-midi-label={$t('spatial.model3d.labels.scaleVariation')}
                  data-midi-min="0"
                  data-midi-max="1"
                  data-midi-step="0.01"
                />
                <span class="value">{mc.echo.scaleVariation.toFixed(2)}</span>
              </div>

              <div class="property-row">
                <label>{$t('spatial.model3d.labels.rotationVariation')}</label>
                <input
                  type="range" min="0" max="1" step="0.01"
                  value={mc.echo.rotationVariation}
                  oninput={(e) => updateEcho({ rotationVariation: parseFloat((e.target as HTMLInputElement).value) })}
                  data-midi-path="map:model3d:echo.rotationVariation"
                  data-midi-label={$t('spatial.model3d.labels.rotationVariation')}
                  data-midi-min="0"
                  data-midi-max="1"
                  data-midi-step="0.01"
                />
                <span class="value">{mc.echo.rotationVariation.toFixed(2)}</span>
              </div>

              <div class="property-row">
                <label>{$t('spatial.model3d.labels.colorVariation')}</label>
                <input
                  type="range" min="0" max="1" step="0.01"
                  value={mc.echo.colorVariation}
                  oninput={(e) => updateEcho({ colorVariation: parseFloat((e.target as HTMLInputElement).value) })}
                  data-midi-path="map:model3d:echo.colorVariation"
                  data-midi-label={$t('spatial.model3d.labels.colorVariation')}
                  data-midi-min="0"
                  data-midi-max="1"
                  data-midi-step="0.01"
                />
                <span class="value">{mc.echo.colorVariation.toFixed(2)}</span>
              </div>

              <div class="property-row">
                <label>{$t('spatial.common.speed')}</label>
                <input
                  type="range" min="0" max="5" step="0.1"
                  value={mc.echo.speed}
                  oninput={(e) => updateEcho({ speed: parseFloat((e.target as HTMLInputElement).value) })}
                  data-midi-path="map:model3d:echo.speed"
                  data-midi-label={$t('spatial.common.speed')}
                  data-midi-min="0"
                  data-midi-max="5"
                  data-midi-step="0.1"
                />
                <span class="value">{mc.echo.speed.toFixed(1)}</span>
              </div>
            {/if}
          {/if}
        </div>
      {/if}
    </div>

    <!-- Transform Section -->
    <div class="section collapsible" class:open={showTransform}>
      <button class="section-header" onclick={() => (showTransform = !showTransform)}>
        <span>{$t('spatial.model3d.sections.transform')}</span>
        <span class="chevron">{showTransform ? '−' : '+'}</span>
      </button>
      {#if showTransform}
        <div class="section-content">
          <div class="property-row">
            <label>{$t('spatial.common.scale')}</label>
            <input
              type="range" min="0.1" max="5" step="0.1"
              value={mc.scaleUniform}
              oninput={(e) => updateContent({ scaleUniform: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:model3d:scaleUniform"
              data-midi-label={$t('spatial.common.scale')}
              data-midi-min="0.1"
              data-midi-max="5"
              data-midi-step="0.1"
            />
            <span class="value">{mc.scaleUniform.toFixed(1)}</span>
          </div>

          <div class="property-row">
            <label>{$t('spatial.model3d.labels.rotationX')}</label>
            <input
              type="range" min="-180" max="180" step="1"
              value={mc.rotationX}
              oninput={(e) => updateContent({ rotationX: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:model3d:rotationX"
              data-midi-label={$t('spatial.model3d.labels.rotationX')}
              data-midi-min="-180"
              data-midi-max="180"
              data-midi-step="1"
            />
            <span class="value">{mc.rotationX.toFixed(0)}°</span>
          </div>

          <div class="property-row">
            <label>{$t('spatial.model3d.labels.rotationY')}</label>
            <input
              type="range" min="-180" max="180" step="1"
              value={mc.rotationY}
              oninput={(e) => updateContent({ rotationY: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:model3d:rotationY"
              data-midi-label={$t('spatial.model3d.labels.rotationY')}
              data-midi-min="-180"
              data-midi-max="180"
              data-midi-step="1"
            />
            <span class="value">{mc.rotationY.toFixed(0)}°</span>
          </div>

          <div class="property-row">
            <label>{$t('spatial.model3d.labels.rotationZ')}</label>
            <input
              type="range" min="-180" max="180" step="1"
              value={mc.rotationZ}
              oninput={(e) => updateContent({ rotationZ: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:model3d:rotationZ"
              data-midi-label={$t('spatial.model3d.labels.rotationZ')}
              data-midi-min="-180"
              data-midi-max="180"
              data-midi-step="1"
            />
            <span class="value">{mc.rotationZ.toFixed(0)}°</span>
          </div>

          <div class="property-row">
            <label>{$t('spatial.model3d.labels.positionX')}</label>
            <input
              type="range" min="-5" max="5" step="0.1"
              value={mc.positionX}
              oninput={(e) => updateContent({ positionX: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:model3d:positionX"
              data-midi-label={$t('spatial.model3d.labels.positionX')}
              data-midi-min="-5"
              data-midi-max="5"
              data-midi-step="0.1"
            />
            <span class="value">{mc.positionX.toFixed(1)}</span>
          </div>

          <div class="property-row">
            <label>{$t('spatial.model3d.labels.positionY')}</label>
            <input
              type="range" min="-5" max="5" step="0.1"
              value={mc.positionY}
              oninput={(e) => updateContent({ positionY: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:model3d:positionY"
              data-midi-label={$t('spatial.model3d.labels.positionY')}
              data-midi-min="-5"
              data-midi-max="5"
              data-midi-step="0.1"
            />
            <span class="value">{mc.positionY.toFixed(1)}</span>
          </div>

          <div class="property-row">
            <label>{$t('spatial.model3d.labels.positionZ')}</label>
            <input
              type="range" min="-5" max="5" step="0.1"
              value={mc.positionZ}
              oninput={(e) => updateContent({ positionZ: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:model3d:positionZ"
              data-midi-label={$t('spatial.model3d.labels.positionZ')}
              data-midi-min="-5"
              data-midi-max="5"
              data-midi-step="0.1"
            />
            <span class="value">{mc.positionZ.toFixed(1)}</span>
          </div>
        </div>
      {/if}
    </div>

    <!-- Camera Section -->
    <div class="section collapsible" class:open={showCamera}>
      <button class="section-header" onclick={() => (showCamera = !showCamera)}>
        <span>{$t('spatial.model3d.sections.camera')}</span>
        <span class="chevron">{showCamera ? '−' : '+'}</span>
      </button>
      {#if showCamera}
        <div class="section-content">
          <div class="button-row">
            <button class="secondary-button" type="button" onclick={frameCamera}>{$t('spatial.model3d.labels.frameModel')}</button>
            <button class="secondary-button" type="button" onclick={resetModelTransform}>{$t('spatial.model3d.labels.resetModel')}</button>
          </div>

          <div class="property-row checkbox">
            <label>
              <input
                type="checkbox"
                checked={mc.camera.autoRotate}
                onchange={(e) => updateCamera({ autoRotate: (e.target as HTMLInputElement).checked })}
                data-midi-path="map:model3d:camera.autoRotate"
                data-midi-label={$t('spatial.model3d.labels.autoRotate')}
                data-midi-mode="toggle"
              />
              {$t('spatial.model3d.labels.autoRotate')}
            </label>
          </div>

          {#if mc.camera.autoRotate}
            <div class="property-row">
              <label>{$t('spatial.model3d.labels.rotateSpeed')}</label>
              <input
                type="range" min="0" max="5" step="0.1"
                value={mc.camera.rotateSpeed}
                oninput={(e) => updateCamera({ rotateSpeed: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:camera.rotateSpeed"
                data-midi-label={$t('spatial.model3d.labels.rotateSpeed')}
                data-midi-min="0"
                data-midi-max="5"
                data-midi-step="0.1"
              />
              <span class="value">{mc.camera.rotateSpeed.toFixed(1)}</span>
            </div>
          {/if}

          <div class="property-row">
            <label>{$t('spatial.common.distance')}</label>
            <input
              type="range" min="1" max="20" step="0.1"
              value={mc.camera.distance}
              oninput={(e) => updateCamera({ distance: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:model3d:camera.distance"
              data-midi-label={$t('spatial.common.distance')}
              data-midi-min="1"
              data-midi-max="20"
              data-midi-step="0.1"
            />
            <span class="value">{mc.camera.distance.toFixed(1)}</span>
          </div>

          <div class="property-row">
            <label>{$t('spatial.common.fov')}</label>
            <input
              type="range" min="20" max="120" step="1"
              value={mc.camera.fov}
              oninput={(e) => updateCamera({ fov: parseInt((e.target as HTMLInputElement).value) })}
              data-midi-path="map:model3d:camera.fov"
              data-midi-label={$t('spatial.common.fov')}
              data-midi-min="20"
              data-midi-max="120"
              data-midi-step="1"
            />
            <span class="value">{mc.camera.fov}°</span>
          </div>

          <div class="property-row">
            <label>{$t('spatial.model3d.labels.orbitX')}</label>
            <input
              type="range" min="-90" max="90" step="1"
              value={mc.camera.orbitX}
              oninput={(e) => updateCamera({ orbitX: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:model3d:camera.orbitX"
              data-midi-label={$t('spatial.model3d.labels.orbitX')}
              data-midi-min="-90"
              data-midi-max="90"
              data-midi-step="1"
            />
            <span class="value">{mc.camera.orbitX.toFixed(0)}°</span>
          </div>

          <div class="property-row">
            <label>{$t('spatial.model3d.labels.orbitY')}</label>
            <input
              type="range" min="-180" max="180" step="1"
              value={mc.camera.orbitY}
              oninput={(e) => updateCamera({ orbitY: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:model3d:camera.orbitY"
              data-midi-label={$t('spatial.model3d.labels.orbitY')}
              data-midi-min="-180"
              data-midi-max="180"
              data-midi-step="1"
            />
            <span class="value">{mc.camera.orbitY.toFixed(0)}°</span>
          </div>

          <div class="property-row">
            <label>{$t('spatial.common.roll')}</label>
            <input
              type="range" min="-180" max="180" step="1"
              value={mc.camera.roll}
              oninput={(e) => updateCamera({ roll: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:model3d:camera.roll"
              data-midi-label={$t('spatial.common.roll')}
              data-midi-min="-180"
              data-midi-max="180"
              data-midi-step="1"
            />
            <span class="value">{mc.camera.roll.toFixed(0)}°</span>
          </div>

          <div class="property-row">
            <label>{$t('spatial.model3d.labels.panX')}</label>
            <input
              type="range" min="-5" max="5" step="0.1"
              value={mc.camera.panX}
              oninput={(e) => updateCamera({ panX: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:model3d:camera.panX"
              data-midi-label={$t('spatial.model3d.labels.panX')}
              data-midi-min="-5"
              data-midi-max="5"
              data-midi-step="0.1"
            />
            <span class="value">{mc.camera.panX.toFixed(1)}</span>
          </div>

          <div class="property-row">
            <label>{$t('spatial.model3d.labels.panY')}</label>
            <input
              type="range" min="-5" max="5" step="0.1"
              value={mc.camera.panY}
              oninput={(e) => updateCamera({ panY: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:model3d:camera.panY"
              data-midi-label={$t('spatial.model3d.labels.panY')}
              data-midi-min="-5"
              data-midi-max="5"
              data-midi-step="0.1"
            />
            <span class="value">{mc.camera.panY.toFixed(1)}</span>
          </div>
        </div>
      {/if}
    </div>

    <!-- Lighting Section -->
    <div class="section collapsible" class:open={showLighting}>
      <button class="section-header" onclick={() => (showLighting = !showLighting)}>
        <span>{$t('spatial.model3d.sections.lighting')}</span>
        <span class="chevron">{showLighting ? '−' : '+'}</span>
      </button>
      {#if showLighting}
        <div class="section-content">
          <div class="property-row">
            <label>{$t('spatial.common.preset')}</label>
            <select
              value={mc.lightingPreset}
              onchange={(e) => updateContent({ lightingPreset: (e.target as HTMLSelectElement).value as Model3DLightingPreset })}
              data-midi-path="map:model3d:lightingPreset"
              data-midi-label={$t('spatial.common.preset')}
              data-midi-min="0"
              data-midi-max="6"
              data-midi-step="1"
              data-midi-discrete="studio,dramatic,neon,sunrise,moonlight,disco,none"
            >
              {#each lightingPresets as preset}
                <option value={preset.value}>{$t(`spatial.${preset.labelKey}`)}</option>
              {/each}
            </select>
          </div>

          <span class="subsection-label">{$t('spatial.model3d.labels.environment')}</span>

          <div class="property-row checkbox">
            <label>
              <input
                type="checkbox"
                checked={mc.environmentEnabled ?? true}
                onchange={(e) => updateContent({ environmentEnabled: (e.target as HTMLInputElement).checked })}
                data-midi-path="map:model3d:environmentEnabled"
                data-midi-label={$t('spatial.model3d.labels.environmentLight')}
                data-midi-mode="toggle"
              />
              {$t('spatial.model3d.labels.environmentLight')}
            </label>
          </div>

          <div class="property-row">
            <label>{$t('spatial.model3d.labels.environment')}</label>
            <input
              type="range" min="0" max="3" step="0.05"
              value={mc.environmentIntensity ?? 1}
              oninput={(e) => updateContent({ environmentIntensity: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:model3d:environmentIntensity"
              data-midi-label={$t('spatial.model3d.labels.environment')}
              data-midi-min="0"
              data-midi-max="3"
              data-midi-step="0.05"
            />
            <span class="value">{(mc.environmentIntensity ?? 1).toFixed(2)}</span>
          </div>

          <div class="property-row">
            <label>{$t('spatial.model3d.labels.exposure')}</label>
            <input
              type="range" min="0.1" max="3" step="0.05"
              value={mc.toneMappingExposure ?? 1}
              oninput={(e) => updateContent({ toneMappingExposure: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:model3d:toneMappingExposure"
              data-midi-label={$t('spatial.model3d.labels.sceneExposure')}
              data-midi-min="0.1"
              data-midi-max="3"
              data-midi-step="0.05"
            />
            <span class="value">{(mc.toneMappingExposure ?? 1).toFixed(2)}</span>
          </div>

          <div class="property-row">
            <label>{$t('spatial.model3d.labels.background')}</label>
            <select
              value={mc.backgroundMode ?? 'transparent'}
              onchange={(e) => updateContent({ backgroundMode: (e.target as HTMLSelectElement).value as Model3DContent['backgroundMode'],
                })}
            >
              <option value="transparent">{$t('spatial.model3d.labels.transparent')}</option>
              <option value="color">{$t('spatial.model3d.labels.solidColor')}</option>
              <option value="environment">{$t('spatial.model3d.options.environment')}</option>
            </select>
          </div>

          {#if (mc.backgroundMode ?? 'transparent') === 'color'}
            <div class="property-row">
              <label>{$t('spatial.model3d.labels.bgColor')}</label>
              <input
                type="color"
                value={rgbToHex(...(mc.backgroundColor ?? [8, 8, 12]))}
                onchange={(e) => updateContent({ backgroundColor: hexToRgb((e.target as HTMLInputElement).value) })}
              />
            </div>
          {/if}

          {#if (mc.backgroundMode ?? 'transparent') !== 'transparent'}
            <div class="property-row">
              <label>{$t('spatial.model3d.labels.bgOpacity')}</label>
              <input
                type="range" min="0" max="1" step="0.01"
                value={mc.backgroundOpacity ?? 1}
                oninput={(e) => updateContent({ backgroundOpacity: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:backgroundOpacity"
                data-midi-label={$t('spatial.model3d.labels.bgOpacity')}
                data-midi-min="0"
                data-midi-max="1"
                data-midi-step="0.01"
              />
              <span class="value">{Math.round((mc.backgroundOpacity ?? 1) * 100)}%</span>
            </div>
          {/if}

          <div class="section-divider"></div>
          <span class="subsection-label">{$t('spatial.model3d.labels.keyFillRim')}</span>

          <div class="property-row">
            <label>{$t('spatial.common.ambient')}</label>
            <input
              type="range" min="0" max="2" step="0.1"
              value={mc.ambientIntensity}
              oninput={(e) => updateContent({ ambientIntensity: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:model3d:ambientIntensity"
              data-midi-label={$t('spatial.common.ambient')}
              data-midi-min="0"
              data-midi-max="2"
              data-midi-step="0.1"
            />
            <span class="value">{mc.ambientIntensity.toFixed(1)}</span>
          </div>

          <div class="property-row">
            <label>{$t('spatial.model3d.labels.keyPower')}</label>
            <input
              type="range" min="0" max="3" step="0.1"
              value={mc.directionalIntensity}
              oninput={(e) => updateContent({ directionalIntensity: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:model3d:directionalIntensity"
              data-midi-label={$t('spatial.model3d.labels.keyPower')}
              data-midi-min="0"
              data-midi-max="3"
              data-midi-step="0.1"
            />
            <span class="value">{mc.directionalIntensity.toFixed(1)}</span>
          </div>

          <div class="property-row">
            <label>{$t('spatial.model3d.labels.keyColor')}</label>
            <input
              type="color"
              value={rgbToHex(mc.lightColor[0], mc.lightColor[1], mc.lightColor[2])}
              onchange={(e) => updateContent({ lightColor: hexToRgb((e.target as HTMLInputElement).value) })}
            />
          </div>

          <div class="property-row">
            <label>{$t('spatial.model3d.labels.keyAzimuth')}</label>
            <input
              type="range" min="-180" max="180" step="1"
              value={mc.keyLightAzimuth ?? 45}
              oninput={(e) => updateContent({ keyLightAzimuth: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:model3d:keyLightAzimuth"
              data-midi-label={$t('spatial.model3d.labels.keyAzimuth')}
              data-midi-min="-180"
              data-midi-max="180"
              data-midi-step="1"
            />
            <span class="value">{(mc.keyLightAzimuth ?? 45).toFixed(0)}°</span>
          </div>

          <div class="property-row">
            <label>{$t('spatial.model3d.labels.keyElevation')}</label>
            <input
              type="range" min="-10" max="90" step="1"
              value={mc.keyLightElevation ?? 50}
              oninput={(e) => updateContent({ keyLightElevation: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:model3d:keyLightElevation"
              data-midi-label={$t('spatial.model3d.labels.keyElevation')}
              data-midi-min="-10"
              data-midi-max="90"
              data-midi-step="1"
            />
            <span class="value">{(mc.keyLightElevation ?? 50).toFixed(0)}°</span>
          </div>

          <div class="property-row">
            <label>{$t('spatial.model3d.labels.fillPower')}</label>
            <input
              type="range" min="0" max="3" step="0.05"
              value={mc.fillIntensity ?? 0.35}
              oninput={(e) => updateContent({ fillIntensity: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:model3d:fillIntensity"
              data-midi-label={$t('spatial.model3d.labels.fillPower')}
              data-midi-min="0"
              data-midi-max="3"
              data-midi-step="0.05"
            />
            <span class="value">{(mc.fillIntensity ?? 0.35).toFixed(2)}</span>
          </div>

          <div class="property-row">
            <label>{$t('spatial.model3d.labels.rimPower')}</label>
            <input
              type="range" min="0" max="3" step="0.05"
              value={mc.rimIntensity ?? 0.4}
              oninput={(e) => updateContent({ rimIntensity: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:model3d:rimIntensity"
              data-midi-label={$t('spatial.model3d.labels.rimPower')}
              data-midi-min="0"
              data-midi-max="3"
              data-midi-step="0.05"
            />
            <span class="value">{(mc.rimIntensity ?? 0.4).toFixed(2)}</span>
          </div>

          <div class="property-row">
            <label>{$t('spatial.model3d.labels.rimColor')}</label>
            <input
              type="color"
              value={rgbToHex(...(mc.rimColor ?? [120, 180, 255]))}
              onchange={(e) => updateContent({ rimColor: hexToRgb((e.target as HTMLInputElement).value) })}
            />
          </div>

          <div class="section-divider"></div>
          <span class="subsection-label">{$t('spatial.model3d.labels.shadows')}</span>

          <div class="property-row checkbox">
            <label>
              <input
                type="checkbox"
                checked={mc.shadowsEnabled ?? true}
                onchange={(e) => updateContent({ shadowsEnabled: (e.target as HTMLInputElement).checked })}
                data-midi-path="map:model3d:shadowsEnabled"
                data-midi-label={$t('spatial.model3d.labels.shadows')}
                data-midi-mode="toggle"
              />
              {$t('spatial.model3d.labels.enableShadows')}
            </label>
          </div>

          {#if mc.shadowsEnabled ?? true}
            <div class="property-row">
              <label>{$t('spatial.model3d.labels.quality')}</label>
              <select
                value={mc.shadowQuality ?? 'medium'}
                onchange={(e) => updateContent({ shadowQuality: (e.target as HTMLSelectElement).value as Model3DContent['shadowQuality'],
                  })}
              >
                <option value="low">{$t('spatial.model3d.labels.low512')}</option>
                <option value="medium">{$t('spatial.model3d.labels.medium1024')}</option>
                <option value="high">{$t('spatial.model3d.labels.high2048')}</option>
              </select>
            </div>

            <div class="property-row">
              <label>{$t('spatial.model3d.labels.softness')}</label>
              <input
                type="range" min="0" max="4" step="0.1"
                value={mc.shadowSoftness ?? 1}
                oninput={(e) => updateContent({ shadowSoftness: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:shadowSoftness"
                data-midi-label={$t('spatial.model3d.labels.softness')}
                data-midi-min="0"
                data-midi-max="4"
                data-midi-step="0.1"
              />
              <span class="value">{(mc.shadowSoftness ?? 1).toFixed(1)}</span>
            </div>

            <div class="property-row">
              <label>{$t('spatial.model3d.labels.bias')}</label>
              <input
                type="range" min="-0.01" max="0.01" step="0.0001"
                value={mc.shadowBias ?? -0.0005}
                oninput={(e) => updateContent({ shadowBias: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:shadowBias"
                data-midi-label={$t('spatial.model3d.labels.bias')}
                data-midi-min="-0.01"
                data-midi-max="0.01"
                data-midi-step="0.0001"
              />
              <span class="value">{(mc.shadowBias ?? -0.0005).toFixed(4)}</span>
            </div>
          {/if}

        </div>
      {/if}
    </div>

    <!-- Audio Reactivity Section -->
    <div class="section collapsible" class:open={showAudio}>
      <button class="section-header" onclick={() => (showAudio = !showAudio)}>
        <span>{$t('spatial.model3d.sections.audio')}</span>
        <span class="chevron">{showAudio ? '−' : '+'}</span>
      </button>
      {#if showAudio}
        <div class="section-content">
          <div class="property-row checkbox">
            <label>
              <input
                type="checkbox"
                checked={mc.audio.enabled}
                onchange={(e) => updateAudio({ enabled: (e.target as HTMLInputElement).checked })}
                data-midi-path="map:model3d:audio.enabled"
                data-midi-label={$t('spatial.model3d.sections.audio')}
                data-midi-mode="toggle"
                data-midi-min="0"
                data-midi-max="1"
              />
              {$t('spatial.model3d.labels.enableAudio')}
            </label>
          </div>

          {#if mc.audio.enabled}
            <div class="property-row">
              <label>{$t('spatial.common.band')}</label>
              <select
                value={mc.audio.audioBand}
                onchange={(e) => updateAudio({ audioBand: (e.target as HTMLSelectElement).value as any })}
                data-midi-path="map:model3d:audio.audioBand"
                data-midi-label={$t('spatial.common.band')}
                data-midi-min="0"
                data-midi-max="6"
                data-midi-step="1"
                data-midi-discrete="all,sub,bass,lowMid,mid,highMid,high"
              >
                <option value="all">{$t('spatial.model3d.labels.allFrequencies')}</option>
                <option value="sub">{$t('spatial.model3d.labels.subBass')}</option>
                <option value="bass">{$t('spatial.model3d.labels.bass')}</option>
                <option value="lowMid">{$t('spatial.model3d.labels.lowMid')}</option>
                <option value="mid">{$t('spatial.model3d.labels.mid')}</option>
                <option value="highMid">{$t('spatial.model3d.labels.highMid')}</option>
                <option value="high">{$t('spatial.model3d.labels.high')}</option>
              </select>
            </div>

            <div class="property-row">
              <label>{$t('spatial.common.scale')}</label>
              <input
                type="range" min="0" max="1" step="0.01"
                value={mc.audio.scaleResponse}
                oninput={(e) => updateAudio({ scaleResponse: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:audio.scaleResponse"
                data-midi-label={$t('spatial.common.scale')}
                data-midi-min="0"
                data-midi-max="1"
                data-midi-step="0.01"
              />
              <span class="value">{(mc.audio.scaleResponse * 100).toFixed(0)}%</span>
            </div>

            <div class="property-row">
              <label>{$t('spatial.common.rotation')}</label>
              <input
                type="range" min="0" max="1" step="0.01"
                value={mc.audio.rotationResponse}
                oninput={(e) => updateAudio({ rotationResponse: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:audio.rotationResponse"
                data-midi-label={$t('spatial.common.rotation')}
                data-midi-min="0"
                data-midi-max="1"
                data-midi-step="0.01"
              />
              <span class="value">{(mc.audio.rotationResponse * 100).toFixed(0)}%</span>
            </div>

            <div class="property-row">
              <label>{$t('spatial.model3d.labels.deform')}</label>
              <input
                type="range" min="0" max="1" step="0.01"
                value={mc.audio.deformResponse}
                oninput={(e) => updateAudio({ deformResponse: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:audio.deformResponse"
                data-midi-label={$t('spatial.model3d.labels.deform')}
                data-midi-min="0"
                data-midi-max="1"
                data-midi-step="0.01"
              />
              <span class="value">{(mc.audio.deformResponse * 100).toFixed(0)}%</span>
            </div>

            <div class="property-row">
              <label>{$t('spatial.common.color')}</label>
              <input
                type="range" min="0" max="1" step="0.01"
                value={mc.audio.colorResponse}
                oninput={(e) => updateAudio({ colorResponse: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:audio.colorResponse"
                data-midi-label={$t('spatial.common.color')}
                data-midi-min="0"
                data-midi-max="1"
                data-midi-step="0.01"
              />
              <span class="value">{(mc.audio.colorResponse * 100).toFixed(0)}%</span>
            </div>

            <div class="property-row">
              <label>{$t('spatial.model3d.labels.emissive')}</label>
              <input
                type="range" min="0" max="1" step="0.01"
                value={mc.audio.emissiveResponse}
                oninput={(e) => updateAudio({ emissiveResponse: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:audio.emissiveResponse"
                data-midi-label={$t('spatial.model3d.labels.emissive')}
                data-midi-min="0"
                data-midi-max="1"
                data-midi-step="0.01"
              />
              <span class="value">{(mc.audio.emissiveResponse * 100).toFixed(0)}%</span>
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Beat Sync Section -->
    <div class="section collapsible" class:open={showBeatSync}>
      <button class="section-header" onclick={() => (showBeatSync = !showBeatSync)}>
        <span>{$t('spatial.model3d.sections.beat')}</span>
        <span class="chevron">{showBeatSync ? '−' : '+'}</span>
      </button>
      {#if showBeatSync}
        <div class="section-content">
          <div class="property-row">
            <label>{$t('spatial.model3d.labels.beatScale')}</label>
            <input
              type="range" min="0" max="1" step="0.01"
              value={mc.beatScale}
              oninput={(e) => updateContent({ beatScale: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:model3d:beatScale"
              data-midi-label={$t('spatial.model3d.labels.beatScale')}
              data-midi-min="0"
              data-midi-max="1"
              data-midi-step="0.01"
            />
            <span class="value">{(mc.beatScale * 100).toFixed(0)}%</span>
          </div>

          <div class="property-row">
            <label>{$t('spatial.model3d.labels.beatRotate')}</label>
            <input
              type="range" min="0" max="1" step="0.01"
              value={mc.beatRotate}
              oninput={(e) => updateContent({ beatRotate: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:model3d:beatRotate"
              data-midi-label={$t('spatial.model3d.labels.beatRotate')}
              data-midi-min="0"
              data-midi-max="1"
              data-midi-step="0.01"
            />
            <span class="value">{(mc.beatRotate * 100).toFixed(0)}%</span>
          </div>

          <div class="property-row">
            <label>{$t('spatial.model3d.labels.beatExplode')}</label>
            <input
              type="range" min="0" max="1" step="0.01"
              value={mc.beatExplode}
              oninput={(e) => updateContent({ beatExplode: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:model3d:beatExplode"
              data-midi-label={$t('spatial.model3d.labels.beatExplode')}
              data-midi-min="0"
              data-midi-max="1"
              data-midi-step="0.01"
            />
            <span class="value">{(mc.beatExplode * 100).toFixed(0)}%</span>
          </div>

          <div class="property-row">
            <label>{$t('spatial.model3d.labels.colorFlash')}</label>
            <input
              type="range" min="0" max="1" step="0.01"
              value={mc.beatColorFlash}
              oninput={(e) => updateContent({ beatColorFlash: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:model3d:beatColorFlash"
              data-midi-label={$t('spatial.model3d.labels.colorFlash')}
              data-midi-min="0"
              data-midi-max="1"
              data-midi-step="0.01"
            />
            <span class="value">{(mc.beatColorFlash * 100).toFixed(0)}%</span>
          </div>
        </div>
      {/if}
    </div>

  </div>
{:else}
  <div class="no-layer">
    <p>{$t('spatial.model3d.noLayer')}</p>
  </div>
{/if}

<style>
  .model3d-panel {
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 13px;
    color: var(--text-primary, #e0e0e0);
    overflow-y: auto;
    max-height: 100%;
  }

  h3 {
    margin: 0 0 8px 0;
    font-size: 15px;
    font-weight: 600;
    color: var(--accent-primary, #bb86fc);
    border-bottom: 1px solid var(--border-color, #333);
    padding-bottom: 8px;
  }

  .section {
    background: var(--bg-tertiary, #0d0d10);
    border-radius: 6px;
    padding: 8px;
  }

  .section-label {
    display: block;
    font-size: 12px;
    color: var(--text-secondary, #888);
    margin-bottom: 6px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .subsection-label {
    color: var(--text-secondary, #888);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .button-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }

  .secondary-button {
    min-width: 0;
    padding: 6px 8px;
    border: 1px solid var(--border-color, #333);
    border-radius: 4px;
    background: var(--bg-secondary, #161618);
    color: var(--text-primary, #e0e0e0);
    font-size: 11px;
    cursor: pointer;
  }

  .secondary-button:hover {
    border-color: var(--accent-primary, #bb86fc);
    color: var(--accent-primary, #bb86fc);
  }

  .collapsible {
    padding: 0;
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    padding: 8px 10px;
    background: none;
    border: none;
    color: var(--text-primary, #e0e0e0);
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    text-align: left;
    border-radius: 6px;
  }

  .section-header:hover {
    background: var(--bg-hover, #111114);
  }

  .section-content {
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    border-top: 1px solid var(--border-color, #333);
  }

  .section-divider {
    height: 1px;
    background: var(--border-color, #333);
    margin: 4px 0;
    opacity: 0.5;
  }

  .chevron {
    font-size: 17px;
    color: var(--text-secondary, #888);
  }

  .property-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .property-row > label:first-child {
    min-width: 70px;
    max-width: 110px;
    flex-shrink: 0;
    color: var(--text-secondary, #aaa);
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .property-row input[type='range'] {
    flex: 1;
    height: 6px;
    background: #000000;
    border-radius: 3px;
    -webkit-appearance: none;
    cursor: pointer;
  }

  .property-row input[type='range']::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 14px;
    height: 14px;
    background: var(--accent-primary, #bb86fc);
    border-radius: 50%;
    cursor: pointer;
  }

  .property-row select {
    flex: 1;
    padding: 5px 8px;
    background-color: var(--bg-secondary, #161618);
    border: 1px solid var(--border-color, #333);
    border-radius: 4px;
    color: var(--text-primary, #e0e0e0);
    font-size: 12px;
    cursor: pointer;
  }

  .property-row input[type='color'] {
    width: 40px;
    height: 24px;
    padding: 0;
    border: 1px solid var(--border-color, #333);
    border-radius: 4px;
    cursor: pointer;
    background: none;
  }

  .property-row .value {
    min-width: 40px;
    text-align: right;
    color: var(--accent-primary, #bb86fc);
    font-size: 11px;
    font-family: var(--ga-font-mono, 'IBM Plex Mono', ui-monospace, monospace);
  }

  .property-row.checkbox label {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    color: var(--text-primary, #e0e0e0);
  }

  .property-row.checkbox input[type='checkbox'] {
    width: 14px;
    height: 14px;
    cursor: pointer;
  }

  .file-row {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .file-row input[type='file'] {
    display: none;
  }

  .file-button {
    padding: 6px 12px;
    background: var(--accent-primary, #bb86fc);
    color: var(--bg-primary, #121212);
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    transition: background 0.2s;
  }

  .file-button:hover {
    background: var(--accent-hover, #34d399);
  }

  .reload-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    margin-left: 6px;
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 4px;
    color: var(--text-dim, #888);
    cursor: pointer;
    transition: all 0.15s;
  }

  .reload-button:hover {
    color: var(--accent-primary, #bb86fc);
    border-color: var(--accent-primary, #bb86fc);
    background: rgba(187, 134, 252, 0.08);
  }

  .reload-button:active {
    transform: rotate(180deg);
    transition: transform 0.3s;
  }

  .file-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-top: 6px;
    padding: 6px;
    background: var(--bg-secondary, #0d0d10);
    border-radius: 4px;
    font-size: 11px;
  }

  .filename {
    color: var(--text-primary, #e0e0e0);
    font-weight: 500;
  }

  .format {
    color: var(--accent-primary, #bb86fc);
  }

  .vertex-count, .face-count {
    color: var(--text-secondary, #888);
  }

  .hint {
    color: var(--text-secondary, #666);
    font-size: 11px;
    margin: 6px 0 0 0;
    font-style: italic;
  }

  .no-layer {
    padding: 20px;
    text-align: center;
    color: var(--text-secondary, #666);
  }
</style>
