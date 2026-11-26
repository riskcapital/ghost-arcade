import { describe, expect, it, vi } from 'vitest';

import {
  NativeJsCanvasHosts,
  isNativeJsCanvasSource,
  jsCanvasHostSize,
  nativeJsCanvasUri,
} from './nativeJsCanvasHosts';

const scenePage =
  '<!DOCTYPE html><html><head></head><body><script type="module">import * as THREE from "three"; new THREE.Scene();</script></body></html>';
const sketchPage = '<script>function setup(){ createCanvas(400, 400); } function draw(){ circle(20, 20, 10); }</script>';
const shaderPage = '<script>const fs = `void main(){ gl_FragColor = vec4(1.0); }`;</script>';

function source(id: string, htmlCode: string, type = 'threejs', extra: Record<string, unknown> = {}) {
  return {
    id,
    type,
    jsAnimation: { animationType: type === 'p5js' ? ('p5js' as const) : ('threejs' as const), htmlCode, ...extra },
  };
}

function fakeHost(overrides: { open?: unknown; status?: unknown } = {}) {
  const calls: Array<{ command: string; args: any }> = [];
  const call = vi.fn(async (command: string, args?: any) => {
    calls.push({ command, args });
    if (command === 'js_source_open') return overrides.open ?? { ok: true };
    if (command === 'js_source_status') return overrides.status ?? { hosts: [] };
    return { ok: true };
  });
  return { call, hosts: new NativeJsCanvasHosts(call), calls, of: (command: string) => calls.filter((c) => c.command === command) };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('isNativeJsCanvasSource', () => {
  it('takes three.js scenes and p5 sketches that have no extractable shader', () => {
    expect(isNativeJsCanvasSource(source('a', scenePage))).toBe(true);
    expect(isNativeJsCanvasSource(source('b', sketchPage, 'p5js'))).toBe(true);
  });

  it('leaves shader-backed pages to the core and ignores empty or non-JS sources', () => {
    expect(isNativeJsCanvasSource(source('c', shaderPage))).toBe(false);
    expect(isNativeJsCanvasSource(source('d', '   '))).toBe(false);
    expect(isNativeJsCanvasSource(source('e', scenePage, 'shader'))).toBe(false);
    expect(isNativeJsCanvasSource({ id: 'f', type: 'threejs' })).toBe(false);
  });

  it('gives a URI that is stable for a page and changes with it', () => {
    const a = source('same-id', scenePage);
    expect(nativeJsCanvasUri(a)).toBe(nativeJsCanvasUri(source('same-id', scenePage)));
    expect(nativeJsCanvasUri(a)).not.toBe(nativeJsCanvasUri(source('same-id', sketchPage)));
    expect(nativeJsCanvasUri(a)).toMatch(/^native-js-canvas:\/\/same-id\//);
  });
});

describe('jsCanvasHostSize', () => {
  it('follows the output aspect and never exceeds the core source slot', () => {
    expect(jsCanvasHostSize(1920, 1080, 2048)).toEqual({ width: 1920, height: 1080 });
    expect(jsCanvasHostSize(1920, 1080, 1536)).toEqual({ width: 1536, height: 864 });
    expect(jsCanvasHostSize(1920, 1080, 1024)).toEqual({ width: 1024, height: 576 });
    expect(jsCanvasHostSize(1080, 1920, 2048)).toEqual({ width: 1080, height: 1920 });
    expect(jsCanvasHostSize(5760, 1080, 2048)).toEqual({ width: 1920, height: 360 });
  });

  it('falls back to 16:9 when the output size is not known yet', () => {
    expect(jsCanvasHostSize(0, 0, 2048)).toEqual({ width: 1920, height: 1080 });
  });
});

describe('NativeJsCanvasHosts', () => {
  it('opens a host once, with saved values over the declared defaults', async () => {
    const { hosts, of } = fakeHost();
    const src = source('clip-1', scenePage, 'threejs', {
      params: [
        { name: 'speed', type: 'number', default: 1 },
        { name: 'glow', type: 'number', default: 0.5 },
      ],
      paramValues: { speed: 2.5 },
    });

    expect(hosts.use(src, 1920, 1080, 1000)).toBe(false);
    expect(hosts.use(src, 1920, 1080, 1016)).toBe(false);
    await settle();
    expect(hosts.use(src, 1920, 1080, 1032)).toBe(true);

    expect(of('js_source_open')).toHaveLength(1);
    expect(of('js_source_open')[0].args).toMatchObject({
      id: 'clip-1',
      html: scenePage,
      width: 1920,
      height: 1080,
      fps: 60,
      params: { speed: 2.5, glow: 0.5 },
    });
  });

  it('reopens when the page or the size changes', async () => {
    const { hosts, of } = fakeHost();
    hosts.use(source('x', scenePage), 1920, 1080, 0);
    await settle();
    hosts.use(source('x', scenePage), 1536, 864, 10);
    await settle();
    hosts.use(source('x', sketchPage, 'p5js'), 1536, 864, 20);
    await settle();
    expect(of('js_source_open').map((c) => [c.args.width, c.args.html === scenePage])).toEqual([
      [1920, true],
      [1536, true],
      [1536, false],
    ]);
  });

  it('retries a failed open after a pause instead of every frame', async () => {
    const { hosts, of } = fakeHost({ open: { ok: false, reason: 'crashed' } });
    const src = source('y', scenePage);
    hosts.use(src, 1920, 1080);
    await settle();
    expect(hosts.use(src, 1920, 1080)).toBe(false);
    expect(of('js_source_open')).toHaveLength(1);
    hosts.use(src, 1920, 1080, Date.now() + 5_000);
    expect(of('js_source_open')).toHaveLength(2);
  });

  it('closes hosts that nothing has used for the linger period', async () => {
    const { hosts, of } = fakeHost({ status: { hosts: [{ id: 'z' }] } });
    hosts.use(source('z', scenePage), 1920, 1080, 1_000);
    await settle();
    hosts.sweep(20_999);
    expect(of('js_source_close')).toHaveLength(0);
    hosts.sweep(21_000);
    expect(of('js_source_close').map((c) => c.args.id)).toEqual(['z']);
    expect(hosts.isOpen('z')).toBe(false);
  });

  it('stops painting a lingering host and paints again the moment it is used', async () => {
    const { hosts, of } = fakeHost({ status: { hosts: [{ id: 'p' }] } });
    const src = source('p', scenePage);
    hosts.use(src, 1920, 1080, 1_000);
    await settle();
    expect(hosts.use(src, 1920, 1080, 1_016)).toBe(true);
    hosts.sweep(1_500);
    expect(of('js_source_paint')).toHaveLength(0);
    hosts.sweep(2_016);
    hosts.sweep(2_500);
    expect(of('js_source_paint').map((c) => c.args)).toEqual([{ id: 'p', paint: false }]);
    // Used again: the same host, painting again, no reopen.
    expect(hosts.use(src, 1920, 1080, 3_000)).toBe(true);
    expect(of('js_source_paint').map((c) => c.args)).toEqual([{ id: 'p', paint: false }, { id: 'p', paint: true }]);
    expect(of('js_source_open')).toHaveLength(1);
  });

  it('does not pause pages while a render steps them', async () => {
    const { hosts, of } = fakeHost();
    hosts.use(source('r', scenePage), 1920, 1080, 1_000);
    await settle();
    await hosts.setRenderClock(true, 0);
    hosts.sweep(5_000);
    expect(of('js_source_paint')).toHaveLength(0);
  });

  it('sweeps on its own timer, so hosts close with no frame sync running', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    try {
      const { call } = fakeHost({ status: { hosts: [{ id: 't' }] } });
      const calls: string[] = [];
      const hosts = new NativeJsCanvasHosts(async (command, args) => {
        calls.push(command);
        return call(command, args);
      }, 1_000);
      hosts.use(source('t', scenePage), 1920, 1080, Date.now());
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(calls).toContain('js_source_paint');
      expect(calls).not.toContain('js_source_close');
      await vi.advanceTimersByTimeAsync(20_000);
      expect(calls).toContain('js_source_close');
      expect(hosts.isOpen('t')).toBe(false);
      // Nothing left: the timer stops.
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reopens a host that was closed on the Electron side', async () => {
    const { hosts, of } = fakeHost({ status: { hosts: [] } });
    const src = source('gone', scenePage);
    hosts.use(src, 1920, 1080, 1_000);
    await settle();
    expect(hosts.isOpen('gone')).toBe(true);
    hosts.sweep(3_500);
    await settle();
    expect(hosts.isOpen('gone')).toBe(false);
    hosts.use(src, 1920, 1080, 3_600);
    expect(of('js_source_open')).toHaveLength(2);
  });

  it('forwards params only to hosts it knows about', async () => {
    const { hosts, of } = fakeHost();
    hosts.setParams('unknown', { speed: 1 });
    hosts.use(source('known', scenePage), 1920, 1080, 0);
    hosts.setParams('known', { speed: 3 });
    expect(of('js_source_params').map((c) => c.args)).toEqual([{ id: 'known', values: { speed: 3 } }]);
  });

  it('sends audio about thirty times a second, in the names pages read', async () => {
    const { hosts, of } = fakeHost();
    const visual = {
      isActive: true, level: 0.4, bass: 0.7, bassFast: 0.2, mid: 0.3, treble: 0.2, high: 0.1,
      beat: 1, beatPhase: 0.25, bpm: 128, centroid: 0.6, kick: 1, snare: 0,
    } as any;
    hosts.pushAudio(visual, 0);
    expect(of('js_source_audio')).toHaveLength(0);

    hosts.use(source('a', scenePage), 1920, 1080, 0);
    hosts.pushAudio(visual, 100);
    hosts.pushAudio(visual, 120);
    hosts.pushAudio(visual, 140);
    expect(of('js_source_audio')).toHaveLength(2);
    expect(of('js_source_audio')[0].args.fields).toMatchObject({
      level: 0.4, bass: 0.7, beat: 1, beatPhase: 0.25, bpm: 128, kick: 1, active: true,
    });
  });
});

describe('pages in a render', () => {
  it('steps only the pages the frame used, with the frame\'s time and audio, and holds the live audio', async () => {
    const { hosts, of } = fakeHost();
    await hosts.setRenderClock(true, 1234);
    expect(of('js_source_render_clock')[0].args).toEqual({ on: true, dateMs: 1234 });
    hosts.use(source('a', scenePage), 640, 360);
    hosts.use(source('b', sketchPage, 'p5js'), 640, 360);
    await settle();
    await hosts.stepRender(0, { level: 0.2 });
    expect(of('js_source_step')[0].args).toEqual({ ids: ['a', 'b'], time: 0, audio: { level: 0.2 } });
    // Next frame shows only page a.
    hosts.use(source('a', scenePage), 640, 360);
    await hosts.stepRender(1 / 60, { level: 0 });
    expect(of('js_source_step')[1].args.ids).toEqual(['a']);
    // A frame with no page does not ask.
    await hosts.stepRender(2 / 60, {});
    expect(of('js_source_step')).toHaveLength(2);
    hosts.pushAudio({} as never, 1e9);
    expect(of('js_source_audio')).toHaveLength(0);
    await hosts.setRenderClock(false);
    await hosts.stepRender(3 / 60, {});
    expect(of('js_source_step')).toHaveLength(2);
  });

  it('a page that does not answer fails the frame, naming it', async () => {
    const call = vi.fn(async (command: string) => (command === 'js_source_step' ? { ok: false, failed: [{ id: 'a', reason: 'the page did not draw its frame within 10 s' }] } : { ok: true }));
    const hosts = new NativeJsCanvasHosts(call);
    await hosts.setRenderClock(true, 0);
    hosts.use(source('a', scenePage), 640, 360);
    await expect(hosts.stepRender(0, {}, () => 'Galaxy')).rejects.toThrow(/"Galaxy": the page did not draw/);
  });
});

