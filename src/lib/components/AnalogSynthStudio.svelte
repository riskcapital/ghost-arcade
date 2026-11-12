<script lang="ts">
  /**
   * Analog Synth, full screen: the instrument as a two-row rack sized to fit
   * the window. The top row makes the picture (three oscillators, the mixer,
   * the output monitor); the bottom row shapes and moves it (picture,
   * feedback, tube) and holds the modulation (LFOs, music, input) and the
   * morph pad. Patch cables hang over the panel as in the Music Studio: drag
   * from an output (on its cream plate) to an input; drag a plugged input to
   * move its cable, or Alt-click it to unplug. Normals, the connections an
   * input has with nothing plugged in, can be shown as dashed cables.
   */
  import { onDestroy, onMount, tick } from 'svelte';
  import { get } from 'svelte/store';
  import './music/studioTokens.css';
  import './music/cableStyles.css';
  import StudioKnob from './music/StudioKnob.svelte';
  import { portal } from '../utils/portal';
  import { nativePreviewClaim, nativePreviewHostEl } from '../stores/nativePreviewHost';
  import { NATIVE_ENGINE_ONLY } from '../stores/settings';
  import { isDesktopApp } from '$lib/bridge';
  import { getNativeRendererCapabilities } from '$lib/api/native-renderer';
  import { project } from '../stores/layers';
  import { CABLE_COLORS, CABLE_LIVE_COLOR, cablePath } from '../music/cableLook';
  import {
    INPUT_JACKS,
    INPUT_LAYER_KEY,
    MORPH_KEY,
    MORPHABLE,
    morphValues,
    paramValue,
    presetValues,
    SNAPSHOTS_KEY,
    SOURCES,
    VIDEOSYNTH_PRESETS,
    type InputJack,
    type Snapshots,
  } from '../videosynth/patch';
  import { formatParam, knobLabel, paramSpec } from '../videosynth/labels';
  import { chooseInputPatch, inputJack, inputUsers, plugPatch, unplugPatch } from '../videosynth/patching';

  let {
    effectSource,
    layers = [],
    midiPrefix = 'map:plugin',
    onpatch,
    onclose,
  }: {
    effectSource: Record<string, unknown>;
    layers?: { id: string; name: string }[];
    midiPrefix?: string;
    onpatch: (patch: Record<string, unknown>, gesture?: string) => void;
    onclose: () => void;
  } = $props();

  const val = (key: string) => paramValue(effectSource, paramSpec(key));
  const sourceOf = (j: InputJack) => val(j.srcKey);
  const cableColor = (source: number) => CABLE_COLORS[(source - 1 + CABLE_COLORS.length) % CABLE_COLORS.length];

  // ── The rack ──
  type Knob = { key: string; size: number };
  type Module = {
    id: string;
    title: string;
    /** Flex basis in px; every module grows a little to fill the row. */
    width: number;
    rows: Knob[][];
    /** A legend and an output at either end of each row (the LFOs). */
    rowLabels?: string[];
    rowOuts?: number[];
    switches: string[];
    ins: string[];
    outs: { source: number; label: string }[];
    input?: boolean;
  };
  const osc = (n: 'A' | 'B' | 'C', out: number): Module => ({
    id: `osc-${n}`,
    title: `Oscillator ${n}`,
    width: 232,
    rows: [
      [{ key: `vs${n}Freq`, size: 54 }, { key: `vs${n}Fine`, size: 34 }],
      [{ key: `vs${n}Sync`, size: 40 }, { key: `vs${n}Shape`, size: 40 }],
      [{ key: `vs${n}Hue`, size: 32 }, { key: `vs${n}Sat`, size: 32 }, { key: `vs${n}Level`, size: 32 }],
    ],
    switches: [`vs${n}ModMode`, `vs${n}Input`],
    ins: [`${n}Mod`, `${n}Fm`, `${n}Level`],
    outs: [{ source: out, label: 'Out' }],
  });
  /** The top row makes the picture; the monitor closes it. */
  const ROW_MAKE: Module[] = [
    osc('A', 2),
    osc('B', 3),
    osc('C', 4),
    { id: 'mixer', title: 'Mixer', width: 112, rows: [], switches: ['vsMix'], ins: [], outs: [{ source: 1, label: 'Out' }] },
  ];
  /** The bottom row shapes and moves it; the morph pad closes it. */
  const ROW_SHAPE: Module[] = [
    {
      id: 'picture', title: 'Picture', width: 212,
      rows: [[{ key: 'vsRotate', size: 42 }, { key: 'vsScale', size: 42 }], [{ key: 'vsX', size: 34 }, { key: 'vsY', size: 34 }, { key: 'vsKaleido', size: 34 }]],
      switches: [], ins: ['RotateIn', 'ScaleIn', 'MoveXIn', 'MoveYIn'], outs: [],
    },
    {
      id: 'feedback', title: 'Feedback', width: 196,
      rows: [[{ key: 'vsFeedback', size: 46 }, { key: 'vsFbZoom', size: 36 }, { key: 'vsFbRotate', size: 36 }], [{ key: 'vsFbX', size: 32 }, { key: 'vsFbY', size: 32 }, { key: 'vsFbHue', size: 32 }]],
      switches: [], ins: ['FbZoomIn', 'FbTurnIn', 'FbHueIn'], outs: [],
    },
    {
      id: 'tube', title: 'Tube', width: 140,
      rows: [[{ key: 'vsScanlines', size: 34 }, { key: 'vsBleed', size: 34 }], [{ key: 'vsRoll', size: 34 }, { key: 'vsGlow', size: 34 }]],
      switches: [], ins: ['RollIn'], outs: [],
    },
    {
      id: 'lfo', title: 'LFOs', width: 196,
      rows: [[{ key: 'vsLfo1Rate', size: 36 }, { key: 'vsLfo1Skew', size: 28 }], [{ key: 'vsLfo2Rate', size: 36 }, { key: 'vsLfo2Skew', size: 28 }], [{ key: 'vsLfo3Rate', size: 36 }, { key: 'vsLfo3Skew', size: 28 }]],
      rowLabels: ['1', '2', '3'], rowOuts: [5, 6, 7],
      switches: [], ins: [], outs: [],
    },
    {
      id: 'music', title: 'Music', width: 250,
      rows: [[{ key: 'vsReact', size: 46 }]],
      switches: [], ins: [],
      outs: [{ source: 8, label: 'Bass' }, { source: 9, label: 'Mids' }, { source: 10, label: 'Highs' }, { source: 11, label: 'Level' }, { source: 12, label: 'Kick' }],
    },
    { id: 'input', title: 'Input', width: 150, rows: [], switches: [], ins: [], outs: [{ source: 13, label: 'In' }], input: true },
  ];

  // ── Presets, randomize, morph ──
  function loadPreset(id: string) {
    if (id) onpatch(presetValues(id));
  }
  function randomize() {
    const r = (a: number, b: number) => a + Math.random() * (b - a);
    const patch: Record<string, number> = {};
    for (const n of ['A', 'B', 'C']) {
      Object.assign(patch, {
        [`vs${n}Freq`]: r(0.2, 0.7), [`vs${n}Sync`]: r(0.5, 2), [`vs${n}Shape`]: r(0, 1),
        [`vs${n}ModMode`]: Math.floor(r(0, 3)), [`vs${n}Mod`]: r(0, 0.6), [`vs${n}Fm`]: r(0, 0.2),
        [`vs${n}Hue`]: r(0, 1), [`vs${n}Sat`]: r(0.5, 1), [`vs${n}Level`]: r(0.5, 1),
      });
    }
    Object.assign(patch, { vsMix: Math.floor(r(0, 3)), vsFeedback: r(0, 0.85), vsFbZoom: r(0.97, 1.03), vsFbRotate: r(-2, 2), vsKaleido: Math.random() < 0.3 ? Math.floor(r(2, 8)) : 0 });
    onpatch(patch);
  }
  const snapshots = $derived<Snapshots>(Array.isArray(effectSource[SNAPSHOTS_KEY]) ? (effectSource[SNAPSHOTS_KEY] as Snapshots).slice(0, 4) : [null, null, null, null]);
  const stored = $derived(snapshots.filter(Boolean).length);
  /** What uses the input layer, shown in the Input module. */
  const inputUse = $derived(inputUsers(effectSource));
  const morph = $derived.by(() => {
    const m = effectSource[MORPH_KEY];
    return Array.isArray(m) && m.length === 2 ? { x: Number(m[0]) || 0, y: Number(m[1]) || 0 } : { x: 0.5, y: 0.5 };
  });
  const current = () => Object.fromEntries(MORPHABLE().map((p) => [p.key, paramValue(effectSource, p)]));
  const store = (i: number) => onpatch({ [SNAPSHOTS_KEY]: [0, 1, 2, 3].map((k) => (k === i ? current() : snapshots[k] ?? null)) });
  const clearCorner = (i: number) => onpatch({ [SNAPSHOTS_KEY]: [0, 1, 2, 3].map((k) => (k === i ? null : snapshots[k] ?? null)) });
  let pad: HTMLDivElement | undefined = $state();
  function movePad(e: PointerEvent) {
    if (!pad || !stored) return;
    const r = pad.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    onpatch({ ...morphValues(snapshots, x, y, current()), [MORPH_KEY]: [x, y] }, 'analog-synth-pad');
  }

  // ── The output in the monitor ──
  let nativePreview = $state(false);
  let hole: HTMLDivElement | undefined = $state();
  let previousHost: HTMLElement | null = null;
  onMount(() => {
    document.body.classList.add('analog-synth-open');
    if (!(isDesktopApp && NATIVE_ENGINE_ONLY)) return;
    let cancelled = false;
    void (async () => {
      while (!cancelled) {
        try {
          const caps = (await getNativeRendererCapabilities()) as { output_shared_texture_export?: { platform?: string } } | null;
          const platform = caps?.output_shared_texture_export?.platform;
          if (platform) {
            nativePreview = platform !== 'unsupported';
            return;
          }
        } catch {
          /* the core is still starting */
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    })();
    return () => (cancelled = true);
  });
  $effect(() => {
    if (!nativePreview || !hole) return;
    const el = hole;
    previousHost = get(nativePreviewHostEl);
    nativePreviewClaim.set('analog-synth');
    nativePreviewHostEl.set(el);
    return () => {
      nativePreviewClaim.set(null);
      if (get(nativePreviewHostEl) === el) nativePreviewHostEl.set(previousHost);
    };
  });
  onDestroy(() => document.body.classList.remove('analog-synth-open'));

  // ── Fit: the rack is laid out at one size and scaled to the window, as a
  // hardware panel would be; spare room in one direction widens the monitor
  // or lets the rows breathe. Below the smallest scale it scrolls. ──
  const DESIGN_W = 1560;
  const DESIGN_H = 780;
  let scrollEl: HTMLDivElement | undefined = $state();
  let fit = $state({ scale: 1, width: DESIGN_W, height: DESIGN_H });
  function fitCase() {
    if (!scrollEl) return;
    const w = scrollEl.clientWidth, h = scrollEl.clientHeight;
    const scale = Math.max(0.7, Math.min(1.6, w / DESIGN_W, h / DESIGN_H));
    fit = { scale, width: Math.max(DESIGN_W, Math.floor(w / scale)), height: Math.max(DESIGN_H, Math.floor(h / scale)) };
    void tick().then(measure);
  }

  // ── Cables ──
  let caseEl: HTMLDivElement | undefined = $state();
  let centers = $state<Record<string, { x: number; y: number }>>({});
  let showNormals = $state(false);
  let drag = $state<{ from: number; x: number; y: number; carried?: InputJack } | null>(null);
  /** Jack centers in the case's own (unscaled) pixels, where the cables are drawn. */
  function measure() {
    if (!caseEl) return;
    const o = caseEl.getBoundingClientRect();
    const s = fit.scale;
    const next: Record<string, { x: number; y: number }> = {};
    for (const el of caseEl.querySelectorAll<HTMLElement>('[data-jack]')) {
      const r = el.getBoundingClientRect();
      next[el.dataset.jack!] = { x: (r.left + r.width / 2 - o.left) / s, y: (r.top + r.height / 2 - o.top) / s };
    }
    centers = next;
  }
  onMount(() => {
    const observer = new ResizeObserver(() => fitCase());
    if (scrollEl) observer.observe(scrollEl);
    const caseObserver = new ResizeObserver(() => measure());
    if (caseEl) caseObserver.observe(caseEl);
    fitCase();
    return () => {
      observer.disconnect();
      caseObserver.disconnect();
    };
  });

  const cables = $derived(
    INPUT_JACKS.flatMap((j) => {
      if (drag?.carried === j) return [];
      const from = sourceOf(j);
      const normal = from === j.normal;
      if (!from || (normal && !showNormals)) return [];
      const a = centers[`out:${from}`], b = centers[`in:${j.id}`];
      if (!a || !b) return [];
      return [{ id: j.id, d: cablePath(a.x, a.y, b.x, b.y, fit.height - 4), color: cableColor(from), normal, a, b }];
    }),
  );
  const liveStart = $derived(drag ? centers[`out:${drag.from}`] : undefined);

  /**
   * While a cable is in the hand, every input can take it: the inputs light
   * up and the outputs step back, as in the Music Studio. Within this many
   * panel pixels of an input the cable snaps to it, so a near miss still
   * plugs in.
   */
  const SNAP = 34;
  let snapTo = $state<string | null>(null);
  function nearestInput(p: { x: number; y: number }): string | null {
    let best: string | null = null;
    let bestDist = SNAP;
    for (const j of INPUT_JACKS) {
      const c = centers[`in:${j.id}`];
      if (!c) continue;
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d < bestDist) {
        best = j.id;
        bestDist = d;
      }
    }
    return best;
  }
  /** Where the live cable's free end is: on the input it snaps to, or in the hand. */
  const liveEnd = $derived(drag ? (snapTo && centers[`in:${snapTo}`]) || drag : undefined);

  const at = (e: PointerEvent) => {
    const o = caseEl!.getBoundingClientRect();
    return { x: (e.clientX - o.left) / fit.scale, y: (e.clientY - o.top) / fit.scale };
  };
  function follow(e: PointerEvent) {
    if (!drag) return;
    drag = { ...drag, ...at(e) };
    snapTo = nearestInput(drag);
  }
  function begin(next: NonNullable<typeof drag>) {
    drag = next;
    window.addEventListener('pointermove', follow);
    window.addEventListener('pointerup', finish, { once: true });
  }
  function fromOutput(source: number, e: PointerEvent) {
    if (e.button !== 0 || !caseEl) return;
    e.preventDefault();
    begin({ from: source, ...at(e) });
  }
  function fromInput(j: InputJack, e: PointerEvent) {
    if (e.button !== 0 || !caseEl) return;
    e.preventDefault();
    const from = sourceOf(j);
    if (e.altKey || e.ctrlKey || e.metaKey) {
      onpatch(unplugPatch(j, from));
      return;
    }
    if (from) begin({ from, carried: j, ...at(e) });
  }
  function finish(e: PointerEvent) {
    window.removeEventListener('pointermove', follow);
    const d = drag;
    const snapped = snapTo;
    drag = null;
    snapTo = null;
    if (!d) return;
    // The input under the pointer (its jack, name or amount knob), or the one the cable snapped to.
    const target = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-input]');
    const into = inputJack(target?.dataset.input ?? snapped ?? '');
    if (into) onpatch(plugPatch(into, d.from, d.carried));
    else if (d.carried) onpatch(unplugPatch(d.carried, sourceOf(d.carried)));
  }

  function onkey(e: KeyboardEvent) {
    if (e.key === 'Escape' && !drag) {
      e.stopPropagation();
      onclose();
    }
  }
  let closeButton: HTMLButtonElement | undefined = $state();
  onMount(() => closeButton?.focus());
</script>

<svelte:window onkeydown={onkey} />

{#snippet screws()}
  <span class="screw tl"></span><span class="screw tr"></span><span class="screw bl"></span><span class="screw br"></span>
{/snippet}

{#snippet outJack(source: number, label: string)}
  <div class="jack-cell out" class:source={drag?.from === source} class:dim={!!drag && drag.from !== source}>
    <button
      class="jack"
      data-jack={`out:${source}`}
      aria-label={`${label} output: drag to an input`}
      title={`${label} out: drag to an input`}
      onpointerdown={(e) => fromOutput(source, e)}
    ></button>
    <span class="jack-name">{label}</span>
  </div>
{/snippet}

{#snippet knob(m: Module, k: Knob)}
  {@const p = paramSpec(k.key)}
  <StudioKnob
    label={knobLabel(k.key)}
    title={`${m.title} · ${p.label}`}
    value={val(k.key)}
    min={p.min}
    max={p.max}
    defaultValue={p.default}
    size={k.size}
    format={formatParam(p)}
    midiPath={`${midiPrefix}:${k.key}`}
    onchange={(v) => onpatch({ [k.key]: p.step === 1 ? Math.round(v) : v }, `analog-synth:${k.key}`)}
  />
{/snippet}

{#snippet moduleView(m: Module)}
  <section class="module" style:flex-basis={`${m.width}px`} aria-label={m.title}>
    {@render screws()}
    <span class="legend">{m.title}</span>
    {#if m.rows.length}
      <div class="knob-rows">
        {#each m.rows as row, ri}
          <div class="knob-row" class:with-out={!!m.rowOuts}>
            {#if m.rowLabels}<span class="row-label">{m.rowLabels[ri]}</span>{/if}
            {#each row as k (k.key)}
              {@render knob(m, k)}
            {/each}
            {#if m.rowOuts}{@render outJack(m.rowOuts[ri], `LFO ${ri + 1}`)}{/if}
          </div>
        {/each}
      </div>
    {/if}
    {#if m.switches.length}
      <div class="switches">
        {#each m.switches as key (key)}
          {@const p = paramSpec(key)}
          <div class="selector" role="radiogroup" aria-label={`${m.title} · ${p.label}`}>
            <span class="legend small">{key.endsWith('Input') ? 'Draws' : key.endsWith('ModMode') ? 'Mod' : 'Mode'}</span>
            {#each p.options ?? [] as option, i}
              <button
                class="position"
                role="radio"
                aria-checked={val(key) === i}
                data-midi-path={`${midiPrefix}:${key}`}
                data-midi-label={`${m.title} · ${p.label}`}
                data-midi-min={0}
                data-midi-max={(p.options?.length ?? 1) - 1}
                onclick={() => onpatch({ [key]: i })}
              >
                <span class="led" class:on={val(key) === i}></span>{option}
              </button>
            {/each}
          </div>
        {/each}
      </div>
    {/if}
    {#if m.input}
      <label class="input-field">
        <span class="legend small">Layer</span>
        <select value={String(effectSource[INPUT_LAYER_KEY] ?? '')} onchange={(e) => onpatch(chooseInputPatch(effectSource, e.currentTarget.value))}>
          <option value="">None</option>
          {#each layers as l (l.id)}
            <option value={l.id}>{l.name}</option>
          {/each}
        </select>
      </label>
      {#if !effectSource[INPUT_LAYER_KEY]}
        <p class="panel-note">{layers.length ? 'Choose a layer, a camera included, to bring its picture into the synth.' : 'Put a clip or a camera on another layer to bring it into the synth.'}</p>
      {:else}
        <div class="input-use" role="status">
          <span class="led" class:on={inputUse.drawnBy.length + inputUse.patchedTo.length > 0}></span>
          <div>
            {#each inputUse.drawnBy as n (n)}
              <p class="panel-note">Oscillator {n} draws it.</p>
            {/each}
            {#each inputUse.patchedTo as j (j.id)}
              <p class="panel-note">Patched to {j.module} {j.label}.</p>
            {/each}
            {#if !inputUse.drawnBy.length && !inputUse.patchedTo.length}
              <p class="panel-note">Nothing uses it yet: set an oscillator to draw Input, or patch In to an input.</p>
            {/if}
          </div>
        </div>
      {/if}
    {/if}
    {#if m.ins.length || m.outs.length}
      <div class="jacks">
        {#each m.ins as id (id)}
          {@const j = inputJack(id)!}
          {@const from = sourceOf(j)}
          {@const a = paramSpec(j.amtKey)}
          <div class="jack-cell" class:accepts={!!drag} class:target={snapTo === j.id} data-input={j.id}>
            <button
              class="jack"
              data-jack={`in:${j.id}`}
              aria-label={`${m.title} ${j.label} input, ${from ? `from ${SOURCES[from]}` : 'empty'}${from && from === j.normal ? ' (normal)' : ''}`}
              title={`${j.label} in: ${from ? SOURCES[from] : 'nothing'}${from && from === j.normal ? ' (normal)' : ''}`}
              onpointerdown={(e) => fromInput(j, e)}
            ></button>
            <span class="jack-name">{j.label}</span>
            <StudioKnob
              label={`${j.label} amount`}
              hideLabel
              title={`${m.title} · ${j.label} amount`}
              value={val(j.amtKey)}
              min={a.min}
              max={a.max}
              defaultValue={a.default}
              size={22}
              format={formatParam(a)}
              midiPath={`${midiPrefix}:${j.amtKey}`}
              onchange={(v) => onpatch({ [j.amtKey]: v }, `analog-synth:${j.amtKey}`)}
            />
          </div>
        {/each}
        {#each m.outs as o (o.source)}
          {@render outJack(o.source, o.label)}
        {/each}
      </div>
    {/if}
  </section>
{/snippet}

<div style="display: contents">
  <div class="synth-app studio-tokens set-analog" class:native={nativePreview} class:patching={!!drag} use:portal role="dialog" aria-modal="true" aria-label="Analog Synth">
    <header class="topbar">
      <span class="app-title">Analog Synth</span>
      <label class="bar-field">
        <span class="sr-only">Preset</span>
        <select value="" onchange={(e) => { loadPreset(e.currentTarget.value); e.currentTarget.value = ''; }}>
          <option value="">Load a preset…</option>
          {#each VIDEOSYNTH_PRESETS as p}
            <option value={p.id}>{p.name}</option>
          {/each}
        </select>
      </label>
      <button class="bar-btn" onclick={randomize} title="A new patch, kept within ranges that make a picture">Randomize</button>
      <button class="bar-btn" aria-pressed={showNormals} onclick={() => (showNormals = !showNormals)} title="Normals are the connections an input has with nothing plugged in">{showNormals ? 'Hide normals' : 'Show normals'}</button>
      <span class="spacer"></span>
      <span class="bar-hint">Drag from an output to an input · Alt-click an input to unplug</span>
      <button class="bar-btn" bind:this={closeButton} onclick={onclose}>Close</button>
    </header>

    <div class="scroll" bind:this={scrollEl}>
      <div class="case face" bind:this={caseEl} style:zoom={fit.scale} style:width={`${fit.width}px`} style:height={`${fit.height}px`}>
        <div class="row make">
          {#each ROW_MAKE as m (m.id)}
            {@render moduleView(m)}
          {/each}
          <section class="module monitor" aria-label="Output">
            {@render screws()}
            <span class="legend">Output</span>
            <div class="bezel" style="--out-w: {Math.max(1, $project.width || 1920)}; --out-h: {Math.max(1, $project.height || 1080)}">
              <div class="screen" bind:this={hole}>
                <span class="frame" aria-hidden="true"></span>
                {#if !nativePreview}<span class="screen-note">The picture plays in the output</span>{/if}
              </div>
            </div>
          </section>
        </div>

        <div class="row shape">
          {#each ROW_SHAPE as m (m.id)}
            {@render moduleView(m)}
          {/each}
          <section class="module plate" aria-label="Morph">
            {@render screws()}
            <div class="brand">
              <span class="brand-name">Analog Synth</span>
              <span class="brand-sub">Three-oscillator video synthesizer</span>
            </div>
            <div class="morph">
              <div
                class="pad"
                class:empty={!stored}
                bind:this={pad}
                role="slider"
                tabindex="0"
                aria-label="Morph between the stored snapshots"
                aria-valuetext={`${Math.round(morph.x * 100)}% across, ${Math.round(morph.y * 100)}% down`}
                aria-valuenow={Math.round(morph.x * 100)}
                onpointerdown={(e) => { if (stored) { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); movePad(e); } }}
                onpointermove={(e) => { if (e.buttons & 1) movePad(e); }}
              >
                {#each [0, 1, 2, 3] as i}
                  <span class="corner c{i}" class:stored={!!snapshots[i]}>{i + 1}</span>
                {/each}
                {#if stored}
                  <span class="dot" style:left={`${morph.x * 100}%`} style:top={`${morph.y * 100}%`}></span>
                {/if}
              </div>
              <div class="corner-keys">
                <span class="legend small">Morph</span>
                {#each [0, 1, 2, 3] as i}
                  <div class="corner-key">
                    <span class="led" class:on={!!snapshots[i]}></span>
                    <span class="key-name">{i + 1}</span>
                    <button class="panel-btn" onclick={() => store(i)} title={`Store the knobs in corner ${i + 1}`}>Store</button>
                    <button class="panel-btn" disabled={!snapshots[i]} onclick={() => clearCorner(i)} title={`Clear corner ${i + 1}`}>Clear</button>
                  </div>
                {/each}
              </div>
            </div>
            <p class="panel-note">{stored < 2 ? 'Store the knobs in two or more corners, then drag across the pad to blend between them.' : 'Drag across the pad to blend between the stored corners.'}</p>
          </section>
        </div>

        <svg class="cables" aria-hidden="true">
          {#each cables as c (c.id)}
            {#if c.normal}
              <path d={c.d} stroke={c.color} class="normal-cable" />
            {:else}
              <path d={c.d} class="studio-cable-shadow" />
              <path d={c.d} stroke={c.color} class="studio-cable" />
              <circle cx={c.a.x} cy={c.a.y} r="6" stroke={c.color} class="studio-cable-plug" />
              <circle cx={c.b.x} cy={c.b.y} r="6" stroke={c.color} class="studio-cable-plug" />
            {/if}
          {/each}
          {#if drag && liveStart && liveEnd}
            <path d={cablePath(liveStart.x, liveStart.y, liveEnd.x, liveEnd.y, fit.height - 4)} class="studio-cable-shadow" />
            <path d={cablePath(liveStart.x, liveStart.y, liveEnd.x, liveEnd.y, fit.height - 4)} stroke={CABLE_LIVE_COLOR} class="studio-cable live" />
          {/if}
        </svg>
      </div>
    </div>
  </div>
</div>

<style>
  /* The rest of the app hides while the instrument is up (it stays mounted),
     so only the output shows through the monitor. */
  :global(body.analog-synth-open > :not(.synth-app)) {
    visibility: hidden;
  }

  .synth-app {
    --rack-ground: #0d0d0c;
    --rack-face: #181817;
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: grid;
    grid-template-rows: var(--ga-bar-h, 48px) minmax(0, 1fr);
    background: var(--rack-ground);
    color: var(--studio-ink);
  }
  /* With the native output under the page, the window is see-through and
     the monitor's screen is a hole: the monitor paints the ground around
     itself, and the screen paints the faceplate around itself. */
  .synth-app.native {
    background: transparent;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }

  /* ── App chrome: the app's own bar ── */
  .topbar {
    position: relative;
    z-index: 3;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 14px;
    background: var(--ga-panel, #100f0d);
    border-bottom: 1px solid var(--ga-line2, rgba(245, 236, 222, 0.13));
  }
  .app-title {
    font-weight: 600;
    font-size: var(--ga-text-title, 14px);
    margin-right: 10px;
    color: var(--ga-ink0, #f2ede4);
  }
  .spacer {
    flex: 1;
  }
  .bar-hint {
    color: var(--ga-ink2, #89857e);
    font-size: var(--ga-text-meta, 11px);
  }
  .bar-field select,
  .bar-btn {
    height: var(--ga-control-h, 28px);
    background: var(--ga-sub, #1a1814);
    color: var(--ga-ink1, #ada9a2);
    border: 1px solid var(--ga-line2, rgba(245, 236, 222, 0.13));
    border-radius: var(--ga-r-hard, 5px);
    font: inherit;
    font-size: var(--ga-text-control, 12px);
    padding: 0 10px;
  }
  .bar-btn {
    cursor: pointer;
  }
  .bar-btn:hover {
    color: var(--ga-ink0, #f2ede4);
  }
  .bar-btn[aria-pressed='true'] {
    color: var(--ga-ink0, #f2ede4);
    border-color: var(--ga-line3, rgba(245, 236, 222, 0.24));
  }
  .bar-btn:focus-visible,
  .bar-field select:focus-visible {
    outline: 2px solid var(--ga-focus, var(--ga-blue, #5278ff));
    outline-offset: 2px;
  }

  /* ── The case: two rows that share the window's height ── */
  .scroll {
    overflow: auto;
    min-height: 0;
  }
  .case {
    position: relative;
    box-sizing: border-box;
    padding: 12px 14px;
    display: grid;
    grid-template-rows: minmax(min-content, 1.6fr) minmax(min-content, 1fr);
    gap: 8px;
    font-family: var(--ga-font-ui, system-ui, sans-serif);
  }
  .row {
    display: flex;
    gap: 8px;
    align-items: stretch;
    min-height: 0;
  }

  /* A panel screwed into the case: matte black with cream silkscreen. */
  .module {
    position: relative;
    z-index: 1;
    box-sizing: border-box;
    flex: 1 0 auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px 12px 14px;
    background: var(--rack-face);
    border: 1px solid rgba(241, 233, 216, 0.14);
    border-radius: 3px;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 2px 6px rgba(0, 0, 0, 0.45);
  }
  .screw {
    position: absolute;
    z-index: 1;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background:
      linear-gradient(45deg, transparent 42%, rgba(0, 0, 0, 0.7) 42% 58%, transparent 58%),
      radial-gradient(circle at 35% 30%, #d9d9d4, #7d7d78 70%);
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6);
  }
  .screw.tl { top: 5px; left: 5px; }
  .screw.tr { top: 5px; right: 5px; }
  .screw.bl { bottom: 5px; left: 5px; }
  .screw.br { bottom: 5px; right: 5px; }
  .legend {
    position: relative;
    z-index: 1;
    display: block;
    text-align: center;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--studio-ink);
    padding-bottom: 7px;
    border-bottom: 1px solid rgba(241, 233, 216, 0.22);
  }
  .legend.small {
    font-size: 9px;
    letter-spacing: 0.14em;
    color: var(--studio-muted);
    border: 0;
    padding: 0;
  }
  .knob-rows {
    display: grid;
    gap: 8px;
  }
  .knob-row {
    display: flex;
    justify-content: space-around;
    align-items: flex-end;
    gap: 6px;
  }
  .knob-row.with-out {
    align-items: center;
  }
  .row-label {
    align-self: center;
    font-size: 11px;
    font-weight: 700;
    color: var(--studio-accent);
    width: 10px;
  }

  /* Selectors: a column of positions, the chosen one lit. */
  .switches {
    display: flex;
    justify-content: space-around;
    gap: 10px;
    padding-top: 8px;
    border-top: 1px solid rgba(241, 233, 216, 0.1);
  }
  .selector {
    display: grid;
    gap: 2px;
    justify-items: start;
  }
  .position {
    display: flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: 0;
    padding: 1px 0;
    color: var(--studio-ink);
    font: inherit;
    font-size: 10px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    cursor: pointer;
  }
  .position[aria-checked='false'] {
    color: var(--studio-muted);
  }
  .led {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #2a1a10;
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.6);
    flex: none;
  }
  .led.on {
    background: radial-gradient(circle at 40% 35%, #ffd1a6, var(--studio-accent) 60%);
    box-shadow: 0 0 6px var(--studio-accent);
  }

  /* Jacks sit along the bottom: inputs on the panel, outputs on a cream plate. */
  .jacks {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-around;
    align-items: flex-start;
    gap: 8px 4px;
    margin-top: auto;
    padding-top: 9px;
    border-top: 1px solid rgba(241, 233, 216, 0.1);
  }
  .jack-cell {
    display: grid;
    justify-items: center;
    gap: 3px;
    min-width: 38px;
  }
  .jack-cell.out {
    padding: 5px 5px 4px;
    background: #ece4d2;
    border-radius: 3px;
  }
  .jack-name {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--studio-ink);
    white-space: nowrap;
  }
  .jack-cell.out .jack-name {
    color: #1a1712;
  }
  .jack {
    position: relative;
    z-index: 3;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background:
      radial-gradient(circle, #050505 0 32%, #3b3b39 33% 38%, transparent 39%),
      conic-gradient(from 30deg, #e6e6e1, #8c8c87, #d6d6d0, #7a7a75, #e6e6e1);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.7);
    cursor: grab;
  }
  /* A cable in the hand: every input that can take it grows and pulses,
     its name lit; the one the cable will snap into pulses hardest; the
     other outputs step back. As the Music Studio's jacks do. */
  .jack-cell.accepts .jack {
    transform: scale(1.2);
    box-shadow: 0 0 0 3px var(--studio-accent-soft), 0 0 12px var(--studio-accent);
    animation: invite 0.9s ease-in-out infinite alternate;
    transition: transform 120ms ease;
  }
  .jack-cell.accepts .jack-name {
    color: var(--studio-accent);
  }
  .jack-cell.target .jack {
    transform: scale(1.4);
    box-shadow: 0 0 0 4px var(--studio-accent), 0 0 18px var(--studio-accent);
    animation: none;
  }
  .jack-cell.source .jack {
    box-shadow: 0 0 0 3px #1a1712;
  }
  .jack-cell.dim {
    opacity: 0.22;
    transition: opacity 120ms ease;
  }
  @keyframes invite {
    from { box-shadow: 0 0 0 2px var(--studio-accent-soft), 0 0 6px var(--studio-accent); }
    to { box-shadow: 0 0 0 5px var(--studio-accent-soft), 0 0 16px var(--studio-accent); }
  }
  @media (prefers-reduced-motion: reduce) {
    .jack-cell.accepts .jack { animation: none; }
  }
  .synth-app.patching,
  .synth-app.patching :global(*) {
    cursor: grabbing;
  }
  .jack:focus-visible,
  .position:focus-visible,
  .panel-btn:focus-visible,
  .pad:focus-visible,
  .input-field select:focus-visible {
    outline: 2px solid var(--studio-accent);
    outline-offset: 2px;
  }

  /* ── Monitor: closes the top row and takes what width is left ── */
  .monitor {
    flex: 100 1 480px;
    min-width: 420px;
  }
  .bezel {
    flex: 1;
    display: grid;
    place-items: center;
    padding: 16px;
    container-type: size;
    min-height: 220px;
  }
  .screen {
    position: relative;
    z-index: 0;
    width: min(100cqw, 100cqh * var(--out-w) / var(--out-h));
    aspect-ratio: var(--out-w) / var(--out-h);
    border-radius: 4px;
    background: #000;
    display: grid;
    place-items: center;
  }
  /* The tube's surround, drawn over the screen's edge. */
  .frame {
    position: absolute;
    inset: -10px;
    border: 10px solid #070707;
    border-radius: 14px;
    box-shadow: 0 0 0 1px rgba(241, 233, 216, 0.1), inset 0 0 0 1px rgba(0, 0, 0, 0.8);
    pointer-events: none;
  }
  .synth-app.native .monitor {
    z-index: 0;
    overflow: hidden;
    background: transparent;
    border-color: transparent;
    box-shadow: 0 0 0 200vmax var(--rack-ground);
  }
  .synth-app.native .monitor::after {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 1;
    border: 1px solid rgba(241, 233, 216, 0.14);
    border-radius: 3px;
    pointer-events: none;
  }
  .synth-app.native .screen {
    background: transparent;
    box-shadow: 0 0 0 200vmax var(--rack-face);
  }
  .synth-app.native .case {
    background: transparent;
  }
  .screen-note {
    color: var(--studio-muted);
    font-size: 11px;
  }

  /* ── Nameplate and morph pad: close the bottom row ── */
  .plate {
    flex: 1 0 330px;
    gap: 12px;
  }
  .brand {
    display: grid;
    gap: 3px;
    padding: 2px 0 10px;
    border-bottom: 1px solid rgba(241, 233, 216, 0.22);
  }
  .brand-name {
    font-size: 19px;
    font-weight: 700;
    letter-spacing: 0.3em;
    text-transform: uppercase;
    color: var(--studio-ink);
  }
  .brand-sub {
    font-size: 9px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--studio-accent);
  }
  .morph {
    display: grid;
    grid-template-columns: 150px auto;
    gap: 14px;
    align-items: start;
  }
  .pad {
    position: relative;
    width: 150px;
    aspect-ratio: 1;
    background:
      linear-gradient(rgba(241, 233, 216, 0.07) 1px, transparent 1px) 0 0 / 25% 25%,
      linear-gradient(90deg, rgba(241, 233, 216, 0.07) 1px, transparent 1px) 0 0 / 25% 25%,
      #0a0a0a;
    border: 1px solid rgba(241, 233, 216, 0.24);
    border-radius: 3px;
    cursor: crosshair;
    touch-action: none;
  }
  .pad.empty {
    cursor: default;
  }
  .corner {
    position: absolute;
    padding: 3px 5px;
    font-size: 10px;
    font-weight: 700;
    color: var(--studio-muted);
  }
  .corner.stored {
    color: var(--studio-accent);
  }
  .c0 { left: 0; top: 0; }
  .c1 { right: 0; top: 0; }
  .c2 { left: 0; bottom: 0; }
  .c3 { right: 0; bottom: 0; }
  .dot {
    position: absolute;
    width: 12px;
    height: 12px;
    margin: -6px 0 0 -6px;
    border-radius: 50%;
    background: radial-gradient(circle at 40% 35%, #ffd1a6, var(--studio-accent) 60%);
    box-shadow: 0 0 8px var(--studio-accent);
    pointer-events: none;
  }
  .corner-keys {
    display: grid;
    gap: 6px;
  }
  .corner-key {
    display: grid;
    grid-template-columns: auto 12px auto auto;
    gap: 6px;
    align-items: center;
  }
  .key-name {
    font-size: 11px;
    font-weight: 700;
    color: var(--studio-ink);
  }
  .panel-btn {
    height: 22px;
    padding: 0 8px;
    background: #222220;
    color: var(--studio-ink);
    border: 1px solid rgba(241, 233, 216, 0.2);
    border-radius: 3px;
    font: inherit;
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    cursor: pointer;
  }
  .panel-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .input-use {
    display: grid;
    grid-template-columns: 7px 1fr;
    gap: 8px;
    align-items: start;
  }
  .input-use .led {
    margin-top: 3px;
  }
  .input-use .panel-note + .panel-note {
    margin-top: 2px;
  }
  .input-field {
    display: grid;
    gap: 6px;
  }
  .input-field select {
    height: 28px;
    min-width: 0;
    background: #0a0a0a;
    color: var(--studio-ink);
    border: 1px solid rgba(241, 233, 216, 0.24);
    border-radius: 3px;
    font: inherit;
    font-size: 12px;
    padding: 0 6px;
  }
  .panel-note {
    margin: 0;
    font-size: 10px;
    line-height: 1.45;
    color: var(--studio-muted);
  }

  /* ── Cables over the panel ── */
  .cables {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    z-index: 2;
    pointer-events: none;
    overflow: visible;
  }
  .normal-cable {
    fill: none;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-dasharray: 3 5;
    opacity: 0.4;
  }
</style>
