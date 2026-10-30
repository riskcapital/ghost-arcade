<script lang="ts">
  /**
   * Signals — continuous values from Live driving Ghost Arcade controls:
   * any device knob or rack macro, a track's level, how far a clip is
   * through its loop, or the colour of whatever launched last.
   */
  import { abletonBridge, abletonSignalLevels, type AbletonBridgeState } from '../../ableton/abletonBridge';
  import { liveColor } from '../../ableton/abletonLinks';
  import type { SignalLink, SignalSource, SignalTarget } from '../../ableton/abletonScore';
  import { macros } from '../../stores/macros';

  export let bridge: AbletonBridgeState;
  /** Let the user click any Ghost Arcade control; resolves null if cancelled. */
  export let pickTarget: () => Promise<SignalTarget | null>;

  type Kind = SignalSource['kind'];
  const KINDS: { kind: Kind; label: string; hint: string }[] = [
    { kind: 'param', label: 'Knob', hint: 'Any device knob or rack macro' },
    { kind: 'level', label: 'Track level', hint: 'How loud a track is' },
    { kind: 'phrase', label: 'Loop progress', hint: 'Rises across the playing clip' },
    { kind: 'color', label: 'Launch color', hint: 'Hue of what launched last' },
  ];

  let adding = false;
  let kind: Kind = 'param';
  let track = 0;
  let device = 0;
  let param = 0;
  let target: SignalTarget | null = null;

  $: tracks = [...bridge.tracks.map((t, i) => ({ index: i, name: t.name || `Track ${i + 1}`, color: t.color })),
    ...(kind === 'param' || kind === 'level' ? [{ index: -1, name: 'Master', color: 0x888780 }] : []),
    ...(kind === 'color' ? [{ index: -1, name: 'Scenes', color: 0x888780 }] : [])];
  $: devices = bridge.devices[track] ?? null;
  $: params = devices?.[device]?.params ?? [];
  // Every device's first parameter is its on/off switch; start past it.
  $: if (param === 0 && params[0]?.name === 'Device On' && params.length > 1) param = 1;
  $: macroTargets = $macros.macros.map((m, i) => ({ path: `vj:macro:${i + 1}:value`, label: `Macro · ${m.name}`, min: 0, max: 1 }));
  $: if (adding && kind === 'param' && bridge.connected && !bridge.devices[track]) abletonBridge.requestDevices(track);

  function startAdding(k: Kind) {
    kind = k;
    track = k === 'color' ? -1 : 0;
    device = 0;
    param = 0;
    target = null;
    adding = true;
  }

  function trackName(state: AbletonBridgeState, k: Kind, index: number) {
    if (index === -1) return k === 'color' ? 'Scenes' : 'Master';
    return state.tracks[index]?.name ?? '';
  }

  // Takes everything it reads so the form re-checks as devices load.
  function sourceFor(state: AbletonBridgeState, k: Kind, t: number, list: typeof devices, d: number, p: number): SignalSource | null {
    const name = trackName(state, k, t);
    if (k === 'param') {
      const dev = list?.[d];
      const par = dev?.params[p];
      if (!dev || !par) return null;
      return { kind: k, track: t, device: d, param: p, trackName: name, deviceName: dev.name, paramName: par.name };
    }
    return { kind: k, track: t, trackName: name } as SignalSource;
  }
  $: pending = sourceFor(bridge, kind, track, devices, device, param);

  async function pick() {
    const picked = await pickTarget();
    if (picked) target = picked;
  }

  function add() {
    if (!pending || !target) return;
    abletonBridge.addSignal(pending, target);
    adding = false;
  }

  function describe(source: SignalSource): { title: string; sub: string } {
    const name = source.track === -1 ? (source.kind === 'color' ? 'Scenes' : 'Master') : source.trackName || `Track ${source.track + 1}`;
    switch (source.kind) {
      case 'param': return { title: `${source.deviceName} · ${source.paramName}`, sub: name };
      case 'level': return { title: 'Level', sub: name };
      case 'phrase': return { title: 'Loop progress', sub: name };
      case 'color': return { title: 'Launch color', sub: name };
    }
  }

  function trackColor(state: AbletonBridgeState, source: SignalSource) {
    return liveColor(source.track >= 0 ? state.tracks[source.track]?.color ?? 0x888780 : 0x888780);
  }

  function setRange(link: SignalLink, key: 'min' | 'max', value: string) {
    const n = Number(value);
    if (Number.isFinite(n)) abletonBridge.updateSignal(link.id, { target: { ...link.target, [key]: n } });
  }
</script>

<div class="signals">
  <div class="add-bar">
    <span class="label">Add</span>
    {#each KINDS as k}
      <button class="add" class:active={adding && kind === k.kind} onclick={() => startAdding(k.kind)} title={k.hint}>+ {k.label}</button>
    {/each}
  </div>

  {#if adding}
    <div class="form">
      <label>
        <span>{kind === 'color' ? 'From' : 'Track'}</span>
        <select bind:value={track} onchange={() => { device = 0; param = 0; }}>
          {#each tracks as t (t.index)}<option value={t.index} translate="no">{t.name}</option>{/each}
        </select>
      </label>
      {#if kind === 'param'}
        <label>
          <span>Device</span>
          <select bind:value={device} onchange={() => (param = 0)} disabled={!devices?.length}>
            {#if devices === null}<option>Loading…</option>{:else if !devices.length}<option>No devices</option>{/if}
            {#each devices ?? [] as d, i}<option value={i} translate="no">{d.name}</option>{/each}
          </select>
        </label>
        <label>
          <span>Knob</span>
          <select bind:value={param} disabled={!params.length}>
            {#each params as p, i}<option value={i} translate="no">{p.name}</option>{/each}
          </select>
        </label>
      {/if}
      <span class="arrow">→</span>
      <label class="grow">
        <span>Ghost Arcade control</span>
        <div class="target-row">
          <select onchange={(e) => { const t = macroTargets[Number((e.target as HTMLSelectElement).value)]; if (t) target = t; }}>
            <option value="">{target ? target.label : 'Choose a macro…'}</option>
            {#each macroTargets as m, i}<option value={i}>{m.label}</option>{/each}
          </select>
          <button class="ghost" onclick={pick} title="Click any slider or knob in Ghost Arcade">Pick a control…</button>
        </div>
      </label>
      <button class="solid" disabled={!target || !pending} onclick={add}>Add signal</button>
      <button class="ghost" onclick={() => (adding = false)}>Cancel</button>
    </div>
  {/if}

  {#if !bridge.signals.length && !adding}
    <div class="intro">
      <b>Let the music move the visuals.</b>
      <p>Turn a filter in Live and open a blur in Ghost Arcade. Let the kick track pump a macro. Build intensity across a 16-bar riser, or tint the output with each scene's colour. Works with any device and rack macro — no Max for Live needed.</p>
    </div>
  {/if}

  {#each bridge.signals as link (link.id)}
    {@const d = describe(link.source)}
    <div class="row">
      <span class="swatch" style="background: {trackColor(bridge, link.source)}"></span>
      <span class="src"><b>{d.title}</b><small>{d.sub}</small></span>
      <span class="meter"><span style="transform: scaleX({$abletonSignalLevels[link.id] ?? 0})"></span></span>
      <span class="arrow">→</span>
      <span class="tgt" title={link.target.path}>{link.target.label}</span>
      <label class="range" title="Range of the control this sweeps">
        <input type="number" step="any" value={link.target.min} onchange={(e) => setRange(link, 'min', (e.target as HTMLInputElement).value)} />
        <span>to</span>
        <input type="number" step="any" value={link.target.max} onchange={(e) => setRange(link, 'max', (e.target as HTMLInputElement).value)} />
      </label>
      <label class="check" title="Flip the direction"><input type="checkbox" checked={link.invert} onchange={(e) => abletonBridge.updateSignal(link.id, { invert: (e.target as HTMLInputElement).checked })} /> Invert</label>
      <label class="smooth" title="Glide toward new values">
        <span>Smooth</span>
        <input type="range" min="0" max="1" step="0.05" value={link.smooth} disabled={link.source.kind === 'color'} oninput={(e) => abletonBridge.updateSignal(link.id, { smooth: Number((e.target as HTMLInputElement).value) })} />
      </label>
      <button class="x" onclick={() => abletonBridge.removeSignal(link.id)} title="Remove signal" aria-label="Remove signal">
        <svg width="9" height="9" viewBox="0 0 10 10" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M1 1l8 8M9 1 1 9"/></svg>
      </button>
    </div>
  {/each}
  {#if bridge.signals.some(l => l.source.kind === 'level')}
    <p class="note">Live only measures track levels while its mixer meters are on screen.</p>
  {/if}
</div>

<style>
  .signals { display: flex; flex-direction: column; gap: 8px; }
  .add-bar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .label { font-size: var(--ga-text-eyebrow, 10px); font-weight: 700; letter-spacing: var(--ga-eyebrow-tracking, 0.08em); text-transform: uppercase; color: var(--ga-ink-2, #8a909b); margin-right: 4px; }
  .add, .ghost, .solid { height: var(--ga-control-h, 26px); padding: 0 10px; border-radius: var(--ga-r-hard, 5px); font: inherit; font-weight: var(--ga-weight-control, 600); cursor: pointer; white-space: nowrap; }
  .add { border: 1px dashed var(--ga-line-3); background: transparent; color: var(--ga-ink-1, #b8bdc6); }
  .add:hover { color: var(--ga-ink-0, #eef0f4); border-color: var(--ga-line-3); }
  .add.active { background: var(--ga-selection-bg); color: var(--ga-selection-ink); border-color: var(--ga-selection-line); border-style: solid; }
  .ghost { border: 1px solid var(--ga-line-2); background: transparent; color: var(--ga-ink-1, #b8bdc6); }
  .ghost:hover { color: var(--ga-ink-0, #eef0f4); }
  .solid { border: 1px solid var(--ga-violet-line, transparent); border-radius: var(--ga-r-soft, 8px); background: var(--ga-accent-gradient, var(--ga-ink-0, #eef0f4)); color: var(--ga-void, #07090d); }
  .solid:disabled { opacity: 0.35; cursor: default; }
  .form { display: flex; align-items: flex-end; gap: 8px; flex-wrap: wrap; padding: 10px; border: 1px solid color-mix(in srgb, var(--ga-selection-line) 45%, transparent); border-radius: var(--ga-r-hard, 5px); background: color-mix(in srgb, var(--ga-selection-bg) 40%, transparent); }
  .form label { display: flex; flex-direction: column; gap: 3px; }
  .form label > span { font-size: var(--ga-text-meta, 11px); color: var(--ga-ink-1, #8a909b); }
  .form .grow { flex: 1; min-width: 240px; }
  .target-row { display: flex; gap: 6px; }
  .target-row select { flex: 1; }
  select, input[type='number'] {
    height: var(--ga-control-h, 26px);
    box-sizing: border-box;
    background: var(--ga-slot);
    color: var(--ga-ink-0, #eef0f4);
    border: 1px solid var(--ga-line-2);
    border-radius: var(--ga-r-hard, 5px);
    font: inherit;
    padding: 0 6px;
    min-width: 0;
  }
  select { max-width: 220px; }
  .arrow { color: var(--ga-ink-2, #8a909b); padding-bottom: 4px; }
  .intro { padding: 10px 12px; border: 1px solid color-mix(in srgb, var(--ga-selection-line) 45%, transparent); background: color-mix(in srgb, var(--ga-selection-bg) 45%, transparent); border-radius: var(--ga-r-hard, 5px); }
  .intro b { font-weight: 600; }
  .intro p { margin: 4px 0 0; color: var(--ga-ink-1, #b8bdc6); line-height: 1.5; }
  .row { display: flex; align-items: center; gap: 10px; padding: 6px 8px; border: 1px solid var(--ga-line-1); border-radius: var(--ga-r-hard, 5px); background: var(--ga-card); }
  .swatch { width: 4px; align-self: stretch; border-radius: 2px; }
  .src { width: 190px; display: flex; flex-direction: column; min-width: 0; }
  .src b { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .src small { color: var(--ga-ink-2, #8a909b); font-size: var(--ga-text-meta, 11px); }
  .meter { width: 90px; height: 6px; background: rgba(255, 255, 255, 0.08); border-radius: var(--ga-r-hard, 5px); overflow: hidden; flex: 0 0 auto; }
  .meter span { display: block; height: 100%; background: var(--ga-selection-line); transform-origin: left center; }
  .tgt { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .range { display: flex; align-items: center; gap: 4px; color: var(--ga-ink-2, #8a909b); }
  .range input { width: 64px; }
  .check { display: flex; align-items: center; gap: 4px; color: var(--ga-ink-1, #b8bdc6); white-space: nowrap; }
  .smooth { display: flex; align-items: center; gap: 6px; color: var(--ga-ink-2, #8a909b); }
  .smooth input { width: 80px; }
  .x { width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; border: 1px solid var(--ga-line-2); border-radius: var(--ga-r-hard, 5px); background: transparent; color: var(--ga-ink-1, #b8bdc6); cursor: pointer; }
  .note { margin: 0; font-size: 11px; color: var(--ga-ink-2, #8a909b); }
</style>
