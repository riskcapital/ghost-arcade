import {describe,it,expect,vi} from 'vitest';
vi.mock('$lib/bridge',()=>({invoke:vi.fn()}));
import {sourceSnapshotPixels} from './nativeSourcePreview';
describe('native editor source pixels',()=>{
 it('decodes padded BGRA without losing alpha on macOS/Windows',()=>{
  const rgba_b64=Buffer.from([30,20,10,128,0,0,0,0,60,50,40,255]).toString('base64');
  expect(Array.from(sourceSnapshotPixels({width:1,height:2,format:'bgra8unorm',padded_bytes_per_row:8,rgba_b64})!)).toEqual([10,20,30,128,40,50,60,255]);
 });
 it('rejects incomplete snapshots instead of showing stale/corrupt pixels',()=>expect(sourceSnapshotPixels({width:2,height:2,rgba_b64:'AAAA'})).toBeNull());
});
import {beforeEach} from 'vitest';
import {invoke} from '$lib/bridge';
import {createNativeSourcePreview,previewInterval,previewRequestSize,PREVIEW_MIN_INTERVAL_MS} from './nativeSourcePreview';
describe('native editor preview cost',()=>{
 const snapshot=(width:number,height:number)=>({width,height,format:'Rgba8Unorm',bytes_per_row:width*4,rgba_b64:Buffer.alloc(width*height*4,200).toString('base64')});
 const canvas=()=>{const painted:number[]=[];return {painted,width:0,height:0,isConnected:true,clientWidth:864,clientHeight:486,getContext:()=>({putImageData:(d:{data:Uint8ClampedArray})=>painted.push(d.data[3])})} as any;};
 beforeEach(()=>{(invoke as any).mockReset();(globalThis as any).ImageData=class{constructor(public data:Uint8ClampedArray,public width:number,public height:number){}};});
 it('decodes packed rows whose reported padded stride is wider than the data',()=>{
  // 3 px wide: 12 bytes a row packed, 256 padded. The core sends packed rows.
  const rgba_b64=Buffer.from([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24]).toString('base64');
  const px=sourceSnapshotPixels({width:3,height:2,format:'Rgba8Unorm',bytes_per_row:12,padded_bytes_per_row:256,rgba_b64})!;
  expect(Array.from(px.slice(12,16))).toEqual([13,14,15,16]);
 });
 it('asks for the size on screen, not a 960 px square',()=>{
  expect(previewRequestSize(864,486,1)).toEqual({width:864,height:486});
  expect(previewRequestSize(864,486,2)).toEqual({width:960,height:540});
  expect(previewRequestSize(560,315,1)).toEqual({width:560,height:316});
  expect(previewRequestSize(0,0,2)).toEqual({width:480,height:270});
 });
 it('backs off with the round trip and never polls faster than 30 Hz',()=>{
  expect(previewInterval(5)).toBeCloseTo(PREVIEW_MIN_INTERVAL_MS);
  expect(previewInterval(60)).toBe(120);
  expect(previewInterval(5000)).toBe(250);
 });
 it('makes no request for a stopped, deleted or hidden layer',async()=>{
  let live=false;const frame=createNativeSourcePreview({layerId:()=>'layer',live:()=>live});
  expect(await frame(canvas())).toBe(false);expect(invoke).not.toHaveBeenCalled();
  live=true;(invoke as any).mockResolvedValue(snapshot(4,2));
  expect(await frame(canvas())).toBe(true);expect(invoke).toHaveBeenCalledTimes(1);
  expect((invoke as any).mock.calls[0][1]).toMatchObject({layer_id:'layer',width:864,height:486,encoding:'jpeg'});
 });
 it('reads a paused scene a few times, then stops until it is edited',async()=>{
  vi.useFakeTimers();try{
   let key='a';const frame=createNativeSourcePreview({layerId:()=>'layer',stillKey:()=>key});const c=canvas();
   (invoke as any).mockResolvedValue(snapshot(4,2));
   for(let i=0;i<40;i++){await frame(c);vi.advanceTimersByTime(34);}
   expect(invoke).toHaveBeenCalledTimes(3);expect(await frame(c)).toBe(true);
   key='b';for(let i=0;i<40;i++){await frame(c);vi.advanceTimersByTime(34);}
   expect(invoke).toHaveBeenCalledTimes(6);
   expect(c.painted.every((alpha:number)=>alpha===255)).toBe(true);
  }finally{vi.useRealTimers();}
 });
 it('waits a second after a failed read instead of hammering the core',async()=>{
  vi.useFakeTimers();try{
   const frame=createNativeSourcePreview({layerId:()=>'layer'});(invoke as any).mockRejectedValue(new Error('Source preview is not ready'));
   for(let i=0;i<30;i++){expect(await frame(canvas())).toBe(false);vi.advanceTimersByTime(33);}
   expect(invoke).toHaveBeenCalledTimes(1);
  }finally{vi.useRealTimers();}
 });
});
