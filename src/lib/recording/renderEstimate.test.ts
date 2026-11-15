import { describe, expect, it } from 'vitest';
import { estimateRender, formatBytes, formatDuration, qualityChoices, qualityFor, rateSampleFrom, videoBitrate } from './renderEstimate';
import { clockLabel, isInteractiveLayer, renderNotes, renderRanges } from './renderSetup';
import type { Layer } from '../types';

describe('render quality and estimates', () => {
  it('offers a quality choice per codec', () => {
    expect(qualityChoices('h264').map((q) => q.label)).toEqual(['Smaller file', 'High', 'Master']);
    expect(qualityChoices('prores_hq').map((q) => q.label)).toEqual(['ProRes 422 LT', 'ProRes 422 HQ', 'ProRes 4444 XQ']);
    expect(qualityChoices('hap').map((q) => q.label)).toEqual(['HAP', 'HAP Q']);
    expect(qualityFor('hap', 'web')).toBe('high');
    expect(qualityFor('h264', 'archive')).toBe('archive');
  });

  it('sizes ProRes from its target rates (HQ 1080p29.97 is 220 Mbit/s)', () => {
    expect(videoBitrate('prores_hq', 'high', 1920, 1080, 30000 / 1001)).toBeCloseTo(220e6, -3);
    expect(videoBitrate('prores_hq', 'high', 1920, 1080, 60)).toBeCloseTo(220e6 * 60 / (30000 / 1001), -3);
    expect(videoBitrate('prores_hq', 'high', 3840, 2160, 60)).toBeCloseTo(4 * videoBitrate('prores_hq', 'high', 1920, 1080, 60), -3);
    const e = estimateRender({ codec: 'prores_hq', quality: 'high', width: 1920, height: 1080, fps: 60, seconds: 120, withSound: true });
    expect(e.frames).toBe(7200);
    expect(e.approximate).toBe(false);
    expect(e.bytes / 1e9).toBeGreaterThan(6.5);
    expect(e.bytes / 1e9).toBeLessThan(7.0);
  });

  it('marks H.264 as about, and times from the last render here', () => {
    const first = estimateRender({ codec: 'h264', quality: 'high', width: 1920, height: 1080, fps: 30, seconds: 60, withSound: true });
    expect(first.approximate).toBe(true);
    expect(first.measured).toBe(false);
    // The measured first guess: 1080p ~60 ms a frame, 4K ~166 ms.
    expect(first.seconds / first.frames * 1000).toBeGreaterThan(50);
    expect(first.seconds / first.frames * 1000).toBeLessThan(65);
    const k4 = estimateRender({ codec: 'h264', quality: 'high', width: 3840, height: 2160, fps: 60, seconds: 120, withSound: true });
    expect(k4.seconds).toBeGreaterThan(1100);
    expect(k4.seconds).toBeLessThan(1300);
    const sample = rateSampleFrom(60_000, 1800, 1920, 1080);
    const next = estimateRender({ codec: 'h264', quality: 'high', width: 1920, height: 1080, fps: 30, seconds: 60, withSound: true, sample });
    expect(next.measured).toBe(true);
    expect(next.seconds).toBeCloseTo(60, 0);
    expect(rateSampleFrom(0, 10, 100, 100)).toBeNull();
  });

  it('formats sizes and times plainly', () => {
    expect(formatBytes(1.5e9)).toBe('1.5 GB');
    expect(formatBytes(320e6)).toBe('320 MB');
    expect(formatDuration(42)).toBe('42 s');
    expect(formatDuration(600)).toBe('10 min');
    expect(formatDuration(5400)).toBe('1 h 30 min');
  });
});

describe('render setup', () => {
  it('offers the whole show and, when set, the in/out work area', () => {
    expect(renderRanges({ duration: 126, workArea: null }, true)).toEqual({ show: { start: 0, seconds: 126 }, area: null });
    expect(renderRanges({ duration: 126, workArea: { start: 30, end: 70.5 } }, true)).toEqual({ show: { start: 0, seconds: 126 }, area: { start: 30, seconds: 40.5 } });
    expect(renderRanges({ duration: 0, workArea: null }, false)).toEqual({ show: null, area: null });
    expect(clockLabel(126)).toBe('2:06');
    expect(clockLabel(70.5)).toBe('1:10.5');
  });

  it('notes Interactive Studio worlds and script pages only when they are in the show', () => {
    const layer = (patch: Partial<Layer>) => ({ id: 'l', name: 'l', visible: true, type: 'media', ...patch }) as Layer;
    const world = layer({ source: { id: 's', type: 'effect', src: 'plugin://performer-world', name: 'Interactive Studio', effectSource: { effectType: 'performer-world' } } as Layer['source'] });
    expect(isInteractiveLayer(world)).toBe(true);
    expect(renderNotes([layer({})])).toEqual({ interactive: false, scriptPages: false });
    expect(renderNotes([world]).interactive).toBe(true);
    expect(renderNotes([{ ...world, visible: false }]).interactive).toBe(false);
    expect(renderNotes([layer({ source: { id: 's', type: 'threejs', src: 'x', name: 'x' } as Layer['source'] })]).scriptPages).toBe(true);
  });
});
