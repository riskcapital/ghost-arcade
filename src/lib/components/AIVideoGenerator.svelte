<script lang="ts">
  import { createEventDispatcher, onDestroy } from 'svelte';
  import {
    generateOmniVideo, generateLumaVideo, enhancePromptForLoop, isAbortError, lumaModelOptions,
    type OmniModel, type LumaModel, type LumaAspectRatio, type LumaDuration, type LumaResolution
  } from '../api/ai-client';
  import { settings, OMNI_MODELS, LUMA_MODELS } from '../stores/settings';
  import { downloadRecording } from '../recording/recorder';
  import { generateUUID } from '../types';

  const dispatch = createEventDispatcher<{
    generated: { id: string; name: string; src: string; blob: Blob };
    close: void;
  }>();

  // Read from centralized settings
  $: videoProvider = $settings.ai.videoProvider;
  $: isLuma = videoProvider === 'luma';
  $: apiKey = isLuma ? $settings.ai.lumaApiKey : $settings.ai.geminiApiKey;
  $: currentModel = isLuma ? $settings.ai.lumaModel : $settings.ai.veoModel;

  // Generation settings
  let prompt = '';
  let negativePrompt = '';
  let showAdvanced = false;

  // Gemini Omni settings
  let veoAspectRatio: '16:9' | '9:16' = '16:9';
  let veoDuration: 4 | 6 | 8 = 8;
  let veoFirstFrameFile: File | null = null;
  let veoLastFrameFile: File | null = null;
  let veoFirstFramePreview = '';
  let veoLastFramePreview = '';

  // Luma settings
  let lumaAspectRatio: LumaAspectRatio = '16:9';
  let lumaDuration: LumaDuration = '5s';
  let lumaResolution: LumaResolution = '720p';
  let loopEnabled = false;
  // What the chosen Luma model accepts. A choice it does not take falls back
  // to one it does when the model changes.
  $: lumaOptions = lumaModelOptions(String(currentModel));
  $: if (isLuma && !lumaOptions.aspectRatios.includes(lumaAspectRatio)) lumaAspectRatio = '16:9';
  $: if (isLuma && !lumaOptions.resolutions.includes(lumaResolution)) lumaResolution = '720p';
  $: if (isLuma && !lumaOptions.durations.includes(lumaDuration)) lumaDuration = '5s';
  $: if (isLuma && loopEnabled && !lumaOptions.loopDurations.includes(lumaDuration)) lumaDuration = '5s';

  // Generation state
  let isGenerating = false;
  let error = '';
  let statusMessage = '';
  // Cancels the running request and its polling when the panel closes.
  let job: AbortController | null = null;
  let elapsedSeconds = 0;
  let elapsedTimer: ReturnType<typeof setInterval> | null = null;

  // Preview state
  let previewUrl = '';
  let previewBlob: Blob | null = null;

  // Example prompts
  const examplePrompts = [
    'Abstract flowing neon ribbons dancing through dark space, vibrant colors',
    'Cinematic aerial shot over a futuristic cyberpunk city at night with rain',
    'Liquid chrome morphing organic shapes with iridescent reflections',
    'Geometric fractal patterns unfolding and rotating, kaleidoscopic',
    'Slow motion ink drops expanding in water, vivid colors on black',
    'Electric plasma tendrils arcing through darkness, purple and blue',
  ];

  function useExample(ex: string) {
    prompt = ex;
  }

  function setVeoFrame(kind: 'first' | 'last', event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] || null;
    const priorPreview = kind === 'first' ? veoFirstFramePreview : veoLastFramePreview;
    if (priorPreview) URL.revokeObjectURL(priorPreview);

    if (kind === 'first') {
      veoFirstFrameFile = file;
      veoFirstFramePreview = file ? URL.createObjectURL(file) : '';
    } else {
      veoLastFrameFile = file;
      veoLastFramePreview = file ? URL.createObjectURL(file) : '';
      if (file) veoDuration = 8;
    }
  }

  function clearVeoFrame(kind: 'first' | 'last') {
    if (kind === 'first') {
      if (veoFirstFramePreview) URL.revokeObjectURL(veoFirstFramePreview);
      veoFirstFrameFile = null;
      veoFirstFramePreview = '';
    } else {
      if (veoLastFramePreview) URL.revokeObjectURL(veoLastFramePreview);
      veoLastFrameFile = null;
      veoLastFramePreview = '';
    }
  }

  $: if (!isLuma && veoLastFrameFile && veoDuration !== 8) {
    veoDuration = 8;
  }

  // ─── Generation ─────────────────────────────────────────────────────
  async function generate() {
    if (!apiKey) {
      error = isLuma
        ? 'Luma API key required. Configure in Settings → AI.'
        : 'Gemini API key required. Configure in Settings → AI.';
      return;
    }
    if (!prompt.trim()) {
      error = 'Enter a video description.';
      return;
    }

    error = '';
    isGenerating = true;
    elapsedSeconds = 0;
    elapsedTimer = setInterval(() => { elapsedSeconds++; }, 1000);

    try {
      if (isLuma) {
        await generateLuma();
      } else {
        await generateVeo();
      }
    } catch (err) {
      if (isAbortError(err)) return;
      error = err instanceof Error ? err.message : 'Generation failed';
      cleanup();
    }
  }

  function showVideo(blob: Blob) {
    previewBlob = blob;
    if (previewUrl) URL.revokeObjectURL(previewUrl); // prevent blob leak on re-generation
    previewUrl = URL.createObjectURL(blob);
    statusMessage = 'Video ready!';
  }

  async function generateVeo() {
    if (veoLastFrameFile && !veoFirstFrameFile) {
      error = 'Add a first frame before adding a last frame.';
      cleanup();
      return;
    }
    job = new AbortController();
    const result = await generateOmniVideo({
      apiKey,
      prompt: prompt.trim(),
      model: currentModel as OmniModel,
      aspectRatio: veoAspectRatio,
      durationSeconds: veoLastFrameFile ? 8 : veoDuration,
      avoid: negativePrompt.trim() || undefined,
      firstFrame: veoFirstFrameFile || undefined,
      lastFrame: veoLastFrameFile || undefined,
    }, { signal: job.signal, onStatus: (message) => { statusMessage = message; } });
    if (result.blob) showVideo(result.blob);
    else { error = result.error || 'Gemini Omni did not return a video.'; statusMessage = ''; }
    cleanup();
  }

  async function generateLuma() {
    // Enhance prompt for loop if enabled
    const finalPrompt = loopEnabled
      ? enhancePromptForLoop(prompt.trim(), false)
      : prompt.trim();

    job = new AbortController();
    const result = await generateLumaVideo({
      apiKey,
      prompt: finalPrompt,
      model: currentModel as LumaModel,
      aspectRatio: lumaAspectRatio,
      duration: lumaDuration,
      resolution: lumaResolution,
      loop: loopEnabled,
    }, { signal: job.signal, onStatus: (message) => { statusMessage = message; } });
    if (result.blob) showVideo(result.blob);
    else { error = result.error || 'Luma did not return a video.'; statusMessage = ''; }
    cleanup();
  }

  function cleanup() {
    isGenerating = false;
    job?.abort();
    job = null;
    if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
  }

  async function addToLibrary() {
    if (!previewBlob || !previewUrl) return;

    const name = prompt.trim().slice(0, 40) || (isLuma ? 'Luma Video' : 'Gemini Omni Video');
    const blobRef = previewBlob;
    const urlRef = previewUrl;
    const dispatchId = generateUUID();

    // Dispatch to parent FIRST so MediaTray / VJModePanel adds to library
    // and switches tabs BEFORE any potentially-blocking save flow runs.
    try {
      dispatch('generated', {
        id: dispatchId,
        name: `AI: ${name}`,
        src: urlRef,
        blob: blobRef,
      });
    } catch (err) {
      console.warn('[AI Video] generated dispatch failed:', err);
    }

    previewUrl = '';
    previewBlob = null;
    statusMessage = '';

    // Save to disk using the same path as output recordings (dirHandle →
    // configured folder, or fallback to browser Downloads).
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const safeName = name.replace(/[^a-zA-Z0-9_\- ]/g, '').trim().replace(/\s+/g, '_');
      const filename = `AI_${safeName}_${timestamp}.mp4`;
      await downloadRecording(blobRef, filename);
    } catch (err) {
      console.warn('[AI Video] Disk save failed (non-fatal):', err);
    }

    // Explicitly close the generator panel.
    try { dispatch('close'); } catch {}
  }

  function formatTime(s: number): string {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  }

  onDestroy(() => {
    cleanup();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (veoFirstFramePreview) URL.revokeObjectURL(veoFirstFramePreview);
    if (veoLastFramePreview) URL.revokeObjectURL(veoLastFramePreview);
  });
</script>

<div data-help-page="ai-generation" class="veo-generator">
  <div class="header">
    <h4>AI video generator</h4>
    <button aria-label="Close video generator" class="close-btn" onclick={() => dispatch('close')}>&times;</button>
  </div>

  <!-- Provider tabs -->
  <div class="provider-tabs">
    <button
      class="provider-tab"
      class:active={!isLuma}
      onclick={() => settings.setVideoProvider('veo')}
    >
      Gemini Omni
    </button>
    <button
      class="provider-tab"
      class:active={isLuma}
      onclick={() => settings.setVideoProvider('luma')}
    >
      Luma
    </button>
  </div>

  <!-- API key warning -->
  {#if !apiKey}
    <div class="api-key-warning">
      {isLuma ? 'Luma' : 'Gemini'} API key not set.
      <span class="configure-hint">Configure in Settings → AI</span>
    </div>
  {/if}

  <!-- Prompt -->
  <div class="prompt-section">
    <textarea
      bind:value={prompt}
      placeholder="Describe the video you want to generate..."
      rows={3}
      disabled={isGenerating}
    ></textarea>
  </div>

  <!-- Example prompts -->
  {#if !isGenerating && !previewUrl}
    <div class="examples">
      {#each examplePrompts as ex}
        <button class="example-chip" onclick={() => useExample(ex)} title={ex}>
          {ex.slice(0, 45)}{ex.length > 45 ? '...' : ''}
        </button>
      {/each}
    </div>
  {/if}

  <!-- Settings row -->
  <div class="settings-row">
    <!-- Model -->
    <div class="setting">
      <label>Model</label>
      <select value={currentModel} onchange={(e) => isLuma ? settings.setLumaModel((e.target as HTMLSelectElement).value) : settings.setVeoModel((e.target as HTMLSelectElement).value)} disabled={isGenerating}>
        {#each (isLuma ? LUMA_MODELS : OMNI_MODELS) as model}
          <option value={model.id}>{model.label}</option>
        {/each}
      </select>
    </div>

    <!-- Aspect ratio -->
    <div class="setting">
      <label>Aspect</label>
      {#if isLuma}
        <select bind:value={lumaAspectRatio} disabled={isGenerating}>
          {#each lumaOptions.aspectRatios as ratio}
            <option value={ratio}>{ratio}</option>
          {/each}
        </select>
      {:else}
        <select bind:value={veoAspectRatio} disabled={isGenerating}>
          <option value="16:9">16:9</option>
          <option value="9:16">9:16</option>
        </select>
      {/if}
    </div>

    <!-- Duration -->
    <div class="setting">
      <label>Duration</label>
      {#if isLuma}
        <select bind:value={lumaDuration} disabled={isGenerating}>
          {#each lumaOptions.durations as duration}
            <option value={duration} disabled={loopEnabled && !lumaOptions.loopDurations.includes(duration)}>{duration}</option>
          {/each}
        </select>
      {:else}
        <select bind:value={veoDuration} disabled={isGenerating || !!veoLastFrameFile}>
          <option value={4}>4s</option>
          <option value={6}>6s</option>
          <option value={8}>8s</option>
        </select>
      {/if}
    </div>

    <button class="toggle-advanced" onclick={() => showAdvanced = !showAdvanced}>
      {showAdvanced ? 'Less' : 'More'}
    </button>
  </div>

  <!-- Luma-specific: Resolution + Loop -->
  {#if isLuma}
    <div class="luma-options">
      <div class="setting">
        <label>Resolution</label>
        <select bind:value={lumaResolution} disabled={isGenerating}>
          {#each lumaOptions.resolutions as resolution}
            <option value={resolution}>{resolution === '4k' ? '4K' : resolution === '360p' ? '360p (draft)' : resolution}</option>
          {/each}
        </select>
      </div>
      <label class="loop-toggle">
        <input type="checkbox" bind:checked={loopEnabled} disabled={isGenerating} />
        <span>Seamless loop</span>
      </label>
    </div>

  {:else}
    <div class="veo-keyframes">
      <div class="keyframe-slot">
        <label class="keyframe-pick" for="veo-first-frame">
          <span>First frame</span>
          <input
            id="veo-first-frame"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onchange={(e) => setVeoFrame('first', e)}
            disabled={isGenerating}
          />
        </label>
        {#if veoFirstFramePreview}
          <div class="keyframe-preview">
            <img src={veoFirstFramePreview} alt="First frame" />
            <button type="button" onclick={() => clearVeoFrame('first')} disabled={isGenerating}>Clear</button>
          </div>
        {/if}
      </div>

      <div class="keyframe-slot">
        <label class="keyframe-pick" for="veo-last-frame">
          <span>Last frame</span>
          <input
            id="veo-last-frame"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onchange={(e) => setVeoFrame('last', e)}
            disabled={isGenerating}
          />
        </label>
        {#if veoLastFramePreview}
          <div class="keyframe-preview">
            <img src={veoLastFramePreview} alt="Last frame" />
            <button type="button" onclick={() => clearVeoFrame('last')} disabled={isGenerating}>Clear</button>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  {#if showAdvanced}
    <div class="advanced-section">
      <!-- Things to avoid (Gemini Omni only) -->
      {#if !isLuma}
        <div class="field">
          <label>Negative prompt</label>
          <input
            type="text"
            bind:value={negativePrompt}
            placeholder="What to avoid..."
            disabled={isGenerating}
          />
        </div>
      {/if}

    </div>
  {/if}

  <!-- Generate button -->
  <button
    class="generate-btn primary-btn"
    onclick={generate}
    disabled={isGenerating || !prompt.trim()}
  >
    {#if isGenerating}
      <span class="spinner"></span>
      Generating...
    {:else}
      Generate video
    {/if}
  </button>

  <!-- Status -->
  {#if statusMessage}
    <div class="status" class:done={!!previewUrl}>
      <span>{statusMessage}</span>
      {#if isGenerating}
        <span class="elapsed">{formatTime(elapsedSeconds)}</span>
      {/if}
    </div>
  {/if}

  <!-- Error -->
  {#if error}
    <div class="error">{error}</div>
  {/if}

  <!-- Preview -->
  {#if previewUrl}
    <div class="preview">
      <!-- svelte-ignore a11y_media_has_caption -->
      <video src={previewUrl} controls loop autoplay muted></video>
      <button class="add-btn" onclick={addToLibrary}>
        Add to Media Library
      </button>
    </div>
  {/if}
</div>

<style>
  .veo-generator {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    background: var(--ga-panel, #0d0d14);
    border-radius: var(--ga-r-soft, 7px);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    font-size: var(--ga-text-control);
    color: var(--ga-ink-1, #9aa0ac);
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  h4 {
    margin: 0;
    font-size: var(--ga-text-title);
    font-weight: var(--ga-weight-title);
    color: var(--ga-ink-0, #eef0f4);
  }

  .close-btn {
    width: var(--ga-control-h-sm, 22px);
    height: var(--ga-control-h-sm, 22px);
    background: none;
    border: none;
    border-radius: var(--ga-r-hard, 3px);
    color: var(--ga-ink-2, #89857e);
    font-size: var(--ga-text-heading);
    line-height: 1;
    cursor: pointer;
    padding: 0;
  }
  .close-btn:hover {
    color: var(--ga-ink-0, #eef0f4);
    background: var(--ga-raise, #26221c);
  }

  /* Provider: a two-way segmented choice. */
  .provider-tabs {
    display: flex;
    gap: 4px;
  }

  .provider-tab {
    flex: 1;
    height: var(--ga-control-h, 26px);
    padding: 0 8px;
    background: var(--ga-card, #111);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    color: var(--ga-ink-1, #9aa0ac);
    font-size: var(--ga-text-control);
    font-weight: var(--ga-weight-control);
    cursor: pointer;
    border-radius: var(--ga-r-hard, 3px);
    transition: border-color 0.15s, color 0.15s, background 0.15s;
  }

  .provider-tab:hover {
    border-color: var(--ga-line-3, rgba(255, 255, 255, 0.20));
    color: var(--ga-ink-0, #eef0f4);
  }

  .provider-tab.active {
    background: var(--ga-selection-bg, #1f3170);
    border-color: var(--ga-selection-line, #5278ff);
    color: var(--ga-selection-ink, #e0e8ff);
  }

  .api-key-warning,
  .error {
    padding: 6px 8px;
    background: color-mix(in srgb, var(--ga-rec, #ff4438) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--ga-rec, #ff4438) 45%, transparent);
    border-radius: var(--ga-r-hard, 3px);
    color: var(--ga-rec, #ff6688);
    font-size: var(--ga-text-meta);
  }

  .configure-hint {
    opacity: 0.75;
  }

  .prompt-section textarea {
    width: 100%;
    background: var(--ga-slot, #050607);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    color: var(--ga-ink-0, #eef0f4);
    padding: 8px 10px;
    font-size: var(--ga-text-body);
    border-radius: var(--ga-r-hard, 3px);
    resize: vertical;
    font-family: inherit;
    box-sizing: border-box;
  }
  .prompt-section textarea:focus {
    border-color: var(--ga-focus, #8aa4ff);
    outline: none;
  }

  .examples {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .example-chip {
    height: var(--ga-control-h-sm, 22px);
    background: var(--ga-card, #14141e);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    color: var(--ga-ink-1, #9aa0ac);
    padding: 0 8px;
    font-size: var(--ga-text-meta);
    border-radius: var(--ga-r-hard, 3px);
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 200px;
  }
  .example-chip:hover {
    color: var(--ga-ink-0, #eef0f4);
    border-color: var(--ga-line-3, rgba(255, 255, 255, 0.20));
  }

  .settings-row {
    display: flex;
    gap: 6px;
    align-items: flex-end;
    flex-wrap: wrap;
  }
  .setting {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  /* Field labels: eyebrows. */
  .setting label,
  .field label,
  .keyframe-pick span {
    font-size: var(--ga-text-eyebrow);
    font-weight: 700;
    letter-spacing: var(--ga-eyebrow-tracking, 0.08em);
    color: var(--ga-ink-2, #89857e);
    text-transform: uppercase;
  }
  .setting select {
    height: var(--ga-control-h-sm, 22px);
    background: var(--ga-slot, #050607);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    color: var(--ga-ink-0, #eef0f4);
    padding: 0 6px;
    font-size: var(--ga-text-meta);
    border-radius: var(--ga-r-hard, 3px);
  }

  .toggle-advanced {
    height: var(--ga-control-h-sm, 22px);
    background: none;
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    color: var(--ga-ink-1, #9aa0ac);
    padding: 0 8px;
    font-size: var(--ga-text-meta);
    font-weight: var(--ga-weight-control);
    border-radius: var(--ga-r-hard, 3px);
    cursor: pointer;
    margin-left: auto;
  }
  .toggle-advanced:hover {
    color: var(--ga-ink-0, #eef0f4);
    border-color: var(--ga-line-3, rgba(255, 255, 255, 0.20));
  }

  /* Luma-specific options */
  .luma-options {
    display: flex;
    gap: 10px;
    align-items: flex-end;
  }

  .loop-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--ga-text-control);
    color: var(--ga-ink-1, #9aa0ac);
    cursor: pointer;
    padding: 3px 0;
  }

  .veo-keyframes {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .keyframe-slot {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .keyframe-pick {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .keyframe-pick input {
    width: 100%;
    color: var(--ga-ink-1, #9aa0ac);
    font-size: var(--ga-text-meta);
  }

  .keyframe-preview {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 4px;
    align-items: center;
    min-width: 0;
  }

  .keyframe-preview img {
    width: 100%;
    height: 44px;
    object-fit: cover;
    border-radius: var(--ga-r-hard, 3px);
    background: #000;
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
  }

  .keyframe-preview button {
    height: var(--ga-control-h-sm, 22px);
    background: var(--ga-card, #13161c);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    color: var(--ga-ink-1, #9aa0ac);
    font-size: var(--ga-text-meta);
    border-radius: var(--ga-r-hard, 3px);
    padding: 0 6px;
    cursor: pointer;
  }

  .advanced-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    background: var(--ga-card, #111);
    border-radius: var(--ga-r-hard, 3px);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .field input, .field select {
    height: var(--ga-control-h-sm, 22px);
    background: var(--ga-slot, #050607);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    color: var(--ga-ink-0, #eef0f4);
    padding: 0 6px;
    font-size: var(--ga-text-meta);
    border-radius: var(--ga-r-hard, 3px);
  }

  /* The panel's primary action (.primary-btn takes the theme's look). */
  .generate-btn,
  .add-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: var(--ga-control-h, 26px);
    padding: 0 12px;
    background: var(--ga-violet, #9b87f5);
    border: none;
    color: var(--ga-blue-800, #0b0d11);
    font-size: var(--ga-text-control);
    font-weight: var(--ga-weight-control);
    border-radius: var(--ga-r-soft, 7px);
    cursor: pointer;
    transition: filter 0.15s;
  }
  .generate-btn:hover:not(:disabled),
  .add-btn:hover { filter: brightness(1.06); }
  .generate-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .spinner {
    width: 12px;
    height: 12px;
    border: 2px solid color-mix(in srgb, currentColor 30%, transparent);
    border-top-color: currentColor;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .status {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 8px;
    background: var(--ga-card, #14141e);
    border-radius: var(--ga-r-hard, 3px);
    font-size: var(--ga-text-meta);
    color: var(--ga-ink-1, #9aa0ac);
  }
  .status.done { color: var(--ga-live, #46d18a); }
  .elapsed {
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    font-variant-numeric: tabular-nums;
    color: var(--ga-ink-2, #89857e);
  }

  .preview {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .preview video {
    width: 100%;
    border-radius: var(--ga-r-hard, 3px);
    background: #000;
    max-height: 200px;
  }
</style>
