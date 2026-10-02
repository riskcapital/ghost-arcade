/** Projector destination corners use top-left-origin normalized display coordinates.
 * The inverse homography maps physical projector pixels back to the source crop.
 * Blend bands live in shared composition coordinates, not individual projector UV. */
export type ProjectorQuad = { x: number; y: number }[];
export type ProjectorCalibration = { enabled: boolean; corners: ProjectorQuad };
export type OverlapBand = { enabled: boolean; side: 'left' | 'right'; startTop: number; startBottom: number; endTop: number; endBottom: number };
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
  const valid=b?.enabled && [b.startTop,b.startBottom,b.endTop,b.endBottom].every(Number.isFinite) && b.endTop>b.startTop && b.endBottom>b.startBottom;
  return [[...matrix.slice(0,3),0],[...matrix.slice(3,6),0],[...matrix.slice(6,9),enabled ? (h ? 1 : -1) : 0],
    valid ? [b.startTop,b.startBottom,b.endTop,b.endBottom] : [0,0,1,1], [valid ? 1 : 0,b?.side==='right'?1:0,0,0]];
}
