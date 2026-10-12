import {homography,project,unitCorners,validQuad,type UV} from '../mobile/studio/calibration';
import {inverseProjectorHomography} from './projectorCalibration';
/** `corners` is what Apply writes: null when the trace cannot be a corner calibration.
 * `reordered` says the traced order was not TL/TR/BR/BL in the projector's raster and was put right.
 * `mirrored` says the projector's own corners run anticlockwise in the photo. */
export type ImportedCalibration={name:string;image:string;projectors:{id:string;name:string;width:number;height:number;mirrored:boolean;surfaces:{id:string;name:string;points:UV[];corners:UV[]|null;reordered:boolean}[]}[]};
/** The output stage draws only a convex quad wound top-left, top-right,
 * bottom-right, bottom-left in the projector's raster; any other order is a
 * black Screen (anticlockwise) or a turned picture (another start corner).
 * A trace is a shape, not an orientation, so its four points are put into
 * that order by where they sit in the raster: wound clockwise, starting from
 * the corner that best matches the raster's own top-left. The picture is
 * therefore always upright and unmirrored in the raster; a turned surface is
 * the Screen's Rotation control. Returns null for a crossed or collapsed quad,
 * or anything the output stage would refuse. */
export function normalizeDestinationQuad(points:UV[]):{corners:UV[];reordered:boolean}|null{
 if(points?.length!==4||points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))return null;
 const cross=points.map((a,i)=>{const b=points[(i+1)%4],c=points[(i+2)%4];return(b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x);});
 const clockwise=cross.every(n=>n>1e-6),anticlockwise=cross.every(n=>n< -1e-6);
 if(!clockwise&&!anticlockwise)return null;
 const wound=clockwise?points:[points[0],points[3],points[2],points[1]];
 const cost=(k:number)=>unitCorners.reduce((sum,u,i)=>{const p=wound[(i+k)%4];return sum+(p.x-u.x)**2+(p.y-u.y)**2;},0);
 let start=0;for(let k=1;k<4;k++)if(cost(k)<cost(start)-1e-12)start=k;
 const corners=unitCorners.map((_,i)=>({...wound[(i+start)%4]}));
 return inverseProjectorHomography(corners)?{corners,reordered:anticlockwise||start!==0}:null;
}
/** Trust measured corner correspondences, never caller-supplied matrices or output commands. */
export function readMobileCalibration(text:string):ImportedCalibration{
 if(text.length>25_000_000)throw Error('Calibration exceeds 25 MB.');
 const c=JSON.parse(text);
 const point=(p:any)=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1;
 if(c?.schema!=='ghost-calibration'||c.version!==1||c.status!=='prepared'||!Array.isArray(c.projectors)||!c.projectors.length||c.projectors.length>16||!Array.isArray(c.surfaces)||c.surfaces.length>128||!c.reference||typeof c.reference.image!=='string'||!/^data:image\/(jpeg|png);base64,[a-zA-Z0-9+/=]+$/.test(c.reference.image))throw Error('Unsupported calibration package.');
 const name=(n:unknown)=>typeof n==='string'?n.slice(0,100):'Untitled';
 for(const s of c.surfaces)if(!s||typeof s.id!=='string'||!Array.isArray(s.points)||s.points.length<3||s.points.length>64||!s.points.every(point))throw Error('Invalid surface points.');
 const projectors=c.projectors.map((p:any)=>{
  if(!p||typeof p.id!=='string'||![p.width,p.height].every(n=>Number.isInteger(n)&&n>=2&&n<=16384)||!Array.isArray(p.corners)||!p.corners.every(point)||!validQuad(p.corners))throw Error('Invalid projector measurements.');
  const h=homography(p.corners,unitCorners);
  const turn=(p.corners[1].x-p.corners[0].x)*(p.corners[2].y-p.corners[1].y)-(p.corners[1].y-p.corners[0].y)*(p.corners[2].x-p.corners[1].x);
  return{id:p.id,name:name(p.name),width:p.width,height:p.height,mirrored:turn<0,surfaces:c.surfaces.map((s:any)=>{
   const points=s.points.map((v:UV)=>project(h,v));
   // Native output accepts a convex TL/TR/BR/BL quad in this bounded raster area.
   const bounded=points.every((v:UV)=>Number.isFinite(v.x)&&Number.isFinite(v.y)&&v.x>=-1&&v.x<=2&&v.y>=-1&&v.y<=2);
   const quad=bounded?normalizeDestinationQuad(points):null;
   return{id:s.id,name:name(s.name),points,corners:quad?.corners??null,reordered:!!quad?.reordered};
  })};
 });
 return{name:name(c.name),image:c.reference.image,projectors};
}
