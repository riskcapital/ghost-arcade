<script lang="ts">
  import { project, layers, selectedLayer, selectedLayerId, selectedLayerIds, getGroupLayers } from '../stores/layers';
  import { confirmDeleteIfSafeMode } from '../utils/safeMode';
  // import AutoMapPanel from './AutoMapPanel.svelte';
  import { vjClipLauncher } from '../stores/vjClipLauncher';
  import type { BlendMode, MediaSource, EffectType, ContentFitMode, VideoPlaybackMode } from '../types';
  import { generateUUID } from '../types';
  import { onDestroy } from 'svelte';
  // ShapeType import removed — Lines layer uses pen tools instead of shape library
  import { getDefaultEffectParams } from '../renderer/effects';
  import { applyPresetToEffect, getEffectPresets, getNumericEffectParams, effectParamLabels } from '../effects/effectUX';
  import { EFFECT_CATALOG } from '../effects/effectCatalog';
  import EffectPickerModal from './EffectPickerModal.svelte';
  import EdgeEffectsPanel from './EdgeEffectsPanel.svelte';
  import EffectParamRow from './EffectParamRow.svelte';
  import { generateCachedThumbnail } from '../isf/thumbnail';
  import { webgpuSupportedStore } from '../renderer/webgpuCapability';
  import { createAssetRefFromFile } from '../storage/assetRegistry';

  // WebGPU capability — reactive store, NOT a snapshot. The probe is
  // async and may not have resolved when this panel first mounts;
  // subscribing to the store means the GPU Shader layer button
  // appears the instant the probe lands instead of staying hidden
  // until the next remount.

  // Shader thumbnail cache: layerId -> { url, codeSnippet }
  let shaderThumbnails: Record<string, string> = {};
  let shaderThumbCodes: Record<string, string> = {}; // track which code generated the thumb

  // Reactively generate thumbnails for shader layers
  $: {
    for (const layer of $layers) {
      if (layer.source?.type === 'shader' && layer.source.shaderCode) {
        const lid = layer.id;
        const code = layer.source.shaderCode;
        const codeKey = code.slice(0, 100); // quick identity check
        if (!shaderThumbnails[lid] || shaderThumbCodes[lid] !== codeKey) {
          shaderThumbCodes[lid] = codeKey;
          generateCachedThumbnail(code).then(url => {
            if (url) shaderThumbnails = { ...shaderThumbnails, [lid]: url };
          });
        }
      }
    }
  }

  // Layer type dropdown state
  let showAddLayerMenu = false;
  let addMenuPos = { top: 0, left: 0 };
  // Context menu state. We snapshot the multi-selection IDs at the moment
  // the menu opens — otherwise some other UI action (canvas click, drag-
  // select clear, layer hit-test on the viewport) can reset the selection
  // between menu open and menu-item click, leaving "Group selected" with
  // only the right-clicked layer in scope.
  let ctxMenu: { x: number; y: number; layerId: string; selectionSnapshot: string[] } | null = null;
  let ctxGroupSubmenu = false; // show "Add to Group" submenu
  // Inline rename state — id of the layer whose name is being edited.
  // Set on dbl-click of the layer name; cleared on Enter / blur / Esc.
  let renamingLayerId: string | null = null;

  function handleLayerContextMenu(layerId: string, e: MouseEvent) {
    e.preventDefault();
    // Snapshot selection NOW. Including the right-clicked layer if not
    // already in the selection — right-clicking on an unselected layer
    // intuitively means "act on this layer too".
    const sel = $selectedLayerIds.includes(layerId)
      ? [...$selectedLayerIds]
      : [...$selectedLayerIds, layerId];
    console.log('[ctxmenu open] right-clicked=', layerId, 'snapshot=', sel);
    ctxMenu = { x: e.clientX, y: e.clientY, layerId, selectionSnapshot: sel };
    ctxGroupSubmenu = false;
  }
  function closeContextMenu() { ctxMenu = null; ctxGroupSubmenu = false; }
  let shapeWarpEditing = false;
  $: if (!$selectedLayer || !$selectedLayer.layerShape || !($selectedLayer.layerShape.type === 'circle' || $selectedLayer.layerShape.type === 'triangle')) {
    shapeWarpEditing = false;
  }

  const blendModes: BlendMode[] = [
    'normal',
    'multiply',
    'screen',
    'difference',
    'add',
    'subtract',
    'overlay',
    'darken',
    'lighten',
    'exclusion',
    'hardlight',
    'softlight',
    'color-dodge',
    'color-burn',
    'hue',
    'saturation',
    'color',
    'luminosity',
    'divide',
    'average',
    'negation',
    'phoenix',
    'linear-light',
    'hard-mix',
    'vivid-light',
    'pin-light',
  ];

  // Drag and drop state
  let draggedIndex: number | null = null;
  let dragOverIndex: number | null = null;
  let lastLayerSelectIndex: number | null = null;

  function selectLayerWithModifiers(layerId: string, index: number, e?: MouseEvent | KeyboardEvent) {
    const isShift = !!e?.shiftKey;
    const isToggle = !!(e && ('ctrlKey' in e ? (e.ctrlKey || (e as MouseEvent).metaKey) : false));
    console.log('[select] layer=', layerId, 'index=', index, 'shift=', isShift, 'toggle=', isToggle, 'meta=', (e as MouseEvent)?.metaKey, 'ctrl=', (e as MouseEvent)?.ctrlKey, 'currentSel=', $selectedLayerIds);
    const idsInOrder = $layers.map(l => l.id);

    if (isShift && lastLayerSelectIndex !== null) {
      const start = Math.min(lastLayerSelectIndex, index);
      const end = Math.max(lastLayerSelectIndex, index);
      const rangeIds = idsInOrder.slice(start, end + 1);
      const nextIds = isToggle
        ? Array.from(new Set([...$selectedLayerIds, ...rangeIds]))
        : rangeIds;
      project.setLayerSelection(layerId, nextIds);
    } else if (isToggle) {
      const exists = $selectedLayerIds.includes(layerId);
      const nextIds = exists
        ? $selectedLayerIds.filter(id => id !== layerId)
        : [...$selectedLayerIds, layerId];
      project.setLayerSelection(layerId, nextIds.length > 0 ? nextIds : [layerId]);
      lastLayerSelectIndex = index;
      return;
    } else {
      project.selectLayer(layerId);
    }

    lastLayerSelectIndex = index;
  }

  let dragOverZone: 'above' | 'below' | 'into' = 'above';

  function handleDragStart(index: number, e: DragEvent) {
    draggedIndex = index;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(index));
    }
  }

  function handleDragEnd() {
    draggedIndex = null;
    dragOverIndex = null;
    dragOverZone = 'above';
  }

  function handleLayerDragOver(index: number, e: DragEvent) {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'move';
    }
    dragOverIndex = index;

    // 3-zone detection for group nesting
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = e.clientY - rect.top;
    const third = rect.height / 3;
    if (y < third) {
      dragOverZone = 'above';
    } else if (y > third * 2) {
      dragOverZone = 'below';
    } else {
      // Middle zone: only allow "into" on group layers
      dragOverZone = $layers[index]?.type === 'group' ? 'into' : (y < rect.height / 2 ? 'above' : 'below');
    }
  }

  function handleLayerDragLeave() {
    dragOverIndex = null;
    dragOverZone = 'above';
  }

  function handleLayerDrop(toIndex: number, e: DragEvent) {
    e.preventDefault();
    if (draggedIndex !== null && draggedIndex !== toIndex) {
      const draggedLayer = $layers[draggedIndex];
      const targetLayer = $layers[toIndex];

      if (dragOverZone === 'into' && targetLayer?.type === 'group') {
        // Drop into group
        if (draggedLayer) {
          project.addToGroup([draggedLayer.id], targetLayer.id);
        }
      } else {
        // Block-aware reorder: if target is a child of a group, redirect to group boundary
        if (targetLayer?.parentGroupId && draggedLayer?.id !== targetLayer.parentGroupId) {
          // Find group boundaries
          const groupIdx = $layers.findIndex(l => l.id === targetLayer.parentGroupId);
          if (groupIdx >= 0) {
            // Redirect: above goes above the group, below goes below last child
            if (dragOverZone === 'above') {
              project.reorderLayers(draggedIndex, groupIdx);
            } else {
              let lastChildIdx = groupIdx;
              for (let i = groupIdx + 1; i < $layers.length; i++) {
                if ($layers[i].parentGroupId === targetLayer.parentGroupId) lastChildIdx = i;
                else break;
              }
              project.reorderLayers(draggedIndex, lastChildIdx + 1);
            }
          }
        } else {
          project.reorderLayers(draggedIndex, toIndex);
        }
      }
    }
    draggedIndex = null;
    dragOverIndex = null;
  }

  // ─── Video Timeline State ───────────────────────────────────────────
  let videoCurrentTime = 0;
  let videoDuration = 0;
  let trimDragging: 'start' | 'end' | null = null;
  let timelineScrubbing = false;
  let timelineEl: HTMLDivElement | null = null;
  let videoTickFrame: number | null = null;

  function formatTime(seconds: number): string {
    if (!isFinite(seconds) || isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function startVideoTick() {
    if (videoTickFrame !== null) return;
    function tick() {
      const layer = $selectedLayer;
      if (layer?.source?.type === 'video' && layer.source.videoElement) {
        videoCurrentTime = layer.source.videoElement.currentTime;
        videoDuration = layer.source.videoElement.duration || 0;
      }
      videoTickFrame = requestAnimationFrame(tick);
    }
    tick();
  }

  function stopVideoTick() {
    if (videoTickFrame !== null) {
      cancelAnimationFrame(videoTickFrame);
      videoTickFrame = null;
    }
  }

  // Start tick when selected layer is a video
  $: if ($selectedLayer?.source?.type === 'video' && $selectedLayer.source.videoElement) {
    startVideoTick();
  } else {
    stopVideoTick();
  }

  onDestroy(() => stopVideoTick());

  function setPlaybackMode(layerId: string, source: MediaSource, mode: VideoPlaybackMode) {
    source.playbackMode = mode;
    source._lastFrameTime = performance.now();
    project.updateLayer(layerId, {});
  }

  function setPlaybackRate(layerId: string, source: MediaSource, rate: number) {
    source.playbackRate = rate;
    project.updateLayer(layerId, {});
  }

  function handleTimelineMouseDown(e: MouseEvent, layerId: string, source: MediaSource) {
    if (!timelineEl || !source.videoElement) return;
    e.stopPropagation();
    timelineScrubbing = true;
    seekToPosition(e, source);

    const onMove = (me: MouseEvent) => seekToPosition(me, source);
    const onUp = () => {
      timelineScrubbing = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function seekToPosition(e: MouseEvent, source: MediaSource) {
    if (!timelineEl || !source.videoElement) return;
    const rect = timelineEl.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / (rect.width || 1)));
    source.videoElement.currentTime = pct * (source.videoElement.duration || 0);
  }

  function handleTrimMouseDown(e: MouseEvent, which: 'start' | 'end', layerId: string, source: MediaSource) {
    e.stopPropagation();
    e.preventDefault();
    trimDragging = which;

    const onMove = (me: MouseEvent) => {
      if (!timelineEl) return;
      const rect = timelineEl.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (me.clientX - rect.left) / (rect.width || 1)));

      if (which === 'start') {
        source.trimStart = Math.min(pct, (source.trimEnd ?? 1) - 0.02);
      } else {
        source.trimEnd = Math.max(pct, (source.trimStart ?? 0) + 0.02);
      }
      project.updateLayer(layerId, {});
    };

    const onUp = () => {
      trimDragging = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }
  // ─── End Video Timeline ────────────────────────────────────────────

  function getMediaType(file: File): 'image' | 'video' | 'shader' {
    const ext = file.name.toLowerCase().split('.').pop();
    if (ext === 'fs' || ext === 'isf') return 'shader';
    if (file.type.startsWith('video/')) return 'video';
    return 'image';
  }

  async function createMediaSource(file: File): Promise<MediaSource> {
    // Capture both runtime URL and durable AssetRef so this layer's source
    // survives save+reload (the blob URL alone won't).
    const { assetRef, runtimeUrl: url } = createAssetRefFromFile(file);
    const mediaType = getMediaType(file);

    const source: MediaSource = {
      id: generateUUID(),
      type: mediaType,
      src: url,
      name: file.name,
      _assetRef: assetRef,
    };

    if (mediaType === 'video') {
      const video = document.createElement('video');
      // crossOrigin BEFORE src — order matters on Chromium 130.
      video.crossOrigin = 'anonymous';
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.src = url;

      // `.src=` already initiated the load. Don't call `.load()` —
      // races any pending play() on Chromium 130 (Electron 42).
      await new Promise<void>((resolve, reject) => {
        const onReady = () => { cleanup(); resolve(); };
        const onError = () => { cleanup(); reject(new Error('Video load failed')); };
        const cleanup = () => {
          video.removeEventListener('loadeddata', onReady);
          video.removeEventListener('error', onError);
        };
        video.addEventListener('loadeddata', onReady, { once: true });
        video.addEventListener('error', onError, { once: true });
        if (video.readyState >= 2) onReady();
      });

      // Autoplay the video immediately
      source.videoElement = video;
      source.isPlaying = true;
      try {
        await video.play();
      } catch (err) {
        console.warn('Autoplay blocked, user interaction required:', err);
        source.isPlaying = false;
      }
    } else if (mediaType === 'shader') {
      // Read shader source code
      const shaderCode = await file.text();
      source.shaderCode = shaderCode;
    }

    return source;
  }

  async function handleFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !$selectedLayerId) return;

    try {
      const source = await createMediaSource(file);
      project.setLayerSource($selectedLayerId, source);
    } catch (err) {
      console.error('Failed to load file:', err);
    }
    input.value = '';
  }

  async function handleDrop(e: DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (!file || !$selectedLayerId) return;

    try {
      const source = await createMediaSource(file);
      project.setLayerSource($selectedLayerId, source);
    } catch (err) {
      console.error('Failed to load file:', err);
    }
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
  }

  // Available effect types with display names
  const effectTypes: { type: EffectType; label: string; category: string }[] =
    EFFECT_CATALOG.map((e) => ({ type: e.type, label: e.label, category: e.category }));

  // Track which effect's params panel is expanded
  let expandedEffectId: string | null = null;
  let showEffectPicker = false;
  let effectPickerLayerId: string | null = null;
  let layerPresetSelection: Record<string, string> = {};
  let layerMacro1 = 0.5;
  let layerMacro2 = 0.5;
  let layerMacroBindings: Record<string, { m1?: string; m2?: string }> = {};

  function getLayerMacroBinding(effectId: string, which: 'm1' | 'm2'): string {
    return layerMacroBindings[effectId]?.[which] || '';
  }

  function setLayerMacroBinding(effectId: string, which: 'm1' | 'm2', paramName: string) {
    const prev = layerMacroBindings[effectId] || {};
    layerMacroBindings = {
      ...layerMacroBindings,
      [effectId]: {
        ...prev,
        [which]: paramName || undefined,
      },
    };
  }

  function applyLayerPreset(layerId: string, effect: { id: string; type: EffectType; params: Record<string, unknown> }, idx?: number) {
    const presetIndex = idx ?? parseInt(layerPresetSelection[effect.id] ?? '', 10);
    if (Number.isNaN(presetIndex)) return;
    const patch = applyPresetToEffect(effect as any, presetIndex);
    if (!patch) return;
    project.updateEffectParams(layerId, effect.id, patch);
  }

  function applyLayerMacroValue(effectId: string, macro: 'm1' | 'm2', value: number) {
    const selected = $selectedLayer;
    if (!selected) return;
    const eff = selected.effects.find((e) => e.id === effectId);
    if (!eff) return;
    const binding = layerMacroBindings[effectId]?.[macro];
    if (!binding) return;
    project.updateEffectParams(selected.id, effectId, { [binding]: value } as any);
  }

  function onLayerMacro1Change(v: number) {
    layerMacro1 = v;
    const selected = $selectedLayer;
    if (!selected) return;
    for (const eff of selected.effects) applyLayerMacroValue(eff.id, 'm1', v);
  }

  function onLayerMacro2Change(v: number) {
    layerMacro2 = v;
    const selected = $selectedLayer;
    if (!selected) return;
    for (const eff of selected.effects) applyLayerMacroValue(eff.id, 'm2', v);
  }

  function addEffect(layerId: string, effectType: EffectType) {
    const defaultParams = getDefaultEffectParams(effectType);
    project.addEffect(layerId, effectType, defaultParams);
  }

  function getEffectLabel(type: EffectType): string {
    return effectTypes.find((e) => e.type === type)?.label || type;
  }

  // Effect drag and drop
  let draggedEffectIndex: number | null = null;
  let dragOverEffectIndex: number | null = null;

  function handleEffectDragStart(index: number, e: DragEvent) {
    draggedEffectIndex = index;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(index));
    }
  }

  function handleEffectDragEnd() {
    draggedEffectIndex = null;
    dragOverEffectIndex = null;
  }

  function handleEffectDragOver(index: number, e: DragEvent) {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'move';
    }
    dragOverEffectIndex = index;
  }

  function handleEffectDrop(layerId: string, toIndex: number, e: DragEvent) {
    e.preventDefault();
    if (draggedEffectIndex !== null && draggedEffectIndex !== toIndex) {
      project.reorderEffects(layerId, draggedEffectIndex, toIndex);
    }
    draggedEffectIndex = null;
    dragOverEffectIndex = null;
  }

  function toggleShapeWarpEditing() {
    shapeWarpEditing = !shapeWarpEditing;
    window.dispatchEvent(
      new CustomEvent('toggle-layer-shape-warp', {
        detail: { enabled: shapeWarpEditing },
      })
    );
  }
</script>

<div class="layer-panel">
  <!-- Layers Section (top half when effects are shown) -->
  <div class="layers-section">
    <div class="panel-header">
      <h3>Layers</h3>
      <div class="add-layer-wrapper">
        <button class="btn-add" onclick={(e) => {
          showAddLayerMenu = !showAddLayerMenu;
          if (showAddLayerMenu) {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            addMenuPos = { top: rect.bottom + 4, left: Math.max(8, rect.right - 170) };
          }
        }}>
          + Add Layer
        </button>
        {#if showAddLayerMenu}
          <div class="add-layer-backdrop" onclick={() => showAddLayerMenu = false}></div>
          <div class="add-layer-menu" style="top:{addMenuPos.top}px;left:{addMenuPos.left}px">
            <button onclick={() => { project.addLayer(undefined, 'media', 'rectangle'); showAddLayerMenu = false; }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <path d="M21 15l-5-5L5 21"/>
              </svg>
              Media Layer
            </button>
            <button onclick={() => { project.addLayer(undefined, 'media', 'custom'); showAddLayerMenu = false; }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="4,18 2,8 8,2 18,4 22,14 16,20" />
                <circle cx="4" cy="18" r="1.5" fill="currentColor"/>
                <circle cx="2" cy="8" r="1.5" fill="currentColor"/>
                <circle cx="8" cy="2" r="1.5" fill="currentColor"/>
                <circle cx="18" cy="4" r="1.5" fill="currentColor"/>
                <circle cx="22" cy="14" r="1.5" fill="currentColor"/>
                <circle cx="16" cy="20" r="1.5" fill="currentColor"/>
              </svg>
              Custom Shape
            </button>
            <button onclick={() => { project.addLinesLayer(); showAddLayerMenu = false; }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="4 17 10 7 16 13 20 6"/>
                <line x1="4" y1="20" x2="20" y2="20"/>
              </svg>
              Lines Layer
            </button>
            <button onclick={() => { project.addSVGLayer(); showAddLayerMenu = false; }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="12,2 22,20 2,20"/>
                <polygon points="12,8 17,16 7,16"/>
              </svg>
              SVG Layer
            </button>
            <button onclick={() => { project.addLightPaintingLayer(); showAddLayerMenu = false; }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 2L7.17 4H4c-1.1 0-2 .9-2 2v0c0 1.1.9 2 2 2h.5"/>
                <path d="M12 2c3 4 7 5 7 10a7 7 0 1 1-14 0c0-5 4-6 7-10z"/>
                <path d="M12 18c-2.2 0-4-1.8-4-4 0-2.5 2-3 4-6"/>
              </svg>
              Light Painting
            </button>
            <!-- Adv Light Paint button hidden — superseded by the
                 in-progress "Light Painting GPU" effort that adds GPU
                 brush types (spiral/firefly/sap-flow/etc) directly to
                 the existing Light Painting layer instead of creating
                 a separate toy layer. The advLightPaint layer type
                 + WebGPUAdvLightPaint module remain in the codebase
                 for reference but are not user-reachable.
            <button onclick={() => { project.addAdvLightPaintingLayer(); showAddLayerMenu = false; }}>
              ...
            </button>
            -->

            <button onclick={() => { project.addTextLayer(); showAddLayerMenu = false; }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="4 7 4 4 20 4 20 7"/>
                <line x1="9" y1="20" x2="15" y2="20"/>
                <line x1="12" y1="4" x2="12" y2="20"/>
              </svg>
              Text Layer
            </button>
            <button onclick={() => { project.addSplatLayer(); showAddLayerMenu = false; }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="2"/>
                <circle cx="6" cy="6" r="1.5"/>
                <circle cx="18" cy="6" r="1"/>
                <circle cx="5" cy="14" r="1"/>
                <circle cx="19" cy="15" r="1.5"/>
                <circle cx="8" cy="19" r="1"/>
                <circle cx="16" cy="18" r="1"/>
                <circle cx="14" cy="7" r="0.8"/>
                <circle cx="9" cy="10" r="0.8"/>
                <circle cx="15" cy="13" r="0.8"/>
              </svg>
              Splat / Point Cloud
            </button>
            <button onclick={() => { project.addModel3DLayer(); showAddLayerMenu = false; }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 2L2 7L12 12L22 7L12 2Z"/>
                <path d="M2 17L12 22L22 17"/>
                <path d="M2 12L12 17L22 12"/>
              </svg>
              3D Model
            </button>
            <!-- Legacy Pixel FX layer button hidden — Pixel Particles
                 now ships as a shader inside the GPU Shader layer
                 (gives full engine integration: warp, blend, effects).
                 The 'pixel-fx' layer type is kept in the data model
                 so any saved projects that already use it still load. -->
            <!--
            <button onclick={() => { project.addPixelFXLayer(); showAddLayerMenu = false; }}>
              Pixel FX (legacy)
            </button>
            -->

            {#if $webgpuSupportedStore}
              <button onclick={() => { project.addGPULayer(); showAddLayerMenu = false; }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="9"/>
                  <ellipse cx="12" cy="12" rx="9" ry="3.2"/>
                  <path d="M3 12 a9 9 0 0 0 18 0"/>
                </svg>
                GPU Shader <span style="font-size:9px; opacity:0.7; padding:1px 4px; background:linear-gradient(135deg,#1e3a8a,#7c2d12); border-radius:2px; margin-left:4px;">WebGPU</span>
              </button>
            {/if}
            <button onclick={() => { project.addScreenLayer(); showAddLayerMenu = false; }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="2" y="3" width="20" height="14" rx="2"/>
                <line x1="8" y1="21" x2="16" y2="21"/>
                <line x1="12" y1="17" x2="12" y2="21"/>
              </svg>
              Screen (VJ Output)
            </button>
            <button onclick={() => { project.addGroupLayer(); showAddLayerMenu = false; }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="7" height="7" rx="1"/>
                <rect x="14" y="3" width="7" height="7" rx="1"/>
                <rect x="3" y="14" width="7" height="7" rx="1"/>
              </svg>
              Group
            </button>
          </div>
        {/if}
      </div>
    </div>

    <div class="layer-list">
    {#each $layers as layer, index (layer.id)}
      {@const isChild = !!layer.parentGroupId}
      {@const parentGroup = isChild ? $layers.find(l => l.id === layer.parentGroupId) : null}
      {@const isHiddenByCollapse = isChild && parentGroup?.groupCollapsed}
      {#if !isHiddenByCollapse}
      <div
        class="layer-item"
        class:selected={$selectedLayerId === layer.id}
        class:multi-selected={$selectedLayerIds.includes(layer.id) && $selectedLayerId !== layer.id}
        class:dragging={draggedIndex === index}
        class:drag-over-above={dragOverIndex === index && draggedIndex !== index && dragOverZone === 'above'}
        class:drag-over-below={dragOverIndex === index && draggedIndex !== index && dragOverZone === 'below'}
        class:drag-over-into={dragOverIndex === index && draggedIndex !== index && dragOverZone === 'into'}
        class:group-layer={layer.type === 'group'}
        class:group-child={isChild}
        onclick={(e) => selectLayerWithModifiers(layer.id, index, e)}
        oncontextmenu={(e) => handleLayerContextMenu(layer.id, e)}
        role="button"
        tabindex="0"
        onkeypress={(e) => e.key === 'Enter' && selectLayerWithModifiers(layer.id, index, e)}
        draggable="true"
        ondragstart={(e) => handleDragStart(index, e)}
        ondragend={handleDragEnd}
        ondragover={(e) => handleLayerDragOver(index, e)}
        ondragleave={handleLayerDragLeave}
        ondrop={(e) => handleLayerDrop(index, e)}
      >
        <!-- Group collapse toggle -->
        {#if layer.type === 'group'}
          <button class="group-collapse-btn" title={layer.groupCollapsed ? 'Expand group' : 'Collapse group'}
            onclick={(e) => { e.stopPropagation(); project.toggleGroupCollapse(layer.id); }}>
            {layer.groupCollapsed ? '▸' : '▾'}
          </button>
        {/if}

        <!-- Drag handle -->
        <div class="drag-handle" title="Drag to reorder">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
            <circle cx="3" cy="3" r="1.5"/>
            <circle cx="9" cy="3" r="1.5"/>
            <circle cx="3" cy="9" r="1.5"/>
            <circle cx="9" cy="9" r="1.5"/>
          </svg>
        </div>

        <!-- Thumbnail -->
        <div class="layer-thumbnail" class:lines={layer.type === 'lines'} class:group={layer.type === 'group'}>
          {#if layer.type === 'group'}
            <div class="group-thumb">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="3" y="3" width="7" height="7" rx="1"/>
                <rect x="14" y="3" width="7" height="7" rx="1"/>
                <rect x="3" y="14" width="7" height="7" rx="1"/>
              </svg>
            </div>
          {:else if layer.type === 'lines'}
            <!-- Lines layer icon -->
            <div class="lines-thumb">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <polyline points="4,18 8,8 14,16 20,6"/>
                <line x1="2" y1="20" x2="22" y2="4" stroke-dasharray="2,2"/>
              </svg>
            </div>
          {:else if layer.type === 'color' && layer.colorContent}
            <!-- Solid color thumbnail -->
            <div
              class="color-thumb"
              style="background: hsl({layer.colorContent.hue}, {layer.colorContent.saturation}%, {layer.colorContent.lightness}%);"
            ></div>
          {:else if layer.source?.type === 'image' && layer.source.src}
            <img src={layer.source.src} alt="" />
          {:else if layer.source?.type === 'video' && layer.source.videoElement}
            <video
              src={layer.source.src}
              muted
              playsinline
              style="width:100%;height:100%;object-fit:cover;"
            ></video>
          {:else if layer.source?.type === 'shader'}
            {#if shaderThumbnails[layer.id]}
              <img src={shaderThumbnails[layer.id]} alt="" style="width:100%;height:100%;object-fit:cover;" />
            {:else}
              <div class="shader-thumb">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                  <path d="M2 17l10 5 10-5"/>
                  <path d="M2 12l10 5 10-5"/>
                </svg>
              </div>
            {/if}
          {:else}
            <div class="empty-thumb">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <path d="M21 15l-5-5L5 21"/>
              </svg>
            </div>
          {/if}
        </div>

        <button
          class="btn-visibility"
          class:hidden={!layer.visible}
          onclick={(e) => { e.stopPropagation(); project.toggleLayerVisibility(layer.id); }}
          title={layer.visible ? 'Hide layer' : 'Show layer'}
        >
          {#if layer.visible}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
          {:else}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
              <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
              <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/>
              <line x1="1" y1="1" x2="23" y2="23"/>
            </svg>
          {/if}
        </button>

        {#if renamingLayerId === layer.id}
          <!-- Inline rename input. Enter / blur saves; Esc cancels. -->
          <input
            class="layer-name-input"
            type="text"
            value={layer.name}
            autofocus
            onkeydown={(e) => {
              if (e.key === 'Enter') { project.renameLayer(layer.id, (e.target as HTMLInputElement).value); renamingLayerId = null; }
              else if (e.key === 'Escape') { renamingLayerId = null; }
            }}
            onblur={(e) => { project.renameLayer(layer.id, (e.target as HTMLInputElement).value); renamingLayerId = null; }}
            onclick={(e) => e.stopPropagation()}
          />
        {:else}
          <span
            class="layer-name"
            ondblclick={(e) => { e.stopPropagation(); renamingLayerId = layer.id; }}
            title="Double-click to rename"
          >{layer.name}</span>
        {/if}

        <button
          class="btn-lock"
          class:locked={layer.locked}
          onclick={(e) => { e.stopPropagation(); project.toggleLayerLock(layer.id); }}
          title={layer.locked ? 'Unlock layer' : 'Lock layer'}
        >
          {#if layer.locked}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
          {:else}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 9.9-1"/>
            </svg>
          {/if}
        </button>

        <button
          class="btn-delete"
          onclick={async (e) => { e.stopPropagation(); if (await confirmDeleteIfSafeMode(`layer "${layer.name}"`, e)) project.removeLayer(layer.id); }}
          title="Delete layer"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>
      </div>
      {/if}
    {/each}

    {#if $layers.length === 0}
      <div class="empty-state">No layers. Click "+ Add Layer" to start.</div>
    {/if}
  </div>

  <!-- Right-click context menu -->
  {#if ctxMenu}
    {@const ctxId = ctxMenu.layerId}
    {@const ctxLayer = $layers.find(l => l.id === ctxId)}
    {@const groups = getGroupLayers($layers)}
    {@const hasMultiSelect = $selectedLayerIds.length > 1}
    {@const snap = ctxMenu.selectionSnapshot}
    <div class="ctx-backdrop" onclick={closeContextMenu}></div>
    <div class="layer-ctx-menu" style="left:{ctxMenu.x}px;top:{ctxMenu.y}px">
      {#if snap.length > 1}
        <button
          class="ctx-item"
          onclick={(e) => {
            e.stopPropagation();
            console.log('[ctxmenu] Group selected — snapshot=', snap);
            project.createGroupFromIds(snap);
            closeContextMenu();
          }}
        >Group selected ({snap.length} layers)</button>
      {/if}
      <button
        class="ctx-item"
        onclick={(e) => {
          e.stopPropagation();
          // Group every non-group layer that is currently a top-level
          // sibling of the right-clicked layer (so an existing group's
          // contents don't get torn out by accident). This is the
          // "I want all my layers in one group" one-click path.
          const ids = $layers.filter((l) => l.type !== 'group' && !l.parentGroupId).map((l) => l.id);
          project.createGroupFromIds(ids);
          closeContextMenu();
        }}
      >Group all top-level layers ({$layers.filter((l) => l.type !== 'group' && !l.parentGroupId).length})</button>
      <button
        class="ctx-item"
        onclick={(e) => {
          e.stopPropagation();
          if (ctxId) project.createGroupFromIds([ctxId]);
          closeContextMenu();
        }}
      >Wrap this layer in a group</button>
      <div class="ctx-divider"></div>
      {#if ctxLayer && ctxLayer.type !== 'group'}
        {#if groups.length > 0}
          <button class="ctx-item ctx-has-sub" onclick={() => ctxGroupSubmenu = !ctxGroupSubmenu}>
            Add to Group ▸
          </button>
          {#if ctxGroupSubmenu}
            <div class="ctx-submenu">
              {#each groups as g}
                <button class="ctx-item" onclick={() => {
                  const ids = snap.length > 1 ? snap.filter(id => id !== g.id) : [ctxId];
                  project.addToGroup(ids, g.id);
                  closeContextMenu();
                }}>
                  {g.name}
                </button>
              {/each}
            </div>
          {/if}
        {/if}
        {#if ctxLayer.parentGroupId}
          <button class="ctx-item" onclick={() => { project.removeFromGroup([ctxId]); closeContextMenu(); }}>Remove from Group</button>
        {/if}
      {/if}
      {#if ctxLayer?.type === 'group'}
        <button class="ctx-item" onclick={() => { project.dissolveGroup(ctxId); closeContextMenu(); }}>Dissolve Group</button>
      {/if}
      <div class="ctx-divider"></div>
      <button class="ctx-item" onclick={() => { project.duplicateLayer(ctxId); closeContextMenu(); }}>Duplicate</button>
      <button class="ctx-item ctx-danger" onclick={async () => {
        // Anchor the popover at the original right-click coords (ctxMenu.x/y)
        // so it appears right where the user is — close the menu first so it
        // doesn't visually compete with the popover.
        const lyr = $layers.find(l => l.id === ctxId);
        const anchor = ctxMenu ? { clientX: ctxMenu.x, clientY: ctxMenu.y } : undefined;
        const id = ctxId;
        closeContextMenu();
        if (await confirmDeleteIfSafeMode(`layer "${lyr?.name ?? id}"`, anchor)) project.removeLayer(id);
      }}>Delete</button>
    </div>
  {/if}

  </div>
  <!-- End of Layers Section -->

  {#if $selectedLayerId}
    {@const layer = $layers.find((l) => l.id === $selectedLayerId)}
    {#if layer}
      <!-- Properties & Effects Panel (bottom section, scrollable) -->
      <div class="properties-effects-panel">
        <div class="properties-effects-content">

          {#if layer.type === 'group'}
          <!-- ── Group Properties ── -->
          <div class="layer-properties">
            <h4>Properties (Group)</h4>

            <div class="property-row">
              <label>Shader Mode</label>
              <div class="radio-group">
                <label class="radio-label">
                  <input type="radio" name="group-shader-mode" value="individual"
                    checked={layer.groupConfig?.shaderMode === 'individual'}
                    onchange={() => project.updateGroupConfig(layer.id, { shaderMode: 'individual' })} />
                  Individual
                </label>
                <label class="radio-label">
                  <input type="radio" name="group-shader-mode" value="unified"
                    checked={layer.groupConfig?.shaderMode === 'unified'}
                    onchange={() => project.updateGroupConfig(layer.id, { shaderMode: 'unified' })} />
                  Unified
                </label>
              </div>
            </div>

            <p class="property-hint">
              {layer.groupConfig?.shaderMode === 'unified'
                ? 'One shader spans the full canvas — each child acts as a masked window into it.'
                : 'Shader repeats independently on each child layer.'}
            </p>

            <div class="property-row">
              <label>Override Effects</label>
              <label class="toggle">
                <input type="checkbox"
                  checked={layer.groupConfig?.overrideStyles ?? false}
                  onchange={(e) => project.updateGroupConfig(layer.id, { overrideStyles: (e.target as HTMLInputElement).checked })} />
                <span class="toggle-slider"></span>
              </label>
            </div>
            {#if layer.groupConfig?.overrideStyles}
              <p class="property-hint">Group effects replace each child's own effects.</p>
            {/if}

            <div class="property-row">
              <label>Children</label>
              <span class="property-value">{$layers.filter(l => l.parentGroupId === layer.id).length} layers</span>
            </div>

            <!-- VJ Source for group (available always, not just when VJ live) -->
            <div class="property-row vj-source-row">
              <label>VJ Source</label>
              <select
                class="vj-source-select"
                value={layer.vjLayerIndex !== undefined ? String(layer.vjLayerIndex) : ''}
                onchange={(e) => {
                  const val = (e.target as HTMLSelectElement).value;
                  project.setLayerVJIndex(layer.id, val === '' ? undefined : parseInt(val));
                }}
              >
                <option value="">None (use shader/media)</option>
                {#each Array($vjClipLauncher.numLayers) as _, i}
                  {@const activeClip = $vjClipLauncher.layerStates[i]?.activeClip}
                  <option value={String(i)}>VJ Layer {i + 1}{activeClip ? ` — ${activeClip.name}` : ''}</option>
                {/each}
              </select>
            </div>

            <!-- Group source (shader/media drop) -->
            <div
              class="media-drop-zone"
              ondrop={handleDrop}
              ondragover={handleDragOver}
              role="button"
              tabindex="0"
              aria-label="Drop shader here to apply across group"
            >
              {#if layer.source}
                <span class="source-name">{layer.source.name}</span>
                <span class="source-type">({layer.source.type})</span>
                <label class="file-label replace-label">
                  <span class="link">Replace</span>
                  <input type="file" accept=".fs,.isf,image/*,video/*" onchange={handleFileSelect} style="display: none;" />
                </label>
              {:else}
                <span>Drop shader here for group</span>
                <label class="file-label">
                  or <span class="link">browse</span>
                  <input type="file" accept=".fs,.isf,image/*,video/*" onchange={handleFileSelect} style="display: none;" />
                </label>
              {/if}
            </div>

            <!-- Group opacity/blend -->
            <div class="property-row">
              <label>Opacity</label>
              <input type="range" min="0" max="1" step="0.01" value={layer.opacity}
                oninput={(e) => project.updateLayer(layer.id, { opacity: parseFloat((e.target as HTMLInputElement).value) })}
                data-midi-path="map:layer:opacity"
                data-midi-label="Layer Opacity"
                data-midi-min="0"
                data-midi-max="1"
                data-midi-step="0.01" />
              <span class="property-value">{Math.round(layer.opacity * 100)}%</span>
            </div>
            <div class="property-row">
              <label>Blend Mode</label>
              <select value={layer.blendMode}
                onchange={(e) => project.updateLayer(layer.id, { blendMode: (e.target as HTMLSelectElement).value as BlendMode })}>
                {#each blendModes as mode}
                  <option value={mode}>{mode}</option>
                {/each}
              </select>
            </div>

            <!-- Content Fit (when group has a source, individual mode only) -->
            {#if layer.source && layer.groupConfig?.shaderMode === 'individual'}
              <div class="property-row">
                <label>Content Fit</label>
                <select value={layer.contentFit || 'stretch'}
                  onchange={(e) => project.updateLayer(layer.id, { contentFit: (e.target as HTMLSelectElement).value as any })}>
                  <option value="stretch">Stretch</option>
                  <option value="fill">Fill</option>
                  <option value="crop">Crop</option>
                </select>
              </div>
            {/if}

            <!-- Render Quality (when group has a shader source) -->
            {#if layer.source?.type === 'shader'}
              <div class="property-row">
                <label>Render Quality</label>
                <select
                  value={String(layer.renderQuality ?? 1.0)}
                  onchange={(e) => {
                    const val = parseFloat((e.target as HTMLSelectElement).value);
                    project.setRenderQuality(layer.id, val);
                  }}
                >
                  <option value="1.0">Full (100%)</option>
                  <option value="0.75">High (75%)</option>
                  <option value="0.5">Medium (50%)</option>
                  <option value="0.35">Low (35%)</option>
                  <option value="0.25">Very Low (25%)</option>
                </select>
              </div>
            {/if}

            <!-- Warp Mode -->
            <div class="property-row">
              <label>Warp Mode</label>
              <div class="warp-mode-buttons">
                <button
                  class="warp-mode-btn"
                  class:active={layer.warpMode === 'corners'}
                  onclick={() => project.setWarpMode(layer.id, 'corners')}
                >
                  Corner
                </button>
                <button
                  class="warp-mode-btn"
                  class:active={layer.warpMode === 'mesh'}
                  onclick={() => project.setWarpMode(layer.id, 'mesh')}
                >
                  Mesh
                </button>
              </div>
            </div>

            <!-- Reset Warp -->
            <button class="reset-warp-btn" onclick={() => project.resetCorners(layer.id)}>Reset Warp</button>
          </div>

          <!-- Group Edge Effects -->
          {#if layer.type === 'group'}
            <EdgeEffectsPanel />
          {/if}
          {:else}

          <div class="layer-properties">
        <h4>Properties ({layer.type === 'lines' ? 'Lines' : layer.type === 'svg' ? 'SVG' : layer.type === 'color' ? 'Color' : layer.type === 'splat' ? 'Point Cloud' : layer.type === 'model3d' ? '3D Model' : 'Media'})</h4>

        <!-- VJ Source dropdown — only on screen/VJ-slice layers, NOT standard media layers -->
        <!-- Group layers and screen layers have their own VJ source selectors -->


        <!-- Orientation Arrows (all layer types) -->
        <div class="orientation-controls">
          <span class="orient-label">Flip</span>
          <button
            class="orient-btn"
            class:active={!layer.flipV}
            onclick={() => { if (layer.flipV) project.toggleLayerFlipV(layer.id); }}
            title="Normal vertical"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M12 19V5M5 12l7-7 7 7"/>
            </svg>
          </button>
          <button
            class="orient-btn"
            class:active={layer.flipV}
            onclick={() => { if (!layer.flipV) project.toggleLayerFlipV(layer.id); }}
            title="Flip vertically"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M12 5v14M5 12l7 7 7-7"/>
            </svg>
          </button>
          <button
            class="orient-btn"
            class:active={layer.flipH}
            onclick={() => { if (!layer.flipH) project.toggleLayerFlipH(layer.id); }}
            title="Flip horizontally"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M19 12H5M12 5l-7 7 7 7"/>
            </svg>
          </button>
          <button
            class="orient-btn"
            class:active={!layer.flipH}
            onclick={() => { if (layer.flipH) project.toggleLayerFlipH(layer.id); }}
            title="Normal horizontal"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </button>
        </div>

        {#if layer.type === 'color' && layer.colorContent}
          <!-- Solid color layer controls -->
          <div class="color-controls">
            <div class="color-preview-large" style="background: hsl({layer.colorContent.hue}, {layer.colorContent.saturation}%, {layer.colorContent.lightness}%);"></div>
            <div class="property-row">
              <label for="color-hue-{layer.id}">Hue</label>
              <input
                id="color-hue-{layer.id}"
                type="range"
                min="0"
                max="360"
                step="1"
                value={layer.colorContent.hue}
                style="--hue-gradient: linear-gradient(to right, hsl(0, 100%, 50%), hsl(60, 100%, 50%), hsl(120, 100%, 50%), hsl(180, 100%, 50%), hsl(240, 100%, 50%), hsl(300, 100%, 50%), hsl(360, 100%, 50%));"
                class="hue-slider"
                oninput={(e) => project.updateColorContent(layer.id, { hue: parseFloat((e.target as HTMLInputElement).value) })}
              />
              <span class="value">{Math.round(layer.colorContent.hue)}</span>
            </div>
            <div class="property-row">
              <label for="color-sat-{layer.id}">Saturation</label>
              <input
                id="color-sat-{layer.id}"
                type="range"
                min="0"
                max="100"
                step="1"
                value={layer.colorContent.saturation}
                oninput={(e) => project.updateColorContent(layer.id, { saturation: parseFloat((e.target as HTMLInputElement).value) })}
              />
              <span class="value">{Math.round(layer.colorContent.saturation)}%</span>
            </div>
            <div class="property-row">
              <label for="color-light-{layer.id}">Lightness</label>
              <input
                id="color-light-{layer.id}"
                type="range"
                min="0"
                max="100"
                step="1"
                value={layer.colorContent.lightness}
                oninput={(e) => project.updateColorContent(layer.id, { lightness: parseFloat((e.target as HTMLInputElement).value) })}
              />
              <span class="value">{Math.round(layer.colorContent.lightness)}%</span>
            </div>
          </div>
        {:else if layer.type === 'lines'}
          <!-- Lines layer: Elements list -->
          <div class="elements-section">
            <div class="elements-header">
              <span>Lines</span>
              <span class="lines-hint">Draw in viewport with pen tools</span>
            </div>
            {#if layer.linesContent && layer.linesContent.elements.length > 0}
              <div class="element-list">
                {#each layer.linesContent.elements as element (element.id)}
                  <div
                    class="element-item"
                    class:selected={layer.linesContent.selectedElementId === element.id}
                    onclick={() => project.selectElement(layer.id, element.id)}
                    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); project.selectElement(layer.id, element.id); } }}
                    role="button"
                    tabindex="0"
                  >
                    <span class="element-icon">
                      {#if element.shape.type === 'freehand'}
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3,18 Q8,4 12,12 T21,6"/></svg>
                      {:else}
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,18 9,6 15,14 21,4"/></svg>
                      {/if}
                    </span>
                    <span class="element-name">{element.name || element.shape.type}</span>
                    <button
                      class="element-delete"
                      onclick={(e) => { e.stopPropagation(); project.removeElement(layer.id, element.id); }}
                      title="Delete element"
                    >x</button>
                  </div>
                {/each}
              </div>
            {:else}
              <div class="no-elements">No lines yet. Use pen tools in the right panel to draw.</div>
            {/if}
          </div>
        {:else if layer.type === 'svg'}
          <!-- SVG layer info -->
          <div class="svg-info">
            <span>SVG controls in right panel</span>
          </div>
        {:else if layer.type === 'splat'}
          <!-- Splat layer: info pointing to right panel -->
          <div class="splat-info">
            {#if layer.splatContent?.filePath}
              <span class="file-loaded-info">{layer.splatContent.pointCount.toLocaleString()} points loaded</span>
            {:else}
              <span class="no-file-info">Load a PLY or .splat file in the right panel</span>
            {/if}
          </div>
        {:else if layer.type === 'model3d'}
          <!-- Model3D layer: info pointing to right panel -->
          <div class="model3d-info">
            {#if layer.model3dContent?.modelData}
              <span class="file-loaded-info">{layer.model3dContent.modelName || 'Model loaded'} — {layer.model3dContent.vertexCount.toLocaleString()} vertices</span>
            {:else}
              <span class="no-file-info">Load a 3D model file in the right panel</span>
            {/if}
          </div>
        {:else if layer.type === 'screen'}
          <!-- Screen layer: VJ Layer assignment -->
          <div class="screen-layer-config">
            <label class="screen-label">VJ Layer Source</label>
            <select
              class="screen-vj-select"
              value={layer.vjLayerIndex ?? 0}
              onchange={(e) => project.setLayerVJIndex(layer.id, parseInt(e.currentTarget.value))}
            >
              {#each Array($vjClipLauncher.numLayers) as _, i}
                <option value={i}>VJ Layer {i + 1}</option>
              {/each}
            </select>
          </div>
        {:else}
          <!-- Media layer: Source (not shown for shader sources) -->
          {#if layer.source?.type !== 'shader'}
            <div
              class="media-drop-zone"
              ondrop={handleDrop}
              ondragover={handleDragOver}
              role="button"
              tabindex="0"
              aria-label="Drop media file here or click to browse"
            >
              {#if layer.source}
                <span class="source-name">{layer.source.name}</span>
                <span class="source-type">({layer.source.type})</span>
                <label class="file-label replace-label">
                  <span class="link">Replace</span>
                  <input
                    type="file"
                    accept="image/*,video/*,.fs,.isf"
                    onchange={handleFileSelect}
                    style="display: none;"
                  />
                </label>
              {:else}
                <span>Drop image/video/shader here</span>
                <label class="file-label">
                  or <span class="link">browse</span>
                  <input
                    type="file"
                    accept="image/*,video/*,.fs,.isf"
                    onchange={handleFileSelect}
                    style="display: none;"
                  />
                </label>
              {/if}
            </div>
          {/if}
        {/if}

        <!-- Video Controls (only for video sources) -->
        {#if layer.type === 'media' && layer.source?.type === 'video' && layer.source.videoElement}
          {@const vSrc = layer.source}
          {@const vEl = layer.source.videoElement}
          {@const vMode = vSrc.playbackMode || 'loop'}
          {@const vRate = vSrc.playbackRate ?? 1.0}
          {@const vTrimS = vSrc.trimStart ?? 0}
          {@const vTrimE = vSrc.trimEnd ?? 1}

          <div class="video-controls-panel">
            <!-- Transport row -->
            <div class="vt-transport">
              <button
                class="vt-btn vt-play"
                onclick={() => {
                  const playing = vSrc.isPlaying !== false;
                  if (playing) {
                    vEl.pause();
                    vSrc.isPlaying = false;
                  } else {
                    vSrc.isPlaying = true;
                    vSrc._lastFrameTime = performance.now();
                    vEl.play().catch(() => {});
                  }
                  project.updateLayer(layer.id, {});
                }}
                title={(vSrc.isPlaying !== false) ? 'Pause' : 'Play'}
              >
                {#if vSrc.isPlaying === false}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
                {:else}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="3" width="4" height="18"/><rect x="15" y="3" width="4" height="18"/></svg>
                {/if}
              </button>
              <button
                class="vt-btn"
                onclick={() => {
                  vEl.currentTime = (vSrc.trimStart ?? 0) * (vEl.duration || 0);
                  vEl.play(); vSrc.isPlaying = true;
                  project.updateLayer(layer.id, {});
                }}
                title="Restart"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
                </svg>
              </button>
              <span class="vt-time">{formatTime(videoCurrentTime)} / {formatTime(videoDuration)}</span>
              <select
                class="vt-speed"
                value={String(vRate)}
                onchange={(e) => setPlaybackRate(layer.id, vSrc, parseFloat((e.target as HTMLSelectElement).value))}
              >
                <option value="0.25">0.25x</option>
                <option value="0.5">0.5x</option>
                <option value="1">1x</option>
                <option value="1.5">1.5x</option>
                <option value="2">2x</option>
                <option value="4">4x</option>
              </select>
            </div>

            <!-- Timeline bar -->
            <div
              class="vt-timeline"
              bind:this={timelineEl}
              onmousedown={(e) => handleTimelineMouseDown(e, layer.id, vSrc)}
              role="slider"
              tabindex="0"
              aria-label="Video timeline"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={videoDuration > 0 ? Math.round(videoCurrentTime / videoDuration * 100) : 0}
            >
              <!-- Grayed areas outside trim -->
              <div class="vt-trim-outside-left" style="width: {vTrimS * 100}%"></div>
              <div class="vt-trim-outside-right" style="width: {(1 - vTrimE) * 100}%"></div>
              <!-- Active trim region -->
              <div class="vt-trim-region" style="left: {vTrimS * 100}%; width: {(vTrimE - vTrimS) * 100}%"></div>
              <!-- Playhead -->
              {#if videoDuration > 0}
                <div class="vt-playhead" style="left: {(videoCurrentTime / videoDuration) * 100}%"></div>
              {/if}
              <!-- Trim handles -->
              <div
                class="vt-trim-handle vt-trim-start"
                style="left: {vTrimS * 100}%"
                onmousedown={(e) => handleTrimMouseDown(e, 'start', layer.id, vSrc)}
                role="slider"
                tabindex="0"
                aria-label="Trim start"
              ></div>
              <div
                class="vt-trim-handle vt-trim-end"
                style="left: {vTrimE * 100}%"
                onmousedown={(e) => handleTrimMouseDown(e, 'end', layer.id, vSrc)}
                role="slider"
                tabindex="0"
                aria-label="Trim end"
              ></div>
            </div>

            <!-- Mode buttons row -->
            <div class="vt-modes">
              <button class="vt-mode-btn" class:active={vMode === 'loop'} onclick={() => setPlaybackMode(layer.id, vSrc, 'loop')} title="Loop">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>
                  <polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
                </svg>
                Loop
              </button>
              <button class="vt-mode-btn" class:active={vMode === 'once'} onclick={() => setPlaybackMode(layer.id, vSrc, 'once')} title="Play Once">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
                Once
              </button>
            </div>
          </div>
        {/if}

        <!-- Opacity -->
        <div class="property-row">
          <label>Opacity</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={layer.opacity}
            oninput={(e) =>
              project.setLayerOpacity(layer.id, parseFloat((e.target as HTMLInputElement).value))}
          />
          <span class="value">{Math.round(layer.opacity * 100)}%</span>
        </div>

        <!-- Blend Mode -->
        <div class="property-row">
          <label>Blend Mode</label>
          <select
            value={layer.blendMode}
            onchange={(e) =>
              project.setLayerBlendMode(layer.id, (e.target as HTMLSelectElement).value as BlendMode)}
          >
            {#each blendModes as mode}
              <option value={mode}>{mode}</option>
            {/each}
          </select>
        </div>

        <!-- Render Quality (shader layers only) -->
        {#if layer.source?.type === 'shader'}
          <div class="property-row">
            <label>Render Quality</label>
            <select
              value={String(layer.renderQuality ?? 1.0)}
              onchange={(e) => {
                const val = parseFloat((e.target as HTMLSelectElement).value);
                project.setRenderQuality(layer.id, val);
              }}
            >
              <option value="1.0">Full (100%)</option>
              <option value="0.75">High (75%)</option>
              <option value="0.5">Medium (50%)</option>
              <option value="0.35">Low (35%)</option>
              <option value="0.25">Very Low (25%)</option>
            </select>
          </div>
        {/if}

        <!-- Content Fit Mode (for media/screen/shader layers) -->
        {#if layer.type === 'media' || layer.type === 'screen'}
          <div class="property-row">
            <label>Content Fit</label>
            <select
              value={layer.contentFit || 'stretch'}
              onchange={(e) =>
                project.setContentFit(layer.id, (e.target as HTMLSelectElement).value as ContentFitMode)}
            >
              <option value="stretch">Stretch</option>
              <option value="fill">Fill</option>
              <option value="crop">Contain</option>
            </select>
          </div>
        {/if}

        <!-- Quick Edge Feather (adds/updates edgeFeather effect without effects panel) -->
        {#if layer.effects}
          {@const featherEffect = layer.effects.find(e => e.type === 'edgeFeather')}
          <div class="property-row feather-row">
            <label>Edge Feather</label>
            {#if !featherEffect}
              <button class="btn-small" onclick={() => project.addEffect(layer.id, 'edgeFeather', { featherTop: 0, featherBottom: 0, featherLeft: 0, featherRight: 0, featherSoftness: 0.5 })}>
                + Enable
              </button>
            {:else}
              <div class="feather-sliders">
                <div class="feather-slider">
                  <span class="feather-label">T</span>
                  <input type="range" min="0" max="1" step="0.01" value={featherEffect.params?.featherTop ?? 0}
                    oninput={(e) => project.updateEffectParams(layer.id, featherEffect.id, { featherTop: parseFloat((e.target as HTMLInputElement).value) })} />
                </div>
                <div class="feather-slider">
                  <span class="feather-label">B</span>
                  <input type="range" min="0" max="1" step="0.01" value={featherEffect.params?.featherBottom ?? 0}
                    oninput={(e) => project.updateEffectParams(layer.id, featherEffect.id, { featherBottom: parseFloat((e.target as HTMLInputElement).value) })} />
                </div>
                <div class="feather-slider">
                  <span class="feather-label">L</span>
                  <input type="range" min="0" max="1" step="0.01" value={featherEffect.params?.featherLeft ?? 0}
                    oninput={(e) => project.updateEffectParams(layer.id, featherEffect.id, { featherLeft: parseFloat((e.target as HTMLInputElement).value) })} />
                </div>
                <div class="feather-slider">
                  <span class="feather-label">R</span>
                  <input type="range" min="0" max="1" step="0.01" value={featherEffect.params?.featherRight ?? 0}
                    oninput={(e) => project.updateEffectParams(layer.id, featherEffect.id, { featherRight: parseFloat((e.target as HTMLInputElement).value) })} />
                </div>
              </div>
            {/if}
          </div>
        {:else}
          <div class="property-row feather-row">
            <label>Edge Feather</label>
            <button class="btn-small" onclick={() => project.addEffect(layer.id, 'edgeFeather', { featherTop: 0, featherBottom: 0, featherLeft: 0, featherRight: 0, featherSoftness: 0.5 })}>
              + Enable
            </button>
          </div>
        {/if}

        <!-- Warp Mode -->
        <div class="property-row">
          <label>Warp Mode</label>
          <div class="warp-mode-buttons">
            <button
              class="warp-mode-btn"
              class:active={layer.warpMode === 'corners'}
              onclick={() => project.setWarpMode(layer.id, 'corners')}
            >
              Corner
            </button>
            <button
              class="warp-mode-btn"
              class:active={layer.warpMode === 'mesh'}
              onclick={() => project.setWarpMode(layer.id, 'mesh')}
            >
              Mesh
            </button>
          </div>
        </div>

        <!-- Mesh Grid Size (only show when in mesh mode) -->
        {#if layer.warpMode === 'mesh' && layer.meshGrid}
          <div class="property-row">
            <label>Grid Size</label>
            <select
              value="{layer.meshGrid.rows}x{layer.meshGrid.cols}"
              onchange={(e) => {
                const [rows, cols] = (e.target as HTMLSelectElement).value.split('x').map(Number);
                project.setMeshGridSize(layer.id, rows, cols);
              }}
            >
              <option value="2x2">2x2</option>
              <option value="3x3">3x3</option>
              <option value="4x4">4x4</option>
              <option value="5x5">5x5</option>
              <option value="6x6">6x6</option>
              <option value="8x8">8x8</option>
              <option value="10x10">10x10</option>
              <option value="12x12">12x12</option>
            </select>
          </div>
        {/if}

        <!-- Reset warp -->
        <div class="property-row">
          {#if layer.warpMode === 'mesh'}
            <button class="btn-reset" onclick={() => project.resetMeshGrid(layer.id)}>
              Reset Mesh
            </button>
          {:else}
            <button class="btn-reset" onclick={() => project.resetCorners(layer.id)}>
              Reset Warp
            </button>
          {/if}
        </div>

        <!-- Mask Section -->
        <div class="mask-section">
          <div class="property-row">
            <label>
              <input
                type="checkbox"
                checked={layer.mask?.enabled ?? false}
                onchange={() => {
                  if (layer.mask?.enabled) {
                    project.disableMask(layer.id);
                  } else {
                    project.enableMask(layer.id);
                  }
                }}
              />
              Enable Mask
            </label>
            <span class="mask-point-count">
              {#if layer.mask?.shapes}
                {@const totalShapes = layer.mask.shapes.length}
                {@const totalPoints = layer.mask.shapes.reduce((acc, s) => acc + s.points.length, 0)}
                {totalPoints} points · {totalShapes} {totalShapes === 1 ? 'shape' : 'shapes'}
              {:else}
                0 points · 0 shapes
              {/if}
            </span>
          </div>

          {#if layer.mask?.enabled}
            <div class="property-row">
              <label>
                <input
                  type="checkbox"
                  checked={layer.mask?.inverted ?? false}
                  onchange={() => project.toggleMaskInvert(layer.id)}
                />
                Invert Mask
              </label>
            </div>

            <div class="property-row">
              <label>Feather</label>
              <input
                type="range"
                min="0"
                max="0.2"
                step="0.005"
                value={layer.mask?.feather ?? 0}
                oninput={(e) => project.setMaskFeather(layer.id, parseFloat((e.target as HTMLInputElement).value))}
              />
              <span class="value">{((layer.mask?.feather ?? 0) * 100).toFixed(0)}%</span>
            </div>

            <!-- Per-shape list. Closed = solid swatch, open = dashed.
                 Edit button re-activates the mask drawing/editing overlay
                 (drag anchors, right-click anchor to delete, right-click
                 empty area to close); × deletes the whole sub-polygon. -->
            {#if (layer.mask?.shapes?.length ?? 0) > 0}
              <div class="mask-shape-list">
                {#each layer.mask.shapes as shape, sIdx}
                  <div class="mask-shape-row">
                    <span class="mask-shape-swatch" class:open={!shape.closed} aria-hidden="true"></span>
                    <span class="mask-shape-label">
                      Shape {sIdx + 1}
                      <span class="mask-shape-meta">
                        · {shape.points.length} pt{shape.points.length === 1 ? '' : 's'}
                        {#if !shape.closed}· <em>open</em>{/if}
                      </span>
                    </span>
                    <button
                      class="mask-shape-edit"
                      title="Edit points (drag to move, right-click anchor to delete)"
                      onclick={() => project.enableMask(layer.id)}
                      aria-label="Edit shape {sIdx + 1}"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M12 20h9"/>
                        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
                      </svg>
                    </button>
                    <button
                      class="mask-shape-delete"
                      title="Delete this shape"
                      onclick={() => project.removeMaskShape(layer.id, sIdx)}
                      aria-label="Delete shape {sIdx + 1}"
                    >×</button>
                  </div>
                {/each}
              </div>
            {/if}

            <div class="property-row mask-actions">
              <button class="btn-secondary" onclick={() => project.clearMask(layer.id)}>
                Clear All
              </button>
              <span class="mask-hint">Click to add points · Click+drag for curves · Click first point or right-click empty area to close · Right-click anchor to delete</span>
            </div>

            <div class="property-row mask-done">
              <button
                class="btn-primary mask-done-btn"
                onclick={() => project.disableMask(layer.id)}
              >
                Done Editing Mask
              </button>
            </div>
          {/if}
          </div>
          <!-- End mask-section -->

        <!-- Layer Shape Section -->
        <div class="shape-mask-section">
          {#if layer.type === 'media'}
            {@const shapeType = layer.layerShape?.type ?? 'rectangle'}
            <div class="property-row">
              <label>Layer Shape</label>
              <div class="shape-icon-row">
                <button
                  class="shape-icon-btn"
                  class:active={shapeType === 'rectangle'}
                  onclick={() => project.setLayerShape(layer.id, 'rectangle')}
                  title="Rectangle"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="6" width="16" height="12" rx="1.5"/></svg>
                </button>
                <button
                  class="shape-icon-btn"
                  class:active={shapeType === 'circle'}
                  onclick={() => project.setLayerShape(layer.id, 'circle')}
                  title="Circle"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/></svg>
                </button>
                <button
                  class="shape-icon-btn"
                  class:active={shapeType === 'ellipse'}
                  onclick={() => project.setLayerShape(layer.id, 'ellipse')}
                  title="Ellipse"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="12" rx="9" ry="6"/></svg>
                </button>
                <button
                  class="shape-icon-btn"
                  class:active={shapeType === 'triangle'}
                  onclick={() => project.setLayerShape(layer.id, 'triangle')}
                  title="Triangle"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4l8 16H4L12 4z"/></svg>
                </button>
                <button
                  class="shape-icon-btn"
                  class:active={shapeType === 'polygon'}
                  onclick={() => project.setLayerShape(layer.id, 'polygon')}
                  title="Polygon"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l9.5 7-3.5 11h-12L2.5 9z"/></svg>
                </button>
                <!-- Star shape hidden from UI (functionality retained) -->
              </div>
            </div>

            {#if shapeType === 'circle' || shapeType === 'triangle'}
              <div class="property-row">
                <button class="btn-secondary" onclick={toggleShapeWarpEditing}>
                  {shapeWarpEditing ? 'Exit Shape Warp Edit' : 'Edit Shape Warp'}
                </button>
              </div>
            {/if}

            {#if layer.layerShape && layer.layerShape.type !== 'custom'}
              <div class="property-row">
                <button class="btn-secondary" onclick={() => project.convertToCustomShape(layer.id)} title="Convert shape to editable polygon with draggable vertices">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1.5" fill="currentColor"/><path d="M12 5v2m0 10v2m-7-7h2m10 0h2"/></svg>
                  Edit Points
                </button>
              </div>
            {/if}
            {#if layer.layerShape?.type === 'custom'}
              <div class="property-row shape-help">
                <span>Drag vertices on canvas. Click edges to add points. Right-click vertex to remove.</span>
              </div>
              <div class="property-row">
                <label>Shape Fit</label>
                <select
                  value={layer.layerShape.params.customShapeFit || 'warp'}
                  onchange={(e) => project.updateLayerShapeParams(layer.id, { customShapeFit: (e.target as HTMLSelectElement).value as 'warp' | 'fill' | 'mask' })}
                >
                  <option value="warp">Warp</option>
                  <option value="fill">Fill</option>
                  <option value="mask">Mask</option>
                </select>
              </div>
              <!-- Invert: turns the custom shape into a HOLE / cutout
                   instead of a fill. Stack a second layer underneath
                   and you get cool projection-mapping setups where the
                   shape "punches through" to reveal what's behind. -->
              <div class="property-row">
                <label>Invert</label>
                <input
                  type="checkbox"
                  checked={layer.layerShape.params.invert === true}
                  onchange={(e) => project.updateLayerShapeParams(layer.id, { invert: (e.target as HTMLInputElement).checked })}
                />
                <span class="invert-hint">cutout / negative space</span>
              </div>
            {/if}
          {/if}

          {#if layer.layerShape}
            {@const shapeT = layer.layerShape.type}
            {#if shapeT === 'circle' || shapeT === 'triangle'}
              <div class="property-row shape-help">
                <span>Shape geometry is controlled directly on canvas via warp points.</span>
              </div>
            {/if}

            {#if shapeT !== 'rectangle' && shapeT !== 'custom'}
              <!-- Radius controls -->
              {#if shapeT === 'circle' || shapeT === 'ellipse'}
                <div class="property-row">
                  <label>{shapeT === 'ellipse' ? 'Radius X' : 'Radius'}</label>
                  <input
                    type="range"
                    min="0.05"
                    max="1.0"
                    step="0.01"
                    value={layer.layerShape.params.radiusX ?? 0.5}
                    oninput={(e) => {
                      const val = parseFloat((e.target as HTMLInputElement).value);
                      const updates: Record<string, number> = { radiusX: val };
                      if (shapeT === 'circle') updates.radiusY = val;
                      project.updateLayerShapeParams(layer.id, updates);
                    }}
                  />
                  <span class="value">{((layer.layerShape.params.radiusX ?? 0.5) * 100).toFixed(0)}%</span>
                </div>
                {#if shapeT === 'ellipse'}
                  <div class="property-row">
                    <label>Radius Y</label>
                    <input
                      type="range"
                      min="0.05"
                      max="1.0"
                      step="0.01"
                      value={layer.layerShape.params.radiusY ?? 0.35}
                      oninput={(e) => project.updateLayerShapeParams(layer.id, { radiusY: parseFloat((e.target as HTMLInputElement).value) })}
                    />
                    <span class="value">{((layer.layerShape.params.radiusY ?? 0.35) * 100).toFixed(0)}%</span>
                  </div>
                {/if}
              {/if}

              <!-- Sides control for polygon/star -->
              {#if shapeT === 'polygon' || shapeT === 'star'}
                <div class="property-row">
                  <label>Sides</label>
                  <input
                    type="range"
                    min="3"
                    max="12"
                    step="1"
                    value={layer.layerShape.params.sides ?? 6}
                    oninput={(e) => project.updateLayerShapeParams(layer.id, { sides: parseInt((e.target as HTMLInputElement).value) })}
                  />
                  <span class="value">{layer.layerShape.params.sides ?? 6}</span>
                </div>
              {/if}

              <!-- Inner radius for star -->
              {#if shapeT === 'star'}
                <div class="property-row">
                  <label>Inner Radius</label>
                  <input
                    type="range"
                    min="0.1"
                    max="0.9"
                    step="0.01"
                    value={layer.layerShape.params.innerRadius ?? 0.4}
                    oninput={(e) => project.updateLayerShapeParams(layer.id, { innerRadius: parseFloat((e.target as HTMLInputElement).value) })}
                  />
                  <span class="value">{((layer.layerShape.params.innerRadius ?? 0.4) * 100).toFixed(0)}%</span>
                </div>
              {/if}

              <!-- Rotation -->
              <div class="property-row">
                <label>Rotation</label>
                <input
                  type="range"
                  min="0"
                  max="360"
                  step="1"
                  value={layer.layerShape.params.rotation ?? 0}
                  oninput={(e) => project.updateLayerShapeParams(layer.id, { rotation: parseFloat((e.target as HTMLInputElement).value) })}
                />
                <span class="value">{(layer.layerShape.params.rotation ?? 0).toFixed(0)}&deg;</span>
              </div>

              <!-- Scale -->
              <div class="property-row">
                <label>Scale</label>
                <input
                  type="range"
                  min="0.1"
                  max="3.0"
                  step="0.01"
                  value={layer.layerShape.params.scale ?? 1.0}
                  oninput={(e) => project.updateLayerShapeParams(layer.id, { scale: parseFloat((e.target as HTMLInputElement).value) })}
                />
                <span class="value">{((layer.layerShape.params.scale ?? 1.0) * 100).toFixed(0)}%</span>
              </div>

              <!-- Feather -->
              <div class="property-row">
                <label>Feather</label>
                <input
                  type="range"
                  min="0"
                  max="0.2"
                  step="0.005"
                  value={layer.layerShape.params.feather ?? 0}
                  oninput={(e) => project.updateLayerShapeParams(layer.id, { feather: parseFloat((e.target as HTMLInputElement).value) })}
                />
                <span class="value">{((layer.layerShape.params.feather ?? 0) * 100).toFixed(0)}%</span>
              </div>

              <!-- Invert -->
              <div class="property-row">
                <label>Invert</label>
                <input
                  type="checkbox"
                  checked={layer.layerShape.params.invert ?? false}
                  onchange={(e) => project.updateLayerShapeParams(layer.id, { invert: (e.target as HTMLInputElement).checked })}
                />
              </div>
            {/if}

            {#if shapeT === 'custom'}
              <!-- Custom shapes just get feather -->
              <div class="property-row">
                <label>Feather</label>
                <input
                  type="range"
                  min="0"
                  max="0.2"
                  step="0.005"
                  value={layer.layerShape.params.feather ?? 0}
                  oninput={(e) => project.updateLayerShapeParams(layer.id, { feather: parseFloat((e.target as HTMLInputElement).value) })}
                />
                <span class="value">{((layer.layerShape.params.feather ?? 0) * 100).toFixed(0)}%</span>
              </div>
            {/if}
          {/if}
        </div>
        <!-- End shape-mask-section -->

        <!-- Edge Effects (all media layers) -->
        {#if (layer.type as string) !== 'group' && layer.type !== 'lines'}
          <EdgeEffectsPanel />
        {/if}

        </div>
        {/if}
        <!-- End layer-properties -->

        {#if layer.parentGroupId}
          {@const pg = $layers.find(l => l.id === layer.parentGroupId)}
          {#if pg}
            <div class="grouped-child-note">
              Part of <strong>{pg.name}</strong> — effects and source controlled at group level.
            </div>
          {/if}
        {/if}

        <!-- Effects Section (inside same scrollable area) — hidden for grouped children -->
        {#if !layer.parentGroupId || layer.type === 'group'}
        <div class="effects-section">
            <div class="effects-header">
              <h4>Layer Effects</h4>
              <button
                class="add-effect-btn"
                onclick={() => { effectPickerLayerId = layer.id; showEffectPicker = true; }}
              >+ Add Effect</button>
            </div>

            <!-- Effect List -->
            {#if layer.effects.length > 0}
              <div class="effect-list">
              {#each layer.effects as effect, index (effect.id)}
                <div
                  class="effect-item"
                  class:disabled={!effect.enabled}
                  class:expanded={expandedEffectId === effect.id}
                  class:dragging={draggedEffectIndex === index}
                  class:drag-over={dragOverEffectIndex === index && draggedEffectIndex !== index}
                  ondragover={(e) => handleEffectDragOver(index, e)}
                  ondrop={(e) => handleEffectDrop(layer.id, index, e)}
                >
                  <div
                    class="effect-header"
                    draggable="true"
                    ondragstart={(e) => handleEffectDragStart(index, e)}
                    ondragend={handleEffectDragEnd}
                  >
                    <!-- Drag handle -->
                    <div class="effect-drag-handle">
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                        <circle cx="2" cy="2" r="1.2"/>
                        <circle cx="8" cy="2" r="1.2"/>
                        <circle cx="2" cy="8" r="1.2"/>
                        <circle cx="8" cy="8" r="1.2"/>
                      </svg>
                    </div>

                    <!-- Enable/disable checkbox -->
                    <input
                      type="checkbox"
                      checked={effect.enabled}
                      onchange={() => project.toggleEffect(layer.id, effect.id)}
                      title={effect.enabled ? 'Disable effect' : 'Enable effect'}
                    />

                    <!-- Effect name (clickable to expand) -->
                    <button
                      class="effect-name"
                      onclick={() => expandedEffectId = expandedEffectId === effect.id ? null : effect.id}
                    >
                      {getEffectLabel(effect.type)}
                    </button>

                    <!-- Delete button -->
                    <button
                      class="effect-delete"
                      onclick={() => project.removeEffect(layer.id, effect.id)}
                      title="Remove effect"
                    >
                      x
                    </button>
                  </div>

                  <!-- Effect Parameters (expanded) -->
                  {#if expandedEffectId === effect.id}
                    {@const layerIdx = $layers.findIndex(l => l.id === layer.id)}
                    <div
                      class="effect-params"
                      ondragstart={(e) => e.stopPropagation()}
                      draggable="false">
                      <!-- Per-effect opacity & blend mode -->
                      <div class="effect-mix-row">
                        <div class="effect-opacity-ctrl">
                          <label>Opacity</label>
                          <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.01"
                            value={effect.opacity ?? 1}
                            oninput={(e) => project.updateEffect(layer.id, effect.id, { opacity: parseFloat((e.target as HTMLInputElement).value) })}
                          />
                          <span class="param-value">{(((effect.opacity ?? 1) * 100)).toFixed(0)}%</span>
                        </div>
                        <div class="effect-blend-ctrl">
                          <label>Blend</label>
                          <select
                            value={effect.blendMode ?? 'normal'}
                            onchange={(e) => project.updateEffect(layer.id, effect.id, { blendMode: (e.target as HTMLSelectElement).value as BlendMode })}
                          >
                            {#each blendModes as mode}
                              <option value={mode}>{mode}</option>
                            {/each}
                          </select>
                        </div>
                      </div>

                      {#if getEffectPresets(effect.type).length > 0}
                        <details open>
                          <summary>Presets</summary>
                          <div class="param-row">
                            <label>Preset</label>
                            <select
                              value={layerPresetSelection[effect.id] ?? ''}
                              onchange={(e) => {
                                const val = (e.target as HTMLSelectElement).value;
                                layerPresetSelection = { ...layerPresetSelection, [effect.id]: val };
                                if (val !== '') applyLayerPreset(layer.id, effect as any, parseInt(val, 10));
                              }}
                            >
                              <option value="">Select preset</option>
                              {#each getEffectPresets(effect.type) as preset, i}
                                <option value={String(i)}>{preset.name}</option>
                              {/each}
                            </select>
                          </div>
                        </details>
                      {/if}

                      <details open>
                        <summary>Controls</summary>
                      {#if effect.type === 'gpuFluidSim'}
                        <!-- ── WebGPU Fluid Simulation ──
                             Real-time Navier-Stokes fluid running on
                             GPU compute. The source is the layer's
                             rendered output (after upstream effects);
                             it injects dye and force into the fluid.
                             EffectParamRow gives each knob the same
                             mod-source dropdown + click-to-type editor
                             the rest of the panel uses. -->
                        <EffectParamRow label="Inject Strength" min={0} max={3} step={0.01}
                          layerIndex={layerIdx} effectId={effect.id} paramName="injectStrength"
                          value={effect.params.injectStrength ?? 1.5}
                          onChange={(v) => project.updateEffectParams(layer.id, effect.id, { injectStrength: v })} />
                        <EffectParamRow label="Velocity Push" min={0} max={3} step={0.01}
                          layerIndex={layerIdx} effectId={effect.id} paramName="velocityFromGradient"
                          value={effect.params.velocityFromGradient ?? 1.4}
                          onChange={(v) => project.updateEffectParams(layer.id, effect.id, { velocityFromGradient: v })} />
                        <EffectParamRow label="Vorticity" min={0} max={3} step={0.01}
                          layerIndex={layerIdx} effectId={effect.id} paramName="vorticity"
                          value={effect.params.vorticity ?? 1.0}
                          onChange={(v) => project.updateEffectParams(layer.id, effect.id, { vorticity: v })} />
                        <EffectParamRow label="Dye Decay" min={0} max={3} step={0.01}
                          layerIndex={layerIdx} effectId={effect.id} paramName="dyeDecay"
                          value={effect.params.dyeDecay ?? 2.4}
                          onChange={(v) => project.updateEffectParams(layer.id, effect.id, { dyeDecay: v })} />
                        <EffectParamRow label="Velocity Decay" min={0} max={3} step={0.01}
                          layerIndex={layerIdx} effectId={effect.id} paramName="velocityDecay"
                          value={effect.params.velocityDecay ?? 2.3}
                          onChange={(v) => project.updateEffectParams(layer.id, effect.id, { velocityDecay: v })} />
                        <EffectParamRow label="Brightness Boost" min={0.5} max={4} step={0.01}
                          layerIndex={layerIdx} effectId={effect.id} paramName="outputBoost"
                          value={effect.params.outputBoost ?? 0.7}
                          displayValue={(v) => v.toFixed(2) + '×'}
                          onChange={(v) => project.updateEffectParams(layer.id, effect.id, { outputBoost: v })} />
                        <EffectParamRow label="Time Scale" min={0.1} max={3} step={0.01}
                          layerIndex={layerIdx} effectId={effect.id} paramName="timeScale"
                          value={effect.params.timeScale ?? 1.6}
                          displayValue={(v) => v.toFixed(2) + '×'}
                          onChange={(v) => project.updateEffectParams(layer.id, effect.id, { timeScale: v })} />

                      {:else if effect.type === 'colorama'}
                        <div class="param-row">
                          <label>Palette</label>
                          <select
                            value={effect.params.coloramaPalette ?? 0}
                            onchange={(e) => project.updateEffectParams(layer.id, effect.id, { coloramaPalette: parseInt((e.target as HTMLSelectElement).value) })}
                          >
                            <option value="0">Rainbow</option>
                            <option value="1">Sunset</option>
                            <option value="2">Ocean</option>
                            <option value="3">Neon</option>
                            <option value="4">Fire</option>
                            <option value="5">Forest</option>
                            <option value="6">Ice</option>
                            <option value="7">Psychedelic</option>
                          </select>
                        </div>
                        <EffectParamRow label="Offset" min={0} max={1} step={0.01}
                          layerIndex={layerIdx} effectId={effect.id} paramName="coloramaOffset"
                          value={effect.params.coloramaOffset ?? 0}
                          displayValue={(v) => (v * 100).toFixed(0) + '%'}
                          onChange={(v) => project.updateEffectParams(layer.id, effect.id, { coloramaOffset: v })} />
                        <EffectParamRow label="Auto Speed" min={0} max={2} step={0.01}
                          layerIndex={layerIdx} effectId={effect.id} paramName="coloramaSpeed"
                          value={effect.params.coloramaSpeed ?? 0.2}
                          onChange={(v) => project.updateEffectParams(layer.id, effect.id, { coloramaSpeed: v })} />
                        <EffectParamRow label="Contrast" min={0.5} max={2} step={0.01}
                          layerIndex={layerIdx} effectId={effect.id} paramName="coloramaContrast"
                          value={effect.params.coloramaContrast ?? 1}
                          displayValue={(v) => (v * 100).toFixed(0) + '%'}
                          onChange={(v) => project.updateEffectParams(layer.id, effect.id, { coloramaContrast: v })} />
                        <EffectParamRow label="Mix" min={0} max={1} step={0.01}
                          layerIndex={layerIdx} effectId={effect.id} paramName="coloramaMix"
                          value={effect.params.coloramaMix ?? 1}
                          displayValue={(v) => (v * 100).toFixed(0) + '%'}
                          onChange={(v) => project.updateEffectParams(layer.id, effect.id, { coloramaMix: v })} />

                      {:else if effect.type === 'invert'}
                        <div class="param-info">No parameters</div>

                      {:else}
                        {@const paramMeta = effectParamLabels[effect.type]}
                        {#if paramMeta}
                          {#each Object.entries(paramMeta) as [paramKey, meta]}
                            {#if meta.type === 'select' && meta.options}
                              <div class="param-row">
                                <label>{meta.label}</label>
                                <select
                                  value={(effect.params as Record<string, number>)[paramKey] ?? meta.default}
                                  onchange={(e) => project.updateEffectParams(layer.id, effect.id, { [paramKey]: parseFloat((e.target as HTMLSelectElement).value) })}
                                >
                                  {#each meta.options as opt}
                                    <option value={opt.value}>{opt.label}</option>
                                  {/each}
                                </select>
                              </div>
                            {:else if meta.type === 'color' && meta.colorParams}
                              <div class="param-row">
                                <label>{meta.label}</label>
                                <input type="color"
                                  value={'#' + [meta.colorParams.r, meta.colorParams.g, meta.colorParams.b].map(k => {
                                    const v = (effect.params as Record<string, number>)[k] ?? 0;
                                    return Math.round(v * 255).toString(16).padStart(2, '0');
                                  }).join('')}
                                  oninput={(e) => {
                                    const hex = (e.target as HTMLInputElement).value;
                                    const r = parseInt(hex.slice(1, 3), 16) / 255;
                                    const g = parseInt(hex.slice(3, 5), 16) / 255;
                                    const b = parseInt(hex.slice(5, 7), 16) / 255;
                                    project.updateEffectParams(layer.id, effect.id, {
                                      [meta.colorParams!.r]: r, [meta.colorParams!.g]: g, [meta.colorParams!.b]: b
                                    });
                                  }}
                                />
                              </div>
                            {:else}
                              <EffectParamRow
                                label={meta.label}
                                value={(effect.params as Record<string, number>)[paramKey] ?? meta.default}
                                min={meta.min as number}
                                max={meta.max as number}
                                step={meta.step as number}
                                layerIndex={layerIdx}
                                effectId={effect.id}
                                paramName={paramKey}
                                displayValue={(v) => (meta.max as number) <= 1 ? (v * 100).toFixed(0) + '%' : v.toFixed(2)}
                                onChange={(v) => project.updateEffectParams(layer.id, effect.id, { [paramKey]: v })}
                              />
                            {/if}
                          {/each}
                        {:else}
                          {#each getNumericEffectParams(effect.type) as paramKey}
                            <EffectParamRow
                              label={paramKey}
                              value={(effect.params as Record<string, number>)[paramKey] ?? 0.5}
                              min={0}
                              max={1}
                              step={0.01}
                              layerIndex={layerIdx}
                              effectId={effect.id}
                              paramName={paramKey}
                              displayValue={(v) => (v * 100).toFixed(0) + '%'}
                              onChange={(v) => project.updateEffectParams(layer.id, effect.id, { [paramKey]: v })}
                            />
                          {/each}
                        {/if}
                      {/if}
                      </details>
                    </div>
                  {/if}
                </div>
              {/each}
              </div>
            {:else}
              <div class="no-effects">No effects. Click + Add Effect above.</div>
            {/if}
          </div>
          <!-- End effects-section -->
        {/if}
        </div>
        <!-- End properties-effects-content -->
      </div>
      <!-- End properties-effects-panel -->
    {/if}
  {/if}
</div>

<EffectPickerModal
  bind:open={showEffectPicker}
  onAdd={(types) => {
    if (effectPickerLayerId) {
      for (const t of types) addEffect(effectPickerLayerId, t);
    }
    showEffectPicker = false;
  }}
  onClose={() => { showEffectPicker = false; }}
/>


<style>
  .layer-panel {
    width: 280px;
    background: #111114;
    border-right: 1px solid rgba(255, 255, 255, 0.06);
    display: flex;
    flex-direction: column;
    color: #eee;
    font-size: 13px;
    height: 100%;
    overflow: hidden;
  }

  /* Top section - layers list (50% height, scrollable) */
  .layers-section {
    display: flex;
    flex-direction: column;
    flex: 0 0 50%;
    min-height: 100px;
    max-height: 50%;
    overflow: hidden;
  }

  .layer-panel:not(:has(.properties-effects-panel)) .layers-section {
    flex: 1 1 auto;
    max-height: none;
  }

  /* Bottom section - properties & effects (50% height, scrollable) */
  .properties-effects-panel {
    display: flex;
    flex-direction: column;
    flex: 1 1 50%;
    min-height: 100px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    overflow: hidden;
  }

  .properties-effects-content {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
  }

  /* Effects section inside properties panel */
  .effects-section {
    margin-top: 12px;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    padding-top: 8px;
  }

  .effects-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
    /* Match EdgeEffectsPanel's .section-header-row padding so the
       "LAYER EFFECTS" and "EDGE EFFECTS" titles line up at the same
       left edge — fixes visual mismatch where one was indented less. */
    padding: 4px 12px;
  }

  .effects-header h4 {
    margin: 0;
    /* Mirror EdgeEffectsPanel's .section-title styling exactly: same
       weight, size, uppercase, letter-spacing. Only difference is the
       accent color — purple (BB86FC) here vs orange (ff9800) for Edge
       Effects, so the two sections read as siblings, not parent/child. */
    font-size: 11px;
    font-weight: 600;
    color: #BB86FC;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .panel-header h3 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
  }

  .btn-add {
    background: #BB86FC;
    color: #000;
    border: none;
    padding: 6px 12px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
  }

  .btn-add:hover {
    background: #CF6EFF;
  }

  .layer-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
  }

  .layer-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    background: rgba(255, 255, 255, 0.04);
    border-radius: 4px;
    margin-bottom: 2px;
    cursor: pointer;
    transition: background 0.15s;
  }

  .layer-item:hover {
    background: #3a3a3a;
  }

  .layer-item.selected {
    background: #BB86FC33;
    border: 1px solid #BB86FC;
  }

  .layer-item.multi-selected {
    background: rgba(103, 232, 249, 0.15);
    border: 1px solid rgba(103, 232, 249, 0.55);
  }

  .layer-item.dragging {
    opacity: 0.5;
    background: rgba(255, 255, 255, 0.08);
  }

  .layer-item.drag-over-above {
    border-top: 2px solid #BB86FC;
    margin-top: -2px;
  }
  .layer-item.drag-over-below {
    border-bottom: 2px solid #BB86FC;
    margin-bottom: -2px;
  }
  .layer-item.drag-over-into {
    outline: 2px solid #BB86FC;
    outline-offset: -2px;
    background: rgba(187, 134, 252, 0.1);
  }

  /* Group layer styles */
  .layer-item.group-layer {
    background: rgba(187, 134, 252, 0.06);
    border-left: 2px solid rgba(187, 134, 252, 0.4);
  }
  .layer-item.group-child {
    padding-left: 26px;
  }
  .group-collapse-btn {
    background: none;
    border: none;
    color: #888;
    font-size: 12px;
    cursor: pointer;
    padding: 0 2px;
    flex-shrink: 0;
    line-height: 1;
  }
  .group-collapse-btn:hover {
    color: #ccc;
  }
  .group-thumb {
    display: flex;
    align-items: center;
    justify-content: center;
    color: #BB86FC;
  }
  .layer-thumbnail.group {
    background: rgba(187, 134, 252, 0.1);
  }
  .radio-group {
    display: flex;
    gap: 12px;
  }
  .radio-label {
    font-size: 12px;
    color: #ccc;
    display: flex;
    align-items: center;
    gap: 4px;
    cursor: pointer;
  }
  .radio-label input[type="radio"] {
    accent-color: #BB86FC;
  }
  .property-hint {
    font-size: 11px;
    color: #666;
    margin: 4px 0 8px;
    line-height: 1.4;
  }
  .property-value {
    font-size: 12px;
    color: #aaa;
    font-family: monospace;
  }
  .grouped-child-note {
    font-size: 11px;
    color: #888;
    padding: 8px 12px;
    background: rgba(187, 134, 252, 0.06);
    border-left: 2px solid rgba(187, 134, 252, 0.3);
    margin: 8px 0;
    line-height: 1.4;
  }

  /* Right-click context menu */
  .ctx-backdrop {
    position: fixed;
    inset: 0;
    z-index: 9998;
  }
  .layer-ctx-menu {
    position: fixed;
    z-index: 9999;
    background: #1a1a20;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    padding: 4px 0;
    min-width: 160px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  }
  .layer-ctx-menu .ctx-item {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    color: #ccc;
    font-size: 12px;
    padding: 6px 14px;
    cursor: pointer;
  }
  .layer-ctx-menu .ctx-item:hover {
    background: rgba(187, 134, 252, 0.12);
    color: #fff;
  }
  .layer-ctx-menu .ctx-item.ctx-danger:hover {
    background: rgba(255, 71, 87, 0.15);
    color: #ff4757;
  }
  .layer-ctx-menu .ctx-item.ctx-has-sub {
    position: relative;
  }
  .layer-ctx-menu .ctx-divider {
    height: 1px;
    background: rgba(255, 255, 255, 0.06);
    margin: 4px 0;
  }
  .ctx-submenu {
    background: #1a1a20;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    padding: 4px 0;
    margin: 0 4px 4px 4px;
  }

  .drag-handle {
    cursor: grab;
    color: #555;
    padding: 2px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .drag-handle:hover {
    color: #888;
  }

  .layer-item.dragging .drag-handle {
    cursor: grabbing;
  }

  .layer-thumbnail {
    width: 28px;
    height: 28px;
    flex-shrink: 0;
    border-radius: 3px;
    overflow: hidden;
    background: #222;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .layer-thumbnail img,
  .layer-thumbnail video {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .empty-thumb {
    color: #555;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .layer-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Inline rename input — sits in the same flex slot as `.layer-name`
     so the row layout doesn't reflow when you double-click to edit. */
  .layer-name-input {
    flex: 1;
    background: rgba(187, 134, 252, 0.12);
    border: 1px solid #BB86FC;
    border-radius: 3px;
    color: #fff;
    font: inherit;
    font-size: 12px;
    padding: 2px 6px;
    outline: none;
    min-width: 0;
  }
  .layer-name-input:focus { background: rgba(187, 134, 252, 0.18); }

  /* Inline hint that sits next to the Invert checkbox so the label stays
     short and stops wrapping into "stacked text". The hint is a single
     italic muted span and is the only flex sibling that's allowed to
     shrink, so the row never overflows. */
  .invert-hint {
    font-size: 10px;
    color: #777;
    font-style: italic;
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .btn-visibility,
  .btn-lock,
  .btn-delete {
    background: none;
    border: none;
    cursor: pointer;
    padding: 2px;
    min-width: 22px;
    min-height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color 0.15s, opacity 0.15s;
    flex-shrink: 0;
  }

  .btn-visibility {
    color: #03DAC6;
    opacity: 0.85;
  }
  .btn-visibility:hover {
    opacity: 1;
    color: #4AEADF;
  }
  .btn-visibility.hidden {
    color: #666;
    opacity: 0.35;
  }
  .btn-visibility.hidden:hover {
    opacity: 0.6;
    color: #888;
  }

  .btn-lock {
    color: #888;
    opacity: 0.5;
  }
  .btn-lock:hover {
    opacity: 0.8;
    color: #aaa;
  }
  .btn-lock.locked {
    color: #FFB300;
    opacity: 0.9;
  }
  .btn-lock.locked:hover {
    opacity: 1;
    color: #FFC107;
  }

  .btn-delete {
    color: #ff4444;
    opacity: 0.5;
  }
  .btn-delete:hover {
    opacity: 1;
    color: #ff6666;
  }

  .empty-state {
    text-align: center;
    color: #666;
    padding: 20px;
  }

  .layer-properties {
    padding: 0;
  }

  .layer-properties h4 {
    margin: 0 0 8px 0;
    font-size: 12px;
    font-weight: 600;
    color: #888;
  }

  .media-drop-zone {
    background: rgba(255, 255, 255, 0.04);
    border: 2px dashed #555;
    border-radius: 4px;
    padding: 10px;
    text-align: center;
    margin-bottom: 8px;
    transition: border-color 0.2s;
  }

  .media-drop-zone:hover {
    border-color: #BB86FC;
  }

  .source-name {
    display: block;
    color: #BB86FC;
    word-break: break-all;
  }

  .source-type {
    display: block;
    font-size: 10px;
    color: #666;
    margin-bottom: 8px;
  }

  /* ─── Video Timeline Controls ─────────────────────── */
  .video-controls-panel {
    margin-bottom: 12px;
    padding: 8px;
    background: rgba(255, 255, 255, 0.04);
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.06);
  }

  .vt-transport {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-bottom: 8px;
  }

  .vt-btn {
    background: rgba(255, 255, 255, 0.08);
    color: #ccc;
    border: none;
    width: 28px;
    height: 28px;
    border-radius: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s, color 0.15s;
    flex-shrink: 0;
  }
  .vt-btn:hover { background: rgba(255, 255, 255, 0.15); color: #fff; }

  .vt-play {
    background: #BB86FC;
    color: #111;
  }
  .vt-play:hover { background: #CF6EFF; color: #000; }

  .vt-time {
    font-size: 11px;
    color: #888;
    font-family: monospace;
    margin-left: 4px;
    flex: 1;
    white-space: nowrap;
  }

  .vt-speed {
    background: rgba(255, 255, 255, 0.08);
    color: #aaa;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    font-size: 11px;
    padding: 2px 4px;
    cursor: pointer;
    flex-shrink: 0;
  }
  .vt-speed:hover { border-color: rgba(255, 255, 255, 0.25); }

  /* Timeline track */
  .vt-timeline {
    position: relative;
    height: 24px;
    background: rgba(255, 255, 255, 0.06);
    border-radius: 3px;
    cursor: pointer;
    margin-bottom: 8px;
    overflow: visible;
    user-select: none;
  }

  .vt-trim-outside-left,
  .vt-trim-outside-right {
    position: absolute;
    top: 0;
    height: 100%;
    background: rgba(0, 0, 0, 0.45);
    pointer-events: none;
    z-index: 1;
  }
  .vt-trim-outside-left { left: 0; border-radius: 3px 0 0 3px; }
  .vt-trim-outside-right { right: 0; border-radius: 0 3px 3px 0; }

  .vt-trim-region {
    position: absolute;
    top: 0;
    height: 100%;
    background: rgba(187, 134, 252, 0.15);
    border-top: 2px solid rgba(187, 134, 252, 0.35);
    border-bottom: 2px solid rgba(187, 134, 252, 0.35);
    pointer-events: none;
    z-index: 1;
  }

  .vt-playhead {
    position: absolute;
    top: -2px;
    width: 2px;
    height: calc(100% + 4px);
    background: #BB86FC;
    box-shadow: 0 0 4px rgba(187, 134, 252, 0.6);
    z-index: 3;
    pointer-events: none;
    transform: translateX(-1px);
  }

  .vt-trim-handle {
    position: absolute;
    top: 0;
    width: 8px;
    height: 100%;
    cursor: ew-resize;
    z-index: 4;
    transform: translateX(-4px);
    border-radius: 2px;
    transition: background 0.1s;
  }
  .vt-trim-handle::after {
    content: '';
    position: absolute;
    top: 25%;
    left: 50%;
    transform: translateX(-50%);
    width: 2px;
    height: 50%;
    background: rgba(187, 134, 252, 0.7);
    border-radius: 1px;
  }
  .vt-trim-handle:hover {
    background: rgba(187, 134, 252, 0.25);
  }
  .vt-trim-handle:hover::after {
    background: #BB86FC;
  }

  /* Mode buttons */
  .vt-modes {
    display: flex;
    gap: 2px;
  }

  .vt-mode-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: #888;
    font-size: 10px;
    padding: 4px 2px;
    border-radius: 3px;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
  }
  .vt-mode-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #bbb;
    border-color: rgba(255, 255, 255, 0.15);
  }
  .vt-mode-btn.active {
    background: rgba(187, 134, 252, 0.2);
    color: #BB86FC;
    border-color: rgba(187, 134, 252, 0.4);
  }

  .file-label {
    cursor: pointer;
  }

  .link {
    color: #BB86FC;
    text-decoration: underline;
  }

  .property-row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 6px;
  }

  .feather-row { flex-wrap: wrap; }
  .feather-sliders { width: 100%; display: flex; flex-direction: column; gap: 3px; margin-top: 4px; }
  .feather-slider { display: flex; align-items: center; gap: 4px; }
  .feather-label { width: 12px; font-size: 9px; color: #666; text-align: center; }
  .feather-slider input[type='range'] { flex: 1; }
  .btn-small { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); color: #aaa; font-size: 10px; padding: 3px 8px; border-radius: 3px; cursor: pointer; }
  .btn-small:hover { background: rgba(255,255,255,0.12); color: #fff; }

  .property-row label {
    width: 80px;
    color: #888;
  }

  .property-row input[type='range'] {
    flex: 1;
    background: #000000;
  }

  .property-row select {
    flex: 1;
    background: #1a1a1e;
    color: #eee;
    border: 1px solid #555;
    padding: 4px 8px;
    border-radius: 4px;
  }

  .property-row .value {
    width: 40px;
    text-align: right;
    color: #888;
    font-size: 12px;
  }

  .vj-source-row {
    padding: 6px 8px;
    background: rgba(249, 153, 0, 0.08);
    border: 1px solid rgba(249, 153, 0, 0.2);
    border-radius: 4px;
    margin-bottom: 8px;
  }

  .vj-source-row label {
    color: #f90;
  }

  .vj-source-select {
    flex: 1;
    background: #1a1a1e;
    color: #eee;
    border: 1px solid #555;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 11px;
  }

  .btn-reset {
    width: 100%;
    background: rgba(255, 255, 255, 0.08);
    color: #eee;
    border: none;
    padding: 8px;
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.15s;
  }

  .btn-reset:hover {
    background: #555;
  }

  .warp-mode-buttons {
    display: flex;
    gap: 4px;
    flex: 1;
  }

  .warp-mode-btn {
    flex: 1;
    background: rgba(255, 255, 255, 0.04);
    color: #aaa;
    border: 1px solid #555;
    padding: 6px 12px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    transition: all 0.15s;
  }

  .warp-mode-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #eee;
  }

  .warp-mode-btn.active {
    background: #BB86FC33;
    color: #BB86FC;
    border-color: #BB86FC;
  }

  /* Mask Section Styles */
  .mask-section {
    margin-top: 16px;
    padding-top: 12px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }

  .mask-section .property-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }

  .mask-section .property-row label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: #ccc;
  }

  .mask-section .property-row label input[type="checkbox"] {
    margin: 0;
  }

  .mask-point-count {
    font-size: 11px;
    color: #888;
    margin-left: auto;
  }

  .mask-section .property-row input[type="range"] {
    flex: 1;
    min-width: 80px;
  }

  .mask-section .property-row .value {
    font-size: 11px;
    color: #888;
    min-width: 35px;
    text-align: right;
  }

  .mask-actions {
    flex-wrap: wrap;
  }

  .mask-actions .btn-secondary {
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
    border: none;
    padding: 4px 10px;
    border-radius: 4px;
    font-size: 11px;
    cursor: pointer;
  }

  .mask-actions .btn-secondary:hover:not(:disabled) {
    background: #555;
  }

  .mask-actions .btn-secondary:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .mask-hint {
    font-size: 10px;
    color: #666;
    font-style: italic;
  }

  .mask-shape-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 6px 0 8px;
    padding: 6px;
    background: rgba(255, 255, 255, 0.03);
    border-radius: 4px;
  }
  .mask-shape-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
    border-radius: 3px;
    background: rgba(255, 0, 255, 0.06);
    border: 1px solid rgba(255, 0, 255, 0.2);
  }
  .mask-shape-swatch {
    width: 12px; height: 12px;
    border-radius: 3px;
    background: #ff00ff;
    flex-shrink: 0;
  }
  .mask-shape-swatch.open {
    background: transparent;
    border: 1.5px dashed #ff00ff;
  }
  .mask-shape-label {
    flex: 1;
    font-size: 11px;
    color: #ddd;
  }
  .mask-shape-meta {
    color: #888;
    font-size: 10px;
  }
  .mask-shape-meta em {
    color: #ffd400;
    font-style: normal;
    font-weight: 600;
  }
  .mask-shape-delete {
    background: transparent;
    border: 1px solid #555;
    color: #aaa;
    width: 22px; height: 22px;
    border-radius: 3px;
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
  }
  .mask-shape-delete:hover {
    background: #2a1414;
    border-color: #844;
    color: #f88;
  }

  /* Per-shape edit button — matches the delete-button footprint so the
     row layout stays tight. Hover shifts to the warp-orange palette
     used elsewhere for "this puts you into an editing mode." */
  .mask-shape-edit {
    background: transparent;
    border: 1px solid #555;
    color: #aaa;
    width: 22px; height: 22px;
    border-radius: 3px;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    margin-right: 4px;
  }
  .mask-shape-edit:hover {
    background: #2a1f10;
    border-color: #ff9800;
    color: #ff9800;
  }

  .mask-done {
    margin-top: 10px;
  }

  .mask-done-btn {
    width: 100%;
    padding: 10px 16px;
    background: #BB86FC;
    border: none;
    border-radius: 4px;
    color: #000;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .mask-done-btn:hover {
    background: #CF6EFF;
  }

  /* Shape Mask Section Styles */
  .shape-mask-section {
    margin-top: 16px;
    padding-top: 12px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }

  .shape-mask-section .property-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }

  .shape-mask-section .property-row label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: #ccc;
    min-width: 70px;
  }

  .shape-mask-section .property-row label input[type="checkbox"] {
    margin: 0;
  }

  .shape-icon-row {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
    flex: 1;
  }

  .shape-icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: #1a1a1e;
    color: #9aa0a6;
    border: 1px solid #444;
    border-radius: 6px;
    height: 30px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .shape-icon-btn:hover {
    border-color: #67E8F9;
    color: #d6faff;
  }

  .shape-icon-btn.active {
    border-color: #67E8F9;
    color: #67E8F9;
    background: rgba(103, 232, 249, 0.08);
  }

  .shape-mask-section .property-row select {
    flex: 1;
    background: #1a1a1e;
    color: #fff;
    border: 1px solid #555;
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 12px;
  }

  .shape-mask-section .property-row input[type="range"] {
    flex: 1;
    min-width: 80px;
  }

  .shape-mask-section .property-row .value {
    font-size: 11px;
    color: #888;
    min-width: 35px;
    text-align: right;
  }

  .shape-mask-section .shape-help {
    align-items: flex-start;
    margin-top: 2px;
  }

  .shape-mask-section .shape-help span {
    font-size: 11px;
    color: #9aa0a6;
    line-height: 1.35;
  }

  .shape-mask-section .btn-secondary {
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
    border: none;
    padding: 4px 10px;
    border-radius: 4px;
    font-size: 11px;
    cursor: pointer;
  }

  .shape-mask-section .btn-secondary:hover {
    background: #555;
  }

  /* Effects Panel Styles - already defined in .effects-panel etc */

  .add-effect-btn {
    background: #BB86FC;
    color: #000;
    border: none;
    padding: 4px 10px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
  }

  .add-effect-btn:hover {
    background: #CF6EFF;
  }

  .effect-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .effect-item {
    background: rgba(255, 255, 255, 0.04);
    border-radius: 4px;
    overflow: hidden;
    transition: all 0.15s;
  }

  .effect-item.disabled {
    opacity: 0.5;
  }

  .effect-item.dragging {
    opacity: 0.5;
    background: rgba(255, 255, 255, 0.08);
  }

  .effect-item.drag-over {
    border-top: 2px solid #BB86FC;
    margin-top: -2px;
  }

  .effect-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    cursor: grab;
  }

  .effect-header:active {
    cursor: grabbing;
  }

  .effect-drag-handle {
    cursor: grab;
    color: #555;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2px;
    flex-shrink: 0;
  }

  .effect-drag-handle:hover {
    color: #888;
  }

  .effect-item.dragging .effect-drag-handle {
    cursor: grabbing;
  }

  .effect-header input[type="checkbox"] {
    accent-color: #BB86FC;
    cursor: pointer;
    flex-shrink: 0;
  }

  .effect-name {
    flex: 1;
    background: none;
    border: none;
    color: #ddd;
    font-size: 12px;
    cursor: pointer;
    text-align: left;
    padding: 4px 0;
  }

  .effect-name:hover {
    color: #BB86FC;
  }

  .effect-delete {
    background: none;
    border: none;
    color: #ff4444;
    font-size: 14px;
    cursor: pointer;
    padding: 2px 4px;
    opacity: 0.6;
    flex-shrink: 0;
  }

  .effect-delete:hover {
    opacity: 1;
  }

  .effect-params {
    padding: 8px 10px 10px;
    background: rgba(255, 255, 255, 0.03);
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }

  .effect-mix-row {
    display: flex;
    gap: 8px;
    margin-bottom: 8px;
    padding-bottom: 8px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .effect-opacity-ctrl {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 1;
  }

  .effect-opacity-ctrl label,
  .effect-blend-ctrl label {
    font-size: 10px;
    color: #888;
    white-space: nowrap;
    min-width: 38px;
  }

  .effect-opacity-ctrl input[type="range"] {
    flex: 1;
    min-width: 50px;
  }

  .effect-blend-ctrl {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .effect-blend-ctrl select {
    background: #1a1a1e;
    border: 1px solid #333;
    color: #ccc;
    font-size: 10px;
    padding: 2px 4px;
    border-radius: 3px;
    max-width: 90px;
  }

  .param-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }

  .param-row:last-child {
    margin-bottom: 0;
  }

  .param-row label {
    width: 70px;
    font-size: 11px;
    color: #888;
    flex-shrink: 0;
  }

  .param-row input[type="range"] {
    flex: 1;
    accent-color: #BB86FC;
    height: 4px;
  }

  .param-row select {
    flex: 1;
    background: #1a1a1e;
    color: #eee;
    border: 1px solid #555;
    padding: 3px 6px;
    border-radius: 3px;
    font-size: 11px;
  }

  .param-value {
    width: 40px;
    text-align: right;
    font-size: 10px;
    color: #666;
    flex-shrink: 0;
  }

  .param-info {
    font-size: 11px;
    color: #666;
    font-style: italic;
    padding: 4px 0;
  }

  .macro-hint {
    font-size: 10px;
    color: #555;
    padding: 2px 6px 6px;
    font-style: italic;
  }

  .no-effects {
    font-size: 11px;
    color: #666;
    text-align: center;
    padding: 10px;
    background: rgba(255, 255, 255, 0.03);
    border-radius: 4px;
  }

  /* Add layer dropdown menu */
  .add-layer-wrapper {
    position: relative;
  }

  .add-layer-backdrop {
    position: fixed;
    inset: 0;
    z-index: 9998;
  }
  .add-layer-menu {
    position: fixed;
    z-index: 9999;
    background: #1a1a1e;
    border: 1px solid #444;
    border-radius: 6px;
    min-width: 170px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
    max-height: calc(100vh - 80px);
    overflow-y: auto;
  }

  .add-layer-menu button {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 10px 14px;
    background: none;
    border: none;
    color: #eee;
    font-size: 12px;
    cursor: pointer;
    text-align: left;
    transition: background 0.15s;
  }

  .add-layer-menu button:hover {
    background: #2a2a30;
  }

  .add-layer-menu button svg {
    color: #BB86FC;
  }

  /* Lines layer thumbnail */
  .layer-thumbnail.lines {
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
    border: 1px solid #00ffc844;
  }

  .lines-thumb,
  .shader-thumb {
    display: flex;
    align-items: center;
    justify-content: center;
    color: #00ffc8;
  }

  .lines-hint {
    font-size: 9px;
    opacity: 0.5;
    font-style: italic;
  }

  /* Color layer thumbnail */
  .layer-thumbnail.color {
    background: #1a1a2e;
    border: 1px solid #ff88ff44;
  }

  .color-thumb {
    width: 100%;
    height: 100%;
    border-radius: 3px;
  }

  /* Color layer controls */
  .color-controls {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 8px 0;
  }

  .color-preview-large {
    width: 100%;
    height: 60px;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.08);
  }

  .color-slider-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .color-slider-group label {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    color: #888;
  }

  .color-slider-group input[type="range"] {
    width: 100%;
    height: 8px;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.04);
    cursor: pointer;
    -webkit-appearance: none;
    appearance: none;
  }

  .color-slider-group input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #fff;
    border: 2px solid #BB86FC;
    cursor: pointer;
  }

  /* Hue slider with rainbow gradient */
  .hue-slider {
    background: linear-gradient(to right,
      hsl(0, 100%, 50%),
      hsl(60, 100%, 50%),
      hsl(120, 100%, 50%),
      hsl(180, 100%, 50%),
      hsl(240, 100%, 50%),
      hsl(300, 100%, 50%),
      hsl(360, 100%, 50%)
    ) !important;
  }

  /* Elements section for lines layers */
  .elements-section {
    margin-bottom: 12px;
  }

  .elements-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
    font-size: 12px;
    color: #888;
  }

  .add-shape-select {
    background: #BB86FC;
    color: #000;
    border: none;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
  }

  .add-shape-select:hover {
    background: #CF6EFF;
  }

  .element-list {
    display: flex;
    flex-direction: column;
    gap: 3px;
    max-height: 150px;
    overflow-y: auto;
  }

  .element-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    background: #1a1a1e;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .element-item:hover {
    background: #3a3a3a;
  }

  .element-item.selected {
    background: #BB86FC22;
    border: 1px solid #BB86FC;
  }

  .element-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    color: #BB86FC;
    flex-shrink: 0;
  }

  .element-name {
    flex: 1;
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .element-delete {
    background: none;
    border: none;
    color: #ff4444;
    font-size: 12px;
    cursor: pointer;
    padding: 2px 4px;
    opacity: 0.6;
    flex-shrink: 0;
  }

  .element-delete:hover {
    opacity: 1;
  }

  .no-elements {
    font-size: 11px;
    color: #666;
    text-align: center;
    padding: 12px 8px;
    background: rgba(255, 255, 255, 0.03);
    border-radius: 4px;
  }

  .svg-info {
    font-size: 11px;
    color: #888;
    text-align: center;
    padding: 12px 8px;
    background: rgba(255, 255, 255, 0.03);
    border-radius: 4px;
  }

  .orientation-controls {
    display: flex;
    gap: 4px;
    padding: 6px 8px;
    align-items: center;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  }

  .orient-label {
    font-size: 10px;
    color: #666;
    margin-right: 4px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .orient-btn {
    width: 26px;
    height: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 4px;
    color: #666;
    cursor: pointer;
    padding: 0;
    transition: all 0.15s;
  }

  .orient-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #bbb;
  }

  .orient-btn.active {
    background: rgba(187, 134, 252, 0.15);
    border-color: rgba(187, 134, 252, 0.4);
    color: #BB86FC;
  }

  .splat-info, .model3d-info {
    padding: 8px;
    background: rgba(255, 255, 255, 0.03);
    border-radius: 4px;
    font-size: 11px;
    color: #aaa;
  }
  .splat-info .file-loaded-info, .model3d-info .file-loaded-info {
    color: #8f8;
  }
  .splat-info .no-file-info, .model3d-info .no-file-info {
    color: #888;
    font-style: italic;
  }

  .screen-layer-config {
    padding: 8px;
    background: rgba(255, 255, 255, 0.03);
    border-radius: 4px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .screen-label {
    font-size: 11px;
    color: #888;
    white-space: nowrap;
  }

  .screen-vj-select {
    flex: 1;
    padding: 4px 8px;
    background: #1a1a1e;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    color: #ddd;
    font-size: 11px;
  }

  .flip-controls {
    display: flex;
    gap: 8px;
    margin-top: 10px;
    justify-content: center;
  }

  .flip-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 12px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 4px;
    color: #aaa;
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .flip-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
    border-color: #555;
  }

  .flip-btn.active {
    background: #BB86FC;
    color: #000;
    border-color: #BB86FC;
  }

  .flip-btn svg {
    width: 14px;
    height: 14px;
  }
</style>
