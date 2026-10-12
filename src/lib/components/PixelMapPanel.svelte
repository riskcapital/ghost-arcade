<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { project } from '../stores/layers';
  import type {
    PixelMapColorOrder,
    PixelMapConfig,
    PixelMapDelivery,
    PixelMapFixture,
    PixelMapFixtureType,
    PixelMapProtocol,
    WLEDColorSamplingMode,
    WLEDMappingConfig,
    WLEDScanAxis,
    WLEDSourceRegion,
    WLEDTestPattern,
  } from '../types';
  import { buildWLEDBasePoints, resolveWLEDSourceRegion } from '../wled/mapping';
  import { drawLEDMapPreview } from '../wled/mapPreview';
  import {
    DMX_CHANNELS,
    MAX_FIXTURE_PIXELS,
    MAX_PIXELMAP_FPS,
    MAX_UNIVERSES_PER_FRAME,
    PIXEL_COLOR_ORDERS,
    channelsPerPixel,
    computeUniverseUsage,
    createDefaultPixelMapConfig,
    createPixelMapFixture,
    deliveriesFor,
    fixtureIssues,
    fixtureMappingConfig,
    maxUniverse,
    minUniverse,
    normalizePixelMapConfig,
    patchFixture,
    pixelsPerUniverse,
    resolveFixtureMapping,
  } from '../pixelmap/fixtures';
  import { getPixelMapFixturePixels, pixelMapBlackout, pixelMapStats } from '../pixelmap/sender';

  type PanelTab = 'map' | 'color' | 'test';
  let activeTab: PanelTab = 'map';
  let selectedFixtureId: string | null = null;
  let mapCanvas: HTMLCanvasElement;
  let resizeObserver: ResizeObserver | null = null;
  let drawFrame = 0;
  let liveTimer: ReturnType<typeof setInterval> | null = null;
  let selectedPoint = -1;
  let draggingPoint = false;

  const PROTOCOL_LABEL: Record<PixelMapProtocol, string> = { artnet: 'Art-Net', sacn: 'sACN' };
  const DELIVERY_LABEL: Record<PixelMapDelivery, string> = {
    unicast: 'Unicast to node',
    broadcast: 'Broadcast',
    multicast: 'Multicast',
  };
  const TYPE_LABEL: Record<PixelMapFixtureType, string> = { strip: 'Strip', matrix: 'Matrix', custom: 'Custom points' };
  const TEST_BUTTONS: Array<{ label: string; pattern: WLEDTestPattern; color?: string }> = [
    { label: 'Content', pattern: 'off' },
    { label: 'Red', pattern: 'solid', color: '#ff0000' },
    { label: 'Green', pattern: 'solid', color: '#00ff00' },
    { label: 'Blue', pattern: 'solid', color: '#0000ff' },
    { label: 'White', pattern: 'solid', color: '#ffffff' },
    { label: 'Chase', pattern: 'chase' },
    { label: 'LED order', pattern: 'rainbow' },
  ];

  // Stable defaults for the controls before the project has a pixel map.
  const DEFAULTS: PixelMapConfig = { ...createDefaultPixelMapConfig(), sacnCid: '' };

  $: config = $project.pixelMap ? normalizePixelMapConfig($project.pixelMap) : null;
  $: view = config ?? DEFAULTS;
  $: fixtures = config?.fixtures ?? [];
  $: if (fixtures.length > 0 && !fixtures.some(fixture => fixture.id === selectedFixtureId)) {
    selectedFixtureId = fixtures[0].id;
  }
  $: selected = fixtures.find(fixture => fixture.id === selectedFixtureId) ?? null;
  $: usage = computeUniverseUsage(fixtures);
  $: blackout = $pixelMapBlackout;
  $: stats = $pixelMapStats;
  $: liveState = !view.enabled ? 'OFF' : blackout ? 'BLACKOUT' : stats?.sending ? 'LIVE' : 'READY';
  $: resolved = selected ? resolveFixtureMapping(selected, 16 / 9) : null;
  $: mapping = selected ? fixtureMappingConfig(selected) : null;
  $: segments = selected ? patchFixture(selected) : [];
  $: issues = selected ? fixtureIssues(selected) : [];
  $: patchText = patchSummary(selected, segments);
  $: if (mapCanvas && resolved) scheduleDraw();
  $: updateLiveTimer(view.enabled && !blackout && activeTab === 'map' && !!selected);

  function clamp(value: number, min = 0, max = 1): number {
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(max, value));
  }

  function intFrom(event: Event, fallback: number): number {
    const value = Number.parseInt((event.target as HTMLInputElement).value, 10);
    return Number.isFinite(value) ? value : fallback;
  }

  function updateConfig(fields: Partial<PixelMapConfig>) {
    project.updatePixelMap(fields);
  }

  function addFixture() {
    const fixture = createPixelMapFixture(fixtures);
    project.addPixelMapFixture(fixture);
    selectedFixtureId = fixture.id;
    selectedPoint = -1;
  }

  function removeFixture(fixtureId: string) {
    project.removePixelMapFixture(fixtureId);
  }

  function updateFixture(fields: Partial<PixelMapFixture>) {
    if (!selected) return;
    project.updatePixelMapFixture(selected.id, fields);
  }

  function updateMapping(fields: Partial<WLEDMappingConfig>) {
    if (!selected) return;
    updateFixture({ mapping: { ...fixtureMappingConfig(selected), ...fields } });
  }

  function updateRegion(fields: Partial<WLEDSourceRegion>) {
    if (!selected) return;
    updateMapping({ sourceRegion: resolveWLEDSourceRegion({ ...resolveWLEDSourceRegion(selected.mapping?.sourceRegion), ...fields }) });
  }

  function setProtocol(protocol: PixelMapProtocol) {
    if (!selected || selected.protocol === protocol) return;
    updateFixture({
      protocol,
      delivery: deliveriesFor(protocol)[0],
      universe: clamp(selected.universe, minUniverse(protocol), maxUniverse(protocol)),
    });
  }

  function setType(type: PixelMapFixtureType) {
    if (!selected) return;
    if (type === 'custom') {
      const points = buildWLEDBasePoints(selected.pixelCount, fixtureMappingConfig(selected), 16 / 9, MAX_FIXTURE_PIXELS);
      updateFixture({ type, mapping: { ...fixtureMappingConfig(selected), mode: 'custom', points } });
      return;
    }
    updateFixture({ type, mapping: { ...fixtureMappingConfig(selected), mode: type } });
  }

  function makeCustomFromCurrent() {
    setType('custom');
  }

  function resetMapping() {
    if (!selected) return;
    selectedPoint = -1;
    const fresh = createPixelMapFixture([]).mapping;
    updateFixture({ mapping: { ...fresh, mode: selected.type, columns: selected.mapping?.columns ?? fresh.columns } });
  }

  function setTest(pattern: WLEDTestPattern, color?: string) {
    updateFixture(color ? { testPattern: pattern, testColor: color } : { testPattern: pattern });
  }

  function testActive(pattern: WLEDTestPattern, color: string | undefined, fixture: PixelMapFixture): boolean {
    const current = fixture.testPattern ?? 'off';
    if (current !== pattern) return false;
    return !color || (fixture.testColor ?? '').toLowerCase() === color;
  }

  function fixtureSummary(fixture: PixelMapFixture): string {
    const fixtureSegments = patchFixture(fixture);
    const first = fixtureSegments[0];
    const last = fixtureSegments[fixtureSegments.length - 1];
    const span = first.universe === last.universe ? `U${first.universe}` : `U${first.universe}-${last.universe}`;
    return `${TYPE_LABEL[fixture.type]} · ${fixture.pixelCount} px · ${fixture.colorOrder} · ${PROTOCOL_LABEL[fixture.protocol]} ${span}`;
  }

  function patchSummary(fixture: PixelMapFixture | null, segments: ReturnType<typeof patchFixture>): string {
    if (segments.length === 0 || !fixture) return '';
    const first = segments[0];
    const last = segments[segments.length - 1];
    const lastChannel = last.channel + last.channelCount - 1;
    const range = first.universe === last.universe
      ? `universe ${first.universe}, channels ${first.channel} to ${lastChannel}`
      : `universe ${first.universe} channel ${first.channel} through universe ${last.universe} channel ${lastChannel}`;
    return `${range}. ${pixelsPerUniverse(fixture.colorOrder)} pixels per universe at ${channelsPerPixel(fixture.colorOrder)} channels each.`;
  }

  function targetText(row: { protocol: PixelMapProtocol; host: string | null; broadcast: boolean }): string {
    if (row.host === null) return 'multicast';
    return row.broadcast ? `broadcast ${row.host || '(no address)'}` : row.host || '(no address)';
  }

  function scheduleDraw() {
    cancelAnimationFrame(drawFrame);
    drawFrame = requestAnimationFrame(drawMap);
  }

  function drawMap() {
    if (!mapCanvas || !resolved || !selected) return;
    const others = fixtures
      .filter(fixture => fixture.id !== selected!.id)
      .map(fixture => resolveFixtureMapping(fixture, 16 / 9).points);
    drawLEDMapPreview(mapCanvas, {
      points: resolved.points,
      sourceRegion: resolved.sourceRegion,
      selectedPoint,
      colors: getPixelMapFixturePixels(selected.id),
      others,
    });
  }

  function updateLiveTimer(live: boolean) {
    if (live && !liveTimer) {
      liveTimer = setInterval(scheduleDraw, 100);
    } else if (!live && liveTimer) {
      clearInterval(liveTimer);
      liveTimer = null;
      scheduleDraw();
    }
  }

  function pointerPosition(event: PointerEvent) {
    const rect = mapCanvas.getBoundingClientRect();
    return {
      x: clamp((event.clientX - rect.left) / rect.width),
      y: clamp((event.clientY - rect.top) / rect.height),
      width: rect.width,
      height: rect.height,
    };
  }

  function handleMapPointerDown(event: PointerEvent) {
    if (!resolved) return;
    const pointer = pointerPosition(event);
    let nearest = -1;
    let nearestDistance = 18;
    resolved.points.forEach((point, index) => {
      const distance = Math.hypot((point.x - pointer.x) * pointer.width, (point.y - pointer.y) * pointer.height);
      if (distance < nearestDistance) {
        nearest = index;
        nearestDistance = distance;
      }
    });
    if (nearest < 0) return;
    selectedPoint = nearest;
    draggingPoint = selected?.type === 'custom';
    mapCanvas.setPointerCapture(event.pointerId);
    scheduleDraw();
  }

  function handleMapPointerMove(event: PointerEvent) {
    if (!draggingPoint || !selected || !mapping || selected.type !== 'custom') return;
    const pointer = pointerPosition(event);
    const region = resolveWLEDSourceRegion(mapping.sourceRegion);
    let x = clamp((pointer.x - region.x) / region.width);
    let y = clamp((pointer.y - region.y) / region.height);
    if (mapping.flipX) x = 1 - x;
    if (mapping.flipY) y = 1 - y;
    const points = buildWLEDBasePoints(selected.pixelCount, mapping, 16 / 9, MAX_FIXTURE_PIXELS);
    const sourceIndex = mapping.reverse ? points.length - 1 - selectedPoint : selectedPoint;
    points[sourceIndex] = { x, y };
    updateMapping({ points });
  }

  function handleMapPointerUp(event: PointerEvent) {
    draggingPoint = false;
    if (mapCanvas?.hasPointerCapture(event.pointerId)) mapCanvas.releasePointerCapture(event.pointerId);
  }

  let observedCanvas: HTMLCanvasElement | null = null;

  onMount(() => {
    resizeObserver = new ResizeObserver(scheduleDraw);
  });

  // The canvas only exists while a fixture is selected on the Map tab.
  $: if (resizeObserver && mapCanvas !== observedCanvas) {
    resizeObserver.disconnect();
    if (mapCanvas) resizeObserver.observe(mapCanvas);
    observedCanvas = mapCanvas ?? null;
  }

  onDestroy(() => {
    resizeObserver?.disconnect();
    cancelAnimationFrame(drawFrame);
    if (liveTimer) clearInterval(liveTimer);
  });
</script>

<div class="pixelmap" data-help-page="settings">
  <article class="pm-card">
    <header class="card-header">
      <label class="power-toggle" title="Send Art-Net and sACN">
        <input
          type="checkbox"
          checked={view.enabled}
          aria-label="Pixel mapping output"
          onchange={(event) => updateConfig({ enabled: (event.target as HTMLInputElement).checked })}
        />
        <span></span>
      </label>
      <strong class="card-title">Output</strong>
      <span class="state" class:live={liveState === 'LIVE'} class:blackout={liveState === 'BLACKOUT'}>{liveState}</span>
      <button
        class="blackout-button"
        class:active={blackout}
        onclick={() => pixelMapBlackout.update(value => !value)}
        title="Send black to every fixture and stop sending"
      >{blackout ? 'Release blackout' : 'Blackout'}</button>
    </header>
    <div class="output-grid">
      <label>
        <span>Frame rate</span>
        <input
          type="number"
          min="1"
          max={MAX_PIXELMAP_FPS}
          value={view.fps}
          aria-label="Frame rate"
          onchange={(event) => updateConfig({ fps: Math.max(1, Math.min(MAX_PIXELMAP_FPS, intFrom(event, 40))) })}
        />
      </label>
      <label>
        <span>sACN priority</span>
        <input
          type="number"
          min="0"
          max="200"
          value={view.sacnPriority}
          aria-label="sACN priority"
          onchange={(event) => updateConfig({ sacnPriority: Math.max(0, Math.min(200, intFrom(event, 100))) })}
        />
      </label>
      <label class="wide">
        <span>sACN source name</span>
        <input
          type="text"
          maxlength="63"
          value={view.sacnSourceName}
          aria-label="sACN source name"
          onchange={(event) => updateConfig({ sacnSourceName: (event.target as HTMLInputElement).value })}
        />
      </label>
      <label class="check-option">
        <input
          type="checkbox"
          checked={view.artSync}
          onchange={(event) => updateConfig({ artSync: (event.target as HTMLInputElement).checked })}
        />
        <span>Send ArtSync after each frame</span>
      </label>
    </div>
    <div class="stats-row">
      {#if stats && (stats.sending || stats.framesSent > 0)}
        <span><b>{stats.fps}</b> fps</span>
        <span><b>{stats.universes}</b> {stats.universes === 1 ? 'universe' : 'universes'}</span>
        <span><b>{stats.framesSent.toLocaleString()}</b> frames</span>
        <span class:warn={stats.framesDropped + stats.skippedInFlight > 0}>
          <b>{(stats.framesDropped + stats.skippedInFlight).toLocaleString()}</b> dropped
        </span>
        {#if stats.lastError}<span class="error-text">{stats.lastError}</span>{/if}
      {:else}
        <span>Not sending. Turn on output and enable a fixture with a node address.</span>
      {/if}
    </div>
  </article>

  <div class="list-title">
    <span>Fixtures</span>
    <button class="add-button" onclick={addFixture}>+ Add fixture</button>
  </div>
  {#if fixtures.length === 0}
    <div class="empty">No fixtures. Click <strong>+ Add fixture</strong> to patch an LED strip or matrix on an Art-Net or sACN node.</div>
  {:else}
    <div class="fixture-list" role="listbox" aria-label="Fixtures">
      {#each fixtures as fixture (fixture.id)}
        <div
          class="fixture-row"
          class:selected={fixture.id === selectedFixtureId}
          role="option"
          aria-selected={fixture.id === selectedFixtureId}
          tabindex="0"
          onclick={() => { selectedFixtureId = fixture.id; selectedPoint = -1; }}
          onkeydown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectedFixtureId = fixture.id; selectedPoint = -1; } }}
        >
          <label class="power-toggle small" title="Send this fixture">
            <input
              type="checkbox"
              checked={fixture.enabled}
              aria-label={`Enable ${fixture.name}`}
              onclick={(event) => event.stopPropagation()}
              onchange={(event) => project.updatePixelMapFixture(fixture.id, { enabled: (event.target as HTMLInputElement).checked })}
            />
            <span></span>
          </label>
          <span class="fixture-name">{fixture.name}</span>
          <span class="fixture-summary">{fixtureSummary(fixture)}</span>
          {#if usage.overlappingFixtureIds.has(fixture.id)}
            <span class="badge danger" title="Channels overlap another fixture">Overlap</span>
          {:else if fixtureIssues(fixture).length > 0}
            <span class="badge warn" title={fixtureIssues(fixture).join(' ')}>Check</span>
          {:else}
            <span class="badge">{fixture.enabled ? 'Ready' : 'Off'}</span>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  {#if selected && mapping && resolved}
    <article class="pm-card editor">
      <header class="card-header editor-header">
        <input
          class="name-input"
          type="text"
          value={selected.name}
          aria-label="Fixture name"
          onchange={(event) => updateFixture({ name: (event.target as HTMLInputElement).value })}
        />
        <button class="remove-button" onclick={() => removeFixture(selected!.id)} title="Remove fixture" aria-label="Remove fixture">×</button>
      </header>

      <div class="field-grid">
        <label>
          <span>Type</span>
          <select value={selected.type} aria-label="Fixture type" onchange={(event) => setType((event.target as HTMLSelectElement).value as PixelMapFixtureType)}>
            <option value="strip">Strip</option>
            <option value="matrix">Matrix</option>
            <option value="custom">Custom points</option>
          </select>
        </label>
        <label>
          <span>Pixels</span>
          <input
            type="number"
            min="1"
            max={MAX_FIXTURE_PIXELS}
            value={selected.pixelCount}
            aria-label="Pixel count"
            onchange={(event) => updateFixture({ pixelCount: Math.max(1, Math.min(MAX_FIXTURE_PIXELS, intFrom(event, 1))) })}
          />
        </label>
        <label>
          <span>Colour order</span>
          <select value={selected.colorOrder} aria-label="Colour order" onchange={(event) => updateFixture({ colorOrder: (event.target as HTMLSelectElement).value as PixelMapColorOrder })}>
            {#each PIXEL_COLOR_ORDERS as order}
              <option value={order}>{order}</option>
            {/each}
          </select>
        </label>
        <label>
          <span>Protocol</span>
          <select value={selected.protocol} aria-label="Protocol" onchange={(event) => setProtocol((event.target as HTMLSelectElement).value as PixelMapProtocol)}>
            <option value="artnet">Art-Net</option>
            <option value="sacn">sACN (E1.31)</option>
          </select>
        </label>
        <label>
          <span>Send to</span>
          <select value={selected.delivery} aria-label="Delivery" onchange={(event) => updateFixture({ delivery: (event.target as HTMLSelectElement).value as PixelMapDelivery })}>
            {#each deliveriesFor(selected.protocol) as delivery}
              <option value={delivery}>{DELIVERY_LABEL[delivery]}</option>
            {/each}
          </select>
        </label>
        <label>
          <span>{selected.delivery === 'broadcast' ? 'Broadcast address' : 'Target IP'}</span>
          <input
            type="text"
            value={selected.protocol === 'sacn' && selected.delivery === 'multicast' ? '' : selected.address}
            placeholder={selected.protocol === 'sacn' && selected.delivery === 'multicast'
              ? `239.255.${(selected.universe >> 8) & 255}.${selected.universe & 255}`
              : selected.delivery === 'broadcast' ? '2.255.255.255' : '192.168.1.50'}
            disabled={selected.protocol === 'sacn' && selected.delivery === 'multicast'}
            aria-label="Target IP"
            onchange={(event) => updateFixture({ address: (event.target as HTMLInputElement).value.trim() })}
          />
        </label>
        <label>
          <span>Universe</span>
          <input
            type="number"
            min={minUniverse(selected.protocol)}
            max={maxUniverse(selected.protocol)}
            value={selected.universe}
            aria-label="Start universe"
            onchange={(event) => updateFixture({
              universe: Math.max(minUniverse(selected!.protocol), Math.min(maxUniverse(selected!.protocol), intFrom(event, minUniverse(selected!.protocol)))),
            })}
          />
        </label>
        <label>
          <span>Channel</span>
          <input
            type="number"
            min="1"
            max={DMX_CHANNELS}
            value={selected.channel}
            aria-label="Start channel"
            onchange={(event) => updateFixture({ channel: Math.max(1, Math.min(DMX_CHANNELS, intFrom(event, 1))) })}
          />
        </label>
      </div>
      <p class="patch-note">Uses {patchText}</p>
      {#each issues as issue}
        <p class="issue">{issue}</p>
      {/each}

      <nav class="panel-tabs" aria-label="Fixture settings">
        <button class:active={activeTab === 'map'} onclick={() => activeTab = 'map'}>Map</button>
        <button class:active={activeTab === 'color'} onclick={() => activeTab = 'color'}>Color</button>
        <button class:active={activeTab === 'test'} onclick={() => activeTab = 'test'}>Test</button>
      </nav>

      {#if activeTab === 'map'}
        <section class="panel-body">
          <div class="map-options">
            {#if selected.type !== 'custom'}
              <label>
                <span>Scan</span>
                <select value={mapping.axis ?? 'horizontal'} aria-label="Scan direction" onchange={(event) => updateMapping({ axis: (event.target as HTMLSelectElement).value as WLEDScanAxis })}>
                  <option value="horizontal">Horizontal</option>
                  <option value="vertical">Vertical</option>
                </select>
              </label>
            {/if}
            {#if selected.type === 'matrix'}
              <label>
                <span>Matrix</span>
                <div class="matrix-size">
                  <input
                    type="number"
                    min="1"
                    max={selected.pixelCount}
                    value={mapping.columns ?? 8}
                    aria-label="Matrix columns"
                    onchange={(event) => updateMapping({ columns: Math.max(1, Math.min(selected!.pixelCount, intFrom(event, 1))) })}
                  />
                  <span>× {Math.ceil(selected.pixelCount / Math.max(1, mapping.columns ?? 8))}</span>
                </div>
              </label>
              <label class="check-option">
                <input type="checkbox" checked={mapping.serpentine ?? false} onchange={(event) => updateMapping({ serpentine: (event.target as HTMLInputElement).checked })} />
                <span>Serpentine</span>
              </label>
            {/if}
            <label class="check-option">
              <input type="checkbox" checked={mapping.reverse ?? false} onchange={(event) => updateMapping({ reverse: (event.target as HTMLInputElement).checked })} />
              <span>Reverse order</span>
            </label>
            <label class="check-option">
              <input type="checkbox" checked={mapping.flipX ?? false} onchange={(event) => updateMapping({ flipX: (event.target as HTMLInputElement).checked })} />
              <span>Flip X</span>
            </label>
            <label class="check-option">
              <input type="checkbox" checked={mapping.flipY ?? false} onchange={(event) => updateMapping({ flipY: (event.target as HTMLInputElement).checked })} />
              <span>Flip Y</span>
            </label>
          </div>

          <canvas
            class:editable={selected.type === 'custom'}
            class="map-canvas"
            bind:this={mapCanvas}
            onpointerdown={handleMapPointerDown}
            onpointermove={handleMapPointerMove}
            onpointerup={handleMapPointerUp}
            onpointercancel={handleMapPointerUp}
          ></canvas>
          <div class="map-caption">
            <span>Pixel 1 is coral. {selected.type === 'custom' ? 'Drag any point to place it.' : 'The line follows physical pixel order.'} Other fixtures show as faint dots.</span>
            <span>{selected.pixelCount} pixels</span>
          </div>

          <div class="tool-row">
            {#if selected.type !== 'custom'}
              <button onclick={makeCustomFromCurrent}>Edit points</button>
            {/if}
            <button onclick={resetMapping}>Reset map</button>
          </div>

          <div class="subsection-title">Source region</div>
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
              <span>Width <b>{Math.round(resolved.sourceRegion.width * 100)}%</b></span>
              <input type="range" min="0.01" max={1 - resolved.sourceRegion.x} step="0.01" value={resolved.sourceRegion.width} oninput={(event) => updateRegion({ width: Number.parseFloat((event.target as HTMLInputElement).value) })} />
            </label>
            <label>
              <span>Height <b>{Math.round(resolved.sourceRegion.height * 100)}%</b></span>
              <input type="range" min="0.01" max={1 - resolved.sourceRegion.y} step="0.01" value={resolved.sourceRegion.height} oninput={(event) => updateRegion({ height: Number.parseFloat((event.target as HTMLInputElement).value) })} />
            </label>
          </div>
          <label class="wide-range">
            <span>Sample area <b>{Math.round((mapping.sampleRadius ?? 0.01) * 1000) / 10}%</b></span>
            <input type="range" min="0" max="0.12" step="0.0025" value={mapping.sampleRadius ?? 0.01} oninput={(event) => updateMapping({ sampleRadius: Number.parseFloat((event.target as HTMLInputElement).value) })} />
          </label>
        </section>
      {:else if activeTab === 'color'}
        <section class="panel-body">
          <label class="sampling-select">
            <span>Color sampling</span>
            <select
              value={selected.samplingMode ?? 'average'}
              onchange={(event) => updateFixture({ samplingMode: (event.target as HTMLSelectElement).value as WLEDColorSamplingMode })}
            >
              <option value="average">Linear average</option>
              <option value="exact">Exact pixel</option>
              <option value="dominant">Dominant color</option>
              <option value="highlight">Bright highlight</option>
              <option value="luma-hue">Hue + source brightness</option>
            </select>
          </label>
          <div class="range-grid">
            <label>
              <span>Brightness <b>{Math.round((selected.brightness ?? 1) * 100)}%</b></span>
              <input type="range" min="0" max="1" step="0.01" value={selected.brightness ?? 1} oninput={(event) => updateFixture({ brightness: Number.parseFloat((event.target as HTMLInputElement).value) })} />
            </label>
            <label>
              <span>Gamma <b>{(selected.gamma ?? 1).toFixed(2)}</b></span>
              <input type="range" min="0.5" max="3" step="0.05" value={selected.gamma ?? 1} oninput={(event) => updateFixture({ gamma: Number.parseFloat((event.target as HTMLInputElement).value) })} />
            </label>
            {#each [['redGain', 'Red'], ['greenGain', 'Green'], ['blueGain', 'Blue']] as gain}
              <label>
                <span>{gain[1]} <b>{(selected.calibration?.[gain[0] as 'redGain'] ?? 1).toFixed(2)}×</b></span>
                <input type="range" min="0" max="2" step="0.01" value={selected.calibration?.[gain[0] as 'redGain'] ?? 1}
                  oninput={(event) => updateFixture({ calibration: { ...(selected!.calibration ?? {}), [gain[0]]: Number.parseFloat((event.target as HTMLInputElement).value) } })} />
              </label>
            {/each}
            <label>
              <span>Smoothing <b>{Math.round((selected.calibration?.smoothing ?? 0) * 100)}%</b></span>
              <input type="range" min="0" max="0.95" step="0.01" value={selected.calibration?.smoothing ?? 0}
                oninput={(event) => updateFixture({ calibration: { ...(selected!.calibration ?? {}), smoothing: Number.parseFloat((event.target as HTMLInputElement).value) } })} />
            </label>
          </div>
          <p class="section-note">RGBW fixtures drive the white channel with the shared white part of each colour, min(R, G, B).</p>
        </section>
      {:else}
        <section class="panel-body">
          <div class="test-patterns">
            {#each TEST_BUTTONS as button}
              <button class:active={testActive(button.pattern, button.color, selected)} onclick={() => setTest(button.pattern, button.color)}>{button.label}</button>
            {/each}
          </div>
          <label class="test-color">
            <span>Solid color</span>
            <input type="color" value={selected.testColor ?? '#ffffff'} oninput={(event) => setTest('solid', (event.target as HTMLInputElement).value)} />
          </label>
          <p class="section-note">
            LED order paints every physical pixel across a rainbow. Chase moves one lit pixel through the patch order, so reversed or serpentine wiring and a wrong start channel are easy to spot. Test patterns send even when no content is playing.
          </p>
        </section>
      {/if}
    </article>
  {/if}

  <div class="list-title"><span>Universe and channel usage</span></div>
  {#if usage.rows.length === 0}
    <div class="empty">No universes in use.</div>
  {:else}
    {#if usage.conflicts.length > 0}
      <div class="conflicts">
        {#each usage.conflicts as conflict}
          <p>{conflict.first} and {conflict.second} both write {PROTOCOL_LABEL[conflict.protocol]} universe {conflict.universe}, channels {conflict.start} to {conflict.end}.</p>
        {/each}
      </div>
    {/if}
    {#if usage.universeCount > MAX_UNIVERSES_PER_FRAME}
      <p class="issue">{usage.universeCount} universes are patched; only the first {MAX_UNIVERSES_PER_FRAME} are sent each frame.</p>
    {/if}
    <div class="usage-table">
      {#each usage.rows as row (row.key)}
        <div class="usage-row" class:overlap={row.overlap}>
          <span class="usage-label">{PROTOCOL_LABEL[row.protocol]} U{row.universe}</span>
          <span class="usage-target">{targetText(row)}</span>
          <div class="usage-bar" title={row.spans.map(span => `${span.name}: ${span.start}-${span.end}`).join(', ')}>
            {#each row.spans as span}
              <span
                class="usage-span"
                class:overlap={span.overlap}
                class:disabled={!span.enabled}
                style={`left:${((span.start - 1) / DMX_CHANNELS) * 100}%;width:${((span.end - span.start + 1) / DMX_CHANNELS) * 100}%`}
              ></span>
            {/each}
          </div>
          <span class="usage-count">{row.used}/{DMX_CHANNELS}</span>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .pixelmap {
    display: grid;
    gap: 10px;
  }

  .pm-card {
    background: #111116;
    border: 1px solid #2a2a30;
    border-radius: 6px;
    overflow: hidden;
  }

  .card-header {
    display: grid;
    grid-template-columns: 36px minmax(80px, 1fr) auto auto;
    gap: 8px;
    align-items: center;
    padding: 10px 12px;
    background: #15151b;
    border-bottom: 1px solid #24242a;
  }

  .editor-header {
    grid-template-columns: minmax(120px, 1fr) 32px;
  }

  .card-title {
    color: #e7e7eb;
    font-size: 13px;
  }

  input, select, button {
    font: inherit;
  }

  .name-input,
  .output-grid input[type='number'],
  .output-grid input[type='text'],
  .field-grid input,
  .field-grid select,
  .map-options input[type='number'],
  .map-options select,
  .sampling-select select {
    min-width: 0;
    width: 100%;
    box-sizing: border-box;
    border: 1px solid #33333a;
    border-radius: 4px;
    background: #09090c;
    color: #e7e7eb;
    padding: 7px 8px;
  }

  .field-grid input:disabled {
    color: #6f6f79;
  }

  .name-input {
    font-size: 14px;
    font-weight: 700;
  }

  .power-toggle {
    display: grid;
    place-items: center;
    cursor: pointer;
    position: relative;
  }

  .power-toggle input {
    position: absolute;
    opacity: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    cursor: pointer;
  }

  .power-toggle span {
    width: 26px;
    height: 14px;
    border-radius: 7px;
    background: #3b3b42;
    position: relative;
    pointer-events: none;
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
    background: var(--ga-blue-a28);
  }

  .power-toggle input:checked + span::after {
    transform: translateX(12px);
    background: var(--ga-blue-300);
  }

  .state {
    color: #686873;
    font-family: var(--ga-font-mono, ui-monospace, monospace);
    font-size: 10px;
    letter-spacing: 0.08em;
  }

  .state.live {
    color: #4ade80;
  }

  .state.blackout {
    color: #ff6b6b;
  }

  .blackout-button,
  .add-button,
  .remove-button,
  .tool-row button,
  .test-patterns button,
  .panel-tabs button {
    border: 1px solid #323239;
    border-radius: 4px;
    background: #141419;
    color: #8c8c96;
    cursor: pointer;
    font-size: 12px;
  }

  .blackout-button {
    padding: 6px 10px;
  }

  .blackout-button.active {
    border-color: #ff6b6b;
    color: #ff6b6b;
    background: rgba(255, 107, 107, 0.1);
  }

  .remove-button {
    width: 28px;
    height: 28px;
    color: #888;
  }

  .remove-button:hover {
    border-color: #ff6b6b;
    color: #ff6b6b;
  }

  .output-grid,
  .field-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px;
    padding: 10px 12px;
    align-items: end;
  }

  .output-grid label,
  .field-grid label,
  .map-options label {
    display: flex;
    flex-direction: column;
    gap: 5px;
    color: #858590;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .output-grid .wide {
    grid-column: span 2;
  }

  .check-option {
    flex-direction: row !important;
    align-items: center;
    gap: 6px !important;
    padding: 7px 0;
    cursor: pointer;
    text-transform: none !important;
    letter-spacing: 0 !important;
    font-size: 12px !important;
    color: #aaa !important;
  }

  .output-grid .check-option {
    grid-column: 1 / -1;
  }

  .check-option input {
    accent-color: var(--ga-blue-300);
  }

  .stats-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
    padding: 8px 12px 10px;
    border-top: 1px solid #202026;
    color: #777781;
    font-size: 11px;
  }

  .stats-row b {
    color: var(--ga-blue-300);
    font-family: var(--ga-font-mono, ui-monospace, monospace);
    font-weight: 500;
  }

  .stats-row .warn b {
    color: #fbbf24;
  }

  .error-text,
  .issue {
    color: #ff8a8a;
  }

  .list-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 6px;
    color: #777781;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }

  .add-button {
    padding: 5px 8px;
    font-size: 11px;
    text-transform: none;
    letter-spacing: 0;
    font-weight: 500;
  }

  .add-button:hover,
  .tool-row button:hover {
    border-color: var(--ga-blue-300);
    color: var(--ga-blue-300);
  }

  .empty {
    color: #70707a;
    font-size: 11px;
    line-height: 1.45;
    padding: 10px 12px;
    border: 1px dashed #2a2a30;
    border-radius: 6px;
  }

  .fixture-list {
    display: grid;
    gap: 4px;
  }

  .fixture-row {
    display: grid;
    grid-template-columns: 36px minmax(90px, 0.8fr) minmax(0, 2fr) auto;
    gap: 8px;
    align-items: center;
    padding: 7px 10px 7px 0;
    border: 1px solid #2a2a30;
    border-radius: 5px;
    background: #111116;
    cursor: pointer;
  }

  .fixture-row:hover {
    border-color: #3a3a44;
  }

  .fixture-row.selected {
    border-color: var(--ga-blue-300);
    background: var(--ga-blue-a08);
  }

  .fixture-name {
    color: #e7e7eb;
    font-size: 12px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .fixture-summary {
    color: #858590;
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .badge {
    color: #686873;
    font-family: var(--ga-font-mono, ui-monospace, monospace);
    font-size: 10px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .badge.warn {
    color: #fbbf24;
  }

  .badge.danger {
    color: #ff6b6b;
  }

  .patch-note,
  .issue {
    margin: 0;
    padding: 0 12px 8px;
    font-size: 11px;
    line-height: 1.45;
  }

  .patch-note {
    color: #777781;
  }

  .panel-tabs {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    padding: 0 12px;
    border-top: 1px solid #202026;
    border-bottom: 1px solid #202026;
  }

  .panel-tabs button {
    padding: 9px;
    border: 0;
    border-radius: 0;
    background: transparent;
    border-bottom: 2px solid transparent;
  }

  .panel-tabs button.active {
    color: var(--ga-blue-300);
    border-bottom-color: var(--ga-blue-300);
  }

  .panel-body {
    padding: 12px;
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

  .matrix-size {
    display: flex;
    align-items: center;
    gap: 6px;
    color: #aaa;
    font-size: 12px;
  }

  .matrix-size input {
    width: 72px !important;
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

  .tool-row button,
  .test-patterns button {
    padding: 7px 8px;
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
  .wide-range,
  .sampling-select {
    display: flex;
    flex-direction: column;
    gap: 5px;
    color: #aaa;
    font-size: 11px;
  }

  .sampling-select {
    margin-bottom: 12px;
  }

  .range-grid label > span,
  .wide-range > span {
    display: flex;
    justify-content: space-between;
  }

  .range-grid b,
  .wide-range b {
    color: var(--ga-blue-300);
    font-family: var(--ga-font-mono, ui-monospace, monospace);
    font-weight: 500;
  }

  input[type='range'] {
    width: 100%;
    accent-color: var(--ga-blue-300);
  }

  .wide-range {
    margin-top: 12px;
  }

  .section-note {
    color: #70707a;
    font-size: 11px;
    line-height: 1.45;
    margin: 12px 0 0;
  }

  .test-patterns {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 4px;
    margin-bottom: 10px;
  }

  .test-patterns button.active {
    border-color: var(--ga-blue-300);
    color: var(--ga-blue-300);
    background: var(--ga-blue-a08);
  }

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

  .conflicts {
    border: 1px solid rgba(255, 107, 107, 0.45);
    background: rgba(255, 107, 107, 0.07);
    border-radius: 5px;
    padding: 8px 10px;
  }

  .conflicts p {
    margin: 0;
    color: #ff8a8a;
    font-size: 11px;
    line-height: 1.5;
  }

  .usage-table {
    display: grid;
    gap: 4px;
  }

  .usage-row {
    display: grid;
    grid-template-columns: 110px minmax(90px, 0.8fr) minmax(120px, 2fr) 64px;
    gap: 8px;
    align-items: center;
    font-size: 11px;
    color: #aaa;
  }

  .usage-label {
    font-family: var(--ga-font-mono, ui-monospace, monospace);
    color: #cfcfd6;
  }

  .usage-target {
    color: #777781;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .usage-bar {
    position: relative;
    height: 10px;
    border: 1px solid #2c2c33;
    background: #0d0d11;
    border-radius: 2px;
    overflow: hidden;
  }

  .usage-span {
    position: absolute;
    top: 0;
    bottom: 0;
    background: var(--ga-blue-a45);
    border-right: 1px solid #0d0d11;
  }

  .usage-span.disabled {
    background: rgba(140, 140, 150, 0.35);
  }

  .usage-span.overlap {
    background: rgba(255, 107, 107, 0.85);
  }

  .usage-count {
    text-align: right;
    font-family: var(--ga-font-mono, ui-monospace, monospace);
  }

  .usage-row.overlap .usage-count,
  .usage-row.overlap .usage-label {
    color: #ff8a8a;
  }

  @media (max-width: 720px) {
    .output-grid,
    .field-grid,
    .range-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .fixture-row {
      grid-template-columns: 36px minmax(80px, 1fr) auto;
    }

    .fixture-summary {
      display: none;
    }
  }
</style>
