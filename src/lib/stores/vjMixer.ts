// VJ Mixer Store
// Exposes VJ mode state for rendering by the main canvas

import { writable, derived, get } from 'svelte/store';
import type { BlendMode, Effect, Layer, MediaSource } from '../types';

// VJ Layer state interface
export interface VJMixerLayer {
  id: string;
  mediaId: string | null;
  mediaType: 'video' | 'shader' | 'image' | null;
  mediaSrc: string | null;
  mediaName: string | null;
  shaderCode: string | null;
  shaderValues: Record<string, any>;
  opacity: number;
  blendMode: BlendMode;
  solo: boolean;
  mute: boolean;
  effects: Effect[];
  videoElement: HTMLVideoElement | null;
}

// VJ Mixer state
export interface VJMixerState {
  isOpen: boolean;
  layers: VJMixerLayer[];
  masterOpacity: number;
}

// Create default state
function createDefaultLayer(index: number): VJMixerLayer {
  return {
    id: `vj-layer-${index}`,
    mediaId: null,
    mediaType: null,
    mediaSrc: null,
    mediaName: null,
    shaderCode: null,
    shaderValues: {},
    opacity: 1,
    blendMode: 'normal' as BlendMode,
    solo: false,
    mute: false,
    effects: [],
    videoElement: null,
  };
}

function createDefaultState(): VJMixerState {
  return {
    isOpen: false,
    layers: [0, 1, 2, 3].map(createDefaultLayer),
    masterOpacity: 1,
  };
}

// Create the store
function createVJMixerStore() {
  const { subscribe, set, update } = writable<VJMixerState>(createDefaultState());

  return {
    subscribe,

    // Set open state
    setOpen(isOpen: boolean) {
      update(state => ({ ...state, isOpen }));
    },

    // Set all layers at once (called from VJModePanel)
    setLayers(layers: VJMixerLayer[]) {
      update(state => ({ ...state, layers }));
    },

    // Set master opacity
    setMasterOpacity(masterOpacity: number) {
      update(state => ({ ...state, masterOpacity }));
    },

    // Update a single layer
    updateLayer(index: number, layerUpdates: Partial<VJMixerLayer>) {
      update(state => {
        const newLayers = [...state.layers];
        newLayers[index] = { ...newLayers[index], ...layerUpdates };
        return { ...state, layers: newLayers };
      });
    },

    // Reset to default
    reset() {
      set(createDefaultState());
    },

    // Get current state
    getState(): VJMixerState {
      return get({ subscribe });
    }
  };
}

export const vjMixer = createVJMixerStore();

// Derived store: Active layers to render (accounting for solo/mute)
export const vjActiveLayers = derived(vjMixer, ($vjMixer) => {
  if (!$vjMixer.isOpen) return [];

  const hasSolo = $vjMixer.layers.some(l => l.solo);

  return $vjMixer.layers
    .filter(layer => {
      // Skip if muted
      if (layer.mute) return false;
      // If any layer has solo, skip non-solo layers
      if (hasSolo && !layer.solo) return false;
      // Skip if no media assigned
      if (!layer.mediaId) return false;
      return true;
    })
    .map(layer => ({
      ...layer,
      // Apply master opacity
      effectiveOpacity: layer.opacity * $vjMixer.masterOpacity,
    }));
});

// Cache for VJ layer source objects (keeps textures persistent)
const vjSourceCache = new Map<string, MediaSource>();

// Derived store: Convert VJ layers to Layer[] format for the renderer
// This returns null when VJ mode is not open, so the renderer will use normal layers
export const vjOutputLayersNew = derived(vjMixer, ($vjMixer) => {
  if (!$vjMixer.isOpen) return null;

  const hasSolo = $vjMixer.layers.some(l => l.solo);
  const outputLayers: Layer[] = [];

  // Process layers (layer 0 = topmost in VJ mode)
  for (let i = 0; i < $vjMixer.layers.length; i++) {
    const vjLayer = $vjMixer.layers[i];

    // Skip if muted or no media
    if (vjLayer.mute) continue;
    if (hasSolo && !vjLayer.solo) continue;
    if (!vjLayer.mediaId) continue;

    // Get or create a cached source object for this layer
    // This ensures textures persist across store updates
    const cacheKey = `vj-${i}-${vjLayer.mediaId}`;
    let source = vjSourceCache.get(cacheKey);

    if (!source) {
      // Determine source type
      let sourceType: 'video' | 'image' | 'shader' | 'color' = 'video';
      if (vjLayer.mediaType === 'shader') sourceType = 'shader';
      else if (vjLayer.mediaType === 'image') sourceType = 'image';

      source = {
        id: vjLayer.mediaId,
        type: sourceType,
        name: vjLayer.mediaName || 'VJ Media',
        src: vjLayer.mediaSrc || '',
        // Shader specific
        shaderCode: vjLayer.shaderCode ?? undefined,
        shaderValues: vjLayer.shaderValues,
        // Video element reference (if video)
        videoElement: vjLayer.videoElement ?? undefined,
      };
      vjSourceCache.set(cacheKey, source);
    } else {
      // Update dynamic properties (keep texture reference)
      source.shaderValues = vjLayer.shaderValues;
      if (vjLayer.videoElement) {
        source.videoElement = vjLayer.videoElement;
      }
    }

    // Create Layer object for renderer
    const layer: Layer = {
      id: vjLayer.id,
      name: vjLayer.mediaName || `VJ Layer ${i + 1}`,
      type: 'media',
      visible: true,
      locked: false,
      opacity: vjLayer.opacity * $vjMixer.masterOpacity,
      blendMode: vjLayer.blendMode,
      source,
      linesContent: null,
      svgContent: null,
      colorContent: null,
      lightPaintingContent: null,
      advLightPaintingContent: null,
      textContent: null,
      splatContent: null,
      model3dContent: null,
      pixelFXContent: null,
      gpuLayerContent: null,
      arcadeContent: null,
      effects: vjLayer.effects,
      // VJ mode doesn't use shape transforms - full screen
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      flipH: false,
      flipV: false,
      warpMode: 'none',
      corners: {
        topLeft: { x: 0, y: 1 },
        topRight: { x: 1, y: 1 },
        bottomLeft: { x: 0, y: 0 },
        bottomRight: { x: 1, y: 0 },
      },
      meshGrid: null,
      mask: null,
      cropRegion: null,
      layerShape: null,
      edgeEffects: null,
    };

    outputLayers.push(layer);
  }

  return outputLayers.length > 0 ? outputLayers : null;
});

// Clear cache when VJ mode closes
vjMixer.subscribe(($state) => {
  if (!$state.isOpen) {
    vjSourceCache.clear();
  }
});
