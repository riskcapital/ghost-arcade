<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { project } from '../stores/layers';
  import type {
    WLEDColorCalibration,
    WLEDColorSamplingMode,
    WLEDController,
    WLEDMappingConfig,
    WLEDMappingMode,
    WLEDNormalizedPoint,
    WLEDScanAxis,
    WLEDSourceRegion,
    WLEDTestPattern,
    WLEDRange,
  } from '../types';
  import {
    buildWLEDBasePoints,
    createDefaultWLEDMapping,
    resolveWLEDMapping,
    resolveWLEDSourceRegion,
  } from '../wled/mapping';
  import { wledTelemetry } from '../wled/sender';
  import { t } from '../i18n';

  export let controller: WLEDController;
  export let onRemove: () => void = () => {};

  type PanelTab = 'map' | 'color' | 'test';
  const MAPPING_MODE_OPTIONS: Array<{ value: WLEDMappingMode; labelKey: string }> = [
    { value: 'auto-grid', labelKey: 'led.mapping.modes.auto' },
    { value: 'strip', labelKey: 'led.mapping.modes.strip' },
    { value: 'matrix', labelKey: 'led.mapping.modes.matrix' },
    { value: 'custom', labelKey: 'led.mapping.modes.custom' },
  ];
  const TEST_PATTERN_OPTIONS: Array<{ value: WLEDTestPattern; labelKey: string }> = [
    { value: 'off', labelKey: 'led.mapping.testPatterns.content' },
    { value: 'solid', labelKey: 'led.mapping.testPatterns.solid' },
    { value: 'rainbow', labelKey: 'led.mapping.testPatterns.rainbow' },
    { value: 'chase', labelKey: 'led.mapping.testPatterns.chase' },
  ];
  let activeTab: PanelTab = 'map';
  let mapCanvas: HTMLCanvasElement;
  let resizeObserver: ResizeObserver | null = null;
  let drawFrame = 0;
  let selectedPoint = 0;
  let draggingPoint = false;

  $: mapping = {
    ...createDefaultWLEDMapping(),
    ...(controller.mapping ?? {}),
    sourceRegion: resolveWLEDSourceRegion(controller.mapping?.sourceRegion),
  } as WLEDMappingConfig;
  $: calibration = {
    redGain: 1,
    greenGain: 1,
    blueGain: 1,
    saturation: 1,
    blackThreshold: 0,
    smoothing: 0,
    colorMatrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    ...(controller.calibration ?? {}),
  } as Required<WLEDColorCalibration>;
  $: resolved = resolveWLEDMapping(controller.ledCount, mapping, 16 / 9);
  $: matrixRows = Math.ceil(Math.max(1, controller.ledCount) / Math.max(1, mapping.columns ?? 8));
  $: telemetry = $wledTelemetry[controller.id];
  $: if (mapCanvas && controller) scheduleDraw();

  function clamp(value: number, min = 0, max = 1): number {
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(max, value));
  }

  function updateController(fields: Partial<WLEDController>) {
    project.updateWLEDController(controller.id, fields);
  }

  function updateMapping(fields: Partial<WLEDMappingConfig>) {
    const current = {
      ...createDefaultWLEDMapping(),
      ...(controller.mapping ?? {}),
      sourceRegion: resolveWLEDSourceRegion(controller.mapping?.sourceRegion),
    };
    updateController({ mapping: { ...current, ...fields } });
  }

  function updateRegion(fields: Partial<WLEDSourceRegion>) {
    const region = resolveWLEDSourceRegion({
      ...resolveWLEDSourceRegion(controller.mapping?.sourceRegion),
      ...fields,
    });
    updateMapping({ sourceRegion: region });
  }

  function updateCalibration(fields: Partial<WLEDColorCalibration>) {
    updateController({
      calibration: {
        redGain: 1,
        greenGain: 1,
        blueGain: 1,
        saturation: 1,
        blackThreshold: 0,
        smoothing: 0,
        colorMatrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        ...(controller.calibration ?? {}),
        ...fields,
      },
    });
  }

  function addRange() {
    const ranges = controller.ranges ?? [];
    const last = ranges[ranges.length - 1];
    const start = last ? Math.min(controller.ledCount - 1, last.start + last.count) : 0;
    const count = Math.max(1, Math.min(controller.ledCount - start, Math.ceil(controller.ledCount / 2)));
    updateController({
      ranges: [...ranges, {
        id: `wled-range-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        name: `Strip ${ranges.length + 1}`,
        start,
        count,
      },
      ],
    });
  }

  function updateRange(rangeId: string, fields: Partial<WLEDRange>) {
    updateController({
      ranges: (controller.ranges ?? []).map((range) => {
        if (range.id !== rangeId) return range;
        const nextStart = Math.max(0, Math.min(controller.ledCount - 1, Math.floor(fields.start ?? range.start)));
        const nextCount = Math.max(1, Math.min(controller.ledCount - nextStart, Math.floor(fields.count ?? range.count)),
        );
        return { ...range, ...fields, start: nextStart, count: nextCount, id: range.id };
      }),
    });
  }

  function removeRange(rangeId: string) {
    updateController({ ranges: (controller.ranges ?? []).filter((range) => range.id !== rangeId) });
  }

  function updateMatrixCell(index: number, value: number) {
    const colorMatrix = [...(calibration.colorMatrix ?? [1, 0, 0, 0, 1, 0, 0, 0, 1])];
    colorMatrix[index] = Number.isFinite(value) ? value : index % 4 === 0 ? 1 : 0;
    updateCalibration({ colorMatrix });
  }

  function setMappingMode(mode: WLEDMappingMode) {
    if (mode !== 'custom') {
      updateMapping({ mode });
      return;
    }
    const points = buildWLEDBasePoints(controller.ledCount, mapping, 16 / 9);
    updateMapping({ mode, points });
  }

  function setAxis(axis: WLEDScanAxis) {
    updateMapping({ axis });
  }

  function resetMapping() {
    selectedPoint = 0;
    updateController({ mapping: createDefaultWLEDMapping() });
  }

  function makeCustomFromCurrent() {
    const points = buildWLEDBasePoints(controller.ledCount, mapping, 16 / 9);
    updateMapping({ mode: 'custom', points });
  }

  function rotateCustomPoints() {
    const points = buildWLEDBasePoints(controller.ledCount, mapping, 16 / 9)
      .map((point) => ({ x: 1 - point.y, y: point.x,
    }));
    updateMapping({ mode: 'custom', points });
  }

  function centerCustomPoints() {
    const points = buildWLEDBasePoints(controller.ledCount, { ...mapping, mode: 'auto-grid' }, 16 / 9);
    updateMapping({
      mode: 'custom',
      points,
      reverse: false,
      flipX: false,
      flipY: false,
    });
  }

  function scheduleDraw() {
    cancelAnimationFrame(drawFrame);
    drawFrame = requestAnimationFrame(drawMap);
  }

  function drawMap() {
    if (!mapCanvas) return;
    const rect = mapCanvas.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const cssWidth = Math.max(1, rect.width);
    const cssHeight = Math.max(1, rect.height);
    const pixelWidth = Math.round(cssWidth * dpr);
    const pixelHeight = Math.round(cssHeight * dpr);
    if (mapCanvas.width !== pixelWidth || mapCanvas.height !== pixelHeight) {
      mapCanvas.width = pixelWidth;
      mapCanvas.height = pixelHeight;
    }
    const context = mapCanvas.getContext('2d');
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, cssWidth, cssHeight);

    const gradient = context.createLinearGradient(0, 0, cssWidth, cssHeight);
    gradient.addColorStop(0, '#0f1c24');
    gradient.addColorStop(0.5, '#101116');
    gradient.addColorStop(1, '#251423');
    context.fillStyle = gradient;
    context.fillRect(0, 0, cssWidth, cssHeight);

    context.strokeStyle = 'rgba(255,255,255,0.07)';
    context.lineWidth = 1;
    for (let column = 1; column < 8; column += 1) {
      const x = (cssWidth * column) / 8;
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, cssHeight);
      context.stroke();
    }
    for (let row = 1; row < 4; row += 1) {
      const y = (cssHeight * row) / 4;
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(cssWidth, y);
      context.stroke();
    }

    const region = resolved.sourceRegion;
    context.fillStyle = 'rgba(76,209,255,0.06)';
    context.fillRect(region.x * cssWidth, region.y * cssHeight, region.width * cssWidth, region.height * cssHeight);
    context.strokeStyle = '#4cd1ff';
    context.setLineDash([5, 4]);
    context.strokeRect(
      region.x * cssWidth + 0.5,
      region.y * cssHeight + 0.5,
      region.width * cssWidth - 1,
      region.height * cssHeight - 1,
    );
    context.setLineDash([]);

    if (resolved.points.length > 1) {
      context.strokeStyle = 'rgba(187,134,252,0.48)';
      context.lineWidth = 1.5;
      context.beginPath();
      resolved.points.forEach((point, index) => {
        const x = point.x * cssWidth;
        const y = point.y * cssHeight;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.stroke();
    }

    const pointRadius = resolved.points.length > 160 ? 2 : resolved.points.length > 64 ? 3 : 4;
    resolved.points.forEach((point, index) => {
      const x = point.x * cssWidth;
      const y = point.y * cssHeight;
      context.beginPath();
      context.arc(x, y, index === selectedPoint ? pointRadius + 3 : pointRadius, 0, Math.PI * 2);
      context.fillStyle = index === selectedPoint ? '#fff' : index === 0 ? '#ff8577' : '#bb86fc';
      context.fill();
      if (index === selectedPoint || (resolved.points.length <= 64 && index % 8 === 0)) {
        context.font = '10px ui-monospace, monospace';
        context.fillStyle = index === selectedPoint ? '#fff' : '#9a8ba8';
        context.fillText(String(index + 1), x + 7, y - 6);
      }
    });
  }

  function pointerPosition(event: PointerEvent): { x: number; y: number; width: number; height: number } {
    const rect = mapCanvas.getBoundingClientRect();
    return {
      x: clamp((event.clientX - rect.left) / rect.width),
      y: clamp((event.clientY - rect.top) / rect.height),
      width: rect.width,
      height: rect.height,
    };
  }

  function handleMapPointerDown(event: PointerEvent) {
    const pointer = pointerPosition(event);
    let nearest = -1;
    let nearestDistance = 18;
    resolved.points.forEach((point, index) => {
      const distance = Math.hypot(
        (point.x - pointer.x) * pointer.width,
        (point.y - pointer.y) * pointer.height
      );
      if (distance < nearestDistance) {
        nearest = index;
        nearestDistance = distance;
      }
    });
    if (nearest < 0) return;
    selectedPoint = nearest;
    draggingPoint = mapping.mode === 'custom';
    mapCanvas.setPointerCapture(event.pointerId);
    scheduleDraw();
  }

  function handleMapPointerMove(event: PointerEvent) {
    if (!draggingPoint || mapping.mode !== 'custom') return;
    const pointer = pointerPosition(event);
    const region = resolveWLEDSourceRegion(mapping.sourceRegion);
    let x = clamp((pointer.x - region.x) / region.width);
    let y = clamp((pointer.y - region.y) / region.height);
    if (mapping.flipX) x = 1 - x;
    if (mapping.flipY) y = 1 - y;

    const points = buildWLEDBasePoints(controller.ledCount, mapping, 16 / 9);
    const sourceIndex = mapping.reverse ? points.length - 1 - selectedPoint : selectedPoint;
    points[sourceIndex] = { x, y };
    updateMapping({ points });
  }

  function handleMapPointerUp(event: PointerEvent) {
    draggingPoint = false;
    if (mapCanvas?.hasPointerCapture(event.pointerId)) mapCanvas.releasePointerCapture(event.pointerId);
  }

  onMount(() => {
    resizeObserver = new ResizeObserver(scheduleDraw);
    resizeObserver.observe(mapCanvas);
    scheduleDraw();
  });

  onDestroy(() => {
    resizeObserver?.disconnect();
    cancelAnimationFrame(drawFrame);
  });
</script>

<article class="wled-card">
  <header class="controller-header">
    <label class="power-toggle" title={$t('led.mapping.sendDataTitle')}>
      <input
        type="checkbox"
        checked={controller.enabled}
        onchange={(event) => updateController({ enabled: (event.target as HTMLInputElement).checked })}
      />
      <span></span>
    </label>
    <input
      class="name-input"
      type="text"
      value={controller.name}
      onchange={(event) => updateController({ name: (event.target as HTMLInputElement).value })}
      aria-label={$t('led.mapping.controllerNameAria')}
    />
    <span class:live={controller.enabled} class="controller-state">
      {$t(controller.enabled ? 'led.mapping.live' : 'led.mapping.off')}
    </span>
    <button class="remove-button" onclick={onRemove} title={$t('led.mapping.removeControllerTitle')}>×</button>
  </header>

  <div class="connection-grid">
    <label>
      <span>{$t('led.mapping.ipAddress')}</span>
      <input
        type="text"
        value={controller.ipAddr}
        placeholder={$t('led.mapping.ipPlaceholder')}
        onchange={(event) => updateController({ ipAddr: (event.target as HTMLInputElement).value })}
      />
    </label>
    <label>
      <span>{$t('led.mapping.port')}</span>
      <input
        type="number"
        min="1"
        max="65535"
        value={controller.port}
        onchange={(event) => updateController({ port: Number.parseInt((event.target as HTMLInputElement).value) || 21324 })}
      />
    </label>
    <label>
      <span>{$t('led.mapping.ledCount')}</span>
      <input
        type="number"
        min="1"
        max="490"
        value={controller.ledCount}
        onchange={(event) => updateController({
          ledCount: Math.max(1, Math.min(490, Number.parseInt((event.target as HTMLInputElement).value) || 1)),
        })}
      />
    </label>
  </div>

  <nav class="panel-tabs" aria-label={$t('led.mapping.tabsAria')}>
    <button class:active={activeTab === 'map'} onclick={() => (activeTab = 'map')}>{$t('led.mapping.tabs.map')}</button>
    <button class:active={activeTab === 'color'} onclick={() => (activeTab = 'color')}>{$t('led.mapping.tabs.color')}</button>
    <button class:active={activeTab === 'test'} onclick={() => (activeTab = 'test')}>{$t('led.mapping.tabs.test')}</button>
  </nav>

  {#if activeTab === 'map'}
    <section class="panel-body">
      <div class="mode-row">
        {#each MAPPING_MODE_OPTIONS as option}
          <button
            class:active={mapping.mode === option.value}
            onclick={() => setMappingMode(option.value)}
          >{$t(option.labelKey)}</button>
        {/each}
      </div>

      <div class="map-options">
        {#if mapping.mode === 'strip' || mapping.mode === 'matrix' || mapping.mode === 'auto-grid'}
          <label>
            <span>{$t('led.mapping.scan')}</span>
            <select value={mapping.axis ?? 'horizontal'} onchange={(event) => setAxis((event.target as HTMLSelectElement).value as WLEDScanAxis)}>
              <option value="horizontal">{$t('led.mapping.axis.horizontal')}</option>
              <option value="vertical">{$t('led.mapping.axis.vertical')}</option>
            </select>
          </label>
        {/if}
        {#if mapping.mode === 'matrix'}
          <label>
            <span>{$t('led.mapping.matrix')}</span>
            <div class="matrix-size">
              <input
                type="number"
                min="1"
                max={controller.ledCount}
                value={mapping.columns ?? 8}
                onchange={(event) => updateMapping({
                  columns: Math.max(1, Math.min(controller.ledCount, Number.parseInt((event.target as HTMLInputElement).value) || 1),
                    ),
                })}
              />
              <span>× {matrixRows}</span>
            </div>
          </label>
        {/if}
        <label class="check-option">
          <input type="checkbox" checked={mapping.serpentine ?? false} onchange={(event) => updateMapping({ serpentine: (event.target as HTMLInputElement).checked })} />
          <span>{$t('led.mapping.serpentine')}</span>
        </label>
        <label class="check-option">
          <input type="checkbox" checked={mapping.reverse ?? false} onchange={(event) => updateMapping({ reverse: (event.target as HTMLInputElement).checked })} />
          <span>{$t('led.mapping.reverseOrder')}</span>
        </label>
        <label class="check-option">
          <input type="checkbox" checked={mapping.flipX ?? false} onchange={(event) => updateMapping({ flipX: (event.target as HTMLInputElement).checked })} />
          <span>{$t('led.mapping.flipX')}</span>
        </label>
        <label class="check-option">
          <input type="checkbox" checked={mapping.flipY ?? false} onchange={(event) => updateMapping({ flipY: (event.target as HTMLInputElement).checked })} />
          <span>{$t('led.mapping.flipY')}</span>
        </label>
      </div>

      <canvas
        class:editable={mapping.mode === 'custom'}
        class="map-canvas"
        bind:this={mapCanvas}
        onpointerdown={handleMapPointerDown}
        onpointermove={handleMapPointerMove}
        onpointerup={handleMapPointerUp}
        onpointercancel={handleMapPointerUp}
      ></canvas>
      <div class="map-caption">
        <span>{$t(mapping.mode === 'custom' ? 'led.mapping.captionCustom' : 'led.mapping.captionAutomatic')}</span>
        <span>{$t('led.mapping.pixels', { values: { count: controller.ledCount} })}</span>
      </div>

      <div class="tool-row">
        <button onclick={makeCustomFromCurrent}>{$t('led.mapping.editPoints')}</button>
        {#if mapping.mode === 'custom'}
          <button onclick={rotateCustomPoints}>{$t('led.mapping.rotate')}</button>
          <button onclick={centerCustomPoints}>{$t('led.mapping.generateGrid')}</button>
        {/if}
        <button onclick={resetMapping}>{$t('led.mapping.resetMap')}</button>
      </div>

      <div class="subsection-title">{$t('led.mapping.sourceRegion')}</div>
      <div class="range-grid">
        <label>
          <span>X <b>{Math.round(resolved.sourceRegion.x * 100)}%</b></span>
          <input type="range" min="0" max={1 - resolved.sourceRegion.width} step="0.01" value={resolved.sourceRegion.x} oninput={(event) => updateRegion({ x: Number.parseFloat((event.target as HTMLInputElement).value) })} />
        </label>
        <label>
          <span>Y <b>{Math.round(resolved.sourceRegion.y * 100)}%</b></span>
          <input type="range" min="0" max={1 - resolved.sourceRegion.height} step="0.01" value={resolved.sourceRegion.y} oninput={(event) => updateRegion({ y: Number.parseFloat((event.target as HTMLInputElement).value) })} />
        </label>
        <label>
          <span>{$t('led.mapping.width')} <b>{Math.round(resolved.sourceRegion.width * 100)}%</b></span>
          <input type="range" min="0.01" max={1 - resolved.sourceRegion.x} step="0.01" value={resolved.sourceRegion.width} oninput={(event) => updateRegion({ width: Number.parseFloat((event.target as HTMLInputElement).value) })} />
        </label>
        <label>
          <span>{$t('led.mapping.height')} <b>{Math.round(resolved.sourceRegion.height * 100)}%</b></span>
          <input type="range" min="0.01" max={1 - resolved.sourceRegion.y} step="0.01" value={resolved.sourceRegion.height} oninput={(event) => updateRegion({ height: Number.parseFloat((event.target as HTMLInputElement).value) })} />
        </label>
      </div>

      <label class="wide-range">
        <span>{$t('led.mapping.sampleArea')} <b>{Math.round((mapping.sampleRadius ?? 0.015) * 1000) / 10}%</b></span>
        <input type="range" min="0" max="0.12" step="0.0025" value={mapping.sampleRadius ?? 0.015} oninput={(event) => updateMapping({ sampleRadius: Number.parseFloat((event.target as HTMLInputElement).value) })} />
      </label>

      <div class="subsection-title range-title">
        <span>{$t('led.mapping.physicalRanges')}</span>
        <button onclick={addRange}>{$t('led.mapping.addStrip')}</button>
      </div>
      <p class="section-note">{$t('led.mapping.rangesNote')}</p>
      <div class="physical-ranges">
        {#each controller.ranges ?? [] as range (range.id)}
          <div class="physical-range">
            <input
              class="range-name"
              value={range.name}
              onchange={(event) => updateRange(range.id, { name: (event.target as HTMLInputElement).value })}
              aria-label={$t('led.mapping.rangeNameAria')}
            />
            <label>
              <span>{$t('led.mapping.start')}</span>
              <input type="number" min="0" max={controller.ledCount - 1} value={range.start}
                onchange={(event) => updateRange(range.id, { start: Number.parseInt((event.target as HTMLInputElement).value) || 0 })} />
            </label>
            <label>
              <span>{$t('led.mapping.count')}</span>
              <input type="number" min="1" max={controller.ledCount - range.start} value={range.count}
                onchange={(event) => updateRange(range.id, { count: Number.parseInt((event.target as HTMLInputElement).value) || 1 })} />
            </label>
            <button class="range-remove" onclick={() => removeRange(range.id)} title={$t('led.mapping.removeRangeTitle')}>×</button>
          </div>
        {/each}
        {#if (controller.ranges ?? []).length === 0}
          <div class="empty-ranges">{$t('led.mapping.noRanges')}</div>
        {/if}
      </div>
    </section>
  {:else if activeTab === 'color'}
    <section class="panel-body color-panel">
      <div class="live-color-match">
        <div>
          <span class="color-caption">{$t('led.mapping.sampledContent')}</span>
          <span class="color-swatch" style={`background:${telemetry?.sourceColor ?? '#000000'}`}></span>
          <code>{telemetry?.sourceColor ?? '#000000'}</code>
        </div>
        <span class="color-arrow">→</span>
        <div>
          <span class="color-caption">{$t('led.mapping.sentToLeds')}</span>
          <span class="color-swatch" style={`background:${telemetry?.outputColor ?? '#000000'}`}></span>
          <code>{telemetry?.outputColor ?? '#000000'}</code>
        </div>
      </div>
      <label class="sampling-select">
        <span>{$t('led.mapping.colorSampling')}</span>
        <select
          value={controller.samplingMode ?? 'dominant'}
          onchange={(event) => updateController({ samplingMode: (event.target as HTMLSelectElement).value as WLEDColorSamplingMode })}
        >
          <option value="dominant">{$t('led.mapping.samplingModes.dominant')}</option>
          <option value="highlight">{$t('led.mapping.samplingModes.highlight')}</option>
          <option value="palette">{$t('led.mapping.samplingModes.palette')}</option>
          <option value="luma-hue">{$t('led.mapping.samplingModes.lumaHue')}</option>
          <option value="average">{$t('led.mapping.samplingModes.average')}</option>
          <option value="exact">{$t('led.mapping.samplingModes.exact')}</option>
        </select>
      </label>
      <div class="range-grid">
        <label>
          <span>{$t('led.mapping.brightness')} <b>{Math.round((controller.brightness ?? 1) * 100)}%</b></span>
          <input type="range" min="0" max="1" step="0.01" value={controller.brightness ?? 1} oninput={(event) => updateController({ brightness: Number.parseFloat((event.target as HTMLInputElement).value) })} />
        </label>
        <label>
          <span>{$t('led.mapping.gamma')} <b>{(controller.gamma ?? 1).toFixed(2)}</b></span>
          <input type="range" min="0.5" max="3" step="0.05" value={controller.gamma ?? 1} oninput={(event) => updateController({ gamma: Number.parseFloat((event.target as HTMLInputElement).value) })} />
        </label>
        <label class="red">
          <span>{$t('led.mapping.red')} <b>{calibration.redGain.toFixed(2)}×</b></span>
          <input type="range" min="0" max="2" step="0.01" value={calibration.redGain} oninput={(event) => updateCalibration({ redGain: Number.parseFloat((event.target as HTMLInputElement).value) })} />
        </label>
        <label class="green">
          <span>{$t('led.mapping.green')} <b>{calibration.greenGain.toFixed(2)}×</b></span>
          <input type="range" min="0" max="2" step="0.01" value={calibration.greenGain} oninput={(event) => updateCalibration({ greenGain: Number.parseFloat((event.target as HTMLInputElement).value) })} />
        </label>
        <label class="blue">
          <span>{$t('led.mapping.blue')} <b>{calibration.blueGain.toFixed(2)}×</b></span>
          <input type="range" min="0" max="2" step="0.01" value={calibration.blueGain} oninput={(event) => updateCalibration({ blueGain: Number.parseFloat((event.target as HTMLInputElement).value) })} />
        </label>
        <label>
          <span>{$t('led.mapping.saturation')} <b>{calibration.saturation.toFixed(2)}×</b></span>
          <input type="range" min="0" max="2" step="0.01" value={calibration.saturation} oninput={(event) => updateCalibration({ saturation: Number.parseFloat((event.target as HTMLInputElement).value) })} />
        </label>
        <label>
          <span>{$t('led.mapping.blackThreshold')} <b>{Math.round(calibration.blackThreshold * 100)}%</b></span>
          <input type="range" min="0" max="0.5" step="0.005" value={calibration.blackThreshold} oninput={(event) => updateCalibration({ blackThreshold: Number.parseFloat((event.target as HTMLInputElement).value) })} />
        </label>
        <label>
          <span>{$t('led.mapping.smoothing')} <b>{Math.round(calibration.smoothing * 100)}%</b></span>
          <input type="range" min="0" max="0.95" step="0.01" value={calibration.smoothing} oninput={(event) => updateCalibration({ smoothing: Number.parseFloat((event.target as HTMLInputElement).value) })} />
        </label>
      </div>
      <div class="subsection-title">{$t('led.mapping.colorCorrectionMatrix')}</div>
      <p class="section-note">{$t('led.mapping.colorMatrixNote')}</p>
      <div class="color-matrix">
        {#each calibration.colorMatrix as value, index}
          <input
            type="number"
            min="-2"
            max="2"
            step="0.01"
            {value}
            aria-label={$t('led.mapping.colorMatrixAria', { values: { index: index + 1 } })}
            onchange={(event) => updateMatrixCell(index, Number.parseFloat((event.target as HTMLInputElement).value))}
          />
        {/each}
      </div>
      <div class="tool-row">
        <button onclick={() => {
          updateController({ brightness: 1, gamma: 1 });
          updateCalibration({
            redGain: 1,
            greenGain: 1,
            blueGain: 1,
            saturation: 1,
            blackThreshold: 0,
            smoothing: 0,
            colorMatrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
          });
        }}>{$t('led.mapping.resetColor')}</button>
      </div>
    </section>
  {:else}
    <section class="panel-body test-panel">
      <div class="test-patterns">
        {#each TEST_PATTERN_OPTIONS as option}
          <button
            class:active={(controller.testPattern ?? 'off') === option.value}
            onclick={() => updateController({ testPattern: option.value })}
          >{$t(option.labelKey)}</button>
        {/each}
      </div>
      <label class="test-color">
        <span>{$t('led.mapping.testColor')}</span>
        <input type="color" value={controller.testColor ?? '#ffffff'} oninput={(event) => updateController({ testColor: (event.target as HTMLInputElement).value })} />
      </label>
      <p>
        {$t('led.mapping.testNote')}
      </p>
    </section>
  {/if}
</article>

<style>
  .wled-card {
    background: #111116;
    border: 1px solid #2a2a30;
    border-radius: 6px;
    margin-bottom: 12px;
    overflow: hidden;
  }

  .controller-header {
    display: grid;
    grid-template-columns: 36px minmax(120px, 1fr) auto 32px;
    gap: 8px;
    align-items: center;
    padding: 10px 12px;
    background: #15151b;
    border-bottom: 1px solid #24242a;
  }

  input, select, button {
    font: inherit;
  }

  .name-input,
  .connection-grid input,
  .map-options input[type='number'],
  .map-options select {
    min-width: 0;
    width: 100%;
    box-sizing: border-box;
    border: 1px solid #33333a;
    border-radius: 4px;
    background: #09090c;
    color: #e7e7eb;
    padding: 7px 8px;
  }

  .name-input {
    font-size: 14px;
    font-weight: 700;
  }

  .power-toggle {
    display: grid;
    place-items: center;
    cursor: pointer;
  }

  .power-toggle input {
    position: absolute;
    opacity: 0;
  }

  .power-toggle span {
    width: 26px;
    height: 14px;
    border-radius: 7px;
    background: #3b3b42;
    position: relative;
  }

  .power-toggle span::after {
    content: '';
    position: absolute;
    width: 10px;
    height: 10px;
    left: 2px;
    top: 2px;
    border-radius: 50%;
    background: #aaa;
    transition: transform 120ms, background 120ms;
  }

  .power-toggle input:checked + span {
    background: rgba(76, 209, 255, 0.34);
  }

  .power-toggle input:checked + span::after {
    transform: translateX(12px);
    background: #4cd1ff;
  }

  .controller-state {
    color: #686873;
    font-family: var(--ga-font-mono, ui-monospace, monospace);
    font-size: 10px;
    letter-spacing: 0.08em;
  }

  .controller-state.live {
    color: #4ade80;
  }

  .remove-button {
    width: 28px;
    height: 28px;
    border: 1px solid #33333a;
    border-radius: 4px;
    background: transparent;
    color: #888;
    cursor: pointer;
  }

  .remove-button:hover {
    border-color: #ff6b6b;
    color: #ff6b6b;
  }

  .connection-grid {
    display: grid;
    grid-template-columns: minmax(150px, 1.5fr) minmax(80px, 0.6fr) minmax(90px, 0.7fr);
    gap: 10px;
    padding: 10px 12px;
  }

  .connection-grid label,
  .map-options label {
    display: flex;
    flex-direction: column;
    gap: 5px;
    color: #858590;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .panel-tabs {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    padding: 0 12px;
    border-top: 1px solid #202026;
    border-bottom: 1px solid #202026;
  }

  .panel-tabs button,
  .mode-row button,
  .tool-row button,
  .test-patterns button {
    border: 0;
    background: transparent;
    color: #8c8c96;
    cursor: pointer;
  }

  .panel-tabs button {
    padding: 9px;
    border-bottom: 2px solid transparent;
  }

  .panel-tabs button.active {
    color: #4cd1ff;
    border-bottom-color: #4cd1ff;
  }

  .panel-body {
    padding: 12px;
  }

  .mode-row,
  .test-patterns {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 4px;
    margin-bottom: 10px;
  }

  .mode-row button,
  .test-patterns button,
  .tool-row button {
    padding: 7px 8px;
    border: 1px solid #323239;
    border-radius: 4px;
    background: #141419;
    font-size: 12px;
  }

  .mode-row button.active,
  .test-patterns button.active {
    border-color: #4cd1ff;
    color: #4cd1ff;
    background: rgba(76, 209, 255, 0.08);
  }

  .map-options {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 10px 16px;
    margin-bottom: 10px;
  }

  .map-options label:not(.check-option) {
    min-width: 120px;
  }

  .map-options select {
    min-width: 120px;
  }

  .matrix-size {
    display: flex;
    align-items: center;
    gap: 6px;
    color: #aaa;
    font-size: 12px;
  }

  .matrix-size input {
    width: 64px !important;
  }

  .map-options .check-option {
    flex-direction: row;
    align-items: center;
    gap: 6px;
    padding: 7px 0;
    cursor: pointer;
    text-transform: none;
    letter-spacing: 0;
    font-size: 12px;
    color: #aaa;
  }

  .check-option input {
    accent-color: #4cd1ff;
  }

  .map-canvas {
    display: block;
    width: 100%;
    aspect-ratio: 16 / 7;
    max-height: 260px;
    border: 1px solid #34343b;
    background: #0d0d10;
    cursor: default;
    touch-action: none;
  }

  .map-canvas.editable {
    cursor: crosshair;
  }

  .map-caption {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    color: #6f6f79;
    font-size: 10px;
    padding: 5px 1px 8px;
  }

  .tool-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 12px;
  }

  .tool-row button:hover {
    border-color: #4cd1ff;
    color: #4cd1ff;
  }

  .subsection-title {
    margin: 3px 0 8px;
    color: #777781;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }

  .range-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px 18px;
  }

  .range-grid label,
  .wide-range {
    display: flex;
    flex-direction: column;
    gap: 5px;
    color: #aaa;
    font-size: 11px;
  }

  .range-grid label > span,
  .wide-range > span {
    display: flex;
    justify-content: space-between;
  }

  .range-grid b,
  .wide-range b {
    color: #4cd1ff;
    font-family: var(--ga-font-mono, ui-monospace, monospace);
    font-weight: 500;
  }

  input[type='range'] {
    width: 100%;
    accent-color: #4cd1ff;
  }

  .wide-range {
    margin-top: 12px;
  }

  .range-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 16px;
  }

  .range-title button,
  .range-remove {
    border: 1px solid #34343b;
    background: #141419;
    color: #9b9ba5;
    cursor: pointer;
  }

  .range-title button {
    padding: 5px 8px;
    border-radius: 4px;
    font-size: 10px;
  }

  .section-note,
  .empty-ranges {
    color: #70707a;
    font-size: 10px;
    line-height: 1.45;
  }

  .section-note {
    margin: -3px 0 9px;
  }

  .physical-ranges {
    display: grid;
    gap: 6px;
  }

  .physical-range {
    display: grid;
    grid-template-columns: minmax(90px, 1fr) 74px 74px 28px;
    gap: 6px;
    align-items: end;
  }

  .physical-range label {
    display: grid;
    gap: 3px;
    color: #777781;
    font-size: 9px;
    text-transform: uppercase;
  }

  .physical-range input,
  .sampling-select select,
  .color-matrix input {
    min-width: 0;
    width: 100%;
    box-sizing: border-box;
    border: 1px solid #33333a;
    border-radius: 4px;
    background: #09090c;
    color: #e7e7eb;
    padding: 6px 7px;
  }

  .range-name {
    align-self: end;
  }

  .range-remove {
    width: 28px;
    height: 29px;
    border-radius: 4px;
    color: #ff7777;
  }

  .live-color-match {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    gap: 10px;
    align-items: center;
    padding: 10px;
    margin-bottom: 12px;
    border: 1px solid #2c2c33;
    background: #0d0d11;
  }

  .live-color-match > div {
    display: grid;
    grid-template-columns: 22px 1fr;
    gap: 3px 7px;
    align-items: center;
  }

  .color-caption {
    grid-column: 1 / -1;
    color: #777781;
    font-size: 9px;
    text-transform: uppercase;
  }

  .color-swatch {
    display: block;
    width: 22px;
    height: 22px;
    border: 1px solid #4a4a52;
  }

  .live-color-match code {
    color: #b9b9c2;
    font-size: 10px;
  }

  .color-arrow {
    color: #4cd1ff;
  }

  .sampling-select {
    display: grid;
    gap: 5px;
    margin-bottom: 12px;
    color: #aaa;
    font-size: 11px;
  }

  .color-matrix {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 5px;
    margin-bottom: 12px;
  }

  .color-panel .red input { accent-color: #ff6b6b; }
  .color-panel .green input { accent-color: #4ade80; }
  .color-panel .blue input { accent-color: #60a5fa; }

  .test-color {
    display: flex;
    align-items: center;
    justify-content: space-between;
    color: #aaa;
    font-size: 12px;
    margin-top: 12px;
  }

  .test-color input {
    width: 54px;
    height: 32px;
    border: 1px solid #33333a;
    background: #09090c;
  }

  .test-panel p {
    color: #777781;
    font-size: 11px;
    line-height: 1.45;
    margin: 12px 0 0;
  }

  @media (max-width: 720px) {
    .connection-grid,
    .range-grid {
      grid-template-columns: 1fr;
    }

    .physical-range {
      grid-template-columns: minmax(80px, 1fr) 62px 62px 28px;
    }
  }
</style>
