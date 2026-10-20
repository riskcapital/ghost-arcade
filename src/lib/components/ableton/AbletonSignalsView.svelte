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

  function trackName(index: number) {
    if (index === -1) return kind === 'color' ? 'Scenes' : 'Master';
    return bridge.tracks[index]?.name ?? '';
  }

  // Takes everything it reads so the form re-checks as devices load.
  function sourceFor(k: Kind, t: number, list: typeof devices, d: number, p: number): SignalSource | null {
    const name = trackName(t);
    if (k === 'param') {
      const dev = list?.[d];
      const par = dev?.params[p];
      if (!dev || !par) return null;
      return { kind: k, track: t, device: d, param: p, trackName: name, deviceName: dev.name, paramName: par.name };
    }
    return { kind: k, track: t, trackName: name } as SignalSource;
  }
  $: pending = sourceFor(kind, track, devices, device, param);

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

  function trackColor(source: SignalSource) {
    return liveColor(source.track >= 0 ? bridge.tracks[source.track]?.color ?? 0x888780 : 0x888780);
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
          {#each tracks as t (t.index)}<option value={t.index}>{t.name}</option>{/each}
        </select>
      </label>
      {#if kind === 'param'}
        <label>
          <span>Device</span>
          <select bind:value={device} onchange={() => (param = 0)} disabled={!devices?.length}>
            {#if devices === null}<option>Loading…</option>{:else if !devices.length}<option>No devices</option>{/if}
            {#each devices ?? [] as d, i}<option value={i}>{d.name}</option>{/each}
          </select>
        </label>
        <label>
          <span>Knob</span>
          <select bind:value={param} disabled={!params.length}>
            {#each params as p, i}<option value={i}>{p.name}</option>{/each}
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
      <span class="swatch" style="background: {trackColor(link.source)}"></span>
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
  .label { font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ga-ink-2, #8a909b); margin-right: 4px; }
  .add, .ghost, .solid { height: 26px; padding: 0 10px; border-radius: 3px; font: inherit; cursor: pointer; white-space: nowrap; }
  .add { border: 1px dashed rgba(255, 255, 255, 0.2); background: transparent; color: var(--ga-ink-1, #b8bdc6); }
  .add:hover, .add.active { color: var(--ga-ink-0, #eef0f4); border-color: #c9c4ff; }
  .ghost { border: 1px solid rgba(255, 255, 255, 0.14); background: transparent; color: var(--ga-ink-1, #b8bdc6); }
  .ghost:hover { color: var(--ga-ink-0, #eef0f4); }
  .solid { border: none; background: var(--ga-ink-0, #eef0f4); color: #07090d; font-weight: 600; }
  .solid:disabled { opacity: 0.35; cursor: default; }
  .form { display: flex; align-items: flex-end; gap: 8px; flex-wrap: wrap; padding: 10px; border: 1px solid rgba(201, 196, 255, 0.3); border-radius: 4px; background: rgba(127, 119, 221, 0.06); }
  .form label { display: flex; flex-direction: column; gap: 3px; }
  .form label > span { font-size: 10px; color: var(--ga-ink-2, #8a909b); }
  .form .grow { flex: 1; min-width: 240px; }
  .target-row { display: flex; gap: 6px; }
  .target-row select { flex: 1; }
  select, input[type='number'] {
    height: 26px;
    background: #000;
    color: var(--ga-ink-0, #eef0f4);
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 3px;
    font: inherit;
    padding: 0 6px;
    min-width: 0;
  }
  select { max-width: 220px; }
  .arrow { color: var(--ga-ink-2, #8a909b); padding-bottom: 4px; }
  .intro { padding: 10px 12px; border: 1px solid rgba(127, 119, 221, 0.35); background: rgba(127, 119, 221, 0.08); border-radius: 4px; }
  .intro b { font-weight: 600; }
  .intro p { margin: 4px 0 0; color: var(--ga-ink-1, #b8bdc6); line-height: 1.5; }
  .row { display: flex; align-items: center; gap: 10px; padding: 6px 8px; border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 3px; background: rgba(255, 255, 255, 0.02); }
  .swatch { width: 4px; align-self: stretch; border-radius: 2px; }
  .src { width: 190px; display: flex; flex-direction: column; min-width: 0; }
  .src b { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .src small { color: var(--ga-ink-2, #8a909b); font-size: 10px; }
  .meter { width: 90px; height: 6px; background: rgba(255, 255, 255, 0.08); border-radius: 3px; overflow: hidden; flex: 0 0 auto; }
  .meter span { display: block; height: 100%; background: linear-gradient(90deg, #7f77dd, #c9c4ff); transform-origin: left center; }
  .tgt { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .range { display: flex; align-items: center; gap: 4px; color: var(--ga-ink-2, #8a909b); }
  .range input { width: 64px; }
  .check { display: flex; align-items: center; gap: 4px; color: var(--ga-ink-1, #b8bdc6); white-space: nowrap; }
  .smooth { display: flex; align-items: center; gap: 6px; color: var(--ga-ink-2, #8a909b); }
  .smooth input { width: 80px; }
  .x { width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 3px; background: transparent; color: var(--ga-ink-1, #b8bdc6); cursor: pointer; }
  .note { margin: 0; font-size: 11px; color: var(--ga-ink-2, #8a909b); }
</style>
