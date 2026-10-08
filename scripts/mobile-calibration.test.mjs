import assert from 'node:assert/strict';
import {build} from 'esbuild';
const result=await build({entryPoints:['src/lib/mobile/studio/calibration.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {homography,project,unitCorners,validQuad,worldPoint,depthPoint,exportCalibration,grayPatternPlan,surfaceDepthQuality}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const quad=[{x:.14,y:.1},{x:.88,y:.24},{x:.95,y:.86},{x:.05,y:.91}];
const h=homography(quad,unitCorners),back=homography(unitCorners,quad);
for(let i=0;i<4;i++){const p=project(h,quad[i]);assert.ok(Math.hypot(p.x-unitCorners[i].x,p.y-unitCorners[i].y)<1e-9);}
for(let i=0;i<100;i++){const a={x:(i%10+.5)/10,y:(Math.floor(i/10)+.5)/10},b=project(h,project(back,a));assert.ok(Math.hypot(a.x-b.x,a.y-b.y)<1e-9);}
assert.equal(validQuad([quad[0],quad[2],quad[1],quad[3]]),false);
assert.throws(()=>homography(Array(4).fill({x:.5,y:.5}),unitCorners));
assert.throws(()=>homography([{x:NaN,y:0},...quad.slice(1)],unitCorners));
const mm=Buffer.alloc(8);for(let i=0;i<4;i++)mm.writeUInt16LE(2000,i*2);
const d={width:2,height:2,millimeters:mm.toString('base64'),confidence:Buffer.from([2,0,2,2]).toString('base64'),intrinsics:[1,1,.5,.5],cameraToWorld:[1,0,0,0,0,1,0,0,0,0,1,0,3,4,5,1],timestamp:42};
assert.deepEqual(depthPoint(d,{x:.1,y:.1}),[-.5,.5,-2]);assert.equal(depthPoint(d,{x:.9,y:.1}),null);assert.deepEqual(worldPoint(d,{x:.1,y:.1}),[2.5,4.5,3]);
assert.equal(depthPoint({...d,millimeters:''},{x:0,y:0}),null);
const c={schema:'ghost-calibration',version:1,id:'test',name:'Test',created:'now',status:'prepared',reference:{image:'data:image/jpeg;base64,',width:2,height:2,depth:d},surfaces:[{id:'s',name:'Backdrop',points:quad}],projectors:[{id:'p',name:'Portrait',width:1080,height:1920,corners:quad}]};
const out=exportCalibration(c);assert.equal(out.hardwareVerified,false);assert.equal(out.projectors[0].surfaces[0].projectorPoints.length,4);assert.equal(out.reference.depth.timestamp,42);
assert.throws(()=>exportCalibration({...c,projectors:[]}));
const plan=grayPatternPlan(1080,1920);assert.equal(plan.length,46);assert.deepEqual(plan.slice(0,2),[{kind:'black'},{kind:'white'}]);for(let i=2;i<plan.length;i+=2){assert.equal(plan[i].inverse,false);assert.equal(plan[i+1].inverse,true);assert.equal(plan[i].bit,plan[i+1].bit);}
assert.throws(()=>grayPatternPlan(0,1920));
console.log('PASS trapezoid homography, inverse round trips, degenerate rejection, metric depth/confidence, ARKit world coordinates, preparation export, Gray-code manifest');

const plane=Buffer.alloc(32*24*2);for(let i=0;i<32*24;i++)plane.writeUInt16LE(2000,i*2);const quality=surfaceDepthQuality({...d,width:32,height:24,millimeters:plane.toString('base64'),confidence:Buffer.alloc(32*24,2).toString('base64')},unitCorners);assert.ok(quality.planeRmsMm<.001);assert.equal(quality.coverage,1);
console.log('PASS planar depth quality and coverage');
