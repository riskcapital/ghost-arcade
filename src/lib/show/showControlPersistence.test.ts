/**
 * Show control survives a project save and reload: the cue list and its
 * markers, timecode settings, the schedule and the projectors all travel in
 * `project.showControl` through the real save and import paths.
 *
 * Same DOM shim as showTimelinePersistence.test.ts: layers.ts touches the
 * document at import time.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';

let layers: typeof import('../stores/layers');
let show: typeof import('./showControlPersistence');
let cues: typeof import('./cueList');
let tc: typeof import('./timecode/timecodeChase');
let sched: typeof import('./scheduler');
let proj: typeof import('./projectors');

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
  const makeEl = (): any => ({
    style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' },
    dataset: {},
    classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
    setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
    appendChild: (c: any) => c, removeChild: (c: any) => c,
    addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [],
    load() {}, play: () => Promise.resolve(), pause() {},
  });
  (globalThis as any).document = {
    documentElement: makeEl(),
    body: makeEl(),
    head: makeEl(),
    createElement: () => makeEl(),
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    addEventListener() {}, removeEventListener() {},
    visibilityState: 'visible',
  };
  (globalThis as any).window = globalThis;
  (globalThis as any).matchMedia = () => ({
    matches: false,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {},
  });
  (globalThis as any).requestAnimationFrame = (cb: (t: number) => void) =>
    setTimeout(() => cb(Date.now()), 0) as unknown as number;
  (globalThis as any).cancelAnimationFrame = (id: number) => clearTimeout(id as never);
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeAll(async () => {
  installDomShim();
  layers = await import('../stores/layers');
  show = await import('./showControlPersistence');
  cues = await import('./cueList');
  tc = await import('./timecode/timecodeChase');
  sched = await import('./scheduler');
  proj = await import('./projectors');
});

afterAll(() => {
  tc.timecodeChase.shutdown();
});

function buildShowControl() {
  const { cueList } = cues;
  cueList.hydrate(null);
  const a = cueList.addCue({ name: 'Doors', timecode: 3600 });
  const b = cueList.addCue({ name: 'Show' });
  cueList.updateFollow(a, { mode: 'auto', wait: 16, unit: 'beats', target: 'jump', jumpTo: b });
  cueList.addAction(a, 'projector');
  const fade = cueList.addAction(b, 'macro');
  cueList.updateAction(b, fade, { macro: 3, value: 0.25, fade: 4 });
  cueList.addMarker(12.5, b, 'Drop');
  // Settings only: the store would try to open the device otherwise.
  tc.timecodeChase.settings.set(tc.normalizeTimecodeSettings({
    source: 'mtc', rate: 29.97, offset: 3600, freewheelSeconds: 4, chaseCues: false, mtcInputId: 'in-1',
  }));
  sched.showSchedule.set(sched.normalizeSchedule({
    enabled: true,
    entries: [{ id: 'daily', days: [0, 1, 2, 3, 4, 5, 6], start: '10:00', stop: '18:00' }],
    exceptions: [{ id: 'x', date: '2026-12-25', kind: 'closed' }],
    startCueId: a,
    projectorsOn: true,
    projectorLeadMinutes: 5,
    projectorsOff: true,
    shutter: true,
  }));
  proj.projectors.hydrate(null);
  proj.projectors.add({ name: 'Left', host: '10.0.0.21', password: 'venue' });
  proj.projectors.add({ name: 'Right', host: '10.0.0.22', port: 14352, enabled: false });
  return { a, b };
}

describe('show control project persistence', () => {
  it('round-trips cues, markers, timecode, schedule and projectors through save and load', async () => {
    const { project } = layers;
    const { a, b } = buildShowControl();
    const before = JSON.parse(JSON.stringify(show.serializeShowControl()));

    const saved = (await project.exportProjectForSave()) as any;
    expect(saved.project.showControl.cues.cues).toHaveLength(2);
    const parsed = JSON.parse(JSON.stringify(saved));

    // Wipe live state so a pass cannot come from leftovers.
    show.hydrateShowControl(null);
    expect(cues.cueList.state.cues).toHaveLength(0);
    expect(get(sched.showSchedule).enabled).toBe(false);
    expect(proj.projectors.serialize().projectors).toHaveLength(0);

    expect(project.importProject(parsed, '/Users/x/projects/show1')).toBe(true);
    await flush();
    tc.timecodeChase.shutdown();

    const after = JSON.parse(JSON.stringify(show.serializeShowControl()));
    expect(after).toEqual(before);
    expect(cues.cueList.state.cues.map((c) => c.name)).toEqual(['Doors', 'Show']);
    expect(cues.cueList.state.cues[0].follow).toEqual({ mode: 'auto', wait: 16, unit: 'beats', target: 'jump', jumpTo: b });
    expect(cues.cueList.state.markers).toEqual([expect.objectContaining({ time: 12.5, cueId: b, label: 'Drop' })]);
    expect(tc.timecodeChase.current).toMatchObject({ source: 'mtc', rate: 29.97, offset: 3600, freewheelSeconds: 4, chaseCues: false });
    expect(get(sched.showSchedule)).toMatchObject({ enabled: true, startCueId: a, projectorLeadMinutes: 5 });
    expect(proj.projectors.serialize().projectors.map((p) => [p.name, p.host, p.port, p.enabled, p.password])).toEqual([
      ['Left', '10.0.0.21', 4352, true, 'venue'],
      ['Right', '10.0.0.22', 14352, false, ''],
    ]);
    // Loading never fires a cue or starts a follow.
    expect(cues.cueList.state.currentCueId).toBeNull();
    expect(cues.cueList.state.pendingFollow).toBeNull();
  });

  it('is in the autosave export and not in the live sync export', () => {
    const { project } = layers;
    buildShowControl();
    expect(JSON.parse(project.exportProjectJSON()).project.showControl.cues.cues).toHaveLength(2);
    expect((project.exportProject() as any).project.showControl).toBeUndefined();
  });

  it('a saved project without the section clears the previous show control', async () => {
    const { project } = layers;
    buildShowControl();
    const legacy = {
      version: '1.9.5',
      project: { id: 'p', name: 'old', width: 1920, height: 1080, layers: [], stage3d: { schemaVersion: 1, nodes: [] } },
    };
    expect(project.importProject(legacy)).toBe(true);
    await flush();
    expect(cues.cueList.state.cues).toHaveLength(0);
    expect(get(sched.showSchedule).enabled).toBe(false);
    expect(proj.projectors.serialize().projectors).toHaveLength(0);
    expect(tc.timecodeChase.current.source).toBe('off');
  });

  it('a live sync payload leaves the running cue list alone', async () => {
    const { project } = layers;
    buildShowControl();
    const sync = JSON.parse(JSON.stringify(project.exportProject()));
    expect(project.importProject(sync)).toBe(true);
    await flush();
    expect(cues.cueList.state.cues).toHaveLength(2);
  });
});
