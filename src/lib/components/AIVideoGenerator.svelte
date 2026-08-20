<script lang="ts">
  import { createEventDispatcher, onDestroy } from 'svelte';
  import {
    startVeoGeneration, pollVeoOperation, downloadVeoVideo,
    startLumaGeneration, pollLumaGeneration, downloadLumaVideo,
    enhancePromptForLoop,
    type VeoModel, type LumaModel, type LumaAspectRatio, type LumaResolution,
  } from '../api/ai-client';
  import { settings, VEO_MODELS, LUMA_MODELS } from '../stores/settings';
  import { downloadRecording } from '../recording/recorder';
  import { generateUUID } from '../types';
  import { t } from '../i18n';

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

  // Veo settings
  let veoAspectRatio: '16:9' | '9:16' = '16:9';
  let veoDuration: 4 | 6 | 8 = 8;
  let veoFirstFrameFile: File | null = null;
  let veoLastFrameFile: File | null = null;
  let veoFirstFramePreview = '';
  let veoLastFramePreview = '';

  // Luma settings
  let lumaAspectRatio: LumaAspectRatio = '16:9';
  let lumaDuration: '5s' | '9s' = '5s';
  let lumaResolution: LumaResolution = '720p';
  let loopEnabled = false;

  // Generation state
  let isGenerating = false;
  let error = '';
  let statusMessage = '';
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let elapsedSeconds = 0;
  let elapsedTimer: ReturnType<typeof setInterval> | null = null;

  // Preview state
  let previewUrl = '';
  let previewBlob: Blob | null = null;

  // Example prompts
  const examplePromptKeys = [
    'visionAi.video.examples.neonRibbons',
    'visionAi.video.examples.cyberpunkCity',
    'visionAi.video.examples.liquidChrome',
    'visionAi.video.examples.fractalPatterns',
    'visionAi.video.examples.inkDrops',
    'visionAi.video.examples.plasmaTendrils',
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
        ? $t('visionAi.video.errors.lumaApiKeyRequired')
        : $t('visionAi.video.errors.geminiApiKeyRequired');
      return;
    }
    if (!prompt.trim()) {
      error = $t('visionAi.video.errors.promptRequired');
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
      error = err instanceof Error ? err.message : $t('visionAi.video.errors.generationFailed');
      cleanup();
    }
  }

  async function generateVeo() {
    statusMessage = $t('visionAi.video.status.submittingVeo');
    if (veoLastFrameFile && !veoFirstFrameFile) {
      error = $t('visionAi.video.errors.lastFrameNeedsFirst');
      cleanup();
      return;
    }
    if (veoLastFrameFile && !String(currentModel).startsWith('veo-3.1')) {
      error = $t('visionAi.video.errors.frameModelRequired');
      cleanup();
      return;
    }

    const startResult = await startVeoGeneration({
      apiKey,
      prompt: prompt.trim(),
      model: currentModel as VeoModel,
      aspectRatio: veoAspectRatio,
      durationSeconds: veoLastFrameFile ? 8 : veoDuration,
      negativePrompt: negativePrompt.trim() || undefined,
      firstFrame: veoFirstFrameFile || undefined,
      lastFrame: veoLastFrameFile || undefined,
    });

    if (startResult.error || !startResult.operationName) {
      error = startResult.error || $t('visionAi.video.errors.startFailed');
      cleanup();
      return;
    }

    statusMessage = $t('visionAi.video.status.generating');
    const opName = startResult.operationName;

    pollTimer = setInterval(async () => {
      const status = await pollVeoOperation(apiKey, opName);

      if (status.error && status.done) {
        error = status.error;
        cleanup();
        return;
      }

      if (status.done && status.videoUri) {
        statusMessage = $t('visionAi.video.status.downloading');
        const downloadResult = await downloadVeoVideo(apiKey, status.videoUri);
        if (downloadResult.error || !downloadResult.blob) {
          error = downloadResult.error || $t('visionAi.video.errors.downloadFailed');
          cleanup();
          return;
        }
        previewBlob = downloadResult.blob;
        if (previewUrl) URL.revokeObjectURL(previewUrl); // prevent blob leak on re-generation
        previewUrl = URL.createObjectURL(previewBlob);
        statusMessage = $t('visionAi.video.status.ready');
        cleanup();
      }
    }, 10000);
  }

  async function generateLuma() {
    statusMessage = $t('visionAi.video.status.preparingLuma');

    // Enhance prompt for loop if enabled
    const finalPrompt = loopEnabled
      ? enhancePromptForLoop(prompt.trim(), false)
      : prompt.trim();

    statusMessage = $t('visionAi.video.status.submittingLuma');

    const startResult = await startLumaGeneration({
      apiKey,
      prompt: finalPrompt,
      model: currentModel as LumaModel,
      aspectRatio: lumaAspectRatio,
      duration: lumaDuration,
      resolution: lumaResolution,
      loop: loopEnabled,
    });

    if (startResult.error || !startResult.id) {
      error = startResult.error || $t('visionAi.video.errors.lumaStartFailed');
      cleanup();
      return;
    }

    statusMessage = $t('visionAi.video.status.generating');
    const genId = startResult.id;

    pollTimer = setInterval(async () => {
      const status = await pollLumaGeneration(apiKey, genId);

      if (status.state === 'dreaming') {
        statusMessage = $t('visionAi.video.status.dreaming');
      }

      if (status.state === 'failed') {
        error = status.error || $t('visionAi.video.errors.generationFailed');
        cleanup();
        return;
      }

      if (status.state === 'completed' && status.videoUrl) {
        statusMessage = $t('visionAi.video.status.downloading');
        const downloadResult = await downloadLumaVideo(status.videoUrl);
        if (downloadResult.error || !downloadResult.blob) {
          error = downloadResult.error || $t('visionAi.video.errors.downloadFailed');
          cleanup();
          return;
        }
        previewBlob = downloadResult.blob;
        if (previewUrl) URL.revokeObjectURL(previewUrl); // prevent blob leak on re-generation
        previewUrl = URL.createObjectURL(previewBlob);
        statusMessage = $t('visionAi.video.status.ready');
        cleanup();
      }
    }, 5000); // Luma polls faster
  }

  function cleanup() {
    isGenerating = false;
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
  }

  async function addToLibrary() {
    if (!previewBlob || !previewUrl) return;

    const name = prompt.trim().slice(0, 40) || (isLuma ? $t('visionAi.video.defaultLumaName') : $t('visionAi.video.defaultVeoName'));
    const blobRef = previewBlob;
    const urlRef = previewUrl;
    const dispatchId = generateUUID();

    // Dispatch to parent FIRST so MediaTray / VJModePanel adds to library
    // and switches tabs BEFORE any potentially-blocking save flow runs.
    try {
      dispatch('generated', {
        id: dispatchId,
        name: $t('visionAi.video.libraryName', { values: { name } }),
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
    return m > 0 ? $t('visionAi.video.elapsed.minutesSeconds', { values: { minutes: m, seconds: sec } })
      : $t('visionAi.video.elapsed.seconds', { values: { seconds: sec } });
  }

  onDestroy(() => {
    cleanup();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (veoFirstFramePreview) URL.revokeObjectURL(veoFirstFramePreview);
    if (veoLastFramePreview) URL.revokeObjectURL(veoLastFramePreview);
  });
</script>

<div class="veo-generator">
  <div class="header">
    <h4>{$t('visionAi.video.title')}</h4>
    <button class="close-btn" onclick={() => dispatch('close')} aria-label={$t('visionAi.video.close')}>&times;</button>
  </div>

  <!-- Provider tabs -->
  <div class="provider-tabs">
    <button
      class="provider-tab"
      class:active={!isLuma}
      onclick={() => settings.setVideoProvider('veo')}
    >
      Veo
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
      {$t('visionAi.video.apiKeyNotSet', { values: { provider: isLuma ? 'Luma' : 'Gemini'} })}
      <span class="configure-hint">{$t('visionAi.video.configureHint')}</span>
    </div>
  {/if}

  <!-- Prompt -->
  <div class="prompt-section">
    <textarea
      bind:value={prompt}
      placeholder={$t('visionAi.video.promptPlaceholder')} rows={3}
      disabled={isGenerating}
    ></textarea>
  </div>

  <!-- Example prompts -->
  {#if !isGenerating && !previewUrl}
    <div class="examples">
      {#each examplePromptKeys as key}
        {@const ex = $t(key)}
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
      <label>{$t('visionAi.video.model')}</label>
      <select value={currentModel} onchange={(e) => isLuma ? settings.setLumaModel((e.target as HTMLSelectElement).value) : settings.setVeoModel((e.target as HTMLSelectElement).value)} disabled={isGenerating}>
        {#each isLuma ? LUMA_MODELS : VEO_MODELS as model}
          <option value={model.id}>{model.label}</option>
        {/each}
      </select>
    </div>

    <!-- Aspect ratio -->
    <div class="setting">
      <label>{$t('visionAi.video.aspect')}</label>
      {#if isLuma}
        <select bind:value={lumaAspectRatio} disabled={isGenerating}>
          <option value="16:9">16:9</option>
          <option value="9:16">9:16</option>
          <option value="1:1">1:1</option>
          <option value="4:3">4:3</option>
          <option value="3:4">3:4</option>
          <option value="21:9">21:9</option>
          <option value="9:21">9:21</option>
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
      <label>{$t('visionAi.video.duration')}</label>
      {#if isLuma}
        <select bind:value={lumaDuration} disabled={isGenerating}>
          <option value="5s">5s</option>
          <option value="9s">9s</option>
        </select>
      {:else}
        <select bind:value={veoDuration} disabled={isGenerating || !!veoLastFrameFile}>
          <option value={4}>4s</option>
          <option value={6}>6s</option>
          <option value={8}>8s</option>
        </select>
      {/if}
    </div>

    <button class="toggle-advanced" onclick={() => (showAdvanced = !showAdvanced)}>
      {showAdvanced ? $t('visionAi.video.less') : $t('visionAi.video.more')}
    </button>
  </div>

  <!-- Luma-specific: Resolution + Loop -->
  {#if isLuma}
    <div class="luma-options">
      <div class="setting">
        <label>{$t('visionAi.video.resolution')}</label>
        <select bind:value={lumaResolution} disabled={isGenerating}>
          <option value="540p">540p</option>
          <option value="720p">720p</option>
          <option value="1080p">1080p</option>
          <option value="4k">4K</option>
        </select>
      </div>
      <label class="loop-toggle">
        <input type="checkbox" bind:checked={loopEnabled} disabled={isGenerating} />
        <span>{$t('visionAi.video.seamlessLoop')}</span>
      </label>
    </div>

  {:else}
    <div class="veo-keyframes">
      <div class="keyframe-slot">
        <label class="keyframe-pick" for="veo-first-frame">
          <span>{$t('visionAi.video.firstFrame')}</span>
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
            <img src={veoFirstFramePreview} alt={$t('visionAi.video.firstFrameAlt')} />
            <button type="button" onclick={() => clearVeoFrame('first')} disabled={isGenerating}>{$t('visionAi.video.clear')}</button>
          </div>
        {/if}
      </div>

      <div class="keyframe-slot">
        <label class="keyframe-pick" for="veo-last-frame">
          <span>{$t('visionAi.video.lastFrame')}</span>
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
            <img src={veoLastFramePreview} alt={$t('visionAi.video.lastFrameAlt')} />
            <button type="button" onclick={() => clearVeoFrame('last')} disabled={isGenerating}>{$t('visionAi.video.clear')}</button>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  {#if showAdvanced}
    <div class="advanced-section">
      <!-- Negative prompt (Veo only) -->
      {#if !isLuma}
        <div class="field">
          <label>{$t('visionAi.video.negativePrompt')}</label>
          <input
            type="text"
            bind:value={negativePrompt}
            placeholder={$t('visionAi.video.negativePlaceholder')}
            disabled={isGenerating}
          />
        </div>
      {/if}

    </div>
  {/if}

  <!-- Generate button -->
  <button
    class="generate-btn"
    onclick={generate}
    disabled={isGenerating || !prompt.trim()}
  >
    {#if isGenerating}
      <span class="spinner"></span>
      {$t('visionAi.video.generating')}
    {:else}
      {$t('visionAi.video.generate')}
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
        {$t('visionAi.video.addToLibrary')}
      </button>
    </div>
  {/if}
</div>

<style>
  .veo-generator {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px;
    background: #0d0d14;
    border-radius: 6px;
    border: 1px solid #333;
    font-size: 12px;
    color: var(--text-primary, #ccc);
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  h4 {
    margin: 0;
    font-size: 13px;
    color: #fff;
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--text-muted, #888);
    font-size: 17px;
    cursor: pointer;
    padding: 0 4px;
  }
  .close-btn:hover { color: #fff; }

  /* Provider tabs */
  .provider-tabs {
    display: flex;
    gap: 4px;
  }

  .provider-tab {
    flex: 1;
    padding: 6px;
    background: #111;
    border: 1px solid #333;
    color: var(--text-muted, #888);
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    border-radius: 4px;
    transition: all 0.15s;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .provider-tab:hover {
    background: #222;
    color: #fff;
  }

  .provider-tab.active {
    background: linear-gradient(135deg, #ff00aa, #7700ff);
    color: #fff;
    border-color: transparent;
  }

  .api-key-warning {
    padding: 6px 8px;
    background: #3a1020;
    border: 1px solid #662233;
    border-radius: 4px;
    color: #ff6688;
    font-size: 11px;
  }

  .configure-hint {
    opacity: 0.7;
    font-style: italic;
  }

  .prompt-section textarea {
    width: 100%;
    background: #111;
    border: 1px solid #333;
    color: #fff;
    padding: 8px;
    font-size: 12px;
    border-radius: 4px;
    resize: vertical;
    font-family: inherit;
    box-sizing: border-box;
  }
  .prompt-section textarea:focus {
    border-color: #ff00aa;
    outline: none;
  }

  .examples {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .example-chip {
    background: #14141e;
    border: 1px solid #333;
    color: var(--text-secondary, #aaa);
    padding: 3px 8px;
    font-size: 10px;
    border-radius: 10px;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 200px;
  }
  .example-chip:hover {
    background: #333;
    color: #fff;
    border-color: #ff00aa;
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
    gap: 2px;
  }
  .setting label {
    font-size: 10px;
    color: var(--text-muted, #888);
    text-transform: uppercase;
  }
  .setting select {
    background: #111;
    border: 1px solid #333;
    color: var(--text-primary, #ccc);
    padding: 3px 6px;
    font-size: 11px;
    border-radius: 3px;
  }

  .toggle-advanced {
    background: none;
    border: 1px solid #444;
    color: var(--text-muted, #888);
    padding: 3px 8px;
    font-size: 10px;
    border-radius: 3px;
    cursor: pointer;
    margin-left: auto;
  }
  .toggle-advanced:hover { color: #fff; border-color: #666; }

  /* Luma-specific options */
  .luma-options {
    display: flex;
    gap: 10px;
    align-items: flex-end;
  }

  .loop-toggle {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    color: var(--text-secondary, #aaa);
    cursor: pointer;
    padding: 3px 0;
  }

  .loop-toggle input[type='checkbox'] {
    accent-color: #ff00aa;
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
    gap: 3px;
    font-size: 10px;
    color: var(--text-muted, #888);
    text-transform: uppercase;
  }

  .keyframe-pick input {
    width: 100%;
    color: var(--text-secondary, #aaa);
    font-size: 10px;
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
    border-radius: 3px;
    background: #000;
    border: 1px solid #333;
  }

  .keyframe-preview button {
    background: #222;
    border: 1px solid #444;
    color: var(--text-secondary, #aaa);
    font-size: 10px;
    border-radius: 3px;
    padding: 3px 5px;
    cursor: pointer;
  }

  .advanced-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    background: #111;
    border-radius: 4px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .field label {
    font-size: 10px;
    color: var(--text-muted, #888);
    text-transform: uppercase;
  }
  .field input, .field select {
    background: #0d0d14;
    border: 1px solid #333;
    color: var(--text-primary, #ccc);
    padding: 4px 6px;
    font-size: 11px;
    border-radius: 3px;
  }

  .generate-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    background: linear-gradient(135deg, #ff00aa, #7700ff);
    border: none;
    color: #fff;
    padding: 8px 16px;
    font-size: 13px;
    font-weight: 600;
    border-radius: 4px;
    cursor: pointer;
    transition: opacity 0.2s;
  }
  .generate-btn:hover:not(:disabled) { opacity: 0.9; }
  .generate-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .spinner {
    width: 12px;
    height: 12px;
    border: 2px solid rgba(255,255,255,0.3);
    border-top-color: #fff;
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
    background: #14141e;
    border-radius: 4px;
    font-size: 11px;
    color: var(--text-secondary, #aaa);
  }
  .status.done { color: #0f0; }
  .elapsed {
    font-family: var(--ga-font-mono, 'IBM Plex Mono', ui-monospace, monospace);
    color: var(--text-muted, #888);
  }

  .error {
    padding: 6px 8px;
    background: #3a1020;
    border: 1px solid #662233;
    border-radius: 4px;
    color: #ff6688;
    font-size: 11px;
  }

  .preview {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .preview video {
    width: 100%;
    border-radius: 4px;
    background: #000;
    max-height: 200px;
  }

  .add-btn {
    background: #0a6;
    border: none;
    color: #fff;
    padding: 8px;
    font-size: 12px;
    font-weight: 600;
    border-radius: 4px;
    cursor: pointer;
  }
  .add-btn:hover { background: #0b7; }
</style>
