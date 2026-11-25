import { describe, expect, it } from 'vitest';
import { parsePatternDepth, parsePatternLuma, poseChange, turnFromPose, turnIntrinsics, turnRaster, type Turn } from './lidarScan';
import { runAutoMap, type AutoMapCamera, type AutoMapLink } from './autoMap';
import { planPatterns, patternValue } from './structuredLight';
import { STRIPE_CELL } from './structuredLightCodes';

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function words(values: number[], floats: number[]): number[] {
  const buffer = new ArrayBuffer(values.length * 4 + floats.length * 4);
  const view = new DataView(buffer);
  values.forEach((v, i) => view.setUint32(i * 4, v, true));
  floats.forEach((v, i) => view.setFloat32(values.length * 4 + i * 4, v, true));
  return Array.from(new Uint8Array(buffer));
}

describe('frames from the LiDAR camera', () => {
  it('reads a luma frame as the app writes it', () => {
    const pixels = [10, 20, 30, 40, 50, 60];
    const bytes = new Uint8Array([...words([0x4741504c, 9, 3, 2, 3], identity), ...pixels]);
    const frame = parsePatternLuma(bytes.buffer);
    expect(frame).toMatchObject({ width: 3, height: 2, frames: 3 });
    expect(Array.from(frame.luma)).toEqual(pixels);
    expect(frame.pose[15]).toBe(1);
    expect(() => parsePatternLuma(bytes.slice(0, 80).buffer)).toThrow();
  });
  it('reads a depth frame with its lens and pose', () => {
    const meters = [1.5, 0, 2.25, 3];
    const bytes = new Uint8Array(words([0x47415044, 2, 2, 15, 1920, 1440], [0.8, 1.07, 0.49, 0.51, ...identity, ...meters]));
    const depth = parsePatternDepth(bytes.buffer);
    expect(depth).toMatchObject({ width: 2, height: 2, frames: 15, imageWidth: 1920, imageHeight: 1440 });
    expect(depth.intrinsics.fx).toBeCloseTo(0.8, 6);
    expect(depth.intrinsics.cy).toBeCloseTo(0.51, 6);
    expect(Array.from(depth.meters)).toEqual(meters);
  });
});

describe('turning the scan upright', () => {
  // A point in the room lands on the same scene pixel before and after the turn: the
  // turned picture and the turned lens stay consistent with each other.
  for (const turn of [0, 90, 180, 270] as Turn[]) {
    it(`keeps photo and lens consistent at ${turn}°`, () => {
      const w = 64, h = 48;
      const k = { fx: 0.8, fy: 1.05, cx: 0.47, cy: 0.53 };
      const point = [0.3, -0.2, 2];
      const xn = k.cx + (k.fx * point[0]) / point[2], yn = k.cy + (k.fy * point[1]) / point[2];
      const i = Math.floor(xn * w), j = Math.floor(yn * h);
      const raster = new Float32Array(w * h);
      raster[j * w + i] = 1;
      const turned = turnRaster(raster, w, h, turn);
      const at = turned.data.indexOf(1);
      const ti = at % turned.width, tj = Math.floor(at / turned.width);
      const k2 = turnIntrinsics(k, turn);
      // The same point in the turned camera's axes.
      const [x, y] = turn === 90 ? [-point[1], point[0]] : turn === 180 ? [-point[0], -point[1]] : turn === 270 ? [point[1], -point[0]] : [point[0], point[1]];
      const xn2 = k2.cx + (k2.fx * x) / point[2], yn2 = k2.cy + (k2.fy * y) / point[2];
      expect(Math.floor(xn2 * turned.width)).toBe(ti);
      expect(Math.floor(yn2 * turned.height)).toBe(tj);
    });
  }
  it('measures how far the phone moved', () => {
    const turned = [...identity];
    const angle = (2 * Math.PI) / 180;
    turned[0] = Math.cos(angle); turned[1] = Math.sin(angle); turned[4] = -Math.sin(angle); turned[5] = Math.cos(angle);
    turned[12] = 0.01; turned[14] = -0.02;
    const moved = poseChange(identity, turned);
    expect(moved.degrees).toBeCloseTo(2, 4);
    expect(moved.metres).toBeCloseTo(Math.hypot(0.01, 0.02), 6);
  });
});

describe('a scan with the LiDAR camera', () => {
  /** A fake desktop and a camera that photographs a projector filling the frame. */
  function rig(depthFails = false) {
    const shown: { screenId: string; frame: number }[] = [];
    let current = 0;
    const link: AutoMapLink = {
      async request(op, extra = {}) {
        if (op === 'screens') return { screens: [{ id: 's1', name: 'Screen 1', width: 256, height: 128 }], cells: [STRIPE_CELL] };
        if (op === 'show') { shown.push(extra as { screenId: string; frame: number }); current = Number(extra.frame); }
        return {};
      },
    };
    const plan = planPatterns(256, 128, STRIPE_CELL);
    const events: string[] = [];
    const camera: AutoMapCamera = {
      async grab() {
        events.push('grab');
        const base = current % 100;
        const frame = base === 0 ? { kind: 'white' as const } : base === 1 ? { kind: 'black' as const }
          : { kind: 'bit' as const, axis: (base - 2 >= 32 ? 'y' : 'x') as 'x' | 'y', bit: ((base - 2) >> 1) % 16, inverted: (base - 2) % 2 === 1 };
        const luma = new Float32Array(128 * 64);
        for (let y = 0; y < 64; y++) for (let x = 0; x < 128; x++) luma[y * 128 + x] = 20 + 200 * patternValue(plan, frame, x * 2 + 1, y * 2 + 1);
        return { width: 128, height: 64, luma };
      },
      async lock() { events.push('lock'); },
      async depth() {
        events.push(`depth after frame ${current}`);
        if (depthFails) throw new Error('The LiDAR stopped sending depth.');
        return { width: 32, height: 16, meters: new Float32Array(32 * 16).fill(2), intrinsics: { fx: 0.8, fy: 1.6, cx: 0.5, cy: 0.5 } };
      },
    };
    return { link, camera, events, shown };
  }

  it('locks the exposure after the white frame and measures depth with the projector dark', async () => {
    const { link, camera, events } = rig();
    const result = await runAutoMap(link, camera, () => {}, { settleMs: 0, encode: () => 'data:image/jpeg;base64,' });
    expect(events.slice(0, 2)).toEqual(['grab', 'lock']);
    expect(events.filter(e => e === 'lock')).toHaveLength(1);
    expect(events[events.length - 1]).toBe(`depth after frame ${2 * 100 + 1}`); // black at the 32-pixel stripe size
    expect(result.depth?.width).toBe(32);
    expect(result.depthError).toBeUndefined();
  });

  it('keeps the stripe results when the depth fails, and says why', async () => {
    const { link, camera } = rig(true);
    const result = await runAutoMap(link, camera, () => {}, { settleMs: 0, encode: () => 'data:image/jpeg;base64,' });
    expect(result.projectors).toHaveLength(1);
    expect(result.depth).toBeUndefined();
    expect(result.depthError).toMatch(/LiDAR/);
  });
});

describe('the preview follows the phone when it turns', () => {
  // Pose columns: x and y of the camera in the world. World up seen in the image is (pose[1], -pose[5]) (x right, y down).
  const poseWithUp = (ux: number, uy: number) => { const p = new Float32Array(16); p[1] = ux; p[5] = -uy; p[15] = 1; return p; };
  it('turns each way the phone is held so world up lands at the top of the picture', () => {
    const w = 8, h = 6;
    for (const [ux, uy] of [[0, -1], [-1, 0], [0, 1], [1, 0]]) {
      const turn = turnFromPose(poseWithUp(ux, uy));
      // A mark at the image edge the world's up points to.
      const raster = new Uint8Array(w * h);
      const x = ux < 0 ? 0 : ux > 0 ? w - 1 : w >> 1, y = uy < 0 ? 0 : uy > 0 ? h - 1 : h >> 1;
      raster[y * w + x] = 255;
      const up = turnRaster(raster, w, h, turn);
      const at = up.data.indexOf(255);
      expect(Math.floor(at / up.width), `held with up at (${ux}, ${uy}): turn ${turn}`).toBe(0);
    }
  });
  it('agrees with a sideways phone: landscape sensor frames need no turn, portrait ones a quarter', () => {
    expect(turnFromPose(poseWithUp(0, -1))).toBe(0);
    expect(turnFromPose(poseWithUp(-0.98, 0.1))).toBe(90);
  });
});
