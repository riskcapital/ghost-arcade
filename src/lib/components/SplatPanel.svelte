<script lang="ts">
  import { onDestroy } from 'svelte';
  import { project, selectedLayer } from '../stores/layers';
  import { showLoading, hideLoading } from '../stores/loading';
  import { loadPLYFromFile } from '../splat';
  import type {
    SplatContent,
    SplatAnimationType,
    SplatDisplacementType,
    SplatColorEffectType,
    SplatOpacityEffectType,
    SplatCreativeEffectType,
    SplatRenderMode,
    SplatMouseInteraction
  } from '../types';
  import { createAssetRefFromFile } from '../storage/assetRegistry';

  // Optional props for dual-mode (mapping mode vs VJ mode)
  // When not provided, falls back to selectedLayer store (mapping mode behavior)
  export let content: SplatContent | null = null;
  export let onUpdate: ((updates: Partial<SplatContent>) => void) | null = null;
  export let onFileLoad: (() => void) | null = null;
  export let compact: boolean = false; // VJ mode uses compact styling

  // Animation types with descriptions
  const animationTypes: { value: SplatAnimationType; label: string; description: string }[] = [
    { value: 'none', label: 'None', description: 'Static point cloud' },
    { value: 'explode', label: 'Explode', description: 'Points burst outward from center' },
    { value: 'implode', label: 'Implode', description: 'Points collapse to center' },
    { value: 'slice', label: 'Slice', description: 'Reveal via animated slice plane' },
    { value: 'voxelSnap', label: 'Voxel Snap', description: 'Snap to 3D voxel grid' },
    { value: 'morph', label: 'Morph', description: 'Morph between shapes' },
    { value: 'orbit', label: 'Orbit', description: 'Points orbit around center' },
    { value: 'wave3d', label: 'Wave 3D', description: 'Propagating 3D wave' },
    { value: 'scatter', label: 'Scatter', description: 'Random scatter pattern' },
    { value: 'spiral', label: 'Spiral', description: 'Spiral motion pattern' },
  ];

  // Displacement types
  const displacementTypes: { value: SplatDisplacementType; label: string }[] = [
    { value: 'none', label: 'None' },
    { value: 'noise', label: 'Noise Distortion' },
    { value: 'audioReactive', label: 'Audio Reactive' },
    { value: 'wave', label: 'Wave Propagation' },
    { value: 'glitch', label: 'Glitch Offset' },
    { value: 'wind', label: 'Wind / Turbulence' },
  ];

  // Color effect types
  const colorEffectTypes: { value: SplatColorEffectType; label: string }[] = [
    { value: 'none', label: 'None' },
    { value: 'chromatic', label: 'Chromatic Shift' },
    { value: 'heatmap', label: 'Heat Map' },
    { value: 'pointillist', label: 'Pointillist Cycling' },
    { value: 'hologram', label: 'Hologram Scanlines' },
    { value: 'rainbow', label: 'Rainbow' },
    { value: 'depthGradient', label: 'Depth Gradient' },
    { value: 'neon', label: 'Neon Glow' },
    { value: 'pastel', label: 'Pastel' },
    { value: 'cyberpunk', label: 'Cyberpunk' },
    { value: 'fire', label: 'Fire' },
    { value: 'ice', label: 'Ice' },
  ];

  // Opacity effect types
  const opacityEffectTypes: { value: SplatOpacityEffectType; label: string }[] = [
    { value: 'none', label: 'None' },
    { value: 'dof', label: 'Depth of Field' },
    { value: 'fog', label: 'Volumetric Fog' },
    { value: 'pulse', label: 'Pulse' },
    { value: 'proximity', label: 'Proximity Reveal' },
    { value: 'dissolve', label: 'Dissolve' },
  ];

  // Creative effect types
  const creativeEffectTypes: { value: SplatCreativeEffectType; label: string }[] = [
    { value: 'none', label: 'None' },
    { value: 'feedback', label: 'Feedback Loop' },
    { value: 'kaleidoscope', label: 'Kaleidoscope' },
    { value: 'constellation', label: 'Constellation / Sparkle' },
    { value: 'datamosh', label: 'Datamosh / Glitch' },
    { value: 'pixelSort', label: 'Pixel Sort' },
    { value: 'echo', label: 'Echo / Ghost' },
  ];

  // Render modes
  const renderModes: { value: SplatRenderMode; label: string }[] = [
    { value: 'points', label: 'Points' },
    { value: 'gaussians', label: 'Gaussian Splats' },
    { value: 'spheres', label: 'Spheres' },
    { value: 'billboards', label: 'Billboards' },
    { value: 'cubes', label: 'Cubes' },
    { value: 'wireframe', label: 'Wireframe (Lines)' },
  ];

  // Mouse interactions
  const mouseInteractions: { value: SplatMouseInteraction; label: string }[] = [
    { value: 'none', label: 'None' },
    { value: 'attract', label: 'Attract' },
    { value: 'repel', label: 'Repel' },
    { value: 'swirl', label: 'Swirl' },
    { value: 'reveal', label: 'Reveal' },
  ];

  // Collapsible sections state
  let showRendering = true;
  let showAnimation = true;
  let showDisplacement = false;
  let showColorEffects = false;
  let showOpacityEffects = false;
  let showCreativeEffects = false;
  let showCamera = false;
  let showPhysics = false;
  let showMouse = false;

  // Dual-mode: use provided content prop or fall back to selected layer
  $: layer = $selectedLayer;
  $: sc = (content || layer?.splatContent) as SplatContent;
  $: isVJMode = !!onUpdate;

  // Unified update function — routes to VJ callback or mapping store
  function doUpdate(updates: Partial<SplatContent>) {
    if (onUpdate) {
      onUpdate(updates);
    } else if (layer) {
      project.updateSplatContent(layer.id, updates);
    }
  }

  // Track blob URLs for cleanup and display filename
  let currentBlobUrl: string | null = null;
  let currentFileName: string = '';
  // Track texture blob URLs (image/video texture maps applied to splats) so we can revoke them.
  let currentTextureBlobUrl: string | null = null;

  onDestroy(() => {
    if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
    if (currentTextureBlobUrl) URL.revokeObjectURL(currentTextureBlobUrl);
  });

  // File input handler
  async function handleFileSelect(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;

    // In VJ mode, we don't require a layer — content comes from clip
    if (!isVJMode && !layer) return;

    const file = input.files[0];
    const ext = file.name.split('.').pop()?.toLowerCase();

    showLoading('Loading point cloud...');
    try {
      if (ext === 'splat') {
        // Native .splat format — create blob URL, Canvas will detect by extension
        if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
        const { assetRef, runtimeUrl: blobUrl } = createAssetRefFromFile(file);
        currentBlobUrl = blobUrl;
        currentFileName = file.name;
        // Store the original filename so Canvas can detect .splat format
        doUpdate({
          filePath: blobUrl,
          dataType: 'gaussian',
          _originalFileName: file.name,
          _assetRef: assetRef,
        } as any);
      } else {
        // PLY format
        const plyData = await loadPLYFromFile(file);

        if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
        const { assetRef, runtimeUrl: blobUrl } = createAssetRefFromFile(file);
        currentBlobUrl = blobUrl;
        currentFileName = file.name;

        console.log('[SplatPanel] Created blob URL for PLY:', blobUrl, 'vertices:', plyData.vertices.length, 'hasUVs:', plyData.hasUVs);

        const updates: Partial<SplatContent> = {
          filePath: blobUrl,
          dataType: plyData.dataType,
          pointCount: plyData.vertices.length,
          hasNativeUVs: plyData.hasUVs,
          _assetRef: assetRef,
        };

        // Auto-enable native texture projection when PLY has embedded UVs
        if (plyData.hasUVs) {
          updates.textureEnabled = true;
          updates.textureProjection = 'native';
        }

        doUpdate(updates);
      }
    } catch (err) {
      console.error('Failed to load splat file:', err);
    } finally {
      hideLoading();
    }
  }

  // Display-friendly filename (extract from blob URL or show stored name)
  $: displayFileName = currentFileName || (sc?.filePath?.startsWith('blob:') ? 'Loaded File' : sc?.filePath || '');
</script>

{#if (isVJMode ? sc : layer && sc)}
  <div class="splat-panel" class:compact>
    {#if !compact}<h3>Splat / Point Cloud</h3>{/if}

    <!-- File Loading -->
    <div class="section">
      <label class="section-label">Point Cloud / Splat File</label>
      <div class="file-row">
        {#if onFileLoad}
          <button class="file-button" onclick={onFileLoad}>Load File</button>
        {:else}
          <input
            type="file"
            accept=".ply,.splat"
            onchange={handleFileSelect}
            id="ply-file-input"
          />
          <label for="ply-file-input" class="file-button">Load PLY/Splat</label>
        {/if}
      </div>
      {#if sc.filePath}
        <div class="file-info">
          <span class="filename">{displayFileName || 'Loaded PLY'}</span>
          <span class="point-count">{sc.pointCount.toLocaleString()} points</span>
          <span class="data-type">{sc.dataType === 'gaussian' ? 'Gaussian Splat' : 'Point Cloud'}</span>
        </div>

        <div class="property-row">
          <label>Point Density</label>
          <input
            type="range" min="0.01" max="1" step="0.01"
            value={sc.pointDensity ?? 1}
            oninput={(e) => doUpdate({ pointDensity: parseFloat((e.target as HTMLInputElement).value) })}
            data-midi-path="map:splat:pointDensity"
            data-midi-label="Point Density"
            data-midi-min="0.01"
            data-midi-max="1"
            data-midi-step="0.01"
          />
          <span class="value">{((sc.pointDensity ?? 1) * 100).toFixed(0)}%</span>
        </div>
        <div class="density-info">
          <span>Active: {(sc.activePointCount || Math.floor(sc.pointCount * (sc.pointDensity ?? 1))).toLocaleString()} pts</span>
        </div>

        <!-- Texture Mapping -->
        <div class="texture-section">
          <div class="property-row checkbox">
            <label>
              <input
                type="checkbox"
                checked={sc.textureEnabled ?? false}
                onchange={(e) => doUpdate({ textureEnabled: (e.target as HTMLInputElement).checked })}
                data-midi-path="map:splat:textureEnabled"
                data-midi-label="Use Texture Map"
                data-midi-mode="toggle"
              />
              Use Texture Map
            </label>
          </div>

          {#if sc.textureEnabled}
            <div class="property-row">
              <label>Type</label>
              <select
                value={sc.textureType ?? 'image'}
                onchange={(e) => {
                  doUpdate({
                    textureType: (e.target as HTMLSelectElement).value as 'image' | 'video',
                    texturePath: '' // Clear path when changing type
                  });
                }}
                data-midi-path="map:splat:textureType"
                data-midi-label="Texture Type"
                data-midi-min="0"
                data-midi-max="1"
                data-midi-step="1"
                data-midi-discrete="image,video"
              >
                <option value="image">Image</option>
                <option value="video">Video</option>
              </select>
            </div>

            <div class="property-row">
              <label>{sc.textureType === 'video' ? 'Video' : 'Image'}</label>
              <input
                type="file"
                accept={sc.textureType === 'video' ? 'video/*' : 'image/*'}
                onchange={async (e) => {
                  const file = (e.target as HTMLInputElement).files?.[0];
                  if (file) {
                    if (sc.textureType === 'video') {
                      // For video, use blob URL for better performance, plus
                      // capture an AssetRef so the texture survives reload
                      // (blob URLs die at session end).
                      if (currentTextureBlobUrl) URL.revokeObjectURL(currentTextureBlobUrl);
                      const { assetRef, runtimeUrl: blobUrl } = createAssetRefFromFile(file);
                      currentTextureBlobUrl = blobUrl;
                      doUpdate({ texturePath: blobUrl, _textureAssetRef: assetRef } as any);
                    } else {
                      // For images, embed as data URL (small assets) AND keep
                      // the AssetRef so the original disk path is recoverable
                      // if the user re-uses the same image elsewhere.
                      const { assetRef } = createAssetRefFromFile(file);
                      const reader = new FileReader();
                      reader.onload = () => {
                        const dataUrl = reader.result as string;
                        // Promote the dataUrl into the assetRef so save/reload
                        // doesn't have to copy the image — it's already inline.
                        const refWithData = { ...assetRef, kind: 'embedded' as const, dataUrl };
                        doUpdate({ texturePath: dataUrl, _textureAssetRef: refWithData } as any);
                      };
                      reader.readAsDataURL(file);
                    }
                  }
                }}
              />
            </div>

            {#if sc.texturePath}
              <div class="texture-preview">
                {#if sc.textureType === 'video'}
                  <video
                    src={sc.texturePath}
                    style="max-width: 100%; max-height: 60px; object-fit: contain;"
                    muted
                    loop
                    autoplay
                    playsinline
                  ></video>
                {:else}
                  <img src={sc.texturePath} alt="Texture preview" style="max-width: 100%; max-height: 60px; object-fit: contain;" />
                {/if}
              </div>
            {/if}

            <div class="property-row">
              <label>Projection</label>
              <select
                value={sc.textureProjection ?? 'spherical'}
                onchange={(e) => doUpdate({ textureProjection: (e.target as HTMLSelectElement).value as any })}
                data-midi-path="map:splat:textureProjection"
                data-midi-label="Texture Projection"
                data-midi-min="0"
                data-midi-max="6"
                data-midi-step="1"
                data-midi-discrete="spherical,cylindrical,planarXY,planarXZ,planarYZ,box,native"
              >
                <option value="spherical">Spherical</option>
                <option value="cylindrical">Cylindrical</option>
                <option value="planarXY">Planar XY (Front)</option>
                <option value="planarXZ">Planar XZ (Top)</option>
                <option value="planarYZ">Planar YZ (Side)</option>
                <option value="box">Box</option>
                <option value="native">Native (from file)</option>
              </select>
            </div>

            <div class="property-row">
              <label>Blend</label>
              <input
                type="range" min="0" max="1" step="0.01"
                value={sc.textureBlend ?? 0.5}
                oninput={(e) => doUpdate({ textureBlend: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:textureBlend"
                data-midi-label="Texture Blend"
                data-midi-min="0"
                data-midi-max="1"
                data-midi-step="0.01"
              />
              <span class="value">{((sc.textureBlend ?? 0.5) * 100).toFixed(0)}%</span>
            </div>

            <div class="property-row">
              <label>Scale</label>
              <input
                type="range" min="0.1" max="5" step="0.1"
                value={sc.textureScale ?? 1}
                oninput={(e) => doUpdate({ textureScale: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:textureScale"
                data-midi-label="Texture Scale"
                data-midi-min="0.1"
                data-midi-max="5"
                data-midi-step="0.1"
              />
              <span class="value">{(sc.textureScale ?? 1).toFixed(1)}</span>
            </div>

            <div class="property-row">
              <label>Offset X</label>
              <input
                type="range" min="-1" max="1" step="0.01"
                value={sc.textureOffsetX ?? 0}
                oninput={(e) => doUpdate({ textureOffsetX: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:textureOffsetX"
                data-midi-label="Texture Offset X"
                data-midi-min="-1"
                data-midi-max="1"
                data-midi-step="0.01"
              />
              <span class="value">{(sc.textureOffsetX ?? 0).toFixed(2)}</span>
            </div>

            <div class="property-row">
              <label>Offset Y</label>
              <input
                type="range" min="-1" max="1" step="0.01"
                value={sc.textureOffsetY ?? 0}
                oninput={(e) => doUpdate({ textureOffsetY: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:textureOffsetY"
                data-midi-label="Texture Offset Y"
                data-midi-min="-1"
                data-midi-max="1"
                data-midi-step="0.01"
              />
              <span class="value">{(sc.textureOffsetY ?? 0).toFixed(2)}</span>
            </div>
          {/if}
        </div>
      {:else}
        <p class="hint">Load a .ply or .splat file to visualize point cloud or gaussian splat data</p>
      {/if}
    </div>

    <!-- Rendering Section -->
    <div class="section collapsible" class:open={showRendering}>
      <button class="section-header" onclick={() => showRendering = !showRendering}>
        <span>Rendering</span>
        <span class="chevron">{showRendering ? '−' : '+'}</span>
      </button>
      {#if showRendering}
        <div class="section-content">
          <div class="property-row">
            <label>Render Mode</label>
            <select
              value={sc.renderMode}
              onchange={(e) => doUpdate({ renderMode: (e.target as HTMLSelectElement).value as SplatRenderMode })}
              data-midi-path="map:splat:renderMode"
              data-midi-label="Render Mode"
              data-midi-min="0"
              data-midi-max="5"
              data-midi-step="1"
              data-midi-discrete="points,gaussians,spheres,billboards,cubes,wireframe"
            >
              {#each renderModes as mode}
                <option value={mode.value}>{mode.label}</option>
              {/each}
            </select>
          </div>

          <div class="property-row">
            <label>Point Size</label>
            <input
              type="range" min="0.1" max="5" step="0.05"
              value={sc.pointSize}
              oninput={(e) => doUpdate({ pointSize: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:splat:pointSize"
              data-midi-label="Point Size"
              data-midi-min="0.1"
              data-midi-max="5"
              data-midi-step="0.05"
            />
            <span class="value">{sc.pointSize.toFixed(2)}</span>
          </div>

          <div class="property-row">
            <label>Global Scale</label>
            <input
              type="range" min="0.01" max="10" step="0.01"
              value={sc.scaleUniform}
              oninput={(e) => doUpdate({ scaleUniform: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:splat:scaleUniform"
              data-midi-label="Global Scale"
              data-midi-min="0.01"
              data-midi-max="10"
              data-midi-step="0.01"
            />
            <span class="value">{sc.scaleUniform.toFixed(2)}</span>
          </div>

          <div class="property-row">
            <label>Global Opacity</label>
            <input
              type="range" min="0" max="1" step="0.01"
              value={sc.opacity}
              oninput={(e) => doUpdate({ opacity: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:splat:opacity"
              data-midi-label="Global Opacity"
              data-midi-min="0"
              data-midi-max="1"
              data-midi-step="0.01"
            />
            <span class="value">{(sc.opacity * 100).toFixed(0)}%</span>
          </div>

          <div class="property-row checkbox">
            <label>
              <input
                type="checkbox"
                checked={sc.sizeAttenuation}
                onchange={(e) => doUpdate({ sizeAttenuation: (e.target as HTMLInputElement).checked })}
                data-midi-path="map:splat:sizeAttenuation"
                data-midi-label="Size Attenuation"
                data-midi-mode="toggle"
              />
              Size Attenuation
            </label>
          </div>

          <div class="property-row checkbox">
            <label>
              <input
                type="checkbox"
                checked={sc.depthTest}
                onchange={(e) => doUpdate({ depthTest: (e.target as HTMLInputElement).checked })}
                data-midi-path="map:splat:depthTest"
                data-midi-label="Depth Test"
                data-midi-mode="toggle"
              />
              Depth Test
            </label>
          </div>
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
          <div class="property-row">
            <label>Type</label>
            <select
              value={sc.animationType}
              onchange={(e) => doUpdate({ animationType: (e.target as HTMLSelectElement).value as SplatAnimationType })}
              data-midi-path="map:splat:animationType"
              data-midi-label="Animation Type"
              data-midi-min="0"
              data-midi-max="12"
              data-midi-step="1"
              data-midi-discrete="none,explode,implode,slice,voxelSnap,peel,gravity,swarm,morph,orbit,wave3d,scatter,spiral"
            >
              {#each animationTypes as anim}
                <option value={anim.value} title={anim.description}>{anim.label}</option>
              {/each}
            </select>
          </div>

          {#if sc.animationType !== 'none'}
            <div class="property-row">
              <label>Speed</label>
              <input
                type="range" min="0" max="5" step="0.01"
                value={sc.animationSpeed}
                oninput={(e) => doUpdate({ animationSpeed: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:animationSpeed"
                data-midi-label="Animation Speed"
                data-midi-min="0"
                data-midi-max="5"
                data-midi-step="0.01"
              />
              <span class="value">{sc.animationSpeed.toFixed(2)}</span>
            </div>

            <div class="property-row">
              <label>Intensity</label>
              <input
                type="range" min="0" max="2" step="0.01"
                value={sc.animationIntensity}
                oninput={(e) => doUpdate({ animationIntensity: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:animationIntensity"
                data-midi-label="Animation Intensity"
                data-midi-min="0"
                data-midi-max="2"
                data-midi-step="0.01"
              />
              <span class="value">{sc.animationIntensity.toFixed(2)}</span>
            </div>

            <div class="property-row checkbox">
              <label>
                <input
                  type="checkbox"
                  checked={sc.animationLoop}
                  onchange={(e) => doUpdate({ animationLoop: (e.target as HTMLInputElement).checked })}
                  data-midi-path="map:splat:animationLoop"
                  data-midi-label="Loop Animation"
                  data-midi-mode="toggle"
                />
                Loop Animation
              </label>
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Displacement Section -->
    <div class="section collapsible" class:open={showDisplacement}>
      <button class="section-header" onclick={() => showDisplacement = !showDisplacement}>
        <span>Displacement</span>
        <span class="chevron">{showDisplacement ? '−' : '+'}</span>
      </button>
      {#if showDisplacement}
        <div class="section-content">
          <div class="property-row">
            <label>Type</label>
            <select
              value={sc.displacementType}
              onchange={(e) => doUpdate({ displacementType: (e.target as HTMLSelectElement).value as SplatDisplacementType })}
              data-midi-path="map:splat:displacementType"
              data-midi-label="Displacement Type"
              data-midi-min="0"
              data-midi-max="5"
              data-midi-step="1"
              data-midi-discrete="none,noise,audioReactive,wave,glitch,wind"
            >
              {#each displacementTypes as disp}
                <option value={disp.value}>{disp.label}</option>
              {/each}
            </select>
          </div>

          {#if sc.displacementType !== 'none'}
            <div class="property-row">
              <label>Scale</label>
              <input
                type="range" min="0.1" max="10" step="0.1"
                value={sc.displacementScale}
                oninput={(e) => doUpdate({ displacementScale: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:displacementScale"
                data-midi-label="Displacement Scale"
                data-midi-min="0.1"
                data-midi-max="10"
                data-midi-step="0.1"
              />
              <span class="value">{sc.displacementScale.toFixed(1)}</span>
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Color Effects Section -->
    <div class="section collapsible" class:open={showColorEffects}>
      <button class="section-header" onclick={() => showColorEffects = !showColorEffects}>
        <span>Color Effects</span>
        <span class="chevron">{showColorEffects ? '−' : '+'}</span>
      </button>
      {#if showColorEffects}
        <div class="section-content">
          <div class="property-row">
            <label>Effect</label>
            <select
              value={sc.colorEffect}
              onchange={(e) => doUpdate({ colorEffect: (e.target as HTMLSelectElement).value as SplatColorEffectType })}
              data-midi-path="map:splat:colorEffect"
              data-midi-label="Color Effect"
              data-midi-min="0"
              data-midi-max="11"
              data-midi-step="1"
              data-midi-discrete="none,chromatic,heatmap,pointillist,hologram,rainbow,depthGradient,neon,pastel,cyberpunk,fire,ice"
            >
              {#each colorEffectTypes as effect}
                <option value={effect.value}>{effect.label}</option>
              {/each}
            </select>
          </div>

          {#if sc.colorEffect !== 'none'}
            <div class="property-row">
              <label>Intensity</label>
              <input
                type="range" min="0" max="1" step="0.01"
                value={sc.colorEffectIntensity}
                oninput={(e) => doUpdate({ colorEffectIntensity: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:colorEffectIntensity"
                data-midi-label="Color Effect Intensity"
                data-midi-min="0"
                data-midi-max="1"
                data-midi-step="0.01"
              />
              <span class="value">{(sc.colorEffectIntensity * 100).toFixed(0)}%</span>
            </div>

            <div class="property-row">
              <label>Speed</label>
              <input
                type="range" min="0" max="5" step="0.01"
                value={sc.colorEffectSpeed}
                oninput={(e) => doUpdate({ colorEffectSpeed: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:colorEffectSpeed"
                data-midi-label="Color Effect Speed"
                data-midi-min="0"
                data-midi-max="5"
                data-midi-step="0.01"
              />
              <span class="value">{sc.colorEffectSpeed.toFixed(2)}</span>
            </div>
          {/if}

        </div>
      {/if}
    </div>

    <!-- Opacity Effects Section -->
    <div class="section collapsible" class:open={showOpacityEffects}>
      <button class="section-header" onclick={() => showOpacityEffects = !showOpacityEffects}>
        <span>Opacity Effects</span>
        <span class="chevron">{showOpacityEffects ? '−' : '+'}</span>
      </button>
      {#if showOpacityEffects}
        <div class="section-content">
          <div class="property-row">
            <label>Effect</label>
            <select
              value={sc.opacityEffect}
              onchange={(e) => doUpdate({ opacityEffect: (e.target as HTMLSelectElement).value as SplatOpacityEffectType })}
              data-midi-path="map:splat:opacityEffect"
              data-midi-label="Opacity Effect"
              data-midi-min="0"
              data-midi-max="5"
              data-midi-step="1"
              data-midi-discrete="none,dof,fog,pulse,proximity,dissolve"
            >
              {#each opacityEffectTypes as effect}
                <option value={effect.value}>{effect.label}</option>
              {/each}
            </select>
          </div>

          {#if sc.opacityEffect !== 'none'}
            <div class="property-row">
              <label>Intensity</label>
              <input
                type="range" min="0" max="1" step="0.01"
                value={sc.opacityEffectIntensity}
                oninput={(e) => doUpdate({ opacityEffectIntensity: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:opacityEffectIntensity"
                data-midi-label="Opacity Effect Intensity"
                data-midi-min="0"
                data-midi-max="1"
                data-midi-step="0.01"
              />
              <span class="value">{(sc.opacityEffectIntensity * 100).toFixed(0)}%</span>
            </div>

            {#if sc.opacityEffect === 'dof'}
              <div class="property-row">
                <label>Focus Distance</label>
                <input
                  type="range" min="0" max="100" step="0.1"
                  value={sc.dofFocusDistance}
                  oninput={(e) => doUpdate({ dofFocusDistance: parseFloat((e.target as HTMLInputElement).value) })}
                  data-midi-path="map:splat:dofFocusDistance"
                  data-midi-label="DOF Focus Distance"
                  data-midi-min="0"
                  data-midi-max="100"
                  data-midi-step="0.1"
                />
                <span class="value">{sc.dofFocusDistance.toFixed(1)}</span>
              </div>

              <div class="property-row">
                <label>Blur Amount</label>
                <input
                  type="range" min="0" max="1" step="0.01"
                  value={sc.dofBlurAmount}
                  oninput={(e) => doUpdate({ dofBlurAmount: parseFloat((e.target as HTMLInputElement).value) })}
                  data-midi-path="map:splat:dofBlurAmount"
                  data-midi-label="DOF Blur Amount"
                  data-midi-min="0"
                  data-midi-max="1"
                  data-midi-step="0.01"
                />
                <span class="value">{(sc.dofBlurAmount * 100).toFixed(0)}%</span>
              </div>
            {/if}

            {#if sc.opacityEffect === 'fog'}
              <div class="property-row">
                <label>Fog Density</label>
                <input
                  type="range" min="0" max="1" step="0.01"
                  value={sc.fogDensity}
                  oninput={(e) => doUpdate({ fogDensity: parseFloat((e.target as HTMLInputElement).value) })}
                  data-midi-path="map:splat:fogDensity"
                  data-midi-label="Fog Density"
                  data-midi-min="0"
                  data-midi-max="1"
                  data-midi-step="0.01"
                />
                <span class="value">{(sc.fogDensity * 100).toFixed(0)}%</span>
              </div>

              <div class="property-row">
                <label>Fog Color</label>
                <input
                  type="color"
                  value={sc.fogColor}
                  onchange={(e) => doUpdate({ fogColor: (e.target as HTMLInputElement).value })}
                />
              </div>
            {/if}
          {/if}
        </div>
      {/if}
    </div>

    <!-- Creative Effects Section -->
    <div class="section collapsible" class:open={showCreativeEffects}>
      <button class="section-header" onclick={() => showCreativeEffects = !showCreativeEffects}>
        <span>Creative Effects</span>
        <span class="chevron">{showCreativeEffects ? '−' : '+'}</span>
      </button>
      {#if showCreativeEffects}
        <div class="section-content">
          <div class="property-row">
            <label>Effect</label>
            <select
              value={sc.creativeEffect}
              onchange={(e) => doUpdate({ creativeEffect: (e.target as HTMLSelectElement).value as SplatCreativeEffectType })}
              data-midi-path="map:splat:creativeEffect"
              data-midi-label="Creative Effect"
              data-midi-min="0"
              data-midi-max="6"
              data-midi-step="1"
              data-midi-discrete="none,feedback,kaleidoscope,constellation,datamosh,pixelSort,echo"
            >
              {#each creativeEffectTypes as effect}
                <option value={effect.value}>{effect.label}</option>
              {/each}
            </select>
          </div>

          {#if sc.creativeEffect !== 'none'}
            <div class="property-row">
              <label>Intensity</label>
              <input
                type="range" min="0" max="1" step="0.01"
                value={sc.creativeEffectIntensity}
                oninput={(e) => doUpdate({ creativeEffectIntensity: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:creativeEffectIntensity"
                data-midi-label="Creative Effect Intensity"
                data-midi-min="0"
                data-midi-max="1"
                data-midi-step="0.01"
              />
              <span class="value">{(sc.creativeEffectIntensity * 100).toFixed(0)}%</span>
            </div>


          {/if}
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
          <div class="property-row checkbox">
            <label>
              <input
                type="checkbox"
                checked={sc.cameraOrbitEnabled}
                onchange={(e) => doUpdate({ cameraOrbitEnabled: (e.target as HTMLInputElement).checked })}
                data-midi-path="map:splat:cameraOrbitEnabled"
                data-midi-label="Enable Orbit Controls"
                data-midi-mode="toggle"
              />
              Enable Orbit Controls
            </label>
          </div>

          <div class="property-row checkbox">
            <label>
              <input
                type="checkbox"
                checked={sc.autoRotate}
                onchange={(e) => doUpdate({ autoRotate: (e.target as HTMLInputElement).checked })}
                data-midi-path="map:splat:autoRotate"
                data-midi-label="Auto Rotate"
                data-midi-mode="toggle"
              />
              Auto Rotate
            </label>
          </div>

          {#if sc.autoRotate}
            <div class="property-row">
              <label>Rotate Speed</label>
              <input
                type="range" min="0" max="5" step="0.1"
                value={sc.autoRotateSpeed}
                oninput={(e) => doUpdate({ autoRotateSpeed: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:autoRotateSpeed"
                data-midi-label="Auto Rotate Speed"
                data-midi-min="0"
                data-midi-max="5"
                data-midi-step="0.1"
              />
              <span class="value">{sc.autoRotateSpeed.toFixed(1)}</span>
            </div>
          {/if}

          <div class="property-row">
            <label>FOV</label>
            <input
              type="range" min="20" max="120" step="1"
              value={sc.cameraFov}
              oninput={(e) => doUpdate({ cameraFov: parseInt((e.target as HTMLInputElement).value) })}
              data-midi-path="map:splat:cameraFov"
              data-midi-label="Camera FOV"
              data-midi-min="20"
              data-midi-max="120"
              data-midi-step="1"
            />
            <span class="value">{sc.cameraFov}</span>
          </div>

          <div class="property-row">
            <label>Distance</label>
            <input
              type="range" min="1" max="500" step="1"
              value={sc.cameraDistance}
              oninput={(e) => doUpdate({ cameraDistance: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:splat:cameraDistance"
              data-midi-label="Camera Distance"
              data-midi-min="1"
              data-midi-max="500"
              data-midi-step="1"
            />
            <span class="value">{sc.cameraDistance.toFixed(0)}</span>
          </div>

          <div class="property-row">
            <label>Orbit X</label>
            <input
              type="range" min="-180" max="180" step="1"
              value={sc.cameraOrbitX ?? 0}
              oninput={(e) => doUpdate({ cameraOrbitX: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:splat:cameraOrbitX"
              data-midi-label="Camera Orbit X"
              data-midi-min="-180"
              data-midi-max="180"
              data-midi-step="1"
            />
            <span class="value">{(sc.cameraOrbitX ?? 0).toFixed(0)}</span>
          </div>

          <div class="property-row">
            <label>Orbit Y</label>
            <input
              type="range" min="-90" max="90" step="1"
              value={sc.cameraOrbitY ?? 0}
              oninput={(e) => doUpdate({ cameraOrbitY: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:splat:cameraOrbitY"
              data-midi-label="Camera Orbit Y"
              data-midi-min="-90"
              data-midi-max="90"
              data-midi-step="1"
            />
            <span class="value">{(sc.cameraOrbitY ?? 0).toFixed(0)}</span>
          </div>

          <div class="property-row">
            <label>Roll (Z)</label>
            <input
              type="range" min="-180" max="180" step="1"
              value={sc.cameraRoll ?? 0}
              oninput={(e) => doUpdate({ cameraRoll: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:splat:cameraRoll"
              data-midi-label="Camera Roll"
              data-midi-min="-180"
              data-midi-max="180"
              data-midi-step="1"
            />
            <span class="value">{(sc.cameraRoll ?? 0).toFixed(0)}</span>
          </div>

          <div class="property-row">
            <label>Pan X</label>
            <input
              type="range" min="-100" max="100" step="0.5"
              value={sc.cameraPanX ?? 0}
              oninput={(e) => doUpdate({ cameraPanX: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:splat:cameraPanX"
              data-midi-label="Camera Pan X"
              data-midi-min="-100"
              data-midi-max="100"
              data-midi-step="0.5"
            />
            <span class="value">{(sc.cameraPanX ?? 0).toFixed(1)}</span>
          </div>

          <div class="property-row">
            <label>Pan Y</label>
            <input
              type="range" min="-100" max="100" step="0.5"
              value={sc.cameraPanY ?? 0}
              oninput={(e) => doUpdate({ cameraPanY: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:splat:cameraPanY"
              data-midi-label="Camera Pan Y"
              data-midi-min="-100"
              data-midi-max="100"
              data-midi-step="0.5"
            />
            <span class="value">{(sc.cameraPanY ?? 0).toFixed(1)}</span>
          </div>
        </div>
      {/if}
    </div>

    <!-- Mouse Interaction Section -->
    <div class="section collapsible" class:open={showMouse}>
      <button class="section-header" onclick={() => showMouse = !showMouse}>
        <span>Mouse Interaction</span>
        <span class="chevron">{showMouse ? '−' : '+'}</span>
      </button>
      {#if showMouse}
        <div class="section-content">
          <div class="property-row">
            <label>Mode</label>
            <select
              value={sc.mouseInteraction}
              onchange={(e) => doUpdate({ mouseInteraction: (e.target as HTMLSelectElement).value as SplatMouseInteraction })}
              data-midi-path="map:splat:mouseInteraction"
              data-midi-label="Mouse Mode"
              data-midi-mode="absolute"
              data-midi-min="0"
              data-midi-max="4"
              data-midi-step="1"
              data-midi-discrete="none,attract,repel,swirl,reveal"
            >
              {#each mouseInteractions as mode}
                <option value={mode.value}>{mode.label}</option>
              {/each}
            </select>
          </div>

          {#if sc.mouseInteraction !== 'none'}
            <div class="property-row">
              <label>Radius</label>
              <input
                type="range" min="0.05" max="1" step="0.01"
                value={sc.mouseRadius}
                oninput={(e) => doUpdate({ mouseRadius: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:mouseRadius"
                data-midi-label="Mouse Radius"
                data-midi-min="0.05"
                data-midi-max="1"
                data-midi-step="0.01"
              />
              <span class="value">{(sc.mouseRadius * 100).toFixed(0)}%</span>
            </div>

            <div class="property-row">
              <label>Strength</label>
              <input
                type="range" min="0.1" max="3" step="0.05"
                value={sc.mouseStrength}
                oninput={(e) => doUpdate({ mouseStrength: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:mouseStrength"
                data-midi-label="Mouse Strength"
                data-midi-min="0.1"
                data-midi-max="3"
                data-midi-step="0.05"
              />
              <span class="value">{sc.mouseStrength.toFixed(2)}</span>
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Physics Section -->
    <div class="section collapsible" class:open={showPhysics}>
      <button class="section-header" onclick={() => showPhysics = !showPhysics}>
        <span>Physics</span>
        <span class="chevron">{showPhysics ? '−' : '+'}</span>
      </button>
      {#if showPhysics}
        <div class="section-content">
          <div class="property-row checkbox">
            <label>
              <input
                type="checkbox"
                checked={sc.physicsEnabled}
                onchange={(e) => doUpdate({ physicsEnabled: (e.target as HTMLInputElement).checked })}
                data-midi-path="map:splat:physicsEnabled"
                data-midi-label="Enable Physics"
                data-midi-mode="toggle"
              />
              Enable Physics
            </label>
          </div>

          {#if sc.physicsEnabled}
            <div class="property-row">
              <label>Gravity</label>
              <input
                type="range" min="-20" max="20" step="0.1"
                value={sc.gravity}
                oninput={(e) => doUpdate({ gravity: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:gravity"
                data-midi-label="Gravity"
                data-midi-min="-20"
                data-midi-max="20"
                data-midi-step="0.1"
              />
              <span class="value">{sc.gravity.toFixed(1)}</span>
            </div>

            <div class="property-row">
              <label>Friction</label>
              <input
                type="range" min="0" max="1" step="0.01"
                value={sc.friction}
                oninput={(e) => doUpdate({ friction: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:friction"
                data-midi-label="Friction"
                data-midi-min="0"
                data-midi-max="1"
                data-midi-step="0.01"
              />
              <span class="value">{sc.friction.toFixed(2)}</span>
            </div>

            <div class="property-row">
              <label>Bounciness</label>
              <input
                type="range" min="0" max="1" step="0.01"
                value={sc.bounciness}
                oninput={(e) => doUpdate({ bounciness: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:bounciness"
                data-midi-label="Bounciness"
                data-midi-min="0"
                data-midi-max="1"
                data-midi-step="0.01"
              />
              <span class="value">{sc.bounciness.toFixed(2)}</span>
            </div>
          {/if}
        </div>
      {/if}
    </div>

  </div>
{:else}
  <div class="no-layer">
    <p>Select a splat layer to edit its properties</p>
  </div>
{/if}

<style>
  .splat-panel {
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 14px;
    color: var(--text-primary, #e0e0e0);
    overflow-y: auto;
    max-height: 100%;
  }

  h3 {
    margin: 0 0 8px 0;
    font-size: 16px;
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
    font-size: 13px;
    color: var(--text-secondary, #888);
    margin-bottom: 6px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
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
    font-size: 14px;
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

  .chevron {
    font-size: 18px;
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
    font-size: 13px;
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
    font-size: 13px;
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
    font-size: 12px;
    font-family: monospace;
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
    font-size: 13px;
    font-weight: 500;
    transition: background 0.2s;
  }

  .file-button:hover {
    background: var(--accent-hover, #34d399);
  }

  .file-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-top: 6px;
    padding: 6px;
    background: var(--bg-secondary, #0d0d10);
    border-radius: 4px;
    font-size: 12px;
  }

  .filename {
    color: var(--text-primary, #e0e0e0);
    font-weight: 500;
  }

  .point-count {
    color: var(--accent-primary, #BB86FC);
  }

  .data-type {
    color: var(--text-secondary, #888);
  }

  .density-info {
    font-size: 12px;
    color: var(--text-secondary, #888);
    margin-top: 4px;
    padding-left: 2px;
  }

  .texture-section {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid var(--border-color, #333);
  }

  .texture-preview {
    margin: 8px 0;
    padding: 8px;
    background: var(--bg-tertiary, #0d0d10);
    border-radius: 4px;
    text-align: center;
  }

  .hint {
    color: var(--text-secondary, #666);
    font-size: 12px;
    margin: 6px 0 0 0;
    font-style: italic;
  }

  .no-layer {
    padding: 20px;
    text-align: center;
    color: var(--text-secondary, #666);
  }
</style>
