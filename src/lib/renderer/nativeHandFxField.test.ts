import { describe, expect, it } from 'vitest';
import {
  HAND_FX_BODY_BUFFER_BYTES,
  HAND_FX_FACE_POINTS,
  HAND_FX_FIELD_MODES,
  HAND_FX_FLUID_JACOBI,
  HAND_FX_QUALITY_PARTICLES,
  handFxDemoFace,
  handFxDemoPose,
  handFxFieldModeIndex,
  handFxTrackingNeeds,
  packHandFxBody,
} from './nativeHandFxField';
import { buildNativeHandInputUpdate, buildNativePluginGraph, buildNativePluginPrecompileCommands } from './nativePluginGraphs';
import { getPluginByEffectType } from '../plugins/registry';
import type { SignalFrame } from '../mediapipe/signals';

const audio = { active: false, bass: 0, mid: 0, treble: 0, energy: 0, beatPhase: 0, beatPulse: 0, amplitude: 0 };
const base = { width: 1920, height: 1080, frameDelta: 1 / 60 };
const emptyFrame = (timestamp: number): SignalFrame => ({ timestamp, values: {}, confidence: {}, gestures: { 'gesture.right': '', 'gesture.left': '' }, hands: [] });
const HEAD = 8 * 4, POSE = HEAD, FACE = HEAD + 33 * 8;
const decode = (b64: string) => new Float32Array(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer);

describe('HandFX rehearsal body and face', () => {
  it('gives a full moving skeleton inside the frame', () => {
    const a = handFxDemoPose(1), b = handFxDemoPose(1.5);
    expect(a).toHaveLength(33);
    // A raised hand or a stepping foot may leave the frame, as a real one does.
    for (const point of a) {
      expect(point.x).toBeGreaterThan(-0.05); expect(point.x).toBeLessThan(1.05);
      expect(point.y).toBeGreaterThan(-0.05); expect(point.y).toBeLessThan(1.05);
    }
    for (const joint of [0, 11, 12, 23, 24]) { expect(a[joint].y).toBeGreaterThan(0); expect(a[joint].y).toBeLessThan(1); }
    // Head above shoulders above hips above ankles (camera space, y down).
    expect(a[0].y).toBeLessThan(a[11].y);
    expect(a[11].y).toBeLessThan(a[23].y);
    expect(a[23].y).toBeLessThan(a[27].y);
    expect(Math.hypot(a[15].x - b[15].x, a[15].y - b[15].y)).toBeGreaterThan(0.02);
  });

  it('gives a 478 point face whose mouth opens and head turns', () => {
    const shut = handFxDemoFace(Math.PI * 1.5 / 1.3), open = handFxDemoFace(Math.PI * 0.5 / 1.3);
    expect(shut).toHaveLength(HAND_FX_FACE_POINTS);
    const gap = (face: typeof shut) => Math.abs(face[14].y - face[13].y) / Math.abs(face[152].y - face[10].y);
    expect(gap(open)).toBeGreaterThan(gap(shut) * 3);
    expect(open.every((point) => Number.isFinite(point.x + point.y + point.z))).toBe(true);
    // Nearly every point has its own spot: the mask's wire needs real neighbours.
    const seen = new Set(shut.map((point) => `${point.x.toFixed(5)},${point.y.toFixed(5)}`));
    expect(seen.size).toBeGreaterThan(460);
  });
});

describe('HandFX body and face packing', () => {
  const index = (mode: string) => handFxFieldModeIndex(mode);

  it('numbers the field modes after the eleven hand modes', () => {
    expect(HAND_FX_FIELD_MODES.map((mode) => handFxFieldModeIndex(mode))).toEqual([11, 12, 13, 14, 15]);
    expect(handFxFieldModeIndex('bridge')).toBe(-1);
  });

  it('asks only for the tracker the mode needs', () => {
    expect(handFxTrackingNeeds({ handfxMode: 'bridge' })).toEqual({ trackBody: false, trackFace: false });
    expect(handFxTrackingNeeds({ handfxMode: 'bodyflow' })).toEqual({ trackBody: true, trackFace: false });
    expect(handFxTrackingNeeds({ handfxMode: 'facemask' })).toEqual({ trackBody: false, trackFace: true });
    expect(handFxTrackingNeeds(null)).toEqual({ trackBody: false, trackFace: false });
  });

  it('packs a live pose y-up with speeds measured between camera frames', () => {
    const pose = (x: number) => Array.from({ length: 33 }, (_, i) => ({ x, y: 0.2 + i * 0.01, z: 0, visibility: i === 5 ? 0.1 : 0.9 }));
    const params = { handfxMode: 'bodyswarm', handfxSmoothing: 0 };
    const first = packHandFxBody({ ...base, params, time: 1, frame: { ...emptyFrame(1000), pose: pose(0.4) } }, null, index('bodyswarm'));
    expect(first.buffer.byteLength).toBe(HAND_FX_BODY_BUFFER_BYTES);
    expect(first.buffer[0]).toBe(1);
    expect(first.buffer[POSE]).toBeCloseTo(0.4, 5);
    expect(first.buffer[POSE + 1]).toBeCloseTo(0.8, 5);
    expect(first.buffer[POSE + 5 * 8 + 3]).toBeCloseTo(0.1, 5);
    expect(first.buffer[POSE + 4]).toBe(0);
    // 0.02 across in 50 ms is 0.4 a second; the estimate is eased in.
    const moved = packHandFxBody({ ...base, params, time: 1.05, frame: { ...emptyFrame(1050), pose: pose(0.42) } }, first.state, index('bodyswarm'));
    expect(moved.buffer[POSE + 4]).toBeGreaterThan(0.1);
    expect(moved.buffer[POSE + 4]).toBeLessThan(0.41);
    // The renderer draws again before the camera delivers: same frame, same speed.
    const repeated = packHandFxBody({ ...base, params, time: 1.066, frame: { ...emptyFrame(1050), pose: pose(0.42) } }, moved.state, index('bodyswarm'));
    expect(repeated.buffer[POSE + 4]).toBe(moved.buffer[POSE + 4]);
    // A jump across the frame is a lost track, not a throw.
    const jumped = packHandFxBody({ ...base, params, time: 1.1, frame: { ...emptyFrame(1100), pose: pose(0.9) } }, repeated.state, index('bodyswarm'));
    expect(jumped.buffer[POSE + 4]).toBe(0);
  });

  it('stays finite and marks the body absent when nobody is in view', () => {
    for (const mode of HAND_FX_FIELD_MODES) {
      const packed = packHandFxBody({ ...base, params: { handfxMode: mode }, time: 1, frame: emptyFrame(1) }, null, index(mode));
      expect(packed.buffer[0], mode).toBe(0);
      expect(packed.buffer[1], mode).toBe(0);
      expect(packed.buffer.every((value) => Number.isFinite(value)), mode).toBe(true);
      expect(packed.buffer[4 * 4 + 2], mode).toBe(HAND_FX_QUALITY_PARTICLES.high);
      const noFrame = packHandFxBody({ ...base, params: { handfxMode: mode }, time: 1, frame: null }, packed.state, index(mode));
      expect(noFrame.buffer.every((value) => Number.isFinite(value)), mode).toBe(true);
    }
  });

  it('reads the mouth from the rehearsal face and prefers the tracker\'s own scores when live', () => {
    const params = { handfxMode: 'facestream', handfxInput: 'demo' };
    const shut = packHandFxBody({ ...base, params, time: Math.PI * 1.5 / 1.3 }, null, index('facestream'));
    const open = packHandFxBody({ ...base, params, time: Math.PI * 0.5 / 1.3 }, null, index('facestream'));
    expect(shut.buffer[1]).toBe(1);
    expect(shut.buffer[4]).toBeLessThan(0.1);
    expect(open.buffer[4]).toBeGreaterThan(0.8);
    expect(open.buffer[FACE + 3]).toBe(1);
    // The aim is a unit direction.
    expect(Math.hypot(open.buffer[14], open.buffer[15])).toBeCloseTo(1, 4);
    const live = packHandFxBody({ ...base, params: { handfxMode: 'facestream' }, time: 1,
      frame: { ...emptyFrame(5), face: handFxDemoFace(Math.PI * 1.5 / 1.3), values: { 'face.mouth': 0.77, 'face.brows': 0.31 } } }, null, index('facestream'));
    expect(live.buffer[4]).toBeCloseTo(0.77, 5);
    expect(live.buffer[5]).toBeCloseTo(0.31, 5);
  });

  it('raises the shatter value on a sudden expression and lets it settle', () => {
    const params = { handfxMode: 'facemask', handfxInput: 'demo' };
    const calm = Math.PI * 1.5 / 1.3;
    let state = packHandFxBody({ ...base, params, time: calm }, null, index('facemask')).state;
    let packed = packHandFxBody({ ...base, params, time: calm + 0.016 }, state, index('facemask'));
    expect(packed.buffer[11]).toBeLessThan(0.05);
    // Mouth snaps open between two frames.
    packed = packHandFxBody({ ...base, params, time: Math.PI * 0.5 / 1.3 + Math.PI * 2 / 1.3 }, packed.state, index('facemask'));
    expect(packed.buffer[11]).toBeGreaterThan(0.6);
    state = packed.state;
    const held = Math.PI * 0.5 / 1.3 + Math.PI * 2 / 1.3;
    for (let step = 1; step <= 240; step += 1) {
      packed = packHandFxBody({ ...base, params, time: held + step * 0.0001 }, state, index('facemask'));
      state = packed.state;
    }
    expect(packed.buffer[11]).toBeLessThan(0.02);
  });

  it('works the face wire out once and gives every point four distinct neighbours', () => {
    const params = { handfxMode: 'facemask', handfxInput: 'demo' };
    const first = packHandFxBody({ ...base, params, time: 1 }, null, index('facemask'));
    expect(first.state.faceTopologyVersion).toBe(1);
    expect(first.topology).toHaveLength(HAND_FX_FACE_POINTS * 4);
    for (let point = 0; point < HAND_FX_FACE_POINTS; point += 1) {
      const neighbours = Array.from(first.topology.subarray(point * 4, point * 4 + 4));
      expect(new Set(neighbours).size).toBe(4);
      expect(neighbours.includes(point)).toBe(false);
      expect(neighbours.every((n) => n >= 0 && n < HAND_FX_FACE_POINTS)).toBe(true);
    }
    const next = packHandFxBody({ ...base, params, time: 2 }, first.state, index('facemask'));
    expect(next.state.faceTopologyVersion).toBe(1);
    expect(Array.from(next.topology)).toEqual(Array.from(first.topology));
  });
});

describe('HandFX body and face graphs', () => {
  const options = (mode: string, extra: Record<string, any> = {}) => ({
    sourceId: 'plugin:layer:handfx', params: { handfxMode: mode, handfxInput: 'demo', ...extra },
    width: 1920, height: 1080, time: 1, frameDelta: 1 / 60, frameIndex: 60, audio,
  });

  it('precompiles the three field shaders', () => {
    const ids = buildNativePluginPrecompileCommands().map((command) => command.shader_id);
    expect(ids).toEqual(expect.arrayContaining(['handfx/field-sim', 'handfx/field-fluid', 'handfx/field-render']));
  });

  it.each([...HAND_FX_FIELD_MODES])('builds %s with persistent simulation buffers and no seeding pass', (mode) => {
    const config = buildNativePluginGraph({ ...options(mode), kind: 'handfx', reset: true }).config as any;
    const buffer = (suffix: string) => config.buffers.find((entry: any) => entry.id.endsWith(suffix));
    expect(buffer(':uniform').byte_length).toBe(144);
    expect(buffer(':body').byte_length).toBe(HAND_FX_BODY_BUFFER_BYTES);
    expect(buffer(':field-particles')).toMatchObject({ byte_length: HAND_FX_QUALITY_PARTICLES.high * 32, persistent: true, clear: true });
    expect(buffer(':light')).toMatchObject({ byte_length: 1920 * 1080 * 8, persistent: true });
    // Every pass runs every frame: nothing here exists only to seed state.
    expect(config.passes.every((pass: any) => !/init|seed/i.test(pass.name))).toBe(true);
    const fluidPasses = config.passes.filter((pass: any) => pass.shader_id === 'handfx/field-fluid');
    expect(fluidPasses).toHaveLength(mode === 'bodyflow' ? HAND_FX_FLUID_JACOBI + 3 : 0);
    // Every binding points at a declared buffer.
    const ids = new Set(config.buffers.map((entry: any) => entry.id));
    for (const pass of [...config.passes, ...config.render_passes]) {
      for (const binding of pass.bindings) if (binding.resource) expect(ids.has(binding.resource), `${pass.name}:${binding.binding}`).toBe(true);
    }
    expect(config.render_passes.at(-1)).toMatchObject({ shader_id: 'handfx/field-render', source_id: 'plugin:layer:handfx', clear: true });
  });

  it('leaves the fluid velocity where the particles read it', () => {
    const config = buildNativePluginGraph({ ...options('bodyflow'), kind: 'handfx' }).config as any;
    const fluid = config.passes.filter((pass: any) => pass.shader_id === 'handfx/field-fluid');
    const writes = (pass: any) => pass.bindings.find((binding: any) => binding.binding === 3).resource;
    const reads = (pass: any) => pass.bindings.find((binding: any) => binding.binding === 2).resource;
    // Each pass reads what the one before it wrote.
    for (let i = 1; i < fluid.length; i += 1) expect(reads(fluid[i]), fluid[i].name).toBe(writes(fluid[i - 1]));
    const particles = config.passes.find((pass: any) => pass.entry === 'cs_particles');
    expect(particles.bindings.find((binding: any) => binding.binding === 4).resource).toBe(writes(fluid.at(-1)));
    expect(reads(fluid[0])).toBe(writes(fluid.at(-1)));
  });

  it('scales particles with the quality setting and falls back for an unknown one', () => {
    const bytes = (quality?: string) => ((buildNativePluginGraph({ ...options('bodyswarm', { handfxQuality: quality }), kind: 'handfx' }).config as any)
      .buffers.find((entry: any) => entry.id.endsWith(':field-particles')).byte_length);
    expect(bytes('low')).toBe(131_072 * 32);
    expect(bytes('max')).toBe(2_097_152 * 32);
    expect(bytes('nonsense')).toBe(HAND_FX_QUALITY_PARTICLES.high * 32);
    expect(bytes(undefined)).toBe(HAND_FX_QUALITY_PARTICLES.high * 32);
  });

  it('caps the light grid at 1080p and keeps its shape', () => {
    const light = (width: number, height: number) => ((buildNativePluginGraph({ ...options('bodyswarm'), width, height, kind: 'handfx' }).config as any)
      .buffers.find((entry: any) => entry.id.endsWith(':light')).byte_length / 8);
    expect(light(3840, 2160)).toBe(1920 * 1080);
    expect(light(1280, 720)).toBe(1280 * 720);
    expect(light(1080, 1920)).toBe(608 * 1080);
  });

  it('sends only the small input buffers each frame, and the face wire once', () => {
    const first = buildNativeHandInputUpdate(options('bodyswarm'));
    expect(first.buffers.map((entry) => entry.id.split(':').pop())).toEqual(['uniform', 'body']);
    const face = buildNativeHandInputUpdate(options('facemask'));
    expect(face.buffers.map((entry) => entry.id.split(':').pop())).toEqual(['uniform', 'body', 'face-topology']);
    const again = buildNativeHandInputUpdate({ ...options('facemask'), time: 1.02, state: face.state });
    expect(again.buffers.map((entry) => entry.id.split(':').pop())).toEqual(['uniform', 'body']);
    expect(again.buffers[1].initialB64).not.toEqual(face.buffers[1].initialB64);
    // Installing after the wire is known carries it in the graph itself.
    const reinstall = buildNativePluginGraph({ ...options('facemask'), kind: 'handfx', state: again.state }).config as any;
    const wire = decode(reinstall.buffers.find((entry: any) => entry.id.endsWith(':face-topology')).initial_b64);
    expect(wire.some((value) => value > 0)).toBe(true);
  });

  it('keeps every earlier mode number, buffer and palette default', () => {
    const modes = ['trails', 'aurora', 'bursts', 'skeleton', 'panel', 'bridge', 'orbit', 'lasers', 'portal', 'web', 'silk'];
    modes.forEach((mode, number) => {
      const config = buildNativePluginGraph({ ...options(mode), kind: 'handfx' }).config as any;
      const uniform = new Uint32Array(Uint8Array.from(atob(config.buffers[0].initial_b64), (c) => c.charCodeAt(0)).buffer);
      expect(uniform[5], mode).toBe(number);
      expect(config.buffers.map((entry: any) => entry.id.split(':').pop()), mode).toEqual(['uniform', 'landmarks', 'particles']);
    });
    // A saved project with a mode name this build does not know still renders the first mode.
    const unknown = buildNativePluginGraph({ ...options('not-a-mode'), kind: 'handfx' }).config as any;
    expect(new Uint32Array(Uint8Array.from(atob(unknown.buffers[0].initial_b64), (c) => c.charCodeAt(0)).buffer)[5]).toBe(0);
  });

  it('gives each field mode its own colours when the palette is the original one', () => {
    const colour = (mode: string, palette?: string) => new Uint32Array(Uint8Array.from(atob((buildNativePluginGraph({
      ...options(mode, palette ? { handfxPalette: palette } : {}), kind: 'handfx' }).config as any).buffers[0].initial_b64), (c) => c.charCodeAt(0)).buffer)[6];
    expect(colour('bodyswarm', 'legacy')).toBe(5);
    expect(colour('bodyflow', 'legacy')).toBe(4);
    expect(colour('bodyaura')).toBe(6);
    expect(colour('bodyaura', 'acid')).toBe(7);
  });
});

describe('HandFX plugin definition', () => {
  const plugin = getPluginByEffectType('handfx')!;
  const modeDef = plugin.paramDefs.find((def) => def.param === 'handfxMode')!;

  it('offers every field mode and keeps every earlier one', () => {
    const values = modeDef.options!.map((option) => option.value);
    expect(values).toEqual(expect.arrayContaining([...HAND_FX_FIELD_MODES, 'bridge', 'orbit', 'lasers', 'portal', 'web', 'silk', 'trails', 'aurora', 'bursts', 'skeleton', 'panel']));
    expect(modeDef.default).toBe('bridge');
    expect(plugin.defaultSourceParams?.handfxMode).toBe('bridge');
  });

  it('shows the particle controls only for the body and face modes', () => {
    for (const param of ['handfxQuality', 'handfxTrails', 'handfxSwirl']) {
      const def = plugin.paramDefs.find((entry) => entry.param === param)!;
      expect([...def.showWhen!.values].sort(), param).toEqual([...HAND_FX_FIELD_MODES].sort());
      expect(plugin.defaultSourceParams?.[param], param).toBe(def.default);
    }
    const quality = plugin.paramDefs.find((entry) => entry.param === 'handfxQuality')!;
    expect(quality.options!.map((option) => option.value).sort()).toEqual(Object.keys(HAND_FX_QUALITY_PARTICLES).sort());
  });

  it('keeps its text plain: no long dashes', () => {
    const text = [plugin.description, ...plugin.paramDefs.flatMap((def) => [def.name, ...(def.options ?? []).map((option) => option.label)])]
      .filter((value) => /Body|Face|Particles|Trails|Swirl|thousand|million|Perform/.test(String(value)));
    for (const value of text) expect(String(value)).not.toMatch(/[—–]/);
  });
});
