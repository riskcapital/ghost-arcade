import { beforeEach, describe, expect, it, vi } from 'vitest';

// Parameter, effect and group names are case-sensitive. Paths are matched on
// keywords in lowercase, but the names they carry must reach their targets
// as written (and paths saved lowercased by older builds must still land).
const harness = vi.hoisted(() => ({ selected: null as any, project: null as any, vj: null as any }));
vi.mock('../stores/launchClock', () => ({ releaseTempoNudgeInputs: vi.fn(), setTempoNudgeInput: vi.fn(), resyncLaunchClock: vi.fn() }));
vi.mock('./midiStore', async () => {
  const { writable } = await import('svelte/store');
  return { midiStore: writable({ mappings: [] }) };
});
vi.mock('../stores/layers', async () => {
  const { writable } = await import('svelte/store');
  harness.selected = writable(null);
  harness.project = writable({ layers: [] });
  return {
    selectedLayer: harness.selected,
    project: {
      subscribe: harness.project.subscribe,
      updateLayer: vi.fn(),
      setLayerSource: vi.fn(),
      updateGPULayerParams: vi.fn(),
      updateGPULayerContent: vi.fn(),
      updateSplatContent: vi.fn(),
      updateModel3DContent: vi.fn(),
      updateEffectParams: vi.fn(),
    },
  };
});
vi.mock('../stores/vjClipLauncher', async () => {
  const { writable } = await import('svelte/store');
  harness.vj = writable({ layerStates: [], bankBLayerStates: [], groups: [] });
  return { vjClipLauncher: { ...harness.vj,
    updateActiveClipShaderValue: vi.fn(), updateActiveClipJSAnimationParam: vi.fn(),
    updateActiveClipSplatContent: vi.fn(), updateActiveClipModel3DContent: vi.fn(),
    updateGroup: vi.fn(), setCrossfaderBlendMode: vi.fn(), releaseInputs: vi.fn(),
  } };
});
vi.mock('../renderer/nativeVideoScratch', () => ({ createNativeVideoScratchController: () => ({ seek: vi.fn(), cancel: vi.fn(), refresh: vi.fn() }) }));
vi.mock('../stores/synthVision', () => ({ synthVisionStore: {} }));
vi.mock('../audio/modulation', () => ({ setBaseValue: vi.fn() }));
vi.mock('../plugins/registry', () => ({ getPluginByEffectType: vi.fn() }));
vi.mock('../stores/audio', () => ({ audioStore: {} }));
import { project } from '../stores/layers';
import { vjClipLauncher } from '../stores/vjClipLauncher';
import { midiRouter } from './midiRouter';

const gpuLayer = (id: string) => ({
  id, name: id, type: 'gpu',
  gpuLayerContent: { shaderId: 'pixel-particles', params: { pointSize: 2, depthScale: 1 } },
});

describe('control paths keep their names', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.selected.set(gpuLayer('selected'));
    harness.project.set({ layers: [gpuLayer('selected'), gpuLayer('other')] });
    harness.vj.set({
      layerStates: [{ activeClip: { id: 'c', type: 'p5js', shaderValues: { colorShift: 0 },
        jsAnimation: { params: [{ name: 'trailFade', default: 0.5 }, { name: 'mirrorX', type: 'boolean', default: false }], paramValues: {} } } }],
      bankBLayerStates: [{ activeClip: { id: 'b', type: 'shader', shaderValues: { colorShift: 0 } } }],
      groups: [{ id: 'Grp-AB12', effects: [] }],
    });
  });

  it('writes a GPU parameter by its real name', () => {
    midiRouter.dispatchPath('map:gpu:pointSize', 4);
    expect(project.updateGPULayerParams).toHaveBeenCalledWith('selected', { pointSize: 4 });
  });

  it('still lands a path an older build saved lowercased', () => {
    midiRouter.dispatchPath('map:gpu:pointsize', 3);
    expect(project.updateGPULayerParams).toHaveBeenCalledWith('selected', { pointSize: 3 });
  });

  it('writes layer-level GPU fields as written', () => {
    midiRouter.dispatchPath('map:gpu:__bgOpacity', 0.4);
    expect(project.updateGPULayerContent).toHaveBeenCalledWith('selected', { bgOpacity: 0.4 });
  });

  it('drives the named layer instead of the selected one', () => {
    midiRouter.dispatchPath('map:gpu:depthScale', 0.7, { layerId: 'other' });
    expect(project.updateGPULayerParams).toHaveBeenCalledWith('other', { depthScale: 0.7 });
  });

  it('reaches VJ shader and sketch parameters, on either deck', () => {
    midiRouter.dispatchPath('vj:0:js:trailFade', 0.25);
    expect(vjClipLauncher.updateActiveClipJSAnimationParam).toHaveBeenCalledWith(0, 'trailFade', 0.25, 'A');
    midiRouter.dispatchPath('vj:0:js:mirrorx', 1);
    expect(vjClipLauncher.updateActiveClipJSAnimationParam).toHaveBeenCalledWith(0, 'mirrorX', true, 'A');
    midiRouter.dispatchPath('vj-b:0:shader:colorShift', 0.6);
    expect(vjClipLauncher.updateActiveClipShaderValue).toHaveBeenCalledWith(0, 'colorShift', 0.6, 'B');
  });

  it('finds a group whose id has capitals', () => {
    midiRouter.dispatchPath('vj:group:Grp-AB12:level', 0.5);
    expect(vjClipLauncher.updateGroup).toHaveBeenCalledWith('Grp-AB12', { opacity: 0.5 });
  });

  it('routes the crossfader blend mode', () => {
    midiRouter.dispatchPath('vj:crossfader:blendMode', 1);
    expect(vjClipLauncher.setCrossfaderBlendMode).toHaveBeenCalledWith('multiply');
  });
});
