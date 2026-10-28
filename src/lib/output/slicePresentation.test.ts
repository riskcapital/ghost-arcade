import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

// Exercise the actual Electron IPC handler, including transport selection,
// without opening windows on the test runner.
const main = readFileSync('electron/main.js', 'utf8');
const probe = main.slice(main.indexOf('async function probeSliceNativeAvailable()'), main.indexOf('/** Parent a native presentation layer'));
const handler = main.slice(main.indexOf("  ipcMain.handle('output_open_slice_window'"), main.indexOf("  ipcMain.handle('output_close_slice_window'"));

type Harness = {available?: boolean; attach?: boolean; setter?: boolean; probes?: Array<object|null>};

function harness(platform: 'win32'|'darwin', {available = true, attach = true, setter = true, probes}: Harness = {}) {
  let callback: any;
  const windows: any[] = [];
  const addon = {monitorAttach: vi.fn(), ...(setter ? {
    [platform === 'win32' ? 'monitorSetSharedTexture' : 'monitorSetIOSurface']: vi.fn(),
  } : {})};
  // `probes`: the core's answers in turn; null is a probe it did not answer in time.
  const broker = {coreInstance: 1, invoke: vi.fn(async()=>(probes
    ? probes.shift() ?? null
    : {available,platform:platform==='win32'?'dxgi':'iosurface',slices:[]}))};
  const attachLayer = vi.fn(()=>attach);
  const showOnDisplayFullscreen = vi.fn();
  const enterSliceFullscreen = vi.fn();
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
    attachSliceNativeLayer:attachLayer,enterSliceFullscreen,showOnDisplayFullscreen,detachSliceNativeLayer:vi.fn(),console,
    refreshSliceNativeLayerRects:vi.fn(),
  });
  const openScreen = (sliceId: string) => callback(null,{sliceId,displayId:5});
  return {openScreen,windows,attachLayer,sliceWindows,broker,showOnDisplayFullscreen,enterSliceFullscreen};
}

async function open(platform: 'win32'|'darwin', available = true, attach = true, setter = true) {
  const h = harness(platform, {available, attach, setter});
  const result = await h.openScreen('left');
  return {result, ...h};
}

describe('native Screen output window routing',()=>{
  it.each(['win32','darwin'] as const)('opens %s on the native calibrated texture before the first slice frame',async platform=>{
    const {result,windows,attachLayer,sliceWindows}=await open(platform);
    expect(result.ok).toBe(true);
    expect(windows[0].options).toMatchObject({transparent:true,width:1080,height:1920,x:1920});
    expect(attachLayer).toHaveBeenCalledWith('left',windows[0]);
    expect(sliceWindows.get('left')).toBe(windows[0]);
    // macOS: a borderless projector placed over the menu-bar strip (not
    // simple fullscreen, which hides the menu bar and Dock app-wide).
    // Windows: built hidden and not fullscreen, then placed on its display
    // and shown fullscreen there.
    expect(windows[0].options).toMatchObject(platform==='darwin'
      ? {frame:false,fullscreen:false,enableLargerThanScreen:true,show:true}
      : {frame:false,fullscreen:false,enableLargerThanScreen:false,show:false});
    expect(windows[0].options.simpleFullscreen).toBeUndefined();
  });
  it('places a Windows Screen on its display before it goes fullscreen', async()=>{
    const {windows,showOnDisplayFullscreen,enterSliceFullscreen,attachLayer}=await open('win32');
    expect(showOnDisplayFullscreen).toHaveBeenCalledWith(windows[0],expect.objectContaining({id:5}));
    expect(enterSliceFullscreen).not.toHaveBeenCalled();
    // Shown fullscreen first, so the presenter is sized to the final window.
    expect(showOnDisplayFullscreen.mock.invocationCallOrder[0]).toBeLessThan(attachLayer.mock.invocationCallOrder[0]!);
  });
  it('does not silently open an uncalibrated fallback when the core is unavailable',async()=>{
    const {result,windows}=await open('win32',false);
    expect(result.ok).toBe(false);
    expect(windows).toHaveLength(0);
  });
  it('keeps the core\'s last answer when a busy core misses the probe',async()=>{
    const answer = {available:true,platform:'dxgi',slices:[]};
    const h = harness('win32',{probes:[answer,null,null]});
    expect((await h.openScreen('left')).ok).toBe(true);
    // A software adapter draws a frame every second or two and answers late.
    expect((await h.openScreen('right')).ok).toBe(true);
    expect(h.windows[1].options.transparent).toBe(true);
    // A restarted core has not answered yet: its predecessor's answer does not count.
    h.broker.coreInstance = 2;
    expect((await h.openScreen('centre')).ok).toBe(false);
    expect(h.windows).toHaveLength(2);
  });
  it('does not take an unanswered probe for a yes',async()=>{
    const h = harness('win32',{probes:[null]});
    expect((await h.openScreen('left')).ok).toBe(false);
    expect(h.windows).toHaveLength(0);
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

const place = main.slice(main.indexOf('function showOnDisplayFullscreen'), main.indexOf('function createOutputWindow'));

describe('showOnDisplayFullscreen', () => {
  function harness(landedIds: number[]) {
    const calls: string[] = [];
    const win = {
      isDestroyed: () => false,
      setBounds: vi.fn((b: any) => calls.push(`bounds:${b.x}`)),
      show: vi.fn(() => calls.push('show')),
      getBounds: () => ({ x: 0, y: 0, width: 1, height: 1 }),
    };
    const landed = [...landedIds];
    const context: Record<string, any> = {
      console: { warn() {}, log() {} },
      setOutputFullScreen: vi.fn((_w: unknown, on: boolean) => calls.push(`fullscreen:${on}`)),
      screen: { getDisplayMatching: () => ({ id: landed.shift() }) },
    };
    runInNewContext(place, context);
    return { win, calls, context };
  }
  const projector = { id: 5, bounds: { x: 1920, y: 0, width: 1080, height: 1920 } };

  it('moves the hidden window to its display, shows it, then goes fullscreen', () => {
    const h = harness([5]);
    h.context.showOnDisplayFullscreen(h.win, projector);
    expect(h.calls).toEqual(['bounds:1920', 'show', 'fullscreen:true']);
  });

  it('moves it again when it went fullscreen on another display', () => {
    const h = harness([1]);
    h.context.showOnDisplayFullscreen(h.win, projector);
    expect(h.calls).toEqual(['bounds:1920', 'show', 'fullscreen:true', 'fullscreen:false', 'bounds:1920', 'fullscreen:true']);
  });
});
