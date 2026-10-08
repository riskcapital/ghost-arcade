import {afterEach,describe,it,expect,vi} from 'vitest';
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});
function stream(){const stop=vi.fn();return {stream:{getTracks:()=>[{stop}]} as unknown as MediaStream,stop};}
describe('native capture camera ownership',()=>{
 it('releases a shared camera and permits a fresh launch after the toolkit',async()=>{
  const first=stream(),next=stream();const getUserMedia=vi.fn().mockResolvedValueOnce(first.stream).mockResolvedValueOnce(next.stream);
  vi.stubGlobal('navigator',{mediaDevices:{getUserMedia}});
  const {acquireCamera,releaseCamerasForToolkit}=await import('./camera');
  const a=await acquireCamera('user'),b=await acquireCamera('user');expect(getUserMedia).toHaveBeenCalledTimes(1);
  a.release();expect(first.stop).not.toHaveBeenCalled();await releaseCamerasForToolkit();expect(first.stop).toHaveBeenCalled();
  b.release();const c=await acquireCamera('environment');expect(c.stream).toBe(next.stream);c.release();expect(next.stop).toHaveBeenCalledTimes(1);
 });
 it('waits for a pending permission request and never exposes its stale stream',async()=>{
  const sample=stream();let complete!:(stream:MediaStream)=>void;
  vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:()=>new Promise<MediaStream>(resolve=>{complete=resolve;})}});
  const {acquireCamera,releaseCamerasForToolkit}=await import('./camera');
  const result=acquireCamera('user').then(()=>false,()=>true);
  let handedOff=false;const handoff=releaseCamerasForToolkit().then(()=>{handedOff=true;});
  await Promise.resolve();expect(handedOff).toBe(false);complete(sample.stream);await handoff;
  expect(await result).toBe(true);expect(sample.stop).toHaveBeenCalled();expect(handedOff).toBe(true);
 });
});
