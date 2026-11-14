import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StudioEngine } from './engine';
import { clipLaunchParams, defaultShow, type Clip } from './model';
import { STUDIO_VOICE_SHADERS } from '../studioVoiceList';
import { MOBILE_SHADERS } from '../standaloneShaderList';
import { standaloneShaderPaths } from './shaderAvailability';
import { VOICE_DRIVEN_INPUTS } from '../studioVoices';

const renderers = vi.hoisted(() => [] as Array<{
  setShaderInputs: ReturnType<typeof vi.fn>;
  loadShaderSource: ReturnType<typeof vi.fn>;
}>);
vi.mock('../standaloneRenderer', () => ({
  StandaloneRenderer: class {
    setShaderInputs = vi.fn();
    clearSource = vi.fn();
    loadShaderSource = vi.fn().mockResolvedValue(undefined);
    setShaderImage = vi.fn();
    setAudio = vi.fn();
    setClipParams = vi.fn();
    drawFrame = vi.fn();
    destroy = vi.fn();
    textureOutput = null;
    constructor() { renderers.push(this); }
  },
}));
vi.mock('./compositor', () => ({
  StudioCompositor: class {
    context = {};
    beginFrame = vi.fn();
    render = vi.fn();
    destroy = vi.fn();
    constructor(public canvas: HTMLCanvasElement) {}
  },
}));

const VOICE_SOURCE = `/*{"PASSES":[{"TARGET":"state","PERSISTENT":true,"FLOAT":true,"WIDTH":"4","HEIGHT":"1"},{}],"INPUTS":[
{"NAME":"vxSource","LABEL":"Follows","TYPE":"long","DEFAULT":5,"VALUES":[0,1,2,3,4,5],"LABELS":["Everything","Kick","Snare and clap","Hats","Toms and crash","Bass"]},
{"NAME":"vxAuto","LABEL":"Comes and goes with its sound","TYPE":"bool","DEFAULT":true},
{"NAME":"vxClear","LABEL":"Transparent background","TYPE":"bool","DEFAULT":false},
{"NAME":"glow","LABEL":"Glow","TYPE":"float","DEFAULT":0.5,"MIN":0,"MAX":1},
{"NAME":"vxEnv","TYPE":"float","DEFAULT":0},{"NAME":"vxSwell","TYPE":"float","DEFAULT":0},{"NAME":"vxPresence","TYPE":"float","DEFAULT":1},{"NAME":"vxNote0","TYPE":"float","DEFAULT":0}
]}*/
void main(){gl_FragColor=vec4(tanh(vxSwell + glow));}`;

let frame: FrameRequestCallback;
let engine: StudioEngine | undefined;
beforeEach(() => {
  renderers.length = 0;
  vi.stubGlobal('HTMLVideoElement', class {});
  vi.stubGlobal('HTMLImageElement', class {});
  vi.stubGlobal('document', { hidden: false });
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frame = callback; return 1; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
    ok: true,
    text: async () => (String(url).includes('VX-') ? VOICE_SOURCE : '/*{"INPUTS":[{"NAME":"gain","TYPE":"float","DEFAULT":0.5}]}*/\nvoid main(){gl_FragColor=vec4(gain);}'),
  })));
});
afterEach(() => {
  engine?.destroy();
  engine = undefined;
  vi.unstubAllGlobals();
});

function setup(shaderId: string) {
  const show = defaultShow();
  const clip: Clip = { id: 'voice-clip', shaderId, name: 'Voice', kind: 'shader' };
  show.clips.push(clip);
  show.layers[0].clipId = clip.id;
  show.layers[0].params = clipLaunchParams(show, clip.id);
  const canvas = { addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as HTMLCanvasElement;
  engine = new StudioEngine(canvas, () => show);
  return { engine, clip, show };
}

describe('studio voices in the library', () => {
  it('are in the catalog after every other shader, in their own group, each with a thumbnail-backed path', () => {
    expect(STUDIO_VOICE_SHADERS.length).toBeGreaterThan(10);
    const first = MOBILE_SHADERS.findIndex((s) => s.voice);
    expect(MOBILE_SHADERS.slice(first).every((s) => s.voice)).toBe(true);
    for (const voice of STUDIO_VOICE_SHADERS) {
      expect(voice.category).toBe('voices');
      expect(voice.id.startsWith('voice-')).toBe(true);
      expect(standaloneShaderPaths.has(voice.path)).toBe(true);
      // On the phone a voice always shows; "comes and goes" stays an option.
      expect(voice.defaults?.vxAuto).toBe(false);
    }
    expect(new Set(MOBILE_SHADERS.map((s) => s.id)).size).toBe(MOBILE_SHADERS.length);
  });
  it('leave the starting set as it was: no voice is on the demo deck', () => {
    const show = defaultShow(true);
    expect(show.clips.some((c) => c.shaderId?.startsWith('voice-'))).toBe(false);
  });
});

describe('a studio voice on the deck', () => {
  const voice = STUDIO_VOICE_SHADERS[0];

  it('loads with the WebGL 1 helpers, hides its driven signals and keeps its own controls', async () => {
    const { engine, clip } = setup(voice.id);
    await engine.launch(0, clip);
    const loaded = renderers[1].loadShaderSource.mock.calls.at(-1)!;
    expect(loaded[0]).toContain('ga_tanh(vxSwell + glow)');
    expect(loaded[1]).toBe(true);
    expect(loaded[3]).toEqual({ flow: 0, breath: 0, glow: false });
    const names = engine.parameters(0).map((p) => p.NAME);
    expect(names).toEqual(['vxSource', 'vxAuto', 'glow']);
  });

  it('gets every signal each frame, follows the sound its control names, and shows all the time by default', async () => {
    const { engine, clip, show } = setup(voice.id);
    await engine.launch(0, clip);
    engine.start();
    frame(1000);
    frame(1016);
    let inputs = renderers[1].setShaderInputs.mock.calls.at(-1)![0] as Record<string, number>;
    for (const name of VOICE_DRIVEN_INPUTS) expect(Number.isFinite(inputs[name]), name).toBe(true);
    expect(inputs.vxPresence).toBe(1);
    expect(inputs.glow).toBeUndefined();
    // With no source listening the quiet groove plays: the bass it follows by default has a note.
    expect(inputs.vxNote0).toBeGreaterThan(0);
    show.layers[0].params = { ...show.layers[0].params, vxSource: 1, glow: 0.3 };
    frame(1032);
    inputs = renderers[1].setShaderInputs.mock.calls.at(-1)![0] as Record<string, number>;
    expect(inputs.vxSource).toBe(1);
    expect(inputs.glow).toBe(0.3);
    // The kick is a drum: its pitch is its General MIDI note.
    expect(inputs.vxPitch).toBeCloseTo(36 / 127, 5);
  });

  it('leaves an ordinary shader exactly as before: no voice signals', async () => {
    const show = defaultShow();
    const canvas = { addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as HTMLCanvasElement;
    engine = new StudioEngine(canvas, () => show);
    const clip = show.clips.find((c) => c.id === show.layers[0].clipId)!;
    show.layers[0].params = { gain: 0.2 };
    await engine.launch(0, clip);
    engine.start();
    frame(1000);
    expect(renderers[1].setShaderInputs).toHaveBeenLastCalledWith({ gain: 0.2 });
    expect(engine.parameters(0).map((p) => p.NAME)).toEqual(['gain']);
  });
});
