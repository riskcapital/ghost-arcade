import {surfaceVertices} from './compositor';
import type {Point,Surface} from './model';
export function snapMappingPoint(p:Point,surfaces:Surface[],selected:number,width:number,height:number):Point {
 const xs=[0,1,Math.round(p.x*16)/16],ys=[0,1,Math.round(p.y*9)/9];
 surfaces.forEach((s,i)=>{if(i!==selected&&s.enabled)s.points.forEach(q=>{xs.push(q.x);ys.push(q.y);});});
 const nearest=(v:number,points:number[],size:number)=>{const n=points.reduce((a,b)=>Math.abs(b-v)<Math.abs(a-v)?b:a,points[0]);return Math.abs(n-v)*size<=9?n:v;};
 return {x:nearest(p.x,xs,width),y:nearest(p.y,ys,height)};
}
export function hitMappingScreens(p:Point,surfaces:Surface[]):number[]{
 const hits:number[]=[];
 for(let i=surfaces.length-1;i>=0;i--){const s=surfaces[i];if(!s.enabled)continue;const v=surfaceVertices(s);
  for(let j=0;j<v.length;j+=12){const ax=v[j],ay=v[j+1],bx=v[j+4],by=v[j+5],cx=v[j+8],cy=v[j+9];
   const area=(bx-ax)*(cy-ay)-(by-ay)*(cx-ax);if(Math.abs(area)<1e-9)continue;
   const u=((p.x-ax)*(cy-ay)-(p.y-ay)*(cx-ax))/area,w=((bx-ax)*(p.y-ay)-(by-ay)*(p.x-ax))/area;
   if(u>=-1e-6&&w>=-1e-6&&u+w<=1.000001){hits.push(i);break;}
  }
 }return hits;
}

export function paintHit(p:Point,surfaces:Surface[]):{surface:string;u:number;v:number}|null{
 for(let i=surfaces.length-1;i>=0;i--){
  const s=surfaces[i];if(!s.enabled)continue;const verts=surfaceVertices(s);
  for(let j=verts.length-12;j>=0;j-=12){
   const ax=verts[j],ay=verts[j+1],bx=verts[j+4],by=verts[j+5],cx=verts[j+8],cy=verts[j+9];
   const area=(bx-ax)*(cy-ay)-(by-ay)*(cx-ax);if(Math.abs(area)<1e-9)continue;
   const b=((p.x-ax)*(cy-ay)-(p.y-ay)*(cx-ax))/area,c=((bx-ax)*(p.y-ay)-(by-ay)*(p.x-ax))/area;
   if(b>=0&&c>=0&&b+c<=1)return{surface:s.id,u:verts[j+2]*(1-b-c)+verts[j+6]*b+verts[j+10]*c,v:verts[j+3]*(1-b-c)+verts[j+7]*b+verts[j+11]*c};
  }
 }return null;
}
