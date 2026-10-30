<script lang="ts">
  import { generateWithAI, type GenerationType } from '../api/ai-client';
  import { jsAnimationFromHtml } from '../renderer/jsAnimationPage';
  import type { MediaSource, JSAnimationSource, ISFInputDef } from '../types';
  import { generateUUID } from '../types';
  import { createEventDispatcher, onMount } from 'svelte';
  import { shaderLibrary, type SavedShader } from '../stores/shaderLibrary';
  import { settings } from '../stores/settings';
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
      error = 'Please configure an API key in Settings → AI';
      return;
    }

    if (!description.trim()) {
      error = 'Please describe what you want to create';
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
        error = result.error || 'Failed to generate content';
        return;
      }

      // Create MediaSource based on generation type
      let mediaSource: MediaSource;

      if (generationType === 'shader-isf') {
        // ISF Shader
        const inputs: ISFInputDef[] = result.metadata?.inputs?.map(input => ({
          NAME: input.name,
          TYPE: input.type as ISFInputDef['TYPE'],
          DEFAULT: input.default,
          MIN: input.min,
          MAX: input.max
        })) || [];

        const defaultValues: Record<string, number | boolean | number[]> = {};
        inputs.forEach(input => {
          if (input.DEFAULT !== undefined && typeof input.DEFAULT !== 'string') {
            defaultValues[input.NAME] = input.DEFAULT;
          }
        });

        mediaSource = {
          id: generateUUID(),
          type: 'shader',
          src: 'ai-generated',
          name: result.name || 'AI Shader',
          shaderCode: result.code,
          shaderInputs: inputs,
          shaderValues: defaultValues,
          aiGenerated: true,
          aiPrompt: description.trim()
        };
      } else {
        // Three.js or p5.js animation
        const animationType = generationType === 'threejs' ? 'threejs' : 'p5js';

        // The controls the page declares (window.shaderParamDefs: labels,
        // ranges, text boxes, menus), else its flat window.shaderParams.
        const parsed = jsAnimationFromHtml(result.code);

        const jsAnimation: JSAnimationSource = {
          animationType,
          htmlCode: result.code,
          params: parsed.params,
          paramValues: parsed.paramValues,
          aiGenerated: true,
          aiPrompt: description
        };

        mediaSource = {
          id: generateUUID(),
          type: animationType,
          src: 'ai-generated',
          name: result.name || `AI ${animationType === 'threejs' ? 'Three.js' : 'p5.js'}`,
          jsAnimation
        };
      }

      // Auto-save to shader library (only for new generations, not edits)
      if (!isEditMode) {
        const savedShader: Omit<SavedShader, 'id' | 'createdAt' | 'updatedAt'> = {
          name: mediaSource.name,
          description: description.trim(),
          type: generationType,
          code: generationType === 'shader-isf' ? result.code : (mediaSource.jsAnimation?.htmlCode || result.code),
          params: result.metadata?.inputs?.map(input => ({
            name: input.name,
            type: input.type as 'number' | 'boolean' | 'color',
            default: input.default,
            min: input.min,
            max: input.max,
            label: input.name.replace(/([A-Z])/g, ' $1').trim()
          })),
          tags: [generationType, 'ai-generated', selectedProvider]
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
      error = e instanceof Error ? e.message : 'Unknown error occurred';
    } finally {
      isGenerating = false;
    }
  }

  // Example prompts for inspiration
  const examplePrompts: Record<GenerationType, string[]> = {
    'shader-isf': [
      'Infinite fractal zoom with neon purple and orange glow, slowly rotating',
      'Liquid metal plasma flowing in organic waves with iridescent rainbow reflections',
      'Sacred geometry mandala with pulsing golden ratio patterns and deep space colors',
      'Electric storm with branching lightning bolts and cyan energy fields',
      'Voronoi cell animation with glowing edges that shift between magenta and teal'
    ],
    'threejs': [
      'Galaxy of 2000 glowing particles in spiral arms, slowly orbiting with rainbow trails',
      'Infinite neon tunnel with rotating geometric rings receding into darkness',
      'Crystal field of 200 floating octahedrons catching colored light beams',
      'Energy vortex tornado with particles spiraling upward in neon colors',
      'Morphing wireframe icosahedron with pulsing vertices and aurora-colored glow'
    ],
    'p5js': [
      'A flock of 600 boids leaving thin ink trails, tightening into a swirl on every kick',
      'A recursive tree that grows branch by branch, sways in a noise wind and regrows every few bars',
      'Flow-field hatching: thousands of short pen strokes that build up slowly like an etching',
      'Truchet tiles in two neon colours that flip in waves on the beat',
      'Kinetic type: the words from a text box break into letters that scatter and re-form'
    ]
  };

  function useExample(prompt: string) {
    description = prompt;
  }
</script>

<div data-help-page="ai-generation" class="ai-generator">
  <div class="header">
    <h3>{isEditMode ? 'Edit AI content' : 'AI content generator'}</h3>
    <button aria-label="Close shader generator" class="btn-close" onclick={() => dispatch('close')}>×</button>
  </div>

  <!-- Compact AI provider status bar -->
  <div class="ai-status-bar">
    <span class="ai-provider-badge">
      {selectedProvider === 'claude' ? 'Claude' : 'Gemini'}
    </span>
    {#if currentApiKey}
      <span class="ai-key-ok">●</span>
    {:else}
      <span class="ai-key-missing">No API key</span>
    {/if}
    {#if onOpenSettings}
      <button class="btn-configure" onclick={onOpenSettings}>Configure</button>
    {/if}
  </div>

  <div class="generation-type">
    <label>Generate</label>
    <div class="type-tabs">
      <button
        class="type-tab"
        class:active={generationType === 'shader-isf'}
        onclick={() => generationType = 'shader-isf'}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="12,2 22,8.5 22,15.5 12,22 2,15.5 2,8.5"/>
        </svg>
        Shader
      </button>
      <button
        class="type-tab"
        class:active={generationType === 'threejs'}
        onclick={() => generationType = 'threejs'}
        title="Three.js Animation"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 2L2 7v10l10 5 10-5V7L12 2z"/>
          <circle cx="12" cy="12" r="2"/>
        </svg>
        Three.js
      </button>
      <button
        class="type-tab"
        class:active={generationType === 'p5js'}
        onclick={() => generationType = 'p5js'}
        title="p5.js Animation"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <path d="M8 12l3 3 5-6"/>
        </svg>
        p5.js
      </button>
    </div>
  </div>

  <div class="description-section">
    <label>Describe what you want</label>
    <textarea
      bind:value={description}
      placeholder="e.g., A hypnotic spiral pattern with rainbow colors that pulses to an imaginary beat..."
      rows="3"
    ></textarea>
  </div>

  <div class="examples">
    <span class="examples-label">Try:</span>
    <div class="example-chips">
      {#each examplePrompts[generationType].slice(0, 3) as prompt}
        <button class="example-chip" onclick={() => useExample(prompt)}>
          {prompt.length > 30 ? prompt.slice(0, 30) + '...' : prompt}
        </button>
      {/each}
    </div>
  </div>

  <details class="advanced-options">
    <summary>Advanced options</summary>
    <div class="advanced-content">
      <label>Additional context (optional)</label>
      <textarea
        bind:value={additionalContext}
        placeholder="Any specific requirements, color schemes, or technical details..."
        rows="2"
      ></textarea>
    </div>
  </details>

  {#if error}
    <div class="error-message">{error}</div>
  {/if}

  <button
    class="btn-generate primary-btn"
    onclick={handleGenerate}
    disabled={isGenerating || !description.trim()}
  >
    {#if isGenerating}
      <span class="spinner"></span>
      {isEditMode ? 'Regenerating...' : 'Generating...'}
    {:else}
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
      </svg>
      {isEditMode ? 'Regenerate' : 'Generate with AI'}
    {/if}
  </button>
</div>

<style>
  .ai-generator {
    background: var(--ga-panel, #0d0d10);
    border-radius: var(--ga-r-soft, 7px);
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .header {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .header h3 {
    margin: 0;
    flex: 1;
    font-size: var(--ga-text-title);
    font-weight: var(--ga-weight-title);
    color: var(--ga-ink-0, #eef0f4);
  }

  .btn-close {
    background: none;
    border: none;
    color: var(--ga-ink-2, #89857e);
    cursor: pointer;
    width: var(--ga-control-h-sm, 22px);
    height: var(--ga-control-h-sm, 22px);
    padding: 0;
    border-radius: var(--ga-r-hard, 3px);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--ga-text-heading);
    line-height: 1;
  }

  .btn-close:hover {
    background: var(--ga-raise, #26221c);
    color: var(--ga-ink-0, #eef0f4);
  }

  .ai-status-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 4px 4px 8px;
    background: var(--ga-card, #111114);
    border-radius: var(--ga-r-hard, 3px);
    border: 1px solid var(--ga-line-1, rgba(255, 255, 255, 0.07));
    font-size: var(--ga-text-meta);
  }

  .ai-provider-badge {
    background: var(--ga-raise, #26221c);
    color: var(--ga-ink-1, #9aa0ac);
    padding: 2px 6px;
    border-radius: var(--ga-r-hard, 3px);
    font-weight: var(--ga-weight-control);
    font-size: var(--ga-text-meta);
  }

  .ai-key-ok {
    color: var(--ga-live, #22c55e);
    font-size: var(--ga-text-meta);
  }

  .ai-key-missing {
    color: var(--ga-rec, #ef4444);
    font-size: var(--ga-text-meta);
  }

  .btn-configure {
    margin-left: auto;
    height: var(--ga-control-h-sm, 22px);
    background: none;
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    color: var(--ga-ink-1, #9aa0ac);
    padding: 0 8px;
    font-size: var(--ga-text-meta);
    font-weight: var(--ga-weight-control);
    border-radius: var(--ga-r-hard, 3px);
    cursor: pointer;
  }

  .btn-configure:hover {
    color: var(--ga-ink-0, #eef0f4);
    border-color: var(--ga-line-3, rgba(255, 255, 255, 0.20));
  }

  /* Field labels: eyebrows. */
  .generation-type label,
  .description-section label,
  .advanced-content label {
    display: block;
    margin-bottom: 6px;
    font-size: var(--ga-text-eyebrow);
    font-weight: 700;
    letter-spacing: var(--ga-eyebrow-tracking, 0.08em);
    text-transform: uppercase;
    color: var(--ga-ink-2, #89857e);
  }

  .type-tabs {
    display: flex;
    gap: 4px;
  }

  .type-tab {
    flex: 1;
    height: var(--ga-control-h, 26px);
    padding: 0 8px;
    background: var(--ga-card, #111114);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    color: var(--ga-ink-1, #9aa0ac);
    font-size: var(--ga-text-control);
    font-weight: var(--ga-weight-control);
    cursor: pointer;
    border-radius: var(--ga-r-hard, 3px);
    transition: border-color 0.15s, color 0.15s, background 0.15s;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }

  .type-tab:hover {
    border-color: var(--ga-line-3, rgba(255, 255, 255, 0.20));
    color: var(--ga-ink-0, #eef0f4);
  }

  .type-tab.active {
    background: var(--ga-selection-bg, #1f3170);
    border-color: var(--ga-selection-line, #5278ff);
    color: var(--ga-selection-ink, #e0e8ff);
  }

  .type-tab svg {
    opacity: 0.7;
  }

  .type-tab.active svg {
    opacity: 1;
  }

  textarea {
    width: 100%;
    box-sizing: border-box;
    background: var(--ga-slot, #050607);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-hard, 3px);
    padding: 8px 10px;
    color: var(--ga-ink-0, #eef0f4);
    font-size: var(--ga-text-body);
    font-family: inherit;
    resize: vertical;
    min-height: 64px;
  }

  textarea:focus {
    outline: none;
    border-color: var(--ga-focus, #8aa4ff);
  }

  textarea::placeholder {
    color: var(--ga-ink-3, #3a404a);
  }

  .examples {
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }

  .examples-label {
    font-size: var(--ga-text-meta);
    color: var(--ga-ink-2, #89857e);
    line-height: var(--ga-control-h-sm, 22px);
  }

  .example-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    flex: 1;
    min-width: 0;
  }

  .example-chip {
    height: var(--ga-control-h-sm, 22px);
    padding: 0 8px;
    background: var(--ga-card, #111114);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-hard, 3px);
    color: var(--ga-ink-1, #9aa0ac);
    font-size: var(--ga-text-meta);
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
  }

  .example-chip:hover {
    border-color: var(--ga-line-3, rgba(255, 255, 255, 0.20));
    color: var(--ga-ink-0, #eef0f4);
  }

  .advanced-options {
    font-size: var(--ga-text-control);
    color: var(--ga-ink-1, #9aa0ac);
  }

  .advanced-options summary {
    cursor: pointer;
    padding: 4px 0;
    font-weight: var(--ga-weight-control);
    letter-spacing: 0;
    text-transform: none;
  }

  .advanced-options summary:hover {
    color: var(--ga-ink-0, #eef0f4);
  }

  .advanced-content {
    padding-top: 8px;
  }

  .error-message {
    background: color-mix(in srgb, var(--ga-rec, #ef4444) 14%, transparent);
    border: 1px solid color-mix(in srgb, var(--ga-rec, #ef4444) 60%, transparent);
    border-radius: var(--ga-r-hard, 3px);
    padding: 8px 10px;
    color: var(--ga-rec, #ef4444);
    font-size: var(--ga-text-control);
  }

  /* The panel's one primary action (.primary-btn takes the theme's look). */
  .btn-generate {
    height: var(--ga-control-h, 26px);
    padding: 0 12px;
    background: var(--ga-violet, #9b87f5);
    border: none;
    border-radius: var(--ga-r-soft, 7px);
    color: var(--ga-blue-800, #0b0d11);
    font-size: var(--ga-text-control);
    font-weight: var(--ga-weight-control);
    cursor: pointer;
    transition: filter 0.15s;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }

  .btn-generate:hover:not(:disabled) {
    filter: brightness(1.06);
  }

  .btn-generate:disabled {
    opacity: 0.5;
    cursor: not-allowed;
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
