import {describe,it,expect} from 'vitest';
import {newSurface} from './model';
import {hitMappingScreens,snapMappingPoint} from './mappingInteraction';
describe('mapping interaction',()=>{
 it('selects rendered shapes top first, including locked but excluding hidden screens',()=>{
  const a=newSurface(0), b=newSurface(1);a.points=a.points.map(p=>({x:p.x*.4,y:p.y}));b.points=a.points.map(p=>({...p}));b.locked=true;
  expect(hitMappingScreens({x:.2,y:.5},[a,b])).toEqual([1,0]);
  expect(hitMappingScreens({x:.9,y:.5},[a,b])).toEqual([]);
  b.enabled=false;expect(hitMappingScreens({x:.2,y:.5},[a,b])).toEqual([0]);
 });
 it('snaps within a visual threshold and leaves distant points alone',()=>{
  expect(snapMappingPoint({x:.255,y:.45},[],0,1000,562.5)).toEqual({x:.25,y:4/9});
  expect(snapMappingPoint({x:.28,y:.48},[],0,1000,562.5)).toEqual({x:.28,y:.48});
 });
});

import {vi} from 'vitest';
import {grabOffset,draggedPoint,holdRepeat} from './mappingInteraction';
describe('corner handles move by the distance dragged',()=>{
 const box={left:21,top:100,width:351,height:197.4};
 it('keeps a corner still when it is grabbed off-centre',()=>{
  const handle={x:.08,y:.08};
  // The reviewed case: finger lands 18 px right and 10 px below the handle centre.
  const finger={x:box.left+handle.x*box.width+18,y:box.top+handle.y*box.height+10};
  const offset=grabOffset(finger,handle,box);
  expect(offset.x).toBeCloseTo(18,6);expect(offset.y).toBeCloseTo(10,6);
  const still=draggedPoint(finger,offset,box);
  expect(still.x).toBeCloseTo(handle.x,9);expect(still.y).toBeCloseTo(handle.y,9);
 });
 it('moves exactly as far as the finger travels',()=>{
  const handle={x:.5,y:.5},finger={x:200,y:210};
  const offset=grabOffset(finger,handle,box);
  const moved=draggedPoint({x:finger.x+40,y:finger.y+20},offset,box);
  expect((moved.x-handle.x)*box.width).toBeCloseTo(40,6);
  expect((moved.y-handle.y)*box.height).toBeCloseTo(20,6);
 });
});
describe('nudge buttons repeat while held',()=>{
 function button(){
  const listeners:Record<string,(e:any)=>void>={};
  const node={disabled:false,addEventListener:(type:string,fn:(e:any)=>void)=>{listeners[type]=fn;},removeEventListener:(type:string)=>{delete listeners[type];}};
  return {node:node as unknown as HTMLElement,fire:(type:string,event:object={})=>listeners[type]?.({button:0,pointerId:1,detail:1,...event}),listeners};
 }
 it('steps once on a tap and keeps stepping on a hold, with one undo checkpoint',()=>{
  vi.useFakeTimers();
  try{
   const b=button(),step=vi.fn(),start=vi.fn();
   const action=holdRepeat(b.node,{step,start,delay:380,interval:70});
   b.fire('pointerdown');expect(step).toHaveBeenCalledTimes(1);
   vi.advanceTimersByTime(100);b.fire('pointerup');vi.advanceTimersByTime(2000);
   expect(step).toHaveBeenCalledTimes(1);
   b.fire('click',{detail:1});expect(step).toHaveBeenCalledTimes(1);
   b.fire('pointerdown');vi.advanceTimersByTime(1500);b.fire('pointerup');
   // 1 on press, then every 70 ms after the 380 ms delay: (1500-380)/70 = 16 repeats + the first at 380.
   expect(step.mock.calls.length).toBe(1+1+17);
   expect(start).toHaveBeenCalledTimes(2);
   vi.advanceTimersByTime(1000);expect(step.mock.calls.length).toBe(19);
   // Keyboard activation is a click with no pointer sequence.
   b.fire('click',{detail:0});expect(step.mock.calls.length).toBe(20);
   action.destroy();expect(Object.keys(b.listeners)).toEqual([]);
  }finally{vi.useRealTimers();}
 });
});
