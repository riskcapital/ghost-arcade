<script lang="ts">
  import type { OutputSlice } from '../stores/settings';
  import { screens, screenActions } from '../stores/screens';
  import { defaultProjectorCorners, defaultOverlap, inverseProjectorHomography } from '../output/projectorCalibration';
  let { screen }: { screen: OutputSlice } = $props();
  let partner = $state('');
  const calibration = $derived(screen.projectorCalibration ?? { enabled: false, corners: defaultProjectorCorners() });
  const band = $derived(screen.overlapBand ?? defaultOverlap());
  const valid = $derived(!!inverseProjectorHomography(calibration.corners));
  function update(p: Partial<OutputSlice>) { screenActions.update(screen.id, p); }
  function coordinate(index: number, axis: 'x'|'y', value: number) {
    if (!Number.isFinite(value)) return;
    const corners = calibration.corners.map(p => ({...p}));
    corners[index][axis] = Math.max(-1, Math.min(2, value));
    update({ projectorCalibration: {...calibration, corners} });
  }
  function drag(event: PointerEvent, index: number) {
    const target = event.currentTarget as SVGCircleElement;
    const svg = target.ownerSVGElement!;
    target.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => {
      const box = svg.getBoundingClientRect();
      const corners = calibration.corners.map(p => ({...p}));
      corners[index] = {x:Math.max(-1,Math.min(2,(e.clientX-box.left)/box.width*1.2-0.1)), y:Math.max(-1,Math.min(2,(e.clientY-box.top)/box.height*1.2-0.1))};
      update({projectorCalibration:{...calibration,corners}});
    };
    const end = () => { target.removeEventListener('pointermove',move); target.removeEventListener('pointerup',end); target.removeEventListener('pointercancel',end); };
    target.addEventListener('pointermove',move); target.addEventListener('pointerup',end); target.addEventListener('pointercancel',end);
  }
  function pair() {
    if (!partner || partner===screen.id || band.endTop<=band.startTop || band.endBottom<=band.startBottom) return;
    // Keep source pixels aligned: crops overlap, neither clip is stretched separately.
    const start=Math.min(band.startTop,band.startBottom), end=Math.max(band.endTop,band.endBottom);
    const left=band.side==='left' ? screen.id : partner, right=band.side==='right' ? screen.id : partner;
    const base={cropY:0,cropH:1,warpMode:'rect' as const,edgeBlendLeft:0,edgeBlendRight:0,edgeBlendTop:0,edgeBlendBottom:0};
    screenActions.update(left,{...base,cropX:0,cropW:end,overlapBand:{...band,enabled:true,side:'left'}});
    screenActions.update(right,{...base,cropX:start,cropW:1-start,overlapBand:{...band,enabled:true,side:'right'}});
  }
</script>
<section class="calibration">
  <h4>Projector calibration</h4>
  <label><input type="checkbox" checked={calibration.enabled} onchange={e=>update({projectorCalibration:{...calibration,enabled:e.currentTarget.checked}})} /> Correct output geometry</label>
  <p>Place the four corners on the physical backdrop. This changes where the image lands, independently of the source slice above.</p>
  {#if calibration.enabled}
    <svg viewBox="-0.1 -0.1 1.2 1.2" role="img" aria-label="Projector destination corners">
      <rect x="0" y="0" width="1" height="1" fill="#080b10" stroke="#46566b" stroke-width="0.006" />
      <polygon points={calibration.corners.map(p=>`${p.x},${p.y}`).join(' ')} fill="#3368a944" stroke={valid?'#56c8ff':'#ff685b'} stroke-width="0.008" />
      {#each calibration.corners as point,i}
        <circle cx={point.x} cy={point.y} r="0.035" fill="#56c8ff" onpointerdown={e=>drag(e,i)} role="presentation" />
      {/each}
    </svg>
    {#each ['Top left','Top right','Bottom right','Bottom left'] as label,i}
      <div class="corner"><span>{label}</span>{#each ['x','y'] as axis}<input aria-label={`${label} ${axis} percent`} type="number" step="0.1" min="-100" max="200" value={+(calibration.corners[i][axis as 'x'|'y']*100).toFixed(2)} oninput={e=>coordinate(i,axis as 'x'|'y',+e.currentTarget.value/100)} />{/each}</div>
    {/each}
    {#if !valid}<p class="error">Corners must form a convex quad without crossing. Output is black until corrected.</p>{/if}
    <button onclick={()=>update({projectorCalibration:{enabled:true,corners:defaultProjectorCorners()}})}>Reset projector corners</button>
  {/if}
  <h4>Shared overlap blend</h4>
  <label><input type="checkbox" checked={band.enabled} onchange={e=>update({overlapBand:{...band,enabled:e.currentTarget.checked}})} /> Angled two-projector overlap</label>
  {#if band.enabled}
    <label>This projector covers <select value={band.side} onchange={e=>update({overlapBand:{...band,side:e.currentTarget.value as 'left'|'right'}})}><option value="left">Left side</option><option value="right">Right side</option></select></label>
    <p>Set the overlap's left and right boundaries as percentages of the full composition. Top and bottom can differ. Use the same boundaries on both outputs.</p>
    {#each [['startTop','Left boundary · top'],['startBottom','Left boundary · bottom'],['endTop','Right boundary · top'],['endBottom','Right boundary · bottom']] as [key,label]}
      <label class="band-field"><span>{label}</span><input aria-label={label+' percent'} type="number" min="0" max="100" step="0.1" value={+(Number(band[key as keyof typeof band])*100).toFixed(2)} oninput={e=>update({overlapBand:{...band,[key]:Math.max(0,Math.min(1,+e.currentTarget.value/100))}})} /></label>
    {/each}
    {#if band.endTop<=band.startTop || band.endBottom<=band.startBottom}<p class="error">Right boundaries must be greater than left boundaries.</p>{/if}
    <label>Other projector<select bind:value={partner}><option value="">Choose screen…</option>{#each $screens.filter(s=>s.id!==screen.id) as other}<option value={other.id}>{other.name}</option>{/each}</select></label>
    <button disabled={!partner || band.endTop<=band.startTop || band.endBottom<=band.startBottom} onclick={pair}>Pair blend &amp; set overlapping crops</button>
    <p>Pairing sets both source slices to Rectangle, replaces their crops, and clears rectangular edge blends. Projector calibration stays intact. Re-pair after changing boundaries.</p>
  {/if}
</section>
<style>
  .calibration{min-width:0}h4{font-size:12px;font-weight:700;text-transform:uppercase;color:#bdb9c8;margin:12px 0 8px}h4:first-child{margin-top:0}p{font-size:12px;line-height:1.5;color:#9ca5b3}label{display:flex;align-items:center;gap:8px;font-size:12px;margin:10px 0;flex-wrap:wrap}svg{width:100%;max-height:220px;touch-action:none}circle{cursor:grab}.corner{display:grid;grid-template-columns:minmax(0,1fr) 64px 64px;gap:6px;align-items:center;font-size:12px;margin:6px 0}input[type=number],select{min-width:0;max-width:100%;background:#0a0d12;color:#e4edf5;border:1px solid #414b5b;border-radius:5px;padding:7px;box-sizing:border-box}select{flex:1}input[type=number]{width:100%}.band-field{display:grid;grid-template-columns:minmax(0,1fr) 75px}button{width:100%;padding:9px;border:1px solid #4f6481;border-radius:5px;background:#1e304a;color:#d8e8f8;font-size:12px;cursor:pointer}button:disabled{opacity:.4;cursor:default}.error{color:#ff9188}
</style>
