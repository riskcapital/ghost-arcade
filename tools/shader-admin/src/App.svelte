<script>
  import { onMount } from 'svelte';
  import ShaderCard from './lib/ShaderCard.svelte';
  import ShaderPreview from './lib/ShaderPreview.svelte';
  import { renderShaderToDataURL } from './lib/isfRenderer.js';

  // ─── State ──────────────────────────────────────────────────────────────────
  let manifest = { version: 2, shaders: [] };
  let newShaderFiles = [];
  let shaderSources = {}; // filename -> source code
  let thumbnails = {};    // filename -> data URL or blob URL
  let loading = true;
  let saving = false;
  let statusMsg = '';

  // Filters
  let searchQuery = '';
  let filterTier = 'all';
  let filterCategory = 'all';
  let filterEnabled = 'all'; // 'all' | 'active' | 'excluded'
  let sortBy = 'name';

  // Selection
  let selectedShader = null;
  let selectedSource = '';
  let bulkSelected = new Set();
  let bulkMode = false;

  // Thumbnail generation
  let genThumbProgress = 0;
  let genThumbTotal = 0;
  let isGeneratingThumbs = false;

  // Scan results
  let scanResults = null;
  let isScanning = false;

  // Drag reorder state
  let dragSourceFile = null;
  let dragOverFile = null;

  // Tab state: 'defaults' = default load order, 'library' = non-default shaders for library curation
  let activeView = 'defaults';

  // Default-load shaders in manifest order (no sorting applied)
  $: defaultLoadShaders = manifest.shaders.filter(s => s.defaultLoad === true && s.enabled !== false);

  // Library shaders = everything NOT in defaults (available for users to browse/add)
  $: libraryShaders = manifest.shaders
    .filter(s => {
      if (s.defaultLoad === true && s.enabled !== false) return false; // already in defaults
      if (filterTier !== 'all' && s.tier !== filterTier) return false;
      if (filterCategory !== 'all' && s.category !== filterCategory) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return s.file.toLowerCase().includes(q) ||
               (s.category || '').toLowerCase().includes(q) ||
               s.tags?.some(t => t.toLowerCase().includes(q));
      }
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'tier') {
        const rank = { demo: 0, starter: 1, pro: 2 };
        return (rank[a.tier] || 0) - (rank[b.tier] || 0) || a.file.localeCompare(b.file);
      }
      if (sortBy === 'category') return (a.category || '').localeCompare(b.category || '') || a.file.localeCompare(b.file);
      return a.file.localeCompare(b.file);
    });

  $: libraryTotalCount = manifest.shaders.filter(s => !(s.defaultLoad === true && s.enabled !== false)).length;

  function promoteToDefault(file) {
    const entry = manifest.shaders.find(s => s.file === file);
    if (entry) {
      entry.defaultLoad = true;
      entry.enabled = true;
      manifest = manifest;
      statusMsg = `Moved "${file}" to defaults`;
      setTimeout(() => statusMsg = '', 3000);
    }
  }

  // Drag state for defaults tab
  let defaultDragSource = null;
  let defaultDragOver = null;

  function handleDefaultDragStart(e, file) {
    defaultDragSource = file;
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleDefaultDragOver(e, file) {
    e.preventDefault();
    defaultDragOver = file;
  }

  function handleDefaultDragDrop(e, targetFile) {
    e.preventDefault();
    if (!defaultDragSource || defaultDragSource === targetFile) {
      defaultDragSource = null;
      defaultDragOver = null;
      return;
    }
    // Reorder within the full manifest.shaders array
    const arr = manifest.shaders;
    const fromIdx = arr.findIndex(s => s.file === defaultDragSource);
    const toIdx = arr.findIndex(s => s.file === targetFile);
    if (fromIdx < 0 || toIdx < 0) return;
    const [item] = arr.splice(fromIdx, 1);
    arr.splice(toIdx, 0, item);
    manifest.shaders = arr;
    manifest = manifest;
    defaultDragSource = null;
    defaultDragOver = null;
  }

  function removeFromDefaults(file) {
    const entry = manifest.shaders.find(s => s.file === file);
    if (entry) {
      entry.defaultLoad = false;
      manifest = manifest;
    }
  }

  function moveDefaultShader(file, direction) {
    const arr = manifest.shaders;
    const idx = arr.findIndex(s => s.file === file);
    if (idx < 0) return;
    // Find the next/prev defaultLoad shader in manifest order
    if (direction === 'up') {
      for (let i = idx - 1; i >= 0; i--) {
        if (arr[i].defaultLoad === true && arr[i].enabled !== false) {
          const [item] = arr.splice(idx, 1);
          arr.splice(i, 0, item);
          break;
        }
      }
    } else {
      for (let i = idx + 1; i < arr.length; i++) {
        if (arr[i].defaultLoad === true && arr[i].enabled !== false) {
          const [item] = arr.splice(idx, 1);
          arr.splice(i, 0, item);
          break;
        }
      }
    }
    manifest.shaders = arr;
    manifest = manifest;
  }

  // ─── Computed ───────────────────────────────────────────────────────────────
  $: categories = [...new Set(manifest.shaders.map(s => s.category).filter(Boolean))].sort();

  $: categoryCounts = (() => {
    const counts = {};
    for (const s of manifest.shaders) {
      if (s.enabled === false) continue;
      const cat = s.category || 'Uncategorized';
      counts[cat] = (counts[cat] || 0) + 1;
    }
    return counts;
  })();

  // Category organizer state
  let newCategoryName = '';
  let renamingCategory = null;
  let renameCategoryValue = '';
  let categoryDragSource = null;
  let categoryDragOverTarget = null;

  $: enabledCount = manifest.shaders.filter(s => s.enabled !== false).length;
  $: excludedCount = manifest.shaders.length - enabledCount;

  $: filteredShaders = manifest.shaders
    .filter(s => {
      if (filterEnabled === 'active' && s.enabled === false) return false;
      if (filterEnabled === 'excluded' && s.enabled !== false) return false;
      if (filterTier !== 'all' && s.tier !== filterTier) return false;
      if (filterCategory !== 'all' && s.category !== filterCategory) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return s.file.toLowerCase().includes(q) ||
               (s.category || '').toLowerCase().includes(q) ||
               s.tags?.some(t => t.toLowerCase().includes(q));
      }
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'tier') {
        const rank = { demo: 0, starter: 1, pro: 2 };
        return (rank[a.tier] || 0) - (rank[b.tier] || 0) || a.file.localeCompare(b.file);
      }
      if (sortBy === 'category') return (a.category || '').localeCompare(b.category || '') || a.file.localeCompare(b.file);
      return a.file.localeCompare(b.file);
    });

  $: tierCounts = {
    demo: manifest.shaders.filter(s => s.tier === 'demo').length,
    starter: manifest.shaders.filter(s => s.tier === 'starter').length,
    pro: manifest.shaders.filter(s => s.tier === 'pro').length,
  };

  // ─── API Helpers ────────────────────────────────────────────────────────────
  async function fetchManifest() {
    const res = await fetch('/api/manifest');
    return res.json();
  }

  async function fetchNewShaders() {
    const res = await fetch('/api/new-shaders');
    const data = await res.json();
    return data.files || [];
  }

  async function fetchShaderSource(filename) {
    if (shaderSources[filename]) return shaderSources[filename];
    const res = await fetch(`/api/shader/${encodeURIComponent(filename)}`);
    const data = await res.json();
    shaderSources[filename] = data.code;
    return data.code;
  }

  async function fetchExistingThumbnails() {
    try {
      const res = await fetch('/api/thumbnails');
      const data = await res.json();
      for (const thumbFile of (data.files || [])) {
        // Map thumb filename back to shader filename
        const shaderFile = thumbFile.replace(/\.jpg$/, '.fs').replace(/_/g, '/');
        // Check both with and without path separator conversion
        thumbnails[shaderFile] = `/api/thumbnail/${encodeURIComponent(shaderFile)}?t=${Date.now()}`;
        // Also check the underscore version as-is
        const directName = thumbFile.replace(/\.jpg$/, '.fs');
        thumbnails[directName] = `/api/thumbnail/${encodeURIComponent(directName)}?t=${Date.now()}`;
      }
      thumbnails = thumbnails;
    } catch (err) {
      console.warn('Could not fetch thumbnails:', err);
    }
  }

  async function saveManifest() {
    saving = true;
    const res = await fetch('/api/manifest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(manifest),
    });
    const data = await res.json();
    saving = false;
    statusMsg = `Saved ${data.count} shaders`;
    setTimeout(() => statusMsg = '', 3000);
  }

  async function updateEntry(file, updates) {
    const entry = manifest.shaders.find(s => s.file === file);
    if (entry) {
      Object.assign(entry, updates);
      manifest = manifest;
    }
  }

  async function importShader(filename) {
    const res = await fetch('/api/import-shader', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename }),
    });
    if (res.ok) {
      manifest.shaders.push({
        file: filename, tier: 'demo', category: 'Generator',
        tags: [], defaults: {}, featured: false, enabled: true,
      });
      manifest = manifest;
      newShaderFiles = newShaderFiles.filter(f => f !== filename);
      statusMsg = `Imported ${filename}`;
      setTimeout(() => statusMsg = '', 3000);
    }
  }

  async function importAllNew() {
    for (const f of [...newShaderFiles]) await importShader(f);
  }

  // ─── Bulk Operations ───────────────────────────────────────────────────────
  function toggleBulkSelect(file) {
    if (bulkSelected.has(file)) bulkSelected.delete(file);
    else bulkSelected.add(file);
    bulkSelected = bulkSelected;
  }

  function selectAllVisible() {
    for (const s of filteredShaders) bulkSelected.add(s.file);
    bulkSelected = bulkSelected;
  }

  function clearBulkSelection() { bulkSelected = new Set(); }

  async function bulkSetTier(tier) {
    const res = await fetch('/api/bulk-tier', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: [...bulkSelected], tier }),
    });
    if (res.ok) {
      for (const entry of manifest.shaders) {
        if (bulkSelected.has(entry.file)) entry.tier = tier;
      }
      manifest = manifest;
      statusMsg = `Set ${bulkSelected.size} shaders to ${tier}`;
      bulkSelected = new Set();
      setTimeout(() => statusMsg = '', 3000);
    }
  }

  // ─── Category Management ─────────────────────────────────────────────────
  function addCategory() {
    const name = newCategoryName.trim();
    if (!name || categories.includes(name)) return;
    // Just need at least one shader to use it — for now just register it
    // Categories exist by being assigned to shaders
    newCategoryName = '';
    statusMsg = `Category "${name}" ready — assign shaders to it`;
    setTimeout(() => statusMsg = '', 3000);
  }

  function renameCategory(oldName, newName) {
    if (!newName.trim() || newName === oldName) {
      renamingCategory = null;
      return;
    }
    let count = 0;
    for (const entry of manifest.shaders) {
      if (entry.category === oldName) {
        entry.category = newName.trim();
        count++;
      }
    }
    manifest = manifest;
    renamingCategory = null;
    statusMsg = `Renamed "${oldName}" → "${newName}" (${count} shaders)`;
    setTimeout(() => statusMsg = '', 3000);
  }

  function bulkSetCategory(category) {
    for (const entry of manifest.shaders) {
      if (bulkSelected.has(entry.file)) entry.category = category;
    }
    manifest = manifest;
    statusMsg = `Set ${bulkSelected.size} shaders to ${category}`;
    bulkSelected = new Set();
    setTimeout(() => statusMsg = '', 3000);
  }

  // ─── Detail Panel ──────────────────────────────────────────────────────────
  async function selectShader(entry) {
    selectedShader = entry;
    selectedSource = await fetchShaderSource(entry.file);
  }

  function closeDetail() {
    selectedShader = null;
    selectedSource = '';
  }

  function deleteShader(file) {
    if (!confirm(`Permanently remove "${file}" from the manifest?\n\n(The .fs file on disk is not deleted)`)) return;
    manifest.shaders = manifest.shaders.filter(s => s.file !== file);
    manifest = manifest;
    if (selectedShader?.file === file) closeDetail();
    statusMsg = `Removed ${file} from manifest`;
    setTimeout(() => statusMsg = '', 3000);
  }

  function handleDragStart(e, file) {
    dragSourceFile = file;
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleDragOver(e, file) {
    e.preventDefault();
    dragOverFile = file;
  }

  function handleDragDrop(e, targetFile) {
    e.preventDefault();
    if (!dragSourceFile || dragSourceFile === targetFile) {
      dragSourceFile = null;
      dragOverFile = null;
      return;
    }
    const arr = manifest.shaders;
    const fromIdx = arr.findIndex(s => s.file === dragSourceFile);
    const toIdx = arr.findIndex(s => s.file === targetFile);
    if (fromIdx < 0 || toIdx < 0) return;
    const [item] = arr.splice(fromIdx, 1);
    arr.splice(toIdx, 0, item);
    manifest.shaders = arr;
    manifest = manifest;
    dragSourceFile = null;
    dragOverFile = null;
  }

  function handleSaveDefaults(event) {
    if (selectedShader) {
      selectedShader.defaults = event.detail;
      manifest = manifest;
      statusMsg = `Defaults saved for ${selectedShader.file}`;
      setTimeout(() => statusMsg = '', 3000);
    }
  }

  function handleThumbnailSaved(event) {
    const filename = event.detail;
    // Refresh thumbnail URL with cache-bust
    thumbnails[filename] = `/api/thumbnail/${encodeURIComponent(filename)}?t=${Date.now()}`;
    thumbnails = thumbnails;
  }

  // ─── Batch Thumbnail Generation ────────────────────────────────────────────
  async function generateAllThumbnails() {
    if (isGeneratingThumbs) return;
    isGeneratingThumbs = true;
    const shaders = filteredShaders;
    genThumbTotal = shaders.length;
    genThumbProgress = 0;

    for (const entry of shaders) {
      try {
        const source = await fetchShaderSource(entry.file);
        const dataUrl = renderShaderToDataURL(source, 320, 180, 1.5, entry.defaults || {});

        if (dataUrl) {
          // Save to server
          await fetch('/api/thumbnail', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: entry.file, dataUrl }),
          });
          thumbnails[entry.file] = `/api/thumbnail/${encodeURIComponent(entry.file)}?t=${Date.now()}`;
          thumbnails = thumbnails;
        }
      } catch (err) {
        console.warn(`Thumbnail failed for ${entry.file}:`, err);
      }

      genThumbProgress++;
      // Small delay to keep UI responsive
      await new Promise(r => setTimeout(r, 30));
    }

    isGeneratingThumbs = false;
    statusMsg = `Generated ${genThumbProgress} thumbnails`;
    setTimeout(() => statusMsg = '', 5000);
  }

  // ─── Scan for New Shaders ─────────────────────────────────────────────────
  async function scanForShaders() {
    isScanning = true;
    try {
      const res = await fetch('/api/scan');
      scanResults = await res.json();
      statusMsg = `Found ${(scanResults.unmanagedISF?.length || 0) + (scanResults.newShaderFiles?.length || 0) + (scanResults.externalFiles?.length || 0)} unmanaged shaders`;
      setTimeout(() => statusMsg = '', 5000);
    } catch (err) {
      statusMsg = 'Scan failed: ' + err.message;
    }
    isScanning = false;
  }

  async function addUnmanagedToManifest(filename) {
    // Already in ISF dir, just add to manifest
    manifest.shaders.push({
      file: filename, tier: 'demo', category: 'Uncategorized',
      tags: [], defaults: {}, featured: false, enabled: true,
    });
    manifest = manifest;
    if (scanResults) {
      scanResults.unmanagedISF = scanResults.unmanagedISF.filter(f => f !== filename);
      scanResults = scanResults;
    }
    statusMsg = `Added ${filename} to manifest`;
    setTimeout(() => statusMsg = '', 3000);
  }

  async function importExternalShader(file, sourceDir) {
    try {
      const res = await fetch('/api/import-from', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file, sourceDir }),
      });
      if (res.ok) {
        manifest.shaders.push({
          file, tier: 'demo', category: 'Uncategorized',
          tags: [], defaults: {}, featured: false, enabled: true,
        });
        manifest = manifest;
        if (scanResults) {
          scanResults.externalFiles = scanResults.externalFiles.filter(f => f.file !== file);
          scanResults.newShaderFiles = scanResults.newShaderFiles.filter(f => f !== file);
          scanResults = scanResults;
        }
        statusMsg = `Imported ${file}`;
        setTimeout(() => statusMsg = '', 3000);
      }
    } catch (err) {
      statusMsg = `Import failed: ${err.message}`;
    }
  }

  async function addAllUnmanaged() {
    if (!scanResults) return;
    for (const f of [...(scanResults.unmanagedISF || [])]) await addUnmanagedToManifest(f);
    for (const f of [...(scanResults.newShaderFiles || [])]) await importExternalShader(f, 'new-shaders');
    for (const { file, dir } of [...(scanResults.externalFiles || [])]) await importExternalShader(file, dir);
  }

  // ─── Init ──────────────────────────────────────────────────────────────────
  onMount(async () => {
    try {
      manifest = await fetchManifest();
      newShaderFiles = await fetchNewShaders();
      const existingFiles = new Set(manifest.shaders.map(s => s.file));
      newShaderFiles = newShaderFiles.filter(f => !existingFiles.has(f));
      await fetchExistingThumbnails();
    } catch (err) {
      statusMsg = 'Failed to connect to API server. Run: npm run dev';
    }
    loading = false;
  });
</script>

<div class="admin-app">
  <!-- Header -->
  <header>
    <div class="header-left">
      <h1>⬡ Shader Admin</h1>
      <span class="shader-count">{enabledCount} active / {manifest.shaders.length} total</span>
      <span class="tier-counts">
        <span class="tier-badge demo">{tierCounts.demo} demo</span>
        <span class="tier-badge starter">{tierCounts.starter} starter</span>
        <span class="tier-badge pro">{tierCounts.pro} pro</span>
        {#if excludedCount > 0}
          <span class="tier-badge excluded">{excludedCount} off</span>
        {/if}
      </span>
    </div>
    <div class="header-right">
      {#if statusMsg}
        <span class="status-msg">{statusMsg}</span>
      {/if}
      {#if isGeneratingThumbs}
        <span class="gen-progress">{genThumbProgress}/{genThumbTotal}</span>
      {/if}
      <button class="header-btn scan-btn" on:click={scanForShaders} disabled={isScanning}>
        {isScanning ? '🔍 Scanning...' : '🔍 Scan New'}
      </button>
      <button class="header-btn gen-btn" on:click={generateAllThumbnails} disabled={isGeneratingThumbs}>
        {isGeneratingThumbs ? `📸 ${Math.round(genThumbProgress/genThumbTotal*100)}%` : '📸 Gen Thumbnails'}
      </button>
      <button class="header-btn save-btn" on:click={saveManifest} disabled={saving}>
        {saving ? 'Saving...' : '💾 Save Manifest'}
      </button>
    </div>
  </header>

  {#if loading}
    <div class="loading">Loading shaders...</div>
  {:else}
    <div class="main-layout" class:has-detail={selectedShader}>
      <!-- Sidebar -->
      <aside class="sidebar">
        <div class="filter-section">
          <input type="text" placeholder="Search shaders..." bind:value={searchQuery} class="search-input" />
        </div>

        <div class="filter-section">
          <span class="filter-label">Status</span>
          <div class="filter-chips">
            <button class:active={filterEnabled === 'all'} on:click={() => filterEnabled = 'all'}>All</button>
            <button class:active={filterEnabled === 'active'} on:click={() => filterEnabled = 'active'}>Active</button>
            <button class:active={filterEnabled === 'excluded'} on:click={() => filterEnabled = 'excluded'}>Excluded</button>
          </div>
        </div>

        <div class="filter-section">
          <span class="filter-label">Tier</span>
          <div class="filter-chips">
            <button class:active={filterTier === 'all'} on:click={() => filterTier = 'all'}>All</button>
            <button class:active={filterTier === 'demo'} on:click={() => filterTier = 'demo'}>Demo</button>
            <button class:active={filterTier === 'starter'} on:click={() => filterTier = 'starter'}>Starter</button>
            <button class:active={filterTier === 'pro'} on:click={() => filterTier = 'pro'}>Pro</button>
          </div>
        </div>

        <div class="filter-section">
          <span class="filter-label">Category</span>
          <select bind:value={filterCategory}>
            <option value="all">All Categories</option>
            {#each categories as cat}
              <option value={cat}>{cat} ({categoryCounts[cat] || 0})</option>
            {/each}
          </select>
        </div>

        <div class="filter-section category-organizer">
          <span class="filter-label">Category Organizer</span>
          <div class="category-list">
            {#each categories as cat (cat)}
              <div
                class="category-row"
                class:drag-over={categoryDragOverTarget === cat}
                on:dragover|preventDefault={() => categoryDragOverTarget = cat}
                on:dragleave={() => { if (categoryDragOverTarget === cat) categoryDragOverTarget = null; }}
                on:drop={() => { if (bulkSelected.size > 0) bulkSetCategory(cat); categoryDragOverTarget = null; }}
              >
                {#if renamingCategory === cat}
                  <input
                    class="rename-input"
                    bind:value={renameCategoryValue}
                    on:keydown={(e) => { if (e.key === 'Enter') renameCategory(cat, renameCategoryValue); if (e.key === 'Escape') renamingCategory = null; }}
                    on:blur={() => renameCategory(cat, renameCategoryValue)}
                  />
                {:else}
                  <button
                    class="cat-name-btn"
                    class:active={filterCategory === cat}
                    on:click={() => filterCategory = filterCategory === cat ? 'all' : cat}
                    on:dblclick={() => { renamingCategory = cat; renameCategoryValue = cat; }}
                    title="Click to filter · Double-click to rename"
                  >
                    {cat}
                  </button>
                {/if}
                <span class="cat-count">{categoryCounts[cat] || 0}</span>
              </div>
            {/each}
          </div>
          {#if bulkMode && bulkSelected.size > 0}
            <div class="bulk-category-assign">
              <span class="filter-label">Move {bulkSelected.size} to:</span>
              <div class="bulk-cat-btns">
                {#each categories as cat}
                  <button on:click={() => bulkSetCategory(cat)}>{cat}</button>
                {/each}
              </div>
            </div>
          {/if}
        </div>

        <div class="filter-section">
          <span class="filter-label">Sort</span>
          <select bind:value={sortBy}>
            <option value="name">Name</option>
            <option value="tier">Tier</option>
            <option value="category">Category</option>
          </select>
        </div>

        <div class="filter-section">
          <label class="bulk-toggle">
            <input type="checkbox" bind:checked={bulkMode} /> Bulk Edit Mode
          </label>
          {#if bulkMode && bulkSelected.size > 0}
            <div class="bulk-actions">
              <span>{bulkSelected.size} selected</span>
              <button on:click={selectAllVisible}>Select All Visible</button>
              <button on:click={clearBulkSelection}>Clear</button>
              <div class="bulk-tier-btns">
                <button class="tier-btn demo" on:click={() => bulkSetTier('demo')}>→ Demo</button>
                <button class="tier-btn starter" on:click={() => bulkSetTier('starter')}>→ Starter</button>
                <button class="tier-btn pro" on:click={() => bulkSetTier('pro')}>→ Pro</button>
              </div>
            </div>
          {/if}
        </div>

        {#if newShaderFiles.length > 0}
          <div class="filter-section new-shaders">
            <span class="filter-label">New Shaders ({newShaderFiles.length})</span>
            <button class="import-all-btn" on:click={importAllNew}>Import All</button>
            <ul>
              {#each newShaderFiles as file}
                <li>
                  <span>{file}</span>
                  <button on:click={() => importShader(file)}>Import</button>
                </li>
              {/each}
            </ul>
          </div>
        {/if}

        {#if scanResults}
          {@const totalFound = (scanResults.unmanagedISF?.length || 0) + (scanResults.newShaderFiles?.length || 0) + (scanResults.externalFiles?.length || 0)}
          {#if totalFound > 0}
            <div class="filter-section scan-results">
              <span class="filter-label">Scan Results ({totalFound} found)</span>
              <button class="import-all-btn" on:click={addAllUnmanaged}>Add All</button>

              {#if scanResults.unmanagedISF?.length > 0}
                <div class="scan-group">
                  <span class="scan-group-label">In ISF/ but not in manifest:</span>
                  <ul>
                    {#each scanResults.unmanagedISF as file}
                      <li>
                        <span title={file}>{file.length > 22 ? file.slice(0, 22) + '…' : file}</span>
                        <button on:click={() => addUnmanagedToManifest(file)}>Add</button>
                      </li>
                    {/each}
                  </ul>
                </div>
              {/if}

              {#if scanResults.newShaderFiles?.length > 0}
                <div class="scan-group">
                  <span class="scan-group-label">In new-shaders/:</span>
                  <ul>
                    {#each scanResults.newShaderFiles as file}
                      <li>
                        <span title={file}>{file.length > 22 ? file.slice(0, 22) + '…' : file}</span>
                        <button on:click={() => importExternalShader(file, 'new-shaders')}>Import</button>
                      </li>
                    {/each}
                  </ul>
                </div>
              {/if}

              {#if scanResults.externalFiles?.length > 0}
                <div class="scan-group">
                  <span class="scan-group-label">Found elsewhere:</span>
                  <ul>
                    {#each scanResults.externalFiles as { file, dir }}
                      <li>
                        <span title="{dir}/{file}">{file.length > 18 ? file.slice(0, 18) + '…' : file}</span>
                        <span class="scan-dir">{dir}</span>
                        <button on:click={() => importExternalShader(file, dir)}>Import</button>
                      </li>
                    {/each}
                  </ul>
                </div>
              {/if}
            </div>
          {:else}
            <div class="filter-section">
              <span class="scan-empty">✓ All shaders are in manifest</span>
            </div>
          {/if}
        {/if}
      </aside>

      <!-- Main content area with tabs -->
      <main class="shader-grid">
        <!-- View Tabs -->
        <div class="view-tabs">
          <button class="view-tab" class:active={activeView === 'defaults'} on:click={() => activeView = 'defaults'}>
            Defaults ({defaultLoadShaders.length})
          </button>
          <button class="view-tab" class:active={activeView === 'library'} on:click={() => activeView = 'library'}>
            Library ({libraryShaders.length})
          </button>
        </div>

        {#if activeView === 'defaults'}
          <!-- Default Load Order -->
          <div class="defaults-header">
            <p class="defaults-desc">These shaders load into the media tray on fresh install. Drag to reorder — top = first in tray.</p>
            <span class="defaults-count">{defaultLoadShaders.length} shaders</span>
          </div>

          {#if defaultLoadShaders.length === 0}
            <div class="defaults-empty">
              <p>No shaders marked as default load.</p>
              <p>Go to <button class="link-btn" on:click={() => activeView = 'library'}>Library</button> and check the blue "D" checkbox on cards you want loaded by default.</p>
            </div>
          {:else}
            <div class="defaults-list">
              {#each defaultLoadShaders as entry, idx (entry.file)}
                <div
                  class="defaults-row"
                  class:drag-over={defaultDragOver === entry.file}
                  class:dragging={defaultDragSource === entry.file}
                  draggable="true"
                  on:dragstart={(e) => handleDefaultDragStart(e, entry.file)}
                  on:dragover={(e) => handleDefaultDragOver(e, entry.file)}
                  on:dragleave={() => { if (defaultDragOver === entry.file) defaultDragOver = null; }}
                  on:drop={(e) => handleDefaultDragDrop(e, entry.file)}
                  on:dragend={() => { defaultDragSource = null; defaultDragOver = null; }}
                >
                  <div class="defaults-drag-handle" title="Drag to reorder">⠿</div>
                  <span class="defaults-index">{idx + 1}</span>
                  <div class="defaults-thumb">
                    {#if thumbnails[entry.file]}
                      <img src={thumbnails[entry.file]} alt="" />
                    {:else}
                      <div class="defaults-thumb-placeholder">◇</div>
                    {/if}
                  </div>
                  <div class="defaults-info">
                    <span class="defaults-name">{entry.file.replace('.fs', '').replace(/^DM-/, '').replace(/^SM-/, '').replace(/^AR-/, '').replace(/^cube shaders\//, '')}</span>
                    <span class="defaults-meta">
                      {#if entry.category}<span class="defaults-cat">{entry.category}</span>{/if}
                      <span class="defaults-tier {entry.tier || 'demo'}">{(entry.tier || 'demo').toUpperCase()}</span>
                    </span>
                  </div>
                  <div class="defaults-actions">
                    <button class="defaults-move-btn" on:click={() => moveDefaultShader(entry.file, 'up')} disabled={idx === 0} title="Move up">▲</button>
                    <button class="defaults-move-btn" on:click={() => moveDefaultShader(entry.file, 'down')} disabled={idx === defaultLoadShaders.length - 1} title="Move down">▼</button>
                    <button class="defaults-remove-btn" on:click={() => removeFromDefaults(entry.file)} title="Remove from defaults">✕</button>
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        {:else}
          <!-- Library Grid (non-default shaders) -->
          <div class="grid-header">
            <span>{libraryShaders.length} of {libraryTotalCount} library shaders</span>
          </div>
          <div class="grid">
            {#each libraryShaders as entry (entry.file)}
              <div
                class="grid-card-wrapper"
                class:drag-over={dragOverFile === entry.file}
                draggable="true"
                on:dragstart={(e) => handleDragStart(e, entry.file)}
                on:dragover={(e) => handleDragOver(e, entry.file)}
                on:dragleave={() => { if (dragOverFile === entry.file) dragOverFile = null; }}
                on:drop={(e) => handleDragDrop(e, entry.file)}
                on:dragend={() => { dragSourceFile = null; dragOverFile = null; }}
              >
                <ShaderCard
                  {entry}
                  selected={selectedShader?.file === entry.file}
                  bulkSelected={bulkSelected.has(entry.file)}
                  {bulkMode}
                  thumbnailUrl={thumbnails[entry.file] || null}
                  on:click={() => bulkMode ? toggleBulkSelect(entry.file) : selectShader(entry)}
                  on:tierChange={(e) => updateEntry(entry.file, { tier: e.detail })}
                  on:enableToggle={(e) => updateEntry(entry.file, { enabled: e.detail })}
                  on:defaultLoadToggle={(e) => { updateEntry(entry.file, { defaultLoad: e.detail }); if (e.detail) promoteToDefault(entry.file); }}
                  on:delete={() => deleteShader(entry.file)}
                />
              </div>
            {/each}
          </div>
        {/if}
      </main>

      <!-- Detail / Preview Panel -->
      {#if selectedShader}
        <aside class="detail-panel">
          <div class="detail-top-bar">
            <div class="detail-file-info">
              <span class="detail-filename">{selectedShader.file}</span>
              <div class="detail-inline-meta">
                <select value={selectedShader.tier} on:change={(e) => updateEntry(selectedShader.file, { tier: e.target.value })}>
                  <option value="demo">Demo</option>
                  <option value="starter">Starter</option>
                  <option value="pro">Pro</option>
                </select>
                <input type="text" value={selectedShader.category} placeholder="Category"
                  on:change={(e) => updateEntry(selectedShader.file, { category: e.target.value })} />
                <input type="text" value={(selectedShader.tags || []).join(', ')} placeholder="tag1, tag2"
                  on:change={(e) => updateEntry(selectedShader.file, { tags: e.target.value.split(',').map(t => t.trim()).filter(Boolean) })} />
                <label class="featured-check">
                  <input type="checkbox" checked={selectedShader.featured}
                    on:change={(e) => updateEntry(selectedShader.file, { featured: e.target.checked })} />
                  ★
                </label>
              </div>
            </div>
            <button class="close-btn" on:click={closeDetail}>✕</button>
          </div>

          <ShaderPreview
            entry={selectedShader}
            source={selectedSource}
            on:saveDefaults={handleSaveDefaults}
            on:thumbnailSaved={handleThumbnailSaved}
          />
        </aside>
      {/if}
    </div>
  {/if}
</div>

<style>
  .grid-card-wrapper { transition: transform 0.1s; }
  .grid-card-wrapper.drag-over { transform: scale(0.97); outline: 2px solid #6eb5ff; outline-offset: 2px; border-radius: 6px; }
  .admin-app { min-height: 100vh; display: flex; flex-direction: column; }

  header {
    display: flex; justify-content: space-between; align-items: center;
    padding: 10px 20px; background: #141418; border-bottom: 1px solid rgba(255,255,255,0.08);
    flex-shrink: 0;
  }
  .header-left { display: flex; align-items: center; gap: 16px; }
  .header-right { display: flex; align-items: center; gap: 10px; }
  h1 { font-size: 16px; font-weight: 600; margin: 0; }
  .shader-count { color: #888; font-size: 13px; }
  .tier-counts { display: flex; gap: 8px; }
  .tier-badge { font-size: 11px; padding: 2px 8px; border-radius: 8px; }
  .tier-badge.demo { background: #333; color: #aaa; }
  .tier-badge.starter { background: #1a3a6a; color: #6eb5ff; }
  .tier-badge.pro { background: #5a3a00; color: #ffb347; }
  .tier-badge.excluded { background: #3a1a1a; color: #ff6b6b; }
  .status-msg { color: #2ed573; font-size: 13px; }
  .gen-progress { color: #FF6B6B; font-size: 12px; font-family: monospace; }
  .header-btn {
    border: none; padding: 7px 14px; border-radius: 6px;
    cursor: pointer; font-weight: 600; font-size: 12px;
  }
  .save-btn { background: #FF6B6B; color: white; }
  .save-btn:hover { background: #ff5252; }
  .save-btn:disabled { opacity: 0.5; }
  .scan-btn { background: #1a4a3a; color: #2ed573; }
  .scan-btn:hover { background: #1e5a44; }
  .scan-btn:disabled { opacity: 0.6; }
  .gen-btn { background: #1a3a6a; color: #6eb5ff; }
  .gen-btn:hover { background: #1e4580; }
  .gen-btn:disabled { opacity: 0.6; }

  .loading { text-align: center; padding: 60px; color: #888; font-size: 18px; }

  .main-layout { display: flex; flex: 1; min-height: 0; height: calc(100vh - 50px); }

  .sidebar {
    width: 220px; padding: 12px; background: #111114;
    border-right: 1px solid rgba(255,255,255,0.06); overflow-y: auto;
    flex-shrink: 0;
  }
  .filter-section { margin-bottom: 14px; }
  .filter-label { display: block; font-size: 10px; color: #666; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
  .search-input {
    width: 100%; padding: 7px 10px; background: #1a1a1e; border: 1px solid #333;
    border-radius: 4px; color: #e0e0e0; font-size: 12px;
  }
  .search-input:focus { border-color: #FF6B6B; outline: none; }
  .filter-chips { display: flex; gap: 4px; flex-wrap: wrap; }
  .filter-chips button {
    padding: 4px 10px; border: 1px solid #333; background: transparent;
    color: #aaa; border-radius: 12px; font-size: 11px; cursor: pointer;
  }
  .filter-chips button.active { background: #FF6B6B; color: white; border-color: #FF6B6B; }
  select {
    width: 100%; padding: 5px; background: #1a1a1e; border: 1px solid #333;
    color: #e0e0e0; border-radius: 4px; font-size: 11px;
  }

  .bulk-toggle { font-size: 12px; color: #aaa; cursor: pointer; display: flex; align-items: center; gap: 6px; }
  .bulk-actions { margin-top: 8px; }
  .bulk-actions span { color: #FF6B6B; font-size: 12px; }
  .bulk-actions button { font-size: 11px; padding: 3px 8px; margin: 2px; background: #222; border: 1px solid #444; color: #ccc; border-radius: 3px; cursor: pointer; }
  .bulk-tier-btns { margin-top: 6px; display: flex; gap: 4px; }
  .tier-btn { font-size: 11px; padding: 4px 8px; border-radius: 4px; cursor: pointer; border: none; }
  .tier-btn.demo { background: #333; color: #ccc; }
  .tier-btn.starter { background: #1a3a6a; color: #6eb5ff; }
  .tier-btn.pro { background: #5a3a00; color: #ffb347; }

  .new-shaders ul { list-style: none; margin-top: 8px; }
  .new-shaders li { display: flex; justify-content: space-between; align-items: center; padding: 4px 0; font-size: 11px; }
  .new-shaders li button { font-size: 10px; padding: 2px 8px; background: #2ed573; color: #000; border: none; border-radius: 3px; cursor: pointer; }
  .import-all-btn { background: #2ed573; color: #000; border: none; padding: 4px 12px; border-radius: 4px; font-size: 11px; cursor: pointer; margin-top: 4px; }

  .scan-results ul { list-style: none; margin-top: 4px; }
  .scan-results li { display: flex; justify-content: space-between; align-items: center; padding: 3px 0; font-size: 10px; gap: 4px; }
  .scan-results li button { font-size: 9px; padding: 2px 6px; background: #2ed573; color: #000; border: none; border-radius: 3px; cursor: pointer; flex-shrink: 0; }
  .scan-group { margin-top: 8px; }
  .scan-group-label { font-size: 9px; color: #888; display: block; margin-bottom: 2px; }
  .scan-dir { font-size: 8px; color: #555; }
  .scan-empty { font-size: 11px; color: #2ed573; }

  /* Category organizer */
  .category-organizer { border-top: 1px solid rgba(255,255,255,0.06); padding-top: 10px; }
  .category-list { display: flex; flex-direction: column; gap: 1px; background: rgba(255,255,255,0.03); border-radius: 4px; overflow: hidden; }
  .category-row {
    display: flex; align-items: center; justify-content: space-between;
    background: #16161b; padding: 4px 8px; transition: background 0.1s;
  }
  .category-row:hover { background: #1e1e28; }
  .category-row.drag-over { background: #1a2a3a; outline: 1px solid #6eb5ff; }
  .cat-name-btn {
    flex: 1; text-align: left; background: none; border: none;
    color: #aaa; font-size: 11px; cursor: pointer; padding: 2px 0;
  }
  .cat-name-btn:hover { color: #fff; }
  .cat-name-btn.active { color: #FF6B6B; font-weight: 600; }
  .cat-count { font-size: 10px; color: #555; font-variant-numeric: tabular-nums; min-width: 20px; text-align: right; }
  .rename-input {
    flex: 1; font-size: 11px; padding: 2px 4px;
    background: #1a1a1e; border: 1px solid #FF6B6B; color: #e0e0e0; border-radius: 2px;
  }
  .bulk-category-assign { margin-top: 8px; }
  .bulk-cat-btns { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 4px; }
  .bulk-cat-btns button {
    font-size: 10px; padding: 3px 6px; background: #222; border: 1px solid #444;
    color: #ccc; border-radius: 3px; cursor: pointer;
  }
  .bulk-cat-btns button:hover { border-color: #FF6B6B; color: #fff; }

  .shader-grid { flex: 1; display: flex; flex-direction: column; overflow-y: auto; padding: 12px; min-width: 0; }
  .grid-header { font-size: 12px; color: #888; margin-bottom: 10px; flex-shrink: 0; }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 10px;
  }

  /* Detail panel - sticky on right, scrolls independently */
  .detail-panel {
    width: 420px;
    background: #111114;
    border-left: 1px solid rgba(255,255,255,0.06);
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    overflow-y: auto;
    position: sticky;
    top: 0;
    align-self: flex-start;
    max-height: calc(100vh - 50px);
  }

  .detail-top-bar {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding: 10px 12px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    flex-shrink: 0;
  }
  .detail-file-info { flex: 1; min-width: 0; }
  .detail-filename {
    font-size: 12px; font-weight: 600; display: block;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    margin-bottom: 6px;
  }
  .detail-inline-meta {
    display: flex; gap: 4px; flex-wrap: wrap; align-items: center;
  }
  .detail-inline-meta select {
    width: auto; font-size: 10px; padding: 2px 4px;
  }
  .detail-inline-meta input[type="text"] {
    width: 90px; font-size: 10px; padding: 3px 6px;
    background: #1a1a1e; border: 1px solid #333; color: #e0e0e0; border-radius: 3px;
  }
  .featured-check {
    font-size: 14px; color: #ffb347; cursor: pointer;
    display: flex; align-items: center; gap: 2px;
  }
  .featured-check input { width: 12px; height: 12px; }
  .close-btn {
    background: none; border: none; color: #666; font-size: 16px;
    cursor: pointer; padding: 0 4px; flex-shrink: 0;
  }
  .close-btn:hover { color: #fff; }

  /* View Tabs */
  .view-tabs {
    display: flex; gap: 0; margin-bottom: 12px; flex-shrink: 0;
    border-bottom: 1px solid rgba(255,255,255,0.08);
  }
  .view-tab {
    padding: 8px 20px; font-size: 12px; font-weight: 600;
    background: transparent; border: none; border-bottom: 2px solid transparent;
    color: #888; cursor: pointer; transition: all 0.15s;
  }
  .view-tab:hover { color: #ccc; }
  .view-tab.active { color: #FF6B6B; border-bottom-color: #FF6B6B; }

  /* Default Load Order view */
  .defaults-header {
    display: flex; justify-content: space-between; align-items: center;
    margin-bottom: 12px; flex-shrink: 0;
  }
  .defaults-desc { font-size: 12px; color: #888; margin: 0; }
  .defaults-count { font-size: 12px; color: #666; white-space: nowrap; }

  .defaults-empty {
    text-align: center; padding: 60px 20px; color: #666; font-size: 13px;
  }
  .defaults-empty p { margin: 8px 0; }
  .link-btn {
    background: none; border: none; color: #FF6B6B; cursor: pointer;
    font-size: 13px; text-decoration: underline; padding: 0;
  }
  .link-btn:hover { color: #ff5252; }

  .defaults-list {
    display: flex; flex-direction: column; gap: 2px;
    background: rgba(255,255,255,0.02); border-radius: 6px; overflow: hidden;
  }
  .defaults-row {
    display: flex; align-items: center; gap: 10px;
    padding: 8px 12px; background: #16161b;
    cursor: grab; transition: all 0.15s; user-select: none;
  }
  .defaults-row:hover { background: #1e1e26; }
  .defaults-row.drag-over {
    background: #1a2a3a; outline: 2px solid #6eb5ff; outline-offset: -2px;
  }
  .defaults-row.dragging { opacity: 0.4; }

  .defaults-drag-handle {
    font-size: 16px; color: #444; cursor: grab; flex-shrink: 0;
    width: 16px; text-align: center; letter-spacing: -1px;
  }
  .defaults-row:hover .defaults-drag-handle { color: #888; }

  .defaults-index {
    font-size: 11px; font-weight: 700; color: #555;
    width: 22px; text-align: center; flex-shrink: 0;
    font-variant-numeric: tabular-nums;
  }

  .defaults-thumb {
    width: 56px; height: 32px; border-radius: 3px; overflow: hidden;
    flex-shrink: 0; background: #111;
  }
  .defaults-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .defaults-thumb-placeholder {
    width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
    color: rgba(255,255,255,0.12); font-size: 14px;
  }

  .defaults-info { flex: 1; min-width: 0; }
  .defaults-name {
    font-size: 12px; font-weight: 500; color: #ddd; display: block;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .defaults-meta { display: flex; align-items: center; gap: 8px; margin-top: 2px; }
  .defaults-cat { font-size: 10px; color: #666; }
  .defaults-tier {
    font-size: 9px; padding: 1px 6px; border-radius: 4px; font-weight: 700;
  }
  .defaults-tier.demo { background: #333; color: #aaa; }
  .defaults-tier.starter { background: #1a3a6a; color: #6eb5ff; }
  .defaults-tier.pro { background: #5a3a00; color: #ffb347; }

  .defaults-actions { display: flex; gap: 4px; flex-shrink: 0; }
  .defaults-move-btn {
    width: 24px; height: 24px; border-radius: 4px;
    background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
    color: #888; font-size: 10px; cursor: pointer; transition: all 0.15s;
    display: flex; align-items: center; justify-content: center; padding: 0;
  }
  .defaults-move-btn:hover { border-color: #6eb5ff; color: #6eb5ff; }
  .defaults-move-btn:disabled { opacity: 0.25; cursor: not-allowed; }
  .defaults-remove-btn {
    width: 24px; height: 24px; border-radius: 4px;
    background: rgba(255,50,50,0.08); border: 1px solid rgba(255,50,50,0.15);
    color: #ff6b6b; font-size: 12px; cursor: pointer; transition: all 0.15s;
    display: flex; align-items: center; justify-content: center; padding: 0;
  }
  .defaults-remove-btn:hover { background: rgba(255,50,50,0.2); border-color: rgba(255,50,50,0.4); color: #ff4444; }

  /* When detail panel open, shrink grid */
  .main-layout.has-detail .shader-grid { flex: 1; }
  .main-layout.has-detail .grid {
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  }
</style>
