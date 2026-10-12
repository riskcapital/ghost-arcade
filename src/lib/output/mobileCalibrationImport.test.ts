import {describe,it,expect} from 'vitest';
import {readMobileCalibration,normalizeDestinationQuad} from './mobileCalibrationImport';
import {inverseProjectorHomography,projectorCalibrationUniforms} from '../output/projectorCalibration';
const quad=[{x:.1,y:.1},{x:.9,y:.1},{x:.9,y:.9},{x:.1,y:.9}];
const fixture=()=>({schema:'ghost-calibration',version:1,status:'prepared',name:'Stage',reference:{image:'data:image/jpeg;base64,AAAA'},projectors:[{id:'p',name:'Portrait',width:1080,height:1920,corners:structuredClone(quad),photoToProjector:[999]}],surfaces:[{id:'s',name:'Wall',points:structuredClone(quad)}]});
describe('phone calibration import',()=>{
 it('recomputes geometry from correspondences rather than trusting imported matrices',()=>{const p=readMobileCalibration(JSON.stringify(fixture())).projectors[0];expect(p.width).toBe(1080);expect(p.surfaces[0].corners![0].x).toBeCloseTo(0);expect(p.surfaces[0].corners![2].y).toBeCloseTo(1);});
 it('rejects degenerate projector geometry',()=>{const c=fixture();c.projectors[0].corners=quad.map(()=>({x:0,y:0}));expect(()=>readMobileCalibration(JSON.stringify(c))).toThrow();});
 it('keeps a polygon reviewable but does not offer corner calibration',()=>{const c=fixture();c.surfaces[0].points=quad.slice(0,3);expect(readMobileCalibration(JSON.stringify(c)).projectors[0].surfaces[0].corners).toBeNull();});
 it('does not accept remote images or unsupported versions',()=>{const c=fixture();c.reference.image='https://example.org/photo';expect(()=>readMobileCalibration(JSON.stringify(c))).toThrow();c.reference.image='data:image/jpeg;base64,AAAA';c.version=2;expect(()=>readMobileCalibration(JSON.stringify(c))).toThrow();});
 it('rejects invalid point payloads',()=>{const c=fixture();c.surfaces[0].points[0]={x:3,y:0};expect(()=>readMobileCalibration(JSON.stringify(c))).toThrow();});
 it('does not apply a crossed surface',()=>{const c=fixture();c.surfaces[0].points=[quad[0],quad[2],quad[1],quad[3]];expect(readMobileCalibration(JSON.stringify(c)).projectors[0].surfaces[0].corners).toBeNull();});
 // Projector marked on the whole photo, so a traced point is its own raster position.
 const whole=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];
 const wall=[{x:.2,y:.1},{x:.85,y:.2},{x:.95,y:.9},{x:.05,y:.95}];
 const traced=(points:{x:number;y:number}[],projector=whole)=>{const c=fixture();c.projectors[0].corners=structuredClone(projector);c.surfaces[0].points=structuredClone(points);return readMobileCalibration(JSON.stringify(c)).projectors[0];};
 const close=(got:{x:number;y:number}[],want:{x:number;y:number}[])=>want.forEach((p,i)=>{expect(got[i].x).toBeCloseTo(p.x,9);expect(got[i].y).toBeCloseTo(p.y,9);});
 it('leaves a correctly traced surface exactly as traced',()=>{const s=traced(wall).surfaces[0];close(s.corners!,wall);expect(s.reordered).toBe(false);});
 it('applies a surface traced anticlockwise instead of blacking out the projector',()=>{
  // TL, BL, BR, TR passed the old check, said "applied", and the output stage drew nothing.
  const s=traced([wall[0],wall[3],wall[2],wall[1]]).surfaces[0];
  close(s.corners!,wall);expect(s.reordered).toBe(true);
  expect(projectorCalibrationUniforms({projectorCalibration:{enabled:true,corners:s.corners!}})[2][3]).toBe(1);
 });
 it('keeps the picture upright when the trace starts at another corner',()=>{
  // TR first used to be applied as a quarter-turned picture.
  for(let k=1;k<4;k++){const s=traced(wall.map((_,i)=>wall[(i+k)%4])).surfaces[0];close(s.corners!,wall);expect(s.reordered).toBe(true);}
 });
 it('never offers Apply for corners the output stage would refuse, in any traced order',()=>{
  const orders=[0,1,2,3].flatMap(a=>[0,1,2,3].flatMap(b=>[0,1,2,3].flatMap(c=>[0,1,2,3].map(d=>[a,b,c,d])))).filter(o=>new Set(o).size===4);
  let offered=0;
  for(const order of orders){const s=traced(order.map(i=>wall[i])).surfaces[0];
   if(s.corners){offered++;expect(inverseProjectorHomography(s.corners)).not.toBeNull();close(s.corners,wall);}}
  // 8 of the 24 orders walk the outline (4 starts x 2 directions); the other 16 cross it.
  expect(offered).toBe(8);
  expect(normalizeDestinationQuad([wall[0],wall[2],wall[1],wall[3]])).toBeNull();
  expect(normalizeDestinationQuad(wall.slice(0,3))).toBeNull();
 });
 it('flags a projector whose corners run anticlockwise in the photo and still gives a usable quad',()=>{
  // Rear projection or a mirror: photo x is raster 1 - x.
  const p=traced(wall,[whole[1],whole[0],whole[3],whole[2]]);
  expect(p.mirrored).toBe(true);expect(traced(wall).mirrored).toBe(false);
  const s=p.surfaces[0];expect(s.reordered).toBe(true);expect(inverseProjectorHomography(s.corners!)).not.toBeNull();
  close(s.corners!,[wall[1],wall[0],wall[3],wall[2]].map(q=>({x:1-q.x,y:q.y})));
 });
});
