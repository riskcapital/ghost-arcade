<script lang="ts">
  // Performance Pad - Live Visual Instrument
  // XY touch pad with gesture trails, trigger buttons, and parameter bindings
  // "Like shooting visuals - connect mind to music and make visuals like dancing"

  import { onMount, onDestroy } from 'svelte';
  import { performanceStore } from '../audio/performanceEngine';
  import { vjClipLauncher } from '../stores/vjClipLauncher';
  import { audioStore } from '../stores/audio';
  import { parseISF } from '../isf/parser';
  import type { ISFInput } from '../isf/parser';

  // Canvas for XY pad rendering
  let padCanvas: HTMLCanvasElement;
  let padCtx: CanvasRenderingContext2D | null = null;
  let padContainer: HTMLDivElement;
  let drawFrameId: number | null = null;

  // Cached shader inputs for param binding dropdowns
  let cachedInputs: Map<string, ISFInput[]> = new Map();

  function getLayerShaderInputs(layerIndex: number): ISFInput[] {
    const clip = $vjClipLauncher.layerStates[layerIndex]?.activeClip;
    if (!clip || clip.type !== 'shader' || !clip.shaderCode) return [];
    const key = clip.shaderCode.substring(0, 64);
    if (cachedInputs.has(key)) return cachedInputs.get(key)!;
    try {
      const parsed = parseISF(clip.shaderCode);
      const inputs = parsed.metadata.INPUTS.filter(
        (i: ISFInput) => i.TYPE === 'float' || i.TYPE === 'point2D'
      );
      cachedInputs.set(key, inputs);
      return inputs;
    } catch { return []; }
  }

  // Get all float params across all layers for binding
  function getBindableParams(): { layerIndex: number; name: string; label: string }[] {
    const params: { layerIndex: number; name: string; label: string }[] = [];
    const vjState = $vjClipLauncher;
    for (let i = 0; i < vjState.numLayers; i++) {
      const inputs = getLayerShaderInputs(i);
      for (const inp of inputs) {
        if (inp.TYPE === 'float') {
          params.push({ layerIndex: i, name: inp.NAME, label: `L${i+1}: ${inp.LABEL || inp.NAME}` });
        }
      }
    }
    return params;
  }

  // XY Pad touch/mouse handlers
  function getNormalizedPosition(e: MouseEvent | TouchEvent): { x: number; y: number } | null {
    if (!padCanvas) return null;
    const rect = padCanvas.getBoundingClientRect();
    let clientX: number, clientY: number;
    if ('touches' in e) {
      if (e.touches.length === 0) return null;
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    return { x, y };
  }

  function handlePadDown(e: MouseEvent | TouchEvent) {
    e.preventDefault();
    const pos = getNormalizedPosition(e);
    if (pos) {
      performanceStore.start();
      performanceStore.padPress(pos.x, pos.y);
    }
  }

  function handlePadMove(e: MouseEvent | TouchEvent) {
    e.preventDefault();
    const pos = getNormalizedPosition(e);
    if (pos) {
      performanceStore.padMove(pos.x, pos.y);
    }
  }

  function handlePadUp(e: MouseEvent | TouchEvent) {
    e.preventDefault();
    performanceStore.padRelease();
  }

  // Trigger button handlers
  function handleTriggerDown(triggerId: string) {
    performanceStore.start();
    performanceStore.fireTrigger(triggerId);
  }

  function handleTriggerUp(triggerId: string) {
    performanceStore.releaseTrigger(triggerId);
  }

  // Canvas drawing loop
  function drawPad() {
    if (!padCtx || !padCanvas) {
      drawFrameId = requestAnimationFrame(drawPad);
      return;
    }

    const w = padCanvas.width;
    const h = padCanvas.height;
    const state = $performanceStore;
    const audio = $audioStore;
    const pad = state.xyPad;

    // Clear with slight fade for trail persistence
    padCtx.fillStyle = 'rgba(8, 8, 16, 0.15)';
    padCtx.fillRect(0, 0, w, h);

    // Beat pulse ring (background)
    if (audio.beat?.isBeat || audio.beat?.beatIntensity > 0.1) {
      const bi = audio.beat.beatIntensity;
      const radius = Math.min(w, h) * 0.45 * bi;
      padCtx.strokeStyle = `rgba(103, 232, 249, ${bi * 0.3})`;
      padCtx.lineWidth = 2 + bi * 4;
      padCtx.beginPath();
      padCtx.arc(w / 2, h / 2, radius, 0, Math.PI * 2);
      padCtx.stroke();
    }

    // Grid lines (subtle)
    padCtx.strokeStyle = 'rgba(103, 232, 249, 0.06)';
    padCtx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      padCtx.beginPath();
      padCtx.moveTo(w * i / 4, 0);
      padCtx.lineTo(w * i / 4, h);
      padCtx.stroke();
      padCtx.beginPath();
      padCtx.moveTo(0, h * i / 4);
      padCtx.lineTo(w, h * i / 4);
      padCtx.stroke();
    }

    // Crosshair (center reference)
    padCtx.strokeStyle = 'rgba(103, 232, 249, 0.12)';
    padCtx.lineWidth = 1;
    padCtx.beginPath();
    padCtx.moveTo(w / 2, 0);
    padCtx.lineTo(w / 2, h);
    padCtx.stroke();
    padCtx.beginPath();
    padCtx.moveTo(0, h / 2);
    padCtx.lineTo(w, h / 2);
    padCtx.stroke();

    // Draw trail
    if (pad.trail.length > 1) {
      for (let i = 1; i < pad.trail.length; i++) {
        const p0 = pad.trail[i - 1];
        const p1 = pad.trail[i];
        const alpha = Math.max(0, 1 - p1.age / state.trailLength);
        const thickness = 1 + alpha * 3;

        // Color shifts with audio - hue rotates with beat phase
        const hue = (audio.beatPhase || 0) * 360;
        padCtx.strokeStyle = `hsla(${hue}, 90%, 70%, ${alpha * 0.8})`;
        padCtx.lineWidth = thickness;
        padCtx.beginPath();
        padCtx.moveTo(p0.x * w, p0.y * h);
        padCtx.lineTo(p1.x * w, p1.y * h);
        padCtx.stroke();
      }
    }

    // Draw velocity vector (shows momentum direction)
    if (Math.abs(pad.velocityX) > 0.001 || Math.abs(pad.velocityY) > 0.001) {
      const vLen = Math.sqrt(pad.velocityX ** 2 + pad.velocityY ** 2);
      const vScale = Math.min(vLen * 800, 60);
      const vx = (pad.velocityX / (vLen || 1)) * vScale;
      const vy = (pad.velocityY / (vLen || 1)) * vScale;
      padCtx.strokeStyle = 'rgba(244, 63, 94, 0.6)';
      padCtx.lineWidth = 2;
      padCtx.beginPath();
      padCtx.moveTo(pad.x * w, pad.y * h);
      padCtx.lineTo(pad.x * w + vx, pad.y * h + vy);
      padCtx.stroke();
    }

    // Draw cursor (main position indicator)
    const cx = pad.x * w;
    const cy = pad.y * h;
    const cursorSize = pad.isPressed ? 14 : 8;
    const pulseSize = cursorSize + Math.sin(performance.now() * 0.005) * 3;

    // Outer glow
    const gradient = padCtx.createRadialGradient(cx, cy, 0, cx, cy, pulseSize * 2.5);
    gradient.addColorStop(0, pad.isPressed ? 'rgba(103, 232, 249, 0.4)' : 'rgba(103, 232, 249, 0.15)');
    gradient.addColorStop(1, 'rgba(103, 232, 249, 0)');
    padCtx.fillStyle = gradient;
    padCtx.beginPath();
    padCtx.arc(cx, cy, pulseSize * 2.5, 0, Math.PI * 2);
    padCtx.fill();

    // Inner dot
    padCtx.fillStyle = pad.isPressed ? '#67E8F9' : 'rgba(103, 232, 249, 0.8)';
    padCtx.beginPath();
    padCtx.arc(cx, cy, cursorSize / 2, 0, Math.PI * 2);
    padCtx.fill();

    // Ring
    padCtx.strokeStyle = '#67E8F9';
    padCtx.lineWidth = 1.5;
    padCtx.beginPath();
    padCtx.arc(cx, cy, pulseSize, 0, Math.PI * 2);
    padCtx.stroke();

    // Position readout
    padCtx.fillStyle = 'rgba(103, 232, 249, 0.5)';
    padCtx.font = '9px monospace';
    padCtx.fillText(`${pad.x.toFixed(2)}, ${pad.y.toFixed(2)}`, 4, h - 4);

    // Param binding labels
    if (pad.paramX) {
      padCtx.fillStyle = 'rgba(103, 232, 249, 0.4)';
      padCtx.font = '9px monospace';
      padCtx.textAlign = 'center';
      padCtx.fillText(pad.paramX, w / 2, h - 4);
      padCtx.textAlign = 'start';
    }
    if (pad.paramY) {
      padCtx.save();
      padCtx.fillStyle = 'rgba(103, 232, 249, 0.4)';
      padCtx.font = '9px monospace';
      padCtx.translate(12, h / 2);
      padCtx.rotate(-Math.PI / 2);
      padCtx.textAlign = 'center';
      padCtx.fillText(pad.paramY, 0, 0);
      padCtx.restore();
    }

    drawFrameId = requestAnimationFrame(drawPad);
  }

  // Resize canvas to match container
  function resizeCanvas() {
    if (!padCanvas || !padContainer) return;
    const rect = padContainer.getBoundingClientRect();
    padCanvas.width = rect.width;
    padCanvas.height = rect.height;
  }

  let resizeObserver: ResizeObserver | null = null;

  onMount(() => {
    if (padCanvas) {
      padCtx = padCanvas.getContext('2d');
      resizeCanvas();
      drawPad();
    }
    if (padContainer) {
      resizeObserver = new ResizeObserver(resizeCanvas);
      resizeObserver.observe(padContainer);
    }
  });

  onDestroy(() => {
    if (drawFrameId !== null) cancelAnimationFrame(drawFrameId);
    if (resizeObserver) resizeObserver.disconnect();
    performanceStore.stop();
  });

  // Reactive binding to get available params
  $: bindableParams = getBindableParams();
  $: padState = $performanceStore.xyPad;
  $: triggers = $performanceStore.triggers;
</script>

<div class="perf-pad-container">
  <!-- XY Pad -->
  <div class="xy-pad-wrapper">
    <div class="xy-pad-header">
      <span class="pad-title">PERFORMANCE PAD</span>
      <span class="pad-status" class:active={$performanceStore.isActive}>
        {$performanceStore.isActive ? 'LIVE' : 'READY'}
      </span>
    </div>

    <div class="xy-pad-area" bind:this={padContainer}>
      <canvas
        bind:this={padCanvas}
        class="xy-canvas"
        onmousedown={handlePadDown}
        onmousemove={handlePadMove}
        onmouseup={handlePadUp}
        onmouseleave={handlePadUp}
        ontouchstart={handlePadDown}
        ontouchmove={handlePadMove}
        ontouchend={handlePadUp}
        ontouchcancel={handlePadUp}
      ></canvas>
    </div>

    <!-- Axis Bindings -->
    <div class="axis-bindings">
      <div class="axis-bind">
        <span class="axis-label">X</span>
        <select
          class="axis-select"
          value={padState.paramX || ''}
          onchange={(e) => {
            const val = (e.target as HTMLSelectElement).value;
            performanceStore.bindPadParam('x', val || null);
            if (val) {
              // Also set target layer from the param
              const param = bindableParams.find(p => p.name === val);
              if (param) performanceStore.setPadTargetLayer(param.layerIndex);
            }
          }}
        >
          <option value="">-- none --</option>
          {#each bindableParams as p}
            <option value={p.name}>{p.label}</option>
          {/each}
        </select>
      </div>
      <div class="axis-bind">
        <span class="axis-label">Y</span>
        <select
          class="axis-select"
          value={padState.paramY || ''}
          onchange={(e) => {
            const val = (e.target as HTMLSelectElement).value;
            performanceStore.bindPadParam('y', val || null);
          }}
        >
          <option value="">-- none --</option>
          {#each bindableParams as p}
            <option value={p.name}>{p.label}</option>
          {/each}
        </select>
      </div>
      <div class="momentum-ctrl">
        <span class="axis-label">MOM</span>
        <input
          type="range"
          min="0"
          max="0.99"
          step="0.01"
          value={$performanceStore.momentum}
          oninput={(e) => performanceStore.setMomentum(parseFloat((e.target as HTMLInputElement).value))}
          class="momentum-slider"
        />
      </div>
    </div>
  </div>

  <!-- Trigger Buttons Grid -->
  <div class="triggers-section">
    <div class="triggers-grid">
      {#each triggers as trigger (trigger.id)}
        <button
          class="trigger-btn"
          class:pressed={trigger.isPressed}
          style="
            --trigger-color: {trigger.color};
            --trigger-intensity: {trigger.intensity};
            --trigger-glow: {trigger.color}{Math.round(trigger.intensity * 200).toString(16).padStart(2, '0')};
          "
          onmousedown={() => handleTriggerDown(trigger.id)}
          onmouseup={() => handleTriggerUp(trigger.id)}
          onmouseleave={() => handleTriggerUp(trigger.id)}
          ontouchstart={(e) => { e.preventDefault(); handleTriggerDown(trigger.id); }}
          ontouchend={(e) => { e.preventDefault(); handleTriggerUp(trigger.id); }}
        >
          <span class="trigger-label">{trigger.label}</span>
          <div
            class="trigger-intensity-bar"
            style="width: {trigger.intensity * 100}%"
          ></div>
        </button>
      {/each}
    </div>
  </div>
</div>

<style>
  .perf-pad-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    gap: 6px;
    min-width: 200px;
  }

  .xy-pad-wrapper {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .xy-pad-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 2px 6px;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.1em;
    color: rgba(255, 255, 255, 0.5);
  }

  .pad-title {
    text-transform: uppercase;
  }

  .pad-status {
    font-size: 8px;
    padding: 1px 5px;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.05);
    color: rgba(255, 255, 255, 0.3);
  }

  .pad-status.active {
    background: rgba(187, 134, 252, 0.15);
    color: #BB86FC;
  }

  .xy-pad-area {
    flex: 1;
    border: 1px solid rgba(187, 134, 252, 0.2);
    border-radius: 4px;
    overflow: hidden;
    cursor: crosshair;
    min-height: 100px;
    background: #080810;
    position: relative;
  }

  .xy-canvas {
    display: block;
    width: 100%;
    height: 100%;
    touch-action: none;
  }

  /* Axis bindings */
  .axis-bindings {
    display: flex;
    gap: 4px;
    padding: 3px 0;
    align-items: center;
  }

  .axis-bind {
    display: flex;
    align-items: center;
    gap: 3px;
    flex: 1;
    min-width: 0;
  }

  .axis-label {
    font-size: 8px;
    font-weight: 700;
    color: rgba(187, 134, 252, 0.6);
    min-width: 16px;
    text-align: center;
  }

  .axis-select {
    flex: 1;
    min-width: 0;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    color: var(--text-primary, #ccc);
    font-size: 8px;
    padding: 2px 3px;
    cursor: pointer;
  }

  .axis-select:hover {
    border-color: rgba(187, 134, 252, 0.3);
  }

  .momentum-ctrl {
    display: flex;
    align-items: center;
    gap: 3px;
  }

  .momentum-slider {
    width: 50px;
    height: 12px;
    -webkit-appearance: none;
    appearance: none;
    background: rgba(255, 255, 255, 0.08);
    border-radius: 3px;
    cursor: pointer;
  }

  .momentum-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 8px;
    height: 12px;
    background: #BB86FC;
    border-radius: 2px;
    cursor: pointer;
  }

  /* Trigger Buttons */
  .triggers-section {
    flex-shrink: 0;
  }

  .triggers-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 4px;
  }

  .trigger-btn {
    position: relative;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid color-mix(in srgb, var(--trigger-color) 30%, transparent);
    border-radius: 4px;
    color: var(--trigger-color);
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 0.05em;
    padding: 8px 4px;
    cursor: pointer;
    overflow: hidden;
    transition: transform 0.05s;
    user-select: none;
    -webkit-user-select: none;
    touch-action: manipulation;
    box-shadow: 0 0 calc(var(--trigger-intensity) * 20px) var(--trigger-glow);
  }

  .trigger-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: color-mix(in srgb, var(--trigger-color) 50%, transparent);
  }

  .trigger-btn:active,
  .trigger-btn.pressed {
    transform: scale(0.95);
    background: color-mix(in srgb, var(--trigger-color) 20%, transparent);
    border-color: var(--trigger-color);
    box-shadow: 0 0 20px var(--trigger-glow), inset 0 0 15px color-mix(in srgb, var(--trigger-color) 15%, transparent);
  }

  .trigger-label {
    position: relative;
    z-index: 1;
  }

  .trigger-intensity-bar {
    position: absolute;
    bottom: 0;
    left: 0;
    height: 2px;
    background: var(--trigger-color);
    transition: width 0.05s;
    opacity: 0.7;
  }
</style>
