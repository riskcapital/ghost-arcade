<script lang="ts">
  import { generateWithAI, extractJSParams, type GenerationType } from '../api/ai-client';
  import type { MediaSource, JSAnimationSource, ISFInputDef } from '../types';
  import { generateUUID } from '../types';
  import { createEventDispatcher, onMount } from 'svelte';
  import { shaderLibrary, type SavedShader } from '../stores/shaderLibrary';
  import { settings } from '../stores/settings';
  import { canUseThreeJS, canUseP5JS } from '../stores/license';

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

        // Parse params from window.shaderParams in the code
        const params = extractJSParams(result.code);

        const jsAnimation: JSAnimationSource = {
          animationType,
          htmlCode: result.code,
          params,
          paramValues: params?.reduce((acc, p) => {
            acc[p.name] = p.default;
            return acc;
          }, {} as Record<string, number | boolean | number[]>),
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
      'Perlin noise flow field with 400 neon particles leaving colorful trails',
      'Gravitational attractor system with glowing orbiting particles and motion blur',
      'Sacred geometry pattern with rotating overlapping circles in golden ratio',
      'Particle explosion bursts with radial symmetry and rainbow color cycling',
      'Constellation network of drifting stars connected by glowing lines'
    ]
  };

  function useExample(prompt: string) {
    description = prompt;
  }
</script>

<div class="ai-generator">
  <div class="header">
    <h3>{isEditMode ? 'Edit AI Content' : 'AI Content Generator'}</h3>
    <button class="btn-close" onclick={() => dispatch('close')}>×</button>
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
        class:locked={!$canUseThreeJS}
        onclick={() => { if ($canUseThreeJS) generationType = 'threejs'; }}
        title={$canUseThreeJS ? 'Three.js Animation' : 'Three.js requires Pro license'}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 2L2 7v10l10 5 10-5V7L12 2z"/>
          <circle cx="12" cy="12" r="2"/>
        </svg>
        Three.js
        {#if !$canUseThreeJS}<span class="pro-badge">PRO</span>{/if}
      </button>
      <button
        class="type-tab"
        class:active={generationType === 'p5js'}
        class:locked={!$canUseP5JS}
        onclick={() => { if ($canUseP5JS) generationType = 'p5js'; }}
        title={$canUseP5JS ? 'p5.js Animation' : 'p5.js requires Pro license'}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <path d="M8 12l3 3 5-6"/>
        </svg>
        p5.js
        {#if !$canUseP5JS}<span class="pro-badge">PRO</span>{/if}
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
    <summary>Advanced Options</summary>
    <div class="advanced-content">
      <label>Additional Context (optional)</label>
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
    class="btn-generate"
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
    background: #0d0d10;
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
    font-size: 14px;
    font-weight: 600;
    flex: 1;
    background: linear-gradient(90deg, #BB86FC, #A78BFA);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .btn-close {
    background: none;
    border: none;
    color: #888;
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
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
    background: #111114;
    border-radius: 6px;
    border: 1px solid #222;
    font-size: 11px;
  }

  .ai-provider-badge {
    background: #BB86FC33;
    color: #BB86FC;
    padding: 2px 8px;
    border-radius: 4px;
    font-weight: 500;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .ai-key-ok {
    color: #22c55e;
    font-size: 10px;
  }

  .ai-key-missing {
    color: #ef4444;
    font-size: 10px;
  }

  .btn-configure {
    margin-left: auto;
    background: none;
    border: 1px solid #444;
    color: #888;
    padding: 3px 8px;
    font-size: 10px;
    border-radius: 4px;
    cursor: pointer;
  }

  .btn-configure:hover {
    color: #fff;
    border-color: #BB86FC;
  }

  .generation-type label,
  .description-section label {
    font-size: 11px;
    color: #888;
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
    background: #111114;
    border: 1px solid #333;
    color: #888;
    font-size: 11px;
    cursor: pointer;
    border-radius: 6px;
    transition: all 0.15s;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }

  .type-tab:hover {
    background: #161618;
    border-color: #444;
    color: #fff;
  }

  .type-tab.active {
    background: #333;
    border-color: #BB86FC;
    color: #BB86FC;
  }

  .type-tab svg {
    opacity: 0.7;
  }

  .type-tab.active svg {
    opacity: 1;
  }

  textarea {
    width: 100%;
    background: #111114;
    border: 1px solid #333;
    border-radius: 6px;
    padding: 10px 12px;
    color: #fff;
    font-size: 13px;
    font-family: inherit;
    resize: vertical;
    min-height: 70px;
  }

  textarea:focus {
    outline: none;
    border-color: #BB86FC;
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
    font-size: 11px;
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
    background: #111114;
    border: 1px solid #333;
    border-radius: 12px;
    color: #888;
    font-size: 10px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .example-chip:hover {
    background: #161618;
    border-color: #BB86FC;
    color: #BB86FC;
  }

  .advanced-options {
    font-size: 12px;
    color: #666;
  }

  .advanced-options summary {
    cursor: pointer;
    padding: 6px 0;
  }

  .advanced-options summary:hover {
    color: #888;
  }

  .advanced-content {
    padding-top: 8px;
  }

  .advanced-content label {
    font-size: 11px;
    color: #888;
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
    font-size: 12px;
  }

  .btn-generate {
    padding: 12px 16px;
    background: linear-gradient(135deg, #BB86FC, #A78BFA);
    border: none;
    border-radius: 6px;
    color: #000;
    font-size: 13px;
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
