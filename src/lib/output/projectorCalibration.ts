/** Projector destination corners use top-left-origin normalized display coordinates.
 * The inverse homography maps physical projector pixels back to the source crop.
 * Blend bands live in shared composition coordinates, not individual projector UV. */
export type ProjectorQuad = { x: number; y: number }[];
export type ProjectorCalibration = { enabled: boolean; corners: ProjectorQuad };
/** `partnerId` names the Screen sharing this band, so boundary edits keep both
 * outputs in step. `gamma` is the projectors' response: the fade is shaped so
 * the two outputs add up to the unblended brightness on a projector with that
 * gamma (2.2 = standard; the ramp is then linear in light). */
export type OverlapBand = { enabled: boolean; side: 'left' | 'right'; startTop: number; startBottom: number; endTop: number; endBottom: number; partnerId?: string; gamma?: number };
export const DEFAULT_OVERLAP_GAMMA = 2.2;
export const overlapGamma = (band?: { gamma?: number }) => Number.isFinite(band?.gamma) ? Math.max(1, Math.min(4, band!.gamma!)) : DEFAULT_OVERLAP_GAMMA;
export const overlapBandValid = (b?: OverlapBand) => !!b && [b.startTop,b.startBottom,b.endTop,b.endBottom].every(Number.isFinite) && b.endTop>b.startTop && b.endBottom>b.startBottom;
export const defaultProjectorCorners = (): ProjectorQuad => [{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];
export const defaultOverlap = (): OverlapBand => ({ enabled:false, side:'left', startTop:0.45, startBottom:0.4, endTop:0.55, endBottom:0.6 });

/** Solve destination -> unit square. Reject folds, degenerate and nonfinite quads. */
export function inverseProjectorHomography(corners: ProjectorQuad): number[] | null {
  if (corners?.length !== 4 || corners.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
  const crosses = corners.map((p,i) => { const q=corners[(i+1)%4], r=corners[(i+2)%4]; return (q.x-p.x)*(r.y-q.y)-(q.y-p.y)*(r.x-q.x); });
  if (!crosses.every(c => c > 1e-6)) return null;
  const target = defaultProjectorCorners();
  const m: number[][] = [];
  corners.forEach(({x,y},i) => { const {x:u,y:v}=target[i]; m.push([x,y,1,0,0,0,-u*x,-u*y,u],[0,0,0,x,y,1,-v*x,-v*y,v]); });
  for (let c=0;c<8;c++) {
    let pivot=c; for(let r=c+1;r<8;r++) if(Math.abs(m[r][c])>Math.abs(m[pivot][c])) pivot=r;
    if(Math.abs(m[pivot][c])<1e-10) return null;
    [m[c],m[pivot]]=[m[pivot],m[c]];
    const d=m[c][c]; for(let k=c;k<=8;k++) m[c][k]/=d;
    for(let r=0;r<8;r++) if(r!==c) { const v=m[r][c]; for(let k=c;k<=8;k++) m[r][k]-=v*m[c][k]; }
  }
  return [...m.map(row=>row[8]),1];
}

export function projectorCalibrationUniforms(slice: { projectorCalibration?: ProjectorCalibration; overlapBand?: OverlapBand }): number[][] {
  const enabled=!!slice.projectorCalibration?.enabled;
  const h=enabled ? inverseProjectorHomography(slice.projectorCalibration!.corners) : null;
  const matrix=h ?? [1,0,0,0,1,0,0,0,1];
  const b=slice.overlapBand;
  const valid=!!b?.enabled && overlapBandValid(b);
  // Row 4 z: exponent applied to the linear ramp. 0 (old cores, default gamma) means 1.
  const gamma=overlapGamma(b);
  const exponent=valid && Math.abs(gamma-DEFAULT_OVERLAP_GAMMA)>1e-6 ? DEFAULT_OVERLAP_GAMMA/gamma : 0;
  return [[...matrix.slice(0,3),0],[...matrix.slice(3,6),0],[...matrix.slice(6,9),enabled ? (h ? 1 : -1) : 0],
    valid ? [b!.startTop,b!.startBottom,b!.endTop,b!.endBottom] : [0,0,1,1], [valid ? 1 : 0,b?.side==='right'?1:0,exponent,0]];
}

type PairSlice = { id: string; cropX?: number; cropW?: number; overlapBand?: OverlapBand };
/** Band and source crops for both Screens of a pair, from one band. The crops
 * overlap across the band so neither projector's picture is stretched
 * separately: left takes 0..band end, right takes band start..1. */
export function pairedOverlapPatches(band: OverlapBand, selfId: string, partnerId: string): Record<string, { cropX: number; cropW: number; overlapBand: OverlapBand }> {
  const start=Math.max(0,Math.min(band.startTop,band.startBottom)), end=Math.min(1,Math.max(band.endTop,band.endBottom));
  const leftId=band.side==='left' ? selfId : partnerId, rightId=band.side==='left' ? partnerId : selfId;
  const shared={ enabled:band.enabled, startTop:band.startTop, startBottom:band.startBottom, endTop:band.endTop, endBottom:band.endBottom, gamma:overlapGamma(band) };
  return {
    [leftId]: { cropX:0, cropW:end, overlapBand:{ ...shared, side:'left', partnerId:rightId } },
    [rightId]: { cropX:start, cropW:1-start, overlapBand:{ ...shared, side:'right', partnerId:leftId } },
  };
}
/** The Screen this one is paired with: by stored id, else (projects paired
 * before ids were stored) the one Screen carrying the same band on the other side. */
export function overlapPartner<T extends PairSlice>(screen: T, all: readonly T[]): T | null {
  const band=screen.overlapBand;
  if (band?.partnerId) return all.find(s=>s.id===band.partnerId && s.id!==screen.id) ?? null;
  if (!band?.enabled) return null;
  const near=(a:number,b:number)=>Math.abs(a-b)<1e-6;
  const matches=all.filter(s=>{ const o=s.overlapBand; return s.id!==screen.id && !!o?.enabled && !o.partnerId && o.side!==band.side
    && near(o.startTop,band.startTop) && near(o.startBottom,band.startBottom) && near(o.endTop,band.endTop) && near(o.endBottom,band.endBottom); });
  return matches.length===1 ? matches[0] : null;
}
/** True when the partner carries exactly what pairing from `screen` would give it. */
export function overlapPairInStep(screen: PairSlice, partner: PairSlice): boolean {
  if (!screen.overlapBand || !partner.overlapBand) return false;
  const want=pairedOverlapPatches(screen.overlapBand, screen.id, partner.id);
  const near=(a:number|undefined,b:number)=>Math.abs((a ?? NaN)-b)<1e-6;
  return [screen,partner].every(s=>{ const w=want[s.id], o=s.overlapBand!; return near(s.cropX,w.cropX) && near(s.cropW,w.cropW) && o.enabled===w.overlapBand.enabled && o.side===w.overlapBand.side
    && near(o.startTop,w.overlapBand.startTop) && near(o.startBottom,w.overlapBand.startBottom) && near(o.endTop,w.overlapBand.endTop) && near(o.endBottom,w.overlapBand.endBottom) && near(overlapGamma(o),w.overlapBand.gamma!); });
}
/** Move one corner by whole (or fractional) output pixels. */
export function nudgeProjectorCorner(corners: ProjectorQuad, index: number, dxPx: number, dyPx: number, width: number, height: number): ProjectorQuad {
  const clamp=(v:number)=>Math.max(-1,Math.min(2,v));
  return corners.map((p,i)=>i===index ? { x:clamp(p.x+dxPx/Math.max(1,width)), y:clamp(p.y+dyPx/Math.max(1,height)) } : { ...p });
}
