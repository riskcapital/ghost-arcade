import type {Point,InteractiveSurface} from './interactive';
/** Mobile mapping stores a 3×3 grid even in corner mode. Convert its boundary
 * in winding order; mesh surfaces need resampling and are intentionally omitted. */
export function importCornerSurfaces(surfaces:{name:string;points:Point[];enabled:boolean;mode:string}[]):InteractiveSurface[]{
 return surfaces.filter(s=>s.enabled&&s.mode==='corners'&&[4,9].includes(s.points.length)).slice(0,32).map(s=>({id:crypto.randomUUID(),name:s.name,behavior:'solid',points:structuredClone(s.points.length===9?[s.points[0],s.points[2],s.points[8],s.points[6]]:s.points)}));
}
export function translatePoints(points:Point[],dx:number,dy:number):Point[]{
 dx=Math.max(-Math.min(...points.map(p=>p.x)),Math.min(1-Math.max(...points.map(p=>p.x)),dx));
 dy=Math.max(-Math.min(...points.map(p=>p.y)),Math.min(1-Math.max(...points.map(p=>p.y)),dy));
 return points.map(p=>({x:p.x+dx,y:p.y+dy}));
}
export function transformPoints(points:Point[],scale:number,angle=0):Point[]{
 const cx=points.reduce((v,p)=>v+p.x,0)/points.length,cy=points.reduce((v,p)=>v+p.y,0)/points.length;
 const next=points.map(p=>({x:cx+(p.x-cx)*scale*Math.cos(angle)-(p.y-cy)*scale*Math.sin(angle),y:cy+(p.x-cx)*scale*Math.sin(angle)+(p.y-cy)*scale*Math.cos(angle)}));
 if(next.some(p=>p.x<0||p.x>1||p.y<0||p.y>1))return points;
 return next;
}
export function makeSurface(kind:'box'|'circle'|'triangle',count:number):InteractiveSurface{
 const points=kind==='box'?[{x:.35,y:.3},{x:.65,y:.3},{x:.65,y:.7},{x:.35,y:.7}]:kind==='triangle'?[{x:.5,y:.25},{x:.7,y:.7},{x:.3,y:.7}]:Array.from({length:16},(_,i)=>({x:.5+Math.cos(i*Math.PI/8)*.15,y:.5+Math.sin(i*Math.PI/8)*.24}));
 return{id:crypto.randomUUID(),name:`${kind[0].toUpperCase()+kind.slice(1)} ${count+1}`,behavior:'solid',points};
}
