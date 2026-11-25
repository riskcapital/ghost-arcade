import { describe, expect, it } from 'vitest';
import { CALIBRATION_CHUNK_CHARS, calibrationAssembler, calibrationMessages, offeredCalibration } from './calibrationTransfer';

const big = (chars: number) => JSON.stringify({ name: 'Stage "A"', mappedSurfaces: [{ name: 'Painting', image: 'data:image/jpeg;base64,' + 'A'.repeat(chars) }] });

describe('calibration packages over the pairing socket', () => {
  it('sends a small package as one object, not JSON text inside JSON', () => {
    const json = JSON.stringify({ name: 'Stage A', surfaces: [] });
    const [message, ...rest] = calibrationMessages('r1', json);
    expect(rest).toHaveLength(0);
    expect(message).toEqual({ type: 'studio_calibration_offer', requestId: 'r1', calibration: { name: 'Stage A', surfaces: [] } });
    // On the wire no quote is escaped twice.
    expect(JSON.stringify(message)).not.toContain('\\"');
    expect(offeredCalibration(message as any)).toBe(json);
    // An older phone's text form still reads.
    expect(offeredCalibration({ json })).toBe(json);
    expect(offeredCalibration({})).toBeNull();
  });

  it('sends a large package in pieces that each fit a socket message, and puts it back together', () => {
    const json = big(7_500_000);
    const messages = calibrationMessages('r2', json);
    expect(messages.length).toBe(Math.ceil(json.length / CALIBRATION_CHUNK_CHARS));
    for (const m of messages) expect(JSON.stringify(m).length).toBeLessThan(2 * 1024 * 1024);
    const assemble = calibrationAssembler();
    // Out of order, and one piece twice.
    const shuffled = [...messages].reverse();
    let out: string | null = null;
    for (const m of [shuffled[0], ...shuffled]) out = assemble.receive(m as any) ?? out;
    expect(out).toBe(json);
    expect(assemble.pending).toBe(0);
  });

  it('refuses a package over the limit, and forgets one that stops arriving', () => {
    expect(() => calibrationMessages('r3', big(21_000_000))).toThrow(/too large/);
    let t = 0;
    const assemble = calibrationAssembler(1000, () => t);
    expect(assemble.receive({ requestId: 'r4', index: 0, count: 3, data: 'x' })).toBeNull();
    expect(assemble.pending).toBe(1);
    t = 5000;
    expect(assemble.receive({ requestId: 'r5', index: 0, count: 2, data: 'y' })).toBeNull();
    expect(assemble.pending).toBe(1);
    // Nonsense is ignored.
    expect(assemble.receive({ requestId: 'r6', index: 4, count: 2, data: 'z' })).toBeNull();
    expect(assemble.receive({ requestId: 'r6', index: 0, count: 999, data: 'z' })).toBeNull();
  });
});
