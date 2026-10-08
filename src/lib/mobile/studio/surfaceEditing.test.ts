import {describe,it,expect} from 'vitest';
import {translatePoints,transformPoints,makeSurface} from './surfaceEditing';
import {defaultInteractive,validateScene,InteractiveWorld,INTERACTIVE_PRESETS} from './interactive';
describe('interactive surface editing',()=>{
 it('keeps an entire translated shape reachable without distorting it',()=>{const p=makeSurface('box',0).points;const moved=translatePoints(p,3,-3);expect(Math.max(...moved.map(v=>v.x))).toBe(1);expect(Math.min(...moved.map(v=>v.y))).toBe(0);expect(moved[1].x-moved[0].x).toBeCloseTo(p[1].x-p[0].x);});
 it('rejects transforms that would strand handles outside the editor',()=>{const p=makeSurface('box',0).points;expect(transformPoints(p,10)).toEqual(p);expect(transformPoints(p,.8)).not.toEqual(p);});
 it('round trips all movements and rejects corrupt geometry',()=>{for(const preset of INTERACTIVE_PRESETS)expect(validateScene({...defaultInteractive(),preset}).preset).toBe(preset);const bad=defaultInteractive();bad.surfaces[0].points[0].x=Infinity;expect(()=>validateScene(bad)).toThrow();});
 it('preserves authored material and depth and rejects non-finite controls',()=>{const scene=defaultInteractive();scene.surfaces[0].material='fire';scene.surfaces[0].height=.4;const saved=validateScene(scene);expect(saved.surfaces[0].material).toBe('fire');expect(saved.surfaces[0].height).toBe(.4);expect(()=>validateScene({...saved,matter:{...saved.matter,lightHeight:Infinity}})).toThrow();expect(()=>validateScene({...saved,surfaces:[{...saved.surfaces[0],material:'bogus'}]})).toThrow();});
 it('attract and repel send particles in opposite directions',()=>{function run(mode:'attract'|'repel'){const w=new InteractiveWorld();w.particles=[{x:.4,y:.5,vx:0,vy:0,life:5,seed:.5}];w.update({...defaultInteractive(),surfaces:[],gravity:0},.01,[{id:'finger',point:{x:.6,y:.5},strength:1,mode}]);return w.particles[0].vx;}expect(run('attract')).toBeGreaterThan(0);expect(run('repel')).toBeLessThan(0);});
});

// Real mobile corner mappings use a 3×3 grid, unlike desktop four-corner slices.
import {importCornerSurfaces} from './surfaceEditing';
it('imports mobile nine-point corner boundaries without center points or source mutation',()=>{
 const points=Array.from({length:9},(_,i)=>({x:(i%3)/2,y:Math.floor(i/3)/2}));
 const result=importCornerSurfaces([{name:'Backdrop',enabled:true,mode:'corners',points}]);
 expect(result[0].points).toEqual([points[0],points[2],points[8],points[6]]);
 result[0].points[0].x=.2;expect(points[0].x).toBe(0);
});
it('keeps four-corner desktop mappings and omits disabled/mesh surfaces',()=>{
 const points=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];
 expect(importCornerSurfaces([{name:'Good',enabled:true,mode:'corners',points},{name:'Off',enabled:false,mode:'corners',points},{name:'Mesh',enabled:true,mode:'mesh',points}]).map(s=>s.name)).toEqual(['Good']);
});
