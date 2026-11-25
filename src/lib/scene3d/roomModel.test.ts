import { describe, expect, it } from 'vitest';
import { defaultRoom, isScannedRoom, roomForHandSetup, roomForRealObjects, roomOnCancel, type Room } from './roomModel';

const face = { id: 'scan:a', origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], outline: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] } as unknown as Room['faces'][number];
const scan = (): Room => ({ ...defaultRoom(), source: 'phone', faces: [face] });

describe('a phone-scanned room survives depth setup', () => {
  it('is recognised as a scan only without a hand setup', () => {
    expect(isScannedRoom(scan())).toBe(true);
    expect(isScannedRoom(roomForHandSetup(scan()))).toBe(false);
    expect(isScannedRoom(defaultRoom())).toBe(false);
    expect(isScannedRoom(undefined)).toBe(false);
  });

  it('Flat wall then Real objects keeps the scan as measured', () => {
    const room = scan();
    expect(roomForRealObjects(room)).toBe(room);
    expect(roomForRealObjects(room).setup).toBeUndefined();
  });

  it('Real objects without a scan starts a hand setup, and keeps one already there', () => {
    expect(roomForRealObjects(undefined).setup?.done).toBe(false);
    const manual = roomForRealObjects(defaultRoom());
    expect(roomForRealObjects(manual)).toBe(manual);
  });

  it('Set up again then Cancel keeps the scan', () => {
    const room = scan();
    expect(roomOnCancel(room)).toBe(room);
  });

  it('Set up by hand then Cancel brings the scan back', () => {
    const handOverScan = roomForHandSetup(scan());
    expect(handOverScan.setup).toBeDefined();
    const back = roomOnCancel(handOverScan)!;
    expect(back.setup).toBeUndefined();
    expect('setup' in back).toBe(false);
    expect(back.faces).toEqual([face]);
    expect(isScannedRoom(back)).toBe(true);
  });

  it('Cancel on a hand setup never finished goes back to the wall; a finished one stays', () => {
    expect(roomOnCancel(roomForRealObjects(undefined))).toBeNull();
    expect(roomOnCancel(undefined)).toBeNull();
    const done = { ...roomForRealObjects(undefined) };
    done.setup = { ...done.setup!, done: true };
    expect(roomOnCancel(done)).toBe(done);
  });
});
