<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { project, selectedLayerId, selectedLayer, selectedLayerIds, layers } from '../stores/layers';
  import { keyframeTimeline } from '../stores/keyframeTimeline';
  import { mediaLibrary, type MediaItem } from '../stores/media';
  import { shaderLibrary, type SavedShader } from '../stores/shaderLibrary';
  import { showToast } from '../stores/errorToast';
  import type { MediaSource, ISFInputDef, ImageInputRef, JSAnimationSource, VideoPlaybackMode, MediaTrayFolder } from '../types';
  import { generateUUID } from '../types';
  import { videoLibrary, type SavedVideo } from '../stores/videoLibrary';
  import { parseISF, getInputDefault } from '../isf/parser';
  import { generateCachedThumbnail as generateShaderThumbnail } from '../isf/thumbnail';
  import { estimateShaderLoadRating, type ShaderLoadRating } from '../isf/loadRating';
  import { createLoop, type LoopProgress, type LoopTransitionType, LOOP_TRANSITIONS } from '../utils/videoLoop';
  import { downloadRecording } from '../recording/recorder';
  import { updateJSAnimationParams } from '../renderer/js-animation';
  import { confirmDeleteIfSafeMode } from '../utils/safeMode';
  // Tier-related imports removed — FluidGen plugin always available.
  import AIShaderGenerator from './AIShaderGenerator.svelte';
  import AIVideoGenerator from './AIVideoGenerator.svelte';
  import ShaderLibrary from './ShaderLibrary.svelte';
  import * as THREE from 'three';
  import { modulationStore, setParamModSource, setParamModAmount, setBaseValue, registerParamRanges, modKeyShader, type ModSource, type ParamModulation } from '../audio/modulation';
  import { mediaTrayShaders } from '../stores/mediaTrayShaders';
  import { createAssetRefFromFile, createAssetRefFromGeneratedBlob } from '../storage/assetRegistry';
  // Built-in Three.js / p5.js animations — auto-discovered from
  // public/threejs/ at build time by the vite plugin (see vite.config.ts).
  // Add a folder there, rebuild, it appears in the JS tab automatically.
  // @ts-expect-error virtual module supplied by vite plugin
  import bundledThreeJSItems from 'virtual:threejs-bundles';

  // Module-level shader cache — survives component remounts
  const _win = window as any;
  if (!_win.__shaderCache) _win.__shaderCache = { shaders: null as ShaderItem[] | null, loading: false };
  const shaderCache = _win.__shaderCache;

  // Hidden shaders persistence
  const HIDDEN_SHADERS_KEY = 'ghost-arcade-hidden-shaders';
  let hiddenShaders: Set<string> = new Set(
    JSON.parse(localStorage.getItem(HIDDEN_SHADERS_KEY) || '[]')
  );

  // Shader library modal state
  let showShaderLibrary = false;

  // Tray state
  export let isOpen = false;
  export let embedded = false;

  // Active tab
  let activeTab: 'videos' | 'images' | 'shaders' | 'js' | 'library' | 'sources' | 'plugins' = 'shaders';

  // --- Plugin System (Integrated) ---
  import { getAllPlugins, getPlugin, type PluginManifest } from '../plugins/registry';

  // Get all registered plugins
  $: availablePlugins = getAllPlugins();

  // Apply an integrated plugin to the selected layer
  async function applyPluginToLayer(plugin: PluginManifest) {
    // No tier gate in OSS build — every plugin is available to everyone.
    await applySourceToTargetMediaLayers((layerId) => {
      const newSource: MediaSource = {
        id: `plugin-${plugin.id}-${layerId}-${Date.now()}`,
        type: 'effect',
        name: plugin.name,
        src: `plugin://${plugin.id}`,
        effectSource: {
          effectType: plugin.effectType,
          ...plugin.defaultSourceParams,
        },
      };
      console.log('[MediaTray] Applying plugin:', plugin.name, 'effectType:', plugin.effectType);
      project.setLayerSource(layerId, newSource);
    });
  }

  // --- Live Sources State ---
  interface LiveSource {
    id: string;
    name: string;
    type: 'spout' | 'webcam' | 'capture';
    status: 'disconnected' | 'connecting' | 'live';
    deviceId?: string; // For webcam/capture device selection
    stream?: MediaStream;
    videoEl?: HTMLVideoElement;
    thumbnail?: string;
    spoutSenderName?: string; // Spout sender name for direct receiver in Canvas.svelte
  }

  let liveSources: LiveSource[] = [];
  let availableWebcams: MediaDeviceInfo[] = [];
  let availableSpoutSenders: string[] = []; // Populated from spout store
  let sourcesInitialized = false;
  let showSpoutPicker = false;

  // Check if running in desktop app (Electron)
  import { invoke as bridgeInvoke, isDesktopApp, getTextureShareLabel } from '$lib/bridge';
  const tsLabel = getTextureShareLabel();
  import { spoutSenders, scanSpoutSenders } from '$lib/stores/spout';
  const isDesktop = isDesktopApp || (typeof window !== 'undefined' && !!window.__ELECTRON__);

  // Subscribe to global Spout sender list
  $: availableSpoutSenders = $spoutSenders;

  // Enumerate webcams
  async function enumerateWebcams() {
    try {
      // Request permission first
      const tempStream = await navigator.mediaDevices.getUserMedia({ video: true });
      tempStream.getTracks().forEach(t => t.stop());
      const devices = await navigator.mediaDevices.enumerateDevices();
      availableWebcams = devices.filter(d => d.kind === 'videoinput');
    } catch (err) {
      console.warn('Could not enumerate webcams:', err);
      availableWebcams = [];
    }
  }

  // Start a webcam source
  async function startWebcam(deviceId?: string) {
    const constraints: MediaStreamConstraints = {
      video: deviceId ? { deviceId: { exact: deviceId } } : true,
      audio: false,
    };
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const videoTrack = stream.getVideoTracks()[0];
      const label = videoTrack.label || 'Webcam';
      const videoEl = document.createElement('video');
      videoEl.srcObject = stream;
      videoEl.muted = true;
      videoEl.playsInline = true;
      videoEl.autoplay = true;
      await videoEl.play();

      const source: LiveSource = {
        id: generateUUID(),
        name: label,
        type: 'webcam',
        status: 'live',
        deviceId: deviceId || videoTrack.getSettings().deviceId,
        stream,
        videoEl,
      };
      liveSources = [...liveSources, source];
    } catch (err) {
      console.error('Failed to start webcam:', err);
    }
  }

  // ── Screen / window capture chooser ─────────────────────────────────
  // The Capture button now opens a modal that lists every screen + every
  // open application window with a thumbnail preview. The user picks one
  // and we start a getUserMedia stream pinned to that desktopCapturer
  // source id — no reliance on platform getDisplayMedia pickers (which
  // pre-Win11 24H2 / pre-macOS 15 don't exist or only show whole-screen).
  //
  // If the IPC isn't available (web build, missing electronAPI) we fall
  // back to the old getDisplayMedia path so non-Electron contexts at least
  // still work.

  interface ScreenSource {
    id: string;
    name: string;
    display_id: string | null;
    thumbnailDataUrl: string | null;
    appIconDataUrl: string | null;
    kind: 'screen' | 'window';
  }

  let screenPickerOpen = false;
  let screenPickerSources: ScreenSource[] = [];
  let screenPickerLoading = false;

  async function startScreenCapture() {
    const electronAPI = (window as any).electronAPI;
    // Non-Electron context: keep the old behaviour so the app still runs in browsers.
    if (!electronAPI?.invoke) return startScreenCaptureBrowserFallback();

    screenPickerOpen = true;
    screenPickerLoading = true;
    screenPickerSources = [];
    try {
      const list = await electronAPI.invoke('screen_sources_list');
      screenPickerSources = Array.isArray(list) ? list : [];
    } catch (err) {
      console.error('Failed to enumerate screen sources:', err);
      screenPickerSources = [];
    } finally {
      screenPickerLoading = false;
    }
  }

  function closeScreenPicker() {
    screenPickerOpen = false;
    screenPickerSources = [];
    screenPickerLoading = false;
  }

  async function pickScreenSource(picked: ScreenSource) {
    closeScreenPicker();
    try {
      // Chrome legacy mandatory constraints — the only way to pin
      // getUserMedia to a specific desktopCapturer source id in Electron.
      // Standard MediaTrackConstraints typings don't include `mandatory`
      // (it's a legacy WebRTC field), hence the `as any` cast.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: picked.id,
            // Cap to 1080p so we don't burn CPU on a 4K capture path
            // by default. Users who need higher can edit this later.
            maxWidth: 1920,
            maxHeight: 1080,
            maxFrameRate: 60,
          },
        } as any,
      });

      const videoTrack = stream.getVideoTracks()[0];
      const label = picked.name || videoTrack.label || 'Capture';
      const videoEl = document.createElement('video');
      videoEl.srcObject = stream;
      videoEl.muted = true;
      videoEl.playsInline = true;
      videoEl.autoplay = true;
      await videoEl.play();

      const source: LiveSource = {
        id: generateUUID(),
        name: label,
        type: 'capture',
        status: 'live',
        stream,
        videoEl,
        // Stash the chooser thumbnail so the live tile shows something
        // immediately — gets replaced by a live frame on next poll.
        thumbnail: picked.thumbnailDataUrl || undefined,
      };

      // The track ends when the source goes away (user closes the window
      // they were capturing, monitor unplugged, etc). Auto-clean.
      videoTrack.onended = () => stopSource(source.id);

      liveSources = [...liveSources, source];
    } catch (err) {
      console.error('Failed to start capture for', picked.name, err);
      showToast(
        `Could not capture "${picked.name}". The window may have closed or the OS denied access.`,
        'error',
      );
    }
  }

  // Fallback for non-Electron environments (web build) — the old behaviour.
  async function startScreenCaptureBrowserFallback() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always' } as any,
        audio: false,
      });
      const videoTrack = stream.getVideoTracks()[0];
      const label = videoTrack.label || 'Screen Capture';
      const videoEl = document.createElement('video');
      videoEl.srcObject = stream;
      videoEl.muted = true;
      videoEl.playsInline = true;
      videoEl.autoplay = true;
      await videoEl.play();

      const source: LiveSource = {
        id: generateUUID(),
        name: label,
        type: 'capture',
        status: 'live',
        stream,
        videoEl,
      };
      videoTrack.onended = () => stopSource(source.id);
      liveSources = [...liveSources, source];
    } catch (err) {
      if ((err as any).name !== 'AbortError') {
        console.error('Failed to start screen capture:', err);
      }
    }
  }

  // Add a Spout receiver source — lightweight, no frame polling here.
  // Canvas.svelte handles actual frame reception via IPC (Electron) or WebSocket (Tauri).
  async function addSpoutSource(senderName: string) {
    const source: LiveSource = {
      id: generateUUID(),
      name: `Spout: ${senderName}`,
      type: 'spout',
      status: 'connecting',
      spoutSenderName: senderName,
    };
    liveSources = [...liveSources, source];

    if (!isDesktop) {
      setTimeout(() => {
        liveSources = liveSources.map(s =>
          s.id === source.id ? { ...s, status: 'live' as const } : s
        );
      }, 1500);
      return;
    }

    try {
      // Start receiver via IPC — tells native addon to begin SpoutDX ReceiveImage
      const result = await bridgeInvoke('spout_start_receiver', { senderName });
      console.log('[Spout] Receiver started:', result);

      // Mark as live
      liveSources = liveSources.map(s =>
        s.id === source.id ? { ...s, status: 'live' as const } : s
      );
    } catch (err) {
      console.error('Failed to start Spout receiver:', err);
      liveSources = liveSources.map(s =>
        s.id === source.id ? { ...s, status: 'disconnected' as const } : s
      );
    }
  }

  // Stop and remove a live source
  async function stopSource(id: string) {
    const source = liveSources.find(s => s.id === id);
    if (source?.stream) {
      source.stream.getTracks().forEach(t => t.stop());
    }
    // Clean up Spout receiver via IPC
    if (source?.type === 'spout' && isDesktop) {
      const senderName = (source as any).spoutSenderName || source.name.replace('Spout: ', '');
      bridgeInvoke('spout_stop_receiver', { senderName })
        .catch((err: any) => console.warn('Failed to stop Spout receiver:', err));
    }
    liveSources = liveSources.filter(s => s.id !== id);
  }

  // Apply a live source to the selected layer
  function applySourceToLayer(source: LiveSource) {
    const targetIds = getTargetMediaLayerIds();
    if (targetIds.length === 0) {
      alert('Please select one or more media layers first');
      return;
    }

    for (const layerId of targetIds) {
      if (source.type === 'spout') {
        const senderName = (source as any).spoutSenderName || source.name.replace('Spout: ', '');
        const ms: MediaSource = {
          id: `${source.id}-${layerId}-${Date.now()}`,
          type: 'spout',
          src: `live://spout/${source.id}`,
          name: source.name,
          spoutSource: {
            senderName,
            width: 1920,
            height: 1080,
          },
        };
        project.setLayerSource(layerId, ms);
      } else {
        if (!source.videoEl) continue;
        const ms: MediaSource = {
          id: `${source.id}-${layerId}-${Date.now()}`,
          type: 'video',
          src: `live://${source.type}/${source.id}`,
          name: source.name,
          videoElement: source.videoEl,
          isPlaying: true,
        };
        project.setLayerSource(layerId, ms);
      }
    }
  }

  // Svelte action to set srcObject on video elements (for MediaStream)
  function setStreamSrc(node: HTMLVideoElement, stream: MediaStream | undefined) {
    if (stream) {
      node.srcObject = stream;
      node.play().catch(() => {});
    }
    return {
      update(newStream: MediaStream | undefined) {
        if (newStream) {
          node.srcObject = newStream;
          node.play().catch(() => {});
        }
      },
      destroy() {
        node.srcObject = null;
      }
    };
  }

  // Saved shaders from library store
  $: savedShaders = $shaderLibrary.shaders;

  // AI Generator state
  let showAIGenerator = false;
  let showVideoGenerator = false;
  const FOLDER_TABS = ['videos', 'images', 'shaders'] as const;
  type FolderTab = (typeof FOLDER_TABS)[number];

  type MediaFolder = MediaTrayFolder;

  // ─── Manifest-driven shader categories ─────────────────────────────────
  // Categories come from the manifest (set in the curator tool).
  // We build folders automatically from the `category` field on each shader.
  let shaderCategoryFilter: string | null = null; // null = show all

  $: shaderCategories = (() => {
    const cats = new Map<string, number>();
    for (const s of shaders) {
      const cat = s.category || 'Uncategorized';
      cats.set(cat, (cats.get(cat) || 0) + 1);
    }
    // Sort: put common categories in a stable order
    const ORDER = ['Visual', 'Generator', 'Audio Reactive', 'Simulation', '3D Room', 'Uncategorized'];
    return [...cats.entries()]
      .sort((a, b) => {
        const ai = ORDER.indexOf(a[0]);
        const bi = ORDER.indexOf(b[0]);
        if (ai >= 0 && bi >= 0) return ai - bi;
        if (ai >= 0) return -1;
        if (bi >= 0) return 1;
        return a[0].localeCompare(b[0]);
      })
      .map(([name, count]) => ({ name, count }));
  })();

  $: filteredByCategory = (() => {
    // If a user folder is active, show only shaders in that folder
    if (activeFolderId) {
      const folder = activeTabFolders.find(f => f.id === activeFolderId);
      if (folder) {
        const idSet = new Set(folder.itemIds);
        return shaders.filter(s => idSet.has(s.id));
      }
    }
    // Otherwise filter by ISF category
    return shaderCategoryFilter
      ? shaders.filter(s => (s.category || 'Uncategorized') === shaderCategoryFilter)
      : shaders;
  })();

  function ensureDefaultShaderFolders() {
    // Now driven by manifest categories — folders are virtual, no project persistence needed
    // Keep this function as a no-op for the reactive trigger
  }

  let mediaFolders: MediaFolder[] = [];
  let activeFolderId: string | null = null;
  let selectedTrayItemIds: string[] = [];
  let lastTraySelectIndex: number | null = null;
  let draggedTrayItemId: string | null = null;
  let dragOverTrayItemId: string | null = null;
  let contextMenuOpen = false;

  // Reorder items within the tray via drag and drop
  function reorderTrayItem(targetId: string) {
    if (!draggedTrayItemId || draggedTrayItemId === targetId) {
      dragOverTrayItemId = null;
      return;
    }
    // Determine which array to reorder based on active tab
    if (activeTab === 'shaders') {
      const fromIdx = shaders.findIndex(s => s.id === draggedTrayItemId);
      const toIdx = shaders.findIndex(s => s.id === targetId);
      if (fromIdx >= 0 && toIdx >= 0) {
        const [item] = shaders.splice(fromIdx, 1);
        shaders.splice(toIdx, 0, item);
        shaders = shaders;
        shaderCache.shaders = shaders;
      }
    } else if (activeTab === 'videos') {
      const fromIdx = videos.findIndex(v => v.id === draggedTrayItemId);
      const toIdx = videos.findIndex(v => v.id === targetId);
      if (fromIdx >= 0 && toIdx >= 0) {
        const [item] = videos.splice(fromIdx, 1);
        videos.splice(toIdx, 0, item);
        videos = videos;
      }
    } else if (activeTab === 'images') {
      const fromIdx = images.findIndex(i => i.id === draggedTrayItemId);
      const toIdx = images.findIndex(i => i.id === targetId);
      if (fromIdx >= 0 && toIdx >= 0) {
        const [item] = images.splice(fromIdx, 1);
        images.splice(toIdx, 0, item);
        images = images;
      }
    }
    dragOverTrayItemId = null;
  }
  let contextMenuX = 0;
  let contextMenuY = 0;

  // JS Animation filter
  let jsFilter: 'all' | 'threejs' | 'p5js' = 'all';

  // JS Animation items
  interface JSAnimationItem {
    id: string;
    name: string;
    type: 'threejs' | 'p5js';
    jsAnimation: JSAnimationSource;
    thumbnail?: string;
  }
  let jsAnimations: JSAnimationItem[] = [];

  // Media library items (local reference to store)
  $: videos = $mediaLibrary.filter(m => m.type === 'video');
  $: images = $mediaLibrary.filter(m => m.type === 'image');

  // Shader library (not shared, local to this component)
  let shaders: ShaderItem[] = [];

  // Mirror the local shaders list into a global store so the WS layer in
  // App.svelte can sync the same list (with thumbnails) to the mobile
  // companion. The mobile uses this list as the SOURCE OF TRUTH for its
  // shader picker — no separate manifest fetch — so adds/removes here are
  // reflected on the phone within one render frame. Excludes hidden
  // shaders since users hide them precisely so they don't see them.
  $: {
    const visible = shaders.filter(s => !hiddenShaders.has(s.id));
    mediaTrayShaders.set(visible.map(s => ({
      id: s.id,
      name: s.name,
      // For library shaders the local `src` is `library-shader:<id>`; for
      // catalog shaders it's `./ISF/...`. Both shapes are understood by
      // the desktop's set_layer_source handler, so we pass them through
      // unchanged. Mobile doesn't need to know the difference.
      src: s.src,
      thumbnail: s.thumbnail,
      custom: !!(s.userAdded || s.cloudShader || s.aiGenerated),
    })));
  }

  // Selected shader for parameter editing
  let selectedShader: ShaderItem | null = null;

  // Loading state for shader thumbnails
  let loadingProgress = 0; // 0 to 1
  let totalShadersCount = 0;
  let loadedShadersCount = 0;
  let isLoadingThumbnails = false;

  // Loop creation state
  let loopingVideoId: string | null = null;
  let loopProgress: LoopProgress | null = null;
  let loopTransitionType: LoopTransitionType = 'fade';
  let loopCrossfadeDuration: number = 0.5;
  let showLoopOptions: string | null = null; // item.id when options panel is shown
  let loopPopoverPos = { x: 0, y: 0 };

  function toggleLoopOptions(itemId: string, e: MouseEvent) {
    e.stopPropagation();
    if (showLoopOptions === itemId) {
      showLoopOptions = null;
      return;
    }
    // Position popover near the button
    const btn = e.currentTarget as HTMLElement;
    const rect = btn.getBoundingClientRect();
    loopPopoverPos = {
      x: rect.left + rect.width / 2,
      y: rect.top - 8,
    };
    showLoopOptions = itemId;
  }

  interface ShaderItem {
    id: string;
    name: string;
    src: string;
    shaderCode: string;
    inputs: ISFInputDef[];
    values: Record<string, number | boolean | number[]>;
    imageInputRefs: Record<string, ImageInputRef | null>; // References to selected images for image inputs
    description?: string;
    thumbnail?: string; // Generated preview image
    loadRating?: ShaderLoadRating;
    loadingProgress?: number; // Individual shader loading progress (0-1)
    aiGenerated?: boolean; // Whether this was AI-generated
    aiPrompt?: string; // Original prompt used to generate
    tier?: 'demo' | 'starter' | 'pro'; // License tier required
    category?: string; // Manifest category
    userAdded?: boolean; // True if imported via "Add files" — persisted in shaderLibrary
    cloudShader?: boolean; // True if synced from the public catalog
  }

  // Convert a persisted SavedShader back into a ShaderItem for the main list.
  function savedShaderToItem(saved: SavedShader): ShaderItem | null {
    if (saved.type !== 'shader-isf') return null;
    try {
      const parsed = parseISF(saved.code);
      const inputs = (parsed.metadata.INPUTS || []) as ISFInputDef[];
      const values: Record<string, number | boolean | number[]> = {};
      const imageInputRefs: Record<string, ImageInputRef | null> = {};
      for (const input of inputs) {
        if (input.TYPE === 'image') {
          imageInputRefs[input.NAME] = null;
        } else {
          values[input.NAME] = getInputDefault(input) as number | boolean | number[];
        }
      }
      const isCloud = saved.source === 'cloud';
      return {
        id: saved.id,
        name: saved.name,
        // Unique src per shader so Canvas's textureCacheKey (= layer.source.src
        // for non-AI shaders) doesn't collide between different library shaders
        // on the same layer. Without this, the renderer caches the FIRST
        // library shader assigned to a layer and silently reuses it for every
        // subsequent library shader picked on that same layer.
        src: `library-shader:${saved.id}`,
        shaderCode: saved.code,
        inputs,
        values,
        imageInputRefs,
        description: saved.description,
        thumbnail: saved.thumbnail,
        loadRating: getShaderLoadRating(saved.code, inputs.length),
        userAdded: !isCloud,
        cloudShader: isCloud,
        category: isCloud ? 'Cloud' : 'My Library',
      };
    } catch (e) {
      console.warn('Failed to convert saved shader:', saved.name, e);
      return null;
    }
  }

  const shaderLoadRatingCache = new Map<string, ShaderLoadRating>();

  function getShaderLoadRating(shaderCode: string, inputCount = 0): ShaderLoadRating {
    const key = `${shaderCode.length}:${inputCount}:${shaderCode.slice(0, 64)}:${shaderCode.slice(-64)}`;
    let cached = shaderLoadRatingCache.get(key);
    if (!cached) {
      cached = estimateShaderLoadRating(shaderCode, inputCount);
      shaderLoadRatingCache.set(key, cached);
    }
    return cached;
  }

  function withShaderLoadRating(shader: ShaderItem): ShaderItem {
    if (shader.loadRating) return shader;
    return {
      ...shader,
      loadRating: getShaderLoadRating(shader.shaderCode, shader.inputs.length),
    };
  }

  function getShaderLoadBadgeTitle(rating: ShaderLoadRating): string {
    const detail = rating.hints.length ? ` - ${rating.hints.slice(0, 2).join(', ')}` : '';
    return `${rating.label} (score ${rating.score})${detail}`;
  }

  // Editing state
  let editingShader: ShaderItem | null = null;
  let editingJSAnimation: JSAnimationItem | null = null;

  // Selected JS animation for parameter editing
  let selectedJSAnimation: JSAnimationItem | null = null;

  function toggleTray() {
    isOpen = !isOpen;
  }

  // Spout scanning is now handled globally by the spout store (started in App.svelte).
  // MediaTray subscribes to $spoutSenders reactively via the `$:` block above.

  /**
   * Generate thumbnails for any shaders that don't already have one.
   * Works on the current `shaders` array — called after shaders are loaded
   * (whether from cache or fresh fetch).
   */
  async function generateMissingThumbnails() {
    const needsGen = shaders.filter(s => !s.thumbnail);
    if (needsGen.length === 0) return;

    totalShadersCount = shaders.length;
    loadedShadersCount = shaders.length - needsGen.length;
    loadingProgress = loadedShadersCount / totalShadersCount;
    isLoadingThumbnails = true;

    // Check once for pre-generated thumbnail manifest (single fetch, not per-shader)
    let preGenMap: Record<string, string> = {};
    try {
      const manifestResp = await fetch('./ISF/thumbnails/manifest.json');
      if (manifestResp.ok) {
        const manifest = await manifestResp.json();
        preGenMap = manifest.thumbnails || {};
        console.log(`[Thumbnails] Found ${Object.keys(preGenMap).length} pre-generated thumbnails`);
      }
    } catch {
      // No pre-generated thumbnails available, will generate at runtime
    }

    // Sequential generation loop — one shader at a time
    for (let i = 0; i < shaders.length; i++) {
      const shader = shaders[i];
      if (shader.thumbnail) { continue; } // Already has one

      const baseName = shader.src.split('/').pop()?.replace('.fs', '') || shader.name;

      // Use pre-generated thumbnail if available
      if (preGenMap[baseName]) {
        shader.thumbnail = `./ISF/thumbnails/${encodeURIComponent(preGenMap[baseName])}`;
        shader.loadingProgress = 1;
        loadedShadersCount++;
        loadingProgress = loadedShadersCount / totalShadersCount;
        shaders = [...shaders];
        continue;
      }

      // Runtime WebGL generation
      shader.loadingProgress = 0;
      shaders = [...shaders];

      try {
        shader.loadingProgress = 0.3;
        shaders = [...shaders];

        const thumbnail = await generateShaderThumbnail(shader.shaderCode, 0.5);
        shader.thumbnail = thumbnail;
        shader.loadingProgress = 1;

        // Sync the generated thumbnail back to the persistent shaderLibrary
        // store so it shows up in the Shader Library modal too. Manifest
        // shaders (id starts with 'isf:') aren't in the store; they use
        // ./ISF/thumbnails/* URLs so this only syncs library shaders.
        if (!shader.id.startsWith('isf:')) {
          const inLibrary = get(shaderLibrary).shaders.find(s => s.id === shader.id);
          if (inLibrary && !inLibrary.thumbnail) {
            shaderLibrary.setThumbnail(shader.id, thumbnail);
          }
        }
      } catch (err) {
        console.warn(`Failed to generate thumbnail for ${shader.name}:`, err);
        shader.loadingProgress = 1;
      }

      loadedShadersCount++;
      loadingProgress = loadedShadersCount / totalShadersCount;
      shaders = [...shaders];
    }

    isLoadingThumbnails = false;

    // Update cache with thumbnails included
    shaderCache.shaders = shaders;
  }

  // Load ISF shaders from manifest on mount — uses cache for instant second load
  // Merge persisted user-added + AI-generated shaders from the shader library
  // into the active `shaders` list, de-duped by id. Called on mount (after the
  // manifest load) so those shaders survive layer-switch remounts.
  //
  // NOTE: Cloud-synced shaders are intentionally excluded — they live in the
  // library (visible via the Shader Library modal) and are only added to the
  // tray when the user explicitly picks them in the modal. Without this rule,
  // every Find Latest sync would dump the entire catalog into the tray.
  function hydrateUserShaders() {
    const existingIds = new Set(shaders.map(s => s.id));
    const extra: ShaderItem[] = [];
    for (const saved of get(shaderLibrary).shaders) {
      if (existingIds.has(saved.id)) continue;
      if (saved.source === 'cloud') continue; // library-only by default
      const item = savedShaderToItem(saved);
      if (item) extra.push(item);
    }
    if (extra.length > 0) shaders = [...shaders, ...extra];
  }

  // Add saved-library shaders (cloud / user / AI) to the tray on demand.
  // Triggered by the Shader Library modal when the user picks them.
  function handleSavedShaderAdd(event: CustomEvent) {
    const savedShaders = event.detail as SavedShader[];
    showShaderLibrary = false;
    if (!Array.isArray(savedShaders) || savedShaders.length === 0) return;

    const existingIds = new Set(shaders.map(s => s.id));
    const added: ShaderItem[] = [];
    for (const saved of savedShaders) {
      if (existingIds.has(saved.id)) continue;
      // Un-hide if the user previously hid this shader
      if (hiddenShaders.has(saved.id)) {
        hiddenShaders.delete(saved.id);
        localStorage.setItem(HIDDEN_SHADERS_KEY, JSON.stringify([...hiddenShaders]));
      }
      const item = savedShaderToItem(saved);
      if (item) added.push(item);
    }
    if (added.length > 0) {
      shaders = [...shaders, ...added];
      shaderCache.shaders = shaders;
      generateMissingThumbnails();
    }
  }

  // Note: cloud-sync UI lives inside the Shader Library modal now.
  // The modal manages its own isSyncing state and calls
  // `shaderLibrary.syncFromCloud()` directly. We listen for changes via the
  // store subscription in `hydrateUserShaders()` so the tray reflects synced
  // shaders automatically.

  // Built-in JS animations seeded into jsAnimations on mount. The list
  // is supplied by the vite plugin at build time so dropping a new
  // folder into public/threejs/<name>/ ships it on the next build.
  const BUILT_IN_THREEJS: Array<{ id: string; folder: string; name: string; url: string }> =
    bundledThreeJSItems as any;

  async function seedBuiltInThreeJSItems() {
    for (const def of BUILT_IN_THREEJS) {
      // Skip if already in the list (re-mount of MediaTray would duplicate)
      if (jsAnimations.some(a => a.id === def.id)) continue;
      try {
        const resp = await fetch(def.url);
        if (!resp.ok) {
          console.warn('[MediaTray] failed to fetch built-in', def.url, resp.status);
          continue;
        }
        const htmlCode = await resp.text();
        const params = parseShaderParamDefs(htmlCode);
        const values = parseShaderParamValues(htmlCode);
        const paramValues: Record<string, number | boolean | number[]> = {};
        for (const p of params) paramValues[p.name] = values[p.name] ?? p.default;
        const isP5 = /p5\.(min\.)?js|new\s+p5\s*\(/.test(htmlCode);
        const item: JSAnimationItem = {
          id: def.id,
          name: def.name,
          type: isP5 ? 'p5js' : 'threejs',
          jsAnimation: {
            animationType: isP5 ? 'p5js' : 'threejs',
            htmlCode,
            params: params.length > 0 ? params : undefined,
            paramValues: params.length > 0 ? paramValues : undefined,
          },
          thumbnail: undefined,
        };
        jsAnimations = [...jsAnimations, item];
        // Background thumbnail capture — non-blocking so the item appears
        // immediately and the thumbnail backfills a few seconds later.
        captureJSAnimationThumbnail(htmlCode).then(thumb => {
          if (!thumb) return;
          const idx = jsAnimations.findIndex(a => a.id === def.id);
          if (idx >= 0) {
            jsAnimations[idx] = { ...jsAnimations[idx], thumbnail: thumb };
            jsAnimations = [...jsAnimations];
          }
        }).catch(() => { /* */ });
      } catch (err) {
        console.warn('[MediaTray] error seeding built-in', def.name, err);
      }
    }
  }

  onMount(async () => {
    // Seed built-in Three.js / p5 animations in the background so the JS
    // tab is never empty out of the box. Doesn't block shader loading.
    seedBuiltInThreeJSItems();

    // If shaders are already cached, use them instantly (filter out hidden)
    if (shaderCache.shaders) {
      shaders = shaderCache.shaders.filter((s: ShaderItem) => !hiddenShaders.has(s.id)).map(withShaderLoadRating);
      hydrateUserShaders();
      // Check if thumbnails are already generated (e.g., from a previous session)
      const allHaveThumbnails = shaders.every(s => s.thumbnail);
      if (allHaveThumbnails) {
        isLoadingThumbnails = false;
        loadingProgress = 1;
        loadedShadersCount = shaders.length;
        totalShadersCount = shaders.length;
        return;
      }
      // Shaders are cached but thumbnails are missing — fall through to generate them
    } else if (shaderCache.loading) {
      // If another instance is already loading, wait for it
      const waitForCache = () => new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (shaderCache.shaders) {
            clearInterval(check);
            shaders = shaderCache.shaders!.map(withShaderLoadRating);
            resolve();
          }
        }, 200);
      });
      await waitForCache();
      hydrateUserShaders();
      // Fall through to generate thumbnails
    } else {
      // Fresh load — fetch all shader files
      shaderCache.loading = true;

      try {
        const response = await fetch('./ISF/manifest.json');
        const manifest = await response.json();

        // Support both v1 (flat array) and v2 (objects with metadata) manifest formats
        const entries: Array<{ file: string; tier?: string; category?: string; tags?: string[]; defaults?: Record<string, any>; featured?: boolean; enabled?: boolean; defaultLoad?: boolean }> =
          manifest.version === 2
            ? manifest.shaders.filter((s: any) => s.enabled !== false && s.defaultLoad === true && !hiddenShaders.has(`isf:${s.file}`))
            : manifest.shaders.map((f: string) => ({ file: f }));

        const loadedShaders: ShaderItem[] = [];
        totalShadersCount = entries.length;
        loadedShadersCount = 0;

        // Load shaders in parallel batches for speed, updating UI progressively
        const BATCH_SIZE = 8;
        for (let i = 0; i < entries.length; i += BATCH_SIZE) {
          const batch = entries.slice(i, i + BATCH_SIZE);
          const batchResults = await Promise.allSettled(batch.map(async (entry) => {
            const filename = entry.file;
            const encodedPath = filename.split('/').map(encodeURIComponent).join('/');
            const shaderResponse = await fetch(`./ISF/${encodedPath}`);
            const shaderCode = await shaderResponse.text();
            const parsed = parseISF(shaderCode);

            const shaderItem: ShaderItem = {
              id: `isf:${filename}`,
              name: filename.replace('.fs', '').replace('DM-', '').replace('SM-', '').replace('AR-', ''),
              src: `./ISF/${encodedPath}`,
              shaderCode,
              inputs: parsed.metadata.INPUTS as ISFInputDef[],
              values: {},
              imageInputRefs: {},
              description: parsed.metadata.DESCRIPTION,
              tier: (entry.tier as 'demo' | 'starter' | 'pro') || 'demo',
              category: entry.category || '',
            };
            shaderItem.loadRating = getShaderLoadRating(shaderItem.shaderCode, shaderItem.inputs.length);

            for (const input of shaderItem.inputs) {
              if (input.TYPE === 'image') {
                shaderItem.imageInputRefs[input.NAME] = null;
              } else {
                const manifestDefault = entry.defaults?.[input.NAME];
                shaderItem.values[input.NAME] = manifestDefault !== undefined
                  ? manifestDefault
                  : getInputDefault(input) as number | boolean | number[];
              }
            }
            return shaderItem;
          }));

          for (const result of batchResults) {
            if (result.status === 'fulfilled') {
              loadedShaders.push(result.value);
            }
          }

          // Update UI progressively — shaders appear as they load
          loadedShadersCount = loadedShaders.length;
          shaders = [...loadedShaders];
        }

        shaderCache.shaders = shaders;
        shaderCache.loading = false;
      } catch (err) {
        console.error('Failed to load shader manifest:', err);
        isLoadingThumbnails = false;
        shaderCache.loading = false;
        return;
      }
      hydrateUserShaders();
    }

    // Generate thumbnails in background — shaders are already visible and usable
    generateMissingThumbnails();
  });

  function getMediaType(file: File): 'image' | 'video' | 'shader' | 'threejs' {
    const ext = file.name.toLowerCase().split('.').pop();
    if (ext === 'fs' || ext === 'isf') return 'shader';
    // .html / .htm files are treated as Three.js / p5.js animation sources.
    // The loader will read the file as text and embed it as htmlCode; the
    // iframe-canvas-as-texture pipeline doesn't care whether the HTML was
    // hand-written, exported from a tool, or AI-generated.
    if (ext === 'html' || ext === 'htm') return 'threejs';
    if (file.type.startsWith('video/')) return 'video';
    return 'image';
  }

  async function handleDrop(e: DragEvent) {
    e.preventDefault();
    const files = e.dataTransfer?.files;
    if (!files) return;

    for (const file of files) {
      await addMediaFile(file);
    }
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
  }

  async function addMediaFile(file: File) {
    // Capture both the runtime URL AND a durable AssetRef. The blob URL dies
    // at session end; the AssetRef carries the absolute disk path so reload
    // works even without the .gha sibling-copy (Electron Save As).
    const { assetRef, runtimeUrl: url } = createAssetRefFromFile(file);
    const mediaType = getMediaType(file);

    if (mediaType === 'video') {
      const video = document.createElement('video');
      // crossOrigin BEFORE src so the load uses anonymous mode from the start.
      video.crossOrigin = 'anonymous';
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.src = url;

      // `.src=` already initiated the load — don't call `.load()`.
      await new Promise<void>((resolve) => {
        const done = () => { video.removeEventListener('loadeddata', done); resolve(); };
        video.addEventListener('loadeddata', done, { once: true });
        if (video.readyState >= 2) done();
      });

      const item: MediaItem = {
        id: generateUUID(),
        name: file.name,
        src: url,
        type: 'video',
        videoElement: video,
        thumbnail: await captureVideoThumbnail(video),
        _assetRef: assetRef,
      };
      mediaLibrary.addItem(item);
    } else if (mediaType === 'image') {
      const item: MediaItem = {
        id: generateUUID(),
        name: file.name,
        src: url,
        type: 'image',
        thumbnail: url,
        _assetRef: assetRef,
      };
      mediaLibrary.addItem(item);
    } else if (mediaType === 'shader') {
      const shaderCode = await file.text();
      const parsed = parseISF(shaderCode);
      const baseName = file.name.replace('.fs', '').replace('.isf', '');

      // Persist to the app-level shader library (localStorage + optional server sync).
      // This makes the shader survive layer switches and app reloads.
      const saved = shaderLibrary.addShader({
        name: baseName,
        description: parsed.metadata.DESCRIPTION || '',
        type: 'shader-isf',
        code: shaderCode,
        tags: ['user-added'],
        source: 'user',
      });

      // Build the ShaderItem for immediate display using the persisted id so
      // it matches what onMount will hydrate on future mounts.
      const shaderItem: ShaderItem = {
        id: saved.id,
        name: baseName,
        src: url,
        shaderCode,
        inputs: parsed.metadata.INPUTS as ISFInputDef[],
        values: {},
        imageInputRefs: {},
        description: parsed.metadata.DESCRIPTION,
        userAdded: true,
        category: 'My Library',
      };
      shaderItem.loadRating = getShaderLoadRating(shaderItem.shaderCode, shaderItem.inputs.length);

      for (const input of shaderItem.inputs) {
        if (input.TYPE === 'image') {
          shaderItem.imageInputRefs[input.NAME] = null;
        } else {
          shaderItem.values[input.NAME] = getInputDefault(input) as number | boolean | number[];
        }
      }

      shaders = [...shaders, shaderItem];
    } else if (mediaType === 'threejs') {
      // User-supplied Three.js / p5.js animation HTML. Read as text and
      // embed as htmlCode so the iframe loader can blob-URL it without
      // needing a stable disk path.
      try {
        const htmlCode = await file.text();
        const baseName = file.name.replace(/\.html?$/i, '');
        // Auto-detect p5 vs three by looking for the import. Defaults to
        // threejs so single-canvas pages without either work too.
        const isP5 = /p5\.(min\.)?js|new p5\(/.test(htmlCode);
        const animationType: 'threejs' | 'p5js' = isP5 ? 'p5js' : 'threejs';

        // Parse window.shaderParamDefs out of the HTML so the slider UI
        // can render the right controls. Without this users have to
        // manually re-declare every param in the app — defeats the point
        // of supporting param-aware files.
        const parsedDefs = parseShaderParamDefs(htmlCode);
        // Also parse window.shaderParams for the live values; falls back
        // to the def's default if not present.
        const parsedValues = parseShaderParamValues(htmlCode);
        const paramValues: Record<string, number | boolean | number[]> = {};
        for (const def of parsedDefs) {
          paramValues[def.name] = parsedValues[def.name] ?? def.default;
        }

        const jsAnimation: JSAnimationSource = {
          animationType,
          htmlCode,
          params: parsedDefs.length > 0 ? parsedDefs : undefined,
          paramValues: parsedDefs.length > 0 ? paramValues : undefined,
        };

        // Snapshot the first rendered frame as a thumbnail. Best-effort —
        // failures (cross-origin, no canvas, slow first frame) fall back
        // to no thumbnail, same as the AI-gen path.
        let thumbnail: string | undefined;
        try { thumbnail = await captureJSAnimationThumbnail(htmlCode); }
        catch { /* leave undefined */ }

        const jsItem: JSAnimationItem = {
          id: generateUUID(),
          name: baseName,
          type: animationType,
          jsAnimation,
          thumbnail,
        };
        jsAnimations = [...jsAnimations, jsItem];
        activeTab = 'js';
      } catch (err) {
        console.error('[MediaTray] failed to import .html as Three.js animation:', err);
      }
    }
  }

  /**
   * Extract a balanced object-or-array literal from `html` starting after
   * the first match of `pattern`. Handles nested brackets (e.g. a defs
   * array whose entries contain `default: [0.4, 0.7, 1.0]`) and strings
   * with brackets inside them. Returns the literal text including its
   * outer brackets, or null when no match / unbalanced.
   *
   * Why this exists: the original regex match `\[[\s\S]*?\]` is non-
   * greedy and stops at the FIRST closing bracket, so a color default
   * like `[0.4, 0.7, 1.0]` truncates the entire defs array and the
   * caller falls back to "no params" — exactly the user-visible bug we
   * just hit with the Embryo defaults.
   */
  function extractBracketedAfter(html: string, pattern: RegExp): string | null {
    const m = html.match(pattern);
    if (!m || m.index === undefined) return null;
    let i = m.index + m[0].length;
    while (i < html.length && /\s/.test(html[i])) i++;
    if (i >= html.length) return null;
    const open = html[i];
    if (open !== '[' && open !== '{') return null;
    const close = open === '[' ? ']' : '}';
    let depth = 0;
    let inStr = false;
    let strCh = '';
    for (let j = i; j < html.length; j++) {
      const c = html[j];
      if (inStr) {
        if (c === '\\') { j++; continue; }
        if (c === strCh) inStr = false;
      } else {
        if (c === '"' || c === "'" || c === '`') { inStr = true; strCh = c; }
        else if (c === open) depth++;
        else if (c === close) {
          depth--;
          if (depth === 0) return html.slice(i, j + 1);
        }
      }
    }
    return null;
  }

  function parseShaderParamDefs(html: string): Array<{
    name: string;
    type: 'number' | 'boolean' | 'color';
    default: number | boolean | number[];
    min?: number;
    max?: number;
    label?: string;
  }> {
    const lit = extractBracketedAfter(html, /window\.shaderParamDefs\s*=\s*/);
    if (!lit) return [];
    try {
      const arr = new Function('return ' + lit)();
      if (!Array.isArray(arr)) return [];
      return arr.filter(d => d && typeof d.name === 'string' && d.type).map(d => ({
        name: String(d.name),
        type: d.type as 'number' | 'boolean' | 'color',
        default: d.default,
        min: typeof d.min === 'number' ? d.min : undefined,
        max: typeof d.max === 'number' ? d.max : undefined,
        label: typeof d.label === 'string' ? d.label : d.name,
      }));
    } catch (err) {
      console.warn('[MediaTray] failed to parse shaderParamDefs:', err);
      return [];
    }
  }

  function parseShaderParamValues(html: string): Record<string, number | boolean | number[]> {
    const lit = extractBracketedAfter(html, /window\.shaderParams\s*=\s*/);
    if (!lit) return {};
    try {
      const obj = new Function('return ' + lit)();
      return (obj && typeof obj === 'object') ? obj : {};
    } catch {
      return {};
    }
  }

  /**
   * Mount the HTML in a hidden iframe long enough to capture the first
   * frame as a 160×90 JPEG thumbnail. Cleans up the iframe after. Fails
   * silently on cross-origin / no-canvas / slow-load.
   */
  async function captureJSAnimationThumbnail(html: string): Promise<string | undefined> {
    return new Promise((resolve) => {
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:320px;height:180px;border:none;';
      iframe.src = url;
      document.body.appendChild(iframe);

      const finish = (out: string | undefined) => {
        try { document.body.removeChild(iframe); } catch {}
        URL.revokeObjectURL(url);
        resolve(out);
      };

      // Give the scene up to 2.5s to produce its first frame. Most
      // Three.js / p5 sketches paint within 100ms; raymarchers can take
      // longer. Capped so import doesn't stall the UI thread.
      setTimeout(() => {
        try {
          const doc = iframe.contentDocument || iframe.contentWindow?.document;
          const canvasEl = doc?.querySelector('canvas') as HTMLCanvasElement | null;
          if (!canvasEl || canvasEl.width === 0) return finish(undefined);
          const thumb = document.createElement('canvas');
          thumb.width = 160; thumb.height = 90;
          const ctx = thumb.getContext('2d');
          if (!ctx) return finish(undefined);
          ctx.drawImage(canvasEl, 0, 0, thumb.width, thumb.height);
          finish(thumb.toDataURL('image/jpeg', 0.7));
        } catch {
          finish(undefined);
        }
      }, 2000);
    });
  }

  async function captureVideoThumbnail(video: HTMLVideoElement): Promise<string> {
    return new Promise((resolve) => {
      const capture = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 120;
        canvas.height = 68;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.7));
        } else {
          resolve('');
        }
      };

      // If video already has frame data, capture immediately or after seek
      if (video.readyState >= 2) {
        video.currentTime = 0.1;
        video.onseeked = capture;
        // Fallback if seek doesn't fire (e.g. already at that time or blob not seekable)
        setTimeout(() => {
          video.onseeked = null;
          capture();
        }, 1000);
      } else {
        // Video not loaded yet - wait for it, then capture current frame
        video.onloadeddata = () => capture();
        setTimeout(() => resolve(''), 3000); // Ultimate fallback
      }
    });
  }

  function getTargetMediaLayerIds(): string[] {
    const multiSelectionValid =
      !!$selectedLayerId &&
      $selectedLayerIds.length > 0 &&
      $selectedLayerIds.includes($selectedLayerId);
    const selectedIds = multiSelectionValid
      ? $selectedLayerIds
      : ($selectedLayerId ? [$selectedLayerId] : []);
    return selectedIds.filter((id) => $layers.some((l) => l.id === id && (l.type === 'media' || l.type === 'screen' || l.type === 'group')));
  }

  async function applySourceToTargetMediaLayers(
    applyToLayerId: (layerId: string) => Promise<void> | void
  ) {
    const targetIds = getTargetMediaLayerIds();
    if (targetIds.length === 0) {
      alert('Please select one or more media layers first');
      return;
    }
    for (const layerId of targetIds) {
      await applyToLayerId(layerId);
    }
  }

  // Apply media to selected layer
  async function applyToLayer(item: MediaItem | ShaderItem | JSAnimationItem) {
    if ('jsAnimation' in item) {
      // It's a JS animation - delegate to the specialized function
      applyJSAnimationToLayer(item);
    } else if ('shaderCode' in item) {
      // It's a shader
      await applySourceToTargetMediaLayers((layerId) => {
        const imageInputRefs: Record<string, ImageInputRef> = {};
        for (const [name, ref] of Object.entries(item.imageInputRefs)) {
          if (ref) imageInputRefs[name] = ref;
        }

        const source: MediaSource = {
          id: `${item.id}-${layerId}-${Date.now()}`,
          type: 'shader',
          src: item.src,
          name: item.name,
          shaderCode: item.shaderCode,
          shaderInputs: item.inputs,
          shaderValues: { ...item.values },
          shaderImageInputs: imageInputRefs,
        };
        project.setLayerSource(layerId, source);

        // Auto-set medium render quality for extreme (XL) shaders
        if (item.loadRating?.shortLabel === 'XL') {
          project.setRenderQuality(layerId, 0.5);
        }
      });
      selectedShader = item;
    } else {
      // It's a video or image
      await applySourceToTargetMediaLayers(async (layerId) => {
        const source: MediaSource = {
          id: `${item.id}-${layerId}-${Date.now()}`,
          type: item.type,
          src: item.src,
          name: item.name,
          // Carry the library item's AssetRef onto the layer so save+reload
          // can find the original disk file. Without this the layer ends up
          // with a dead blob: URL by save time and reload comes back empty.
          _assetRef: (item as any)._assetRef,
        };

        if (item.type === 'video' && item.videoElement) {
          // Reuse the library item's existing <video> element. Pre-fix:
          // each apply-to-layer click made a fresh element + fresh load,
          // racing 4+ in-flight loads on rapid back-and-forth and stuck
          // textures on garbage frames. Reusing makes apply-A → apply-B
          // → apply-A a near-instant texture swap.
          const video = item.videoElement;
          // Pause whatever video was previously bound to this layer so
          // it doesn't keep decoding in the background. The decoder
          // budget is shared across all <video> elements; a stack of
          // "still playing but offscreen" clips thrashes the GPU.
          const prevLayer = $project.layers.find((l) => l.id === layerId);
          const prevVideo = (prevLayer?.source as any)?.videoElement as HTMLVideoElement | undefined;
          if (prevVideo && prevVideo !== video) {
            try { prevVideo.pause(); } catch { /* ignore */ }
          }
          video.loop = true;
          video.muted = true;
          video.playsInline = true;
          video.preload = 'auto';
          // Restart from frame 0 on every apply — VJ semantics: clicking
          // a clip means "play this clip from the top", not "resume from
          // wherever it was last paused".
          try { video.currentTime = 0; } catch { /* ignore */ }

          if (video.readyState < 2) {
            await new Promise<void>((resolve) => {
              const done = () => { cleanup(); resolve(); };
              const cleanup = () => {
                video.removeEventListener('loadeddata', done);
                video.removeEventListener('canplaythrough', done);
              };
              video.addEventListener('loadeddata', done, { once: true });
              video.addEventListener('canplaythrough', done, { once: true });
            });
          }

          if (video.paused) {
            try {
              await video.play();
              await new Promise(resolve => requestAnimationFrame(resolve));
            } catch (e) {
              if ((e as DOMException)?.name !== 'AbortError') {
                console.warn('Video autoplay blocked:', e);
              }
            }
          }

          source.videoElement = video;
          source.isPlaying = !video.paused;
        }

        project.setLayerSource(layerId, source);
      });
      selectedShader = null;
    }
  }

  // Set video playback mode on the current layer
  function setPlaybackMode(mode: VideoPlaybackMode) {
    if (!$selectedLayerId || !$selectedLayer?.source) return;
    const source = $selectedLayer.source;
    if (source.type !== 'video') return;
    source.playbackMode = mode;
    // Stop timelapse when switching away
    if (mode !== 'timelapse') {
      stopTimelapse();
    }
    project.setLayerSource($selectedLayerId, { ...source });
  }

  // Get the current playback mode for the selected layer
  $: currentPlaybackMode = $selectedLayer?.source?.type === 'video'
    ? ($selectedLayer.source.playbackMode || 'loop')
    : 'loop';

  // ---- Timelapse state ----
  let timelapseInterval: number = 5; // seconds between frames
  let timelapseTimerId: ReturnType<typeof setInterval> | null = null;
  let timelapseState: 'idle' | 'running' | 'paused' = 'idle';
  let timelapseCurrentFrame: number = 0;
  let timelapseTotalFrames: number = 0;
  let showTimelapsePopover: string | null = null;
  let timelapsePopoverPos = { x: 0, y: 0 };
  const ASSUMED_FPS = 30; // assumed fps for frame calculation

  function toggleTimelapsePopover(itemId: string, e: MouseEvent) {
    e.stopPropagation();
    if (showTimelapsePopover === itemId) {
      showTimelapsePopover = null;
      return;
    }
    const btn = e.currentTarget as HTMLElement;
    const rect = btn.getBoundingClientRect();
    timelapsePopoverPos = {
      x: rect.left + rect.width / 2,
      y: rect.top - 8,
    };

    // Calculate total frames from the video element
    const source = $selectedLayer?.source;
    if (source?.videoElement) {
      const vid = source.videoElement;
      const dur = vid.duration || 0;
      timelapseTotalFrames = Math.max(1, Math.floor(dur * ASSUMED_FPS));
      // Set current frame from currentTime
      timelapseCurrentFrame = Math.floor(vid.currentTime * ASSUMED_FPS);
    }

    showTimelapsePopover = itemId;
  }

  function startTimelapse() {
    if (!$selectedLayerId || !$selectedLayer?.source) return;
    const source = $selectedLayer.source;
    if (source.type !== 'video' || !source.videoElement) return;

    const vid = source.videoElement;
    vid.pause();

    // Set mode to timelapse
    source.playbackMode = 'timelapse';
    source.timelapseInterval = timelapseInterval;
    source.timelapseRunning = true;

    const dur = vid.duration || 0;
    timelapseTotalFrames = Math.max(1, Math.floor(dur * ASSUMED_FPS));

    // If resuming from pause, keep current frame; otherwise start from 0
    if (timelapseState !== 'paused') {
      timelapseCurrentFrame = 0;
      vid.currentTime = 0;
    }

    project.setLayerSource($selectedLayerId, { ...source });

    // Clear any existing timer
    if (timelapseTimerId) clearInterval(timelapseTimerId);

    // Step one frame immediately, then on interval
    timelapseState = 'running';
    timelapseTimerId = setInterval(() => {
      stepTimelapseFrame();
    }, timelapseInterval * 1000);
  }

  function stepTimelapseFrame() {
    if (!$selectedLayerId || !$selectedLayer?.source) return;
    const source = $selectedLayer.source;
    if (source.type !== 'video' || !source.videoElement) return;

    const vid = source.videoElement;
    const dur = vid.duration || 0;
    const frameDuration = 1 / ASSUMED_FPS;

    timelapseCurrentFrame++;
    const newTime = timelapseCurrentFrame * frameDuration;

    if (newTime >= dur) {
      // Reached the end
      stopTimelapse();
      return;
    }

    vid.currentTime = newTime;
    // Force texture update
    if (source.texture) {
      (source.texture as THREE.VideoTexture).needsUpdate = true;
    }
  }

  function pauseTimelapse() {
    if (timelapseTimerId) {
      clearInterval(timelapseTimerId);
      timelapseTimerId = null;
    }
    timelapseState = 'paused';
    if ($selectedLayerId && $selectedLayer?.source) {
      const source = $selectedLayer.source;
      source.timelapseRunning = false;
      project.setLayerSource($selectedLayerId, { ...source });
    }
  }

  function stopTimelapse() {
    if (timelapseTimerId) {
      clearInterval(timelapseTimerId);
      timelapseTimerId = null;
    }
    timelapseState = 'idle';
    timelapseCurrentFrame = 0;
    if ($selectedLayerId && $selectedLayer?.source) {
      const source = $selectedLayer.source;
      source.timelapseRunning = false;
      source._timelapseFrame = 0;
      project.setLayerSource($selectedLayerId, { ...source });
    }
  }

  // Click-outside handler for popovers
  function handleGlobalClick(e: MouseEvent) {
    // Close timelapse popover if clicking outside it (only when idle or stopped)
    if (showTimelapsePopover) {
      const target = e.target as HTMLElement;
      if (!target.closest('.timelapse-popover') && !target.closest('.mode-btn')) {
        // If timelapse is idle, close the popover
        if (timelapseState === 'idle') {
          showTimelapsePopover = null;
        }
      }
    }
    // Close loop popover if clicking outside it
    if (showLoopOptions) {
      const target = e.target as HTMLElement;
      if (!target.closest('.loop-options-popover') && !target.closest('.loop-btn')) {
        showLoopOptions = null;
      }
    }
    if (contextMenuOpen || folderContextMenuOpen) {
      const target = e.target as HTMLElement;
      if (!target.closest('.tray-context-menu')) {
        closeTrayContextMenu();
        closeFolderContextMenu();
      }
    }
  }

  // Register/cleanup global click listener
  onMount(() => {
    // Use setTimeout to avoid registering during the same click that opens a popover
    const id = setTimeout(() => {
      document.addEventListener('click', handleGlobalClick);
    }, 0);

    // Dev-only: Ctrl+Shift+G generates all shader thumbnails and saves as JPGs
    const handleDevKeydown = async (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'G') {
        e.preventDefault();
        await generateAndSaveAllThumbnails();
      }
    };
    document.addEventListener('keydown', handleDevKeydown);

    return () => {
      clearTimeout(id);
      document.removeEventListener('click', handleGlobalClick);
      document.removeEventListener('keydown', handleDevKeydown);
    };
  });

  onDestroy(() => {
    document.removeEventListener('click', handleGlobalClick);
    if (timelapseTimerId) clearInterval(timelapseTimerId);
  });

  /**
   * Dev utility: Generate thumbnails for ALL shaders and save as JPGs via Tauri.
   * Triggered by Ctrl+Shift+G. Downloads a zip or saves individually via Tauri IPC.
   */
  async function generateAndSaveAllThumbnails() {
    if (!shaders || shaders.length === 0) {
      console.warn('[Thumbnails] No shaders loaded yet');
      return;
    }

    console.log(`[Thumbnails] Generating ${shaders.length} thumbnails...`);
    let saved = 0;
    let failed = 0;

    for (const shader of shaders) {
      try {
        const baseName = shader.src.split('/').pop()?.replace('.fs', '') || shader.name;
        const dataUrl = await generateShaderThumbnail(shader.shaderCode, 0.5);

        // Convert data URL to binary
        const base64Data = dataUrl.split(',')[1];
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        // Try to save via desktop IPC to the public/ISF/thumbnails directory
        try {
          // Use window location to determine the project's public dir (dev server serves from public/)
          // In dev mode, the dev server serves from the project root's public/ directory
          const dirPath = 'C:/Users/justi/OneDrive/Documents/001RISKCAPITAL/CustomPlugins/ghost-arcade/public/ISF/thumbnails';
          await bridgeInvoke('save_shader_thumbnail', {
            dirPath,
            filename: `${baseName}.jpg`,
            data: Array.from(bytes),
          });
          saved++;
        } catch (desktopErr) {
          console.warn('[Thumbnails] Desktop save failed, trying browser download:', desktopErr);
          // Fallback: trigger browser download
          const blob = new Blob([bytes], { type: 'image/jpeg' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${baseName}.jpg`;
          a.click();
          URL.revokeObjectURL(url);
          saved++;
        }

        if (saved % 10 === 0) {
          console.log(`[Thumbnails] Progress: ${saved}/${shaders.length}`);
        }

        // Small delay to not overwhelm GPU
        await new Promise(r => setTimeout(r, 100));
      } catch (err) {
        console.warn(`[Thumbnails] Failed for ${shader.name}:`, err);
        failed++;
      }
    }

    // Generate manifest.json for the pre-generated thumbnails
    const manifest: Record<string, string> = {};
    for (const shader of shaders) {
      const baseName = shader.src.split('/').pop()?.replace('.fs', '') || shader.name;
      manifest[baseName] = `${baseName}.jpg`;
    }

    try {
      const dirPath = 'C:/Users/justi/OneDrive/Documents/001RISKCAPITAL/CustomPlugins/ghost-arcade/public/ISF/thumbnails';
      const manifestJson = JSON.stringify({ thumbnails: manifest }, null, 2);
      const manifestBytes = new TextEncoder().encode(manifestJson);
      await bridgeInvoke('save_shader_thumbnail', {
        dirPath,
        filename: 'manifest.json',
        data: Array.from(manifestBytes),
      });
      console.log('[Thumbnails] Saved manifest.json');
    } catch (e) {
      console.warn('[Thumbnails] Failed to save manifest.json:', e);
    }

    console.log(`[Thumbnails] Done! Saved: ${saved}, Failed: ${failed}`);
  }

  // Shader param modulation — cached layer index, shared helpers from modulation.ts
  $: selectedLayerIdx = $layers.findIndex(l => l.id === $selectedLayerId);

  // Reactive subscription so the panel re-renders when a mod
  // is added / changed. getShaderModulation READS DIRECTLY from
  // this reactive map (not via modulationStore.getModulation
  // which is a snapshot read) — that's the only way Svelte's
  // template tracking sees the call as a dependency on the store.
  $: mappingModMap = $modulationStore;

  function getShaderModulation(paramName: string): ParamModulation | undefined {
    if (selectedLayerIdx < 0) return undefined;
    // Target='mapping' — these mods write to project.layers[i].source.shaderValues
    // via the mapping updater, not VJ deck slots.
    return mappingModMap.get(modKeyShader(selectedLayerIdx, paramName, 'A', 'mapping'));
  }

  /** Read the current Auto config for a mapping-mode shader param,
   *  reading from the live layer source so Svelte tracks the
   *  dependency from template `{@const}` sites. */
  function getMappingShaderAuto(paramName: string): import('../types').AutoConfig | undefined {
    if (!$selectedLayer?.source) return undefined;
    return $selectedLayer.source.shaderValueAuto?.[paramName];
  }

  /** Update one field on a mapping-mode shader param's Auto config.
   *  Writes through project.setShaderValueAuto so the sidecar rides
   *  with the layer and the autoEngine animates it. */
  function setMappingAutoField<K extends keyof import('../types').AutoConfig>(
    paramName: string,
    field: K,
    value: import('../types').AutoConfig[K],
  ) {
    if (!$selectedLayerId) return;
    const cur = getMappingShaderAuto(paramName);
    if (!cur) return;
    project.setShaderValueAuto($selectedLayerId, paramName, { ...cur, [field]: value });
  }

  /** Source-change handler for mapping-mode shader params. Splits
   *  Auto onto the sidecar path; everything else stays on the audio
   *  modulation store. */
  function setMappingShaderSource(paramName: string, source: ModSource, paramMin: number, paramMax: number) {
    if (!$selectedLayerId) return;
    if (source === 'auto') {
      const existingMod = selectedLayerIdx >= 0
        ? modulationStore.getModulation(selectedLayerIdx, paramName, 'A', 'mapping')
        : undefined;
      if (existingMod && existingMod.source !== 'manual') {
        setParamModSource(selectedLayerIdx, paramName, 'manual', 'A', 'mapping');
      }
      const existingAuto = getMappingShaderAuto(paramName);
      project.setShaderValueAuto(
        $selectedLayerId,
        paramName,
        existingAuto ?? { phase: 0, mode: 'loop', speedHz: 0.15, min: paramMin, max: paramMax, playing: true }
      );
      return;
    }
    // Switching away from Auto — clear the sidecar.
    if (getMappingShaderAuto(paramName)) {
      project.setShaderValueAuto($selectedLayerId, paramName, null);
    }
    if (selectedLayerIdx >= 0) {
      setParamModSource(selectedLayerIdx, paramName, source, 'A', 'mapping');
    }
  }

  /** Reset every shader param on the open shader to its catalog
   *  default. Also clears any active modulation so the
   *  modulation engine doesn't immediately overwrite the values
   *  we just snapped back. */
  function resetMappingShaderToDefaults() {
    if (!selectedShader || selectedLayerIdx < 0) return;
    for (const input of selectedShader.inputs) {
      const existingMod = modulationStore.getModulation(selectedLayerIdx, input.NAME, 'A', 'mapping');
      if (existingMod && existingMod.source !== 'manual') {
        setParamModSource(selectedLayerIdx, input.NAME, 'manual', 'A', 'mapping');
      }
      // Clear Auto sidecar so the playhead stops driving the value
      // we're about to snap back.
      if ($selectedLayerId && $selectedLayer?.source?.shaderValueAuto?.[input.NAME]) {
        project.setShaderValueAuto($selectedLayerId, input.NAME, null);
      }
      if (input.DEFAULT === undefined || input.DEFAULT === null) continue;
      if (input.TYPE === 'float' || input.TYPE === 'long') {
        if (typeof input.DEFAULT === 'number') {
          updateShaderParam(input.NAME, input.DEFAULT);
        }
      } else if (input.TYPE === 'bool') {
        if (typeof input.DEFAULT === 'boolean') {
          updateShaderParam(input.NAME, input.DEFAULT);
        }
      }
    }
  }

  // Update shader parameter value
  function updateShaderParam(inputName: string, value: number | boolean | number[]) {
    if (!selectedShader || !$selectedLayerId || !$selectedLayer?.source) return;

    selectedShader.values[inputName] = value;

    // Update the layer source
    const source = $selectedLayer.source;
    if (source.shaderValues) {
      source.shaderValues[inputName] = value;
      project.setLayerSource($selectedLayerId, { ...source });
    }

    // Keep modulation base value in sync with slider (mapping mode)
    if (typeof value === 'number' && selectedLayerIdx >= 0) {
      setBaseValue(selectedLayerIdx, inputName, value);
    }

    // Auto-keyframe: if this track is armed, record a keyframe at the current playhead
    if (typeof value === 'number' || typeof value === 'boolean') {
      const trackKey = `shader:${inputName}`;
      const label = selectedShader.inputs?.find(i => i.NAME === inputName)?.LABEL || inputName;
      console.log('[KF MediaTray] autoRecord call: layerId=', $selectedLayerId, 'trackKey=', trackKey, 'value=', value);
      keyframeTimeline.autoRecord($selectedLayerId, trackKey, value, label, typeof value === 'boolean' ? 'boolean' : 'number');
    }
  }

  // Update shader image input reference
  function updateShaderImageInput(inputName: string, ref: ImageInputRef | null) {
    if (!selectedShader || !$selectedLayerId || !$selectedLayer?.source) return;

    selectedShader.imageInputRefs[inputName] = ref;

    // Proactively load texture for media items so it's ready when the render loop needs it
    if (ref && ref.type === 'media') {
      const mediaItem = $mediaLibrary.find(m => m.id === ref.id);
      if (mediaItem && !mediaItem.texture) {
        console.log('[Shader Image Input] Proactively loading texture for:', mediaItem.name);
        if (mediaItem.type === 'image') {
          const loader = new THREE.TextureLoader();
          loader.load(
            mediaItem.src,
            (texture) => {
              texture.minFilter = THREE.LinearFilter;
              texture.magFilter = THREE.LinearFilter;
              texture.needsUpdate = true;
              console.log('[Shader Image Input] Texture preloaded for:', mediaItem.name);
              mediaLibrary.setTexture(mediaItem.id, texture);
            },
            undefined,
            (err) => {
              console.error('[Shader Image Input] Failed to preload texture:', mediaItem.name, err);
            }
          );
        } else if (mediaItem.type === 'video' && mediaItem.videoElement) {
          const videoTex = new THREE.VideoTexture(mediaItem.videoElement);
          videoTex.minFilter = THREE.LinearFilter;
          videoTex.magFilter = THREE.LinearFilter;
          console.log('[Shader Image Input] Video texture created for:', mediaItem.name);
          mediaLibrary.setTexture(mediaItem.id, videoTex);
        }
      }
    }

    // Update the layer source
    const source = $selectedLayer.source;
    if (!source.shaderImageInputs) {
      source.shaderImageInputs = {};
    }

    if (ref) {
      source.shaderImageInputs[inputName] = ref;
    } else {
      delete source.shaderImageInputs[inputName];
    }

    project.setLayerSource($selectedLayerId, { ...source });
  }

  function removeItem(item: MediaItem | ShaderItem | JSAnimationItem) {
    if ('jsAnimation' in item) {
      // It's a JS animation
      removeJSAnimation(item.id);
    } else if ('shaderCode' in item) {
      // If it's a manifest shader (ISF path), persist to hidden list
      if (item.src.startsWith('./ISF') || item.src.startsWith('/ISF')) {
        hiddenShaders.add(item.id);
        hiddenShaders = hiddenShaders;
        localStorage.setItem(HIDDEN_SHADERS_KEY, JSON.stringify([...hiddenShaders]));
      }
      shaders = shaders.filter(s => s.id !== item.id);
      if (item.src.startsWith('blob:')) {
        URL.revokeObjectURL(item.src);
      }
    } else {
      mediaLibrary.removeItem(item.id);
    }
  }

  async function handleLibraryAdd(event: CustomEvent) {
    const entries = event.detail as Array<{ file: string; tier?: string; category?: string; defaults?: Record<string, any> }>;
    showShaderLibrary = false;

    for (const entry of entries) {
      const shaderId = `isf:${entry.file}`;
      // Remove from hidden list if previously hidden
      if (hiddenShaders.has(shaderId)) {
        hiddenShaders.delete(shaderId);
        localStorage.setItem(HIDDEN_SHADERS_KEY, JSON.stringify([...hiddenShaders]));
      }
      // Skip if already loaded
      if (shaders.some(s => s.id === shaderId)) continue;

      try {
        const encodedPath = entry.file.split('/').map(encodeURIComponent).join('/');
        const response = await fetch(`./ISF/${encodedPath}`);
        const shaderCode = await response.text();
        const parsed = parseISF(shaderCode);

        const shaderItem: ShaderItem = {
          id: shaderId,
          name: entry.file.replace('.fs', '').replace('DM-', '').replace('SM-', '').replace('AR-', ''),
          src: `./ISF/${encodedPath}`,
          shaderCode,
          inputs: parsed.metadata.INPUTS as ISFInputDef[],
          values: {},
          imageInputRefs: {},
          description: parsed.metadata.DESCRIPTION,
          tier: (entry.tier as 'demo' | 'starter' | 'pro') || 'demo',
          category: entry.category || '',
        };
        shaderItem.loadRating = getShaderLoadRating(shaderItem.shaderCode, shaderItem.inputs.length);

        for (const input of shaderItem.inputs) {
          if (input.TYPE === 'image') {
            shaderItem.imageInputRefs[input.NAME] = null;
          } else {
            const manifestDefault = entry.defaults?.[input.NAME];
            shaderItem.values[input.NAME] = manifestDefault !== undefined
              ? manifestDefault
              : getInputDefault(input) as number | boolean | number[];
          }
        }

        shaders = [...shaders, shaderItem];
      } catch (err) {
        console.error(`Failed to load shader ${entry.file}:`, err);
      }
    }

    // Update cache
    shaderCache.shaders = shaders;
    // Generate thumbnails for newly added shaders
    generateMissingThumbnails();
  }

  // Create a seamless loop from a video
  async function createLoopFromVideo(item: MediaItem) {
    if (loopingVideoId) return; // Already processing
    if (item.type !== 'video') return;

    loopingVideoId = item.id;
    showLoopOptions = null;
    loopProgress = { stage: 'loading', progress: 0, message: 'Initializing...' };

    try {
      const loopedUrl = await createLoop(item.src, loopCrossfadeDuration, (progress) => {
        loopProgress = progress;
      }, loopTransitionType);

      // Create a new video element for the looped version
      const video = document.createElement('video');
      video.crossOrigin = 'anonymous';
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.src = loopedUrl;

      // `.src=` already initiated the load — don't call `.load()`.
      await new Promise<void>((resolve) => {
        const done = () => { video.removeEventListener('loadeddata', done); resolve(); };
        video.addEventListener('loadeddata', done, { once: true });
        if (video.readyState >= 2) done();
      });

      // Persist the generated loop once so project save/reload has a real
      // disk-backed AssetRef instead of a session-only blob URL.
      const baseName = item.name.replace(/\.[^/.]+$/, ''); // Remove extension
      const generatedName = `${baseName} (Loop).mp4`;
      let loopBlob: Blob | null = null;
      let loopAssetRef: any = undefined;
      try {
        const resp = await fetch(loopedUrl);
        loopBlob = await resp.blob();
        const captured = await createAssetRefFromGeneratedBlob(
          loopBlob,
          generatedName,
          loopBlob.type || 'video/mp4',
          loopedUrl,
        );
        loopAssetRef = captured.assetRef;
      } catch (err) {
        console.warn('[Loop] Failed to persist generated loop asset:', err);
      }

      // Add to media library with "(Loop)" suffix
      const newItem: MediaItem = {
        id: generateUUID(),
        name: generatedName,
        src: loopedUrl,
        type: 'video',
        videoElement: video,
        thumbnail: await captureVideoThumbnail(video),
        _assetRef: loopAssetRef,
      };

      mediaLibrary.addItem(newItem);

      // Save loop video to disk (same recordings folder as output recording)
      try {
        if (!loopBlob) {
          const resp = await fetch(loopedUrl);
          loopBlob = await resp.blob();
        }
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const safeName = baseName.replace(/[^a-zA-Z0-9_\- ]/g, '').trim().replace(/\s+/g, '_');
        await downloadRecording(loopBlob, `Loop_${safeName}_${timestamp}.mp4`);
      } catch (err) {
        console.warn('[Loop] Disk save failed (non-fatal):', err);
      }

      loopProgress = { stage: 'complete', progress: 1, message: 'Loop created & saved!' };

      // Clear progress after a short delay
      setTimeout(() => {
        loopingVideoId = null;
        loopProgress = null;
      }, 1500);

    } catch (error) {
      console.error('Failed to create loop:', error);
      loopProgress = { stage: 'error', progress: 0, message: 'Failed to create loop' };

      setTimeout(() => {
        loopingVideoId = null;
        loopProgress = null;
      }, 3000);
    }
  }

  $: currentItems = activeTab === 'videos' ? videos : activeTab === 'images' ? images : activeTab === 'js' ? filteredJSAnimations : filteredByCategory;
  $: mediaFolders = Array.isArray($project.mediaFolders)
    ? $project.mediaFolders
      .filter((f) => FOLDER_TABS.includes(f.tab as FolderTab))
      .map((f) => ({ ...f, itemIds: Array.from(new Set(f.itemIds || [])) }))
    : [];
  $: activeTabFolders = FOLDER_TABS.includes(activeTab as FolderTab)
    ? mediaFolders.filter(f => f.tab === activeTab)
    : [];
  $: if (activeFolderId && !activeTabFolders.some(f => f.id === activeFolderId)) {
    activeFolderId = null;
  }
  $: activeFolder = activeFolderId
    ? activeTabFolders.find(f => f.id === activeFolderId) || null
    : null;
  $: activeFolderItems = activeFolder
    ? currentItems.filter(item => activeFolder.itemIds.includes(item.id))
    : [];
  $: isFolderTab = FOLDER_TABS.includes(activeTab as FolderTab);
  $: mediaSections = (() => {
    // Shader tab with active folder: show only folder items, no duplicate "All Clips"
    if (activeTab === 'shaders' && activeFolderId && activeFolder) {
      return [{
        id: `folder-${activeFolder.id}`,
        label: activeFolder.name,
        items: currentItems, // already filtered by folder in filteredByCategory
        kind: 'folder' as const,
      }];
    }
    // Shader tab without folder: just show filtered items (by category or all)
    if (activeTab === 'shaders') {
      return [{
        id: 'all-clips',
        label: shaderCategoryFilter || 'All Shaders',
        items: currentItems,
        kind: 'all' as const,
      }];
    }
    // Other tabs (videos, images) with folder system
    if (isFolderTab && activeFolder) {
      return [
        {
          id: `folder-${activeFolder.id}`,
          label: `Folder: ${activeFolder.name}`,
          items: activeFolderItems,
          kind: 'folder' as const,
        },
        {
          id: 'all-clips',
          label: 'All Clips',
          items: currentItems,
          kind: 'all' as const,
        },
      ];
    }
    return [{
      id: 'all-clips',
      label: 'All Clips',
      items: currentItems,
      kind: 'all' as const,
    }];
  })();
  $: if (shaders.length > 0) {
    ensureDefaultShaderFolders();
  }

  // Filtered JS animations based on filter
  $: filteredJSAnimations = jsFilter === 'all'
    ? jsAnimations
    : jsAnimations.filter(a => a.type === jsFilter);

  function getVisibleItemsForSelection() {
    return currentItems;
  }

  function handleTrayItemClick(itemId: string, e: MouseEvent, apply: () => void) {
    const visible = getVisibleItemsForSelection();
    const index = visible.findIndex(i => i.id === itemId);
    const isToggle = e.ctrlKey || e.metaKey;
    const isShift = e.shiftKey;

    if (isShift && lastTraySelectIndex !== null && index >= 0) {
      const start = Math.min(lastTraySelectIndex, index);
      const end = Math.max(lastTraySelectIndex, index);
      const range = visible.slice(start, end + 1).map(i => i.id);
      selectedTrayItemIds = isToggle
        ? Array.from(new Set([...selectedTrayItemIds, ...range]))
        : range;
      return;
    }

    if (isToggle) {
      selectedTrayItemIds = selectedTrayItemIds.includes(itemId)
        ? selectedTrayItemIds.filter(id => id !== itemId)
        : [...selectedTrayItemIds, itemId];
      lastTraySelectIndex = index >= 0 ? index : lastTraySelectIndex;
      return;
    }

    selectedTrayItemIds = [itemId];
    lastTraySelectIndex = index >= 0 ? index : null;
    apply();
  }

  function openTrayContextMenu(itemId: string, e: MouseEvent) {
    e.preventDefault();
    const inSelection = selectedTrayItemIds.includes(itemId);
    if (!inSelection) {
      selectedTrayItemIds = [itemId];
    }
    const estimatedWidth = 220;
    const estimatedHeight = 52 + Math.max(0, activeTabFolders.length) * 34;
    const margin = 8;
    contextMenuOpen = true;
    contextMenuX = Math.min(e.clientX, window.innerWidth - estimatedWidth - margin);
    contextMenuY = Math.min(e.clientY, window.innerHeight - estimatedHeight - margin);
  }

  function closeTrayContextMenu() {
    contextMenuOpen = false;
  }

  function assignItemsToFolder(folderId: string, itemIds: string[]) {
    const targetIds = Array.from(new Set(itemIds));
    const nextFolders = mediaFolders.map(folder =>
      folder.id === folderId
        ? { ...folder, itemIds: Array.from(new Set([...folder.itemIds, ...targetIds])) }
        : folder
    );
    project.setMediaFolders(nextFolders);
    closeTrayContextMenu();
  }

  function removeItemsFromFolder(folderId: string, itemIds: string[]) {
    const removeSet = new Set(itemIds);
    const nextFolders = mediaFolders.map(folder =>
      folder.id === folderId
        ? { ...folder, itemIds: folder.itemIds.filter(id => !removeSet.has(id)) }
        : folder
    );
    project.setMediaFolders(nextFolders);
    closeTrayContextMenu();
  }

  function renameFolder(folderId: string) {
    const folder = mediaFolders.find(f => f.id === folderId);
    if (!folder) return;
    folderInputMode = 'rename';
    folderInputValue = folder.name;
    folderInputTargetId = folderId;
    closeFolderContextMenu();
  }

  function deleteFolder(folderId: string) {
    const folder = mediaFolders.find(f => f.id === folderId);
    if (!folder) return;
    const nextFolders = mediaFolders.filter(f => f.id !== folderId);
    project.setMediaFolders(nextFolders);
    if (activeFolderId === folderId) activeFolderId = null;
    closeTrayContextMenu();
  }

  // Inline rename/create input state
  let folderInputMode: 'create' | 'rename' | null = null;
  let folderInputValue = '';
  let folderInputTargetId: string | null = null;

  // Folder drag reorder state
  let draggedFolderIndex: number | null = null;
  let dragOverFolderIndex: number | null = null;

  function handleFolderReorder(targetIndex: number) {
    if (draggedFolderIndex === null || draggedFolderIndex === targetIndex) return;
    const tabFolders = activeTabFolders;
    const otherFolders = mediaFolders.filter(f => f.tab !== activeTab);
    const reordered = [...tabFolders];
    const [moved] = reordered.splice(draggedFolderIndex, 1);
    reordered.splice(targetIndex, 0, moved);
    project.setMediaFolders([...otherFolders, ...reordered]);
    draggedFolderIndex = null;
    dragOverFolderIndex = null;
  }

  // Folder chip context menu state
  let folderContextMenuOpen = false;
  let folderContextMenuX = 0;
  let folderContextMenuY = 0;
  let folderContextMenuId: string | null = null;

  function openFolderContextMenu(folderId: string, e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    folderContextMenuId = folderId;
    folderContextMenuX = Math.min(e.clientX, window.innerWidth - 200);
    folderContextMenuY = Math.min(e.clientY, window.innerHeight - 120);
    folderContextMenuOpen = true;
    contextMenuOpen = false; // close item context menu if open
  }

  function closeFolderContextMenu() {
    folderContextMenuOpen = false;
    folderContextMenuId = null;
  }

  function createFolderFromSelection() {
    if (!FOLDER_TABS.includes(activeTab as FolderTab)) return;
    if (selectedTrayItemIds.length === 0) return; // Must have items selected
    folderInputMode = 'create';
    folderInputValue = '';
  }

  function confirmFolderInput() {
    const name = folderInputValue.trim();
    if (!name) { folderInputMode = null; return; }

    if (folderInputMode === 'create') {
      const folder: MediaFolder = {
        id: generateUUID(),
        name,
        tab: activeTab as FolderTab,
        itemIds: Array.from(new Set(selectedTrayItemIds)),
      };
      project.setMediaFolders([...mediaFolders, folder]);
      activeFolderId = folder.id;
      // Clear selection so user can immediately start selecting for next folder
      selectedTrayItemIds = [];
      lastTraySelectIndex = null;
    } else if (folderInputMode === 'rename' && folderInputTargetId) {
      const nextFolders = mediaFolders.map(f =>
        f.id === folderInputTargetId ? { ...f, name } : f
      );
      project.setMediaFolders(nextFolders);
    }

    folderInputMode = null;
    folderInputValue = '';
    folderInputTargetId = null;
    closeTrayContextMenu();
    closeFolderContextMenu();
  }

  function onTrayItemDragStart(itemId: string, e: DragEvent) {
    draggedTrayItemId = itemId;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', itemId);
    }
  }

  function onFolderDrop(folderId: string, e: DragEvent) {
    e.preventDefault();
    const draggedId = draggedTrayItemId || e.dataTransfer?.getData('text/plain');
    if (!draggedId) return;
    const ids = selectedTrayItemIds.includes(draggedId) ? selectedTrayItemIds : [draggedId];
    assignItemsToFolder(folderId, ids);
    draggedTrayItemId = null;
  }

  // Handle AI-generated content
  function handleAIGenerated(event: CustomEvent<{ item: MediaSource; isEdit: boolean }>) {
    const { item, isEdit } = event.detail;
    showAIGenerator = false;

    if (item.type === 'shader' && item.shaderCode) {
      // Create shader item
      const shaderItem: ShaderItem = {
        id: item.id,
        name: item.name,
        src: 'ai-generated',
        shaderCode: item.shaderCode,
        inputs: item.shaderInputs || [],
        values: item.shaderValues || {},
        imageInputRefs: {},
        description: 'AI Generated Shader',
        aiGenerated: true,
        aiPrompt: item.aiPrompt,
        loadRating: getShaderLoadRating(item.shaderCode, (item.shaderInputs || []).length),
      };

      if (isEdit && editingShader) {
        // Replace the existing shader
        const idx = shaders.findIndex(s => s.id === editingShader!.id);
        if (idx >= 0) {
          shaders[idx] = shaderItem;
          shaders = [...shaders];
        }
        editingShader = null;
      } else {
        // Add new shader
        shaders = [...shaders, shaderItem];
      }

      // Generate thumbnail for the shader
      generateShaderThumbnail(item.shaderCode, 0.5).then(thumbnail => {
        const idx = shaders.findIndex(s => s.id === item.id);
        if (idx >= 0) {
          shaders[idx].thumbnail = thumbnail;
          shaders = [...shaders];
        }
      }).catch(err => console.warn('Failed to generate AI shader thumbnail:', err));

      activeTab = 'shaders';
    } else if ((item.type === 'threejs' || item.type === 'p5js') && item.jsAnimation) {
      // Create JS animation item
      const jsItem: JSAnimationItem = {
        id: item.id,
        name: item.name,
        type: item.jsAnimation.animationType,
        jsAnimation: item.jsAnimation,
      };

      if (isEdit && editingJSAnimation) {
        // Replace the existing JS animation
        const idx = jsAnimations.findIndex(a => a.id === editingJSAnimation!.id);
        if (idx >= 0) {
          jsAnimations[idx] = jsItem;
          jsAnimations = [...jsAnimations];
        }
        editingJSAnimation = null;
      } else {
        // Add new JS animation
        jsAnimations = [...jsAnimations, jsItem];
      }

      activeTab = 'js';
    }
  }

  // Handle AI-generated video
  async function handleAIVideoGenerated(event: CustomEvent<{ id: string; name: string; src: string; blob: Blob }>) {
    const { id, name, src, blob } = event.detail;

    // Close the generator panel + switch to Videos tab first so the UI
    // reflects success even if downstream work hangs or throws.
    showVideoGenerator = false;
    activeTab = 'videos';

    if (!blob) {
      console.warn('[AI Video] handler: no blob in event.detail');
      return;
    }

    // Normalise MIME type
    const videoBlob = blob.type.startsWith('video/') ? blob : new Blob([blob], { type: 'video/mp4' });
    const blobUrl = URL.createObjectURL(videoBlob);
    const { assetRef } = await createAssetRefFromGeneratedBlob(
      videoBlob,
      `${(name || 'AI Video').replace(/\.[^.]+$/, '')}.mp4`,
      videoBlob.type || 'video/mp4',
      blobUrl,
    );

    const video = document.createElement('video');
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = blobUrl;

    // Add to session media library immediately so the clip appears in
    // the Vid tab right away, even if thumbnail capture takes a moment.
    mediaLibrary.addItem({
      id,
      name,
      src: blobUrl,
      type: 'video',
      videoElement: video,
      thumbnail: '',
      _assetRef: assetRef,
    });

    // Wait (up to 5s) for the video to load, then capture a thumbnail
    // and patch the existing library item so its tile shows a preview.
    // `.src=` already initiated the load — don't call `.load()`.
    await new Promise<void>((resolve) => {
      let resolved = false;
      const done = () => { if (!resolved) { resolved = true; resolve(); } };
      video.oncanplaythrough = done;
      video.onloadeddata = done;
      video.onerror = done;
      if (video.readyState >= 2) done();
      setTimeout(done, 5000);
    });

    let thumbnail = '';
    try {
      await video.play().catch(() => {});
      await new Promise(r => setTimeout(r, 120));
      video.pause();
      const canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 90;
      const ctx = canvas.getContext('2d');
      if (ctx && video.videoWidth > 0) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        thumbnail = canvas.toDataURL('image/jpeg', 0.7);
      }
      video.currentTime = 0;
    } catch (e) {
      console.warn('[AI Video] thumbnail capture failed:', e);
    }

    // Push the thumbnail back onto the already-added library item.
    if (thumbnail) {
      try { mediaLibrary.updateItem(id, { thumbnail }); } catch {}
    }

    // Persist to IndexedDB videoLibrary for the Saved tab.
    try {
      const promptText = (name || '').replace(/^AI:\s*/, '');
      await videoLibrary.addVideo({
        name: name || 'AI Video',
        prompt: promptText,
        thumbnail,
        blob: videoBlob,
      });
    } catch (e) {
      console.warn('[AI Video] videoLibrary.addVideo failed:', e);
    }

    // Revoke the original preview URL since we created our own
    if (src && src !== blobUrl) {
      try { URL.revokeObjectURL(src); } catch {}
    }
  }

  // Start editing a shader
  function startEditShader(shader: ShaderItem) {
    editingShader = shader;
    showAIGenerator = true;
  }

  // Start editing a JS animation
  function startEditJSAnimation(item: JSAnimationItem) {
    editingJSAnimation = item;
    showAIGenerator = true;
  }

  // Get editing item for the generator
  $: editingItem = editingShader ? {
    id: editingShader.id,
    type: 'shader' as const,
    src: 'ai-generated',
    name: editingShader.name,
    shaderCode: editingShader.shaderCode,
    aiGenerated: true,
    aiPrompt: editingShader.aiPrompt
  } : editingJSAnimation ? {
    id: editingJSAnimation.id,
    type: editingJSAnimation.type as 'threejs' | 'p5js',
    src: 'js-animation',
    name: editingJSAnimation.name,
    jsAnimation: editingJSAnimation.jsAnimation
  } : null;

  // Apply JS animation to layer
  async function applyJSAnimationToLayer(item: JSAnimationItem) {
    await applySourceToTargetMediaLayers((layerId) => {
      const source: MediaSource = {
        id: `${item.id}-${layerId}-${Date.now()}`,
        type: item.type,
        src: 'js-animation',
        name: item.name,
        jsAnimation: { ...item.jsAnimation },
      };
      project.setLayerSource(layerId, source);
    });
  }

  // Remove JS animation
  function removeJSAnimation(id: string) {
    jsAnimations = jsAnimations.filter(a => a.id !== id);
  }

  // Load a saved shader from the library and add it to the active list
  async function loadFromLibrary(saved: SavedShader) {
    if (saved.type === 'shader-isf') {
      // Parse the ISF shader
      const parsed = parseISF(saved.code);
      const inputs = parsed.metadata.INPUTS.map(input => ({
        NAME: input.NAME,
        TYPE: input.TYPE as ISFInputDef['TYPE'],
        DEFAULT: input.DEFAULT,
        MIN: input.MIN,
        MAX: input.MAX,
        LABEL: input.LABEL,
        VALUES: input.VALUES,
        LABELS: input.LABELS,
      }));

      // Create default values
      const values: Record<string, number | boolean | number[]> = {};
      for (const input of inputs) {
        values[input.NAME] = getInputDefault(input);
      }

      // Create shader item
      const aiId = generateUUID();
      const shaderItem: ShaderItem = {
        id: aiId,
        name: saved.name,
        // Unique src for cache-key uniqueness — Canvas falls back to src for
        // non-AI items, but include the id here too for consistency with the
        // cloud/user-added path and to defend against any code path that
        // doesn't check the aiGenerated flag.
        src: `library-shader:${aiId}`,
        shaderCode: saved.code,
        inputs,
        values,
        imageInputRefs: {},
        description: saved.description,
        aiGenerated: true,
        aiPrompt: saved.description,
        loadRating: getShaderLoadRating(saved.code, inputs.length),
      };

      // Add to shaders list
      shaders = [...shaders, shaderItem];

      // Generate thumbnail
      try {
        const thumbnail = await generateShaderThumbnail(saved.code, 0.5);
        const idx = shaders.findIndex(s => s.id === shaderItem.id);
        if (idx !== -1) {
          shaders[idx].thumbnail = thumbnail;
          shaders = [...shaders];
        }
      } catch (e) {
        console.warn('Failed to generate thumbnail for library shader:', e);
      }

      // Switch to shaders tab
      activeTab = 'shaders';

    } else {
      // JS animation (threejs or p5js)
      const animationType = saved.type === 'threejs' ? 'threejs' : 'p5js';

      const jsAnimation: JSAnimationSource = {
        animationType,
        htmlCode: saved.code,
        params: saved.params?.map(p => ({
          name: p.name,
          type: p.type as 'number' | 'boolean' | 'color',
          default: p.default as number | boolean | number[],
          min: p.min,
          max: p.max,
          label: p.label
        })),
        paramValues: saved.params?.reduce((acc, p) => {
          acc[p.name] = p.default as number | boolean | number[];
          return acc;
        }, {} as Record<string, number | boolean | number[]>),
        aiGenerated: true,
        aiPrompt: saved.description
      };

      const jsItem: JSAnimationItem = {
        id: generateUUID(),
        name: saved.name,
        type: animationType,
        jsAnimation,
      };

      jsAnimations = [...jsAnimations, jsItem];

      // Switch to JS tab
      activeTab = 'js';
    }
  }

  // Delete a shader from the library. Safe Mode gates this with the
  // in-app confirm popover.
  async function deleteFromLibrary(savedId: string, event?: MouseEvent) {
    if (!(await confirmDeleteIfSafeMode('this shader from your library', event))) return;
    shaderLibrary.removeShader(savedId);
  }

  // Load a saved video from the persistent library into the session
  async function loadSavedVideo(saved: SavedVideo) {
    const blob = await videoLibrary.loadVideoBlob(saved.blobKey);
    if (!blob) {
      alert('Video data not found. It may have been cleared from storage.');
      return;
    }

    const blobUrl = URL.createObjectURL(blob);
    const { assetRef } = await createAssetRefFromGeneratedBlob(
      blob,
      `${(saved.name || 'Saved Video').replace(/\.[^.]+$/, '')}.mp4`,
      blob.type || 'video/mp4',
      blobUrl,
    );
    const video = document.createElement('video');
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = blobUrl;

    // `.src=` already initiated the load — don't call `.load()`.
    await new Promise<void>((resolve) => {
      let resolved = false;
      const done = () => { if (!resolved) { resolved = true; resolve(); } };
      video.onloadeddata = done;
      video.onerror = done;
      if (video.readyState >= 2) done();
      setTimeout(done, 5000);
    });

    mediaLibrary.addItem({
      id: generateUUID(),
      name: saved.name,
      src: blobUrl,
      type: 'video',
      videoElement: video,
      thumbnail: saved.thumbnail,
      _assetRef: assetRef,
    });

    activeTab = 'videos';
  }

  // Delete a saved video from the persistent library. Safe Mode gates
  // this with the in-app confirm popover.
  async function deleteSavedVideo(id: string, event?: MouseEvent) {
    if (!(await confirmDeleteIfSafeMode('this video from your library', event))) return;
    videoLibrary.removeVideo(id);
  }

  // Saved video library state
  $: savedVideos = $videoLibrary.videos;

  // Check if current layer has a shader with the selected shader's id
  $: {
    if ($selectedLayer?.source?.type === 'shader') {
      // Try exact ID match first, then fall back to matching by src path
      // Source IDs are formatted as "${shaderItem.id}-${layerId}-${timestamp}"
      // while shader item IDs are "isf:filename" - so also try matching by src
      const sourceId = $selectedLayer?.source?.id ?? '';
      const sourceSrc = $selectedLayer?.source?.src ?? '';
      const found = shaders.find(s => s.id === sourceId) ||
                    shaders.find(s => sourceId.startsWith(s.id)) ||
                    shaders.find(s => s.src === sourceSrc);
      if (found) {
        selectedShader = found;
        // Sync values from layer source
        if ($selectedLayer.source.shaderValues) {
          selectedShader.values = { ...$selectedLayer.source.shaderValues };
        }
        // Sync image input refs from layer source
        if ($selectedLayer.source.shaderImageInputs) {
          selectedShader.imageInputRefs = { ...selectedShader.imageInputRefs };
          for (const [name, ref] of Object.entries($selectedLayer.source.shaderImageInputs)) {
            selectedShader.imageInputRefs[name] = ref;
          }
        }
        // Register param ranges in the 'map:' namespace so VJ-mode
        // ranges on the same layer index don't get clobbered.
        if (selectedLayerIdx >= 0 && found.inputs) {
          registerParamRanges(selectedLayerIdx, found.inputs, 'mapping');
        }
      }
    } else {
      selectedShader = null;
    }
  }

  // Check if current layer has a JS animation. The layer source's id is a
  // composite `${item.id}-${layerId}-${timestamp}` (see applyJSAnimationToLayer)
  // so an exact `a.id === source.id` match would never succeed — that was
  // the reason params never appeared after applying an animation. Match
  // by source.id starting with the tray item's id instead. Fall back to
  // a name-based lookup for built-in items where the source.id may have
  // been generated differently.
  $: {
    const layerSrc = $selectedLayer?.source;
    if (layerSrc?.jsAnimation) {
      const sid = layerSrc.id || '';
      let found = jsAnimations.find(a => sid === a.id || sid.startsWith(a.id + '-'));
      if (!found) found = jsAnimations.find(a => a.name === layerSrc.name && a.type === (layerSrc as any).type);
      if (found) {
        selectedJSAnimation = found;
        // Sync param values from layer source so sliders reflect current state
        if (layerSrc.jsAnimation.paramValues) {
          selectedJSAnimation.jsAnimation.paramValues = { ...layerSrc.jsAnimation.paramValues };
        }
      }
    } else {
      selectedJSAnimation = null;
    }
  }

  // Update JS animation parameter
  function updateJSAnimationParam(paramName: string, value: number | boolean) {
    if (!selectedJSAnimation || !$selectedLayerId) return;

    // Update local state
    if (!selectedJSAnimation.jsAnimation.paramValues) {
      selectedJSAnimation.jsAnimation.paramValues = {};
    }
    selectedJSAnimation.jsAnimation.paramValues[paramName] = value;
    jsAnimations = [...jsAnimations]; // Trigger reactivity

    // Update the layer source
    const currentSource = $selectedLayer?.source;
    if (currentSource?.jsAnimation) {
      project.setLayerSource($selectedLayerId, {
        ...currentSource,
        jsAnimation: {
          ...currentSource.jsAnimation,
          paramValues: { ...selectedJSAnimation.jsAnimation.paramValues }
        }
      });
    }

    // Send parameter update to the iframe. The iframe cache is keyed by
    // the LAYER source's id (set in Canvas.svelte when createJSAnimationContext
    // is called), NOT by the tray item id — those differ because apply-to-layer
    // constructs `${item.id}-${layerId}-${timestamp}`. Passing the tray id
    // here would miss the cache and the slider would do nothing.
    if (currentSource?.id) {
      updateJSAnimationParams(currentSource.id, { [paramName]: value });
    }
  }

  // Reactive declaration for available image sources
  // Explicitly depend on stores to trigger reactivity when they change
  $: availableImageSources = (() => {
    const sources: Array<{ type: 'layer' | 'media'; id: string; name: string }> = [];

    // Add other layers that have a source
    for (const layer of $layers) {
      if (layer.id !== $selectedLayerId && layer.source) {
        sources.push({
          type: 'layer',
          id: layer.id,
          name: `Layer: ${layer.name}`,
        });
      }
    }

    // Add all media items (videos and images) from the library
    for (const item of $mediaLibrary) {
      sources.push({
        type: 'media',
        id: item.id,
        name: `${item.type === 'video' ? 'Video' : 'Image'}: ${item.name}`,
      });
    }

    return sources;
  })();
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
  <span class="toggle-label">Media</span>
</button>
{/if}

<!-- Slide-out tray -->
<div class="media-tray" class:open={isOpen || embedded} class:embedded>
  <div class="tray-header">
    <h3>Media Library</h3>
  </div>

  <!-- Tabs -->
  <div class="tabs">
    <div class="tab-row">
      <button class="tab" class:active={activeTab === 'shaders'} onclick={() => activeTab = 'shaders'}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
        <span>FX</span>
        {#if shaders.length}<span class="tab-count">{shaders.length}</span>{/if}
      </button>
      <button class="tab" class:active={activeTab === 'js'} onclick={() => activeTab = 'js'}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/></svg>
        <span>JS</span>
        {#if jsAnimations.length}<span class="tab-count">{jsAnimations.length}</span>{/if}
      </button>
      <button class="tab" class:active={activeTab === 'library'} onclick={() => activeTab = 'library'}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
        <span>Saved</span>
        {#if savedShaders.length}<span class="tab-count">{savedShaders.length}</span>{/if}
      </button>
      <button class="tab" class:active={activeTab === 'videos'} onclick={() => activeTab = 'videos'}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        <span>Vid</span>
        {#if videos.length}<span class="tab-count">{videos.length}</span>{/if}
      </button>
      <button class="tab" class:active={activeTab === 'images'} onclick={() => activeTab = 'images'}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
        <span>Img</span>
        {#if images.length}<span class="tab-count">{images.length}</span>{/if}
      </button>
      <button class="tab" class:active={activeTab === 'sources'} onclick={() => { activeTab = 'sources'; if (!sourcesInitialized) { sourcesInitialized = true; enumerateWebcams(); } }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
        <span>Src</span>
        {#if liveSources.filter(s => s.status === 'live').length > 0}
          <span class="tab-live">{liveSources.filter(s => s.status === 'live').length}</span>
        {/if}
      </button>
      <button class="tab" class:active={activeTab === 'plugins'} onclick={() => { activeTab = 'plugins'; }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
        <span>Plug</span>
      </button>
    </div>
  </div>

  <!-- AI Generator Buttons -->
  <div class="ai-generator-section">
    <button class="ai-generate-btn" onclick={() => { showAIGenerator = !showAIGenerator; if (showAIGenerator) showVideoGenerator = false; }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
      </svg>
      {showAIGenerator ? 'Hide AI Generator' : 'AI Generate'}
    </button>
    <button class="ai-generate-btn ai-video-btn" onclick={() => { showVideoGenerator = !showVideoGenerator; if (showVideoGenerator) showAIGenerator = false; }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polygon points="5 3 19 12 5 21 5 3"/>
      </svg>
      {showVideoGenerator ? 'Hide Video Gen' : 'AI Video'}
    </button>
  </div>

  {#if showAIGenerator}
    <div class="ai-generator-container">
      <AIShaderGenerator
        editingItem={editingItem}
        on:generated={handleAIGenerated}
        on:close={() => {
          showAIGenerator = false;
          editingShader = null;
          editingJSAnimation = null;
        }}
      />
    </div>
  {/if}

  {#if showVideoGenerator}
    <div class="ai-generator-container">
      <AIVideoGenerator
        on:generated={handleAIVideoGenerated}
        on:close={() => { showVideoGenerator = false; }}
      />
    </div>
  {/if}

  <!-- JS Filter (only show on JS tab) -->
  {#if activeTab === 'js'}
    <div class="js-filter-row">
      <button class="js-filter-btn" class:active={jsFilter === 'all'} onclick={() => jsFilter = 'all'}>
        All
      </button>
      <button class="js-filter-btn" class:active={jsFilter === 'threejs'} onclick={() => jsFilter = 'threejs'}>
        Three.js
      </button>
      <button class="js-filter-btn" class:active={jsFilter === 'p5js'} onclick={() => jsFilter = 'p5js'}>
        p5.js
      </button>
    </div>
  {/if}

  <!-- Global loading progress bar -->
  {#if isLoadingThumbnails}
    <div class="global-loading">
      <div class="global-loading-info">
        <div class="loading-spinner-inline"></div>
        <span>Generating thumbnails... {loadedShadersCount}/{totalShadersCount}</span>
      </div>
      <div class="global-loading-bar-container">
        <div class="global-loading-bar" style="width: {loadingProgress * 100}%"></div>
      </div>
    </div>
  {/if}

  <!-- Shader Parameters Panel (when shader is selected) -->
  {#if selectedShader && selectedShader.inputs.length > 0}
    <div class="shader-params">
      <div class="params-header">
        <h4>{selectedShader.name}</h4>
        <!-- ↺ Reset all params + clear modulation. Cyan to read as
             recoverable, matching the VJ Mode shader-params reset. -->
        <button class="reset-params" onclick={resetMappingShaderToDefaults} title="Reset all params to defaults" aria-label="Reset all params to defaults">↺</button>
        <button class="close-params" onclick={() => selectedShader = null}>x</button>
      </div>
      <div class="params-list">
        {#each selectedShader.inputs as input}
          <!-- Inline modulationMap lookup so Svelte tracks the
               template's reactive dependency on the store (function
               calls hide the dep). target='mapping' so this picks
               up the map:-prefixed key the mapping-mode setter
               writes under — previously this was a legacy VJ-style
               key lookup which never matched after the target-aware
               refactor. -->
          {@const mod = input.TYPE === 'float' && selectedLayerIdx >= 0
            ? mappingModMap.get(modKeyShader(selectedLayerIdx, input.NAME, 'A', 'mapping'))
            : undefined}
          {@const _mapAuto = input.TYPE === 'float' ? $selectedLayer?.source?.shaderValueAuto?.[input.NAME] : undefined}
          {@const _currentSrc = _mapAuto ? 'auto' : (mod?.source ?? 'manual')}
          {@const isModulated = _currentSrc !== 'manual'}
          {#if input.TYPE === 'float'}
            <div class="shader-param" class:modulated={isModulated}>
              <div class="shader-param-header">
                <span class="shader-param-name">{input.LABEL || input.NAME}</span>
                <select class="mod-source-select" class:active={isModulated} value={_currentSrc}
                  onchange={(e) => setMappingShaderSource(input.NAME, (e.target as HTMLSelectElement).value as ModSource, input.MIN ?? 0, input.MAX ?? 1)}>
                  <optgroup label="Control">
                    <option value="manual">Manual</option>
                    <option value="auto">Auto (playhead)</option>
                  </optgroup>
                  <optgroup label="Audio">
                    <option value="sub">Sub</option><option value="bass">Bass</option><option value="lowMid">Low Mid</option>
                    <option value="mid">Mid</option><option value="highMid">Hi Mid</option><option value="high">High</option>
                    <option value="amplitude">Volume</option>
                  </optgroup>
                  <optgroup label="Sync"><option value="beatPhase">Beat</option></optgroup>
                  <optgroup label="LFO">
                    <option value="lfo-sine">Sine</option><option value="lfo-saw">Saw</option>
                    <option value="lfo-square">Square</option><option value="lfo-tri">Triangle</option>
                  </optgroup>
                </select>
              </div>
              <div class="shader-param-slider">
                <div class="slider-track-wrap">
                  <input
                    type="range"
                    min={input.MIN ?? 0}
                    max={input.MAX ?? 1}
                    step="0.01"
                    value={selectedShader.values[input.NAME] ?? input.DEFAULT ?? 0}
                    oninput={(e) => updateShaderParam(input.NAME, parseFloat((e.target as HTMLInputElement).value))}
                    class="param-slider"
                  />
                  <!-- Auto-mode slippers overlay on the main slider.
                       Slipper inputs use the same min/max as the
                       slider above so the cyan thumb visually aligns
                       with the slider's actual range — internal
                       storage stays as 0..1 fractions. -->
                  {#if _mapAuto}
                    {@const _rMin = input.MIN ?? 0}
                    {@const _rMax = input.MAX ?? 1}
                    {@const _rSpan = (_rMax - _rMin) || 1}
                    {@const _aMin = _mapAuto.min}
                    {@const _aMax = _mapAuto.max}
                    {@const _aMinFrac = (_aMin - _rMin) / _rSpan}
                    {@const _aMaxFrac = (_aMax - _rMin) / _rSpan}
                    <div class="slipper-fill" style="left: {_aMinFrac * 100}%; right: {(1 - _aMaxFrac) * 100}%"></div>
                    <input type="range" min={_rMin} max={_rMax} step={_rSpan / 200} value={_aMin}
                      class="slipper slipper-min"
                      oninput={(e) => {
                        const v = parseFloat((e.target as HTMLInputElement).value);
                        setMappingAutoField(input.NAME, 'min', Math.min(v, _aMax - _rSpan * 0.02));
                      }} />
                    <input type="range" min={_rMin} max={_rMax} step={_rSpan / 200} value={_aMax}
                      class="slipper slipper-max"
                      oninput={(e) => {
                        const v = parseFloat((e.target as HTMLInputElement).value);
                        setMappingAutoField(input.NAME, 'max', Math.max(v, _aMin + _rSpan * 0.02));
                      }} />
                  {/if}
                </div>
                <span class="param-val">
                  {(selectedShader.values[input.NAME] as number)?.toFixed(2) ?? '0.00'}
                </span>
              </div>
              {#if isModulated && !_mapAuto}
                <div class="mod-amount-row">
                  <span class="mod-amount-label">Depth</span>
                  <input type="range" min="0" max="1" step="0.01" value={mod?.amount ?? 0.5}
                    oninput={(e) => setParamModAmount(selectedLayerIdx, input.NAME, parseFloat((e.target as HTMLInputElement).value))} class="mod-amount-slider" />
                  <span class="mod-amount-val">{((mod?.amount ?? 0.5) * 100).toFixed(0)}%</span>
                </div>
              {/if}
              <!-- Auto-automation controls. Mirrors the VJ Mode panel
                   exactly — playhead with speed, loop/pingpong, and
                   dual-thumb range clippers. -->
              {#if _mapAuto}
                <div class="auto-controls">
                  <div class="auto-row">
                    <button class="auto-play" class:playing={_mapAuto.playing}
                      onclick={() => setMappingAutoField(input.NAME, 'playing', !_mapAuto!.playing)}
                      title={_mapAuto.playing ? 'Pause' : 'Resume'}
                    >{_mapAuto.playing ? '❚❚' : '▶'}</button>
                    <div class="auto-mode-toggle">
                      <button class:active={_mapAuto.mode === 'loop'}
                        onclick={() => setMappingAutoField(input.NAME, 'mode', 'loop')}>Loop</button>
                      <button class:active={_mapAuto.mode === 'pingpong'}
                        onclick={() => setMappingAutoField(input.NAME, 'mode', 'pingpong')}>Ping-pong</button>
                    </div>
                  </div>
                  <div class="auto-row auto-row-speed">
                    <span class="auto-label">Speed</span>
                    <input type="range" min="0.01" max="1" step="0.005"
                      value={_mapAuto.speedHz}
                      oninput={(e) => setMappingAutoField(input.NAME, 'speedHz', parseFloat((e.target as HTMLInputElement).value))}
                      class="auto-speed-slider" />
                    <span class="auto-val">{_mapAuto.speedHz.toFixed(2)}Hz</span>
                  </div>
                </div>
              {/if}
            </div>
          {:else if input.TYPE === 'long' && input.VALUES && input.LABELS}
            <div class="shader-param">
              <div class="shader-param-header">
                <span class="shader-param-name">{input.LABEL || input.NAME}</span>
              </div>
              <div class="shader-param-slider">
                <select class="param-select"
                  value={selectedShader.values[input.NAME] ?? input.DEFAULT ?? 0}
                  onchange={(e) => updateShaderParam(input.NAME, parseInt((e.target as HTMLSelectElement).value))}>
                  {#each input.VALUES as val, i}
                    <option value={val}>{input.LABELS?.[i] ?? val}</option>
                  {/each}
                </select>
              </div>
            </div>
          {:else if input.TYPE === 'long'}
            <div class="shader-param">
              <div class="shader-param-header">
                <span class="shader-param-name">{input.LABEL || input.NAME}</span>
              </div>
              <div class="shader-param-slider">
                <input type="range" min={input.MIN ?? 0} max={input.MAX ?? 10} step="1"
                  value={selectedShader.values[input.NAME] ?? input.DEFAULT ?? 0}
                  oninput={(e) => updateShaderParam(input.NAME, parseInt((e.target as HTMLInputElement).value))}
                  class="param-slider" />
                <span class="param-val">{selectedShader.values[input.NAME] ?? input.DEFAULT ?? 0}</span>
              </div>
            </div>
          {:else if input.TYPE === 'color'}
            {@const cv = (selectedShader.values[input.NAME] ?? input.DEFAULT ?? [1,1,1,1]) as number[]}
            <div class="shader-param">
              <div class="shader-param-header">
                <span class="shader-param-name">{input.LABEL || input.NAME}</span>
              </div>
              <div class="shader-param-slider">
                <input type="color" class="param-color"
                  value={'#' + Math.round((cv[0]??1)*255).toString(16).padStart(2,'0') + Math.round((cv[1]??1)*255).toString(16).padStart(2,'0') + Math.round((cv[2]??1)*255).toString(16).padStart(2,'0')}
                  oninput={(e) => {
                    const hex = (e.target as HTMLInputElement).value;
                    const r = parseInt(hex.slice(1,3),16)/255;
                    const g = parseInt(hex.slice(3,5),16)/255;
                    const b = parseInt(hex.slice(5,7),16)/255;
                    updateShaderParam(input.NAME, [r, g, b, 1.0]);
                  }} />
              </div>
            </div>
          {:else if input.TYPE === 'bool'}
            <div class="param-row">
              <label>{input.LABEL || input.NAME}</label>
              <input
                type="checkbox"
                checked={selectedShader.values[input.NAME] as boolean}
                onchange={(e) => updateShaderParam(input.NAME, (e.target as HTMLInputElement).checked)}
              />
            </div>
          {:else if input.TYPE === 'image'}
            <div class="param-row image-input">
              <label>{input.LABEL || input.NAME}</label>
              <select
                class="image-select"
                value={selectedShader.imageInputRefs[input.NAME]?.id ?? ''}
                onchange={(e) => {
                  const selectEl = e.target as HTMLSelectElement;
                  const value = selectEl.value;
                  if (!value) {
                    updateShaderImageInput(input.NAME, null);
                  } else {
                    const source = availableImageSources.find(s => s.id === value);
                    if (source) {
                      updateShaderImageInput(input.NAME, {
                        type: source.type,
                        id: source.id,
                        name: source.name,
                      });
                    }
                  }
                }}
              >
                <option value="">-- Select source --</option>
                {#each availableImageSources as source}
                  <option value={source.id}>{source.name}</option>
                {/each}
              </select>
            </div>
          {/if}
        {/each}
      </div>
    </div>
  {/if}

  <!-- JS Animation Parameters Panel (when JS animation is selected) -->
  {#if selectedJSAnimation && selectedJSAnimation.jsAnimation.params && selectedJSAnimation.jsAnimation.params.length > 0}
    <div class="shader-params js-params">
      <div class="params-header">
        <h4>{selectedJSAnimation.name}</h4>
        <button class="close-params" onclick={() => selectedJSAnimation = null}>x</button>
      </div>
      <div class="params-list">
        {#each selectedJSAnimation.jsAnimation.params as param}
          {#if param.type === 'number'}
            <div class="param-row">
              <label>{param.label || param.name}</label>
              <input
                type="range"
                min={param.min ?? 0}
                max={param.max ?? 1}
                step="0.01"
                value={selectedJSAnimation.jsAnimation.paramValues?.[param.name] ?? param.default ?? 0}
                oninput={(e) => updateJSAnimationParam(param.name, parseFloat((e.target as HTMLInputElement).value))}
              />
              <span class="param-value">
                {((selectedJSAnimation.jsAnimation.paramValues?.[param.name] ?? param.default) as number)?.toFixed(2) ?? '0.00'}
              </span>
            </div>
          {:else if param.type === 'boolean'}
            <div class="param-row">
              <label>{param.label || param.name}</label>
              <input
                type="checkbox"
                checked={(selectedJSAnimation.jsAnimation.paramValues?.[param.name] ?? param.default) as boolean}
                onchange={(e) => updateJSAnimationParam(param.name, (e.target as HTMLInputElement).checked)}
              />
            </div>
          {/if}
        {/each}
      </div>
    </div>
  {/if}

  <!-- Media Grid -->
  <div
    class="media-content"
    ondrop={handleDrop}
    ondragover={handleDragOver}
    role="region"
    aria-label="Media drop zone"
  >
    {#if activeTab === 'sources'}
      <!-- Live Sources Panel -->
      <div class="sources-panel">
        <div class="sources-add-row">
          <button class="source-add-btn" onclick={() => startWebcam()}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
            </svg>
            Webcam
          </button>
          <button class="source-add-btn" onclick={() => startScreenCapture()}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
            </svg>
            Capture
          </button>
          <button class="source-add-btn spout" class:active={showSpoutPicker} onclick={() => { showSpoutPicker = !showSpoutPicker; if (showSpoutPicker) scanSpoutSenders(); }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><circle cx="12" cy="20" r="1"/>
            </svg>
            {tsLabel} In
          </button>
        </div>

        {#if showSpoutPicker}
          <div class="spout-picker">
            <label class="picker-label">{tsLabel} Senders</label>
            {#if availableSpoutSenders.length > 0}
              <div class="spout-sender-list">
                {#each availableSpoutSenders as sender}
                  <button class="spout-sender-btn" onclick={() => { addSpoutSource(sender); showSpoutPicker = false; }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M5 12.55a11 11 0 0 1 14.08 0"/><circle cx="12" cy="20" r="1"/>
                    </svg>
                    {sender}
                  </button>
                {/each}
              </div>
            {:else}
              <div class="spout-no-senders">
                <p>No {tsLabel} senders detected</p>
                <p class="hint">Open an app with {tsLabel} output (FluidGen, OBS, etc.)</p>
                <button class="spout-refresh-btn" onclick={() => scanSpoutSenders()}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                  </svg>
                  Refresh
                </button>
              </div>
            {/if}
          </div>
        {/if}

        {#if availableWebcams.length > 1}
          <div class="webcam-picker">
            <label class="picker-label">Camera Device</label>
            <select class="device-select" onchange={(e) => { const v = (e.target as HTMLSelectElement).value; if (v) startWebcam(v); }}>
              <option value="">Select camera...</option>
              {#each availableWebcams as cam}
                <option value={cam.deviceId}>{cam.label || `Camera ${availableWebcams.indexOf(cam) + 1}`}</option>
              {/each}
            </select>
          </div>
        {/if}

        {#if liveSources.length === 0}
          <div class="empty-state">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
            </svg>
            <p>No live sources</p>
            <p class="hint">Add a webcam, screen capture, or {tsLabel} input</p>
          </div>
        {:else}
          <div class="sources-list">
            {#each liveSources as source (source.id)}
              <div
                class="source-card"
                class:live={source.status === 'live'}
                class:connecting={source.status === 'connecting'}
                ondblclick={() => source.status === 'live' && applySourceToLayer(source)}
                title={source.status === 'live' ? 'Double-click to apply to layer' : ''}
              >
                <div class="source-preview">
                  {#if source.videoEl && source.status === 'live'}
                    <!-- svelte-ignore a11y_media_has_caption -->
                    <video
                      class="source-video-preview"
                      use:setStreamSrc={source.stream}
                      muted
                      playsinline
                      autoplay
                    ></video>
                  {:else}
                    <div class="source-icon">
                      {#if source.type === 'spout'}
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                          <path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><circle cx="12" cy="20" r="1"/>
                        </svg>
                      {:else if source.type === 'capture'}
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                          <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
                        </svg>
                      {:else}
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                          <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                        </svg>
                      {/if}
                    </div>
                  {/if}
                </div>
                <div class="source-info">
                  <span class="source-name">{source.name}</span>
                  <span class="source-status">
                    {#if source.status === 'live'}
                      <span class="status-dot live"></span> Live
                    {:else if source.status === 'connecting'}
                      <span class="status-dot connecting"></span> Connecting...
                    {:else}
                      <span class="status-dot"></span> Disconnected
                    {/if}
                  </span>
                </div>
                <div class="source-actions">
                  {#if source.status === 'live' && (source.videoEl || source.type === 'spout')}
                    <button class="source-apply-btn" onclick={() => applySourceToLayer(source)} title="Apply to selected layer">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    </button>
                  {/if}
                  <button class="source-stop-btn" onclick={() => stopSource(source.id)} title="Stop source">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {:else if activeTab === 'plugins'}
      <!-- Plugins Panel -->
      <div class="plugins-panel">
        <div class="plugins-header">
          <span class="plugins-title">GPU Plugins</span>
          <span class="plugins-hint">Click to apply to selected layer</span>
        </div>
        <div class="plugins-grid">
          <!-- Integrated plugins (from registry) -->
          {#each availablePlugins as plugin (plugin.id)}
            <button
              class="plugin-card"
              onclick={() => applyPluginToLayer(plugin)}
              disabled={!$selectedLayer}
              title={$selectedLayer ? `Apply ${plugin.name} to layer` : 'Select a layer first'}
            >
              <div class="plugin-preview" style="background: {plugin.previewCSS}">
                {#if plugin.id === 'fluidgen'}
                  <svg class="plugin-icon-svg" width="36" height="36" viewBox="0 0 24 24" fill="none">
                    <path d="M12 2C6.5 8 4 12 4 15a8 8 0 1 0 16 0c0-3-2.5-7-8-13Z" stroke="currentColor" stroke-width="1.5" fill="rgba(14,165,233,0.25)"/>
                    <path d="M12 22c-2.5 0-4-1.5-4-4" stroke="currentColor" stroke-width="1.5" opacity="0.7"/>
                    <path d="M9 14c0 2 1.3 3 3 3s3-1 3-3" stroke="currentColor" stroke-width="1" opacity="0.5"/>
                  </svg>
                {:else if plugin.id === 'particles3d'}
                  <svg class="plugin-icon-svg" width="36" height="36" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.5" fill="rgba(99,102,241,0.3)"/>
                    <circle cx="6" cy="6" r="1.8" stroke="currentColor" stroke-width="1" fill="rgba(236,72,153,0.3)"/>
                    <circle cx="18" cy="6" r="1.5" stroke="currentColor" stroke-width="1" fill="rgba(168,85,247,0.3)"/>
                    <circle cx="6" cy="18" r="1.3" stroke="currentColor" stroke-width="1" fill="rgba(99,102,241,0.3)"/>
                    <circle cx="18" cy="18" r="2" stroke="currentColor" stroke-width="1" fill="rgba(236,72,153,0.3)"/>
                    <circle cx="3" cy="12" r="0.8" fill="currentColor" opacity="0.6"/>
                    <circle cx="21" cy="12" r="0.8" fill="currentColor" opacity="0.6"/>
                    <line x1="8.5" y1="9.5" x2="6.5" y2="7.5" stroke="currentColor" stroke-width="0.8" opacity="0.4"/>
                    <line x1="15.5" y1="9.5" x2="17.5" y2="7.5" stroke="currentColor" stroke-width="0.8" opacity="0.4"/>
                    <line x1="8.5" y1="14.5" x2="6.5" y2="16.5" stroke="currentColor" stroke-width="0.8" opacity="0.4"/>
                    <line x1="15.5" y1="14.5" x2="17.5" y2="16.5" stroke="currentColor" stroke-width="0.8" opacity="0.4"/>
                  </svg>
                {:else}
                  <span class="plugin-icon-emoji">{plugin.icon}</span>
                {/if}
              </div>
              <div class="plugin-info">
                <span class="plugin-name">{plugin.name}</span>
                <span class="plugin-desc">{plugin.description}</span>
                <span class="plugin-tier">{plugin.tier.toUpperCase()}</span>
              </div>
            </button>
          {/each}

          <!-- Old standalone Bevy Particles3D removed — now integrated via registry above -->
        </div>
        {#if !$selectedLayer}
          <div class="plugins-hint-footer">
            Select a media layer, then click a plugin to apply it
          </div>
        {/if}
      </div>
    {:else if activeTab === 'library'}
      {#if savedShaders.length === 0 && savedVideos.length === 0}
        <div class="empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
            <polyline points="17 21 17 13 7 13 7 21"/>
            <polyline points="7 3 7 8 15 8"/>
          </svg>
          <p>No saved content yet</p>
          <p class="hint">AI-generated shaders and videos are automatically saved here</p>
        </div>
      {:else}
        <!-- Saved Videos -->
        {#if savedVideos.length > 0}
          <div class="library-section-label">Videos ({savedVideos.length})</div>
          <div class="library-grid">
            {#each savedVideos as sv (sv.id)}
              <div class="library-item video-item">
                <div class="library-item-header">
                  <span class="library-type-badge video-badge">VID</span>
                  <span class="library-date">{new Date(sv.createdAt).toLocaleDateString()}</span>
                </div>
                {#if sv.thumbnail}
                  <img src={sv.thumbnail} alt={sv.name} class="library-thumb" />
                {:else}
                  <div class="library-icon">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                      <polygon points="5 3 19 12 5 21 5 3"/>
                    </svg>
                  </div>
                {/if}
                <span class="library-name" title={sv.name}>{sv.name}</span>
                <span class="library-desc" title={sv.prompt}>{sv.prompt}</span>
                <div class="library-actions">
                  <button class="library-load-btn" onclick={() => loadSavedVideo(sv)} title="Load into session">Load</button>
                  <button class="library-delete-btn" onclick={(e) => deleteSavedVideo(sv.id, e)} title="Delete from library">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                  </button>
                </div>
              </div>
            {/each}
          </div>
        {/if}

        <!-- Saved Shaders -->
        {#if savedShaders.length > 0}
          <div class="library-section-label">Shaders ({savedShaders.length})</div>
          <div class="library-grid">
            {#each savedShaders as saved (saved.id)}
              <div
                class="library-item"
                class:isf={saved.type === 'shader-isf'}
                class:threejs={saved.type === 'threejs'}
                class:p5js={saved.type === 'p5js'}
              >
                <div class="library-item-header">
                  <span class="library-type-badge">
                    {#if saved.type === 'shader-isf'}ISF{:else if saved.type === 'threejs'}3JS{:else}P5{/if}
                  </span>
                  <span class="library-date">{new Date(saved.createdAt).toLocaleDateString()}</span>
                </div>
                <div class="library-preview">
                  {#if saved.thumbnail}
                    <img src={saved.thumbnail} alt={saved.name} class="library-thumb" />
                  {:else}
                    <div class="library-icon">
                      {#if saved.type === 'shader-isf'}
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                          <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"/>
                          <line x1="12" y1="22" x2="12" y2="15.5"/>
                          <polyline points="22 8.5 12 15.5 2 8.5"/>
                        </svg>
                      {:else if saved.type === 'threejs'}
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                          <path d="M12 2L2 7v10l10 5 10-5V7L12 2z"/>
                          <circle cx="12" cy="12" r="3"/>
                        </svg>
                      {:else}
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                          <circle cx="12" cy="12" r="10"/>
                          <path d="M8 12l3 3 5-6"/>
                        </svg>
                      {/if}
                    </div>
                  {/if}
                  {#if saved.type === 'shader-isf'}
                    {@const savedLoadRating = getShaderLoadRating(saved.code, saved.params?.length || 0)}
                    <span
                      class="shader-load-badge library"
                      class:low={savedLoadRating.level === 'low'}
                      class:medium={savedLoadRating.level === 'medium'}
                      class:high={savedLoadRating.level === 'high'}
                      class:extreme={savedLoadRating.level === 'extreme'}
                      title={getShaderLoadBadgeTitle(savedLoadRating)}
                    >
                      {savedLoadRating.shortLabel}
                    </span>
                  {/if}
                </div>
                <span class="library-name" title={saved.name}>{saved.name}</span>
                <span class="library-desc" title={saved.description}>{saved.description}</span>
                <div class="library-actions">
                  <button class="library-load-btn" onclick={() => loadFromLibrary(saved)} title="Load and add to active list">Load</button>
                  <button class="library-delete-btn" onclick={(e) => deleteFromLibrary(saved.id, e)} title="Delete from library">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                  </button>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      {/if}
    {:else if activeTab === 'js' && jsAnimations.length === 0}
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4"/>
        </svg>
        <p>No JS animations yet</p>
        <p class="hint">Use AI Generate to create Three.js or p5.js animations</p>
      </div>
    {:else if activeTab === 'js'}
      <div class="media-grid">
        {#each filteredJSAnimations as item (item.id)}
          <div
            class="media-item js-item"
            class:threejs={item.type === 'threejs'}
            class:p5js={item.type === 'p5js'}
            onclick={() => applyJSAnimationToLayer(item)}
            role="button"
            tabindex="0"
            onkeypress={(e) => e.key === 'Enter' && applyJSAnimationToLayer(item)}
            title="Click to apply to selected layer"
          >
            <div class="js-icon" class:threejs={item.type === 'threejs'} class:p5js={item.type === 'p5js'}>
              {#if item.type === 'threejs'}
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path d="M12 2L2 7v10l10 5 10-5V7L12 2z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              {:else}
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M8 12l3 3 5-6"/>
                </svg>
              {/if}
              {#if item.jsAnimation.aiGenerated}
                <span class="ai-badge">AI</span>
              {/if}
            </div>
            <span class="item-name">{item.name}</span>
            <span class="js-type-badge">{item.type === 'threejs' ? '3JS' : 'P5'}</span>
            <div class="item-actions">
              {#if item.jsAnimation.aiGenerated}
                <button
                  class="edit-btn"
                  onclick={(e) => { e.stopPropagation(); startEditJSAnimation(item); }}
                  title="Edit prompt and regenerate"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                </button>
              {/if}
              <button
                class="remove-btn"
                onclick={async (e) => {
                  e.stopPropagation();
                  if (!(await confirmDeleteIfSafeMode(`"${item.name ?? 'this animation'}" from the library`, e))) return;
                  removeJSAnimation(item.id);
                }}
                title="Remove from library"
              >
                x
              </button>
            </div>
          </div>
        {/each}
      </div>
    {:else if currentItems.length === 0}
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M12 5v14M5 12h14" />
          <rect x="3" y="3" width="18" height="18" rx="2" />
        </svg>
        <p>Drop {activeTab} here</p>
        <p class="hint">or click Add Files below</p>
      </div>
    {:else}
      {#if activeTab === 'shaders' && shaderCategories.length > 1}
        <div class="category-stack">
          <button
            class="category-toggle"
            class:active={shaderCategoryFilter === null && !activeFolderId}
            onclick={() => { shaderCategoryFilter = null; activeFolderId = null; }}
          >
            <span class="category-name">All Shaders</span>
            <span class="category-count">{shaders.length}</span>
          </button>
          {#each shaderCategories as cat (cat.name)}
            <button
              class="category-toggle"
              class:active={shaderCategoryFilter === cat.name && !activeFolderId}
              onclick={() => { shaderCategoryFilter = shaderCategoryFilter === cat.name ? null : cat.name; activeFolderId = null; }}
            >
              <span class="category-name">{cat.name}</span>
              <span class="category-count">{cat.count}</span>
            </button>
          {/each}

          <!-- User folders in the same sidebar -->
          {#if activeTabFolders.length > 0}
            <div class="category-sep"></div>
            {#each activeTabFolders as folder, fi (folder.id)}
              <button
                class="category-toggle user-folder"
                class:active={activeFolderId === folder.id}
                onclick={() => { activeFolderId = activeFolderId === folder.id ? null : folder.id; shaderCategoryFilter = null; }}
                oncontextmenu={(e) => openFolderContextMenu(folder.id, e)}
                ondragover={(e) => { e.preventDefault(); dragOverFolderIndex = fi; }}
                ondragleave={() => dragOverFolderIndex = null}
                ondrop={(e) => { onFolderDrop(folder.id, e); handleFolderReorder(fi); }}
                draggable="true"
                ondragstart={(e) => { draggedFolderIndex = fi; if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'; }}
                ondragend={() => { draggedFolderIndex = null; dragOverFolderIndex = null; }}
                class:drag-over={dragOverFolderIndex === fi && draggedFolderIndex !== fi}
                title="Right-click to rename or delete. Drag to reorder."
              >
                <span class="category-name">{folder.name}</span>
                <span class="category-count">{folder.itemIds.length}</span>
              </button>
            {/each}
          {/if}
        </div>
      {:else if isFolderTab}
        <div class="folder-bar">
          {#each activeTabFolders as folder (folder.id)}
            <button
              class="folder-chip"
              class:active={activeFolderId === folder.id}
              onclick={() => activeFolderId = activeFolderId === folder.id ? null : folder.id}
              oncontextmenu={(e) => openFolderContextMenu(folder.id, e)}
              ondragover={(e) => e.preventDefault()}
              ondrop={(e) => onFolderDrop(folder.id, e)}
              title="Right-click to rename or delete"
            >
              <span class="folder-chip-icon">{activeFolderId === folder.id ? '-' : '+'}</span>
              <span>{folder.name} ({folder.itemIds.length})</span>
            </button>
          {/each}
        </div>
      {/if}
      {#each mediaSections as section (section.id)}
        {#if section.kind === 'folder'}
          <div class="section-label">{section.label}</div>
          <div class="folder-open-divider"></div>
        {:else if isFolderTab}
          <div class="section-label all-clips-label">{section.label}</div>
        {/if}
        {#if section.items.length > 0}
          <div class="media-grid">
          {#each section.items as item (item.id)}
            <div
              class="media-item"
              class:selected={selectedShader?.id === item.id}
              class:item-selected={selectedTrayItemIds.includes(item.id)}
              class:processing={loopingVideoId === item.id}
              class:drag-over-reorder={dragOverTrayItemId === item.id}
              onclick={(e) => handleTrayItemClick(item.id, e, () => applyToLayer(item))}
              oncontextmenu={(e) => openTrayContextMenu(item.id, e)}
              draggable="true"
              ondragstart={(e) => onTrayItemDragStart(item.id, e)}
              ondragover={(e) => { e.preventDefault(); dragOverTrayItemId = item.id; }}
              ondragleave={() => { if (dragOverTrayItemId === item.id) dragOverTrayItemId = null; }}
              ondrop={(e) => { e.preventDefault(); e.stopPropagation(); reorderTrayItem(item.id); }}
              ondragend={() => { draggedTrayItemId = null; dragOverTrayItemId = null; }}
              role="button"
              tabindex="0"
              onkeypress={(e) => e.key === 'Enter' && applyToLayer(item)}
              title="Click to apply to selected layer"
            >
              {#if 'shaderCode' in item && item.thumbnail}
                <img src={item.thumbnail} alt={item.name} class="shader-thumb" />
              {:else if 'shaderCode' in item && (item.loadingProgress || 0) < 1}
                <div class="shader-icon loading">
                  <div class="loading-bar-container">
                    <div class="loading-bar" style="width: {(item.loadingProgress || 0) * 100}%"></div>
                  </div>
                  <span class="loading-text">Loading...</span>
                </div>
              {:else if 'shaderCode' in item}
                <div class="shader-icon">
                  <span class="shader-placeholder-text">ISF</span>
                </div>
              {:else if 'thumbnail' in item && item.thumbnail}
                <img src={item.thumbnail} alt={item.name} />
              {:else}
                <div class="placeholder-thumb"></div>
              {/if}
              {#if 'shaderCode' in item}
                {@const itemLoadRating = item.loadRating || getShaderLoadRating(item.shaderCode, item.inputs.length)}
                <span
                  class="shader-load-badge"
                  class:low={itemLoadRating.level === 'low'}
                  class:medium={itemLoadRating.level === 'medium'}
                  class:high={itemLoadRating.level === 'high'}
                  class:extreme={itemLoadRating.level === 'extreme'}
                  title={getShaderLoadBadgeTitle(itemLoadRating)}
                >
                  {itemLoadRating.shortLabel}
                </span>
              {/if}

              <!-- Loop progress overlay for videos being processed -->
              {#if loopingVideoId === item.id && loopProgress}
                <div class="loop-progress-overlay">
                  <div class="loop-progress-content">
                    <svg class="loop-spinner" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                    <span class="loop-progress-text">{loopProgress.message}</span>
                    <div class="loop-progress-bar-container">
                      <!-- Round to whole percent to avoid 12-digit decimals
                           in the inspector / animations stuttering on
                           floats the user can't see anyway. -->
                      <div class="loop-progress-bar" style="width: {Math.round(loopProgress.progress * 100)}%"></div>
                    </div>
                  </div>
                </div>
              {/if}

              <span class="item-name">
                {#if 'shaderCode' in item && item.userAdded}
                  <span class="user-badge" title="Added from your computer">•</span>
                {:else if 'shaderCode' in item && item.cloudShader}
                  <span class="cloud-badge" title="Synced from ghostarcade.live">•</span>
                {/if}
                {item.name}
              </span>

              <!-- Action buttons container -->
              <div class="item-actions">
                {#if !('shaderCode' in item) && item.type === 'video'}
                  <button
                    class="loop-btn"
                    onclick={(e) => toggleLoopOptions(item.id, e)}
                    title="Create loop"
                    disabled={loopingVideoId !== null}
                    class:active={showLoopOptions === item.id}
                  >
                    <!-- Loop/infinity icon -->
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                      <path d="M18.178 8c5.096 0 5.096 8 0 8-5.095 0-7.133-8-12.739-8-4.585 0-4.585 8 0 8 5.606 0 7.644-8 12.74-8z" />
                    </svg>
                  </button>
                  <button
                    class="loop-btn"
                    class:active={currentPlaybackMode === 'timelapse' || showTimelapsePopover === item.id}
                    onclick={(e) => { e.stopPropagation(); toggleTimelapsePopover(item.id, e); }}
                    title="Timelapse frame-by-frame"
                  >
                    <!-- Camera icon -->
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                      <circle cx="12" cy="13" r="4"/>
                    </svg>
                  </button>
                {/if}
                {#if 'shaderCode' in item && item.aiGenerated}
                  <button
                    class="edit-btn"
                    onclick={(e) => { e.stopPropagation(); startEditShader(item); }}
                    title="Edit prompt and regenerate"
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                  </button>
                {/if}
                <button
                  class="remove-btn"
                  onclick={async (e) => {
                    e.stopPropagation();
                    const name = ('name' in item ? item.name : 'this item') || 'this item';
                    if (!(await confirmDeleteIfSafeMode(`"${name}" from the tray`, e))) return;
                    removeItem(item);
                  }}
                  title="Remove from tray"
                >
                  x
                </button>
              </div>

            </div>
          {/each}
          </div>
        {:else if section.kind === 'folder'}
          <div class="folder-status">No clips in this folder yet.</div>
        {/if}
      {/each}
    {/if}

    {#if contextMenuOpen && FOLDER_TABS.includes(activeTab as FolderTab)}
      <div
        class="tray-context-menu"
        style="left: {contextMenuX}px; top: {contextMenuY}px;"
        onclick={(e) => e.stopPropagation()}
      >
        {#if folderInputMode}
          <!-- Inline folder name input -->
          <div class="ctx-input-row">
            <input
              type="text"
              class="folder-name-input"
              placeholder={folderInputMode === 'create' ? 'Folder name...' : 'New name...'}
              bind:value={folderInputValue}
              onkeydown={(e) => { if (e.key === 'Enter') confirmFolderInput(); if (e.key === 'Escape') { folderInputMode = null; closeTrayContextMenu(); } }}
              autofocus
            />
            <button class="folder-input-ok" onclick={confirmFolderInput}>OK</button>
          </div>
        {:else}
          {#if activeFolderId && selectedTrayItemIds.length > 0}
            <button class="ctx-btn" onclick={async (e) => {
              const n = selectedTrayItemIds.length;
              if (!(await confirmDeleteIfSafeMode(`${n} ${n === 1 ? 'item' : 'items'} from this folder`, e))) return;
              removeItemsFromFolder(activeFolderId!, selectedTrayItemIds);
            }}>
              Remove from Folder ({selectedTrayItemIds.length})
            </button>
            <div class="ctx-sep"></div>
          {/if}
          {#if selectedTrayItemIds.length > 0}
            <button class="ctx-btn" onclick={createFolderFromSelection}>
              Create New Folder ({selectedTrayItemIds.length} selected)
            </button>
          {:else}
            <span class="ctx-hint">Ctrl/Cmd+click to select, then right-click</span>
          {/if}
          {#if activeTabFolders.length > 0 && selectedTrayItemIds.length > 0}
            <div class="ctx-sep"></div>
            {#each activeTabFolders as folder (folder.id)}
              <button class="ctx-btn" onclick={() => assignItemsToFolder(folder.id, selectedTrayItemIds)}>
                Add to {folder.name}
              </button>
            {/each}
          {/if}
        {/if}
      </div>
    {/if}

    <!-- Folder chip context menu (right-click on folder tab) -->
    {#if folderContextMenuOpen && folderContextMenuId}
      <div
        class="tray-context-menu"
        style="left: {folderContextMenuX}px; top: {folderContextMenuY}px;"
        onclick={(e) => e.stopPropagation()}
      >
        {#if folderInputMode === 'rename'}
          <div class="ctx-input-row">
            <input
              type="text"
              class="folder-name-input"
              placeholder="New name..."
              bind:value={folderInputValue}
              onkeydown={(e) => { if (e.key === 'Enter') { confirmFolderInput(); closeFolderContextMenu(); } if (e.key === 'Escape') { folderInputMode = null; closeFolderContextMenu(); } }}
              autofocus
            />
            <button class="folder-input-ok" onclick={() => { confirmFolderInput(); closeFolderContextMenu(); }}>OK</button>
          </div>
        {:else}
          <button class="ctx-btn" onclick={() => renameFolder(folderContextMenuId!)}>
            Rename Folder
          </button>
          <button class="ctx-btn ctx-btn-danger" onclick={async (e) => {
            const folder = mediaFolders.find(f => f.id === folderContextMenuId);
            const id = folderContextMenuId!;
            closeFolderContextMenu();
            if (!(await confirmDeleteIfSafeMode(`folder "${folder?.name ?? 'this folder'}"`, e))) return;
            deleteFolder(id);
          }}>
            Delete Folder
          </button>
        {/if}
      </div>
    {/if}
  </div>

  <!-- Add Files / Browse Library -->
  <div class="tray-footer">
    <label class="add-btn">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 5v14M5 12h14" />
      </svg>
      Add Files
      <input
        type="file"
        accept="image/*,video/*,.fs,.isf,.html,.htm"
        multiple
        onchange={async (e) => {
          const input = e.target as HTMLInputElement;
          if (input.files) {
            for (const file of input.files) {
              await addMediaFile(file);
            }
          }
          input.value = '';
        }}
        style="display: none;"
      />
    </label>
    <button class="browse-library-btn" onclick={() => showShaderLibrary = true}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
      Shader Library
    </button>
  </div>

  <!-- Shader Library Modal -->
  <ShaderLibrary
    isOpen={showShaderLibrary}
    currentShaderIds={new Set(shaders.map(s => s.id))}
    onClose={() => showShaderLibrary = false}
    on:addShaders={handleLibraryAdd}
    on:addSavedShaders={handleSavedShaderAdd}
  />
</div>

<!-- Fixed-position loop options popover -->
{#if showLoopOptions}
  {@const loopItem = videos.find(i => i.id === showLoopOptions)}
  {#if loopItem}
    <div
      class="loop-options-popover"
      style="left: {loopPopoverPos.x}px; top: {loopPopoverPos.y}px; transform: translate(-50%, -100%);"
      onclick={(e) => e.stopPropagation()}
    >
      <div class="loop-popover-title">Create Seamless Loop</div>
      <div class="loop-opt-row">
        <label>Transition</label>
        <select bind:value={loopTransitionType}>
          {#each LOOP_TRANSITIONS as t}
            <option value={t.value}>{t.label}</option>
          {/each}
        </select>
      </div>
      <div class="loop-opt-row">
        <label>Duration</label>
        <select bind:value={loopCrossfadeDuration}>
          <option value={0.2}>0.2s</option>
          <option value={0.5}>0.5s</option>
          <option value={1.0}>1.0s</option>
          <option value={1.5}>1.5s</option>
          <option value={2.0}>2.0s</option>
          <option value={3.0}>3.0s</option>
        </select>
      </div>
      <button class="loop-create-btn" onclick={() => createLoopFromVideo(loopItem)}>
        Create Loop
      </button>
    </div>
  {/if}
{/if}

<!-- Fixed-position timelapse popover -->
{#if showTimelapsePopover}
  <div
    class="timelapse-popover"
    style="left: {timelapsePopoverPos.x}px; top: {timelapsePopoverPos.y}px; transform: translate(-50%, -100%);"
    onclick={(e) => e.stopPropagation()}
  >
    <div class="timelapse-popover-title">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
        <circle cx="12" cy="13" r="4"/>
      </svg>
      Timelapse Playback
    </div>

    <div class="timelapse-opt-row">
      <label>Interval</label>
      <select bind:value={timelapseInterval}>
        <option value={1}>1s</option>
        <option value={2}>2s</option>
        <option value={3}>3s</option>
        <option value={5}>5s</option>
        <option value={8}>8s</option>
        <option value={10}>10s</option>
        <option value={15}>15s</option>
        <option value={20}>20s</option>
        <option value={25}>25s</option>
        <option value={30}>30s</option>
      </select>
      <span class="timelapse-interval-label">per frame</span>
    </div>

    <div class="timelapse-frame-display">
      <span class="timelapse-frame-current">{timelapseCurrentFrame}</span>
      <span class="timelapse-frame-sep">/</span>
      <span class="timelapse-frame-total">{timelapseTotalFrames}</span>
      <span class="timelapse-frame-label">frames</span>
    </div>

    {#if timelapseTotalFrames > 0}
      <div class="timelapse-progress-bar">
        <div class="timelapse-progress-fill" style="width: {(timelapseCurrentFrame / timelapseTotalFrames) * 100}%"></div>
      </div>
    {/if}

    <div class="timelapse-controls">
      {#if timelapseState === 'idle' || timelapseState === 'paused'}
        <button class="timelapse-ctrl-btn timelapse-start" onclick={startTimelapse} title={timelapseState === 'paused' ? 'Resume' : 'Start'}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
          {timelapseState === 'paused' ? 'Resume' : 'Start'}
        </button>
      {:else}
        <button class="timelapse-ctrl-btn timelapse-pause" onclick={pauseTimelapse} title="Pause">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>
          </svg>
          Pause
        </button>
      {/if}
      <button class="timelapse-ctrl-btn timelapse-stop" onclick={stopTimelapse} title="Stop">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none">
          <rect x="4" y="4" width="16" height="16" rx="2"/>
        </svg>
        Stop
      </button>
    </div>

    {#if timelapseState === 'running'}
      <div class="timelapse-status running">Running — next frame in {timelapseInterval}s</div>
    {:else if timelapseState === 'paused'}
      <div class="timelapse-status paused">Paused at frame {timelapseCurrentFrame}</div>
    {/if}
  </div>
{/if}

<!-- ── Screen / window capture picker modal ──────────────────────────────
  Opens when the Capture button is clicked in the SRC tab. Lists every
  desktopCapturer source (physical displays + open application windows)
  with a thumbnail preview and an app icon for windows. Clicking a tile
  hands the chosen sourceId to getUserMedia + chromeMediaSource so the
  resulting MediaStream is pinned to that surface — same UX as Zoom /
  Slack / OBS.

  Why a custom modal instead of the OS picker: on Windows pre-24H2 and
  macOS pre-15 there isn't a system screen-share picker that Electron
  can delegate to. Building it here gives every supported platform the
  same "Zoom-style" chooser UX.
-->
{#if screenPickerOpen}
  <div
    class="capture-picker-backdrop"
    onclick={closeScreenPicker}
    role="dialog"
    aria-modal="true"
    aria-label="Pick a screen or window to capture"
  >
    <div class="capture-picker-modal" onclick={(e) => e.stopPropagation()} role="document">
      <div class="cpm-header">
        <div class="cpm-title">Capture a screen or window</div>
        <button class="cpm-close" onclick={closeScreenPicker} title="Close">×</button>
      </div>

      {#if screenPickerLoading}
        <div class="cpm-loading">Loading sources…</div>
      {:else if screenPickerSources.length === 0}
        <div class="cpm-empty">
          No capturable sources found. On Linux you may need to grant
          screen-share permission in your desktop environment.
        </div>
      {:else}
        {@const screens = screenPickerSources.filter(s => s.kind === 'screen')}
        {@const windows = screenPickerSources.filter(s => s.kind === 'window')}

        {#if screens.length > 0}
          <div class="cpm-section-title">Screens</div>
          <div class="cpm-grid">
            {#each screens as src (src.id)}
              <button class="cpm-card" onclick={() => pickScreenSource(src)} title={src.name}>
                {#if src.thumbnailDataUrl}
                  <img class="cpm-thumb" src={src.thumbnailDataUrl} alt={src.name} />
                {:else}
                  <div class="cpm-thumb cpm-thumb-empty">No preview</div>
                {/if}
                <div class="cpm-name">{src.name}</div>
              </button>
            {/each}
          </div>
        {/if}

        {#if windows.length > 0}
          <div class="cpm-section-title">Application windows</div>
          <div class="cpm-grid">
            {#each windows as src (src.id)}
              <button class="cpm-card" onclick={() => pickScreenSource(src)} title={src.name}>
                {#if src.thumbnailDataUrl}
                  <img class="cpm-thumb" src={src.thumbnailDataUrl} alt={src.name} />
                {:else}
                  <div class="cpm-thumb cpm-thumb-empty">No preview</div>
                {/if}
                <div class="cpm-name-row">
                  {#if src.appIconDataUrl}
                    <img class="cpm-app-icon" src={src.appIconDataUrl} alt="" />
                  {/if}
                  <div class="cpm-name">{src.name}</div>
                </div>
              </button>
            {/each}
          </div>
        {/if}
      {/if}
    </div>
  </div>
{/if}

<style>
  .tray-toggle {
    position: fixed;
    right: 0;
    top: 50%;
    transform: translateY(-50%);
    background: #333;
    border: none;
    border-radius: 8px 0 0 8px;
    padding: 12px 8px;
    cursor: pointer;
    color: #BB86FC;
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

  .media-tray {
    position: fixed;
    right: -320px;
    top: 48px;
    bottom: 28px;
    width: 320px;
    background: #111114;
    border-left: 1px solid #333;
    display: flex;
    flex-direction: column;
    z-index: 99;
    transition: right 0.3s ease;
  }

  .media-tray.open {
    right: 0;
  }

  .media-tray.embedded {
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
  }

  .tray-header h3 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: #eee;
  }

  .tabs {
    border-bottom: 1px solid #333;
    background: #0d0d10;
  }

  .tab-row {
    display: flex;
    gap: 1px;
    padding: 4px 4px 0;
  }

  .tab {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    background: none;
    border: none;
    padding: 6px 2px 5px;
    color: #666;
    font-size: 9px;
    cursor: pointer;
    transition: all 0.15s;
    border-bottom: 2px solid transparent;
    border-radius: 4px 4px 0 0;
    position: relative;
    min-width: 0;
  }

  .tab svg {
    opacity: 0.6;
    transition: opacity 0.15s;
    flex-shrink: 0;
  }

  .tab span {
    line-height: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }

  .tab:hover {
    color: #ccc;
    background: rgba(255, 255, 255, 0.05);
  }

  .tab:hover svg {
    opacity: 0.9;
  }

  .tab.active {
    color: #BB86FC;
    border-bottom-color: #BB86FC;
    background: rgba(103, 232, 249, 0.06);
  }

  .tab.active svg {
    opacity: 1;
  }

  .tab-count {
    font-size: 8px;
    background: rgba(255, 255, 255, 0.1);
    color: #999;
    padding: 1px 4px;
    border-radius: 6px;
    line-height: 1.2;
    position: absolute;
    top: 2px;
    right: 2px;
    min-width: 14px;
    text-align: center;
  }

  .tab.active .tab-count {
    background: rgba(103, 232, 249, 0.15);
    color: #BB86FC;
  }

  .tab-live {
    font-size: 8px;
    background: rgba(74, 222, 128, 0.2);
    color: #4ade80;
    padding: 1px 4px;
    border-radius: 6px;
    line-height: 1.2;
    position: absolute;
    top: 2px;
    right: 2px;
    min-width: 14px;
    text-align: center;
    animation: pulse-live 2s ease-in-out infinite;
  }

  @keyframes pulse-live {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  /* Global loading indicator */
  .global-loading {
    padding: 8px 12px;
    background: #161618;
    border-bottom: 1px solid #333;
  }

  .global-loading-info {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 10px;
    color: #888;
    margin-bottom: 6px;
  }

  .loading-spinner-inline {
    width: 12px;
    height: 12px;
    border: 2px solid rgba(187, 134, 252, 0.2);
    border-top-color: #BB86FC;
    border-radius: 50%;
    animation: spinner-spin 0.7s linear infinite;
    flex-shrink: 0;
  }

  @keyframes spinner-spin {
    to { transform: rotate(360deg); }
  }

  .global-loading-bar-container {
    width: 100%;
    height: 3px;
    background: #444;
    border-radius: 2px;
    overflow: hidden;
  }

  .global-loading-bar {
    height: 100%;
    background: linear-gradient(90deg, #BB86FC, #69F0AE);
    border-radius: 2px;
    transition: width 0.2s ease-out;
  }

  /* Shader Parameters Panel */
  .shader-params {
    background: #161618;
    border-bottom: 1px solid #333;
    max-height: 250px;
    overflow-y: auto;
  }

  .params-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 12px;
    background: #333;
    position: sticky;
    top: 0;
  }

  .params-header h4 {
    margin: 0;
    font-size: 12px;
    font-weight: 600;
    color: #BB86FC;
  }

  .close-params {
    background: none;
    border: none;
    color: #888;
    font-size: 16px;
    cursor: pointer;
    padding: 0 4px;
  }

  .close-params:hover {
    color: #eee;
  }

  .reset-params {
    background: none;
    border: none;
    color: #7ec8e3;
    font-size: 14px;
    cursor: pointer;
    padding: 0 6px;
    line-height: 1;
    opacity: 0.6;
    margin-right: 2px;
  }
  .reset-params:hover { opacity: 1; }

  /* ─── Per-param auto-automation controls (mapping mode) ─── */
  /* Mirrors VJModePanel exactly so users see the same UI affordances
     in both modes. Compact stack of [play/mode] + [speed] + [range]. */
  .auto-controls {
    margin-top: 4px;
    padding: 6px 8px;
    background: rgba(120, 215, 220, 0.06);
    border-left: 2px solid #5ce1e6;
    border-radius: 0 4px 4px 0;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .auto-row { display: flex; align-items: center; gap: 6px; font-size: 10px; }
  .auto-row-speed input[type='range'], .auto-row-range .auto-range-track { flex: 1; }
  .auto-label { color: rgba(255,255,255,0.55); width: 42px; flex-shrink: 0; text-transform: uppercase; letter-spacing: 0.4px; }
  .auto-val { color: #5ce1e6; font-variant-numeric: tabular-nums; font-size: 10px; min-width: 52px; text-align: right; }
  .auto-play { width: 24px; height: 24px; border-radius: 4px; background: transparent; border: 1px solid rgba(255,255,255,0.18); color: #ccc; font-size: 9px; cursor: pointer; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
  .auto-play.playing { background: rgba(92,225,230,0.18); border-color: #5ce1e6; color: #5ce1e6; }
  .auto-mode-toggle { display: flex; border: 1px solid rgba(255,255,255,0.12); border-radius: 4px; overflow: hidden; }
  .auto-mode-toggle button { background: transparent; border: none; padding: 3px 8px; font-size: 10px; color: rgba(255,255,255,0.5); cursor: pointer; }
  .auto-mode-toggle button.active { background: rgba(92,225,230,0.18); color: #5ce1e6; }
  .auto-speed-slider { accent-color: #5ce1e6; height: 3px; }
  .auto-range-track { position: relative; height: 16px; display: flex; align-items: center; }
  .auto-range-input { position: absolute; inset: 0; width: 100%; accent-color: #5ce1e6; background: transparent; pointer-events: none; }
  .auto-range-input::-webkit-slider-thumb { pointer-events: auto; }
  .auto-range-input::-moz-range-thumb { pointer-events: auto; }

  .params-list {
    padding: 8px 12px;
  }

  .param-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }

  .param-row label {
    font-size: 11px;
    color: #888;
    min-width: 80px;
    max-width: 80px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .param-row input[type="range"] {
    flex: 1;
    accent-color: #BB86FC;
    height: 4px;
  }

  .param-row input[type="checkbox"] {
    accent-color: #BB86FC;
  }

  .param-value {
    font-size: 10px;
    color: #666;
    min-width: 36px;
    text-align: right;
  }

  .param-row.image-input {
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
  }

  .param-row.image-input label {
    max-width: none;
    margin-bottom: 2px;
  }

  .image-select {
    width: 100%;
    background: #333;
    color: #eee;
    border: 1px solid #555;
    padding: 6px 8px;
    border-radius: 4px;
    font-size: 11px;
    cursor: pointer;
  }

  /* Shader param modulation (matches VJ mode pattern) */
  .shader-param {
    padding: 4px 0;
    border-left: 2px solid transparent;
    padding-left: 6px;
    margin-bottom: 6px;
  }
  .shader-param.modulated {
    border-left-color: #a855f7;
    background: rgba(168, 85, 247, 0.05);
    border-radius: 0 4px 4px 0;
  }
  .shader-param-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 4px;
    margin-bottom: 3px;
  }
  .shader-param-name {
    font-size: 11px;
    color: #888;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }
  .mod-source-select {
    font-size: 10px;
    padding: 2px 4px;
    background-color: #0d0d10;
    border: 1px solid #333;
    border-radius: 3px;
    color: #666;
    cursor: pointer;
    max-width: 85px;
  }
  .mod-source-select.active {
    border-color: #a855f7;
    color: #a855f7;
    background: #1a1a2a;
  }
  .shader-param-slider {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .slider-track-wrap {
    position: relative;
    flex: 1;
    min-height: 18px;
    display: flex;
    align-items: center;
  }
  .param-slider {
    flex: 1;
    width: 100%;
    height: 6px;
    accent-color: #BB86FC;
  }
  /* ─── Auto-mode slippers overlay (mapping mode) ─── */
  /* Mirror of VJ panel — two range inputs absolutely positioned
     over the main slider so the slipper 0..1 axis aligns 1:1 with
     input.MIN..input.MAX. Track is invisible; only the cyan thumbs
     show, with a filled bar between them indicating active range. */
  .slipper {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    background: transparent;
    pointer-events: none;
    -webkit-appearance: none;
    appearance: none;
    margin: 0;
  }
  .slipper::-webkit-slider-runnable-track { background: transparent; height: 100%; }
  .slipper::-moz-range-track             { background: transparent; height: 100%; }
  .slipper::-webkit-slider-thumb {
    -webkit-appearance: none;
    pointer-events: auto;
    cursor: ew-resize;
    width: 6px;
    height: 18px;
    border-radius: 2px;
    background: #5ce1e6;
    box-shadow: 0 0 4px rgba(92, 225, 230, 0.5);
    border: none;
  }
  .slipper::-moz-range-thumb {
    pointer-events: auto;
    cursor: ew-resize;
    width: 6px;
    height: 18px;
    border-radius: 2px;
    background: #5ce1e6;
    box-shadow: 0 0 4px rgba(92, 225, 230, 0.5);
    border: none;
  }
  .slipper-fill {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    height: 8px;
    background: rgba(92, 225, 230, 0.18);
    border-top: 1px solid rgba(92, 225, 230, 0.4);
    border-bottom: 1px solid rgba(92, 225, 230, 0.4);
    pointer-events: none;
    z-index: 1;
  }
  .auto-val-grow { min-width: 0; flex: 1; text-align: left; color: #5ce1e6; opacity: 0.75; }
  .param-val {
    font-size: 10px;
    color: #666;
    min-width: 36px;
    text-align: right;
  }
  .param-select {
    flex: 1;
    background-color: #1a1a2e;
    color: #ccc;
    border: 1px solid #333;
    border-radius: 3px;
    padding: 5px 8px;
    font-size: 10px;
    outline: none;
    cursor: pointer;
  }
  .param-select:focus {
    border-color: #BB86FC;
  }
  .param-color {
    width: 40px;
    height: 24px;
    border: 1px solid #444;
    border-radius: 3px;
    padding: 0;
    cursor: pointer;
    background: transparent;
  }
  .mod-amount-row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 6px;
    padding-left: 2px;
  }
  .mod-amount-label {
    font-size: 9px;
    color: #a855f7;
    min-width: 30px;
  }
  .mod-amount-slider {
    flex: 1;
    height: 4px;
    accent-color: #a855f7;
  }
  .mod-amount-val {
    font-size: 8px;
    color: #a855f7;
    min-width: 28px;
    text-align: right;
  }

  .image-select:hover {
    border-color: #BB86FC;
  }

  .image-select:focus {
    outline: none;
    border-color: #BB86FC;
  }

  .media-content {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #666;
    text-align: center;
    padding: 20px;
  }

  .empty-state svg {
    margin-bottom: 12px;
    opacity: 0.5;
  }

  .empty-state p {
    margin: 4px 0;
  }

  .empty-state .hint {
    font-size: 11px;
    color: #555;
  }

  .media-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 4px;
  }

  /* ─── Stacked category toggles ─── */
  .category-stack {
    display: flex;
    flex-direction: column;
    gap: 1px;
    margin-bottom: 10px;
    background: rgba(255, 255, 255, 0.03);
    border-radius: 6px;
    overflow: hidden;
  }

  .category-toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 7px 12px;
    background: #16161b;
    border: none;
    color: #8a8ea0;
    font-size: 11px;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
    border-left: 3px solid transparent;
  }

  .category-toggle:hover {
    background: #1e1e28;
    color: #c8cad8;
  }

  .category-toggle.active {
    background: #1a1a2e;
    color: #67E8F9;
    border-left-color: #67E8F9;
  }

  .category-toggle.user-folder {
    border-left-color: rgba(168, 85, 247, 0.2);
  }

  .category-toggle.user-folder.active {
    color: #a855f7;
    border-left-color: #a855f7;
    background: rgba(168, 85, 247, 0.08);
  }

  .category-toggle.user-folder:hover {
    border-left-color: rgba(168, 85, 247, 0.4);
  }

  .category-toggle.drag-over {
    border-top: 2px solid #a855f7;
  }

  .category-sep {
    height: 1px;
    background: #2a2f3b;
    margin: 4px 8px;
  }

  .category-name {
    font-weight: 500;
  }

  .category-count {
    font-size: 10px;
    color: #555;
    font-variant-numeric: tabular-nums;
    min-width: 22px;
    text-align: right;
  }

  .category-toggle.active .category-count {
    color: rgba(103, 232, 249, 0.5);
  }

  .folder-bar {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-bottom: 8px;
  }

  .folder-chip {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 1px solid #3f3f49;
    background: #1a1a22;
    color: #a0a4b8;
    border-radius: 999px;
    padding: 4px 10px;
    font-size: 11px;
    cursor: pointer;
  }

  .folder-chip:hover {
    border-color: #67E8F9;
    color: #d8f9ff;
  }

  .folder-chip.active {
    border-color: #67E8F9;
    color: #67E8F9;
    background: rgba(103, 232, 249, 0.12);
  }

  .folder-chip.active::after {
    content: '';
    position: absolute;
    left: 8px;
    right: 8px;
    bottom: -6px;
    height: 2px;
    border-radius: 999px;
    background: #67E8F9;
    opacity: 0.95;
  }

  .folder-chip-icon {
    font-weight: 700;
    min-width: 10px;
    text-align: center;
  }

  .folder-status {
    font-size: 11px;
    color: #9cb4c2;
    margin: 0 0 8px 2px;
  }

  .folder-open-divider {
    height: 1px;
    margin: 4px 0 8px;
    background: rgba(103, 232, 249, 0.75);
  }

  .all-clips-label {
    opacity: 0.95;
  }

  .media-item {
    position: relative;
    aspect-ratio: 4/3;
    background: #333;
    border-radius: 4px;
    overflow: hidden;
    cursor: pointer;
    transition: all 0.15s;
    border: 2px solid transparent;
  }

  .media-item:hover {
    transform: scale(1.02);
    border-color: #BB86FC;
  }

  .media-item.selected {
    border-color: #BB86FC;
    box-shadow: 0 0 8px #BB86FC66;
  }

  .media-item.drag-over-reorder {
    border-color: #6eb5ff;
    box-shadow: 0 0 8px rgba(110,181,255,0.4);
    transform: scale(0.95);
  }

  .media-item.item-selected {
    border-color: #67E8F9;
    box-shadow: 0 0 10px rgba(103, 232, 249, 0.45);
  }

  .media-item img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .tray-context-menu {
    position: fixed;
    z-index: 9000;
    min-width: 190px;
    background: #14161d;
    border: 1px solid #2c3240;
    border-radius: 8px;
    padding: 6px;
    box-shadow: 0 12px 30px rgba(0, 0, 0, 0.45);
  }

  .ctx-btn {
    width: 100%;
    text-align: left;
    border: none;
    background: transparent;
    color: #d7d9e0;
    padding: 8px 10px;
    border-radius: 6px;
    font-size: 12px;
    cursor: pointer;
  }

  .ctx-btn:hover {
    background: rgba(103, 232, 249, 0.12);
    color: #e8feff;
  }

  .ctx-hint {
    display: block;
    padding: 6px 10px;
    font-size: 10px;
    color: #555;
    font-style: italic;
  }

  .ctx-input-row {
    display: flex;
    gap: 4px;
    padding: 6px 8px;
  }
  .folder-name-input {
    flex: 1;
    background: var(--bg-primary, #0d0d1a);
    border: 1px solid var(--accent-primary, #a855f7);
    color: var(--text-primary, #e0e0e0);
    padding: 3px 6px;
    font-size: 11px;
    border-radius: 3px;
    outline: none;
  }
  .folder-input-ok {
    background: var(--accent-primary, #a855f7);
    color: #fff;
    border: none;
    padding: 2px 8px;
    font-size: 10px;
    font-weight: 600;
    border-radius: 3px;
    cursor: pointer;
  }
  .folder-input-cancel {
    background: transparent;
    color: var(--text-muted, #666);
    border: 1px solid var(--border, #333);
    padding: 2px 6px;
    font-size: 10px;
    border-radius: 3px;
    cursor: pointer;
  }

  .ctx-btn-danger:hover {
    background: rgba(239, 68, 68, 0.15) !important;
    color: #ef4444 !important;
  }

  .ctx-sep {
    height: 1px;
    background: #2a2f3b;
    margin: 6px 4px;
  }

  .shader-icon {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #ff00aa33, #BB86FC33);
    color: #fff;
  }

  .shader-icon.loading {
    background: linear-gradient(135deg, #222, #333);
    flex-direction: column;
    gap: 8px;
  }

  .loading-bar-container {
    width: 70%;
    height: 4px;
    background: #444;
    border-radius: 2px;
    overflow: hidden;
  }

  .loading-bar {
    height: 100%;
    background: linear-gradient(90deg, #BB86FC, #69F0AE);
    border-radius: 2px;
    transition: width 0.15s ease-out;
  }

  .loading-text {
    font-size: 9px;
    color: #666;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .shader-placeholder-text {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 1px;
    color: #BB86FC;
    opacity: 0.8;
  }

  .shader-thumb {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .shader-load-badge {
    position: absolute;
    top: 4px;
    left: 4px;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 9px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.2px;
    color: #111;
    border: 1px solid rgba(0, 0, 0, 0.25);
    text-shadow: none;
    z-index: 6;
    pointer-events: auto;
  }

  .shader-load-badge.low {
    background: #7ee787;
  }

  .shader-load-badge.medium {
    background: #f2cc60;
  }

  .shader-load-badge.high {
    background: #ff9a5a;
  }

  .shader-load-badge.extreme {
    background: #ff6b6b;
  }

  .shader-load-badge.library {
    top: 6px;
    left: 6px;
  }

  .placeholder-thumb {
    width: 100%;
    height: 100%;
    background: #444;
  }

  .item-name {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 2px 4px;
    background: rgba(0, 0, 0, 0.8);
    color: #eee;
    font-size: 9px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .user-badge {
    display: inline-block;
    color: #5db4ff;
    font-weight: bold;
    margin-right: 3px;
    font-size: 12px;
    line-height: 0;
    vertical-align: middle;
  }

  .cloud-badge {
    display: inline-block;
    color: #c08cff;
    font-weight: bold;
    margin-right: 3px;
    font-size: 12px;
    line-height: 0;
    vertical-align: middle;
  }

  .find-latest-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    background: rgba(192, 140, 255, 0.12);
    color: #c08cff;
    border: 1px solid rgba(192, 140, 255, 0.4);
    border-radius: 4px;
    font-size: 11px;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }
  .find-latest-btn:hover:not(:disabled) {
    background: rgba(192, 140, 255, 0.22);
    border-color: rgba(192, 140, 255, 0.7);
  }
  .find-latest-btn:disabled {
    opacity: 0.55;
    cursor: default;
  }
  .find-latest-btn .spin {
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* Action buttons container */
  .item-actions {
    position: absolute;
    top: 4px;
    right: 4px;
    display: flex;
    gap: 4px;
    opacity: 0;
    transition: opacity 0.15s;
  }

  .media-item:hover .item-actions {
    opacity: 1;
  }

  .remove-btn {
    width: 20px;
    height: 20px;
    background: rgba(255, 0, 0, 0.8);
    border: none;
    border-radius: 50%;
    color: #fff;
    font-size: 12px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .remove-btn:hover {
    background: rgba(255, 0, 0, 1);
  }

  .edit-btn {
    width: 20px;
    height: 20px;
    background: rgba(103, 232, 249, 0.9);
    border: none;
    border-radius: 50%;
    color: #000;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
  }

  .edit-btn:hover {
    background: rgba(103, 232, 249, 1);
    transform: scale(1.1);
  }

  .loop-btn {
    width: 20px;
    height: 20px;
    background: rgba(103, 232, 249, 0.9);
    border: none;
    border-radius: 50%;
    color: #000;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
  }

  .loop-btn:hover:not(:disabled) {
    background: rgba(103, 232, 249, 1);
    transform: scale(1.1);
  }

  .loop-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .loop-btn.active {
    background: rgba(103, 232, 249, 1);
    box-shadow: 0 0 8px rgba(103, 232, 249, 0.5);
  }

  :global(.loop-options-popover) {
    position: fixed;
    z-index: 9999;
    background: #0d0d10;
    border: 1px solid #555;
    border-radius: 8px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 200px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.7);
  }

  :global(.loop-popover-title) {
    font-size: 11px;
    font-weight: 600;
    color: #BB86FC;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 2px;
  }

  :global(.loop-opt-row) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  :global(.loop-opt-row label) {
    font-size: 11px;
    color: #aaa;
    white-space: nowrap;
  }

  :global(.loop-opt-row select) {
    background-color: #161618;
    border: 1px solid #444;
    color: #ddd;
    font-size: 11px;
    padding: 3px 6px;
    border-radius: 4px;
    cursor: pointer;
    flex: 1;
    min-width: 0;
  }

  :global(.loop-opt-row select:focus) {
    outline: none;
    border-color: #BB86FC;
  }

  :global(.loop-create-btn) {
    background: #BB86FC;
    border: none;
    color: #000;
    font-size: 11px;
    font-weight: 600;
    padding: 6px 12px;
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.15s;
  }

  :global(.loop-create-btn:hover) {
    background: #5dd3e3;
  }

  /* ==========================================
     TIMELAPSE POPOVER (fixed position, :global)
     ========================================== */
  :global(.timelapse-popover) {
    position: fixed;
    z-index: 9999;
    background: #0d0d10;
    border: 1px solid #444;
    border-radius: 8px;
    padding: 12px;
    width: 220px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
  }

  :global(.timelapse-popover-title) {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    font-weight: 600;
    color: #eee;
    margin-bottom: 10px;
    padding-bottom: 8px;
    border-bottom: 1px solid #333;
  }

  :global(.timelapse-popover-title svg) {
    color: #BB86FC;
  }

  :global(.timelapse-opt-row) {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 10px;
  }

  :global(.timelapse-opt-row label) {
    font-size: 10px;
    color: #999;
    min-width: 45px;
  }

  :global(.timelapse-opt-row select) {
    flex: 1;
    background-color: #161618;
    border: 1px solid #444;
    border-radius: 4px;
    color: #eee;
    padding: 4px 6px;
    font-size: 11px;
    cursor: pointer;
  }

  :global(.timelapse-opt-row select:focus) {
    border-color: #BB86FC;
    outline: none;
  }

  :global(.timelapse-interval-label) {
    font-size: 9px;
    color: #666;
    white-space: nowrap;
  }

  :global(.timelapse-frame-display) {
    display: flex;
    align-items: baseline;
    justify-content: center;
    gap: 3px;
    padding: 8px;
    background: #111;
    border-radius: 6px;
    margin-bottom: 8px;
    font-family: 'Courier New', monospace;
  }

  :global(.timelapse-frame-current) {
    font-size: 18px;
    font-weight: 700;
    color: #BB86FC;
  }

  :global(.timelapse-frame-sep) {
    font-size: 14px;
    color: #555;
  }

  :global(.timelapse-frame-total) {
    font-size: 14px;
    color: #888;
  }

  :global(.timelapse-frame-label) {
    font-size: 9px;
    color: #555;
    margin-left: 4px;
  }

  :global(.timelapse-progress-bar) {
    width: 100%;
    height: 3px;
    background: #333;
    border-radius: 2px;
    overflow: hidden;
    margin-bottom: 10px;
  }

  :global(.timelapse-progress-fill) {
    height: 100%;
    background: #BB86FC;
    border-radius: 2px;
    transition: width 0.3s ease;
  }

  :global(.timelapse-controls) {
    display: flex;
    gap: 6px;
    margin-bottom: 6px;
  }

  :global(.timelapse-ctrl-btn) {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 6px 8px;
    border: 1px solid #444;
    border-radius: 5px;
    font-size: 10px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
    background: #161618;
    color: #ccc;
  }

  :global(.timelapse-ctrl-btn:hover) {
    border-color: #BB86FC;
  }

  :global(.timelapse-start) {
    background: rgba(103, 232, 249, 0.15);
    color: #BB86FC;
    border-color: rgba(103, 232, 249, 0.4);
  }

  :global(.timelapse-start:hover) {
    background: rgba(103, 232, 249, 0.3);
  }

  :global(.timelapse-pause) {
    background: rgba(250, 204, 21, 0.15);
    color: #facc15;
    border-color: rgba(250, 204, 21, 0.4);
  }

  :global(.timelapse-pause:hover) {
    background: rgba(250, 204, 21, 0.3);
  }

  :global(.timelapse-stop) {
    background: rgba(239, 68, 68, 0.15);
    color: #ef4444;
    border-color: rgba(239, 68, 68, 0.3);
  }

  :global(.timelapse-stop:hover) {
    background: rgba(239, 68, 68, 0.3);
  }

  :global(.timelapse-status) {
    text-align: center;
    font-size: 9px;
    padding: 4px;
    border-radius: 4px;
  }

  :global(.timelapse-status.running) {
    color: #4ade80;
    background: rgba(74, 222, 128, 0.1);
  }

  :global(.timelapse-status.paused) {
    color: #facc15;
    background: rgba(250, 204, 21, 0.1);
  }

  /* Loop progress overlay */
  .loop-progress-overlay {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.85);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10;
    border-radius: 4px;
  }

  .loop-progress-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 8px;
  }

  .loop-spinner {
    color: #BB86FC;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .loop-progress-text {
    font-size: 9px;
    color: #ccc;
    text-align: center;
    max-width: 100px;
  }

  .loop-progress-bar-container {
    width: 80px;
    height: 3px;
    background: #444;
    border-radius: 2px;
    overflow: hidden;
  }

  .loop-progress-bar {
    height: 100%;
    background: linear-gradient(90deg, #BB86FC, #69F0AE);
    border-radius: 2px;
    transition: width 0.2s ease-out;
  }

  .media-item.processing {
    border-color: #BB86FC;
    box-shadow: 0 0 12px #BB86FC66;
  }

  .tray-footer {
    padding: 12px;
    border-top: 1px solid #333;
  }

  .add-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
    padding: 10px;
    background: #BB86FC;
    color: #000;
    border: none;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
  }

  .add-btn:hover {
    background: #69F0AE;
  }

  .browse-library-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    width: 100%;
    padding: 8px;
    margin-top: 6px;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 6px;
    color: #aaa;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
  }
  .browse-library-btn:hover {
    background: rgba(255,133,119,0.1);
    border-color: rgba(255,133,119,0.3);
    color: #FF8577;
  }

  /* AI Generator Section */
  .ai-generator-section {
    padding: 8px 12px;
    border-bottom: 1px solid #333;
    display: flex;
    gap: 6px;
  }

  .ai-generate-btn {
    flex: 1;
    padding: 8px 10px;
    background: linear-gradient(135deg, #1a1a2e, #16213e);
    border: 1px solid #333;
    border-radius: 6px;
    color: #BB86FC;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    transition: all 0.2s;
  }

  .ai-generate-btn:hover {
    background: linear-gradient(135deg, #1f1f3a, #1a2745);
    border-color: #BB86FC;
    box-shadow: 0 0 12px rgba(103, 232, 249, 0.2);
  }

  .ai-video-btn {
    color: #ff80dd;
  }
  .ai-video-btn:hover {
    border-color: #ff80dd;
    box-shadow: 0 0 12px rgba(255, 128, 221, 0.2);
  }

  .ai-generate-btn svg {
    animation: pulse-glow 2s ease-in-out infinite;
  }

  @keyframes pulse-glow {
    0%, 100% { opacity: 0.7; }
    50% { opacity: 1; }
  }

  .ai-generator-container {
    border-bottom: 1px solid #333;
    max-height: 500px;
    overflow-y: auto;
  }

  /* JS Filter Row */
  .js-filter-row {
    display: flex;
    gap: 4px;
    padding: 8px 12px;
    background: #0d0d10;
    border-bottom: 1px solid #333;
  }

  .js-filter-btn {
    flex: 1;
    padding: 6px 8px;
    background: #111114;
    border: 1px solid #333;
    border-radius: 4px;
    color: #888;
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .js-filter-btn:hover {
    background: #161618;
    color: #fff;
  }

  .js-filter-btn.active {
    background: #333;
    border-color: #BB86FC;
    color: #BB86FC;
  }

  /* JS Animation Items */
  .media-item.js-item {
    border: 2px solid transparent;
  }

  .media-item.js-item.threejs {
    border-color: #f0db4f33;
  }

  .media-item.js-item.p5js {
    border-color: #ed225d33;
  }

  .media-item.js-item:hover.threejs {
    border-color: #f0db4f;
  }

  .media-item.js-item:hover.p5js {
    border-color: #ed225d;
  }

  .js-icon {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
  }

  .js-icon.threejs {
    color: #f0db4f;
    background: linear-gradient(135deg, #2d2d1a, #1a1a0d);
  }

  .js-icon.p5js {
    color: #ed225d;
    background: linear-gradient(135deg, #2d1a22, #1a0d11);
  }

  .ai-badge {
    position: absolute;
    top: 4px;
    right: 4px;
    background: linear-gradient(135deg, #BB86FC, #A78BFA);
    color: #000;
    font-size: 8px;
    font-weight: 700;
    padding: 2px 4px;
    border-radius: 3px;
  }

  .js-type-badge {
    position: absolute;
    bottom: 20px;
    left: 4px;
    background: rgba(0, 0, 0, 0.7);
    color: #888;
    font-size: 8px;
    font-weight: 600;
    padding: 2px 4px;
    border-radius: 2px;
  }

  /* Library Grid Styles */
  .library-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 12px;
    padding: 8px 0;
  }

  .library-item {
    background: #161618;
    border-radius: 8px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    border: 2px solid transparent;
    transition: all 0.15s;
  }

  .library-item:hover {
    border-color: #BB86FC;
    transform: translateY(-2px);
  }

  .library-item.isf {
    border-color: #ff00aa44;
  }

  .library-item.threejs {
    border-color: #BB86FC44;
  }

  .library-item.p5js {
    border-color: #ffaa0044;
  }

  .library-item-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 4px 8px;
    background: #0d0d10;
    font-size: 9px;
  }

  .library-type-badge {
    font-weight: 600;
    color: #BB86FC;
  }

  .library-item.isf .library-type-badge {
    color: #ff00aa;
  }

  .library-item.threejs .library-type-badge {
    color: #BB86FC;
  }

  .library-item.p5js .library-type-badge {
    color: #ffaa00;
  }

  .library-date {
    color: #666;
  }

  .library-thumb {
    width: 100%;
    height: 70px;
    object-fit: cover;
  }

  .library-preview {
    position: relative;
    width: 100%;
    height: 70px;
  }

  .library-icon {
    width: 100%;
    height: 70px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #222, #333);
    color: #555;
  }

  .library-item.isf .library-icon {
    background: linear-gradient(135deg, #ff00aa22, #22002a);
  }

  .library-item.threejs .library-icon {
    background: linear-gradient(135deg, #BB86FC22, #002a22);
  }

  .library-item.p5js .library-icon {
    background: linear-gradient(135deg, #ffaa0022, #2a2200);
  }

  .library-name {
    padding: 6px 8px 2px;
    font-size: 11px;
    font-weight: 500;
    color: #eee;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .library-desc {
    padding: 0 8px 6px;
    font-size: 9px;
    color: #888;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
  }

  .library-actions {
    display: flex;
    gap: 4px;
    padding: 6px 8px;
    border-top: 1px solid #333;
    background: #0d0d10;
  }

  .library-load-btn {
    flex: 1;
    padding: 6px 10px;
    background: linear-gradient(135deg, #BB86FC, #69F0AE);
    border: none;
    border-radius: 4px;
    color: #000;
    font-size: 10px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }

  .library-load-btn:hover {
    transform: scale(1.02);
    box-shadow: 0 2px 8px #BB86FC44;
  }

  .library-delete-btn {
    padding: 6px 8px;
    background: #333;
    border: none;
    border-radius: 4px;
    color: #888;
    cursor: pointer;
    transition: all 0.15s;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .library-delete-btn:hover {
    background: #ff4444;
    color: #fff;
  }

  .library-section-label {
    font-size: 11px;
    font-weight: 600;
    color: #888;
    padding: 8px 0 4px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .video-badge {
    color: #f472b6 !important;
  }

  .video-item {
    border-color: #f472b644;
  }

  .video-item .library-icon {
    background: linear-gradient(135deg, #f472b622, #2a001a);
  }

  /* Playback mode controls removed — camera icon moved to item-actions */

  /* ==========================================
     PLUGINS TAB
     ========================================== */

  .plugins-panel {
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .plugins-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 4px;
  }

  .plugins-title {
    font-size: 11px;
    font-weight: 600;
    color: #aaa;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .plugins-hint {
    font-size: 10px;
    color: #666;
  }

  .plugins-grid {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .plugin-card {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px;
    background: #0d0d10;
    border: 1px solid #333;
    border-radius: 8px;
    transition: all 0.2s;
    cursor: pointer;
    text-align: left;
    width: 100%;
  }

  .plugin-card:hover:not(:disabled) {
    border-color: #BB86FC;
    background: #1a1a2e;
    box-shadow: 0 0 12px rgba(187, 134, 252, 0.15);
  }

  .plugin-card:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .plugin-card.running {
    border-color: #22c55e;
    background: rgba(34, 197, 94, 0.08);
    position: relative;
  }

  .plugin-status-dot {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 8px;
    height: 8px;
    background: #22c55e;
    border-radius: 50%;
    box-shadow: 0 0 6px rgba(34, 197, 94, 0.6);
    animation: pulse-dot 2s infinite;
  }

  @keyframes pulse-dot {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .plugin-preview {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    border-radius: 8px;
    flex-shrink: 0;
  }

  .plugin-icon-emoji {
    font-size: 22px;
    filter: drop-shadow(0 0 4px rgba(255,255,255,0.3));
  }

  .plugin-icon-svg {
    color: rgba(255,255,255,0.9);
    filter: drop-shadow(0 0 6px rgba(187, 134, 252, 0.4));
  }

  .plugin-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .plugin-name {
    font-size: 13px;
    font-weight: 600;
    color: #fff;
  }

  .plugin-desc {
    font-size: 9px;
    color: #888;
    line-height: 1.3;
  }

  .plugin-tier {
    font-size: 8px;
    color: #BB86FC;
    letter-spacing: 0.5px;
    margin-top: 2px;
  }

  .plugins-hint-footer {
    font-size: 10px;
    color: #555;
    text-align: center;
    padding: 8px;
    font-style: italic;
  }

  /* plugins-warning removed — plugins are now integrated */

  .spin {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  /* ==========================================
     SOURCES TAB
     ========================================== */

  .sources-panel {
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .sources-add-row {
    display: flex;
    gap: 6px;
  }

  .source-add-btn {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 10px 4px;
    background: #0d0d10;
    border: 1px solid #333;
    border-radius: 6px;
    color: #aaa;
    font-size: 10px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .source-add-btn:hover {
    border-color: #BB86FC;
    color: #BB86FC;
    background: #1a2a2d;
  }

  .source-add-btn.spout {
    border-color: #444;
  }

  .source-add-btn.spout:hover,
  .source-add-btn.spout.active {
    border-color: #a78bfa;
    color: #a78bfa;
    background: #1e1a2d;
  }

  .spout-picker {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    background: #0d0d10;
    border: 1px solid #333;
    border-radius: 6px;
  }

  .spout-sender-list {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .spout-sender-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    background: #222;
    border: 1px solid #333;
    border-radius: 4px;
    color: #ccc;
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s;
    text-align: left;
  }

  .spout-sender-btn:hover {
    border-color: #a78bfa;
    color: #a78bfa;
    background: #1e1a2d;
  }

  .spout-no-senders {
    padding: 12px;
    text-align: center;
    color: #888;
  }

  .spout-no-senders p {
    margin: 0 0 4px 0;
    font-size: 11px;
  }

  .spout-no-senders .hint {
    color: #666;
    font-size: 10px;
  }

  .spout-refresh-btn {
    margin-top: 8px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 6px 12px;
    background: #333;
    border: 1px solid #444;
    border-radius: 4px;
    color: #aaa;
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .spout-refresh-btn:hover {
    background: #444;
    border-color: #a78bfa;
    color: #fff;
  }

  /* Removed manual entry - keeping for reference if needed later
  .spout-manual-row {
    display: flex;
    gap: 4px;
  }

  .spout-name-input {
    flex: 1;
    background: #222;
    border: 1px solid #333;
    border-radius: 4px;
    color: #ccc;
    padding: 6px 8px;
    font-size: 11px;
  }

  .spout-name-input:focus {
    outline: none;
    border-color: #a78bfa;
  }

  .spout-connect-btn {
    padding: 6px 10px;
    background: #a78bfa20;
    border: 1px solid #a78bfa;
    border-radius: 4px;
    color: #a78bfa;
    font-size: 10px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }

  .spout-connect-btn:disabled {
    opacity: 0.3;
    cursor: default;
  }

  .spout-connect-btn:not(:disabled):hover {
    background: #a78bfa40;
  }
  */

  .webcam-picker {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .picker-label {
    font-size: 10px;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .device-select {
    background: #0d0d10;
    border: 1px solid #333;
    border-radius: 4px;
    color: #ccc;
    padding: 6px 8px;
    font-size: 11px;
  }

  .sources-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .source-card {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px;
    background: #0d0d10;
    border: 1px solid #333;
    border-radius: 8px;
    transition: all 0.2s;
  }

  .source-card.live {
    border-color: #22c55e40;
  }

  .source-card.connecting {
    border-color: #f5920040;
  }

  .source-preview {
    width: 56px;
    height: 36px;
    border-radius: 4px;
    overflow: hidden;
    background: #111;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .source-video-preview {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .source-icon {
    color: #555;
  }

  .source-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .source-name {
    font-size: 11px;
    color: #ddd;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .source-status {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 10px;
    color: #888;
  }

  .status-dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #555;
  }

  .status-dot.live {
    background: #22c55e;
    box-shadow: 0 0 6px #22c55e80;
  }

  .status-dot.connecting {
    background: #f59e0b;
    animation: pulse-dot 1.2s infinite;
  }

  @keyframes pulse-dot {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  .source-actions {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
  }

  .source-apply-btn,
  .source-stop-btn {
    width: 28px;
    height: 28px;
    border-radius: 4px;
    border: 1px solid #333;
    background: #161618;
    color: #aaa;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.15s;
  }

  .source-apply-btn:hover {
    border-color: #BB86FC;
    color: #BB86FC;
    background: #1a2a2d;
  }

  .source-stop-btn:hover {
    border-color: #f44;
    color: #f44;
    background: #2d1a1a;
  }

  /* ── Capture chooser modal ─────────────────────────────────────── */

  .capture-picker-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.78);
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
    backdrop-filter: blur(4px);
  }

  .capture-picker-modal {
    background: #141418;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    width: 92vw;
    max-width: 1100px;
    height: 80vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
    color: #e8e8ea;
  }

  .cpm-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .cpm-title {
    font-size: 14px;
    font-weight: 600;
    letter-spacing: 0.2px;
  }

  .cpm-close {
    background: transparent;
    color: #aaa;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 4px;
    width: 28px;
    height: 28px;
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
  }

  .cpm-close:hover {
    color: #fff;
    border-color: rgba(255, 255, 255, 0.3);
  }

  .cpm-loading,
  .cpm-empty {
    padding: 40px;
    text-align: center;
    color: #888;
    font-size: 13px;
  }

  .cpm-section-title {
    padding: 16px 18px 6px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 1.1px;
    color: #888;
  }

  .cpm-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 12px;
    padding: 6px 18px 18px;
    overflow-y: auto;
  }

  .capture-picker-modal > .cpm-grid:last-child {
    flex: 1 1 auto;       /* the last grid scrolls; earlier sections are static */
  }

  .cpm-card {
    background: #1c1c22;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 6px;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    cursor: pointer;
    text-align: left;
    color: inherit;
    transition: border-color 120ms, background 120ms;
  }

  .cpm-card:hover {
    border-color: #BB86FC;
    background: #1f1c2a;
  }

  .cpm-thumb {
    width: 100%;
    aspect-ratio: 16 / 9;
    object-fit: cover;
    background: #0a0a0c;
    border-radius: 4px;
    display: block;
  }

  .cpm-thumb-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    color: #555;
    font-size: 11px;
  }

  .cpm-name-row {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .cpm-app-icon {
    width: 16px;
    height: 16px;
    flex: 0 0 16px;
    object-fit: contain;
  }

  .cpm-name {
    font-size: 12px;
    color: #d8d8dc;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1 1 auto;
    min-width: 0;
  }
</style>
