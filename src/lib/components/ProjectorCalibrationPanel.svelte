<script lang="ts">
  import { tick } from 'svelte';
  import type { OutputSlice } from '../stores/settings';
  import { settings } from '../stores/settings';
  import { screens, screenActions } from '../stores/screens';
  import { scheduleHistorySnapshot, recordDiscreteAction } from '../stores/historyHooks';
  import { screenAlignmentGridIds, setScreenAlignmentGrid, identifyScreen } from '../stores/screenOutputStatus';
  import {
    defaultProjectorCorners, defaultOverlap, inverseProjectorHomography, nudgeProjectorCorner, overlapBandValid,
    overlapGamma, overlapPartner, overlapPairInStep, pairedOverlapPatches, DEFAULT_OVERLAP_GAMMA,
    type OverlapBand, type ProjectorQuad,
  } from '../output/projectorCalibration';

  type DisplayInfo = { id: number; width: number; height: number; scaleFactor: number };
  let { screen, displays = [], outputOpen = false }: { screen: OutputSlice; displays?: DisplayInfo[]; outputOpen?: boolean } = $props();

  const CORNER_LABELS = ['Top left', 'Top right', 'Bottom right', 'Bottom left'];
  const BAND_FIELDS: [keyof OverlapBand, string][] = [['startTop', 'Left boundary · top'], ['startBottom', 'Left boundary · bottom'], ['endTop', 'Right boundary · top'], ['endBottom', 'Right boundary · bottom']];
  const AXES = ['x', 'y'] as const;
  const MARGIN = 0.1;

  let chosenPartner = $state('');
  let selectedCorner = $state(0);
  let largeEditor = $state(false);
  let editor: SVGSVGElement | undefined = $state();

  const calibration = $derived(screen.projectorCalibration ?? { enabled: false, corners: defaultProjectorCorners() });
  const band = $derived(screen.overlapBand ?? defaultOverlap());
  const valid = $derived(!!inverseProjectorHomography(calibration.corners));
  const bandValid = $derived(overlapBandValid(band));
  // The projector's real raster, as the render core sizes this Screen's output.
  const size = $derived.by(() => {
    const display = displays.find(d => d.id === screen.displayId);
    const scale = display?.scaleFactor && display.scaleFactor > 0 ? display.scaleFactor : 1;
    return {
      width: Math.max(1, Math.round((display?.width ?? $settings.output.masterCanvasWidth ?? 1920) * scale)),
      height: Math.max(1, Math.round((display?.height ?? $settings.output.masterCanvasHeight ?? 1080) * scale)),
      known: !!display,
    };
  });
  const aspect = $derived(size.width / size.height);
  const partner = $derived(overlapPartner(screen, $screens));
  const partnerMissing = $derived(!!band.partnerId && !partner);
  const inStep = $derived(!!partner && overlapPairInStep(screen, partner));
  const screenNumber = $derived($screens.findIndex(s => s.id === screen.id) + 1);
  const gridOn = $derived($screenAlignmentGridIds.includes(screen.id));
  const legacyBlend = $derived((screen.edgeBlendLeft ?? 0) + (screen.edgeBlendRight ?? 0) + (screen.edgeBlendTop ?? 0) + (screen.edgeBlendBottom ?? 0) > 0);

  $effect(() => { chosenPartner = partner?.id ?? ''; });

  function setCorners(corners: ProjectorQuad) {
    screenActions.update(screen.id, { projectorCalibration: { ...calibration, corners } });
  }
  function setCalibration(enabled: boolean, corners = calibration.corners) {
    screenActions.update(screen.id, { projectorCalibration: { enabled, corners } });
    recordDiscreteAction();
  }

  /** Pointer position in normalised raster coordinates, through the SVG's own
   *  transform so letterboxing inside the element cannot skew it. */
  function pointerAt(event: PointerEvent): { x: number; y: number } | null {
    const matrix = editor?.getScreenCTM();
    if (!matrix) return null;
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: p.x / aspect, y: p.y };
  }
  /** Drag moves the corner by the pointer's travel (Shift: a tenth of it), so
   *  pressing a handle never makes the projected image jump. One undo step. */
  function drag(event: PointerEvent, index: number) {
    if (event.button !== 0) return;
    selectedCorner = index;
    editor?.focus({ preventScroll: true });
    const target = event.currentTarget as SVGElement;
    target.setPointerCapture(event.pointerId);
    let last = pointerAt(event);
    let corners = calibration.corners.map(p => ({ ...p }));
    let moved = false;
    const move = (e: PointerEvent) => {
      const now = pointerAt(e);
      if (!now || !last) return;
      const fine = e.shiftKey ? 0.1 : 1;
      corners = nudgeProjectorCorner(corners, index, (now.x - last.x) * fine * size.width, (now.y - last.y) * fine * size.height, size.width, size.height);
      last = now;
      moved = true;
      setCorners(corners);
    };
    const end = () => {
      target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', end); target.removeEventListener('pointercancel', end);
      if (moved) recordDiscreteAction();
    };
    target.addEventListener('pointermove', move); target.addEventListener('pointerup', end); target.addEventListener('pointercancel', end);
  }
  /** Arrow keys move the selected corner one output pixel (Shift 10, Alt 0.1). */
  function nudge(event: KeyboardEvent) {
    const step = event.shiftKey ? 10 : event.altKey ? 0.1 : 1;
    const delta: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const d = delta[event.key];
    if (!d) return;
    event.preventDefault();
    event.stopPropagation();
    setCorners(nudgeProjectorCorner(calibration.corners, selectedCorner, d[0], d[1], size.width, size.height));
    scheduleHistorySnapshot();
  }
  function selectCorner(index: number) { selectedCorner = index; editor?.focus({ preventScroll: true }); }

  /** Number fields commit on Enter, blur or a spinner step. An empty or
   *  unreadable field restores the current value instead of writing zero. */
  function commit(event: Event, apply: (value: number) => void) {
    const input = event.currentTarget as HTMLInputElement;
    const value = input.value.trim() === '' ? NaN : Number(input.value);
    if (Number.isFinite(value)) apply(value);
    void tick().then(() => { input.value = input.dataset.current ?? ''; });
  }
  function fieldKey(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    const input = event.currentTarget as HTMLInputElement;
    input.value = input.dataset.current ?? '';
    input.blur();
    event.stopPropagation();
  }
  /** Up/Down in a corner field move that axis by one output pixel (Shift 10,
   *  Alt 0.1), the same steps as the arrow keys on the editor. */
  function cornerFieldKey(event: KeyboardEvent, index: number, axis: 'x' | 'y') {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return fieldKey(event);
    event.preventDefault();
    event.stopPropagation();
    const step = (event.shiftKey ? 10 : event.altKey ? 0.1 : 1) * (event.key === 'ArrowUp' ? 1 : -1);
    setCorners(nudgeProjectorCorner(calibration.corners, index, axis === 'x' ? step : 0, axis === 'y' ? step : 0, size.width, size.height));
    scheduleHistorySnapshot();
  }
  function setCoordinate(index: number, axis: 'x' | 'y', percent: number) {
    const corners = calibration.corners.map(p => ({ ...p }));
    corners[index][axis] = Math.max(-1, Math.min(2, percent / 100));
    setCorners(corners);
    recordDiscreteAction();
  }

  /** Band edits apply to the paired Screen too (boundaries, gamma, side and
   *  both source crops), so the two outputs can never drift apart. */
  function applyBand(next: OverlapBand) {
    if (partner && overlapBandValid(next)) {
      for (const [id, patch] of Object.entries(pairedOverlapPatches(next, screen.id, partner.id))) screenActions.update(id, patch);
    } else {
      screenActions.update(screen.id, { overlapBand: next });
    }
  }
  function setBand(patch: Partial<OverlapBand>, continuous = false) {
    applyBand({ ...band, ...patch });
    if (continuous) scheduleHistorySnapshot(); else recordDiscreteAction();
  }
  function pair() {
    if (!chosenPartner || chosenPartner === screen.id || !bandValid) return;
    const base = { cropY: 0, cropH: 1, warpMode: 'rect' as const, edgeBlendLeft: 0, edgeBlendRight: 0, edgeBlendTop: 0, edgeBlendBottom: 0 };
    for (const [id, patch] of Object.entries(pairedOverlapPatches({ ...band, enabled: true }, screen.id, chosenPartner))) screenActions.update(id, { ...base, ...patch });
    recordDiscreteAction();
  }
  function toggleGrid() { setScreenAlignmentGrid(partner ? [screen.id, partner.id] : [screen.id], !gridOn); }
</script>
<section class="calibration">
  <h4>Projector calibration</h4>
  <div class="aids">
    <button class:active={gridOn} disabled={!outputOpen} onclick={toggleGrid}
      title="Replaces the picture on {partner ? 'both paired projectors' : 'this projector'} with a numbered grid, circles and diagonals drawn in composition space. It is not saved with the project.">{gridOn ? 'Hide alignment grid' : 'Show alignment grid'}</button>
    <button disabled={!outputOpen} onclick={() => identifyScreen(screen.id)} title="Shows a large {screenNumber} on this Screen's projector for four seconds.">Identify ({screenNumber})</button>
  </div>
  {#if !outputOpen}<p>Open this Screen on its display to use the alignment grid and Identify.</p>
  {:else if gridOn}<p class="note">Alignment grid is showing{partner ? ` on ${screen.name} and ${partner.name}` : ''}: the left projector draws green, the right magenta, so lines that meet turn white. Yellow lines mark the overlap boundaries. The fade is off while the grid shows.</p>{/if}
  <label><input type="checkbox" checked={calibration.enabled} onchange={e => setCalibration(e.currentTarget.checked)} /> Correct output geometry</label>
  <p>Place the four corners on the physical backdrop. This changes where the image lands, independently of the source slice above.</p>
  {#if calibration.enabled}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <svg bind:this={editor} class:large={largeEditor} viewBox="{-MARGIN * aspect} {-MARGIN} {aspect * (1 + 2 * MARGIN)} {1 + 2 * MARGIN}" style:aspect-ratio={aspect}
      role="application" tabindex="0" aria-label="Projector destination corners. Arrow keys move the selected corner by one output pixel." onkeydown={nudge}>
      <rect x="0" y="0" width={aspect} height="1" fill="#080b10" stroke="var(--ga-blue-mute-600)" stroke-width="0.006" />
      <polygon points={calibration.corners.map(p => `${p.x * aspect},${p.y}`).join(' ')} fill="color-mix(in srgb, var(--ga-blue-600) 26.67%, transparent)" stroke={valid ? 'var(--ga-blue-300)' : '#ff685b'} stroke-width="0.008" />
      {#each calibration.corners as point, i}
        <circle cx={point.x * aspect} cy={point.y} r="0.04" fill={i === selectedCorner ? '#ffd45c' : 'var(--ga-blue-300)'} stroke="#080b10" stroke-width="0.008"
          onpointerdown={e => drag(e, i)} role="presentation" />
      {/each}
    </svg>
    <p class="keys">Output {size.width} × {size.height} px{size.known ? '' : ' (no display chosen: assumed)'}. Click a corner, then arrow keys move it 1 px (Shift 10 px, Alt 0.1 px); Up/Down in a number box do the same. Hold Shift while dragging for fine movement.
      {#if aspect < 0.9}<button class="link" onclick={() => largeEditor = !largeEditor}>{largeEditor ? 'Smaller editor' : 'Larger editor'}</button>{/if}</p>
    {#each CORNER_LABELS as label, i}
      {@const point = calibration.corners[i]}
      <div class="corner" class:selected={i === selectedCorner}>
        <button class="link name" onclick={() => selectCorner(i)} title="Select this corner for the arrow keys">{label}</button>
        {#each AXES as axis}
          {@const current = (point[axis] * 100).toFixed(3)}
          <input aria-label={`${label} ${axis} percent`} type="number" step="any"
            value={current} data-current={current} onfocus={() => selectedCorner = i} onchange={e => commit(e, v => setCoordinate(i, axis, v))} onkeydown={e => cornerFieldKey(e, i, axis)} />
        {/each}
        <span class="px">{(point.x * size.width).toFixed(1)}, {(point.y * size.height).toFixed(1)} px</span>
      </div>
    {/each}
    {#if !valid}<p class="error">Corners must form a convex quad without crossing. Output is black until corrected.</p>{/if}
    <button onclick={() => setCalibration(true, defaultProjectorCorners())}>Reset projector corners</button>
  {/if}
  <h4>Shared overlap blend</h4>
  <label><input type="checkbox" checked={band.enabled} onchange={e => setBand({ enabled: e.currentTarget.checked })} /> Angled two-projector overlap</label>
  {#if band.enabled}
    <label>This projector covers <select value={band.side} onchange={e => setBand({ side: e.currentTarget.value as 'left' | 'right' })}><option value="left">Left side</option><option value="right">Right side</option></select></label>
    <p>Set the overlap's left and right boundaries as percentages of the full composition. Top and bottom can differ.</p>
    {#each BAND_FIELDS as [key, label]}
      {@const current = (Number(band[key]) * 100).toFixed(2)}
      <label class="band-field"><span>{label}</span><input aria-label={label + ' percent'} type="number" min="0" max="100" step="0.1"
        value={current} data-current={current} onchange={e => commit(e, v => setBand({ [key]: Math.max(0, Math.min(1, v / 100)) } as Partial<OverlapBand>))} onkeydown={fieldKey} /></label>
    {/each}
    {#if !bandValid}<p class="error">Right boundaries must be greater than left boundaries. The fade is off{partner ? ` and ${partner.name} is not updated` : ''} until they are.</p>{/if}
    <label class="band-field"><span>Projector gamma (overlap brightness)</span><input aria-label="Overlap projector gamma" type="number" min="1" max="4" step="0.05"
      value={overlapGamma(band).toFixed(2)} data-current={overlapGamma(band).toFixed(2)} onchange={e => commit(e, v => setBand({ gamma: Math.max(1, Math.min(4, v)) }))} onkeydown={fieldKey} /></label>
    <input class="gamma" aria-label="Overlap projector gamma slider" type="range" min="1.4" max="3.2" step="0.05" value={overlapGamma(band)}
      oninput={e => setBand({ gamma: +e.currentTarget.value }, true)} ondblclick={() => setBand({ gamma: DEFAULT_OVERLAP_GAMMA })} />
    <p>On a flat white or mid-grey image: if the overlap looks darker than the rest, raise this; if it looks brighter, lower it. 2.2 is standard. Double-click the slider to reset.</p>
    {#if legacyBlend}<p class="error">This Screen also has Edge Blend ramps, which darken the seam a second time. Set them to 0, or pair again to clear them.</p>{/if}
    {#if partner}
      <p class={inStep ? 'note' : 'error'}>Paired with <strong>{partner.name}</strong>. {inStep ? 'Boundaries, gamma and source crops are shared: edits here update both Screens.' : 'The two Screens no longer match (boundaries, gamma or source crops differ).'}</p>
      {#if !inStep}<button disabled={!bandValid} onclick={pair}>Re-sync pair from this Screen</button>{/if}
    {:else if partnerMissing}
      <p class="error">The Screen this was paired with no longer exists. This Screen still fades toward it: choose the other projector and pair again, or turn the overlap off.</p>
    {:else}
      <p>Not paired yet: the fade applies to this Screen only.</p>
    {/if}
    <label>Other projector<select bind:value={chosenPartner}><option value="">Choose screen…</option>{#each $screens.filter(s => s.id !== screen.id) as other}<option value={other.id}>{other.name}</option>{/each}</select></label>
    {#if !partner || chosenPartner !== partner.id}
      <button disabled={!chosenPartner || !bandValid} onclick={pair}>Pair blend &amp; set overlapping crops</button>
      <p>Pairing sets both source slices to Rectangle, replaces their crops, and clears rectangular edge blends. Projector calibration stays intact.</p>
    {/if}
  {/if}
</section>
<style>
  .calibration{padding:14px 0;border-top:1px solid #343842;min-width:0}h4{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#9bacc0;margin:12px 0}p{font-size:12px;line-height:1.5;color:#9ca5b3}label{display:flex;align-items:center;gap:8px;font-size:12px;margin:10px 0;flex-wrap:wrap}
  svg{display:block;width:100%;max-height:260px;margin:0 auto;touch-action:none;border-radius:4px;outline:none}svg.large{max-height:620px}svg:focus-visible{box-shadow:0 0 0 1px var(--ga-blue-300)}circle{cursor:grab}
  .corner{display:grid;grid-template-columns:minmax(0,1fr) 78px 78px;gap:2px 6px;align-items:center;font-size:12px;margin:6px 0}.corner .px{grid-column:1 / -1;text-align:right;font-size:11px;color:#7f8a9a;font-variant-numeric:tabular-nums}.corner.selected .name{color:#ffd45c}
  input[type=number],select{min-width:0;max-width:100%;background:#0a0d12;color:#e4edf5;border:1px solid var(--ga-blue-mute-600);border-radius:5px;padding:7px;box-sizing:border-box}.corner input[type=number]{padding:6px 5px;font-size:12px;font-variant-numeric:tabular-nums;appearance:textfield}.corner input[type=number]::-webkit-inner-spin-button{appearance:none;margin:0}select{flex:1}input[type=number]{width:100%}input.gamma{width:100%}.band-field{display:grid;grid-template-columns:minmax(0,1fr) 75px}
  button{width:100%;padding:9px;border:1px solid var(--ga-blue-mute-600);border-radius:5px;background:var(--ga-blue-mute-800);color:#d8e8f8;font-size:12px;cursor:pointer}button:disabled{opacity:.4;cursor:default}button.active{background:#5a4a12;border-color:#c9a53a;color:#fff1c4}
  button.link{width:auto;padding:0;border:0;background:none;color:var(--ga-blue-200);text-align:left;text-decoration:underline;cursor:pointer}.aids{display:grid;grid-template-columns:1fr auto;gap:6px}.aids button:last-child{width:auto;padding:9px 12px}
  .error{color:#ff9188}.note{color:#b9c9a4}.keys{font-size:11px}
</style>
