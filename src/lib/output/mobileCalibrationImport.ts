import {homography,project,unitCorners,validQuad,type UV} from '../mobile/studio/calibration';
export type ImportedCalibration={name:string;image:string;projectors:{id:string;name:string;width:number;height:number;surfaces:{id:string;name:string;points:UV[];corners:UV[]|null}[]}[]};
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
  return{id:p.id,name:name(p.name),width:p.width,height:p.height,surfaces:c.surfaces.map((s:any)=>{
   const points=s.points.map((v:UV)=>project(h,v));
   // Native output accepts a convex TL/TR/BR/BL quad in this bounded raster area.
   const bounded=points.every((v:UV)=>Number.isFinite(v.x)&&Number.isFinite(v.y)&&v.x>=-1&&v.x<=2&&v.y>=-1&&v.y<=2);
   const normalized=points.map((v:UV)=>({x:(v.x+1)/3,y:(v.y+1)/3}));
   return{id:s.id,name:name(s.name),points,corners:bounded&&validQuad(normalized)?points:null};
  })};
 });
 return{name:name(c.name),image:c.reference.image,projectors};
}
