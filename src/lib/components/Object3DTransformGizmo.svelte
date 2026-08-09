<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { project, selectedLayer } from '../stores/layers';
  import type { Model3DContent, SplatContent } from '../types';

  export let containerWidth = 1920;
  export let containerHeight = 1080;
  export let zoom = 1;

  type GizmoMode = 'move' | 'rotate' | 'scale';
  type GizmoAxis = 'free' | 'x' | 'y' | 'z';
  type DragState = {
    pointerId: number;
    axis: GizmoAxis;
    startX: number;
    startY: number;
    centerClientX: number;
    centerClientY: number;
    startAngle: number;
    positionX: number;
    positionY: number;
    positionZ: number;
    rotationX: number;
    rotationY: number;
    rotationZ: number;
    scaleUniform: number;
  };

  let mode: GizmoMode = 'move';
  let axis: GizmoAxis = 'free';
  let hoverAxis: GizmoAxis | null = null;
  let drag: DragState | null = null;

  $: layer = $selectedLayer;
  $: content = layer?.type === 'splat' ? layer.splatContent : layer?.type === 'model3d' ? layer.model3dContent : null;
  $: positionScale = Math.max(12, Math.min(containerWidth, containerHeight) * 0.075);
  $: centerX = Math.max(76, containerWidth - 112);
  $: centerY = Math.max(86, containerHeight - 104);
  $: displayScale = Math.max(0.8, Math.min(1.25, zoom || 1));

  function updateTransform(updates: Partial<SplatContent> & Partial<Model3DContent>) {
    if (!layer) return;
    if (layer.type === 'splat') {
      project.updateSplatContent(layer.id, updates as Partial<SplatContent>);
    } else if (layer.type === 'model3d') {
      project.updateModel3DContent(layer.id, updates as Partial<Model3DContent>);
    }
  }

  function selectMode(nextMode: GizmoMode) {
    mode = nextMode;
    axis = nextMode === 'rotate' ? 'y' : 'free';
    hoverAxis = null;
  }

  function setHoverAxis(nextAxis: GizmoAxis | null) {
    if (!drag) hoverAxis = nextAxis;
  }

  function stepRotation(event: MouseEvent, rotationAxis: 'x' | 'y' | 'z', degrees: number) {
    event.preventDefault();
    event.stopPropagation();
    if (!content) return;
    const key = rotationAxis === 'x' ? 'rotationX' : rotationAxis === 'y' ? 'rotationY' : 'rotationZ';
    const current = Number.isFinite(content[key]) ? content[key] : 0;
    updateTransform({ [key]: current + degrees });
    mode = 'rotate';
    axis = rotationAxis;
  }

  function beginDrag(event: PointerEvent, dragAxis: GizmoAxis = axis) {
    if (!layer || !content) return;
    event.preventDefault();
    event.stopPropagation();
    const gizmoElement = (event.currentTarget as HTMLElement).closest('.object-gizmo');
    const gizmoRect = gizmoElement?.getBoundingClientRect();
    const centerClientX = gizmoRect ? gizmoRect.left + gizmoRect.width / 2 : event.clientX;
    const centerClientY = gizmoRect ? gizmoRect.top + gizmoRect.height / 2 : event.clientY;
    drag = {
      pointerId: event.pointerId,
      axis: dragAxis,
      startX: event.clientX,
      startY: event.clientY,
      centerClientX,
      centerClientY,
      startAngle: Math.atan2(event.clientY - centerClientY, event.clientX - centerClientX),
      positionX: content.positionX,
      positionY: content.positionY,
      positionZ: content.positionZ,
      rotationX: content.rotationX,
      rotationY: content.rotationY,
      rotationZ: content.rotationZ,
      scaleUniform: content.scaleUniform,
    };
    window.addEventListener('pointermove', handleDrag, { passive: false });
    window.addEventListener('pointerup', endDrag, { once: true });
    window.addEventListener('pointercancel', endDrag, { once: true });
  }

  function handleDrag(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;

    if (mode === 'move') {
      const unitsPerPixel = 1 / positionScale;
      if (drag.axis === 'x') {
        updateTransform({ positionX: drag.positionX + dx * unitsPerPixel });
      } else if (drag.axis === 'y') {
        updateTransform({ positionY: drag.positionY - dy * unitsPerPixel });
      } else if (drag.axis === 'z') {
        updateTransform({ positionZ: drag.positionZ - dy * unitsPerPixel });
      } else {
        updateTransform({
          positionX: drag.positionX + dx * unitsPerPixel,
          positionY: drag.positionY - dy * unitsPerPixel,
        });
      }
    } else if (mode === 'rotate') {
      if (drag.axis === 'x') {
        updateTransform({ rotationX: drag.rotationX + dy * 0.45 });
      } else if (drag.axis === 'z') {
        const angle = Math.atan2(event.clientY - drag.centerClientY, event.clientX - drag.centerClientX);
        updateTransform({
          rotationZ: drag.rotationZ + ((angle - drag.startAngle) * 180) / Math.PI,
        });
      } else if (drag.axis === 'free') {
        // Native renderer axis calibration: horizontal drag yaws (rotationX
        // slot), vertical drag pitches (rotationY slot) — matches the ring
        // and step-button behavior under the native packers.
        updateTransform({
          rotationX: drag.rotationX + dx * 0.45,
          rotationY: drag.rotationY + dy * 0.45,
        });
      } else {
        updateTransform({ rotationY: drag.rotationY + dx * 0.45 });
      }
    } else {
      const distance = dx - dy;
      updateTransform({
        scaleUniform: Math.max(0.02, Math.min(50, drag.scaleUniform * Math.exp(distance * 0.008))),
      });
    }
  }

  function endDrag(event: PointerEvent) {
    if (drag && event.pointerId !== drag.pointerId) return;
    drag = null;
    window.removeEventListener('pointermove', handleDrag);
    window.removeEventListener('pointerup', endDrag);
    window.removeEventListener('pointercancel', endDrag);
  }

  function frameObject(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (!layer) return;
    const updates = {
      scaleUniform: 1,
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,
      positionX: 0,
      positionY: 0,
      positionZ: 0,
    };
    if (layer.type === 'splat') {
      project.updateSplatContent(layer.id, { ...updates, cameraDistance: 5, cameraOrbitX: 0, cameraOrbitY: 0 });
    } else if (layer.type === 'model3d') {
      project.updateModel3DContent(layer.id, {
        ...updates,
        camera: {
          ...layer.model3dContent!.camera,
          distance: 5,
          orbitX: 0,
          orbitY: 20,
          roll: 0,
          panX: 0,
          panY: 0,
        },
      });
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!layer || !content) return;
    const target = event.target as HTMLElement | null;
    if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;
    const key = event.key.toLowerCase();
    if (key === 'w') selectMode('move');
    else if (key === 'e') selectMode('rotate');
    else if (key === 's') selectMode('scale');
    else if (key === 'x' || key === 'y' || key === 'z') axis = key;
    else if (key === 'f') frameObject(event as unknown as MouseEvent);
    else return;
    event.preventDefault();
  }

  onMount(() => {
    window.addEventListener('keydown', handleKeydown);
  });

  onDestroy(() => {
    window.removeEventListener('keydown', handleKeydown);
    window.removeEventListener('pointermove', handleDrag);
    window.removeEventListener('pointerup', endDrag);
    window.removeEventListener('pointercancel', endDrag);
  });
</script>

{#if layer && content && (layer.type === 'splat' || layer.type === 'model3d')}
  <div
    class="object-gizmo"
    class:dragging={!!drag}
    style="left: {centerX}px; top: {centerY}px; --gizmo-scale: {displayScale};"
    aria-label="3D object transform"
  >
    <div class="mode-strip">
      <button
        class:active={mode === 'move'}
        on:pointerdown|stopPropagation
        on:click|stopPropagation={() => selectMode('move')}
        title="Move object (W)"
        aria-label="Move object"
        ><span class="tool-icon move-icon" aria-hidden="true">✥</span><span>Move</span><kbd>W</kbd></button
      >
      <button
        class:active={mode === 'rotate'}
        on:pointerdown|stopPropagation
        on:click|stopPropagation={() => selectMode('rotate')}
        title="Rotate object (E)"
        aria-label="Rotate object"
        ><span class="tool-icon" aria-hidden="true">↻</span><span>Rotate</span><kbd>E</kbd></button
      >
      <button
        class:active={mode === 'scale'}
        on:pointerdown|stopPropagation
        on:click|stopPropagation={() => selectMode('scale')}
        title="Scale object (S)"
        aria-label="Scale object"
        ><span class="tool-icon" aria-hidden="true">↗</span><span>Scale</span><kbd>S</kbd></button
      >
      <button
        on:pointerdown|stopPropagation
        on:click={frameObject}
        title="Reset object transform (F)"
        aria-label="Reset object transform"
        ><span class="tool-icon" aria-hidden="true">⌖</span><span>Reset</span><kbd>F</kbd></button
      >
    </div>

    {#if mode === 'rotate'}
      <div class="rotation-strip">
        <span class="rotation-hint">Drag a ring, or step:</span>
        <button
          on:pointerdown|stopPropagation
          on:click={(event) => stepRotation(event, 'x', 90)}
          title="Rotate 90° on X"
        >
          X&nbsp;+90°
        </button>
        <button
          on:pointerdown|stopPropagation
          on:click={(event) => stepRotation(event, 'y', 90)}
          title="Rotate 90° on Y"
        >
          Y&nbsp;+90°
        </button>
        <button
          on:pointerdown|stopPropagation
          on:click={(event) => stepRotation(event, 'z', 90)}
          title="Rotate 90° on Z"
        >
          Z&nbsp;+90°
        </button>
        <button
          class="flip-upright"
          on:pointerdown|stopPropagation
          on:click={(event) => stepRotation(event, 'x', 180)}
          title="Flip an upside-down scan 180° on X"
        >
          Flip Upright
        </button>
      </div>
    {/if}

    <div
      class="drag-surface {mode}"
      on:pointerdown={(event) => beginDrag(event, mode === 'rotate' ? 'free' : axis)}
      role="slider"
      tabindex="0"
      aria-valuenow={mode === 'scale' ? content.scaleUniform : 0}
      aria-valuemin={mode === 'scale' ? 0.02 : -50}
      aria-valuemax="50"
      title={mode === 'move'
        ? 'Drag center for X/Y; drag an axis for constrained movement'
        : mode === 'rotate'
          ? 'Drag a colored ring to rotate on that axis'
          : 'Drag to scale uniformly'}
      aria-label="{mode} 3D object on {axis} axis"
    >
      {#if mode === 'move'}
        <span
          class="axis-hit axis-hit-x"
          on:pointerenter={() => setHoverAxis('x')}
          on:pointerleave={() => setHoverAxis(null)}
          on:pointerdown={(event) => beginDrag(event, 'x')}
        ></span>
        <span class="axis axis-x" class:highlighted={hoverAxis === 'x' || drag?.axis === 'x'}></span>
        <span class="axis-tip axis-x-tip" class:highlighted={hoverAxis === 'x' || drag?.axis === 'x'}></span>
        <span
          class="axis-hit axis-hit-y"
          on:pointerenter={() => setHoverAxis('y')}
          on:pointerleave={() => setHoverAxis(null)}
          on:pointerdown={(event) => beginDrag(event, 'y')}
        ></span>
        <span class="axis axis-y" class:highlighted={hoverAxis === 'y' || drag?.axis === 'y'}></span>
        <span class="axis-tip axis-y-tip" class:highlighted={hoverAxis === 'y' || drag?.axis === 'y'}></span>
        <span
          class="axis-hit axis-hit-z"
          on:pointerenter={() => setHoverAxis('z')}
          on:pointerleave={() => setHoverAxis(null)}
          on:pointerdown={(event) => beginDrag(event, 'z')}
        ></span>
        <span class="axis axis-z" class:highlighted={hoverAxis === 'z' || drag?.axis === 'z'}></span>
        <span class="axis-tip axis-z-tip" class:highlighted={hoverAxis === 'z' || drag?.axis === 'z'}></span>
        <span
          class="axis-origin"
          class:highlighted={hoverAxis === 'free' || drag?.axis === 'free'}
          on:pointerenter={() => setHoverAxis('free')}
          on:pointerleave={() => setHoverAxis(null)}
          on:pointerdown={(event) => beginDrag(event, 'free')}
        ></span>
      {:else if mode === 'rotate'}
        <span
          class="rotate-ring rotate-ring-z"
          class:highlighted={hoverAxis === 'z' || drag?.axis === 'z'}
          on:pointerenter={() => setHoverAxis('z')}
          on:pointerleave={() => setHoverAxis(null)}
          on:pointerdown={(event) => beginDrag(event, 'z')}
        ></span>
        <span
          class="rotate-ring rotate-ring-x"
          class:highlighted={hoverAxis === 'x' || drag?.axis === 'x'}
          on:pointerenter={() => setHoverAxis('x')}
          on:pointerleave={() => setHoverAxis(null)}
          on:pointerdown={(event) => beginDrag(event, 'x')}
        ></span>
        <span
          class="rotate-ring rotate-ring-y"
          class:highlighted={hoverAxis === 'y' || drag?.axis === 'y'}
          on:pointerenter={() => setHoverAxis('y')}
          on:pointerleave={() => setHoverAxis(null)}
          on:pointerdown={(event) => beginDrag(event, 'y')}
        ></span>
        <span class="axis-origin"></span>
      {:else}
        <span class="scale-line"></span>
        <span
          class="scale-box"
          class:highlighted={hoverAxis === 'free' || drag?.axis === 'free'}
          on:pointerenter={() => setHoverAxis('free')}
          on:pointerleave={() => setHoverAxis(null)}
          on:pointerdown={(event) => beginDrag(event, 'free')}
        ></span>
        <span class="axis-origin"></span>
      {/if}
    </div>
  </div>
{/if}

<style>
  .object-gizmo {
    --gizmo-scale: 1;
    position: absolute;
    width: 1px;
    height: 1px;
    z-index: 8;
    pointer-events: none;
    transform: translate(-50%, -50%);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }

  .mode-strip {
    position: absolute;
    right: 34px;
    top: -72px;
    display: flex;
    gap: 2px;
    padding: 3px;
    border: 1px solid #374151;
    border-radius: 4px;
    background: rgba(8, 12, 17, 0.94);
    box-shadow: 0 5px 18px rgba(0, 0, 0, 0.45);
    pointer-events: auto;
    z-index: 20;
    white-space: nowrap;
  }

  .mode-strip button {
    min-width: 68px;
    height: 30px;
    padding: 0 7px;
    border: 1px solid transparent;
    border-radius: 2px;
    color: #9ca3af;
    background: transparent;
    font: inherit;
    font-size: 10px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
  }

  .mode-strip button:hover,
  .mode-strip button.active {
    color: #f9fafb;
    border-color: #4b5563;
    background: #1f2937;
  }

  .mode-strip button.active {
    color: #67e8f9;
    border-color: #0891b2;
  }

  .tool-icon {
    width: 13px;
    color: currentColor;
    font-size: 14px;
    line-height: 1;
  }

  .move-icon {
    font-size: 16px;
  }

  kbd {
    color: #6b7280;
    font: inherit;
    font-size: 9px;
  }

  .active kbd {
    color: #22d3ee;
  }

  .rotation-strip {
    position: absolute;
    right: 34px;
    top: -35px;
    z-index: 20;
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 4px 5px;
    border: 1px solid #374151;
    border-radius: 4px;
    background: rgba(8, 12, 17, 0.96);
    box-shadow: 0 5px 18px rgba(0, 0, 0, 0.45);
    pointer-events: auto;
    white-space: nowrap;
  }

  .rotation-hint {
    padding: 0 4px;
    color: #6b7280;
    font-size: 9px;
  }

  .rotation-strip button {
    height: 24px;
    padding: 0 7px;
    border: 1px solid #374151;
    border-radius: 2px;
    color: #d1d5db;
    background: #111827;
    font: inherit;
    font-size: 9px;
    cursor: pointer;
  }

  .rotation-strip button:hover {
    color: #ffffff;
    border-color: #0891b2;
    background: #1f2937;
  }

  .rotation-strip .flip-upright {
    color: #67e8f9;
    border-color: #155e75;
  }

  .drag-surface {
    position: absolute;
    left: -48px;
    top: -48px;
    width: 96px;
    height: 96px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    pointer-events: auto;
    cursor: grab;
    transform: scale(var(--gizmo-scale));
    touch-action: none;
    z-index: 1;
  }

  .dragging .drag-surface {
    cursor: grabbing;
  }

  .axis {
    position: absolute;
    left: 48px;
    top: 46px;
    height: 4px;
    transform-origin: 0 50%;
    border-radius: 2px;
  }

  .axis-hit {
    position: absolute;
    left: 43px;
    top: 39px;
    width: 52px;
    height: 18px;
    z-index: 3;
    cursor: grab;
    transform-origin: 5px 50%;
    pointer-events: auto;
  }

  .axis-hit-y {
    transform: rotate(-90deg);
  }

  .axis-hit-z {
    transform: rotate(42deg);
  }

  .axis-x {
    width: 40px;
    background: #ff5f57;
  }

  .axis-y {
    width: 40px;
    background: #45d483;
    transform: rotate(-90deg);
  }

  .axis-z {
    width: 35px;
    background: #3b82f6;
    transform: rotate(42deg);
  }

  .axis-tip {
    position: absolute;
    width: 0;
    height: 0;
  }

  .axis-x-tip {
    left: 86px;
    top: 42px;
    border-left: 9px solid #ff5f57;
    border-top: 6px solid transparent;
    border-bottom: 6px solid transparent;
  }

  .axis-y-tip {
    left: 42px;
    top: 1px;
    border-bottom: 9px solid #45d483;
    border-left: 6px solid transparent;
    border-right: 6px solid transparent;
  }

  .axis-z-tip {
    left: 72px;
    top: 69px;
    border-left: 9px solid #3b82f6;
    border-top: 6px solid transparent;
    border-bottom: 6px solid transparent;
    transform: rotate(42deg);
  }

  .axis.highlighted {
    background: #fff66b;
    box-shadow: 0 0 9px rgba(255, 246, 107, 0.95);
  }

  .axis-x-tip.highlighted {
    border-left-color: #fff66b;
    filter: drop-shadow(0 0 5px rgba(255, 246, 107, 0.95));
  }

  .axis-y-tip.highlighted {
    border-bottom-color: #fff66b;
    filter: drop-shadow(0 0 5px rgba(255, 246, 107, 0.95));
  }

  .axis-z-tip.highlighted {
    border-left-color: #fff66b;
    filter: drop-shadow(0 0 5px rgba(255, 246, 107, 0.95));
  }

  .axis-origin {
    position: absolute;
    left: 41px;
    top: 41px;
    width: 14px;
    height: 14px;
    border: 2px solid #6ee7f9;
    background: #0b1118;
    box-sizing: border-box;
    z-index: 4;
    pointer-events: auto;
    cursor: move;
  }

  .axis-origin.highlighted {
    border-color: #fff66b;
    box-shadow: 0 0 10px rgba(255, 246, 107, 0.9);
  }

  .rotate-ring {
    position: absolute;
    left: 12px;
    top: 12px;
    width: 72px;
    height: 72px;
    box-sizing: border-box;
    border: 3px solid;
    border-radius: 50%;
    pointer-events: auto;
    cursor: grab;
  }

  .rotate-ring-z {
    border-color: #3b82f6;
    box-shadow: 0 0 7px rgba(59, 130, 246, 0.35);
  }

  .rotate-ring-x {
    border-color: #ff5f57;
    transform: scaleY(0.36);
  }

  .rotate-ring-y {
    border-color: #45d483;
    transform: scaleX(0.36);
  }

  .rotate-ring.highlighted {
    border-color: #fff66b;
    box-shadow: 0 0 11px rgba(255, 246, 107, 0.95);
  }

  .scale-line {
    position: absolute;
    left: 47px;
    top: 47px;
    width: 42px;
    height: 3px;
    background: #38bdf8;
    transform: rotate(-45deg);
    transform-origin: 0 50%;
  }

  .scale-box {
    position: absolute;
    left: 72px;
    top: 10px;
    width: 14px;
    height: 14px;
    border: 3px solid #38bdf8;
    background: #0b1118;
    box-sizing: border-box;
  }

  .scale-box.highlighted {
    border-color: #fff66b;
    box-shadow: 0 0 10px rgba(255, 246, 107, 0.95);
  }
</style>
