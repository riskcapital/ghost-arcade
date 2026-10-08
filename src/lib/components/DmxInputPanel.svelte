<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { dmxActivity, dmxStore, getDmxUniverseValues, listDmxUniverses } from '../dmx/dmxStore';
  import {
    DMX_CHANNELS,
    fineChannelOf,
    formatUniverseFilter,
    maxUniverseFor,
    minUniverseFor,
    parseUniverseFilter,
    readDmxBindingPosition,
    type DmxBinding,
    type DmxBindingMode,
    type DmxMergeMode,
    type DmxProtocol,
  } from '../dmx/dmxBindings';
  import { CONTROL_PATH_EXAMPLES, normalizeControlPath, validateControlPath } from '../control/controlPaths';

  const PROTOCOL_LABEL: Record<DmxProtocol, string> = { artnet: 'Art-Net', sacn: 'sACN' };
  const MODE_LABEL: Record<DmxBindingMode, string> = { '8bit': '8-bit', '16bit': '16-bit', trigger: 'Button' };
  const MERGE_LABEL: Record<DmxMergeMode, string> = {
    htp: 'HTP (highest value)',
    ltp: 'LTP (latest change)',
    priority: 'Highest sACN priority',
  };
  const COLUMNS = 32;
  const ROWS = DMX_CHANNELS / COLUMNS;

  let filterText = '';
  let filterError: string | null = null;
  let filterFocused = false;
  let learnPath = 'vj:0:opacity';
  let learnMode: 'auto' | DmxBindingMode = 'auto';
  let learnMin = 0;
  let learnMax = 1;
  let pathOptions: Array<{ path: string; label: string }> = [];
  let monitorKey = '';
  let monitorCanvas: HTMLCanvasElement;
  let hoverChannel: number | null = null;
  let drawFrame = 0;
  let statusTimer: ReturnType<typeof setInterval> | null = null;
  let resizeObserver: ResizeObserver | null = null;

  $: state = $dmxStore;
  $: status = state.status;
  $: if (!filterFocused) filterText = formatUniverseFilter(state.universes);
  $: stateLabel = !state.enabled ? 'OFF' : state.listening ? 'LISTENING' : state.lastError ? 'ERROR' : 'STARTING';
  $: interfaces = status?.interfaces ?? [];
  $: learnValid = validateControlPath(learnPath);

  // Universes the monitor can show: anything with data, anything a desk is
  // sending, and anything a binding reads.
  $: monitorOptions = computeMonitorOptions(status?.universes ?? [], state.bindings, $dmxActivity);
  $: if (monitorOptions.length > 0 && !monitorOptions.some(option => option.key === monitorKey)) monitorKey = monitorOptions[0].key;
  $: monitorTarget = monitorOptions.find(option => option.key === monitorKey) ?? null;
  $: monitorSources = status?.universes.find(entry => monitorTarget && entry.protocol === monitorTarget.protocol && entry.universe === monitorTarget.universe)?.sources ?? [];
  $: boundChannels = new Set(
    state.bindings
      .filter(binding => monitorTarget && binding.protocol === monitorTarget.protocol && binding.universe === monitorTarget.universe)
      .flatMap(binding => binding.mode === '16bit' ? [binding.channel, fineChannelOf(binding)] : [binding.channel])
  );
  $: $dmxActivity, monitorTarget, boundChannels, hoverChannel, scheduleDraw();

  function computeMonitorOptions(
    live: Array<{ protocol: DmxProtocol; universe: number }>,
    bindings: DmxBinding[],
    _activity: number,
  ) {
    const seen = new Map<string, { protocol: DmxProtocol; universe: number }>();
    const add = (protocol: DmxProtocol, universe: number) => seen.set(`${protocol}:${universe}`, { protocol, universe });
    for (const entry of live) add(entry.protocol, entry.universe);
    for (const entry of listDmxUniverses()) add(entry.protocol, entry.universe);
    for (const binding of bindings) add(binding.protocol, binding.universe);
    return [...seen.entries()]
      .sort((a, b) => a[1].protocol.localeCompare(b[1].protocol) || a[1].universe - b[1].universe)
      .map(([key, value]) => ({ key, ...value }));
  }

  function intFrom(event: Event, fallback: number): number {
    const value = parseInt((event.target as HTMLInputElement).value, 10);
    return Number.isFinite(value) ? value : fallback;
  }

  function numberFrom(event: Event, fallback: number): number {
    const value = parseFloat((event.target as HTMLInputElement).value);
    return Number.isFinite(value) ? value : fallback;
  }

  function commitFilter() {
    const parsed = parseUniverseFilter(filterText);
    filterError = parsed.error;
    if (!parsed.error) void dmxStore.setUniverses(parsed.universes);
  }

  /** Every control on screen that MIDI can map is a valid DMX target too. */
  function collectPathOptions() {
    const found = new Map<string, string>();
    for (const example of CONTROL_PATH_EXAMPLES) found.set(example.path, example.label);
    for (let macro = 1; macro <= 8; macro += 1) found.set(`vj:macro:${macro}:value`, `Macro ${macro}`);
    if (typeof document !== 'undefined') {
      for (const element of document.querySelectorAll<HTMLElement>('[data-midi-path]')) {
        const path = element.dataset.midiPath;
        if (!path || !validateControlPath(path).valid || found.has(path)) continue;
        found.set(path, element.dataset.midiLabel || path);
      }
    }
    pathOptions = [...found.entries()].map(([path, label]) => ({ path, label }));
  }

  function startLearn() {
    if (!learnValid.valid) return;
    dmxStore.startLearn(learnValid.normalized, {
      mode: learnMode === 'auto' ? undefined : learnMode,
      min: learnMin,
      max: learnMax,
      label: pathOptions.find(option => option.path === learnValid.normalized)?.label,
    });
  }

  function addManualBinding() {
    const target = monitorTarget ?? { protocol: 'artnet' as DmxProtocol, universe: 0 };
    const channel = hoverChannel ?? 1;
    dmxStore.addBinding({
      protocol: target.protocol,
      universe: target.universe,
      channel,
      mode: '8bit',
      path: 'vj:master:opacity',
      min: 0,
      max: 1,
      invert: false,
      threshold: 128,
      hysteresis: 16,
    });
  }

  function bindingPosition(binding: DmxBinding, _activity: number): number | null {
    const data = getDmxUniverseValues(binding.protocol, binding.universe);
    return data ? readDmxBindingPosition(binding, data) : null;
  }

  function scheduleDraw() {
    if (typeof requestAnimationFrame === 'undefined' || drawFrame) return;
    drawFrame = requestAnimationFrame(() => {
      drawFrame = 0;
      drawMonitor();
    });
  }

  function drawMonitor() {
    if (!monitorCanvas) return;
    const width = monitorCanvas.clientWidth;
    const height = monitorCanvas.clientHeight;
    if (width < 1 || height < 1) return;
    const ratio = window.devicePixelRatio || 1;
    if (monitorCanvas.width !== Math.round(width * ratio)) monitorCanvas.width = Math.round(width * ratio);
    if (monitorCanvas.height !== Math.round(height * ratio)) monitorCanvas.height = Math.round(height * ratio);
    const context = monitorCanvas.getContext('2d');
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    const data = monitorTarget ? getDmxUniverseValues(monitorTarget.protocol, monitorTarget.universe) : null;
    const cellWidth = width / COLUMNS;
    const cellHeight = height / ROWS;
    for (let index = 0; index < DMX_CHANNELS; index += 1) {
      const x = (index % COLUMNS) * cellWidth;
      const y = Math.floor(index / COLUMNS) * cellHeight;
      const value = data?.[index] ?? 0;
      context.fillStyle = '#0b0b0f';
      context.fillRect(x + 1, y + 1, cellWidth - 2, cellHeight - 2);
      if (value > 0) {
        const fill = (cellHeight - 2) * (value / 255);
        context.fillStyle = boundChannels.has(index + 1) ? 'rgba(76, 209, 255, 0.85)' : 'rgba(76, 209, 255, 0.38)';
        context.fillRect(x + 1, y + cellHeight - 1 - fill, cellWidth - 2, fill);
      }
      if (boundChannels.has(index + 1) || hoverChannel === index + 1) {
        context.strokeStyle = hoverChannel === index + 1 ? '#ffffff' : '#4cd1ff';
        context.lineWidth = 1;
        context.strokeRect(x + 1.5, y + 1.5, cellWidth - 3, cellHeight - 3);
      }
    }
  }

  function channelAt(event: MouseEvent): number | null {
    const rect = monitorCanvas.getBoundingClientRect();
    const column = Math.floor(((event.clientX - rect.left) / rect.width) * COLUMNS);
    const row = Math.floor(((event.clientY - rect.top) / rect.height) * ROWS);
    if (column < 0 || column >= COLUMNS || row < 0 || row >= ROWS) return null;
    return row * COLUMNS + column + 1;
  }

  function channelValue(target: { protocol: DmxProtocol; universe: number } | null, channel: number | null, _activity: number): number | null {
    if (!target || channel === null) return null;
    return getDmxUniverseValues(target.protocol, target.universe)?.[channel - 1] ?? 0;
  }

  $: hoverValue = channelValue(monitorTarget, hoverChannel, $dmxActivity);

  onMount(() => {
    collectPathOptions();
    void dmxStore.refreshStatus();
    statusTimer = setInterval(() => { if ($dmxStore.enabled) void dmxStore.refreshStatus(); }, 1000);
    resizeObserver = new ResizeObserver(() => scheduleDraw());
    if (monitorCanvas) resizeObserver.observe(monitorCanvas);
    scheduleDraw();
  });

  onDestroy(() => {
    if (statusTimer) clearInterval(statusTimer);
    resizeObserver?.disconnect();
    if (drawFrame) cancelAnimationFrame(drawFrame);
  });
</script>

<div class="dmx-input" data-help-page="settings">
  <article class="pm-card">
    <header class="card-header">
      <label class="power-toggle" title="Listen for Art-Net and sACN">
        <input
          type="checkbox"
          checked={state.enabled}
          aria-label="DMX input"
          onchange={(event) => dmxStore.setEnabled((event.target as HTMLInputElement).checked)}
        />
        <span></span>
      </label>
      <strong class="card-title">Input</strong>
      <span class="state" class:live={stateLabel === 'LISTENING'} class:error={stateLabel === 'ERROR'}>{stateLabel}</span>
    </header>
    <div class="output-grid">
      <label class="wide">
        <span>Listen on</span>
        <select
          value={state.bindAddress}
          aria-label="Bind address"
          onchange={(event) => dmxStore.setNetwork({ bindAddress: (event.target as HTMLSelectElement).value })}
        >
          <option value="0.0.0.0">All interfaces (0.0.0.0)</option>
          {#each interfaces as item (item.name + item.address)}
            <option value={item.address}>{item.name} ({item.address})</option>
          {/each}
          {#if state.bindAddress !== '0.0.0.0' && !interfaces.some(item => item.address === state.bindAddress)}
            <option value={state.bindAddress}>{state.bindAddress}</option>
          {/if}
        </select>
      </label>
      <label>
        <span>Merge</span>
        <select
          value={state.mergeMode}
          aria-label="Merge rule"
          onchange={(event) => dmxStore.setMerge({ mergeMode: (event.target as HTMLSelectElement).value as DmxMergeMode })}
        >
          {#each Object.entries(MERGE_LABEL) as [value, label] (value)}
            <option {value}>{label}</option>
          {/each}
        </select>
      </label>
      <label>
        <span>Source timeout (s)</span>
        <input
          type="number"
          min="0.25"
          max="30"
          step="0.25"
          value={state.timeoutMs / 1000}
          aria-label="Source timeout in seconds"
          onchange={(event) => dmxStore.setMerge({ timeoutMs: Math.round(numberFrom(event, 2.5) * 1000) })}
        />
      </label>
      <label class="wide">
        <span>Universes</span>
        <input
          type="text"
          placeholder="All (first 64 seen)"
          bind:value={filterText}
          class:invalid={!!filterError}
          aria-label="Universe filter"
          onfocus={() => { filterFocused = true; }}
          onblur={() => { filterFocused = false; commitFilter(); }}
          onkeydown={(event) => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); }}
        />
      </label>
      <label class="check-option inline">
        <input
          type="checkbox"
          checked={state.artnet}
          onchange={(event) => dmxStore.setNetwork({ artnet: (event.target as HTMLInputElement).checked })}
        />
        <span>Art-Net (UDP 6454)</span>
      </label>
      <label class="check-option inline">
        <input
          type="checkbox"
          checked={state.sacn}
          onchange={(event) => dmxStore.setNetwork({ sacn: (event.target as HTMLInputElement).checked })}
        />
        <span>sACN (UDP 5568)</span>
      </label>
      <label class="check-option">
        <input
          type="checkbox"
          checked={state.sacnMulticast}
          disabled={!state.sacn}
          onchange={(event) => dmxStore.setNetwork({ sacnMulticast: (event.target as HTMLInputElement).checked })}
        />
        <span>Join sACN multicast for the listed universes (unicast sACN always works)</span>
      </label>
    </div>
    {#if filterError}<p class="issue">{filterError}</p>{/if}
    <div class="stats-row">
      {#if state.enabled && status?.running}
        <span><b>{status.stats.accepted.toLocaleString()}</b> packets</span>
        <span><b>{status.universes.filter(entry => entry.live).length}</b> live {status.universes.filter(entry => entry.live).length === 1 ? 'universe' : 'universes'}</span>
        <span class:warn={status.stats.malformed > 0}><b>{status.stats.malformed.toLocaleString()}</b> malformed</span>
        {#if status.stats.filtered > 0}<span><b>{status.stats.filtered.toLocaleString()}</b> filtered</span>{/if}
        {#if status.stats.outOfOrder > 0}<span><b>{status.stats.outOfOrder.toLocaleString()}</b> out of order</span>{/if}
        {#if state.lastError}<span class="error-text">{state.lastError}</span>{/if}
      {:else if state.lastError}
        <span class="error-text">{state.lastError}</span>
      {:else}
        <span>Off. Turn on to let a lighting desk drive the show over Art-Net or sACN.</span>
      {/if}
    </div>
  </article>

  <div class="list-title">
    <span>Monitor</span>
    {#if monitorOptions.length > 0}
      <select class="monitor-select" bind:value={monitorKey} aria-label="Monitored universe">
        {#each monitorOptions as option (option.key)}
          <option value={option.key}>{PROTOCOL_LABEL[option.protocol]} universe {option.universe}</option>
        {/each}
      </select>
    {/if}
  </div>
  <article class="pm-card monitor-card">
    <canvas
      class="monitor-canvas"
      bind:this={monitorCanvas}
      aria-label="Incoming DMX channel levels"
      onmousemove={(event) => { hoverChannel = channelAt(event); }}
      onmouseleave={() => { hoverChannel = null; }}
    ></canvas>
    <div class="stats-row">
      {#if hoverChannel !== null}
        <span>Channel <b>{hoverChannel}</b> = <b>{hoverValue}</b> ({Math.round(((hoverValue ?? 0) / 255) * 100)}%)</span>
      {:else if monitorTarget}
        <span>Hover a cell for its channel and value. Outlined cells are bound.</span>
      {:else}
        <span>No universe yet. Values appear here as soon as a desk sends.</span>
      {/if}
      {#each monitorSources as source (source.address + source.name)}
        <span class="source">{source.name || source.address} {source.name ? `(${source.address})` : ''} · priority {source.priority}</span>
      {/each}
    </div>
  </article>

  <div class="list-title">
    <span>Bindings ({state.bindings.length})</span>
    <button class="add-button" onclick={addManualBinding} title="Add a binding for the monitored universe">+ Add binding</button>
  </div>

  <article class="pm-card">
    <div class="learn-form">
      <label class="learn-path">
        <span>Target</span>
        <input
          type="text"
          list="dmx-path-options"
          bind:value={learnPath}
          class:invalid={!learnValid.valid}
          aria-label="Learn target path"
          onfocus={collectPathOptions}
          onkeydown={(event) => { if (event.key === 'Enter') startLearn(); }}
        />
        <datalist id="dmx-path-options">
          {#each pathOptions as option (option.path)}
            <option value={option.path}>{option.label}</option>
          {/each}
        </datalist>
      </label>
      <label>
        <span>Mode</span>
        <select bind:value={learnMode} aria-label="Learn mode">
          <option value="auto">Auto</option>
          <option value="8bit">8-bit</option>
          <option value="16bit">16-bit</option>
          <option value="trigger">Button</option>
        </select>
      </label>
      <label>
        <span>Min</span>
        <input type="number" step="any" bind:value={learnMin} aria-label="Learn minimum" />
      </label>
      <label>
        <span>Max</span>
        <input type="number" step="any" bind:value={learnMax} aria-label="Learn maximum" />
      </label>
      {#if state.learn}
        <button class="learn-button active" onclick={() => dmxStore.cancelLearn()}>Cancel</button>
      {:else}
        <button class="learn-button" disabled={!learnValid.valid} onclick={startLearn}>Learn</button>
      {/if}
    </div>
    {#if state.learn}
      <div class="learn-banner">
        <span class="pulse"></span>
        <span>
          Move a fader or press a button on the desk to bind
          <strong>{state.learn.label ?? state.learn.path}</strong>.
          {#if !state.listening}Turn DMX input on first.{/if}
        </span>
      </div>
    {:else if !learnValid.valid}
      <p class="issue">{learnValid.reason}</p>
    {:else}
      <p class="section-note">
        Routes to <code>{normalizeControlPath(learnPath)}</code>. You can also turn on MIDI edit mode, click any control,
        and move a desk fader: DMX learns it with the control's own range.
      </p>
    {/if}
  </article>

  {#if state.bindings.length === 0}
    <div class="empty">No bindings. Pick a target and press <strong>Learn</strong>, then move a fader on your desk.</div>
  {:else}
    <div class="binding-table" role="table" aria-label="DMX bindings">
      <div class="binding-row head" role="row">
        <span>Source</span>
        <span>Ch</span>
        <span>Mode</span>
        <span>Target</span>
        <span>Range / trigger</span>
        <span>Inv</span>
        <span>Now</span>
        <span></span>
      </div>
      {#each state.bindings as binding (binding.id)}
        {@const position = bindingPosition(binding, $dmxActivity)}
        <div class="binding-row" role="row" class:learned={state.lastLearnedId === binding.id}>
          <div class="source-cell">
            <select
              value={binding.protocol}
              aria-label="Protocol"
              onchange={(event) => {
                const protocol = (event.target as HTMLSelectElement).value as DmxProtocol;
                dmxStore.updateBinding(binding.id, { protocol, universe: Math.max(minUniverseFor(protocol), Math.min(maxUniverseFor(protocol), binding.universe)) });
              }}
            >
              <option value="artnet">Art-Net</option>
              <option value="sacn">sACN</option>
            </select>
            <input
              type="number"
              min={minUniverseFor(binding.protocol)}
              max={maxUniverseFor(binding.protocol)}
              value={binding.universe}
              aria-label="Universe"
              title="Universe"
              onchange={(event) => dmxStore.updateBinding(binding.id, { universe: intFrom(event, binding.universe) })}
            />
          </div>
          <div class="channel-cell">
            <input
              type="number"
              min="1"
              max="512"
              value={binding.channel}
              aria-label={binding.mode === '16bit' ? 'Coarse channel' : 'Channel'}
              title={binding.mode === '16bit' ? 'Coarse channel' : 'Channel'}
              onchange={(event) => dmxStore.updateBinding(binding.id, { channel: intFrom(event, binding.channel) })}
            />
            {#if binding.mode === '16bit'}
              <input
                type="number"
                min="1"
                max="512"
                value={fineChannelOf(binding)}
                aria-label="Fine channel"
                title="Fine channel"
                onchange={(event) => dmxStore.updateBinding(binding.id, { fineChannel: intFrom(event, fineChannelOf(binding)) })}
              />
            {/if}
          </div>
          <select
            value={binding.mode}
            aria-label="Binding mode"
            onchange={(event) => dmxStore.updateBinding(binding.id, { mode: (event.target as HTMLSelectElement).value as DmxBindingMode })}
          >
            {#each Object.entries(MODE_LABEL) as [value, label] (value)}
              <option {value}>{label}</option>
            {/each}
          </select>
          <input
            type="text"
            list="dmx-path-options"
            value={binding.path}
            class:invalid={!validateControlPath(binding.path).valid}
            title={binding.label ?? validateControlPath(binding.path).reason ?? binding.path}
            aria-label="Target path"
            onfocus={collectPathOptions}
            onchange={(event) => dmxStore.updateBinding(binding.id, { path: (event.target as HTMLInputElement).value })}
          />
          <div class="range-cell">
            {#if binding.mode === 'trigger'}
              <input
                type="number"
                min="1"
                max="255"
                value={binding.threshold}
                aria-label="Trigger threshold"
                title="Pressed at or above this DMX value (1-255)"
                onchange={(event) => dmxStore.updateBinding(binding.id, { threshold: intFrom(event, binding.threshold) })}
              />
              <input
                type="number"
                min="0"
                max="127"
                value={binding.hysteresis}
                aria-label="Trigger hysteresis"
                title="Released below threshold minus this"
                onchange={(event) => dmxStore.updateBinding(binding.id, { hysteresis: intFrom(event, binding.hysteresis) })}
              />
            {:else}
              <input
                type="number"
                step="any"
                value={binding.min}
                aria-label="Output minimum"
                title="Value sent at DMX 0"
                onchange={(event) => dmxStore.updateBinding(binding.id, { min: numberFrom(event, binding.min) })}
              />
              <input
                type="number"
                step="any"
                value={binding.max}
                aria-label="Output maximum"
                title="Value sent at DMX full"
                onchange={(event) => dmxStore.updateBinding(binding.id, { max: numberFrom(event, binding.max) })}
              />
            {/if}
          </div>
          <label class="inv">
            <input
              type="checkbox"
              checked={binding.invert}
              aria-label="Invert"
              onchange={(event) => dmxStore.updateBinding(binding.id, { invert: (event.target as HTMLInputElement).checked })}
            />
          </label>
          <span class="meter" title={position === null ? 'No data yet' : `${Math.round(position * 100)}%`}>
            <span style="width: {position === null ? 0 : Math.round(position * 100)}%"></span>
          </span>
          <button class="remove-button" onclick={() => dmxStore.removeBinding(binding.id)} title="Remove binding" aria-label="Remove binding">×</button>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .dmx-input {
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
    grid-template-columns: 36px minmax(80px, 1fr) auto;
    gap: 8px;
    align-items: center;
    padding: 10px 12px;
    background: #15151b;
    border-bottom: 1px solid #24242a;
  }

  .card-title {
    color: #e7e7eb;
    font-size: 13px;
  }

  input, select, button {
    font: inherit;
  }

  .output-grid input[type='number'],
  .output-grid input[type='text'],
  .output-grid select,
  .learn-form input,
  .learn-form select,
  .binding-row input[type='number'],
  .binding-row input[type='text'],
  .binding-row select,
  .monitor-select {
    min-width: 0;
    width: 100%;
    box-sizing: border-box;
    border: 1px solid #33333a;
    border-radius: 4px;
    background: #09090c;
    color: #e7e7eb;
    padding: 7px 8px;
  }

  input.invalid {
    border-color: #ff6b6b !important;
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

  .state.error {
    color: #ff6b6b;
  }

  .output-grid,
  .learn-form {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px;
    padding: 10px 12px;
    align-items: end;
  }

  .learn-form {
    grid-template-columns: minmax(0, 2.4fr) minmax(0, 1fr) 70px 70px auto;
  }

  .output-grid label,
  .learn-form label {
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
    grid-column: 1 / -1;
  }

  .check-option.inline {
    grid-column: span 1;
    white-space: nowrap;
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

  .stats-row .source {
    color: #a5a5ae;
  }

  .error-text,
  .issue {
    color: #ff8a8a;
  }

  .issue,
  .section-note {
    margin: 0;
    padding: 0 12px 10px;
    font-size: 11px;
    line-height: 1.45;
  }

  .section-note {
    color: #777781;
  }

  .section-note code {
    color: var(--ga-blue-300);
  }

  .list-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-top: 6px;
    color: #777781;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }

  .monitor-select {
    width: auto;
    padding: 4px 6px;
    font-size: 11px;
    text-transform: none;
    letter-spacing: 0;
    font-weight: 500;
  }

  .add-button,
  .learn-button,
  .remove-button {
    border: 1px solid #323239;
    border-radius: 4px;
    background: #141419;
    color: #8c8c96;
    cursor: pointer;
    font-size: 12px;
  }

  .add-button {
    padding: 5px 8px;
    font-size: 11px;
    text-transform: none;
    letter-spacing: 0;
    font-weight: 500;
  }

  .add-button:hover,
  .learn-button:hover:not(:disabled) {
    border-color: var(--ga-blue-300);
    color: var(--ga-blue-300);
  }

  .learn-button {
    padding: 7px 14px;
  }

  .learn-button:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .learn-button.active {
    border-color: #fbbf24;
    color: #fbbf24;
    background: rgba(251, 191, 36, 0.08);
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

  .monitor-card {
    padding: 8px 8px 0;
  }

  .monitor-canvas {
    display: block;
    width: 100%;
    height: 192px;
    cursor: crosshair;
  }

  .monitor-card .stats-row {
    margin: 0 -8px;
  }

  .learn-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 12px 10px;
    padding: 8px 10px;
    border: 1px solid rgba(251, 191, 36, 0.4);
    border-radius: 4px;
    background: rgba(251, 191, 36, 0.06);
    color: #e7e7eb;
    font-size: 12px;
  }

  .pulse {
    width: 8px;
    height: 8px;
    flex: 0 0 8px;
    border-radius: 50%;
    background: #fbbf24;
    animation: dmx-pulse 1s ease-in-out infinite;
  }

  @keyframes dmx-pulse {
    50% { opacity: 0.25; }
  }

  .empty {
    color: #70707a;
    font-size: 11px;
    line-height: 1.45;
    padding: 10px 12px;
    border: 1px dashed #2a2a30;
    border-radius: 6px;
  }

  .binding-table {
    display: grid;
    gap: 4px;
  }

  .binding-row {
    display: grid;
    grid-template-columns: minmax(130px, 1.2fr) minmax(56px, 0.6fr) minmax(76px, 0.7fr) minmax(120px, 2fr) minmax(110px, 1fr) 28px 56px 28px;
    gap: 6px;
    align-items: center;
    padding: 6px 8px;
    border: 1px solid #2a2a30;
    border-radius: 5px;
    background: #111116;
  }

  .binding-row.head {
    border: 0;
    background: none;
    padding-top: 0;
    padding-bottom: 0;
    color: #686873;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .binding-row.learned {
    border-color: var(--ga-blue-300);
    background: var(--ga-blue-a08);
  }

  .binding-row input,
  .binding-row select {
    padding: 5px 6px !important;
    font-size: 11px;
  }

  .source-cell,
  .channel-cell,
  .range-cell {
    display: flex;
    gap: 4px;
    min-width: 0;
  }

  .source-cell select {
    flex: 1.3;
  }

  .source-cell input {
    flex: 1;
  }

  .inv {
    display: grid;
    place-items: center;
  }

  .inv input {
    accent-color: var(--ga-blue-300);
  }

  .meter {
    height: 6px;
    border-radius: 3px;
    background: #0b0b0f;
    border: 1px solid #26262c;
    overflow: hidden;
  }

  .meter span {
    display: block;
    height: 100%;
    background: var(--ga-blue-300);
  }
</style>
