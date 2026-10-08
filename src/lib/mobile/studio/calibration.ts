/** Mobile-only preparation format. No desktop commands are sent by this module. */
export type UV={x:number;y:number};
export type DepthReference={width:number;height:number;millimeters:string;confidence:string;intrinsics:number[];cameraToWorld:number[];timestamp:number};
export type Reference={image:string;width:number;height:number;depth?:DepthReference};
export type Surface={id:string;name:string;points:UV[]};
export type Projector={id:string;name:string;width:number;height:number;corners:UV[]};
export type Calibration={schema:'ghost-calibration';version:1;id:string;name:string;created:string;status:'prepared';reference:Reference;surfaces:Surface[];projectors:Projector[]};
export const unitCorners:UV[]=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];
export function validQuad(p:UV[]){
 if(p.length!==4||p.some(v=>!Number.isFinite(v.x)||!Number.isFinite(v.y)||v.x<0||v.x>1||v.y<0||v.y>1))return false;
 const cross=p.map((a,i)=>{const b=p[(i+1)%4],c=p[(i+2)%4];return(b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x)});
 return cross.every(n=>n>1e-5)||cross.every(n=>n< -1e-5);
}
export function homography(from:UV[],to:UV[]):number[]{
 if(!validQuad(from)||!validQuad(to))throw new Error('Mark four distinct corners around a convex area: top left, top right, bottom right, bottom left.');
 const a:number[][]=[];
 from.forEach((p,i)=>{const q=to[i];a.push([p.x,p.y,1,0,0,0,-q.x*p.x,-q.x*p.y,q.x],[0,0,0,p.x,p.y,1,-q.y*p.x,-q.y*p.y,q.y]);});
 for(let c=0;c<8;c++){let pivot=c;for(let j=c+1;j<8;j++)if(Math.abs(a[j][c])>Math.abs(a[pivot][c]))pivot=j;
  if(Math.abs(a[pivot][c])<1e-10)throw new Error('Calibration points are too close together.');
  [a[c],a[pivot]]=[a[pivot],a[c]];const scale=a[c][c];for(let k=c;k<9;k++)a[c][k]/=scale;
  for(let j=0;j<8;j++)if(j!==c){const f=a[j][c];for(let k=c;k<9;k++)a[j][k]-=f*a[c][k];}
 }
 return [...a.map(row=>row[8]),1];
}
export function project(h:number[],p:UV):UV{const w=h[6]*p.x+h[7]*p.y+h[8];if(!Number.isFinite(w)||Math.abs(w)<1e-8)throw new Error('Point crosses the calibration horizon.');return{x:(h[0]*p.x+h[1]*p.y+h[2])/w,y:(h[3]*p.x+h[4]*p.y+h[5])/w};}
export function bytes(base64:string){return Uint8Array.from(atob(base64),c=>c.charCodeAt(0));}
export function depthPoint(d:DepthReference,p:UV):number[]|null{
 const x=Math.min(d.width-1,Math.max(0,Math.floor(p.x*d.width))),y=Math.min(d.height-1,Math.max(0,Math.floor(p.y*d.height))),i=y*d.width+x;
 const raw=bytes(d.millimeters),confidence=bytes(d.confidence);
 if(raw.length!==d.width*d.height*2||confidence.length!==d.width*d.height||confidence[i]<1)return null;
 const z=(raw[i*2]+raw[i*2+1]*256)/1000,[fx,fy,cx,cy]=d.intrinsics;
 if(!z||!fx||!fy)return null;
 // ARKit camera: right +X, up +Y, camera looks down -Z. Image is sensor-native, top-left origin.
 return [((x+.5)/d.width-cx)*z/fx,-((y+.5)/d.height-cy)*z/fy,-z];
}
export function worldPoint(d:DepthReference,p:UV){const v=depthPoint(d,p);if(!v)return null;const m=d.cameraToWorld;return [0,1,2].map(i=>m[i]*v[0]+m[4+i]*v[1]+m[8+i]*v[2]+m[12+i]);}
export function exportCalibration(c:Calibration){
 if(!c.reference.image||!c.projectors.length||!c.surfaces.length)throw new Error('Add a reference, a projector and at least one surface.');
 return {...c,coordinates:{photo:'normalized-top-left-sensor-native',projector:'normalized-top-left',world:'ARKit-right-handed-meters',matrix:'row-major-homography; column-major-cameraToWorld'},hardwareVerified:false,
  projectors:c.projectors.map(p=>{const photoToProjector=homography(p.corners,unitCorners);return {...p,photoToProjector,surfaces:c.surfaces.map(s=>({...s,depthQuality:c.reference.depth?surfaceDepthQuality(c.reference.depth,s.points):null,projectorPoints:s.points.map(v=>project(photoToProjector,v)),worldPoints:c.reference.depth?s.points.map(v=>worldPoint(c.reference.depth!,v)):null}))};})};
}
/** Deterministic pattern manifest for a later desktop presenter; never fires projectors. */
export function grayPatternPlan(width:number,height:number){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<2||height<2||width>16384||height>16384)throw new Error('Invalid projector resolution.');
 const steps:{kind:string;axis?:string;bit?:number;inverse?:boolean}[]=[{kind:'black'},{kind:'white'}];
 for(const [axis,n] of [['x',width],['y',height]] as const)for(let bit=Math.ceil(Math.log2(n))-1;bit>=0;bit--)for(const inverse of [false,true])steps.push({kind:'gray',axis,bit,inverse});return steps;
}

/** Coverage and plane residual are advisory; they do not calibrate a projector. */
export function surfaceDepthQuality(d:DepthReference,polygon:UV[]){
 const raw=bytes(d.millimeters),confidence=bytes(d.confidence),samples:number[][]=[];
 if(raw.length!==d.width*d.height*2||confidence.length!==d.width*d.height)return null;
 const [fx,fy,cx,cy]=d.intrinsics;if(!(fx>0&&fy>0))return null;
 const inside=(x:number,y:number)=>{let hit=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)hit=!hit;}return hit;};
 let tested=0;const step=Math.max(1,Math.ceil(Math.sqrt(d.width*d.height/1500)));
 for(let y=0;y<d.height;y+=step)for(let x=0;x<d.width;x+=step){const u=(x+.5)/d.width,v=(y+.5)/d.height;if(!inside(u,v))continue;tested++;const i=y*d.width+x,z=(raw[i*2]+raw[i*2+1]*256)/1000;if(confidence[i]<1||!z)continue;samples.push([(u-cx)*z/fx,-(v-cy)*z/fy,-z]);}
 if(samples.length<12)return {samples:samples.length,coverage:tested?samples.length/tested:0,planeRmsMm:null};
 // Least-squares z=ax+by+c. Return null for an ill-conditioned, edge-on region.
 const a=Array.from({length:3},()=>[0,0,0,0]);for(const p of samples){const v=[p[0],p[1],1];for(let i=0;i<3;i++){for(let j=0;j<3;j++)a[i][j]+=v[i]*v[j];a[i][3]+=v[i]*p[2];}}
 for(let c=0;c<3;c++){let pivot=c;for(let j=c+1;j<3;j++)if(Math.abs(a[j][c])>Math.abs(a[pivot][c]))pivot=j;if(Math.abs(a[pivot][c])<1e-8)return {samples:samples.length,coverage:samples.length/tested,planeRmsMm:null};[a[c],a[pivot]]=[a[pivot],a[c]];const k=a[c][c];for(let j=c;j<4;j++)a[c][j]/=k;for(let i=0;i<3;i++)if(i!==c){const f=a[i][c];for(let j=c;j<4;j++)a[i][j]-=f*a[c][j];}}
 const [nx,ny,b]=a.map(row=>row[3]),normal=Math.hypot(nx,ny,1);
 return {samples:samples.length,coverage:samples.length/tested,planeRmsMm:1000*Math.sqrt(samples.reduce((sum,p)=>sum+((p[2]-nx*p[0]-ny*p[1]-b)/normal)**2,0)/samples.length)};
}
