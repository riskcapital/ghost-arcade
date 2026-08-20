<script lang="ts">
  import { onMount } from 'svelte';
  import { project, selectedLayer, layers } from '../stores/layers';
  import { linesStore } from '../stores/lines';
  import { t } from '../i18n';
  import { generateUUID } from '../types';
  import type {
    LinesContent,
    LineElement,
    LineStroke,
    LineStrokeType,
    LineDrawAnimation,
    LineToolMode,
    LineLoopMode,
  } from '../lines/types';

  // Dual-mode props: no props = mapping mode, with props = VJ mode
  export let content: LinesContent | undefined = undefined;
  export let onUpdate: ((updates: Partial<LinesContent>) => void) | undefined = undefined;
  export let compact: boolean = false;

  // Tab state
  let activeTab: 'tools' | 'stroke' | 'animation' | 'settings' = 'tools';

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
    { type: 'solid', label: 'creative.lines.stroke.types.solid' },
    { type: 'dashed', label: 'creative.lines.stroke.types.dashed' },
    { type: 'dotted', label: 'creative.lines.stroke.types.dotted' },
    { type: 'glow', label: 'creative.lines.stroke.types.glow' },
    { type: 'neon', label: 'creative.lines.stroke.types.neon' },
    { type: 'electric', label: 'creative.lines.stroke.types.electric' },
    { type: 'fire', label: 'creative.lines.stroke.types.fire' },
    { type: 'snake', label: 'creative.lines.stroke.types.snake' },
    { type: 'multiTail', label: 'creative.lines.stroke.types.multiTail' },
    { type: 'pulse', label: 'creative.lines.stroke.types.pulse' },
    { type: 'scanner', label: 'creative.lines.stroke.types.scanner' },
    { type: 'rainbow', label: 'creative.lines.stroke.types.rainbow' },
    { type: 'laser', label: 'creative.lines.stroke.types.laser' },
    { type: 'pipe', label: 'creative.lines.stroke.types.pipe' },
  ];

  // === Reactive derivations ===
  $: layer = $selectedLayer;
  $: layerId = layer?.id ?? null;
  $: lc = content ?? (layer?.type === 'lines' ? layer.linesContent : null);
  $: elements = lc?.elements ?? [];
  $: selectedElementId = lc?.selectedElementId ?? null;
  $: selectedEl = elements.find((e) => e.id === selectedElementId) ?? null;
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
      project.updateLayer(layerId, { linesContent: { ...lc, ...updates } });
    }
  }

  function updateElements(updatedElements: LineElement[]) {
    updateContent({ elements: updatedElements });
  }

  function updateSelectedElement(updates: Partial<LineElement>) {
    if (!selectedEl || !lc) return;
    const updated = elements.map((e) => (e.id === selectedEl!.id ? { ...e, ...updates } : e));
    updateElements(updated);
  }

  function updateSelectedStroke(stroke: LineStroke) {
    updateSelectedElement({ stroke });
  }

  function updateStrokeProp(key: string, value: unknown) {
    if (!selectedEl) return;
    updateSelectedStroke({ ...selectedEl.stroke, [key]: value } as LineStroke);
  }

  function updateSelectedDrawAnimation(updates: Partial<LineDrawAnimation>) {
    if (!selectedEl) return;
    updateSelectedElement({ drawAnimation: { ...selectedEl.drawAnimation, ...updates } });
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
        stroke = { type: 'dashed', color: currentColor, width: currentWidth, dashLength: 0.3, gapLength: 0.2, animated: true, animationSpeed: 1,
        };
        break;
      case 'dotted':
        stroke = { type: 'dotted', color: currentColor, width: currentWidth, dotSize: 0.1, spacing: 0.15, animated: false, animationSpeed: 1,
        };
        break;
      case 'glow':
        stroke = { type: 'glow', color: currentColor, width: currentWidth, glowSize: 15, glowIntensity: 1, pulseSpeed: 0,
        };
        break;
      case 'neon':
        stroke = { type: 'neon', color: currentColor, width: currentWidth, glowSize: 20, flickerSpeed: 0.5, flickerIntensity: 0.3,
        };
        break;
      case 'electric':
        stroke = { type: 'electric', color: currentColor, width: currentWidth, arcIntensity: 1, speed: 1, branches: 3 };
        break;
      case 'fire':
        stroke = { type: 'fire', color: [1, 0.4, 0, 1], width: currentWidth, intensity: 1, speed: 1 };
        break;
      case 'snake':
        stroke = { type: 'snake', color: currentColor, width: currentWidth, length: 0.5, speed: 1, tailFade: true, headGlow: true, bidirectional: false, snakeCount: 1,
        };
        break;
      case 'multiTail':
        stroke = { type: 'multiTail', color: currentColor, width: currentWidth, tailCount: 3, tailLength: 0.3, spacing: 0.2, speed: 1, tailFade: true, headGlow: true, colorShift: false, colorShiftAmount: 0.1,
        };
        break;
      case 'pulse':
        stroke = { type: 'pulse', color: currentColor, width: currentWidth, pulseCount: 5, speed: 1, fadeLength: 0.2, direction: 'forward',
        };
        break;
      case 'scanner':
        stroke = { type: 'scanner', color: currentColor, width: currentWidth, beamWidth: 0.1, speed: 1, trail: 0.3 };
        break;
      case 'rainbow':
        stroke = { type: 'rainbow', width: currentWidth, saturation: 1, brightness: 1, speed: 0.5, segments: 6 };
        break;
      case 'laser':
        stroke = { type: 'laser', color: currentColor, width: currentWidth, intensity: 1.5, scatter: 0.3, flicker: 0.1,
        };
        break;
      case 'pipe':
        stroke = { type: 'pipe', color: currentColor, width: currentWidth, depth: 0.5, edgeLight: 1, edgeLightColor: [1, 1, 1, 0.5], specular: 0.5, roughness: 0.3,
        };
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
      name: `${el.name} ${$t('creative.lines.copySuffix')}`,
      position: { x: el.position.x + 0.05, y: el.position.y + 0.05 },
      zIndex: elements.length,
    };
    updateContent({ elements: [...elements, newEl], selectedElementId: newEl.id });
  }

  function toggleElementVisibility(elementId: string) {
    const updated = elements.map((e) => (e.id === elementId ? { ...e, visible: !e.visible } : e));
    updateElements(updated);
  }

  function toggleElementLock(elementId: string) {
    const updated = elements.map((e) => (e.id === elementId ? { ...e, locked: !e.locked } : e));
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
      label: l.source.name || l.name || $t('creative.lines.unnamed'),
      type: l.source.type || 'unknown',
      layerName: l.name,
    }));

  // === Element list collapsed state ===
  let elementsCollapsed = false;
</script>

{#if lc}
  <div class="lines-panel" class:compact>
    <!-- Header -->
    <div class="lp-header">
      <span class="lp-title">{$t('creative.lines.title')}</span>
      <span class="el-badge">{elements.length}</span>
    </div>

    <!-- Compact elements list — always visible -->
    {#if elements.length > 0}
      <div class="elements-strip">
        <button class="strip-toggle" onclick={() => (elementsCollapsed = !elementsCollapsed)}>
          {elementsCollapsed ? '▶' : '▼'}
          {$t('creative.lines.elementsToggle', { values: { count: elements.length} })}
        </button>
        {#if !elementsCollapsed}
          <div class="elements-strip-list">
            {#each elements as el}
              <div
                class="strip-el"
                class:selected={selectedElementId === el.id}
                onclick={() => selectElement(el.id)}
                title={$t('creative.lines.elementTitle', { values: { name: el.name, type: el.stroke.type } })}
                role="button"
                tabindex="0"
              >
                <span class="strip-name">{el.name}</span>
                <span class="strip-type">{el.stroke.type}</span>
                <button class="strip-del" title={$t('creative.lines.actions.delete')}
                  onclick={(e) => { e.stopPropagation(); removeElement(el.id); }}>✕</button>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    <!-- Tabs -->
    <div class="lp-tabs">
      <button class:active={activeTab === 'tools'} onclick={() => (activeTab = 'tools')}>{$t('creative.lines.tabs.draw')}</button>
      <button class:active={activeTab === 'stroke'} onclick={() => (activeTab = 'stroke')}>{$t('creative.lines.tabs.stroke')}</button>
      <button class:active={activeTab === 'animation'} onclick={() => (activeTab = 'animation')}>{$t('creative.lines.tabs.animation')}</button>
      <button class:active={activeTab === 'settings'} onclick={() => (activeTab = 'settings')}>{$t('creative.lines.tabs.settings')}</button>
    </div>

    <!-- Content -->
    <div class="lp-content">
      <!-- ============ TAB 1: DRAW TOOLS ============ -->
      {#if activeTab === 'tools'}
        <div class="sec-label">{$t('creative.lines.toolMode')}</div>
        <div class="tool-grid">
          <button class="tool-btn" class:active={toolMode === 'select'} onclick={() => setToolMode('select')}>
            <span class="tool-icon">&#10022;</span>
            <span class="tool-label">{$t('creative.lines.tools.select')}</span>
          </button>
          <button class="tool-btn" class:active={toolMode === 'freehand'} onclick={() => setToolMode('freehand')}>
            <span class="tool-icon">&#9998;</span>
            <span class="tool-label">{$t('creative.lines.tools.freehand')}</span>
          </button>
          <button class="tool-btn" class:active={toolMode === 'pointClick'} onclick={() => setToolMode('pointClick')}>
            <span class="tool-icon">&#8889;</span>
            <span class="tool-label">{$t('creative.lines.tools.pointClick')}</span>
          </button>
        </div>

        {#if toolMode === 'freehand'}
          <div class="sec-label">{$t('creative.lines.tools.freehandSettings')}</div>
          <div class="slider-col">
            <div class="sc">
              <label>{$t('creative.lines.tools.smoothing')} <b>0.50</b></label>
              <input type="range" min="0" max="1" step="0.05" value="0.5" />
            </div>
          </div>
          <div class="drawing-hint">{$t('creative.lines.tools.hints.freehand')}</div>
        {/if}

        {#if toolMode === 'pointClick'}
          <div class="sec-label">{$t('creative.lines.tools.pointClickSettings')}</div>
          <div class="slider-col">
            <div class="sc">
              <label>{$t('creative.lines.tools.cornerStyle')}</label>
              <select class="inline-select" value="sharp">
                <option value="sharp">{$t('creative.lines.tools.options.sharp')}</option>
                <option value="rounded">{$t('creative.lines.tools.options.rounded')}</option>
                <option value="chamfer">{$t('creative.lines.tools.options.chamfer')}</option>
              </select>
            </div>
            <div class="sc">
              <label>{$t('creative.lines.tools.cornerRadius')} <b>0</b></label>
              <input type="range" min="0" max="50" step="1" value="0" />
            </div>
          </div>
          <div class="drawing-hint">{$t('creative.lines.tools.hints.pointClick')}</div>
        {/if}

        {#if toolMode === 'select'}
          <div class="drawing-hint">{$t('creative.lines.tools.hints.select')}</div>
        {/if}

      <!-- ============ TAB 2: STROKE EFFECTS ============ -->
      {:else if activeTab === 'stroke'}
        {#if selectedEl}
          <div class="sec-label">{$t('creative.lines.stroke.type')}</div>
          <div class="control-row">
            <span class="control-label">{$t('creative.lines.stroke.labels.type')}</span>
            <select
              value={selectedEl.stroke.type}
              onchange={(e) => changeStrokeType((e.target as HTMLSelectElement).value as LineStrokeType)}
            >
              {#each strokeTypes as st}
                <option value={st.type}>{$t(st.label)}</option>
              {/each}
            </select>
          </div>

          <!-- Color (all types except rainbow) -->
          {#if 'color' in selectedEl.stroke}
            <div class="control-row">
              <span class="control-label">{$t('creative.lines.stroke.labels.color')}</span>
              <input
                type="color"
                value={rgbaToHex(selectedEl.stroke.color)}
                oninput={(e) => {
                  if (!selectedEl) return;
                  const c = hexToRgba((e.target as HTMLInputElement).value, 'color' in selectedEl.stroke ? selectedEl.stroke.color[3] : 1,
                  );
                  updateStrokeProp('color', c);
                }}
              />
              <span class="control-label" style="width:auto">{$t('creative.lines.stroke.labels.alpha')}</span>
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
            <span class="control-label">{$t('creative.lines.stroke.labels.width')}</span>
            <input
              type="range" min="1" max="50" step="0.5"
              value={selectedEl.stroke.width}
              oninput={(e) => updateStrokeProp('width', parseFloat((e.target as HTMLInputElement).value))}
            />
            <span class="control-value">{selectedEl.stroke.width}</span>
          </div>

          <!-- Type-specific controls -->
          {#if selectedEl.stroke.type === 'solid'}
            <div class="sec-label">{$t('creative.lines.stroke.options.solid')}</div>
            <div class="control-row">
              <span class="control-label">{$t('creative.lines.stroke.labels.cap')}</span>
              <select value={selectedEl.stroke.cap} onchange={(e) => updateStrokeProp('cap', (e.target as HTMLSelectElement).value)}>
                <option value="butt">{$t('creative.lines.stroke.cap.butt')}</option>
                <option value="round">{$t('creative.lines.stroke.cap.round')}</option>
                <option value="square">{$t('creative.lines.stroke.cap.square')}</option>
              </select>
            </div>
            <div class="control-row">
              <span class="control-label">{$t('creative.lines.stroke.labels.join')}</span>
              <select value={selectedEl.stroke.join} onchange={(e) => updateStrokeProp('join', (e.target as HTMLSelectElement).value)}>
                <option value="miter">{$t('creative.lines.stroke.join.miter')}</option>
                <option value="round">{$t('creative.lines.stroke.join.round')}</option>
                <option value="bevel">{$t('creative.lines.stroke.join.bevel')}</option>
              </select>
            </div>

          {:else if selectedEl.stroke.type === 'dashed'}
            <div class="sec-label">{$t('creative.lines.stroke.options.dashed')}</div>
            <div class="control-row">
              <span class="control-label">{$t('creative.lines.stroke.labels.dash')}</span>
              <input type="range" min="0.05" max="1" step="0.05" value={selectedEl.stroke.dashLength}
                oninput={(e) => updateStrokeProp('dashLength', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.dashLength.toFixed(2)}</span>
            </div>
            <div class="control-row">
              <span class="control-label">{$t('creative.lines.stroke.labels.gap')}</span>
              <input type="range" min="0.05" max="1" step="0.05" value={selectedEl.stroke.gapLength}
                oninput={(e) => updateStrokeProp('gapLength', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.gapLength.toFixed(2)}</span>
            </div>
            <div class="check-row">
              <label><input type="checkbox" checked={selectedEl.stroke.animated}
                onchange={(e) => updateStrokeProp('animated', (e.target as HTMLInputElement).checked)} />
                {$t('creative.lines.stroke.labels.animated')}</label>
            </div>
            {#if selectedEl.stroke.animated}
              <div class="control-row">
                <span class="control-label">{$t('creative.lines.stroke.labels.speed')}</span>
                <input type="range" min="0.1" max="5" step="0.1" value={selectedEl.stroke.animationSpeed}
                  oninput={(e) => updateStrokeProp('animationSpeed', parseFloat((e.target as HTMLInputElement).value))} />
                <span class="control-value">{selectedEl.stroke.animationSpeed.toFixed(1)}</span>
              </div>
            {/if}

          {:else if selectedEl.stroke.type === 'dotted'}
            <div class="sec-label">{$t('creative.lines.stroke.options.dotted')}</div>
            <div class="control-row">
              <span class="control-label">{$t('creative.lines.stroke.labels.dotSize')}</span>
              <input type="range" min="0.01" max="0.5" step="0.01" value={selectedEl.stroke.dotSize}
                oninput={(e) => updateStrokeProp('dotSize', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.dotSize.toFixed(2)}</span>
            </div>
            <div class="control-row">
              <span class="control-label">{$t('creative.lines.stroke.labels.spacing')}</span>
              <input type="range" min="0.02" max="0.5" step="0.01" value={selectedEl.stroke.spacing}
                oninput={(e) => updateStrokeProp('spacing', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.spacing.toFixed(2)}</span>
            </div>
            <div class="check-row">
              <label><input type="checkbox" checked={selectedEl.stroke.animated}
                onchange={(e) => updateStrokeProp('animated', (e.target as HTMLInputElement).checked)} />
                {$t('creative.lines.stroke.labels.animated')}</label>
            </div>
            {#if selectedEl.stroke.animated}
              <div class="control-row">
                <span class="control-label">{$t('creative.lines.stroke.labels.speed')}</span>
                <input type="range" min="0.1" max="5" step="0.1" value={selectedEl.stroke.animationSpeed}
                  oninput={(e) => updateStrokeProp('animationSpeed', parseFloat((e.target as HTMLInputElement).value))} />
                <span class="control-value">{selectedEl.stroke.animationSpeed.toFixed(1)}</span>
              </div>
            {/if}

          {:else if selectedEl.stroke.type === 'glow'}
            <div class="sec-label">{$t('creative.lines.stroke.options.glow')}</div>
            <div class="control-row">
              <span class="control-label">{$t('creative.lines.stroke.labels.glowSize')}</span>
              <input type="range" min="1" max="100" step="1" value={selectedEl.stroke.glowSize}
                oninput={(e) => updateStrokeProp('glowSize', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.glowSize}</span>
            </div>
            <div class="control-row">
              <span class="control-label">{$t('creative.lines.stroke.labels.intensity')}</span>
              <input type="range" min="0" max="3" step="0.1" value={selectedEl.stroke.glowIntensity}
                oninput={(e) => updateStrokeProp('glowIntensity', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.glowIntensity.toFixed(1)}</span>
            </div>
            <div class="control-row">
              <span class="control-label">{$t('creative.lines.stroke.labels.pulse')}</span>
              <input type="range" min="0" max="10" step="0.1" value={selectedEl.stroke.pulseSpeed}
                oninput={(e) => updateStrokeProp('pulseSpeed', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.pulseSpeed.toFixed(1)}</span>
            </div>

          {:else if selectedEl.stroke.type === 'neon'}
            <div class="sec-label">{$t('creative.lines.stroke.options.neon')}</div>
            <div class="control-row">
              <span class="control-label">{$t('creative.lines.stroke.labels.glowSize')}</span>
              <input type="range" min="1" max="100" step="1" value={selectedEl.stroke.glowSize}
                oninput={(e) => updateStrokeProp('glowSize', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.glowSize}</span>
            </div>
            <div class="control-row">
              <span class="control-label">{$t('creative.lines.stroke.labels.flickerSpd')}</span>
              <input type="range" min="0" max="5" step="0.1" value={selectedEl.stroke.flickerSpeed}
                oninput={(e) => updateStrokeProp('flickerSpeed', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.flickerSpeed.toFixed(1)}</span>
            </div>
            <div class="control-row">
              <span class="control-label">{$t('creative.lines.stroke.labels.flickerInt')}</span>
              <input type="range" min="0" max="1" step="0.05" value={selectedEl.stroke.flickerIntensity}
                oninput={(e) => updateStrokeProp('flickerIntensity', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.flickerIntensity.toFixed(2)}</span>
            </div>

          {:else if selectedEl.stroke.type === 'electric'}
            <div class="sec-label">{$t('creative.lines.stroke.options.electric')}</div>
            <div class="control-row">
              <span class="control-label">{$t('creative.lines.stroke.labels.arc')}</span>
              <input type="range" min="0" max="3" step="0.1" value={selectedEl.stroke.arcIntensity}
                oninput={(e) => updateStrokeProp('arcIntensity', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.arcIntensity.toFixed(1)}</span>
            </div>
            <div class="control-row">
              <span class="control-label">{$t('creative.lines.stroke.labels.speed')}</span>
              <input type="range" min="0.1" max="5" step="0.1" value={selectedEl.stroke.speed}
                oninput={(e) => updateStrokeProp('speed', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.speed.toFixed(1)}</span>
            </div>
            <div class="control-row">
              <span class="control-label">{$t('creative.lines.stroke.labels.branches')}</span>
              <input type="range" min="1" max="10" step="1" value={selectedEl.stroke.branches}
                oninput={(e) => updateStrokeProp('branches', parseInt((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.branches}</span>
            </div>

          {:else if selectedEl.stroke.type === 'fire'}
            <div class="sec-label">{$t('creative.lines.stroke.options.fire')}</div>
            <div class="control-row">
              <span class="control-label">{$t('creative.lines.stroke.labels.intensity')}</span>
              <input type="range" min="0" max="3" step="0.1" value={selectedEl.stroke.intensity}
                oninput={(e) => updateStrokeProp('intensity', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.intensity.toFixed(1)}</span>
            </div>
            <div class="control-row">
              <span class="control-label">{$t('creative.lines.stroke.labels.speed')}</span>
              <input type="range" min="0.1" max="5" step="0.1" value={selectedEl.stroke.speed}
                oninput={(e) => updateStrokeProp('speed', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.speed.toFixed(1)}</span>
            </div>

          {:else if selectedEl.stroke.type === 'snake'}
            <div class="sec-label">{$t('creative.lines.stroke.options.snake')}</div>
            <div class="control-row">
              <span class="control-label">{$t('creative.lines.stroke.labels.length')}</span>
              <input type="range" min="0.01" max="2" step="0.01" value={selectedEl.stroke.length}
                oninput={(e) => updateStrokeProp('length', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.length.toFixed(2)}</span>
            </div>
            <div class="control-row">
              <span class="control-label">{$t('creative.lines.stroke.labels.speed')}</span>
              <input type="range" min="0.1" max="5" step="0.1" value={selectedEl.stroke.speed}
                oninput={(e) => updateStrokeProp('speed', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.speed.toFixed(1)}</span>
            </div>
            <div class="control-row">
              <span class="control-label">{$t('creative.lines.stroke.labels.count')}</span>
              <input type="range" min="1" max="8" step="1" value={selectedEl.stroke.snakeCount}
                oninput={(e) => updateStrokeProp('snakeCount', parseInt((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.snakeCount}</span>
            </div>
            <div class="check-row">
              <label><input type="checkbox" checked={selectedEl.stroke.tailFade}
                onchange={(e) => updateStrokeProp('tailFade', (e.target as HTMLInputElement).checked)} />
                {$t('creative.lines.stroke.labels.tailFade')}</label>
              <label><input type="checkbox" checked={selectedEl.stroke.headGlow}
                onchange={(e) => updateStrokeProp('headGlow', (e.target as HTMLInputElement).checked)} />
                {$t('creative.lines.stroke.labels.headGlow')}</label>
              <label><input type="checkbox" checked={selectedEl.stroke.bidirectional}
                onchange={(e) => updateStrokeProp('bidirectional', (e.target as HTMLInputElement).checked)} />
                {$t('creative.lines.stroke.labels.bidir')}</label>
            </div>

          {:else if selectedEl.stroke.type === 'multiTail'}
            <div class="sec-label">{$t('creative.lines.stroke.options.multiTail')}</div>
            <div class="control-row">
              <span class="control-label">{$t('creative.lines.stroke.labels.tails')}</span>
              <input type="range" min="2" max="12" step="1" value={selectedEl.stroke.tailCount}
                oninput={(e) => updateStrokeProp('tailCount', parseInt((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.tailCount}</span>
            </div>
            <div class="control-row">
              <span class="control-label">{$t('creative.lines.stroke.labels.tailLen')}</span>
              <input type="range" min="0" max="1" step="0.05" value={selectedEl.stroke.tailLength}
                oninput={(e) => updateStrokeProp('tailLength', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.tailLength.toFixed(2)}</span>
            </div>
            <div class="control-row">
              <span class="control-label">{$t('creative.lines.stroke.labels.spacing')}</span>
              <input type="range" min="0" max="1" step="0.05" value={selectedEl.stroke.spacing}
                oninput={(e) => updateStrokeProp('spacing', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.spacing.toFixed(2)}</span>
            </div>
            <div class="control-row">
              <span class="control-label">{$t('creative.lines.stroke.labels.speed')}</span>
              <input type="range" min="0.1" max="5" step="0.1" value={selectedEl.stroke.speed}
                oninput={(e) => updateStrokeProp('speed', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.speed.toFixed(1)}</span>
            </div>
            <div class="check-row">
              <label><input type="checkbox" checked={selectedEl.stroke.tailFade}
                onchange={(e) => updateStrokeProp('tailFade', (e.target as HTMLInputElement).checked)} />
                {$t('creative.lines.stroke.labels.tailFade')}</label>
              <label><input type="checkbox" checked={selectedEl.stroke.headGlow}
                onchange={(e) => updateStrokeProp('headGlow', (e.target as HTMLInputElement).checked)} />
                {$t('creative.lines.stroke.labels.headGlow')}</label>
            </div>
            <div class="check-row">
              <label><input type="checkbox" checked={selectedEl.stroke.colorShift}
                onchange={(e) => updateStrokeProp('colorShift', (e.target as HTMLInputElement).checked)} />
                {$t('creative.lines.stroke.labels.colorShift')}</label>
            </div>
            {#if selectedEl.stroke.colorShift}
              <div class="control-row">
                <span class="control-label">{$t('creative.lines.stroke.labels.shiftAmt')}</span>
                <input type="range" min="0" max="1" step="0.05" value={selectedEl.stroke.colorShiftAmount}
                  oninput={(e) => updateStrokeProp('colorShiftAmount', parseFloat((e.target as HTMLInputElement).value))} />
                <span class="control-value">{selectedEl.stroke.colorShiftAmount.toFixed(2)}</span>
              </div>
            {/if}

          {:else if selectedEl.stroke.type === 'pulse'}
            <div class="sec-label">{$t('creative.lines.stroke.options.pulse')}</div>
            <div class="control-row">
              <span class="control-label">{$t('creative.lines.stroke.labels.pulses')}</span>
              <input type="range" min="1" max="20" step="1" value={selectedEl.stroke.pulseCount}
                oninput={(e) => updateStrokeProp('pulseCount', parseInt((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.pulseCount}</span>
            </div>
            <div class="control-row">
              <span class="control-label">{$t('creative.lines.stroke.labels.speed')}</span>
              <input type="range" min="0.1" max="5" step="0.1" value={selectedEl.stroke.speed}
                oninput={(e) => updateStrokeProp('speed', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.speed.toFixed(1)}</span>
            </div>
            <div class="control-row">
              <span class="control-label">{$t('creative.lines.stroke.labels.fadeLen')}</span>
              <input type="range" min="0" max="1" step="0.05" value={selectedEl.stroke.fadeLength}
                oninput={(e) => updateStrokeProp('fadeLength', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.fadeLength.toFixed(2)}</span>
            </div>
            <div class="control-row">
              <span class="control-label">{$t('creative.lines.stroke.labels.direction')}</span>
              <select value={selectedEl.stroke.direction}
                onchange={(e) => updateStrokeProp('direction', (e.target as HTMLSelectElement).value)}>
                <option value="forward">{$t('creative.lines.stroke.direction.forward')}</option>
                <option value="backward">{$t('creative.lines.stroke.direction.backward')}</option>
                <option value="both">{$t('creative.lines.stroke.direction.both')}</option>
              </select>
            </div>

          {:else if selectedEl.stroke.type === 'scanner'}
            <div class="sec-label">{$t('creative.lines.stroke.options.scanner')}</div>
            <div class="control-row">
              <span class="control-label">{$t('creative.lines.stroke.labels.beamW')}</span>
              <input type="range" min="0" max="1" step="0.05" value={selectedEl.stroke.beamWidth}
                oninput={(e) => updateStrokeProp('beamWidth', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.beamWidth.toFixed(2)}</span>
            </div>
            <div class="control-row">
              <span class="control-label">{$t('creative.lines.stroke.labels.speed')}</span>
              <input type="range" min="0.1" max="5" step="0.1" value={selectedEl.stroke.speed}
                oninput={(e) => updateStrokeProp('speed', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.speed.toFixed(1)}</span>
            </div>
            <div class="control-row">
              <span class="control-label">{$t('creative.lines.stroke.labels.trail')}</span>
              <input type="range" min="0" max="1" step="0.05" value={selectedEl.stroke.trail}
                oninput={(e) => updateStrokeProp('trail', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.trail.toFixed(2)}</span>
            </div>

          {:else if selectedEl.stroke.type === 'rainbow'}
            <div class="sec-label">{$t('creative.lines.stroke.options.rainbow')}</div>
            <div class="control-row">
              <span class="control-label">{$t('creative.lines.stroke.labels.saturation')}</span>
              <input type="range" min="0" max="1" step="0.05" value={selectedEl.stroke.saturation}
                oninput={(e) => updateStrokeProp('saturation', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.saturation.toFixed(2)}</span>
            </div>
            <div class="control-row">
              <span class="control-label">{$t('creative.lines.stroke.labels.brightness')}</span>
              <input type="range" min="0" max="1" step="0.05" value={selectedEl.stroke.brightness}
                oninput={(e) => updateStrokeProp('brightness', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.brightness.toFixed(2)}</span>
            </div>
            <div class="control-row">
              <span class="control-label">{$t('creative.lines.stroke.labels.speed')}</span>
              <input type="range" min="0.1" max="5" step="0.1" value={selectedEl.stroke.speed}
                oninput={(e) => updateStrokeProp('speed', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.speed.toFixed(1)}</span>
            </div>
            <div class="control-row">
              <span class="control-label">{$t('creative.lines.stroke.labels.segments')}</span>
              <input type="range" min="1" max="20" step="1" value={selectedEl.stroke.segments}
                oninput={(e) => updateStrokeProp('segments', parseInt((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.segments}</span>
            </div>

          {:else if selectedEl.stroke.type === 'laser'}
            <div class="sec-label">{$t('creative.lines.stroke.options.laser')}</div>
            <div class="control-row">
              <span class="control-label">{$t('creative.lines.stroke.labels.intensity')}</span>
              <input type="range" min="0" max="3" step="0.1" value={selectedEl.stroke.intensity}
                oninput={(e) => updateStrokeProp('intensity', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.intensity.toFixed(1)}</span>
            </div>
            <div class="control-row">
              <span class="control-label">{$t('creative.lines.stroke.labels.scatter')}</span>
              <input type="range" min="0" max="1" step="0.05" value={selectedEl.stroke.scatter}
                oninput={(e) => updateStrokeProp('scatter', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.scatter.toFixed(2)}</span>
            </div>
            <div class="control-row">
              <span class="control-label">{$t('creative.lines.stroke.labels.flicker')}</span>
              <input type="range" min="0" max="1" step="0.05" value={selectedEl.stroke.flicker}
                oninput={(e) => updateStrokeProp('flicker', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.flicker.toFixed(2)}</span>
            </div>

          {:else if selectedEl.stroke.type === 'pipe'}
            <div class="sec-label">{$t('creative.lines.stroke.options.pipe')}</div>
            <div class="control-row">
              <span class="control-label">{$t('creative.lines.stroke.labels.depth')}</span>
              <input type="range" min="0" max="1" step="0.05" value={selectedEl.stroke.depth}
                oninput={(e) => updateStrokeProp('depth', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.depth.toFixed(2)}</span>
            </div>
            <div class="control-row">
              <span class="control-label">{$t('creative.lines.stroke.labels.edgeLight')}</span>
              <input type="range" min="0" max="2" step="0.1" value={selectedEl.stroke.edgeLight}
                oninput={(e) => updateStrokeProp('edgeLight', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.edgeLight.toFixed(1)}</span>
            </div>
            <div class="control-row">
              <span class="control-label">{$t('creative.lines.stroke.labels.edgeColor')}</span>
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
              <span class="control-label">{$t('creative.lines.stroke.labels.specular')}</span>
              <input type="range" min="0" max="1" step="0.05" value={selectedEl.stroke.specular}
                oninput={(e) => updateStrokeProp('specular', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.specular.toFixed(2)}</span>
            </div>
            <div class="control-row">
              <span class="control-label">{$t('creative.lines.stroke.labels.roughness')}</span>
              <input type="range" min="0" max="1" step="0.05" value={selectedEl.stroke.roughness}
                oninput={(e) => updateStrokeProp('roughness', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="control-value">{selectedEl.stroke.roughness.toFixed(2)}</span>
            </div>

          {/if}

          <!-- Apply stroke to all lines -->
          {#if elements.length > 1}
            <button class="apply-all-btn" onclick={applyStrokeToAll}>
              {$t('creative.lines.stroke.applyAll')}
            </button>
          {/if}

          <!-- Compositing -->
          <div class="sec-label">{$t('creative.lines.stroke.labels.compositing')}</div>
          <div class="control-row">
            <span class="control-label">{$t('creative.lines.stroke.labels.blend')}</span>
            <select value={selectedEl.blendMode}
              onchange={(e) => updateSelectedElement({ blendMode: (e.target as HTMLSelectElement).value as LineElement['blendMode'] })}>
              <option value="normal">{$t('creative.lines.stroke.blend.normal')}</option>
              <option value="add">{$t('creative.lines.stroke.blend.add')}</option>
              <option value="multiply">{$t('creative.lines.stroke.blend.multiply')}</option>
              <option value="screen">{$t('creative.lines.stroke.blend.screen')}</option>
            </select>
          </div>
          <div class="control-row">
            <span class="control-label">{$t('creative.lines.stroke.labels.opacity')}</span>
            <input type="range" min="0" max="1" step="0.05" value={selectedEl.opacity}
              oninput={(e) => updateSelectedElement({ opacity: parseFloat((e.target as HTMLInputElement).value) })} />
            <span class="control-value">{(selectedEl.opacity * 100).toFixed(0)}%</span>
          </div>
        {:else}
          <div class="empty-msg">{$t('creative.lines.stroke.empty')}</div>
        {/if}

      <!-- ============ TAB 3: ANIMATION ============ -->
      {:else if activeTab === 'animation'}
        <!-- Animation status -->
        {@const animatedCount = elements.filter((e) => e.drawAnimation.enabled).length}
        <div class="anim-status">{$t('creative.lines.animation.status', { values: { animated: animatedCount, total: elements.length} })}
        </div>

        {#if selectedEl}
          <div class="sec-label">{$t('creative.lines.animation.title')}</div>
          <div class="check-row">
            <label><input type="checkbox" checked={selectedEl.drawAnimation.enabled}
              onchange={(e) => updateSelectedDrawAnimation({ enabled: (e.target as HTMLInputElement).checked })} />
              {$t('creative.lines.animation.enabled')}</label>
          </div>

          {#if selectedEl.drawAnimation.enabled}
            <div class="slider-col">
              <div class="sc">
                <label>{$t('creative.lines.animation.drawSpeed')}
                  <b>{selectedEl.drawAnimation.drawSpeed.toFixed(1)}</b></label>
                <input type="range" min="0.1" max="10" step="0.1" value={selectedEl.drawAnimation.drawSpeed}
                  oninput={(e) => updateSelectedDrawAnimation({ drawSpeed: parseFloat((e.target as HTMLInputElement).value) })} />
              </div>
              <div class="sc">
                <label>{$t('creative.lines.animation.trailLength')}
                  <b>{selectedEl.drawAnimation.trailLength.toFixed(2)}</b></label>
                <input type="range" min="0" max="1" step="0.01" value={selectedEl.drawAnimation.trailLength}
                  oninput={(e) => updateSelectedDrawAnimation({ trailLength: parseFloat((e.target as HTMLInputElement).value) })} />
              </div>
            </div>

            <div class="control-row">
              <span class="control-label">{$t('creative.lines.animation.loop')}</span>
              <select value={selectedEl.drawAnimation.loopMode}
                onchange={(e) => updateSelectedDrawAnimation({ loopMode: (e.target as HTMLSelectElement).value as LineLoopMode })}>
                <option value="once">{$t('creative.lines.animation.loopOptions.once')}</option>
                <option value="loop">{$t('creative.lines.animation.loopOptions.loop')}</option>
                <option value="pingpong">{$t('creative.lines.animation.loopOptions.pingpong')}</option>
                <option value="continuous">{$t('creative.lines.animation.loopOptions.continuous')}</option>
              </select>
            </div>

            <div class="check-row">
              <label><input type="checkbox" checked={selectedEl.drawAnimation.reverse}
                onchange={(e) => updateSelectedDrawAnimation({ reverse: (e.target as HTMLInputElement).checked })} />
                {$t('creative.lines.animation.reverse')}</label>
            </div>

            <div class="control-row">
              <span class="control-label">{$t('creative.lines.animation.easing')}</span>
              <select value={selectedEl.drawAnimation.easing}
                onchange={(e) => updateSelectedDrawAnimation({ easing: (e.target as HTMLSelectElement).value as LineDrawAnimation['easing'],
                  })}>
                <option value="linear">{$t('creative.lines.animation.easingOptions.linear')}</option>
                <option value="easeIn">{$t('creative.lines.animation.easingOptions.easeIn')}</option>
                <option value="easeOut">{$t('creative.lines.animation.easingOptions.easeOut')}</option>
                <option value="easeInOut">{$t('creative.lines.animation.easingOptions.easeInOut')}</option>
              </select>
            </div>

            <!-- Apply animation to all lines -->
            {#if elements.length > 1}
              <button class="apply-all-btn" onclick={applyAnimationToAll}>
                {$t('creative.lines.animation.applyAll')}
              </button>
            {/if}
          {/if}
        {:else}
          <div class="empty-msg">{$t('creative.lines.animation.empty')}</div>
        {/if}

        <!-- Layer-level animation -->
        <div class="sec-label">{$t('creative.lines.animation.layerTitle')}</div>
        <div class="slider-col">
          <div class="sc">
            <label>{$t('creative.lines.animation.globalSpeed')} <b>{lc.globalDrawSpeed.toFixed(1)}x</b></label>
            <input type="range" min="0.1" max="5" step="0.1" value={lc.globalDrawSpeed}
              oninput={(e) => updateContent({ globalDrawSpeed: parseFloat((e.target as HTMLInputElement).value) })} />
          </div>
        </div>

        <div class="control-row">
          <span class="control-label">{$t('creative.lines.animation.stagger')}</span>
          <select value={lc.staggerMode}
            onchange={(e) => updateContent({ staggerMode: (e.target as HTMLSelectElement).value as LinesContent['staggerMode'] })}>
            <option value="simultaneous">{$t('creative.lines.animation.staggerOptions.simultaneous')}</option>
            <option value="sequential">{$t('creative.lines.animation.staggerOptions.sequential')}</option>
            <option value="cascade">{$t('creative.lines.animation.staggerOptions.cascade')}</option>
            <option value="solo">{$t('creative.lines.animation.staggerOptions.solo')}</option>
            <option value="random">{$t('creative.lines.animation.staggerOptions.random')}</option>
            <option value="wave">{$t('creative.lines.animation.staggerOptions.wave')}</option>
          </select>
        </div>

        {#if lc.staggerMode === 'cascade' || lc.staggerMode === 'sequential' || lc.staggerMode === 'solo' || lc.staggerMode === 'random' || lc.staggerMode === 'wave'}
          <div class="slider-col">
            <div class="sc">
              <label>{$t('creative.lines.animation.staggerDelay')} <b>{lc.staggerDelay}ms</b></label>
              <input type="range" min="0" max="2000" step="50" value={lc.staggerDelay}
                oninput={(e) => updateContent({ staggerDelay: parseInt((e.target as HTMLInputElement).value) })} />
            </div>
          </div>
        {/if}

        {#if lc.staggerMode === 'wave'}
          <div class="slider-col">
            <div class="sc">
              <label>{$t('creative.lines.animation.waveWindowSize')} <b>{lc.waveWindowSize ?? 3}</b></label>
              <input type="range" min="1" max="12" step="1" value={lc.waveWindowSize ?? 3}
                oninput={(e) => updateContent({ waveWindowSize: parseInt((e.target as HTMLInputElement).value) })} />
            </div>
          </div>
        {/if}

        <button class="reset-btn" onclick={() => window.dispatchEvent(new CustomEvent('lines-reset-animations'))}>
          {$t('creative.lines.animation.reset')}
        </button>

      <!-- ============ TAB 4: SETTINGS ============ -->
      {:else if activeTab === 'settings'}
        <div class="sec-label">{$t('creative.lines.settings.elements')}</div>
        {#if elements.length === 0}
          <div class="empty-msg">{$t('creative.lines.settings.emptyElements')}</div>
        {:else}
          <div class="elements-list">
            {#each elements as el}
              <div class="element-row" class:selected={selectedElementId === el.id} onclick={() => selectElement(el.id)}>
                <div class="el-info">
                  <span class="el-name">{el.name}</span>
                  <span class="el-meta">{el.shape.type} / {el.stroke.type}</span>
                </div>
                <button class="icon-btn" class:off={!el.visible} title={$t('creative.lines.actions.visibility')}
                  onclick={(e) => { e.stopPropagation(); toggleElementVisibility(el.id); }}>
                  {#if el.visible}&#128065;{:else}&#128064;{/if}
                </button>
                <button class="icon-btn" class:on={el.locked} title={$t('creative.lines.actions.lock')}
                  onclick={(e) => { e.stopPropagation(); toggleElementLock(el.id); }}>
                  {#if el.locked}&#128274;{:else}&#128275;{/if}
                </button>
                <button class="icon-btn" title={$t('creative.lines.actions.duplicate')}
                  onclick={(e) => { e.stopPropagation(); duplicateElement(el.id); }}>&#10697;</button>
                <button class="icon-btn del" title={$t('creative.lines.actions.delete')}
                  onclick={(e) => { e.stopPropagation(); removeElement(el.id); }}>&#10005;</button>
              </div>
            {/each}
          </div>
        {/if}

        <div class="sec-label">{$t('creative.lines.settings.layerSettings')}</div>
        <div class="control-row">
          <span class="control-label">{$t('creative.lines.settings.bgColor')}</span>
          <input type="color"
            value={rgbaToHex(lc.backgroundColor)}
            oninput={(e) => {
              const c = hexToRgba((e.target as HTMLInputElement).value, lc!.backgroundColor[3]);
              updateContent({ backgroundColor: c });
            }} />
          <span class="control-label" style="width:auto">{$t('creative.lines.stroke.labels.alpha')}</span>
          <input type="range" min="0" max="1" step="0.05"
            value={lc.backgroundColor[3]}
            oninput={(e) => {
              const c = lc!.backgroundColor;
              updateContent({ backgroundColor: [c[0], c[1], c[2], parseFloat((e.target as HTMLInputElement).value)] });
            }} />
        </div>

        <div class="slider-col">
          <div class="sc">
            <label>{$t('creative.lines.settings.bloom')} <b>{lc.bloom.toFixed(1)}</b></label>
            <input type="range" min="0" max="3" step="0.1" value={lc.bloom}
              oninput={(e) => updateContent({ bloom: parseFloat((e.target as HTMLInputElement).value) })} />
          </div>
          <div class="sc">
            <label>{$t('creative.lines.settings.afterglow')} <b>{lc.afterglow.toFixed(2)}</b></label>
            <input type="range" min="0" max="1" step="0.01" value={lc.afterglow}
              oninput={(e) => updateContent({ afterglow: parseFloat((e.target as HTMLInputElement).value) })} />
          </div>
        </div>

        <!-- Shared Shader Mask Mode -->
        <div class="sec-label">{$t('creative.lines.settings.shaderMask')}</div>
        <div class="control-row">
          <label class="toggle-row">
            <input type="checkbox"
              checked={lc.sharedShaderMode ?? false}
              onchange={(e) => updateContent({ sharedShaderMode: (e.target as HTMLInputElement).checked })} />
            <span>{$t('creative.lines.settings.maskWindows')}</span>
          </label>
        </div>
        {#if lc.sharedShaderMode}
          <div class="hint-text" style="margin-bottom: 6px;">
            Lines reveal a shared shader/video underneath — like looking through line-shaped windows.
          </div>
          <div class="control-row">
            <span class="control-label">{$t('creative.lines.settings.sourceLayer')}</span>
            <select class="param-select"
              value={lc.sharedShaderSourceId ?? ''}
              onchange={(e) => updateContent({ sharedShaderSourceId: (e.target as HTMLSelectElement).value })}>
              <option value="">{$t('creative.lines.settings.selectLayer')}</option>
              {#each sharedShaderSources as src}
                <option value={src.id}>{src.layerName} ({src.type})</option>
              {/each}
            </select>
          </div>
          {#if sharedShaderSources.length === 0}
            <div class="hint-text" style="color: #f59e0b;">{$t('creative.lines.settings.addMaskSource')}</div>
          {/if}
        {/if}
      {/if}
    </div>
  </div>
{:else}
  <div class="lines-panel">
    <div class="empty-msg">{$t('creative.lines.settings.noLayer')}</div>
  </div>
{/if}

<style>
  .lines-panel {
    width: 100%;
    background: #141416;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    flex: 1;
    color: var(--text-primary, #eee);
    font-size: 14px;
  }

  .lines-panel.compact {
    font-size: 12px;
  }

  /* Header */
  .lp-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px 8px;
    border-bottom: 1px solid #161618;
  }
  .lp-title { font-size: 14px; font-weight: 700; color: #bb86fc; letter-spacing: 0.5px; }
  .el-badge {
    background: #bb86fc; color: #000; font-size: 10px; font-weight: 700;
    padding: 1px 5px; border-radius: 8px;
  }

  /* Tabs */
  .lp-tabs { display: flex; border-bottom: 1px solid #161618; flex-shrink: 0; }
  .lp-tabs button {
    flex: 1; background: none; border: none; color: #666;
    padding: 7px 4px; font-size: 12px; font-weight: 600; cursor: pointer;
    border-bottom: 2px solid transparent;
  }
  .lp-tabs button:hover { color: var(--text-secondary, #aaa); }
  .lp-tabs button.active { color: #bb86fc; border-bottom-color: #bb86fc; }

  /* Content */
  .lp-content { padding: 8px 12px; overflow-y: auto; flex: 1; }

  /* Section labels */
  .sec-label {
    display: flex; align-items: center; justify-content: space-between;
    font-size: 12px; font-weight: 600; color: var(--text-muted, #888); text-transform: uppercase; letter-spacing: 0.4px;
    margin: 10px 0 6px; padding-bottom: 4px; border-bottom: 1px solid #222;
  }
  .sec-label:first-child { margin-top: 0; }

  /* Tool grid */
  .tool-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; margin-bottom: 8px; }
  .tool-btn {
    display: flex; flex-direction: column; align-items: center; gap: 4px;
    padding: 8px 4px; background: var(--bg-primary, #0d0d10); border: 1px solid #333; color: var(--text-secondary, #aaa);
    border-radius: 6px; cursor: pointer; text-align: center;
    transition: all 0.15s;
  }
  .tool-btn:hover { background: var(--bg-tertiary, #161618); color: var(--text-primary, #eee); border-color: #555; }
  .tool-btn.active { background: rgba(187, 134, 252, 0.1); color: #bb86fc; border-color: #bb86fc; }
  .tool-icon { font-size: 19px; line-height: 1; }
  .tool-label { font-size: 10px; }
  .tool-btn.active .tool-label { color: #bb86fc; }

  /* Drawing hint */
  .drawing-hint {
    padding: 6px 8px; margin: 6px 0;
    font-size: 11px; color: #bb86fc;
    background: rgba(187, 134, 252, 0.06);
    border: 1px solid rgba(187, 134, 252, 0.15);
    border-radius: 4px;
  }

  /* Control rows */
  .control-row {
    display: flex; align-items: center; gap: 8px; margin-bottom: 8px;
  }
  .control-label {
    width: 70px; font-size: 12px; color: var(--text-muted, #888); flex-shrink: 0;
  }
  .control-row input[type='range'] {
    flex: 1; height: 4px; appearance: none; background: #333; border-radius: 2px; outline: none;
  }
  .control-row input[type='range']::-webkit-slider-thumb {
    appearance: none; width: 14px; height: 14px; border-radius: 50%;
    background: #bb86fc; cursor: pointer; border: 2px solid #141416;
  }
  .control-row input[type='color'] {
    width: 40px; height: 24px; border: none; border-radius: 4px; cursor: pointer; padding: 0;
  }
  .control-row select, .inline-select {
    flex: 1; background: #333; color: var(--text-primary, #eee); border: 1px solid #555;
    padding: 4px 8px; border-radius: 4px; font-size: 12px;
  }
  .control-value {
    width: 45px; text-align: right; font-size: 11px; color: #666; flex-shrink: 0;
  }

  /* Full-width slider column */
  .slider-col { display: flex; flex-direction: column; gap: 8px; margin-bottom: 8px; }
  .sc { display: flex; flex-direction: column; }
  .sc label {
    font-size: 12px; color: #bbb; margin-bottom: 4px; display: flex; align-items: baseline;
  }
  .sc label b { color: #bb86fc; font-family: var(--ga-font-mono, 'IBM Plex Mono', ui-monospace, monospace); font-size: 12px; font-weight: 400; margin-left: auto; }
  .sc select {
    background: #333; color: var(--text-primary, #eee); border: 1px solid #555;
    padding: 4px 8px; border-radius: 4px; font-size: 12px;
  }
  .sc input[type='range'] {
    width: 100%; height: 4px; appearance: none; background: #333; border-radius: 2px; outline: none;
  }
  .sc input[type='range']::-webkit-slider-thumb {
    appearance: none; width: 14px; height: 14px; border-radius: 50%;
    background: #bb86fc; cursor: pointer; border: 2px solid #141416;
  }

  /* Check row */
  .check-row { display: flex; gap: 12px; margin-bottom: 8px; flex-wrap: wrap; }
  .check-row label { display: flex; align-items: center; gap: 5px; font-size: 12px; color: #bbb; cursor: pointer; }
  .check-row input[type='checkbox'] { accent-color: #bb86fc; width: 13px; height: 13px; }

  /* Text input */
  .text-input {
    flex: 1; background: #222; color: var(--text-primary, #eee); border: 1px solid #444;
    padding: 4px 8px; border-radius: 4px; font-size: 12px; outline: none;
  }
  .text-input:focus { border-color: #bb86fc; }

  /* Elements list */
  .elements-list { max-height: 260px; overflow-y: auto; margin-bottom: 8px; }
  .element-row {
    display: flex; align-items: center; gap: 6px; padding: 5px 8px;
    border: 1px solid #222; border-radius: 5px; margin-bottom: 4px;
    cursor: pointer; transition: all 0.1s;
  }
  .element-row:hover { background: var(--bg-primary, #0d0d10); border-color: #333; }
  .element-row.selected { background: rgba(187, 134, 252, 0.08); border-color: #bb86fc; }
  .el-info { flex: 1; min-width: 0; }
  .el-name { display: block; font-size: 13px; color: var(--text-primary, #ddd); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .el-meta { display: block; font-size: 11px; color: #666; }

  .icon-btn {
    background: none; border: 1px solid transparent; color: #666;
    font-size: 13px; cursor: pointer; padding: 2px 4px; border-radius: 3px;
    line-height: 1; flex-shrink: 0;
  }
  .icon-btn:hover { color: var(--text-primary, #ddd); background: rgba(255,255,255,0.05); }
  .icon-btn.off { opacity: 0.4; }
  .icon-btn.on { color: #bb86fc; }
  .icon-btn.del:hover { color: #ff5555; background: rgba(255,85,85,0.1); border-color: rgba(255,85,85,0.3); }

  /* Empty state */
  .empty-msg { text-align: center; color: #555; font-size: 13px; padding: 20px; }

  /* Elements strip — always visible above tabs */
  .elements-strip {
    border-bottom: 1px solid #1a1a1e;
    background: var(--bg-primary, #0d0d10);
  }
  .strip-toggle {
    width: 100%;
    background: none; border: none; color: var(--text-muted, #888);
    font-size: 11px; font-weight: 600; text-align: left;
    padding: 5px 12px; cursor: pointer;
    text-transform: uppercase; letter-spacing: 0.3px;
  }
  .strip-toggle:hover { color: #bbb; }
  .elements-strip-list {
    max-height: 120px; overflow-y: auto;
    padding: 0 8px 6px;
    display: flex; flex-direction: column; gap: 2px;
  }
  .strip-el {
    display: flex; align-items: center; gap: 6px;
    padding: 3px 8px; background: #141416;
    border: 1px solid #222; border-radius: 4px;
    cursor: pointer; font-size: 12px; color: #bbb;
    text-align: left;
  }
  .strip-el:hover { background: var(--bg-tertiary, #1a1a1e); border-color: #333; }
  .strip-el.selected { background: rgba(187, 134, 252, 0.08); border-color: #bb86fc; color: var(--text-primary, #eee); }
  .strip-name { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 12px; }
  .strip-type { font-size: 10px; color: #666; flex-shrink: 0; }
  .strip-del {
    background: none; border: none; color: #555; font-size: 11px;
    cursor: pointer; padding: 0 2px; line-height: 1; flex-shrink: 0;
  }
  .strip-del:hover { color: #ff5555; }

  /* Apply to all button */
  .apply-all-btn {
    width: 100%; padding: 6px 12px; margin: 8px 0;
    background: rgba(187, 134, 252, 0.1);
    border: 1px solid rgba(187, 134, 252, 0.25);
    color: #bb86fc; border-radius: 4px;
    font-size: 12px; font-weight: 600; cursor: pointer;
  }
  .apply-all-btn:hover {
    background: rgba(187, 134, 252, 0.2);
    border-color: rgba(187, 134, 252, 0.4);
  }

  /* Reset animations button */
  .reset-btn {
    width: 100%; padding: 5px 12px; margin: 6px 0;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid #333; color: #999;
    border-radius: 4px; font-size: 12px; cursor: pointer;
  }
  .reset-btn:hover { background: rgba(255, 255, 255, 0.08); color: var(--text-primary, #eee); border-color: #555; }

  /* Animation status */
  .anim-status {
    font-size: 11px; color: #bb86fc;
    padding: 4px 0 6px; margin-bottom: 4px;
    border-bottom: 1px solid #222;
    text-align: center; font-weight: 600;
  }

  /* Toggle row */
  .toggle-row {
    display: flex; align-items: center; gap: 8px;
    cursor: pointer; font-size: 13px; color: var(--text-primary, #ccc);
  }
  .toggle-row input[type='checkbox'] {
    accent-color: #bb86fc;
  }

  /* Hint text */
  .hint-text {
    font-size: 11px; color: var(--text-muted, #888);
    padding: 2px 0 4px; line-height: 1.35;
  }
</style>
