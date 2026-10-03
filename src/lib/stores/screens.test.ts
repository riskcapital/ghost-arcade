import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';

/**
 * Screen mask editing goes through screenActions so the settings store is
 * the single mutation point. What matters: a new mask starts in placing
 * mode, vertex edits never mutate a shared array, feather stays in range,
 * and the selection resets when the mask or screen goes away.
 */

let screensModule: typeof import('./screens');
let settingsModule: typeof import('./settings');

function installDomShim(): void {
  const storage = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, String(v)),
    removeItem: (k: string) => void storage.delete(k),
    clear: () => storage.clear(),
    key: () => null,
    length: 0,
  };
  (globalThis as any).document = {
    documentElement: { style: { setProperty() {}, removeProperty() {} } },
    addEventListener() {}, removeEventListener() {},
  };
  (globalThis as any).window = globalThis;
  (globalThis as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
}

beforeAll(async () => {
  installDomShim();
  settingsModule = await import('./settings');
  screensModule = await import('./screens');
});

beforeEach(() => {
  settingsModule.settings.update(s => ({
    ...s,
    output: { ...s.output, slices: [settingsModule.createDefaultSlice('screen-a', 'A', 'A')] },
  }));
  screensModule.selectedScreenId.set('screen-a');
});

const masksOf = (id = 'screen-a') => get(screensModule.screens).find(s => s.id === id)!.masks!;

describe('screen mask actions', () => {
  it('adds an empty mask, selects it and starts placing vertices', () => {
    const { screenActions, selectedScreenMaskId, screenMaskPlacing } = screensModule;
    const id = screenActions.addMask('screen-a')!;
    expect(masksOf()).toEqual([{ id, name: 'Mask 1', enabled: true, points: [], feather: 0, invert: false }]);
    expect(get(selectedScreenMaskId)).toBe(id);
    expect(get(screenMaskPlacing)).toBe(true);

    screenActions.addMaskPoint('screen-a', id, { x: 0.1, y: 0.1 });
    screenActions.addMaskPoint('screen-a', id, { x: 0.9, y: 0.1 });
    screenActions.addMaskPoint('screen-a', id, { x: 1.4, y: -0.2 });
    expect(masksOf()[0].points).toEqual([{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 1, y: 0 }]);
    expect(settingsModule.screenMaskIsActive(masksOf()[0])).toBe(true);

    // Insert before index 1, move a vertex, remove one.
    screenActions.addMaskPoint('screen-a', id, { x: 0.5, y: 0.05 }, 1);
    expect(masksOf()[0].points[1]).toEqual({ x: 0.5, y: 0.05 });
    screenActions.updateMaskPoint('screen-a', id, 3, { x: 0.8, y: 0.8 });
    expect(masksOf()[0].points[3]).toEqual({ x: 0.8, y: 0.8 });
    screenActions.removeMaskPoint('screen-a', id, 0);
    expect(masksOf()[0].points).toEqual([{ x: 0.5, y: 0.05 }, { x: 0.9, y: 0.1 }, { x: 0.8, y: 0.8 }]);
  });

  it('updates mask settings without sharing vertices and keeps feather in range', () => {
    const { screenActions } = screensModule;
    const id = screenActions.addMask('screen-a')!;
    screenActions.addMaskPoint('screen-a', id, { x: 0.2, y: 0.2 });
    const before = masksOf();
    screenActions.updateMask('screen-a', id, { name: 'Doorway', invert: true, feather: 3, enabled: false });
    const after = masksOf();
    expect(after[0]).toMatchObject({ name: 'Doorway', invert: true, feather: 1, enabled: false });
    expect(after).not.toBe(before);
    expect(after[0].points).not.toBe(before[0].points);
    expect(after[0].points).toEqual(before[0].points);
    screenActions.updateMask('screen-a', id, { feather: -0.5 });
    expect(masksOf()[0].feather).toBe(0);
  });

  it('removing the selected mask or changing screens clears the selection', () => {
    const { screenActions, selectedScreenId, selectedScreenMaskId, screenMaskPlacing } = screensModule;
    const first = screenActions.addMask('screen-a')!;
    const second = screenActions.addMask('screen-a')!;
    expect(masksOf().map(m => m.name)).toEqual(['Mask 1', 'Mask 2']);
    expect(get(selectedScreenMaskId)).toBe(second);
    screenActions.removeMask('screen-a', second);
    expect(masksOf().map(m => m.id)).toEqual([first]);
    expect(get(selectedScreenMaskId)).toBeNull();
    expect(get(screenMaskPlacing)).toBe(false);

    selectedScreenMaskId.set(first);
    screenMaskPlacing.set(true);
    selectedScreenId.set(null);
    expect(get(selectedScreenMaskId)).toBeNull();
    expect(get(screenMaskPlacing)).toBe(false);
  });

  it('duplicating a screen copies its masks with fresh ids', () => {
    const { screenActions } = screensModule;
    const id = screenActions.addMask('screen-a')!;
    for (const p of [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.5, y: 0.9 }]) screenActions.addMaskPoint('screen-a', id, p);
    const copyId = screenActions.duplicate('screen-a')!;
    const copy = masksOf(copyId);
    expect(copy).toHaveLength(1);
    expect(copy[0].id).not.toBe(id);
    expect(copy[0].points).toEqual(masksOf()[0].points);
    screenActions.updateMaskPoint(copyId, copy[0].id, 0, { x: 0.3, y: 0.3 });
    expect(masksOf()[0].points[0]).toEqual({ x: 0.1, y: 0.1 });
  });
});

describe('screen mask presses', () => {
  const left = { button: 0, altKey: false };
  const right = { button: 2, altKey: false };
  const alt = { button: 0, altKey: true };

  it('closes the shape from the first vertex once there are 3 points while placing', () => {
    const { screenMaskPointPress } = screensModule;
    expect(screenMaskPointPress(left, true, 0, 3)).toBe('close');
    expect(screenMaskPointPress(left, true, 0, 2)).toBe('drag');
    expect(screenMaskPointPress(left, true, 1, 3)).toBe('drag');
  });

  it('closes on a right-click while placing and removes on a right-click otherwise', () => {
    const { screenMaskPointPress } = screensModule;
    expect(screenMaskPointPress(right, true, 2, 4)).toBe('close');
    expect(screenMaskPointPress(right, false, 2, 4)).toBe('remove');
    expect(screenMaskPointPress(alt, false, 0, 4)).toBe('remove');
    expect(screenMaskPointPress(left, false, 0, 4)).toBe('drag');
  });

  it('adds on a left press on the canvas, closes on a right press, ignores the rest', () => {
    const { screenMaskCanvasPress } = screensModule;
    expect(screenMaskCanvasPress(0)).toBe('add');
    expect(screenMaskCanvasPress(2)).toBe('close');
    expect(screenMaskCanvasPress(1)).toBe('ignore');
  });
});

describe('curved screen mask editing', () => {
  function withArch() {
    const id = screensModule.screenActions.addMask('screen-a')!;
    for (const p of [{ x: 0.1, y: 0.6 }, { x: 0.9, y: 0.6 }, { x: 0.5, y: 0.95 }]) {
      screensModule.screenActions.addMaskPoint('screen-a', id, p);
    }
    return id;
  }

  it('toggles a vertex between corner and curve with handles along its neighbours', () => {
    const id = withArch();
    screensModule.screenActions.toggleMaskPointCurve('screen-a', id, 2);
    const p = masksOf()[0].points[2];
    // Neighbours are (0.9, 0.6) before and (0.1, 0.6) after: handles run
    // a quarter of that span either side of the vertex.
    expect(p.cpIn!.x).toBeCloseTo(0.7, 12);
    expect(p.cpOut!.x).toBeCloseTo(0.3, 12);
    expect(p.cpIn!.y).toBeCloseTo(0.95, 12);
    screensModule.screenActions.toggleMaskPointCurve('screen-a', id, 2);
    expect(masksOf()[0].points[2]).toEqual({ x: 0.5, y: 0.95 });
  });

  it('moves handles with their vertex and sets or clears one side at a time', () => {
    const id = withArch();
    screensModule.screenActions.setMaskPointHandles('screen-a', id, 0, { cpOut: { x: 0.3, y: 0.1 } });
    screensModule.screenActions.updateMaskPoint('screen-a', id, 0, { x: 0.2, y: 0.5 });
    const p = masksOf()[0].points[0];
    expect(p.x).toBeCloseTo(0.2, 12);
    expect(p.cpOut!.x).toBeCloseTo(0.4, 12);
    expect(p.cpOut!.y).toBeCloseTo(0.0, 12);
    expect(p.cpIn).toBeUndefined();
    screensModule.screenActions.setMaskPointHandles('screen-a', id, 0, { cpOut: null });
    expect(masksOf()[0].points[0]).toEqual({ x: 0.2, y: 0.5 });
  });

  it('splits a curved edge in the middle without changing its shape', async () => {
    const { flattenScreenMask } = await import('./screenMaskGeometry');
    const id = withArch();
    screensModule.screenActions.setMaskPointHandles('screen-a', id, 0, { cpOut: { x: 0.3, y: 0.05 } });
    screensModule.screenActions.setMaskPointHandles('screen-a', id, 1, { cpIn: { x: 0.7, y: 0.05 } });
    const before = masksOf()[0].points;
    const mid = screensModule.screenMaskEdgeMidpoint(before, 0);
    screensModule.screenActions.insertMaskPointOnEdge('screen-a', id, 0);
    const after = masksOf()[0].points;
    expect(after).toHaveLength(4);
    expect(after[1].x).toBeCloseTo(mid.x, 12);
    expect(after[1].y).toBeCloseTo(mid.y, 12);
    // Each half is exactly half of the old cubic: sample both outlines.
    const cubicAt = (a: any, c1: any, c2: any, b: any, t: number) => {
      const mt = 1 - t;
      return { x: mt ** 3 * a.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t ** 3 * b.x,
        y: mt ** 3 * a.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t ** 3 * b.y };
    };
    for (const t of [0.1, 0.3, 0.45]) {
      const old = cubicAt(before[0], before[0].cpOut, before[1].cpIn, before[1], t);
      const half = cubicAt(after[0], after[0].cpOut, after[1].cpIn, after[1], t * 2);
      expect(half.x).toBeCloseTo(old.x, 12);
      expect(half.y).toBeCloseTo(old.y, 12);
    }
    expect(flattenScreenMask(after).length).toBeGreaterThan(4);
    // A side with no handle keeps none after the split (it would sit on
    // its own point): only the curved side's neighbour gains a handle.
    screensModule.screenActions.setMaskPointHandles('screen-a', id, 2, { cpOut: { x: 0.95, y: 0.8 } });
    screensModule.screenActions.insertMaskPointOnEdge('screen-a', id, 2);
    const split = masksOf()[0].points;
    expect(split[4].cpIn).toBeUndefined();
    expect(split[3].cpIn && split[3].cpOut).toBeTruthy();
    screensModule.screenActions.removeMaskPoint('screen-a', id, 3);
    // A straight edge still gets a plain midpoint.
    screensModule.screenActions.insertMaskPointOnEdge('screen-a', id, 3);
    const plain = masksOf()[0].points[4];
    expect(plain.cpIn ?? plain.cpOut).toBeUndefined();
    expect(plain.x).toBeCloseTo(0.3, 12);
    expect(plain.y).toBeCloseTo(0.775, 12);
  });

  it('duplicates a curved mask with its own handles', () => {
    const id = withArch();
    screensModule.screenActions.setMaskPointHandles('screen-a', id, 0, { cpOut: { x: 0.3, y: 0.1 } });
    const copyId = screensModule.screenActions.duplicate('screen-a')!;
    const copy = masksOf(copyId)[0].points[0];
    expect(copy.cpOut).toEqual({ x: 0.3, y: 0.1 });
    expect(copy.cpOut).not.toBe(masksOf()[0].points[0].cpOut);
  });
});

describe('projector calibration', () => {
 it('preserves calibrated crops through migration and removing another output', () => {
   const calibrated = settingsModule.migrateOutputSlice({ ...settingsModule.createDefaultSlice('screen-a','A','A'),cropX:.12,cropW:.6,
     projectorCalibration:{enabled:true,corners:[{x:.1,y:.1},{x:.9,y:.1},{x:1,y:1},{x:0,y:1}]},
     overlapBand:{enabled:true,side:'left',startTop:.45,startBottom:.4,endTop:.55,endBottom:.6} });
   const roundTrip=settingsModule.migrateOutputSlice(JSON.parse(JSON.stringify(calibrated)));
   expect(roundTrip.projectorCalibration).toEqual(calibrated.projectorCalibration);
   expect(roundTrip.overlapBand).toEqual(calibrated.overlapBand);
   settingsModule.settings.update(s=>({...s,output:{...s.output,slices:[roundTrip,settingsModule.createDefaultSlice('b','B','B')]}}));
   screensModule.screenActions.remove('b');
   expect(get(settingsModule.settings).output.slices[0].cropX).toBe(.12);
   expect(get(settingsModule.settings).output.slices[0].cropW).toBe(.6);
 });
});
