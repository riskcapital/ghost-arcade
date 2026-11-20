import { describe, expect, it } from 'vitest';
import { ARM_FADE_SECONDS, LazyConvolver, nextConvolverBuild, type ConvolverBuild } from './lazyConvolver';
import { SendReturns } from './sendReturns';
import { BuildFx } from './buildFx';
import { BandFx } from './bandFx';
import { FxRack } from './fxRack';
import { FX_RACKS, type StudioSet } from './studioSets';

/** Just enough of an AudioContext to build the studio's effect graphs and count what they make. */
function fakeContext() {
  const made: Record<string, number> = {};
  const convolvers: Array<{ buffer: unknown; connections: unknown[] }> = [];
  const param = (value = 1) => ({
    value,
    calls: [] as Array<[string, number, number]>,
    setValueAtTime(v: number, t: number) { this.calls.push(['set', v, t]); this.value = v; return this; },
    linearRampToValueAtTime(v: number, t: number) { this.calls.push(['ramp', v, t]); return this; },
    exponentialRampToValueAtTime(v: number, t: number) { this.calls.push(['exp', v, t]); return this; },
    setTargetAtTime(v: number, t: number) { this.calls.push(['target', v, t]); return this; },
    cancelScheduledValues() { return this; },
    cancelAndHoldAtTime() { return this; },
  });
  const node = (kind: string, extra: Record<string, unknown> = {}) => {
    made[kind] = (made[kind] ?? 0) + 1;
    const n: any = {
      kind, connections: [] as unknown[],
      gain: param(), frequency: param(), Q: param(), detune: param(), delayTime: param(0), pan: param(0),
      threshold: param(), knee: param(), ratio: param(), attack: param(), release: param(),
      type: '', curve: null, oversample: 'none', buffer: null,
      connect(target: unknown) { n.connections.push(target); return target; },
      disconnect() {}, start() {}, stop() {},
      ...extra,
    };
    return n;
  };
  const ctx: any = {
    currentTime: 0,
    sampleRate: 8000,
    state: 'running',
    destination: node('destination'),
    createGain: () => node('gain'),
    createDelay: () => node('delay'),
    createBiquadFilter: () => node('biquad'),
    createWaveShaper: () => node('shaper'),
    createStereoPanner: () => node('panner'),
    createOscillator: () => node('oscillator'),
    createDynamicsCompressor: () => node('compressor'),
    createBufferSource: () => node('bufferSource'),
    createConvolver: () => { const c = node('convolver'); convolvers.push(c); return c; },
    createBuffer: (channels: number, length: number) => {
      made.buffer = (made.buffer ?? 0) + 1;
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return { length, numberOfChannels: channels, getChannelData: (c: number) => data[c] };
    },
  };
  return { ctx, made, convolvers };
}

describe('convolver build state', () => {
  const none: ConvolverBuild = { kind: 'none' };
  it('none: arm with a fade builds, arm at once is ready, time alone does nothing', () => {
    expect(nextConvolverBuild(none, { type: 'arm', now: 2, fadeSeconds: 0.05 })).toEqual({ kind: 'building', readyAt: 2.05 });
    expect(nextConvolverBuild(none, { type: 'arm', now: 2, fadeSeconds: 0 })).toEqual({ kind: 'ready' });
    expect(nextConvolverBuild(none, { type: 'settle', now: 99 })).toBe(none);
  });
  it('building: ready once the fade is over; arming again changes nothing', () => {
    const building: ConvolverBuild = { kind: 'building', readyAt: 2.05 };
    expect(nextConvolverBuild(building, { type: 'settle', now: 2.01 })).toBe(building);
    expect(nextConvolverBuild(building, { type: 'settle', now: 2.05 })).toEqual({ kind: 'ready' });
    expect(nextConvolverBuild(building, { type: 'arm', now: 2.02, fadeSeconds: 0 })).toBe(building);
  });
  it('ready stays ready', () => {
    const ready: ConvolverBuild = { kind: 'ready' };
    expect(nextConvolverBuild(ready, { type: 'arm', now: 5, fadeSeconds: 0.05 })).toBe(ready);
    expect(nextConvolverBuild(ready, { type: 'settle', now: 5 })).toBe(ready);
  });
});

describe('LazyConvolver', () => {
  it('makes no convolver and no impulse until armed, then exactly one', () => {
    const { ctx, made } = fakeContext();
    let impulses = 0;
    const verb = new LazyConvolver(ctx, () => { impulses++; return ctx.createBuffer(2, 10, 8000); });
    expect(made.convolver ?? 0).toBe(0);
    expect(impulses).toBe(0);
    expect(verb.build.kind).toBe('none');
    verb.arm();
    verb.arm();
    expect(made.convolver).toBe(1);
    expect(impulses).toBe(1);
  });

  it('armed mid-playback, the wet sound fades in and is ready after the fade', () => {
    const { ctx, convolvers } = fakeContext();
    ctx.currentTime = 10;
    const verb = new LazyConvolver(ctx, () => ctx.createBuffer(2, 10, 8000));
    verb.arm();
    expect(verb.build).toEqual({ kind: 'building', readyAt: 10 + ARM_FADE_SECONDS });
    const fade = convolvers[0].connections[0] as any;
    expect(fade.gain.calls).toEqual([['set', 0, 10], ['ramp', 1, 10 + ARM_FADE_SECONDS]]);
    ctx.currentTime = 10 + ARM_FADE_SECONDS;
    expect(verb.build).toEqual({ kind: 'ready' });
  });

  it('armed at engine setup, it is at full level at once (a saved project sounds the same)', () => {
    const { ctx, convolvers } = fakeContext();
    const verb = new LazyConvolver(ctx, () => ctx.createBuffer(2, 10, 8000));
    verb.arm(true);
    expect(verb.build).toEqual({ kind: 'ready' });
    const fade = convolvers[0].connections[0] as any;
    expect(fade.gain.calls).toEqual([]);
    expect(fade.gain.value).toBe(1);
  });

  it('a new shape before the build is kept for it; after the build it applies at once', () => {
    const { ctx, convolvers } = fakeContext();
    const shapes: string[] = [];
    const make = (s: string) => () => { shapes.push(s); return ctx.createBuffer(2, 10, 8000); };
    const verb = new LazyConvolver(ctx, make('a'), 'a');
    verb.setImpulse('b', make('b'));
    expect(shapes).toEqual([]);
    verb.arm();
    expect(shapes).toEqual(['b']);
    verb.setImpulse('b', make('b'));
    verb.setImpulse('c', make('c'));
    expect(shapes).toEqual(['b', 'c']);
    expect(convolvers).toHaveLength(1);
  });
});

describe('the studio builds its reverbs on first use', () => {
  it('send returns: no convolver until a channel sends to that return', () => {
    const { ctx, made } = fakeContext();
    const returns = new SendReturns(ctx, ctx.createGain());
    returns.set({ reverb: 0.8, echo: 0.8, spring: 0.8 }, 120);
    expect(made.convolver ?? 0).toBe(0);
    returns.route({ reverb: true, echo: true, spring: false });
    expect(made.convolver).toBe(1);
    returns.route({ reverb: true, echo: false, spring: true });
    expect(made.convolver).toBe(2);
  });

  it('build-up: its reverb is made by the first build', () => {
    const { ctx, made } = fakeContext();
    const build = new BuildFx(ctx, ctx.createBuffer(1, 10, 8000));
    expect(made.convolver ?? 0).toBe(0);
    build.start({ start: 0, land: 2, beatSeconds: 0.5, hits: [], settings: { filter: 'none', sends: 1, gap: false, roll: 'snare', riser: 0, impact: 0 } as any });
    expect(made.convolver).toBe(1);
  });

  it('band effects: no reverb until the band sends into the echo or the reverb', () => {
    const { ctx, made } = fakeContext();
    const band = new BandFx(ctx, ctx.createGain());
    const settings = { echoSend: 0, verbSend: 0, feedback: 0.5, echoTone: 0.5, returnLevel: 0.8, freezeLevel: 0.5, echoTime: 'dotted8' } as any;
    band.setSettings(settings, 120);
    expect(made.convolver ?? 0).toBe(0);
    band.setSettings({ ...settings, verbSend: 0.4 }, 120);
    expect(made.convolver).toBe(1);
  });

  it('band effects: washing or an echo send makes the reverb too', () => {
    for (const touch of ['wash', 'echo'] as const) {
      const { ctx, made } = fakeContext();
      const band = new BandFx(ctx, ctx.createGain());
      const settings = { echoSend: 0, verbSend: 0, feedback: 0.5, echoTone: 0.5, returnLevel: 0.8, freezeLevel: 0.5, echoTime: 'dotted8' } as any;
      band.setSettings(settings, 120);
      if (touch === 'wash') band.setWash(true);
      else band.setSettings({ ...settings, echoSend: 0.3 }, 120);
      expect(made.convolver, touch).toBe(1);
    }
  });

  it('the effects rack: a room is made only when its mix is up', () => {
    const set = (Object.keys(FX_RACKS) as StudioSet[]).find((s) => FX_RACKS[s].some((d) => ['reverb', 'shimmer', 'gate', 'spring'].includes(d.kind)))!;
    const rooms = FX_RACKS[set].filter((d) => ['reverb', 'shimmer', 'gate', 'spring'].includes(d.kind));
    const { ctx, made } = fakeContext();
    const rack = new FxRack(ctx, set);
    const off = Object.fromEntries(FX_RACKS[set].map((d) => [`fx.${d.id}.mix`, 0]));
    rack.setParams(off, 120);
    expect(made.convolver ?? 0).toBe(0);
    rack.setParams({ ...off, [`fx.${rooms[0].id}.mix`]: 0.5 }, 120);
    expect(made.convolver).toBe(1);
  });
});
