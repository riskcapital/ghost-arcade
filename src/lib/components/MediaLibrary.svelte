<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { project, selectedLayerId } from '../stores/layers';
  import { confirmDeleteIfSafeMode } from '../utils/safeMode';
  import type { MediaSource, JSAnimationSource } from '../types';
  import { generateUUID } from '../types';
  import { createAssetRefFromFile } from '../storage/assetRegistry';
  import AIShaderGenerator from './AIShaderGenerator.svelte';

  // Library state
  let libraryItems: MediaSource[] = [];
  let activeTab: 'images' | 'videos' | 'shaders' | 'js' | 'threejs' = 'images';
  let isExpanded = true;
  let showAIGenerator = false;

  // JS animation filter (for JS tab)
  let jsFilter: 'all' | 'threejs' | 'p5js' = 'all';
  let searchQuery = '';

  // Three.js items (built-in)
  interface ThreeJSItem {
    id: string;
    name: string;
    src: string;
    thumbnail?: string;
  }

  // Default Three.js items that ship with every build. Located under
  // /public/threejs/<name>/index.html so vite copies them into dist.
  // The apply-to-layer path fetches the HTML and routes through the
  // JS-animation pipeline so they get the same shim injection + param
  // slider UI that user-uploaded HTML gets.
  const defaultThreeJSItems: ThreeJSItem[] = [
    {
      id: 'threejs-embryo',
      name: 'Embryo',
      src: '/threejs/embryo/index.html',
      thumbnail: undefined, // generated on mount
    },
  ];

  let threejsItems: ThreeJSItem[] = [...defaultThreeJSItems];

  // Generate thumbnail from Three.js iframe
  async function generateThreeJSThumbnail(src: string): Promise<string | undefined> {
    return new Promise((resolve) => {
      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'position: absolute; left: -9999px; top: -9999px; width: 320px; height: 180px; border: none;';
      iframe.src = src;
      document.body.appendChild(iframe);

      // Give it time to render
      setTimeout(() => {
        try {
          const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
          if (iframeDoc) {
            const iframeCanvas = iframeDoc.querySelector('canvas');
            if (iframeCanvas) {
              const thumbCanvas = document.createElement('canvas');
              thumbCanvas.width = 160;
              thumbCanvas.height = 90;
              const ctx = thumbCanvas.getContext('2d');
              if (ctx) {
                ctx.drawImage(iframeCanvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
                resolve(thumbCanvas.toDataURL('image/jpeg', 0.7));
              } else {
                resolve(undefined);
              }
            } else {
              resolve(undefined);
            }
          } else {
            resolve(undefined);
          }
        } catch (err) {
          // Cross-origin or other error
          console.warn('Could not generate Three.js thumbnail:', err);
          resolve(undefined);
        } finally {
          document.body.removeChild(iframe);
        }
      }, 2000); // Wait 2 seconds for Three.js to render
    });
  }

  // Load Three.js thumbnails on mount
  onMount(async () => {
    // Generate thumbnails in background
    for (let i = 0; i < threejsItems.length; i++) {
      const item = threejsItems[i];
      if (!item.thumbnail) {
        const thumbnail = await generateThreeJSThumbnail(item.src);
        if (thumbnail) {
          threejsItems[i] = { ...item, thumbnail };
          threejsItems = [...threejsItems]; // Trigger reactivity
        }
      }
    }
  });

  // Drag state
  let draggedItem: MediaSource | null = null;

  function handleFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = input.files;
    if (!files) return;

    for (const file of files) {
      addFileToLibrary(file);
    }
    input.value = '';
  }

  function addFileToLibrary(file: File) {
    // Capture an AssetRef so the library entry survives save/reload. Without
    // this the URL is a blob: that dies at session end and the library item
    // becomes unresolvable.
    const { assetRef, runtimeUrl: url } = createAssetRefFromFile(file);
    const isVideo = file.type.startsWith('video/');

    const item: MediaSource = {
      id: generateUUID(),
      type: isVideo ? 'video' : 'image',
      src: url,
      name: file.name,
      _assetRef: assetRef,
    };

    if (isVideo) {
      const video = document.createElement('video');
      video.src = url;
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      video.preload = 'metadata';
      item.videoElement = video;
    }

    libraryItems = [...libraryItems, item];
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    const files = e.dataTransfer?.files;
    if (!files) return;

    for (const file of files) {
      addFileToLibrary(file);
    }
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
  }

  async function removeFromLibrary(id: string, event?: MouseEvent) {
    const item = libraryItems.find(i => i.id === id);
    // Safe Mode: confirm before nuking media-library entries. The × is
    // tiny and easy to misclick when scanning thumbnails. The click event
    // is passed through so the in-app popover anchors right at the ×.
    if (!(await confirmDeleteIfSafeMode(item ? `"${item.name}" from the media library` : 'this media item', event))) return;
    if (item) {
      URL.revokeObjectURL(item.src);
      if (item.videoElement) {
        item.videoElement.pause();
        item.videoElement.src = '';
      }
    }
    libraryItems = libraryItems.filter(i => i.id !== id);
  }

  function updateLibraryItem(id: string, updates: Partial<MediaSource>) {
    libraryItems = libraryItems.map(i => i.id === id ? { ...i, ...updates } : i);
  }

  // Apply media to selected layer
  function applyToLayer(item: MediaSource) {
    if (!$selectedLayerId) return;

    // Create a fresh copy for the layer
    const layerSource: MediaSource = {
      id: generateUUID(),
      type: item.type,
      src: item.src,
      name: item.name,
      _assetRef: (item as any)._assetRef,
    };

    if (item.type === 'video') {
      // Reuse the library item's existing <video> element. See community
      // fix: pre-fix every apply-to-layer click made a fresh element +
      // fresh load, racing 4+ in-flight loads on rapid back-and-forth.
      let video = item.videoElement as HTMLVideoElement | undefined;
      if (!video) {
        video = document.createElement('video');
        video.src = item.src;
        item.videoElement = video;
        libraryItems = libraryItems.map(i => i.id === item.id ? { ...i, videoElement: video } : i);
      }
      // Pause whatever video was previously bound to this layer so it
      // doesn't keep decoding in the background. The decoder budget is
      // shared across all <video> elements; a stack of "still playing
      // but offscreen" clips thrashes the GPU.
      const prevLayer = $project.layers.find((l) => l.id === $selectedLayerId);
      const prevVideo = (prevLayer?.source as any)?.videoElement as HTMLVideoElement | undefined;
      if (prevVideo && prevVideo !== video) {
        try { prevVideo.pause(); } catch { /* ignore */ }
      }
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      // Restart from frame 0 on every apply — VJ semantics: clicking a
      // clip means "play this clip from the top", not "resume from
      // wherever it was last paused".
      try { video.currentTime = 0; } catch { /* ignore */ }
      if (video.paused) video.play().catch(() => { /* AbortError on rapid re-apply is fine */ });
      layerSource.videoElement = video;
    }

    project.setLayerSource($selectedLayerId, layerSource);
  }

  // Apply Three.js item to selected layer.
  //
  // Built-in items live as static HTML at /threejs/<name>/index.html.
  // We fetch the file, parse its shaderParamDefs, and dispatch as a
  // JSAnimation so the layer gets:
  //   - the iframe runtime shims (importmap for `three`, DPR=1 clamp)
  //   - param slider UI driven by the HTML's own shaderParamDefs
  // Without this conversion the layer would skip both — the engine's
  // legacy createThreeJSIframeContext path doesn't support params or
  // shim injection.
  async function applyThreeJSToLayer(item: ThreeJSItem) {
    if (!$selectedLayerId) return;
    try {
      const resp = await fetch(item.src);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const htmlCode = await resp.text();
      const isP5 = /p5\.(min\.)?js|new\s+p5\s*\(/.test(htmlCode);
      const animationType: 'threejs' | 'p5js' = isP5 ? 'p5js' : 'threejs';
      const params = parseShaderParamDefs(htmlCode);
      const values = parseShaderParamValues(htmlCode);
      const paramValues: Record<string, number | boolean | number[]> = {};
      for (const p of params) paramValues[p.name] = values[p.name] ?? p.default;

      const layerSource: MediaSource = {
        id: generateUUID(),
        type: animationType,
        src: item.src,
        name: item.name,
        jsAnimation: {
          animationType,
          htmlCode,
          params: params.length > 0 ? params : undefined,
          paramValues: params.length > 0 ? paramValues : undefined,
        },
      };
      project.setLayerSource($selectedLayerId, layerSource);
    } catch (err) {
      console.error('[MediaLibrary] failed to load built-in Three.js item:', item.src, err);
    }
  }

  // ---- shaderParamDefs parsers ----
  // Shared with the file-upload path in MediaTray. Both need to extract
  // the same object-literal-with-unquoted-keys format from raw HTML.
  function parseShaderParamDefs(html: string): Array<{
    name: string; type: 'number' | 'boolean' | 'color';
    default: number | boolean | number[];
    min?: number; max?: number; label?: string;
  }> {
    const m = html.match(/window\.shaderParamDefs\s*=\s*(\[[\s\S]*?\])\s*;?/);
    if (!m) return [];
    try {
      const arr = new Function('return ' + m[1])();
      if (!Array.isArray(arr)) return [];
      return arr.filter(d => d && typeof d.name === 'string' && d.type).map(d => ({
        name: String(d.name),
        type: d.type as 'number' | 'boolean' | 'color',
        default: d.default,
        min: typeof d.min === 'number' ? d.min : undefined,
        max: typeof d.max === 'number' ? d.max : undefined,
        label: typeof d.label === 'string' ? d.label : d.name,
      }));
    } catch {
      return [];
    }
  }
  function parseShaderParamValues(html: string): Record<string, number | boolean | number[]> {
    const m = html.match(/window\.shaderParams\s*=\s*(\{[\s\S]*?\})\s*;?/);
    if (!m) return {};
    try {
      const obj = new Function('return ' + m[1])();
      return (obj && typeof obj === 'object') ? obj : {};
    } catch { return {}; }
  }

  // Drag Three.js item
  let draggedThreeJS: ThreeJSItem | null = null;

  function handleThreeJSDragStart(item: ThreeJSItem, e: DragEvent) {
    draggedThreeJS = item;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('application/json', JSON.stringify({ type: 'threejs-item', id: item.id, src: item.src, name: item.name }));
    }
  }

  function handleThreeJSDragEnd() {
    draggedThreeJS = null;
  }

  // Drag from library to layer
  function handleItemDragStart(item: MediaSource, e: DragEvent) {
    draggedItem = item;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('application/json', JSON.stringify({ type: 'library-item', id: item.id }));
    }
  }

  function handleItemDragEnd() {
    draggedItem = null;
  }

  // Filter items by tab
  $: filteredItems = libraryItems.filter(item => {
    // Tab filter
    let tabMatch = false;
    if (activeTab === 'images') tabMatch = item.type === 'image';
    else if (activeTab === 'videos') tabMatch = item.type === 'video';
    else if (activeTab === 'shaders') tabMatch = item.type === 'shader';
    else if (activeTab === 'js') {
      const isJSAnimation = (item.type === 'threejs' || item.type === 'p5js') && item.jsAnimation;
      if (!isJSAnimation) tabMatch = false;
      else if (jsFilter === 'all') tabMatch = true;
      else tabMatch = item.jsAnimation?.animationType === jsFilter;
    } else tabMatch = true;
    if (!tabMatch) return false;

    // Text search filter (case-insensitive match on name)
    const q = searchQuery.trim().toLowerCase();
    if (q && !(item.name || '').toLowerCase().includes(q)) return false;

    return true;
  });

  // JS animation items are available via libraryItems filtered by type === 'threejs' || 'p5js'

  // Accept type for file input
  $: acceptType = activeTab === 'images' ? 'image/*' : activeTab === 'videos' ? 'video/*' : activeTab === 'js' ? '.html' : '.fs,.isf';

  // Handle AI-generated content
  function handleAIGenerated(event: CustomEvent<{ item: MediaSource }>) {
    const { item } = event.detail;
    libraryItems = [...libraryItems, item];
    showAIGenerator = false;

    // Switch to appropriate tab
    if (item.type === 'shader') {
      activeTab = 'shaders';
    } else if (item.type === 'threejs' || item.type === 'p5js') {
      activeTab = 'js';
    }
  }

  // Add HTML file as JS animation
  function addJSFileToLibrary(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const htmlCode = e.target?.result as string;

      // Detect if it's Three.js or p5.js
      const isThreeJS = htmlCode.includes('three') || htmlCode.includes('THREE');

      const animationType = isThreeJS ? 'threejs' : 'p5js';

      const jsAnimation: JSAnimationSource = {
        animationType,
        htmlCode,
        aiGenerated: false
      };

      const item: MediaSource = {
        id: generateUUID(),
        type: animationType,
        src: 'file',
        name: file.name.replace('.html', ''),
        jsAnimation
      };

      libraryItems = [...libraryItems, item];
    };
    reader.readAsText(file);
  }

  // Updated file handling to support HTML files
  function handleFileSelectUpdated(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = input.files;
    if (!files) return;

    for (const file of files) {
      if (file.name.endsWith('.html')) {
        addJSFileToLibrary(file);
      } else {
        addFileToLibrary(file);
      }
    }
    input.value = '';
  }

  // Apply JS animation to layer
  function applyJSToLayer(item: MediaSource) {
    if (!$selectedLayerId) return;

    // Clone the item for the layer
    const layerSource: MediaSource = {
      id: generateUUID(),
      type: item.type,
      src: item.src,
      name: item.name,
      jsAnimation: item.jsAnimation ? { ...item.jsAnimation } : undefined
    };

    project.setLayerSource($selectedLayerId, layerSource);
  }

  // Drag JS animation item
  let draggedJS: MediaSource | null = null;

  function handleJSDragStart(item: MediaSource, e: DragEvent) {
    draggedJS = item;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('application/json', JSON.stringify({
        type: 'js-animation',
        id: item.id,
        mediaType: item.type,
        name: item.name
      }));
    }
  }

  function handleJSDragEnd() {
    draggedJS = null;
  }

</script>

<div class="media-library" class:collapsed={!isExpanded}>
  <div class="library-header" onclick={() => isExpanded = !isExpanded}>
    <h3>
      <span class="toggle-icon">{isExpanded ? '▼' : '▶'}</span>
      Media Library
    </h3>
    <span class="item-count">{libraryItems.length}</span>
  </div>

  {#if isExpanded}
    <div class="library-tabs">
      <button
        class="tab"
        class:active={activeTab === 'images'}
        onclick={() => activeTab = 'images'}
      >
        Images
      </button>
      <button
        class="tab"
        class:active={activeTab === 'videos'}
        onclick={() => activeTab = 'videos'}
      >
        Videos
      </button>
      <button
        class="tab"
        class:active={activeTab === 'shaders'}
        onclick={() => activeTab = 'shaders'}
      >
        Shaders
      </button>
      <button
        class="tab"
        class:active={activeTab === 'js'}
        onclick={() => activeTab = 'js'}
      >
        JS
      </button>
      <button
        class="tab"
        class:active={activeTab === 'threejs'}
        onclick={() => activeTab = 'threejs'}
      >
        3.js
      </button>
    </div>

    <!-- AI Buttons row (Generate + Video, side-by-side per v10 mock) -->
    <div class="ai-generator-row">
      <button class="btn-ai-generate" onclick={() => showAIGenerator = !showAIGenerator}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/>
        </svg>
        {showAIGenerator ? 'Hide AI Generator' : 'AI Generate'}
      </button>
      <button class="btn-ai-video" onclick={() => window.dispatchEvent(new CustomEvent('open-ai-video'))} title="AI Video generation">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M8 5v14l11-7z"/>
        </svg>
        AI Video
      </button>
    </div>

    {#if showAIGenerator}
      <AIShaderGenerator
        on:generated={handleAIGenerated}
        on:close={() => showAIGenerator = false}
      />
    {/if}

    <!-- Text search -->
    <div class="media-search-row">
      <input
        type="text"
        class="media-search-input"
        placeholder="Search media..."
        bind:value={searchQuery}
      />
      {#if searchQuery}
        <button class="media-search-clear" onclick={() => searchQuery = ''} title="Clear">×</button>
      {/if}
    </div>

    {#if activeTab === 'js'}
      <!-- JS tab filter buttons -->
      <div class="js-filter-row">
        <button
          class="js-filter-btn"
          class:active={jsFilter === 'all'}
          onclick={() => jsFilter = 'all'}
        >
          All
        </button>
        <button
          class="js-filter-btn"
          class:active={jsFilter === 'threejs'}
          onclick={() => jsFilter = 'threejs'}
        >
          Three.js
        </button>
        <button
          class="js-filter-btn"
          class:active={jsFilter === 'p5js'}
          onclick={() => jsFilter = 'p5js'}
        >
          p5.js
        </button>
      </div>
      <div
        class="library-drop-zone"
        ondrop={handleDrop}
        ondragover={handleDragOver}
      >
        <p>Drop .html files here</p>
        <label class="browse-link">
          or <span>browse</span>
          <input
            type="file"
            accept=".html"
            multiple
            onchange={handleFileSelectUpdated}
            style="display: none;"
          />
        </label>
      </div>
    {:else if activeTab !== 'threejs'}
      <div
        class="library-drop-zone"
        ondrop={handleDrop}
        ondragover={handleDragOver}
      >
        <p>Drop {activeTab} here</p>
        <label class="browse-link">
          or <span>browse</span>
          <input
            type="file"
            accept={acceptType}
            multiple
            onchange={handleFileSelect}
            style="display: none;"
          />
        </label>
      </div>
    {/if}

    <div class="library-grid">
      {#if activeTab === 'threejs'}
        <!-- Three.js items (built-in) -->
        {#each threejsItems as item (item.id)}
          <div
            class="library-item"
            class:dragging={draggedThreeJS?.id === item.id}
            draggable="true"
            ondragstart={(e) => handleThreeJSDragStart(item, e)}
            ondragend={handleThreeJSDragEnd}
            ondblclick={() => applyThreeJSToLayer(item)}
            title="Double-click to apply to selected layer"
          >
            <div class="item-preview">
              {#if item.thumbnail}
                <img src={item.thumbnail} alt={item.name} />
              {:else}
                <div class="threejs-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 2L2 7v10l10 5 10-5V7L12 2z"/>
                    <path d="M12 22V12"/>
                    <path d="M22 7l-10 5-10-5"/>
                    <circle cx="12" cy="12" r="2" fill="currentColor"/>
                  </svg>
                </div>
              {/if}
            </div>
            <div class="item-name">{item.name}</div>
          </div>
        {/each}

        {#if threejsItems.length === 0}
          <div class="empty-message">
            No 3.js items available
          </div>
        {/if}
      {:else if activeTab === 'js'}
        <!-- JS animations (AI-generated or uploaded) -->
        {#each filteredItems as item (item.id)}
          <div
            class="library-item"
            class:dragging={draggedJS?.id === item.id}
            draggable="true"
            ondragstart={(e) => handleJSDragStart(item, e)}
            ondragend={handleJSDragEnd}
            ondblclick={() => applyJSToLayer(item)}
            title="Double-click to apply to selected layer"
          >
            <div class="item-preview">
              <div class="js-icon" class:threejs={item.jsAnimation?.animationType === 'threejs'} class:p5js={item.jsAnimation?.animationType === 'p5js'}>
                {#if item.jsAnimation?.animationType === 'threejs'}
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 2L2 7v10l10 5 10-5V7L12 2z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                {:else}
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M8 12l3 3 5-6"/>
                  </svg>
                {/if}
                {#if item.jsAnimation?.aiGenerated}
                  <span class="ai-badge">AI</span>
                {/if}
              </div>
            </div>
            <div class="item-name">{item.name}</div>
            <div class="item-type-badge">{item.jsAnimation?.animationType === 'threejs' ? '3JS' : 'P5'}</div>
            <button
              class="btn-remove"
              onclick={(e) => { e.stopPropagation(); removeFromLibrary(item.id, e); }}
              title="Remove from library"
            >
              ×
            </button>
          </div>
        {/each}

        {#if filteredItems.length === 0}
          <div class="empty-message">
            <p>No JS animations yet</p>
            <p class="hint">Use AI Generate or drop .html files</p>
          </div>
        {/if}
      {:else}
        <!-- Regular media items (images, videos, shaders) -->
        {#each filteredItems as item (item.id)}
          <div
            class="library-item"
            class:dragging={draggedItem?.id === item.id}
            draggable="true"
            ondragstart={(e) => handleItemDragStart(item, e)}
            ondragend={handleItemDragEnd}
            ondblclick={() => applyToLayer(item)}
            title="Double-click to apply to selected layer"
          >
            <div class="item-preview">
              {#if item.type === 'image'}
                <img
                  src={item.src}
                  alt={item.name}
                  onerror={() => updateLibraryItem(item.id, { broken: true, brokenReason: 'File not found or failed to load' })}
                  onload={() => { if (item.broken) updateLibraryItem(item.id, { broken: false, brokenReason: undefined }); }}
                />
              {:else if item.type === 'video'}
                <video
                  src={item.src}
                  muted
                  playsinline
                  onerror={() => updateLibraryItem(item.id, { broken: true, brokenReason: 'Video failed to load' })}
                  onloadeddata={() => { if (item.broken) updateLibraryItem(item.id, { broken: false, brokenReason: undefined }); }}
                ></video>
              {:else}
                <div class="shader-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polygon points="12,2 22,8.5 22,15.5 12,22 2,15.5 2,8.5"/>
                    <line x1="12" y1="22" x2="12" y2="15.5"/>
                    <polyline points="22,8.5 12,15.5 2,8.5"/>
                  </svg>
                </div>
              {/if}
              {#if item.broken}
                <div class="broken-badge" title={item.brokenReason || 'Missing file'}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                    <line x1="12" y1="9" x2="12" y2="13"/>
                    <line x1="12" y1="17" x2="12.01" y2="17"/>
                  </svg>
                </div>
              {/if}
            </div>
            <div class="item-name">{item.name}</div>
            <button
              class="btn-remove"
              onclick={(e) => { e.stopPropagation(); removeFromLibrary(item.id, e); }}
              title="Remove from library"
            >
              ×
            </button>
          </div>
        {/each}

        {#if filteredItems.length === 0}
          <div class="empty-message">
            No {activeTab} in library
          </div>
        {/if}
      {/if}
    </div>

    <!-- Bottom action row (per v10 mock) — short labels, side-by-side.
         "+ Add" hits the hidden file input that the active tab's drop
         zone shares; "Library" dispatches an event the host wires to
         the Shader Library modal. -->
    <div class="lib-footer">
      <button class="lib-add-btn" onclick={() => {
        const fileInputs = document.querySelectorAll<HTMLInputElement>('.library-drop-zone input[type=file]');
        const inp = fileInputs[fileInputs.length - 1];
        if (inp) inp.click();
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
          <path d="M12 5v14M5 12h14"/>
        </svg>
        Add
      </button>
      <button class="lib-library-btn" onclick={() => window.dispatchEvent(new CustomEvent('open-shader-library'))}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <path d="M3 9h18"/>
        </svg>
        Library
      </button>
    </div>
  {/if}
</div>

<style>
  .media-library {
    background: var(--ga-panel, var(--bg-secondary, #0b0d11));
    border-top: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    display: flex;
    flex-direction: column;
    font-family: var(--ga-font-ui, inherit);
  }

  /* Title in the v10: 18px bold "Media Library" — already lives in
     .library-header h3 below. Just raises the weight there. */
  .library-header h3 {
    font-weight: 800;
    font-size: 19px;
    color: var(--ga-ink-0, #eef0f4);
  }

  .library-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 12px;
    cursor: pointer;
    user-select: none;
  }

  .library-header:hover {
    background: var(--bg-tertiary, #161618);
  }

  .library-header h3 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .toggle-icon {
    font-size: 11px;
    color: #666;
  }

  .item-count {
    background: #333;
    color: var(--text-muted, #888);
    font-size: 12px;
    padding: 2px 8px;
    border-radius: 10px;
  }

  .library-tabs {
    display: flex;
    padding: 0 8px;
    gap: 2px;
    border-bottom: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
  }

  /* v10 tab style: mono uppercase eyebrow label, blue underline on active. */
  .tab {
    flex: 1;
    background: none;
    border: none;
    color: var(--ga-ink-2, #5e6571);
    padding: 9px 2px;
    font-family: var(--ga-font-mono, 'Geist Mono', monospace);
    font-size: 10px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    cursor: pointer;
    border-bottom: 2px solid transparent;
    transition: color 0.14s, border-color 0.14s;
  }

  .tab:hover {
    color: var(--ga-ink-0, #eef0f4);
  }

  .tab.active {
    color: var(--ga-ink-0, #eef0f4);
    border-bottom-color: var(--ga-blue, #5b8def);
  }

  .library-drop-zone {
    margin: 8px;
    padding: 16px;
    border: 2px dashed #444;
    border-radius: 6px;
    text-align: center;
    color: #666;
    font-size: 13px;
    transition: border-color 0.2s;
  }

  .library-drop-zone:hover {
    border-color: #BB86FC;
  }

  .library-drop-zone p {
    margin: 0 0 4px 0;
  }

  .browse-link {
    cursor: pointer;
  }

  .browse-link span {
    color: #BB86FC;
    text-decoration: underline;
  }

  .library-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
    padding: 8px;
    max-height: 200px;
    overflow-y: auto;
  }

  .library-item {
    position: relative;
    background: #333;
    border-radius: 4px;
    overflow: hidden;
    cursor: grab;
    transition: transform 0.15s, box-shadow 0.15s;
  }

  .library-item:hover {
    transform: scale(1.02);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }

  .library-item.dragging {
    opacity: 0.5;
    cursor: grabbing;
  }

  .item-preview {
    width: 100%;
    aspect-ratio: 1;
    background: #222;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  .item-preview img,
  .item-preview video {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .shader-icon {
    color: #ff00aa;
  }

  .threejs-icon {
    color: #c0a080;
    background: linear-gradient(135deg, #4a3a2a, #3a2a1a);
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .item-name {
    padding: 4px 6px;
    font-size: 11px;
    color: var(--text-secondary, #aaa);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .btn-remove {
    position: absolute;
    top: 2px;
    right: 2px;
    width: 18px;
    height: 18px;
    background: rgba(0, 0, 0, 0.7);
    border: none;
    border-radius: 50%;
    color: #ff4444;
    font-size: 15px;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.15s;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .library-item:hover .btn-remove {
    opacity: 1;
  }

  .btn-remove:hover {
    background: rgba(255, 68, 68, 0.3);
  }

  .empty-message {
    grid-column: 1 / -1;
    text-align: center;
    color: #555;
    padding: 20px;
    font-size: 13px;
  }

  .collapsed .library-header {
    border-bottom: none;
  }

  /* AI Generator Button */
  /* v10 AI row: violet Generate + blue Video, side-by-side. */
  .ai-generator-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 9px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--ga-line, rgba(255, 255, 255, 0.07));
  }

  .btn-ai-generate {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    height: 38px;
    padding: 0;
    background: var(--ga-violet-soft, rgba(155, 135, 245, 0.10));
    border: 1px solid var(--ga-violet-line, rgba(155, 135, 245, 0.36));
    border-radius: var(--ga-r-soft, 7px);
    color: var(--ga-violet, #9b87f5);
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
    transition: background 0.14s;
  }

  .btn-ai-generate:hover {
    background: rgba(155, 135, 245, 0.18);
  }

  .btn-ai-video {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    height: 38px;
    padding: 0;
    background: var(--ga-blue-soft, rgba(91, 141, 239, 0.10));
    border: 1px solid var(--ga-blue-line, rgba(91, 141, 239, 0.38));
    border-radius: var(--ga-r-soft, 7px);
    color: var(--ga-blue, #5b8def);
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
    transition: background 0.14s;
  }

  .btn-ai-video:hover {
    background: rgba(91, 141, 239, 0.18);
  }

  /* Bottom footer: side-by-side Add (violet solid) + Library (ghost). */
  .lib-footer {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 9px;
    padding: 12px 14px;
    border-top: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    margin-top: auto;
  }

  .lib-add-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 36px;
    padding: 0;
    background: var(--ga-violet, #9b87f5);
    border: none;
    border-radius: var(--ga-r-soft, 7px);
    color: #160f2e;
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
  }
  .lib-add-btn:hover { filter: brightness(1.06); }

  .lib-library-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 36px;
    padding: 0;
    background: transparent;
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-hard, 2px);
    color: var(--ga-ink-1, #9aa0ac);
    font-size: 13.5px;
    font-weight: 600;
    cursor: pointer;
    transition: color 0.14s, border-color 0.14s;
  }
  .lib-library-btn:hover {
    color: var(--ga-ink-0, #eef0f4);
    border-color: var(--ga-line-3, rgba(255, 255, 255, 0.20));
  }

  .btn-ai-generate svg {
    animation: pulse-glow 2s ease-in-out infinite;
  }

  @keyframes pulse-glow {
    0%, 100% { opacity: 0.7; }
    50% { opacity: 1; }
  }

  /* JS Filter Row */
  .js-filter-row {
    display: flex;
    gap: 4px;
    padding: 8px;
    background: var(--bg-primary, #0d0d10);
  }

  .media-search-row {
    position: relative;
    padding: 8px;
    background: var(--bg-primary, #0d0d10);
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  }

  .media-search-input {
    width: 100%;
    padding: 6px 28px 6px 10px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    color: var(--text-primary, #e8e8e8);
    font-size: 13px;
    outline: none;
  }
  .media-search-input::placeholder { color: rgba(255, 255, 255, 0.3); }
  .media-search-input:focus { border-color: rgba(92, 225, 230, 0.5); }

  .media-search-clear {
    position: absolute;
    right: 14px;
    top: 50%;
    transform: translateY(-50%);
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.5);
    font-size: 17px;
    line-height: 1;
    cursor: pointer;
    padding: 2px 6px;
  }
  .media-search-clear:hover { color: #fff; }

  .broken-badge {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: rgba(255, 80, 80, 0.92);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
    pointer-events: auto;
    z-index: 2;
  }

  .js-filter-btn {
    flex: 1;
    padding: 6px 8px;
    background: var(--bg-secondary, #111114);
    border: 1px solid #333;
    border-radius: 4px;
    color: var(--text-muted, #888);
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .js-filter-btn:hover {
    background: var(--bg-tertiary, #161618);
    color: #fff;
  }

  .js-filter-btn.active {
    background: #333;
    border-color: #BB86FC;
    color: #BB86FC;
  }

  /* JS Icon Styles */
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
    font-size: 9px;
    font-weight: 700;
    padding: 2px 4px;
    border-radius: 3px;
  }

  .item-type-badge {
    position: absolute;
    bottom: 20px;
    left: 4px;
    background: rgba(0, 0, 0, 0.7);
    color: var(--text-muted, #888);
    font-size: 9px;
    font-weight: 600;
    padding: 2px 4px;
    border-radius: 2px;
  }

  .empty-message .hint {
    margin-top: 4px;
    font-size: 11px;
    color: #444;
  }

  /* Plugin Styles */
  .plugins-grid {
    grid-template-columns: 1fr !important;
    gap: 12px !important;
    max-height: 300px !important;
  }

  .plugin-card {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
    background: linear-gradient(135deg, #1a1a2e, #16213e);
    border: 1px solid #333;
    border-radius: 8px;
    cursor: grab;
    transition: all 0.2s;
  }

  .plugin-card:hover {
    border-color: #BB86FC;
    box-shadow: 0 0 12px rgba(187, 134, 252, 0.15);
    transform: translateX(4px);
  }

  .plugin-card.running {
    border-color: #4ade80;
    background: linear-gradient(135deg, #1a2e1a, #16213e);
  }

  .plugin-icon {
    width: 48px;
    height: 48px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    background: rgba(0, 0, 0, 0.3);
  }

  .plugin-icon.fluid {
    color: #60a5fa;
    background: linear-gradient(135deg, rgba(96, 165, 250, 0.2), rgba(96, 165, 250, 0.05));
  }

  .plugin-icon.particles {
    color: #f472b6;
    background: linear-gradient(135deg, rgba(244, 114, 182, 0.2), rgba(244, 114, 182, 0.05));
  }

  .plugin-info {
    flex: 1;
    min-width: 0;
  }

  .plugin-name {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary, #eee);
    margin-bottom: 2px;
  }

  .plugin-desc {
    font-size: 11px;
    color: var(--text-muted, #888);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .plugin-status {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    background: rgba(0, 0, 0, 0.3);
    border-radius: 12px;
  }

  .status-indicator {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .status-indicator.running {
    background: #4ade80;
    box-shadow: 0 0 8px #4ade80;
    animation: pulse-green 2s ease-in-out infinite;
  }

  .status-indicator.stopped {
    background: #666;
  }

  @keyframes pulse-green {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }

  .status-text {
    font-size: 11px;
    color: var(--text-muted, #888);
  }

  .plugin-actions {
    flex-shrink: 0;
  }

  .btn-plugin {
    padding: 6px 12px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
    border: 1px solid transparent;
  }

  .btn-plugin.start {
    background: linear-gradient(135deg, #166534, #15803d);
    color: #4ade80;
    border-color: #22c55e;
  }

  .btn-plugin.start:hover {
    background: linear-gradient(135deg, #15803d, #166534);
    box-shadow: 0 0 8px rgba(74, 222, 128, 0.3);
  }

  .btn-plugin.stop {
    background: linear-gradient(135deg, #7f1d1d, #991b1b);
    color: #f87171;
    border-color: #ef4444;
  }

  .btn-plugin.stop:hover {
    background: linear-gradient(135deg, #991b1b, #7f1d1d);
    box-shadow: 0 0 8px rgba(248, 113, 113, 0.3);
  }
</style>
