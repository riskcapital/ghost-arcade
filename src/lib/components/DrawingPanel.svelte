<script lang="ts">
  import { onMount } from 'svelte';
  import { project, selectedGenerativeLayer, selectedElement } from '../stores/layers';
  import type {
    ShapeType,
    Fill,
    Stroke,
    Animation,
    StrokeType,
    FillType,
    AnimationType } from '../drawing/types';
  import { t } from '../i18n';

  // Listen for drawing mode resets from App.svelte
  onMount(() => {
    const handleModeChange = (e: CustomEvent<{ mode: 'none' | 'freehand' | 'pointClickLine' }>) => {
      drawingMode = e.detail.mode;
    };
    window.addEventListener('drawing-mode-change', handleModeChange as EventListener);

    return () => {
      window.removeEventListener('drawing-mode-change', handleModeChange as EventListener);
    };
  });

  // Shape library items - basic shapes
  const shapeLibrary: { type: ShapeType; label: string; icon: string }[] = [
    { type: 'circle', label: 'creative.drawing.shapes.circle', icon: '○' },
    { type: 'rectangle', label: 'creative.drawing.shapes.rectangle', icon: '▢' },
    { type: 'triangle', label: 'creative.drawing.shapes.triangle', icon: '△' },
    { type: 'polygon', label: 'creative.drawing.shapes.polygon', icon: '⬡' },
    { type: 'star', label: 'creative.drawing.shapes.star', icon: '★' },
    { type: 'ring', label: 'creative.drawing.shapes.ring', icon: '◎' },
    { type: 'line', label: 'creative.drawing.shapes.line', icon: '━' },
    { type: 'spiral', label: 'creative.drawing.shapes.spiral', icon: '@' },
  ];

  // Line tools for drawing paths
  const lineTools: { type: ShapeType; label: string; icon: string }[] = [
    { type: 'freehand', label: 'creative.drawing.tools.freehand', icon: '✏' },
    { type: 'pointClickLine', label: 'creative.drawing.tools.polyline', icon: '⌇' },
  ];

  // Drawing mode for interactive line creation
  let drawingMode: 'none' | 'freehand' | 'pointClickLine' = 'none';

  // Dispatch drawing mode to parent
  function setDrawingMode(mode: 'none' | 'freehand' | 'pointClickLine') {
    drawingMode = mode;
    // Dispatch event to parent to enable canvas drawing
    window.dispatchEvent(new CustomEvent('drawing-mode-change', { detail: { mode } }));
  }

  const strokeTypes: { type: StrokeType; label: string }[] = [
    { type: 'none', label: 'creative.drawing.strokeTypes.none' },
    { type: 'solid', label: 'creative.drawing.strokeTypes.solid' },
    { type: 'glow', label: 'creative.drawing.strokeTypes.glow' },
    { type: 'neon', label: 'creative.drawing.strokeTypes.neon' },
    { type: 'snake', label: 'creative.drawing.strokeTypes.snake' },
    { type: 'rainbow', label: 'creative.drawing.strokeTypes.rainbow' },
    { type: 'dashed', label: 'creative.drawing.strokeTypes.dashed' },
    { type: 'electric', label: 'creative.drawing.strokeTypes.electric' },
    { type: 'pulse', label: 'creative.drawing.strokeTypes.pulse' },
    { type: 'scanner', label: 'creative.drawing.strokeTypes.scanner' },
    { type: 'fire', label: 'creative.drawing.strokeTypes.fire' },
  ];

  const fillTypes: { type: FillType; label: string }[] = [
    { type: 'none', label: 'creative.drawing.fillTypes.none' },
    { type: 'solid', label: 'creative.drawing.fillTypes.solid' },
    { type: 'plasma', label: 'creative.drawing.fillTypes.plasma' },
    { type: 'liquid', label: 'creative.drawing.fillTypes.liquid' },
    { type: 'fire', label: 'creative.drawing.fillTypes.fire' },
    { type: 'electric', label: 'creative.drawing.fillTypes.electric' },
    { type: 'holographic', label: 'creative.drawing.fillTypes.holographic' },
    { type: 'noise', label: 'creative.drawing.fillTypes.noise' },
    { type: 'gradient', label: 'creative.drawing.fillTypes.gradient' },
  ];

  const animationTypes: { type: AnimationType; label: string }[] = [
    { type: 'none', label: 'creative.drawing.animationTypes.none' },
    { type: 'concentric', label: 'creative.drawing.animationTypes.concentric' },
    { type: 'breathe', label: 'creative.drawing.animationTypes.breathe' },
    { type: 'rotate', label: 'creative.drawing.animationTypes.rotate' },
    { type: 'radiate', label: 'creative.drawing.animationTypes.radiate' },
    { type: 'ripple', label: 'creative.drawing.animationTypes.ripple' },
    { type: 'wave', label: 'creative.drawing.animationTypes.wave' },
    { type: 'glitch', label: 'creative.drawing.animationTypes.glitch' },
  ];

  // Color picker helpers
  function rgbaToHex(rgba: [number, number, number, number]): string {
    const r = Math.round(rgba[0] * 255).toString(16).padStart(2, '0');
    const g = Math.round(rgba[1] * 255).toString(16).padStart(2, '0');
    const b = Math.round(rgba[2] * 255).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
  }

  function hexToRgba(hex: string, alpha: number = 1): [number, number, number, number] {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    return [r, g, b, alpha];
  }

  // Add shape to selected generative layer
  function addShape(type: ShapeType) {
    if ($selectedGenerativeLayer) {
      project.addElement($selectedGenerativeLayer.id, type);
    }
  }

  // Update stroke
  function updateStrokeType(type: StrokeType) {
    if (!$selectedGenerativeLayer || !$selectedElement) return;

    let stroke: Stroke;
    if (type === 'none') {
      stroke = { type: 'none' };
    } else if (type === 'glow') {
      stroke = {
        type: 'glow',
        color: [0, 1, 0.5, 1],
        width: 3,
        glowSize: 20,
        glowIntensity: 1,
        pulseSpeed: 1,
      };
    } else if (type === 'neon') {
      stroke = {
        type: 'neon',
        color: [1, 0, 0.5, 1],
        width: 2,
        glowSize: 25,
        flickerSpeed: 0.5,
        flickerIntensity: 0.3,
      };
    } else if (type === 'snake') {
      stroke = {
        type: 'snake',
        color: [0, 1, 1, 1],
        width: 4,
        length: 0.5,
        speed: 1,
        tailFade: true,
        headGlow: true,
        bidirectional: false,
        snakeCount: 1,
      };
    } else if (type === 'pulse') {
      stroke = {
        type: 'pulse',
        color: [1, 1, 0, 1],
        width: 3,
        pulseCount: 5,
        speed: 1,
        fadeLength: 0.2,
        direction: 'forward',
      };
    } else if (type === 'rainbow') {
      stroke = {
        type: 'rainbow',
        width: 4,
        saturation: 1,
        brightness: 1,
        speed: 0.5,
        segments: 6,
      };
    } else if (type === 'dashed') {
      stroke = {
        type: 'dashed',
        color: [1, 1, 1, 1],
        width: 3,
        dashLength: 0.3,
        gapLength: 0.2,
        animated: true,
        animationSpeed: 1,
      };
    } else if (type === 'electric') {
      stroke = {
        type: 'electric',
        color: [0.3, 0.5, 1, 1],
        width: 3,
        arcIntensity: 1,
        speed: 1,
        branches: 3,
      };
    } else if (type === 'scanner') {
      stroke = {
        type: 'scanner',
        color: [0, 1, 0.5, 1],
        width: 3,
        beamWidth: 0.1,
        speed: 1,
        trail: 0.3,
      };
    } else if (type === 'fire') {
      stroke = {
        type: 'fire',
        color: [1, 0.4, 0, 1],
        width: 4,
        intensity: 1,
        speed: 1,
      };
    } else {
      stroke = {
        type: 'solid',
        color: [1, 1, 1, 1],
        width: 2,
        cap: 'round',
        join: 'round',
      };
    }

    project.updateElementStroke($selectedGenerativeLayer.id, $selectedElement.id, stroke);
  }

  // Update fill
  function updateFillType(type: FillType) {
    if (!$selectedGenerativeLayer || !$selectedElement) return;

    let fill: Fill;
    if (type === 'none') {
      fill = { type: 'none' };
    } else if (type === 'solid') {
      fill = { type: 'solid', color: [1, 1, 1, 0.5] };
    } else if (type === 'plasma') {
      fill = {
        type: 'plasma',
        scale: 5,
        complexity: 3,
        palette: 'rainbow',
        speed: 1,
      };
    } else if (type === 'liquid') {
      fill = {
        type: 'liquid',
        color: [0, 0.5, 1, 1],
        viscosity: 0.5,
        turbulence: 0.5,
        speed: 1,
        metallic: 0.5,
      };
    } else if (type === 'fire') {
      fill = {
        type: 'fire',
        intensity: 1,
        palette: 'orange',
        speed: 1,
        turbulence: 0.5,
      };
    } else if (type === 'electric') {
      fill = {
        type: 'electric',
        color: [0.3, 0.5, 1, 1],
        intensity: 1,
        arcCount: 5,
        speed: 1,
      };
    } else if (type === 'holographic') {
      fill = {
        type: 'holographic',
        baseColor: [1, 0.5, 1, 1],
        shiftAmount: 0.5,
        scanlines: false,
        flicker: 0.5,
      };
    } else if (type === 'noise') {
      fill = {
        type: 'noise',
        scale: 5,
        octaves: 4,
        color1: [0, 1, 0.5, 1],
        color2: [0, 0.2, 0.4, 1],
        animated: true,
        animationSpeed: 1,
      };
    } else if (type === 'gradient') {
      fill = {
        type: 'gradient',
        angle: 0,
        stops: [
          { position: 0, color: [0.3, 0.5, 1, 1] },
          { position: 1, color: [1, 0.3, 0.5, 1] },
        ],
        animated: true,
        animationSpeed: 0.5,
      };
    } else {
      fill = { type: 'solid', color: [1, 1, 1, 0.5] };
    }

    project.updateElementFill($selectedGenerativeLayer.id, $selectedElement.id, fill);
  }

  // Update animation
  function updateAnimationType(type: AnimationType) {
    if (!$selectedGenerativeLayer || !$selectedElement) return;

    let animation: Animation;
    if (type === 'none') {
      animation = { type: 'none' };
    } else if (type === 'concentric') {
      animation = {
        type: 'concentric',
        count: 5,
        spacing: 0.03,
        speed: 1,
        direction: 'out',
        fadeOut: true,
        scaleVariation: 0,
      };
    } else if (type === 'breathe') {
      animation = {
        type: 'breathe',
        minScale: 0.8,
        maxScale: 1.2,
        speed: 1,
        easing: 'sine',
      };
    } else if (type === 'rotate') {
      animation = {
        type: 'rotate',
        speed: 1,
        direction: 'cw',
        oscillate: false,
        oscillateAngle: 45,
      };
    } else if (type === 'radiate') {
      animation = {
        type: 'radiate',
        rays: 8,
        speed: 1,
        length: 0.3,
        rotation: 0,
        rotationSpeed: 0.5,
      } as any;
    } else if (type === 'ripple') {
      animation = {
        type: 'ripple',
        count: 5,
        speed: 1,
        decay: 1,
        maxRadius: 0.5,
      } as any;
    } else if (type === 'wave') {
      animation = {
        type: 'wave',
        amplitude: 1,
        frequency: 1,
        speed: 1,
        axis: 'both',
      } as any;
    } else if (type === 'glitch') {
      animation = {
        type: 'glitch',
        intensity: 1,
        speed: 1,
        rgbSplit: true,
        blockSize: 1,
      } as any;
    } else {
      animation = { type: 'none' };
    }

    project.updateElementAnimation($selectedGenerativeLayer.id, $selectedElement.id, animation);
  }

  // Expanded sections
  let expandedSection: string | null = 'shapes';
</script>

<div class="drawing-panel">
  <div class="panel-header">
    <h3>{$t('creative.drawing.title')}</h3>
  </div>

  {#if $selectedGenerativeLayer}
    <!-- Shape Library -->
    <div class="section">
      <button
        class="section-header"
        onclick={() => (expandedSection = expandedSection === 'shapes' ? null : 'shapes')}
      >
        <span>{$t('creative.drawing.sections.shapes')}</span>
        <span class="expand-icon">{expandedSection === 'shapes' ? '-' : '+'}</span>
      </button>

      {#if expandedSection === 'shapes'}
        <div class="shape-library">
          {#each shapeLibrary as shape}
            <button
              class="shape-item"
              onclick={() => addShape(shape.type)}
              title={$t(shape.label)}
            >
              <span class="shape-icon">{shape.icon}</span>
              <span class="shape-label">{$t(shape.label)}</span>
            </button>
          {/each}
        </div>

        <!-- Line Drawing Tools -->
        <div class="subsection-header">{$t('creative.drawing.sections.drawLines')}</div>
        <div class="line-tools">
          {#each lineTools as tool}
            <button
              class="tool-btn"
              class:active={drawingMode === tool.type}
              onclick={() => setDrawingMode(drawingMode === tool.type ? 'none' : (tool.type as 'freehand' | 'pointClickLine'))}
              title={$t(tool.label)}
            >
              <span class="tool-icon">{tool.icon}</span>
              <span class="tool-label">{$t(tool.label)}</span>
            </button>
          {/each}
        </div>
        {#if drawingMode !== 'none'}
          <div class="drawing-hint">
            {#if drawingMode === 'freehand'}
              {$t('creative.drawing.tools.hints.freehand')}
            {:else}
              {$t('creative.drawing.tools.hints.polyline')}
            {/if}
          </div>
        {/if}
      {/if}
    </div>

    <!-- Element Properties (only show when an element is selected) -->
    {#if $selectedElement}
      <!-- Outline Effect -->
      <div class="section">
        <button
          class="section-header"
          onclick={() => (expandedSection = expandedSection === 'stroke' ? null : 'stroke')}
        >
          <span>{$t('creative.drawing.sections.outline')}</span>
          <span class="expand-icon">{expandedSection === 'stroke' ? '-' : '+'}</span>
        </button>

        {#if expandedSection === 'stroke'}
          <div class="effect-controls">
            <div class="control-row">
              <span class="control-label">{$t('creative.common.type')}</span>
              <select
                value={$selectedElement.stroke.type}
                onchange={(e) => updateStrokeType((e.target as HTMLSelectElement).value as StrokeType)}
              >
                {#each strokeTypes as st}
                  <option value={st.type}>{$t(st.label)}</option>
                {/each}
              </select>
            </div>

            {#if ($selectedElement.stroke.type as string) !== 'none' && 'color' in $selectedElement.stroke}
              <div class="control-row">
                <span class="control-label">{$t('creative.common.color')}</span>
                <input
                  type="color"
                  value={rgbaToHex($selectedElement.stroke.color)}
                  oninput={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      const newColor = hexToRgba((e.target as HTMLInputElement).value, 1);
                      project.updateElementStroke(
                        $selectedGenerativeLayer.id,
                        $selectedElement.id,
                        { ...$selectedElement.stroke, color: newColor,
                      } as Stroke
                      );
                    }
                  }}
                />
              </div>
            {/if}

            {#if ($selectedElement.stroke.type as string) !== 'none' && 'width' in $selectedElement.stroke}
              <div class="control-row">
                <span class="control-label">{$t('creative.common.width')}</span>
                <input
                  type="range"
                  min="1"
                  max="20"
                  step="0.5"
                  value={$selectedElement.stroke.width}
                  oninput={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      project.updateElementStroke(
                        $selectedGenerativeLayer.id,
                        $selectedElement.id,
                        { ...$selectedElement.stroke, width: parseFloat((e.target as HTMLInputElement).value),
                      } as Stroke
                      );
                    }
                  }}
                />
                <span class="control-value">{$selectedElement.stroke.width}</span>
              </div>
            {/if}

            {#if ($selectedElement.stroke.type === 'glow' || $selectedElement.stroke.type === 'neon') && 'glowSize' in $selectedElement.stroke}
              <div class="control-row">
                <span class="control-label">{$t('creative.common.glowSize')}</span>
                <input
                  type="range"
                  min="5"
                  max="50"
                  step="1"
                  value={$selectedElement.stroke.glowSize}
                  oninput={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      project.updateElementStroke(
                        $selectedGenerativeLayer.id,
                        $selectedElement.id,
                        { ...$selectedElement.stroke, glowSize: parseFloat((e.target as HTMLInputElement).value),
                      } as Stroke
                      );
                    }
                  }}
                />
                <span class="control-value">{$selectedElement.stroke.glowSize}</span>
              </div>
            {/if}

            {#if $selectedElement.stroke.type === 'snake' && 'length' in $selectedElement.stroke}
              <div class="control-row">
                <span class="control-label">{$t('creative.common.length')}</span>
                <input
                  type="range"
                  min="0.05"
                  max="0.95"
                  step="0.05"
                  value={$selectedElement.stroke.length}
                  oninput={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      project.updateElementStroke(
                        $selectedGenerativeLayer.id,
                        $selectedElement.id,
                        { ...$selectedElement.stroke, length: parseFloat((e.target as HTMLInputElement).value),
                      } as Stroke
                      );
                    }
                  }}
                />
                <span class="control-value">{($selectedElement.stroke.length * 100).toFixed(0)}%</span>
              </div>
              <div class="control-row">
                <span class="control-label">{$t('creative.common.speed')}</span>
                <input
                  type="range"
                  min="0.1"
                  max="3"
                  step="0.1"
                  value={$selectedElement.stroke.speed}
                  oninput={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      project.updateElementStroke(
                        $selectedGenerativeLayer.id,
                        $selectedElement.id,
                        { ...$selectedElement.stroke, speed: parseFloat((e.target as HTMLInputElement).value),
                      } as Stroke
                      );
                    }
                  }}
                />
                <span class="control-value">{$selectedElement.stroke.speed.toFixed(1)}x</span>
              </div>
              <div class="control-row">
                <span class="control-label">{$t('creative.drawing.strokeControls.snakes')}</span>
                <input
                  type="range"
                  min="1"
                  max="8"
                  step="1"
                  value={$selectedElement.stroke.snakeCount ?? 1}
                  oninput={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      project.updateElementStroke(
                        $selectedGenerativeLayer.id,
                        $selectedElement.id,
                        { ...$selectedElement.stroke, snakeCount: parseInt((e.target as HTMLInputElement).value),
                      } as Stroke
                      );
                    }
                  }}
                />
                <span class="control-value">{$selectedElement.stroke.snakeCount ?? 1}</span>
              </div>
            {/if}

            {#if $selectedElement.stroke.type === 'electric' && 'arcIntensity' in $selectedElement.stroke}
              <div class="control-row">
                <span class="control-label">{$t('creative.common.arc')}</span>
                <input type="range" min="0.1" max="3" step="0.1"
                  value={$selectedElement.stroke.arcIntensity}
                  oninput={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      project.updateElementStroke($selectedGenerativeLayer.id, $selectedElement.id,
                        { ...$selectedElement.stroke, arcIntensity: parseFloat((e.target as HTMLInputElement).value),
                      } as Stroke);
                    }
                  }} />
                <span class="control-value">{$selectedElement.stroke.arcIntensity?.toFixed(1)}</span>
              </div>
              <div class="control-row">
                <span class="control-label">{$t('creative.common.speed')}</span>
                <input type="range" min="0.1" max="3" step="0.1"
                  value={$selectedElement.stroke.speed ?? 1}
                  oninput={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      project.updateElementStroke($selectedGenerativeLayer.id, $selectedElement.id,
                        { ...$selectedElement.stroke, speed: parseFloat((e.target as HTMLInputElement).value),
                      } as Stroke);
                    }
                  }} />
                <span class="control-value">{($selectedElement.stroke.speed ?? 1).toFixed(1)}x</span>
              </div>
            {/if}

            {#if $selectedElement.stroke.type === 'pulse' && 'pulseCount' in $selectedElement.stroke}
              <div class="control-row">
                <span class="control-label">{$t('creative.common.pulses')}</span>
                <input type="range" min="1" max="20" step="1"
                  value={$selectedElement.stroke.pulseCount}
                  oninput={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      project.updateElementStroke($selectedGenerativeLayer.id, $selectedElement.id,
                        { ...$selectedElement.stroke, pulseCount: parseInt((e.target as HTMLInputElement).value),
                      } as Stroke);
                    }
                  }} />
                <span class="control-value">{$selectedElement.stroke.pulseCount}</span>
              </div>
              <div class="control-row">
                <span class="control-label">{$t('creative.common.speed')}</span>
                <input type="range" min="0.1" max="3" step="0.1"
                  value={$selectedElement.stroke.speed ?? 1}
                  oninput={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      project.updateElementStroke($selectedGenerativeLayer.id, $selectedElement.id,
                        { ...$selectedElement.stroke, speed: parseFloat((e.target as HTMLInputElement).value),
                      } as Stroke);
                    }
                  }} />
                <span class="control-value">{($selectedElement.stroke.speed ?? 1).toFixed(1)}x</span>
              </div>
              <div class="control-row">
                <span class="control-label">{$t('creative.common.fade')}</span>
                <input type="range" min="0.05" max="0.5" step="0.05"
                  value={$selectedElement.stroke.fadeLength ?? 0.2}
                  oninput={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      project.updateElementStroke($selectedGenerativeLayer.id, $selectedElement.id,
                        { ...$selectedElement.stroke, fadeLength: parseFloat((e.target as HTMLInputElement).value),
                      } as Stroke);
                    }
                  }} />
                <span class="control-value">{(($selectedElement.stroke.fadeLength ?? 0.2) * 100).toFixed(0)}%</span>
              </div>
            {/if}

            {#if $selectedElement.stroke.type === 'scanner' && 'beamWidth' in $selectedElement.stroke}
              <div class="control-row">
                <span class="control-label">{$t('creative.common.beam')}</span>
                <input type="range" min="0.02" max="0.3" step="0.01"
                  value={$selectedElement.stroke.beamWidth}
                  oninput={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      project.updateElementStroke($selectedGenerativeLayer.id, $selectedElement.id,
                        { ...$selectedElement.stroke, beamWidth: parseFloat((e.target as HTMLInputElement).value),
                      } as Stroke);
                    }
                  }} />
                <span class="control-value">{($selectedElement.stroke.beamWidth * 100)?.toFixed(0)}%</span>
              </div>
              <div class="control-row">
                <span class="control-label">{$t('creative.common.trail')}</span>
                <input type="range" min="0.05" max="0.8" step="0.05"
                  value={$selectedElement.stroke.trail ?? 0.3}
                  oninput={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      project.updateElementStroke($selectedGenerativeLayer.id, $selectedElement.id,
                        { ...$selectedElement.stroke, trail: parseFloat((e.target as HTMLInputElement).value),
                      } as Stroke);
                    }
                  }} />
                <span class="control-value">{(($selectedElement.stroke.trail ?? 0.3) * 100).toFixed(0)}%</span>
              </div>
              <div class="control-row">
                <span class="control-label">{$t('creative.common.speed')}</span>
                <input type="range" min="0.1" max="3" step="0.1"
                  value={$selectedElement.stroke.speed ?? 1}
                  oninput={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      project.updateElementStroke($selectedGenerativeLayer.id, $selectedElement.id,
                        { ...$selectedElement.stroke, speed: parseFloat((e.target as HTMLInputElement).value),
                      } as Stroke);
                    }
                  }} />
                <span class="control-value">{($selectedElement.stroke.speed ?? 1).toFixed(1)}x</span>
              </div>
            {/if}

            {#if $selectedElement.stroke.type === 'dashed' && 'dashLength' in $selectedElement.stroke}
              <div class="control-row">
                <span class="control-label">{$t('creative.common.dash')}</span>
                <input type="range" min="0.05" max="0.8" step="0.05"
                  value={$selectedElement.stroke.dashLength}
                  oninput={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      project.updateElementStroke($selectedGenerativeLayer.id, $selectedElement.id,
                        { ...$selectedElement.stroke, dashLength: parseFloat((e.target as HTMLInputElement).value),
                      } as Stroke);
                    }
                  }} />
                <span class="control-value">{$selectedElement.stroke.dashLength?.toFixed(2)}</span>
              </div>
              <div class="control-row">
                <span class="control-label">{$t('creative.common.gap')}</span>
                <input type="range" min="0.05" max="0.8" step="0.05"
                  value={$selectedElement.stroke.gapLength}
                  oninput={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      project.updateElementStroke($selectedGenerativeLayer.id, $selectedElement.id,
                        { ...$selectedElement.stroke, gapLength: parseFloat((e.target as HTMLInputElement).value),
                      } as Stroke);
                    }
                  }} />
                <span class="control-value">{$selectedElement.stroke.gapLength?.toFixed(2)}</span>
              </div>
            {/if}

            {#if $selectedElement.stroke.type === 'fire' && 'speed' in $selectedElement.stroke}
              <div class="control-row">
                <span class="control-label">{$t('creative.common.speed')}</span>
                <input type="range" min="0.1" max="3" step="0.1"
                  value={$selectedElement.stroke.speed ?? 1}
                  oninput={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      project.updateElementStroke($selectedGenerativeLayer.id, $selectedElement.id,
                        { ...$selectedElement.stroke, speed: parseFloat((e.target as HTMLInputElement).value),
                      } as Stroke);
                    }
                  }} />
                <span class="control-value">{($selectedElement.stroke.speed ?? 1).toFixed(1)}x</span>
              </div>
            {/if}
          </div>
        {/if}
      </div>

      <!-- Fill Effect -->
      <div class="section">
        <button
          class="section-header"
          onclick={() => (expandedSection = expandedSection === 'fill' ? null : 'fill')}
        >
          <span>{$t('creative.drawing.sections.fill')}</span>
          <span class="expand-icon">{expandedSection === 'fill' ? '-' : '+'}</span>
        </button>

        {#if expandedSection === 'fill'}
          <div class="effect-controls">
            <div class="control-row">
              <span class="control-label">{$t('creative.common.type')}</span>
              <select
                value={$selectedElement.fill.type}
                onchange={(e) => updateFillType((e.target as HTMLSelectElement).value as FillType)}
              >
                {#each fillTypes as ft}
                  <option value={ft.type}>{$t(ft.label)}</option>
                {/each}
              </select>
            </div>

            {#if $selectedElement.fill.type === 'solid' && 'color' in $selectedElement.fill}
              <div class="control-row">
                <span class="control-label">{$t('creative.common.color')}</span>
                <input
                  type="color"
                  value={rgbaToHex($selectedElement.fill.color)}
                  oninput={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      const currentAlpha = ($selectedElement.fill as any).color?.[3] ?? 1;
                      const newColor = hexToRgba((e.target as HTMLInputElement).value, currentAlpha);
                      project.updateElementFill(
                        $selectedGenerativeLayer.id,
                        $selectedElement.id,
                        { type: 'solid', color: newColor,
                      }
                      );
                    }
                  }}
                />
              </div>
              <div class="control-row">
                <span class="control-label">{$t('creative.common.opacity')}</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={$selectedElement.fill.color[3]}
                  oninput={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement && $selectedElement.fill.type === 'solid') {
                      const c = $selectedElement.fill.color;
                      project.updateElementFill(
                        $selectedGenerativeLayer.id,
                        $selectedElement.id,
                        { type: 'solid', color: [c[0], c[1], c[2], parseFloat((e.target as HTMLInputElement).value)],
                      }
                      );
                    }
                  }}
                />
                <span class="control-value">{($selectedElement.fill.color[3] * 100).toFixed(0)}%</span>
              </div>
            {/if}

            {#if ($selectedElement.fill.type === 'plasma' || $selectedElement.fill.type === 'liquid' || $selectedElement.fill.type === 'fire' || $selectedElement.fill.type === 'electric') && 'speed' in $selectedElement.fill}
              <div class="control-row">
                <span class="control-label">{$t('creative.common.speed')}</span>
                <input type="range" min="0.1" max="3" step="0.1"
                  value={$selectedElement.fill.speed ?? 1}
                  oninput={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      project.updateElementFill($selectedGenerativeLayer.id, $selectedElement.id,
                        { ...$selectedElement.fill, speed: parseFloat((e.target as HTMLInputElement).value),
                      } as any);
                    }
                  }} />
                <span class="control-value">{($selectedElement.fill.speed ?? 1).toFixed(1)}x</span>
              </div>
            {/if}

            <!-- PLASMA controls -->
            {#if $selectedElement.fill.type === 'plasma'}
              <div class="control-row">
                <span class="control-label">{$t('creative.common.scale')}</span>
                <input type="range" min="2" max="20" step="0.5"
                  value={$selectedElement.fill.scale ?? 8}
                  oninput={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      project.updateElementFill($selectedGenerativeLayer.id, $selectedElement.id,
                        { ...$selectedElement.fill, scale: parseFloat((e.target as HTMLInputElement).value),
                      } as any);
                    }
                  }} />
                <span class="control-value">{($selectedElement.fill.scale ?? 8).toFixed(1)}</span>
              </div>
              <div class="control-row">
                <span class="control-label">{$t('creative.common.complexity')}</span>
                <input type="range" min="1" max="6" step="0.5"
                  value={$selectedElement.fill.complexity ?? 3}
                  oninput={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      project.updateElementFill($selectedGenerativeLayer.id, $selectedElement.id,
                        { ...$selectedElement.fill, complexity: parseFloat((e.target as HTMLInputElement).value),
                      } as any);
                    }
                  }} />
                <span class="control-value">{($selectedElement.fill.complexity ?? 3).toFixed(1)}</span>
              </div>
              <div class="control-row">
                <span class="control-label">{$t('creative.common.palette')}</span>
                <select
                  value={$selectedElement.fill.palette ?? 'rainbow'}
                  onchange={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      project.updateElementFill($selectedGenerativeLayer.id, $selectedElement.id,
                        { ...$selectedElement.fill, palette: (e.target as HTMLSelectElement).value,
                      } as any);
                    }
                  }}>
                  <option value="rainbow">{$t('creative.drawing.palette.rainbow')}</option>
                  <option value="fire">{$t('creative.drawing.palette.fire')}</option>
                  <option value="ocean">{$t('creative.drawing.palette.ocean')}</option>
                  <option value="neon">{$t('creative.drawing.palette.neon')}</option>
                </select>
              </div>
            {/if}

            <!-- LIQUID controls -->
            {#if $selectedElement.fill.type === 'liquid'}
              <div class="control-row">
                <span class="control-label">{$t('creative.common.color')}</span>
                <input type="color"
                  value={rgbaToHex($selectedElement.fill.color ?? [0, 0.5, 1, 1])}
                  oninput={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      project.updateElementFill($selectedGenerativeLayer.id, $selectedElement.id,
                        { ...$selectedElement.fill, color: hexToRgba((e.target as HTMLInputElement).value, 1),
                      } as any);
                    }
                  }} />
              </div>
              <div class="control-row">
                <span class="control-label">{$t('creative.common.viscosity')}</span>
                <input type="range" min="0" max="1" step="0.05"
                  value={$selectedElement.fill.viscosity ?? 0.5}
                  oninput={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      project.updateElementFill($selectedGenerativeLayer.id, $selectedElement.id,
                        { ...$selectedElement.fill, viscosity: parseFloat((e.target as HTMLInputElement).value),
                      } as any);
                    }
                  }} />
                <span class="control-value">{(($selectedElement.fill.viscosity ?? 0.5) * 100).toFixed(0)}%</span>
              </div>
              <div class="control-row">
                <span class="control-label">{$t('creative.common.turbulence')}</span>
                <input type="range" min="0" max="1" step="0.05"
                  value={$selectedElement.fill.turbulence ?? 0.5}
                  oninput={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      project.updateElementFill($selectedGenerativeLayer.id, $selectedElement.id,
                        { ...$selectedElement.fill, turbulence: parseFloat((e.target as HTMLInputElement).value),
                      } as any);
                    }
                  }} />
                <span class="control-value">{(($selectedElement.fill.turbulence ?? 0.5) * 100).toFixed(0)}%</span>
              </div>
              <div class="control-row">
                <span class="control-label">{$t('creative.common.metallic')}</span>
                <input type="range" min="0" max="1" step="0.05"
                  value={$selectedElement.fill.metallic ?? 0.5}
                  oninput={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      project.updateElementFill($selectedGenerativeLayer.id, $selectedElement.id,
                        { ...$selectedElement.fill, metallic: parseFloat((e.target as HTMLInputElement).value),
                      } as any);
                    }
                  }} />
                <span class="control-value">{(($selectedElement.fill.metallic ?? 0.5) * 100).toFixed(0)}%</span>
              </div>
            {/if}

            <!-- FIRE controls -->
            {#if $selectedElement.fill.type === 'fire'}
              <div class="control-row">
                <span class="control-label">{$t('creative.common.intensity')}</span>
                <input type="range" min="0.2" max="2" step="0.1"
                  value={$selectedElement.fill.intensity ?? 1}
                  oninput={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      project.updateElementFill($selectedGenerativeLayer.id, $selectedElement.id,
                        { ...$selectedElement.fill, intensity: parseFloat((e.target as HTMLInputElement).value),
                      } as any);
                    }
                  }} />
                <span class="control-value">{($selectedElement.fill.intensity ?? 1).toFixed(1)}</span>
              </div>
              <div class="control-row">
                <span class="control-label">{$t('creative.common.turbulence')}</span>
                <input type="range" min="0" max="1" step="0.05"
                  value={$selectedElement.fill.turbulence ?? 0.5}
                  oninput={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      project.updateElementFill($selectedGenerativeLayer.id, $selectedElement.id,
                        { ...$selectedElement.fill, turbulence: parseFloat((e.target as HTMLInputElement).value),
                      } as any);
                    }
                  }} />
                <span class="control-value">{(($selectedElement.fill.turbulence ?? 0.5) * 100).toFixed(0)}%</span>
              </div>
              <div class="control-row">
                <span class="control-label">{$t('creative.common.palette')}</span>
                <select
                  value={$selectedElement.fill.palette ?? 'orange'}
                  onchange={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      project.updateElementFill($selectedGenerativeLayer.id, $selectedElement.id,
                        { ...$selectedElement.fill, palette: (e.target as HTMLSelectElement).value,
                      } as any);
                    }
                  }}>
                  <option value="orange">{$t('creative.drawing.palette.orange')}</option>
                  <option value="blue">{$t('creative.drawing.palette.blue')}</option>
                  <option value="green">{$t('creative.drawing.palette.green')}</option>
                  <option value="purple">{$t('creative.drawing.palette.purple')}</option>
                </select>
              </div>
            {/if}

            <!-- ELECTRIC controls -->
            {#if $selectedElement.fill.type === 'electric'}
              <div class="control-row">
                <span class="control-label">{$t('creative.common.color')}</span>
                <input type="color"
                  value={rgbaToHex($selectedElement.fill.color ?? [0.3, 0.5, 1, 1])}
                  oninput={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      project.updateElementFill($selectedGenerativeLayer.id, $selectedElement.id,
                        { ...$selectedElement.fill, color: hexToRgba((e.target as HTMLInputElement).value, 1),
                      } as any);
                    }
                  }} />
              </div>
              <div class="control-row">
                <span class="control-label">{$t('creative.common.intensity')}</span>
                <input type="range" min="0.2" max="2" step="0.1"
                  value={$selectedElement.fill.intensity ?? 1}
                  oninput={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      project.updateElementFill($selectedGenerativeLayer.id, $selectedElement.id,
                        { ...$selectedElement.fill, intensity: parseFloat((e.target as HTMLInputElement).value),
                      } as any);
                    }
                  }} />
                <span class="control-value">{($selectedElement.fill.intensity ?? 1).toFixed(1)}</span>
              </div>
              <div class="control-row">
                <span class="control-label">{$t('creative.common.arcCount')}</span>
                <input type="range" min="1" max="10" step="1"
                  value={$selectedElement.fill.arcCount ?? 5}
                  oninput={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      project.updateElementFill($selectedGenerativeLayer.id, $selectedElement.id,
                        { ...$selectedElement.fill, arcCount: parseInt((e.target as HTMLInputElement).value),
                      } as any);
                    }
                  }} />
                <span class="control-value">{$selectedElement.fill.arcCount ?? 5}</span>
              </div>
            {/if}

            <!-- HOLOGRAPHIC controls -->
            {#if $selectedElement.fill.type === 'holographic'}
              <div class="control-row">
                <span class="control-label">{$t('creative.drawing.fillControls.hueShift')}</span>
                <input type="range" min="0" max="1" step="0.05"
                  value={$selectedElement.fill.shiftAmount ?? 0.5}
                  oninput={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      project.updateElementFill($selectedGenerativeLayer.id, $selectedElement.id,
                        { ...$selectedElement.fill, shiftAmount: parseFloat((e.target as HTMLInputElement).value),
                      } as any);
                    }
                  }} />
                <span class="control-value">{(($selectedElement.fill.shiftAmount ?? 0.5) * 100).toFixed(0)}%</span>
              </div>
              <div class="control-row">
                <span class="control-label">{$t('creative.common.scanlines')}</span>
                <input
                  type="checkbox"
                  checked={$selectedElement.fill.scanlines ?? false}
                  onchange={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      project.updateElementFill($selectedGenerativeLayer.id, $selectedElement.id,
                        { ...$selectedElement.fill, scanlines: (e.target as HTMLInputElement).checked,
                      } as any);
                    }
                  }}
                />
              </div>
              <div class="control-row">
                <span class="control-label">{$t('creative.drawing.fillControls.flicker')}</span>
                <input type="range" min="0" max="1" step="0.05"
                  value={$selectedElement.fill.flicker ?? 0.5}
                  oninput={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      project.updateElementFill($selectedGenerativeLayer.id, $selectedElement.id,
                        { ...$selectedElement.fill, flicker: parseFloat((e.target as HTMLInputElement).value),
                      } as any);
                    }
                  }} />
                <span class="control-value">{(($selectedElement.fill.flicker ?? 0.5) * 100).toFixed(0)}%</span>
              </div>
            {/if}

            <!-- NOISE controls -->
            {#if $selectedElement.fill.type === 'noise'}
              <div class="control-row">
                <span class="control-label">{$t('creative.common.color1')}</span>
                <input type="color"
                  value={rgbaToHex($selectedElement.fill.color1 ?? [0, 1, 0.5, 1])}
                  oninput={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      project.updateElementFill($selectedGenerativeLayer.id, $selectedElement.id,
                        { ...$selectedElement.fill, color1: hexToRgba((e.target as HTMLInputElement).value, 1),
                      } as any);
                    }
                  }} />
              </div>
              <div class="control-row">
                <span class="control-label">{$t('creative.common.color2')}</span>
                <input type="color"
                  value={rgbaToHex($selectedElement.fill.color2 ?? [0, 0.2, 0.4, 1])}
                  oninput={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      project.updateElementFill($selectedGenerativeLayer.id, $selectedElement.id,
                        { ...$selectedElement.fill, color2: hexToRgba((e.target as HTMLInputElement).value, 1),
                      } as any);
                    }
                  }} />
              </div>
              <div class="control-row">
                <span class="control-label">{$t('creative.common.scale')}</span>
                <input type="range" min="1" max="20" step="0.5"
                  value={$selectedElement.fill.scale ?? 5}
                  oninput={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      project.updateElementFill($selectedGenerativeLayer.id, $selectedElement.id,
                        { ...$selectedElement.fill, scale: parseFloat((e.target as HTMLInputElement).value),
                      } as any);
                    }
                  }} />
                <span class="control-value">{($selectedElement.fill.scale ?? 5).toFixed(1)}</span>
              </div>
              <div class="control-row">
                <span class="control-label">{$t('creative.drawing.fillControls.octaves')}</span>
                <input type="range" min="1" max="8" step="1"
                  value={$selectedElement.fill.octaves ?? 4}
                  oninput={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      project.updateElementFill($selectedGenerativeLayer.id, $selectedElement.id,
                        { ...$selectedElement.fill, octaves: parseInt((e.target as HTMLInputElement).value),
                      } as any);
                    }
                  }} />
                <span class="control-value">{$selectedElement.fill.octaves ?? 4}</span>
              </div>
            {/if}

            <!-- GRADIENT controls -->
            {#if $selectedElement.fill.type === 'gradient'}
              <div class="control-row">
                <span class="control-label">{$t('creative.common.color1')}</span>
                <input type="color"
                  value={rgbaToHex($selectedElement.fill.stops[0]?.color ?? [0.3, 0.5, 1, 1])}
                  oninput={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement && $selectedElement.fill.type === 'gradient') {
                      const newStops = [...$selectedElement.fill.stops];
                      if (newStops[0]) {
                        newStops[0] = { ...newStops[0], color: hexToRgba((e.target as HTMLInputElement).value, 1) };
                      } else {
                        newStops[0] = { position: 0, color: hexToRgba((e.target as HTMLInputElement).value, 1) };
                      }
                      project.updateElementFill($selectedGenerativeLayer.id, $selectedElement.id,
                        { ...$selectedElement.fill, stops: newStops,
                      } as any);
                    }
                  }} />
              </div>
              <div class="control-row">
                <span class="control-label">{$t('creative.common.color2')}</span>
                <input type="color"
                  value={rgbaToHex($selectedElement.fill.stops[1]?.color ?? [1, 0.3, 0.5, 1])}
                  oninput={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement && $selectedElement.fill.type === 'gradient') {
                      const newStops = [...$selectedElement.fill.stops];
                      if (newStops[1]) {
                        newStops[1] = { ...newStops[1], color: hexToRgba((e.target as HTMLInputElement).value, 1) };
                      } else {
                        newStops[1] = { position: 1, color: hexToRgba((e.target as HTMLInputElement).value, 1) };
                      }
                      project.updateElementFill($selectedGenerativeLayer.id, $selectedElement.id,
                        { ...$selectedElement.fill, stops: newStops,
                      } as any);
                    }
                  }} />
              </div>
              <div class="control-row">
                <span class="control-label">{$t('creative.common.angle')}</span>
                <input type="range" min="0" max="6.28" step="0.1"
                  value={$selectedElement.fill.angle ?? 0}
                  oninput={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      project.updateElementFill($selectedGenerativeLayer.id, $selectedElement.id,
                        { ...$selectedElement.fill, angle: parseFloat((e.target as HTMLInputElement).value),
                      } as any);
                    }
                  }} />
                <span class="control-value">{((($selectedElement.fill.angle ?? 0) * 180) / Math.PI).toFixed(0)}deg</span>
              </div>
              <div class="control-row">
                <span class="control-label">{$t('creative.common.animated')}</span>
                <input
                  type="checkbox"
                  checked={$selectedElement.fill.animated ?? false}
                  onchange={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      project.updateElementFill($selectedGenerativeLayer.id, $selectedElement.id,
                        { ...$selectedElement.fill, animated: (e.target as HTMLInputElement).checked,
                      } as any);
                    }
                  }}
                />
              </div>
              {#if $selectedElement.fill.animated}
                <div class="control-row">
                  <span class="control-label">{$t('creative.common.speed')}</span>
                  <input type="range" min="0.1" max="3" step="0.1"
                    value={$selectedElement.fill.animationSpeed ?? 0.5}
                    oninput={(e) => {
                      if ($selectedGenerativeLayer && $selectedElement) {
                        project.updateElementFill($selectedGenerativeLayer.id, $selectedElement.id,
                          { ...$selectedElement.fill, animationSpeed: parseFloat((e.target as HTMLInputElement).value),
                        } as any);
                      }
                    }} />
                  <span class="control-value">{($selectedElement.fill.animationSpeed ?? 0.5).toFixed(1)}x</span>
                </div>
              {/if}
            {/if}
          </div>
        {/if}
      </div>

      <!-- Animation -->
      <div class="section">
        <button
          class="section-header"
          onclick={() => (expandedSection = expandedSection === 'animation' ? null : 'animation')}
        >
          <span>{$t('creative.drawing.sections.animation')}</span>
          <span class="expand-icon">{expandedSection === 'animation' ? '-' : '+'}</span>
        </button>

        {#if expandedSection === 'animation'}
          <div class="effect-controls">
            <div class="control-row">
              <span class="control-label">{$t('creative.common.type')}</span>
              <select
                value={$selectedElement.animation.type}
                onchange={(e) => updateAnimationType((e.target as HTMLSelectElement).value as AnimationType)}
              >
                {#each animationTypes as at}
                  <option value={at.type}>{$t(at.label)}</option>
                {/each}
              </select>
            </div>

            {#if $selectedElement.animation.type === 'concentric'}
              <div class="control-row">
                <span class="control-label">{$t('creative.common.direction')}</span>
                <select
                  value={$selectedElement.animation.direction ?? 'out'}
                  onchange={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      project.updateElementAnimation(
                        $selectedGenerativeLayer.id,
                        $selectedElement.id,
                        { ...$selectedElement.animation, direction: (e.target as HTMLSelectElement).value as 'in' | 'out' | 'both',
                      } as Animation
                      );
                    }
                  }}
                >
                  <option value="out">{$t('creative.drawing.animationDirection.outward')}</option>
                  <option value="in">{$t('creative.drawing.animationDirection.inward')}</option>
                  <option value="both">{$t('creative.drawing.animationDirection.both')}</option>
                </select>
              </div>
              <div class="control-row">
                <span class="control-label">{$t('creative.common.count')}</span>
                <input
                  type="range"
                  min="2"
                  max="20"
                  step="1"
                  value={$selectedElement.animation.count}
                  oninput={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      project.updateElementAnimation(
                        $selectedGenerativeLayer.id,
                        $selectedElement.id,
                        { ...$selectedElement.animation, count: parseInt((e.target as HTMLInputElement).value),
                      } as Animation
                      );
                    }
                  }}
                />
                <span class="control-value">{$selectedElement.animation.count}</span>
              </div>
              <div class="control-row">
                <span class="control-label">{$t('creative.common.spacing')}</span>
                <input
                  type="range"
                  min="0.01"
                  max="0.1"
                  step="0.005"
                  value={$selectedElement.animation.spacing}
                  oninput={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      project.updateElementAnimation(
                        $selectedGenerativeLayer.id,
                        $selectedElement.id,
                        { ...$selectedElement.animation, spacing: parseFloat((e.target as HTMLInputElement).value),
                      } as Animation
                      );
                    }
                  }}
                />
                <span class="control-value">{($selectedElement.animation.spacing * 100).toFixed(1)}</span>
              </div>
              <div class="control-row">
                <span class="control-label">{$t('creative.common.speed')}</span>
                <input
                  type="range"
                  min="0.1"
                  max="3"
                  step="0.1"
                  value={$selectedElement.animation.speed}
                  oninput={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      project.updateElementAnimation(
                        $selectedGenerativeLayer.id,
                        $selectedElement.id,
                        { ...$selectedElement.animation, speed: parseFloat((e.target as HTMLInputElement).value),
                      } as Animation
                      );
                    }
                  }}
                />
                <span class="control-value">{$selectedElement.animation.speed.toFixed(1)}x</span>
              </div>
            {/if}

            {#if $selectedElement.animation.type === 'rotate'}
              <div class="control-row">
                <span class="control-label">{$t('creative.common.speed')}</span>
                <input type="range" min="0.1" max="5" step="0.1"
                  value={$selectedElement.animation.speed}
                  oninput={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      project.updateElementAnimation($selectedGenerativeLayer.id, $selectedElement.id,
                        { ...$selectedElement.animation, speed: parseFloat((e.target as HTMLInputElement).value),
                      } as Animation);
                    }
                  }} />
                <span class="control-value">{$selectedElement.animation.speed.toFixed(1)}x</span>
              </div>
              <div class="control-row">
                <span class="control-label">{$t('creative.drawing.animationDirection.directionShort')}</span>
                <select
                  value={$selectedElement.animation.direction ?? 'cw'}
                  onchange={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      project.updateElementAnimation($selectedGenerativeLayer.id, $selectedElement.id,
                        { ...$selectedElement.animation, direction: (e.target as HTMLSelectElement).value,
                      } as Animation);
                    }
                  }}>
                  <option value="cw">{$t('creative.drawing.animationDirection.clockwise')}</option>
                  <option value="ccw">{$t('creative.drawing.animationDirection.counterClockwise')}</option>
                </select>
              </div>
            {/if}

            {#if $selectedElement.animation.type === 'breathe'}
              <div class="control-row">
                <span class="control-label">{$t('creative.common.speed')}</span>
                <input type="range" min="0.1" max="5" step="0.1"
                  value={$selectedElement.animation.speed ?? 1}
                  oninput={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      project.updateElementAnimation($selectedGenerativeLayer.id, $selectedElement.id,
                        { ...$selectedElement.animation, speed: parseFloat((e.target as HTMLInputElement).value),
                      } as Animation);
                    }
                  }} />
                <span class="control-value">{($selectedElement.animation.speed ?? 1).toFixed(1)}x</span>
              </div>
              <div class="control-row">
                <span class="control-label">{$t('creative.common.min')}</span>
                <input type="range" min="0.1" max="1" step="0.05"
                  value={$selectedElement.animation.minScale ?? 0.8}
                  oninput={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      project.updateElementAnimation($selectedGenerativeLayer.id, $selectedElement.id,
                        { ...$selectedElement.animation, minScale: parseFloat((e.target as HTMLInputElement).value),
                      } as Animation);
                    }
                  }} />
                <span class="control-value">{($selectedElement.animation.minScale ?? 0.8).toFixed(2)}</span>
              </div>
              <div class="control-row">
                <span class="control-label">{$t('creative.common.max')}</span>
                <input type="range" min="1" max="2" step="0.05"
                  value={$selectedElement.animation.maxScale ?? 1.2}
                  oninput={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      project.updateElementAnimation($selectedGenerativeLayer.id, $selectedElement.id,
                        { ...$selectedElement.animation, maxScale: parseFloat((e.target as HTMLInputElement).value),
                      } as Animation);
                    }
                  }} />
                <span class="control-value">{($selectedElement.animation.maxScale ?? 1.2).toFixed(2)}</span>
              </div>
            {/if}

            {#if $selectedElement.animation.type === 'radiate'}
              <div class="control-row">
                <span class="control-label">{$t('creative.drawing.animationControls.rays')}</span>
                <input type="range" min="2" max="24" step="1"
                  value={$selectedElement.animation.rays ?? 8}
                  oninput={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      project.updateElementAnimation($selectedGenerativeLayer.id, $selectedElement.id,
                        { ...$selectedElement.animation, rays: parseInt((e.target as HTMLInputElement).value),
                      } as Animation);
                    }
                  }} />
                <span class="control-value">{$selectedElement.animation.rays ?? 8}</span>
              </div>
              <div class="control-row">
                <span class="control-label">{$t('creative.common.speed')}</span>
                <input type="range" min="0.1" max="3" step="0.1"
                  value={$selectedElement.animation.speed ?? 1}
                  oninput={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      project.updateElementAnimation($selectedGenerativeLayer.id, $selectedElement.id,
                        { ...$selectedElement.animation, speed: parseFloat((e.target as HTMLInputElement).value),
                      } as Animation);
                    }
                  }} />
                <span class="control-value">{($selectedElement.animation.speed ?? 1).toFixed(1)}x</span>
              </div>
            {/if}

            {#if $selectedElement.animation.type === 'ripple'}
              <div class="control-row">
                <span class="control-label">{$t('creative.common.count')}</span>
                <input type="range" min="2" max="10" step="1"
                  value={$selectedElement.animation.count ?? 5}
                  oninput={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      project.updateElementAnimation($selectedGenerativeLayer.id, $selectedElement.id,
                        { ...$selectedElement.animation, count: parseInt((e.target as HTMLInputElement).value),
                      } as Animation);
                    }
                  }} />
                <span class="control-value">{$selectedElement.animation.count ?? 5}</span>
              </div>
              <div class="control-row">
                <span class="control-label">{$t('creative.common.speed')}</span>
                <input type="range" min="0.1" max="3" step="0.1"
                  value={$selectedElement.animation.speed ?? 1}
                  oninput={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      project.updateElementAnimation($selectedGenerativeLayer.id, $selectedElement.id,
                        { ...$selectedElement.animation, speed: parseFloat((e.target as HTMLInputElement).value),
                      } as Animation);
                    }
                  }} />
                <span class="control-value">{($selectedElement.animation.speed ?? 1).toFixed(1)}x</span>
              </div>
              <div class="control-row">
                <span class="control-label">{$t('creative.common.decay')}</span>
                <input type="range" min="0.1" max="3" step="0.1"
                  value={$selectedElement.animation.decay ?? 1}
                  oninput={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      project.updateElementAnimation($selectedGenerativeLayer.id, $selectedElement.id,
                        { ...$selectedElement.animation, decay: parseFloat((e.target as HTMLInputElement).value),
                      } as Animation);
                    }
                  }} />
                <span class="control-value">{($selectedElement.animation.decay ?? 1).toFixed(1)}</span>
              </div>
            {/if}

            {#if $selectedElement.animation.type === 'wave'}
              <div class="control-row">
                <span class="control-label">{$t('creative.drawing.animationControls.amplitude')}</span>
                <input type="range" min="0.1" max="3" step="0.1"
                  value={$selectedElement.animation.amplitude ?? 1}
                  oninput={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      project.updateElementAnimation($selectedGenerativeLayer.id, $selectedElement.id,
                        { ...$selectedElement.animation, amplitude: parseFloat((e.target as HTMLInputElement).value),
                      } as Animation);
                    }
                  }} />
                <span class="control-value">{($selectedElement.animation.amplitude ?? 1).toFixed(1)}</span>
              </div>
              <div class="control-row">
                <span class="control-label">{$t('creative.drawing.animationControls.frequency')}</span>
                <input type="range" min="0.1" max="5" step="0.1"
                  value={$selectedElement.animation.frequency ?? 1}
                  oninput={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      project.updateElementAnimation($selectedGenerativeLayer.id, $selectedElement.id,
                        { ...$selectedElement.animation, frequency: parseFloat((e.target as HTMLInputElement).value),
                      } as Animation);
                    }
                  }} />
                <span class="control-value">{($selectedElement.animation.frequency ?? 1).toFixed(1)}</span>
              </div>
              <div class="control-row">
                <span class="control-label">{$t('creative.common.speed')}</span>
                <input type="range" min="0.1" max="3" step="0.1"
                  value={$selectedElement.animation.speed ?? 1}
                  oninput={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      project.updateElementAnimation($selectedGenerativeLayer.id, $selectedElement.id,
                        { ...$selectedElement.animation, speed: parseFloat((e.target as HTMLInputElement).value),
                      } as Animation);
                    }
                  }} />
                <span class="control-value">{($selectedElement.animation.speed ?? 1).toFixed(1)}x</span>
              </div>
            {/if}

            {#if $selectedElement.animation.type === 'glitch'}
              <div class="control-row">
                <span class="control-label">{$t('creative.common.intensity')}</span>
                <input type="range" min="0.1" max="3" step="0.1"
                  value={$selectedElement.animation.intensity ?? 1}
                  oninput={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      project.updateElementAnimation($selectedGenerativeLayer.id, $selectedElement.id,
                        { ...$selectedElement.animation, intensity: parseFloat((e.target as HTMLInputElement).value),
                      } as Animation);
                    }
                  }} />
                <span class="control-value">{($selectedElement.animation.intensity ?? 1).toFixed(1)}</span>
              </div>
              <div class="control-row">
                <span class="control-label">{$t('creative.drawing.animationControls.block')}</span>
                <input type="range" min="0.2" max="3" step="0.1"
                  value={$selectedElement.animation.blockSize ?? 1}
                  oninput={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      project.updateElementAnimation($selectedGenerativeLayer.id, $selectedElement.id,
                        { ...$selectedElement.animation, blockSize: parseFloat((e.target as HTMLInputElement).value),
                      } as Animation);
                    }
                  }} />
                <span class="control-value">{($selectedElement.animation.blockSize ?? 1).toFixed(1)}</span>
              </div>
              <div class="control-row">
                <span class="control-label">{$t('creative.common.speed')}</span>
                <input type="range" min="0.1" max="3" step="0.1"
                  value={$selectedElement.animation.speed ?? 1}
                  oninput={(e) => {
                    if ($selectedGenerativeLayer && $selectedElement) {
                      project.updateElementAnimation($selectedGenerativeLayer.id, $selectedElement.id,
                        { ...$selectedElement.animation, speed: parseFloat((e.target as HTMLInputElement).value),
                      } as Animation);
                    }
                  }} />
                <span class="control-value">{($selectedElement.animation.speed ?? 1).toFixed(1)}x</span>
              </div>
            {/if}
          </div>
        {/if}
      </div>

      <!-- Corner Warp -->
      <div class="section">
        <button
          class="section-header"
          onclick={() => (expandedSection = expandedSection === 'warp' ? null : 'warp')}
        >
          <span>{$t('creative.drawing.sections.cornerWarp')}</span>
          <span class="expand-icon">{expandedSection === 'warp' ? '-' : '+'}</span>
        </button>

        {#if expandedSection === 'warp'}
          <div class="effect-controls">
            <div class="control-row">
              <span class="control-label">{$t('creative.common.enable')}</span>
              <input
                type="checkbox"
                checked={$selectedElement.warpEnabled ?? false}
                onchange={(e) => {
                  if ($selectedGenerativeLayer && $selectedElement) {
                    project.updateElement($selectedGenerativeLayer.id, $selectedElement.id, {
                      warpEnabled: (e.target as HTMLInputElement).checked,
                    });
                  }
                }}
              />
            </div>

            {#if $selectedElement.warpEnabled}
              <div class="warp-grid">
                <div class="warp-corner">
                  <span class="corner-label">TL</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="1"
                    value={$selectedElement.warpCorners?.topLeft?.x ?? 0}
                    oninput={(e) => {
                      if ($selectedGenerativeLayer && $selectedElement && $selectedElement.warpCorners) {
                        project.updateElement($selectedGenerativeLayer.id, $selectedElement.id, {
                          warpCorners: {
                            ...$selectedElement.warpCorners,
                            topLeft: { ...$selectedElement.warpCorners.topLeft, x: parseFloat((e.target as HTMLInputElement).value),
                            },
                          },
                        });
                      }
                    }}
                  />
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="1"
                    value={$selectedElement.warpCorners?.topLeft?.y ?? 0}
                    oninput={(e) => {
                      if ($selectedGenerativeLayer && $selectedElement && $selectedElement.warpCorners) {
                        project.updateElement($selectedGenerativeLayer.id, $selectedElement.id, {
                          warpCorners: {
                            ...$selectedElement.warpCorners,
                            topLeft: { ...$selectedElement.warpCorners.topLeft, y: parseFloat((e.target as HTMLInputElement).value),
                            },
                          },
                        });
                      }
                    }}
                  />
                </div>
                <div class="warp-corner">
                  <span class="corner-label">TR</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="1"
                    value={$selectedElement.warpCorners?.topRight?.x ?? 1}
                    oninput={(e) => {
                      if ($selectedGenerativeLayer && $selectedElement && $selectedElement.warpCorners) {
                        project.updateElement($selectedGenerativeLayer.id, $selectedElement.id, {
                          warpCorners: {
                            ...$selectedElement.warpCorners,
                            topRight: { ...$selectedElement.warpCorners.topRight, x: parseFloat((e.target as HTMLInputElement).value),
                            },
                          },
                        });
                      }
                    }}
                  />
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="1"
                    value={$selectedElement.warpCorners?.topRight?.y ?? 0}
                    oninput={(e) => {
                      if ($selectedGenerativeLayer && $selectedElement && $selectedElement.warpCorners) {
                        project.updateElement($selectedGenerativeLayer.id, $selectedElement.id, {
                          warpCorners: {
                            ...$selectedElement.warpCorners,
                            topRight: { ...$selectedElement.warpCorners.topRight, y: parseFloat((e.target as HTMLInputElement).value),
                            },
                          },
                        });
                      }
                    }}
                  />
                </div>
                <div class="warp-corner">
                  <span class="corner-label">BL</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="1"
                    value={$selectedElement.warpCorners?.bottomLeft?.x ?? 0}
                    oninput={(e) => {
                      if ($selectedGenerativeLayer && $selectedElement && $selectedElement.warpCorners) {
                        project.updateElement($selectedGenerativeLayer.id, $selectedElement.id, {
                          warpCorners: {
                            ...$selectedElement.warpCorners,
                            bottomLeft: { ...$selectedElement.warpCorners.bottomLeft, x: parseFloat((e.target as HTMLInputElement).value),
                            },
                          },
                        });
                      }
                    }}
                  />
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="1"
                    value={$selectedElement.warpCorners?.bottomLeft?.y ?? 1}
                    oninput={(e) => {
                      if ($selectedGenerativeLayer && $selectedElement && $selectedElement.warpCorners) {
                        project.updateElement($selectedGenerativeLayer.id, $selectedElement.id, {
                          warpCorners: {
                            ...$selectedElement.warpCorners,
                            bottomLeft: { ...$selectedElement.warpCorners.bottomLeft, y: parseFloat((e.target as HTMLInputElement).value),
                            },
                          },
                        });
                      }
                    }}
                  />
                </div>
                <div class="warp-corner">
                  <span class="corner-label">BR</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="1"
                    value={$selectedElement.warpCorners?.bottomRight?.x ?? 1}
                    oninput={(e) => {
                      if ($selectedGenerativeLayer && $selectedElement && $selectedElement.warpCorners) {
                        project.updateElement($selectedGenerativeLayer.id, $selectedElement.id, {
                          warpCorners: {
                            ...$selectedElement.warpCorners,
                            bottomRight: { ...$selectedElement.warpCorners.bottomRight, x: parseFloat((e.target as HTMLInputElement).value),
                            },
                          },
                        });
                      }
                    }}
                  />
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="1"
                    value={$selectedElement.warpCorners?.bottomRight?.y ?? 1}
                    oninput={(e) => {
                      if ($selectedGenerativeLayer && $selectedElement && $selectedElement.warpCorners) {
                        project.updateElement($selectedGenerativeLayer.id, $selectedElement.id, {
                          warpCorners: {
                            ...$selectedElement.warpCorners,
                            bottomRight: { ...$selectedElement.warpCorners.bottomRight, y: parseFloat((e.target as HTMLInputElement).value),
                            },
                          },
                        });
                      }
                    }}
                  />
                </div>
              </div>
              <button
                class="reset-btn"
                onclick={() => {
                  if ($selectedGenerativeLayer && $selectedElement) {
                    project.updateElement($selectedGenerativeLayer.id, $selectedElement.id, {
                      warpCorners: {
                        topLeft: { x: 0, y: 0 },
                        topRight: { x: 1, y: 0 },
                        bottomLeft: { x: 0, y: 1 },
                        bottomRight: { x: 1, y: 1 },
                      },
                    });
                  }
                }}
              >
                {$t('creative.drawing.resetCorners')}
              </button>
            {/if}
          </div>
        {/if}
      </div>

      <!-- Transform -->
      <div class="section">
        <button
          class="section-header"
          onclick={() => (expandedSection = expandedSection === 'transform' ? null : 'transform')}
        >
          <span>{$t('creative.drawing.sections.transform')}</span>
          <span class="expand-icon">{expandedSection === 'transform' ? '-' : '+'}</span>
        </button>

        {#if expandedSection === 'transform'}
          <div class="effect-controls">
            <div class="control-row">
              <span class="control-label">{$t('creative.drawing.transform.positionX')}</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={$selectedElement.shape.position.x}
                oninput={(e) => {
                  if ($selectedGenerativeLayer && $selectedElement) {
                    project.updateElementShape(
                      $selectedGenerativeLayer.id,
                      $selectedElement.id,
                      { position: { ...$selectedElement.shape.position, x: parseFloat((e.target as HTMLInputElement).value),
                      },
                    }
                    );
                  }
                }}
              />
              <span class="control-value">{($selectedElement.shape.position.x * 100).toFixed(0)}%</span>
            </div>
            <div class="control-row">
              <span class="control-label">{$t('creative.drawing.transform.positionY')}</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={$selectedElement.shape.position.y}
                oninput={(e) => {
                  if ($selectedGenerativeLayer && $selectedElement) {
                    project.updateElementShape(
                      $selectedGenerativeLayer.id,
                      $selectedElement.id,
                      { position: { ...$selectedElement.shape.position, y: parseFloat((e.target as HTMLInputElement).value),
                      },
                    }
                    );
                  }
                }}
              />
              <span class="control-value">{($selectedElement.shape.position.y * 100).toFixed(0)}%</span>
            </div>
            <div class="control-row">
              <span class="control-label">{$t('creative.drawing.transform.rotation')}</span>
              <input
                type="range"
                min="0"
                max="360"
                step="1"
                value={$selectedElement.shape.rotation}
                oninput={(e) => {
                  if ($selectedGenerativeLayer && $selectedElement) {
                    project.updateElementShape(
                      $selectedGenerativeLayer.id,
                      $selectedElement.id,
                      { rotation: parseFloat((e.target as HTMLInputElement).value),
                    }
                    );
                  }
                }}
              />
              <span class="control-value">{$selectedElement.shape.rotation}deg</span>
            </div>
            <div class="control-row">
              <span class="control-label">{$t('creative.common.scale')}</span>
              <input
                type="range"
                min="0.1"
                max="3"
                step="0.1"
                value={$selectedElement.shape.scale.x}
                oninput={(e) => {
                  if ($selectedGenerativeLayer && $selectedElement) {
                    const s = parseFloat((e.target as HTMLInputElement).value);
                    project.updateElementShape(
                      $selectedGenerativeLayer.id,
                      $selectedElement.id,
                      { scale: { x: s, y: s },
                    }
                    );
                  }
                }}
              />
              <span class="control-value">{$selectedElement.shape.scale.x.toFixed(1)}x</span>
            </div>

            <!-- Delete button -->
            <button
              class="delete-btn"
              onclick={() => {
                if ($selectedGenerativeLayer && $selectedElement) {
                  project.removeElement($selectedGenerativeLayer.id, $selectedElement.id);
                }
              }}
            >
              {$t('creative.drawing.deleteShape')}
            </button>
          </div>
        {/if}
      </div>
    {:else}
      <div class="no-selection">
        <p>{$t('creative.drawing.empty.selection')}</p>
      </div>
    {/if}
  {:else}
    <div class="no-layer">
      <p>{$t('creative.drawing.empty.layer')}</p>
      <p class="hint">{$t('creative.drawing.empty.addLayerHint')}</p>
    </div>
  {/if}
</div>

<style>
  .drawing-panel {
    width: 100%;
    background: var(--bg-secondary, #111114);
    display: flex;
    flex-direction: column;
    color: var(--text-primary, #eee);
    font-size: 14px;
    overflow-y: auto;
    flex: 1;
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px;
    border-bottom: 1px solid #333;
    flex-shrink: 0;
  }

  .panel-header h3 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
  }

  .section {
    border-bottom: 1px solid #333;
  }

  .section-header {
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 12px;
    background: var(--bg-tertiary, #161618);
    border: none;
    color: var(--text-secondary, #aaa);
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    text-align: left;
  }

  .section-header:hover {
    background: #333;
    color: #fff;
  }

  .expand-icon {
    font-size: 13px;
    font-weight: bold;
  }

  .shape-library {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 6px;
    padding: 10px;
  }

  .shape-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 8px 4px;
    background: #333;
    border: 1px solid #444;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s;
    color: var(--text-primary, #eee);
  }

  .shape-item:hover {
    background: #444;
    border-color: #bb86fc;
    transform: scale(1.05);
  }

  .shape-icon {
    font-size: 21px;
    line-height: 1;
  }

  .shape-label {
    font-size: 10px;
    color: var(--text-muted, #888);
  }

  .effect-controls {
    padding: 10px;
  }

  .control-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }

  .control-label {
    width: 70px;
    font-size: 12px;
    color: var(--text-muted, #888);
    flex-shrink: 0;
  }

  .control-row input[type='range'] {
    flex: 1;
    background: #000000;
  }

  .control-row input[type='color'] {
    width: 40px;
    height: 24px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
  }

  .control-row select {
    flex: 1;
    background: #333;
    color: var(--text-primary, #eee);
    border: 1px solid #555;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 12px;
  }

  .control-value {
    width: 45px;
    text-align: right;
    font-size: 11px;
    color: #666;
    flex-shrink: 0;
  }

  .delete-btn {
    width: 100%;
    margin-top: 10px;
    padding: 8px;
    background: #ff444433;
    border: 1px solid #ff4444;
    border-radius: 4px;
    color: #ff4444;
    font-size: 13px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .delete-btn:hover {
    background: #ff444455;
  }

  .no-selection, .no-layer {
    padding: 20px;
    text-align: center;
    color: #666;
  }

  .no-selection p, .no-layer p {
    margin: 0 0 10px 0;
    font-size: 13px;
  }

  .hint {
    font-size: 12px;
    color: #555;
  }

  /* Line tools */
  .subsection-header {
    padding: 8px 10px;
    font-size: 11px;
    color: #666;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    border-top: 1px solid #333;
    margin-top: 6px;
  }

  .line-tools {
    display: flex;
    gap: 6px;
    padding: 6px 10px;
  }

  .tool-btn {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 8px 4px;
    background: #333;
    border: 1px solid #444;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s;
    color: var(--text-primary, #eee);
  }

  .tool-btn:hover {
    background: #444;
    border-color: var(--text-muted, #888);
  }

  .tool-btn.active {
    background: #bb86fc33;
    border-color: #bb86fc;
    color: #bb86fc;
  }

  .tool-icon {
    font-size: 19px;
  }

  .tool-label {
    font-size: 10px;
    color: var(--text-muted, #888);
  }

  .tool-btn.active .tool-label {
    color: #bb86fc;
  }

  .drawing-hint {
    padding: 6px 10px;
    font-size: 11px;
    color: #bb86fc;
    background: #bb86fc11;
    border-top: 1px solid #bb86fc33;
  }

  /* Warp controls */
  .warp-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-bottom: 10px;
  }

  .warp-corner {
    display: flex;
    align-items: center;
    gap: 4px;
    background: #333;
    padding: 6px;
    border-radius: 4px;
  }

  .corner-label {
    font-size: 11px;
    color: var(--text-muted, #888);
    width: 20px;
  }

  .warp-corner input[type='number'] {
    width: 50px;
    background: #222;
    border: 1px solid #444;
    color: var(--text-primary, #eee);
    padding: 4px;
    border-radius: 3px;
    font-size: 12px;
  }

  .reset-btn {
    width: 100%;
    padding: 6px;
    background: #333;
    border: 1px solid #555;
    border-radius: 4px;
    color: var(--text-secondary, #aaa);
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .reset-btn:hover {
    background: #444;
    border-color: var(--text-muted, #888);
    color: #fff;
  }

  .control-row input[type='checkbox'] {
    width: 18px;
    height: 18px;
    accent-color: #bb86fc;
    cursor: pointer;
  }
</style>
