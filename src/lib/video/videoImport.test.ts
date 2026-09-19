import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareVideoImport } from './videoImport';
class Video extends EventTarget {
  readyState=0; videoWidth=0; videoHeight=0; duration=NaN; error: object | null = null;
}
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
describe('native-only video import',()=>{
  it('uses native metadata immediately after a browser codec error',async()=>{
    const invoke=vi.fn(async()=>({durationSeconds:2.4,videoWidth:1080,videoHeight:1920,thumbnail:'data:image/jpeg;base64,AA=='}));
    vi.stubGlobal('window',{electronAPI:{invoke}});
    const video=new Video();video.error={};
    expect(await prepareVideoImport(video as any,{kind:'local-file',originalPath:'/show/hap.mov'})).toMatchObject({durationSeconds:2.4,videoWidth:1080,videoHeight:1920});
    expect(invoke).toHaveBeenCalledWith('inspect_video_import',{inputPath:'/show/hap.mov'});
  });
  it('does not hang when a browser emits neither loadeddata nor error',async()=>{
    vi.useFakeTimers();vi.stubGlobal('window',{});
    const promise=prepareVideoImport(new Video() as any);
    await vi.advanceTimersByTimeAsync(2500);
    expect(await promise).toEqual({durationSeconds:undefined,thumbnail:''});
    expect(vi.getTimerCount()).toBe(0);
  });
  it('keeps the ready browser path free of native work',async()=>{
    const invoke=vi.fn();const drawImage=vi.fn();
    vi.stubGlobal('window',{electronAPI:{invoke}});
    vi.stubGlobal('document',{createElement:()=>({width:0,height:0,getContext:()=>({drawImage}),toDataURL:()=> 'thumbnail'})});
    const video=new Video();video.readyState=2;video.videoWidth=128;video.videoHeight=72;video.duration=4;
    expect(await prepareVideoImport(video as any,{kind:'local-file',originalPath:'/show/video.mp4'})).toEqual({durationSeconds:4,videoWidth:128,videoHeight:72,thumbnail:'thumbnail'});
    expect(invoke).not.toHaveBeenCalled();expect(drawImage).toHaveBeenCalled();
  });
});
