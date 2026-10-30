<script lang="ts" module>
  import { get as getStore } from 'svelte/store';
  import { project as projectStore } from '../stores/layers';

  /** Blob URLs this panel made (splat files and video textures), with the
   *  file name behind each. Keyed by URL rather than by panel: one panel
   *  edits whichever layer or clip is selected, so loading a new file frees
   *  only the URL that layer was using. */
  const splatBlobNames = new Map<string, string>();

  /** Revoke a URL this panel made once no layer shows it any more. */
  function releaseSplatBlobUrl(url: string | null | undefined): void {
    if (!url || !splatBlobNames.has(url)) return;
    const layers = getStore(projectStore)?.layers ?? [];
    if (layers.some((l) => l.splatContent?.filePath === url || l.splatContent?.texturePath === url)) return;
    splatBlobNames.delete(url);
    URL.revokeObjectURL(url);
  }
</script>

<script lang="ts">
  import { project, selectedLayer, scheduleHistorySnapshot } from '../stores/layers';
  import type {
    SplatContent,
    SplatAnimationType,
    SplatDisplacementType,
    SplatColorEffectType,
    SplatOpacityEffectType,
    SplatCreativeEffectType,
    SplatEffectBlendMode,
    SplatRenderMode,
    SplatMouseInteraction,
    SplatImportOrientation,
  } from '../types';
  import { createAssetRefFromFile } from '../storage/assetRegistry';
  import EffectParamRow from './EffectParamRow.svelte';
  import { keyframeTimeline } from '../stores/keyframeTimeline';
  import {
    SPLAT_AUTOMATABLE_PARAM_MAP,
    type SplatParamDescriptor,
  } from '../splat/splatParamSchema';
  import {
    SPLAT_IMPORT_ORIENTATION_OPTIONS,
    bakeSplatManualRotationAsUpright,
    resolveSplatImportRotation,
    splatImportOrientationRotation,
  } from '../splat';

  // Optional props for dual-mode (mapping mode vs VJ mode)
  // When not provided, falls back to selectedLayer store (mapping mode behavior)
  export let content: SplatContent | null = null;
  export let onUpdate: ((updates: Partial<SplatContent>) => void) | null = null;
  export let onFileLoad: (() => void) | null = null;
  export let compact: boolean = false; // VJ mode uses compact styling

  // Animation types with descriptions
  const animationTypes: { value: SplatAnimationType; label: string; description: string }[] = [
    { value: 'none', label: 'None', description: 'Static point cloud' },
    { value: 'orbit', label: 'Turntable', description: 'Continuous rigid rotation around the vertical axis' },
    { value: 'tumble', label: 'Tumble', description: 'Continuous multi-axis rigid rotation' },
    { value: 'breathe', label: 'Breathe', description: 'Coherent rhythmic expansion and contraction' },
    { value: 'drift', label: 'Organic drift', description: 'Slow coherent motion through a 3D noise field' },
    { value: 'vortex', label: 'Vortex', description: 'Continuous height-dependent torsion' },
    { value: 'wave3d', label: 'Wave field', description: 'Propagating spatial wave' },
    { value: 'swarm', label: 'Swarm', description: 'Noise-driven flocking and separation' },
    { value: 'spiral', label: 'Spiral', description: 'Spiral motion pattern' },
    { value: 'scatter', label: 'Scatter', description: 'Random scatter and reassembly' },
    { value: 'explode', label: 'Explode', description: 'Points burst outward from center' },
    { value: 'implode', label: 'Implode', description: 'Points collapse to center' },
    { value: 'slice', label: 'Slice', description: 'Reveal via animated slice plane' },
    { value: 'peel', label: 'Peel', description: 'Layer-by-layer reveal' },
    { value: 'voxelSnap', label: 'Voxel snap', description: 'Snap to 3D voxel grid' },
    { value: 'gravity', label: 'Gravity', description: 'Physics-inspired falling motion' },
    { value: 'morph', label: 'Morph', description: 'Morph between shapes' },
  ];

  // Displacement types
  const displacementTypes: { value: SplatDisplacementType; label: string }[] = [
    { value: 'none', label: 'None' },
    { value: 'noise', label: 'Noise distortion' },
    { value: 'curlNoise', label: 'Curl flow' },
    { value: 'audioReactive', label: 'Audio reactive' },
    { value: 'wave', label: 'Wave field' },
    { value: 'radialPulse', label: 'Radial pulse' },
    { value: 'twist', label: 'Axis twist' },
    { value: 'wind', label: 'Wind / turbulence' },
    { value: 'magnetic', label: 'Magnetic field' },
    { value: 'ripple', label: 'Interaction ripple' },
    { value: 'scanline', label: 'Scan field' },
    { value: 'glitch', label: 'Glitch offset' },
  ];

  // Color effect types
  const colorEffectTypes: { value: SplatColorEffectType; label: string }[] = [
    { value: 'none', label: 'None' },
    { value: 'chromatic', label: 'Chromatic shift' },
    { value: 'heatmap', label: 'Heat map' },
    { value: 'pointillist', label: 'Pointillist cycling' },
    { value: 'hologram', label: 'Hologram scanlines' },
    { value: 'rainbow', label: 'Rainbow' },
    { value: 'depthGradient', label: 'Depth gradient' },
    { value: 'neon', label: 'Neon glow' },
    { value: 'pastel', label: 'Pastel' },
    { value: 'cyberpunk', label: 'Cyberpunk' },
    { value: 'fire', label: 'Fire' },
    { value: 'ice', label: 'Ice' },
  ];

  // Opacity effect types
  const opacityEffectTypes: { value: SplatOpacityEffectType; label: string }[] = [
    { value: 'none', label: 'None' },
    { value: 'dof', label: 'Depth of field' },
    { value: 'fog', label: 'Volumetric fog' },
    { value: 'pulse', label: 'Pulse' },
    { value: 'proximity', label: 'Proximity reveal' },
    { value: 'dissolve', label: 'Dissolve' },
  ];

  // Creative effect types
  const creativeEffectTypes: { value: SplatCreativeEffectType; label: string }[] = [
    { value: 'none', label: 'None' },
    { value: 'feedback', label: 'Feedback loop' },
    { value: 'kaleidoscope', label: 'Kaleidoscope' },
    { value: 'constellation', label: 'Constellation / sparkle' },
    { value: 'datamosh', label: 'Datamosh / glitch' },
    { value: 'pixelSort', label: 'Pixel sort' },
    { value: 'echo', label: 'Echo / ghost' },
  ];

  // How the constellation sparkle combines with the point's own colour.
  // Per-splat, evaluated in the fragment shader — distinct from the
  // layer-level blend mode that composites the whole layer downstream.
  const constellationBlendModes: { value: SplatEffectBlendMode; label: string }[] = [
    { value: 'add', label: 'Add' },
    { value: 'screen', label: 'Screen' },
    { value: 'multiply', label: 'Multiply' },
    { value: 'replace', label: 'Replace' },
  ];

  // Render modes
  const renderModes: { value: SplatRenderMode; label: string }[] = [
    { value: 'points', label: 'Points' },
    { value: 'gaussians', label: 'Gaussian splats' },
    { value: 'spheres', label: 'Spheres' },
    { value: 'billboards', label: 'Billboards' },
    { value: 'cubes', label: 'Cubes' },
    { value: 'wireframe', label: 'Wireframe (lines)' },
  ];

  // Mouse interactions
  const mouseInteractions: { value: SplatMouseInteraction; label: string }[] = [
    { value: 'none', label: 'None' },
    { value: 'attract', label: 'Attract' },
    { value: 'repel', label: 'Repel' },
    { value: 'swirl', label: 'Swirl' },
    { value: 'reveal', label: 'Reveal' },
  ];

  type NumericSplatControl = {
    key: keyof SplatContent;
    label: string;
    min: number;
    max: number;
    step: number;
    fallback: number;
    suffix?: string;
  };

  const animationControls: Partial<Record<SplatAnimationType, NumericSplatControl[]>> = {
    explode: [
      { key: 'explodeForce', label: 'Burst distance', min: 0, max: 8, step: 0.01, fallback: 2 },
      { key: 'explodeTurbulence', label: 'Turbulence', min: 0, max: 2, step: 0.01, fallback: 0.35 },
    ],
    implode: [
      { key: 'implodeForce', label: 'Collapse', min: 0, max: 1, step: 0.01, fallback: 0.85 },
      { key: 'implodeSpin', label: 'Core spin', min: 0, max: 8, step: 0.01, fallback: 1.5 },
    ],
    slice: [
      { key: 'sliceWidth', label: 'Band count', min: 0.5, max: 12, step: 0.1, fallback: 3 },
      { key: 'sliceSoftness', label: 'Band softness', min: 0.01, max: 0.95, step: 0.01, fallback: 0.2 },
      { key: 'sliceTravel', label: 'Travel', min: -5, max: 5, step: 0.01, fallback: 1 },
    ],
    peel: [
      { key: 'peelWidth', label: 'Peel width', min: 0.05, max: 2.5, step: 0.01, fallback: 0.55 },
      { key: 'peelCurl', label: 'Curl', min: 0, max: 10, step: 0.01, fallback: 2.2 },
    ],
    voxelSnap: [{ key: 'voxelGridSize', label: 'Grid density', min: 2, max: 64, step: 1, fallback: 16 }],
    gravity: [
      { key: 'gravityStrength', label: 'Gravity', min: 0, max: 12, step: 0.01, fallback: 2 },
      { key: 'gravitySpread', label: 'Air spread', min: 0, max: 2, step: 0.01, fallback: 0.25 },
      { key: 'gravityFloor', label: 'Floor', min: -5, max: 2, step: 0.01, fallback: -2 },
    ],
    swarm: [
      { key: 'swarmCohesion', label: 'Cohesion', min: 0, max: 2, step: 0.01, fallback: 0.3 },
      { key: 'swarmSeparation', label: 'Separation', min: 0, max: 2, step: 0.01, fallback: 0.4 },
      { key: 'swarmAlignment', label: 'Flow alignment', min: 0, max: 2, step: 0.01, fallback: 0.6 },
    ],
    morph: [{ key: 'morphRoundness', label: 'Roundness', min: 0, max: 1, step: 0.01, fallback: 1 }],
    orbit: [{ key: 'turntableTilt', label: 'Axis tilt', min: -90, max: 90, step: 1, fallback: 0, suffix: '°' }],
    wave3d: [
      { key: 'animationWaveFrequency', label: 'Frequency', min: 0.25, max: 20, step: 0.01, fallback: 5 },
      { key: 'animationWaveAmplitude', label: 'Amplitude', min: 0, max: 3, step: 0.01, fallback: 0.3 },
    ],
    scatter: [
      { key: 'scatterDistance', label: 'Distance', min: 0, max: 8, step: 0.01, fallback: 2 },
      { key: 'scatterRandomness', label: 'Granularity', min: 0.25, max: 24, step: 0.01, fallback: 8 },
    ],
    spiral: [
      { key: 'spiralRadius', label: 'Radius', min: 0, max: 5, step: 0.01, fallback: 0.75 },
      { key: 'spiralTurns', label: 'Turns', min: -8, max: 8, step: 0.01, fallback: 2 },
      { key: 'spiralLift', label: 'Lift', min: -5, max: 5, step: 0.01, fallback: 1 },
    ],
    tumble: [{ key: 'tumbleSpread', label: 'Axis spread', min: 0, max: 3, step: 0.01, fallback: 1 }],
    breathe: [{ key: 'breatheAmount', label: 'Expansion', min: 0, max: 1, step: 0.01, fallback: 0.15 }],
    drift: [{ key: 'driftAmount', label: 'Drift range', min: 0, max: 2, step: 0.01, fallback: 0.25 }],
    vortex: [{ key: 'vortexTwist', label: 'Twist', min: -10, max: 10, step: 0.01, fallback: 2 }],
  };

  // Collapsible sections state
  let showImportOrientation = true;
  let showRendering = true;
  let showAnimation = true;
  let showDisplacement = false;
  let showLighting = false;
  let showMaterial = false;
  let showAtmosphere = false;
  let showVolumetrics = false;
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
  $: splatLayerIndex = layer ? $project.layers.findIndex((candidate) => candidate.id === layer.id) : -1;

  // Unified update function — routes to VJ callback or mapping store
  function doUpdate(updates: Partial<SplatContent>) {
    const normalizedUpdates: Partial<SplatContent> = { ...updates };
    if (updates.colorEffect !== undefined) normalizedUpdates.colorEffectType = updates.colorEffect;
    if (updates.opacityEffect !== undefined) normalizedUpdates.opacityEffectType = updates.opacityEffect;
    if (updates.creativeEffect !== undefined) normalizedUpdates.creativeEffectType = updates.creativeEffect;
    if (updates.sizeAttenuation !== undefined) normalizedUpdates.pointSizeAttenuation = updates.sizeAttenuation;
    if (updates.displacementAmount !== undefined) normalizedUpdates.displacementIntensity = updates.displacementAmount;
    if (updates.displacementScale !== undefined) normalizedUpdates.noiseScale = updates.displacementScale;
    if (updates.displacementSpeed !== undefined) normalizedUpdates.noiseSpeed = updates.displacementSpeed;
    if (updates.displacementType === 'audioReactive') normalizedUpdates.audioEnabled = true;
    if (updates.mouseInteraction !== undefined) {
      normalizedUpdates.mouseMode = updates.mouseInteraction === 'none' ? 'attract' : updates.mouseInteraction;
      normalizedUpdates.mouseInfluence = updates.mouseInteraction === 'none' ? 0 : Math.max(sc?.mouseInfluence ?? 0, 1);
    }
    if (onUpdate) {
      onUpdate(normalizedUpdates);
    } else if (layer) {
      project.updateSplatContent(layer.id, normalizedUpdates);
      scheduleHistorySnapshot(`splat:${layer.id}:${Object.keys(normalizedUpdates).sort().join(',')}`);
      for (const [paramKey, value] of Object.entries(normalizedUpdates)) {
        const descriptor = SPLAT_AUTOMATABLE_PARAM_MAP.get(paramKey as keyof SplatContent & string);
        if (!descriptor || typeof value !== 'number') continue;
        keyframeTimeline.autoRecord(
          layer.id,
          `splat:${paramKey}`,
          value,
          descriptor.label,
          'number',
        );
      }
    }
  }

  function updateNumericControl(key: keyof SplatContent, value: number) {
    doUpdate({ [key]: value } as Partial<SplatContent>);
  }

  function numericControlValue(control: NumericSplatControl): number {
    const value = sc?.[control.key];
    return typeof value === 'number' ? value : control.fallback;
  }

  function splatParamValue(param: SplatParamDescriptor): number {
    const value = sc?.[param.key];
    return typeof value === 'number' ? value : param.min;
  }

  function formatSplatParamValue(param: SplatParamDescriptor, value: number): string {
    if (param.suffix === '%') return `${Math.round(value * 100)}%`;
    if (param.suffix === '°') return `${Math.round(value)}°`;
    if (param.step >= 1) return value.toFixed(0);
    if (param.step >= 0.1) return value.toFixed(1);
    if (param.step >= 0.01) return value.toFixed(2);
    return value.toFixed(3);
  }

  // Blob URLs stay alive for the lifetime of their layer. Panel teardown happens
  // during normal mode switches and must not invalidate an otherwise live source.
  // They are tracked per URL in splatBlobNames (module scope).

  function frameObject() {
    doUpdate({
      scaleUniform: 1,
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,
      positionX: 0,
      positionY: 0,
      positionZ: 0,
      cameraDistance: 5,
      cameraOrbitX: 0,
      cameraOrbitY: 0,
      cameraRoll: 0,
      cameraPanX: 0,
      cameraPanY: 0,
    });
  }

  function applyImportOrientation(orientation: SplatImportOrientation) {
    if (orientation === 'auto') {
      if (
        !Number.isFinite(sc.autoLevelRotationX) ||
        !Number.isFinite(sc.autoLevelRotationY) ||
        !Number.isFinite(sc.autoLevelRotationZ)
      ) {
        return;
      }
      doUpdate({ importOrientation: 'auto' });
      return;
    }

    if (orientation === 'custom') {
      doUpdate({ importOrientation: 'custom' });
      return;
    }

    const [importRotationX, importRotationY, importRotationZ] =
      splatImportOrientationRotation(orientation);
    doUpdate({
      importOrientation: orientation,
      importRotationX,
      importRotationY,
      importRotationZ,
    });
  }

  function setCurrentAsUpright() {
    doUpdate(bakeSplatManualRotationAsUpright(sc));
  }

  $: resolvedImportRotation = sc
    ? resolveSplatImportRotation(sc)
    : ([0, 0, 0] as [number, number, number]);
  $: hasAutoLevelSuggestion =
    Number.isFinite(sc?.autoLevelRotationX) &&
    Number.isFinite(sc?.autoLevelRotationY) &&
    Number.isFinite(sc?.autoLevelRotationZ);

  // File input handler
  async function handleFileSelect(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;

    // In VJ mode, we don't require a layer — content comes from clip
    if (!isVJMode && !layer) return;

    const file = input.files[0];
    const ext = file.name.split('.').pop()?.toLowerCase();

    try {
      // The URL this layer (or clip) shows now; other layers keep theirs.
      const previousUrl = sc?.filePath;
      if (ext === 'splat') {
        // Native .splat format — create blob URL, Canvas will detect by extension
        const { assetRef, runtimeUrl: blobUrl } = createAssetRefFromFile(file);
        splatBlobNames.set(blobUrl, file.name);
        // Store the original filename so Canvas can detect .splat format
        doUpdate({
          filePath: blobUrl,
          dataType: 'gaussian',
          renderMode: 'gaussians',
          _originalFileName: file.name,
          _assetRef: assetRef,
        } as any);
        if (previousUrl !== blobUrl) releaseSplatBlobUrl(previousUrl);
      } else {
        // PLY parsing and GPU upload are owned by Canvas. Parsing here used to
        // load every large file twice and dismissed the loader before upload.
        const { assetRef, runtimeUrl: blobUrl } = createAssetRefFromFile(file);
        splatBlobNames.set(blobUrl, file.name);

        const updates: Partial<SplatContent> = {
          filePath: blobUrl,
          pointCount: 0,
          activePointCount: 0,
          sourcePointCount: 0,
          _assetRef: assetRef,
        };

        doUpdate(updates);
        if (previousUrl !== blobUrl) releaseSplatBlobUrl(previousUrl);
      }
    } catch (err) {
      console.error('Failed to load splat file:', err);
    }
  }

  // Display-friendly filename (extract from blob URL or show stored name)
  $: displayFileName = (sc?.filePath ? splatBlobNames.get(sc.filePath) : undefined)
    || (sc?.filePath?.startsWith('blob:') ? 'Loaded File' : sc?.filePath || '');
</script>

{#snippet splatModButton(paramKey: keyof SplatContent)}
  {@const param = SPLAT_AUTOMATABLE_PARAM_MAP.get(paramKey as keyof SplatContent & string)}
  {#if !isVJMode && splatLayerIndex >= 0 && param}
    <EffectParamRow
      buttonOnly={true}
      label={param.label}
      value={splatParamValue(param)}
      min={param.min}
      max={param.max}
      step={param.step}
      layerIndex={splatLayerIndex}
      effectId=""
      paramName={param.key}
      effectKind="splat"
      target="mapping"
      displayValue={(nextValue) => formatSplatParamValue(param, nextValue)}
      onChange={(nextValue) => updateNumericControl(param.key, nextValue)}
    />
  {/if}
{/snippet}

{#if isVJMode ? sc : layer && sc}
  <div data-help-page="point-clouds" class="splat-panel" class:compact>
    {#if !compact}<h3>Splat / point cloud</h3>{/if}

    <!-- File Loading -->
    <div class="section">
      <label class="section-label">Point Cloud / Splat File</label>
      <div class="file-row">
        {#if onFileLoad}
          <button class="file-button" onclick={onFileLoad}>Load file</button>
        {:else}
          <input type="file" accept=".ply,.splat" onchange={handleFileSelect} id="ply-file-input" />
          <label for="ply-file-input" class="file-button">Load PLY/splat</label>
        {/if}
      </div>
      {#if sc.filePath}
        <div class="file-info">
          <span class="filename">{displayFileName || 'Loaded PLY'}</span>
          <span class="point-count">
            {sc.pointCount.toLocaleString()} points
            {#if (sc.sourcePointCount ?? 0) > sc.pointCount}
              / {(sc.sourcePointCount ?? 0).toLocaleString()} source
            {/if}
          </span>
          <span class="data-type">{sc.dataType === 'gaussian' ? 'Gaussian Splat' : 'Point Cloud'}</span>
        </div>

        <div class="property-row">
          <label>Point density</label>
          <input
            type="range"
            min="0.01"
            max="1"
            step="0.01"
            value={sc.pointDensity ?? 1}
            oninput={(e) => doUpdate({ pointDensity: parseFloat((e.target as HTMLInputElement).value) })}
            data-midi-path="map:splat:pointDensity"
            data-midi-label="Point Density"
            data-midi-min="0.01"
            data-midi-max="1"
            data-midi-step="0.01"
          />
          {@render splatModButton('pointDensity')}
          <span class="value">{((sc.pointDensity ?? 1) * 100).toFixed(0)}%</span>
        </div>
        <div class="density-info">
          <span>Active: {Math.floor(sc.pointCount * (sc.pointDensity ?? 1)).toLocaleString()} pts</span>
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
              Use texture map
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
                    texturePath: '', // Clear path when changing type
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
                      const previousTexture = sc.texturePath;
                      const { assetRef, runtimeUrl: blobUrl } = createAssetRefFromFile(file);
                      splatBlobNames.set(blobUrl, file.name);
                      doUpdate({ texturePath: blobUrl, _textureAssetRef: assetRef } as any);
                      if (previousTexture !== blobUrl) releaseSplatBlobUrl(previousTexture);
                    } else {
                      // For images, embed as data URL (small assets) AND keep
                      // the AssetRef so the original disk path is recoverable
                      // if the user re-uses the same image elsewhere.
                      const previousTexture = sc.texturePath;
                      const { assetRef, runtimeUrl } = createAssetRefFromFile(file);
                      // Only the ref is kept; the image goes inline below.
                      URL.revokeObjectURL(runtimeUrl);
                      const reader = new FileReader();
                      reader.onload = () => {
                        const dataUrl = reader.result as string;
                        // Promote the dataUrl into the assetRef so save/reload
                        // doesn't have to copy the image — it's already inline.
                        const refWithData = { ...assetRef, kind: 'embedded' as const, dataUrl };
                        doUpdate({ texturePath: dataUrl, _textureAssetRef: refWithData } as any);
                        releaseSplatBlobUrl(previousTexture);
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
                  <img
                    src={sc.texturePath}
                    alt="Texture preview"
                    style="max-width: 100%; max-height: 60px; object-fit: contain;"
                  />
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
                <option value="planarXY">Planar XY (front)</option>
                <option value="planarXZ">Planar xz (top)</option>
                <option value="planarYZ">Planar yz (side)</option>
                <option value="box">Box</option>
                <option value="native">Native (from file)</option>
              </select>
            </div>

            <div class="property-row">
              <label>Blend</label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={sc.textureBlend ?? 0.5}
                oninput={(e) => doUpdate({ textureBlend: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:textureBlend"
                data-midi-label="Texture Blend"
                data-midi-min="0"
                data-midi-max="1"
                data-midi-step="0.01"
              />
              {@render splatModButton('textureBlend')}
              <span class="value">{((sc.textureBlend ?? 0.5) * 100).toFixed(0)}%</span>
            </div>

            <div class="property-row">
              <label>Scale</label>
              <input
                type="range"
                min="0.1"
                max="5"
                step="0.1"
                value={sc.textureScale ?? 1}
                oninput={(e) => doUpdate({ textureScale: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:textureScale"
                data-midi-label="Texture Scale"
                data-midi-min="0.1"
                data-midi-max="5"
                data-midi-step="0.1"
              />
              {@render splatModButton('textureScale')}
              <span class="value">{(sc.textureScale ?? 1).toFixed(1)}</span>
            </div>

            <div class="property-row">
              <label>Offset X</label>
              <input
                type="range"
                min="-1"
                max="1"
                step="0.01"
                value={sc.textureOffsetX ?? 0}
                oninput={(e) => doUpdate({ textureOffsetX: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:textureOffsetX"
                data-midi-label="Texture Offset X"
                data-midi-min="-1"
                data-midi-max="1"
                data-midi-step="0.01"
              />
              {@render splatModButton('textureOffsetX')}
              <span class="value">{(sc.textureOffsetX ?? 0).toFixed(2)}</span>
            </div>

            <div class="property-row">
              <label>Offset Y</label>
              <input
                type="range"
                min="-1"
                max="1"
                step="0.01"
                value={sc.textureOffsetY ?? 0}
                oninput={(e) => doUpdate({ textureOffsetY: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:textureOffsetY"
                data-midi-label="Texture Offset Y"
                data-midi-min="-1"
                data-midi-max="1"
                data-midi-step="0.01"
              />
              {@render splatModButton('textureOffsetY')}
              <span class="value">{(sc.textureOffsetY ?? 0).toFixed(2)}</span>
            </div>
          {/if}
        </div>
      {:else}
        <p class="hint">Load a .ply or .splat file to visualize point cloud or gaussian splat data</p>
      {/if}
    </div>

    <!-- Import Orientation Section -->
    <div class="section collapsible" class:open={showImportOrientation}>
      <button class="section-header" onclick={() => (showImportOrientation = !showImportOrientation)}>
        <span>Import Orientation</span>
        <span class="chevron">{showImportOrientation ? '−' : '+'}</span>
      </button>
      {#if showImportOrientation}
        <div class="section-content">
          <div class="property-row">
            <label>Source up</label>
            <select
              value={sc.importOrientation ?? 'authored'}
              onchange={(e) =>
                applyImportOrientation(
                  (e.target as HTMLSelectElement).value as SplatImportOrientation,
                )}
            >
              {#each SPLAT_IMPORT_ORIENTATION_OPTIONS as option}
                <option
                  value={option.value}
                  disabled={option.value === 'auto' && !hasAutoLevelSuggestion}
                >
                  {option.label}
                </option>
              {/each}
            </select>
          </div>

          <div class="orientation-actions">
            <button
              class="reset-button"
              disabled={!hasAutoLevelSuggestion}
              onclick={() => applyImportOrientation('auto')}
            >
              Auto level
            </button>
            <button class="reset-button" onclick={setCurrentAsUpright}>
              Set current as upright
            </button>
          </div>

          <div class="orientation-readout">
            <span>X {resolvedImportRotation[0].toFixed(1)}°</span>
            <span>Y {resolvedImportRotation[1].toFixed(1)}°</span>
            <span>Z {resolvedImportRotation[2].toFixed(1)}°</span>
            {#if sc.importOrientation === 'auto' && Number.isFinite(sc.autoLevelConfidence)}
              <span>{Math.round((sc.autoLevelConfidence ?? 0) * 100)}% confidence</span>
            {/if}
          </div>
          <p class="section-note">Applied before transform, animation, and interaction.</p>
        </div>
      {/if}
    </div>

    <!-- Rendering Section -->
    <div class="section collapsible" class:open={showRendering}>
      <button class="section-header" onclick={() => (showRendering = !showRendering)}>
        <span>Rendering</span>
        <span class="chevron">{showRendering ? '−' : '+'}</span>
      </button>
      {#if showRendering}
        <div class="section-content">
          <div class="property-row">
            <label>Render mode</label>
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
            <label>Point size</label>
            <input
              type="range"
              min="0.1"
              max="20"
              step="0.05"
              value={sc.pointSize}
              oninput={(e) => doUpdate({ pointSize: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:splat:pointSize"
              data-midi-label="Point Size"
              data-midi-min="0.1"
              data-midi-max="5"
              data-midi-step="0.05"
            />
            {@render splatModButton('pointSize')}
            <span class="value">{sc.pointSize.toFixed(2)}</span>
          </div>

          <div class="property-row">
            <label>Global scale</label>
            <input
              type="range"
              min="0.01"
              max="10"
              step="0.01"
              value={sc.scaleUniform}
              oninput={(e) => doUpdate({ scaleUniform: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:splat:scaleUniform"
              data-midi-label="Global Scale"
              data-midi-min="0.01"
              data-midi-max="10"
              data-midi-step="0.01"
            />
            {@render splatModButton('scaleUniform')}
            <span class="value">{sc.scaleUniform.toFixed(2)}</span>
          </div>

          <div class="property-row">
            <label>Global opacity</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={sc.opacity}
              oninput={(e) => doUpdate({ opacity: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:splat:opacity"
              data-midi-label="Global Opacity"
              data-midi-min="0"
              data-midi-max="1"
              data-midi-step="0.01"
            />
            {@render splatModButton('opacity')}
            <span class="value">{(sc.opacity * 100).toFixed(0)}%</span>
          </div>

          <div class="property-row">
            <label>Background</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={sc.backgroundOpacity ?? 0}
              oninput={(e) => doUpdate({ backgroundOpacity: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:splat:backgroundOpacity"
              data-midi-label="Background Opacity"
              data-midi-min="0"
              data-midi-max="1"
              data-midi-step="0.01"
            />
            {@render splatModButton('backgroundOpacity')}
            <span class="value">{((sc.backgroundOpacity ?? 0) * 100).toFixed(0)}%</span>
          </div>

          <div class="property-row">
            <label>BG color</label>
            <input
              type="color"
              value={sc.backgroundColor ?? '#000000'}
              oninput={(e) => doUpdate({ backgroundColor: (e.target as HTMLInputElement).value })}
              data-midi-path="map:splat:backgroundColor"
              data-midi-label="Background Color"
            />
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
              Size attenuation
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
              Depth test
            </label>
          </div>

          <div class="property-row checkbox">
            <label title="Points hide what is behind them. Turn off for soft, see-through points.">
              <input
                type="checkbox"
                checked={sc.solidPoints === true}
                disabled={sc.renderMode === 'gaussians' || sc.dataType === 'gaussian'}
                onchange={(e) => doUpdate({ solidPoints: (e.target as HTMLInputElement).checked })}
                data-midi-path="map:splat:solidPoints"
                data-midi-label="Solid Points"
                data-midi-mode="toggle"
              />
              Solid points
            </label>
          </div>

          <div class="property-row checkbox">
            <label>
              <input
                type="checkbox"
                checked={sc.showTransformGizmo !== false}
                onchange={(e) => doUpdate({ showTransformGizmo: (e.target as HTMLInputElement).checked })}
                data-midi-path="map:splat:showTransformGizmo"
                data-midi-label="Show Transform Gizmo"
                data-midi-mode="toggle"
              />
              Show transform gizmo
            </label>
          </div>
        </div>
      {/if}
    </div>

    <!-- Animation Section -->
    <div class="section collapsible" class:open={showAnimation}>
      <button class="section-header" onclick={() => (showAnimation = !showAnimation)}>
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
              data-midi-max="16"
              data-midi-step="1"
              data-midi-discrete="none,explode,implode,slice,voxelSnap,peel,gravity,swarm,morph,orbit,wave3d,scatter,spiral,tumble,breathe,drift,vortex"
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
                type="range"
                min="0"
                max="5"
                step="0.01"
                value={sc.animationSpeed}
                oninput={(e) => doUpdate({ animationSpeed: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:animationSpeed"
                data-midi-label="Animation Speed"
                data-midi-min="0"
                data-midi-max="5"
                data-midi-step="0.01"
              />
              {@render splatModButton('animationSpeed')}
              <span class="value">{sc.animationSpeed.toFixed(2)}</span>
            </div>

            <div class="property-row">
              <label>Intensity</label>
              <input
                type="range"
                min="0"
                max="2"
                step="0.01"
                value={sc.animationIntensity}
                oninput={(e) => doUpdate({ animationIntensity: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:animationIntensity"
                data-midi-label="Animation Intensity"
                data-midi-min="0"
                data-midi-max="2"
                data-midi-step="0.01"
              />
              {@render splatModButton('animationIntensity')}
              <span class="value">{sc.animationIntensity.toFixed(2)}</span>
            </div>

            {#each animationControls[sc.animationType] ?? [] as control}
              <div class="property-row">
                <label title={control.label}>{control.label}</label>
                <input
                  type="range"
                  min={control.min}
                  max={control.max}
                  step={control.step}
                  value={numericControlValue(control)}
                  oninput={(e) =>
                    updateNumericControl(control.key, parseFloat((e.target as HTMLInputElement).value))}
                  data-midi-path={`map:splat:${String(control.key)}`}
                  data-midi-label={control.label}
                  data-midi-min={control.min}
                  data-midi-max={control.max}
                  data-midi-step={control.step}
                />
                {@render splatModButton(control.key)}
                <span class="value">
                  {control.step >= 1
                    ? numericControlValue(control).toFixed(0)
                    : numericControlValue(control).toFixed(2)}{control.suffix ?? ''}
                </span>
              </div>
            {/each}

            {#if sc.animationType === 'slice' || sc.animationType === 'peel'}
              <div class="property-row">
                <label>Axis</label>
                <select
                  value={sc.peelAxis ?? 'y'}
                  onchange={(e) => doUpdate({ peelAxis: (e.target as HTMLSelectElement).value as 'x' | 'y' | 'z' })}
                  data-midi-path="map:splat:peelAxis"
                  data-midi-label="Animation Axis"
                  data-midi-min="0"
                  data-midi-max="2"
                  data-midi-step="1"
                  data-midi-discrete="x,y,z"
                >
                  <option value="x">Horizontal X</option>
                  <option value="y">Vertical Y</option>
                  <option value="z">Depth Z</option>
                </select>
              </div>
            {/if}

            {#if sc.animationType === 'peel'}
              <div class="property-row">
                <label>Direction</label>
                <select
                  value={sc.peelDirection ?? 1}
                  onchange={(e) =>
                    doUpdate({ peelDirection: parseInt((e.target as HTMLSelectElement).value, 10) as 1 | -1 })}
                  data-midi-path="map:splat:peelDirection"
                  data-midi-label="Peel Direction"
                  data-midi-min="0"
                  data-midi-max="1"
                  data-midi-step="1"
                  data-midi-discrete="1,-1"
                >
                  <option value={1}>Forward</option>
                  <option value={-1}>Reverse</option>
                </select>
              </div>
            {/if}

            {#if sc.animationType === 'wave3d'}
              <div class="property-row">
                <label>Axis</label>
                <select
                  value={sc.waveAxis ?? 'y'}
                  onchange={(e) => doUpdate({ waveAxis: (e.target as HTMLSelectElement).value as 'x' | 'y' | 'z' })}
                  data-midi-path="map:splat:waveAxis"
                  data-midi-label="Wave Axis"
                  data-midi-min="0"
                  data-midi-max="2"
                  data-midi-step="1"
                  data-midi-discrete="x,y,z"
                >
                  <option value="x">X</option>
                  <option value="y">Y</option>
                  <option value="z">Z</option>
                </select>
              </div>
            {/if}

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
                Loop animation
              </label>
            </div>

            {#if sc.animationLoop}
              <div class="property-row checkbox">
                <label>
                  <input
                    type="checkbox"
                    checked={sc.animationPingPong ?? false}
                    onchange={(e) => doUpdate({ animationPingPong: (e.target as HTMLInputElement).checked })}
                    data-midi-path="map:splat:animationPingPong"
                    data-midi-label="Ping Pong Animation"
                    data-midi-mode="toggle"
                  />
                  Ping pong
                </label>
              </div>
            {:else}
              <div class="property-row">
                <label>Progress</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.001"
                  value={sc.animationProgress ?? 0}
                  oninput={(e) =>
                    doUpdate({ animationProgress: parseFloat((e.target as HTMLInputElement).value) })}
                  data-midi-path="map:splat:animationProgress"
                  data-midi-label="Animation Progress"
                  data-midi-min="0"
                  data-midi-max="1"
                  data-midi-step="0.001"
                />
                {@render splatModButton('animationProgress')}
                <span class="value">{((sc.animationProgress ?? 0) * 100).toFixed(0)}%</span>
              </div>
            {/if}
          {/if}
        </div>
      {/if}
    </div>

    <!-- Displacement Section -->
    <div class="section collapsible" class:open={showDisplacement}>
      <button class="section-header" onclick={() => (showDisplacement = !showDisplacement)}>
        <span>Displacement</span>
        <span class="chevron">{showDisplacement ? '−' : '+'}</span>
      </button>
      {#if showDisplacement}
        <div class="section-content">
          <div class="property-row">
            <label>Type</label>
            <select
              value={sc.displacementType}
              onchange={(e) =>
                doUpdate({ displacementType: (e.target as HTMLSelectElement).value as SplatDisplacementType })}
              data-midi-path="map:splat:displacementType"
              data-midi-label="Displacement Type"
              data-midi-min="0"
              data-midi-max="11"
              data-midi-step="1"
              data-midi-discrete="none,noise,audioReactive,wave,glitch,wind,magnetic,ripple,curlNoise,twist,radialPulse,scanline"
            >
              {#each displacementTypes as disp}
                <option value={disp.value}>{disp.label}</option>
              {/each}
            </select>
          </div>

          {#if sc.displacementType !== 'none'}
            <div class="property-row">
              <label>Amount</label>
              <input
                type="range"
                min="0"
                max="3"
                step="0.01"
                value={sc.displacementAmount ?? sc.displacementIntensity ?? 0.5}
                oninput={(e) => doUpdate({ displacementAmount: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:displacementAmount"
                data-midi-label="Displacement Amount"
                data-midi-min="0"
                data-midi-max="3"
                data-midi-step="0.01"
              />
              {@render splatModButton('displacementAmount')}
              <span class="value">{(sc.displacementAmount ?? sc.displacementIntensity ?? 0.5).toFixed(2)}</span>
            </div>

            <div class="property-row">
              <label>Scale</label>
              <input
                type="range"
                min="0.1"
                max="10"
                step="0.1"
                value={sc.displacementScale ?? sc.noiseScale ?? 1}
                oninput={(e) => doUpdate({ displacementScale: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:displacementScale"
                data-midi-label="Displacement Scale"
                data-midi-min="0.1"
                data-midi-max="10"
                data-midi-step="0.1"
              />
              {@render splatModButton('displacementScale')}
              <span class="value">{(sc.displacementScale ?? sc.noiseScale ?? 1).toFixed(1)}</span>
            </div>

            <div class="property-row">
              <label>Speed</label>
              <input
                type="range"
                min="0"
                max="5"
                step="0.01"
                value={sc.displacementSpeed ?? sc.noiseSpeed ?? 1}
                oninput={(e) => doUpdate({ displacementSpeed: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:displacementSpeed"
                data-midi-label="Displacement Speed"
                data-midi-min="0"
                data-midi-max="5"
                data-midi-step="0.01"
              />
              {@render splatModButton('displacementSpeed')}
              <span class="value">{(sc.displacementSpeed ?? sc.noiseSpeed ?? 1).toFixed(2)}</span>
            </div>

            {#if sc.displacementType === 'audioReactive'}
              <div class="property-row checkbox">
                <label>
                  <input
                    type="checkbox"
                    checked={sc.audioEnabled ?? true}
                    onchange={(e) => doUpdate({ audioEnabled: (e.target as HTMLInputElement).checked })}
                    data-midi-path="map:splat:audioEnabled"
                    data-midi-label="Audio Displacement"
                    data-midi-mode="toggle"
                  />
                  Audio displacement
                </label>
              </div>

              <div class="property-row">
                <label>Band</label>
                <select
                  value={sc.audioBand ?? 'all'}
                  onchange={(e) => doUpdate({ audioBand: (e.target as HTMLSelectElement).value as any })}
                  data-midi-path="map:splat:audioBand"
                  data-midi-label="Audio Band"
                  data-midi-min="0"
                  data-midi-max="6"
                  data-midi-step="1"
                  data-midi-discrete="all,sub,bass,lowMid,mid,highMid,high"
                >
                  <option value="all">Full mix</option>
                  <option value="sub">Sub</option>
                  <option value="bass">Bass</option>
                  <option value="lowMid">Low mid</option>
                  <option value="mid">Mid</option>
                  <option value="highMid">High mid</option>
                  <option value="high">High</option>
                </select>
              </div>

              <div class="property-row">
                <label>Sensitivity</label>
                <input
                  type="range"
                  min="0"
                  max="4"
                  step="0.01"
                  value={sc.audioSensitivity ?? 1}
                  oninput={(e) => doUpdate({ audioSensitivity: parseFloat((e.target as HTMLInputElement).value) })}
                  data-midi-path="map:splat:audioSensitivity"
                  data-midi-label="Audio Sensitivity"
                  data-midi-min="0"
                  data-midi-max="4"
                  data-midi-step="0.01"
                />
                {@render splatModButton('audioSensitivity')}
                <span class="value">{(sc.audioSensitivity ?? 1).toFixed(2)}</span>
              </div>

              <div class="property-row">
                <label>Response</label>
                <input
                  type="range"
                  min="0"
                  max="3"
                  step="0.01"
                  value={sc.audioDisplacement ?? 1}
                  oninput={(e) => doUpdate({ audioDisplacement: parseFloat((e.target as HTMLInputElement).value) })}
                  data-midi-path="map:splat:audioDisplacement"
                  data-midi-label="Audio Response"
                  data-midi-min="0"
                  data-midi-max="3"
                  data-midi-step="0.01"
                />
                {@render splatModButton('audioDisplacement')}
                <span class="value">{(sc.audioDisplacement ?? 1).toFixed(2)}</span>
              </div>

              <div class="property-row">
                <label>Smoothing</label>
                <input
                  type="range"
                  min="0"
                  max="0.98"
                  step="0.01"
                  value={sc.audioSmoothing ?? 0.7}
                  oninput={(e) => doUpdate({ audioSmoothing: parseFloat((e.target as HTMLInputElement).value) })}
                  data-midi-path="map:splat:audioSmoothing"
                  data-midi-label="Audio Smoothing"
                  data-midi-min="0"
                  data-midi-max="0.98"
                  data-midi-step="0.01"
                />
                {@render splatModButton('audioSmoothing')}
                <span class="value">{(sc.audioSmoothing ?? 0.7).toFixed(2)}</span>
              </div>
            {/if}
          {/if}
        </div>
      {/if}
    </div>

    <!-- Lighting Section -->
    <div class="section collapsible" class:open={showLighting}>
      <button class="section-header" onclick={() => (showLighting = !showLighting)}>
        <span>Lighting</span>
        <span class="chevron">{showLighting ? '−' : '+'}</span>
      </button>
      {#if showLighting}
        <div class="section-content">
          <div class="property-row checkbox">
            <label>
              <input
                type="checkbox"
                checked={sc.lightingEnabled ?? true}
                onchange={(e) => doUpdate({ lightingEnabled: (e.target as HTMLInputElement).checked })}
                data-midi-path="map:splat:lightingEnabled"
                data-midi-label="Point Lighting"
                data-midi-mode="toggle"
              />
              Enable lighting
            </label>
          </div>

          {#if sc.lightingEnabled ?? true}
            <div class="property-row">
              <label>Ambient</label>
              <input
                type="range"
                min="0"
                max="2"
                step="0.01"
                value={sc.ambientIntensity ?? 0.65}
                oninput={(e) => doUpdate({ ambientIntensity: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:ambientIntensity"
                data-midi-label="Ambient Light"
                data-midi-min="0"
                data-midi-max="2"
                data-midi-step="0.01"
              />
              {@render splatModButton('ambientIntensity')}
              <span class="value">{(sc.ambientIntensity ?? 0.65).toFixed(2)}</span>
            </div>

            <div class="property-row">
              <label>Key color</label>
              <input
                type="color"
                value={sc.keyLightColor ?? '#ffffff'}
                oninput={(e) => doUpdate({ keyLightColor: (e.target as HTMLInputElement).value })}
                data-midi-path="map:splat:keyLightColor"
                data-midi-label="Key Light Color"
              />
            </div>

            <div class="property-row">
              <label>Key power</label>
              <input
                type="range"
                min="0"
                max="4"
                step="0.01"
                value={sc.keyLightIntensity ?? 1.25}
                oninput={(e) => doUpdate({ keyLightIntensity: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:keyLightIntensity"
                data-midi-label="Key Light Power"
                data-midi-min="0"
                data-midi-max="4"
                data-midi-step="0.01"
              />
              {@render splatModButton('keyLightIntensity')}
              <span class="value">{(sc.keyLightIntensity ?? 1.25).toFixed(2)}</span>
            </div>

            <div class="property-row">
              <label>Key orbit</label>
              <input
                type="range"
                min="-180"
                max="180"
                step="1"
                value={sc.keyLightAzimuth ?? 35}
                oninput={(e) => doUpdate({ keyLightAzimuth: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:keyLightAzimuth"
                data-midi-label="Key Light Orbit"
                data-midi-min="-180"
                data-midi-max="180"
                data-midi-step="1"
              />
              {@render splatModButton('keyLightAzimuth')}
              <span class="value">{(sc.keyLightAzimuth ?? 35).toFixed(0)}°</span>
            </div>

            <div class="property-row">
              <label>Key height</label>
              <input
                type="range"
                min="-90"
                max="90"
                step="1"
                value={sc.keyLightElevation ?? 40}
                oninput={(e) => doUpdate({ keyLightElevation: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:keyLightElevation"
                data-midi-label="Key Light Height"
                data-midi-min="-90"
                data-midi-max="90"
                data-midi-step="1"
              />
              {@render splatModButton('keyLightElevation')}
              <span class="value">{(sc.keyLightElevation ?? 40).toFixed(0)}°</span>
            </div>

            <div class="property-row">
              <label>Rim color</label>
              <input
                type="color"
                value={sc.rimLightColor ?? '#66ccff'}
                oninput={(e) => doUpdate({ rimLightColor: (e.target as HTMLInputElement).value })}
                data-midi-path="map:splat:rimLightColor"
                data-midi-label="Rim Light Color"
              />
            </div>

            <div class="property-row">
              <label>Rim power</label>
              <input
                type="range"
                min="0"
                max="4"
                step="0.01"
                value={sc.rimLightIntensity ?? 0.8}
                oninput={(e) => doUpdate({ rimLightIntensity: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:rimLightIntensity"
                data-midi-label="Rim Light Power"
                data-midi-min="0"
                data-midi-max="4"
                data-midi-step="0.01"
              />
              {@render splatModButton('rimLightIntensity')}
              <span class="value">{(sc.rimLightIntensity ?? 0.8).toFixed(2)}</span>
            </div>

            <div class="property-row">
              <label>Rim orbit</label>
              <input
                type="range"
                min="-180"
                max="180"
                step="1"
                value={sc.rimLightAzimuth ?? -120}
                oninput={(e) => doUpdate({ rimLightAzimuth: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:rimLightAzimuth"
                data-midi-label="Rim Light Orbit"
                data-midi-min="-180"
                data-midi-max="180"
                data-midi-step="1"
              />
              {@render splatModButton('rimLightAzimuth')}
              <span class="value">{(sc.rimLightAzimuth ?? -120).toFixed(0)}°</span>
            </div>

            <div class="property-row">
              <label>Shadows</label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={sc.shadowStrength ?? 0.25}
                oninput={(e) => doUpdate({ shadowStrength: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:shadowStrength"
                data-midi-label="Shadow Strength"
                data-midi-min="0"
                data-midi-max="1"
                data-midi-step="0.01"
              />
              {@render splatModButton('shadowStrength')}
              <span class="value">{(sc.shadowStrength ?? 0.25).toFixed(2)}</span>
            </div>

            <div class="property-row">
              <label>Softness</label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={sc.shadowSoftness ?? 0.45}
                oninput={(e) => doUpdate({ shadowSoftness: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:shadowSoftness"
                data-midi-label="Shadow Softness"
                data-midi-min="0"
                data-midi-max="1"
                data-midi-step="0.01"
              />
              {@render splatModButton('shadowSoftness')}
              <span class="value">{(sc.shadowSoftness ?? 0.45).toFixed(2)}</span>
            </div>

            <div class="property-row">
              <label>Specular</label>
              <input
                type="range"
                min="0"
                max="2"
                step="0.01"
                value={sc.specularStrength ?? 0.35}
                oninput={(e) => doUpdate({ specularStrength: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:specularStrength"
                data-midi-label="Specular Strength"
                data-midi-min="0"
                data-midi-max="2"
                data-midi-step="0.01"
              />
              {@render splatModButton('specularStrength')}
              <span class="value">{(sc.specularStrength ?? 0.35).toFixed(2)}</span>
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Material Section -->
    <!-- Splat previously had a lighting rig but no material model at all.
         These shape how the lighting lands: lobe tightness, highlight and
         rim tints independent of light colour, plus a per-point glow. -->
    <div class="section collapsible" class:open={showMaterial}>
      <button class="section-header" onclick={() => (showMaterial = !showMaterial)}>
        <span>Material &amp; Glow</span>
        <span class="chevron">{showMaterial ? '−' : '+'}</span>
      </button>
      {#if showMaterial}
        <div class="section-content">
          <div class="property-row">
            <label>Shininess</label>
            <input
              type="range" min="1" max="128" step="1"
              value={sc.specularShininess ?? 24}
              oninput={(e) => doUpdate({ specularShininess: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:splat:specularShininess"
              data-midi-label="Shininess"
              data-midi-min="1" data-midi-max="128" data-midi-step="1"
            />
            {@render splatModButton('specularShininess')}
            <span class="value">{(sc.specularShininess ?? 24).toFixed(0)}</span>
          </div>

          <div class="property-row">
            <label>Metallic</label>
            <input
              type="range" min="0" max="1" step="0.01"
              value={sc.metallic ?? 0}
              oninput={(e) => doUpdate({ metallic: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:splat:metallic"
              data-midi-label="Metallic"
              data-midi-min="0" data-midi-max="1" data-midi-step="0.01"
            />
            {@render splatModButton('metallic')}
            <span class="value">{(sc.metallic ?? 0).toFixed(2)}</span>
          </div>

          <div class="property-row">
            <label>Fresnel power</label>
            <input
              type="range" min="0.5" max="8" step="0.05"
              value={sc.fresnelPower ?? 3}
              oninput={(e) => doUpdate({ fresnelPower: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:splat:fresnelPower"
              data-midi-label="Fresnel Power"
              data-midi-min="0.5" data-midi-max="8" data-midi-step="0.05"
            />
            {@render splatModButton('fresnelPower')}
            <span class="value">{(sc.fresnelPower ?? 3).toFixed(2)}</span>
          </div>

          <div class="property-row">
            <label>Emissive</label>
            <input
              type="range" min="0" max="3" step="0.01"
              value={sc.emissiveStrength ?? 0}
              oninput={(e) => doUpdate({ emissiveStrength: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:splat:emissiveStrength"
              data-midi-label="Emissive"
              data-midi-min="0" data-midi-max="3" data-midi-step="0.01"
            />
            {@render splatModButton('emissiveStrength')}
            <span class="value">{(sc.emissiveStrength ?? 0).toFixed(2)}</span>
          </div>

          <div class="property-row">
            <label>Specular tint</label>
            <input
              type="color"
              value={sc.specularTint ?? '#ffffff'}
              oninput={(e) => doUpdate({ specularTint: (e.target as HTMLInputElement).value })}
            />
          </div>

          <div class="property-row">
            <label>Rim tint</label>
            <input
              type="color"
              value={sc.rimTint ?? '#ffffff'}
              oninput={(e) => doUpdate({ rimTint: (e.target as HTMLInputElement).value })}
            />
          </div>

          <div class="subsection-label">Glow</div>
          <p class="hint">
            Per-point glow that stays welded to bright points as they move.
            For a full-frame bloom, add the Bloom effect from the layer's
            Effects list instead.
          </p>

          <div class="property-row">
            <label>Glow strength</label>
            <input
              type="range" min="0" max="3" step="0.01"
              value={sc.bloom ?? 0}
              oninput={(e) => doUpdate({ bloom: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:splat:bloom"
              data-midi-label="Glow Strength"
              data-midi-min="0" data-midi-max="3" data-midi-step="0.01"
            />
            {@render splatModButton('bloom')}
            <span class="value">{(sc.bloom ?? 0).toFixed(2)}</span>
          </div>

          <div class="property-row">
            <label>Glow threshold</label>
            <input
              type="range" min="0" max="1" step="0.01"
              value={sc.bloomThreshold ?? 0.5}
              oninput={(e) => doUpdate({ bloomThreshold: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:splat:bloomThreshold"
              data-midi-label="Glow Threshold"
              data-midi-min="0" data-midi-max="1" data-midi-step="0.01"
            />
            {@render splatModButton('bloomThreshold')}
            <span class="value">{(sc.bloomThreshold ?? 0.5).toFixed(2)}</span>
          </div>

          <div class="property-row">
            <label>Glow radius</label>
            <input
              type="range" min="1" max="4" step="0.05"
              value={sc.bloomRadius ?? 2}
              oninput={(e) => doUpdate({ bloomRadius: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:splat:bloomRadius"
              data-midi-label="Glow Radius"
              data-midi-min="1" data-midi-max="4" data-midi-step="0.05"
            />
            {@render splatModButton('bloomRadius')}
            <span class="value">{(sc.bloomRadius ?? 2).toFixed(2)}</span>
          </div>
        </div>
      {/if}
    </div>

    <!-- Volumetric Light Section -->
    <div class="section collapsible" class:open={showVolumetrics}>
      <button class="section-header" onclick={() => (showVolumetrics = !showVolumetrics)}>
        <span>Volumetric Light</span>
        <span class="chevron">{showVolumetrics ? '−' : '+'}</span>
      </button>
      {#if showVolumetrics}
        <div class="section-content">
          <div class="property-row checkbox">
            <label>
              <input
                type="checkbox"
                checked={sc.volumetricEnabled ?? false}
                onchange={(e) => doUpdate({ volumetricEnabled: (e.target as HTMLInputElement).checked })}
                data-midi-path="map:splat:volumetricEnabled"
                data-midi-label="Volumetric Light"
                data-midi-mode="toggle"
              />
              Enable light shafts
            </label>
          </div>
          <p class="section-note">
            Beams and cast shadows built from the cloud itself, lit by the Key Light above.
          </p>

          {#if sc.volumetricEnabled ?? false}
            <div class="property-row">
              <label>Haze density</label>
              <input
                type="range"
                min="0"
                max="3"
                step="0.01"
                value={sc.volumetricDensity ?? 1.2}
                oninput={(e) => doUpdate({ volumetricDensity: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:volumetricDensity"
                data-midi-label="Haze Density"
                data-midi-min="0"
                data-midi-max="3"
                data-midi-step="0.01"
              />
              {@render splatModButton('volumetricDensity')}
              <span class="value">{(sc.volumetricDensity ?? 1.2).toFixed(2)}</span>
            </div>

            <div class="property-row">
              <label>Haze colour</label>
              <input
                type="color"
                value={sc.volumetricColor ?? '#cfe0ff'}
                oninput={(e) => doUpdate({ volumetricColor: (e.target as HTMLInputElement).value })}
                data-midi-path="map:splat:volumetricColor"
                data-midi-label="Haze Colour"
              />
            </div>

            <div class="property-row">
              <label>Shaft power</label>
              <input
                type="range"
                min="0"
                max="3"
                step="0.01"
                value={sc.volumetricStrength ?? 1.4}
                oninput={(e) => doUpdate({ volumetricStrength: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:volumetricStrength"
                data-midi-label="Shaft Power"
                data-midi-min="0"
                data-midi-max="3"
                data-midi-step="0.01"
              />
              {@render splatModButton('volumetricStrength')}
              <span class="value">{(sc.volumetricStrength ?? 1.4).toFixed(2)}</span>
            </div>

            <div class="property-row">
              <label>Shadow density</label>
              <input
                type="range"
                min="0"
                max="6"
                step="0.01"
                value={sc.volumetricShadowDensity ?? 1.6}
                oninput={(e) => doUpdate({ volumetricShadowDensity: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:volumetricShadowDensity"
                data-midi-label="Shaft Shadow Density"
                data-midi-min="0"
                data-midi-max="6"
                data-midi-step="0.01"
              />
              {@render splatModButton('volumetricShadowDensity')}
              <span class="value">{(sc.volumetricShadowDensity ?? 1.6).toFixed(2)}</span>
            </div>

            <div class="property-row">
              <label>Cloud shadowing</label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={sc.volumetricShadowStrength ?? 0.5}
                oninput={(e) => doUpdate({ volumetricShadowStrength: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:volumetricShadowStrength"
                data-midi-label="Cloud Self Shadowing"
                data-midi-min="0"
                data-midi-max="1"
                data-midi-step="0.01"
              />
              {@render splatModButton('volumetricShadowStrength')}
              <span class="value">{(sc.volumetricShadowStrength ?? 0.5).toFixed(2)}</span>
            </div>

            <div class="property-row">
              <label>Shadow volume</label>
              <select
                value={String(sc.volumetricShadowRes ?? 0)}
                onchange={(e) => doUpdate({ volumetricShadowRes: parseInt((e.target as HTMLSelectElement).value, 10) })}
                data-midi-path="map:splat:volumetricShadowRes"
                data-midi-label="Shadow Volume Resolution"
                data-midi-discrete="0,32,48,64,80,96"
              >
                <option value="0">Auto (quality tier)</option>
                <option value="32">32³ (fast)</option>
                <option value="48">48³</option>
                <option value="64">64³</option>
                <option value="80">80³</option>
                <option value="96">96³ (sharp)</option>
              </select>
            </div>

            <div class="property-row">
              <label>Spot angle</label>
              <input
                type="range"
                min="5"
                max="180"
                step="1"
                value={sc.volumetricSpotAngle ?? 38}
                oninput={(e) => doUpdate({ volumetricSpotAngle: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:volumetricSpotAngle"
                data-midi-label="Spot Angle"
                data-midi-min="5"
                data-midi-max="180"
                data-midi-step="1"
              />
              {@render splatModButton('volumetricSpotAngle')}
              <span class="value">{Math.round(sc.volumetricSpotAngle ?? 38)}°</span>
            </div>

            <div class="property-row">
              <label>Spot softness</label>
              <input
                type="range"
                min="0.01"
                max="1"
                step="0.01"
                value={sc.volumetricSpotSoftness ?? 0.4}
                oninput={(e) => doUpdate({ volumetricSpotSoftness: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:volumetricSpotSoftness"
                data-midi-label="Spot Softness"
                data-midi-min="0.01"
                data-midi-max="1"
                data-midi-step="0.01"
              />
              {@render splatModButton('volumetricSpotSoftness')}
              <span class="value">{(sc.volumetricSpotSoftness ?? 0.4).toFixed(2)}</span>
            </div>

            <div class="property-row">
              <label>Light distance</label>
              <input
                type="range"
                min="1"
                max="20"
                step="0.05"
                value={sc.volumetricLightDistance ?? 6.5}
                oninput={(e) => doUpdate({ volumetricLightDistance: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:volumetricLightDistance"
                data-midi-label="Shaft Light Distance"
                data-midi-min="1"
                data-midi-max="20"
                data-midi-step="0.05"
              />
              {@render splatModButton('volumetricLightDistance')}
              <span class="value">{(sc.volumetricLightDistance ?? 6.5).toFixed(2)}</span>
            </div>

            <div class="property-row">
              <label>Scatter bias</label>
              <input
                type="range"
                min="-0.95"
                max="0.95"
                step="0.01"
                value={sc.volumetricAnisotropy ?? 0.6}
                oninput={(e) => doUpdate({ volumetricAnisotropy: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:volumetricAnisotropy"
                data-midi-label="Shaft Scatter Bias"
                data-midi-min="-0.95"
                data-midi-max="0.95"
                data-midi-step="0.01"
              />
              {@render splatModButton('volumetricAnisotropy')}
              <span class="value">{(sc.volumetricAnisotropy ?? 0.6).toFixed(2)}</span>
            </div>

            <p class="section-note">
              Beam direction follows Key Orbit / Key Pitch in the Lighting section.
            </p>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Atmosphere Section -->
    <div class="section collapsible" class:open={showAtmosphere}>
      <button class="section-header" onclick={() => (showAtmosphere = !showAtmosphere)}>
        <span>Fog / Smoke</span>
        <span class="chevron">{showAtmosphere ? '−' : '+'}</span>
      </button>
      {#if showAtmosphere}
        <div class="section-content">
          <div class="property-row checkbox">
            <label>
              <input
                type="checkbox"
                checked={sc.atmosphereEnabled ?? false}
                onchange={(e) => doUpdate({ atmosphereEnabled: (e.target as HTMLInputElement).checked })}
                data-midi-path="map:splat:atmosphereEnabled"
                data-midi-label="Point Atmosphere"
                data-midi-mode="toggle"
              />
              Enable atmosphere
            </label>
          </div>

          {#if sc.atmosphereEnabled}
            <div class="property-row">
              <label>Density</label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={sc.atmosphereDensity ?? 0.25}
                oninput={(e) => doUpdate({ atmosphereDensity: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:atmosphereDensity"
                data-midi-label="Atmosphere Density"
                data-midi-min="0"
                data-midi-max="1"
                data-midi-step="0.01"
              />
              {@render splatModButton('atmosphereDensity')}
              <span class="value">{(sc.atmosphereDensity ?? 0.25).toFixed(2)}</span>
            </div>

            <div class="property-row">
              <label>Fog color</label>
              <input
                type="color"
                value={sc.atmosphereColor ?? '#8aa4c8'}
                oninput={(e) => doUpdate({ atmosphereColor: (e.target as HTMLInputElement).value })}
                data-midi-path="map:splat:atmosphereColor"
                data-midi-label="Atmosphere Color"
              />
            </div>

            <div class="property-row">
              <label>Scale</label>
              <input
                type="range"
                min="0.1"
                max="8"
                step="0.01"
                value={sc.atmosphereScale ?? 1.5}
                oninput={(e) => doUpdate({ atmosphereScale: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:atmosphereScale"
                data-midi-label="Atmosphere Scale"
                data-midi-min="0.1"
                data-midi-max="8"
                data-midi-step="0.01"
              />
              {@render splatModButton('atmosphereScale')}
              <span class="value">{(sc.atmosphereScale ?? 1.5).toFixed(2)}</span>
            </div>

            <div class="property-row">
              <label>Turbulence</label>
              <input
                type="range"
                min="0"
                max="2"
                step="0.01"
                value={sc.atmosphereTurbulence ?? 0.7}
                oninput={(e) => doUpdate({ atmosphereTurbulence: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:atmosphereTurbulence"
                data-midi-label="Atmosphere Turbulence"
                data-midi-min="0"
                data-midi-max="2"
                data-midi-step="0.01"
              />
              {@render splatModButton('atmosphereTurbulence')}
              <span class="value">{(sc.atmosphereTurbulence ?? 0.7).toFixed(2)}</span>
            </div>

            <div class="property-row">
              <label>Drift speed</label>
              <input
                type="range"
                min="-2"
                max="2"
                step="0.01"
                value={sc.atmosphereSpeed ?? 0.25}
                oninput={(e) => doUpdate({ atmosphereSpeed: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:atmosphereSpeed"
                data-midi-label="Atmosphere Drift Speed"
                data-midi-min="-2"
                data-midi-max="2"
                data-midi-step="0.01"
              />
              {@render splatModButton('atmosphereSpeed')}
              <span class="value">{(sc.atmosphereSpeed ?? 0.25).toFixed(2)}</span>
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Color Effects Section -->
    <div class="section collapsible" class:open={showColorEffects}>
      <button class="section-header" onclick={() => (showColorEffects = !showColorEffects)}>
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
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={sc.colorEffectIntensity}
                oninput={(e) => doUpdate({ colorEffectIntensity: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:colorEffectIntensity"
                data-midi-label="Color Effect Intensity"
                data-midi-min="0"
                data-midi-max="1"
                data-midi-step="0.01"
              />
              {@render splatModButton('colorEffectIntensity')}
              <span class="value">{(sc.colorEffectIntensity * 100).toFixed(0)}%</span>
            </div>

            <div class="property-row">
              <label>Speed</label>
              <input
                type="range"
                min="0"
                max="5"
                step="0.01"
                value={sc.colorEffectSpeed}
                oninput={(e) => doUpdate({ colorEffectSpeed: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:colorEffectSpeed"
                data-midi-label="Color Effect Speed"
                data-midi-min="0"
                data-midi-max="5"
                data-midi-step="0.01"
              />
              {@render splatModButton('colorEffectSpeed')}
              <span class="value">{sc.colorEffectSpeed.toFixed(2)}</span>
            </div>

            {#if sc.colorEffect === 'depthGradient'}
              <div class="property-row">
                <label>Near color</label>
                <input
                  class="color-input"
                  type="color"
                  value={sc.depthColorNear ?? '#ff5c33'}
                  oninput={(e) => doUpdate({ depthColorNear: (e.target as HTMLInputElement).value })}
                  data-midi-path="map:splat:depthColorNear"
                  data-midi-label="Depth Near Color"
                />
              </div>
              <div class="property-row">
                <label>Far color</label>
                <input
                  class="color-input"
                  type="color"
                  value={sc.depthColorFar ?? '#3377ff'}
                  oninput={(e) => doUpdate({ depthColorFar: (e.target as HTMLInputElement).value })}
                  data-midi-path="map:splat:depthColorFar"
                  data-midi-label="Depth Far Color"
                />
              </div>
              <div class="property-row">
                <label>Depth bias</label>
                <input
                  type="range"
                  min="0.05"
                  max="0.95"
                  step="0.01"
                  value={sc.depthGradientBias ?? 0.5}
                  oninput={(e) => doUpdate({ depthGradientBias: parseFloat((e.target as HTMLInputElement).value) })}
                  data-midi-path="map:splat:depthGradientBias"
                  data-midi-label="Depth Gradient Bias"
                  data-midi-min="0.05"
                  data-midi-max="0.95"
                  data-midi-step="0.01"
                />
                {@render splatModButton('depthGradientBias')}
                <span class="value">{((sc.depthGradientBias ?? 0.5) * 100).toFixed(0)}%</span>
              </div>
            {/if}
          {/if}
        </div>
      {/if}
    </div>

    <!-- Opacity Effects Section -->
    <div class="section collapsible" class:open={showOpacityEffects}>
      <button class="section-header" onclick={() => (showOpacityEffects = !showOpacityEffects)}>
        <span>Opacity Effects</span>
        <span class="chevron">{showOpacityEffects ? '−' : '+'}</span>
      </button>
      {#if showOpacityEffects}
        <div class="section-content">
          <div class="property-row">
            <label>Effect</label>
            <select
              value={sc.opacityEffect}
              onchange={(e) =>
                doUpdate({ opacityEffect: (e.target as HTMLSelectElement).value as SplatOpacityEffectType })}
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
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={sc.opacityEffectIntensity}
                oninput={(e) => doUpdate({ opacityEffectIntensity: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:opacityEffectIntensity"
                data-midi-label="Opacity Effect Intensity"
                data-midi-min="0"
                data-midi-max="1"
                data-midi-step="0.01"
              />
              {@render splatModButton('opacityEffectIntensity')}
              <span class="value">{(sc.opacityEffectIntensity * 100).toFixed(0)}%</span>
            </div>

            {#if sc.opacityEffect === 'dof'}
              <div class="property-row">
                <label>Focus distance</label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="0.1"
                  value={sc.dofFocusDistance}
                  oninput={(e) => doUpdate({ dofFocusDistance: parseFloat((e.target as HTMLInputElement).value) })}
                  data-midi-path="map:splat:dofFocusDistance"
                  data-midi-label="DOF Focus Distance"
                  data-midi-min="0"
                  data-midi-max="100"
                  data-midi-step="0.1"
                />
                {@render splatModButton('dofFocusDistance')}
                <span class="value">{sc.dofFocusDistance.toFixed(1)}</span>
              </div>

              <div class="property-row">
                <label>Blur amount</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={sc.dofBlurAmount}
                  oninput={(e) => doUpdate({ dofBlurAmount: parseFloat((e.target as HTMLInputElement).value) })}
                  data-midi-path="map:splat:dofBlurAmount"
                  data-midi-label="DOF Blur Amount"
                  data-midi-min="0"
                  data-midi-max="1"
                  data-midi-step="0.01"
                />
                {@render splatModButton('dofBlurAmount')}
                <span class="value">{(sc.dofBlurAmount * 100).toFixed(0)}%</span>
              </div>
            {/if}

            {#if sc.opacityEffect === 'fog'}
              <div class="property-row">
                <label>Fog density</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={sc.fogDensity}
                  oninput={(e) => doUpdate({ fogDensity: parseFloat((e.target as HTMLInputElement).value) })}
                  data-midi-path="map:splat:fogDensity"
                  data-midi-label="Fog Density"
                  data-midi-min="0"
                  data-midi-max="1"
                  data-midi-step="0.01"
                />
                {@render splatModButton('fogDensity')}
                <span class="value">{(sc.fogDensity * 100).toFixed(0)}%</span>
              </div>

              <div class="property-row">
                <label>Fog color</label>
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
      <button class="section-header" onclick={() => (showCreativeEffects = !showCreativeEffects)}>
        <span>Creative Effects</span>
        <span class="chevron">{showCreativeEffects ? '−' : '+'}</span>
      </button>
      {#if showCreativeEffects}
        <div class="section-content">
          <div class="property-row">
            <label>Effect</label>
            <select
              value={sc.creativeEffect}
              onchange={(e) =>
                doUpdate({ creativeEffect: (e.target as HTMLSelectElement).value as SplatCreativeEffectType })}
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
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={sc.creativeEffectIntensity}
                oninput={(e) => doUpdate({ creativeEffectIntensity: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:creativeEffectIntensity"
                data-midi-label="Creative Effect Intensity"
                data-midi-min="0"
                data-midi-max="1"
                data-midi-step="0.01"
              />
              {@render splatModButton('creativeEffectIntensity')}
              <span class="value">{(sc.creativeEffectIntensity * 100).toFixed(0)}%</span>
            </div>
          {/if}

          <!-- Datamosh: flicker rate was hardcoded at 10Hz with no control. -->
          {#if sc.creativeEffect === 'datamosh'}
            <div class="property-row">
              <label>Flicker speed</label>
              <input
                type="range" min="0" max="4" step="0.01"
                value={sc.datamoshSpeed ?? 1}
                oninput={(e) => doUpdate({ datamoshSpeed: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:datamoshSpeed"
                data-midi-label="Datamosh Speed"
                data-midi-min="0" data-midi-max="4" data-midi-step="0.01"
              />
              {@render splatModButton('datamoshSpeed')}
              <span class="value">{(sc.datamoshSpeed ?? 1).toFixed(2)}×</span>
            </div>
            <p class="hint">0 freezes the glitch; 1 is the original rate.</p>
          {/if}

          <!-- Constellation: a per-point sparkle (it does not draw lines). -->
          {#if sc.creativeEffect === 'constellation'}
            <div class="property-row">
              <label>Sparkle speed</label>
              <input
                type="range" min="0" max="8" step="0.01"
                value={sc.constellationSpeed ?? 1}
                oninput={(e) => doUpdate({ constellationSpeed: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:constellationSpeed"
                data-midi-label="Constellation Speed"
                data-midi-min="0" data-midi-max="8" data-midi-step="0.01"
              />
              {@render splatModButton('constellationSpeed')}
              <span class="value">{(sc.constellationSpeed ?? 1).toFixed(2)}×</span>
            </div>

            <div class="property-row">
              <label>Blend</label>
              <select
                value={sc.constellationBlend ?? 'add'}
                onchange={(e) =>
                  doUpdate({ constellationBlend: (e.target as HTMLSelectElement).value as SplatEffectBlendMode })}
              >
                {#each constellationBlendModes as mode}
                  <option value={mode.value}>{mode.label}</option>
                {/each}
              </select>
            </div>

            <div class="property-row">
              <label>Wave mode</label>
              <input
                type="checkbox"
                checked={sc.constellationWave ?? false}
                onchange={(e) => doUpdate({ constellationWave: (e.target as HTMLInputElement).checked })}
              />
            </div>

            {#if sc.constellationWave}
              <p class="hint">
                Sparkle sweeps across the cloud as a travelling front instead
                of firing uniformly.
              </p>
              <div class="property-row">
                <label>Wave axis</label>
                <select
                  value={sc.constellationWaveAxis ?? 'y'}
                  onchange={(e) =>
                    doUpdate({ constellationWaveAxis: (e.target as HTMLSelectElement).value as 'x' | 'y' | 'z' })}
                >
                  <option value="x">X</option>
                  <option value="y">Y</option>
                  <option value="z">Z</option>
                </select>
              </div>
              <div class="property-row">
                <label>Wave frequency</label>
                <input
                  type="range" min="0.1" max="8" step="0.01"
                  value={sc.constellationWaveFrequency ?? 1.5}
                  oninput={(e) => doUpdate({ constellationWaveFrequency: parseFloat((e.target as HTMLInputElement).value) })}
                  data-midi-path="map:splat:constellationWaveFrequency"
                  data-midi-label="Constellation Wave Freq"
                  data-midi-min="0.1" data-midi-max="8" data-midi-step="0.01"
                />
                {@render splatModButton('constellationWaveFrequency')}
                <span class="value">{(sc.constellationWaveFrequency ?? 1.5).toFixed(2)}</span>
              </div>
              <div class="property-row">
                <label>Wave speed</label>
                <input
                  type="range" min="-4" max="4" step="0.01"
                  value={sc.constellationWaveSpeed ?? 1}
                  oninput={(e) => doUpdate({ constellationWaveSpeed: parseFloat((e.target as HTMLInputElement).value) })}
                  data-midi-path="map:splat:constellationWaveSpeed"
                  data-midi-label="Constellation Wave Speed"
                  data-midi-min="-4" data-midi-max="4" data-midi-step="0.01"
                />
                {@render splatModButton('constellationWaveSpeed')}
                <span class="value">{(sc.constellationWaveSpeed ?? 1).toFixed(2)}</span>
              </div>
            {/if}
          {/if}
        </div>
      {/if}
    </div>

    <!-- Camera Section -->
    <div class="section collapsible" class:open={showCamera}>
      <button class="section-header" onclick={() => (showCamera = !showCamera)}>
        <span>Camera</span>
        <span class="chevron">{showCamera ? '−' : '+'}</span>
      </button>
      {#if showCamera}
        <div class="section-content">
          <button class="reset-button" onclick={frameObject}>Frame object</button>

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
              Enable orbit controls
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
              Auto rotate
            </label>
          </div>

          {#if sc.autoRotate}
            <div class="property-row">
              <label>Rotate speed</label>
              <input
                type="range"
                min="0"
                max="5"
                step="0.1"
                value={sc.autoRotateSpeed}
                oninput={(e) => doUpdate({ autoRotateSpeed: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:autoRotateSpeed"
                data-midi-label="Auto Rotate Speed"
                data-midi-min="0"
                data-midi-max="5"
                data-midi-step="0.1"
              />
              {@render splatModButton('autoRotateSpeed')}
              <span class="value">{sc.autoRotateSpeed.toFixed(1)}</span>
            </div>
          {/if}

          <div class="property-row">
            <label>FOV</label>
            <input
              type="range"
              min="20"
              max="120"
              step="1"
              value={sc.cameraFov}
              oninput={(e) => doUpdate({ cameraFov: parseInt((e.target as HTMLInputElement).value) })}
              data-midi-path="map:splat:cameraFov"
              data-midi-label="Camera FOV"
              data-midi-min="20"
              data-midi-max="120"
              data-midi-step="1"
            />
            {@render splatModButton('cameraFov')}
            <span class="value">{sc.cameraFov}</span>
          </div>

          <div class="property-row">
            <label>Distance</label>
            <input
              type="range"
              min="1.5"
              max="30"
              step="0.1"
              value={sc.cameraDistance}
              oninput={(e) => doUpdate({ cameraDistance: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:splat:cameraDistance"
              data-midi-label="Camera Distance"
              data-midi-min="1.5"
              data-midi-max="30"
              data-midi-step="0.1"
            />
            {@render splatModButton('cameraDistance')}
            <span class="value">{sc.cameraDistance.toFixed(1)}</span>
          </div>

          <div class="property-row">
            <label>Pitch</label>
            <input
              type="range"
              min="-89"
              max="89"
              step="1"
              value={sc.cameraOrbitX ?? 0}
              oninput={(e) => doUpdate({ cameraOrbitX: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:splat:cameraOrbitX"
              data-midi-label="Camera Orbit X"
              data-midi-min="-89"
              data-midi-max="89"
              data-midi-step="1"
            />
            {@render splatModButton('cameraOrbitX')}
            <span class="value">{(sc.cameraOrbitX ?? 0).toFixed(0)}</span>
          </div>

          <div class="property-row">
            <label>Yaw</label>
            <input
              type="range"
              min="-180"
              max="180"
              step="1"
              value={sc.cameraOrbitY ?? 0}
              oninput={(e) => doUpdate({ cameraOrbitY: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:splat:cameraOrbitY"
              data-midi-label="Camera Orbit Y"
              data-midi-min="-180"
              data-midi-max="180"
              data-midi-step="1"
            />
            {@render splatModButton('cameraOrbitY')}
            <span class="value">{(sc.cameraOrbitY ?? 0).toFixed(0)}</span>
          </div>

          <div class="property-row">
            <label>Roll (Z)</label>
            <input
              type="range"
              min="-180"
              max="180"
              step="1"
              value={sc.cameraRoll ?? 0}
              oninput={(e) => doUpdate({ cameraRoll: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:splat:cameraRoll"
              data-midi-label="Camera Roll"
              data-midi-min="-180"
              data-midi-max="180"
              data-midi-step="1"
            />
            {@render splatModButton('cameraRoll')}
            <span class="value">{(sc.cameraRoll ?? 0).toFixed(0)}</span>
          </div>

          <div class="property-row">
            <label>Pan X</label>
            <input
              type="range"
              min="-100"
              max="100"
              step="0.5"
              value={sc.cameraPanX ?? 0}
              oninput={(e) => doUpdate({ cameraPanX: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:splat:cameraPanX"
              data-midi-label="Camera Pan X"
              data-midi-min="-100"
              data-midi-max="100"
              data-midi-step="0.5"
            />
            {@render splatModButton('cameraPanX')}
            <span class="value">{(sc.cameraPanX ?? 0).toFixed(1)}</span>
          </div>

          <div class="property-row">
            <label>Pan Y</label>
            <input
              type="range"
              min="-100"
              max="100"
              step="0.5"
              value={sc.cameraPanY ?? 0}
              oninput={(e) => doUpdate({ cameraPanY: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:splat:cameraPanY"
              data-midi-label="Camera Pan Y"
              data-midi-min="-100"
              data-midi-max="100"
              data-midi-step="0.5"
            />
            {@render splatModButton('cameraPanY')}
            <span class="value">{(sc.cameraPanY ?? 0).toFixed(1)}</span>
          </div>
        </div>
      {/if}
    </div>

    <!-- Mouse Interaction Section -->
    <div class="section collapsible" class:open={showMouse}>
      <button class="section-header" onclick={() => (showMouse = !showMouse)}>
        <span>Mouse Interaction</span>
        <span class="chevron">{showMouse ? '−' : '+'}</span>
      </button>
      {#if showMouse}
        <div class="section-content">
          <div class="property-row">
            <label>Mode</label>
            <select
              value={sc.mouseInteraction}
              onchange={(e) =>
                doUpdate({ mouseInteraction: (e.target as HTMLSelectElement).value as SplatMouseInteraction })}
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
                type="range"
                min="0.05"
                max="1"
                step="0.01"
                value={sc.mouseRadius}
                oninput={(e) => doUpdate({ mouseRadius: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:mouseRadius"
                data-midi-label="Mouse Radius"
                data-midi-min="0.05"
                data-midi-max="1"
                data-midi-step="0.01"
              />
              {@render splatModButton('mouseRadius')}
              <span class="value">{(sc.mouseRadius * 100).toFixed(0)}%</span>
            </div>

            <div class="property-row">
              <label>Strength</label>
              <input
                type="range"
                min="0.1"
                max="3"
                step="0.05"
                value={sc.mouseStrength}
                oninput={(e) => doUpdate({ mouseStrength: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:mouseStrength"
                data-midi-label="Mouse Strength"
                data-midi-min="0.1"
                data-midi-max="3"
                data-midi-step="0.05"
              />
              {@render splatModButton('mouseStrength')}
              <span class="value">{sc.mouseStrength.toFixed(2)}</span>
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Physics Section -->
    <div class="section collapsible" class:open={showPhysics}>
      <button class="section-header" onclick={() => (showPhysics = !showPhysics)}>
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
              Enable physics
            </label>
          </div>

          {#if sc.physicsEnabled}
            <div class="property-row">
              <label>Gravity</label>
              <input
                type="range"
                min="-20"
                max="20"
                step="0.1"
                value={sc.gravity}
                oninput={(e) => doUpdate({ gravity: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:gravity"
                data-midi-label="Gravity"
                data-midi-min="-20"
                data-midi-max="20"
                data-midi-step="0.1"
              />
              {@render splatModButton('gravity')}
              <span class="value">{sc.gravity.toFixed(1)}</span>
            </div>

            <div class="property-row">
              <label>Friction</label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={sc.friction}
                oninput={(e) => doUpdate({ friction: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:friction"
                data-midi-label="Friction"
                data-midi-min="0"
                data-midi-max="1"
                data-midi-step="0.01"
              />
              {@render splatModButton('friction')}
              <span class="value">{sc.friction.toFixed(2)}</span>
            </div>

            <div class="property-row">
              <label>Bounciness</label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={sc.bounciness}
                oninput={(e) => doUpdate({ bounciness: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:bounciness"
                data-midi-label="Bounciness"
                data-midi-min="0"
                data-midi-max="1"
                data-midi-step="0.01"
              />
              {@render splatModButton('bounciness')}
              <span class="value">{sc.bounciness.toFixed(2)}</span>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </div>
{:else}
  <div data-help-page="point-clouds" class="no-layer">
    <p>Select a splat layer to edit its properties</p>
  </div>
{/if}

<style>
  .splat-panel {
    padding: 12px;
    display: flex;
    flex-direction: column;
    font-size: var(--ga-text-body);
    color: var(--ga-ink-0);
    overflow-y: auto;
    max-height: 100%;
  }

  h3 {
    margin: 0 0 8px 0;
    font-size: var(--ga-text-title);
    font-weight: var(--ga-weight-title);
    color: var(--ga-ink-0);
  }

  .section {
    border-top: 1px solid var(--ga-line-1);
  }
  .section:not(.collapsible) {
    padding: 12px 0;
  }

  /* Eyebrow section label, same as every layer editor. */
  .section-label {
    display: block;
    font-size: var(--ga-text-eyebrow);
    font-weight: 700;
    color: var(--ga-ink-2);
    margin-bottom: 8px;
    text-transform: uppercase;
    letter-spacing: var(--ga-eyebrow-tracking);
  }

  .subsection-label {
    margin-top: 4px;
    color: var(--ga-ink-2);
    font-size: var(--ga-text-eyebrow);
    font-weight: 700;
    letter-spacing: var(--ga-eyebrow-tracking);
    text-transform: uppercase;
  }

  .collapsible {
    padding: 0;
  }

  /* Collapsible eyebrow header */
  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    min-height: 32px;
    padding: 0;
    background: none;
    border: none;
    color: var(--ga-ink-2);
    cursor: pointer;
    font-size: var(--ga-text-eyebrow);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: var(--ga-eyebrow-tracking);
    text-align: left;
  }

  .section-header:hover {
    color: var(--ga-ink-0);
  }

  .section-content {
    padding: 0 0 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .chevron {
    font-size: var(--ga-text-body);
    color: var(--ga-ink-2);
  }

  .property-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: var(--ga-control-h);
  }

  .property-row :global(.epr.button-only) {
    flex: 1 1 auto;
    min-width: 0;
  }

  .property-row > label:first-child {
    width: 96px;
    flex-shrink: 0;
    color: var(--ga-ink-1);
    font-size: var(--ga-text-control);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Only style the panel's own slider. EffectParamRow mounts its Auto
     slippers inside the same property row; a descendant selector here
     turns those slim cyan handles into full-size splat thumbs. */
  .property-row > input[type='range'] {
    flex: 1;
    min-width: 0;
    height: 6px;
    background: var(--ga-slot);
    border-radius: 3px;
    -webkit-appearance: none;
    cursor: pointer;
  }

  .property-row > input[type='range']::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 14px;
    height: 14px;
    background: var(--ga-selection-line);
    border-radius: 50%;
    cursor: pointer;
  }

  .property-row select {
    flex: 1;
    min-width: 0;
    height: var(--ga-control-h);
    padding: 0 8px;
    background-color: var(--ga-slot);
    border: 1px solid var(--ga-line-2);
    border-radius: var(--ga-r-hard);
    color: var(--ga-ink-0);
    font-size: var(--ga-text-control);
    cursor: pointer;
  }

  .property-row input[type='color'] {
    width: 40px;
    height: var(--ga-control-h-sm);
    padding: 0;
    border: 1px solid var(--ga-line-2);
    border-radius: var(--ga-r-hard);
    cursor: pointer;
    background: none;
  }

  .property-row .value {
    min-width: 40px;
    text-align: right;
    color: var(--ga-ink-1);
    font-size: var(--ga-text-meta);
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    font-variant-numeric: tabular-nums;
  }

  .property-row.checkbox label {
    display: flex;
    align-items: center;
    flex: 0 1 auto;
    width: auto;
    min-width: 0;
    max-width: none;
    gap: 8px;
    cursor: pointer;
    color: var(--ga-ink-0);
    overflow: visible;
    text-overflow: clip;
  }

  .property-row.checkbox input[type='checkbox'] {
    width: 14px;
    height: 14px;
    cursor: pointer;
  }

  .reset-button {
    width: 100%;
    height: var(--ga-control-h);
    padding: 0 10px;
    border: 1px solid var(--ga-line-2);
    border-radius: var(--ga-r-hard);
    background: var(--ga-sub);
    color: var(--ga-ink-1);
    cursor: pointer;
    font-size: var(--ga-text-control);
    font-weight: var(--ga-weight-control);
  }

  .reset-button:hover:not(:disabled) {
    border-color: var(--ga-line-3);
    color: var(--ga-ink-0);
  }

  .reset-button:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  .orientation-actions {
    display: grid;
    grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr);
    gap: 4px;
  }

  .orientation-actions .reset-button {
    min-width: 0;
    padding-inline: 8px;
  }

  .orientation-readout {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 12px;
    color: var(--ga-ink-1);
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    font-size: var(--ga-text-meta);
    font-variant-numeric: tabular-nums;
  }

  .section-note {
    margin: 0;
    color: var(--ga-ink-2);
    font-size: var(--ga-text-meta);
    line-height: 1.4;
  }

  .file-row {
    display: flex;
    gap: 6px;
    align-items: center;
  }

  .file-row input[type='file'] {
    display: none;
  }

  /* Primary action */
  .file-button {
    display: inline-flex;
    align-items: center;
    height: var(--ga-control-h);
    padding: 0 12px;
    background: var(--ga-accent-gradient, var(--ga-violet));
    border: none;
    color: var(--ga-blue-800);
    border-radius: var(--ga-r-soft);
    cursor: pointer;
    font-size: var(--ga-text-control);
    font-weight: 700;
    transition: filter 0.2s;
  }

  .file-button:hover {
    filter: brightness(1.06);
  }

  .file-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-top: 8px;
    padding: 6px 8px;
    background: var(--ga-card);
    border: 1px solid var(--ga-line-1);
    border-radius: var(--ga-r-hard);
    font-size: var(--ga-text-meta);
  }

  .filename {
    color: var(--ga-ink-0);
    font-weight: var(--ga-weight-control);
  }

  .point-count {
    color: var(--ga-ink-1);
  }

  .data-type {
    color: var(--ga-ink-2);
  }

  .density-info {
    font-size: var(--ga-text-meta);
    color: var(--ga-ink-2);
    margin-top: 4px;
  }

  .texture-section {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid var(--ga-line-1);
  }

  .texture-preview {
    margin: 8px 0;
    padding: 8px;
    background: var(--ga-card);
    border: 1px solid var(--ga-line-1);
    border-radius: var(--ga-r-hard);
    text-align: center;
  }

  .hint {
    color: var(--ga-ink-2);
    font-size: var(--ga-text-meta);
    margin: 6px 0 0 0;
  }

  .no-layer {
    padding: 20px;
    text-align: center;
    color: var(--ga-ink-2);
  }
</style>
