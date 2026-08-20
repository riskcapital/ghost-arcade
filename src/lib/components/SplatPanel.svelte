<script lang="ts">
  import { project, selectedLayer } from '../stores/layers';
  import type {
    SplatContent,
    SplatAnimationType,
    SplatDisplacementType,
    SplatColorEffectType,
    SplatOpacityEffectType,
    SplatCreativeEffectType,
    SplatRenderMode,
    SplatMouseInteraction,
    SplatImportOrientation,
  } from '../types';
  import { createAssetRefFromFile } from '../storage/assetRegistry';
  import EffectParamRow from './EffectParamRow.svelte';
  import { keyframeTimeline } from '../stores/keyframeTimeline';
  import {
    SPLAT_AUTOMATABLE_PARAM_MAP,
    type SplatParamDescriptor } from '../splat/splatParamSchema';
  import {
    SPLAT_IMPORT_ORIENTATION_OPTIONS,
    bakeSplatManualRotationAsUpright,
    resolveSplatImportRotation,
    splatImportOrientationRotation,
  } from '../splat';
  import { t } from '../i18n';

  // Optional props for dual-mode (mapping mode vs VJ mode)
  // When not provided, falls back to selectedLayer store (mapping mode behavior)
  export let content: SplatContent | null = null;
  export let onUpdate: ((updates: Partial<SplatContent>) => void) | null = null;
  export let onFileLoad: (() => void) | null = null;
  export let compact: boolean = false; // VJ mode uses compact styling

  // Animation types with descriptions
  const animationTypes: { value: SplatAnimationType; labelKey: string; descriptionKey: string }[] = [
    { value: 'none', labelKey: 'splat.types.animation.none', descriptionKey: 'splat.descriptions.animation.none' },
    { value: 'orbit', labelKey: 'splat.types.animation.orbit', descriptionKey: 'splat.descriptions.animation.orbit' },
    { value: 'tumble',
      labelKey: 'splat.types.animation.tumble',
      descriptionKey: 'splat.descriptions.animation.tumble',
    },
    { value: 'breathe',
      labelKey: 'splat.types.animation.breathe',
      descriptionKey: 'splat.descriptions.animation.breathe',
    },
    { value: 'drift', labelKey: 'splat.types.animation.drift', descriptionKey: 'splat.descriptions.animation.drift' },
    { value: 'vortex',
      labelKey: 'splat.types.animation.vortex',
      descriptionKey: 'splat.descriptions.animation.vortex',
    },
    { value: 'wave3d',
      labelKey: 'splat.types.animation.wave3d',
      descriptionKey: 'splat.descriptions.animation.wave3d',
    },
    { value: 'swarm', labelKey: 'splat.types.animation.swarm', descriptionKey: 'splat.descriptions.animation.swarm' },
    { value: 'spiral',
      labelKey: 'splat.types.animation.spiral',
      descriptionKey: 'splat.descriptions.animation.spiral',
    },
    { value: 'scatter',
      labelKey: 'splat.types.animation.scatter',
      descriptionKey: 'splat.descriptions.animation.scatter',
    },
    { value: 'explode',
      labelKey: 'splat.types.animation.explode',
      descriptionKey: 'splat.descriptions.animation.explode',
    },
    { value: 'implode',
      labelKey: 'splat.types.animation.implode',
      descriptionKey: 'splat.descriptions.animation.implode',
    },
    { value: 'slice', labelKey: 'splat.types.animation.slice', descriptionKey: 'splat.descriptions.animation.slice' },
    { value: 'peel', labelKey: 'splat.types.animation.peel', descriptionKey: 'splat.descriptions.animation.peel' },
    { value: 'voxelSnap',
      labelKey: 'splat.types.animation.voxelSnap',
      descriptionKey: 'splat.descriptions.animation.voxelSnap',
    },
    { value: 'gravity',
      labelKey: 'splat.types.animation.gravity',
      descriptionKey: 'splat.descriptions.animation.gravity',
    },
    { value: 'morph', labelKey: 'splat.types.animation.morph', descriptionKey: 'splat.descriptions.animation.morph' },
  ];

  // Displacement types
  const displacementTypes: { value: SplatDisplacementType; labelKey: string }[] = [
    { value: 'none', labelKey: 'splat.types.displacement.none' },
    { value: 'noise', labelKey: 'splat.types.displacement.noise' },
    { value: 'curlNoise', labelKey: 'splat.types.displacement.curlNoise' },
    { value: 'audioReactive', labelKey: 'splat.types.displacement.audioReactive' },
    { value: 'wave', labelKey: 'splat.types.displacement.wave' },
    { value: 'radialPulse', labelKey: 'splat.types.displacement.radialPulse' },
    { value: 'twist', labelKey: 'splat.types.displacement.twist' },
    { value: 'wind', labelKey: 'splat.types.displacement.wind' },
    { value: 'magnetic', labelKey: 'splat.types.displacement.magnetic' },
    { value: 'ripple', labelKey: 'splat.types.displacement.ripple' },
    { value: 'scanline', labelKey: 'splat.types.displacement.scanline' },
    { value: 'glitch', labelKey: 'splat.types.displacement.glitch' },
  ];

  // Color effect types
  const colorEffectTypes: { value: SplatColorEffectType; labelKey: string }[] = [
    { value: 'none', labelKey: 'splat.types.color.none' },
    { value: 'chromatic', labelKey: 'splat.types.color.chromatic' },
    { value: 'heatmap', labelKey: 'splat.types.color.heatmap' },
    { value: 'pointillist', labelKey: 'splat.types.color.pointillist' },
    { value: 'hologram', labelKey: 'splat.types.color.hologram' },
    { value: 'rainbow', labelKey: 'splat.types.color.rainbow' },
    { value: 'depthGradient', labelKey: 'splat.types.color.depthGradient' },
    { value: 'neon', labelKey: 'splat.types.color.neon' },
    { value: 'pastel', labelKey: 'splat.types.color.pastel' },
    { value: 'cyberpunk', labelKey: 'splat.types.color.cyberpunk' },
    { value: 'fire', labelKey: 'splat.types.color.fire' },
    { value: 'ice', labelKey: 'splat.types.color.ice' },
  ];

  // Opacity effect types
  const opacityEffectTypes: { value: SplatOpacityEffectType; labelKey: string }[] = [
    { value: 'none', labelKey: 'splat.types.opacity.none' },
    { value: 'dof', labelKey: 'splat.types.opacity.dof' },
    { value: 'fog', labelKey: 'splat.types.opacity.fog' },
    { value: 'pulse', labelKey: 'splat.types.opacity.pulse' },
    { value: 'proximity', labelKey: 'splat.types.opacity.proximity' },
    { value: 'dissolve', labelKey: 'splat.types.opacity.dissolve' },
  ];

  // Creative effect types
  const creativeEffectTypes: { value: SplatCreativeEffectType; labelKey: string }[] = [
    { value: 'none', labelKey: 'splat.types.creative.none' },
    { value: 'feedback', labelKey: 'splat.types.creative.feedback' },
    { value: 'kaleidoscope', labelKey: 'splat.types.creative.kaleidoscope' },
    { value: 'constellation', labelKey: 'splat.types.creative.constellation' },
    { value: 'datamosh', labelKey: 'splat.types.creative.datamosh' },
    { value: 'pixelSort', labelKey: 'splat.types.creative.pixelSort' },
    { value: 'echo', labelKey: 'splat.types.creative.echo' },
  ];

  // Render modes
  const renderModes: { value: SplatRenderMode; labelKey: string }[] = [
    { value: 'points', labelKey: 'splat.types.render.points' },
    { value: 'gaussians', labelKey: 'splat.types.render.gaussians' },
    { value: 'spheres', labelKey: 'splat.types.render.spheres' },
    { value: 'billboards', labelKey: 'splat.types.render.billboards' },
    { value: 'cubes', labelKey: 'splat.types.render.cubes' },
    { value: 'wireframe', labelKey: 'splat.types.render.wireframe' },
  ];

  // Mouse interactions
  const mouseInteractions: { value: SplatMouseInteraction; labelKey: string }[] = [
    { value: 'none', labelKey: 'splat.types.mouse.none' },
    { value: 'attract', labelKey: 'splat.types.mouse.attract' },
    { value: 'repel', labelKey: 'splat.types.mouse.repel' },
    { value: 'swirl', labelKey: 'splat.types.mouse.swirl' },
    { value: 'reveal', labelKey: 'splat.types.mouse.reveal' },
  ];

  type NumericSplatControl = {
    key: keyof SplatContent;
    labelKey: string;
    min: number;
    max: number;
    step: number;
    fallback: number;
    suffix?: string;
  };

  const animationControls: Partial<Record<SplatAnimationType, NumericSplatControl[]>> = {
    explode: [
      { key: 'explodeForce', labelKey: 'splat.params.explodeForce', min: 0, max: 8, step: 0.01, fallback: 2 },
      { key: 'explodeTurbulence',
        labelKey: 'splat.params.explodeTurbulence', min: 0, max: 2, step: 0.01, fallback: 0.35,
      },
    ],
    implode: [
      { key: 'implodeForce', labelKey: 'splat.params.implodeForce', min: 0, max: 1, step: 0.01, fallback: 0.85 },
      { key: 'implodeSpin', labelKey: 'splat.params.implodeSpin', min: 0, max: 8, step: 0.01, fallback: 1.5 },
    ],
    slice: [
      { key: 'sliceWidth', labelKey: 'splat.params.sliceWidth', min: 0.5, max: 12, step: 0.1, fallback: 3 },
      { key: 'sliceSoftness', labelKey: 'splat.params.sliceSoftness', min: 0.01, max: 0.95, step: 0.01, fallback: 0.2 },
      { key: 'sliceTravel', labelKey: 'splat.params.sliceTravel', min: -5, max: 5, step: 0.01, fallback: 1 },
    ],
    peel: [
      { key: 'peelWidth', labelKey: 'splat.params.peelWidth', min: 0.05, max: 2.5, step: 0.01, fallback: 0.55 },
      { key: 'peelCurl', labelKey: 'splat.params.peelCurl', min: 0, max: 10, step: 0.01, fallback: 2.2 },
    ],
    voxelSnap: [{ key: 'voxelGridSize', labelKey: 'splat.params.voxelGridSize', min: 2, max: 64, step: 1, fallback: 16 },
    ],
    gravity: [
      { key: 'gravityStrength', labelKey: 'splat.params.gravityStrength', min: 0, max: 12, step: 0.01, fallback: 2 },
      { key: 'gravitySpread', labelKey: 'splat.params.gravitySpread', min: 0, max: 2, step: 0.01, fallback: 0.25 },
      { key: 'gravityFloor', labelKey: 'splat.params.gravityFloor', min: -5, max: 2, step: 0.01, fallback: -2 },
    ],
    swarm: [
      { key: 'swarmCohesion', labelKey: 'splat.params.swarmCohesion', min: 0, max: 2, step: 0.01, fallback: 0.3 },
      { key: 'swarmSeparation', labelKey: 'splat.params.swarmSeparation', min: 0, max: 2, step: 0.01, fallback: 0.4 },
      { key: 'swarmAlignment', labelKey: 'splat.params.swarmAlignment', min: 0, max: 2, step: 0.01, fallback: 0.6 },
    ],
    morph: [{ key: 'morphRoundness', labelKey: 'splat.params.morphRoundness', min: 0, max: 1, step: 0.01, fallback: 1 },
    ],
    orbit: [{ key: 'turntableTilt',
        labelKey: 'splat.params.turntableTilt', min: -90, max: 90, step: 1, fallback: 0, suffix: '°',
      },
    ],
    wave3d: [
      { key: 'animationWaveFrequency',
        labelKey: 'splat.params.animationWaveFrequency', min: 0.25, max: 20, step: 0.01, fallback: 5,
      },
      { key: 'animationWaveAmplitude',
        labelKey: 'splat.params.animationWaveAmplitude', min: 0, max: 3, step: 0.01, fallback: 0.3,
      },
    ],
    scatter: [
      { key: 'scatterDistance', labelKey: 'splat.params.scatterDistance', min: 0, max: 8, step: 0.01, fallback: 2 },
      { key: 'scatterRandomness',
        labelKey: 'splat.params.scatterRandomness', min: 0.25, max: 24, step: 0.01, fallback: 8,
      },
    ],
    spiral: [
      { key: 'spiralRadius', labelKey: 'splat.params.spiralRadius', min: 0, max: 5, step: 0.01, fallback: 0.75 },
      { key: 'spiralTurns', labelKey: 'splat.params.spiralTurns', min: -8, max: 8, step: 0.01, fallback: 2 },
      { key: 'spiralLift', labelKey: 'splat.params.spiralLift', min: -5, max: 5, step: 0.01, fallback: 1 },
    ],
    tumble: [{ key: 'tumbleSpread', labelKey: 'splat.params.tumbleSpread', min: 0, max: 3, step: 0.01, fallback: 1 }],
    breathe: [{ key: 'breatheAmount', labelKey: 'splat.params.breatheAmount', min: 0, max: 1, step: 0.01, fallback: 0.15 },
    ],
    drift: [{ key: 'driftAmount', labelKey: 'splat.params.driftAmount', min: 0, max: 2, step: 0.01, fallback: 0.25 }],
    vortex: [{ key: 'vortexTwist', labelKey: 'splat.params.vortexTwist', min: -10, max: 10, step: 0.01, fallback: 2 }],
  };

  // Collapsible sections state
  let showImportOrientation = true;
  let showRendering = true;
  let showAnimation = true;
  let showDisplacement = false;
  let showLighting = false;
  let showAtmosphere = false;
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
      for (const [paramKey, value] of Object.entries(normalizedUpdates)) {
        const descriptor = SPLAT_AUTOMATABLE_PARAM_MAP.get(paramKey as keyof SplatContent & string);
        if (!descriptor || typeof value !== 'number') continue;
        const labelKey = `spatial.splat.params.${paramKey}`;
        const localizedLabel = $t(labelKey);
        keyframeTimeline.autoRecord(
          layer.id,
          `splat:${paramKey}`,
          value,
          localizedLabel === labelKey ? descriptor.label : localizedLabel,
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

  // Track blob URLs for cleanup and display filename
  let currentBlobUrl: string | null = null;
  let currentFileName: string = '';
  // Blob URLs stay alive for the lifetime of their layer. Panel teardown happens
  // during normal mode switches and must not invalidate an otherwise live source.
  let currentTextureBlobUrl: string | null = null;

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

  function orientationLabel(value: SplatImportOrientation): string {
    return $t(`spatial.splat.orientation.options.${value}`);
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
          renderMode: 'gaussians',
          _originalFileName: file.name,
          _assetRef: assetRef,
        } as any);
      } else {
        // PLY parsing and GPU upload are owned by Canvas. Parsing here used to
        // load every large file twice and dismissed the loader before upload.
        if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
        const { assetRef, runtimeUrl: blobUrl } = createAssetRefFromFile(file);
        currentBlobUrl = blobUrl;
        currentFileName = file.name;

        const updates: Partial<SplatContent> = {
          filePath: blobUrl,
          pointCount: 0,
          activePointCount: 0,
          sourcePointCount: 0,
          _assetRef: assetRef,
        };

        doUpdate(updates);
      }
    } catch (err) {
      console.error($t('spatial.splat.file.loadError'), err);
    }
  }

  // Display-friendly filename (extract from blob URL or show stored name)
  $: displayFileName =
    currentFileName || (sc?.filePath?.startsWith('blob:') ? $t('spatial.splat.file.loadedFile') : sc?.filePath || '');
</script>

{#snippet splatModButton(paramKey: keyof SplatContent)}
  {@const param = SPLAT_AUTOMATABLE_PARAM_MAP.get(paramKey as keyof SplatContent & string)}
  {#if !isVJMode && splatLayerIndex >= 0 && param}
    <EffectParamRow
      buttonOnly={true}
      label={$t(`spatial.splat.params.${String(param.key)}`)}
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
  <div class="splat-panel" class:compact>
    {#if !compact}<h3>{$t('spatial.splat.title')}</h3>{/if}

    <!-- File Loading -->
    <div class="section">
      <label class="section-label">{$t('spatial.splat.file.section')}</label>
      <div class="file-row">
        {#if onFileLoad}
          <button class="file-button" onclick={onFileLoad}>{$t('spatial.splat.file.loadFile')}</button>
        {:else}
          <input type="file" accept=".ply,.splat" onchange={handleFileSelect} id="ply-file-input" />
          <label for="ply-file-input" class="file-button">{$t('spatial.splat.file.loadPly')}</label>
        {/if}
      </div>
      {#if sc.filePath}
        <div class="file-info">
          <span class="filename">{displayFileName || $t('spatial.splat.file.loadedPly')}</span>
          <span class="point-count">
            {$t('spatial.splat.file.pointCount', { values: { count: sc.pointCount.toLocaleString() } })}
            {#if (sc.sourcePointCount ?? 0) > sc.pointCount}
              / {$t('spatial.splat.file.sourceCount', {
                values: { count: (sc.sourcePointCount ?? 0).toLocaleString() },
              })}
            {/if}
          </span>
          <span class="data-type"
            >{$t(
              sc.dataType === 'gaussian' ? 'spatial.splat.file.dataGaussian' : 'spatial.splat.file.dataPointCloud',
            )}</span
          >
        </div>

        <div class="property-row">
          <label>{$t('spatial.splat.params.pointDensity')}</label>
          <input
            type="range"
            min="0.01"
            max="1"
            step="0.01"
            value={sc.pointDensity ?? 1}
            oninput={(e) => doUpdate({ pointDensity: parseFloat((e.target as HTMLInputElement).value) })}
            data-midi-path="map:splat:pointDensity"
            data-midi-label={$t('spatial.splat.params.pointDensity')}
            data-midi-min="0.01"
            data-midi-max="1"
            data-midi-step="0.01"
          />
          {@render splatModButton('pointDensity')}
          <span class="value">{((sc.pointDensity ?? 1) * 100).toFixed(0)}%</span>
        </div>
        <div class="density-info">
          <span
            >{$t('spatial.splat.file.activePoints', {
              values: { count: Math.floor(sc.pointCount * (sc.pointDensity ?? 1)).toLocaleString() },
            })}</span
          >
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
                data-midi-label={$t('spatial.splat.texture.useMap')}
                data-midi-mode="toggle"
              />
              {$t('spatial.splat.texture.useMap')}
            </label>
          </div>

          {#if sc.textureEnabled}
            <div class="property-row">
              <label>{$t('spatial.common.type')}</label>
              <select
                value={sc.textureType ?? 'image'}
                onchange={(e) => {
                  doUpdate({
                    textureType: (e.target as HTMLSelectElement).value as 'image' | 'video',
                    texturePath: '', // Clear path when changing type
                  });
                }}
                data-midi-path="map:splat:textureType"
                data-midi-label={$t('spatial.splat.texture.type')}
                data-midi-min="0"
                data-midi-max="1"
                data-midi-step="1"
                data-midi-discrete="image,video"
              >
                <option value="image">{$t('spatial.splat.texture.image')}</option>
                <option value="video">{$t('spatial.splat.texture.video')}</option>
              </select>
            </div>

            <div class="property-row">
              <label
                >{$t(sc.textureType === 'video' ? 'spatial.splat.texture.video' : 'spatial.splat.texture.image')}</label
              >
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
                  <img
                    src={sc.texturePath}
                    alt={$t('spatial.splat.texture.preview')}
                    style="max-width: 100%; max-height: 60px; object-fit: contain;"
                  />
                {/if}
              </div>
            {/if}

            <div class="property-row">
              <label>{$t('spatial.splat.texture.projection')}</label>
              <select
                value={sc.textureProjection ?? 'spherical'}
                onchange={(e) => doUpdate({ textureProjection: (e.target as HTMLSelectElement).value as any })}
                data-midi-path="map:splat:textureProjection"
                data-midi-label={$t('spatial.splat.texture.projection')}
                data-midi-min="0"
                data-midi-max="6"
                data-midi-step="1"
                data-midi-discrete="spherical,cylindrical,planarXY,planarXZ,planarYZ,box,native"
              >
                <option value="spherical">{$t('spatial.splat.texture.spherical')}</option>
                <option value="cylindrical">{$t('spatial.splat.texture.cylindrical')}</option>
                <option value="planarXY">{$t('spatial.splat.texture.planarFront')}</option>
                <option value="planarXZ">{$t('spatial.splat.texture.planarTop')}</option>
                <option value="planarYZ">{$t('spatial.splat.texture.planarSide')}</option>
                <option value="box">{$t('spatial.splat.texture.box')}</option>
                <option value="native">{$t('spatial.splat.texture.native')}</option>
              </select>
            </div>

            <div class="property-row">
              <label>{$t('spatial.splat.texture.blend')}</label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={sc.textureBlend ?? 0.5}
                oninput={(e) => doUpdate({ textureBlend: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:textureBlend"
                data-midi-label={$t('spatial.splat.texture.blend')}
                data-midi-min="0"
                data-midi-max="1"
                data-midi-step="0.01"
              />
              {@render splatModButton('textureBlend')}
              <span class="value">{((sc.textureBlend ?? 0.5) * 100).toFixed(0)}%</span>
            </div>

            <div class="property-row">
              <label>{$t('spatial.splat.texture.scale')}</label>
              <input
                type="range"
                min="0.1"
                max="5"
                step="0.1"
                value={sc.textureScale ?? 1}
                oninput={(e) => doUpdate({ textureScale: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:textureScale"
                data-midi-label={$t('spatial.splat.texture.scale')}
                data-midi-min="0.1"
                data-midi-max="5"
                data-midi-step="0.1"
              />
              {@render splatModButton('textureScale')}
              <span class="value">{(sc.textureScale ?? 1).toFixed(1)}</span>
            </div>

            <div class="property-row">
              <label>{$t('spatial.splat.texture.offsetX')}</label>
              <input
                type="range"
                min="-1"
                max="1"
                step="0.01"
                value={sc.textureOffsetX ?? 0}
                oninput={(e) => doUpdate({ textureOffsetX: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:textureOffsetX"
                data-midi-label={$t('spatial.splat.texture.offsetX')}
                data-midi-min="-1"
                data-midi-max="1"
                data-midi-step="0.01"
              />
              {@render splatModButton('textureOffsetX')}
              <span class="value">{(sc.textureOffsetX ?? 0).toFixed(2)}</span>
            </div>

            <div class="property-row">
              <label>{$t('spatial.splat.texture.offsetY')}</label>
              <input
                type="range"
                min="-1"
                max="1"
                step="0.01"
                value={sc.textureOffsetY ?? 0}
                oninput={(e) => doUpdate({ textureOffsetY: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:textureOffsetY"
                data-midi-label={$t('spatial.splat.texture.offsetY')}
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
        <p class="hint">{$t('spatial.splat.file.hint')}</p>
      {/if}
    </div>

    <!-- Import Orientation Section -->
    <div class="section collapsible" class:open={showImportOrientation}>
      <button class="section-header" onclick={() => (showImportOrientation = !showImportOrientation)}>
        <span>{$t('spatial.splat.sections.importOrientation')}</span>
        <span class="chevron">{showImportOrientation ? '−' : '+'}</span>
      </button>
      {#if showImportOrientation}
        <div class="section-content">
          <div class="property-row">
            <label>{$t('spatial.splat.orientation.sourceUp')}</label>
            <select
              value={sc.importOrientation ?? 'authored'}
              onchange={(e) => applyImportOrientation((e.target as HTMLSelectElement).value as SplatImportOrientation)}
            >
              {#each SPLAT_IMPORT_ORIENTATION_OPTIONS as option}
                <option value={option.value} disabled={option.value === 'auto' && !hasAutoLevelSuggestion}>
                  {orientationLabel(option.value)}
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
              {$t('spatial.splat.orientation.autoLevel')}
            </button>
            <button class="reset-button" onclick={setCurrentAsUpright}>
              {$t('spatial.splat.orientation.setUpright')}
            </button>
          </div>

          <div class="orientation-readout">
            <span>X {resolvedImportRotation[0].toFixed(1)}°</span>
            <span>Y {resolvedImportRotation[1].toFixed(1)}°</span>
            <span>Z {resolvedImportRotation[2].toFixed(1)}°</span>
            {#if sc.importOrientation === 'auto' && Number.isFinite(sc.autoLevelConfidence)}
              <span
                >{$t('spatial.splat.orientation.confidence', {
                  values: { percent: Math.round((sc.autoLevelConfidence ?? 0) * 100) },
                })}</span
              >
            {/if}
          </div>
          <p class="section-note">{$t('spatial.splat.orientation.note')}</p>
        </div>
      {/if}
    </div>

    <!-- Rendering Section -->
    <div class="section collapsible" class:open={showRendering}>
      <button class="section-header" onclick={() => (showRendering = !showRendering)}>
        <span>{$t('spatial.splat.sections.rendering')}</span>
        <span class="chevron">{showRendering ? '−' : '+'}</span>
      </button>
      {#if showRendering}
        <div class="section-content">
          <div class="property-row">
            <label>{$t('spatial.splat.rendering.renderMode')}</label>
            <select
              value={sc.renderMode}
              onchange={(e) => doUpdate({ renderMode: (e.target as HTMLSelectElement).value as SplatRenderMode })}
              data-midi-path="map:splat:renderMode"
              data-midi-label={$t('spatial.splat.rendering.renderMode')}
              data-midi-min="0"
              data-midi-max="5"
              data-midi-step="1"
              data-midi-discrete="points,gaussians,spheres,billboards,cubes,wireframe"
            >
              {#each renderModes as mode}
                <option value={mode.value}>{$t(`spatial.${mode.labelKey}`)}</option>
              {/each}
            </select>
          </div>

          <div class="property-row">
            <label>{$t('spatial.splat.rendering.pointSize')}</label>
            <input
              type="range"
              min="0.1"
              max="5"
              step="0.05"
              value={sc.pointSize}
              oninput={(e) => doUpdate({ pointSize: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:splat:pointSize"
              data-midi-label={$t('spatial.splat.rendering.pointSize')}
              data-midi-min="0.1"
              data-midi-max="5"
              data-midi-step="0.05"
            />
            {@render splatModButton('pointSize')}
            <span class="value">{sc.pointSize.toFixed(2)}</span>
          </div>

          <div class="property-row">
            <label>{$t('spatial.splat.rendering.globalScale')}</label>
            <input
              type="range"
              min="0.01"
              max="10"
              step="0.01"
              value={sc.scaleUniform}
              oninput={(e) => doUpdate({ scaleUniform: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:splat:scaleUniform"
              data-midi-label={$t('spatial.splat.rendering.globalScale')}
              data-midi-min="0.01"
              data-midi-max="10"
              data-midi-step="0.01"
            />
            {@render splatModButton('scaleUniform')}
            <span class="value">{sc.scaleUniform.toFixed(2)}</span>
          </div>

          <div class="property-row">
            <label>{$t('spatial.splat.rendering.globalOpacity')}</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={sc.opacity}
              oninput={(e) => doUpdate({ opacity: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:splat:opacity"
              data-midi-label={$t('spatial.splat.rendering.globalOpacity')}
              data-midi-min="0"
              data-midi-max="1"
              data-midi-step="0.01"
            />
            {@render splatModButton('opacity')}
            <span class="value">{(sc.opacity * 100).toFixed(0)}%</span>
          </div>

          <div class="property-row">
            <label>{$t('spatial.splat.rendering.background')}</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={sc.backgroundOpacity ?? 0}
              oninput={(e) => doUpdate({ backgroundOpacity: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:splat:backgroundOpacity"
              data-midi-label={$t('spatial.splat.rendering.backgroundOpacity')}
              data-midi-min="0"
              data-midi-max="1"
              data-midi-step="0.01"
            />
            {@render splatModButton('backgroundOpacity')}
            <span class="value">{((sc.backgroundOpacity ?? 0) * 100).toFixed(0)}%</span>
          </div>

          <div class="property-row">
            <label>{$t('spatial.splat.rendering.backgroundColor')}</label>
            <input
              type="color"
              value={sc.backgroundColor ?? '#000000'}
              oninput={(e) => doUpdate({ backgroundColor: (e.target as HTMLInputElement).value })}
              data-midi-path="map:splat:backgroundColor"
              data-midi-label={$t('spatial.splat.rendering.backgroundColor')}
            />
          </div>

          <div class="property-row checkbox">
            <label>
              <input
                type="checkbox"
                checked={sc.sizeAttenuation}
                onchange={(e) => doUpdate({ sizeAttenuation: (e.target as HTMLInputElement).checked })}
                data-midi-path="map:splat:sizeAttenuation"
                data-midi-label={$t('spatial.splat.rendering.sizeAttenuation')}
                data-midi-mode="toggle"
              />
              {$t('spatial.splat.rendering.sizeAttenuation')}
            </label>
          </div>

          <div class="property-row checkbox">
            <label>
              <input
                type="checkbox"
                checked={sc.depthTest}
                onchange={(e) => doUpdate({ depthTest: (e.target as HTMLInputElement).checked })}
                data-midi-path="map:splat:depthTest"
                data-midi-label={$t('spatial.splat.rendering.depthTest')}
                data-midi-mode="toggle"
              />
              {$t('spatial.splat.rendering.depthTest')}
            </label>
          </div>

          <div class="property-row checkbox">
            <label>
              <input
                type="checkbox"
                checked={sc.showTransformGizmo !== false}
                onchange={(e) => doUpdate({ showTransformGizmo: (e.target as HTMLInputElement).checked })}
                data-midi-path="map:splat:showTransformGizmo"
                data-midi-label={$t('spatial.splat.rendering.showGizmo')}
                data-midi-mode="toggle"
              />
              {$t('spatial.splat.rendering.showGizmo')}
            </label>
          </div>
        </div>
      {/if}
    </div>

    <!-- Animation Section -->
    <div class="section collapsible" class:open={showAnimation}>
      <button class="section-header" onclick={() => (showAnimation = !showAnimation)}>
        <span>{$t('spatial.splat.sections.animation')}</span>
        <span class="chevron">{showAnimation ? '−' : '+'}</span>
      </button>
      {#if showAnimation}
        <div class="section-content">
          <div class="property-row">
            <label>{$t('spatial.common.type')}</label>
            <select
              value={sc.animationType}
              onchange={(e) => doUpdate({ animationType: (e.target as HTMLSelectElement).value as SplatAnimationType })}
              data-midi-path="map:splat:animationType"
              data-midi-label={$t('spatial.common.type')}
              data-midi-min="0"
              data-midi-max="16"
              data-midi-step="1"
              data-midi-discrete="none,explode,implode,slice,voxelSnap,peel,gravity,swarm,morph,orbit,wave3d,scatter,spiral,tumble,breathe,drift,vortex"
            >
              {#each animationTypes as anim}
                <option value={anim.value} title={$t(`spatial.${anim.descriptionKey}`)}
                  >{$t(`spatial.${anim.labelKey}`)}</option
                >
              {/each}
            </select>
          </div>

          {#if sc.animationType !== 'none'}
            <div class="property-row">
              <label>{$t('spatial.splat.animation.speed')}</label>
              <input
                type="range"
                min="0"
                max="5"
                step="0.01"
                value={sc.animationSpeed}
                oninput={(e) => doUpdate({ animationSpeed: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:animationSpeed"
                data-midi-label={$t('spatial.splat.animation.speed')}
                data-midi-min="0"
                data-midi-max="5"
                data-midi-step="0.01"
              />
              {@render splatModButton('animationSpeed')}
              <span class="value">{sc.animationSpeed.toFixed(2)}</span>
            </div>

            <div class="property-row">
              <label>{$t('spatial.splat.animation.intensity')}</label>
              <input
                type="range"
                min="0"
                max="2"
                step="0.01"
                value={sc.animationIntensity}
                oninput={(e) => doUpdate({ animationIntensity: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:animationIntensity"
                data-midi-label={$t('spatial.splat.animation.intensity')}
                data-midi-min="0"
                data-midi-max="2"
                data-midi-step="0.01"
              />
              {@render splatModButton('animationIntensity')}
              <span class="value">{sc.animationIntensity.toFixed(2)}</span>
            </div>

            {#each animationControls[sc.animationType] ?? [] as control}
              <div class="property-row">
                <label title={$t(`spatial.${control.labelKey}`)}>{$t(`spatial.${control.labelKey}`)}</label>
                <input
                  type="range"
                  min={control.min}
                  max={control.max}
                  step={control.step}
                  value={numericControlValue(control)}
                  oninput={(e) => updateNumericControl(control.key, parseFloat((e.target as HTMLInputElement).value))}
                  data-midi-path={`map:splat:${String(control.key)}`}
                  data-midi-label={$t(`spatial.${control.labelKey}`)}
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
                <label>{$t('spatial.common.axis')}</label>
                <select
                  value={sc.peelAxis ?? 'y'}
                  onchange={(e) => doUpdate({ peelAxis: (e.target as HTMLSelectElement).value as 'x' | 'y' | 'z' })}
                  data-midi-path="map:splat:peelAxis"
                  data-midi-label={$t('spatial.splat.animation.axis')}
                  data-midi-min="0"
                  data-midi-max="2"
                  data-midi-step="1"
                  data-midi-discrete="x,y,z"
                >
                  <option value="x">{$t('spatial.splat.animation.horizontalX')}</option>
                  <option value="y">{$t('spatial.splat.animation.verticalY')}</option>
                  <option value="z">{$t('spatial.splat.animation.depthZ')}</option>
                </select>
              </div>
            {/if}

            {#if sc.animationType === 'peel'}
              <div class="property-row">
                <label>{$t('spatial.splat.animation.direction')}</label>
                <select
                  value={sc.peelDirection ?? 1}
                  onchange={(e) =>
                    doUpdate({ peelDirection: parseInt((e.target as HTMLSelectElement).value, 10) as 1 | -1 })}
                  data-midi-path="map:splat:peelDirection"
                  data-midi-label={$t('spatial.splat.animation.direction')}
                  data-midi-min="0"
                  data-midi-max="1"
                  data-midi-step="1"
                  data-midi-discrete="1,-1"
                >
                  <option value={1}>{$t('spatial.splat.animation.forward')}</option>
                  <option value={-1}>{$t('spatial.splat.animation.reverse')}</option>
                </select>
              </div>
            {/if}

            {#if sc.animationType === 'wave3d'}
              <div class="property-row">
                <label>{$t('spatial.common.axis')}</label>
                <select
                  value={sc.waveAxis ?? 'y'}
                  onchange={(e) => doUpdate({ waveAxis: (e.target as HTMLSelectElement).value as 'x' | 'y' | 'z' })}
                  data-midi-path="map:splat:waveAxis"
                  data-midi-label={$t('spatial.splat.animation.axis')}
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
                  data-midi-label={$t('spatial.splat.animation.loop')}
                  data-midi-mode="toggle"
                />
                {$t('spatial.splat.animation.loop')}
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
                    data-midi-label={$t('spatial.splat.animation.pingPong')}
                    data-midi-mode="toggle"
                  />
                  {$t('spatial.splat.animation.pingPong')}
                </label>
              </div>
            {:else}
              <div class="property-row">
                <label>{$t('spatial.splat.animation.progress')}</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.001"
                  value={sc.animationProgress ?? 0}
                  oninput={(e) => doUpdate({ animationProgress: parseFloat((e.target as HTMLInputElement).value) })}
                  data-midi-path="map:splat:animationProgress"
                  data-midi-label={$t('spatial.splat.animation.progress')}
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
        <span>{$t('spatial.splat.sections.displacement')}</span>
        <span class="chevron">{showDisplacement ? '−' : '+'}</span>
      </button>
      {#if showDisplacement}
        <div class="section-content">
          <div class="property-row">
            <label>{$t('spatial.splat.displacement.type')}</label>
            <select
              value={sc.displacementType}
              onchange={(e) =>
                doUpdate({ displacementType: (e.target as HTMLSelectElement).value as SplatDisplacementType })}
              data-midi-path="map:splat:displacementType"
              data-midi-label={$t('spatial.splat.displacement.type')}
              data-midi-min="0"
              data-midi-max="11"
              data-midi-step="1"
              data-midi-discrete="none,noise,audioReactive,wave,glitch,wind,magnetic,ripple,curlNoise,twist,radialPulse,scanline"
            >
              {#each displacementTypes as disp}
                <option value={disp.value}>{$t(`spatial.${disp.labelKey}`)}</option>
              {/each}
            </select>
          </div>

          {#if sc.displacementType !== 'none'}
            <div class="property-row">
              <label>{$t('spatial.splat.displacement.amount')}</label>
              <input
                type="range"
                min="0"
                max="3"
                step="0.01"
                value={sc.displacementAmount ?? sc.displacementIntensity ?? 0.5}
                oninput={(e) => doUpdate({ displacementAmount: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:displacementAmount"
                data-midi-label={$t('spatial.splat.displacement.amount')}
                data-midi-min="0"
                data-midi-max="3"
                data-midi-step="0.01"
              />
              {@render splatModButton('displacementAmount')}
              <span class="value">{(sc.displacementAmount ?? sc.displacementIntensity ?? 0.5).toFixed(2)}</span>
            </div>

            <div class="property-row">
              <label>{$t('spatial.splat.displacement.scale')}</label>
              <input
                type="range"
                min="0.1"
                max="10"
                step="0.1"
                value={sc.displacementScale ?? sc.noiseScale ?? 1}
                oninput={(e) => doUpdate({ displacementScale: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:displacementScale"
                data-midi-label={$t('spatial.splat.displacement.scale')}
                data-midi-min="0.1"
                data-midi-max="10"
                data-midi-step="0.1"
              />
              {@render splatModButton('displacementScale')}
              <span class="value">{(sc.displacementScale ?? sc.noiseScale ?? 1).toFixed(1)}</span>
            </div>

            <div class="property-row">
              <label>{$t('spatial.splat.displacement.speed')}</label>
              <input
                type="range"
                min="0"
                max="5"
                step="0.01"
                value={sc.displacementSpeed ?? sc.noiseSpeed ?? 1}
                oninput={(e) => doUpdate({ displacementSpeed: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:displacementSpeed"
                data-midi-label={$t('spatial.splat.displacement.speed')}
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
                    data-midi-label={$t('spatial.splat.displacement.audio')}
                    data-midi-mode="toggle"
                  />
                  {$t('spatial.splat.displacement.audio')}
                </label>
              </div>

              <div class="property-row">
                <label>{$t('spatial.splat.displacement.band')}</label>
                <select
                  value={sc.audioBand ?? 'all'}
                  onchange={(e) => doUpdate({ audioBand: (e.target as HTMLSelectElement).value as any })}
                  data-midi-path="map:splat:audioBand"
                  data-midi-label={$t('spatial.splat.displacement.band')}
                  data-midi-min="0"
                  data-midi-max="6"
                  data-midi-step="1"
                  data-midi-discrete="all,sub,bass,lowMid,mid,highMid,high"
                >
                  <option value="all">{$t('spatial.splat.displacement.fullMix')}</option>
                  <option value="sub">{$t('spatial.splat.displacement.sub')}</option>
                  <option value="bass">{$t('spatial.splat.displacement.bass')}</option>
                  <option value="lowMid">{$t('spatial.splat.displacement.lowMid')}</option>
                  <option value="mid">{$t('spatial.splat.displacement.mid')}</option>
                  <option value="highMid">{$t('spatial.splat.displacement.highMid')}</option>
                  <option value="high">{$t('spatial.splat.displacement.high')}</option>
                </select>
              </div>

              <div class="property-row">
                <label>{$t('spatial.splat.displacement.sensitivity')}</label>
                <input
                  type="range"
                  min="0"
                  max="4"
                  step="0.01"
                  value={sc.audioSensitivity ?? 1}
                  oninput={(e) => doUpdate({ audioSensitivity: parseFloat((e.target as HTMLInputElement).value) })}
                  data-midi-path="map:splat:audioSensitivity"
                  data-midi-label={$t('spatial.splat.displacement.sensitivity')}
                  data-midi-min="0"
                  data-midi-max="4"
                  data-midi-step="0.01"
                />
                {@render splatModButton('audioSensitivity')}
                <span class="value">{(sc.audioSensitivity ?? 1).toFixed(2)}</span>
              </div>

              <div class="property-row">
                <label>{$t('spatial.splat.displacement.response')}</label>
                <input
                  type="range"
                  min="0"
                  max="3"
                  step="0.01"
                  value={sc.audioDisplacement ?? 1}
                  oninput={(e) => doUpdate({ audioDisplacement: parseFloat((e.target as HTMLInputElement).value) })}
                  data-midi-path="map:splat:audioDisplacement"
                  data-midi-label={$t('spatial.splat.displacement.response')}
                  data-midi-min="0"
                  data-midi-max="3"
                  data-midi-step="0.01"
                />
                {@render splatModButton('audioDisplacement')}
                <span class="value">{(sc.audioDisplacement ?? 1).toFixed(2)}</span>
              </div>

              <div class="property-row">
                <label>{$t('spatial.splat.displacement.smoothing')}</label>
                <input
                  type="range"
                  min="0"
                  max="0.98"
                  step="0.01"
                  value={sc.audioSmoothing ?? 0.7}
                  oninput={(e) => doUpdate({ audioSmoothing: parseFloat((e.target as HTMLInputElement).value) })}
                  data-midi-path="map:splat:audioSmoothing"
                  data-midi-label={$t('spatial.splat.displacement.smoothing')}
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
        <span>{$t('spatial.splat.sections.lighting')}</span>
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
                data-midi-label={$t('spatial.splat.lighting.pointLighting')}
                data-midi-mode="toggle"
              />
              {$t('spatial.splat.lighting.enable')}
            </label>
          </div>

          {#if sc.lightingEnabled ?? true}
            <div class="property-row">
              <label>{$t('spatial.common.ambient')}</label>
              <input
                type="range"
                min="0"
                max="2"
                step="0.01"
                value={sc.ambientIntensity ?? 0.65}
                oninput={(e) => doUpdate({ ambientIntensity: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:ambientIntensity"
                data-midi-label={$t('spatial.common.ambient')}
                data-midi-min="0"
                data-midi-max="2"
                data-midi-step="0.01"
              />
              {@render splatModButton('ambientIntensity')}
              <span class="value">{(sc.ambientIntensity ?? 0.65).toFixed(2)}</span>
            </div>

            <div class="property-row">
              <label>{$t('spatial.splat.lighting.keyColor')}</label>
              <input
                type="color"
                value={sc.keyLightColor ?? '#ffffff'}
                oninput={(e) => doUpdate({ keyLightColor: (e.target as HTMLInputElement).value })}
                data-midi-path="map:splat:keyLightColor"
                data-midi-label={$t('spatial.splat.lighting.keyColor')}
              />
            </div>

            <div class="property-row">
              <label>{$t('spatial.splat.lighting.keyPower')}</label>
              <input
                type="range"
                min="0"
                max="4"
                step="0.01"
                value={sc.keyLightIntensity ?? 1.25}
                oninput={(e) => doUpdate({ keyLightIntensity: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:keyLightIntensity"
                data-midi-label={$t('spatial.splat.lighting.keyPower')}
                data-midi-min="0"
                data-midi-max="4"
                data-midi-step="0.01"
              />
              {@render splatModButton('keyLightIntensity')}
              <span class="value">{(sc.keyLightIntensity ?? 1.25).toFixed(2)}</span>
            </div>

            <div class="property-row">
              <label>{$t('spatial.splat.lighting.keyOrbit')}</label>
              <input
                type="range"
                min="-180"
                max="180"
                step="1"
                value={sc.keyLightAzimuth ?? 35}
                oninput={(e) => doUpdate({ keyLightAzimuth: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:keyLightAzimuth"
                data-midi-label={$t('spatial.splat.lighting.keyOrbit')}
                data-midi-min="-180"
                data-midi-max="180"
                data-midi-step="1"
              />
              {@render splatModButton('keyLightAzimuth')}
              <span class="value">{(sc.keyLightAzimuth ?? 35).toFixed(0)}°</span>
            </div>

            <div class="property-row">
              <label>{$t('spatial.splat.lighting.keyHeight')}</label>
              <input
                type="range"
                min="-90"
                max="90"
                step="1"
                value={sc.keyLightElevation ?? 40}
                oninput={(e) => doUpdate({ keyLightElevation: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:keyLightElevation"
                data-midi-label={$t('spatial.splat.lighting.keyHeight')}
                data-midi-min="-90"
                data-midi-max="90"
                data-midi-step="1"
              />
              {@render splatModButton('keyLightElevation')}
              <span class="value">{(sc.keyLightElevation ?? 40).toFixed(0)}°</span>
            </div>

            <div class="property-row">
              <label>{$t('spatial.splat.lighting.rimColor')}</label>
              <input
                type="color"
                value={sc.rimLightColor ?? '#66ccff'}
                oninput={(e) => doUpdate({ rimLightColor: (e.target as HTMLInputElement).value })}
                data-midi-path="map:splat:rimLightColor"
                data-midi-label={$t('spatial.splat.lighting.rimColor')}
              />
            </div>

            <div class="property-row">
              <label>{$t('spatial.splat.lighting.rimPower')}</label>
              <input
                type="range"
                min="0"
                max="4"
                step="0.01"
                value={sc.rimLightIntensity ?? 0.8}
                oninput={(e) => doUpdate({ rimLightIntensity: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:rimLightIntensity"
                data-midi-label={$t('spatial.splat.lighting.rimPower')}
                data-midi-min="0"
                data-midi-max="4"
                data-midi-step="0.01"
              />
              {@render splatModButton('rimLightIntensity')}
              <span class="value">{(sc.rimLightIntensity ?? 0.8).toFixed(2)}</span>
            </div>

            <div class="property-row">
              <label>{$t('spatial.splat.lighting.rimOrbit')}</label>
              <input
                type="range"
                min="-180"
                max="180"
                step="1"
                value={sc.rimLightAzimuth ?? -120}
                oninput={(e) => doUpdate({ rimLightAzimuth: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:rimLightAzimuth"
                data-midi-label={$t('spatial.splat.lighting.rimOrbit')}
                data-midi-min="-180"
                data-midi-max="180"
                data-midi-step="1"
              />
              {@render splatModButton('rimLightAzimuth')}
              <span class="value">{(sc.rimLightAzimuth ?? -120).toFixed(0)}°</span>
            </div>

            <div class="property-row">
              <label>{$t('spatial.splat.lighting.shadows')}</label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={sc.shadowStrength ?? 0.25}
                oninput={(e) => doUpdate({ shadowStrength: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:shadowStrength"
                data-midi-label={$t('spatial.splat.lighting.shadowStrength')}
                data-midi-min="0"
                data-midi-max="1"
                data-midi-step="0.01"
              />
              {@render splatModButton('shadowStrength')}
              <span class="value">{(sc.shadowStrength ?? 0.25).toFixed(2)}</span>
            </div>

            <div class="property-row">
              <label>{$t('spatial.splat.lighting.softness')}</label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={sc.shadowSoftness ?? 0.45}
                oninput={(e) => doUpdate({ shadowSoftness: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:shadowSoftness"
                data-midi-label={$t('spatial.splat.lighting.softness')}
                data-midi-min="0"
                data-midi-max="1"
                data-midi-step="0.01"
              />
              {@render splatModButton('shadowSoftness')}
              <span class="value">{(sc.shadowSoftness ?? 0.45).toFixed(2)}</span>
            </div>

            <div class="property-row">
              <label>{$t('spatial.splat.lighting.specular')}</label>
              <input
                type="range"
                min="0"
                max="2"
                step="0.01"
                value={sc.specularStrength ?? 0.35}
                oninput={(e) => doUpdate({ specularStrength: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:specularStrength"
                data-midi-label={$t('spatial.splat.lighting.specular')}
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

    <!-- Atmosphere Section -->
    <div class="section collapsible" class:open={showAtmosphere}>
      <button class="section-header" onclick={() => (showAtmosphere = !showAtmosphere)}>
        <span>{$t('spatial.splat.sections.atmosphere')}</span>
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
                data-midi-label={$t('spatial.splat.atmosphere.pointAtmosphere')}
                data-midi-mode="toggle"
              />
              {$t('spatial.splat.atmosphere.enable')}
            </label>
          </div>

          {#if sc.atmosphereEnabled}
            <div class="property-row">
              <label>{$t('spatial.splat.atmosphere.density')}</label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={sc.atmosphereDensity ?? 0.25}
                oninput={(e) => doUpdate({ atmosphereDensity: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:atmosphereDensity"
                data-midi-label={$t('spatial.splat.atmosphere.density')}
                data-midi-min="0"
                data-midi-max="1"
                data-midi-step="0.01"
              />
              {@render splatModButton('atmosphereDensity')}
              <span class="value">{(sc.atmosphereDensity ?? 0.25).toFixed(2)}</span>
            </div>

            <div class="property-row">
              <label>{$t('spatial.splat.atmosphere.color')}</label>
              <input
                type="color"
                value={sc.atmosphereColor ?? '#8aa4c8'}
                oninput={(e) => doUpdate({ atmosphereColor: (e.target as HTMLInputElement).value })}
                data-midi-path="map:splat:atmosphereColor"
                data-midi-label={$t('spatial.splat.atmosphere.color')}
              />
            </div>

            <div class="property-row">
              <label>{$t('spatial.splat.atmosphere.scale')}</label>
              <input
                type="range"
                min="0.1"
                max="8"
                step="0.01"
                value={sc.atmosphereScale ?? 1.5}
                oninput={(e) => doUpdate({ atmosphereScale: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:atmosphereScale"
                data-midi-label={$t('spatial.splat.atmosphere.scale')}
                data-midi-min="0.1"
                data-midi-max="8"
                data-midi-step="0.01"
              />
              {@render splatModButton('atmosphereScale')}
              <span class="value">{(sc.atmosphereScale ?? 1.5).toFixed(2)}</span>
            </div>

            <div class="property-row">
              <label>{$t('spatial.splat.atmosphere.turbulence')}</label>
              <input
                type="range"
                min="0"
                max="2"
                step="0.01"
                value={sc.atmosphereTurbulence ?? 0.7}
                oninput={(e) => doUpdate({ atmosphereTurbulence: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:atmosphereTurbulence"
                data-midi-label={$t('spatial.splat.atmosphere.turbulence')}
                data-midi-min="0"
                data-midi-max="2"
                data-midi-step="0.01"
              />
              {@render splatModButton('atmosphereTurbulence')}
              <span class="value">{(sc.atmosphereTurbulence ?? 0.7).toFixed(2)}</span>
            </div>

            <div class="property-row">
              <label>{$t('spatial.splat.atmosphere.driftSpeed')}</label>
              <input
                type="range"
                min="-2"
                max="2"
                step="0.01"
                value={sc.atmosphereSpeed ?? 0.25}
                oninput={(e) => doUpdate({ atmosphereSpeed: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:atmosphereSpeed"
                data-midi-label={$t('spatial.splat.atmosphere.driftSpeed')}
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
        <span>{$t('spatial.splat.sections.colorEffects')}</span>
        <span class="chevron">{showColorEffects ? '−' : '+'}</span>
      </button>
      {#if showColorEffects}
        <div class="section-content">
          <div class="property-row">
            <label>{$t('spatial.common.effect')}</label>
            <select
              value={sc.colorEffect}
              onchange={(e) => doUpdate({ colorEffect: (e.target as HTMLSelectElement).value as SplatColorEffectType })}
              data-midi-path="map:splat:colorEffect"
              data-midi-label={$t('spatial.common.effect')}
              data-midi-min="0"
              data-midi-max="11"
              data-midi-step="1"
              data-midi-discrete="none,chromatic,heatmap,pointillist,hologram,rainbow,depthGradient,neon,pastel,cyberpunk,fire,ice"
            >
              {#each colorEffectTypes as effect}
                <option value={effect.value}>{$t(`spatial.${effect.labelKey}`)}</option>
              {/each}
            </select>
          </div>

          {#if sc.colorEffect !== 'none'}
            <div class="property-row">
              <label>{$t('spatial.splat.effects.intensity')}</label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={sc.colorEffectIntensity}
                oninput={(e) => doUpdate({ colorEffectIntensity: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:colorEffectIntensity"
                data-midi-label={$t('spatial.splat.effects.intensity')}
                data-midi-min="0"
                data-midi-max="1"
                data-midi-step="0.01"
              />
              {@render splatModButton('colorEffectIntensity')}
              <span class="value">{(sc.colorEffectIntensity * 100).toFixed(0)}%</span>
            </div>

            <div class="property-row">
              <label>{$t('spatial.splat.effects.speed')}</label>
              <input
                type="range"
                min="0"
                max="5"
                step="0.01"
                value={sc.colorEffectSpeed}
                oninput={(e) => doUpdate({ colorEffectSpeed: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:colorEffectSpeed"
                data-midi-label={$t('spatial.splat.effects.speed')}
                data-midi-min="0"
                data-midi-max="5"
                data-midi-step="0.01"
              />
              {@render splatModButton('colorEffectSpeed')}
              <span class="value">{sc.colorEffectSpeed.toFixed(2)}</span>
            </div>

            {#if sc.colorEffect === 'depthGradient'}
              <div class="property-row">
                <label>{$t('spatial.splat.effects.nearColor')}</label>
                <input
                  class="color-input"
                  type="color"
                  value={sc.depthColorNear ?? '#ff5c33'}
                  oninput={(e) => doUpdate({ depthColorNear: (e.target as HTMLInputElement).value })}
                  data-midi-path="map:splat:depthColorNear"
                  data-midi-label={$t('spatial.splat.effects.nearColor')}
                />
              </div>
              <div class="property-row">
                <label>{$t('spatial.splat.effects.farColor')}</label>
                <input
                  class="color-input"
                  type="color"
                  value={sc.depthColorFar ?? '#3377ff'}
                  oninput={(e) => doUpdate({ depthColorFar: (e.target as HTMLInputElement).value })}
                  data-midi-path="map:splat:depthColorFar"
                  data-midi-label={$t('spatial.splat.effects.farColor')}
                />
              </div>
              <div class="property-row">
                <label>{$t('spatial.splat.effects.depthBias')}</label>
                <input
                  type="range"
                  min="0.05"
                  max="0.95"
                  step="0.01"
                  value={sc.depthGradientBias ?? 0.5}
                  oninput={(e) => doUpdate({ depthGradientBias: parseFloat((e.target as HTMLInputElement).value) })}
                  data-midi-path="map:splat:depthGradientBias"
                  data-midi-label={$t('spatial.splat.effects.depthBias')}
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
        <span>{$t('spatial.splat.sections.opacityEffects')}</span>
        <span class="chevron">{showOpacityEffects ? '−' : '+'}</span>
      </button>
      {#if showOpacityEffects}
        <div class="section-content">
          <div class="property-row">
            <label>{$t('spatial.common.effect')}</label>
            <select
              value={sc.opacityEffect}
              onchange={(e) =>
                doUpdate({ opacityEffect: (e.target as HTMLSelectElement).value as SplatOpacityEffectType })}
              data-midi-path="map:splat:opacityEffect"
              data-midi-label={$t('spatial.common.effect')}
              data-midi-min="0"
              data-midi-max="5"
              data-midi-step="1"
              data-midi-discrete="none,dof,fog,pulse,proximity,dissolve"
            >
              {#each opacityEffectTypes as effect}
                <option value={effect.value}>{$t(`spatial.${effect.labelKey}`)}</option>
              {/each}
            </select>
          </div>

          {#if sc.opacityEffect !== 'none'}
            <div class="property-row">
              <label>{$t('spatial.splat.effects.opacityIntensity')}</label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={sc.opacityEffectIntensity}
                oninput={(e) => doUpdate({ opacityEffectIntensity: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:opacityEffectIntensity"
                data-midi-label={$t('spatial.splat.effects.opacityIntensity')}
                data-midi-min="0"
                data-midi-max="1"
                data-midi-step="0.01"
              />
              {@render splatModButton('opacityEffectIntensity')}
              <span class="value">{(sc.opacityEffectIntensity * 100).toFixed(0)}%</span>
            </div>

            {#if sc.opacityEffect === 'dof'}
              <div class="property-row">
                <label>{$t('spatial.splat.effects.focusDistance')}</label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="0.1"
                  value={sc.dofFocusDistance}
                  oninput={(e) => doUpdate({ dofFocusDistance: parseFloat((e.target as HTMLInputElement).value) })}
                  data-midi-path="map:splat:dofFocusDistance"
                  data-midi-label={$t('spatial.splat.effects.focusDistance')}
                  data-midi-min="0"
                  data-midi-max="100"
                  data-midi-step="0.1"
                />
                {@render splatModButton('dofFocusDistance')}
                <span class="value">{sc.dofFocusDistance.toFixed(1)}</span>
              </div>

              <div class="property-row">
                <label>{$t('spatial.splat.effects.blurAmount')}</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={sc.dofBlurAmount}
                  oninput={(e) => doUpdate({ dofBlurAmount: parseFloat((e.target as HTMLInputElement).value) })}
                  data-midi-path="map:splat:dofBlurAmount"
                  data-midi-label={$t('spatial.splat.effects.blurAmount')}
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
                <label>{$t('spatial.splat.effects.fogDensity')}</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={sc.fogDensity}
                  oninput={(e) => doUpdate({ fogDensity: parseFloat((e.target as HTMLInputElement).value) })}
                  data-midi-path="map:splat:fogDensity"
                  data-midi-label={$t('spatial.splat.effects.fogDensity')}
                  data-midi-min="0"
                  data-midi-max="1"
                  data-midi-step="0.01"
                />
                {@render splatModButton('fogDensity')}
                <span class="value">{(sc.fogDensity * 100).toFixed(0)}%</span>
              </div>

              <div class="property-row">
                <label>{$t('spatial.common.fogColor')}</label>
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
        <span>{$t('spatial.splat.sections.creativeEffects')}</span>
        <span class="chevron">{showCreativeEffects ? '−' : '+'}</span>
      </button>
      {#if showCreativeEffects}
        <div class="section-content">
          <div class="property-row">
            <label>{$t('spatial.common.effect')}</label>
            <select
              value={sc.creativeEffect}
              onchange={(e) =>
                doUpdate({ creativeEffect: (e.target as HTMLSelectElement).value as SplatCreativeEffectType })}
              data-midi-path="map:splat:creativeEffect"
              data-midi-label={$t('spatial.common.effect')}
              data-midi-min="0"
              data-midi-max="6"
              data-midi-step="1"
              data-midi-discrete="none,feedback,kaleidoscope,constellation,datamosh,pixelSort,echo"
            >
              {#each creativeEffectTypes as effect}
                <option value={effect.value}>{$t(`spatial.${effect.labelKey}`)}</option>
              {/each}
            </select>
          </div>

          {#if sc.creativeEffect !== 'none'}
            <div class="property-row">
              <label>{$t('spatial.splat.effects.creativeIntensity')}</label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={sc.creativeEffectIntensity}
                oninput={(e) => doUpdate({ creativeEffectIntensity: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:creativeEffectIntensity"
                data-midi-label={$t('spatial.splat.effects.creativeIntensity')}
                data-midi-min="0"
                data-midi-max="1"
                data-midi-step="0.01"
              />
              {@render splatModButton('creativeEffectIntensity')}
              <span class="value">{(sc.creativeEffectIntensity * 100).toFixed(0)}%</span>
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Camera Section -->
    <div class="section collapsible" class:open={showCamera}>
      <button class="section-header" onclick={() => (showCamera = !showCamera)}>
        <span>{$t('spatial.splat.sections.camera')}</span>
        <span class="chevron">{showCamera ? '−' : '+'}</span>
      </button>
      {#if showCamera}
        <div class="section-content">
          <button class="reset-button" onclick={frameObject}>{$t('spatial.splat.camera.frame')}</button>

          <div class="property-row checkbox">
            <label>
              <input
                type="checkbox"
                checked={sc.cameraOrbitEnabled}
                onchange={(e) => doUpdate({ cameraOrbitEnabled: (e.target as HTMLInputElement).checked })}
                data-midi-path="map:splat:cameraOrbitEnabled"
                data-midi-label={$t('spatial.splat.camera.enableOrbit')}
                data-midi-mode="toggle"
              />
              {$t('spatial.splat.camera.enableOrbit')}
            </label>
          </div>

          <div class="property-row checkbox">
            <label>
              <input
                type="checkbox"
                checked={sc.autoRotate}
                onchange={(e) => doUpdate({ autoRotate: (e.target as HTMLInputElement).checked })}
                data-midi-path="map:splat:autoRotate"
                data-midi-label={$t('spatial.splat.camera.autoRotate')}
                data-midi-mode="toggle"
              />
              {$t('spatial.splat.camera.autoRotate')}
            </label>
          </div>

          {#if sc.autoRotate}
            <div class="property-row">
              <label>{$t('spatial.splat.camera.autoRotateSpeed')}</label>
              <input
                type="range"
                min="0"
                max="5"
                step="0.1"
                value={sc.autoRotateSpeed}
                oninput={(e) => doUpdate({ autoRotateSpeed: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:autoRotateSpeed"
                data-midi-label={$t('spatial.splat.camera.autoRotateSpeed')}
                data-midi-min="0"
                data-midi-max="5"
                data-midi-step="0.1"
              />
              {@render splatModButton('autoRotateSpeed')}
              <span class="value">{sc.autoRotateSpeed.toFixed(1)}</span>
            </div>
          {/if}

          <div class="property-row">
            <label>{$t('spatial.splat.camera.fov')}</label>
            <input
              type="range"
              min="20"
              max="120"
              step="1"
              value={sc.cameraFov}
              oninput={(e) => doUpdate({ cameraFov: parseInt((e.target as HTMLInputElement).value) })}
              data-midi-path="map:splat:cameraFov"
              data-midi-label={$t('spatial.splat.camera.fov')}
              data-midi-min="20"
              data-midi-max="120"
              data-midi-step="1"
            />
            {@render splatModButton('cameraFov')}
            <span class="value">{sc.cameraFov}</span>
          </div>

          <div class="property-row">
            <label>{$t('spatial.splat.camera.distance')}</label>
            <input
              type="range"
              min="1.5"
              max="30"
              step="0.1"
              value={sc.cameraDistance}
              oninput={(e) => doUpdate({ cameraDistance: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:splat:cameraDistance"
              data-midi-label={$t('spatial.splat.camera.distance')}
              data-midi-min="1.5"
              data-midi-max="30"
              data-midi-step="0.1"
            />
            {@render splatModButton('cameraDistance')}
            <span class="value">{sc.cameraDistance.toFixed(1)}</span>
          </div>

          <div class="property-row">
            <label>{$t('spatial.splat.camera.pitch')}</label>
            <input
              type="range"
              min="-89"
              max="89"
              step="1"
              value={sc.cameraOrbitX ?? 0}
              oninput={(e) => doUpdate({ cameraOrbitX: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:splat:cameraOrbitX"
              data-midi-label={$t('spatial.splat.camera.pitch')}
              data-midi-min="-89"
              data-midi-max="89"
              data-midi-step="1"
            />
            {@render splatModButton('cameraOrbitX')}
            <span class="value">{(sc.cameraOrbitX ?? 0).toFixed(0)}</span>
          </div>

          <div class="property-row">
            <label>{$t('spatial.splat.camera.yaw')}</label>
            <input
              type="range"
              min="-180"
              max="180"
              step="1"
              value={sc.cameraOrbitY ?? 0}
              oninput={(e) => doUpdate({ cameraOrbitY: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:splat:cameraOrbitY"
              data-midi-label={$t('spatial.splat.camera.yaw')}
              data-midi-min="-180"
              data-midi-max="180"
              data-midi-step="1"
            />
            {@render splatModButton('cameraOrbitY')}
            <span class="value">{(sc.cameraOrbitY ?? 0).toFixed(0)}</span>
          </div>

          <div class="property-row">
            <label>{$t('spatial.splat.camera.roll')}</label>
            <input
              type="range"
              min="-180"
              max="180"
              step="1"
              value={sc.cameraRoll ?? 0}
              oninput={(e) => doUpdate({ cameraRoll: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:splat:cameraRoll"
              data-midi-label={$t('spatial.splat.camera.roll')}
              data-midi-min="-180"
              data-midi-max="180"
              data-midi-step="1"
            />
            {@render splatModButton('cameraRoll')}
            <span class="value">{(sc.cameraRoll ?? 0).toFixed(0)}</span>
          </div>

          <div class="property-row">
            <label>{$t('spatial.splat.camera.panX')}</label>
            <input
              type="range"
              min="-100"
              max="100"
              step="0.5"
              value={sc.cameraPanX ?? 0}
              oninput={(e) => doUpdate({ cameraPanX: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:splat:cameraPanX"
              data-midi-label={$t('spatial.splat.camera.panX')}
              data-midi-min="-100"
              data-midi-max="100"
              data-midi-step="0.5"
            />
            {@render splatModButton('cameraPanX')}
            <span class="value">{(sc.cameraPanX ?? 0).toFixed(1)}</span>
          </div>

          <div class="property-row">
            <label>{$t('spatial.splat.camera.panY')}</label>
            <input
              type="range"
              min="-100"
              max="100"
              step="0.5"
              value={sc.cameraPanY ?? 0}
              oninput={(e) => doUpdate({ cameraPanY: parseFloat((e.target as HTMLInputElement).value) })}
              data-midi-path="map:splat:cameraPanY"
              data-midi-label={$t('spatial.splat.camera.panY')}
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
        <span>{$t('spatial.splat.sections.mouse')}</span>
        <span class="chevron">{showMouse ? '−' : '+'}</span>
      </button>
      {#if showMouse}
        <div class="section-content">
          <div class="property-row">
            <label>{$t('spatial.common.mode')}</label>
            <select
              value={sc.mouseInteraction}
              onchange={(e) =>
                doUpdate({ mouseInteraction: (e.target as HTMLSelectElement).value as SplatMouseInteraction })}
              data-midi-path="map:splat:mouseInteraction"
              data-midi-label={$t('spatial.splat.mouse.mode')}
              data-midi-mode="absolute"
              data-midi-min="0"
              data-midi-max="4"
              data-midi-step="1"
              data-midi-discrete="none,attract,repel,swirl,reveal"
            >
              {#each mouseInteractions as mode}
                <option value={mode.value}>{$t(`spatial.${mode.labelKey}`)}</option>
              {/each}
            </select>
          </div>

          {#if sc.mouseInteraction !== 'none'}
            <div class="property-row">
              <label>{$t('spatial.splat.mouse.radius')}</label>
              <input
                type="range"
                min="0.05"
                max="1"
                step="0.01"
                value={sc.mouseRadius}
                oninput={(e) => doUpdate({ mouseRadius: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:mouseRadius"
                data-midi-label={$t('spatial.splat.mouse.radius')}
                data-midi-min="0.05"
                data-midi-max="1"
                data-midi-step="0.01"
              />
              {@render splatModButton('mouseRadius')}
              <span class="value">{(sc.mouseRadius * 100).toFixed(0)}%</span>
            </div>

            <div class="property-row">
              <label>{$t('spatial.splat.mouse.strength')}</label>
              <input
                type="range"
                min="0.1"
                max="3"
                step="0.05"
                value={sc.mouseStrength}
                oninput={(e) => doUpdate({ mouseStrength: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:mouseStrength"
                data-midi-label={$t('spatial.splat.mouse.strength')}
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
        <span>{$t('spatial.splat.sections.physics')}</span>
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
                data-midi-label={$t('spatial.splat.physics.enable')}
                data-midi-mode="toggle"
              />
              {$t('spatial.splat.physics.enable')}
            </label>
          </div>

          {#if sc.physicsEnabled}
            <div class="property-row">
              <label>{$t('spatial.splat.physics.gravity')}</label>
              <input
                type="range"
                min="-20"
                max="20"
                step="0.1"
                value={sc.gravity}
                oninput={(e) => doUpdate({ gravity: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:gravity"
                data-midi-label={$t('spatial.splat.physics.gravity')}
                data-midi-min="-20"
                data-midi-max="20"
                data-midi-step="0.1"
              />
              {@render splatModButton('gravity')}
              <span class="value">{sc.gravity.toFixed(1)}</span>
            </div>

            <div class="property-row">
              <label>{$t('spatial.splat.physics.friction')}</label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={sc.friction}
                oninput={(e) => doUpdate({ friction: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:friction"
                data-midi-label={$t('spatial.splat.physics.friction')}
                data-midi-min="0"
                data-midi-max="1"
                data-midi-step="0.01"
              />
              {@render splatModButton('friction')}
              <span class="value">{sc.friction.toFixed(2)}</span>
            </div>

            <div class="property-row">
              <label>{$t('spatial.splat.physics.bounciness')}</label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={sc.bounciness}
                oninput={(e) => doUpdate({ bounciness: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:splat:bounciness"
                data-midi-label={$t('spatial.splat.physics.bounciness')}
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
  <div class="no-layer">
    <p>{$t('spatial.splat.noLayer')}</p>
  </div>
{/if}

<style>
  .splat-panel {
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

  .chevron {
    font-size: 17px;
    color: var(--text-secondary, #888);
  }

  .property-row {
    display: flex;
    align-items: center;
    gap: 7px;
  }

  .property-row :global(.epr.button-only) {
    flex: 1 1 auto;
    min-width: 0;
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

  /* Only style the panel's own slider. EffectParamRow mounts its Auto
     slippers inside the same property row; a descendant selector here
     turns those slim cyan handles into full-size splat thumbs. */
  .property-row > input[type='range'] {
    flex: 1;
    height: 6px;
    background: #000000;
    border-radius: 3px;
    -webkit-appearance: none;
    cursor: pointer;
  }

  .property-row > input[type='range']::-webkit-slider-thumb {
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
    flex: 0 1 auto;
    min-width: 0;
    max-width: none;
    gap: 8px;
    cursor: pointer;
    color: var(--text-primary, #e0e0e0);
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
    padding: 7px 10px;
    border: 1px solid var(--border-color, #333);
    border-radius: 4px;
    background: var(--bg-secondary, #161618);
    color: var(--text-primary, #e0e0e0);
    cursor: pointer;
    font-size: 12px;
  }

  .reset-button:hover {
    border-color: var(--accent-primary, #bb86fc);
  }

  .reset-button:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  .orientation-actions {
    display: grid;
    grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr);
    gap: 8px;
  }

  .orientation-actions .reset-button {
    min-width: 0;
    padding-inline: 8px;
  }

  .orientation-readout {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 12px;
    color: var(--text-secondary, #98a0ad);
    font-family: var(--ga-font-mono, 'IBM Plex Mono', ui-monospace, monospace);
    font-size: 11px;
  }

  .section-note {
    margin: 0;
    color: var(--text-muted, #6f7784);
    font-size: 11px;
    line-height: 1.35;
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

  .point-count {
    color: var(--accent-primary, #bb86fc);
  }

  .data-type {
    color: var(--text-secondary, #888);
  }

  .density-info {
    font-size: 11px;
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
