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
