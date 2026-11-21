import { describe, expect, it } from 'vitest';
import type { AudioAnalysis } from './analyzer';
import {
  AV_EVENT_CAPACITY,
  AV_EVENTS_OFFSET,
  AV_H,
  AV_SPECTRUM_OFFSET,
  AV_TOTAL_FLOATS,
  AV_WAVEFORM_OFFSET,
  AV_WAVEFORM_SAMPLES,
  createAudioVisualPacker,
} from './audioVisualData';

const BINS = 1024;
const SR = 48000;

/** A frame with `db` everywhere, plus `boost` dB in [loHz, hiHz). */
function frame(db: number, boost = 0, loHz = 0, hiHz = 0, tone = 0): AudioAnalysis {
  const fftData = new Float32Array(BINS).fill(db);
  for (let i = 0; i < BINS; i += 1) {
    const hz = (i / BINS) * (SR / 2);
    if (hz >= loHz && hz < hiHz) fftData[i] = db + boost;
  }
  const waveformData = new Float32Array(2048);
  for (let i = 0; i < waveformData.length; i += 1) waveformData[i] = Math.sin(i * 0.05 + tone) * 0.5;
  return {
    fftData,
    waveformData,
    amplitude: 0.4,
    beatPhase: 0.25,
    bpm: 120,
  } as unknown as AudioAnalysis;
}

function events(packet: Float32Array) {
  const out: Array<{ time: number; band: number; strength: number; seq: number }> = [];
  for (let i = 0; i < packet[AV_H.eventCount]; i += 1) {
    const at = AV_EVENTS_OFFSET + i * 4;
    out.push({ time: packet[at], band: packet[at + 1], strength: packet[at + 2], seq: packet[at + 3] });
  }
  return out;
}

/** 20 quiet frames, then a bass hit at frame 20, at 60 fps. */
function runKick(packer = createAudioVisualPacker({ sampleRate: SR })) {
  let packet: Float32Array | null = null;
  for (let f = 0; f < 30; f += 1) {
    const hit = f === 20;
    packet = packer.pack(hit ? frame(-60, 35, 30, 160) : frame(-60), f / 60);
  }
  return packet!;
}

describe('audio visual packer', () => {
  it('uses the layout the core reads (audio_data.rs)', () => {
    expect(AV_EVENTS_OFFSET).toBe(16);
    expect(AV_SPECTRUM_OFFSET).toBe(144);
    expect(AV_WAVEFORM_OFFSET).toBe(272);
    expect(AV_TOTAL_FLOATS).toBe(784);
    const packet = createAudioVisualPacker().pack(frame(-60), 1)!;
    expect(packet.byteLength).toBe(3136);
    expect(packet[AV_H.version]).toBe(1);
    expect(packet[AV_H.time]).toBe(1);
    expect(packet[AV_H.active]).toBe(1);
    expect(packet[AV_H.spectrumBins]).toBe(128);
    expect(packet[AV_H.bpm]).toBe(120);
  });

  it('returns null without analysis', () => {
    expect(createAudioVisualPacker().pack(null, 0)).toBeNull();
    expect(createAudioVisualPacker().encode(undefined, 0)).toBeNull();
  });

  it('finds a bass hit once, at the time it happened, and lifts the bass envelope', () => {
    const packet = runKick();
    const hits = events(packet);
    expect(hits).toHaveLength(1);
    expect(hits[0].band).toBe(0);
    expect(hits[0].time).toBeCloseTo(20 / 60, 5);
    expect(hits[0].seq).toBe(1);
    expect(hits[0].strength).toBeGreaterThanOrEqual(0.3);
    expect(packet[AV_H.eventSeq]).toBe(1);
    expect(packet[AV_H.envBass]).toBeGreaterThan(0.1);
    expect(packet[AV_H.envHigh]).toBe(0);
  });

  it('finds the same hit at 30 fps as at 60 fps', () => {
    const packer = createAudioVisualPacker({ sampleRate: SR });
    let packet: Float32Array | null = null;
    // A loud start (the kind of jump that used to sit in the history for
    // twice as long at 30 fps), then quiet, then a kick at 1 s.
    for (let f = 0; f < 45; f += 1) {
      const t = f / 30;
      const frameData = f < 3 ? frame(-30) : f === 30 ? frame(-60, 35, 30, 160) : frame(-60);
      packet = packer.pack(frameData, t);
    }
    const bass = events(packet!).filter((hit) => hit.band === 0);
    expect(bass.some((hit) => Math.abs(hit.time - 1) < 1e-6)).toBe(true);
  });

  it('is deterministic for the same frames and times (offline render)', () => {
    const a = runKick();
    const b = runKick();
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('a repeat frame at the same time changes nothing', () => {
    const packer = createAudioVisualPacker({ sampleRate: SR });
    for (let f = 0; f < 20; f += 1) packer.pack(frame(-60), f / 60);
    const first = Array.from(packer.pack(frame(-60, 35, 30, 160), 20 / 60)!);
    const again = Array.from(packer.pack(frame(-60, 35, 30, 160), 20 / 60)!);
    expect(again).toEqual(first);
    expect(events(Float32Array.from(again))).toHaveLength(1);
  });

  it('keeps a bounded ring of hits, newest first', () => {
    const packer = createAudioVisualPacker({ sampleRate: SR });
    let packet: Float32Array | null = null;
    for (let f = 0; f < 1200; f += 1) {
      // A high-band tick every 6 frames (100 ms).
      packet = packer.pack(f % 6 === 0 && f > 30 ? frame(-60, 40, 3000, 12000) : frame(-60), f / 60);
    }
    const hits = events(packet!);
    expect(hits).toHaveLength(AV_EVENT_CAPACITY);
    for (let i = 1; i < hits.length; i += 1) {
      expect(hits[i - 1].seq).toBe(hits[i].seq + 1);
      expect(hits[i - 1].time).toBeGreaterThan(hits[i].time);
    }
    expect(hits.every((hit) => hit.band === 2)).toBe(true);
  });

  it('reset forgets history but never reuses a sequence number', () => {
    const packer = createAudioVisualPacker({ sampleRate: SR });
    runKick(packer);
    packer.reset();
    const packet = runKick(packer);
    expect(events(packet)[0].seq).toBe(2);
  });

  it('spectrum is 0..1 and brighter where the sound is; waveform tapers to zero at the ends', () => {
    const packet = createAudioVisualPacker({ sampleRate: SR }).pack(frame(-75, 50, 800, 1200), 0)!;
    const spectrum = Array.from(packet.subarray(AV_SPECTRUM_OFFSET, AV_SPECTRUM_OFFSET + 128));
    expect(Math.min(...spectrum)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...spectrum)).toBeLessThanOrEqual(1);
    // 1 kHz sits about 60% of the way up a 30 Hz..16 kHz log axis.
    const peak = spectrum.indexOf(Math.max(...spectrum));
    expect(peak).toBeGreaterThan(64);
    expect(peak).toBeLessThan(80);
    expect(packet[AV_WAVEFORM_OFFSET]).toBeCloseTo(0, 5);
    expect(packet[AV_WAVEFORM_OFFSET + AV_WAVEFORM_SAMPLES - 1]).toBeCloseTo(0, 5);
    const middle = packet.subarray(AV_WAVEFORM_OFFSET + 100, AV_WAVEFORM_OFFSET + 400);
    expect(Math.max(...Array.from(middle).map(Math.abs))).toBeGreaterThan(0.3);
  });
});
