/**
 * End-to-end project persistence for the show timeline.
 *
 * The store's own round-trip is covered in showTimeline.test.ts. What THIS
 * suite proves is the wiring nobody notices until a user loses a show:
 *
 *   project.exportProjectForSave()  →  JSON  →  project.importProject()
 *
 * i.e. that the section is actually written into `project.showTimeline` by
 * the save path, that `importProject` restores it with the projectDir it was
 * handed, and that a project WITHOUT the section clears the previous one
 * instead of silently inheriting an arrangement that would start firing
 * presets.
 *
 * layers.ts touches the DOM at import time (settings.ts applies the colour
 * scheme), so the suite installs a minimal shim first. vitest runs in the
 * `node` environment for the whole repo and this is the cheapest way to
 * exercise the real store rather than a stand-in.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';

let layers: typeof import('./layers');
let showTimelineStore: typeof import('./showTimeline');

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

/** importProject defers the show-timeline restore into a queueMicrotask,
 *  the same as the stage3d / projection-sim restores it sits beside. */
const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeAll(async () => {
  installDomShim();
  layers = await import('./layers');
  showTimelineStore = await import('./showTimeline');
});

beforeEach(() => {
  showTimelineStore.showTimeline._resetForTest();
});

/** A show with 2 audio tracks and 3 preset clips — the shape the brief
 *  asks us to prove survives a save/load. */
async function buildShow() {
  const { showTimeline } = showTimelineStore;
  showTimeline.addPresetClip('comp-opening', 60, 'Opening');
  showTimeline.addPresetClip('comp-drop', 30, 'Drop');
  showTimeline.addPresetClip('comp-outro', 45, 'Outro');
  await showTimeline.addAudioTrack({
    name: 'bed.wav',
    url: 'blob:http://localhost:1420/bed-runtime',
    assetRef: { kind: 'local-file', originalPath: '/Users/x/music/bed.wav', name: 'bed.wav' },
    startTime: 0,
    duration: 120,
  });
  await showTimeline.addAudioTrack({
    name: 'stinger.wav',
    url: 'blob:http://localhost:1420/stinger-runtime',
    assetRef: { kind: 'local-file', originalPath: '/Users/x/music/stinger.wav', name: 'stinger.wav' },
    startTime: 90,
    duration: 20,
    lane: 1,
  });
  showTimeline.setLoop(true);
  showTimeline.setOpen(true);
}

describe('show timeline project persistence', () => {
  it('round-trips 2 audio tracks + 3 preset clips through save → JSON → load', async () => {
    const { project } = layers;
    const { showTimeline } = showTimelineStore;

    await buildShow();
    const before = get(showTimeline);
    expect(before.presetClips).toHaveLength(3);
    expect(before.audioTracks).toHaveLength(2);
    expect(before.duration).toBe(135);

    const saved = (await project.exportProjectForSave()) as any;

    // The section must land on the project, and the save must have blanked
    // the dead blob URLs (the AssetRefs can rebuild them).
    expect(saved.version).toBe('1.9.5');
    expect(saved.project.showTimeline).toBeTruthy();
    expect(saved.project.showTimeline.presetClips).toHaveLength(3);
    expect(saved.project.showTimeline.audioTracks).toHaveLength(2);
    for (const track of saved.project.showTimeline.audioTracks) {
      expect(track.url).toBe('');
      expect(track.assetRef.originalPath).toContain('/Users/x/music/');
    }

    // Through a real serialize/parse cycle, exactly like the .gha file.
    const json = JSON.stringify(saved);
    const parsed = JSON.parse(json);

    // Wipe the live state so a pass could not come from leftovers.
    showTimeline._resetForTest();
    expect(get(showTimeline).presetClips).toHaveLength(0);

    expect(project.importProject(parsed, '/Users/x/projects/show1')).toBe(true);
    await flushMicrotasks();

    const after = get(showTimeline);
    expect(after.presetClips.map((c) => [c.compositionId, c.startTime, c.duration])).toEqual([
      ['comp-opening', 0, 60],
      ['comp-drop', 60, 30],
      ['comp-outro', 90, 45],
    ]);
    expect(after.presetClips.map((c) => c.label)).toEqual(['Opening', 'Drop', 'Outro']);
    expect(after.audioTracks.map((t) => [t.name, t.startTime, t.duration, t.lane])).toEqual([
      ['bed.wav', 0, 120, 0],
      ['stinger.wav', 90, 20, 1],
    ]);
    // Audio URLs recomputed from the AssetRefs, not the dead blobs.
    for (const track of after.audioTracks) {
      expect(track.url).toBeTruthy();
      expect(track.url).not.toContain('blob:');
      expect(track.url).toContain(track.name);
    }
    expect(after.loop).toBe(true);
    expect(after.duration).toBe(135);
    // Never resume a transport on load.
    expect(after.isPlaying).toBe(false);
    expect(after.currentTime).toBe(0);
    expect(after.activeClipId).toBeNull();
  });

  it('keeps the show out of the live sync export (save-only section)', async () => {
    const { project } = layers;
    await buildShow();
    const sync = project.exportProject() as any;
    // Same treatment as stage3d / projectionSim: the relay must not carry it.
    expect(sync.project.showTimeline).toBeUndefined();
    expect(sync.version).toBe('1.9.5');
  });

  it('includes the show in the autosave JSON export', async () => {
    const { project } = layers;
    await buildShow();
    const auto = JSON.parse(project.exportProjectJSON());
    expect(auto.project.showTimeline.presetClips).toHaveLength(3);
    expect(auto.project.showTimeline.audioTracks).toHaveLength(2);
  });

  it('clears the arrangement when a SAVED project carries no show section', async () => {
    const { project } = layers;
    const { showTimeline } = showTimelineStore;
    await buildShow();
    expect(get(showTimeline).presetClips).toHaveLength(3);

    // A pre-1.9.5 save: it carries the other save-only sections but no show.
    // Opening it must not leave the previous project's show firing presets.
    const legacy = {
      version: '1.9.2',
      project: {
        id: 'p', name: 'legacy', width: 1920, height: 1080, layers: [],
        stage3d: { schemaVersion: 1, nodes: [] },
      },
    };
    expect(project.importProject(legacy, '/Users/x/projects/legacy')).toBe(true);
    await flushMicrotasks();

    const after = get(showTimeline);
    expect(after.presetClips).toHaveLength(0);
    expect(after.audioTracks).toHaveLength(0);
    expect(after.duration).toBe(0);
  });

  it('leaves the arrangement alone for a live state-sync payload', async () => {
    // importProject is ALSO the receiver for the output-window state relay,
    // and exportProject() omits every save-only section. Treating that
    // absence as "empty" would wipe the receiver's show on every tick.
    const { project } = layers;
    const { showTimeline } = showTimelineStore;
    await buildShow();

    const relayPayload = project.exportProject() as any;
    expect(relayPayload.project.showTimeline).toBeUndefined();
    expect(relayPayload.project.stage3d).toBeUndefined();

    expect(project.importProject(relayPayload)).toBe(true);
    await flushMicrotasks();

    const after = get(showTimeline);
    expect(after.presetClips).toHaveLength(3);
    expect(after.audioTracks).toHaveLength(2);
    expect(after.duration).toBe(135);
  });

  it('registers a composition loader that reaches project.loadComposition', async () => {
    const { project } = layers;
    const { showTimeline } = showTimelineStore;

    // Give the project a real composition so loadComposition has something
    // to find, then prove seek() actually swaps the layer stack.
    project.saveComposition('Timeline Target');
    const comp = get(project).vjMode?.compositions.at(-1);
    expect(comp).toBeTruthy();

    showTimeline.addPresetClip(comp!.id, 30, comp!.name);
    showTimeline.seek(5);
    expect(get(project).vjMode?.activeCompositionId).toBe(comp!.id);
  });
});
