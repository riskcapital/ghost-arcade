<script lang="ts">
  import { onDestroy } from 'svelte';
  import { project, selectedLayer, scheduleHistorySnapshot } from '../stores/layers';
  import { showLoading, hideLoading } from '../stores/loading';
  import { keyframeTimeline } from '../stores/keyframeTimeline';
  import { MODEL3D_AUTOMATABLE_PARAM_MAP } from '../model3d/model3dParamSchema';
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

  // Material types with descriptions
  const materialTypes: { value: Model3DMaterialType; label: string; description: string }[] = [
    { value: 'source', label: 'Model Materials', description: 'Embedded colors and textures' },
    { value: 'standard', label: 'Standard PBR', description: 'Physically-based rendering' },
    { value: 'wireframe', label: 'Wireframe Only', description: 'Lines only, no faces' },
    { value: 'glass', label: 'Glass', description: 'Transparent with refraction' },
    { value: 'chrome', label: 'Chrome', description: 'Mirror-like reflections' },
    { value: 'hologram', label: 'Hologram', description: 'Sci-fi scanlines and glow' },
    { value: 'lava', label: 'Lava', description: 'Animated flowing magma' },
    { value: 'ice', label: 'Ice', description: 'Frosted translucent' },
    { value: 'neon', label: 'Neon', description: 'Bright emissive glow' },
    { value: 'xray', label: 'X-Ray', description: 'Medical see-through effect' },
    { value: 'toon', label: 'Toon/Cel', description: 'Cartoon cel-shading' },
    { value: 'fresnel', label: 'Fresnel', description: 'Edge glow falloff' },
    { value: 'dissolve', label: 'Dissolve', description: 'Noise-based disintegration' },
    { value: 'glitch', label: 'Glitch', description: 'Digital corruption' },
    { value: 'normal', label: 'Normal Map', description: 'Visualize normals' },
    { value: 'depth', label: 'Depth', description: 'Depth visualization' },
  ];

  // Wireframe modes
  const wireframeModes: { value: Model3DWireframeMode; label: string }[] = [
    { value: 'none', label: 'None' },
    { value: 'classic', label: 'Classic' },
    { value: 'animated', label: 'Animated Flow' },
    { value: 'glow', label: 'Soft Glow' },
    { value: 'neon', label: 'Neon Tubes' },
    { value: 'pulse', label: 'Pulsing' },
    { value: 'rainbow', label: 'Rainbow' },
    { value: 'dotted', label: 'Dotted' },
    { value: 'thick', label: 'Thick Lines' },
  ];

  // Vertex decorations
  const vertexDecorations: { value: Model3DVertexDecoration; label: string }[] = [
    { value: 'none', label: 'None' },
    { value: 'spheres', label: 'Spheres' },
    { value: 'cubes', label: 'Cubes' },
    { value: 'pyramids', label: 'Pyramids' },
    { value: 'points', label: 'Points' },
    { value: 'stars', label: 'Stars' },
    { value: 'diamonds', label: 'Diamonds' },
  ];

  // Deformation types
  const deformationTypes: { value: Model3DDeformationType; label: string; description: string }[] = [
    { value: 'none', label: 'None', description: 'No deformation' },
    { value: 'noise', label: 'Noise', description: 'Perlin noise displacement' },
    { value: 'wave', label: 'Wave', description: 'Sinusoidal ripple' },
    { value: 'pulse', label: 'Pulse', description: 'Concentric ripple from center' },
    { value: 'bulge', label: 'Bulge', description: 'Traveling outward wave' },
    { value: 'twist', label: 'Twist', description: 'Rotate along Y axis' },
    { value: 'swirl', label: 'Swirl', description: 'Helical vortex twist' },
    { value: 'bend', label: 'Bend', description: 'Arc around X axis' },
    { value: 'taper', label: 'Taper', description: 'Pinch ends toward axis' },
    { value: 'spherify', label: 'Spherify', description: 'Pull to sphere (radius = spread)' },
    { value: 'inflate', label: 'Inflate', description: 'Push along normals (pulsing)' },
    { value: 'breathe', label: 'Breathe', description: 'Soft pulsating scale' },
    { value: 'explode', label: 'Explode', description: 'Steady outward push — pair with rotate animation' },
    { value: 'implode', label: 'Implode', description: 'Steady inward pull' },
    { value: 'shatter', label: 'Shatter', description: 'Fragments scatter outward (steady)' },
    { value: 'fracture', label: 'Fracture', description: 'Chunks drift apart along random axes' },
    { value: 'melt', label: 'Melt', description: 'Drip downward' },
    { value: 'pixelate', label: 'Voxelize', description: 'Snap to voxel grid' },
    { value: 'jelly', label: 'Jelly', description: 'Bouncy soft body' },
    { value: 'tentacle', label: 'Tentacle', description: 'Tendril-like waves' },
    { value: 'magnetic', label: 'Magnetic', description: 'Pull toward poles' },
  ];

  // Animation types
  const animationTypes: { value: Model3DAnimationType; label: string; description: string }[] = [
    { value: 'none', label: 'None', description: 'Static model' },
    { value: 'rotate', label: 'Rotate', description: 'Continuous rotation' },
    { value: 'orbit', label: 'Orbit', description: 'Circular path motion' },
    { value: 'bounce', label: 'Bounce', description: 'Vertical bounce' },
    { value: 'swing', label: 'Swing', description: 'Pendulum motion' },
    { value: 'float', label: 'Float', description: 'Gentle floating' },
    { value: 'shake', label: 'Shake', description: 'Vibration/tremor' },
    { value: 'spiral', label: 'Spiral', description: 'Spiral path' },
    { value: 'fadeIn', label: 'Fade In', description: 'Opacity fade' },
    { value: 'scaleIn', label: 'Scale In', description: 'Scale from 0' },
    { value: 'unfold', label: 'Unfold', description: 'Origami unfold' },
    { value: 'assemble', label: 'Assemble', description: 'Parts fly in' },
    { value: 'grow', label: 'Grow', description: 'Organic growth' },
    { value: 'morphLoop', label: 'Morph Loop', description: 'Morph keyframes' },
    { value: 'colorCycle', label: 'Color Cycle', description: 'Hue rotation' },
    { value: 'texturePan', label: 'Texture Pan', description: 'UV animation' },
  ];

  // Echo types
  const echoTypes: { value: Model3DEchoType; label: string; description: string }[] = [
    { value: 'none', label: 'None', description: 'No copies' },
    { value: 'ghostTrail', label: 'Ghost Trail', description: 'Fading copies behind' },
    { value: 'stream', label: 'Stream', description: 'Flowing copies' },
    { value: 'swarm', label: 'Swarm', description: 'Boid-like flock' },
    { value: 'grid', label: '3D Grid', description: 'Grid arrangement' },
    { value: 'radial', label: 'Radial', description: 'Around center' },
    { value: 'spiral', label: 'Spiral', description: 'Spiral arrangement' },
    { value: 'random', label: 'Random', description: 'Random scatter' },
    { value: 'fountain', label: 'Fountain', description: 'Emit and fall' },
    { value: 'tornado', label: 'Tornado', description: 'Spiral vortex' },
    { value: 'explosion', label: 'Explosion', description: 'Burst outward' },
    { value: 'orbit', label: 'Orbit', description: 'Orbiting copies' },
    { value: 'matrix', label: 'Matrix', description: 'Matrix falling' },
    { value: 'dna', label: 'DNA', description: 'Double helix' },
    { value: 'kaleidoscope', label: 'Kaleidoscope', description: 'Mirrored copies' },
  ];

  // Lighting presets
  const lightingPresets: { value: Model3DLightingPreset; label: string }[] = [
    { value: 'studio', label: 'Studio (3-Point)' },
    { value: 'dramatic', label: 'Dramatic' },
    { value: 'neon', label: 'Neon Rim' },
    { value: 'sunrise', label: 'Sunrise' },
    { value: 'moonlight', label: 'Moonlight' },
    { value: 'disco', label: 'Disco' },
    { value: 'none', label: 'None (Unlit)' },
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
      alert('Supported formats: GLB, GLTF, OBJ, FBX');
      return;
    }

    showLoading('Loading 3D model...');
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
      console.error('Failed to load 3D model:', err);
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
      scheduleHistorySnapshot();
    }
  }

  // Hands a changed field to the keyframe timeline. autoRecord() itself is a
  // no-op unless the track is armed. Matches SplatPanel's doUpdate pattern —
  // only records when driving the mapping store directly (not in VJ mode,
  // where onUpdate takes over and there's no armed-track concept).
  function recordAutomatable(dotPath: string, value: unknown) {
    if (onUpdate || !layer || typeof value !== 'number') return;
    const descriptor = MODEL3D_AUTOMATABLE_PARAM_MAP.get(dotPath);
    if (descriptor) keyframeTimeline.autoRecord(layer.id, `model3d:${dotPath}`, value, descriptor.label, 'number');
  }

  // Helper to update content (alias for doUpdate for backward compatibility in template)
  function updateContent(updates: Partial<Model3DContent>) {
    doUpdate(updates);
    for (const [key, value] of Object.entries(updates)) {
      recordAutomatable(key, value);
    }
  }

  // Helper to update nested echo config
  function updateEcho(updates: Partial<Model3DContent['echo']>) {
    if (mc) {
      doUpdate({ echo: { ...mc.echo, ...updates } });
      for (const [key, value] of Object.entries(updates)) {
        recordAutomatable(`echo.${key}`, value);
      }
    }
  }

  // Helper to update nested camera config
  function updateCamera(updates: Partial<Model3DContent['camera']>) {
    if (mc) {
      doUpdate({ camera: { ...mc.camera, ...updates } });
      for (const [key, value] of Object.entries(updates)) {
        recordAutomatable(`camera.${key}`, value);
      }
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
      for (const [key, value] of Object.entries(updates)) {
        recordAutomatable(`audio.${key}`, value);
      }
    }
  }

  // RGB to hex
  function rgbToHex(r: number, g: number, b: number): string {
    return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
  }

  // Hex to RGB
  function hexToRgb(hex: string): [number, number, number] {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)]
      : [200, 200, 200];
  }
</script>

{#if (isVJMode ? mc : layer && mc)}
  <div class="model3d-panel" class:compact>
    {#if !compact}<h3>3D Model</h3>{/if}

    <!-- File Loading -->
    <div class="section">
      <label class="section-label">Model File</label>
      <div class="file-row">
        {#if onFileLoad}
          <button class="file-button" onclick={onFileLoad}>Load File</button>
        {:else}
          <input
            type="file"
            accept=".glb,.gltf,.obj,.fbx"
            onchange={handleFileSelect}
            id="model3d-file-input"
          />
          <label for="model3d-file-input" class="file-button">Load Model</label>
        {/if}
        {#if mc.modelData}
          <button
            type="button"
            class="reload-button"
            onclick={reloadModel}
            title="Reload model (use if it disappears after a mode switch)"
            aria-label="Reload model"
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
          <span class="filename">{currentFileName || mc.modelName || 'Loaded Model'}</span>
          <span class="format">{mc.modelFormat.toUpperCase()}</span>
          {#if mc.vertexCount > 0}
            <span class="vertex-count">{mc.vertexCount.toLocaleString()} vertices</span>
            <span class="face-count">{mc.faceCount.toLocaleString()} faces</span>
          {/if}
        </div>
      {:else}
        <p class="hint">Supported: GLB, GLTF, OBJ, FBX</p>
      {/if}
    </div>

    <!-- Material Section -->
    <div class="section collapsible" class:open={showMaterial}>
      <button class="section-header" onclick={() => showMaterial = !showMaterial}>
        <span>Material</span>
        <span class="chevron">{showMaterial ? '−' : '+'}</span>
      </button>
      {#if showMaterial}
        <div class="section-content">
          <div class="property-row">
            <label>Type</label>
            <select
              value={mc.materialType}
              onchange={(e) => updateContent({ materialType: (e.target as HTMLSelectElement).value as Model3DMaterialType })}
              data-midi-path="map:model3d:materialType"
              data-midi-label="Material Type"
              data-midi-min="0"
              data-midi-max="15"
              data-midi-step="1"
              data-midi-discrete="source,standard,wireframe,glass,chrome,hologram,lava,ice,neon,xray,toon,fresnel,dissolve,glitch,normal,depth"
            >
              {#each materialTypes as mat}
                <option value={mat.value} title={mat.description}>{mat.label}</option>
              {/each}
            </select>
          </div>

          <div class="property-row">
            <label>Color</label>
            <input
              type="color"
              value={rgbToHex(mc.materialColor[0], mc.materialColor[1], mc.materialColor[2])}
              oninput={(e) => updateContent({ materialColor: hexToRgb((e.target as HTMLInputElement).value) })}
            />
          </div>

          <div class="property-row">
            <label>Opacity</label>
            <input
              type="range" min="0" max="1" step="0.01"
              value={mc.materialOpacity}
              oninput={(e) => updateContent({ materialOpacity: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:model3d:materialOpacity"
              data-midi-label="Opacity"
              data-midi-min="0"
              data-midi-max="1"
              data-midi-step="0.01"
            />
            <span class="value">{(mc.materialOpacity * 100).toFixed(0)}%</span>
          </div>

          {#if mc.materialType === 'standard'}
            <div class="property-row">
              <label>Roughness</label>
              <input
                type="range" min="0" max="1" step="0.01"
                value={mc.materialRoughness}
                oninput={(e) => updateContent({ materialRoughness: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:materialRoughness"
                data-midi-label="Roughness"
                data-midi-min="0"
                data-midi-max="1"
                data-midi-step="0.01"
              />
              <span class="value">{mc.materialRoughness.toFixed(2)}</span>
            </div>

            <div class="property-row">
              <label>Metalness</label>
              <input
                type="range" min="0" max="1" step="0.01"
                value={mc.materialMetalness}
                oninput={(e) => updateContent({ materialMetalness: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:materialMetalness"
                data-midi-label="Metalness"
                data-midi-min="0"
                data-midi-max="1"
                data-midi-step="0.01"
              />
              <span class="value">{mc.materialMetalness.toFixed(2)}</span>
            </div>

            <div class="property-row">
              <label>Emissive</label>
              <input
                type="color"
                value={rgbToHex(mc.materialEmissive[0], mc.materialEmissive[1], mc.materialEmissive[2])}
                oninput={(e) => updateContent({ materialEmissive: hexToRgb((e.target as HTMLInputElement).value) })}
              />
            </div>

            <div class="property-row">
              <label>Emissive Int.</label>
              <input
                type="range" min="0" max="5" step="0.1"
                value={mc.materialEmissiveIntensity}
                oninput={(e) => updateContent({ materialEmissiveIntensity: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:materialEmissiveIntensity"
                data-midi-label="Emissive Intensity"
                data-midi-min="0"
                data-midi-max="5"
                data-midi-step="0.1"
              />
              <span class="value">{mc.materialEmissiveIntensity.toFixed(1)}</span>
            </div>
          {/if}

          {#if mc.materialType === 'hologram'}
            <div class="property-row">
              <label>Scan Speed</label>
              <input
                type="range" min="0" max="10" step="0.1"
                value={mc.hologramScanSpeed}
                oninput={(e) => updateContent({ hologramScanSpeed: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:hologramScanSpeed"
                data-midi-label="Hologram Scan Speed"
                data-midi-min="0"
                data-midi-max="10"
                data-midi-step="0.1"
              />
              <span class="value">{mc.hologramScanSpeed.toFixed(1)}</span>
            </div>

            <div class="property-row">
              <label>Scan Count</label>
              <input
                type="range" min="5" max="100" step="1"
                value={mc.hologramScanCount}
                oninput={(e) => updateContent({ hologramScanCount: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:hologramScanCount"
                data-midi-label="Hologram Scan Count"
                data-midi-min="5"
                data-midi-max="100"
                data-midi-step="1"
              />
              <span class="value">{mc.hologramScanCount}</span>
            </div>

            <div class="property-row">
              <label>Glitch</label>
              <input
                type="range" min="0" max="1" step="0.01"
                value={mc.hologramGlitchIntensity}
                oninput={(e) => updateContent({ hologramGlitchIntensity: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:hologramGlitchIntensity"
                data-midi-label="Hologram Glitch"
                data-midi-min="0"
                data-midi-max="1"
                data-midi-step="0.01"
              />
              <span class="value">{(mc.hologramGlitchIntensity * 100).toFixed(0)}%</span>
            </div>

            <div class="property-row">
              <label>Rim Color</label>
              <input
                type="color"
                value={rgbToHex(mc.hologramRimColor[0], mc.hologramRimColor[1], mc.hologramRimColor[2])}
                oninput={(e) => updateContent({ hologramRimColor: hexToRgb((e.target as HTMLInputElement).value) })}
              />
            </div>
          {/if}

          {#if mc.materialType === 'lava'}
            <div class="property-row">
              <label>Flow Speed</label>
              <input
                type="range" min="0" max="5" step="0.1"
                value={mc.lavaFlowSpeed}
                oninput={(e) => updateContent({ lavaFlowSpeed: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:lavaFlowSpeed"
                data-midi-label="Lava Flow Speed"
                data-midi-min="0"
                data-midi-max="5"
                data-midi-step="0.1"
              />
              <span class="value">{mc.lavaFlowSpeed.toFixed(1)}</span>
            </div>

            <div class="property-row">
              <label>Crack Int.</label>
              <input
                type="range" min="0" max="2" step="0.1"
                value={mc.lavaCrackIntensity}
                oninput={(e) => updateContent({ lavaCrackIntensity: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:lavaCrackIntensity"
                data-midi-label="Lava Crack Intensity"
                data-midi-min="0"
                data-midi-max="2"
                data-midi-step="0.1"
              />
              <span class="value">{mc.lavaCrackIntensity.toFixed(1)}</span>
            </div>

            <div class="property-row">
              <label>Glow Color</label>
              <input
                type="color"
                value={rgbToHex(mc.lavaGlowColor[0], mc.lavaGlowColor[1], mc.lavaGlowColor[2])}
                oninput={(e) => updateContent({ lavaGlowColor: hexToRgb((e.target as HTMLInputElement).value) })}
              />
            </div>
          {/if}

          {#if mc.materialType === 'glass'}
            <div class="property-row">
              <label>IOR</label>
              <input
                type="range" min="1" max="2.5" step="0.01"
                value={mc.glassIOR}
                oninput={(e) => updateContent({ glassIOR: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:glassIOR"
                data-midi-label="Glass IOR"
                data-midi-min="1"
                data-midi-max="2.5"
                data-midi-step="0.01"
              />
              <span class="value">{mc.glassIOR.toFixed(2)}</span>
            </div>

            <div class="property-row">
              <label>Thickness</label>
              <input
                type="range" min="0" max="2" step="0.1"
                value={mc.glassThickness}
                oninput={(e) => updateContent({ glassThickness: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:glassThickness"
                data-midi-label="Glass Thickness"
                data-midi-min="0"
                data-midi-max="2"
                data-midi-step="0.1"
              />
              <span class="value">{mc.glassThickness.toFixed(1)}</span>
            </div>
          {/if}

          {#if mc.materialType === 'dissolve'}
            <div class="property-row">
              <label>Amount</label>
              <input
                type="range" min="0" max="1" step="0.01"
                value={mc.dissolveAmount}
                oninput={(e) => updateContent({ dissolveAmount: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:dissolveAmount"
                data-midi-label="Dissolve Amount"
                data-midi-min="0"
                data-midi-max="1"
                data-midi-step="0.01"
              />
              <span class="value">{(mc.dissolveAmount * 100).toFixed(0)}%</span>
            </div>

            <div class="property-row">
              <label>Edge Color</label>
              <input
                type="color"
                value={rgbToHex(mc.dissolveEdgeColor[0], mc.dissolveEdgeColor[1], mc.dissolveEdgeColor[2])}
                oninput={(e) => updateContent({ dissolveEdgeColor: hexToRgb((e.target as HTMLInputElement).value) })}
              />
            </div>

            <div class="property-row">
              <label>Edge Width</label>
              <input
                type="range" min="0.01" max="0.2" step="0.01"
                value={mc.dissolveEdgeWidth}
                oninput={(e) => updateContent({ dissolveEdgeWidth: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:dissolveEdgeWidth"
                data-midi-label="Dissolve Edge Width"
                data-midi-min="0.01"
                data-midi-max="0.2"
                data-midi-step="0.01"
              />
              <span class="value">{mc.dissolveEdgeWidth.toFixed(2)}</span>
            </div>
          {/if}

          {#if mc.materialType === 'fresnel'}
            <div class="property-row">
              <label>Power</label>
              <input
                type="range" min="0.5" max="5" step="0.1"
                value={mc.fresnelPower}
                oninput={(e) => updateContent({ fresnelPower: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:fresnelPower"
                data-midi-label="Fresnel Power"
                data-midi-min="0.5"
                data-midi-max="5"
                data-midi-step="0.1"
              />
              <span class="value">{mc.fresnelPower.toFixed(1)}</span>
            </div>

            <div class="property-row">
              <label>Fresnel Color</label>
              <input
                type="color"
                value={rgbToHex(mc.fresnelColor[0], mc.fresnelColor[1], mc.fresnelColor[2])}
                oninput={(e) => updateContent({ fresnelColor: hexToRgb((e.target as HTMLInputElement).value) })}
              />
            </div>
          {/if}

          {#if mc.materialType === 'toon'}
            <div class="property-row">
              <label>Levels</label>
              <input
                type="range" min="2" max="8" step="1"
                value={mc.toonLevels}
                oninput={(e) => updateContent({ toonLevels: parseInt((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:toonLevels"
                data-midi-label="Toon Levels"
                data-midi-min="2"
                data-midi-max="8"
                data-midi-step="1"
              />
              <span class="value">{mc.toonLevels}</span>
            </div>
          {/if}

          {#if mc.materialType === 'chrome'}
            <div class="property-row">
              <label>Reflectivity</label>
              <input
                type="range" min="0" max="2" step="0.1"
                value={mc.chromeReflectivity}
                oninput={(e) => updateContent({ chromeReflectivity: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:chromeReflectivity"
                data-midi-label="Chrome Reflectivity"
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
      <button class="section-header" onclick={() => showWireframe = !showWireframe}>
        <span>Wireframe & Vertices</span>
        <span class="chevron">{showWireframe ? '−' : '+'}</span>
      </button>
      {#if showWireframe}
        <div class="section-content">
          <div class="property-row">
            <label>Wireframe</label>
            <select
              value={mc.wireframeMode}
              onchange={(e) => updateContent({ wireframeMode: (e.target as HTMLSelectElement).value as Model3DWireframeMode })}
              data-midi-path="map:model3d:wireframeMode"
              data-midi-label="Wireframe Mode"
              data-midi-min="0"
              data-midi-max="8"
              data-midi-step="1"
              data-midi-discrete="none,classic,animated,glow,neon,pulse,rainbow,dotted,thick"
            >
              {#each wireframeModes as mode}
                <option value={mode.value}>{mode.label}</option>
              {/each}
            </select>
          </div>

          {#if mc.wireframeMode !== 'none'}
            <div class="property-row">
              <label>Color</label>
              <input
                type="color"
                value={rgbToHex(mc.wireframeColor[0], mc.wireframeColor[1], mc.wireframeColor[2])}
                onchange={(e) => updateContent({ wireframeColor: hexToRgb((e.target as HTMLInputElement).value) })}
              />
            </div>

            <div class="property-row">
              <label>Opacity</label>
              <input
                type="range" min="0" max="1" step="0.01"
                value={mc.wireframeOpacity}
                oninput={(e) => updateContent({ wireframeOpacity: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:wireframeOpacity"
                data-midi-label="Wireframe Opacity"
                data-midi-min="0"
                data-midi-max="1"
                data-midi-step="0.01"
              />
              <span class="value">{(mc.wireframeOpacity * 100).toFixed(0)}%</span>
            </div>

            <div class="property-row">
              <label>Thickness</label>
              <input
                type="range" min="0.5" max="5" step="0.1"
                value={mc.wireframeThickness}
                oninput={(e) => updateContent({ wireframeThickness: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:wireframeThickness"
                data-midi-label="Wireframe Thickness"
                data-midi-min="0.5"
                data-midi-max="5"
                data-midi-step="0.1"
              />
              <span class="value">{mc.wireframeThickness.toFixed(1)}</span>
            </div>

            {#if mc.wireframeMode === 'animated' || mc.wireframeMode === 'pulse' || mc.wireframeMode === 'rainbow' || mc.wireframeMode === 'dotted'}
              <div class="property-row">
                <label>Anim Speed</label>
                <input
                  type="range" min="0" max="5" step="0.1"
                  value={mc.wireframeAnimSpeed}
                  oninput={(e) => updateContent({ wireframeAnimSpeed: parseFloat((e.target as HTMLInputElement).value) })}
                  data-midi-path="map:model3d:wireframeAnimSpeed"
                  data-midi-label="Wireframe Anim Speed"
                  data-midi-min="0"
                  data-midi-max="5"
                  data-midi-step="0.1"
                />
                <span class="value">{mc.wireframeAnimSpeed.toFixed(1)}</span>
              </div>
            {/if}
          {/if}

          <div class="property-row">
            <label>Vertices</label>
            <select
              value={mc.vertexDecoration}
              onchange={(e) => updateContent({ vertexDecoration: (e.target as HTMLSelectElement).value as Model3DVertexDecoration })}
              data-midi-path="map:model3d:vertexDecoration"
              data-midi-label="Vertex Decoration"
              data-midi-min="0"
              data-midi-max="6"
              data-midi-step="1"
              data-midi-discrete="none,spheres,cubes,pyramids,points,stars,diamonds"
            >
              {#each vertexDecorations as deco}
                <option value={deco.value}>{deco.label}</option>
              {/each}
            </select>
          </div>

          {#if mc.vertexDecoration !== 'none'}
            <div class="property-row">
              <label>Size</label>
              <input
                type="range" min="0.001" max="0.2" step="0.001"
                value={mc.vertexDecorationSize}
                oninput={(e) => updateContent({ vertexDecorationSize: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:vertexDecorationSize"
                data-midi-label="Vertex Size"
                data-midi-min="0.001"
                data-midi-max="0.2"
                data-midi-step="0.001"
              />
              <span class="value">{mc.vertexDecorationSize.toFixed(3)}</span>
            </div>

            <div class="property-row">
              <label>Color</label>
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
      <button class="section-header" onclick={() => showDeformation = !showDeformation}>
        <span>Deformation</span>
        <span class="chevron">{showDeformation ? '−' : '+'}</span>
      </button>
      {#if showDeformation}
        <div class="section-content">
          <div class="property-row">
            <label>Type</label>
            <select
              value={mc.deformationType}
              onchange={(e) => updateContent({ deformationType: (e.target as HTMLSelectElement).value as Model3DDeformationType })}
              data-midi-path="map:model3d:deformationType"
              data-midi-label="Deformation Type"
              data-midi-min="0"
              data-midi-max="14"
              data-midi-step="1"
              data-midi-discrete="none,noise,wave,twist,bend,taper,spherify,inflate,explode,implode,shatter,melt,pixelate,jelly,breathe"
            >
              {#each deformationTypes as def}
                <option value={def.value} title={def.description}>{def.label}</option>
              {/each}
            </select>
          </div>

          {#if mc.deformationType !== 'none'}
            <div class="property-row">
              <label>Intensity</label>
              <input
                type="range" min="0" max="2" step="0.01"
                value={mc.deformationIntensity}
                oninput={(e) => updateContent({ deformationIntensity: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:deformationIntensity"
                data-midi-label="Deformation Intensity"
                data-midi-min="0"
                data-midi-max="2"
                data-midi-step="0.01"
              />
              <span class="value">{mc.deformationIntensity.toFixed(2)}</span>
            </div>

            <div class="property-row">
              <label>Speed</label>
              <input
                type="range" min="0" max="5" step="0.1"
                value={mc.deformationSpeed}
                oninput={(e) => updateContent({ deformationSpeed: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:deformationSpeed"
                data-midi-label="Deformation Speed"
                data-midi-min="0"
                data-midi-max="5"
                data-midi-step="0.1"
              />
              <span class="value">{mc.deformationSpeed.toFixed(1)}</span>
            </div>

            <div class="property-row">
              <label>Scale</label>
              <input
                type="range" min="0.1" max="10" step="0.1"
                value={mc.deformationScale}
                oninput={(e) => updateContent({ deformationScale: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:deformationScale"
                data-midi-label="Deformation Scale"
                data-midi-min="0.1"
                data-midi-max="10"
                data-midi-step="0.1"
              />
              <span class="value">{mc.deformationScale.toFixed(1)}</span>
            </div>

            <div class="property-row">
              <label>Spread</label>
              <input
                type="range" min="0" max="6" step="0.05"
                value={mc.deformationSpread ?? 1}
                oninput={(e) => updateContent({ deformationSpread: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:deformationSpread"
                data-midi-label="Deformation Spread"
                data-midi-min="0"
                data-midi-max="6"
                data-midi-step="0.05"
              />
              <span class="value">{(mc.deformationSpread ?? 1).toFixed(2)}</span>
            </div>

            <div class="property-row">
              <label>Axis</label>
              <select
                value={mc.deformationAxis}
                onchange={(e) => updateContent({ deformationAxis: (e.target as HTMLSelectElement).value as any })}
                data-midi-path="map:model3d:deformationAxis"
                data-midi-label="Deformation Axis"
                data-midi-min="0"
                data-midi-max="3"
                data-midi-step="1"
                data-midi-discrete="all,x,y,z"
              >
                <option value="all">All</option>
                <option value="x">X Only</option>
                <option value="y">Y Only</option>
                <option value="z">Z Only</option>
              </select>
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Animation Section -->
    <div class="section collapsible" class:open={showAnimation}>
      <button class="section-header" onclick={() => showAnimation = !showAnimation}>
        <span>Animation</span>
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
                  data-midi-label="Play File Animation"
                  data-midi-mode="toggle"
                />
                Play File Animation
              </label>
            </div>
            {#if mc.useFileAnimation !== false}
              <div class="property-row">
                <label>Playback Speed</label>
                <input
                  type="range" min="0" max="5" step="0.1"
                  value={mc.fileAnimationSpeed ?? 1}
                  oninput={(e) => updateContent({ fileAnimationSpeed: parseFloat((e.target as HTMLInputElement).value) })}
                  data-midi-path="map:model3d:fileAnimationSpeed"
                  data-midi-label="File Anim Speed"
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
            <label>Type</label>
            <select
              value={mc.animationType}
              onchange={(e) => updateContent({ animationType: (e.target as HTMLSelectElement).value as Model3DAnimationType })}
              data-midi-path="map:model3d:animationType"
              data-midi-label="Animation Type"
              data-midi-min="0"
              data-midi-max="15"
              data-midi-step="1"
              data-midi-discrete="none,rotate,orbit,bounce,swing,float,shake,spiral,fadeIn,scaleIn,unfold,assemble,grow,morphLoop,colorCycle,texturePan"
            >
              {#each animationTypes as anim}
                <option value={anim.value} title={anim.description}>{anim.label}</option>
              {/each}
            </select>
          </div>

          {#if mc.animationType !== 'none'}
            <div class="property-row">
              <label>Speed</label>
              <input
                type="range" min="0" max="5" step="0.1"
                value={mc.animationSpeed}
                oninput={(e) => updateContent({ animationSpeed: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:animationSpeed"
                data-midi-label="Animation Speed"
                data-midi-min="0"
                data-midi-max="5"
                data-midi-step="0.1"
              />
              <span class="value">{mc.animationSpeed.toFixed(1)}</span>
            </div>

            <div class="property-row">
              <label>Intensity</label>
              <input
                type="range" min="0" max="2" step="0.1"
                value={mc.animationIntensity}
                oninput={(e) => updateContent({ animationIntensity: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:animationIntensity"
                data-midi-label="Animation Intensity"
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
                  data-midi-label="Loop Animation"
                  data-midi-mode="toggle"
                />
                Loop Animation
              </label>
            </div>

            {#if !mc.animationLoop}
              <div class="property-row">
                <label>Progress</label>
                <input
                  type="range" min="0" max="1" step="0.01"
                  value={mc.animationProgress}
                  oninput={(e) => updateContent({ animationProgress: parseFloat((e.target as HTMLInputElement).value) })}
                  data-midi-path="map:model3d:animationProgress"
                  data-midi-label="Animation Progress"
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
      <button class="section-header" onclick={() => showEcho = !showEcho}>
        <span>Echo / Instancing</span>
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
                ...(enabled && mc.echo.type === 'none' ? { type: 'ghostTrail' } : {})
              });
            }}
                data-midi-path="map:model3d:echo.enabled"
                data-midi-label="Enable Echo"
                data-midi-mode="toggle"
              />
              Enable Echo
            </label>
          </div>

          {#if mc.echo.enabled}
            <div class="property-row">
              <label>Type</label>
              <select
                value={mc.echo.type}
                onchange={(e) => updateEcho({ type: (e.target as HTMLSelectElement).value as Model3DEchoType })}
                data-midi-path="map:model3d:echo.type"
                data-midi-label="Echo Type"
                data-midi-min="0"
                data-midi-max="14"
                data-midi-step="1"
                data-midi-discrete="none,ghostTrail,stream,swarm,grid,radial,spiral,random,fountain,tornado,explosion,orbit,matrix,dna,kaleidoscope"
              >
                {#each echoTypes as echo}
                  <option value={echo.value} title={echo.description}>{echo.label}</option>
                {/each}
              </select>
            </div>

            {#if mc.echo.type !== 'none'}
              <div class="property-row">
                <label>Count</label>
                <input
                  type="range" min="1" max="50" step="1"
                  value={mc.echo.count}
                  oninput={(e) => updateEcho({ count: parseInt((e.target as HTMLInputElement).value) })}
                  data-midi-path="map:model3d:echo.count"
                  data-midi-label="Echo Count"
                  data-midi-min="1"
                  data-midi-max="50"
                  data-midi-step="1"
                />
                <span class="value">{mc.echo.count}</span>
              </div>

              <div class="property-row">
                <label>Spacing</label>
                <input
                  type="range" min="0.1" max="3" step="0.1"
                  value={mc.echo.spacing}
                  oninput={(e) => updateEcho({ spacing: parseFloat((e.target as HTMLInputElement).value) })}
                  data-midi-path="map:model3d:echo.spacing"
                  data-midi-label="Echo Spacing"
                  data-midi-min="0.1"
                  data-midi-max="3"
                  data-midi-step="0.1"
                />
                <span class="value">{mc.echo.spacing.toFixed(1)}</span>
              </div>

              <div class="property-row">
                <label>Fade Rate</label>
                <input
                  type="range" min="0" max="1" step="0.01"
                  value={mc.echo.fadeRate}
                  oninput={(e) => updateEcho({ fadeRate: parseFloat((e.target as HTMLInputElement).value) })}
                  data-midi-path="map:model3d:echo.fadeRate"
                  data-midi-label="Echo Fade Rate"
                  data-midi-min="0"
                  data-midi-max="1"
                  data-midi-step="0.01"
                />
                <span class="value">{mc.echo.fadeRate.toFixed(2)}</span>
              </div>

              <div class="property-row">
                <label>Scale Var.</label>
                <input
                  type="range" min="0" max="1" step="0.01"
                  value={mc.echo.scaleVariation}
                  oninput={(e) => updateEcho({ scaleVariation: parseFloat((e.target as HTMLInputElement).value) })}
                  data-midi-path="map:model3d:echo.scaleVariation"
                  data-midi-label="Echo Scale Variation"
                  data-midi-min="0"
                  data-midi-max="1"
                  data-midi-step="0.01"
                />
                <span class="value">{mc.echo.scaleVariation.toFixed(2)}</span>
              </div>

              <div class="property-row">
                <label>Rotation Var.</label>
                <input
                  type="range" min="0" max="1" step="0.01"
                  value={mc.echo.rotationVariation}
                  oninput={(e) => updateEcho({ rotationVariation: parseFloat((e.target as HTMLInputElement).value) })}
                  data-midi-path="map:model3d:echo.rotationVariation"
                  data-midi-label="Echo Rotation Variation"
                  data-midi-min="0"
                  data-midi-max="1"
                  data-midi-step="0.01"
                />
                <span class="value">{mc.echo.rotationVariation.toFixed(2)}</span>
              </div>

              <div class="property-row">
                <label>Color Var.</label>
                <input
                  type="range" min="0" max="1" step="0.01"
                  value={mc.echo.colorVariation}
                  oninput={(e) => updateEcho({ colorVariation: parseFloat((e.target as HTMLInputElement).value) })}
                  data-midi-path="map:model3d:echo.colorVariation"
                  data-midi-label="Echo Color Variation"
                  data-midi-min="0"
                  data-midi-max="1"
                  data-midi-step="0.01"
                />
                <span class="value">{mc.echo.colorVariation.toFixed(2)}</span>
              </div>

              <div class="property-row">
                <label>Speed</label>
                <input
                  type="range" min="0" max="5" step="0.1"
                  value={mc.echo.speed}
                  oninput={(e) => updateEcho({ speed: parseFloat((e.target as HTMLInputElement).value) })}
                  data-midi-path="map:model3d:echo.speed"
                  data-midi-label="Echo Speed"
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
      <button class="section-header" onclick={() => showTransform = !showTransform}>
        <span>Transform</span>
        <span class="chevron">{showTransform ? '−' : '+'}</span>
      </button>
      {#if showTransform}
        <div class="section-content">
          <div class="property-row">
            <label>Scale</label>
            <input
              type="range" min="0.1" max="5" step="0.1"
              value={mc.scaleUniform}
              oninput={(e) => updateContent({ scaleUniform: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:model3d:scaleUniform"
              data-midi-label="Scale"
              data-midi-min="0.1"
              data-midi-max="5"
              data-midi-step="0.1"
            />
            <span class="value">{mc.scaleUniform.toFixed(1)}</span>
          </div>

          <div class="property-row">
            <label>Rotation X</label>
            <input
              type="range" min="-180" max="180" step="1"
              value={mc.rotationX}
              oninput={(e) => updateContent({ rotationX: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:model3d:rotationX"
              data-midi-label="Rotation X"
              data-midi-min="-180"
              data-midi-max="180"
              data-midi-step="1"
            />
            <span class="value">{mc.rotationX.toFixed(0)}°</span>
          </div>

          <div class="property-row">
            <label>Rotation Y</label>
            <input
              type="range" min="-180" max="180" step="1"
              value={mc.rotationY}
              oninput={(e) => updateContent({ rotationY: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:model3d:rotationY"
              data-midi-label="Rotation Y"
              data-midi-min="-180"
              data-midi-max="180"
              data-midi-step="1"
            />
            <span class="value">{mc.rotationY.toFixed(0)}°</span>
          </div>

          <div class="property-row">
            <label>Rotation Z</label>
            <input
              type="range" min="-180" max="180" step="1"
              value={mc.rotationZ}
              oninput={(e) => updateContent({ rotationZ: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:model3d:rotationZ"
              data-midi-label="Rotation Z"
              data-midi-min="-180"
              data-midi-max="180"
              data-midi-step="1"
            />
            <span class="value">{mc.rotationZ.toFixed(0)}°</span>
          </div>

          <div class="property-row">
            <label>Position X</label>
            <input
              type="range" min="-5" max="5" step="0.1"
              value={mc.positionX}
              oninput={(e) => updateContent({ positionX: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:model3d:positionX"
              data-midi-label="Position X"
              data-midi-min="-5"
              data-midi-max="5"
              data-midi-step="0.1"
            />
            <span class="value">{mc.positionX.toFixed(1)}</span>
          </div>

          <div class="property-row">
            <label>Position Y</label>
            <input
              type="range" min="-5" max="5" step="0.1"
              value={mc.positionY}
              oninput={(e) => updateContent({ positionY: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:model3d:positionY"
              data-midi-label="Position Y"
              data-midi-min="-5"
              data-midi-max="5"
              data-midi-step="0.1"
            />
            <span class="value">{mc.positionY.toFixed(1)}</span>
          </div>

          <div class="property-row">
            <label>Position Z</label>
            <input
              type="range" min="-5" max="5" step="0.1"
              value={mc.positionZ}
              oninput={(e) => updateContent({ positionZ: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:model3d:positionZ"
              data-midi-label="Position Z"
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
      <button class="section-header" onclick={() => showCamera = !showCamera}>
        <span>Camera</span>
        <span class="chevron">{showCamera ? '−' : '+'}</span>
      </button>
      {#if showCamera}
        <div class="section-content">
          <div class="button-row">
            <button class="secondary-button" type="button" onclick={frameCamera}>Frame Model</button>
            <button class="secondary-button" type="button" onclick={resetModelTransform}>Reset Model</button>
          </div>

          <div class="property-row checkbox">
            <label>
              <input
                type="checkbox"
                checked={mc.camera.autoRotate}
                onchange={(e) => updateCamera({ autoRotate: (e.target as HTMLInputElement).checked })}
                data-midi-path="map:model3d:camera.autoRotate"
                data-midi-label="Auto Rotate"
                data-midi-mode="toggle"
              />
              Auto Rotate
            </label>
          </div>

          {#if mc.camera.autoRotate}
            <div class="property-row">
              <label>Rotate Speed</label>
              <input
                type="range" min="0" max="5" step="0.1"
                value={mc.camera.rotateSpeed}
                oninput={(e) => updateCamera({ rotateSpeed: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:camera.rotateSpeed"
                data-midi-label="Rotate Speed"
                data-midi-min="0"
                data-midi-max="5"
                data-midi-step="0.1"
              />
              <span class="value">{mc.camera.rotateSpeed.toFixed(1)}</span>
            </div>
          {/if}

          <div class="property-row">
            <label>Distance</label>
            <input
              type="range" min="1" max="20" step="0.1"
              value={mc.camera.distance}
              oninput={(e) => updateCamera({ distance: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:model3d:camera.distance"
              data-midi-label="Camera Distance"
              data-midi-min="1"
              data-midi-max="20"
              data-midi-step="0.1"
            />
            <span class="value">{mc.camera.distance.toFixed(1)}</span>
          </div>

          <div class="property-row">
            <label>FOV</label>
            <input
              type="range" min="20" max="120" step="1"
              value={mc.camera.fov}
              oninput={(e) => updateCamera({ fov: parseInt((e.target as HTMLInputElement).value) })}
              data-midi-path="map:model3d:camera.fov"
              data-midi-label="Camera FOV"
              data-midi-min="20"
              data-midi-max="120"
              data-midi-step="1"
            />
            <span class="value">{mc.camera.fov}°</span>
          </div>

          <div class="property-row">
            <label>Orbit X</label>
            <input
              type="range" min="-90" max="90" step="1"
              value={mc.camera.orbitX}
              oninput={(e) => updateCamera({ orbitX: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:model3d:camera.orbitX"
              data-midi-label="Camera Orbit X"
              data-midi-min="-90"
              data-midi-max="90"
              data-midi-step="1"
            />
            <span class="value">{mc.camera.orbitX.toFixed(0)}°</span>
          </div>

          <div class="property-row">
            <label>Orbit Y</label>
            <input
              type="range" min="-180" max="180" step="1"
              value={mc.camera.orbitY}
              oninput={(e) => updateCamera({ orbitY: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:model3d:camera.orbitY"
              data-midi-label="Camera Orbit Y"
              data-midi-min="-180"
              data-midi-max="180"
              data-midi-step="1"
            />
            <span class="value">{mc.camera.orbitY.toFixed(0)}°</span>
          </div>

          <div class="property-row">
            <label>Roll</label>
            <input
              type="range" min="-180" max="180" step="1"
              value={mc.camera.roll}
              oninput={(e) => updateCamera({ roll: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:model3d:camera.roll"
              data-midi-label="Camera Roll"
              data-midi-min="-180"
              data-midi-max="180"
              data-midi-step="1"
            />
            <span class="value">{mc.camera.roll.toFixed(0)}°</span>
          </div>

          <div class="property-row">
            <label>Pan X</label>
            <input
              type="range" min="-5" max="5" step="0.1"
              value={mc.camera.panX}
              oninput={(e) => updateCamera({ panX: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:model3d:camera.panX"
              data-midi-label="Camera Pan X"
              data-midi-min="-5"
              data-midi-max="5"
              data-midi-step="0.1"
            />
            <span class="value">{mc.camera.panX.toFixed(1)}</span>
          </div>

          <div class="property-row">
            <label>Pan Y</label>
            <input
              type="range" min="-5" max="5" step="0.1"
              value={mc.camera.panY}
              oninput={(e) => updateCamera({ panY: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:model3d:camera.panY"
              data-midi-label="Camera Pan Y"
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
      <button class="section-header" onclick={() => showLighting = !showLighting}>
        <span>Lighting</span>
        <span class="chevron">{showLighting ? '−' : '+'}</span>
      </button>
      {#if showLighting}
        <div class="section-content">
          <div class="property-row">
            <label>Preset</label>
            <select
              value={mc.lightingPreset}
              onchange={(e) => updateContent({ lightingPreset: (e.target as HTMLSelectElement).value as Model3DLightingPreset })}
              data-midi-path="map:model3d:lightingPreset"
              data-midi-label="Lighting Preset"
              data-midi-min="0"
              data-midi-max="6"
              data-midi-step="1"
              data-midi-discrete="studio,dramatic,neon,sunrise,moonlight,disco,none"
            >
              {#each lightingPresets as preset}
                <option value={preset.value}>{preset.label}</option>
              {/each}
            </select>
          </div>

          <span class="subsection-label">Environment</span>

          <div class="property-row checkbox">
            <label>
              <input
                type="checkbox"
                checked={mc.environmentEnabled ?? true}
                onchange={(e) => updateContent({ environmentEnabled: (e.target as HTMLInputElement).checked })}
                data-midi-path="map:model3d:environmentEnabled"
                data-midi-label="Environment Lighting"
                data-midi-mode="toggle"
              />
              Environment Light
            </label>
          </div>

          <div class="property-row">
            <label>Environment</label>
            <input
              type="range" min="0" max="3" step="0.05"
              value={mc.environmentIntensity ?? 1}
              oninput={(e) => updateContent({ environmentIntensity: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:model3d:environmentIntensity"
              data-midi-label="Environment Intensity"
              data-midi-min="0"
              data-midi-max="3"
              data-midi-step="0.05"
            />
            <span class="value">{(mc.environmentIntensity ?? 1).toFixed(2)}</span>
          </div>

          <div class="property-row">
            <label>Exposure</label>
            <input
              type="range" min="0.1" max="3" step="0.05"
              value={mc.toneMappingExposure ?? 1}
              oninput={(e) => updateContent({ toneMappingExposure: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:model3d:toneMappingExposure"
              data-midi-label="Scene Exposure"
              data-midi-min="0.1"
              data-midi-max="3"
              data-midi-step="0.05"
            />
            <span class="value">{(mc.toneMappingExposure ?? 1).toFixed(2)}</span>
          </div>

          <div class="property-row">
            <label>Background</label>
            <select
              value={mc.backgroundMode ?? 'transparent'}
              onchange={(e) => updateContent({ backgroundMode: (e.target as HTMLSelectElement).value as Model3DContent['backgroundMode'] })}
            >
              <option value="transparent">Transparent</option>
              <option value="color">Solid Color</option>
              <option value="environment">Environment</option>
            </select>
          </div>

          {#if (mc.backgroundMode ?? 'transparent') === 'color'}
            <div class="property-row">
              <label>BG Color</label>
              <input
                type="color"
                value={rgbToHex(...(mc.backgroundColor ?? [8, 8, 12]))}
                onchange={(e) => updateContent({ backgroundColor: hexToRgb((e.target as HTMLInputElement).value) })}
              />
            </div>
          {/if}

          {#if (mc.backgroundMode ?? 'transparent') !== 'transparent'}
            <div class="property-row">
              <label>BG Opacity</label>
              <input
                type="range" min="0" max="1" step="0.01"
                value={mc.backgroundOpacity ?? 1}
                oninput={(e) => updateContent({ backgroundOpacity: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:backgroundOpacity"
                data-midi-label="Background Opacity"
                data-midi-min="0"
                data-midi-max="1"
                data-midi-step="0.01"
              />
              <span class="value">{Math.round((mc.backgroundOpacity ?? 1) * 100)}%</span>
            </div>
          {/if}

          <div class="section-divider"></div>
          <span class="subsection-label">Key / Fill / Rim</span>

          <div class="property-row">
            <label>Ambient</label>
            <input
              type="range" min="0" max="2" step="0.1"
              value={mc.ambientIntensity}
              oninput={(e) => updateContent({ ambientIntensity: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:model3d:ambientIntensity"
              data-midi-label="Ambient Intensity"
              data-midi-min="0"
              data-midi-max="2"
              data-midi-step="0.1"
            />
            <span class="value">{mc.ambientIntensity.toFixed(1)}</span>
          </div>

          <div class="property-row">
            <label>Key Power</label>
            <input
              type="range" min="0" max="3" step="0.1"
              value={mc.directionalIntensity}
              oninput={(e) => updateContent({ directionalIntensity: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:model3d:directionalIntensity"
              data-midi-label="Directional Intensity"
              data-midi-min="0"
              data-midi-max="3"
              data-midi-step="0.1"
            />
            <span class="value">{mc.directionalIntensity.toFixed(1)}</span>
          </div>

          <div class="property-row">
            <label>Key Color</label>
            <input
              type="color"
              value={rgbToHex(mc.lightColor[0], mc.lightColor[1], mc.lightColor[2])}
              onchange={(e) => updateContent({ lightColor: hexToRgb((e.target as HTMLInputElement).value) })}
            />
          </div>

          <div class="property-row">
            <label>Key Azimuth</label>
            <input
              type="range" min="-180" max="180" step="1"
              value={mc.keyLightAzimuth ?? 45}
              oninput={(e) => updateContent({ keyLightAzimuth: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:model3d:keyLightAzimuth"
              data-midi-label="Key Light Azimuth"
              data-midi-min="-180"
              data-midi-max="180"
              data-midi-step="1"
            />
            <span class="value">{(mc.keyLightAzimuth ?? 45).toFixed(0)}°</span>
          </div>

          <div class="property-row">
            <label>Key Elevation</label>
            <input
              type="range" min="-10" max="90" step="1"
              value={mc.keyLightElevation ?? 50}
              oninput={(e) => updateContent({ keyLightElevation: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:model3d:keyLightElevation"
              data-midi-label="Key Light Elevation"
              data-midi-min="-10"
              data-midi-max="90"
              data-midi-step="1"
            />
            <span class="value">{(mc.keyLightElevation ?? 50).toFixed(0)}°</span>
          </div>

          <div class="property-row">
            <label>Fill Power</label>
            <input
              type="range" min="0" max="3" step="0.05"
              value={mc.fillIntensity ?? 0.35}
              oninput={(e) => updateContent({ fillIntensity: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:model3d:fillIntensity"
              data-midi-label="Fill Light Intensity"
              data-midi-min="0"
              data-midi-max="3"
              data-midi-step="0.05"
            />
            <span class="value">{(mc.fillIntensity ?? 0.35).toFixed(2)}</span>
          </div>

          <div class="property-row">
            <label>Rim Power</label>
            <input
              type="range" min="0" max="3" step="0.05"
              value={mc.rimIntensity ?? 0.4}
              oninput={(e) => updateContent({ rimIntensity: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:model3d:rimIntensity"
              data-midi-label="Rim Light Intensity"
              data-midi-min="0"
              data-midi-max="3"
              data-midi-step="0.05"
            />
            <span class="value">{(mc.rimIntensity ?? 0.4).toFixed(2)}</span>
          </div>

          <div class="property-row">
            <label>Rim Color</label>
            <input
              type="color"
              value={rgbToHex(...(mc.rimColor ?? [120, 180, 255]))}
              onchange={(e) => updateContent({ rimColor: hexToRgb((e.target as HTMLInputElement).value) })}
            />
          </div>

          <div class="section-divider"></div>
          <span class="subsection-label">Shadows</span>

          <div class="property-row checkbox">
            <label>
              <input
                type="checkbox"
                checked={mc.shadowsEnabled ?? true}
                onchange={(e) => updateContent({ shadowsEnabled: (e.target as HTMLInputElement).checked })}
                data-midi-path="map:model3d:shadowsEnabled"
                data-midi-label="Model Shadows"
                data-midi-mode="toggle"
              />
              Enable Shadows
            </label>
          </div>

          {#if mc.shadowsEnabled ?? true}
            <div class="property-row">
              <label>Quality</label>
              <select
                value={mc.shadowQuality ?? 'medium'}
                onchange={(e) => updateContent({ shadowQuality: (e.target as HTMLSelectElement).value as Model3DContent['shadowQuality'] })}
              >
                <option value="low">Low (512)</option>
                <option value="medium">Medium (1024)</option>
                <option value="high">High (2048)</option>
              </select>
            </div>

            <div class="property-row">
              <label>Softness</label>
              <input
                type="range" min="0" max="4" step="0.1"
                value={mc.shadowSoftness ?? 1}
                oninput={(e) => updateContent({ shadowSoftness: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:shadowSoftness"
                data-midi-label="Shadow Softness"
                data-midi-min="0"
                data-midi-max="4"
                data-midi-step="0.1"
              />
              <span class="value">{(mc.shadowSoftness ?? 1).toFixed(1)}</span>
            </div>

            <div class="property-row">
              <label>Bias</label>
              <input
                type="range" min="-0.01" max="0.01" step="0.0001"
                value={mc.shadowBias ?? -0.0005}
                oninput={(e) => updateContent({ shadowBias: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:shadowBias"
                data-midi-label="Shadow Bias"
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
      <button class="section-header" onclick={() => showAudio = !showAudio}>
        <span>Audio Reactivity</span>
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
                data-midi-label="Audio React"
                data-midi-mode="toggle"
                data-midi-min="0"
                data-midi-max="1"
              />
              Enable Audio
            </label>
          </div>

          {#if mc.audio.enabled}
            <div class="property-row">
              <label>Band</label>
              <select
                value={mc.audio.audioBand}
                onchange={(e) => updateAudio({ audioBand: (e.target as HTMLSelectElement).value as any })}
                data-midi-path="map:model3d:audio.audioBand"
                data-midi-label="Audio Band"
                data-midi-min="0"
                data-midi-max="6"
                data-midi-step="1"
                data-midi-discrete="all,sub,bass,lowMid,mid,highMid,high"
              >
                <option value="all">All Frequencies</option>
                <option value="sub">Sub Bass</option>
                <option value="bass">Bass</option>
                <option value="lowMid">Low Mid</option>
                <option value="mid">Mid</option>
                <option value="highMid">High Mid</option>
                <option value="high">High</option>
              </select>
            </div>

            <div class="property-row">
              <label>Scale</label>
              <input
                type="range" min="0" max="1" step="0.01"
                value={mc.audio.scaleResponse}
                oninput={(e) => updateAudio({ scaleResponse: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:audio.scaleResponse"
                data-midi-label="Audio Scale Response"
                data-midi-min="0"
                data-midi-max="1"
                data-midi-step="0.01"
              />
              <span class="value">{(mc.audio.scaleResponse * 100).toFixed(0)}%</span>
            </div>

            <div class="property-row">
              <label>Rotation</label>
              <input
                type="range" min="0" max="1" step="0.01"
                value={mc.audio.rotationResponse}
                oninput={(e) => updateAudio({ rotationResponse: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:audio.rotationResponse"
                data-midi-label="Audio Rotation Response"
                data-midi-min="0"
                data-midi-max="1"
                data-midi-step="0.01"
              />
              <span class="value">{(mc.audio.rotationResponse * 100).toFixed(0)}%</span>
            </div>

            <div class="property-row">
              <label>Deform</label>
              <input
                type="range" min="0" max="1" step="0.01"
                value={mc.audio.deformResponse}
                oninput={(e) => updateAudio({ deformResponse: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:audio.deformResponse"
                data-midi-label="Audio Deform Response"
                data-midi-min="0"
                data-midi-max="1"
                data-midi-step="0.01"
              />
              <span class="value">{(mc.audio.deformResponse * 100).toFixed(0)}%</span>
            </div>

            <div class="property-row">
              <label>Color</label>
              <input
                type="range" min="0" max="1" step="0.01"
                value={mc.audio.colorResponse}
                oninput={(e) => updateAudio({ colorResponse: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:audio.colorResponse"
                data-midi-label="Audio Color Response"
                data-midi-min="0"
                data-midi-max="1"
                data-midi-step="0.01"
              />
              <span class="value">{(mc.audio.colorResponse * 100).toFixed(0)}%</span>
            </div>

            <div class="property-row">
              <label>Emissive</label>
              <input
                type="range" min="0" max="1" step="0.01"
                value={mc.audio.emissiveResponse}
                oninput={(e) => updateAudio({ emissiveResponse: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:model3d:audio.emissiveResponse"
                data-midi-label="Audio Emissive Response"
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
      <button class="section-header" onclick={() => showBeatSync = !showBeatSync}>
        <span>Beat Sync</span>
        <span class="chevron">{showBeatSync ? '−' : '+'}</span>
      </button>
      {#if showBeatSync}
        <div class="section-content">
          <div class="property-row">
            <label>Beat Scale</label>
            <input
              type="range" min="0" max="1" step="0.01"
              value={mc.beatScale}
              oninput={(e) => updateContent({ beatScale: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:model3d:beatScale"
              data-midi-label="Beat Scale"
              data-midi-min="0"
              data-midi-max="1"
              data-midi-step="0.01"
            />
            <span class="value">{(mc.beatScale * 100).toFixed(0)}%</span>
          </div>

          <div class="property-row">
            <label>Beat Rotate</label>
            <input
              type="range" min="0" max="1" step="0.01"
              value={mc.beatRotate}
              oninput={(e) => updateContent({ beatRotate: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:model3d:beatRotate"
              data-midi-label="Beat Rotate"
              data-midi-min="0"
              data-midi-max="1"
              data-midi-step="0.01"
            />
            <span class="value">{(mc.beatRotate * 100).toFixed(0)}%</span>
          </div>

          <div class="property-row">
            <label>Beat Explode</label>
            <input
              type="range" min="0" max="1" step="0.01"
              value={mc.beatExplode}
              oninput={(e) => updateContent({ beatExplode: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:model3d:beatExplode"
              data-midi-label="Beat Explode"
              data-midi-min="0"
              data-midi-max="1"
              data-midi-step="0.01"
            />
            <span class="value">{(mc.beatExplode * 100).toFixed(0)}%</span>
          </div>

          <div class="property-row">
            <label>Color Flash</label>
            <input
              type="range" min="0" max="1" step="0.01"
              value={mc.beatColorFlash}
              oninput={(e) => updateContent({ beatColorFlash: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:model3d:beatColorFlash"
              data-midi-label="Beat Flash"
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
    <p>Select a 3D model layer to edit its properties</p>
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
    color: var(--accent-primary, #BB86FC);
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
    border-color: var(--accent-primary, #BB86FC);
    color: var(--accent-primary, #BB86FC);
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

  .property-row input[type="range"] {
    flex: 1;
    height: 6px;
    background: #000000;
    border-radius: 3px;
    -webkit-appearance: none;
    cursor: pointer;
  }

  .property-row input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 14px;
    height: 14px;
    background: var(--accent-primary, #BB86FC);
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

  .property-row input[type="color"] {
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
    color: var(--accent-primary, #BB86FC);
    font-size: 11px;
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
  }

  .property-row.checkbox label {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    color: var(--text-primary, #e0e0e0);
  }

  .property-row.checkbox input[type="checkbox"] {
    width: 14px;
    height: 14px;
    cursor: pointer;
  }

  .file-row {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .file-row input[type="file"] {
    display: none;
  }

  .file-button {
    padding: 6px 12px;
    background: var(--accent-primary, #BB86FC);
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
    color: var(--accent-primary, #BB86FC);
    border-color: var(--accent-primary, #BB86FC);
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
    color: var(--accent-primary, #BB86FC);
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
