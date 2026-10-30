<script lang="ts">
  import { onMount } from 'svelte';
  import { project, selectedLayer, layers, scheduleHistorySnapshot } from '../stores/layers';
  import { linesStore } from '../stores/lines';
  import { generateUUID } from '../types';
  import type {
    LinesContent,
    LineElement,
    LineStroke,
    LineStrokeType,
    LineDrawAnimation,
    LineToolMode,
    LineLoopMode,
    LinesRevealMode,
  } from '../lines/types';
  import { createDefaultDrawAnimation, LINES_REVEAL_DEFAULTS } from '../lines/types';
  import { restartLinesAnimation } from '../lines/linesClock';

  // Dual-mode props: no props = mapping mode, with props = VJ mode
  export let content: LinesContent | undefined = undefined;
  export let onUpdate: ((updates: Partial<LinesContent>) => void) | undefined = undefined;
  export let compact: boolean = false;

  // Tab state
  let activeTab: 'tools' | 'stroke' | 'animation' | 'settings' = 'tools';
  // Draw Animation edits every line unless "This line" is picked.
  let drawScope: 'all' | 'one' = 'all';

  // Listen for lines mode resets from App.svelte
  onMount(() => {
    const handleModeChange = (e: CustomEvent<{ mode: LineToolMode }>) => {
      linesStore.setToolMode(e.detail.mode);
    };
    window.addEventListener('lines-mode-change', handleModeChange as EventListener);
    return () => {
      window.removeEventListener('lines-mode-change', handleModeChange as EventListener);
    };
  });

  // Stroke type options
  const strokeTypes: { type: LineStrokeType; label: string }[] = [
    { type: 'solid', label: 'Solid' },
    { type: 'dashed', label: 'Dashed' },
    { type: 'dotted', label: 'Dotted' },
    { type: 'glow', label: 'Glow' },
    { type: 'neon', label: 'Neon' },
    { type: 'electric', label: 'Electric' },
    { type: 'fire', label: 'Fire' },
    { type: 'snake', label: 'Snake' },
    { type: 'multiTail', label: 'Multi-tail' },
    { type: 'pulse', label: 'Pulse' },
    { type: 'scanner', label: 'Scanner' },
    { type: 'rainbow', label: 'Rainbow' },
    { type: 'laser', label: 'Laser' },
    { type: 'pipe', label: 'Pipe' },
  ];

  // === Reactive derivations ===
  $: layer = $selectedLayer;
  $: layerId = layer?.id ?? null;
  $: lc = content ?? (layer?.type === 'lines' ? layer.linesContent : null);
  $: elements = lc?.elements ?? [];
  $: selectedElementId = lc?.selectedElementId ?? null;
  $: selectedEl = elements.find((e) => e.id === selectedElementId) ?? null;
  // The line whose draw settings the Animation tab shows: the selected one,
  // or the first when editing all lines with none selected.
  $: animEl = selectedEl ?? (drawScope === 'all' ? elements[0] ?? null : null);
  $: revealMode = (lc?.revealMode ?? 'off') as LinesRevealMode;
  $: toolMode = $linesStore.toolMode;

  // === Color helpers ===
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

  // === Content update helpers ===
  function updateContent(updates: Partial<LinesContent>) {
    if (onUpdate) {
      // VJ mode
      onUpdate(updates);
    } else if (layerId && lc) {
      // Mapping mode
      project.updateLayer(layerId, { linesContent: { ...lc, ...updates } }, { history: false });
      scheduleHistorySnapshot(`lines:${layerId}:${Object.keys(updates).sort().join(',')}`);
    }
  }

  function updateElements(updatedElements: LineElement[]) {
    updateContent({ elements: updatedElements });
  }

  function updateSelectedElement(updates: Partial<LineElement>) {
    if (!selectedEl || !lc) return;
    const updated = elements.map((e) =>
      e.id === selectedEl!.id ? { ...e, ...updates } : e
    );
    updateElements(updated);
  }

  function updateSelectedStroke(stroke: LineStroke) {
    updateSelectedElement({ stroke });
  }

  function updateStrokeProp(key: string, value: unknown) {
    if (!selectedEl) return;
    updateSelectedStroke({ ...selectedEl.stroke, [key]: value } as LineStroke);
  }

  function updateSelectedMotionFx(updates: Partial<import('../lines/types').LineMotionFx>) {
    if (!elements.length) return;
    // Motion FX is a layer-wide look: apply to every line so picking a mode
    // moves the whole drawing together.
    const updated = elements.map((element) => {
      const current = element.motionFx ?? { mode: 'none' as const, amount: 0.5, speed: 1 };
      return { ...element, motionFx: { ...current, ...updates } };
    });
    updateElements(updated);
  }

  function updateSelectedDrawAnimation(updates: Partial<LineDrawAnimation>) {
    if (drawScope === 'all') {
      if (!elements.length) return;
      // Only the changed setting goes to every line; the rest stay their own.
      updateElements(elements.map((e) => ({ ...e, drawAnimation: { ...e.drawAnimation, ...updates } })));
      return;
    }
    if (!selectedEl) return;
    updateSelectedElement({ drawAnimation: { ...selectedEl.drawAnimation, ...updates } });
  }

  /**
   * Every line's draw animation and motion, the layer's stagger and Light Up
   * back to their defaults, and the animations restarted. Undo brings the
   * settings back.
   */
  function resetAllAnimations() {
    if (!lc) return;
    updateContent({
      elements: elements.map((e) => ({
        ...e,
        drawAnimation: createDefaultDrawAnimation(),
        motionFx: { mode: 'none', amount: 0.5, speed: 1 },
      })),
      globalDrawSpeed: 1,
      staggerMode: 'simultaneous',
      staggerDelay: 200,
      waveWindowSize: 3,
      ...LINES_REVEAL_DEFAULTS,
    });
    if (layerId && !onUpdate) restartLinesAnimation(layerId);
    window.dispatchEvent(new CustomEvent('lines-reset-animations'));
  }

  // === Tool mode ===
  function setToolMode(mode: LineToolMode) {
    linesStore.setToolMode(mode);
    window.dispatchEvent(new CustomEvent('lines-mode-change', { detail: { mode } }));
  }

  // === Stroke type switching ===
  function changeStrokeType(type: LineStrokeType) {
    if (!selectedEl) return;
    const currentColor: [number, number, number, number] =
      'color' in selectedEl.stroke ? selectedEl.stroke.color : [0, 1, 0.5, 1];
    const currentWidth = selectedEl.stroke.width;

    let stroke: LineStroke;
    switch (type) {
      case 'solid':
        stroke = { type: 'solid', color: currentColor, width: currentWidth, cap: 'round', join: 'round' };
        break;
      case 'dashed':
        stroke = { type: 'dashed', color: currentColor, width: currentWidth, dashLength: 0.3, gapLength: 0.2, animated: true, animationSpeed: 1 };
        break;
      case 'dotted':
        stroke = { type: 'dotted', color: currentColor, width: currentWidth, dotSize: 0.1, spacing: 0.15, animated: false, animationSpeed: 1 };
        break;
      case 'glow':
        stroke = { type: 'glow', color: currentColor, width: currentWidth, glowSize: 15, glowIntensity: 1, pulseSpeed: 0 };
        break;
      case 'neon':
        stroke = { type: 'neon', color: currentColor, width: currentWidth, glowSize: 20, flickerSpeed: 0.5, flickerIntensity: 0.3 };
        break;
      case 'electric':
        stroke = { type: 'electric', color: currentColor, width: currentWidth, arcIntensity: 1, speed: 1, branches: 3 };
        break;
      case 'fire':
        stroke = { type: 'fire', color: [1, 0.4, 0, 1], width: currentWidth, intensity: 1, speed: 1 };
        break;
      case 'snake':
        stroke = { type: 'snake', color: currentColor, width: currentWidth, length: 0.5, speed: 1, tailFade: true, headGlow: true, bidirectional: false, snakeCount: 1 };
        break;
      case 'multiTail':
        stroke = { type: 'multiTail', color: currentColor, width: currentWidth, tailCount: 3, tailLength: 0.3, spacing: 0.2, speed: 1, tailFade: true, headGlow: true, colorShift: false, colorShiftAmount: 0.1 };
        break;
      case 'pulse':
        stroke = { type: 'pulse', color: currentColor, width: currentWidth, pulseCount: 5, speed: 1, fadeLength: 0.2, direction: 'forward' };
        break;
      case 'scanner':
        stroke = { type: 'scanner', color: currentColor, width: currentWidth, beamWidth: 0.1, speed: 1, trail: 0.3 };
        break;
      case 'rainbow':
        stroke = { type: 'rainbow', width: currentWidth, saturation: 1, brightness: 1, speed: 0.5, segments: 6 };
        break;
      case 'laser':
        stroke = { type: 'laser', color: currentColor, width: currentWidth, intensity: 1.5, scatter: 0.3, flicker: 0.1 };
        break;
      case 'pipe':
        stroke = { type: 'pipe', color: currentColor, width: currentWidth, depth: 0.5, edgeLight: 1, edgeLightColor: [1, 1, 1, 0.5], specular: 0.5, roughness: 0.3 };
        break;
      default:
        stroke = { type: 'solid', color: currentColor, width: currentWidth, cap: 'round', join: 'round' };
    }
    updateSelectedStroke(stroke);
  }

  // === Element CRUD ===
  function selectElement(elementId: string | null) {
    updateContent({ selectedElementId: elementId });
  }

  function removeElement(elementId: string) {
    if (!lc) return;
    const filtered = elements.filter((e) => e.id !== elementId);
    const newSelectedId = selectedElementId === elementId ? null : selectedElementId;
    updateContent({ elements: filtered, selectedElementId: newSelectedId });
  }

  function duplicateElement(elementId: string) {
    if (!lc) return;
    const el = elements.find((e) => e.id === elementId);
    if (!el) return;
    const newEl: LineElement = {
      ...structuredClone(el),
      id: generateUUID(),
      name: `${el.name} Copy`,
      position: { x: el.position.x + 0.05, y: el.position.y + 0.05 },
      zIndex: elements.length,
    };
    updateContent({ elements: [...elements, newEl], selectedElementId: newEl.id });
  }

  function toggleElementVisibility(elementId: string) {
    const updated = elements.map((e) =>
      e.id === elementId ? { ...e, visible: !e.visible } : e
    );
    updateElements(updated);
  }

  function toggleElementLock(elementId: string) {
    const updated = elements.map((e) =>
      e.id === elementId ? { ...e, locked: !e.locked } : e
    );
    updateElements(updated);
  }

  // === Apply to all ===
  function applyAnimationToAll() {
    if (!selectedEl || !lc) return;
    const animSettings = { ...selectedEl.drawAnimation };
    const updated = elements.map((e) => ({
      ...e,
      drawAnimation: { ...animSettings },
    }));
    updateElements(updated);
  }

  function applyStrokeToAll() {
    if (!selectedEl || !lc) return;
    const strokeSettings = structuredClone(selectedEl.stroke);
    const updated = elements.map((e) => ({
      ...e,
      stroke: { ...strokeSettings },
    }));
    updateElements(updated);
  }

  // === Available sources for shared shader mask (from other layers in the project) ===
  $: sharedShaderSources = ($layers || [])
    .filter((l: any) => l.id !== layerId && l.source?.src)
    .map((l: any) => ({
      id: l.source.src === 'ai-generated' || l.source.src === 'js-animation'
        ? l.source.id : l.source.src,
      label: l.source.name || l.name || 'Unnamed',
      type: l.source.type || 'unknown',
      layerName: l.name,
    }));

  // === Element list collapsed state ===
  let elementsCollapsed = false;
</script>

{#if lc}
  <div data-help-page="layers" class="lines-panel" class:compact>
    <!-- Header -->
    <div class="lp-header">
      <span class="lp-title">Lines</span>
      <span class="el-badge">{elements.length}</span>
    </div>

    <!-- Compact elements list — always visible -->
    {#if elements.length > 0}
      <div class="elements-strip">
        <button class="strip-toggle" onclick={() => elementsCollapsed = !elementsCollapsed}>
          {elementsCollapsed ? '▶' : '▼'} Elements ({elements.length})
        </button>
        {#if !elementsCollapsed}
          <div class="elements-strip-list">
            {#each elements as el}
              <div
                class="strip-el"
                class:selected={selectedElementId === el.id}
                onclick={() => selectElement(el.id)}
                title="{el.name} — {el.stroke.type}"
                role="button"
                tabindex="0"
              >
                <span class="strip-name">{el.name}</span>
                <span class="strip-type">{el.stroke.type}</span>
                <button class="strip-del" title="Delete" onclick={(e) => { e.stopPropagation(); removeElement(el.id); }}>✕</button>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    <!-- Tabs -->
    <div class="lp-tabs">
      <button class:active={activeTab === 'tools'} onclick={() => activeTab = 'tools'}>Draw</button>
      <button class:active={activeTab === 'stroke'} onclick={() => activeTab = 'stroke'}>Stroke</button>
      <button class:active={activeTab === 'animation'} onclick={() => activeTab = 'animation'}>Animation</button>
      <button class:active={activeTab === 'settings'} onclick={() => activeTab = 'settings'}>Settings</button>
    </div>

    <!-- Content -->
    <div class="lp-content">
      <!-- ============ TAB 1: DRAW TOOLS ============ -->
      {#if activeTab === 'tools'}
        <div class="sec-label">Tool Mode</div>
        <div class="tool-grid">
          <button class="tool-btn" class:active={toolMode === 'select'} onclick={() => setToolMode('select')}>
            <span class="tool-icon">&#10022;</span>
            <span class="tool-label">Select</span>
          </button>
          <button class="tool-btn" class:active={toolMode === 'freehand'} onclick={() => setToolMode('freehand')}>
            <span class="tool-icon">&#9998;</span>
            <span class="tool-label">Freehand</span>
          </button>
          <button class="tool-btn" class:active={toolMode === 'pointClick'} onclick={() => setToolMode('pointClick')}>
            <span class="tool-icon">&#8889;</span>
            <span class="tool-label">Point-click</span>
          </button>
        </div>

        {#if toolMode === 'freehand'}
          <div class="sec-label">Freehand Settings</div>
          <div class="slider-col">
            <div class="sc">
              <label>Smoothing <b>0.50</b></label>
              <input type="range" min="0" max="1" step="0.05" value="0.5" />
            </div>
          </div>
          <div class="drawing-hint">Click and drag to draw. Hold Shift to constrain.</div>
        {/if}

        {#if toolMode === 'pointClick'}
          <div class="sec-label">Point-Click Settings</div>
          <div class="slider-col">
            <div class="sc">
              <label>Corner style</label>
              <select class="inline-select" value="sharp">
                <option value="sharp">Sharp</option>
                <option value="rounded">Rounded</option>
                <option value="chamfer">Chamfer</option>
              </select>
            </div>
            <div class="sc">
              <label>Corner radius <b>0</b></label>
              <input type="range" min="0" max="50" step="1" value="0" />
            </div>
          </div>
          <div class="drawing-hint">Click to add points. Shift = straight. Double-click or right-click to finish. Esc to cancel.</div>
        {/if}

        {#if toolMode === 'select'}
          <div class="drawing-hint">Click elements on canvas to select. Use Freehand or Point-click to draw new lines.</div>
        {/if}

      <!-- ============ TAB 2: STROKE EFFECTS ============ -->
      {:else if activeTab === 'stroke'}
        {#if selectedEl}
          <div class="sec-label">Stroke Type</div>
          <div class="control-row">
            <span class="control-label">Type</span>
            <select
              value={selectedEl.stroke.type}
              onchange={(e) => changeStrokeType((e.target as HTMLSelectElement).value as LineStrokeType)}
            >
              {#each strokeTypes as st}
                <option value={st.type}>{st.label}</option>
              {/each}
            </select>
          </div>

          <!-- Color (all types except rainbow) -->
          {#if 'color' in selectedEl.stroke}
            <div class="control-row">
              <span class="control-label">Color</span>
              <input
                type="color"
                value={rgbaToHex(selectedEl.stroke.color)}
                oninput={(e) => {
                  if (!selectedEl) return;
                  const c = hexToRgba((e.target as HTMLInputElement).value, 'color' in selectedEl.stroke ? selectedEl.stroke.color[3] : 1);
                  updateStrokeProp('color', c);
                }}
              />
              <span class="control-label" style="width:auto">Alpha</span>
              <input
                type="range" min="0" max="1" step="0.05"
                value={selectedEl.stroke.color[3]}
                oninput={(e) => {
                  if (!selectedEl || !('color' in selectedEl.stroke)) return;
                  const c = selectedEl.stroke.color;
                  updateStrokeProp('color', [c[0], c[1], c[2], parseFloat((e.target as HTMLInputElement).value)]);
                }}
              />
            </div>
          {/if}

          <!-- Width (all types) -->
          <div class="control-row">
            <span class="control-label">Width</span>
            <input
              type="range" min="1" max="50" step="0.5"
              value={selectedEl.stroke.width}
              oninput={(e) => updateStrokeProp('width', parseFloat((e.target as HTMLInputElement).value))}
            />
            <span class="control-value">{selectedEl.stroke.width}</span>
          </div>

          <!-- Type-specific controls -->
          {#if selectedEl.stroke.type === 'solid'}
            <div class="sec-label">Solid Options</div>
            <div class="control-row">
              <span class="control-label">Cap</span>
              <select value={selectedEl.stroke.cap} onchange={(e) => updateStrokeProp('cap', (e.target as HTMLSelectElement).value)}>
                <option value="butt">Butt</option>
                <option value="round">Round</option>
                <option value="square">Square</option>
              </select>
            </div>
            <div class="control-row">
              <span class="control-label">Join</span>
              <select value={selectedEl.stroke.join} onchange={(e) => updateStrokeProp('join', (e.target as HTMLSelectElement).value)}>
                <option value="miter">Miter</option>
                <option value="round">Round</option>
                <option value="bevel">Bevel</option>
              </select>
            </div>

          {:else if selectedEl.stroke.type === 'dashed'}
            <div class="sec-label">Dash Options</div>
            <div class="control-row">
              <span class="control-label">Dash</span>
              <input type="range" min="0.05" max="1" step="0.05" value={selectedEl.stroke.dashLength}
                oninput={(e) => updateStrokeProp('dashLength', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.dashLength.toFixed(2)}</span>
            </div>
            <div class="control-row">
              <span class="control-label">Gap</span>
              <input type="range" min="0.05" max="1" step="0.05" value={selectedEl.stroke.gapLength}
                oninput={(e) => updateStrokeProp('gapLength', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.gapLength.toFixed(2)}</span>
            </div>
            <div class="check-row">
              <label><input type="checkbox" checked={selectedEl.stroke.animated}
                onchange={(e) => updateStrokeProp('animated', (e.target as HTMLInputElement).checked)} /> Animated</label>
            </div>
            {#if selectedEl.stroke.animated}
              <div class="control-row">
                <span class="control-label">Speed</span>
                <input type="range" min="0.1" max="5" step="0.1" value={selectedEl.stroke.animationSpeed}
                  oninput={(e) => updateStrokeProp('animationSpeed', parseFloat((e.target as HTMLInputElement).value))} />
                <span class="control-value">{selectedEl.stroke.animationSpeed.toFixed(1)}</span>
              </div>
            {/if}

          {:else if selectedEl.stroke.type === 'dotted'}
            <div class="sec-label">Dot Options</div>
            <div class="control-row">
              <span class="control-label">Dot size</span>
              <input type="range" min="0.01" max="0.5" step="0.01" value={selectedEl.stroke.dotSize}
                oninput={(e) => updateStrokeProp('dotSize', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.dotSize.toFixed(2)}</span>
            </div>
            <div class="control-row">
              <span class="control-label">Spacing</span>
              <input type="range" min="0.02" max="0.5" step="0.01" value={selectedEl.stroke.spacing}
                oninput={(e) => updateStrokeProp('spacing', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.spacing.toFixed(2)}</span>
            </div>
            <div class="check-row">
              <label><input type="checkbox" checked={selectedEl.stroke.animated}
                onchange={(e) => updateStrokeProp('animated', (e.target as HTMLInputElement).checked)} /> Animated</label>
            </div>
            {#if selectedEl.stroke.animated}
              <div class="control-row">
                <span class="control-label">Speed</span>
                <input type="range" min="0.1" max="5" step="0.1" value={selectedEl.stroke.animationSpeed}
                  oninput={(e) => updateStrokeProp('animationSpeed', parseFloat((e.target as HTMLInputElement).value))} />
                <span class="control-value">{selectedEl.stroke.animationSpeed.toFixed(1)}</span>
              </div>
            {/if}

          {:else if selectedEl.stroke.type === 'glow'}
            <div class="sec-label">Glow Options</div>
            <div class="control-row">
              <span class="control-label">Glow size</span>
              <input type="range" min="1" max="100" step="1" value={selectedEl.stroke.glowSize}
                oninput={(e) => updateStrokeProp('glowSize', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.glowSize}</span>
            </div>
            <div class="control-row">
              <span class="control-label">Intensity</span>
              <input type="range" min="0" max="3" step="0.1" value={selectedEl.stroke.glowIntensity}
                oninput={(e) => updateStrokeProp('glowIntensity', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.glowIntensity.toFixed(1)}</span>
            </div>
            <div class="control-row">
              <span class="control-label">Pulse</span>
              <input type="range" min="0" max="10" step="0.1" value={selectedEl.stroke.pulseSpeed}
                oninput={(e) => updateStrokeProp('pulseSpeed', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.pulseSpeed.toFixed(1)}</span>
            </div>

          {:else if selectedEl.stroke.type === 'neon'}
            <div class="sec-label">Neon Options</div>
            <div class="control-row">
              <span class="control-label">Glow size</span>
              <input type="range" min="1" max="100" step="1" value={selectedEl.stroke.glowSize}
                oninput={(e) => updateStrokeProp('glowSize', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.glowSize}</span>
            </div>
            <div class="control-row">
              <span class="control-label">Flicker speed</span>
              <input type="range" min="0" max="5" step="0.1" value={selectedEl.stroke.flickerSpeed}
                oninput={(e) => updateStrokeProp('flickerSpeed', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.flickerSpeed.toFixed(1)}</span>
            </div>
            <div class="control-row">
              <span class="control-label">Flicker amount</span>
              <input type="range" min="0" max="1" step="0.05" value={selectedEl.stroke.flickerIntensity}
                oninput={(e) => updateStrokeProp('flickerIntensity', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.flickerIntensity.toFixed(2)}</span>
            </div>

          {:else if selectedEl.stroke.type === 'electric'}
            <div class="sec-label">Electric Options</div>
            <div class="control-row">
              <span class="control-label">Arc</span>
              <input type="range" min="0" max="3" step="0.1" value={selectedEl.stroke.arcIntensity}
                oninput={(e) => updateStrokeProp('arcIntensity', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.arcIntensity.toFixed(1)}</span>
            </div>
            <div class="control-row">
              <span class="control-label">Speed</span>
              <input type="range" min="0.1" max="5" step="0.1" value={selectedEl.stroke.speed}
                oninput={(e) => updateStrokeProp('speed', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.speed.toFixed(1)}</span>
            </div>
            <div class="control-row">
              <span class="control-label">Branches</span>
              <input type="range" min="1" max="10" step="1" value={selectedEl.stroke.branches}
                oninput={(e) => updateStrokeProp('branches', parseInt((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.branches}</span>
            </div>

          {:else if selectedEl.stroke.type === 'fire'}
            <div class="sec-label">Fire Options</div>
            <div class="control-row">
              <span class="control-label">Intensity</span>
              <input type="range" min="0" max="3" step="0.1" value={selectedEl.stroke.intensity}
                oninput={(e) => updateStrokeProp('intensity', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.intensity.toFixed(1)}</span>
            </div>
            <div class="control-row">
              <span class="control-label">Speed</span>
              <input type="range" min="0.1" max="5" step="0.1" value={selectedEl.stroke.speed}
                oninput={(e) => updateStrokeProp('speed', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.speed.toFixed(1)}</span>
            </div>

          {:else if selectedEl.stroke.type === 'snake'}
            <div class="sec-label">Snake Options</div>
            <div class="control-row">
              <span class="control-label">Length</span>
              <input type="range" min="0.01" max="2" step="0.01" value={selectedEl.stroke.length}
                oninput={(e) => updateStrokeProp('length', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.length.toFixed(2)}</span>
            </div>
            <div class="control-row">
              <span class="control-label">Speed</span>
              <input type="range" min="0.1" max="5" step="0.1" value={selectedEl.stroke.speed}
                oninput={(e) => updateStrokeProp('speed', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.speed.toFixed(1)}</span>
            </div>
            <div class="control-row">
              <span class="control-label">Count</span>
              <input type="range" min="1" max="8" step="1" value={selectedEl.stroke.snakeCount}
                oninput={(e) => updateStrokeProp('snakeCount', parseInt((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.snakeCount}</span>
            </div>
            <div class="check-row">
              <label><input type="checkbox" checked={selectedEl.stroke.tailFade}
                onchange={(e) => updateStrokeProp('tailFade', (e.target as HTMLInputElement).checked)} /> Tail fade</label>
              <label><input type="checkbox" checked={selectedEl.stroke.headGlow}
                onchange={(e) => updateStrokeProp('headGlow', (e.target as HTMLInputElement).checked)} /> Head glow</label>
              <label><input type="checkbox" checked={selectedEl.stroke.bidirectional}
                onchange={(e) => updateStrokeProp('bidirectional', (e.target as HTMLInputElement).checked)} /> Bidir</label>
            </div>

          {:else if selectedEl.stroke.type === 'multiTail'}
            <div class="sec-label">Multi-Tail Options</div>
            <div class="control-row">
              <span class="control-label">Tails</span>
              <input type="range" min="2" max="12" step="1" value={selectedEl.stroke.tailCount}
                oninput={(e) => updateStrokeProp('tailCount', parseInt((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.tailCount}</span>
            </div>
            <div class="control-row">
              <span class="control-label">Tail length</span>
              <input type="range" min="0" max="1" step="0.05" value={selectedEl.stroke.tailLength}
                oninput={(e) => updateStrokeProp('tailLength', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.tailLength.toFixed(2)}</span>
            </div>
            <div class="control-row">
              <span class="control-label">Spacing</span>
              <input type="range" min="0" max="1" step="0.05" value={selectedEl.stroke.spacing}
                oninput={(e) => updateStrokeProp('spacing', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.spacing.toFixed(2)}</span>
            </div>
            <div class="control-row">
              <span class="control-label">Speed</span>
              <input type="range" min="0.1" max="5" step="0.1" value={selectedEl.stroke.speed}
                oninput={(e) => updateStrokeProp('speed', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.speed.toFixed(1)}</span>
            </div>
            <div class="check-row">
              <label><input type="checkbox" checked={selectedEl.stroke.tailFade}
                onchange={(e) => updateStrokeProp('tailFade', (e.target as HTMLInputElement).checked)} /> Tail fade</label>
              <label><input type="checkbox" checked={selectedEl.stroke.headGlow}
                onchange={(e) => updateStrokeProp('headGlow', (e.target as HTMLInputElement).checked)} /> Head glow</label>
            </div>
            <div class="check-row">
              <label><input type="checkbox" checked={selectedEl.stroke.colorShift}
                onchange={(e) => updateStrokeProp('colorShift', (e.target as HTMLInputElement).checked)} /> Color shift</label>
            </div>
            {#if selectedEl.stroke.colorShift}
              <div class="control-row">
                <span class="control-label">Shift amount</span>
                <input type="range" min="0" max="1" step="0.05" value={selectedEl.stroke.colorShiftAmount}
                  oninput={(e) => updateStrokeProp('colorShiftAmount', parseFloat((e.target as HTMLInputElement).value))} />
                <span class="control-value">{selectedEl.stroke.colorShiftAmount.toFixed(2)}</span>
              </div>
            {/if}

          {:else if selectedEl.stroke.type === 'pulse'}
            <div class="sec-label">Pulse Options</div>
            <div class="control-row">
              <span class="control-label">Pulses</span>
              <input type="range" min="1" max="20" step="1" value={selectedEl.stroke.pulseCount}
                oninput={(e) => updateStrokeProp('pulseCount', parseInt((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.pulseCount}</span>
            </div>
            <div class="control-row">
              <span class="control-label">Speed</span>
              <input type="range" min="0.1" max="5" step="0.1" value={selectedEl.stroke.speed}
                oninput={(e) => updateStrokeProp('speed', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.speed.toFixed(1)}</span>
            </div>
            <div class="control-row">
              <span class="control-label">Fade length</span>
              <input type="range" min="0" max="1" step="0.05" value={selectedEl.stroke.fadeLength}
                oninput={(e) => updateStrokeProp('fadeLength', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.fadeLength.toFixed(2)}</span>
            </div>
            <div class="control-row">
              <span class="control-label">Direction</span>
              <select value={selectedEl.stroke.direction}
                onchange={(e) => updateStrokeProp('direction', (e.target as HTMLSelectElement).value)}>
                <option value="forward">Forward</option>
                <option value="backward">Backward</option>
                <option value="both">Both</option>
              </select>
            </div>

          {:else if selectedEl.stroke.type === 'scanner'}
            <div class="sec-label">Scanner Options</div>
            <div class="control-row">
              <span class="control-label">Beam width</span>
              <input type="range" min="0" max="1" step="0.05" value={selectedEl.stroke.beamWidth}
                oninput={(e) => updateStrokeProp('beamWidth', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.beamWidth.toFixed(2)}</span>
            </div>
            <div class="control-row">
              <span class="control-label">Speed</span>
              <input type="range" min="0.1" max="5" step="0.1" value={selectedEl.stroke.speed}
                oninput={(e) => updateStrokeProp('speed', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.speed.toFixed(1)}</span>
            </div>
            <div class="control-row">
              <span class="control-label">Trail</span>
              <input type="range" min="0" max="1" step="0.05" value={selectedEl.stroke.trail}
                oninput={(e) => updateStrokeProp('trail', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.trail.toFixed(2)}</span>
            </div>

          {:else if selectedEl.stroke.type === 'rainbow'}
            <div class="sec-label">Rainbow Options</div>
            <div class="control-row">
              <span class="control-label">Saturation</span>
              <input type="range" min="0" max="1" step="0.05" value={selectedEl.stroke.saturation}
                oninput={(e) => updateStrokeProp('saturation', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.saturation.toFixed(2)}</span>
            </div>
            <div class="control-row">
              <span class="control-label">Brightness</span>
              <input type="range" min="0" max="1" step="0.05" value={selectedEl.stroke.brightness}
                oninput={(e) => updateStrokeProp('brightness', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.brightness.toFixed(2)}</span>
            </div>
            <div class="control-row">
              <span class="control-label">Speed</span>
              <input type="range" min="0.1" max="5" step="0.1" value={selectedEl.stroke.speed}
                oninput={(e) => updateStrokeProp('speed', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.speed.toFixed(1)}</span>
            </div>
            <div class="control-row">
              <span class="control-label">Segments</span>
              <input type="range" min="1" max="20" step="1" value={selectedEl.stroke.segments}
                oninput={(e) => updateStrokeProp('segments', parseInt((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.segments}</span>
            </div>

          {:else if selectedEl.stroke.type === 'laser'}
            <div class="sec-label">Laser Options</div>
            <div class="control-row">
              <span class="control-label">Intensity</span>
              <input type="range" min="0" max="3" step="0.1" value={selectedEl.stroke.intensity}
                oninput={(e) => updateStrokeProp('intensity', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.intensity.toFixed(1)}</span>
            </div>
            <div class="control-row">
              <span class="control-label">Scatter</span>
              <input type="range" min="0" max="1" step="0.05" value={selectedEl.stroke.scatter}
                oninput={(e) => updateStrokeProp('scatter', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.scatter.toFixed(2)}</span>
            </div>
            <div class="control-row">
              <span class="control-label">Flicker</span>
              <input type="range" min="0" max="1" step="0.05" value={selectedEl.stroke.flicker}
                oninput={(e) => updateStrokeProp('flicker', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.flicker.toFixed(2)}</span>
            </div>

          {:else if selectedEl.stroke.type === 'pipe'}
            <div class="sec-label">Pipe Options</div>
            <div class="control-row">
              <span class="control-label">Depth</span>
              <input type="range" min="0" max="1" step="0.05" value={selectedEl.stroke.depth}
                oninput={(e) => updateStrokeProp('depth', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.depth.toFixed(2)}</span>
            </div>
            <div class="control-row">
              <span class="control-label">Edge light</span>
              <input type="range" min="0" max="2" step="0.1" value={selectedEl.stroke.edgeLight}
                oninput={(e) => updateStrokeProp('edgeLight', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.edgeLight.toFixed(1)}</span>
            </div>
            <div class="control-row">
              <span class="control-label">Edge color</span>
              <input
                type="color"
                value={rgbaToHex(selectedEl.stroke.edgeLightColor)}
                oninput={(e) => {
                  if (!selectedEl || selectedEl.stroke.type !== 'pipe') return;
                  const c = hexToRgba((e.target as HTMLInputElement).value, selectedEl.stroke.edgeLightColor[3]);
                  updateStrokeProp('edgeLightColor', c);
                }}
              />
            </div>
            <div class="control-row">
              <span class="control-label">Specular</span>
              <input type="range" min="0" max="1" step="0.05" value={selectedEl.stroke.specular}
                oninput={(e) => updateStrokeProp('specular', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.specular.toFixed(2)}</span>
            </div>
            <div class="control-row">
              <span class="control-label">Roughness</span>
              <input type="range" min="0" max="1" step="0.05" value={selectedEl.stroke.roughness}
                oninput={(e) => updateStrokeProp('roughness', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.roughness.toFixed(2)}</span>
            </div>

          {/if}

          <!-- Apply stroke to all lines -->
          {#if elements.length > 1}
            <button class="apply-all-btn" onclick={applyStrokeToAll}>
              Apply Stroke to All Lines
            </button>
          {/if}

          <!-- Compositing -->
          <div class="sec-label">Compositing</div>
          <div class="control-row">
            <span class="control-label">Blend</span>
            <select value={selectedEl.blendMode}
              onchange={(e) => updateSelectedElement({ blendMode: (e.target as HTMLSelectElement).value as LineElement['blendMode'] })}>
              <option value="normal">Normal</option>
              <option value="add">Add</option>
              <option value="multiply">Multiply</option>
              <option value="screen">Screen</option>
            </select>
          </div>
          <div class="control-row">
            <span class="control-label">Opacity</span>
            <input type="range" min="0" max="1" step="0.05" value={selectedEl.opacity}
              oninput={(e) => updateSelectedElement({ opacity: parseFloat((e.target as HTMLInputElement).value) })} />
            <span class="control-value">{(selectedEl.opacity * 100).toFixed(0)}%</span>
          </div>
        {:else}
          <div class="empty-msg">Select an element to edit its stroke effects</div>
        {/if}

      <!-- ============ TAB 3: ANIMATION ============ -->
      {:else if activeTab === 'animation'}
        <!-- Animation status -->
        {@const animatedCount = elements.filter(e => e.drawAnimation.enabled).length}
        <div class="anim-status">{animatedCount} / {elements.length} lines animated</div>

        {#if animEl}
          <div class="sec-label">Draw Animation</div>
          {#if elements.length > 1}
            <div class="scope-toggle" role="group" aria-label="Which lines the draw animation changes">
              <button class:active={drawScope === 'all'} onclick={() => (drawScope = 'all')}>All lines</button>
              <button class:active={drawScope === 'one'} onclick={() => (drawScope = 'one')} disabled={!selectedEl}
                title={selectedEl ? 'Change only the selected line' : 'Select a line first'}>This line</button>
            </div>
          {/if}
          <div class="check-row">
            <label><input type="checkbox" checked={animEl.drawAnimation.enabled}
              onchange={(e) => updateSelectedDrawAnimation({ enabled: (e.target as HTMLInputElement).checked })} /> Enabled</label>
          </div>

          {#if animEl.drawAnimation.enabled}
            <div class="slider-col">
              <div class="sc">
                <label>Draw speed <b>{animEl.drawAnimation.drawSpeed.toFixed(1)}</b></label>
                <input type="range" min="0.1" max="10" step="0.1" value={animEl.drawAnimation.drawSpeed}
                  oninput={(e) => updateSelectedDrawAnimation({ drawSpeed: parseFloat((e.target as HTMLInputElement).value) })} />
              </div>
              <div class="sc">
                <label>Trail length <b>{animEl.drawAnimation.trailLength.toFixed(2)}</b></label>
                <input type="range" min="0" max="1" step="0.01" value={animEl.drawAnimation.trailLength}
                  oninput={(e) => updateSelectedDrawAnimation({ trailLength: parseFloat((e.target as HTMLInputElement).value) })} />
              </div>
            </div>

            <div class="control-row">
              <span class="control-label">Loop</span>
              <select value={animEl.drawAnimation.loopMode}
                onchange={(e) => updateSelectedDrawAnimation({ loopMode: (e.target as HTMLSelectElement).value as LineLoopMode })}>
                <option value="once">Once</option>
                <option value="loop">Loop</option>
                <option value="pingpong">Ping-pong</option>
                <option value="continuous">Continuous</option>
              </select>
            </div>

            <div class="check-row">
              <label><input type="checkbox" checked={animEl.drawAnimation.reverse}
                onchange={(e) => updateSelectedDrawAnimation({ reverse: (e.target as HTMLInputElement).checked })} /> Reverse</label>
            </div>

            <div class="control-row">
              <span class="control-label">Easing</span>
              <select value={animEl.drawAnimation.easing}
                onchange={(e) => updateSelectedDrawAnimation({ easing: (e.target as HTMLSelectElement).value as LineDrawAnimation['easing'] })}>
                <option value="linear">Linear</option>
                <option value="easeIn">Ease in</option>
                <option value="easeOut">Ease out</option>
                <option value="easeInOut">Ease in/out</option>
              </select>
            </div>

            <div class="slider-col">
              <div class="sc">
                <label title="Softens the leading edge of the draw into a fade">Head feather <b>{(animEl.drawAnimation.headFeather ?? 0).toFixed(2)}</b></label>
                <input type="range" min="0" max="1" step="0.01" value={animEl.drawAnimation.headFeather ?? 0}
                  oninput={(e) => updateSelectedDrawAnimation({ headFeather: parseFloat((e.target as HTMLInputElement).value) })} />
              </div>
              <div class="sc">
                <label title="Thins the line toward the leading edge">Head taper <b>{(animEl.drawAnimation.headTaper ?? 0).toFixed(2)}</b></label>
                <input type="range" min="0" max="1" step="0.01" value={animEl.drawAnimation.headTaper ?? 0}
                  oninput={(e) => updateSelectedDrawAnimation({ headTaper: parseFloat((e.target as HTMLInputElement).value) })} />
              </div>
            </div>

            <!-- Copy this line's animation to the others -->
            {#if elements.length > 1 && drawScope === 'one' && selectedEl}
              <button class="apply-all-btn" onclick={applyAnimationToAll}>
                Apply Animation to All Lines
              </button>
            {/if}
          {/if}

        {:else}
          <div class="empty-msg">Draw a line to animate it</div>
        {/if}

        {#if elements.length > 0}
          {@const motionFx = elements[0].motionFx ?? { mode: 'none', amount: 0.5, speed: 1 }}
          <div class="sec-label">Motion FX (all lines)</div>
          <div class="control-row">
            <span class="control-label">Motion</span>
            <select value={motionFx.mode}
              onchange={(e) => updateSelectedMotionFx({ mode: (e.target as HTMLSelectElement).value as import('../lines/types').LineMotionFxMode })}>
              <option value="none">None</option>
              <option value="wave">Wave</option>
              <option value="breathe">Breathe</option>
              <option value="shimmer">Shimmer</option>
              <option value="spin">Spin</option>
              <option value="orbit">Orbit</option>
              <option value="audioPulse">Audio pulse</option>
            </select>
          </div>
          {#if motionFx.mode !== 'none'}
            <div class="slider-col">
              <div class="sc">
                <label>Amount <b>{motionFx.amount.toFixed(2)}</b></label>
                <input type="range" min="0" max="1" step="0.01" value={motionFx.amount}
                  oninput={(e) => updateSelectedMotionFx({ amount: parseFloat((e.target as HTMLInputElement).value) })} />
              </div>
              <div class="sc">
                <label>Speed <b>{motionFx.speed.toFixed(1)}</b></label>
                <input type="range" min="0.1" max="4" step="0.1" value={motionFx.speed}
                  oninput={(e) => updateSelectedMotionFx({ speed: parseFloat((e.target as HTMLInputElement).value) })} />
              </div>
            </div>
          {/if}
        {/if}

        {#if elements.length > 0}
          <div class="sec-label">Light Up (all lines)</div>
          <div class="control-row">
            <span class="control-label">Mode</span>
            <select value={revealMode}
              onchange={(e) => updateContent({ revealMode: (e.target as HTMLSelectElement).value as LinesRevealMode })}>
              <option value="off">Off</option>
              <option value="waveRight">Wave, left to right</option>
              <option value="waveLeft">Wave, right to left</option>
              <option value="wavePingPong">Wave, back and forth</option>
              <option value="random">Random</option>
            </select>
          </div>
          {#if revealMode !== 'off'}
            <div class="slider-col">
              <div class="sc">
                <label>Speed <b>{(lc.revealSpeed ?? LINES_REVEAL_DEFAULTS.revealSpeed).toFixed(2)}</b></label>
                <input type="range" min="0.02" max="2" step="0.01" value={lc.revealSpeed ?? LINES_REVEAL_DEFAULTS.revealSpeed}
                  oninput={(e) => updateContent({ revealSpeed: parseFloat((e.target as HTMLInputElement).value) })} />
              </div>
              <div class="sc">
                <label title="How many of the lines are lit at once">Lit at once <b>{Math.round((lc.revealWidth ?? LINES_REVEAL_DEFAULTS.revealWidth) * 100)}%</b></label>
                <input type="range" min="0.05" max="1" step="0.01" value={lc.revealWidth ?? LINES_REVEAL_DEFAULTS.revealWidth}
                  oninput={(e) => updateContent({ revealWidth: parseFloat((e.target as HTMLInputElement).value) })} />
              </div>
              <div class="sc">
                <label title="How gently lines fade in and out">Fade <b>{(lc.revealFade ?? LINES_REVEAL_DEFAULTS.revealFade).toFixed(2)}</b></label>
                <input type="range" min="0" max="1" step="0.01" value={lc.revealFade ?? LINES_REVEAL_DEFAULTS.revealFade}
                  oninput={(e) => updateContent({ revealFade: parseFloat((e.target as HTMLInputElement).value) })} />
              </div>
              <div class="sc">
                <label title="How bright a line stays while it is not lit">Dim to <b>{Math.round((lc.revealFloor ?? 0) * 100)}%</b></label>
                <input type="range" min="0" max="1" step="0.01" value={lc.revealFloor ?? 0}
                  oninput={(e) => updateContent({ revealFloor: parseFloat((e.target as HTMLInputElement).value) })} />
              </div>
            </div>
          {/if}
        {/if}

        <!-- Layer-level animation -->
        <div class="sec-label">Layer Animation</div>
        <div class="slider-col">
          <div class="sc">
            <label>Global speed <b>{(lc.globalDrawSpeed).toFixed(1)}x</b></label>
            <input type="range" min="0.1" max="5" step="0.1" value={lc.globalDrawSpeed}
              oninput={(e) => updateContent({ globalDrawSpeed: parseFloat((e.target as HTMLInputElement).value) })} />
          </div>
        </div>

        <div class="control-row">
          <span class="control-label">Stagger</span>
          <select value={lc.staggerMode}
            onchange={(e) => updateContent({ staggerMode: (e.target as HTMLSelectElement).value as LinesContent['staggerMode'] })}>
            <option value="simultaneous">Simultaneous</option>
            <option value="sequential">Sequential (one at a time)</option>
            <option value="cascade">Cascade (staggered start)</option>
            <option value="solo">Solo (draw on/off)</option>
            <option value="random">Random</option>
            <option value="wave">Wave (sliding window)</option>
          </select>
        </div>

        {#if lc.staggerMode === 'cascade' || lc.staggerMode === 'sequential' || lc.staggerMode === 'solo' || lc.staggerMode === 'random' || lc.staggerMode === 'wave'}
          <div class="slider-col">
            <div class="sc">
              <label>Stagger delay <b>{lc.staggerDelay}ms</b></label>
              <input type="range" min="0" max="2000" step="50" value={lc.staggerDelay}
                oninput={(e) => updateContent({ staggerDelay: parseInt((e.target as HTMLInputElement).value) })} />
            </div>
          </div>
        {/if}

        {#if lc.staggerMode === 'wave'}
          <div class="slider-col">
            <div class="sc">
              <label>Wave window size <b>{lc.waveWindowSize ?? 3}</b></label>
              <input type="range" min="1" max="12" step="1" value={lc.waveWindowSize ?? 3}
                oninput={(e) => updateContent({ waveWindowSize: parseInt((e.target as HTMLInputElement).value) })} />
            </div>
          </div>
        {/if}

        <button class="reset-btn" onclick={resetAllAnimations}
          title="Every line's draw animation, motion, stagger and Light Up back to the defaults, restarted">
          Reset All Animations
        </button>

      <!-- ============ TAB 4: SETTINGS ============ -->
      {:else if activeTab === 'settings'}
        <div class="sec-label">Elements</div>
        {#if elements.length === 0}
          <div class="empty-msg">No elements yet. Use the Draw tab to add lines.</div>
        {:else}
          <div class="elements-list">
            {#each elements as el}
              <div class="element-row" class:selected={selectedElementId === el.id} onclick={() => selectElement(el.id)}>
                <div class="el-info">
                  <span class="el-name">{el.name}</span>
                  <span class="el-meta">{el.shape.type} / {el.stroke.type}</span>
                </div>
                <button class="icon-btn" class:off={!el.visible} title="Visibility"
                  onclick={(e) => { e.stopPropagation(); toggleElementVisibility(el.id); }}>
                  {#if el.visible}&#128065;{:else}&#128064;{/if}
                </button>
                <button class="icon-btn" class:on={el.locked} title="Lock"
                  onclick={(e) => { e.stopPropagation(); toggleElementLock(el.id); }}>
                  {#if el.locked}&#128274;{:else}&#128275;{/if}
                </button>
                <button class="icon-btn" title="Duplicate"
                  onclick={(e) => { e.stopPropagation(); duplicateElement(el.id); }}>&#10697;</button>
                <button class="icon-btn del" title="Delete"
                  onclick={(e) => { e.stopPropagation(); removeElement(el.id); }}>&#10005;</button>
              </div>
            {/each}
          </div>
        {/if}

        <div class="sec-label">Layer Settings</div>
        <div class="control-row">
          <span class="control-label">Background</span>
          <input type="color"
            value={rgbaToHex(lc.backgroundColor)}
            oninput={(e) => {
              const c = hexToRgba((e.target as HTMLInputElement).value, lc!.backgroundColor[3]);
              updateContent({ backgroundColor: c });
            }} />
          <span class="control-label" style="width:auto">Alpha</span>
          <input type="range" min="0" max="1" step="0.05"
            value={lc.backgroundColor[3]}
            oninput={(e) => {
              const c = lc!.backgroundColor;
              updateContent({ backgroundColor: [c[0], c[1], c[2], parseFloat((e.target as HTMLInputElement).value)] });
            }} />
        </div>

        <div class="slider-col">
          <div class="sc">
            <label>Bloom <b>{lc.bloom.toFixed(1)}</b></label>
            <input type="range" min="0" max="3" step="0.1" value={lc.bloom}
              oninput={(e) => updateContent({ bloom: parseFloat((e.target as HTMLInputElement).value) })} />
          </div>
          <div class="sc">
            <label>Afterglow <b>{lc.afterglow.toFixed(2)}</b></label>
            <input type="range" min="0" max="1" step="0.01" value={lc.afterglow}
              oninput={(e) => updateContent({ afterglow: parseFloat((e.target as HTMLInputElement).value) })} />
          </div>
        </div>

        <!-- Shared Shader Mask Mode -->
        <div class="sec-label">Shader Mask</div>
        <div class="control-row">
          <label class="toggle-row">
            <input type="checkbox"
              checked={lc.sharedShaderMode ?? false}
              onchange={(e) => updateContent({ sharedShaderMode: (e.target as HTMLInputElement).checked })} />
            <span>Lines as mask windows</span>
          </label>
        </div>
        {#if lc.sharedShaderMode}
          <div class="hint-text" style="margin-bottom: 6px;">
            Lines reveal a shared shader/video underneath — like looking through line-shaped windows.
          </div>
          <div class="control-row">
            <span class="control-label">Source layer</span>
            <select class="param-select"
              value={lc.sharedShaderSourceId ?? ''}
              onchange={(e) => updateContent({ sharedShaderSourceId: (e.target as HTMLSelectElement).value })}>
              <option value="">— Select a layer —</option>
              {#each sharedShaderSources as src}
                <option value={src.id}>{src.layerName} ({src.type})</option>
              {/each}
            </select>
          </div>
          {#if sharedShaderSources.length === 0}
            <div class="hint-text" style="color: #f59e0b;">Add a shader or video layer to the project to use as a mask source.</div>
          {/if}
        {/if}
      {/if}
    </div>
  </div>
{:else}
  <div data-help-page="layers" class="lines-panel">
    <div class="empty-msg">No Lines layer selected</div>
  </div>
{/if}

<style>
  .lines-panel {
    width: 100%;
    background: var(--ga-panel);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    flex: 1;
    color: var(--ga-ink-0);
    font-size: var(--ga-text-body);
  }

  .lines-panel.compact {
    font-size: var(--ga-text-control);
  }

  /* Header */
  .lp-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 12px 8px;
  }
  .lp-title { font-size: var(--ga-text-title); font-weight: var(--ga-weight-title); color: var(--ga-ink-0); }
  .el-badge {
    min-width: 18px; text-align: center;
    background: var(--ga-sub); color: var(--ga-ink-1); border: 1px solid var(--ga-line-2);
    font-size: var(--ga-text-micro); font-weight: 700; font-variant-numeric: tabular-nums;
    padding: 1px 5px; border-radius: var(--ga-r-hard);
  }

  /* Tabs: the shared segmented look */
  .lp-tabs {
    display: flex; gap: 2px; flex-shrink: 0;
    margin: 0 12px 4px; padding: 2px;
    background: var(--ga-slot); border: 1px solid var(--ga-line-2); border-radius: var(--ga-r-hard);
  }
  .lp-tabs button {
    flex: 1; height: calc(var(--ga-control-h) - 4px); background: none; border: none; color: var(--ga-ink-1);
    padding: 0 4px; font-size: var(--ga-text-control); font-weight: var(--ga-weight-control); cursor: pointer;
    border-radius: calc(var(--ga-r-hard) - 1px);
  }
  .lp-tabs button:hover:not(.active) { color: var(--ga-ink-0); background: rgba(255, 255, 255, 0.05); }
  .lp-tabs button.active { color: var(--ga-selection-ink); background: var(--ga-selection-bg); box-shadow: inset 0 0 0 1px var(--ga-selection-line); }

  /* Content */
  .lp-content { padding: 8px 12px 12px; overflow-y: auto; flex: 1; }

  /* Eyebrow section label, same as every layer editor. */
  .sec-label {
    display: flex; align-items: center; justify-content: space-between;
    font-size: var(--ga-text-eyebrow); font-weight: 700; color: var(--ga-ink-2); text-transform: uppercase; letter-spacing: var(--ga-eyebrow-tracking);
    margin: 16px 0 8px; padding-top: 12px; border-top: 1px solid var(--ga-line-1);
  }
  .sec-label:first-child { margin-top: 4px; padding-top: 0; border-top: 0; }

  /* Tool grid */
  .tool-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; margin-bottom: 8px; }
  .tool-btn {
    display: flex; flex-direction: column; align-items: center; gap: 4px;
    padding: 8px 4px; background: var(--ga-sub); border: 1px solid var(--ga-line-2); color: var(--ga-ink-1);
    border-radius: var(--ga-r-hard); cursor: pointer; text-align: center;
    transition: all 0.15s;
  }
  .tool-btn:hover:not(.active) { color: var(--ga-ink-0); border-color: var(--ga-line-3); }
  .tool-btn.active { background: var(--ga-selection-bg); color: var(--ga-selection-ink); border-color: var(--ga-selection-line); }
  .tool-icon { font-size: 20px; line-height: 1; }
  .tool-label { font-size: var(--ga-text-meta); font-weight: var(--ga-weight-control); }
  .tool-btn.active .tool-label { color: var(--ga-selection-ink); }

  /* Drawing hint */
  .drawing-hint {
    padding: 6px 8px; margin: 6px 0;
    font-size: var(--ga-text-meta); line-height: 1.4; color: var(--ga-ink-2);
    background: var(--ga-card);
    border-left: 2px solid var(--ga-line-3);
    border-radius: 0 var(--ga-r-hard) var(--ga-r-hard) 0;
  }

  /* Control rows */
  .control-row {
    display: flex; align-items: center; gap: 8px; min-height: var(--ga-control-h); margin-bottom: 4px;
  }
  .control-label {
    width: 84px; font-size: var(--ga-text-control); color: var(--ga-ink-1); flex-shrink: 0;
  }
  .control-row input[type="range"] {
    flex: 1; min-width: 0; height: 4px; appearance: none; background: var(--ga-line-2); border-radius: 2px; outline: none;
  }
  .control-row input[type="range"]::-webkit-slider-thumb {
    appearance: none; width: 14px; height: 14px; border-radius: 50%;
    background: var(--ga-selection-line); cursor: pointer; border: 2px solid var(--ga-panel);
  }
  .control-row input[type="color"] {
    width: 40px; height: var(--ga-control-h-sm); border: 1px solid var(--ga-line-2); border-radius: var(--ga-r-hard); cursor: pointer; padding: 0;
  }
  .control-row select, .inline-select {
    flex: 1; min-width: 0; height: var(--ga-control-h); background: var(--ga-slot); color: var(--ga-ink-0); border: 1px solid var(--ga-line-2);
    padding: 0 8px; border-radius: var(--ga-r-hard); font-size: var(--ga-text-control);
  }
  .control-value {
    width: 45px; text-align: right; font-size: var(--ga-text-meta); color: var(--ga-ink-1); font-variant-numeric: tabular-nums; flex-shrink: 0;
  }

  /* Full-width slider column */
  .slider-col { display: flex; flex-direction: column; gap: 8px; margin-bottom: 8px; }
  .sc { display: flex; flex-direction: column; }
  .sc label {
    font-size: var(--ga-text-control); color: var(--ga-ink-1); margin-bottom: 4px; display: flex; align-items: baseline;
  }
  .sc label b { color: var(--ga-ink-0); font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace); font-size: var(--ga-text-meta); font-weight: 400; font-variant-numeric: tabular-nums; margin-left: auto; }
  .sc select {
    height: var(--ga-control-h); background: var(--ga-slot); color: var(--ga-ink-0); border: 1px solid var(--ga-line-2);
    padding: 0 8px; border-radius: var(--ga-r-hard); font-size: var(--ga-text-control);
  }
  .sc input[type="range"] {
    width: 100%; height: 4px; appearance: none; background: var(--ga-line-2); border-radius: 2px; outline: none;
  }
  .sc input[type="range"]::-webkit-slider-thumb {
    appearance: none; width: 14px; height: 14px; border-radius: 50%;
    background: var(--ga-selection-line); cursor: pointer; border: 2px solid var(--ga-panel);
  }

  /* Check row */
  .check-row { display: flex; gap: 12px; min-height: var(--ga-control-h-sm); margin-bottom: 8px; flex-wrap: wrap; }
  .check-row label { display: flex; align-items: center; gap: 6px; font-size: var(--ga-text-control); color: var(--ga-ink-1); cursor: pointer; }
  .check-row input[type="checkbox"] { accent-color: var(--ga-selection-line); width: 13px; height: 13px; }

  /* Text input */
  .text-input {
    flex: 1; height: var(--ga-control-h); background: var(--ga-slot); color: var(--ga-ink-0); border: 1px solid var(--ga-line-2);
    padding: 0 8px; border-radius: var(--ga-r-hard); font-size: var(--ga-text-control); outline: none;
  }
  .text-input:focus { border-color: var(--ga-focus); }

  /* Elements list */
  .elements-list { max-height: 260px; overflow-y: auto; margin-bottom: 8px; }
  .element-row {
    display: flex; align-items: center; gap: 6px; min-height: var(--ga-control-h); padding: 4px 8px;
    border: 1px solid var(--ga-line-1); border-radius: var(--ga-r-hard); margin-bottom: 4px;
    cursor: pointer; transition: all 0.1s;
  }
  .element-row:hover { background: var(--ga-card); border-color: var(--ga-line-2); }
  .element-row.selected { background: var(--ga-selection-bg); border-color: var(--ga-selection-line); }
  .el-info { flex: 1; min-width: 0; }
  .el-name { display: block; font-size: var(--ga-text-control); font-weight: var(--ga-weight-control); color: var(--ga-ink-0); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .element-row.selected .el-name { color: var(--ga-selection-ink); }
  .el-meta { display: block; font-size: var(--ga-text-meta); color: var(--ga-ink-2); }

  .icon-btn {
    background: none; border: 1px solid transparent; color: var(--ga-ink-2);
    font-size: 13px; cursor: pointer; padding: 2px 4px; border-radius: var(--ga-r-hard);
    line-height: 1; flex-shrink: 0;
  }
  .icon-btn:hover { color: var(--ga-ink-0); background: rgba(255,255,255,0.05); }
  .icon-btn.off { opacity: 0.4; }
  .icon-btn.on { color: var(--ga-selection-ink); }
  .icon-btn.del:hover { color: var(--ga-rec); background: color-mix(in srgb, var(--ga-rec) 10%, transparent); border-color: color-mix(in srgb, var(--ga-rec) 30%, transparent); }

  /* Empty state */
  .empty-msg { text-align: center; color: var(--ga-ink-2); font-size: var(--ga-text-control); padding: 20px; }

  /* Elements strip — always visible above tabs */
  .elements-strip {
    margin: 0 12px 8px;
    border: 1px solid var(--ga-line-2);
    border-radius: var(--ga-r-hard);
    background: var(--ga-card);
  }
  /* Collapsible eyebrow header */
  .strip-toggle {
    width: 100%; height: var(--ga-control-h-sm);
    background: none; border: none; color: var(--ga-ink-2);
    font-size: var(--ga-text-eyebrow); font-weight: 700; text-align: left;
    padding: 0 8px; cursor: pointer;
    text-transform: uppercase; letter-spacing: var(--ga-eyebrow-tracking);
  }
  .strip-toggle:hover { color: var(--ga-ink-1); }
  .elements-strip-list {
    max-height: 120px; overflow-y: auto;
    padding: 0 4px 4px;
    display: flex; flex-direction: column; gap: 2px;
  }
  .strip-el {
    display: flex; align-items: center; gap: 6px;
    min-height: var(--ga-control-h-sm); padding: 0 8px; background: var(--ga-panel);
    border: 1px solid var(--ga-line-1); border-radius: var(--ga-r-hard);
    cursor: pointer; font-size: var(--ga-text-control); color: var(--ga-ink-1);
    text-align: left;
  }
  .strip-el:hover { color: var(--ga-ink-0); border-color: var(--ga-line-2); }
  .strip-el.selected { background: var(--ga-selection-bg); border-color: var(--ga-selection-line); color: var(--ga-selection-ink); }
  .strip-name { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: var(--ga-text-control); }
  .strip-type { font-size: var(--ga-text-meta); color: var(--ga-ink-2); flex-shrink: 0; }
  .strip-del {
    background: none; border: none; color: var(--ga-ink-2); font-size: var(--ga-text-meta);
    cursor: pointer; padding: 0 2px; line-height: 1; flex-shrink: 0;
  }
  .strip-del:hover { color: var(--ga-rec); }

  /* Apply to all button */
  .apply-all-btn {
    width: 100%; height: var(--ga-control-h); padding: 0 12px; margin: 8px 0;
    background: var(--ga-sub);
    border: 1px solid var(--ga-line-2);
    color: var(--ga-ink-1); border-radius: var(--ga-r-hard);
    font-size: var(--ga-text-control); font-weight: var(--ga-weight-control); cursor: pointer;
  }
  .apply-all-btn:hover {
    color: var(--ga-ink-0);
    border-color: var(--ga-line-3);
  }

  /* Draw Animation scope: all lines or the selected one */
  .scope-toggle {
    display: grid; grid-template-columns: 1fr 1fr; gap: 2px;
    margin: 2px 0 8px; padding: 2px; background: var(--ga-slot); border: 1px solid var(--ga-line-2); border-radius: var(--ga-r-hard);
  }
  .scope-toggle button {
    height: calc(var(--ga-control-h) - 6px); padding: 0 8px; font-size: var(--ga-text-control); font-weight: var(--ga-weight-control); background: transparent; color: var(--ga-ink-1);
    border: none; border-radius: calc(var(--ga-r-hard) - 1px); cursor: pointer;
  }
  .scope-toggle button:hover:not(.active):not(:disabled) { color: var(--ga-ink-0); background: rgba(255, 255, 255, 0.05); }
  .scope-toggle button.active { background: var(--ga-selection-bg); color: var(--ga-selection-ink); box-shadow: inset 0 0 0 1px var(--ga-selection-line); }
  .scope-toggle button:disabled { opacity: 0.4; cursor: default; }

  /* Reset animations button */
  .reset-btn {
    width: 100%; height: var(--ga-control-h); padding: 0 12px; margin: 6px 0;
    background: var(--ga-sub);
    border: 1px solid var(--ga-line-2); color: var(--ga-ink-1);
    border-radius: var(--ga-r-hard); font-size: var(--ga-text-control); font-weight: var(--ga-weight-control); cursor: pointer;
  }
  .reset-btn:hover { color: var(--ga-ink-0); border-color: var(--ga-line-3); }

  /* Animation status */
  .anim-status {
    font-size: var(--ga-text-meta); color: var(--ga-ink-1);
    padding: 4px 0 6px; margin-bottom: 4px;
    border-bottom: 1px solid var(--ga-line-1);
    text-align: center; font-weight: var(--ga-weight-control);
  }

  /* Toggle row */
  .toggle-row {
    display: flex; align-items: center; gap: 8px; min-height: var(--ga-control-h-sm);
    cursor: pointer; font-size: var(--ga-text-control); color: var(--ga-ink-0);
  }
  .toggle-row input[type="checkbox"] {
    accent-color: var(--ga-selection-line);
  }

  /* Hint text */
  .hint-text {
    font-size: var(--ga-text-meta); color: var(--ga-ink-2);
    padding: 2px 0 4px; line-height: 1.4;
  }
</style>
