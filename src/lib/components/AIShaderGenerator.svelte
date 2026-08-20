<script lang="ts">
  import { generateWithAI, extractJSParams, type GenerationType } from '../api/ai-client';
  import type { MediaSource, JSAnimationSource, ISFInputDef } from '../types';
  import { generateUUID } from '../types';
  import { createEventDispatcher, onMount } from 'svelte';
  import { shaderLibrary, type SavedShader } from '../stores/shaderLibrary';
  import { settings } from '../stores/settings';
  import { t } from '../i18n';
  // Tier-related imports removed — Three.js / p5.js generators always available.

  // Props for editing existing content
  export let editingItem: MediaSource | null = null;
  // Optional callback to open the Settings panel
  export let onOpenSettings: (() => void) | null = null;

  const dispatch = createEventDispatcher<{
    generated: { item: MediaSource; isEdit: boolean };
    close: void;
  }>();

  // Read AI configuration from centralized settings store
  $: selectedProvider = $settings.ai.shaderProvider;
  $: currentApiKey = selectedProvider === 'claude' ? $settings.ai.claudeApiKey : $settings.ai.geminiApiKey;
  $: currentModel = selectedProvider === 'claude' ? $settings.ai.claudeModel : $settings.ai.geminiModel;

  let generationType: GenerationType = 'shader-isf';

  // Generation state
  let description = '';
  let additionalContext = '';
  let isGenerating = false;
  let error = '';

  // Initialize from editing item if provided
  onMount(() => {
    if (editingItem) {
      // Get the original prompt
      if (editingItem.aiPrompt) {
        description = editingItem.aiPrompt;
      } else if (editingItem.jsAnimation?.aiPrompt) {
        description = editingItem.jsAnimation.aiPrompt;
      }

      // Set the generation type based on the item type
      if (editingItem.type === 'shader') {
        generationType = 'shader-isf';
      } else if (editingItem.type === 'threejs') {
        generationType = 'threejs';
      } else if (editingItem.type === 'p5js') {
        generationType = 'p5js';
      }
    }
  });

  // Check if we're in edit mode
  $: isEditMode = editingItem !== null;

  // Generate shader/animation
  async function handleGenerate() {
    if (!currentApiKey) {
      error = $t('shaderAi.errors.apiKeyMissing');
      return;
    }

    if (!description.trim()) {
      error = $t('shaderAi.errors.descriptionMissing');
      return;
    }

    isGenerating = true;
    error = '';

    try {
      const result = await generateWithAI({
        provider: selectedProvider,
        apiKey: currentApiKey,
        description: description.trim(),
        generationType,
        additionalContext: additionalContext.trim() || undefined,
        model: currentModel,
      });

      if (!result.success || !result.code) {
        error = result.error || $t('shaderAi.errors.generationFailed');
        return;
      }

      // Create MediaSource based on generation type
      let mediaSource: MediaSource;

      if (generationType === 'shader-isf') {
        // ISF Shader
        const inputs: ISFInputDef[] =
          result.metadata?.inputs?.map((input) => ({
            NAME: input.name,
            TYPE: input.type as ISFInputDef['TYPE'],
            DEFAULT: input.default,
            MIN: input.min,
            MAX: input.max,
          })) || [];

        const defaultValues: Record<string, number | boolean | number[]> = {};
        inputs.forEach((input) => {
          if (input.DEFAULT !== undefined && typeof input.DEFAULT !== 'string') {
            defaultValues[input.NAME] = input.DEFAULT;
          }
        });

        mediaSource = {
          id: generateUUID(),
          type: 'shader',
          src: 'ai-generated',
          name: result.name || $t('shaderAi.names.shader'),
          shaderCode: result.code,
          shaderInputs: inputs,
          shaderValues: defaultValues,
          aiGenerated: true,
          aiPrompt: description.trim(),
        };
      } else {
        // Three.js or p5.js animation
        const animationType = generationType === 'threejs' ? 'threejs' : 'p5js';

        // Parse params from window.shaderParams in the code
        const params = extractJSParams(result.code);

        const jsAnimation: JSAnimationSource = {
          animationType,
          htmlCode: result.code,
          params,
          paramValues: params?.reduce(
            (acc, p) => {
              acc[p.name] = p.default;
              return acc;
            },
            {} as Record<string, number | boolean | number[]>,
          ),
          aiGenerated: true,
          aiPrompt: description,
        };

        mediaSource = {
          id: generateUUID(),
          type: animationType,
          src: 'ai-generated',
          name: result.name || $t(`shaderAi.names.${animationType === 'threejs' ? 'threejs' : 'p5js'}`),
          jsAnimation,
        };
      }

      // Auto-save to shader library (only for new generations, not edits)
      if (!isEditMode) {
        const savedShader: Omit<SavedShader, 'id' | 'createdAt' | 'updatedAt'> = {
          name: mediaSource.name,
          description: description.trim(),
          type: generationType,
          code: generationType === 'shader-isf' ? result.code : mediaSource.jsAnimation?.htmlCode || result.code,
          params: result.metadata?.inputs?.map((input) => ({
            name: input.name,
            type: input.type as 'number' | 'boolean' | 'color',
            default: input.default,
            min: input.min,
            max: input.max,
            label: input.name.replace(/([A-Z])/g, ' $1').trim(),
          })),
          tags: [generationType, 'ai-generated', selectedProvider],
        };
        shaderLibrary.addShader(savedShader);
        console.log(`[Shader Library] Saved "${savedShader.name}" to library`);
      }

      dispatch('generated', { item: mediaSource, isEdit: isEditMode });

      // Only clear if not in edit mode
      if (!isEditMode) {
        description = '';
        additionalContext = '';
      }
    } catch (e) {
      error = e instanceof Error ? e.message : $t('shaderAi.errors.unknown');
    } finally {
      isGenerating = false;
    }
  }

  // Example prompts for inspiration
  $: examplePrompts = {
    'shader-isf': [
      $t('shaderAi.examples.shaderIsf1'),
      $t('shaderAi.examples.shaderIsf2'),
      $t('shaderAi.examples.shaderIsf3'),
      $t('shaderAi.examples.shaderIsf4'),
      $t('shaderAi.examples.shaderIsf5'),
    ],
    threejs: [
      $t('shaderAi.examples.threejs1'),
      $t('shaderAi.examples.threejs2'),
      $t('shaderAi.examples.threejs3'),
      $t('shaderAi.examples.threejs4'),
      $t('shaderAi.examples.threejs5'),
    ],
    p5js: [
      $t('shaderAi.examples.p5js1'),
      $t('shaderAi.examples.p5js2'),
      $t('shaderAi.examples.p5js3'),
      $t('shaderAi.examples.p5js4'),
      $t('shaderAi.examples.p5js5'),
    ],
  } satisfies Record<GenerationType, string[]>;

  function useExample(prompt: string) {
    description = prompt;
  }
</script>

<div class="ai-generator">
  <div class="header">
    <h3>{isEditMode ? $t('shaderAi.generator.editTitle') : $t('shaderAi.generator.createTitle')}</h3>
    <button
      class="btn-close"
      onclick={() => dispatch('close')}
      aria-label={$t('shaderAi.generator.close')}
      title={$t('shaderAi.generator.close')}>×</button
    >
  </div>

  <!-- Compact AI provider status bar -->
  <div class="ai-status-bar">
    <span class="ai-provider-badge">
      {selectedProvider === 'claude' ? 'Claude' : 'Gemini'}
    </span>
    {#if currentApiKey}
      <span class="ai-key-ok">●</span>
    {:else}
      <span class="ai-key-missing">{$t('shaderAi.generator.noApiKey')}</span>
    {/if}
    {#if onOpenSettings}
      <button
        class="btn-configure"
        onclick={onOpenSettings}
        aria-label={$t('shaderAi.generator.configure')}
        title={$t('shaderAi.generator.configure')}>{$t('shaderAi.generator.configure')}</button
      >
    {/if}
  </div>

  <div class="generation-type">
    <label>{$t('shaderAi.generator.generateLabel')}</label>
    <div class="type-tabs">
      <button
        class="type-tab"
        class:active={generationType === 'shader-isf'}
        onclick={() => (generationType = 'shader-isf')}
        aria-label={$t('shaderAi.generator.shader')}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="12,2 22,8.5 22,15.5 12,22 2,15.5 2,8.5" />
        </svg>
        {$t('shaderAi.generator.shader')}
      </button>
      <button
        class="type-tab"
        class:active={generationType === 'threejs'}
        onclick={() => (generationType = 'threejs')}
        title={$t('shaderAi.generator.threejsTitle')}
        aria-label={$t('shaderAi.generator.threejsTitle')}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 2L2 7v10l10 5 10-5V7L12 2z" />
          <circle cx="12" cy="12" r="2" />
        </svg>
        {$t('shaderAi.generator.threejs')}
      </button>
      <button
        class="type-tab"
        class:active={generationType === 'p5js'}
        onclick={() => (generationType = 'p5js')}
        title={$t('shaderAi.generator.p5jsTitle')}
        aria-label={$t('shaderAi.generator.p5jsTitle')}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10" />
          <path d="M8 12l3 3 5-6" />
        </svg>
        {$t('shaderAi.generator.p5js')}
      </button>
    </div>
  </div>

  <div class="description-section">
    <label>{$t('shaderAi.generator.descriptionLabel')}</label>
    <textarea
      bind:value={description}
      placeholder={$t('shaderAi.generator.descriptionPlaceholder')}
      aria-label={$t('shaderAi.generator.descriptionLabel')}
      rows="3"
    ></textarea>
  </div>

  <div class="examples">
    <span class="examples-label">{$t('shaderAi.generator.examplesLabel')}</span>
    <div class="example-chips">
      {#each examplePrompts[generationType].slice(0, 3) as prompt}
        <button class="example-chip" onclick={() => useExample(prompt)}>
          {prompt.length > 30 ? prompt.slice(0, 30) + '...' : prompt}
        </button>
      {/each}
    </div>
  </div>

  <details class="advanced-options">
    <summary>{$t('shaderAi.generator.advancedOptions')}</summary>
    <div class="advanced-content">
      <label>{$t('shaderAi.generator.additionalContextLabel')}</label>
      <textarea
        bind:value={additionalContext}
        placeholder={$t('shaderAi.generator.additionalContextPlaceholder')}
        aria-label={$t('shaderAi.generator.additionalContextLabel')}
        rows="2"
      ></textarea>
    </div>
  </details>

  {#if error}
    <div class="error-message">{error}</div>
  {/if}

  <button
    class="btn-generate"
    onclick={handleGenerate}
    disabled={isGenerating || !description.trim()}
    aria-label={isGenerating
      ? isEditMode
        ? $t('shaderAi.generator.regenerating')
        : $t('shaderAi.generator.generating')
      : isEditMode
        ? $t('shaderAi.generator.regenerate')
        : $t('shaderAi.generator.generateWithAi')}
  >
    {#if isGenerating}
      <span class="spinner"></span>
      {isEditMode ? $t('shaderAi.generator.regenerating') : $t('shaderAi.generator.generating')}
    {:else}
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path
          d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"
        />
      </svg>
      {isEditMode ? $t('shaderAi.generator.regenerate') : $t('shaderAi.generator.generateWithAi')}
    {/if}
  </button>
</div>

<style>
  .ai-generator {
    background: var(--bg-primary, #0d0d10);
    border-radius: 8px;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .header {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .header h3 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    flex: 1;
    background: linear-gradient(90deg, #bb86fc, #a78bfa);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .btn-close {
    background: none;
    border: none;
    color: var(--text-muted, #888);
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 21px;
    line-height: 1;
  }

  .btn-close:hover {
    background: #333;
    color: #fff;
  }

  .ai-status-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    background: var(--bg-secondary, #111114);
    border-radius: 6px;
    border: 1px solid #222;
    font-size: 12px;
  }

  .ai-provider-badge {
    background: #bb86fc33;
    color: #bb86fc;
    padding: 2px 8px;
    border-radius: 4px;
    font-weight: 500;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .ai-key-ok {
    color: #22c55e;
    font-size: 11px;
  }

  .ai-key-missing {
    color: #ef4444;
    font-size: 11px;
  }

  .btn-configure {
    margin-left: auto;
    background: none;
    border: 1px solid #444;
    color: var(--text-muted, #888);
    padding: 3px 8px;
    font-size: 11px;
    border-radius: 4px;
    cursor: pointer;
  }

  .btn-configure:hover {
    color: #fff;
    border-color: #bb86fc;
  }

  .generation-type label,
  .description-section label {
    font-size: 12px;
    color: var(--text-muted, #888);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 6px;
    display: block;
  }

  .type-tabs {
    display: flex;
    gap: 4px;
  }

  .type-tab {
    flex: 1;
    padding: 10px 8px;
    background: var(--bg-secondary, #111114);
    border: 1px solid #333;
    color: var(--text-muted, #888);
    font-size: 12px;
    cursor: pointer;
    border-radius: 6px;
    transition: all 0.15s;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }

  .type-tab:hover {
    background: var(--bg-tertiary, #161618);
    border-color: #444;
    color: #fff;
  }

  .type-tab.active {
    background: #333;
    border-color: #bb86fc;
    color: #bb86fc;
  }

  .type-tab svg {
    opacity: 0.7;
  }

  .type-tab.active svg {
    opacity: 1;
  }

  textarea {
    width: 100%;
    background: var(--bg-secondary, #111114);
    border: 1px solid #333;
    border-radius: 6px;
    padding: 10px 12px;
    color: #fff;
    font-size: 14px;
    font-family: inherit;
    resize: vertical;
    min-height: 70px;
  }

  textarea:focus {
    outline: none;
    border-color: #bb86fc;
  }

  textarea::placeholder {
    color: #555;
  }

  .examples {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    flex-wrap: wrap;
  }

  .examples-label {
    font-size: 12px;
    color: #666;
    padding-top: 4px;
  }

  .example-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    flex: 1;
  }

  .example-chip {
    padding: 4px 8px;
    background: var(--bg-secondary, #111114);
    border: 1px solid #333;
    border-radius: 12px;
    color: var(--text-muted, #888);
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .example-chip:hover {
    background: var(--bg-tertiary, #161618);
    border-color: #bb86fc;
    color: #bb86fc;
  }

  .advanced-options {
    font-size: 13px;
    color: #666;
  }

  .advanced-options summary {
    cursor: pointer;
    padding: 6px 0;
  }

  .advanced-options summary:hover {
    color: var(--text-muted, #888);
  }

  .advanced-content {
    padding-top: 8px;
  }

  .advanced-content label {
    font-size: 12px;
    color: var(--text-muted, #888);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 6px;
    display: block;
  }

  .error-message {
    background: #ef444433;
    border: 1px solid #ef4444;
    border-radius: 4px;
    padding: 8px 12px;
    color: #ef4444;
    font-size: 13px;
  }

  .btn-generate {
    padding: 12px 16px;
    background: linear-gradient(135deg, #bb86fc, #a78bfa);
    border: none;
    border-radius: 6px;
    color: #000;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }

  .btn-generate:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(103, 232, 249, 0.3);
  }

  .btn-generate:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none;
  }

  .spinner {
    width: 14px;
    height: 14px;
    border: 2px solid transparent;
    border-top-color: currentColor;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
