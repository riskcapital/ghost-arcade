<script lang="ts">
  /**
   * Analog Synth, full screen: the instrument as a two-row rack fitted to
   * the window, in Audio Lab's look (its modules, knobs, jacks, cables, bar
   * and wooden end cheeks). The top row makes the picture (three
   * oscillators, the mixer, the output); the bottom row shapes and moves it
   * (picture, feedback, tube) and holds the modulation (LFOs, music, input)
   * and the morph pad. Patch cables hang over the panel as in Audio Lab: drag
   * from an output to an input; drag a plugged input to move its cable, or
   * Alt-click it to unplug. Normals, the connections an input has with
   * nothing plugged in, can be shown as dashed cables.
   */
  import { onDestroy, onMount, tick } from 'svelte';
  import { get } from 'svelte/store';
  import './music/studioTokens.css';
  import StudioKnob from './music/StudioKnob.svelte';
  import StudioModule from './music/StudioModule.svelte';
  import PatchJack from './music/PatchJack.svelte';
  import CableStrands from './music/CableStrands.svelte';
  import { portal } from '../utils/portal';
  import { windowCaption, wheelScrollsSideways } from '../utils/windowCaption';
  import { nativePreviewClaim, nativePreviewHostEl } from '../stores/nativePreviewHost';
  import { NATIVE_ENGINE_ONLY } from '../stores/settings';
  import { isDesktopApp } from '$lib/bridge';
  import { getNativeRendererCapabilities } from '$lib/api/native-renderer';
  import { project } from '../stores/layers';
  import { liveCable, sourceKind, synthCables } from '../videosynth/cables';
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
  onDestroy(() => {
    document.body.classList.remove('analog-synth-open');
    // Closed mid-drag: the cable's window listeners go with it.
    window.removeEventListener('pointermove', follow);
    window.removeEventListener('pointerup', finish);
  });

  // ── Fit: the rack is laid out at one size and scaled down to a smaller
  // window, as a hardware panel would be; it is never drawn larger than the
  // interface size, so its knobs and jacks match Audio Lab's. Spare room
  // widens the monitor or lets the rows breathe. Below the smallest scale it
  // scrolls. ──
  const DESIGN_W = 1560;
  const DESIGN_H = 780;
  let scrollEl: HTMLDivElement | undefined = $state();
  let fit = $state({ scale: 1, width: DESIGN_W, height: DESIGN_H });
  function fitCase() {
    if (!scrollEl) return;
    const w = scrollEl.clientWidth, h = scrollEl.clientHeight;
    const scale = Math.max(0.7, Math.min(1, w / DESIGN_W, h / DESIGN_H));
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

  /** Outputs with a cable in them (not counting normals), lit like Audio Lab's plugged jacks. */
  const pluggedSources = $derived(new Set(INPUT_JACKS.map((j) => [sourceOf(j), j.normal]).filter(([f, n]) => f && f !== n).map(([f]) => f)));
  const cables = $derived(synthCables(effectSource, centers, { showNormals, carried: drag?.carried, floor: fit.height - 4 }));
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
  const live = $derived(drag && liveStart && liveEnd ? liveCable(liveStart, liveEnd, fit.height - 4) : null);

  // The cable under the pointer lights up with its plugs, as in Audio Lab, so
  // it is clear which is which in a tangle.
  let cableSvg: SVGSVGElement | undefined = $state();
  let hovered = $state<string | null>(null);
  function hover(e: PointerEvent) {
    if (drag || e.buttons !== 0 || !caseEl || !cableSvg) return;
    const p = at(e);
    const pt = new DOMPoint(p.x, p.y);
    const next = [...cableSvg.querySelectorAll<SVGPathElement>('path.hit')].reverse().find((h) => h.isPointInStroke(pt))?.dataset.cable ?? null;
    if (next !== hovered) hovered = next;
  }

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
    hovered = null;
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
    window.removeEventListener('pointerup', finish);
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

<svelte:window onkeydown={onkey} onpointermove={hover} />

{#snippet outJack(source: number, label: string)}
  <PatchJack
    jack={`out:${source}`}
    kind={sourceKind(source) === 'control' ? 'control' : null}
    {label}
    labelAbove
    ariaLabel={`${label} output: drag to an input`}
    title={`${label} out: drag to an input`}
    plugged={pluggedSources.has(source)}
    source={drag?.from === source}
    dim={!!drag && drag.from !== source}
    onpointerdown={(e) => fromOutput(source, e)}
  />
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

{#snippet moduleBody(m: Module)}
  {#if m.rows.length}
    <div class="knob-rows">
      {#each m.rows as row, ri}
        <div class="knob-row" class:with-out={!!m.rowOuts}>
          {#if m.rowLabels}<span class="row-label ga-eyebrow">{m.rowLabels[ri]}</span>{/if}
          {#each row as k (k.key)}
            {@render knob(m, k)}
          {/each}
          {#if m.rowOuts}{@render outJack(m.rowOuts[ri], `LFO ${ri + 1}`)}{/if}
        </div>
      {/each}
    </div>
  {/if}
  {#if m.switches.length}
    <div class="switches" class:column={m.id === 'mixer'}>
      {#each m.switches as key (key)}
        {@const p = paramSpec(key)}
        <div class="selector">
          <span class="ga-eyebrow legend">{key.endsWith('Input') ? 'Draws' : key.endsWith('ModMode') ? 'Mod' : 'Mode'}</span>
          <div class="seg small" role="radiogroup" aria-label={`${m.title} · ${p.label}`}>
            {#each p.options ?? [] as option, i}
              <button
                role="radio"
                aria-checked={val(key) === i}
                class:on={val(key) === i}
                data-midi-path={`${midiPrefix}:${key}`}
                data-midi-label={`${m.title} · ${p.label}`}
                data-midi-min={0}
                data-midi-max={(p.options?.length ?? 1) - 1}
                onclick={() => onpatch({ [key]: i })}
              >{option}</button>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {/if}
  {#if m.input}
    <label class="input-field">
      <span class="ga-eyebrow legend">Layer</span>
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
    {/if}
  {/if}
  {#if m.ins.length || m.outs.length}
    <!-- The module's patch bay: inputs, each with its amount, then the outputs. -->
    <div class="bay">
      {#if m.ins.length}
        <div class="bay-group">
          {#each m.ins as id (id)}
            {@const j = inputJack(id)!}
            {@const from = sourceOf(j)}
            {@const a = paramSpec(j.amtKey)}
            {@const normal = !!from && from === j.normal}
            <div class="in-cell" data-input={j.id}>
              <PatchJack
                jack={`in:${j.id}`}
                label={j.label}
                ariaLabel={`${m.title} ${j.label} input, ${from ? `from ${SOURCES[from]}` : 'empty'}${normal ? ' (normal)' : ''}`}
                title={`${j.label} in: ${from ? SOURCES[from] : 'nothing'}${normal ? ' (normal)' : ''}`}
                plugged={!!from && !normal}
                accepts={!!drag}
                target={snapTo === j.id}
                onpointerdown={(e) => fromInput(j, e)}
              />
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
        </div>
      {/if}
      {#if m.outs.length}
        <div class="bay-group outs">
          {#each m.outs as o (o.source)}
            {@render outJack(o.source, o.label)}
          {/each}
        </div>
      {/if}
    </div>
  {/if}
{/snippet}

{#snippet moduleView(m: Module)}
  <div class="cell" style:flex-basis={`${m.width}px`}>
    <StudioModule title={m.title} foldKey={`Analog Synth ${m.title}`} led={m.input ? inputUse.drawnBy.length + inputUse.patchedTo.length > 0 : null}>
      {@render moduleBody(m)}
    </StudioModule>
  </div>
{/snippet}

<div style="display: contents">
  <div class="synth-app studio-tokens set-analog" class:native={nativePreview} class:patching={!!drag} use:portal role="dialog" aria-modal="true" aria-label="Analog Synth">
    <header class="bar" use:windowCaption use:wheelScrollsSideways>
      <span class="bar-title">Analog Synth</span>
      <div class="group">
        <select class="preset-menu" aria-label="Preset" value="" onchange={(e) => { loadPreset(e.currentTarget.value); e.currentTarget.value = ''; }}>
          <option value="">Load a preset…</option>
          {#each VIDEOSYNTH_PRESETS as p}
            <option value={p.id}>{p.name}</option>
          {/each}
        </select>
        <button class="text-btn" onclick={randomize} title="A new patch, kept within ranges that make a picture">Randomize</button>
      </div>
      <span class="spacer"></span>
      <span class="bar-hint">Drag from an output to an input · Alt-click an input to unplug</span>
      <div class="group">
        <button class="text-btn" class:on={showNormals} aria-pressed={showNormals} onclick={() => (showNormals = !showNormals)} title="Normals are the connections an input has with nothing plugged in">{showNormals ? 'Hide normals' : 'Show normals'}</button>
      </div>
      <div class="group nav">
        <button class="nav-btn" bind:this={closeButton} onclick={onclose} aria-label="Close" title="Close the synth (Esc); its layer keeps playing">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
        </button>
      </div>
    </header>

    <div class="scroll" bind:this={scrollEl}>
      <div class="case face" bind:this={caseEl} style:zoom={fit.scale} style:width={`${fit.width}px`} style:height={`${fit.height}px`}>
        <div class="row make">
          {#each ROW_MAKE as m (m.id)}
            {@render moduleView(m)}
          {/each}
          <div class="cell monitor-cell">
            <StudioModule title="Output" foldKey="Analog Synth Output" class="monitor">
              <div class="frame-well" style="--out-w: {Math.max(1, $project.width || 1920)}; --out-h: {Math.max(1, $project.height || 1080)}">
                <div class="screen" bind:this={hole}>
                  <span class="frame-label ga-eyebrow">Live output</span>
                  {#if !nativePreview}<span class="screen-note">The picture plays in the output</span>{/if}
                </div>
              </div>
            </StudioModule>
          </div>
        </div>

        <div class="row shape">
          {#each ROW_SHAPE as m (m.id)}
            {@render moduleView(m)}
          {/each}
          <div class="cell morph-cell">
            <StudioModule title="Morph" foldKey="Analog Synth Morph" led={stored >= 2}>
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
                    <span class="corner ga-eyebrow c{i}" class:stored={!!snapshots[i]}>{i + 1}</span>
                  {/each}
                  {#if stored}
                    <span class="puck" style:left={`${morph.x * 100}%`} style:top={`${morph.y * 100}%`}></span>
                  {/if}
                </div>
                <div class="corner-keys">
                  {#each [0, 1, 2, 3] as i}
                    <div class="corner-key">
                      <span class="led" class:on={!!snapshots[i]}></span>
                      <span class="key-name">{i + 1}</span>
                      <button class="studio-btn" onclick={() => store(i)} title={`Store the knobs in corner ${i + 1}`}>Store</button>
                      <button class="studio-btn" disabled={!snapshots[i]} onclick={() => clearCorner(i)} title={`Clear corner ${i + 1}`}>Clear</button>
                    </div>
                  {/each}
                </div>
              </div>
              <p class="panel-note">{stored < 2 ? 'Store the knobs in two or more corners, then drag across the pad to blend between them.' : 'Drag across the pad to blend between the stored corners.'}</p>
            </StudioModule>
          </div>
        </div>

        <svg class="cables" aria-hidden="true" bind:this={cableSvg}>
          <CableStrands {cables} {hovered} />
          {#if live}<CableStrands cables={[live]} />{/if}
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
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: grid;
    grid-template-rows: var(--ga-bar-h, 48px) minmax(0, 1fr);
    background: var(--studio-ground);
    color: var(--studio-ink);
    user-select: none;
  }
  /* Wooden end cheeks down both sides, as on Audio Lab. */
  .synth-app::before,
  .synth-app::after {
    content: '';
    position: absolute;
    top: var(--ga-bar-h, 48px);
    bottom: 0;
    width: 8px;
    background: var(--studio-wood);
    z-index: 4;
    pointer-events: none;
  }
  .synth-app::before { left: 0; box-shadow: inset -1px 0 0 rgba(0, 0, 0, 0.6); }
  .synth-app::after { right: 0; box-shadow: inset 1px 0 0 rgba(0, 0, 0, 0.6); }
  /* With the native output under the page, the window is see-through and
     the monitor's screen is a hole: the monitor paints the ground around
     itself, and the screen paints the module around itself. */
  .synth-app.native {
    background: transparent;
  }

  /* ── Top bar: Audio Lab's (the app's 48px bar, 30px controls, 13px text), in groups ── */
  .bar {
    position: relative;
    z-index: 5;
    display: flex;
    align-items: center;
    gap: var(--ga-bar-group-gap, 14px);
    padding: 0 14px;
    background: var(--ga-bar, #100f0d);
    border-bottom: 1px solid var(--studio-edge-soft);
    white-space: nowrap;
    font-size: var(--ga-text-body, 13px);
    /* A narrow window scrolls the bar sideways instead of cutting it off. */
    overflow-x: auto;
    overflow-y: hidden;
    container-type: inline-size;
  }
  .bar > * { flex-shrink: 0; }
  .group { display: flex; align-items: center; gap: var(--ga-bar-gap, 6px); flex: 0 0 auto; }
  .bar-title { font-size: var(--ga-text-title, 14px); font-weight: var(--ga-weight-title, 650); color: var(--studio-ink); }
  .spacer { flex: 1 1 4px; min-width: 4px; }
  .bar-hint { color: var(--studio-muted); font-size: var(--ga-text-meta, 11px); }
  .bar select { height: var(--ga-bar-control-h, 30px); padding: 0 8px; font-size: var(--ga-text-body, 13px); }
  .bar .text-btn { height: var(--ga-bar-control-h, 30px); padding: 0 12px; font-size: var(--ga-text-body, 13px); }
  .nav-btn {
    flex: 0 0 auto; width: var(--ga-bar-control-h, 30px); height: var(--ga-bar-control-h, 30px); padding: 0; display: inline-grid; place-items: center;
    border: 1px solid var(--studio-edge); border-radius: var(--studio-radius); background: transparent; color: var(--studio-ink); cursor: pointer;
  }
  .nav-btn:hover { border-color: var(--studio-ink); }
  .nav-btn svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.4; stroke-linecap: round; stroke-linejoin: round; }
  .bar :is(select, button):focus-visible { outline: 2px solid var(--ga-focus, var(--studio-accent)); outline-offset: 2px; }
  /* The bar folds as the window narrows: first the hint, then the title. */
  @container (max-width: 1100px) {
    .bar-hint { display: none; }
  }
  @container (max-width: 640px) {
    .bar-title { display: none; }
  }

  /* ── The case: two rows that share the window's height ── */
  .scroll {
    overflow: auto;
    min-height: 0;
  }
  .case {
    position: relative;
    box-sizing: border-box;
    padding: 10px 14px 12px;
    display: grid;
    grid-template-rows: minmax(min-content, 1.6fr) minmax(min-content, 1fr);
    gap: var(--studio-gap);
  }
  .row {
    display: flex;
    gap: var(--studio-gap);
    align-items: stretch;
    min-height: 0;
  }
  /* Each module takes its width and grows a little to fill the row. */
  .cell {
    position: relative;
    z-index: 1;
    flex: 1 0 auto;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .cell > :global(.module) { flex: 1; }
  .cell :global(.panel) { gap: 10px; }

  .knob-rows { display: grid; gap: 8px; }
  .knob-row { display: flex; justify-content: space-around; align-items: flex-end; gap: 6px; }
  .knob-row.with-out { align-items: center; }
  /* Row legends print in the accent, as Audio Lab's section names do. */
  .row-label { align-self: center; width: 10px; color: var(--studio-accent); }

  /* Selectors: the face's segmented choice, a legend before it. */
  .switches {
    display: grid;
    gap: 6px;
    padding-top: 8px;
    border-top: 1px solid var(--studio-edge-soft);
  }
  .selector { display: grid; grid-template-columns: 44px auto; align-items: center; gap: 8px; justify-content: start; }
  .switches.column .selector { grid-template-columns: 1fr; gap: 4px; }
  .switches.column .seg { flex-direction: column; height: auto; }
  .switches.column .seg button { height: 20px; text-align: left; }

  /* ── Patch bay: along the bottom of a module, inputs then outputs, on the slot ── */
  .bay {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-around;
    gap: 10px 6px;
    margin-top: auto;
    padding: 8px 6px 6px;
    background: var(--studio-slot);
    border: 1px solid var(--studio-edge-soft);
    border-radius: var(--studio-radius);
  }
  .bay-group { display: flex; flex: 1 1 auto; justify-content: space-around; align-items: flex-start; gap: 6px; }
  .bay-group.outs { flex: 0 1 auto; }
  .bay-group + .bay-group.outs { padding-left: 8px; border-left: 1px solid var(--studio-edge-soft); }
  .in-cell { display: grid; justify-items: center; gap: 4px; min-width: 36px; }
  .synth-app.patching,
  .synth-app.patching :global(*) {
    cursor: grabbing;
  }

  /* ── Output: closes the top row and takes what width is left; Audio Lab's frame ── */
  .monitor-cell {
    flex: 100 1 480px;
    min-width: 420px;
  }
  .frame-well {
    flex: 1;
    display: grid;
    place-items: center;
    container-type: size;
    min-height: 220px;
  }
  .screen {
    position: relative;
    z-index: 0;
    box-sizing: border-box;
    width: min(100cqw, 100cqh * var(--out-w) / var(--out-h));
    aspect-ratio: var(--out-w) / var(--out-h);
    border: 1px solid var(--studio-edge);
    border-radius: var(--studio-radius);
    background: #000;
    display: grid;
    place-items: center;
  }
  .frame-label {
    position: absolute;
    left: 10px;
    top: 8px;
    padding: 2px 6px;
    background: var(--studio-ground);
    border-radius: 3px;
  }
  .screen-note { color: var(--studio-muted); font-size: var(--ga-text-meta, 11px); }
  .synth-app.native .monitor-cell { z-index: 0; }
  .synth-app.native .monitor-cell > :global(.module) {
    overflow: hidden;
    background: transparent;
    /* No border: the window shows through anything left unpainted; the edge is drawn over it instead. */
    border: 0;
    box-shadow: 0 0 0 200vmax var(--studio-ground);
  }
  /* The module's head stays over the screen's surround. */
  .synth-app.native .monitor-cell :global(.head) { position: relative; z-index: 1; }
  .synth-app.native .monitor-cell::after {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 1;
    border: 1px solid var(--studio-edge-soft);
    border-radius: var(--studio-radius);
    pointer-events: none;
  }
  .synth-app.native .screen {
    background: transparent;
    box-shadow: 0 0 0 200vmax var(--studio-panel);
  }

  /* ── Morph: Audio Lab's XY pad, with a store and clear for each corner ── */
  .morph-cell { flex: 1 0 300px; }
  .morph { display: grid; grid-template-columns: 150px auto; gap: 14px; align-items: start; }
  .pad {
    position: relative;
    width: 150px;
    aspect-ratio: 1;
    box-sizing: border-box;
    border: 1px solid var(--studio-edge);
    border-radius: var(--studio-radius);
    background-color: var(--studio-slot);
    background-image: linear-gradient(var(--studio-edge-soft) 1px, transparent 1px), linear-gradient(90deg, var(--studio-edge-soft) 1px, transparent 1px);
    background-size: 25% 25%;
    cursor: crosshair;
    touch-action: none;
    overflow: hidden;
  }
  .pad.empty { cursor: default; }
  .pad:focus-visible { outline: 2px solid var(--studio-accent); outline-offset: 2px; }
  .corner { position: absolute; padding: 4px 6px; pointer-events: none; }
  .corner.stored { color: var(--studio-accent); }
  .c0 { left: 0; top: 0; }
  .c1 { right: 0; top: 0; }
  .c2 { left: 0; bottom: 0; }
  .c3 { right: 0; bottom: 0; }
  .puck {
    position: absolute;
    width: 22px;
    height: 22px;
    box-sizing: border-box;
    border-radius: 50%;
    border: 2px solid var(--studio-accent);
    background: var(--studio-accent-soft);
    box-shadow: 0 0 18px var(--studio-accent);
    transform: translate(-50%, -50%);
    pointer-events: none;
  }
  .corner-keys { display: grid; gap: 6px; }
  .corner-key { display: grid; grid-template-columns: 7px 12px auto auto; gap: 6px; align-items: center; }
  .key-name { font-size: var(--ga-text-meta, 11px); font-weight: 700; color: var(--studio-ink); }
  .led { width: 7px; height: 7px; border-radius: 50%; background: var(--studio-edge); flex: none; }
  .led.on { background: var(--studio-accent); box-shadow: 0 0 8px var(--studio-accent); }

  /* ── Input ── */
  .input-use { display: grid; gap: 2px; }
  .input-field { display: grid; gap: 6px; }
  .input-field select { height: var(--ga-control-h, 26px); min-width: 0; }
  .input-field select:focus-visible { outline: 2px solid var(--studio-accent); outline-offset: 2px; }
  .panel-note {
    margin: 0;
    font-size: var(--ga-text-meta, 11px);
    line-height: 1.45;
    color: var(--studio-muted);
  }

  /* ── Cables over the panel, under the jacks' hit areas ── */
  .cables {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    z-index: 2;
    pointer-events: none;
    overflow: visible;
  }
</style>
