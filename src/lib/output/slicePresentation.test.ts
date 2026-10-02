import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

// Exercise the actual Electron IPC handler, including transport selection,
// without opening windows on the test runner.
const main = readFileSync('electron/main.js', 'utf8');
const probe = main.slice(main.indexOf('async function probeSliceNativeAvailable()'), main.indexOf('/** Parent a native presentation layer'));
const handler = main.slice(main.indexOf("  ipcMain.handle('output_open_slice_window'"), main.indexOf("  ipcMain.handle('output_close_slice_window'"));

async function open(platform: 'win32'|'darwin', available = true, attach = true, setter = true) {
  let callback: any;
  const windows: any[] = [];
  const addon = {monitorAttach: vi.fn(), ...(setter ? {
    [platform === 'win32' ? 'monitorSetSharedTexture' : 'monitorSetIOSurface']: vi.fn(),
  } : {})};
  const broker = {invoke: vi.fn(async()=>({available,platform:platform==='win32'?'dxgi':'iosurface',slices:[]}))};
  const attachLayer = vi.fn(()=>attach);
  const sliceWindows = new Map();
  class Window {
    webContents = {once:vi.fn()};
    setMenuBarVisibility = vi.fn();
    loadFile = vi.fn();
    loadURL = vi.fn();
    destroy = vi.fn();
    on = vi.fn();
    constructor(public options: any) { windows.push(this); }
  }
  runInNewContext(probe + handler, {
    isMac:platform==='darwin',isWin:platform==='win32',nativePreviewAddon:addon,
    loadNativePreviewAddon:()=>addon,nativeRendererBroker:broker,
    ipcMain:{handle:(_name:string,fn:any)=>{callback=fn;}},
    sliceNativePending:new Set(),sliceNativeAttached:new Set(),sliceWindows,
    BrowserWindow:Window,screen:{getAllDisplays:()=>[{id:5,bounds:{x:1920,y:0,width:1080,height:1920}}]},
    process:{platform,env:{}},app:{isPackaged:true},path:{join:(...s:string[])=>s.join('/')},__dirname:'/app/electron',
    attachSliceNativeLayer:attachLayer,enterSliceFullscreen:vi.fn(),detachSliceNativeLayer:vi.fn(),console,
  });
  const result = await callback(null,{sliceId:'left',displayId:5});
  return {result,windows,attachLayer,sliceWindows,broker};
}

describe('native Screen output window routing',()=>{
  it.each(['win32','darwin'] as const)('opens %s on the native calibrated texture before the first slice frame',async platform=>{
    const {result,windows,attachLayer,sliceWindows}=await open(platform);
    expect(result.ok).toBe(true);
    expect(windows[0].options).toMatchObject({transparent:true,width:1080,height:1920,x:1920});
    expect(attachLayer).toHaveBeenCalledWith('left',windows[0]);
    expect(sliceWindows.get('left')).toBe(windows[0]);
  });
  it('does not silently open an uncalibrated fallback when the core is unavailable',async()=>{
    const {result,windows}=await open('win32',false);
    expect(result.ok).toBe(false);
    expect(windows).toHaveLength(0);
  });
  it('requires the Windows named-texture setter, not just monitorAttach',async()=>{
    const {result,windows}=await open('win32',true,true,false);
    expect(result.ok).toBe(false);
    expect(windows).toHaveLength(0);
  });
  it('closes a failed presenter window without loading the fallback renderer',async()=>{
    const {result,windows,sliceWindows}=await open('win32',true,false);
    expect(result.ok).toBe(false);
    expect(windows[0].destroy).toHaveBeenCalled();
    expect(windows[0].loadFile).not.toHaveBeenCalled();
    expect(sliceWindows.size).toBe(0);
  });
});
